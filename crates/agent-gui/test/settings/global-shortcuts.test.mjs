import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const STORAGE_KEY = "liveagent.globalShortcuts.v1";
const FIXED_TOGGLE = { accelerator: "F2", enabled: true };

function createMemoryLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    dump() {
      return Object.fromEntries(store);
    },
  };
}

async function withWindow(localStorage, task) {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage };
  try {
    return await task();
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
}

function loadGlobalShortcuts({ invoke } = {}) {
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        invoke: invoke ?? (async () => []),
      },
    },
  });
  return loader.loadModule("src/lib/shortcuts/globalShortcuts.ts");
}

test("readGlobalShortcutBindings always provides the fixed F2 toggle", async () => {
  await withWindow(createMemoryLocalStorage(), async () => {
    const { readGlobalShortcutBindings } = loadGlobalShortcuts();
    assert.deepEqual(readGlobalShortcutBindings(), { toggle: FIXED_TOGGLE });
  });

  await withWindow(createMemoryLocalStorage({ [STORAGE_KEY]: "not-json{" }), async () => {
    const { readGlobalShortcutBindings } = loadGlobalShortcuts();
    assert.deepEqual(readGlobalShortcutBindings(), { toggle: FIXED_TOGGLE });
  });

  await withWindow(createMemoryLocalStorage({ [STORAGE_KEY]: JSON.stringify(42) }), async () => {
    const { readGlobalShortcutBindings } = loadGlobalShortcuts();
    assert.deepEqual(readGlobalShortcutBindings(), { toggle: FIXED_TOGGLE });
  });
});

test("readGlobalShortcutBindings drops legacy summon and overrides legacy toggle with F2", async () => {
  const storage = createMemoryLocalStorage({
    [STORAGE_KEY]: JSON.stringify({
      summon: " Ctrl+Shift+KeyA ",
      toggle: { accelerator: "Alt+KeyT", enabled: false },
      newChat: " Ctrl+Shift+KeyN ",
      pin: { accelerator: "f2", enabled: true },
    }),
  });
  await withWindow(storage, async () => {
    const { readGlobalShortcutBindings } = loadGlobalShortcuts();
    assert.deepEqual(readGlobalShortcutBindings(), {
      toggle: FIXED_TOGGLE,
      newChat: { accelerator: "Ctrl+Shift+KeyN", enabled: true },
    });
  });
});

test("readGlobalShortcutBindings keeps enabled flags and drops invalid entries", async () => {
  const storage = createMemoryLocalStorage({
    [STORAGE_KEY]: JSON.stringify({
      toggle: { accelerator: "Alt+KeyT", enabled: false },
      newChat: { accelerator: "Alt+KeyN" },
      pin: { accelerator: 42, enabled: true },
      unknownAction: { accelerator: "Ctrl+KeyU", enabled: true },
    }),
  });
  await withWindow(storage, async () => {
    const { readGlobalShortcutBindings } = loadGlobalShortcuts();
    assert.deepEqual(readGlobalShortcutBindings(), {
      toggle: FIXED_TOGGLE,
      // enabled 缺省视为启用（legacy 对象无该字段）。
      newChat: { accelerator: "Alt+KeyN", enabled: true },
    });
  });
});

test("writeGlobalShortcutBindings persists the fixed F2 toggle", async () => {
  const storage = createMemoryLocalStorage();
  await withWindow(storage, async () => {
    const { readGlobalShortcutBindings, writeGlobalShortcutBindings } = loadGlobalShortcuts();
    writeGlobalShortcutBindings({
      toggle: { accelerator: "Alt+KeyT", enabled: false },
      newChat: { accelerator: "F2", enabled: true },
      pin: { accelerator: "F9", enabled: false },
    });
    assert.deepEqual(readGlobalShortcutBindings(), {
      toggle: FIXED_TOGGLE,
      pin: { accelerator: "F9", enabled: false },
    });
    assert.deepEqual(JSON.parse(storage.dump()[STORAGE_KEY]), {
      toggle: FIXED_TOGGLE,
      pin: { accelerator: "F9", enabled: false },
    });
  });
});

test("applyGlobalShortcuts registers only enabled bindings with non-empty accelerators", async () => {
  const calls = [];
  const { applyGlobalShortcuts } = loadGlobalShortcuts({
    invoke: async (command, args) => {
      calls.push({ command, args });
      return [{ action: "toggle", accelerator: "F2", error: "taken" }];
    },
  });
  const failures = await applyGlobalShortcuts({
    // 注册入口仍会覆盖调用方传入的旧值，确保固定 F2 不变量。
    toggle: { accelerator: "Alt+KeyT", enabled: false },
    newChat: { accelerator: "F2", enabled: true },
    pin: { accelerator: "   ", enabled: true },
  });
  assert.deepEqual(calls, [
    {
      command: "app_set_global_shortcuts",
      args: { bindings: [{ action: "toggle", accelerator: "F2" }] },
    },
  ]);
  assert.deepEqual(failures, [{ action: "toggle", accelerator: "F2", error: "taken" }]);
});

test("applyGlobalShortcuts tolerates non-Tauri environments and bad responses", async () => {
  const { applyGlobalShortcuts: applyWithThrow } = loadGlobalShortcuts({
    invoke: async () => {
      throw new Error("not tauri");
    },
  });
  assert.deepEqual(await applyWithThrow({ toggle: FIXED_TOGGLE }), []);

  const { applyGlobalShortcuts: applyWithBadResponse } = loadGlobalShortcuts({
    invoke: async () => null,
  });
  assert.deepEqual(await applyWithBadResponse({ toggle: FIXED_TOGGLE }), []);
});

test("applyGlobalShortcuts keeps the fixed F2 binding even when callers pass no bindings", async () => {
  const calls = [];
  const { applyGlobalShortcuts } = loadGlobalShortcuts({
    invoke: async (command, args) => {
      calls.push({ command, args });
      return [];
    },
  });
  await applyGlobalShortcuts({});
  assert.deepEqual(calls, [
    {
      command: "app_set_global_shortcuts",
      args: { bindings: [{ action: "toggle", accelerator: "F2" }] },
    },
  ]);
});

test("applyStoredGlobalShortcuts always registers the fixed global F2 toggle", async () => {
  const calls = [];
  await withWindow(createMemoryLocalStorage(), async () => {
    const { applyStoredGlobalShortcuts } = loadGlobalShortcuts({
      invoke: async (command, args) => {
        calls.push({ command, args });
        return [];
      },
    });
    await applyStoredGlobalShortcuts();
  });
  assert.deepEqual(calls, [
    {
      command: "app_set_global_shortcuts",
      args: { bindings: [{ action: "toggle", accelerator: "F2" }] },
    },
  ]);
});

test("applyStoredGlobalShortcuts keeps F2 when every configurable binding is disabled", async () => {
  const calls = [];
  const storage = createMemoryLocalStorage({
    [STORAGE_KEY]: JSON.stringify({
      newChat: { accelerator: "Alt+KeyN", enabled: false },
    }),
  });
  await withWindow(storage, async () => {
    const { applyStoredGlobalShortcuts } = loadGlobalShortcuts({
      invoke: async (command, args) => {
        calls.push({ command, args });
        return [];
      },
    });
    await applyStoredGlobalShortcuts();
  });
  assert.deepEqual(calls, [
    {
      command: "app_set_global_shortcuts",
      args: { bindings: [{ action: "toggle", accelerator: "F2" }] },
    },
  ]);
});
