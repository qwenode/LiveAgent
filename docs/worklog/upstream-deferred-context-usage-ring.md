# Upstream context-usage ring / manual-compaction deferral

Date: 2026-08-12
Repository: `C:/data/www/LiveAgent`
Local baseline: `af57da1e`

## Scope

The upstream context-usage feature is a multi-commit runtime/UI migration. The local GUI already has a separate, working automatic-compaction architecture centered on `CompactionController` and `TokenLedger`; the Gateway WebUI has its own transcript store and status bridge. The upstream implementation introduces a live usage-ring UI, a manual-compaction action, shared checkpoint/status components, and cross-host transcript/runtime contracts. A wholesale port would create a second compaction state mechanism and overwrite the local dual-frontend layout.

## Reviewed commits

### `36be781f` — initial context-usage ring and manual compaction

- **Upstream files:** `crates/agent-ui/src/lib/chat/contextUsage.ts`, `crates/agent-ui/src/components/chat/ContextUsageRing.tsx`, `crates/agent-gui/src/pages/chat/runtime/useManualCompaction.ts`, `crates/agent-gui/src/lib/chat/compaction/controller.ts`, `tokenLedger.ts`, `ChatPage.tsx`, `ChatComposerBar.tsx`, GUI/Gateway i18n and tests.
- **Local reason for deferral:** the local controller already owns automatic pre-send, mid-stream, and post-tool compaction, but has no compatible manual trigger/action contract. The local composer does not expose upstream `contextUsage`/`onManualCompact` props, and the send/expand controls use a different layout. The upstream hook also depends on runtime preparation, Tauri invoke, Gateway bridge event mirroring, persistence, rollback, and queue coordination that do not map one-to-one to local APIs.
- **Follow-up:** define one controller-owned manual-compaction intent and one context-usage snapshot source before adding UI; then add a shared ring incrementally without duplicating token accounting.

### `18dabdac` — reliable context usage and manual compaction

- **Upstream files:** 52 files across `agent-ui`, GUI, Gateway WebUI, transcript stores, runtime snapshots, queue handling, assistant/status rendering, and tests.
- **Local reason for deferral:** this is a high-conflict architecture migration, not a portable component change. Missing local contracts include shared `contextUsage.ts`, `ContextUsageRing`, `useManualCompaction`, `contextUsageMetadata`, transient activity/state synchronization, shared checkpoint/retry/status components, and the upstream Gateway transcript/runtime event shapes. Local equivalents are split across `CompactionController`, `TokenLedger`, `liveTranscriptStore`, `useChatPageRuntimeStore`, `gatewayBridgeEvents`, and the existing `UsagePanel`.
- **Follow-up:** compare the final upstream event/state contracts against the local controller and bridge; port pure usage math first, then add a read-only ring, and only afterward add a controller-backed manual action with single-flight and rollback tests.
- **P0 adaptation landed:** the local branch keeps the existing `TokenLedger`/`CompactionController` as the sole source of truth and adds only a controller subscription, shared ratio/level helpers, focused tests, and a layout-preserving desktop read-only ring. Upstream transcript metadata fields are intentionally not retained until their local event and persistence propagation is complete.

### `2743f3d0` — shared context-usage reliability/refactor batch

- **Upstream files:** shared `ContextCheckpointCard`, `RetryDetailsBlock`, `AssistantStatus`/transient activity helpers, `anthropicContext`, GUI/Gateway assistant/transcript adapters, settings normalization, and boundary checks.
- **Local reason for deferral:** local assistant bubbles, transcript rows, provider settings, and workspace-resource UI have already diverged into a layout-preserving dual-host implementation. The upstream shared components have no direct local insertion points and would require broad UI rewrites.
- **Follow-up:** port only pure, independently testable utilities after the ring/manual-compaction contract is settled; keep local assistant/transcript layouts and adapters.

### `d1550008` / `972d7b6e` — mobile tooltip and ring animation polish

- **Upstream files:** `ContextUsageRing.tsx`, `label-tooltip.tsx`, `confirm-action-popover.tsx`, GUI/Gateway CSS.
- **Local reason for deferral:** these commits depend on the unported ring and tooltip interaction model. Applying them alone would add dead or incompatible styles/components.
- **Follow-up:** apply after a local ring exists, preserving host-specific CSS and reduced-motion conventions.

### `079672c5` — duplicate checkpoint prevention

- **Status:** **adapted** as local commit `1d637f7e`.
- **Files:** `crates/agent-gateway/web/src/lib/chat/transcript/rows.ts`, `crates/agent-gateway/web/test/transcript-rows.test.mjs`.
- **Portable change:** checkpoint row keys are content identities (`checkpoint-<summaryId>`); duplicate checkpoint rows are dropped instead of renamed, while other row collisions retain suffix behavior.
- **Validation:** `node --test test/transcript-rows.test.mjs test/transcript-store.test.mjs` passed with 85 tests.

## Prerequisites for future implementation

1. Keep `CompactionController`/`TokenLedger` as the sole compaction source of truth; do not introduce a parallel manual-compaction state store.
2. Add a controller-level manual intent/API that participates in the existing single-flight, status, checkpoint, persistence, and rollback paths.
3. Define the context-usage snapshot source and reconciliation rules for prepared context, observed provider usage, pending stream units, and post-checkpoint rebasing.
4. Add GUI composer props and ChatPage wiring without replacing the local control-rail/send layout.
5. Specify Gateway WebUI behavior explicitly (read-only ring versus manual action) and extend the existing transcript event/status contracts only where required.
6. Add pure utility, controller, GUI wiring, and Gateway transcript regression tests before enabling the ring or manual action by default.
