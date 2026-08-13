# Upstream `ae919b22` — managed-process / right-dock self-healing

**Upstream:** `ae919b22468a4a02cf679f23cce73e55e11de4a6` (`fix(ui): 右侧栏「后台任务」tab 跨端同步与状态镜像自愈`, August 13, 2026)

**Local status:** compatible reliability subset adapted manually; right-dock persistence/UI semantics intentionally deferred.

## Adapted

The local tree keeps the backend-authoritative managed-process mirror and its derived background-task tab. The following low-conflict reliability behavior is portable and is being added without changing the local layout:

- `crates/agent-gateway/web/src/lib/gatewaySocket.ts`
  - `processStateListeners` now keeps the gateway WebSocket alive in `shouldMaintainConnection()`.
  - Singleton replacement tracking now covers `resetGatewayWebSocketClient()` followed by a new client creation, allowing module-scoped stores to reattach after logout/login or token replacement.
- `crates/agent-ui/src/lib/managed-process/store.ts`
  - Adds `refreshManagedProcessState()` as an authoritative snapshot reconcile and failed-init retry path.
  - Reconciles on `document.visibilitychange` when the page becomes visible, without writing process state back from the UI.
- `crates/agent-ui/src/components/project-tools/BackgroundTasksPanel.tsx`
  - Reconciles once when the visible panel activates and periodically while visible (30 seconds), while preserving cached state during transport failure.
- `crates/agent-gateway/test/webui/gateway-socket-client.test.mjs`
  - Covers singleton `reset → create` replacement notification.

## Intentionally deferred

The upstream commit also persists a `RightDockProjectState.backgroundTasks` intent bucket and synchronizes open/dismissed IDs across clients. That conflicts with the local contract that background-task tab **existence is derived from live managed-process records** and that UI-derived visibility must not write back process state merely to establish the tab. The local ephemeral hide-only dismissal behavior is therefore retained; a future worktree/project-state baseline may revisit cross-client tab intent separately.

Upstream-only broad test additions (Go websocket broadcast/replay and dedicated managed-process/right-dock persistence suites) are not copied wholesale because the local test harness and right-dock state contract differ. The portable singleton regression is covered locally; backend snapshot and panel reconciliation remain covered by existing managed-process integration paths and targeted source/type checks.

## Validation

- `git diff --check`
- Targeted gateway socket and managed-process mirror tests: `node --test test/webui/gateway-socket-client.test.mjs test/webui/managed-process-store.test.mjs`
- GUI focused regression set (including right-dock normalization): passed.
- GUI TypeScript check: `./node_modules/.bin/tsc --noEmit --pretty false -p tsconfig.json`
- Gateway WebUI TypeScript check: `./node_modules/.bin/tsc --noEmit --pretty false -p tsconfig.json`
