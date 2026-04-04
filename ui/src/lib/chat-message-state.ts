import type { ChatMessage } from "./store";

function isTransientStatus(status: ChatMessage["status"]): status is "queued" | "thinking" {
  return status === "queued" || status === "thinking";
}

function isTerminalStatus(status: ChatMessage["status"]): status is "complete" | "error" {
  return status === "complete" || status === "error";
}

export function mergeChatMessages(chatMessages: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (chatMessages.some((existing) => existing.id === msg.id)) {
    return chatMessages;
  }

  if (msg.status === "queued") {
    const existingTransient = chatMessages.find(
      (existing) => existing.conversationId === msg.conversationId && isTransientStatus(existing.status),
    );
    return existingTransient ? chatMessages : [...chatMessages, msg];
  }

  if (msg.status === "thinking") {
    const filtered = chatMessages.filter(
      (existing) => !(existing.conversationId === msg.conversationId && isTransientStatus(existing.status)),
    );
    return [...filtered, msg];
  }

  if (isTerminalStatus(msg.status)) {
    const filtered = chatMessages.filter(
      (existing) => !(existing.conversationId === msg.conversationId && isTransientStatus(existing.status)),
    );
    return [...filtered, msg];
  }

  return [...chatMessages, msg];
}
