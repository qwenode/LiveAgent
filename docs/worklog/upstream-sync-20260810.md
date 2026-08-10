# Upstream sync progress

- Branch: `sync/upstream-20260810`
- Plan: `1339-upstream-commit-cherry-pick`
- upstream remote: `https://github.com/Stack-Cairn/LiveAgent.git`
- upstream/main: `38f818753cbaf5403033276fbb9567f61d54d90e`
- merge-base: `f177f2858590ba998de17dd662aa1a9f8f6785ac`
- local main at branch create: `eb0f4717fde1a979a5c08e6a664b06cae60ea029`
- pending commit list: `docs/worklog/.upstream-pending-commits-1339.txt` (84 commits, chronological)
- Next index: 85
- Next SHA: `DONE`
- Policy: no automatic push / no PR / no merge into main
- Merge-commit policy: skip pure integration merges (`Merge origin/main into *`, `Merge remote-tracking branch *`, `Merge branch * into *` that only sync main); for `Merge pull request #N` use `-m 1` only if unique content not already applied, else skip as empty
- Conflict policy: analyze both-side diffs, present options, wait for user

## Applied

- `d2e1ba0e2a4401cd1dd4173c2a84e13c83e2c7ba` fix: keep sidebar visible with workspace editor
  - applied as `05096e1f`; clean auto-merge; layout-only `WorkspaceOverlayHost` move into main content; no functional overlap with local sidebar pagination/focus

- `1ac98a20ed5f1a3019b8b58b06c454d9aa707f2a` feat(skills): add reusable skill presets
  - applied as `94ee2a6f`; manual hybrid: keep local history window/transcript + chat_file_open; merge skillPresetId/skillsDisabled; proto history_skills=100 / history_skills_resp=100; regenerated pb

- `554db08a06a91fdd9914b51649ade943ca608a57` fix(webui): mirror automation skill fields
  - applied as `98db2c33`; clean pick; merge-commit=-m1?no; diff-check=0

- `a5bc702f0a0da2519da65e9aed4ab7131d46e44b` fix(skills): address preset review feedback
  - applied as `fa72d3ee`; clean pick; merge-commit=-m1?no; diff-check=0

- `85c6ecac01b0022a96adf00371ddad20e99895bc` refactor(skills): separate default and custom presets
  - applied as `23ae6e6d`; clean pick; parents=1; diff-check=0

- `099fe8b6576b694681ba0386f363215adcc2671a` refactor(skills): configure chat presets via slash command
  - applied as `13d4c817`; clean pick; parents=1; diff-check=0

- `b229271adcfe9d38c4d0b1aa01bed8a17454a07a` fix(聊天): 修复提问工具启动竞态
  - applied as `6ebecb74`; clean pick; parents=1; diff-check=0

- `5f4bfe1e23d8eeca9e67e3b29f1360f9be37b63b` style(聊天): 修正提问卡片格式
  - applied as `89b486ae`; clean pick; parents=1; diff-check=0

- `5a2c3b5c20ad2eff5034191b21dbdfb3599b28b0` test(skills): support readonly navigator globals
  - applied as `9b3c0af3`; modify/delete resolved by keeping restored test file with navigator defineProperty fix

- `3de56be2a05480580569cb7e0e91fe05e5a8c685` fix(聊天): 提问卡截止时间容忍远端时钟偏移
  - applied as `b3c6aa39`; clean pick; parents=1; diff-check=0

- `50fa57cfc0685af0b595198de3a920cbbd6d4028` chore(github): add issue/PR templates and PR governance workflow
  - applied as `eacb6020`; clean pick; parents=1; diff-check=0

- `a031706406dc189c69db1bf146a54c2cc04c1c59` fix(github): convert PR to draft via optional PAT and make governance report truthful
  - applied as `7c438fac`; clean pick; parents=1; diff-check=0

- `2163d11654d057e4ba76cd88a8fabf3bc759a7e0` chore(github): add stale workflow to close inactive issues and PRs
  - applied as `d0999f79`; clean pick; parents=1; diff-check=0

- `da6adf522734906b5de789c05d3a6a83e847e7f2` chore(github): push daily chart SVGs to chart-assets branch instead of main
  - applied as `fdba0088`; clean pick; parents=1; diff-check=0

- `254251ac068fc7f8176a3bff54b031911402370f` fix(github): call draft conversion with PAT via direct fetch, octokit overrides auth header
  - applied as `1a08a53e`; clean pick; parents=1; diff-check=0

- `0f95b836c3ea928365185835154981a9c2be9a82` feat: remove built-in CLI identity user-agent
  - applied as `1fb30aa8`; clean pick; parents=1; diff-check=0

- `5a560fc9e1e3ed070040655f0bf66c56fcf3baaa` fix(deepseek): map max thinking level to max instead of high
  - applied as `8a09d451`; clean pick; parents=1; diff-check=0

- `39fa0bd6ff66adcb7ee05fe541eeb726f1f9bbfc` test(deepseek): add regression for reasoning=max -> reasoning_effort=max
  - applied as `8ea13bba`; clean pick; parents=1; diff-check=0

- `870fc67b1b46811aa54a0a9c847a6c27a217722b` ci: apply frontend formatting fixes
  - applied as `af8df938`; clean pick; parents=1; diff-check=0

- `96558114065df8c809eeb1616f3779c80da48e3b` fix(composer): cover text leak below input card with background
  - applied as `deb2b9f2`; clean pick; parents=1; diff-check=0

- `a145a6e36a523223bb8a63d7a276d64302ebae79` Update API relay service information in README
  - applied as `e86d0c8d`; clean pick; parents=1; diff-check=0

- `4a96669a7b3fec00395532f591b2fae9fbc21ef4` fix(providers): respect requestFormat for DeepSeek models
  - applied as `b9e59653`; auto-resolved single modify/delete by keeping file

- `41946bdc1feff20d1500efb67eb79e3a8e51c9c3` feat(skills): support AGENTS global skills import
  - applied as `b5a18784`; clean pick; parents=1; diff-check=0

- `dc40553c1d612729067ccbaf597c3b0e4cad7a7a` docs: correct LLM tech-stack deps in README
  - applied as `28abecfc`; clean pick; parents=1; diff-check=0

- `c86f410610bd7054d303028b910db73696d54b57` test(providers): remove stale DeepSeek request-format tests
  - applied as `e83f70e0`; auto-resolved single modify/delete by keeping file

- `dd5eb56bac0a8e9d81bebe0f17ded120ce4544f4` fix(chat): preserve pasted user message newlines
  - applied as `a2a9a65e`; auto-resolved single modify/delete by keeping file

- `f5d7b9a5c56efd3f98947a96777830cad2b9e1db` docs(chat): record paste newline handoff
  - applied as `5fa6b554`; clean pick; parents=1; diff-check=0

- `8d74b7c779f85f6dabe546f7eb5f2da52b104178` style(chat): satisfy frontend format checks
  - applied as `b7451aca`; clean pick; parents=1; diff-check=0

- `889ba72444d1def6b2d324bccaeaae99a5207d7e` fix(gateway): recover compacted chat ingress gaps
  - applied as `f7106934`; clean pick; parents=1; diff-check=0

- `c63a2c22e7215650925156ace8f795b2634d6406` feat(chat): 添加当前会话任务进度指示器
  - applied as `27c9a57b`; auto-resolved single modify/delete by keeping file

- `e2b90aab387884969202c27bd57605f4c4aa1db1` fix(chat): prevent task progress and queue overlap
  - applied as `9eea16a6`; clean pick; parents=1; diff-check=0

- `fc60ad7794be17a5215e3f4c738dcd530f58d98b` Merge pull request #350 from AlphaCatMeow/codex/fix-live-transcript-jitter
  - applied as `658ecf97`; clean pick; parents=1; diff-check=0

- `df998bbd59a5b5fff5544f4091fa4dfa818f5410` fix: reduce IME composition end Enter tail window from 80ms to 20ms (#387)
  - applied as `53e85fb1`; clean pick; parents=1; diff-check=0

- `14e83701c799b562c8f800a7b170029b2c789735` feat(sidebar): distinct styling for pinned workspaces and conversations
  - applied as `55d73c98`; hybrid: keep local visible-workspace effect + renderWorkspaceProject; add pin divider via firstUnpinnedProjectIndex

- `8f24e73c296d58a64e48bd1984f262ffef3a09ad` feat(providers): cc-switch 式供应商自动故障转移（同厂商同模型） (#385)
  - applied as `70809a6d`; clean pick; parents=1; diff-check=0

- `97c6a4c9ac3a90803a682bf035c732f8253d490b` feat(mcp-hub): MCP 配置增加描述与文档链接附加信息 (#378)
  - applied as `b622b950`; clean pick; parents=1; diff-check=0

- `de67b729b83d63730749c411d16f9857de6715a7` fix(composer): preserve structured tags across copy/cut/paste (#398)
  - applied as `aae0289f`; clean pick; parents=1; diff-check=0

- `ddf12d202995235ba680ceb9e26d6be2617493cc` fix(mcp-hub): address metadata review feedback
  - applied as `e7993183`; clean pick; parents=1; diff-check=0

- `b00f8357831943533fb5c7488a8773050ed41b65` refactor(ui): 统一 GUI 与 WebUI 共享界面 (#399)
  - applied as `6744824c`; hybrid: agent-ui shared package; keep local workspace feed sidebar in agent-ui ChatHistorySidebar; containers import @liveagent/ui

- `5089772c78b48d5d079c34fac73bdfb2caaeff73` fix(i18n): 补齐共享界面翻译键
  - applied as `2e048ad4`; clean pick; parents=1; diff-check=0

- `95a243d401588d6539bb33e80137369448718f1f` docs(i18n): 添加 Skills Hub 修复预览
  - applied as `570e296f`; clean pick; parents=1; diff-check=0

- `cc514b72016269cfeb51c50ba59ac588ba2d5032` fix(chat): restore transcript scrolling and thinking collapse
  - applied as `a87d521e`; clean pick; parents=1; diff-check=0

- `1006152b012aa503cf9a5d14904076164b09a102` fix(workspace): 支持打开 skills 目录下的 skill:// 文件
  - applied as `f192fb81`; clean pick; parents=1; diff-check=0

- `a86749352ba43904b45edd65119f6dc150a6bd24` feat(settings): 优化系统设置界面并引入共享 Switch 组件 (#394)
  - applied as `e78cc8dd`; clean pick; parents=1; diff-check=0

- `f373aa8a017444559f6b28e892096e71d5ecb3fa` ci(models): 改为定时刷新模型目录 (#411)
  - applied as `d60a29b0`; clean pick; parents=1; diff-check=0

- `c59b9ca40494b08c8b33aa78fdbff487eea35763` fix(webui): 修复桌面设置同步页 Logo 显示
  - applied as `f569096f`; clean pick; parents=1; diff-check=0

- `ecfb038aaac7a0e4f5e8fcba8216952814d266bd` fix(test): align save_system_persists_project_setting_rows with workspace resource settings (#414)
  - applied as `f81623a6`; clean pick; parents=1; diff-check=0

- `c1bfe47c6998b9eab7b824dda51a87b3fc149852` feat(chat): move conversations to another workspace (single & batch) (#356)
  - applied as `edac0e0f`; auto-resolved conflicts preferring upstream feature side post agent-ui

- `2883e09af2dbb4040cea00c3854f327a4c2f7cba` feat(agent): make task lists durable across compaction
  - applied as `8318cafa`; auto-resolved conflicts preferring upstream feature side post agent-ui

- `d09fed795a496e3ef2a716c80a89b482f065a15b` chore(models): refresh model catalog (#417)
  - applied as `fdd2a79d`; clean pick; parents=1; diff-check=0

- `e93ab1c5baf600c68bde77846e453efc8d2abed6` refactor(ui): share task progress across GUI and WebUI
  - applied as `ed96953f`; clean pick; parents=1; diff-check=0

## Skipped

- `65be156a4971db05b132f873ae0c5f6470b55fe3` Merge origin/main into feat/skill-presets — skipped (integration merge; no unique feature content under first-parent pick policy)

- `21ea9295eed4ff54957fe921db49e82aee2bd59a` Merge origin/main into feat/skill-presets — integration merge skipped

- `2fea3b0fbee26da66ef829e144bae992b44f631e` Merge remote-tracking branch 'origin/main' into feat/skill-presets — integration merge skipped

- `82b366f2baa313d20901f2b3eb7e272b7f184def` Merge pull request #327 from AlphaCatMeow/codex/fix-ask-user-question-race — empty/already applied

- `88e7c5daf31d249453c3a39dd0e50c35219b223f` Merge remote-tracking branch 'upstream/main' into chore/github-governance-upstream — integration merge skipped

- `c321e1b4ffe633587317a22340c509dd54e4f38b` Merge remote-tracking branch 'origin/main' into feat/skill-presets — integration merge skipped

- `a32199b3c42a50bbd274b422633315fd977eeba4` Merge remote-tracking branch 'origin/main' into feat/skill-presets — integration merge skipped

- `849daf269762846557cc8243c5fe6e7fb155ed72` Merge pull request #340 from yyg-max/chore/github-governance-stale — empty/already applied

- `7de95a20bf93cfe026a57f6367c453e74a50acef` Merge pull request #347 from yyg-max/main — empty/already applied

- `2c007744251ae4c6e207258d6de0bc32463eb6c9` Merge branch 'Stack-Cairn:main' into chore/chart-assets-branch — integration merge skipped

- `5c7ee615db0a972f63d286afcb04e5601addf2f9` Merge pull request #341 from yyg-max/chore/chart-assets-branch — empty/already applied

- `97c22b205eca2e540ac3cb128ebf2bcde20de3a1` Merge pull request #368 from FlowerRealm/patch-1 — empty/already applied

- `b051e96828373f4d6a111cfd619b29bf629539ee` chore: verify PR CI trigger — empty/already applied

- `99d7a92e177faf23b628f009a3bd0ade6916571f` Merge pull request #363 from FlowerRealm/realm/fix-composer-text-leak — empty/already applied

- `66c26bc59d3875172b9bb71d6d0571e0173e581b` Merge pull request #351 from FlowerRealm/realm/remove-builtin-user-agent — empty/already applied

- `dcc97adb69de00c028ac62dad073f23f9c0f9268` Merge pull request #373 from FlowerRealm/worktree-fix+readme-fake-sdk-deps — empty/already applied

- `5e22b73f959a4a729355f1c3f72fde9074388b7e` Merge pull request #312 from Mieluoxxx/fix/304-editor-sidebar-overlay — empty/already applied

- `38150e51547c3a3694d377a4d1b589a15dd032b6` Merge pull request #372 from ISO-N/feat/skills-hub-agents-import — empty/already applied

- `4ed3ea1c244aaf74123e9c18f708e70695e63f3a` Merge pull request #370 from ISO-N/fix/deepseek-responses-request-format — PR merge skipped after conflict (feature commits already linearized)

- `de40155723a0419b5df88cde13db3563d98b685a` Merge remote-tracking branch 'origin/main' into fix/deepseek-max-reasoning-effort — integration merge skipped

- `00a2c6fc43754f40022b0703459824559bee73ea` Merge pull request #360 from xiaYuTian11/fix/deepseek-max-reasoning-effort — PR merge skipped after conflict (feature commits already linearized)

- `fb7ec206279bcc7c278830d03cb923e4bb8b66d1` Merge pull request #353 from AlphaCatMeow/codex/fix-paste-newline-serialization — PR merge skipped after conflict (feature commits already linearized)

- `27a2d928e426788fc5aaf8b21e3bff9dc9dcea75` Merge pull request #345 from AlphaCatMeow/codex/feat-task-progress-indicator-stacked — PR merge skipped after conflict (feature commits already linearized)

- `ef25c9d85b2edf43de4455925f64680ac530d08e` Merge pull request #395 from Stack-Cairn/feat/sidebar-pinned-styling — PR merge skipped after conflict (feature commits already linearized)

- `809bbf27c5b9b7a865ee4e242fbb33c7195c07c6` Merge pull request #400 from Stack-Cairn/feat/mcp-additional-info — empty/already applied

- `6ed79340996e7b61c085f8452e6d62dd9f820411` feat(workspace): configure Skills and MCP per workspace — mega-merge (2 parents, 236-file first-parent delta) skipped to avoid replaying already-linearized history; workspace-resources feature may need targeted re-apply later

- `12e28f80dff9c01a97d5358510653b3c3cfa7513` Merge remote-tracking branch 'origin/main' into feat/skill-presets — integration merge skipped

- `a2f3525af916f30f54d235f49ad6cef2e8c9f01a` Merge pull request #401 from Stack-Cairn/fix/shared-i18n-parity — empty/already applied

- `c3434f94e9a503b3620c5a6bf00cae3345b0fa2d` Merge pull request #406 from Stack-Cairn/fix/chat-transcript-scroll-thinking-collapse — empty/already applied

- `158e3fac5e1faacfffeec6c8ea0866db373b8b97` Merge pull request #407 from Stack-Cairn/fix/skill-path-file-card-open — empty/already applied

- `a2ee9f99eeb42051a3021156271a5ba0e0570000` Merge pull request #317 from NotToday1024/feat/skill-presets — PR merge skipped after conflict

- `d5a27420633390aa53b72c0fade011f69ad8be4b` Merge pull request #412 from Stack-Cairn/fix/webui-settings-sync-logo — empty/already applied

- `38f818753cbaf5403033276fbb9567f61d54d90e` Merge pull request #416 from Stack-Cairn/refactor/stable-task-list — empty/already applied

## Resolutions


- `1ac98a20`: user authorized auto hybrid for new features; keep local history paths; reassign history_skills proto fields to 100

## Validation

- 2026-08-10 post-loop audit (branch `sync/upstream-20260810`, HEAD after cleanup commits):
  - Pending list indexes 1–84 processed; Next index=85 / DONE.
  - Local commits on top of base `eb0f4717`: 52 feature picks + sync fixups (`e8bb840c`, `30a8ab28`, dead-import fix).
  - Sidebar hybrid wiring verified: `ChatHistorySidebar` still has `workspaceFeeds` / `onVisibleWorkspaceProjectsChange` / `firstUnpinned*`; both GUI and WebUI containers pass them.
  - `request-options.test.mjs`: leftover `=======`/`>>>>>>>` markers removed; DeepSeek `reasoning=max -> reasoning_effort=max` regression restored to match upstream tip.
  - **Missing feature:** `6ed79340` *feat(workspace): configure Skills and MCP per workspace* was skipped. Upstream tip still has the feature; HEAD does not:
    - missing UI: `crates/agent-ui/src/components/chat/WorkspaceResourceSettingsDrawer.tsx`, `.../resources/ResourceActivationSwitch.tsx`, docs images, `workspace-resource-settings.test.mjs`
    - missing data path: `workspaceResourceSettings` types/normalize/resolve/update helpers in `agent-gui` + `agent-gateway` `lib/settings/index.ts`, sync merge in `agent-ui/src/lib/settings/sync.ts`, Rust `SYSTEM_WORKSPACE_RESOURCE_SETTINGS_KEY` + normalize in `system.rs`/`mod.rs`
    - missing call sites: `ChatPage` / `GatewayApp` drawer wiring, skills/MCP resolve-per-workdir, SkillsHub/McpServers reference cleanup, workspace removal reset
  - Interim build fix: removed orphaned `WorkspaceResourceSettingsDrawer` import from `GatewayApp.tsx` (no usage without the feature).
  - Full `pnpm`/typecheck/test matrix not run in this audit step.

## Open decisions for user

1. **Targeted re-apply of workspace Skills+MCP** (~20 core paths vs replaying 236-file mega-merge)? Recommended: port from upstream tip `38f81875` file-by-file onto current agent-ui layout.
2. Run full validation (workspace install, UI boundary script, GUI provider tests, typecheck) after decision (1).

## Targeted re-apply (2026-08-10)

- Ported `feat(workspace): configure Skills and MCP per workspace` from upstream tip `38f81875` without replaying mega-merge `6ed79340`.
- **Default semantics preserved:** `resolveWorkspaceResources` uses mode `inherit` when unset → global Skills Hub selection / skill presets (GUI send path) and full MCP hub list; only explicit `custom` / `off` override per workspace.
- Layers: settings types+APIs (gui/gateway), Rust system key normalize/save, agent-ui sync CRDT merge, drawer+switch UI, sidebar menu entry, ChatPage/GatewayApp drawer wiring, send/cron filter, deletion cleanup, tests + docs images.
- Validation: `workspace-resource-settings.test.mjs` 4/4 pass; normalization workspace-resource cases 6/6 pass.

## Post-port validation + gap fixes (2026-08-10 cont.)

### Gaps found and fixed

1. **Cron Skills preset UI dropped during #399** — shared `CronTaskModal` no longer accepted `skillPresets` / rendered the selector, while `CronSection` still passed the prop and automation types + runner still used `skillPresetId` / `skillsDisabled`. Restored modal prop, state, save payload, and selector UI (names via `skillPresets.find` + `resolveSkillPreset`).
2. **Cron runner MCP filter** — named `workspaceResources` once (upstream-style) and assert `resolveWorkspaceResources` + `filterMcpSettingsForWorkspace` in automation tests.
3. **Workspace resource i18n** — ported missing `chat.workspaceResourcesTitle` / mode / hint / search / selected keys (zh+en) into both GUI and WebUI host configs; full drawer copy now present.
4. **Stale #399 test paths** — `workspace-sidebar-wiring` reads shared `agent-ui` sidebar; conversation-select assertions match simplified `onSelectConversation` path; skills-preset-navigation rewritten for shared SkillsHub (no presets tab) while still locking send/cron inherit preset behavior.
5. **provider-usage preset byte-sync** — Windows `core.autocrlf` made Rust file CRLF on disk so `includes(r#"…"#)` failed; normalize `\r\n`→`\n` in the test before compare. Pre-existing platform flake, not content drift.

### Validation results

- `node scripts/check-ui-boundaries.mjs` — **passed**
- `node --test test/settings/*.test.mjs` — **232/232 pass**
- Combined settings + i18n + workspace-sidebar-wiring + skills-preset-navigation — **246/246 pass**
- `pnpm --filter liveagent test:frontend` — **1519 pass / 11 fail** (remaining failures look pre-existing / env / #399 path drift outside this port):
  - `edit-resend-atomic` (replaceIndex assert)
  - `mention-composer-selection` / `mention-refetch` (function extract markers / shared composer moves)
  - `new-conversation-focus` (focusComposerAfterConversationChange markers)
  - `skill-preset-manager-interaction` (missing `happy-dom` package in this env)
  - (sidebar wiring / shared-translations / skills-preset-navigation fixed above)

### Residual risks / not done

- Full typecheck / WebUI test matrix not run.
- Remaining frontend fails above not proven caused by workspace-resources port; leave for follow-up unless they block merge.
- Local customizations still present: sidebar `workspaceFeeds` / visible-project pagination / pin divider hybrid; skill-presets hybrid on inherit send/cron.
- No push / no PR / no merge to main (policy unchanged).

## Frontend green fix (2026-08-10 cont. 2)

- Restored `focusComposerAfterConversationChange` + action ref wiring on `ChatPage` (dropped after #399); also wire `cancelPendingWorkspaceConversationActionRef` into workspace projects/removal.
- CRLF-normalize source reads in edit-resend / mention / focus tests (Windows autocrlf).
- Replaced obsolete `SkillPresetManager` interaction suite (component removed) with a presence guard.
- Validation: `pnpm --filter liveagent test:frontend` **1538/1538 pass**; settings/i18n/skills/sidebar combined still green.

## Post-#399 wiring closeout (2026-08-10 cont. 3)

Closed remaining post-`#399` / workspace Skills-MCP port gaps that left Gateway/Chat sidebar conversation selection incomplete.

### Fixes

1. **GatewayApp cross-workspace conversation open** — restored historical pending-seq pipeline:
   - `pendingWorkspaceConversationRef` + `workspaceConversationSelectionSeqRef`
   - `handleSidebarSelectWorkspaceConversation` (same path → select; else validate dir → pending → `activateWorkspaceProject`)
   - effect waits for `activeWorkspaceProjectPath` + `historyScopeKey` + conversation in `sidebarConversationsById`, then opens via `handleSidebarSelectConversationRef`
2. **GatewayApp `historyScopeKey`** — derived with `sidebarScopeKey` from agent/workdir/none/unscoped (same shape as `setScope`).
3. **GatewayApp collapse wiring** — re-added `handleSidebarWorkspaceProjectCollapsedChange` and passed `collapsedWorkspaceProjectPaths` / `onWorkspaceProjectCollapsedChange` into `GatewaySidebarContainer` (required props after local workspace-feed customs).
4. **GatewayApp focus** — `focusComposerAfterConversationChange` (double rAF, skip mobile) on activate/new conversation paths (from prior segment; kept).
5. **adapters `history.skills`** — socket adapter case for skill-preset history RPC parity.
6. **ChatPage** — destructure `checkWorkspaceProjectDirectory`; `handleSelectProjectConversation` validates dir → activate → select; wire `onSelectProjectConversation`.
7. **Web tests** — CRLF normalize; shared `agent-ui` sidebar path; `showProjects` assert keeps **local** online guard (`isAgentMode && status?.online === true`); cross-workspace pending markers match ref-based open.

### Validation

- `crates/agent-gateway/web`: `new-conversation-focus` + `workspace-sidebar-wiring` — **9/9 pass**
- `crates/agent-gui`: `workspace-sidebar-wiring` + `new-conversation-focus` — **10/10 pass**
- `crates/agent-gui`: `test/settings/*.test.mjs` — **232/232 pass** (includes automation-prompt-runner + provider-usage + workspace-resource)

### Local customs preserved

- Web `showProjects={isAgentMode && status?.online === true}` (not bare `isAgentMode`)
- Sidebar workspace feeds / visible-project pagination / collapse-by-path
- Workspace resources default **inherit** (global skills presets + global MCP until custom/off)
- Skill-presets hybrid on send/cron inherit path

### Residual

- Full gateway/web typecheck matrix not re-run this segment
- `request-options` reasoning_effort case-count audit still open from earlier notes
- No push / no PR / no merge to main

