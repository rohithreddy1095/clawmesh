import { describe, it, expect, vi } from "vitest";
import { createChatHandlers, type ChatHandlerDeps, type PiSessionLike } from "./chat-handlers.js";
import { UIBroadcaster } from "./ui-broadcaster.js";

function makeDeps(overrides: Partial<ChatHandlerDeps> = {}): ChatHandlerDeps {
  return {
    uiBroadcaster: new UIBroadcaster(),
    getPiSession: () => undefined,
    log: { info: () => {} },
    ...overrides,
  };
}

function makeRespond() {
  const calls: Array<{ ok: boolean; payload?: unknown; error?: any }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: any) => {
    calls.push({ ok, payload, error });
  };
  return { respond, calls };
}

function makeMockSession(overrides: Partial<PiSessionLike> = {}): PiSessionLike {
  return {
    approveProposal: vi.fn().mockResolvedValue({ taskId: "t-1", status: "approved" }),
    rejectProposal: vi.fn().mockReturnValue({ taskId: "t-1", status: "rejected" }),
    ...overrides,
  };
}

describe("chat.subscribe", () => {
  it("subscribes a socket and responds ok", () => {
    const broadcaster = new UIBroadcaster();
    const addSpy = vi.spyOn(broadcaster, "addSubscriber");
    const handlers = createChatHandlers(makeDeps({ uiBroadcaster: broadcaster }));
    const { respond, calls } = makeRespond();
    const mockSocket = { addEventListener: () => {} } as any;
    handlers["chat.subscribe"]({ params: {}, req: { _socket: mockSocket }, respond });
    expect(addSpy).toHaveBeenCalledWith(mockSocket);
    expect(calls[0].ok).toBe(true);
    expect(calls[0].payload).toEqual({ subscribed: true });
  });

  it("responds ok even without socket (graceful)", () => {
    const handlers = createChatHandlers(makeDeps());
    const { respond, calls } = makeRespond();
    handlers["chat.subscribe"]({ params: {}, respond });
    expect(calls[0].ok).toBe(true);
  });
});

describe("chat.proposal.approve", () => {
  it("returns INVALID_PARAMS when taskId missing", async () => {
    const handlers = createChatHandlers(makeDeps());
    const { respond, calls } = makeRespond();
    await handlers["chat.proposal.approve"]({ params: {}, respond });
    expect(calls[0].ok).toBe(false);
    expect(calls[0].error.code).toBe("INVALID_PARAMS");
  });

  it("returns NO_PLANNER when no session", async () => {
    const handlers = createChatHandlers(makeDeps());
    const { respond, calls } = makeRespond();
    await handlers["chat.proposal.approve"]({ params: { taskId: "t-1" }, respond });
    expect(calls[0].ok).toBe(false);
    expect(calls[0].error.code).toBe("NO_PLANNER");
  });

  it("approves a valid proposal", async () => {
    const session = makeMockSession();
    const handlers = createChatHandlers(makeDeps({ getPiSession: () => session }));
    const { respond, calls } = makeRespond();
    await handlers["chat.proposal.approve"]({ params: { taskId: "t-1" }, respond });
    expect(session.approveProposal).toHaveBeenCalledWith("t-1");
    expect(calls[0].ok).toBe(true);
    expect(calls[0].payload).toEqual({ proposal: { taskId: "t-1", status: "approved" } });
  });

  it("returns NOT_FOUND when proposal doesn't exist", async () => {
    const session = makeMockSession({ approveProposal: vi.fn().mockResolvedValue(null) });
    const handlers = createChatHandlers(makeDeps({ getPiSession: () => session }));
    const { respond, calls } = makeRespond();
    await handlers["chat.proposal.approve"]({ params: { taskId: "bad" }, respond });
    expect(calls[0].ok).toBe(false);
    expect(calls[0].error.code).toBe("NOT_FOUND");
  });
});

describe("chat.proposal.reject", () => {
  it("returns INVALID_PARAMS when taskId missing", () => {
    const handlers = createChatHandlers(makeDeps());
    const { respond, calls } = makeRespond();
    handlers["chat.proposal.reject"]({ params: {}, respond });
    expect(calls[0].ok).toBe(false);
    expect(calls[0].error.code).toBe("INVALID_PARAMS");
  });

  it("returns NO_PLANNER when no session", () => {
    const handlers = createChatHandlers(makeDeps());
    const { respond, calls } = makeRespond();
    handlers["chat.proposal.reject"]({ params: { taskId: "t-1" }, respond });
    expect(calls[0].ok).toBe(false);
    expect(calls[0].error.code).toBe("NO_PLANNER");
  });

  it("rejects a valid proposal", () => {
    const session = makeMockSession();
    const handlers = createChatHandlers(makeDeps({ getPiSession: () => session }));
    const { respond, calls } = makeRespond();
    handlers["chat.proposal.reject"]({ params: { taskId: "t-1" }, respond });
    expect(session.rejectProposal).toHaveBeenCalledWith("t-1");
    expect(calls[0].ok).toBe(true);
  });

  it("returns NOT_FOUND when proposal doesn't exist", () => {
    const session = makeMockSession({ rejectProposal: vi.fn().mockReturnValue(null) });
    const handlers = createChatHandlers(makeDeps({ getPiSession: () => session }));
    const { respond, calls } = makeRespond();
    handlers["chat.proposal.reject"]({ params: { taskId: "bad" }, respond });
    expect(calls[0].ok).toBe(false);
    expect(calls[0].error.code).toBe("NOT_FOUND");
  });
});

describe("createChatHandlers - structural", () => {
  it("returns exactly 3 handlers", () => {
    const handlers = createChatHandlers(makeDeps());
    expect(Object.keys(handlers)).toEqual([
      "chat.subscribe",
      "chat.proposal.approve",
      "chat.proposal.reject",
    ]);
  });
});
