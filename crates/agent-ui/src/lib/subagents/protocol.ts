/**
 * Subagent UI wire protocol.
 *
 * 本文件是 GUI/WebUI 的单一协议真源，必须保持零依赖；两端只依据这些随
 * tool_call/tool_result 传输的结构渲染子代理工具调用。
 */

export type SubagentProtocolMode = "readonly" | "worktree";
export type SubagentProtocolTaskType = "search" | "synthesis" | "routine";
export type SubagentProtocolStatus = "completed" | "failed" | "cancelled";
export type SubagentProtocolChannel = "direct" | "shared" | "decision" | "question";
export type SubagentLivePhase =
  | "queued"
  | "starting"
  | "model"
  | "responding"
  | "tool"
  | "settling"
  | "stalled";

export type SubagentCardLiveState = {
  phase: SubagentLivePhase;
  round?: number;
  toolCalls?: number;
  activeTool?: string;
  lastActivityAt?: number;
};

/** Final per-agent report embedded in cards and batch results. */
export type SubagentReportDetails = {
  id: string;
  runId: string;
  name: string;
  role?: string;
  prompt: string;
  taskType?: SubagentProtocolTaskType;
  templateId?: string;
  mode: SubagentProtocolMode;
  applyPolicy?: "none" | "explicit" | "auto";
  allowedOutputPaths?: string[];
  status: SubagentProtocolStatus;
  summary: string;
  durationMs: number;
  rounds: number;
  toolCalls: number;
  error?: string;
  persistenceWarnings?: string[];
  worktreeRoot?: string;
  workdir?: string;
  branchName?: string;
  changed?: boolean;
  statusText?: string;
  diffStat?: string;
  diff?: string;
  diffTruncated?: boolean;
  untrackedFiles?: string[];
  worktreeStatusError?: string;
  applyStatus?: "applied" | "skipped" | "failed";
  applyMethod?: "git_apply" | "git_apply_3way" | "file_copy_fallback";
  applyChanged?: boolean;
  applyPatchBytes?: number;
  applySkippedReason?: string;
  applyFallbackReason?: string;
  applyCopiedFiles?: string[];
  applyDeletedFiles?: string[];
  applyConflictFiles?: string[];
  applyError?: string;
  appliedToWorkdir?: string;
  worktreeCleanupStatus?: "removed" | "retained" | "skipped" | "failed";
  worktreeCleanupReason?: string;
  worktreeCleanupError?: string;
  worktreeBranchDeleted?: boolean;
  candidateArtifacts?: string[];
  changedPaths?: string[];
};

export type SubagentBatchIssue = {
  agentId?: string;
  code: string;
  message: string;
};

export type SubagentRosterEntry = {
  id: string;
  name: string;
  role: string;
  lastMode: SubagentProtocolMode;
  lastStatus?: string;
  lastSummary?: string;
};

export type SubagentTemplateEntry = {
  id: string;
  name: string;
  description?: string;
};

/** Aggregate result of one Agent tool call. */
export type SubagentBatchDetails = {
  kind: "subagent_batch";
  status: "ok" | "rejected";
  agentCount: number;
  concurrency: number;
  totalDurationMs: number;
  mode: "readonly" | "worktree" | "mixed";
  agents: SubagentReportDetails[];
  issues?: SubagentBatchIssue[];
  roster?: SubagentRosterEntry[];
  templates?: SubagentTemplateEntry[];
};

/** Per-agent live card result, fanned out from one Agent tool call. */
export type SubagentCardDetails = {
  kind: "subagent_card";
  parentToolCallId: string;
  index: number;
  total: number;
  concurrency: number;
  agent: SubagentReportDetails;
};

/** SendMessage tool result payload. */
export type SubagentMessageDetails = {
  kind: "subagent_message";
  parentConversationId: string;
  seq: number;
  senderId: string;
  senderName?: string;
  recipientId: string;
  recipientName?: string;
  channel: SubagentProtocolChannel;
  subject?: string;
  sourceRunId?: string;
  sourceToolCallId?: string;
  bodyPreview: string;
};

/**
 * Synthetic-card tool-call arguments. Cards use tool name "Agent" and the
 * `subagent_card: true` flag so both frontends can tell them apart from the
 * (suppressed) parent Agent call. `index` is 1-based for display.
 */
export type SubagentCardArguments = {
  subagent_card: true;
  parent_tool_call_id: string;
  index: number;
  total: number;
  concurrency?: number;
  id: string;
  name?: string;
  role?: string;
  mode?: SubagentProtocolMode;
  task_type?: SubagentProtocolTaskType;
  prompt?: string;
  phase?: SubagentLivePhase;
  round?: number;
  tool_calls?: number;
  active_tool?: string;
  last_activity_at?: number;
};

export function buildSubagentCardToolCallId(parentToolCallId: string, displayIndex: number) {
  return `${parentToolCallId}:agent:${displayIndex}`;
}

export function isSubagentCardArguments(value: unknown): value is SubagentCardArguments {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.subagent_card === true && typeof record.id === "string";
}

const SUBAGENT_LIVE_PHASES = new Set<SubagentLivePhase>([
  "queued",
  "starting",
  "model",
  "responding",
  "tool",
  "settling",
  "stalled",
]);

function optionalNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

/** Parse the mutable progress snapshot carried by a live synthetic card call. */
export function readSubagentCardLiveState(value: unknown): SubagentCardLiveState | null {
  if (!isSubagentCardArguments(value)) return null;
  const phase = value.phase;
  if (typeof phase !== "string" || !SUBAGENT_LIVE_PHASES.has(phase as SubagentLivePhase)) {
    return null;
  }
  return {
    phase: phase as SubagentLivePhase,
    round: optionalNonNegativeInteger(value.round),
    toolCalls: optionalNonNegativeInteger(value.tool_calls),
    activeTool:
      typeof value.active_tool === "string" && value.active_tool.trim()
        ? value.active_tool.trim()
        : undefined,
    lastActivityAt: optionalNonNegativeInteger(value.last_activity_at),
  };
}
