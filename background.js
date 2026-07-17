import {
  CoreError,
  SETTINGS_KEY,
  calculateOuterSize,
  createInitialSettings,
  createPreset,
  deletePreset,
  isWithinTolerance,
  normalizeSettings,
  setDefaultPreset,
  updatePreset,
  validateDimensions
} from "./core.js";

const HOST_ID = "ux-viewport-extension-host";
const POSITION_KEY = "uxViewportPosition";
const resizeLocks = new Set();

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSettings();
});

chrome.action.onClicked.addListener((tab) => {
  void openWidgetFromAction(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse(errorResponse(error)));
  return true;
});

async function openWidgetFromAction(tab) {
  if (!tab.id || !isSupportedUrl(tab.url)) {
    if (tab.id) {
      await showUnsupportedBadge(tab.id);
    }
    return;
  }

  await clearActionBadge(tab.id);

  try {
    await injectOrShowWidget(tab.id, true);
  } catch (error) {
    await showUnsupportedBadge(tab.id);
    console.warn("UX Viewport could not be injected:", error);
  }
}

async function injectOrShowWidget(tabId, expand) {
  const [{ result: hostExists = false } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (hostId) => Boolean(document.getElementById(hostId)),
    args: [HOST_ID]
  });

  if (hostExists) {
    if (expand) {
      await chrome.tabs.sendMessage(tabId, { type: "SHOW_WIDGET" });
    }
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["widget.js"]
  });
  if (expand) {
    await chrome.tabs.sendMessage(tabId, { type: "SHOW_WIDGET" });
  }
}

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") {
    throw new CoreError("INVALID_MESSAGE", "无法识别该操作。");
  }

  switch (message.type) {
    case "GET_INITIAL_STATE":
      return {
        ok: true,
        settings: await getSettings(),
        session: { position: await getGlobalPosition(), collapsed: true }
      };
    case "GET_SETTINGS":
      return { ok: true, settings: await getSettings() };
    case "PRESET_CREATE":
      return mutateSettings((settings) =>
        createPreset(
          settings,
          `preset-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
          message.width,
          message.height
        ).settings
      );
    case "PRESET_UPDATE":
      return mutateSettings((settings) =>
        updatePreset(settings, message.id, message.width, message.height)
      );
    case "PRESET_DELETE":
      return mutateSettings((settings) => deletePreset(settings, message.id));
    case "PRESET_SET_DEFAULT":
      return mutateSettings((settings) => setDefaultPreset(settings, message.id));
    case "RESIZE_REQUEST":
      return resizeViewport(message, sender);
    case "WIDGET_STATE_UPDATE":
      return updateWidgetSession(message, sender);
    case "WIDGET_CLOSED":
      return { ok: true };
    default:
      throw new CoreError("UNKNOWN_MESSAGE", "无法识别该操作。");
  }
}

async function mutateSettings(mutator) {
  const settings = mutator(await getSettings());
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return { ok: true, settings };
}

async function ensureSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: createInitialSettings() });
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  if (!stored[SETTINGS_KEY]) {
    const initial = createInitialSettings();
    await chrome.storage.local.set({ [SETTINGS_KEY]: initial });
    return initial;
  }

  const normalized = normalizeSettings(stored[SETTINGS_KEY]);
  if (JSON.stringify(normalized) !== JSON.stringify(stored[SETTINGS_KEY])) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  }
  return normalized;
}

async function updateWidgetSession(message, sender) {
  if (!sender.tab?.id) {
    throw new CoreError("TAB_UNAVAILABLE", "无法获取当前标签页。");
  }

  if (
    message.position === null ||
    (message.position &&
      (message.position.edge === "left" || message.position.edge === "right") &&
      Number.isFinite(message.position.y)) ||
    (message.position &&
      Number.isFinite(message.position.x) &&
      Number.isFinite(message.position.y))
  ) {
    await chrome.storage.local.set({ [POSITION_KEY]: message.position });
  }
  return { ok: true };
}

async function resizeViewport(message, sender) {
  const validation = validateDimensions(message.width, message.height);
  if (!validation.valid) {
    throw new CoreError(validation.code, validation.message);
  }

  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  if (!tabId || typeof windowId !== "number") {
    throw new CoreError("WINDOW_UNAVAILABLE", "无法获取当前浏览器窗口。");
  }
  if (resizeLocks.has(windowId)) {
    throw new CoreError("RESIZE_BUSY", "窗口正在调整，请稍后再试。");
  }

  resizeLocks.add(windowId);
  const target = { width: validation.width, height: validation.height };
  try {
    let browserWindow = await chrome.windows.get(windowId);
    if (browserWindow.state !== "normal") {
      await updateWindowAndWait(windowId, { state: "normal" }, 1200);
    }

    let actual = await measureViewport(tabId);
    let attempts = 0;
    while (attempts < 3 && !isWithinTolerance(actual, target)) {
      browserWindow = await chrome.windows.get(windowId);
      if (
        typeof browserWindow.width !== "number" ||
        typeof browserWindow.height !== "number"
      ) {
        throw new CoreError("WINDOW_BOUNDS_UNAVAILABLE", "无法读取浏览器窗口尺寸。");
      }

      const outer = calculateOuterSize(
        { width: browserWindow.width, height: browserWindow.height },
        actual,
        target
      );
      await updateWindowAndWait(
        windowId,
        { width: outer.width, height: outer.height },
        650
      );
      actual = await measureViewport(tabId);
      attempts += 1;
    }

    const status = isWithinTolerance(actual, target) ? "success" : "constrained";
    return {
      ok: true,
      type: "RESIZE_RESULT",
      status,
      target,
      actual,
      attempts
    };
  } finally {
    resizeLocks.delete(windowId);
  }
}

async function measureViewport(tabId) {
  let measurement;
  try {
    measurement = await chrome.tabs.sendMessage(tabId, { type: "MEASURE_VIEWPORT" });
  } catch {
    throw new CoreError("PAGE_DISCONNECTED", "页面已断开连接，请重新打开 UX Viewport。");
  }
  if (
    !measurement ||
    !Number.isFinite(measurement.width) ||
    !Number.isFinite(measurement.height)
  ) {
    throw new CoreError("MEASURE_FAILED", "无法读取当前网页可视区尺寸。");
  }
  return {
    width: Math.round(measurement.width),
    height: Math.round(measurement.height)
  };
}

function updateWindowAndWait(windowId, updateInfo, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.windows.onBoundsChanged.removeListener(onBoundsChanged);
      error ? reject(error) : resolve(value);
    };
    const onBoundsChanged = (browserWindow) => {
      if (browserWindow.id === windowId) {
        setTimeout(() => finish(browserWindow), 80);
      }
    };
    const timeout = setTimeout(async () => {
      try {
        finish(await chrome.windows.get(windowId));
      } catch (error) {
        finish(null, error);
      }
    }, timeoutMs);

    chrome.windows.onBoundsChanged.addListener(onBoundsChanged);
    chrome.windows.update(windowId, updateInfo).catch((error) => finish(null, error));
  });
}

async function getGlobalPosition() {
  const stored = await chrome.storage.local.get(POSITION_KEY);
  return stored[POSITION_KEY] ?? null;
}

function isSupportedUrl(url) {
  return typeof url === "string" && /^(https?:|file:)/.test(url);
}

async function showUnsupportedBadge(tabId) {
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#222222" }),
    chrome.action.setBadgeText({ tabId, text: "!" }),
    chrome.action.setTitle({
      tabId,
      title: "UX Viewport 无法在当前页面运行"
    })
  ]);
}

async function clearActionBadge(tabId) {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: "" }),
    chrome.action.setTitle({ tabId, title: "Open UX Viewport" })
  ]);
}

function errorResponse(error) {
  return {
    ok: false,
    error: {
      code: error instanceof CoreError ? error.code : "UNEXPECTED_ERROR",
      message: error?.message || "操作失败，请重试。"
    }
  };
}
