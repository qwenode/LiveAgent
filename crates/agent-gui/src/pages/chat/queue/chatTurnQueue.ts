import type { MentionComposerDraft } from "@liveagent/ui/components/chat/MentionComposer";
import type {
  PendingUploadedFile,
  UploadedUserMessage,
} from "../../../lib/chat/messages/uploadedFiles";
import type { ChatRuntimeControls, ExecutionMode } from "../../../lib/settings";
import type {
  GatewayChatRuntimeControlsEvent,
  GatewaySelectedModelEvent,
} from "../gateway/gatewayBridgeTypes";

export type QueuedGatewayChatRequest = {
  requestId: string;
  clientRequestId?: string;
  workerId?: string;
  queuePolicy?: "auto" | "append" | "interrupt" | "steer";
  selectedModel?: GatewaySelectedModelEvent;
  runtimeControls?: GatewayChatRuntimeControlsEvent;
  skillPresetId?: string;
  skillsDisabled?: boolean;
};

export type QueuedChatTurnDelivery = "after-run" | "next-turn";
export type QueuedChatTurnStatus = "waiting" | "delivering";

export type QueuedChatTurn = {
  id: string;
  conversationId: string;
  delivery: QueuedChatTurnDelivery;
  status: QueuedChatTurnStatus;
  draft: MentionComposerDraft;
  uploadedFiles: PendingUploadedFile[];
  userMessage?: UploadedUserMessage;
  targetRunToken?: string;
  executionMode: ExecutionMode;
  workdir: string;
  runtimeControls: ChatRuntimeControls;
  createdAt: number;
  gatewayRequest?: QueuedGatewayChatRequest;
};

export type ChatQueueItemSummary = {
  id: string;
  previewText: string;
  fileCount: number;
  createdAt: number;
  source: "gui" | "webui";
  editable: boolean;
};

export type ChatQueueSnapshot = {
  conversationId: string;
  revision: number;
  items: ChatQueueItemSummary[];
};

export type ChatQueueItemDetail = ChatQueueItemSummary & {
  draftJson: string;
  uploadedFilesJson: string;
};

export type QueuedChatTurnInput = Omit<
  QueuedChatTurn,
  "createdAt" | "id" | "delivery" | "status"
> & {
  delivery?: QueuedChatTurnDelivery;
  status?: QueuedChatTurnStatus;
  createdAt?: number;
  id?: string;
};

export type QueuedChatTurnEditSlot = {
  conversationId: string;
  previousId: string | null;
  nextId: string | null;
  index?: number;
};

function cloneUploadedUserMessage(message: UploadedUserMessage | undefined) {
  if (!message) return undefined;
  const cloned = { ...message } as UploadedUserMessage & Record<string, unknown>;
  for (const [key, value] of Object.entries(cloned)) {
    if (!Array.isArray(value)) continue;
    cloned[key] = value.map((item) =>
      item && typeof item === "object" ? { ...(item as Record<string, unknown>) } : item,
    );
  }
  return cloned as UploadedUserMessage;
}

export function createQueuedChatTurn(input: QueuedChatTurnInput): QueuedChatTurn {
  const createdAt = input.createdAt ?? Date.now();
  return {
    id: input.id?.trim() || `queued-chat-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId: input.conversationId.trim(),
    delivery: input.delivery ?? "after-run",
    status: input.status ?? "waiting",
    draft: input.draft,
    uploadedFiles: input.uploadedFiles.map((file) => ({ ...file })),
    userMessage: cloneUploadedUserMessage(input.userMessage),
    targetRunToken: input.targetRunToken?.trim() || undefined,
    executionMode: input.executionMode,
    workdir: input.workdir.trim(),
    runtimeControls: { ...input.runtimeControls },
    createdAt,
    gatewayRequest: input.gatewayRequest ? { ...input.gatewayRequest } : undefined,
  };
}

export function queuedChatTurnHasContent(
  draft: MentionComposerDraft | null | undefined,
  uploadedFiles: readonly PendingUploadedFile[],
): draft is MentionComposerDraft {
  return Boolean(draft && (!draft.isEmpty || draft.text.trim() || uploadedFiles.length > 0));
}

export function isNextTurnQueuedChatTurn(item: QueuedChatTurn) {
  return item.delivery === "next-turn";
}

export function isAfterRunQueuedChatTurn(item: QueuedChatTurn) {
  return item.delivery === "after-run";
}

export function isQueuedChatTurnDelivering(item: QueuedChatTurn) {
  return isNextTurnQueuedChatTurn(item) && item.status === "delivering";
}

export function isQueuedChatTurnMutable(item: QueuedChatTurn) {
  return !isQueuedChatTurnDelivering(item);
}

export function buildQueuedChatTurnPreview(draft: MentionComposerDraft) {
  const parts = draft.segments.map((segment) => {
    switch (segment.type) {
      case "largePaste":
        return segment.paste.label;
      case "skillMention":
        return `/${segment.skill.name}`;
      case "commitMention":
        return segment.commit.subject || segment.commit.shortSha || segment.commit.sha;
      case "gitFileMention":
        return segment.file.path;
      case "codeMention":
        return `${segment.reference.path}:${segment.reference.startLine}~${segment.reference.endLine}`;
      case "fileMention":
        return segment.reference.path;
      case "text":
        return segment.text;
    }
    return "";
  });
  return parts.join("").replace(/\s+/g, " ").trim() || draft.text.replace(/\s+/g, " ").trim();
}

function withoutTurn(queue: readonly QueuedChatTurn[], id: string) {
  const key = id.trim();
  return queue.filter((item) => item.id !== key);
}

export function appendQueuedChatTurn(
  queue: readonly QueuedChatTurn[],
  item: QueuedChatTurn,
): QueuedChatTurn[] {
  return [...withoutTurn(queue, item.id), item];
}

export function prependQueuedChatTurn(
  queue: readonly QueuedChatTurn[],
  item: QueuedChatTurn,
): QueuedChatTurn[] {
  return [item, ...withoutTurn(queue, item.id)];
}

export function resolveQueuedChatTurnSlotIndex(
  queue: readonly QueuedChatTurn[],
  slot: QueuedChatTurnEditSlot,
) {
  const compactQueue = queue.slice();
  const nextIndex = slot.nextId ? compactQueue.findIndex((item) => item.id === slot.nextId) : -1;
  if (nextIndex >= 0) return nextIndex;

  const previousIndex = slot.previousId
    ? compactQueue.findIndex((item) => item.id === slot.previousId)
    : -1;
  if (previousIndex >= 0) return previousIndex + 1;

  if (Number.isInteger(slot.index) && slot.index !== undefined && slot.index >= 0) {
    let scopedIndex = 0;
    let lastConversationIndex = -1;
    for (let index = 0; index < compactQueue.length; index += 1) {
      if (compactQueue[index]?.conversationId !== slot.conversationId) continue;
      if (scopedIndex >= slot.index) return index;
      scopedIndex += 1;
      lastConversationIndex = index;
    }
    if (lastConversationIndex >= 0) return lastConversationIndex + 1;
  }

  const firstConversationIndex = compactQueue.findIndex(
    (item) => item.conversationId === slot.conversationId,
  );
  if (firstConversationIndex >= 0) return firstConversationIndex;
  return compactQueue.length;
}

export function insertQueuedChatTurnAtSlot(
  queue: readonly QueuedChatTurn[],
  item: QueuedChatTurn,
  slot: QueuedChatTurnEditSlot,
): QueuedChatTurn[] {
  const next = withoutTurn(queue, item.id);
  const index = resolveQueuedChatTurnSlotIndex(next, slot);
  return [...next.slice(0, index), item, ...next.slice(index)];
}

export function removeQueuedChatTurn(
  queue: readonly QueuedChatTurn[],
  id: string,
): QueuedChatTurn[] {
  return withoutTurn(queue, id);
}

export function removeQueuedChatTurnsForConversation(
  queue: readonly QueuedChatTurn[],
  conversationId: string,
): QueuedChatTurn[] {
  const key = conversationId.trim();
  if (!key) return queue.slice();
  return queue.filter((item) => item.conversationId !== key);
}

export function moveQueuedChatTurn(
  queue: readonly QueuedChatTurn[],
  id: string,
  direction: "up" | "down",
): QueuedChatTurn[] {
  const key = id.trim();
  const index = queue.findIndex((item) => item.id === key);
  if (index < 0) return queue.slice();
  const item = queue[index];
  if (!item || !isQueuedChatTurnMutable(item)) return queue.slice();
  let swapIndex = index;
  while (true) {
    swapIndex = direction === "up" ? swapIndex - 1 : swapIndex + 1;
    if (swapIndex < 0 || swapIndex >= queue.length) return queue.slice();
    const candidate = queue[swapIndex];
    if (candidate?.conversationId !== item.conversationId) continue;
    if (!isQueuedChatTurnMutable(candidate)) return queue.slice();
    break;
  }
  if (swapIndex < 0 || swapIndex >= queue.length) return queue.slice();
  const next = queue.slice();
  [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  return next;
}

export function promoteQueuedChatTurn(
  queue: readonly QueuedChatTurn[],
  id: string,
): QueuedChatTurn[] {
  const key = id.trim();
  const item = queue.find((candidate) => candidate.id === key);
  if (!item) return queue.slice();
  return prependQueuedChatTurn(queue, item);
}

export function takeNextAfterRunQueuedChatTurn(
  queue: readonly QueuedChatTurn[],
  conversationId: string,
): { item: QueuedChatTurn | null; queue: QueuedChatTurn[] } {
  const key = conversationId.trim();
  if (!key) return { item: null, queue: queue.slice() };
  const index = queue.findIndex(
    (item) => item.conversationId === key && isAfterRunQueuedChatTurn(item),
  );
  if (index < 0) return { item: null, queue: queue.slice() };
  const next = queue.slice();
  const [item] = next.splice(index, 1);
  return { item: item ?? null, queue: next };
}

export function takeNextQueuedChatTurn(
  queue: readonly QueuedChatTurn[],
  conversationId: string,
): { item: QueuedChatTurn | null; queue: QueuedChatTurn[] } {
  return takeNextAfterRunQueuedChatTurn(queue, conversationId);
}

export function findNextWaitingNextTurnQueuedChatTurn(
  queue: readonly QueuedChatTurn[],
  conversationId: string,
) {
  const key = conversationId.trim();
  if (!key) return null;
  return (
    queue.find(
      (item) =>
        item.conversationId === key &&
        isNextTurnQueuedChatTurn(item) &&
        item.status === "waiting",
    ) ?? null
  );
}

export function updateQueuedChatTurn(
  queue: readonly QueuedChatTurn[],
  id: string,
  patch: Partial<Pick<QueuedChatTurn, "status" | "userMessage" | "targetRunToken">>,
): QueuedChatTurn[] {
  const key = id.trim();
  if (!key) return queue.slice();
  let changed = false;
  const next = queue.map((item) => {
    if (item.id !== key) return item;
    changed = true;
    const hasTargetRunToken = Object.prototype.hasOwnProperty.call(patch, "targetRunToken");
    return {
      ...item,
      ...patch,
      targetRunToken: hasTargetRunToken
        ? patch.targetRunToken?.trim() || undefined
        : item.targetRunToken,
    };
  });
  return changed ? next : queue.slice();
}

export function getQueuedConversationIds(queue: readonly QueuedChatTurn[]) {
  return Array.from(new Set(queue.map((item) => item.conversationId).filter(Boolean)));
}
