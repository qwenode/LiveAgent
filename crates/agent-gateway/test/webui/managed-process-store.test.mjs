import assert from "node:assert/strict";
import test from "node:test";
import { createWebModuleLoader } from "../helpers/load-web-module.mjs";

function snapshot(revision, overrides = {}) {
  return {
    ready: true,
    agentOnline: true,
    revision,
    processes: [{ id: `p-${revision}`, running: true }],
    ...overrides,
  };
}

const listeners = new Set();
const backend = {
  failNextFetch: false,
  nextState: snapshot(1),
  async fetchState() {
    if (backend.failNextFetch) {
      backend.failNextFetch = false;
      throw new Error("fetch failed");
    }
    return backend.nextState;
  },
  async stop() {
    return null;
  },
  async clear() {
    return null;
  },
  async readLog() {
    return { content: "", logPath: "", truncated: false };
  },
  subscribe(onState) {
    listeners.add(onState);
    return () => listeners.delete(onState);
  },
  push(nextState) {
    for (const listener of listeners) listener(nextState);
  },
};

const loader = createWebModuleLoader({
  mocks: { "@liveagent/app/lib/managed-process/backend": { backend } },
});
const store = loader.loadModule("@liveagent/ui/lib/managed-process/store.ts");

test("managed-process store refresh retries init and accepts authoritative snapshots", async () => {
  backend.failNextFetch = true;
  await assert.rejects(store.ensureManagedProcessInit(), /fetch failed/);
  assert.equal(store.getManagedProcessState().ready, false);
  assert.equal(listeners.size, 0);

  backend.nextState = snapshot(5);
  await store.refreshManagedProcessState();
  assert.equal(store.getManagedProcessState().revision, 5);
  assert.equal(listeners.size, 1);

  backend.push(snapshot(6));
  assert.equal(store.getManagedProcessState().revision, 6);

  // A stale process list is rejected, but the transport's online bit remains
  // authoritative so the offline banner can still update.
  backend.push(snapshot(3, { agentOnline: false, processes: [] }));
  const stale = store.getManagedProcessState();
  assert.equal(stale.revision, 6);
  assert.equal(stale.processes.length, 1);
  assert.equal(stale.agentOnline, false);

  backend.push(snapshot(6, { agentOnline: true }));
  assert.equal(store.getManagedProcessState().agentOnline, true);

  backend.nextState = snapshot(9);
  await store.refreshManagedProcessState();
  assert.equal(store.getManagedProcessState().revision, 9);
});
