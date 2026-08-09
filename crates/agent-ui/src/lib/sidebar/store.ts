// The sidebar state store: one external store per app instance holding the
// workspace/conversation sidebar domain — conversation list, workdir
// summaries, running set, and per-row mutations. Consumed from React through
// useSidebarSelector so a store commit re-renders selector subscribers only,
// never the page-level components. Shared between agent-gui and
// agent-gateway/web; everything platform-specific arrives via SidebarBackend.
//
// Consistency policy (stale-while-revalidate):
// - a fetch failure never clears the visible list;
// - a scope switch first shows the cached slice of the new scope (syncing),
//   the skeleton appears only when nothing is cached (loading);
// - authoritative pages drop server-absent rows except pending drafts,
//   in-flight mutations, and adapter-protected ids — reconnects therefore
//   remove conversations deleted elsewhere instead of resurrecting them.

import { workspaceProjectPathKey } from "@liveagent/app/lib/settings";
import type { SidebarBackend } from "./backend";
import {
  applySidebarBackendEvent,
  mergeSidebarConversation,
  reconcileSidebarConversations,
  sortSidebarConversations,
} from "./reconcile";
import { conversationMatchesScope, filterConversationsForScope, sidebarScopeKey } from "./scope";
import type {
  SidebarBackendEvent,
  SidebarConversation,
  SidebarErrorCode,
  SidebarListStatus,
  SidebarMutationKind,
  SidebarRunningItem,
  SidebarScope,
  SidebarWorkdirSummary,
  SidebarWorkspaceFeed,
  SidebarWorkspaceFeedErrorCode,
  SidebarWorkspaceFeedTarget,
} from "./types";

const DEFAULT_PAGE_SIZE = 80;
const DEFAULT_RECONCILE_INTERVAL_MS = 60_000;
const DEFAULT_WORKDIRS_FALLBACK_MS = 300_000;
const DEFAULT_WORKDIRS_DEBOUNCE_MS = 2_000;
const DEFAULT_POSITION_LOCK_MS = 1_200;
const WORKSPACE_FEED_INITIAL_LIMIT = 5;
const WORKSPACE_FEED_LOAD_MORE_INCREMENT = 10;
const WORKSPACE_FEED_MAX_CONCURRENCY = 4;

export type SidebarSnapshot = {
  revision: number;
  scopeKey: string;
  conversations: readonly SidebarConversation[];
  byId: ReadonlyMap<string, SidebarConversation>;
  workspaceFeeds: ReadonlyMap<string, SidebarWorkspaceFeed>;
  totalCount: number;
  hasMore: boolean;
  listStatus: SidebarListStatus;
  isLoadingMore: boolean;
  listError: SidebarErrorCode | null;
  listErrorDetail: string | null;
  workdirs: readonly SidebarWorkdirSummary[];
  workdirActivity: ReadonlyMap<string, number>;
  runningConversationIds: ReadonlySet<string>;
  runningWorkdirPathKeys: ReadonlySet<string>;
  mutations: ReadonlyMap<string, SidebarMutationKind>;
  mutationErrors: ReadonlyMap<string, SidebarErrorCode>;
};

export type SidebarRefreshReason = "reconnect" | "interval" | "manual";
export type SidebarWorkdirsRefreshReason =
  | "initial"
  | "reconnect"
  | "delete"
  | "new-workdir"
  | "fallback";

export type SidebarStore = {
  getSnapshot(): SidebarSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  setScope(scope: SidebarScope): void;
  refresh(options?: { reason?: SidebarRefreshReason }): Promise<void>;
  loadMore(): Promise<void>;
  setWorkspaceFeedRefreshTargets(targets: readonly SidebarWorkspaceFeedTarget[]): void;
  ensureWorkspaceFeeds(
    targets: readonly SidebarWorkspaceFeedTarget[],
    options?: { force?: boolean },
  ): Promise<void>;
  retryWorkspaceFeed(target: SidebarWorkspaceFeedTarget): Promise<void>;
  loadMoreWorkspaceFeed(target: SidebarWorkspaceFeedTarget): Promise<void>;
  collapseWorkspaceFeed(pathKey: string): void;
  refreshWorkdirs(reason: SidebarWorkdirsRefreshReason): Promise<void>;
  rename(id: string, title: string): Promise<boolean>;
  setPinned(id: string, isPinned: boolean): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  clearMutationError(id: string): void;
  upsertLocal(conversation: SidebarConversation): void;
  removeLocal(conversationId: string): void;
  applyRunningPatch(patch: {
    conversationId: string;
    running: boolean;
    workdir?: string | null;
    updatedAt?: number;
  }): void;
  hydrateRunning(items: readonly SidebarRunningItem[]): void;
  peek(conversationId: string): SidebarConversation | undefined;
  peekConversations(): readonly SidebarConversation[];
};

export type SidebarStoreOptions = {
  now?: () => number;
  pageSize?: number;
  reconcileIntervalMs?: number;
  workdirsFallbackMs?: number;
  workdirsDebounceMs?: number;
  positionLockMs?: number;
};

function persistedCount(conversations: readonly SidebarConversation[]) {
  let count = 0;
  for (const item of conversations) {
    if (item.isPending !== true) count += 1;
  }
  return count;
}

type WorkspaceFeedRequest = {
  pathKey: string;
  cwd: string;
  target: number;
  kind: SidebarWorkspaceFeedErrorCode;
  generation: number;
  seq: number;
};

export function createSidebarStore(
  backend: SidebarBackend,
  options?: SidebarStoreOptions,
): SidebarStore {
  const now = options?.now ?? Date.now;
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const reconcileIntervalMs = options?.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
  const workdirsFallbackMs = options?.workdirsFallbackMs ?? DEFAULT_WORKDIRS_FALLBACK_MS;
  const workdirsDebounceMs = options?.workdirsDebounceMs ?? DEFAULT_WORKDIRS_DEBOUNCE_MS;
  const positionLockMs = options?.positionLockMs ?? DEFAULT_POSITION_LOCK_MS;

  let scope: SidebarScope = { kind: "none" };
  let byId = new Map<string, SidebarConversation>();
  let running = new Map<string, { workdir: string | null; updatedAt: number }>();
  const runningStatusUpdatedAt = new Map<string, number>();
  const positionLocks = new Map<string, number>();
  let snapshot: SidebarSnapshot = {
    revision: 0,
    scopeKey: sidebarScopeKey(scope),
    conversations: [],
    byId,
    workspaceFeeds: new Map(),
    totalCount: 0,
    hasMore: false,
    listStatus: "initial",
    isLoadingMore: false,
    listError: null,
    listErrorDetail: null,
    workdirs: [],
    workdirActivity: new Map(),
    runningConversationIds: new Set(),
    runningWorkdirPathKeys: new Set(),
    mutations: new Map(),
    mutationErrors: new Map(),
  };
  const listeners = new Set<() => void>();

  let startCount = 0;
  let requestSeq = 0;
  let workspaceFeedSeq = 0;
  // A first-page refresh supersedes every older pagination request for the
  // same scope. This is separate from requestSeq (scope/lifecycle invalidation):
  // reconnect refreshes do not change scope, but they must still prevent a
  // pre-disconnect loadMore failure from landing after the fresh page succeeds
  // and resurrecting a stale listError.
  let listGeneration = 0;
  let loadedPageCount = 0;
  let listRequestInFlight = false;
  let queuedListRequest: { authoritative: boolean } | null = null;
  let loadMoreRequestToken: symbol | null = null;
  let workspaceFeedQueue: WorkspaceFeedRequest[] = [];
  let activeWorkspaceFeedRequests = 0;
  const activeWorkspaceFeedPathKeys = new Set<string>();
  const workspaceFeedWaiters = new Map<string, Set<() => void>>();
  let workspaceFeedRefreshTargets = new Map<string, SidebarWorkspaceFeedTarget>();
  let workdirsInFlight = false;
  let workdirsQueued = false;
  let wasDisconnected = false;
  let unsubscribeEvents: (() => void) | null = null;
  let unsubscribeConnection: (() => void) | null = null;
  let reconcileTimer: ReturnType<typeof setInterval> | null = null;
  let workdirsFallbackTimer: ReturnType<typeof setInterval> | null = null;
  let workdirsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const commit = (patch: Partial<SidebarSnapshot>) => {
    snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
    for (const listener of listeners) {
      listener();
    }
  };

  const activePositionLockIds = () => {
    const nowMs = now();
    const ids: string[] = [];
    for (const [id, until] of positionLocks) {
      if (until > nowMs) {
        ids.push(id);
      } else {
        positionLocks.delete(id);
      }
    }
    return ids;
  };

  const retainedConversationIds = () => {
    const ids = new Set<string>(snapshot.mutations.keys());
    for (const id of backend.getProtectedConversationIds?.() ?? []) {
      const trimmed = id.trim();
      if (trimmed) ids.add(trimmed);
    }
    return ids;
  };

  const runningWorkdirPathKeysOf = (
    entries: ReadonlyMap<string, { workdir: string | null; updatedAt: number }>,
  ) => {
    const keys = new Set<string>();
    for (const entry of entries.values()) {
      const key = workspaceProjectPathKey(entry.workdir ?? "");
      if (key) keys.add(key);
    }
    return keys;
  };

  const bumpWorkdirActivity = (
    activity: ReadonlyMap<string, number>,
    workdir: string | null | undefined,
    updatedAt: number | undefined,
  ): ReadonlyMap<string, number> => {
    const key = workspaceProjectPathKey(workdir ?? "");
    const at = typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0;
    if (!key || at <= 0 || (activity.get(key) ?? 0) >= at) {
      return activity;
    }
    const next = new Map(activity);
    next.set(key, at);
    return next;
  };

  const normalizeWorkspaceFeedTarget = (
    target: SidebarWorkspaceFeedTarget,
  ): SidebarWorkspaceFeedTarget | null => {
    const cwd = target.cwd.trim();
    const pathKey = workspaceProjectPathKey(target.pathKey || cwd);
    const cwdPathKey = workspaceProjectPathKey(cwd);
    if (!cwd || !pathKey || pathKey !== cwdPathKey) {
      return null;
    }
    return { pathKey, cwd };
  };

  const createWorkspaceFeed = (target: SidebarWorkspaceFeedTarget): SidebarWorkspaceFeed => ({
    pathKey: target.pathKey,
    cwd: target.cwd,
    conversationIds: [],
    visibleLimit: WORKSPACE_FEED_INITIAL_LIMIT,
    totalCount: 0,
    status: "initial",
    isLoadingMore: false,
    error: null,
    errorDetail: null,
    requestGeneration: 0,
  });

  const workspaceFeedRows = (
    feed: SidebarWorkspaceFeed,
    index: ReadonlyMap<string, SidebarConversation> = byId,
  ) =>
    feed.conversationIds
      .map((id) => index.get(id))
      .filter((item): item is SidebarConversation => item !== undefined);

  const updateWorkspaceFeedsForConversation = (
    previous: SidebarConversation | undefined,
    next: SidebarConversation | undefined,
  ): ReadonlyMap<string, SidebarWorkspaceFeed> => {
    const conversationId = next?.id ?? previous?.id;
    if (!conversationId || snapshot.workspaceFeeds.size === 0) {
      return snapshot.workspaceFeeds;
    }
    const previousPathKey = workspaceProjectPathKey(previous?.cwd ?? "");
    const nextPathKey = workspaceProjectPathKey(next?.cwd ?? "");
    let workspaceFeeds: Map<string, SidebarWorkspaceFeed> | null = null;
    for (const [pathKey, feed] of snapshot.workspaceFeeds) {
      const wasListed = feed.conversationIds.includes(conversationId);
      if (!wasListed && previousPathKey !== pathKey && nextPathKey !== pathKey) {
        continue;
      }
      const previousCounted =
        (previousPathKey === pathKey && previous?.isPending !== true) ||
        (previous === undefined && wasListed);
      const nextCounted = nextPathKey === pathKey && next?.isPending !== true;
      const rest = workspaceFeedRows(feed).filter((item) => item.id !== conversationId);
      const rows = nextPathKey === pathKey && next ? sortSidebarConversations([next, ...rest]) : rest;
      const totalCount = Math.max(
        persistedCount(rows),
        feed.totalCount + Number(nextCounted) - Number(previousCounted),
      );
      workspaceFeeds ??= new Map(snapshot.workspaceFeeds);
      workspaceFeeds.set(pathKey, {
        ...feed,
        conversationIds: rows.map((item) => item.id),
        totalCount,
        status: feed.status === "initial" ? "ready" : feed.status,
        error: null,
        errorDetail: null,
      });
    }
    return workspaceFeeds ?? snapshot.workspaceFeeds;
  };

  const syncActiveWorkspaceFeed = (
    workspaceFeeds: ReadonlyMap<string, SidebarWorkspaceFeed>,
    state: {
      conversations: readonly SidebarConversation[];
      totalCount: number;
      listStatus: SidebarListStatus;
      isLoadingMore: boolean;
      listError: SidebarErrorCode | null;
      listErrorDetail: string | null;
    },
  ): ReadonlyMap<string, SidebarWorkspaceFeed> => {
    if (scope.kind !== "workdir") {
      return workspaceFeeds;
    }
    const pathKey = workspaceProjectPathKey(scope.cwd);
    const feed = workspaceFeeds.get(pathKey);
    if (!feed) {
      return workspaceFeeds;
    }
    const next = new Map(workspaceFeeds);
    next.set(pathKey, {
      ...feed,
      cwd: scope.cwd,
      conversationIds: state.conversations.map((item) => item.id),
      totalCount: state.totalCount,
      status: state.listStatus,
      isLoadingMore: state.isLoadingMore,
      error:
        state.listError === "listFailed" || state.listError === "loadMoreFailed"
          ? state.listError
          : null,
      errorDetail: state.listErrorDetail,
    });
    return next;
  };

  const commitScopedState = (patch: Partial<SidebarSnapshot>) => {
    const conversations = patch.conversations ?? snapshot.conversations;
    const totalCount = patch.totalCount ?? snapshot.totalCount;
    const listStatus = patch.listStatus ?? snapshot.listStatus;
    const isLoadingMore = patch.isLoadingMore ?? snapshot.isLoadingMore;
    const listError = patch.listError === undefined ? snapshot.listError : patch.listError;
    const listErrorDetail =
      patch.listErrorDetail === undefined ? snapshot.listErrorDetail : patch.listErrorDetail;
    const workspaceFeeds = syncActiveWorkspaceFeed(
      patch.workspaceFeeds ?? snapshot.workspaceFeeds,
      {
        conversations,
        totalCount,
        listStatus,
        isLoadingMore,
        listError,
        listErrorDetail,
      },
    );
    commit({ ...patch, workspaceFeeds });
  };

  const pruneOrphanedConversations = (
    candidateIds: Iterable<string>,
    workspaceFeeds: ReadonlyMap<string, SidebarWorkspaceFeed>,
    conversations: readonly SidebarConversation[] = snapshot.conversations,
  ) => {
    const retained = retainedConversationIds();
    const referenced = new Set(conversations.map((item) => item.id));
    for (const feed of workspaceFeeds.values()) {
      for (const id of feed.conversationIds) referenced.add(id);
    }
    let nextById: Map<string, SidebarConversation> | null = null;
    for (const id of candidateIds) {
      const item = byId.get(id);
      if (!item || item.isPending === true || retained.has(id) || referenced.has(id)) {
        continue;
      }
      nextById ??= new Map(byId);
      nextById.delete(id);
    }
    if (nextById) byId = nextById;
  };

  const hasQueuedWorkspaceFeedRequest = (pathKey: string) =>
    workspaceFeedQueue.some((request) => request.pathKey === pathKey);

  const settleWorkspaceFeedWaiters = (pathKey: string) => {
    if (activeWorkspaceFeedPathKeys.has(pathKey) || hasQueuedWorkspaceFeedRequest(pathKey)) {
      return;
    }
    const waiters = workspaceFeedWaiters.get(pathKey);
    workspaceFeedWaiters.delete(pathKey);
    for (const resolve of waiters ?? []) resolve();
  };

  const waitForWorkspaceFeedIdle = (pathKey: string) => {
    if (!activeWorkspaceFeedPathKeys.has(pathKey) && !hasQueuedWorkspaceFeedRequest(pathKey)) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const waiters = workspaceFeedWaiters.get(pathKey) ?? new Set();
      waiters.add(resolve);
      workspaceFeedWaiters.set(pathKey, waiters);
    });
  };

  const runWorkspaceFeedRequest = async (request: WorkspaceFeedRequest) => {
    try {
      const page = await backend.listConversations(1, request.target, {
        kind: "workdir",
        cwd: request.cwd,
      });
      const current = snapshot.workspaceFeeds.get(request.pathKey);
      if (
        request.seq !== workspaceFeedSeq ||
        startCount === 0 ||
        !current ||
        current.requestGeneration !== request.generation
      ) {
        return;
      }
      const authoritativeItems = page.items.filter(
        (item) => workspaceProjectPathKey(item.cwd ?? "") === request.pathKey,
      );
      const previousIds = current.conversationIds;
      const reconciled = reconcileSidebarConversations(
        workspaceFeedRows(current),
        authoritativeItems,
        {
          retainConversationIds: retainedConversationIds(),
          preserveUpdatedAtConversationIds: activePositionLockIds(),
          authoritativeComplete: page.items.length < request.target,
        },
      );
      byId = new Map(byId);
      for (const item of reconciled) byId.set(item.id, item);
      const workspaceFeeds = new Map(snapshot.workspaceFeeds);
      workspaceFeeds.set(request.pathKey, {
        ...current,
        cwd: request.cwd,
        conversationIds: reconciled.map((item) => item.id),
        totalCount: Math.max(0, page.totalCount),
        status: "ready",
        isLoadingMore: false,
        error: null,
        errorDetail: null,
      });
      const reconciledIds = new Set(reconciled.map((item) => item.id));
      pruneOrphanedConversations(
        previousIds.filter((id) => !reconciledIds.has(id)),
        workspaceFeeds,
      );
      commit({ workspaceFeeds, byId });
    } catch (error) {
      const current = snapshot.workspaceFeeds.get(request.pathKey);
      if (
        request.seq !== workspaceFeedSeq ||
        startCount === 0 ||
        !current ||
        current.requestGeneration !== request.generation
      ) {
        return;
      }
      const workspaceFeeds = new Map(snapshot.workspaceFeeds);
      workspaceFeeds.set(request.pathKey, {
        ...current,
        status: "ready",
        isLoadingMore: false,
        error: request.kind,
        errorDetail: error instanceof Error ? error.message : String(error),
      });
      commit({ workspaceFeeds });
    }
  };

  const drainWorkspaceFeedQueue = () => {
    while (
      startCount > 0 &&
      activeWorkspaceFeedRequests < WORKSPACE_FEED_MAX_CONCURRENCY &&
      workspaceFeedQueue.length > 0
    ) {
      const request = workspaceFeedQueue.shift()!;
      if (activeWorkspaceFeedPathKeys.has(request.pathKey)) {
        workspaceFeedQueue.push(request);
        if (workspaceFeedQueue.every((item) => activeWorkspaceFeedPathKeys.has(item.pathKey))) {
          break;
        }
        continue;
      }
      activeWorkspaceFeedRequests += 1;
      activeWorkspaceFeedPathKeys.add(request.pathKey);
      void runWorkspaceFeedRequest(request).finally(() => {
        activeWorkspaceFeedRequests -= 1;
        activeWorkspaceFeedPathKeys.delete(request.pathKey);
        settleWorkspaceFeedWaiters(request.pathKey);
        drainWorkspaceFeedQueue();
      });
    }
  };

  const enqueueWorkspaceFeedRequest = (
    target: SidebarWorkspaceFeedTarget,
    requestTarget: number,
    kind: SidebarWorkspaceFeedErrorCode,
  ) => {
    const current = snapshot.workspaceFeeds.get(target.pathKey) ?? createWorkspaceFeed(target);
    const generation = current.requestGeneration + 1;
    const workspaceFeeds = new Map(snapshot.workspaceFeeds);
    workspaceFeeds.set(target.pathKey, {
      ...current,
      cwd: target.cwd,
      status: current.conversationIds.length > 0 ? "syncing" : "loading",
      isLoadingMore: kind === "loadMoreFailed",
      error: null,
      errorDetail: null,
      requestGeneration: generation,
    });
    commit({ workspaceFeeds });
    const queuedIndex = workspaceFeedQueue.findIndex(
      (request) => request.pathKey === target.pathKey,
    );
    const request: WorkspaceFeedRequest = {
      pathKey: target.pathKey,
      cwd: target.cwd,
      target: requestTarget,
      kind,
      generation,
      seq: workspaceFeedSeq,
    };
    if (queuedIndex >= 0) {
      const queued = workspaceFeedQueue[queuedIndex]!;
      workspaceFeedQueue[queuedIndex] = {
        ...request,
        target: Math.max(queued.target, requestTarget),
        kind:
          queued.kind === "loadMoreFailed" || kind === "loadMoreFailed"
            ? "loadMoreFailed"
            : "listFailed",
      };
    } else {
      workspaceFeedQueue.push(request);
    }
    drainWorkspaceFeedQueue();
  };

  const ensureWorkspaceFeeds = async (
    targets: readonly SidebarWorkspaceFeedTarget[],
    ensureOptions?: { force?: boolean },
  ) => {
    const normalizedByPathKey = new Map<string, SidebarWorkspaceFeedTarget>();
    for (const target of targets) {
      const normalized = normalizeWorkspaceFeedTarget(target);
      if (normalized) normalizedByPathKey.set(normalized.pathKey, normalized);
    }
    const normalizedTargets = Array.from(normalizedByPathKey.values());
    if (normalizedTargets.length === 0) {
      return;
    }

    let workspaceFeeds: ReadonlyMap<string, SidebarWorkspaceFeed> = snapshot.workspaceFeeds;
    for (const target of normalizedTargets) {
      if (workspaceFeeds.has(target.pathKey)) continue;
      if (workspaceFeeds === snapshot.workspaceFeeds) {
        workspaceFeeds = new Map(workspaceFeeds);
      }
      (workspaceFeeds as Map<string, SidebarWorkspaceFeed>).set(
        target.pathKey,
        createWorkspaceFeed(target),
      );
    }
    workspaceFeeds = syncActiveWorkspaceFeed(workspaceFeeds, {
      conversations: snapshot.conversations,
      totalCount: snapshot.totalCount,
      listStatus: snapshot.listStatus,
      isLoadingMore: snapshot.isLoadingMore,
      listError: snapshot.listError,
      listErrorDetail: snapshot.listErrorDetail,
    });
    if (workspaceFeeds !== snapshot.workspaceFeeds) {
      commit({ workspaceFeeds });
    }

    let refreshActiveScope = false;
    for (const target of normalizedTargets) {
      const current = snapshot.workspaceFeeds.get(target.pathKey);
      if (!current || startCount === 0) continue;
      const isActiveScope =
        scope.kind === "workdir" && workspaceProjectPathKey(scope.cwd) === target.pathKey;
      if (isActiveScope) {
        refreshActiveScope ||= ensureOptions?.force === true;
        continue;
      }
      const hasPendingRequest =
        activeWorkspaceFeedPathKeys.has(target.pathKey) ||
        hasQueuedWorkspaceFeedRequest(target.pathKey);
      if (ensureOptions?.force === true) {
        enqueueWorkspaceFeedRequest(
          target,
          Math.max(WORKSPACE_FEED_INITIAL_LIMIT, current.visibleLimit),
          "listFailed",
        );
        continue;
      }
      if (hasPendingRequest) continue;
      if (current.status === "initial") {
        enqueueWorkspaceFeedRequest(
          target,
          Math.max(WORKSPACE_FEED_INITIAL_LIMIT, current.visibleLimit),
          "listFailed",
        );
      }
    }

    const waits = normalizedTargets.map((target) => waitForWorkspaceFeedIdle(target.pathKey));
    if (refreshActiveScope) {
      waits.push(fetchFirstPage(false));
    }
    await Promise.all(waits);
  };

  const setWorkspaceFeedRefreshTargets = (targets: readonly SidebarWorkspaceFeedTarget[]) => {
    const nextTargets = new Map<string, SidebarWorkspaceFeedTarget>();
    const restoredTargets: SidebarWorkspaceFeedTarget[] = [];
    for (const target of targets) {
      const normalized = normalizeWorkspaceFeedTarget(target);
      if (!normalized) continue;
      nextTargets.set(normalized.pathKey, normalized);
      if (
        !workspaceFeedRefreshTargets.has(normalized.pathKey) &&
        snapshot.workspaceFeeds.has(normalized.pathKey)
      ) {
        restoredTargets.push(normalized);
      }
    }

    const removedPathKeys = Array.from(workspaceFeedRefreshTargets.keys()).filter(
      (pathKey) => !nextTargets.has(pathKey),
    );
    workspaceFeedRefreshTargets = nextTargets;
    if (removedPathKeys.length > 0) {
      const removedPathKeySet = new Set(removedPathKeys);
      workspaceFeedQueue = workspaceFeedQueue.filter(
        (request) => !removedPathKeySet.has(request.pathKey),
      );
      let workspaceFeeds: Map<string, SidebarWorkspaceFeed> | null = null;
      for (const pathKey of removedPathKeys) {
        const current = snapshot.workspaceFeeds.get(pathKey);
        if (!current) continue;
        workspaceFeeds ??= new Map(snapshot.workspaceFeeds);
        workspaceFeeds.set(pathKey, {
          ...current,
          status: current.conversationIds.length > 0 ? "ready" : "initial",
          isLoadingMore: false,
          requestGeneration: current.requestGeneration + 1,
        });
      }
      if (workspaceFeeds) commit({ workspaceFeeds });
      for (const pathKey of removedPathKeys) settleWorkspaceFeedWaiters(pathKey);
    }
    if (restoredTargets.length > 0) {
      void ensureWorkspaceFeeds(restoredTargets, { force: true });
    }
  };

  const retryWorkspaceFeed = async (target: SidebarWorkspaceFeedTarget) => {
    const normalized = normalizeWorkspaceFeedTarget(target);
    if (!normalized || startCount === 0) return;
    const current = snapshot.workspaceFeeds.get(normalized.pathKey);
    if (!current) {
      await ensureWorkspaceFeeds([normalized]);
      return;
    }
    if (
      activeWorkspaceFeedPathKeys.has(normalized.pathKey) ||
      hasQueuedWorkspaceFeedRequest(normalized.pathKey)
    ) {
      await waitForWorkspaceFeedIdle(normalized.pathKey);
      return;
    }
    if (scope.kind === "workdir" && workspaceProjectPathKey(scope.cwd) === normalized.pathKey) {
      await fetchFirstPage(false);
      return;
    }
    enqueueWorkspaceFeedRequest(
      normalized,
      Math.max(WORKSPACE_FEED_INITIAL_LIMIT, current.visibleLimit),
      current.error ?? "listFailed",
    );
    await waitForWorkspaceFeedIdle(normalized.pathKey);
  };

  const loadMoreWorkspaceFeed = async (target: SidebarWorkspaceFeedTarget) => {
    const normalized = normalizeWorkspaceFeedTarget(target);
    if (!normalized || startCount === 0) return;
    if (!snapshot.workspaceFeeds.has(normalized.pathKey)) {
      await ensureWorkspaceFeeds([normalized]);
    }
    const current = snapshot.workspaceFeeds.get(normalized.pathKey);
    if (!current || current.isLoadingMore) return;
    if (
      activeWorkspaceFeedPathKeys.has(normalized.pathKey) ||
      hasQueuedWorkspaceFeedRequest(normalized.pathKey)
    ) {
      await waitForWorkspaceFeedIdle(normalized.pathKey);
      return;
    }

    const visibleLimit = current.visibleLimit + WORKSPACE_FEED_LOAD_MORE_INCREMENT;
    const workspaceFeeds = new Map(snapshot.workspaceFeeds);
    workspaceFeeds.set(normalized.pathKey, { ...current, visibleLimit });
    commit({ workspaceFeeds });
    const needsMoreRows =
      current.conversationIds.length < visibleLimit &&
      (current.totalCount === 0 || current.conversationIds.length < current.totalCount);
    if (!needsMoreRows) return;

    if (scope.kind === "workdir" && workspaceProjectPathKey(scope.cwd) === normalized.pathKey) {
      await loadMore();
      return;
    }
    enqueueWorkspaceFeedRequest(normalized, visibleLimit, "loadMoreFailed");
    await waitForWorkspaceFeedIdle(normalized.pathKey);
  };

  const collapseWorkspaceFeed = (pathKey: string) => {
    const normalizedPathKey = workspaceProjectPathKey(pathKey);
    const current = snapshot.workspaceFeeds.get(normalizedPathKey);
    if (!current || current.visibleLimit === WORKSPACE_FEED_INITIAL_LIMIT) return;
    const workspaceFeeds = new Map(snapshot.workspaceFeeds);
    workspaceFeeds.set(normalizedPathKey, {
      ...current,
      visibleLimit: WORKSPACE_FEED_INITIAL_LIMIT,
    });
    commit({ workspaceFeeds });
  };

  const knownWorkdirPathKeys = () => {
    const keys = new Set<string>();
    for (const workdir of snapshot.workdirs) {
      const key = workspaceProjectPathKey(workdir.path);
      if (key) keys.add(key);
    }
    return keys;
  };

  const scheduleWorkdirsDebounce = () => {
    if (workdirsDebounceTimer !== null || startCount === 0) {
      return;
    }
    workdirsDebounceTimer = setTimeout(() => {
      workdirsDebounceTimer = null;
      void refreshWorkdirs("new-workdir");
    }, workdirsDebounceMs);
  };

  const totalCountAfterListChange = (
    previous: readonly SidebarConversation[],
    next: readonly SidebarConversation[],
  ) => {
    const delta = persistedCount(next) - persistedCount(previous);
    return Math.max(persistedCount(next), snapshot.totalCount + delta);
  };

  const commitScopedList = (
    conversations: readonly SidebarConversation[],
    extra?: Partial<SidebarSnapshot>,
  ) => {
    const totalCount =
      extra?.totalCount ?? totalCountAfterListChange(snapshot.conversations, conversations);
    commitScopedState({
      ...extra,
      conversations,
      byId,
      totalCount,
      hasMore: persistedCount(conversations) < totalCount,
    });
  };

  const scopedFromCache = () =>
    sortSidebarConversations(filterConversationsForScope(Array.from(byId.values()), scope));

  const applyEvent = (event: SidebarBackendEvent) => {
    switch (event.kind) {
      case "upsert": {
        const incoming = event.conversation;
        const previous = byId.get(incoming.id);
        const preserveUpdatedAtIds = activePositionLockIds();
        const merged = mergeSidebarConversation(previous, incoming, {
          preserveExistingUpdatedAt: preserveUpdatedAtIds.includes(incoming.id),
        });
        byId = new Map(byId);
        byId.set(merged.id, merged);
        const workspaceFeeds = updateWorkspaceFeedsForConversation(previous, merged);
        const workdirActivity = bumpWorkdirActivity(
          snapshot.workdirActivity,
          merged.cwd,
          merged.updatedAt,
        );
        const cwdKey = workspaceProjectPathKey(merged.cwd ?? "");
        if (cwdKey && !knownWorkdirPathKeys().has(cwdKey)) {
          scheduleWorkdirsDebounce();
        }
        const inScope = conversationMatchesScope(merged, scope);
        const wasListed = snapshot.conversations.some((item) => item.id === merged.id);
        const next = inScope
          ? applySidebarBackendEvent(snapshot.conversations, event, {
              preserveUpdatedAtConversationIds: preserveUpdatedAtIds,
            })
          : wasListed
            ? snapshot.conversations.filter((item) => item.id !== merged.id)
            : snapshot.conversations;
        if (next === snapshot.conversations && workdirActivity === snapshot.workdirActivity) {
          commit({ byId, workspaceFeeds });
          return;
        }
        commitScopedList(next, {
          workspaceFeeds,
          workdirActivity,
          listError: null,
          listErrorDetail: null,
        });
        return;
      }
      case "delete": {
        const previous = byId.get(event.conversationId);
        if (previous) {
          byId = new Map(byId);
          byId.delete(event.conversationId);
        }
        const workspaceFeeds = updateWorkspaceFeedsForConversation(previous, undefined);
        const next = snapshot.conversations.filter((item) => item.id !== event.conversationId);
        scheduleWorkdirsDebounce();
        if (next === snapshot.conversations || next.length === snapshot.conversations.length) {
          commit({ byId, workspaceFeeds });
          return;
        }
        commitScopedList(next, { workspaceFeeds });
        return;
      }
      case "running": {
        const workdir =
          event.workdir?.trim() || byId.get(event.conversationId)?.cwd?.trim() || null;
        const updatedAt =
          typeof event.updatedAt === "number" && Number.isFinite(event.updatedAt)
            ? event.updatedAt
            : now();
        const statusUpdatedAt = runningStatusUpdatedAt.get(event.conversationId);
        const current = running.get(event.conversationId);
        if (
          statusUpdatedAt !== undefined &&
          (statusUpdatedAt > updatedAt || (statusUpdatedAt === updatedAt && !current))
        ) {
          return;
        }
        if (current && current.workdir === workdir && current.updatedAt >= updatedAt) {
          return;
        }
        runningStatusUpdatedAt.set(event.conversationId, updatedAt);
        running = new Map(running);
        running.set(event.conversationId, { workdir, updatedAt });
        commit({
          runningConversationIds: new Set(running.keys()),
          runningWorkdirPathKeys: runningWorkdirPathKeysOf(running),
          workdirActivity: bumpWorkdirActivity(snapshot.workdirActivity, workdir, updatedAt),
        });
        return;
      }
      case "idle": {
        const updatedAt =
          typeof event.updatedAt === "number" && Number.isFinite(event.updatedAt)
            ? event.updatedAt
            : now();
        const statusUpdatedAt = runningStatusUpdatedAt.get(event.conversationId);
        if (statusUpdatedAt !== undefined && statusUpdatedAt > updatedAt) {
          return;
        }
        runningStatusUpdatedAt.set(event.conversationId, updatedAt);
        if (!running.has(event.conversationId)) {
          return;
        }
        running = new Map(running);
        running.delete(event.conversationId);
        commit({
          runningConversationIds: new Set(running.keys()),
          runningWorkdirPathKeys: runningWorkdirPathKeysOf(running),
        });
        return;
      }
    }
  };

  // authoritative=false keeps the pagination cursor and stays silent about
  // status when rows are already visible; authoritative=true is the fresh
  // scope load path (cursor reset). Both reconcile with server-wins.
  const fetchFirstPage = async (authoritative: boolean) => {
    if (startCount === 0) {
      return;
    }
    if (listRequestInFlight) {
      queuedListRequest = {
        authoritative: (queuedListRequest?.authoritative ?? false) || authoritative,
      };
      return;
    }
    listRequestInFlight = true;
    try {
      let nextRequest: { authoritative: boolean } | null = { authoritative };
      while (nextRequest && startCount > 0) {
        queuedListRequest = null;
        await runFirstPageRequest(nextRequest.authoritative);
        nextRequest = queuedListRequest;
      }
    } finally {
      listRequestInFlight = false;
    }
  };

  const runFirstPageRequest = async (authoritative: boolean) => {
    const seq = requestSeq;
    const generation = ++listGeneration;
    // Release the current-generation pagination gate immediately. Its
    // transport promise may still settle later, but the generation checks
    // make that result inert and a fresh page-2 request need not wait for it.
    loadMoreRequestToken = null;
    const requestScope = scope;
    if (requestScope.kind === "none") {
      byId = new Map(byId);
      commit({
        conversations: [],
        byId,
        totalCount: 0,
        hasMore: false,
        listStatus: "ready",
        isLoadingMore: false,
        listError: null,
        listErrorDetail: null,
      });
      loadedPageCount = 0;
      return;
    }
    let workspaceFeeds = snapshot.workspaceFeeds;
    if (requestScope.kind === "workdir") {
      const pathKey = workspaceProjectPathKey(requestScope.cwd);
      const feed = workspaceFeeds.get(pathKey);
      if (feed) {
        workspaceFeedQueue = workspaceFeedQueue.filter((request) => request.pathKey !== pathKey);
        const nextWorkspaceFeeds = new Map(workspaceFeeds);
        nextWorkspaceFeeds.set(pathKey, {
          ...feed,
          requestGeneration: feed.requestGeneration + 1,
        });
        workspaceFeeds = nextWorkspaceFeeds;
        settleWorkspaceFeedWaiters(pathKey);
      }
    }
    const hasRows = snapshot.conversations.length > 0;
    commitScopedState({
      workspaceFeeds,
      listStatus: hasRows ? "syncing" : "loading",
      // The new first page owns pagination truth now. An older loadMore may
      // still settle at the transport layer, but its generation is stale and
      // its UI/result commits are ignored below.
      isLoadingMore: false,
    });
    try {
      const page = await backend.listConversations(1, pageSize, requestScope);
      if (seq !== requestSeq || generation !== listGeneration || startCount === 0) {
        return;
      }
      const authoritativeItems = filterConversationsForScope(page.items, requestScope);
      const reconciled = reconcileSidebarConversations(snapshot.conversations, authoritativeItems, {
        retainConversationIds: retainedConversationIds(),
        preserveUpdatedAtConversationIds: activePositionLockIds(),
        authoritativeComplete: page.items.length < pageSize,
      });
      byId = new Map(byId);
      const reconciledIds = new Set<string>();
      for (const item of reconciled) {
        byId.set(item.id, item);
        reconciledIds.add(item.id);
      }
      const fetchedPageCount = page.items.length > 0 ? 1 : 0;
      loadedPageCount = authoritative
        ? fetchedPageCount
        : Math.max(loadedPageCount, fetchedPageCount);
      const totalCount = Math.max(0, page.totalCount);
      const workspaceFeeds = syncActiveWorkspaceFeed(snapshot.workspaceFeeds, {
        conversations: reconciled,
        totalCount,
        listStatus: "ready",
        isLoadingMore: false,
        listError: null,
        listErrorDetail: null,
      });
      pruneOrphanedConversations(
        snapshot.conversations
          .map((item) => item.id)
          .filter((id) => !reconciledIds.has(id)),
        workspaceFeeds,
        reconciled,
      );
      commit({
        conversations: reconciled,
        byId,
        workspaceFeeds,
        totalCount,
        hasMore: page.items.length > 0 && persistedCount(reconciled) < totalCount,
        listStatus: "ready",
        listError: null,
        listErrorDetail: null,
      });
    } catch (error) {
      if (seq !== requestSeq || generation !== listGeneration || startCount === 0) {
        return;
      }
      commitScopedState({
        listStatus: "ready",
        listError: "listFailed",
        listErrorDetail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const refreshWorkdirs = async (reason: SidebarWorkdirsRefreshReason) => {
    void reason;
    if (startCount === 0) {
      return;
    }
    if (workdirsInFlight) {
      workdirsQueued = true;
      return;
    }
    workdirsInFlight = true;
    try {
      do {
        workdirsQueued = false;
        const seq = requestSeq;
        try {
          const workdirs = await backend.listWorkdirs();
          if (seq !== requestSeq || startCount === 0) {
            return;
          }
          let workdirActivity = snapshot.workdirActivity;
          for (const workdir of workdirs) {
            workdirActivity = bumpWorkdirActivity(workdirActivity, workdir.path, workdir.updatedAt);
          }
          commit({ workdirs, workdirActivity });
        } catch {
          // Workdir summaries are auxiliary (project ordering/activity); the
          // conversation list and the next scheduled refresh are unaffected.
          return;
        }
      } while (workdirsQueued && startCount > 0);
    } finally {
      workdirsInFlight = false;
    }
  };

  const runMutation = async (params: {
    id: string;
    kind: SidebarMutationKind;
    failureCode: SidebarErrorCode;
    blockedCode?: SidebarErrorCode;
    optimistic: (current: SidebarConversation) => SidebarConversation | null;
    execute: () => Promise<SidebarConversation | null>;
  }): Promise<boolean> => {
    const { id, kind, failureCode, blockedCode } = params;
    if (snapshot.mutations.has(id)) {
      return false;
    }
    if (blockedCode && running.has(id)) {
      const mutationErrors = new Map(snapshot.mutationErrors);
      mutationErrors.set(id, blockedCode);
      commit({ mutationErrors });
      return false;
    }
    const previous = byId.get(id);
    if (!previous) {
      return false;
    }
    const optimistic = params.optimistic(previous);
    const mutations = new Map(snapshot.mutations);
    mutations.set(id, kind);
    const mutationErrors = new Map(snapshot.mutationErrors);
    mutationErrors.delete(id);
    byId = new Map(byId);
    if (optimistic) {
      byId.set(id, optimistic);
      const workspaceFeeds = updateWorkspaceFeedsForConversation(previous, optimistic);
      const rest = snapshot.conversations.filter((item) => item.id !== id);
      const next = conversationMatchesScope(optimistic, scope)
        ? sortSidebarConversations([optimistic, ...rest])
        : rest;
      commitScopedList(next, { mutations, mutationErrors, workspaceFeeds });
    } else {
      byId.delete(id);
      const workspaceFeeds = updateWorkspaceFeedsForConversation(previous, undefined);
      commitScopedList(
        snapshot.conversations.filter((item) => item.id !== id),
        { mutations, mutationErrors, workspaceFeeds },
      );
    }

    try {
      const confirmed = await params.execute();
      const nextMutations = new Map(snapshot.mutations);
      nextMutations.delete(id);
      if (confirmed) {
        positionLocks.set(id, now() + positionLockMs);
        const optimisticCurrent = byId.get(id);
        const merged = mergeSidebarConversation(optimisticCurrent, confirmed, {
          preserveExistingUpdatedAt: true,
        });
        byId = new Map(byId);
        byId.set(id, merged);
        const workspaceFeeds = updateWorkspaceFeedsForConversation(optimisticCurrent, merged);
        const rest = snapshot.conversations.filter((item) => item.id !== id);
        const next = conversationMatchesScope(merged, scope)
          ? sortSidebarConversations([merged, ...rest])
          : rest;
        commitScopedList(next, { mutations: nextMutations, workspaceFeeds });
      } else {
        commit({ mutations: nextMutations, byId });
      }
      return true;
    } catch (error) {
      void error;
      const nextMutations = new Map(snapshot.mutations);
      nextMutations.delete(id);
      const nextErrors = new Map(snapshot.mutationErrors);
      nextErrors.set(id, failureCode);
      const optimisticCurrent = byId.get(id);
      byId = new Map(byId);
      byId.set(id, previous);
      const workspaceFeeds = updateWorkspaceFeedsForConversation(optimisticCurrent, previous);
      const rest = snapshot.conversations.filter((item) => item.id !== id);
      const next = conversationMatchesScope(previous, scope)
        ? sortSidebarConversations([previous, ...rest])
        : rest;
      commitScopedList(next, {
        mutations: nextMutations,
        mutationErrors: nextErrors,
        workspaceFeeds,
      });
      return false;
    }
  };

  const refresh = async (refreshOptions?: { reason?: SidebarRefreshReason }) => {
    void refreshOptions;
    await fetchFirstPage(false);
  };

  const loadMore = async () => {
    if (
      startCount === 0 ||
      loadMoreRequestToken !== null ||
      listRequestInFlight ||
      !snapshot.hasMore ||
      scope.kind === "none"
    ) {
      return;
    }
    const requestToken = Symbol("sidebar-load-more");
    loadMoreRequestToken = requestToken;
    const seq = requestSeq;
    const generation = listGeneration;
    const requestScope = scope;
    const pageNumber = loadedPageCount + 1;
    commitScopedState({ isLoadingMore: true });
    try {
      const page = await backend.listConversations(pageNumber, pageSize, requestScope);
      if (seq !== requestSeq || generation !== listGeneration || startCount === 0) {
        return;
      }
      let next = snapshot.conversations;
      for (const item of filterConversationsForScope(page.items, requestScope)) {
        next = reconcileMergePageItem(next, item);
      }
      byId = new Map(byId);
      for (const item of next) {
        byId.set(item.id, item);
      }
      if (page.items.length > 0) {
        loadedPageCount = pageNumber;
      }
      const totalCount = Math.max(0, page.totalCount);
      commitScopedState({
        conversations: next,
        byId,
        totalCount,
        hasMore: page.items.length > 0 && persistedCount(next) < totalCount,
        isLoadingMore: false,
        listError: null,
        listErrorDetail: null,
      });
    } catch (error) {
      if (seq !== requestSeq || generation !== listGeneration || startCount === 0) {
        return;
      }
      commitScopedState({
        isLoadingMore: false,
        listError: "loadMoreFailed",
        listErrorDetail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (loadMoreRequestToken === requestToken) {
        loadMoreRequestToken = null;
      }
    }
  };

  const reconcileMergePageItem = (
    conversations: readonly SidebarConversation[],
    item: SidebarConversation,
  ) => {
    const preserveUpdatedAtIds = activePositionLockIds();
    return applySidebarBackendEvent(
      conversations,
      { kind: "upsert", conversationId: item.id, conversation: item },
      { preserveUpdatedAtConversationIds: preserveUpdatedAtIds },
    );
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start: () => {
      startCount += 1;
      if (startCount > 1) {
        return;
      }
      unsubscribeEvents = backend.subscribeEvents(applyEvent);
      unsubscribeConnection =
        backend.subscribeConnection?.((connected) => {
          if (!connected) {
            wasDisconnected = true;
            return;
          }
          if (wasDisconnected) {
            wasDisconnected = false;
            void fetchFirstPage(false);
            const activePathKey =
              scope.kind === "workdir" ? workspaceProjectPathKey(scope.cwd) : "";
            const feedTargets = Array.from(workspaceFeedRefreshTargets.values()).filter(
              (target) => target.pathKey !== activePathKey,
            );
            void ensureWorkspaceFeeds(feedTargets, { force: true });
            void refreshWorkdirs("reconnect");
          }
        }) ?? null;
      reconcileTimer = setInterval(() => {
        void fetchFirstPage(false);
      }, reconcileIntervalMs);
      workdirsFallbackTimer = setInterval(() => {
        void refreshWorkdirs("fallback");
      }, workdirsFallbackMs);
      void refreshWorkdirs("initial");
      void fetchFirstPage(true);
    },

    stop: () => {
      if (startCount === 0) {
        return;
      }
      startCount -= 1;
      if (startCount > 0) {
        return;
      }
      requestSeq += 1;
      workspaceFeedSeq += 1;
      listGeneration += 1;
      unsubscribeEvents?.();
      unsubscribeEvents = null;
      unsubscribeConnection?.();
      unsubscribeConnection = null;
      if (reconcileTimer !== null) {
        clearInterval(reconcileTimer);
        reconcileTimer = null;
      }
      if (workdirsFallbackTimer !== null) {
        clearInterval(workdirsFallbackTimer);
        workdirsFallbackTimer = null;
      }
      if (workdirsDebounceTimer !== null) {
        clearTimeout(workdirsDebounceTimer);
        workdirsDebounceTimer = null;
      }
      queuedListRequest = null;
      loadMoreRequestToken = null;
      const queuedWorkspaceFeedPathKeys = new Set(
        workspaceFeedQueue.map((request) => request.pathKey),
      );
      workspaceFeedQueue = [];
      for (const pathKey of queuedWorkspaceFeedPathKeys) settleWorkspaceFeedWaiters(pathKey);
      workdirsQueued = false;
      wasDisconnected = false;
    },

    setScope: (nextScope) => {
      const nextKey = sidebarScopeKey(nextScope);
      if (nextKey === snapshot.scopeKey) {
        scope = nextScope;
        return;
      }
      scope = nextScope;
      requestSeq += 1;
      listGeneration += 1;
      loadMoreRequestToken = null;
      loadedPageCount = 0;
      const cached = scopedFromCache();
      commit({
        scopeKey: nextKey,
        conversations: cached,
        totalCount: persistedCount(cached),
        hasMore: false,
        listStatus: nextScope.kind === "none" ? "ready" : cached.length > 0 ? "syncing" : "loading",
        isLoadingMore: false,
        listError: null,
        listErrorDetail: null,
      });
      if (startCount > 0) {
        void fetchFirstPage(true);
      }
    },

    refresh,
    loadMore,
    setWorkspaceFeedRefreshTargets,
    ensureWorkspaceFeeds,
    retryWorkspaceFeed,
    loadMoreWorkspaceFeed,
    collapseWorkspaceFeed,
    refreshWorkdirs,

    rename: (id, title) =>
      runMutation({
        id,
        kind: "rename",
        failureCode: "renameFailed",
        blockedCode: "renameBlockedRunning",
        optimistic: (current) => ({ ...current, title }),
        execute: () => backend.renameConversation(id, title),
      }),

    setPinned: (id, isPinned) =>
      runMutation({
        id,
        kind: "pin",
        failureCode: "pinFailed",
        optimistic: (current) => ({
          ...current,
          isPinned,
          pinnedAt: isPinned ? now() : null,
        }),
        execute: () => backend.setConversationPinned(id, isPinned),
      }),

    remove: async (id) => {
      const removed = await runMutation({
        id,
        kind: "delete",
        failureCode: "deleteFailed",
        blockedCode: "deleteBlockedRunning",
        optimistic: () => null,
        execute: async () => {
          await backend.deleteConversation(id);
          return null;
        },
      });
      if (removed) {
        void refreshWorkdirs("delete");
      }
      return removed;
    },

    clearMutationError: (id) => {
      if (!snapshot.mutationErrors.has(id)) {
        return;
      }
      const mutationErrors = new Map(snapshot.mutationErrors);
      mutationErrors.delete(id);
      commit({ mutationErrors });
    },

    upsertLocal: (conversation) => {
      const previous = byId.get(conversation.id);
      const merged = mergeSidebarConversation(previous, conversation);
      byId = new Map(byId);
      byId.set(merged.id, merged);
      const workspaceFeeds = updateWorkspaceFeedsForConversation(previous, merged);
      const inScope = conversationMatchesScope(merged, scope);
      const wasVisible = snapshot.conversations.some((item) => item.id === merged.id);
      const workdirActivity = bumpWorkdirActivity(
        snapshot.workdirActivity,
        merged.cwd,
        merged.updatedAt,
      );
      if (!inScope && !wasVisible) {
        // 会话不属于当前作用域且原本不可见：保持 conversations 引用稳定。
        // 否则每次调用都会产生新列表引用，调用方若依据“列表里没有该会话”
        // 反复重插，会形成同步更新风暴（Maximum update depth exceeded）。
        commit({ byId, workspaceFeeds, workdirActivity });
        return;
      }
      const rest = snapshot.conversations.filter((item) => item.id !== merged.id);
      const next = inScope ? sortSidebarConversations([merged, ...rest]) : rest;
      commitScopedList(next, { workspaceFeeds, workdirActivity });
    },

    removeLocal: (conversationId) => {
      const previous = byId.get(conversationId);
      if (!previous) {
        return;
      }
      byId = new Map(byId);
      byId.delete(conversationId);
      const workspaceFeeds = updateWorkspaceFeedsForConversation(previous, undefined);
      commitScopedList(snapshot.conversations.filter((item) => item.id !== conversationId), {
        workspaceFeeds,
      });
    },

    applyRunningPatch: (patch) => {
      applyEvent(
        patch.running
          ? {
              kind: "running",
              conversationId: patch.conversationId,
              workdir: patch.workdir,
              updatedAt: patch.updatedAt,
            }
          : {
              kind: "idle",
              conversationId: patch.conversationId,
              updatedAt: patch.updatedAt,
            },
      );
    },

    hydrateRunning: (items) => {
      const next = new Map<string, { workdir: string | null; updatedAt: number }>();
      for (const item of items) {
        const conversationId = item.conversationId.trim();
        if (!conversationId) continue;
        const hasUpdatedAt = typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt);
        const updatedAt = hasUpdatedAt ? item.updatedAt! : now();
        const statusUpdatedAt = runningStatusUpdatedAt.get(conversationId);
        const current = running.get(conversationId);
        const staleAgainstKnownStatus =
          statusUpdatedAt !== undefined &&
          (!hasUpdatedAt ||
            statusUpdatedAt > updatedAt ||
            (statusUpdatedAt === updatedAt && !current));
        if (staleAgainstKnownStatus) {
          if (current) {
            next.set(conversationId, current);
          }
          continue;
        }
        const entry = {
          workdir: item.workdir?.trim() || null,
          updatedAt,
        };
        next.set(conversationId, entry);
        runningStatusUpdatedAt.set(conversationId, updatedAt);
      }
      running = next;
      commit({
        runningConversationIds: new Set(running.keys()),
        runningWorkdirPathKeys: runningWorkdirPathKeysOf(running),
      });
    },

    peek: (conversationId) => byId.get(conversationId),
    peekConversations: () => snapshot.conversations,
  };
}
