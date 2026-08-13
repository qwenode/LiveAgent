# Upstream coverage matrix — final audit through `ae919b22`

**Audit date:** August 13, 2026  
**Local main:** `25da5475` (`feat(chat): close runtime snapshot metadata round-trip`)
**Recorded upstream tip:** `ae919b22468a4a02cf679f23cce73e55e11de4a6`  
**Requested feda target:** `feda12e5766f230d9cb424bbc2e10b3edc524f3c`

## Final post-`4ab0a3d27` matrix

| Upstream | Theme | Local status | Evidence / compatibility decision |
|---|---|---|---|
| `5567eb62` | shared frontend extraction (#443) | **DEFER** (structural) | Local shared `agent-ui` baseline already exists through the earlier local equivalent `4b188383`; the remaining upstream host rewires, drawer-presence hook, transcript/status extraction, and Hub/file layout changes are high-conflict. See context/MCP/worktree deferral logs. |
| `feda12e5` | WebUI SFTP dual-pane bottom scrollbar | **ADAPTED** | Local `8d5b9829` preserves the shared SFTP layout and adds the WebUI scrollbar/CSS regression coverage. |
| `59689298` | Base UI worktree/path-picker dialog stacking | **SKIP / equivalent local baseline** | The worktree/group product baseline is intentionally absent, while the local dialog implementation remains the pre-existing local modal architecture. The upstream change is coupled to the deferred worktree chain and would replace local modal/layout behavior; no safe standalone product behavior is required. |
| `614d6462` | generated model catalog refresh | **ADAPTED** | Local `50fc3a27`; `MODEL_CATALOG_SNAPSHOT_DATE` is `2026-08-13`. The local patch has the same stable patch-id as upstream (`d062089883812b240bca57acf4560836bdd5139d`). |
| `ae919b22` | managed-process/right-dock sync and mirror self-healing | **PARTIALLY ADAPTED / UI persistence deferred** | Local `39479100` ports connection retention, singleton reset→create replacement notification, authoritative refresh, visibility reconciliation, visible-panel 30s reconcile, tests, and worklog. Upstream `RightDockProjectState.backgroundTasks` persistence is intentionally not ported because local tab existence remains derived from live backend records and UI must not write process state merely to establish a tab. |

## Earlier focus commits confirmed

- `1ea494aab`: **equivalent already present**, not a missing product delta. Local `SettingsShell` has customizable navigation search and no-results handling; local shared `Switch` is in `agent-ui` and is used by system settings. This was inherited through the local settings/UI baseline and is recorded here so it is not silently omitted.
- `226ca87c`: **equivalent already present**, not a missing product delta. Local `pages/settings/shared.tsx` provides `SettingsGroup`, `SettingsRow`, and `SettingsChoiceRow`, consumed by system settings surfaces.
- `2743f3d0`: Anthropic context policy adapted as `0311c5e6`; remaining broad shared-display extraction is deferred in `upstream-adapted-2743-anthropic-context.md` and the context-usage worklog.
- Worktree/project-group series `57fcd1ee..62cfc2f2` and prerequisite `b9b9406ee`: **deferred as a feature chain**; no orphan contract-only port.

## Integrity and validation

- No cherry-pick state or unmerged paths at final review.
- Independent local commits were appended; upstream commits were not cherry-picked or merged into `main`.
- Focused GUI regressions passed, including compaction, context ring, manual-compaction wiring, MCP, skills scan, and right-dock model tests.
- Gateway WebUI targeted socket + managed-process tests passed (`40/40`).
- GUI TypeScript check passed.
- Gateway WebUI TypeScript check passed.
- `git diff --check` passed.

## Chat context/runtime closure (2026-08-13)

- Context metadata production, bridge propagation, Gateway reducer/history/rows consumption, context-ring derivation, and GUI runtime snapshot live/final/recovery round-trips are **ADAPTED** in the current working tree. `runtime_state` remains transport-only and is restored into activity state before row construction; checkpoint rows retain `contextUsageTokens` and take precedence for the Gateway ring after compaction.
- Gateway `chat.compact` is **ADAPTED** through Web → Go → Rust inbox → GUI controller-backed compaction, with busy rejection, no user-message seed, cancellation, terminal mirror ordering, and focused tests.
- `2743f3d0` broad shared transcript-body extraction remains **DEFERRED / equivalent local coverage**: `AssistantStatus` is already shared; retry/checkpoint bodies are host-local because GUI virtualization/layout and Gateway full-round rendering differ. Do not wholesale-port `TranscriptList.tsx` or `GatewayTranscript.tsx`.

## Remaining non-blocking follow-up

If the deferred worktree/project-group baseline is intentionally introduced later, revisit `59689298` and the upstream persisted background-task intent model together with that baseline. Do not independently port the structural `5567eb62` host rewires or `useDrawerPresence` solely to claim symbol coverage; preserve local layout and adapter boundaries.
