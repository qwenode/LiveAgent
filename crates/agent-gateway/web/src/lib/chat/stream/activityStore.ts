import type { ConversationActivityEvent, RunActivityState } from "./streamTypes";

// The single source of truth for "which conversations have an active run":
// sidebar dots, busy indicators, everything. Fed by the always-on
// chat.activity broadcast plus history.list hydration — both carry run ids
// composed by the gateway inside the run-lifecycle transition, so there is no
// enrichment race and no local/remote union to reconcile.

export type ConversationActivity = {
  runId: string;
  state: RunActivityState;
  workdir: string | null;
  updatedAt: number;
  // Local receipt time (store clock): lets hydrate distinguish a push that
  // raced ahead of a list snapshot from a genuinely stale entry.
  receivedAt: number;
};

// A push received this recently survives a non-empty hydrate batch that omits
// it: the batch snapshot may have been built just before the run registered.
// Stale (stuck) entries are far older than this and still get dropped.
const RECENT_PUSH_KEEP_MS = 15_000;

export type ActivityIdleTransition = {
  runId: string;
  updatedAt: number;
};

export type ActivitySnapshot = {
  activities: ReadonlyMap<string, ConversationActivity>;
  idleTransitions: ReadonlyMap<string, ActivityIdleTransition>;
  revision: number;
};

export type ActivityStore = {
  getSnapshot(): ActivitySnapshot;
  subscribe(listener: () => void): () => void;
  isRunning(conversationId: string): boolean;
  get(conversationId: string): ConversationActivity | null;
  applyActivityEvent(event: ConversationActivityEvent): boolean;
  // Local settlement by run identity: a run_finished (or an activity-less
  // subscribe sync) proves the stored run ended even when the chat.activity
  // "stopped" broadcast was missed. Only the exact run is cleared — a newer
  // run's entry is never touched.
  settleRun(conversationId: string, runId: string): void;
  // history.list / chat.activities hydration: authoritative snapshot of
  // every active run at response time. Entries absent from the batch are
  // dropped unless listed in keepConversationIds (locally pending commands
  // the gateway may not know about yet).
  hydrate(
    items: Array<{
      conversationId: string;
      runId: string;
      state?: string;
      workdir?: string | null;
      updatedAt?: number;
    }>,
    options?: { keepConversationIds?: ReadonlySet<string> },
  ): void;
  clear(): void;
};

export function createActivityStore(options?: { now?: () => number }): ActivityStore {
  const now = options?.now ?? Date.now;
  let activities = new Map<string, ConversationActivity>();
  let idleTransitions = new Map<string, ActivityIdleTransition>();
  const latestIdleByConversation = new Map<string, ActivityIdleTransition>();
  let snapshot: ActivitySnapshot = { activities, idleTransitions, revision: 0 };
  const listeners = new Set<() => void>();

  const emit = (removed?: ReadonlyMap<string, ActivityIdleTransition>) => {
    idleTransitions = new Map(removed ?? []);
    snapshot = { activities, idleTransitions, revision: snapshot.revision + 1 };
    for (const listener of listeners) {
      listener();
    }
  };

  const normalizeState = (state: string | undefined | null): RunActivityState => {
    return state === "queued" || state === "cancelling" ? state : "running";
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isRunning: (conversationId) => activities.has(conversationId),
    get: (conversationId) => activities.get(conversationId) ?? null,

    applyActivityEvent: (event) => {
      const current = activities.get(event.conversationId);
      // Activity events are state signals ordered per conversation by the
      // gateway; a stale timestamp can only appear after a reconnect race —
      // ignore anything older than what we already show.
      if (current && event.updatedAt > 0 && event.updatedAt < current.updatedAt) {
        return false;
      }

      if (!event.running) {
        // A terminal signal may settle only the run it names. This mirrors
        // settleRun and prevents a delayed terminal for an older run from
        // deleting a newer run that now owns the conversation.
        if (!event.runId || (current && current.runId !== event.runId)) {
          return false;
        }
        const updatedAt = event.updatedAt > 0 ? event.updatedAt : (current?.updatedAt ?? 0);
        const previousIdle = latestIdleByConversation.get(event.conversationId);
        if (
          !current &&
          previousIdle &&
          (updatedAt <= 0 ||
            updatedAt < previousIdle.updatedAt ||
            (updatedAt === previousIdle.updatedAt && event.runId === previousIdle.runId))
        ) {
          return false;
        }
        if (current) {
          activities = new Map(activities);
          activities.delete(event.conversationId);
        }
        const transition = { runId: event.runId, updatedAt };
        latestIdleByConversation.set(event.conversationId, transition);
        emit(new Map([[event.conversationId, transition]]));
        return true;
      }

      if (!event.runId) {
        return false;
      }
      const previousIdle = latestIdleByConversation.get(event.conversationId);
      if (
        !current &&
        previousIdle &&
        (event.updatedAt <= 0 || event.updatedAt <= previousIdle.updatedAt)
      ) {
        return false;
      }
      const next: ConversationActivity = {
        runId: event.runId,
        state: normalizeState(event.state),
        workdir: event.workdir,
        updatedAt: event.updatedAt,
        receivedAt: now(),
      };
      if (
        current &&
        current.runId === next.runId &&
        current.state === next.state &&
        current.workdir === next.workdir
      ) {
        return false;
      }
      activities = new Map(activities);
      activities.set(event.conversationId, next);
      if (previousIdle) {
        latestIdleByConversation.delete(event.conversationId);
      }
      emit();
      return true;
    },

    settleRun: (conversationId, runId) => {
      if (!runId) {
        return;
      }
      const current = activities.get(conversationId);
      if (!current || current.runId !== runId) {
        return;
      }
      activities = new Map(activities);
      activities.delete(conversationId);
      const transition = { runId, updatedAt: current.updatedAt };
      latestIdleByConversation.set(conversationId, transition);
      emit(new Map([[conversationId, transition]]));
    },

    hydrate: (items, hydrateOptions) => {
      const nowMs = now();
      const incoming = new Map<string, ConversationActivity>();
      for (const item of items) {
        const conversationId = item.conversationId.trim();
        const runId = item.runId.trim();
        if (!conversationId || !runId) {
          continue;
        }
        incoming.set(conversationId, {
          runId,
          state: normalizeState(item.state),
          workdir: item.workdir?.trim() || null,
          updatedAt: item.updatedAt ?? 0,
          receivedAt: nowMs,
        });
      }

      // An empty authoritative snapshot means idle everywhere. Preserve each
      // removed run's gateway timestamp for the sidebar idle tombstone instead
      // of substituting the browser clock in the adapter.
      if (incoming.size === 0) {
        if (activities.size === 0) {
          return;
        }
        const removed = new Map<string, ActivityIdleTransition>();
        for (const [conversationId, current] of activities) {
          const transition = { runId: current.runId, updatedAt: current.updatedAt };
          removed.set(conversationId, transition);
          latestIdleByConversation.set(conversationId, transition);
        }
        activities = new Map();
        emit(removed);
        return;
      }

      // The snapshot races the chat.activity pushes: merge per entry with
      // newer-wins (all timestamps come from the gateway clock) so a stale
      // list response cannot resurrect a run we already saw finish. Entries
      // absent from the authoritative batch are dropped — the gateway says
      // they are not running — except conversations with a locally pending
      // command (whose run the gateway may not have registered yet) and
      // entries whose push arrived after the batch snapshot was built.
      const merged = new Map<string, ConversationActivity>();
      for (const [conversationId, activity] of incoming) {
        const current = activities.get(conversationId);
        merged.set(
          conversationId,
          current && current.updatedAt > activity.updatedAt ? current : activity,
        );
      }
      const keepConversationIds = hydrateOptions?.keepConversationIds;
      for (const [conversationId, current] of activities) {
        if (merged.has(conversationId)) {
          continue;
        }
        if (
          keepConversationIds?.has(conversationId) ||
          nowMs - current.receivedAt <= RECENT_PUSH_KEEP_MS
        ) {
          merged.set(conversationId, current);
        }
      }

      let changed = merged.size !== activities.size;
      if (!changed) {
        for (const [conversationId, activity] of merged) {
          const current = activities.get(conversationId);
          if (
            !current ||
            current.runId !== activity.runId ||
            current.state !== activity.state ||
            current.workdir !== activity.workdir ||
            current.updatedAt !== activity.updatedAt
          ) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) {
        return;
      }
      const removed = new Map<string, ActivityIdleTransition>();
      for (const [conversationId, current] of activities) {
        if (merged.has(conversationId)) {
          continue;
        }
        const transition = { runId: current.runId, updatedAt: current.updatedAt };
        removed.set(conversationId, transition);
        latestIdleByConversation.set(conversationId, transition);
      }
      for (const conversationId of merged.keys()) {
        latestIdleByConversation.delete(conversationId);
      }
      activities = merged;
      emit(removed);
    },

    clear: () => {
      if (activities.size === 0) {
        return;
      }
      const removed = new Map<string, ActivityIdleTransition>();
      for (const [conversationId, current] of activities) {
        const transition = { runId: current.runId, updatedAt: current.updatedAt };
        removed.set(conversationId, transition);
        latestIdleByConversation.set(conversationId, transition);
      }
      activities = new Map();
      emit(removed);
    },
  };
}
