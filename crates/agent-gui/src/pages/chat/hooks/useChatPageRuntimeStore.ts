import type { MentionComposerDraft } from "@liveagent/ui/components/chat/MentionComposer";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CompactionStatus } from "../../../lib/chat/compaction/types";
import {
  type ConversationViewState,
  createConversationStateFromContext,
} from "../../../lib/chat/conversation/conversationState";
import type { ConversationPersistenceCursor } from "../../../lib/chat/history/chatHistory";
import type {
  PendingUploadedFile,
  UploadedUserMessage,
} from "../../../lib/chat/messages/uploadedFiles";
import type {
  ChatRuntimeControls,
  ExecutionMode,
  SelectedModel,
} from "../../../lib/settings";
import {
  type ConversationRuntimeEntry,
  createConversationRuntimeEntry,
  setConversationRuntimeCacheEntry,
} from "../runtime/chatPageRuntime";

type ConversationIdentity = {
  conversationId: string;
  sessionId: string;
  createdAt: number;
};

type RuntimeEntryFallback = Partial<ConversationRuntimeEntry> &
  Pick<ConversationRuntimeEntry, "state" | "sessionId" | "createdAt">;

export type ConversationAgentSteerHandler = {
  runToken: string;
  deliver: (message: UploadedUserMessage) => boolean;
};

export type ConversationDirectHandoff = {
  text: string;
  uploadedFiles: PendingUploadedFile[];
  userMessage: UploadedUserMessage;
  executionMode: ExecutionMode;
  workdir: string;
  runtimeControls: ChatRuntimeControls;
  restoreDraft: MentionComposerDraft | null;
  restoreUploadedFiles: PendingUploadedFile[];
};

type UseChatPageRuntimeStoreParams = {
  initialConversation: ConversationIdentity;
  initialConversationState: ConversationViewState;
  currentConversationId: string;
  conversationState: ConversationViewState;
  compactionStatus: CompactionStatus;
  isSending: boolean;
  errorMessage: string | null;
  hookWarning: string | null;
  currentConversationSessionId: string;
  currentConversationCreatedAt: number;
  currentConversationSelectedModel: SelectedModel | undefined;
  setConversationState: Dispatch<SetStateAction<ConversationViewState>>;
  setCompactionStatus: Dispatch<SetStateAction<CompactionStatus>>;
  setIsSending: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setHookWarning: Dispatch<SetStateAction<string | null>>;
  setCurrentConversationSessionId: Dispatch<SetStateAction<string>>;
  setCurrentConversationCreatedAt: Dispatch<SetStateAction<number>>;
  setCurrentConversationSelectedModel: Dispatch<SetStateAction<SelectedModel | undefined>>;
  setRunningConversationIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
};

export function useChatPageRuntimeStore(params: UseChatPageRuntimeStoreParams) {
  const {
    initialConversation,
    initialConversationState,
    currentConversationId,
    conversationState,
    compactionStatus,
    isSending,
    errorMessage,
    hookWarning,
    currentConversationSessionId,
    currentConversationCreatedAt,
    currentConversationSelectedModel,
    setConversationState,
    setCompactionStatus,
    setIsSending,
    setErrorMessage,
    setHookWarning,
    setCurrentConversationSessionId,
    setCurrentConversationCreatedAt,
    setCurrentConversationSelectedModel,
    setRunningConversationIds,
  } = params;

  const currentConversationIdRef = useRef<string>(initialConversation.conversationId);
  const conversationRuntimeCacheRef = useRef(
    new Map<string, ConversationRuntimeEntry>([
      [
        initialConversation.conversationId,
        createConversationRuntimeEntry({
          state: initialConversationState,
          sessionId: initialConversation.sessionId,
          createdAt: initialConversation.createdAt,
        }),
      ],
    ]),
  );
  const conversationPersistenceCursorRef = useRef(new Map<string, ConversationPersistenceCursor>());
  const runningConversationIdsRef = useRef(new Set<string>());
  const conversationAbortControllersRef = useRef(new Map<string, AbortController>());
  const conversationStopRequestsRef = useRef(new Set<string>());
  const conversationStopRequestVersionsRef = useRef(new Map<string, number>());
  const conversationStopHandlersRef = useRef(
    new Map<string, (options: { force: boolean; requestVersion: number }) => void>(),
  );
  const conversationAgentSteerHandlersRef = useRef(
    new Map<string, ConversationAgentSteerHandler>(),
  );
  const conversationDirectHandoffsRef = useRef(
    new Map<string, ConversationDirectHandoff | null>(),
  );
  const [directHandoffConversationIds, setDirectHandoffConversationIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const buildRuntimeEntryFromVisibleState = useCallback(
    (): ConversationRuntimeEntry =>
      createConversationRuntimeEntry({
        state: conversationState,
        compactionStatus,
        isSending,
        errorMessage,
        hookWarning,
        sessionId: currentConversationSessionId,
        createdAt: currentConversationCreatedAt,
        workdir: conversationRuntimeCacheRef.current.get(currentConversationIdRef.current)?.workdir,
        selectedModel: currentConversationSelectedModel,
      }),
    [
      compactionStatus,
      conversationState,
      currentConversationCreatedAt,
      currentConversationSessionId,
      currentConversationSelectedModel,
      errorMessage,
      hookWarning,
      isSending,
    ],
  );

  const syncVisibleConversationRuntime = useCallback(
    (conversationId: string, entry: ConversationRuntimeEntry) => {
      currentConversationIdRef.current = conversationId;
      setConversationState(entry.state);
      setCompactionStatus(entry.compactionStatus);
      setIsSending(entry.isSending);
      setErrorMessage(entry.errorMessage);
      setHookWarning(entry.hookWarning);
      setCurrentConversationSessionId(entry.sessionId);
      setCurrentConversationCreatedAt(entry.createdAt);
      setCurrentConversationSelectedModel(entry.selectedModel);
    },
    [
      setCompactionStatus,
      setConversationState,
      setCurrentConversationCreatedAt,
      setCurrentConversationSelectedModel,
      setCurrentConversationSessionId,
      setErrorMessage,
      setHookWarning,
      setIsSending,
    ],
  );

  const ensureConversationRuntimeEntry = useCallback(
    (conversationId: string, fallback?: RuntimeEntryFallback) => {
      const key = conversationId.trim();
      const cached = conversationRuntimeCacheRef.current.get(key);
      if (cached) return cached;
      const next =
        fallback ??
        (key === currentConversationIdRef.current
          ? buildRuntimeEntryFromVisibleState()
          : createConversationRuntimeEntry({
              state: createConversationStateFromContext({
                tools: conversationState.meta.tools,
                messages: [],
              }),
              sessionId: key,
              createdAt: Date.now(),
            }));
      const normalized = createConversationRuntimeEntry(next);
      setConversationRuntimeCacheEntry(conversationRuntimeCacheRef.current, key, normalized);
      return normalized;
    },
    [buildRuntimeEntryFromVisibleState, conversationState.meta.tools],
  );

  const updateConversationRuntimeEntry = useCallback(
    (
      conversationId: string,
      updater: (prev: ConversationRuntimeEntry) => ConversationRuntimeEntry,
      fallback?: RuntimeEntryFallback,
    ) => {
      const key = conversationId.trim();
      const next = updater(ensureConversationRuntimeEntry(key, fallback));
      setConversationRuntimeCacheEntry(conversationRuntimeCacheRef.current, key, next);
      if (currentConversationIdRef.current === key) {
        syncVisibleConversationRuntime(key, next);
      }
      return next;
    },
    [ensureConversationRuntimeEntry, syncVisibleConversationRuntime],
  );

  const getConversationRuntimeEntry = useCallback(
    (conversationId: string) => conversationRuntimeCacheRef.current.get(conversationId.trim()),
    [],
  );

  const isConversationRunning = useCallback((conversationId: string) => {
    return runningConversationIdsRef.current.has(conversationId.trim());
  }, []);

  const setConversationAbortController = useCallback(
    (conversationId: string, controller: AbortController | null) => {
      const key = conversationId.trim();
      if (!key) return;
      if (controller) {
        conversationAbortControllersRef.current.set(key, controller);
        if (conversationStopRequestsRef.current.has(key)) {
          controller.abort();
        }
        return;
      }
      conversationAbortControllersRef.current.delete(key);
    },
    [],
  );

  const getConversationAbortController = useCallback((conversationId: string) => {
    return conversationAbortControllersRef.current.get(conversationId.trim()) ?? null;
  }, []);

  const requestConversationStop = useCallback((conversationId: string) => {
    const key = conversationId.trim();
    if (!key) return false;
    const alreadyRequested = conversationStopRequestsRef.current.has(key);
    conversationStopRequestVersionsRef.current.set(
      key,
      (conversationStopRequestVersionsRef.current.get(key) ?? 0) + 1,
    );
    conversationStopRequestsRef.current.add(key);
    return alreadyRequested;
  }, []);

  const getConversationStopRequestVersion = useCallback((conversationId: string) => {
    return conversationStopRequestVersionsRef.current.get(conversationId.trim()) ?? 0;
  }, []);

  const isConversationStopRequested = useCallback((conversationId: string) => {
    return conversationStopRequestsRef.current.has(conversationId.trim());
  }, []);

  const consumeConversationStop = useCallback(
    (conversationId: string, expectedVersion?: number) => {
      const key = conversationId.trim();
      if (
        expectedVersion !== undefined &&
        conversationStopRequestVersionsRef.current.get(key) !== expectedVersion
      ) {
        return false;
      }
      return conversationStopRequestsRef.current.delete(key);
    },
    [],
  );

  const setConversationStopHandler = useCallback(
    (
      conversationId: string,
      handler: ((options: { force: boolean; requestVersion: number }) => void) | null,
    ) => {
      const key = conversationId.trim();
      if (!key) return;
      if (handler) {
        conversationStopHandlersRef.current.set(key, handler);
        if (conversationStopRequestsRef.current.has(key)) {
          handler({
            force: false,
            requestVersion: conversationStopRequestVersionsRef.current.get(key) ?? 0,
          });
        }
        return;
      }
      conversationStopHandlersRef.current.delete(key);
    },
    [],
  );

  const clearConversationStopHandler = useCallback(
    (
      conversationId: string,
      handler: (options: { force: boolean; requestVersion: number }) => void,
    ) => {
      const key = conversationId.trim();
      if (conversationStopHandlersRef.current.get(key) === handler) {
        conversationStopHandlersRef.current.delete(key);
      }
    },
    [],
  );

  const requestActiveConversationStop = useCallback(
    (conversationId: string, options: { force: boolean }) => {
      const key = conversationId.trim();
      const handler = conversationStopHandlersRef.current.get(key);
      if (!handler) return false;
      handler({
        ...options,
        requestVersion: conversationStopRequestVersionsRef.current.get(key) ?? 0,
      });
      return true;
    },
    [],
  );

  const setConversationAgentSteerHandler = useCallback(
    (conversationId: string, handler: ConversationAgentSteerHandler) => {
      const key = conversationId.trim();
      const runToken = handler.runToken.trim();
      if (!key || !runToken) return false;
      conversationAgentSteerHandlersRef.current.set(key, { ...handler, runToken });
      return true;
    },
    [],
  );

  const getConversationAgentSteerHandler = useCallback((conversationId: string) => {
    return conversationAgentSteerHandlersRef.current.get(conversationId.trim()) ?? null;
  }, []);

  const clearConversationAgentSteerHandler = useCallback(
    (conversationId: string, runToken: string) => {
      const key = conversationId.trim();
      const current = conversationAgentSteerHandlersRef.current.get(key);
      if (!current || current.runToken !== runToken.trim()) return false;
      conversationAgentSteerHandlersRef.current.delete(key);
      return true;
    },
    [],
  );

  const deliverConversationAgentSteer = useCallback(
    (conversationId: string, runToken: string, message: UploadedUserMessage) => {
      const handler = conversationAgentSteerHandlersRef.current.get(conversationId.trim());
      if (!handler || handler.runToken !== runToken.trim()) return false;
      return handler.deliver(message);
    },
    [],
  );

  const reserveConversationDirectHandoff = useCallback((conversationId: string) => {
    const key = conversationId.trim();
    if (!key || conversationDirectHandoffsRef.current.has(key)) return false;
    conversationDirectHandoffsRef.current.set(key, null);
    setDirectHandoffConversationIds((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
    return true;
  }, []);

  const setConversationDirectHandoff = useCallback(
    (conversationId: string, handoff: ConversationDirectHandoff) => {
      const key = conversationId.trim();
      if (!key || conversationDirectHandoffsRef.current.get(key) !== null) return false;
      conversationDirectHandoffsRef.current.set(key, handoff);
      return true;
    },
    [],
  );

  const getConversationDirectHandoff = useCallback((conversationId: string) => {
    return conversationDirectHandoffsRef.current.get(conversationId.trim()) ?? null;
  }, []);

  const takeConversationDirectHandoff = useCallback((conversationId: string) => {
    const key = conversationId.trim();
    const handoff = conversationDirectHandoffsRef.current.get(key) ?? null;
    if (!handoff) return null;
    conversationDirectHandoffsRef.current.delete(key);
    setDirectHandoffConversationIds((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    return handoff;
  }, []);

  const clearConversationDirectHandoff = useCallback((conversationId: string) => {
    const key = conversationId.trim();
    const cleared = conversationDirectHandoffsRef.current.delete(key);
    if (cleared) {
      setDirectHandoffConversationIds((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
    return cleared;
  }, []);

  const isConversationDirectHandoffPending = useCallback(
    (conversationId: string) => directHandoffConversationIds.has(conversationId.trim()),
    [directHandoffConversationIds],
  );

  const setConversationSendingState = useCallback(
    (conversationId: string, value: boolean) => {
      updateConversationRuntimeEntry(conversationId, (prev) => ({
        ...prev,
        isSending: value,
      }));
      const key = conversationId.trim();
      if (!key) return;
      if (value) {
        runningConversationIdsRef.current.add(key);
        setRunningConversationIds((prev) => {
          if (prev.has(key)) return prev;
          const next = new Set(prev);
          next.add(key);
          return next;
        });
        return;
      }
      runningConversationIdsRef.current.delete(key);
      setRunningConversationIds((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    },
    [setRunningConversationIds, updateConversationRuntimeEntry],
  );

  useEffect(() => {
    setConversationRuntimeCacheEntry(
      conversationRuntimeCacheRef.current,
      currentConversationId,
      createConversationRuntimeEntry({
        state: conversationState,
        compactionStatus,
        isSending,
        errorMessage,
        hookWarning,
        sessionId: currentConversationSessionId,
        createdAt: currentConversationCreatedAt,
        workdir: conversationRuntimeCacheRef.current.get(currentConversationId)?.workdir,
        selectedModel: currentConversationSelectedModel,
      }),
    );
  }, [
    compactionStatus,
    conversationState,
    currentConversationCreatedAt,
    currentConversationId,
    currentConversationSessionId,
    currentConversationSelectedModel,
    errorMessage,
    hookWarning,
    isSending,
  ]);

  useEffect(
    () => () => {
      for (const controller of conversationAbortControllersRef.current.values()) {
        controller.abort();
      }
      conversationAbortControllersRef.current.clear();
      conversationStopRequestsRef.current.clear();
      conversationStopRequestVersionsRef.current.clear();
      conversationStopHandlersRef.current.clear();
      conversationAgentSteerHandlersRef.current.clear();
      conversationDirectHandoffsRef.current.clear();
    },
    [],
  );

  return {
    currentConversationIdRef,
    conversationRuntimeCacheRef,
    conversationPersistenceCursorRef,
    runningConversationIdsRef,
    buildRuntimeEntryFromVisibleState,
    syncVisibleConversationRuntime,
    ensureConversationRuntimeEntry,
    updateConversationRuntimeEntry,
    getConversationRuntimeEntry,
    isConversationRunning,
    setConversationAbortController,
    getConversationAbortController,
    requestConversationStop,
    getConversationStopRequestVersion,
    isConversationStopRequested,
    consumeConversationStop,
    setConversationStopHandler,
    clearConversationStopHandler,
    requestActiveConversationStop,
    setConversationAgentSteerHandler,
    getConversationAgentSteerHandler,
    clearConversationAgentSteerHandler,
    deliverConversationAgentSteer,
    reserveConversationDirectHandoff,
    setConversationDirectHandoff,
    getConversationDirectHandoff,
    takeConversationDirectHandoff,
    clearConversationDirectHandoff,
    isConversationDirectHandoffPending,
    directHandoffConversationIds,
    setConversationSendingState,
  };
}
