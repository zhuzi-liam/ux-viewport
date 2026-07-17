import test from "node:test";
import assert from "node:assert/strict";

test("closing one widget disables and closes every other tab", async () => {
  const stored = {};
  const sentMessages = [];
  const executedScripts = [];
  let onMessage;
  let onActivated;
  let onActionClicked;

  globalThis.chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { onMessage = listener; } }
    },
    action: {
      onClicked: { addListener(listener) { onActionClicked = listener; } },
      async setBadgeText() {},
      async setTitle() {}
    },
    tabs: {
      onActivated: { addListener(listener) { onActivated = listener; } },
      onUpdated: { addListener() {} },
      async query() {
        return [{ id: 1 }, { id: 2 }, { id: 3 }];
      },
      async sendMessage(tabId, message) {
        sentMessages.push({ tabId, message });
      }
    },
    scripting: {
      async executeScript(details) {
        executedScripts.push(details);
        return details.func ? [{ result: false }] : undefined;
      }
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: stored[key] };
        },
        async set(values) {
          Object.assign(stored, values);
        }
      }
    }
  };

  await import(`../background.js?global-close=${Date.now()}`);
  const response = await new Promise((resolve) => {
    onMessage({ type: "WIDGET_CLOSED" }, { tab: { id: 1 } }, resolve);
  });

  assert.deepEqual(response, { ok: true });
  assert.equal(stored.uxViewportVisible, false);
  assert.deepEqual(sentMessages, [
    { tabId: 2, message: { type: "CLOSE_WIDGET" } },
    { tabId: 3, message: { type: "CLOSE_WIDGET" } }
  ]);

  onActivated({ tabId: 2 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executedScripts.length, 0);

  onActionClicked({ id: 1, url: "https://example.com" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored.uxViewportVisible, true);
  assert.equal(executedScripts.length, 2);
  assert.deepEqual(sentMessages.at(-1), {
    tabId: 1,
    message: { type: "SHOW_WIDGET" }
  });

  delete globalThis.chrome;
});
