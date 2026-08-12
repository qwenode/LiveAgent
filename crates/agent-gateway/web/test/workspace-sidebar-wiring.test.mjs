import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (url) => readFileSync(url, "utf8").replaceAll("\r\n", "\n");
const sidebarSource = readSource(
  new URL("../../../agent-ui/src/components/chat/ChatHistorySidebar.tsx", import.meta.url),
);
const containerSource = readSource(
  new URL("../src/app/sidebar/GatewaySidebarContainer.tsx", import.meta.url),
);
const appSource = readSource(new URL("../src/app/GatewayApp.tsx", import.meta.url));
const i18nSource = readSource(new URL("../src/i18n/config.ts", import.meta.url));
const workspaceConversationTranslations = [
  ["chat.workspaceConversationsExpand", "展开工作空间对话", "Expand workspace conversations"],
  ["chat.workspaceConversationsCollapse", "收起工作空间对话", "Collapse workspace conversations"],
  ["chat.workspaceConversationsLoading", "正在读取工作空间对话…", "Loading workspace conversations…"],
  ["chat.workspaceConversationsEmpty", "此工作空间暂无对话", "No conversations in this workspace"],
  ["chat.workspaceConversationsRetry", "重试", "Retry"],
  ["chat.workspaceConversationsShowLatest", "收起到最近 5 条", "Show latest 5"],
  ["chat.workspaceConversationsLoadMore", "加载更多 10 条", "Load 10 more"],
];
const workspaceTaskTranslations = [
  ["chat.workspaceArchiveTasks", "归档任务", "Archive tasks"],
  ["chat.workspaceCleanupTasks", "清理任务", "Clean up tasks"],
];

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function assertInOrder(source, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.ok(next > cursor, `expected ${marker} after index ${cursor}`);
    cursor = next;
  }
}

test("web workspace conversation translations preserve required zh-CN and en-US copy", () => {
  const zhSource = between(i18nSource, '  "zh-CN": {', '\n  },\n\n  "en-US": {');
  const enStart = i18nSource.indexOf('  "en-US": {');
  assert.notEqual(enStart, -1, "missing en-US translation block");
  const enSource = i18nSource.slice(enStart);

  for (const [key, zh, en] of workspaceConversationTranslations) {
    assert.equal(zhSource.split(`"${key}": "${zh}"`).length - 1, 1);
    assert.equal(enSource.split(`"${key}": "${en}"`).length - 1, 1);
  }
});

test("web workspace feed loading excludes unavailable projects and is inert offline", () => {
  assert.match(containerSource, /!collapsedWorkspaceProjectPathKeys\.has\(target\.pathKey\)/);
  const refreshTargets = between(
    containerSource,
    "const workspaceFeedRefreshTargets",
    "  const expandedWorkspaceFeedTargets",
  );
  assert.match(
    refreshTargets,
    /!pathKey \|\|\s*!visibleWorkspaceProjectPathKeys\.has\(pathKey\) \|\|\s*props\.archivedProjectPathKeys\?\.has\(pathKey\) \|\|\s*props\.missingProjectPathKeys\.has\(pathKey\)/,
  );
  assert.match(sidebarSource, /onVisibleWorkspaceProjectsChange\?\.\(renderedProjects\)/);
  assert.match(
    containerSource,
    /onVisibleWorkspaceProjectsChange=\{handleVisibleWorkspaceProjectsChange\}/,
  );
  assert.match(containerSource, /store\.setWorkspaceFeedRefreshTargets/);
  assert.match(
    containerSource,
    /sectionsDisabled \|\|\s*!props\.showProjects \|\|\s*props\.projectsCollapsed/,
  );
  assert.match(containerSource, /store\.ensureWorkspaceFeeds\(expandedWorkspaceFeedTargets\)/);

  const guardedHandlers = [
    between(containerSource, "const handleCommitRename", "\n\n  const handleCancelRename"),
    between(containerSource, "const handleSetPinned", "\n\n  const handleDeleteConversation"),
    between(containerSource, "const handleDeleteConversation", "\n\n  const handleDeleteConversations"),
    between(containerSource, "const handleDeleteConversations", "\n\n  const handleLoadMore"),
    between(containerSource, "const handleLoadMore", "\n\n  // --- Authoritative-removal watcher"),
    between(containerSource, "const handleRetryWorkspaceFeed", "\n  const handleLoadMoreWorkspaceFeed"),
    between(containerSource, "const handleLoadMoreWorkspaceFeed", "\n  const handleCollapseWorkspaceFeed"),
    between(containerSource, "const handleCollapseWorkspaceFeed", "\n\n  return ("),
  ];
  for (const handler of guardedHandlers) {
    assert.match(handler, /if \(sectionsDisabled\)/);
  }
  assert.match(sidebarSource, /inert=\{sectionsDisabled\}/);
  assert.match(sidebarSource, /sectionsDisabled && "pointer-events-none select-none opacity-50"/);
  assert.match(containerSource, /const visibleWorkspaceFeeds = useMemo/);
  assert.match(containerSource, /isGatewayTransportErrorDetail\(feed\.errorDetail\)/);
  assert.match(containerSource, /workspaceFeeds=\{visibleWorkspaceFeeds\}/);
});

test("web workspace project names use ellipsis instead of a fade mask", () => {
  const projectRow = between(sidebarSource, "const ProjectRow =", "function HistoryListLoadingSkeleton");
  assert.doesNotMatch(projectRow, /sidebar-project-name-fade/);
  assert.match(projectRow, /min-w-0 flex-1 truncate/);
});

test("web workspace right-click menu exposes only archive and cleanup task actions", () => {
  const zhSource = between(i18nSource, '  "zh-CN": {', '\n  },\n\n  "en-US": {');
  const enSource = i18nSource.slice(i18nSource.indexOf('  "en-US": {'));
  for (const [key, zh, en] of workspaceTaskTranslations) {
    assert.equal(zhSource.split(`"${key}": "${zh}"`).length - 1, 1);
    assert.equal(enSource.split(`"${key}": "${en}"`).length - 1, 1);
  }
  const projectRow = between(sidebarSource, "const ProjectRow =", "function HistoryListLoadingSkeleton");
  assert.match(projectRow, /onContextMenu=\{handleProjectContextMenu\}/);
  const contextMenu = between(sidebarSource, "{projectTaskContextMenu &&", "{bulkDeleteDialog}");
  assert.equal((contextMenu.match(/role="menuitem"/g) ?? []).length, 2);
  assert.match(contextMenu, /chat\.workspaceArchiveTasks/);
  assert.match(contextMenu, /chat\.workspaceCleanupTasks/);
  assert.doesNotMatch(contextMenu, /workspaceRename|workspaceRemove|workspaceArchive"/);
  assert.match(containerSource, /onArchiveProjectTasks=\{props\.onArchiveProjectTasks\}/);
  assert.match(containerSource, /onCleanupProjectTasks=\{props\.onCleanupProjectTasks\}/);
  assert.match(appSource, /archiveHistoryByCwd\(project\.path\)/);
  assert.match(appSource, /cleanupHistoryByCwd\(project\.path\)/);
  assert.match(appSource, /onArchiveProjectTasks=\{handleArchiveProjectTasks\}/);
  assert.match(appSource, /onCleanupProjectTasks=\{handleCleanupProjectTasks\}/);
  assert.match(appSource, /\{ cwd: path, includeArchived: true \}/);
});

test("web Agent mode renders workspace feeds while non-Agent mode keeps the recent list", () => {
  assert.match(sidebarSource, /if \(!showProjects\) return items;/);
  assert.match(sidebarSource, /if \(projectsCollapsed\) return \[\];/);
  assert.match(sidebarSource, /workspaceFeeds\.get\(pathKey\)/);
  assert.match(sidebarSource, /renderedProjects\.map\(\(project, projectIndex\) =>/);
  assert.match(sidebarSource, /\{renderWorkspaceProject\(project\)\}/);
  assert.match(sidebarSource, /const historyVirtualizer = useVirtualizer\(/);
  assert.match(sidebarSource, /virtualHistoryRows\.map\(\(virtualRow\) =>/);
  assert.match(
    sidebarSource,
    /\{!showProjects \? \(\s*<div\s+ref=\{recentHeaderRef\}/,
  );
  assert.match(
    sidebarSource,
    /\{!showProjects \? \(\s*<div\s+aria-hidden=\{recentCollapsed\}/,
  );
  const autoPagingEffect = between(
    sidebarSource,
    "  useEffect(() => {\n    if (\n      sectionsDisabled",
    "  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run to (re)observe section refs",
  );
  assertInOrder(autoPagingEffect, [
    "lastVirtualHistoryIndex < items.length - HISTORY_LOAD_MORE_THRESHOLD",
    "return;",
    "handleLoadMore();",
  ]);
  assert.match(appSource, /showProjects=\{isAgentMode && status\?\.online === true\}/);
  assert.match(appSource, /collapsedWorkspaceProjectPaths=/);
  assert.match(appSource, /onWorkspaceProjectCollapsedChange=/);
});

test("web unseen completion lifecycle marks only live terminal events and clears viewed results", () => {
  assert.match(sidebarSource, /function unseenOutcomeDotClass/);
  assert.equal((sidebarSource.match(/h-2 w-2 shrink-0 rounded-full/g) ?? []).length, 2);
  assert.match(sidebarSource, /unseenOutcome === "failure"/);
  assert.match(appSource, /api\.subscribeChatActivity/);
  assert.match(appSource, /const activityAccepted = activityStore\.applyActivityEvent\(event\)/);
  assert.match(appSource, /if \(activityAccepted\) \{/);
  assert.match(appSource, /sidebarStore\.markRunResult\(\{/);
  assert.match(appSource, /seen: outcome === "failure" \? false : isConversationActivelyViewed/);
  assert.match(appSource, /if \(!isReplay\) \{\s*sidebarStore\.markRunResult/);
  assert.match(appSource, /sidebarStore\.clearRunResult\(targetConversationId\)/);
  assert.match(appSource, /document\.addEventListener\("visibilitychange"/);

  const zhSource = between(i18nSource, '  "zh-CN": {', '\n  },\n\n  "en-US": {');
  const enSource = i18nSource.slice(i18nSource.indexOf('  "en-US": {'));
  for (const [key, zh, en] of [
    ["chat.statusRunCompletedUnseen", "任务已完成，尚未查看", "Task completed, not yet viewed"],
    ["chat.statusRunFailedUnseen", "任务失败，尚未查看", "Task failed, not yet viewed"],
    ["chat.statusRunCancelledUnseen", "任务已取消，尚未查看", "Task cancelled, not yet viewed"],
  ]) {
    assert.equal(zhSource.split(`"${key}": "${zh}"`).length - 1, 1);
    assert.equal(enSource.split(`"${key}": "${en}"`).length - 1, 1);
  }
});

test("web cross-workspace conversation opening validates, activates, waits for scope, then opens", () => {
  const handler = between(
    appSource,
    "async function handleSidebarSelectWorkspaceConversation",
    "\n\n  useEffect(() => {",
  );
  assert.match(handler, /workspaceProjectPathKey\(activeWorkspaceProjectPath\) === targetPathKey/);
  assert.match(handler, /if \(!\(await checkWorkspaceProjectDirectory\(project\)\)\) return;/);
  assertInOrder(handler, [
    "handleSidebarSelectConversation(conversationId)",
    "return;",
    "checkWorkspaceProjectDirectory(project)",
    "if (workspaceConversationSelectionSeqRef.current !== selectionSeq) return;",
    "pendingWorkspaceConversationRef.current = {",
    "activateWorkspaceProject(project)",
  ]);

  const pendingEffect = between(
    appSource,
    "  useEffect(() => {\n    const pending = pendingWorkspaceConversationRef.current;",
    "\n\n  // Conversations that left",
  );
  assert.match(pendingEffect, /!targetProject/);
  assert.match(pendingEffect, /archivedWorkspaceProjectPathKeys\.has\(pending\.targetPathKey\)/);
  assert.match(pendingEffect, /!sidebarConversationsById\.has\(pending\.conversationId\)/);
  assertInOrder(pendingEffect, [
    "workspaceProjectPathKey(activeWorkspaceProjectPath) !== pending.targetPathKey",
    "historyScopeKey !== pending.targetScopeKey",
    "handleSidebarSelectConversationRef.current(pending.conversationId)",
  ]);
  assert.match(appSource, /onSelectProjectConversation=\{handleSidebarSelectWorkspaceConversation\}/);
});
