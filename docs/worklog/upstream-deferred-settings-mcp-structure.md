# Upstream Settings/MCP structural work deferred

Date: 2026-08-13

## Scope

This worklog records the upstream Settings/MCP deltas that were audited but intentionally not copied wholesale because the local `agent-ui` architecture and Hub layouts are different.

## Upstream commits

- `0a9d67fc` — Enhance Markdown styling and internationalization for Skills Hub.
- `f2bc55de` — Add MCP Hub navigation/import tests and shared Hub UI refactors.
- `20c4ae93` — Enhance MCP Hub components and tests.
- Related structural baseline: `4edaf62a` — standardize Skills/MCP Hub components.

## Safe portions already adapted

- `77e67f01` — MCP import search and no-match feedback in the existing `McpImportView`.
  - Added query filtering without changing the selection model.
  - Added dedicated `mcpHub.importSearchPlaceholder` / `mcpHub.importNoMatch` keys in both hosts.
  - Added a source-level regression test.
- `9330c964` — MCP documentation links use the platform `openUrl` shim while retaining the local card/layout structure.
  - Added a narrow source-level test and removed the browser-anchor path for the card docs action.
- `2e81d604` — Skills manual scan feedback in the existing monolithic `SkillsHubPage`.
  - Added announce-only scan result feedback, added/updated/removed counts, dismissible status/alert semantics, and dual-host translations.
  - Kept silent initialization and background refreshes silent.
  - Applied value-only copy improvements for installed Skill preview and bulk deselection labels.

## Deferred structural portions

### `0a9d67fc`

- **Deferred files/areas:** `DocumentMarkdown.tsx`, `.document-markdown` CSS, extracted Skills components, `CopyButton`/shared UI extraction, and the upstream Skills Hub layout rewrite.
- **Reason:** local `Markdown` and `SkillsHubPage.tsx` are shared/local implementations with existing styling and portal drawer behavior. Introducing the upstream component split would overwrite local layout and duplicate existing helpers.
- **Follow-up:** if long-form document typography becomes a product requirement, add a local shared markdown surface in a separate design task and verify both GUI and Gateway rendering before changing the Hub layout.

### `f2bc55de`

- **Deferred files/areas:** `tabs.tsx`, `McpRegistryToolbar`, `McpImportSourcePicker`, `McpServerCard`, shared fuzzy-search helpers/highlighting, and the upstream multi-file Skills/MCP navigation rewrite.
- **Reason:** local MCP navigation is already implemented in `McpHubPage.tsx` plus four existing modules, while Skills remains a deliberately monolithic page. The upstream tests assert files and props that do not exist locally; copying them would be a structural refactor rather than a compatible behavior port.
- **Follow-up:** establish a shared Hub component contract first, then port pure helpers only when both desktop and Gateway hosts can adopt the same API without replacing local layout.

### `20c4ae93`

- **Deferred files/areas:** upstream `McpServerCard`/`ResourceActivationSwitch` presentation, Store card-grid restyling, and the associated split-file test matrix.
- **Reason:** local installed MCP configuration uses `McpServersForm.tsx` and a different activation/policy model. The safe external-link behavior was adapted separately; the remaining card visual/API changes would conflict with local approval controls and spacing.
- **Follow-up:** revisit after a shared MCP resource-card contract exists; preserve local tool-policy and workspace-resource semantics.

### `4edaf62a` related baseline

The full Hub standardization/refactor remains deferred. No upstream Hub file was cherry-picked or merged. Only behavior that fit the existing local modules was hand-adapted.

## Validation

The safe ports were validated with the repository's existing conventions:

- MCP import/docs source tests: `node --test test/settings/mcp-import-search.test.mjs test/settings/mcp-docs-link.test.mjs`
- Skills scan/copy source tests: `node --test test/skills/skill-scan-feedback.test.mjs test/skills/skills-installed-preview-copy.test.mjs`
- GUI TypeScript: `./node_modules/.bin/tsc --noEmit --pretty false -p tsconfig.json`
- Formatting check: `git diff --check`

No raw upstream commit was merged or cherry-picked for this topic.
