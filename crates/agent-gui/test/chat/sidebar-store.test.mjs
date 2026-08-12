import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { createSidebarStore } = loader.loadModule("@liveagent/ui/lib/sidebar/store.ts");

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function conversation(id, overrides = {}) {
  return {
    id,
    title: overrides.title ?? id,
    providerId: "provider",
    model: "model",
    cwd: overrides.cwd,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    isPinned: overrides.isPinned,
    pinnedAt: overrides.pinnedAt,
    isPending: overrides.isPending,
  };
}

function createFakeBackend() {
  const state = {
    pages: new Map(), // scopeKey -> items
    totalCount: 0,
    listError: null,
    workdirs: [],
    workdirsError: null,
    calls: {
      list: [],
      workdirs: 0,
      rename: [],
      pin: [],
      move: [],
      delete: [],
      subscribes: 0,
      unsubscribes: 0,
    },
    listeners: new Set(),
    connectionListeners: new Set(),
    protectedIds: [],
    listImpl: null,
    renameImpl: null,
    moveImpl: null,
    deleteImpl: null,
  };

  const scopeKeyOf = (scope) =>
    scope.kind === "workdir" ? `cwd:${scope.cwd}` : scope.kind === "unscoped" ? "cwd-empty" : "none";

  const backend = {
    listConversations: async (page, pageSize, scope) => {
      state.calls.list.push({ page, pageSize, scope });
      if (state.listImpl) {
        return state.listImpl(page, pageSize, scope);
      }
      if (state.listError) {
        throw new Error(state.listError);
      }
      const all = state.pages.get(scopeKeyOf(scope)) ?? [];
      const start = (page - 1) * pageSize;
      return {
        items: all.slice(start, start + pageSize),
        totalCount: state.totalCount || all.length,
      };
    },
    listWorkdirs: async () => {
      state.calls.workdirs += 1;
      if (state.workdirsError) {
        throw new Error(state.workdirsError);
      }
      return state.workdirs;
    },
    renameConversation: async (id, title) => {
      state.calls.rename.push({ id, title });
      if (state.renameImpl) {
        return state.renameImpl(id, title);
      }
      return conversation(id, { title, updatedAt: 999 });
    },
    setConversationPinned: async (id, isPinned) => {
      state.calls.pin.push({ id, isPinned });
      if (state.pinImpl) {
        return state.pinImpl(id, isPinned);
      }
      return conversation(id, { isPinned, pinnedAt: isPinned ? 500 : null });
    },
    setConversationCwd: async (id, cwd) => {
      state.calls.move.push({ id, cwd });
      if (state.moveImpl) {
        return state.moveImpl(id, cwd);
      }
      return conversation(id, { cwd });
    },
    deleteConversation: async (id) => {
      state.calls.delete.push(id);
      if (state.deleteImpl) {
        return state.deleteImpl(id);
      }
    },
    subscribeEvents: (listener) => {
      state.calls.subscribes += 1;
      state.listeners.add(listener);
      return () => {
        state.calls.unsubscribes += 1;
        state.listeners.delete(listener);
      };
    },
    subscribeConnection: (listener) => {
      state.connectionListeners.add(listener);
      return () => {
        state.connectionListeners.delete(listener);
      };
    },
    getProtectedConversationIds: () => state.protectedIds,
  };

  return {
    state,
    backend,
    emit: (event) => {
      for (const listener of state.listeners) listener(event);
    },
    setConnected: (connected) => {
      for (const listener of state.connectionListeners) listener(connected);
    },
  };
}

const SCOPE_A = { kind: "workdir", cwd: "/tmp/a" };
const SCOPE_B = { kind: "workdir", cwd: "/tmp/b" };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for sidebar store state");
    }
    await sleep(5);
  }
}

function workspaceTarget(cwd) {
  return { pathKey: cwd, cwd };
}

function workspaceFeed(store, cwd) {
  return store.getSnapshot().workspaceFeeds.get(cwd);
}

function workspaceFeedIds(store, cwd) {
  return workspaceFeed(store, cwd)?.conversationIds ?? [];
}

function conversationRange(prefix, cwd, count) {
  return Array.from({ length: count }, (_, index) =>
    conversation(`${prefix}${index + 1}`, { cwd, updatedAt: count - index }),
  );
}

test("initial load fills the list and fetches workdirs exactly once", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [
    conversation("one", { cwd: "/tmp/a", updatedAt: 20 }),
    conversation("two", { cwd: "/tmp/a", updatedAt: 10 }),
  ]);
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();

  const snapshot = store.getSnapshot();
  assert.deepEqual(
    snapshot.conversations.map((item) => item.id),
    ["one", "two"],
  );
  assert.equal(snapshot.listStatus, "ready");
  assert.equal(snapshot.totalCount, 2);
  assert.equal(snapshot.hasMore, false);
  assert.equal(fake.state.calls.workdirs, 1);
  store.stop();
});

test("a failed refresh keeps the visible list and sets an error code", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [conversation("one", { cwd: "/tmp/a" })]);
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();
  assert.equal(store.getSnapshot().conversations.length, 1);

  fake.state.listError = "boom";
  await store.refresh();
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.conversations.length, 1);
  assert.equal(snapshot.listError, "listFailed");
  assert.equal(snapshot.listErrorDetail, "boom");
  assert.equal(snapshot.listStatus, "ready");
  store.stop();
});

test("scope switch paints the cached slice immediately without a wipe", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [conversation("a1", { cwd: "/tmp/a", updatedAt: 5 })]);
  fake.state.pages.set("cwd:/tmp/b", [conversation("b1", { cwd: "/tmp/b", updatedAt: 7 })]);
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();

  // An event for scope B lands in the byId cache without touching scope A.
  fake.emit({
    kind: "upsert",
    conversationId: "b1",
    conversation: conversation("b1", { cwd: "/tmp/b", updatedAt: 7 }),
  });
  assert.deepEqual(
    store.getSnapshot().conversations.map((item) => item.id),
    ["a1"],
  );

  store.setScope(SCOPE_B);
  const switched = store.getSnapshot();
  assert.deepEqual(
    switched.conversations.map((item) => item.id),
    ["b1"],
  );
  assert.equal(switched.listStatus, "syncing");

  await tick();
  assert.equal(store.getSnapshot().listStatus, "ready");
  store.stop();
});

test("scope none resolves empty locally without a backend call", async () => {
  const fake = createFakeBackend();
  const store = createSidebarStore(fake.backend);
  store.setScope({ kind: "none" });
  store.start();
  await tick();
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.listStatus, "ready");
  assert.equal(snapshot.conversations.length, 0);
  assert.equal(fake.state.calls.list.length, 0);
  store.stop();
});

test("reconnect reconciles ghosts away but keeps pending drafts", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [
    conversation("stays", { cwd: "/tmp/a", updatedAt: 30 }),
    conversation("ghost", { cwd: "/tmp/a", updatedAt: 20 }),
  ]);
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();
  store.upsertLocal(conversation("draft", { cwd: "/tmp/a", updatedAt: 40, isPending: true }));
  assert.equal(store.getSnapshot().conversations.length, 3);

  // The other client deletes "ghost" while this one is offline.
  fake.state.pages.set("cwd:/tmp/a", [conversation("stays", { cwd: "/tmp/a", updatedAt: 30 })]);
  const workdirCallsBefore = fake.state.calls.workdirs;
  fake.setConnected(false);
  fake.setConnected(true);
  await tick();

  const snapshot = store.getSnapshot();
  assert.deepEqual(
    snapshot.conversations.map((item) => item.id),
    ["draft", "stays"],
  );
  assert.equal(fake.state.calls.workdirs, workdirCallsBefore + 1);
  store.stop();
});

test("optimistic rename rolls back and records a mutation error on failure", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [
    conversation("one", { cwd: "/tmp/a", title: "before", updatedAt: 10 }),
  ]);
  fake.state.renameImpl = () => {
    throw new Error("rename failed");
  };
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();

  const renamed = await store.rename("one", "after");
  assert.equal(renamed, false);
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.conversations[0].title, "before");
  assert.equal(snapshot.mutationErrors.get("one"), "renameFailed");
  assert.equal(snapshot.mutations.size, 0);
  store.stop();
});

test("rename is blocked for a running conversation without a backend call", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [conversation("one", { cwd: "/tmp/a" })]);
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();

  store.applyRunningPatch({ conversationId: "one", running: true, workdir: "/tmp/a" });
  const renamed = await store.rename("one", "nope");
  assert.equal(renamed, false);
  assert.equal(store.getSnapshot().mutationErrors.get("one"), "renameBlockedRunning");
  assert.equal(fake.state.calls.rename.length, 0);

  store.applyRunningPatch({ conversationId: "one", running: false });
  assert.equal(store.getSnapshot().runningConversationIds.size, 0);
  store.stop();
});

test("move leaves the current scope optimistically, rolls back on failure, and blocks running rows", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [
    conversation("one", { cwd: "/tmp/a", updatedAt: 20 }),
    conversation("two", { cwd: "/tmp/a", updatedAt: 10 }),
  ]);
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();

  let resolveMove;
  fake.state.moveImpl = (id, cwd) =>
    new Promise((resolve) => {
      resolveMove = () => resolve(conversation(id, { cwd }));
    });
  const moving = store.setCwd("one", "/tmp/b");
  assert.deepEqual(
    store.getSnapshot().conversations.map((item) => item.id),
    ["two"],
  );
  assert.equal(store.getSnapshot().mutations.get("one"), "move");
  resolveMove();
  assert.equal(await moving, true);
  assert.deepEqual(fake.state.calls.move, [{ id: "one", cwd: "/tmp/b" }]);

  fake.state.moveImpl = () => Promise.reject(new Error("move failed"));
  assert.equal(await store.setCwd("two", "/tmp/b"), false);
  assert.equal(store.getSnapshot().conversations[0].cwd, "/tmp/a");
  assert.equal(store.getSnapshot().mutationErrors.get("two"), "moveFailed");

  store.applyRunningPatch({ conversationId: "two", running: true, workdir: "/tmp/a" });
  assert.equal(await store.setCwd("two", "/tmp/b"), false);
  assert.equal(store.getSnapshot().mutationErrors.get("two"), "moveBlockedRunning");
  assert.equal(fake.state.calls.move.length, 2);
  store.stop();
});

test("mutations are tracked per row, not globally", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [
    conversation("one", { cwd: "/tmp/a" }),
    conversation("two", { cwd: "/tmp/a" }),
  ]);
  let resolveRename;
  fake.state.renameImpl = () =>
    new Promise((resolve) => {
      resolveRename = () => resolve(conversation("one", { title: "renamed", cwd: "/tmp/a" }));
    });
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();

  const renamePromise = store.rename("one", "renamed");
  await tick();
  assert.equal(store.getSnapshot().mutations.get("one"), "rename");
  assert.equal(store.getSnapshot().mutations.has("two"), false);
  resolveRename();
  await renamePromise;
  assert.equal(store.getSnapshot().mutations.size, 0);
  store.stop();
});

test("delete refreshes workdirs; unseen cwd upserts trigger a debounced refresh", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [conversation("one", { cwd: "/tmp/a" })]);
  fake.state.workdirs = [{ path: "/tmp/a", conversationCount: 1, updatedAt: 10 }];
  const store = createSidebarStore(fake.backend, { workdirsDebounceMs: 5 });
  store.setScope(SCOPE_A);
  store.start();
  await tick();
  assert.equal(fake.state.calls.workdirs, 1);

  // Upsert for a known cwd: no workdirs refresh.
  fake.emit({
    kind: "upsert",
    conversationId: "one",
    conversation: conversation("one", { cwd: "/tmp/a", updatedAt: 50 }),
  });
  await sleep(15);
  assert.equal(fake.state.calls.workdirs, 1);

  // Upsert for an unseen cwd: debounced refresh.
  fake.emit({
    kind: "upsert",
    conversationId: "fresh",
    conversation: conversation("fresh", { cwd: "/tmp/new", updatedAt: 60 }),
  });
  await sleep(15);
  assert.equal(fake.state.calls.workdirs, 2);

  await store.remove("one");
  assert.equal(fake.state.calls.workdirs, 3);
  store.stop();
});

test("workdir activity is maintained incrementally from events", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", []);
  const store = createSidebarStore(fake.backend, { workdirsDebounceMs: 1_000 });
  store.setScope(SCOPE_A);
  store.start();
  await tick();

  fake.emit({
    kind: "upsert",
    conversationId: "one",
    conversation: conversation("one", { cwd: "/tmp/a", updatedAt: 123 }),
  });
  const activity = store.getSnapshot().workdirActivity;
  const key = Array.from(activity.keys())[0];
  assert.equal(activity.get(key), 123);

  fake.emit({ kind: "running", conversationId: "one", workdir: "/tmp/a", updatedAt: 456 });
  const after = store.getSnapshot();
  assert.equal(after.workdirActivity.get(key), 456);
  assert.equal(after.runningConversationIds.has("one"), true);
  assert.equal(after.runningWorkdirPathKeys.size, 1);
  store.stop();
});

test("StrictMode start/stop/start keeps exactly one live subscription", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [conversation("one", { cwd: "/tmp/a" })]);
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  store.stop();
  store.start();
  await tick();

  assert.equal(fake.state.listeners.size, 1);
  assert.equal(fake.state.calls.subscribes, 2);
  assert.equal(fake.state.calls.unsubscribes, 1);

  fake.emit({
    kind: "upsert",
    conversationId: "two",
    conversation: conversation("two", { cwd: "/tmp/a", updatedAt: 99 }),
  });
  assert.deepEqual(
    store.getSnapshot().conversations.map((item) => item.id),
    ["two", "one"],
  );
  store.stop();
  assert.equal(fake.state.listeners.size, 0);
});

test("loadMore appends the next page and updates hasMore", async () => {
  const fake = createFakeBackend();
  const items = [];
  for (let index = 0; index < 5; index += 1) {
    items.push(conversation(`c${index}`, { cwd: "/tmp/a", updatedAt: 100 - index }));
  }
  fake.state.pages.set("cwd:/tmp/a", items);
  const store = createSidebarStore(fake.backend, { pageSize: 2 });
  store.setScope(SCOPE_A);
  store.start();
  await tick();
  assert.equal(store.getSnapshot().conversations.length, 2);
  assert.equal(store.getSnapshot().hasMore, true);

  await store.loadMore();
  assert.equal(store.getSnapshot().conversations.length, 4);
  assert.equal(store.getSnapshot().hasMore, true);

  await store.loadMore();
  assert.equal(store.getSnapshot().conversations.length, 5);
  assert.equal(store.getSnapshot().hasMore, false);
  store.stop();
});

test("reconnect success is not overwritten by a stale loadMore failure", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [
    conversation("one", { cwd: "/tmp/a", updatedAt: 20 }),
    conversation("two", { cwd: "/tmp/a", updatedAt: 10 }),
  ]);
  fake.state.totalCount = 2;
  const store = createSidebarStore(fake.backend, { pageSize: 1 });
  store.setScope(SCOPE_A);
  store.start();
  await tick();

  let rejectStaleLoadMore;
  let pageTwoCalls = 0;
  fake.state.listImpl = (page, pageSize, scope) => {
    if (page === 2) {
      pageTwoCalls += 1;
      if (pageTwoCalls === 1) {
        return new Promise((_, reject) => {
          rejectStaleLoadMore = reject;
        });
      }
    }
    const all = fake.state.pages.get(`cwd:${scope.cwd}`) ?? [];
    const start = (page - 1) * pageSize;
    return {
      items: all.slice(start, start + pageSize),
      totalCount: fake.state.totalCount,
    };
  };

  const loadMorePromise = store.loadMore();
  await tick();
  assert.equal(store.getSnapshot().isLoadingMore, true);

  // The reconnect's fresh first page succeeds while the pre-disconnect
  // pagination request is still unresolved.
  fake.setConnected(false);
  fake.setConnected(true);
  await tick();
  assert.equal(store.getSnapshot().listError, null);
  assert.equal(store.getSnapshot().isLoadingMore, false);
  assert.deepEqual(
    store.getSnapshot().conversations.map((item) => item.id),
    ["one"],
  );

  // The obsolete request no longer owns the in-flight gate; page 2 can be
  // loaded immediately from the recovered generation.
  await store.loadMore();
  assert.equal(pageTwoCalls, 2);
  assert.deepEqual(
    store.getSnapshot().conversations.map((item) => item.id),
    ["one", "two"],
  );

  rejectStaleLoadMore(new Error("stale pagination transport failed"));
  await loadMorePromise;

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.listError, null);
  assert.equal(snapshot.listErrorDetail, null);
  assert.equal(snapshot.totalCount, 2);
  assert.equal(snapshot.hasMore, false);
  store.stop();
});

test("stale loadMore success cannot restore rows removed by reconnect", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [
    conversation("keep", { cwd: "/tmp/a", updatedAt: 20 }),
    conversation("ghost", { cwd: "/tmp/a", updatedAt: 10 }),
  ]);
  fake.state.totalCount = 2;
  const store = createSidebarStore(fake.backend, { pageSize: 1 });
  store.setScope(SCOPE_A);
  store.start();
  await tick();

  let resolveStaleLoadMore;
  fake.state.listImpl = (page) => {
    if (page === 2) {
      return new Promise((resolve) => {
        resolveStaleLoadMore = resolve;
      });
    }
    return {
      items: [conversation("keep", { cwd: "/tmp/a", updatedAt: 20 })],
      totalCount: 1,
    };
  };

  const staleLoadMorePromise = store.loadMore();
  await tick();

  // The authoritative post-reconnect page no longer contains "ghost".
  fake.state.pages.set("cwd:/tmp/a", [conversation("keep", { cwd: "/tmp/a", updatedAt: 20 })]);
  fake.state.totalCount = 1;
  fake.setConnected(false);
  fake.setConnected(true);
  await tick();

  resolveStaleLoadMore({
    items: [conversation("ghost", { cwd: "/tmp/a", updatedAt: 10 })],
    totalCount: 2,
  });
  await staleLoadMorePromise;

  const snapshot = store.getSnapshot();
  assert.deepEqual(
    snapshot.conversations.map((item) => item.id),
    ["keep"],
  );
  assert.equal(snapshot.totalCount, 1);
  assert.equal(snapshot.hasMore, false);
  assert.equal(snapshot.listError, null);
  store.stop();
});

test("upsertLocal and removeLocal manage pending drafts", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", []);
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();

  store.upsertLocal(conversation("draft", { cwd: "/tmp/a", isPending: true, updatedAt: 10 }));
  assert.equal(store.getSnapshot().conversations.length, 1);
  assert.equal(store.getSnapshot().totalCount, 0);
  assert.equal(store.peek("draft").isPending, true);

  store.removeLocal("draft");
  assert.equal(store.getSnapshot().conversations.length, 0);
  assert.equal(store.peek("draft"), undefined);
  store.stop();
});

test("upsertLocal keeps a persisted title when an active-view pending fallback arrives", async () => {
  const fake = createFakeBackend();
  fake.state.pages.set("cwd:/tmp/a", [
    conversation("persisted", { cwd: "/tmp/a", title: "Real title", updatedAt: 10 }),
  ]);
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();

  store.upsertLocal(
    conversation("persisted", {
      cwd: "/tmp/a",
      title: "新对话",
      updatedAt: 20,
      isPending: true,
    }),
  );

  const item = store.peek("persisted");
  assert.equal(item.title, "Real title");
  assert.equal(item.updatedAt, 10);
  assert.equal(item.isPending, undefined);
  assert.equal(store.getSnapshot().totalCount, 1);
  store.stop();
});

test("workspace feeds isolate rows and grow 5 then 15 then 25 without dropping cached rows", async () => {
  const fake = createFakeBackend();
  const rowsA = conversationRange("a", "/tmp/a", 30);
  const rowsB = conversationRange("b", "/tmp/b", 3);
  fake.state.listImpl = (page, pageSize, scope) => {
    const all = scope.cwd === "/tmp/a" ? rowsA : rowsB;
    const start = (page - 1) * pageSize;
    return { items: all.slice(start, start + pageSize), totalCount: all.length };
  };
  const store = createSidebarStore(fake.backend);
  store.setScope({ kind: "none" });
  store.start();
  await tick();

  await store.ensureWorkspaceFeeds([workspaceTarget("/tmp/a"), workspaceTarget("/tmp/b")]);
  assert.deepEqual(
    fake.state.calls.list.map(({ page, pageSize, scope }) => [page, pageSize, scope.cwd]),
    [
      [1, 5, "/tmp/a"],
      [1, 5, "/tmp/b"],
    ],
  );
  assert.deepEqual(workspaceFeedIds(store, "/tmp/a"), rowsA.slice(0, 5).map((item) => item.id));
  assert.deepEqual(workspaceFeedIds(store, "/tmp/b"), rowsB.map((item) => item.id));
  assert.equal(workspaceFeed(store, "/tmp/a").visibleLimit, 5);
  assert.equal(workspaceFeed(store, "/tmp/a").totalCount, 30);
  assert.equal(workspaceFeed(store, "/tmp/b").totalCount, 3);

  await store.loadMoreWorkspaceFeed(workspaceTarget("/tmp/a"));
  assert.equal(fake.state.calls.list.at(-1).pageSize, 15);
  assert.equal(workspaceFeed(store, "/tmp/a").visibleLimit, 15);
  assert.equal(workspaceFeedIds(store, "/tmp/a").length, 15);
  assert.equal(workspaceFeedIds(store, "/tmp/b").length, 3);

  await store.loadMoreWorkspaceFeed(workspaceTarget("/tmp/a"));
  assert.equal(fake.state.calls.list.at(-1).pageSize, 25);
  assert.equal(workspaceFeed(store, "/tmp/a").visibleLimit, 25);
  assert.equal(workspaceFeedIds(store, "/tmp/a").length, 25);
  const cachedIds = [...workspaceFeedIds(store, "/tmp/a")];

  store.collapseWorkspaceFeed("/tmp/a");
  assert.equal(workspaceFeed(store, "/tmp/a").visibleLimit, 5);
  assert.deepEqual(workspaceFeedIds(store, "/tmp/a"), cachedIds);
  store.stop();
});

test("workspace feed requests dedupe by path and never exceed four concurrent reads", async () => {
  const fake = createFakeBackend();
  const pending = [];
  let active = 0;
  let maxActive = 0;
  fake.state.listImpl = (_page, _pageSize, scope) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const gate = deferred();
    pending.push({ cwd: scope.cwd, gate });
    return gate.promise.finally(() => {
      active -= 1;
    });
  };
  const store = createSidebarStore(fake.backend);
  store.setScope({ kind: "none" });
  store.start();
  await tick();

  const targets = Array.from({ length: 6 }, (_, index) => workspaceTarget(`/tmp/feed-${index}`));
  const ensureAll = store.ensureWorkspaceFeeds(targets);
  const ensureDuplicate = store.ensureWorkspaceFeeds([targets[0]]);
  await tick();
  assert.equal(fake.state.calls.list.length, 4);
  assert.equal(maxActive, 4);

  for (const entry of pending.slice(0, 4)) {
    entry.gate.resolve({ items: [], totalCount: 0 });
  }
  await tick();
  await tick();
  assert.equal(fake.state.calls.list.length, 6);
  assert.equal(maxActive, 4);

  for (const entry of pending.slice(4)) {
    entry.gate.resolve({ items: [], totalCount: 0 });
  }
  await Promise.all([ensureAll, ensureDuplicate]);
  assert.equal(new Set(fake.state.calls.list.map((call) => call.scope.cwd)).size, 6);
  store.stop();
});

test("repeated workspace load-more clicks share one request and leave other feed state untouched", async () => {
  const fake = createFakeBackend();
  const rowsA = conversationRange("a", "/tmp/a", 20);
  const rowsB = conversationRange("b", "/tmp/b", 2);
  let loadMoreGate = null;
  fake.state.listImpl = (_page, pageSize, scope) => {
    if (scope.cwd === "/tmp/a" && pageSize === 15 && loadMoreGate) {
      return loadMoreGate.promise;
    }
    const all = scope.cwd === "/tmp/a" ? rowsA : rowsB;
    return { items: all.slice(0, pageSize), totalCount: all.length };
  };
  const store = createSidebarStore(fake.backend);
  store.setScope({ kind: "none" });
  store.start();
  await tick();
  await store.ensureWorkspaceFeeds([workspaceTarget("/tmp/a"), workspaceTarget("/tmp/b")]);
  const feedBBefore = workspaceFeed(store, "/tmp/b");

  loadMoreGate = deferred();
  const first = store.loadMoreWorkspaceFeed(workspaceTarget("/tmp/a"));
  const second = store.loadMoreWorkspaceFeed(workspaceTarget("/tmp/a"));
  await tick();

  assert.equal(
    fake.state.calls.list.filter(
      (call) => call.scope.cwd === "/tmp/a" && call.pageSize === 15,
    ).length,
    1,
  );
  assert.equal(workspaceFeed(store, "/tmp/a").visibleLimit, 15);
  assert.equal(workspaceFeed(store, "/tmp/a").isLoadingMore, true);
  assert.deepEqual(
    {
      ids: workspaceFeedIds(store, "/tmp/b"),
      status: workspaceFeed(store, "/tmp/b").status,
      isLoadingMore: workspaceFeed(store, "/tmp/b").isLoadingMore,
      error: workspaceFeed(store, "/tmp/b").error,
    },
    {
      ids: feedBBefore.conversationIds,
      status: feedBBefore.status,
      isLoadingMore: feedBBefore.isLoadingMore,
      error: feedBBefore.error,
    },
  );

  loadMoreGate.resolve({ items: rowsA.slice(0, 15), totalCount: rowsA.length });
  await Promise.all([first, second]);
  assert.equal(workspaceFeed(store, "/tmp/a").isLoadingMore, false);
  assert.equal(workspaceFeedIds(store, "/tmp/a").length, 15);
  store.stop();
});

test("workspace refresh targets invalidate removed requests and force a follow-up refresh", async () => {
  const fake = createFakeBackend();
  const first = deferred();
  const restored = deferred();
  let workspaceReads = 0;
  fake.state.listImpl = (_page, _pageSize, scope) => {
    if (scope.cwd !== "/tmp/a") return { items: [], totalCount: 0 };
    workspaceReads += 1;
    if (workspaceReads === 1) return first.promise;
    if (workspaceReads === 2) return restored.promise;
    return {
      items: [conversation("fresh", { cwd: "/tmp/a", updatedAt: 30 })],
      totalCount: 1,
    };
  };
  const store = createSidebarStore(fake.backend);
  const targetA = workspaceTarget("/tmp/a");
  store.setScope({ kind: "none" });
  store.start();
  await tick();
  store.setWorkspaceFeedRefreshTargets([targetA]);

  const initial = store.ensureWorkspaceFeeds([targetA]);
  await tick();
  store.setWorkspaceFeedRefreshTargets([]);
  first.resolve({
    items: [conversation("archived-stale", { cwd: "/tmp/a", updatedAt: 10 })],
    totalCount: 1,
  });
  await initial;
  assert.deepEqual(workspaceFeedIds(store, "/tmp/a"), []);

  store.setWorkspaceFeedRefreshTargets([targetA]);
  await tick();
  const forced = store.ensureWorkspaceFeeds([targetA], { force: true });
  restored.resolve({
    items: [conversation("restore-stale", { cwd: "/tmp/a", updatedAt: 20 })],
    totalCount: 1,
  });
  await forced;
  assert.equal(workspaceReads, 3);
  assert.deepEqual(workspaceFeedIds(store, "/tmp/a"), ["fresh"]);
  store.stop();
});

test("an active-scope refresh supersedes an older workspace feed response", async () => {
  const fake = createFakeBackend();
  const stale = deferred();
  const fresh = deferred();
  fake.state.listImpl = (_page, pageSize) => (pageSize === 5 ? stale.promise : fresh.promise);
  const store = createSidebarStore(fake.backend);
  store.setScope({ kind: "none" });
  store.start();
  await tick();

  const ensurePromise = store.ensureWorkspaceFeeds([workspaceTarget("/tmp/a")]);
  await tick();
  store.setScope(SCOPE_A);
  await tick();

  fresh.resolve({
    items: [conversation("fresh", { cwd: "/tmp/a", updatedAt: 20 })],
    totalCount: 1,
  });
  await tick();
  stale.resolve({
    items: [conversation("stale", { cwd: "/tmp/a", updatedAt: 10 })],
    totalCount: 1,
  });
  await ensurePromise;

  assert.deepEqual(store.getSnapshot().conversations.map((item) => item.id), ["fresh"]);
  assert.deepEqual(workspaceFeedIds(store, "/tmp/a"), ["fresh"]);
  store.stop();
});

test("workspace feed failures retain stale rows and retry clears list and load-more errors", async () => {
  const fake = createFakeBackend();
  const rows = conversationRange("a", "/tmp/a", 20);
  const rowsB = conversationRange("b", "/tmp/b", 2);
  let failure = null;
  fake.state.listImpl = (_page, pageSize, scope) => {
    if (scope.cwd === "/tmp/a" && failure) throw new Error(failure);
    const all = scope.cwd === "/tmp/a" ? rows : rowsB;
    return { items: all.slice(0, pageSize), totalCount: all.length };
  };
  const store = createSidebarStore(fake.backend);
  store.setScope({ kind: "none" });
  store.start();
  await tick();

  await store.ensureWorkspaceFeeds([workspaceTarget("/tmp/a"), workspaceTarget("/tmp/b")]);
  const feedBBefore = workspaceFeed(store, "/tmp/b");
  failure = "load more failed";
  await store.loadMoreWorkspaceFeed(workspaceTarget("/tmp/a"));
  assert.equal(workspaceFeed(store, "/tmp/a").visibleLimit, 15);
  assert.equal(workspaceFeed(store, "/tmp/a").error, "loadMoreFailed");
  assert.equal(workspaceFeed(store, "/tmp/a").totalCount, 20);
  assert.equal(workspaceFeedIds(store, "/tmp/a").length, 5);
  assert.deepEqual(workspaceFeed(store, "/tmp/b"), feedBBefore);

  failure = null;
  await store.retryWorkspaceFeed(workspaceTarget("/tmp/a"));
  assert.equal(workspaceFeed(store, "/tmp/a").error, null);
  assert.equal(workspaceFeedIds(store, "/tmp/a").length, 15);

  failure = "refresh failed";
  await store.ensureWorkspaceFeeds([workspaceTarget("/tmp/a")], { force: true });
  assert.equal(workspaceFeed(store, "/tmp/a").error, "listFailed");
  assert.equal(workspaceFeed(store, "/tmp/a").totalCount, 20);
  assert.equal(workspaceFeedIds(store, "/tmp/a").length, 15);
  assert.deepEqual(workspaceFeed(store, "/tmp/b"), feedBBefore);

  failure = null;
  await store.retryWorkspaceFeed(workspaceTarget("/tmp/a"));
  assert.equal(workspaceFeed(store, "/tmp/a").error, null);
  assert.equal(workspaceFeedIds(store, "/tmp/a").length, 15);
  store.stop();
});

test("active scope seeds its workspace feed and scope switches keep both feed caches coherent", async () => {
  const fake = createFakeBackend();
  const rowsA = conversationRange("a", "/tmp/a", 8);
  const rowsB = conversationRange("b", "/tmp/b", 4);
  fake.state.listImpl = (_page, pageSize, scope) => {
    const all = scope.cwd === "/tmp/a" ? rowsA : rowsB;
    return { items: all.slice(0, pageSize), totalCount: all.length };
  };
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();
  assert.equal(fake.state.calls.list.length, 1);

  await store.ensureWorkspaceFeeds([workspaceTarget("/tmp/a")]);
  assert.equal(fake.state.calls.list.length, 1);
  assert.equal(workspaceFeed(store, "/tmp/a").visibleLimit, 5);
  assert.deepEqual(workspaceFeedIds(store, "/tmp/a"), rowsA.map((item) => item.id));

  store.setScope(SCOPE_B);
  await tick();
  assert.equal(fake.state.calls.list.length, 2);
  await store.ensureWorkspaceFeeds([workspaceTarget("/tmp/b")]);
  assert.equal(fake.state.calls.list.length, 2);
  assert.deepEqual(store.getSnapshot().conversations.map((item) => item.id), rowsB.map((item) => item.id));
  assert.deepEqual(workspaceFeedIds(store, "/tmp/a"), rowsA.map((item) => item.id));
  assert.deepEqual(workspaceFeedIds(store, "/tmp/b"), rowsB.map((item) => item.id));
  store.stop();
});

test("events and mutations update only the owning workspace feed", async () => {
  const fake = createFakeBackend();
  const rowsA = conversationRange("a", "/tmp/a", 2);
  const rowsB = conversationRange("b", "/tmp/b", 2);
  fake.state.listImpl = (_page, pageSize, scope) => {
    const all = scope.cwd === "/tmp/a" ? rowsA : rowsB;
    return { items: all.slice(0, pageSize), totalCount: all.length };
  };
  fake.state.renameImpl = (id, title) =>
    conversation(id, { cwd: "/tmp/a", title, updatedAt: 100 });
  fake.state.pinImpl = (id, isPinned) =>
    conversation(id, { cwd: "/tmp/b", isPinned, pinnedAt: 200, updatedAt: 100 });
  const store = createSidebarStore(fake.backend, { workdirsDebounceMs: 1_000 });
  store.setScope({ kind: "none" });
  store.start();
  await tick();
  await store.ensureWorkspaceFeeds([workspaceTarget("/tmp/a"), workspaceTarget("/tmp/b")]);

  fake.emit({
    kind: "upsert",
    conversationId: "a3",
    conversation: conversation("a3", { cwd: "/tmp/a", updatedAt: 50 }),
  });
  fake.emit({ kind: "delete", conversationId: "b1" });
  await store.rename("a1", "renamed");
  await store.setPinned("b2", true);

  assert.deepEqual(workspaceFeedIds(store, "/tmp/a"), ["a3", "a1", "a2"]);
  assert.deepEqual(workspaceFeedIds(store, "/tmp/b"), ["b2"]);
  assert.equal(store.peek("a1").title, "renamed");
  assert.equal(store.peek("b2").isPinned, true);

  const beforeRunningA = [...workspaceFeedIds(store, "/tmp/a")];
  const beforeRunningB = [...workspaceFeedIds(store, "/tmp/b")];
  store.applyRunningPatch({ conversationId: "a1", running: true, workdir: "/tmp/a", updatedAt: 300 });
  assert.equal(store.getSnapshot().runningConversationIds.has("a1"), true);
  assert.equal(store.getSnapshot().runningWorkdirPathKeys.has("/tmp/a"), true);
  assert.equal(store.getSnapshot().runningWorkdirPathKeys.has("/tmp/b"), false);
  assert.deepEqual(workspaceFeedIds(store, "/tmp/a"), beforeRunningA);
  assert.deepEqual(workspaceFeedIds(store, "/tmp/b"), beforeRunningB);
  store.applyRunningPatch({ conversationId: "a1", running: false, updatedAt: 301 });
  assert.equal(store.getSnapshot().runningConversationIds.has("a1"), false);
  store.stop();
});

test("reconnect refreshes active and cached workspace feeds while retaining failed stale rows", async () => {
  const fake = createFakeBackend();
  let phase = "initial";
  fake.state.listImpl = (_page, pageSize, scope) => {
    if (phase === "reconnect" && scope.cwd === "/tmp/b") {
      throw new Error("workspace b unavailable");
    }
    const all =
      phase === "initial"
        ? [conversation(`old-${scope.cwd.endsWith("a") ? "a" : "b"}`, { cwd: scope.cwd })]
        : [conversation("new-a", { cwd: "/tmp/a", updatedAt: 50 })];
    return { items: all.slice(0, pageSize), totalCount: all.length };
  };
  const store = createSidebarStore(fake.backend);
  store.setScope(SCOPE_A);
  store.start();
  await tick();
  store.setWorkspaceFeedRefreshTargets([workspaceTarget("/tmp/a"), workspaceTarget("/tmp/b")]);
  await store.ensureWorkspaceFeeds([workspaceTarget("/tmp/a"), workspaceTarget("/tmp/b")]);
  assert.deepEqual(workspaceFeedIds(store, "/tmp/b"), ["old-b"]);

  phase = "reconnect";
  fake.setConnected(false);
  fake.setConnected(true);
  await waitFor(
    () =>
      store.getSnapshot().conversations[0]?.id === "new-a" &&
      workspaceFeed(store, "/tmp/b")?.error === "listFailed",
  );

  assert.deepEqual(store.getSnapshot().conversations.map((item) => item.id), ["new-a"]);
  assert.deepEqual(workspaceFeedIds(store, "/tmp/a"), ["new-a"]);
  assert.deepEqual(workspaceFeedIds(store, "/tmp/b"), ["old-b"]);
  assert.equal(workspaceFeed(store, "/tmp/b").error, "listFailed");
  store.stop();
});

test("archived workspace feeds skip reconnect reads and refresh after restore", async () => {
  const fake = createFakeBackend();
  let phase = "initial";
  fake.state.listImpl = (_page, pageSize, scope) => {
    const suffix = scope.cwd?.endsWith("b") ? "b" : "a";
    const item = conversation(`${phase === "initial" ? "old" : "new"}-${suffix}`, {
      cwd: scope.cwd,
      updatedAt: phase === "initial" ? 10 : 20,
    });
    return { items: [item].slice(0, pageSize), totalCount: 1 };
  };
  const store = createSidebarStore(fake.backend);
  const targetA = workspaceTarget("/tmp/a");
  const targetB = workspaceTarget("/tmp/b");
  store.setScope(SCOPE_A);
  store.start();
  await tick();
  store.setWorkspaceFeedRefreshTargets([targetA, targetB]);
  await store.ensureWorkspaceFeeds([targetA, targetB]);
  assert.deepEqual(workspaceFeedIds(store, "/tmp/b"), ["old-b"]);

  store.setWorkspaceFeedRefreshTargets([targetA]);
  const workspaceBReadsBeforeReconnect = fake.state.calls.list.filter(
    (call) => call.scope.cwd === "/tmp/b",
  ).length;
  phase = "restored";
  fake.setConnected(false);
  fake.setConnected(true);
  await waitFor(() => store.getSnapshot().conversations[0]?.id === "new-a");
  assert.equal(
    fake.state.calls.list.filter((call) => call.scope.cwd === "/tmp/b").length,
    workspaceBReadsBeforeReconnect,
  );
  assert.deepEqual(workspaceFeedIds(store, "/tmp/b"), ["old-b"]);

  store.setWorkspaceFeedRefreshTargets([targetA, targetB]);
  await waitFor(() => workspaceFeedIds(store, "/tmp/b")[0] === "new-b");
  assert.equal(
    fake.state.calls.list.filter((call) => call.scope.cwd === "/tmp/b").length,
    workspaceBReadsBeforeReconnect + 1,
  );
  store.stop();
});


test("unseen run results deduplicate, aggregate by severity, clear on new runs, and reset on deletion", () => {
  let clock = 100;
  const fake = createFakeBackend();
  const store = createSidebarStore(fake.backend, { now: () => clock });
  store.start();
  store.upsertLocal(conversation("success", { cwd: "/tmp/project" }));
  store.upsertLocal(conversation("cancelled", { cwd: "/tmp/project" }));
  store.upsertLocal(conversation("failure", { cwd: "/tmp/project" }));

  store.markRunResult({ conversationId: "success", outcome: "success", runId: "run-1" });
  store.markRunResult({ conversationId: "success", outcome: "failure", runId: "run-1" });
  assert.equal(store.getSnapshot().unseenRunResults.get("success")?.outcome, "success");

  clock += 1;
  store.markRunResult({
    conversationId: "cancelled",
    outcome: "cancelled",
    runId: "run-2",
  });
  clock += 1;
  store.markRunResult({ conversationId: "failure", outcome: "failure", runId: "run-3" });
  assert.equal(store.getSnapshot().unseenWorkdirOutcomes.get("/tmp/project"), "failure");

  store.applyRunningPatch({
    conversationId: "failure",
    running: true,
    workdir: "/tmp/project",
    updatedAt: 200,
  });
  assert.equal(store.getSnapshot().unseenRunResults.has("failure"), false);
  store.markRunResult({
    conversationId: "failure",
    outcome: "failure",
    runId: "old-run",
    updatedAt: 199,
  });
  assert.equal(store.getSnapshot().unseenRunResults.has("failure"), false);

  store.upsertLocal(conversation("revived", { cwd: "/tmp/project" }));
  store.markRunResult({
    conversationId: "revived",
    outcome: "failure",
    runId: "run-revived",
    updatedAt: 210,
  });
  store.applyRunningPatch({
    conversationId: "revived",
    running: true,
    runId: "run-revived",
    workdir: "/tmp/project",
    updatedAt: 211,
  });
  assert.equal(store.getSnapshot().unseenRunResults.has("revived"), false);
  store.applyRunningPatch({ conversationId: "revived", running: false, updatedAt: 212 });
  store.markRunResult({
    conversationId: "revived",
    outcome: "success",
    runId: "run-revived",
    updatedAt: 213,
  });
  assert.equal(store.getSnapshot().unseenRunResults.get("revived")?.outcome, "success");
  store.markRunResult({
    conversationId: "revived",
    outcome: "failure",
    runId: "run-revived",
    updatedAt: 214,
  });
  assert.equal(
    store.getSnapshot().unseenRunResults.get("revived")?.outcome,
    "success",
    "the genuine terminal is recorded once after resurrection",
  );

  store.markRunResult({
    conversationId: "success",
    outcome: "success",
    runId: "seen-run",
    seen: true,
    updatedAt: 300,
  });
  assert.equal(store.getSnapshot().unseenRunResults.has("success"), false);

  store.markRunResult({
    conversationId: "success",
    outcome: "failure",
    runId: "seen-failure-run",
    seen: true,
    updatedAt: 350,
  });
  assert.equal(store.getSnapshot().unseenRunResults.get("success")?.outcome, "failure");

  fake.emit({ kind: "delete", conversationId: "success" });
  store.upsertLocal(conversation("success", { cwd: "/tmp/project" }));
  store.markRunResult({
    conversationId: "success",
    outcome: "success",
    runId: "run-1",
    updatedAt: 400,
  });
  assert.equal(store.getSnapshot().unseenRunResults.get("success")?.runId, "run-1");
  store.stop();
});
