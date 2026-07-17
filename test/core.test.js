import test from "node:test";
import assert from "node:assert/strict";

import {
  CoreError,
  calculateOuterSize,
  createInitialSettings,
  createPreset,
  deletePreset,
  isWithinTolerance,
  normalizeSettings,
  setDefaultPreset,
  updatePreset,
  validateDimensions
} from "../core.js";

test("creates the four initial presets with 1440x900 as default", () => {
  const settings = createInitialSettings();
  assert.equal(settings.presets.length, 4);
  assert.equal(settings.defaultPresetId, "preset-1440-900");
});

test("keeps an intentionally empty preset list", () => {
  const settings = normalizeSettings({ version: 1, presets: [], defaultPresetId: null });
  assert.deepEqual(settings.presets, []);
  assert.equal(settings.defaultPresetId, null);
});

test("validates integers and configured ranges", () => {
  assert.deepEqual(validateDimensions("1440", "900"), {
    valid: true,
    width: 1440,
    height: 900
  });
  assert.equal(validateDimensions("14.4", "900").code, "INVALID_INTEGER");
  assert.equal(validateDimensions(319, 900).code, "WIDTH_OUT_OF_RANGE");
  assert.equal(validateDimensions(1440, 4321).code, "HEIGHT_OUT_OF_RANGE");
});

test("adds the first preset as the default after an empty state", () => {
  const empty = { version: 1, presets: [], defaultPresetId: null };
  const { settings } = createPreset(empty, "new", 1024, 768);
  assert.equal(settings.defaultPresetId, "new");
});

test("rejects duplicate presets during create and update", () => {
  const settings = createInitialSettings();
  assert.throws(
    () => createPreset(settings, "duplicate", 1440, 900),
    (error) => error instanceof CoreError && error.code === "DUPLICATE_PRESET"
  );
  assert.throws(
    () => updatePreset(settings, "preset-1728-1117", 1440, 900),
    (error) => error instanceof CoreError && error.code === "DUPLICATE_PRESET"
  );
});

test("edits every preset, including initial presets", () => {
  const settings = updatePreset(createInitialSettings(), "preset-1728-1117", 1600, 1000);
  assert.deepEqual(settings.presets[0], {
    id: "preset-1728-1117",
    width: 1600,
    height: 1000
  });
});

test("deleting the default selects the first remaining preset, then allows empty", () => {
  let settings = setDefaultPreset(createInitialSettings(), "preset-1728-1117");
  settings = deletePreset(settings, "preset-1728-1117");
  assert.equal(settings.defaultPresetId, "preset-1440-900");

  for (const preset of [...settings.presets]) {
    settings = deletePreset(settings, preset.id);
  }
  assert.equal(settings.presets.length, 0);
  assert.equal(settings.defaultPresetId, null);
});

test("calculates target outer size from live browser chrome offsets", () => {
  assert.deepEqual(
    calculateOuterSize(
      { width: 1400, height: 900 },
      { width: 1384, height: 812 },
      { width: 1440, height: 900 }
    ),
    { width: 1456, height: 988 }
  );
});

test("accepts one-pixel calibration tolerance", () => {
  assert.equal(
    isWithinTolerance({ width: 1439, height: 901 }, { width: 1440, height: 900 }),
    true
  );
  assert.equal(
    isWithinTolerance({ width: 1438, height: 900 }, { width: 1440, height: 900 }),
    false
  );
});
