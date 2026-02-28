import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MeshDiscovery } from "./discovery.js";

vi.mock("@homebridge/ciao", () => {
  const browser = {
    on: vi.fn(),
    start: vi.fn(),
  };
  const service = {
    advertise: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  };
  const responder = {
    createService: vi.fn(() => service),
    createServiceBrowser: vi.fn(() => browser),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
  return {
    default: {
      getResponder: vi.fn(() => responder),
    },
  };
});

describe("MeshDiscovery", () => {
  let discovery: MeshDiscovery;

  beforeEach(() => {
    discovery = new MeshDiscovery({
      localDeviceId: "local-device",
      localPort: 18789,
    });
  });

  afterEach(() => {
    discovery.stop();
  });

  it("creates a discovery instance", () => {
    expect(discovery).toBeDefined();
  });
});
