(() => {
  "use strict";

  const HOST_ID = "ux-viewport-extension-host";
  const POSITION_KEY = "uxViewportPosition";
  const EDGE_INSET = 8;
  const HOVER_COLLAPSE_DELAY = 180;
  const SURFACE_TRANSITION_MS = 300;
  if (document.getElementById(HOST_ID)) {
    return;
  }

  const ICONS = {
    grip: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7" cy="5" r="1"/><circle cx="13" cy="5" r="1"/><circle cx="7" cy="10" r="1"/><circle cx="13" cy="10" r="1"/><circle cx="7" cy="15" r="1"/><circle cx="13" cy="15" r="1"/></svg>`,
    chevronDown: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 8 4.5 4 4.5-4"/></svg>`,
    chevronUp: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 12 4.5-4 4.5 4"/></svg>`,
    x: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg>`,
    star: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 3.5 2.02 4.1 4.53.66-3.28 3.2.77 4.52L10 13.85l-4.04 2.13.77-4.52-3.28-3.2 4.53-.66L10 3.5Z"/></svg>`,
    pencil: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.9 4.1 3 3-8.75 8.75-3.75.75.75-3.75L12.9 4.1Z"/><path d="m11.4 5.6 3 3"/></svg>`,
    trash: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6.5h10m-7.5 0V4.75h5V6.5m1.5 0-.6 9H6.6l-.6-9M8.25 9v4m3.5-4v4"/></svg>`,
    plus: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11"/></svg>`
  };

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.dataset.edge = "right";
  setImportantStyle(host, "all", "initial");
  setImportantStyle(host, "position", "fixed");
  setImportantStyle(host, "top", "16px");
  setImportantStyle(host, "right", "16px");
  setImportantStyle(host, "z-index", "2147483647");
  setImportantStyle(host, "width", "max-content");
  setImportantStyle(host, "height", "max-content");
  setImportantStyle(host, "margin", "0");
  setImportantStyle(host, "padding", "0");
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = getStyles();
  const app = document.createElement("div");
  app.className = "uxv-root";
  shadow.append(style, app);

  const state = {
    settings: null,
    viewport: measureViewport(),
    expanded: false,
    menuOpen: false,
    loading: false,
    formMode: null,
    formPresetId: null,
    formDraft: { width: "", height: "", save: false },
    formError: "",
    notice: null,
    position: null,
    settingsMutationPending: false,
    destroyed: false,
    collapseTimer: null
  };

  let resizeTimer = null;
  let positionSaveTimer = null;
  let surfaceTransition = null;

  const onWindowPointerDown = (event) => {
    if (state.expanded && !host.contains(event.target)) {
      setExpanded(false);
    }
  };
  const onWindowKeyDown = (event) => {
    if (event.key === "Escape" && state.expanded) {
      setExpanded(false);
    }
  };
  const onWindowResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      state.viewport = measureViewport();
      updateViewportLabels();
      clampHost(true);
    }, 70);
  };
  const onStorageChanged = (changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    if (changes.uxViewportSettings?.newValue) {
      state.settings = changes.uxViewportSettings.newValue;
      if (!state.settingsMutationPending) {
        render();
      }
    }
    if (Object.hasOwn(changes, POSITION_KEY)) {
      state.position = normalizeStoredPosition(changes[POSITION_KEY].newValue);
      applyStoredPosition();
      clampHost(false);
    }
  };
  const onRuntimeMessage = (message, _sender, sendResponse) => {
    if (message?.type === "MEASURE_VIEWPORT") {
      sendResponse(measureViewport());
      return false;
    }
    if (message?.type === "SHOW_WIDGET") {
      setExpanded(true);
      return false;
    }
    return false;
  };

  window.addEventListener("pointerdown", onWindowPointerDown, true);
  window.addEventListener("keydown", onWindowKeyDown, true);
  window.addEventListener("resize", onWindowResize, { passive: true });
  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  render();
  void initialize();

  async function initialize() {
    const response = await sendMessage({ type: "GET_INITIAL_STATE" });
    if (!response?.ok) {
      showError(response?.error?.message || "初始化失败，请重新打开插件。");
      return;
    }

    state.settings = response.settings;
    state.position = normalizeStoredPosition(response.session?.position);
    applyStoredPosition();
    render();
  }

  function render() {
    if (state.destroyed) return;
    cancelSurfaceTransition();
    app.innerHTML = state.expanded ? renderPanel() : renderCapsule();
    bindRenderedEvents();
    requestAnimationFrame(() => clampHost(false));
  }

  function renderCapsule() {
    return `
      <div class="capsule" role="group" aria-label="UX Viewport">
        <button class="icon-button drag-handle" type="button" data-drag-handle aria-label="拖拽移动">
          ${ICONS.grip}
        </button>
        <span class="capsule-size numeric" data-viewport-size>${formatViewport()}</span>
        <button class="icon-button" type="button" data-action="close" aria-label="关闭 UX Viewport">
          ${ICONS.x}
        </button>
      </div>`;
  }

  function renderPanel() {
    return `
      <section class="panel" aria-label="UX Viewport 尺寸控制">
        <header class="panel-header">
          <button class="icon-button drag-handle" type="button" data-drag-handle aria-label="拖拽移动">
            ${ICONS.grip}
          </button>
          <span class="brand">UX Viewport</span>
          <span class="header-spacer"></span>
          <button class="icon-button" type="button" data-action="close" aria-label="关闭 UX Viewport">
            ${ICONS.x}
          </button>
        </header>
        <div class="viewport-summary">
          <span class="eyebrow">当前网页可视区</span>
          <strong class="viewport-value numeric" data-viewport-size>${formatViewport()}</strong>
        </div>
        ${renderPanelBody()}
        ${
          state.notice
            ? `<div class="notice ${state.notice.kind === "error" ? "is-error" : ""}" role="status" aria-live="polite">${escapeHtml(state.notice.message)}</div>`
            : ""
        }
      </section>`;
  }

  function renderPanelBody() {
    if (!state.settings) {
      return `<div class="loading-block" aria-label="正在加载"><span></span><span></span></div>`;
    }
    if (state.formMode) {
      return renderForm();
    }
    if (state.settings.presets.length === 0) {
      return `
        <div class="empty-state">
          <p>暂无预设尺寸</p>
          <button class="button primary" type="button" data-action="open-create">
            ${ICONS.plus}<span>添加预设尺寸</span>
          </button>
        </div>`;
    }

    const defaultPreset = state.settings.presets.find(
      (preset) => preset.id === state.settings.defaultPresetId
    );
    return `
      <div class="controls">
        <div class="split-button ${state.loading ? "is-disabled" : ""}">
          <button class="split-main numeric" type="button" data-action="apply-default" ${state.loading ? "disabled" : ""}>
            ${state.loading ? "正在调整…" : `应用 ${formatPreset(defaultPreset)}`}
          </button>
          <button class="split-toggle" type="button" data-action="toggle-menu" aria-label="展开预设尺寸" aria-expanded="${state.menuOpen}" ${state.loading ? "disabled" : ""}>
            ${state.menuOpen ? ICONS.chevronUp : ICONS.chevronDown}
          </button>
        </div>
        ${state.menuOpen ? renderPresetMenu() : ""}
      </div>`;
  }

  function renderPresetMenu() {
    const rows = state.settings.presets
      .map((preset, index) => {
        const isDefault = preset.id === state.settings.defaultPresetId;
        return `
          <div class="preset-row ${isDefault ? "is-default" : ""}">
            <button class="preset-select numeric" type="button" data-action="apply-preset" data-index="${index}">
              <span class="default-mark" aria-hidden="true">${isDefault ? "★" : ""}</span>
              <span>${formatPreset(preset)}</span>
              ${isDefault ? `<span class="sr-only">当前默认</span>` : ""}
            </button>
            <div class="row-actions">
              ${
                isDefault
                  ? ""
                  : `<button class="icon-button tooltip-button" type="button" data-action="set-default" data-index="${index}" data-tooltip="设为默认" aria-label="设为默认">${ICONS.star}</button>`
              }
              <button class="icon-button tooltip-button" type="button" data-action="edit-preset" data-index="${index}" data-tooltip="编辑" aria-label="编辑预设">${ICONS.pencil}</button>
              <button class="icon-button tooltip-button" type="button" data-action="delete-preset" data-index="${index}" data-tooltip="删除" aria-label="删除预设">${ICONS.trash}</button>
            </div>
          </div>`;
      })
      .join("");

    return `
      <div class="preset-menu" role="menu">
        <div class="preset-list">${rows}</div>
        <button class="custom-entry" type="button" data-action="open-custom">
          ${ICONS.plus}<span>自定义尺寸</span>
        </button>
      </div>`;
  }

  function renderForm() {
    const isEdit = state.formMode === "edit";
    const isCreate = state.formMode === "create";
    const heading = isEdit ? "编辑预设尺寸" : isCreate ? "添加预设尺寸" : "自定义尺寸";
    const submitText = isEdit ? "保存" : isCreate ? "添加" : "应用";
    return `
      <form class="size-form" data-size-form novalidate>
        <div class="form-heading">
          <strong>${heading}</strong>
          <button class="icon-button" type="button" data-action="cancel-form" aria-label="关闭表单">${ICONS.x}</button>
        </div>
        <div class="field-row">
          <label>
            <span>宽度</span>
            <input class="numeric" name="width" inputmode="numeric" autocomplete="off" value="${escapeHtml(state.formDraft.width)}" placeholder="1440" aria-label="宽度" />
          </label>
          <span class="multiply" aria-hidden="true">×</span>
          <label>
            <span>高度</span>
            <input class="numeric" name="height" inputmode="numeric" autocomplete="off" value="${escapeHtml(state.formDraft.height)}" placeholder="900" aria-label="高度" />
          </label>
        </div>
        ${
          state.formMode === "custom"
            ? `<label class="checkbox-row"><input type="checkbox" name="save" ${state.formDraft.save ? "checked" : ""} /><span>保存为预设</span></label>`
            : ""
        }
        <p class="form-error" role="alert">${escapeHtml(state.formError)}</p>
        <div class="form-actions">
          <button class="button secondary" type="button" data-action="cancel-form">取消</button>
          <button class="button primary" type="submit" ${state.loading ? "disabled" : ""}>${state.loading ? "处理中…" : submitText}</button>
        </div>
      </form>`;
  }

  function bindRenderedEvents() {
    const surface = app.firstElementChild;
    surface?.addEventListener("pointerenter", onSurfacePointerEnter);
    surface?.addEventListener("pointerleave", onSurfacePointerLeave);
    app.querySelectorAll("[data-drag-handle]").forEach(bindDragHandle);
    app.querySelectorAll("[data-action]").forEach((element) => {
      element.addEventListener("click", onActionClick);
    });
    const form = app.querySelector("[data-size-form]");
    form?.addEventListener("submit", onFormSubmit);
  }

  function onSurfacePointerEnter() {
    clearTimeout(state.collapseTimer);
    if (!state.expanded) {
      setExpanded(true);
    }
  }

  function onSurfacePointerLeave() {
    clearTimeout(state.collapseTimer);
    if (!state.expanded || state.formMode || state.loading || host.dataset.dragging === "true") {
      return;
    }
    state.collapseTimer = setTimeout(() => setExpanded(false), HOVER_COLLAPSE_DELAY);
  }

  function onActionClick(event) {
    const button = event.currentTarget;
    const action = button.dataset.action;
    const index = Number(button.dataset.index);
    const preset = Number.isInteger(index) ? state.settings?.presets[index] : null;

    switch (action) {
      case "close":
        closeWidget();
        break;
      case "toggle-menu":
        state.menuOpen = !state.menuOpen;
        state.notice = null;
        render();
        break;
      case "apply-default": {
        const selected = state.settings?.presets.find(
          (item) => item.id === state.settings.defaultPresetId
        );
        if (selected) void applyResize(selected);
        break;
      }
      case "apply-preset":
        if (preset) void applyResize(preset);
        break;
      case "set-default":
        if (preset) void mutatePreset({ type: "PRESET_SET_DEFAULT", id: preset.id });
        break;
      case "edit-preset":
        if (preset) openForm("edit", preset);
        break;
      case "delete-preset":
        if (preset) void mutatePreset({ type: "PRESET_DELETE", id: preset.id });
        break;
      case "open-create":
        openForm("create");
        break;
      case "open-custom":
        openForm("custom");
        break;
      case "cancel-form":
        closeForm();
        break;
      default:
        break;
    }
  }

  function openForm(mode, preset = null) {
    state.formMode = mode;
    state.formPresetId = preset?.id ?? null;
    state.formDraft = {
      width: preset ? String(preset.width) : "",
      height: preset ? String(preset.height) : "",
      save: false
    };
    state.formError = "";
    state.menuOpen = false;
    state.notice = null;
    render();
    requestAnimationFrame(() => app.querySelector('input[name="width"]')?.focus());
  }

  function closeForm() {
    state.formMode = null;
    state.formPresetId = null;
    state.formError = "";
    render();
  }

  async function onFormSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    state.formDraft = {
      width: String(formData.get("width") ?? "").trim(),
      height: String(formData.get("height") ?? "").trim(),
      save: formData.get("save") === "on"
    };
    state.formError = "";
    state.loading = true;
    render();

    if (state.formMode === "edit") {
      const response = await sendSettingsMutation({
        type: "PRESET_UPDATE",
        id: state.formPresetId,
        width: state.formDraft.width,
        height: state.formDraft.height
      });
      finishFormMutation(response);
      return;
    }

    if (state.formMode === "create") {
      const response = await sendSettingsMutation({
        type: "PRESET_CREATE",
        width: state.formDraft.width,
        height: state.formDraft.height
      });
      finishFormMutation(response);
      return;
    }

    if (state.formDraft.save) {
      const createResponse = await sendSettingsMutation({
        type: "PRESET_CREATE",
        width: state.formDraft.width,
        height: state.formDraft.height
      });
      if (!createResponse?.ok) {
        state.loading = false;
        state.formError = createResponse?.error?.message || "保存失败，请重试。";
        render();
        return;
      }
      state.settings = createResponse.settings;
    }

    const dimensions = {
      width: state.formDraft.width,
      height: state.formDraft.height
    };
    state.formMode = null;
    state.loading = false;
    render();
    await applyResize(dimensions);
  }

  function finishFormMutation(response) {
    state.loading = false;
    if (!response?.ok) {
      state.formError = response?.error?.message || "操作失败，请重试。";
      render();
      return;
    }
    state.settings = response.settings;
    state.formMode = null;
    state.formPresetId = null;
    state.notice = { kind: "success", message: "预设已保存。" };
    render();
  }

  async function mutatePreset(message) {
    const response = await sendSettingsMutation(message);
    if (!response?.ok) {
      showError(response?.error?.message || "操作失败，请重试。");
      return;
    }
    state.settings = response.settings;
    state.notice = null;
    render();
  }

  async function applyResize(preset) {
    if (state.loading) return;
    clearTimeout(state.collapseTimer);
    state.loading = true;
    state.menuOpen = false;
    state.notice = null;
    render();

    const response = await sendMessage({
      type: "RESIZE_REQUEST",
      width: preset.width,
      height: preset.height
    });
    state.loading = false;

    if (!response?.ok) {
      showError(response?.error?.message || "调整失败，请重试。");
      return;
    }

    state.viewport = response.actual;
    if (response.status === "success") {
      state.notice = {
        kind: "success",
        message: `已调整为 ${formatSize(response.actual.width, response.actual.height)}。`
      };
      render();
      state.collapseTimer = setTimeout(() => setExpanded(false), 650);
      return;
    }

    state.notice = {
      kind: "error",
      message: `未达到目标：${formatSize(response.target.width, response.target.height)}，实际 ${formatSize(response.actual.width, response.actual.height)}。`
    };
    render();
  }

  function setExpanded(expanded) {
    clearTimeout(state.collapseTimer);
    if (state.expanded === expanded) {
      return;
    }
    const previousSurface = app.firstElementChild;
    const previousRect = previousSurface?.getBoundingClientRect();
    const transitionGhost = previousSurface?.cloneNode(true) ?? null;
    state.expanded = expanded;
    if (!expanded) {
      state.menuOpen = false;
      state.formMode = null;
      state.formError = "";
      state.notice = null;
    }
    render();
    playSurfaceTransition(transitionGhost, previousRect, expanded);
  }

  function playSurfaceTransition(ghost, previousRect, expanded) {
    const nextSurface = app.firstElementChild;
    if (
      !ghost ||
      !previousRect ||
      !nextSurface ||
      typeof nextSurface.animate !== "function" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const origin = host.dataset.edge === "left" ? "top left" : "top right";
    const nextRect = nextSurface.getBoundingClientRect();
    const edgeIsLeft = host.dataset.edge === "left";
    ghost.classList.add("surface-ghost");
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.width = `${previousRect.width}px`;
    ghost.style.height = `${previousRect.height}px`;
    ghost.style.transformOrigin = origin;
    if (host.dataset.edge === "left") {
      ghost.style.left = "0";
    } else {
      ghost.style.right = "0";
    }
    nextSurface.style.transformOrigin = origin;
    nextSurface.classList.add("surface-transition-target");
    app.append(ghost);

    const backdrop = (expanded ? nextSurface : ghost).cloneNode(false);
    backdrop.classList.remove("surface-ghost");
    backdrop.classList.add("surface-backdrop");
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.style.width = `${expanded ? nextRect.width : previousRect.width}px`;
    backdrop.style.height = `${expanded ? nextRect.height : previousRect.height}px`;
    backdrop.style.transformOrigin = origin;
    if (edgeIsLeft) {
      backdrop.style.left = "0";
    } else {
      backdrop.style.right = "0";
    }
    app.append(backdrop);

    const easing = "cubic-bezier(.42, 0, .58, 1)";
    const nextAnimation = expanded
      ? nextSurface.animate(
          [
            { opacity: 0, transform: "scale(.995)" },
            { opacity: 0, transform: "scale(.995)", offset: 0.2 },
            { opacity: 1, transform: "scale(1)" }
          ],
          { duration: SURFACE_TRANSITION_MS, easing, fill: "both" }
        )
      : nextSurface.animate(
          [
            { opacity: 0, transform: "scale(.99)" },
            { opacity: 0, transform: "scale(.99)", offset: 0.42 },
            { opacity: 1, transform: "scale(1)" }
          ],
          { duration: SURFACE_TRANSITION_MS, easing, fill: "both" }
        );
    const backdropAnimation = backdrop.animate(
      expanded
        ? [
            { width: `${previousRect.width}px`, height: `${previousRect.height}px`, borderRadius: "12px" },
            { width: `${nextRect.width}px`, height: `${nextRect.height}px`, borderRadius: "14px" }
          ]
        : [
            { width: `${previousRect.width}px`, height: `${previousRect.height}px`, borderRadius: "14px" },
            { width: `${nextRect.width}px`, height: `${nextRect.height}px`, borderRadius: "12px" }
          ],
      { duration: SURFACE_TRANSITION_MS, easing, fill: "both" }
    );
    const ghostAnimation = expanded
      ? ghost.animate(
          [
            { opacity: 1 },
            { opacity: 0, offset: 0.4 },
            { opacity: 0 }
          ],
          { duration: SURFACE_TRANSITION_MS, easing, fill: "both" }
        )
      : ghost.animate(
          [
            { opacity: 1 },
            { opacity: 0, offset: 0.35 },
            { opacity: 0 }
          ],
          { duration: SURFACE_TRANSITION_MS, easing, fill: "both" }
        );
    const transition = {
      ghost,
      backdrop,
      nextSurface,
      animations: [nextAnimation, ghostAnimation, backdropAnimation].filter(Boolean)
    };
    surfaceTransition = transition;
    void Promise.all(
      transition.animations.map((animation) => animation.finished.catch(() => undefined))
    ).then(() => finishSurfaceTransition(transition));
  }

  function finishSurfaceTransition(transition) {
    if (surfaceTransition !== transition) {
      return;
    }
    surfaceTransition = null;
    transition.ghost.remove();
    transition.backdrop?.remove();
    transition.animations.forEach((animation) => animation.cancel());
    transition.nextSurface.classList.remove("surface-transition-target");
    transition.nextSurface.style.removeProperty("transform-origin");
  }

  function cancelSurfaceTransition() {
    if (!surfaceTransition) {
      return;
    }
    const transition = surfaceTransition;
    surfaceTransition = null;
    transition.animations.forEach((animation) => animation.cancel());
    transition.ghost.remove();
    transition.backdrop?.remove();
    transition.nextSurface.classList.remove("surface-transition-target");
    transition.nextSurface.style.removeProperty("transform-origin");
  }

  function closeWidget() {
    if (state.destroyed) return;
    state.destroyed = true;
    clearTimeout(resizeTimer);
    clearTimeout(positionSaveTimer);
    clearTimeout(state.collapseTimer);
    cancelSurfaceTransition();
    window.removeEventListener("pointerdown", onWindowPointerDown, true);
    window.removeEventListener("keydown", onWindowKeyDown, true);
    window.removeEventListener("resize", onWindowResize);
    chrome.storage.onChanged.removeListener(onStorageChanged);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    void sendMessage({ type: "WIDGET_CLOSED" });
    host.remove();
  }

  function bindDragHandle(handle) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const start = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        x: rect.left,
        y: rect.top
      };
      handle.setPointerCapture(event.pointerId);
      host.dataset.dragging = "true";

      const onMove = (moveEvent) => {
        const next = clampFreePosition(
          start.x + moveEvent.clientX - start.pointerX,
          start.y + moveEvent.clientY - start.pointerY
        );
        applyFreePosition(next);
      };
      const onEnd = () => {
        const rect = host.getBoundingClientRect();
        state.position = {
          edge: rect.left + rect.width / 2 <= window.innerWidth / 2 ? "left" : "right",
          y: clampVertical(rect.top, rect.height)
        };
        applyEdgePosition(state.position);
        host.dataset.dragging = "false";
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onEnd);
        handle.removeEventListener("pointercancel", onEnd);
        void saveWidgetState();
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onEnd);
      handle.addEventListener("pointercancel", onEnd);
    });
  }

  function applyStoredPosition() {
    if (state.position) {
      state.position.y = clampVertical(state.position.y);
      applyEdgePosition(state.position);
      return;
    }
    setImportantStyle(host, "left", "auto");
    setImportantStyle(host, "right", "16px");
    setImportantStyle(host, "top", "16px");
  }

  function applyFreePosition(position) {
    host.dataset.edge = "free";
    setImportantStyle(host, "left", `${Math.round(position.x)}px`);
    setImportantStyle(host, "right", "auto");
    setImportantStyle(host, "top", `${Math.round(position.y)}px`);
  }

  function applyEdgePosition(position) {
    host.dataset.edge = position.edge;
    if (position.edge === "left") {
      setImportantStyle(host, "left", `${EDGE_INSET}px`);
      setImportantStyle(host, "right", "auto");
    } else {
      setImportantStyle(host, "left", "auto");
      setImportantStyle(host, "right", `${EDGE_INSET}px`);
    }
    setImportantStyle(host, "top", `${Math.round(position.y)}px`);
  }

  function clampHost(saveAfterClamp) {
    if (!state.position || state.destroyed) return;
    const nextY = clampVertical(state.position.y);
    if (nextY !== state.position.y) {
      state.position = { ...state.position, y: nextY };
      applyEdgePosition(state.position);
      if (saveAfterClamp) {
        clearTimeout(positionSaveTimer);
        positionSaveTimer = setTimeout(() => void saveWidgetState(), 120);
      }
    }
  }

  function clampFreePosition(x, y) {
    const rect = host.getBoundingClientRect();
    return {
      x: Math.round(Math.min(Math.max(EDGE_INSET, x), Math.max(EDGE_INSET, window.innerWidth - rect.width - EDGE_INSET))),
      y: clampVertical(y, rect.height)
    };
  }

  function clampVertical(y, height = host.getBoundingClientRect().height) {
    return Math.round(
      Math.min(
        Math.max(EDGE_INSET, y),
        Math.max(EDGE_INSET, window.innerHeight - height - EDGE_INSET)
      )
    );
  }

  function normalizeStoredPosition(position) {
    if (
      position &&
      (position.edge === "left" || position.edge === "right") &&
      Number.isFinite(position.y)
    ) {
      return { edge: position.edge, y: position.y };
    }
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      const width = host.getBoundingClientRect().width;
      return {
        edge: position.x + width / 2 <= window.innerWidth / 2 ? "left" : "right",
        y: position.y
      };
    }
    return null;
  }

  async function saveWidgetState() {
    await sendMessage({
      type: "WIDGET_STATE_UPDATE",
      position: state.position
    });
  }

  function showError(message) {
    state.loading = false;
    state.notice = { kind: "error", message };
    state.expanded = true;
    render();
  }

  function updateViewportLabels() {
    app.querySelectorAll("[data-viewport-size]").forEach((element) => {
      element.textContent = formatViewport();
    });
  }

  function measureViewport() {
    return {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight)
    };
  }

  function formatViewport() {
    return formatSize(state.viewport.width, state.viewport.height);
  }

  function formatPreset(preset) {
    return preset ? formatSize(preset.width, preset.height) : "未设置";
  }

  function formatSize(width, height) {
    return `${width} × ${height}`;
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error) {
            resolve({ ok: false, error: { message: "插件连接已失效，请刷新页面后重试。" } });
            return;
          }
          resolve(response);
        });
      } catch {
        resolve({ ok: false, error: { message: "插件连接已失效，请刷新页面后重试。" } });
      }
    });
  }

  async function sendSettingsMutation(message) {
    state.settingsMutationPending = true;
    try {
      return await sendMessage(message);
    } finally {
      state.settingsMutationPending = false;
    }
  }

  function setImportantStyle(element, property, value) {
    element.style.setProperty(property, value, "important");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getStyles() {
    return `
      :host { color-scheme: light; }
      *, *::before, *::after { box-sizing: border-box; }
      button, input { font: inherit; }
      button { -webkit-tap-highlight-color: transparent; }
      .uxv-root {
        --ink: #222222;
        --text: #333333;
        --muted: #7a7a7a;
        --line: #e5e5e5;
        --soft: #f5f5f5;
        --surface: #ffffff;
        --danger: #b42318;
        color: var(--text);
        font-family: "Avenir Next", "Helvetica Neue", sans-serif;
        font-size: 13px;
        line-height: 1.4;
        letter-spacing: 0;
        user-select: none;
        -webkit-font-smoothing: antialiased;
        position: relative;
      }
      .numeric { font-variant-numeric: tabular-nums; letter-spacing: .01em; }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      svg {
        display: block;
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.55;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .drag-handle svg circle { fill: currentColor; stroke: none; }
      .capsule, .panel {
        background: var(--surface);
        border: 1px solid rgba(34, 34, 34, .12);
        box-shadow: 0 12px 32px rgba(0, 0, 0, .14), 0 2px 8px rgba(0, 0, 0, .06);
      }
      .capsule {
        display: flex;
        align-items: center;
        gap: 2px;
        height: 40px;
        padding: 5px 6px;
        border-radius: 12px;
      }
      .capsule-size {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        min-width: 92px;
        height: 28px;
        padding: 1px 7px 0;
        color: var(--ink);
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        text-align: left;
      }
      .panel {
        width: min(320px, calc(100vw - 16px));
        max-height: calc(100vh - 16px);
        padding: 10px;
        border-radius: 14px;
        overflow: visible;
      }
      .surface-transition-target {
        position: relative;
        z-index: 2;
      }
      .surface-backdrop,
      .surface-ghost {
        position: absolute;
        top: 0;
        margin: 0;
        pointer-events: none;
      }
      .surface-backdrop { z-index: 1; }
      .surface-ghost { z-index: 3; }
      .panel-header {
        display: flex;
        align-items: center;
        height: 30px;
      }
      .brand { margin-left: 4px; color: var(--ink); font-size: 12px; font-weight: 600; letter-spacing: .02em; }
      .header-spacer { flex: 1; }
      .icon-button {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        color: #666;
        background: transparent;
        border: 0;
        border-radius: 7px;
        cursor: pointer;
      }
      .icon-button:hover { color: var(--ink); background: var(--soft); }
      .icon-button:focus-visible, .button:focus-visible, .split-main:focus-visible, .split-toggle:focus-visible, .preset-select:focus-visible, .custom-entry:focus-visible, input:focus-visible {
        outline: 2px solid var(--ink);
        outline-offset: 2px;
      }
      .drag-handle { cursor: grab; touch-action: none; }
      .drag-handle:active { cursor: grabbing; }
      .viewport-summary { padding: 18px 9px 16px; }
      .eyebrow { display: block; margin-bottom: 4px; color: var(--muted); font-size: 11px; }
      .viewport-value { display: block; color: var(--ink); font-size: 25px; font-weight: 600; line-height: 1.15; }
      .controls { position: relative; display: grid; margin: 0 9px 9px; }
      .split-button {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 42px;
        height: 36px;
        overflow: hidden;
        border-radius: 10px;
        background: var(--ink);
      }
      .split-main, .split-toggle {
        color: #fff;
        background: transparent;
        border: 0;
        cursor: pointer;
      }
      .split-main { padding: 0 14px; font-weight: 600; text-align: left; }
      .split-toggle { display: grid; place-items: center; border-left: 1px solid rgba(255,255,255,.2); }
      .split-main:hover, .split-toggle:hover { background: rgba(255,255,255,.1); }
      .split-main:disabled, .split-toggle:disabled { cursor: wait; opacity: .68; }
      .preset-menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        left: 0;
        z-index: 4;
        padding: 6px;
        border: 1px solid var(--line);
        border-radius: 11px;
        background: var(--surface);
        box-shadow: 0 8px 22px rgba(0,0,0,.08);
      }
      .preset-list { max-height: min(252px, calc(100vh - 310px)); padding-bottom: 6px; overflow-y: auto; overscroll-behavior: contain; border-bottom: 1px solid var(--line); }
      .preset-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        min-height: 38px;
        border-radius: 8px;
      }
      .preset-row:hover, .preset-row:focus-within { background: var(--soft); }
      .preset-select {
        display: flex;
        align-items: center;
        min-width: 0;
        height: 38px;
        padding: 0 8px;
        color: var(--text);
        background: transparent;
        border: 0;
        cursor: pointer;
        text-align: left;
      }
      .default-mark { width: 16px; color: var(--ink); font-size: 10px; }
      .row-actions { display: flex; align-items: center; padding-right: 3px; opacity: 0; pointer-events: none; transition: opacity 100ms ease; }
      .preset-row:hover .row-actions, .preset-row:focus-within .row-actions { opacity: 1; pointer-events: auto; }
      .row-actions .icon-button { width: 27px; height: 27px; }
      .row-actions [data-action="delete-preset"]:hover { color: var(--danger); background: #fef3f2; }
      .tooltip-button::after {
        content: attr(data-tooltip);
        position: absolute;
        right: 0;
        bottom: calc(100% + 6px);
        z-index: 3;
        width: max-content;
        max-width: 100px;
        padding: 5px 7px;
        color: #fff;
        background: #111;
        border-radius: 5px;
        font-size: 11px;
        line-height: 1;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transform: translateY(2px);
        transition: opacity 100ms ease, transform 100ms ease;
      }
      .tooltip-button:hover::after, .tooltip-button:focus-visible::after { opacity: 1; transform: translateY(0); }
      .preset-row:first-child .tooltip-button::after { top: calc(100% + 6px); bottom: auto; }
      .custom-entry {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        height: 38px;
        margin-top: 6px;
        padding: 0 9px;
        color: var(--text);
        background: transparent;
        border: 0;
        border-radius: 7px;
        cursor: pointer;
        text-align: left;
      }
      .custom-entry:hover { color: var(--ink); background: var(--soft); }
      .empty-state { display: grid; justify-items: center; gap: 15px; padding: 28px 12px 20px; border-top: 1px solid var(--line); }
      .empty-state p { margin: 0; color: #999; }
      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 36px;
        padding: 0 13px;
        border: 1px solid transparent;
        border-radius: 9px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      }
      .button.primary { color: #fff; background: var(--ink); }
      .button.primary:hover { background: #111; }
      .button.secondary { color: var(--text); background: var(--surface); border-color: var(--line); }
      .button.secondary:hover { background: var(--soft); }
      .button:disabled { cursor: wait; opacity: .6; }
      .button svg { width: 14px; height: 14px; }
      .size-form { display: grid; gap: 13px; padding: 12px 8px 4px; border-top: 1px solid var(--line); }
      .form-heading { display: flex; align-items: center; justify-content: space-between; color: var(--ink); }
      .form-heading strong { font-size: 13px; }
      .field-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 8px; }
      .field-row label { display: grid; gap: 5px; color: var(--muted); font-size: 11px; }
      .field-row input {
        width: 100%;
        height: 38px;
        padding: 0 10px;
        color: var(--ink);
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 8px;
        font-size: 13px;
        user-select: text;
      }
      .multiply { padding-bottom: 10px; color: var(--muted); }
      .checkbox-row { display: flex; align-items: center; gap: 7px; color: var(--text); cursor: pointer; }
      .checkbox-row input { accent-color: var(--ink); }
      .form-error { min-height: 17px; margin: -4px 0 0; color: var(--danger); font-size: 11px; }
      .form-actions { display: flex; justify-content: flex-end; gap: 8px; }
      .notice { min-height: 17px; margin: 8px 8px 0; color: var(--muted); font-size: 11px; }
      .notice.is-error { color: var(--danger); }
      .loading-block { display: grid; gap: 8px; padding: 10px 8px 14px; }
      .loading-block span { display: block; height: 14px; border-radius: 5px; background: var(--soft); }
      .loading-block span:last-child { width: 65%; }
      @media (prefers-reduced-motion: reduce) {
        .row-actions, .tooltip-button::after { transition: none; }
      }
    `;
  }
})();
