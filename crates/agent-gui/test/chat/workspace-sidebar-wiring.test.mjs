import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (url) => readFileSync(url, "utf8").replaceAll("\r\n", "\n");
const sidebarSource = readSource(
  new URL("../../src/components/chat/ChatHistorySidebar.tsx", import.meta.url),
);
const containerSource = readSource(
  new URL("../../src/pages/chat/sidebar/ChatSidebarContainer.tsx", import.meta.url),
);
const chatPageSource = readSource(new URL("../../src/pages/ChatPage.tsx", import.meta.url));
const workspaceSource = readSource(
  new URL("../../src/pages/chat/workspace/useWorkspaceProjects.ts", import.meta.url),
);
const workspaceRemovalSource = readSource(
  new URL("../../src/pages/chat/workspace/useWorkspaceProjectRemoval.tsx", import.meta.url),
);
const i18nSource = readSource(new URL("../../src/i18n/config.ts", import.meta.url));
const workspaceConversationTranslations = [
  ["chat.workspaceConversationsExpand", "展开工作空间对话", "Expand workspace conversations"],
  ["chat.workspaceConversationsCollapse", "收起工作空间对话", "Collapse workspace conversations"],
  ["chat.workspaceConversationsLoading", "正在读取工作空间对话…", "Loading workspace conversations…"],
  ["chat.workspaceConversationsEmpty", "此工作空间暂无对话", "No conversations in this workspace"],
  ["chat.workspaceConversationsRetry", "重试", "Retry"],
  ["chat.workspaceConversationsShowLatest", "收起到最近 5 条", "Show latest 5"],
  ["chat.workspaceConversationsLoadMore", "加载更多 10 条", "Load 10 more"],
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

test("desktop workspace conversation translations preserve required zh-CN and en-US copy", () => {
  const zhSource = between(i18nSource, '  "zh-CN": {', '\n  },\n\n  "en-US": {');
  const enStart = i18nSource.indexOf('  "en-US": {');
  assert.notEqual(enStart, -1, "missing en-US translation block");
  const enSource = i18nSource.slice(enStart);

  for (const [key, zh, en] of workspaceConversationTranslations) {
    assert.equal(zhSource.split(`"${key}": "${zh}"`).length - 1, 1);
    assert.equal(enSource.split(`"${key}": "${en}"`).length - 1, 1);
  }
});

test("desktop workspace feed loading excludes hidden projects and preserves non-Agent history", () => {
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
    /if \(\s*!props\.showProjects \|\|\s*props\.projectsCollapsed \|\|\s*expandedWorkspaceFeedTargets\.length === 0\s*\)/,
  );
  assert.match(containerSource, /store\.ensureWorkspaceFeeds\(expandedWorkspaceFeedTargets\)/);

  assert.match(sidebarSource, /if \(!showProjects\) return items;/);
  assert.match(sidebarSource, /if \(projectsCollapsed\) return \[\];/);
  assert.match(sidebarSource, /workspaceFeeds\.get\(pathKey\)/);
  assert.match(sidebarSource, /renderedProjects\.map\(renderWorkspaceProject\)/);
  assert.match(sidebarSource, /const historyVirtualizer = useVirtualizer\(/);
  assert.match(sidebarSource, /virtualHistoryRows\.map\(\(virtualRow\) =>/);
  assert.match(
    sidebarSource,
    /\{!showProjects \? \(\s*<div\s+aria-hidden=\{recentCollapsed\}/,
  );
  const autoPagingEffect = between(
    sidebarSource,
    "  useEffect(() => {\n    if (\n      !hasMore",
    "  useEffect(() => {\n    if (!pendingProjectRemoveId)",
  );
  assertInOrder(autoPagingEffect, [
    "lastVirtualHistoryIndex < items.length - HISTORY_LOAD_MORE_THRESHOLD",
    "return;",
    "onLoadMore();",
  ]);
});

test("desktop workspace project names use ellipsis instead of a fade mask", () => {
  const projectRow = between(sidebarSource, "const ProjectRow =", "function HistoryListLoadingSkeleton");
  assert.doesNotMatch(projectRow, /sidebar-project-name-fade/);
  assert.match(projectRow, /min-w-0 flex-1 truncate/);
});

test("desktop workspace conversation opening waits for directory, project, and scope readiness", () => {
  const projectSelectionHandler = between(
    workspaceSource,
    "const handleSelectWorkspaceProject",
    "  const handleNewConversationForProject",
  );
  assertInOrder(projectSelectionHandler, [
    "cancelPendingWorkspaceConversationActionRef.current()",
    "checkWorkspaceProjectDirectory(project)",
    "activateWorkspaceProject(project)",
  ]);
  for (const [startMarker, endMarker] of [
    ["const handleRemoveWorkspaceProject", "  const handleArchiveWorkspaceProject"],
    ["const handleArchiveWorkspaceProject", "  const handleUnarchiveWorkspaceProject"],
  ]) {
    const destructiveHandler = between(workspaceRemovalSource, startMarker, endMarker);
    assert.match(destructiveHandler, /cancelPendingWorkspaceConversationActionRef\.current\(\)/);
  }
  assert.match(chatPageSource, /cancelPendingWorkspaceConversationActionRef,/);

  const handler = between(
    chatPageSource,
    "const handleSelectWorkspaceConversation",
    "  useEffect(() => {",
  );
  assert.match(handler, /workspaceProjectPathKey\(activeWorkspaceProjectPath\) === targetPathKey/);
  assert.match(handler, /if \(!\(await checkWorkspaceProjectDirectory\(project\)\)\) return;/);
  assertInOrder(handler, [
    "handleSelectConversation(conversationId)",
    "return;",
    "checkWorkspaceProjectDirectory(project)",
    "if (workspaceConversationSelectionSeqRef.current !== selectionSeq) return;",
    "pendingWorkspaceConversationRef.current = {",
    "activateWorkspaceProject(project)",
  ]);

  const pendingEffect = between(
    chatPageSource,
    "  useEffect(() => {\n    const pending = pendingWorkspaceConversationRef.current;",
    "  const sidebarRunningConversationIds",
  );
  assert.match(pendingEffect, /!targetProject/);
  assert.match(pendingEffect, /archivedWorkspaceProjectPathKeys\.has\(pending\.targetPathKey\)/);
  assert.match(pendingEffect, /!sidebarStore\.peek\(pending\.conversationId\)/);
  assertInOrder(pendingEffect, [
    "workspaceProjectPathKey(activeWorkspaceProjectPath) !== pending.targetPathKey",
    "historyScopeKey !== pending.targetScopeKey",
    "handleSelectConversation(pending.conversationId)",
  ]);
});

test("desktop workspace collapse intent is persisted by normalized project path", () => {
  const callback = between(
    workspaceSource,
    "const handleSidebarWorkspaceProjectCollapsedChange",
    "\n\n  return {",
  );
  assert.match(callback, /workspaceProjectPathKey\(project\.path\)/);
  assert.match(callback, /collapsedWorkspaceProjectPaths/);
  assert.match(callback, /updateCustomSettings/);
});
