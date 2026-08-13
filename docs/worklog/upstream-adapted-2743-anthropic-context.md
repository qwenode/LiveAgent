# Upstream 2743f3d0 Anthropic context-policy adaptation

Date: 2026-08-13
Repository: `C:/data/www/LiveAgent`

## Adapted scope

Upstream `2743f3d0d96f2b020afae833efbb48891d4bed1b` extracts Anthropic context-window and long-context endpoint policy into the shared `agent-ui` layer so GUI and Gateway do not maintain drifting copies.

The local adaptation preserves the existing GUI runtime/request behavior and Gateway settings API. It ports only the pure policy layer and replaces the Gateway inline copy; no context-usage ring, manual-compaction hook, transcript layout, or shared assistant UI is transplanted.

## Files

- `crates/agent-ui/src/lib/models/anthropicContext.ts` — shared constants and pure helpers for endpoint classification, `[1m]` suffix handling, effective context windows, and known model limits.
- `crates/agent-gui/src/lib/providers/anthropicModels.ts` — re-exports shared policy while retaining GUI-only pi-ai model lookup and wire-model normalization.
- `crates/agent-gateway/web/src/lib/settings/index.ts` — uses shared policy for Anthropic defaults and stored-model normalization; non-Anthropic settings remain local.
- `crates/agent-gui/test/providers/anthropic-long-context.test.mjs` — verifies GUI re-exports match the shared implementation.
- `crates/agent-gateway/test/webui/anthropic-context.test.mjs` — verifies Gateway settings and relay/official endpoint semantics.

## Deferred 2743 areas

`ContextCheckpointCard`, `RetryDetailsBlock`, transient assistant/status abstractions, and broad transcript/settings UI changes remain deferred. Local GUI/Gateway layouts and compaction architecture differ materially from upstream; those changes require a separate compatibility design and must not be folded into this pure-policy adaptation.
