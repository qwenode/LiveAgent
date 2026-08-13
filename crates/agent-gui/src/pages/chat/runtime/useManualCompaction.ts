import type { MutableRefObject } from "react";
import { useCallback } from "react";
import type {
  CompactionController,
  CompactionSinks,
  ManualCompactionOutcome,
} from "../../../lib/chat/compaction/controller";
import type { CompactionDecisionReason } from "../../../lib/chat/compaction/types";
import { createTurnCancellation } from "../../../lib/chat/conversation/turnCancellation";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import { createProviderRuntimeConfig } from "../../../lib/providers/llm";
import type { AppSettings } from "../../../lib/settings";
import type { ConversationRuntimeEntry } from "./chatPageRuntime";
import {
  buildPreparedContext as buildPreparedConversationContext,
  buildResumeContext as buildResumeConversationContext,
} from "./conversationContextBuilders";
import { resolveEffectiveChatModelSelection } from "./modelSelection";
import type { PersistConversationParams } from "../history/useConversationHistoryActions";

export type ManualCompactionResult = {
  status: "compacted" | "failed" | "busy" | "skipped";
  message?: string;
};

type StopHandler = (options: { force: boolean; requestVersion: number }) => void;

type PromptInputs = {
  skillsPrompt: string;
  memoryPrompt: string;
};

function manualSkipMessage(t: (key: string) => string, reason: CompactionDecisionReason) {
  switch (reason) {
    case "below-manual-threshold":
      return t("chat.manualCompactBelowThreshold");
    case "no-active-messages":
      return t("chat.manualCompactEmpty");
    default:
      return t("chat.manualCompactUnavailable");
  }
}

function mapOutcome(
  t: (key: string) => string,
  outcome: ManualCompactionOutcome,
  failureMessage: string,
): ManualCompactionResult {
  switch (outcome.status) {
    case "compacted":
      return { status: "compacted" };
    case "busy":
      return { status: "busy", message: t("chat.manualCompactRejected") };
    case "skipped":
      return { status: "skipped", message: manualSkipMessage(t, outcome.reason) };
    case "failed":
      return outcome.aborted
        ? { status: "skipped", message: t("chat.manualCompactCancelled") }
        : { status: "failed", message: failureMessage || t("chat.manualCompactFailed") };
  }
}

/**
 * Desktop-only manual compaction adapter. The controller remains the sole
 * owner of compaction state; this hook only assembles the existing binding and
 * exposes the existing running/stop/persistence lifecycle to the page.
 */
export function useManualCompaction(params: {
  settings: AppSettings;
  t: (key: string) => string;
  currentConversationIdRef: MutableRefObject<string>;
  isConversationRunning: (conversationId: string) => boolean;
  setConversationSendingState: (conversationId: string, value: boolean) => void;
  setConversationAbortController: (
    conversationId: string,
    controller: AbortController | null,
  ) => void;
  setConversationStopHandler: (conversationId: string, handler: StopHandler | null) => void;
  clearConversationStopHandler: (conversationId: string, handler: StopHandler) => void;
  consumeConversationStop: (conversationId: string, expectedVersion?: number) => boolean;
  buildRuntimeEntryFromVisibleState: () => ConversationRuntimeEntry;
  getCompactionController: (conversationId: string) => CompactionController;
  getConversationLiveTranscriptStore: (conversationId: string) => LiveTranscriptStore;
  updateConversationRuntimeEntry: (
    conversationId: string,
    updater: (prev: ConversationRuntimeEntry) => ConversationRuntimeEntry,
  ) => unknown;
  resetLiveTranscript: (store?: LiveTranscriptStore) => void;
  updateToolStatus: (status: string | null, store?: LiveTranscriptStore) => void;
  persistConversation: (params: PersistConversationParams) => Promise<boolean>;
  activeAgentPrompt: string;
  resolvePromptInputs: (workdir: string) => Promise<PromptInputs>;
}) {
  const {
    settings,
    t,
    currentConversationIdRef,
    isConversationRunning,
    setConversationSendingState,
    setConversationAbortController,
    setConversationStopHandler,
    clearConversationStopHandler,
    consumeConversationStop,
    buildRuntimeEntryFromVisibleState,
    getCompactionController,
    getConversationLiveTranscriptStore,
    updateConversationRuntimeEntry,
    resetLiveTranscript,
    updateToolStatus,
    persistConversation,
    activeAgentPrompt,
    resolvePromptInputs,
  } = params;

  return useCallback(async (): Promise<ManualCompactionResult> => {
    const conversationId = currentConversationIdRef.current.trim();
    if (!conversationId) {
      return { status: "skipped", message: t("chat.manualCompactRejected") };
    }
    if (isConversationRunning(conversationId)) {
      return { status: "busy", message: t("chat.manualCompactRejected") };
    }

    const runtimeEntry = buildRuntimeEntryFromVisibleState();
    const transcriptStore = getConversationLiveTranscriptStore(conversationId);
    let effective: ReturnType<typeof resolveEffectiveChatModelSelection>;
    try {
      effective = resolveEffectiveChatModelSelection({
        settings,
        conversationSelectedModel: runtimeEntry.selectedModel,
      });
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const { provider, providerId, model, selectedModel } = effective;
    const runtime = createProviderRuntimeConfig(provider, model, settings.chatRuntimeControls);
    const promptInputs = await resolvePromptInputs(runtimeEntry.workdir ?? "");
    if (isConversationRunning(conversationId)) {
      return { status: "busy", message: t("chat.manualCompactRejected") };
    }

    const cancellation = createTurnCancellation();
    let stopRequestVersion: number | null = null;
    const handleStop: StopHandler = (options) => {
      stopRequestVersion = options.requestVersion;
      cancellation.userStop.abort();
    };
    let failureMessage = "";
    const persistState = (state: ConversationRuntimeEntry["state"]) =>
      persistConversation({
        conversationId,
        sessionId: runtimeEntry.sessionId,
        providerId,
        model,
        selectedModel,
        cwd: runtimeEntry.workdir,
        state,
        fallbackTitle: t("chat.pendingTitle"),
        createdAt: runtimeEntry.createdAt,
        titlePromise: null,
      });
    const sinks: CompactionSinks = {
      applyState: (state) =>
        updateConversationRuntimeEntry(conversationId, (prev) => ({ ...prev, state })),
      applyStateMidRun: (state) => {
        updateConversationRuntimeEntry(conversationId, (prev) => ({ ...prev, state }));
        resetLiveTranscript(transcriptStore);
      },
      publishStatus: (status) => {
        if (status.phase === "failed") failureMessage = status.message;
        updateConversationRuntimeEntry(conversationId, (prev) => ({
          ...prev,
          compactionStatus: status,
        }));
      },
      setBridgeToolStatus: (status, isCompaction = false) => {
        updateToolStatus(status, transcriptStore);
        // The local bridge sink has no second state source; the flag is
        // intentionally consumed only by the existing transcript/tool-status path.
        void isCompaction;
      },
      persist: persistState,
      persistRollback: persistState,
    };

    setConversationSendingState(conversationId, true);
    setConversationStopHandler(conversationId, handleStop);
    setConversationAbortController(conversationId, cancellation.userStop);
    try {
      const controller = getCompactionController(conversationId);
      const outcome = await controller.compactManually(
        {
          providerId,
          model,
          runtime,
          cancellation,
          sinks,
          buildPreparedContext: (state, tools, options) =>
            buildPreparedConversationContext({
              state,
              tools,
              activeAgentPrompt,
              skillsPrompt: promptInputs.skillsPrompt,
              memoryPrompt: promptInputs.memoryPrompt,
              includeAbortedMessages: options?.includeAbortedMessages,
              includeUploadedFilesMetadata: options?.includeUploadedFilesMetadata,
            }),
          buildResumeContext: (state, resumeMessage, tools, options) =>
            buildResumeConversationContext({
              state,
              resumeMessage,
              tools,
              activeAgentPrompt,
              skillsPrompt: promptInputs.skillsPrompt,
              memoryPrompt: promptInputs.memoryPrompt,
              includeAbortedMessages: options?.includeAbortedMessages,
              includeUploadedFilesMetadata: options?.includeUploadedFilesMetadata,
            }),
        },
        runtimeEntry.state,
        undefined,
        { tools: runtimeEntry.state.meta.tools },
      );
      return mapOutcome(t, outcome, failureMessage);
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearConversationStopHandler(conversationId, handleStop);
      setConversationAbortController(conversationId, null);
      setConversationSendingState(conversationId, false);
      if (stopRequestVersion !== null) {
        consumeConversationStop(conversationId, stopRequestVersion);
      }
    }
  }, [
    activeAgentPrompt,
    buildRuntimeEntryFromVisibleState,
    clearConversationStopHandler,
    consumeConversationStop,
    currentConversationIdRef,
    getCompactionController,
    getConversationLiveTranscriptStore,
    isConversationRunning,
    persistConversation,
    resetLiveTranscript,
    resolvePromptInputs,
    setConversationAbortController,
    setConversationSendingState,
    setConversationStopHandler,
    settings,
    t,
    updateConversationRuntimeEntry,
    updateToolStatus,
  ]);
}
