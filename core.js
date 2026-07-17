export const SETTINGS_KEY = "uxViewportSettings";
export const SETTINGS_VERSION = 1;
export const RESIZE_LIMITS = Object.freeze({
  minWidth: 320,
  maxWidth: 7680,
  minHeight: 320,
  maxHeight: 4320
});

export const INITIAL_PRESETS = Object.freeze([
  Object.freeze({ id: "preset-1728-1117", width: 1728, height: 1117 }),
  Object.freeze({ id: "preset-1440-900", width: 1440, height: 900 }),
  Object.freeze({ id: "preset-1280-720", width: 1280, height: 720 }),
  Object.freeze({ id: "preset-768-900", width: 768, height: 900 })
]);

export class CoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CoreError";
    this.code = code;
  }
}

export function createInitialSettings() {
  return {
    version: SETTINGS_VERSION,
    presets: INITIAL_PRESETS.map((preset) => ({ ...preset })),
    defaultPresetId: "preset-1440-900"
  };
}

export function normalizeSettings(value) {
  if (!value || value.version !== SETTINGS_VERSION || !Array.isArray(value.presets)) {
    return createInitialSettings();
  }

  const presets = value.presets
    .filter((preset) => preset && typeof preset.id === "string")
    .map((preset) => {
      const normalized = {
        id: preset.id,
        width: Number(preset.width),
        height: Number(preset.height)
      };
      if (
        normalized.id === "preset-1280-800" &&
        normalized.width === 1280 &&
        normalized.height === 800
      ) {
        return { id: "preset-1280-720", width: 1280, height: 720 };
      }
      return normalized;
    })
    .filter((preset) => validateDimensions(preset.width, preset.height).valid)
    .filter((preset, index, list) =>
      list.findIndex((candidate) => sameSize(candidate, preset)) === index
    );

  const requestedDefaultId =
    value.defaultPresetId === "preset-1280-800"
      ? "preset-1280-720"
      : value.defaultPresetId;
  const defaultPresetId = presets.some((preset) => preset.id === requestedDefaultId)
    ? requestedDefaultId
    : presets[0]?.id ?? null;

  return { version: SETTINGS_VERSION, presets, defaultPresetId };
}

function parseInteger(value) {
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function validateDimensions(widthValue, heightValue) {
  const width = parseInteger(widthValue);
  const height = parseInteger(heightValue);

  if (width === null || height === null) {
    return {
      valid: false,
      code: "INVALID_INTEGER",
      message: "请输入整数宽度和高度。"
    };
  }

  if (width < RESIZE_LIMITS.minWidth || width > RESIZE_LIMITS.maxWidth) {
    return {
      valid: false,
      code: "WIDTH_OUT_OF_RANGE",
      message: `宽度需在 ${RESIZE_LIMITS.minWidth}–${RESIZE_LIMITS.maxWidth} 之间。`
    };
  }

  if (height < RESIZE_LIMITS.minHeight || height > RESIZE_LIMITS.maxHeight) {
    return {
      valid: false,
      code: "HEIGHT_OUT_OF_RANGE",
      message: `高度需在 ${RESIZE_LIMITS.minHeight}–${RESIZE_LIMITS.maxHeight} 之间。`
    };
  }

  return { valid: true, width, height };
}

export function sameSize(first, second) {
  return first.width === second.width && first.height === second.height;
}

export function createPreset(settingsValue, id, widthValue, heightValue) {
  const settings = normalizeSettings(settingsValue);
  const dimensions = validateOrThrow(widthValue, heightValue);
  assertUnique(settings.presets, dimensions);

  const preset = { id, width: dimensions.width, height: dimensions.height };
  const presets = [...settings.presets, preset];
  return {
    settings: {
      ...settings,
      presets,
      defaultPresetId: settings.defaultPresetId ?? id
    },
    preset
  };
}

export function updatePreset(settingsValue, id, widthValue, heightValue) {
  const settings = normalizeSettings(settingsValue);
  if (!settings.presets.some((preset) => preset.id === id)) {
    throw new CoreError("PRESET_NOT_FOUND", "未找到该预设尺寸。");
  }

  const dimensions = validateOrThrow(widthValue, heightValue);
  assertUnique(settings.presets, dimensions, id);

  return {
    ...settings,
    presets: settings.presets.map((preset) =>
      preset.id === id ? { ...preset, ...dimensions } : preset
    )
  };
}

export function deletePreset(settingsValue, id) {
  const settings = normalizeSettings(settingsValue);
  const presets = settings.presets.filter((preset) => preset.id !== id);
  if (presets.length === settings.presets.length) {
    throw new CoreError("PRESET_NOT_FOUND", "未找到该预设尺寸。");
  }

  return {
    ...settings,
    presets,
    defaultPresetId:
      settings.defaultPresetId === id ? presets[0]?.id ?? null : settings.defaultPresetId
  };
}

export function setDefaultPreset(settingsValue, id) {
  const settings = normalizeSettings(settingsValue);
  if (!settings.presets.some((preset) => preset.id === id)) {
    throw new CoreError("PRESET_NOT_FOUND", "未找到该预设尺寸。");
  }
  return { ...settings, defaultPresetId: id };
}

export function calculateOuterSize(outer, viewport, target) {
  return {
    width: Math.round(outer.width + target.width - viewport.width),
    height: Math.round(outer.height + target.height - viewport.height)
  };
}

export function isWithinTolerance(actual, target, tolerance = 1) {
  return (
    Math.abs(actual.width - target.width) <= tolerance &&
    Math.abs(actual.height - target.height) <= tolerance
  );
}

function validateOrThrow(width, height) {
  const result = validateDimensions(width, height);
  if (!result.valid) {
    throw new CoreError(result.code, result.message);
  }
  return { width: result.width, height: result.height };
}

function assertUnique(presets, dimensions, excludedId = null) {
  if (
    presets.some(
      (preset) => preset.id !== excludedId && sameSize(preset, dimensions)
    )
  ) {
    throw new CoreError("DUPLICATE_PRESET", "该预设尺寸已存在。");
  }
}
