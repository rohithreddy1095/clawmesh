/**
 * Gateway connect tests — connection error handling and option validation.
 */

import { describe, it, expect, vi } from "vitest";
import { connectToGateway, type GatewayConnectOptions } from "./gateway-connect.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTempIdentity() {
  const dir = mkdtempSync(join(tmpdir(), "gw-connect-test-"));
  return loadOrCreateDeviceIdentity(join(dir, "device.json"));
}

describe("connectToGateway", () => {
  it("returns error for unreachable server", async () => {
    const result = await connectToGateway({
      url: "ws://127.0.0.1:19996",
      identity: makeTempIdentity(),
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns error on timeout", async () => {
    // Connect to a port that accepts but doesn't respond — use a very short timeout
    const result = await connectToGateway({
      url: "ws://127.0.0.1:19995",
      identity: makeTempIdentity(),
      timeoutMs: 200, // Very short timeout
    });

    expect(result.ok).toBe(false);
    // Either connection error or timeout
    expect(result.error).toBeTruthy();
  });

  it("accepts password auth option", async () => {
    const opts: GatewayConnectOptions = {
      url: "ws://127.0.0.1:19994",
      identity: makeTempIdentity(),
      password: "secret123",
      timeoutMs: 200,
    };

    const result = await connectToGateway(opts);
    expect(result.ok).toBe(false); // Can't connect but should not crash
  });

  it("accepts token auth option", async () => {
    const result = await connectToGateway({
      url: "ws://127.0.0.1:19993",
      identity: makeTempIdentity(),
      token: "bearer-token-abc",
      timeoutMs: 200,
    });

    expect(result.ok).toBe(false);
  });

  it("accepts custom role and scopes", async () => {
    const result = await connectToGateway({
      url: "ws://127.0.0.1:19992",
      identity: makeTempIdentity(),
      role: "admin",
      scopes: ["mesh:connect", "mesh:forward"],
      timeoutMs: 200,
    });

    expect(result.ok).toBe(false);
  });

  it("accepts custom display name", async () => {
    const result = await connectToGateway({
      url: "ws://127.0.0.1:19991",
      identity: makeTempIdentity(),
      displayName: "my-gateway-client",
      timeoutMs: 200,
    });

    expect(result.ok).toBe(false);
  });

  it("accepts custom logger", async () => {
    const logMessages: string[] = [];
    const result = await connectToGateway({
      url: "ws://127.0.0.1:19990",
      identity: makeTempIdentity(),
      timeoutMs: 200,
      log: {
        info: (msg) => logMessages.push(msg),
        warn: (msg) => logMessages.push(msg),
        error: (msg) => logMessages.push(msg),
      },
    });

    expect(result.ok).toBe(false);
  });

  it("result fields are undefined on connection failure", async () => {
    const result = await connectToGateway({
      url: "ws://127.0.0.1:19989",
      identity: makeTempIdentity(),
      timeoutMs: 200,
    });

    expect(result.server).toBeUndefined();
    expect(result.protocol).toBeUndefined();
    expect(result.methods).toBeUndefined();
    expect(result.ws).toBeUndefined();
  });
});
