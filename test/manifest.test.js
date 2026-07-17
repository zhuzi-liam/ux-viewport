import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8")
);

test("automatically injects the widget on ordinary web pages", () => {
  assert.deepEqual(manifest.host_permissions, ["http://*/*", "https://*/*"]);
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["widget.js"],
      run_at: "document_idle"
    }
  ]);
});
