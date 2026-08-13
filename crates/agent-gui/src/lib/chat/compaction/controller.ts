import type { Context, Message, UserMessage } from "@earendil-works/pi-ai";
import { canManualCompact, contextUsageRatio } from "@liveagent/ui/lib/chat/contextUsage";

import type { StreamDebugLogger } from "../../debug/agentDebug";
import type { ProviderId } from "../../settings";
import { type ConversationViewState, getActiveSegment } from "../conversation/conversationState";
import type { TurnCancellation } from "../conversation/turnCancellation";
import type { PendingUploadedFile } from "../messages/uploadedFiles";
import { isAbortLikeError } from "../page/chatPageHelpers";
import { createSyntheticContinueUserMessage, runCompaction } from "./engine";
import {
  createCompactionPressure,
  decideCompaction,
  normalizeCompactionPressure,
  notePressureAfterCompaction,
  resolvePruneOptions,
  shouldPruneBeforeCompaction,
} from "./policy";
import { type PruneConversationResult, pruneConversationState } from "./prune";
import {
  buildCompactionRunningStatus,
  buildPruneFallbackStatus,
  PRUNE_FALLBACK_NOTICE,
} from "./statusText";
import { type CompleteAssistantFn, createCompactionAbortError } from "./summarizer";
import { getUsageTotalTokens, TokenLedger } from "./tokenLedger";
import { writeAssistantContextUsage } from "./contextUsageMetadata";
import type {
  CompactionDecision,
  CompactionDecisionReason,
  CompactionIntent,
  CompactionStatus,
  CompactionTrigger,
  ProviderRuntimeConfig,
} from "./types";

type ContextBuildOptions = {
  includeAbortedMessages?: boolean;
  includeUploadedFilesMetadata?: boolean;
};

// 所有副作用经由注入的 sinks：ChatPage 提供完整实现，子代理提供轻量子集。
// 全部可选——缺省即 no-op，controller 自身保持纯净可测。
export type CompactionSinks = {
  applyState?: (state: ConversationViewState) => void;
  // 运行中换底：apply + 清空 live transcript（压缩/prune 结果落地后旧流式内容已过期）。
  applyStateMidRun?: (state: ConversationViewState) => void;
  publishStatus?: (status: CompactionStatus) => void;
  setBridgeToolStatus?: (status: string | null, isCompaction?: boolean) => void;
  queueCheckpoint?: (state: ConversationViewState, contextUsageTokens?: number) => void;
  persist?: (state: ConversationViewState) => Promise<boolean | undefined>;
  restoreComposer?: (
    composerText: string | undefined,
    uploadedFiles: PendingUploadedFile[],
  ) => void;
  persistRollback?: (state: ConversationViewState) => Promise<unknown>;
};

export type CompactionPreSendBinding = {
  // 待 checkpoint 的基线状态（不含本轮待发送的用户消息）。
  baseState: ConversationViewState;
  pendingUserText: string;
  composerText?: string;
  uploadedFiles?: PendingUploadedFile[];
  // 压缩/prune 后如何得到要 apply 的最终状态（如重新附加待发送的用户消息）。
  composeAppliedState: (state: ConversationViewState) => ConversationViewState;
};

export type CompactionTurnBinding = {
  providerId: ProviderId;
  model: string;
  runtime: ProviderRuntimeConfig;
  cancellation: TurnCancellation;
  debugLogger?: StreamDebugLogger;
  complete?: CompleteAssistantFn;
  sinks: CompactionSinks;
  buildPreparedContext: (
    state: ConversationViewState,
    tools?: Context["tools"],
    options?: ContextBuildOptions,
  ) => Context;
  buildResumeContext: (
    state: ConversationViewState,
    resumeMessage?: UserMessage,
    tools?: Context["tools"],
    options?: ContextBuildOptions,
  ) => Context;
  presend?: CompactionPreSendBinding;
};

export type CompactionDuringRunResult = {
  context: Context | null;
  shouldDisableProtection: boolean;
  /** Explicit result for this invocation; never infer it from retained statusPhase. */
  outcome: "compacted" | "skipped" | "failed";
  reason?: CompactionDecisionReason;
};

export type ManualCompactionOutcome =
  | { status: "compacted" | "busy" }
  | { status: "failed"; aborted?: boolean }
  | { status: "skipped"; reason: CompactionDecisionReason };

export type ManualContextUsageSnapshot = {
  totalTokens?: number;
  fixedTokens?: number;
};

function withActiveSummaryContextTokens(
  state: ConversationViewState,
  contextUsageTokens: number,
): ConversationViewState {
  const segment = state.segments[state.activeSegmentIndex];
  if (!segment?.summary) return state;
  const nextSegment = {
    ...segment,
    summary: {
      ...segment.summary,
      summaryMeta: {
        ...segment.summary.summaryMeta,
        stats: {
          ...(segment.summary.summaryMeta.stats ?? {
            sourceMessageCount: segment.summary.summaryMeta.coveredMessageCount,
          }),
          contextTokensAfter: contextUsageTokens,
        },
      },
    },
  };
  const segments = state.segments.slice();
  segments[state.activeSegmentIndex] = nextSegment;
  return { ...state, segments };
}

type RollbackSnapshot = {
  state: ConversationViewState;
  composerText?: string;
  uploadedFiles?: PendingUploadedFile[];
  persistOnRollback?: boolean;
};

/**
 * 每会话压缩状态机。跨轮持有压力阶梯与 token 账本；每轮 bindTurn 注入
 * 运行时/sinks/取消链。单飞由 inFlight 保证；回滚快照是实例字段，所有
 * 终态都经 settle*() 收敛（状态发布与 bridge 状态清理成对，不再散落）。
 */
export class CompactionController {
  private pressure = createCompactionPressure();
  private readonly ledger = new TokenLedger();
  private readonly contextUsageListeners = new Set<() => void>();
  private binding: CompactionTurnBinding | null = null;
  private rollbackSnapshot: RollbackSnapshot | null = null;
  private inFlight = false;
  private statusPhase: CompactionStatus["phase"] = "idle";
  private turnMeta = { activeMessageCount: 0, userMessageCount: 0, lastSummaryAt: 0 };

  bindTurn(binding: CompactionTurnBinding) {
    this.binding = binding;
    this.rollbackSnapshot = null;
    this.inFlight = false;
  }

  unbindTurn() {
    this.binding = null;
    this.rollbackSnapshot = null;
    this.inFlight = false;
  }

  get stats() {
    return { compactionsApplied: this.pressure.compactionsApplied };
  }

  /** Read-only usage snapshot for host UI; compaction remains controller-owned. */
  get contextUsageTokens(): number | undefined {
    const total = this.ledger.total();
    return total > 0 ? total : undefined;
  }

  get contextUsageSnapshot() {
    const snapshot = this.ledger.snapshot();
    return snapshot.totalTokens > 0
      ? { totalTokens: snapshot.totalTokens, fixedTokens: snapshot.fixedTokens }
      : undefined;
  }

  subscribeContextUsage(listener: () => void) {
    this.contextUsageListeners.add(listener);
    return () => {
      this.contextUsageListeners.delete(listener);
    };
  }

  private notifyContextUsage() {
    for (const listener of this.contextUsageListeners) {
      listener();
    }
  }

  private rebaseLedger(context: Context) {
    this.ledger.rebase(context);
    this.notifyContextUsage();
  }

  private async persistCheckpoint(binding: CompactionTurnBinding, state: ConversationViewState) {
    const persisted = await binding.sinks.persist?.(state);
    if (persisted === false) {
      throw new Error("compaction checkpoint persistence failed");
    }
  }

  beginRequest(context: Context, state: ConversationViewState) {
    this.rebaseLedger(context);
    this.updateTurnMeta(state);
  }

  /**
   * Record authoritative assistant usage and advance the same ledger consumed
   * by compaction decisions and the read-only context ring. Render-only
   * messages may still be appended to the ledger as estimates, but only a real
   * provider usage value is persisted as a message anchor.
   */
  observeContextMessages(messages: readonly Message[]) {
    for (const message of messages) {
      if (message.role === "assistant") {
        const observedTokens = getUsageTotalTokens(message.usage);
        if (observedTokens !== undefined) {
          writeAssistantContextUsage(message, {
            totalTokens: observedTokens,
            fixedTokens: this.ledger.snapshot().fixedTokens,
          });
        }
      }
    }
    this.ledger.addMessages(messages);
    this.notifyContextUsage();
    return this.contextUsageTokens;
  }

  // O(1)：账本读数 + 流式增量估算 + 纯决策，无状态构建、无序列化。
  // pendingTokenUnits 由调用方按流式 delta 用 estimateTextTokenUnits 累加。
  shouldProtectMidStream(pendingTokenUnits: number): boolean {
    if (!this.binding || this.inFlight) return false;
    return this.decide("protection", this.ledger.totalWithPendingTokens(pendingTokenUnits))
      .shouldCompact;
  }

  async maybeCompactPreSend(params: {
    budgetContext: Context;
    tools?: Context["tools"];
    includeUploadedFilesMetadata?: boolean;
  }): Promise<boolean> {
    const binding = this.binding;
    const presend = binding?.presend;
    if (!binding || !presend) return false;
    if (binding.cancellation.userStop.signal.aborted) {
      throw createCompactionAbortError();
    }
    const now = Date.now();
    const buildOptions: ContextBuildOptions = {
      includeUploadedFilesMetadata: params.includeUploadedFilesMetadata,
    };

    let workingState = presend.baseState;
    let pruned: PruneConversationResult | null = null;
    if (shouldPruneBeforeCompaction(this.pressure, now)) {
      const attempt = pruneConversationState(workingState, resolvePruneOptions(this.pressure));
      if (attempt.applied) {
        pruned = attempt;
        workingState = attempt.state;
      }
    }

    const budgetContext = pruned
      ? binding.buildPreparedContext(workingState, params.tools, buildOptions)
      : params.budgetContext;
    this.rebaseLedger(budgetContext);
    this.updateTurnMeta(workingState);
    const decision = this.decide("optimization", this.ledger.total(), now);
    this.logDecision(decision);

    if (!decision.shouldCompact) {
      if (pruned) {
        binding.sinks.applyState?.(presend.composeAppliedState(pruned.state));
        return true;
      }
      return false;
    }

    this.rollbackSnapshot = {
      state: presend.baseState,
      composerText: presend.composerText,
      uploadedFiles: presend.uploadedFiles,
    };
    this.inFlight = true;
    this.publishRunning("pre-send", workingState.meta.activeSegmentIndex, decision);

    const scope = binding.cancellation.deriveScope();
    try {
      const outcome = await runCompaction({
        state: workingState,
        incomingUserText: presend.pendingUserText,
        intent: "optimization",
        contextTokens: decision.totalTokens,
        threshold: decision.threshold,
        providerId: binding.providerId,
        model: binding.model,
        runtime: binding.runtime,
        signal: scope.controller.signal,
        debugLogger: binding.debugLogger,
        complete: binding.complete,
      });

      const checkpointContext = binding.buildPreparedContext(
        outcome.state,
        params.tools,
        buildOptions,
      );
      this.rebaseLedger(checkpointContext);
      const checkpointState = withActiveSummaryContextTokens(
        outcome.state,
        this.contextUsageTokens ?? 0,
      );
      await this.persistCheckpoint(binding, checkpointState);
      this.rollbackSnapshot = null;
      const appliedCheckpointState = presend.composeAppliedState(checkpointState);
      binding.sinks.applyState?.(appliedCheckpointState);
      this.settleCompleted("pre-send", outcome.newSegmentIndex);
      binding.sinks.queueCheckpoint?.(checkpointState, this.contextUsageTokens);
      this.notePostCompactionPressure(
        binding.buildPreparedContext(appliedCheckpointState, params.tools, buildOptions),
        appliedCheckpointState,
        decision.threshold,
      );
      return true;
    } catch (error) {
      if (this.isAbortOutcome(scope.controller.signal, error)) {
        throw error;
      }
      this.rollbackSnapshot = null;
      const fallback =
        pruned ?? pruneConversationState(presend.baseState, resolvePruneOptions(this.pressure));
      if (fallback.applied) {
        binding.sinks.applyState?.(presend.composeAppliedState(fallback.state));
        this.settleFailed("pre-send", PRUNE_FALLBACK_NOTICE);
        binding.sinks.setBridgeToolStatus?.(buildPruneFallbackStatus(fallback.prunedMessageCount));
        return true;
      }
      console.warn("发送前上下文压缩失败，继续使用原始上下文", error);
      this.settleFailed("pre-send", error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      scope.release();
      this.inFlight = false;
      this.binding?.sinks.setBridgeToolStatus?.(null, false);
    }
  }

  async compactDuringRun(params: {
    trigger: Exclude<CompactionTrigger, "pre-send">;
    state: ConversationViewState;
    budgetContext?: Context;
    tools?: Context["tools"];
    includeAbortedMessages?: boolean;
    includeUploadedFilesMetadata?: boolean;
    /** Manual compaction may supply the already-observed ring value. */
    manualContextUsage?: ManualContextUsageSnapshot;
  }): Promise<CompactionDuringRunResult> {
    const binding = this.binding;
    if (!binding) {
      return { context: null, shouldDisableProtection: false, outcome: "skipped" };
    }
    // 覆盖"mid-stream abort 后、summarizer 启动前"用户恰好点停止的间隙。
    if (binding.cancellation.userStop.signal.aborted) {
      throw createCompactionAbortError();
    }
    const now = Date.now();
    const buildOptions: ContextBuildOptions = {
      includeAbortedMessages: params.includeAbortedMessages,
      includeUploadedFilesMetadata: params.includeUploadedFilesMetadata,
    };
    const buildFallbackContext = (state: ConversationViewState): Context => {
      if (params.trigger !== "mid-stream") {
        return binding.buildPreparedContext(state, params.tools, buildOptions);
      }
      const messages = getActiveSegment(state)?.messages ?? [];
      const lastTimestamp = messages[messages.length - 1]?.timestamp;
      const resumeMessage = createSyntheticContinueUserMessage(
        typeof lastTimestamp === "number" ? lastTimestamp + 1 : now,
      );
      return binding.buildResumeContext(state, resumeMessage, params.tools, {
        includeUploadedFilesMetadata: params.includeUploadedFilesMetadata,
      });
    };

    let workingState = params.state;
    let pruned: PruneConversationResult | null = null;
    // Manual compaction is an idle operation. Do not apply an unpersisted prune
    // fallback before or after it; the caller has no continuation turn to absorb
    // that state safely.
    if (params.trigger !== "manual" && shouldPruneBeforeCompaction(this.pressure, now)) {
      const attempt = pruneConversationState(workingState, resolvePruneOptions(this.pressure));
      if (attempt.applied) {
        pruned = attempt;
        workingState = attempt.state;
      }
    }

    const budgetContext =
      !pruned && params.budgetContext
        ? params.budgetContext
        : binding.buildPreparedContext(workingState, params.tools, buildOptions);
    this.rebaseLedger(budgetContext);
    this.updateTurnMeta(workingState);
    const manualTotalTokens =
      typeof params.manualContextUsage?.totalTokens === "number" &&
      Number.isFinite(params.manualContextUsage.totalTokens) &&
      params.manualContextUsage.totalTokens > 0
        ? Math.floor(params.manualContextUsage.totalTokens)
        : this.ledger.total();
    const intent: CompactionIntent = params.trigger === "manual" ? "optimization" : "protection";
    const decision =
      params.trigger === "manual"
        ? this.decideManual(manualTotalTokens, now)
        : this.decide(intent, this.ledger.total(), now);
    this.logDecision(decision);

    if (!decision.shouldCompact) {
      if (pruned) {
        binding.sinks.applyStateMidRun?.(pruned.state);
        return {
          context: buildFallbackContext(pruned.state),
          shouldDisableProtection: false,
          outcome: "skipped",
          reason: decision.reason,
        };
      }
      return params.trigger === "mid-stream"
        ? {
            context: buildFallbackContext(workingState),
            shouldDisableProtection: true,
            outcome: "skipped",
            reason: decision.reason,
          }
        : {
            context: null,
            shouldDisableProtection: false,
            outcome: "skipped",
            reason: decision.reason,
          };
    }

    this.rollbackSnapshot = { state: params.state, persistOnRollback: true };
    this.inFlight = true;
    this.publishRunning(params.trigger, workingState.meta.activeSegmentIndex, decision);

    const scope = binding.cancellation.deriveScope();
    try {
      const outcome = await runCompaction({
        state: workingState,
        intent,
        contextTokens: decision.totalTokens,
        threshold: decision.threshold,
        providerId: binding.providerId,
        model: binding.model,
        runtime: binding.runtime,
        signal: scope.controller.signal,
        debugLogger: binding.debugLogger,
        complete: binding.complete,
      });

      const checkpointContext = binding.buildPreparedContext(
        outcome.state,
        params.tools,
        buildOptions,
      );
      this.rebaseLedger(checkpointContext);
      const checkpointState = withActiveSummaryContextTokens(
        outcome.state,
        this.contextUsageTokens ?? 0,
      );
      await this.persistCheckpoint(binding, checkpointState);
      this.rollbackSnapshot = null;
      binding.sinks.applyStateMidRun?.(checkpointState);
      this.settleCompleted(params.trigger, outcome.newSegmentIndex);
      binding.sinks.queueCheckpoint?.(checkpointState, this.contextUsageTokens);

      const resumeMessage = createSyntheticContinueUserMessage(
        (outcome.checkpointMessage.timestamp ?? now) + 1,
      );
      const resumeContext = binding.buildResumeContext(outcome.state, resumeMessage, params.tools, {
        includeUploadedFilesMetadata: params.includeUploadedFilesMetadata,
      });
      const postCompactionContext =
        params.trigger === "manual"
          ? binding.buildPreparedContext(outcome.state, params.tools, buildOptions)
          : resumeContext;
      this.notePostCompactionPressure(postCompactionContext, outcome.state, decision.threshold);
      return {
        context: params.trigger === "manual" ? null : resumeContext,
        shouldDisableProtection: false,
        outcome: "compacted",
      };
    } catch (error) {
      if (this.isAbortOutcome(scope.controller.signal, error)) {
        throw error;
      }
      this.rollbackSnapshot = null;
      const fallback =
        params.trigger === "manual"
          ? null
          : pruned ?? pruneConversationState(workingState, resolvePruneOptions(this.pressure));
      if (fallback?.applied) {
        binding.sinks.applyStateMidRun?.(fallback.state);
        this.settleFailed(params.trigger, PRUNE_FALLBACK_NOTICE);
        binding.sinks.setBridgeToolStatus?.(buildPruneFallbackStatus(fallback.prunedMessageCount));
        return {
          context: buildFallbackContext(fallback.state),
          shouldDisableProtection: false,
          outcome: "failed",
        };
      }
      this.settleFailed(
        params.trigger,
        (error instanceof Error ? error.message : String(error)) || "压缩失败",
      );
      return params.trigger === "mid-stream"
        ? {
            context: buildFallbackContext(workingState),
            shouldDisableProtection: true,
            outcome: "failed",
          }
        : {
            context: null,
            shouldDisableProtection: false,
            outcome: "failed",
          };
    } finally {
      scope.release();
      this.inFlight = false;
      this.binding?.sinks.setBridgeToolStatus?.(null, false);
    }
  }

  /**
   * Idle, user-requested compaction. The controller temporarily owns the same
   * binding used by a normal turn, probes with a local ledger, then delegates
   * execution to compactDuringRun so status, persistence, rollback, and the
   * single-flight guard stay on one lifecycle.
   */
  async compactManually(
    binding: Omit<CompactionTurnBinding, "presend">,
    state: ConversationViewState,
    contextUsage?: ManualContextUsageSnapshot,
    options?: {
      tools?: Context["tools"];
      onProceed?: () => void;
    },
  ): Promise<ManualCompactionOutcome> {
    if (this.binding || this.inFlight) return { status: "busy" };

    this.bindTurn(binding);
    try {
      const probeLedger = new TokenLedger();
      probeLedger.rebase(binding.buildPreparedContext(state, options?.tools));
      this.updateTurnMeta(state);
      const suppliedTotal = contextUsage?.totalTokens;
      const totalTokens =
        typeof suppliedTotal === "number" && Number.isFinite(suppliedTotal) && suppliedTotal > 0
          ? Math.floor(suppliedTotal)
          : probeLedger.total();
      const decision = this.decideManual(totalTokens);
      this.logDecision(decision);
      if (!decision.shouldCompact) {
        return { status: "skipped", reason: decision.reason };
      }

      options?.onProceed?.();
      const result = await this.compactDuringRun({
        trigger: "manual",
        state,
        tools: options?.tools,
        manualContextUsage: contextUsage,
      });
      if (result.outcome === "compacted") return { status: "compacted" };
      if (result.outcome === "skipped") {
        return { status: "skipped", reason: result.reason ?? "disabled" };
      }
      return { status: "failed" };
    } catch (error) {
      const aborted =
        binding.cancellation.userStop.signal.aborted || isAbortLikeError(error);
      if (aborted) {
        await this.handleTurnAbort();
        return { status: "failed", aborted: true };
      }
      const message = error instanceof Error ? error.message : String(error);
      this.settleFailed("manual", message || "压缩失败");
      return { status: "failed" };
    } finally {
      this.unbindTurn();
    }
  }

  private decideManual(totalTokens: number, now = Date.now()) {
    const decision = this.decide("optimization", totalTokens, now, true);
    if (!decision.shouldCompact) return decision;
    if (canManualCompact(contextUsageRatio(decision.totalTokens, decision.contextWindow))) {
      return decision;
    }
    return { ...decision, shouldCompact: false, reason: "below-manual-threshold" as const };
  }

  // 用户中止后的统一善后：有快照则回滚（恢复状态/输入框/可选持久化）并返回 true。
  async handleTurnAbort(): Promise<boolean> {
    const binding = this.binding;
    const snapshot = this.rollbackSnapshot;
    this.rollbackSnapshot = null;
    this.inFlight = false;
    if (!binding) return false;

    if (!snapshot) {
      if (this.statusPhase === "running") {
        this.publishStatus({ phase: "idle" });
      }
      return false;
    }

    binding.sinks.applyStateMidRun?.(snapshot.state);
    binding.sinks.setBridgeToolStatus?.(null, false);
    this.publishStatus({ phase: "idle" });
    binding.sinks.restoreComposer?.(snapshot.composerText, snapshot.uploadedFiles ?? []);
    if (snapshot.persistOnRollback) {
      await binding.sinks.persistRollback?.(snapshot.state);
    }
    return true;
  }

  private updateTurnMeta(state: ConversationViewState) {
    const segment = getActiveSegment(state);
    const messages = segment?.messages ?? [];
    let userMessageCount = 0;
    for (const message of messages) {
      if (message.role === "user") userMessageCount += 1;
    }
    this.turnMeta = {
      activeMessageCount: messages.length,
      userMessageCount,
      lastSummaryAt: segment?.summary?.timestamp ?? 0,
    };
  }

  private decide(
    intent: CompactionIntent,
    totalTokens: number,
    now = Date.now(),
    bypassThresholdAndCooldown = false,
  ) {
    const binding = this.binding;
    if (!binding) {
      throw new Error("compaction decision requested without an active turn binding");
    }
    this.pressure = normalizeCompactionPressure(this.pressure, now);
    return decideCompaction({
      providerId: binding.providerId,
      intent,
      totalTokens,
      modelConfig: binding.runtime.modelConfig,
      activeMessageCount: this.turnMeta.activeMessageCount,
      userMessageCount: this.turnMeta.userMessageCount,
      lastCompactionAt: Math.max(this.turnMeta.lastSummaryAt, this.pressure.lastCompactionAt),
      pressure: this.pressure,
      inFlight: this.inFlight,
      now,
      bypassThresholdAndCooldown,
    });
  }

  private notePostCompactionPressure(
    contextAfter: Context,
    stateAfter: ConversationViewState,
    threshold: number,
  ) {
    this.rebaseLedger(contextAfter);
    this.updateTurnMeta(stateAfter);
    this.pressure = notePressureAfterCompaction(this.pressure, {
      totalTokensAfter: this.ledger.total(),
      threshold,
      now: Date.now(),
    });
  }

  private isAbortOutcome(scopeSignal: AbortSignal, error: unknown) {
    return (
      this.binding?.cancellation.userStop.signal.aborted ||
      scopeSignal.aborted ||
      isAbortLikeError(error)
    );
  }

  private publishStatus(status: CompactionStatus) {
    this.statusPhase = status.phase;
    this.binding?.sinks.publishStatus?.(status);
  }

  private publishRunning(
    trigger: CompactionTrigger,
    sourceSegmentIndex: number,
    decision: CompactionDecision,
  ) {
    this.publishStatus({
      phase: "running",
      trigger,
      startedAt: Date.now(),
      sourceSegmentIndex,
    });
    this.binding?.sinks.setBridgeToolStatus?.(
      buildCompactionRunningStatus(decision, this.pressure),
      true,
    );
  }

  private settleCompleted(trigger: CompactionTrigger, newSegmentIndex: number) {
    this.publishStatus({
      phase: "completed",
      trigger,
      newSegmentIndex,
      completedAt: Date.now(),
    });
  }

  private settleFailed(trigger: CompactionTrigger, message: string) {
    this.publishStatus({ phase: "failed", trigger, failedAt: Date.now(), message });
  }

  private logDecision(decision: CompactionDecision) {
    this.binding?.debugLogger?.logResult({
      event: "compaction_decision",
      intent: decision.intent,
      reason: decision.reason,
      shouldCompact: decision.shouldCompact,
      totalTokens: decision.totalTokens,
      threshold: decision.threshold,
      thresholdMode: decision.thresholdMode,
      contextWindow: decision.contextWindow,
      maxOutputToken: decision.maxOutputToken,
      pressure: this.pressure,
      ledger: this.ledger.snapshot(),
    });
  }
}

export type CompactionControllerRegistry = {
  get: (conversationId: string) => CompactionController;
  dispose: (conversationId: string) => void;
};

export function createCompactionControllerRegistry(): CompactionControllerRegistry {
  const controllers = new Map<string, CompactionController>();
  return {
    get(conversationId: string) {
      const key = conversationId.trim();
      const existing = controllers.get(key);
      if (existing) return existing;
      const created = new CompactionController();
      controllers.set(key, created);
      return created;
    },
    dispose(conversationId: string) {
      controllers.delete(conversationId.trim());
    },
  };
}
