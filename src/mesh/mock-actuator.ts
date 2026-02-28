import type { MeshForwardPayload } from "./types.js";

export type MockActuatorStateRecord = {
  targetRef: string;
  status: string;
  lastCommandId?: string;
  lastOperation?: string;
  lastParams?: Record<string, unknown>;
  updatedAtMs: number;
};

export type MockActuatorEvent = {
  targetRef: string;
  commandId?: string;
  operation: string;
  params?: Record<string, unknown>;
  trust?: MeshForwardPayload["trust"];
  appliedAtMs: number;
};

export class MockActuatorController {
  private state = new Map<string, MockActuatorStateRecord>();
  private history: MockActuatorEvent[] = [];
  private maxHistory: number;
  private log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
  };

  constructor(opts?: {
    maxHistory?: number;
    log?: {
      info?: (msg: string) => void;
      warn?: (msg: string) => void;
    };
  }) {
    this.maxHistory = Math.max(1, opts?.maxHistory ?? 100);
    this.log = opts?.log;
  }

  async handleForward(payload: MeshForwardPayload): Promise<void> {
    if (payload.channel !== "clawmesh") {
      return;
    }
    const command = payload.command;
    if (!command) {
      return;
    }
    if (!command.target?.ref?.startsWith("actuator:")) {
      return;
    }

    const targetRef = command.target.ref;
    const opName = command.operation.name;
    const params = command.operation.params;
    const appliedAtMs = Date.now();
    const status = this.deriveStatus(opName, params);

    this.state.set(targetRef, {
      targetRef,
      status,
      lastCommandId: command.commandId,
      lastOperation: opName,
      lastParams: params,
      updatedAtMs: appliedAtMs,
    });

    this.history.push({
      targetRef,
      commandId: command.commandId,
      operation: opName,
      params,
      trust: command.trust,
      appliedAtMs,
    });
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }

    this.log?.info?.(
      `mock-actuator: ${targetRef} <- ${opName} (${status}) commandId=${command.commandId.slice(0, 8)}…`,
    );
  }

  snapshot(params?: { targetRef?: string }) {
    const states = params?.targetRef
      ? [this.state.get(params.targetRef)].filter(Boolean)
      : [...this.state.values()];
    return {
      records: states.map((s) => ({ ...s })),
      history: this.history.map((h) => ({ ...h })),
    };
  }

  private deriveStatus(opName: string, params?: Record<string, unknown>): string {
    const op = opName.toLowerCase();
    if (op === "open" || op === "start" || op === "on" || op === "enable") {
      return "active";
    }
    if (op === "close" || op === "stop" || op === "off" || op === "disable") {
      return "inactive";
    }
    if (op === "set" && params && "state" in params && typeof params.state === "string") {
      return String(params.state);
    }
    return `command:${opName}`;
  }
}

type HandlerFn = (opts: {
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
}) => void | Promise<void>;
type GatewayRequestHandlers = Record<string, HandlerFn>;

export function createMockActuatorHandlers(deps: {
  controller: MockActuatorController;
}): GatewayRequestHandlers {
  return {
    "clawmesh.mock.actuator.state": async ({ params, respond }) => {
      const targetRef = typeof params?.targetRef === "string" ? params.targetRef : undefined;
      const snapshot = deps.controller.snapshot({ targetRef });
      respond(true, snapshot);
    },
  };
}

