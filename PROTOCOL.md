# ClawMesh Wire Protocol

**Version:** 1 (protocol generation `1`, handshake auth `v2`)
**Status:** Draft — normative for this repository as of 2026-07-05
**Audience:** implementers. This document is intended to be sufficient to
reimplement a ClawMesh node in any language without reading the TypeScript.

The key words MUST, MUST NOT, SHOULD, and MAY are to be interpreted as in
RFC 2119.

---

## 1. Scope and design intent

ClawMesh is a **control-plane** protocol for a small (2–10 node), explicitly
trust-gated mesh of heterogeneous devices. Its distinguishing mechanism is
**evidence provenance as first-class wire metadata that gates physical
actuation** (§8): every context frame and actuation command carries an
evidence trust tier, and tier gating is enforced by the protocol handlers on
both sender and receiver — not left as an application convention.

It is NOT a data plane. See §11 for explicit non-guarantees.

---

## 2. Transport

- **Carrier:** WebSocket (RFC 6455), text frames only. Every frame is one
  UTF-8 JSON document. No binary framing, no compression extensions.
- **Default port:** `18789`.
- **URL schemes:** `ws://` and `wss://`. Implementations MUST normalize
  `http://` → `ws://` and `https://` → `wss://` when reading peer URLs.
- **Message size:** receivers MUST reject messages larger than
  **1,048,576 bytes** (`TOO_LARGE`) and context-frame `data` larger than
  **524,288 bytes** (`DATA_TOO_LARGE`). Senders SHOULD stay well below both.
- **TLS pinning:** a `wss://` peer MAY be pinned with a SHA-256 certificate
  fingerprint. When a pin is configured, the client MUST verify the server
  certificate's `fingerprint256` equals the pin (normalized, case-insensitive
  hex, `:` separators ignored) and MUST abort on mismatch.
- **Security posture labels** (operator-visible, derived, not negotiated):
  `insecure` (ws://), `tls-unpinned` (wss:// without pin), `tls-pinned`
  (wss:// with pin).
- **Transport labels** (operator-declared, per static peer): e.g. `lan`,
  `local`, `mdns`, `relay`, `vpn`. Labels outside {`lan`, `local`, `mdns`}
  denote WAN-style links and MUST be configured with a TLS pin
  (`tls-pinned`); implementations MUST refuse to start otherwise.

## 3. Identity and trust prerequisites

- Each node holds a persistent **Ed25519** keypair.
- `deviceId` = SHA-256 of the **raw 32-byte** Ed25519 public key (not the
  PEM/SPKI encoding), lowercase hex.
- On the wire, public keys are the **raw 32-byte Ed25519 key,
  base64url-encoded** (no PEM framing).
- Signatures are Ed25519 over the UTF-8 bytes of the auth payload string
  (§5.2), base64url-encoded.
- **Trust is explicit.** A server MUST NOT accept `mesh.connect` from a
  `deviceId` absent from its local trust store, regardless of signature
  validity (`UNTRUSTED_PEER`). If the trust store pins a public key for that
  deviceId, a mismatching key MUST be rejected (`PUBLIC_KEY_MISMATCH`).
  If no key is pinned, the first successfully verified key MAY be accepted
  (trust-on-first-use for the key, never for the device).

## 4. Discovery

- **mDNS/DNS-SD service type:** `clawmesh` (i.e. `_clawmesh._tcp.local`).
- Advertised TXT records: `deviceId` (as §3), `version` (software version
  string). The service port is the node's WebSocket listen port.
- Browsers MUST ignore service records without `deviceId` and MUST ignore
  their own `deviceId`; `deviceId` is the identity used for the trust check
  before any discovered address is dialed.
- Discovery only *finds* peers. Connection eligibility is governed solely by
  the trust store (§3). Nodes MAY disable discovery entirely and use static
  peer configuration: `<deviceId>=<url>|<tlsFingerprint>|<transportLabel>`
  (fingerprint and label optional for local links; see §2 for WAN rules).
- **Dial tie-break (normative):** when two nodes discover each other, only
  the node with the lexicographically LOWER `deviceId` dials; the higher one
  waits for the inbound connection. If crossing connections race anyway,
  both registries MUST converge on the same survivor — the connection
  initiated by the lower `deviceId` — closing the loser with code 1000.
  A node whose outbound dial loses the tie-break MUST stand its dialer
  down rather than reconnect. (Without this rule, device-keyed session
  replacement makes crossing dials displace each other in a loop; observed
  on hardware 2026-07-05.) The tie-break applies to discovery-initiated
  dials only; statically configured peers always dial as configured.

## 5. Envelope

Exactly three frame types exist. Any other `type` MUST be rejected
(`INVALID_TYPE`).

### 5.1 Request / Response / Event

```jsonc
// Request
{ "type": "req", "id": "<unique string>", "method": "<name>", "params": { } }

// Response (correlated by id)
{ "type": "res", "id": "<same id>", "ok": true,  "payload": { } }
{ "type": "res", "id": "<same id>", "ok": false, "error": { "code": "<CODE>", "message": "<text>" } }

// Event (uncorrelated, fire-and-forget)
{ "type": "event", "event": "<name>", "payload": { } }
```

- `id` MUST be unique per in-flight request on a connection (UUIDv4
  recommended). Responders MUST echo it verbatim.
- Unknown methods MUST yield `ok:false` with code `UNKNOWN_METHOD`.
- Handler exceptions MUST yield `INTERNAL_ERROR`, never a dropped response.
- Events carry no delivery guarantee (§11).

### 5.2 Handshake (auth v2, mandatory)

A connection is unauthenticated until `mesh.connect` succeeds. Servers MUST
NOT dispatch any other method for the peer session before that (except
`mesh.challenge`).

**Sequence — three messages:**

```
Client                                    Server
  │  req mesh.challenge {}                  │
  │ ────────────────────────────────────▶  │  issue nonce N (single-use,
  │  res { nonce: N }                       │  bound to this connection,
  │ ◀────────────────────────────────────  │  TTL 60 s)
  │  req mesh.connect                       │
  │    { version: 2, deviceId, publicKey,   │  verify: N issued here, unused,
  │      signature, signedAtMs, nonce: N,   │  fresh; deviceId trusted; key
  │      clientNonce: C, displayName?,      │  matches pin; signature valid
  │      capabilities?, meshId?, role? }    │  over payload(§5.2.1, nonce=N)
  │ ────────────────────────────────────▶  │
  │  res { deviceId, publicKey, signature,  │  server signs payload with
  │        signedAtMs, nonce: C,            │  nonce = C (the CLIENT's nonce)
  │        displayName?, capabilities?,     │
  │        meshId?, role? }                 │
  │ ◀────────────────────────────────────  │
```

The client MUST verify the response signature over the payload built with
`nonce = C` and MUST verify `deviceId` equals the expected remote device.
Signing over `C` is what makes the server response non-replayable; signing
over `N` is what makes the client request non-replayable. Nonces are
single-use and connection-bound; a nonce presented on a different connection
MUST be rejected.

#### 5.2.1 Auth payload string (signed bytes)

```
mesh.connect|v2|<deviceId>|<signedAtMs>|<nonce>|<meshId>|<role>
```

- Exactly **seven fixed positions**, `|`-joined. Absent optional fields are
  the **empty string** — positions never shift.
- Every variable field is **URI-component-encoded** (RFC 3986 unreserved set
  passes through; `|` always encodes to `%7C`). A field value can therefore
  never be confused with a field boundary.
- `signedAtMs` is decimal milliseconds since epoch. Verifiers MUST reject
  |now − signedAtMs| > **300,000 ms** (5 min clock-drift window).

#### 5.2.2 Handshake error codes

| Code | Meaning |
|---|---|
| `INVALID_PARAMS` | missing required fields (incl. `clientNonce`) |
| `AUTH_NONCE_REQUIRED` | `mesh.connect` without a nonce |
| `AUTH_NONCE_INVALID` | nonce not issued for this connection, reused, or expired |
| `UNTRUSTED_PEER` | deviceId not in trust store |
| `PUBLIC_KEY_MISMATCH` | key differs from pinned key |
| `AUTH_FAILED` | signature or timestamp verification failed |
| `MESH_ID_MISMATCH` | both sides declare meshIds and they differ |

`version` in `mesh.connect` params is currently informational; servers do not
negotiate on it. (Generation-level evolution uses `gen`, §6.)

## 6. Protocol generation

Nodes and context frames carry an integer generation, currently **1**
(`gen: 1` on frames). Implementations MUST tolerate unknown *optional* fields
anywhere (forward compatibility) and SHOULD surface a generation mismatch to
operators rather than silently interoperating.

## 7. Context frames and gossip

### 7.1 Frame schema

Event name: `context.frame`.

```jsonc
{
  "gen": 1,
  "kind": "observation" | "event" | "human_input" | "inference"
        | "capability_update" | "agent_response",
  "frameId": "<UUID — global dedup key>",
  "sourceDeviceId": "<originator deviceId>",
  "sourceDisplayName": "optional",
  "timestamp": 1730000000000,          // originator wall clock, ms
  "data": { },                          // arbitrary; ≤ 512 KiB serialized
  "trust": {
    "evidence_sources": ["sensor"],     // §8.1
    "evidence_trust_tier": "T2_operational_observation"
  },
  "note": "optional human-readable",
  "hops": 0                             // 0 = originated on sourceDeviceId
}
```

`trust` is MANDATORY on every frame. Wire values are snake_case.
Producers MUST set the tier honestly by construction: frames created from
LLM output (`inference`, `agent_response`) MUST carry
`T0_planning_inference` and `evidence_sources: ["llm"]`; sensor observations
default to `T2` with `["sensor"]`; operator input carries `T3` with
`["human"]`.

### 7.2 Gossip rules (flood with hop limit)

On receiving `context.frame` from peer P:

1. If `frameId` already seen → drop (no re-forward). Seen-set: nodes SHOULD
   retain ≥ the most recent ~5,000 frameIds.
2. If `sourceDeviceId` is self → mark seen, drop.
3. Mark seen, ingest into local world model.
4. If `hops < 3`: increment `hops` and forward to every connected peer
   except P. If `hops ≥ 3`: ingest only.

Originators set `hops: 0`, mark their own frameId seen, and send to all
connected peers. Maximum propagation radius is therefore 4 edges from the
origin. There is no negative acknowledgment and no retransmission.

### 7.3 Anti-entropy: `context.sync`

Request/response catch-up for (re)joining nodes:

```jsonc
// req  context.sync
{ "since": 1730000000000, "limit": 50, "kind": "observation?", "zone": "z1?" }
// res
{ "frames": [ ...context frames... ], "peerTimestamp": 1730000000123,
  "totalAvailable": 240 }
```

- Server behavior: consider its most recent ≤ 500 frames, filter
  `timestamp > since` (and optional `kind` / `zone` where
  `zone` matches `data.zone`), cap the reply at min(limit, 500), returning
  the most recent when truncating.
- Reference client behavior: on each outbound peer connect, request
  `since = (latest local frame timestamp − 60 s)` bounded by a 1 h lookback,
  `limit 50`, timeout 10 s, best-effort (failure is logged, not fatal).
- **Convergence is therefore bounded, not guaranteed** (§11): a node offline
  longer than the lookback, or missing more frames than the caps, does not
  fully converge. `peerTimestamp` exists so clients can estimate clock skew;
  it is not currently used for correction.

## 8. Trust and actuation gating (normative core)

### 8.1 Vocabulary

Evidence trust tiers, totally ordered `T0 < T1 < T2 < T3`:

| Wire value | Meaning |
|---|---|
| `T0_planning_inference` | produced by LLM/planner reasoning alone |
| `T1_unverified_observation` | reported, not corroborated |
| `T2_operational_observation` | sensor/device telemetry in normal operation |
| `T3_verified_action_evidence` | verified outcome or direct human action |

Evidence sources: `llm`, `sensor`, `device`, `human`, `mixed`.
Verification requirements: `none`, `device`, `human`, `device_or_human`.
Action types: `communication`, `observation`, `actuation`.

Approval levels `L0`–`L3` are a **proposal-layer** vocabulary (L0 read-only,
L1 bounded auto-execute, L2 human approval required, L3 strongest
verification); on the wire they appear in proposal records, while enforcement
of "who may execute" is expressed through §8.2 metadata.

### 8.2 Command envelope v1

Actuation and other cross-node commands ride `mesh.message.forward` with an
embedded envelope:

```jsonc
{
  "version": 1,
  "kind": "clawmesh.command",
  "commandId": "<UUID>",
  "createdAtMs": 1730000000000,
  "source": { "nodeId": "opt", "role": "opt" },
  "target": { "kind": "capability" | "device" | "peer" | "task", "ref": "<id>" },
  "operation": { "name": "<verb>", "params": { } },
  "trust": {                                   // REQUIRED, all four:
    "action_type": "actuation",
    "evidence_trust_tier": "T2_operational_observation",
    "minimum_trust_tier": "T2_operational_observation",
    "verification_required": "human",
    "verification_satisfied": true,            // optional unless required≠none
    "evidence_sources": ["sensor", "human"],   // optional
    "approved_by": ["operator:rohith"]         // optional
  },
  "note": "optional audit note"
}
```

### 8.3 Receiver-side gate (MUST, in this order)

A receiver of `mesh.message.forward` MUST:

1. Reject missing `channel`/`to`/`originGatewayId` → `INVALID_PARAMS`.
2. Reject `originGatewayId == self` → `LOOP_DETECTED`.
3. If an envelope is present, validate it structurally → else
   `INVALID_COMMAND_ENVELOPE`. If top-level `trust` AND envelope `trust` are
   both present they MUST be canonically equal (keys sorted, arrays sorted)
   → else `TRUST_ENVELOPE_MISMATCH`. The envelope's trust is authoritative.
4. **Deny-by-default for actuator targets:** if `to` OR the envelope's
   `target.ref` begins with `actuator:`, then trust metadata MUST be present
   AND `action_type` MUST be `"actuation"` → else
   `ACTUATION_DECLARATION_REQUIRED`. A command cannot reach an actuator by
   declaring itself to be something else (or nothing at all).
5. Reject unknown tier / verification vocabulary → `INVALID_TRUST_POLICY`.
6. If `action_type == "actuation"`:
   a. `evidence_trust_tier`, `minimum_trust_tier`, and
      `verification_required` MUST all be present → else
      `TRUST_METADATA_REQUIRED`.
   b. If `evidence_sources` is non-empty and every entry is `"llm"` →
      **`LLM_ONLY_ACTUATION_BLOCKED`**, unconditionally. There is no
      override. This is the protocol's core safety invariant.
   c. `evidence_trust_tier ≥ minimum_trust_tier` → else
      `INSUFFICIENT_TRUST_TIER`.
   d. If `verification_required ≠ "none"`, then
      `verification_satisfied === true` → else `VERIFICATION_REQUIRED`.
7. Only then deliver, responding `{ messageId, channel }`; local delivery
   failure → `DELIVERY_FAILED`.

**Three independent enforcement points, by design:**
senders MUST apply this evaluation before transmitting (fail fast);
receivers MUST apply it in the forward handler; and actuator executors MUST
re-apply it against the envelope's own trust metadata immediately before
touching hardware, refusing (and counting the refusal for operator surfaces)
on any failure. No layer may assume another layer ran.

## 9. Capabilities and routing

- Capability IDs are colon-separated ASCII strings:
  `<kind>:<name>[:<subName>]` with kinds `channel`, `skill`, `actuator`,
  `sensor` (anything else parses as `custom`). Examples: `channel:telegram`,
  `actuator:pump:P1`, `llm:nanochat/nano`,
  `llm:google/gemini-3.1-pro-preview`.
- LLM capability IDs MUST be `llm:<provider>/<model-id>`, where
  `<provider>/<model-id>` is the exact model spec accepted by the local model
  resolver. A node MUST NOT advertise an `llm:` capability unless it has
  resolved the model locally and can serve `llm.infer` for that model.
- Advertised in `mesh.connect` (`capabilities: string[]`) and updated via
  `capability_update` context frames.
- Pattern matching: segment-wise equality; `*` in a pattern segment matches
  that segment and everything after (`actuator:*` matches `actuator:pump:P1`);
  otherwise segment counts must match exactly.
- Routing preference: local capability first; otherwise peers scored
  `health (healthy 10 / degraded 5 / unknown 3 / unhealthy 0) + 5 if exact
  string match`, highest score wins.
- Declared roles: `node`, `planner`, `field`, `sensor`, `actuator`, `viewer`,
  `standby-planner`.

## 10. Operational RPC surface

| Method | Params | Returns (summary) |
|---|---|---|
| `mesh.challenge` | `{}` | `{ nonce }` (§5.2) |
| `mesh.connect` | §5.2 | mutual-auth payload (§5.2) |
| `mesh.peers` | `{}` | `{ peers: [{deviceId, displayName?, outbound, capabilities, role?, transportLabel?, connectedAtMs}] }` |
| `mesh.status` | `{}` | local deviceId, peer summaries, planner activity/mode/model, discovery flag, configured static peers (with posture), pending proposals |
| `mesh.health` | `{}` | status `healthy\|degraded\|unhealthy`, uptime, peers, world-model sizes, capabilities, planner state, memory, metrics, version |
| `mesh.world.query` | `{ limit? ≤200, kind?, sourceDeviceId? }` | read-only world-model snapshot: `{ count, entries, frames, bySourceDeviceId, byKind, byTrustTier, peerTimestamp }` |
| `mesh.events` | `{ limit? ≤200, type?, sinceMs? }` | `{ events, summary, total }` — system event log |
| `mesh.trace` | `{ frameId? \| stage? \| {} }` | causal chains from the correlation tracker |
| `llm.infer` | §10.2.1 | streams `llm.chunk` events, then `{ requestId, finishReason, usage? }` |
| `llm.cancel` | `{ requestId }` | `{ requestId, cancelled: true }` if an in-flight stream was cancelled |
| `mesh.message.forward` | §8.2/§8.3 | `{ messageId, channel }` |
| `context.sync` | §7.3 | §7.3 |

Command-center/UI methods (`chat.subscribe`, `chat.proposal.approve`,
`chat.proposal.reject`, `operator.intent`) share the envelope (§5.1) but are
operator-surface contract, not peer-mesh contract; peers MUST NOT depend on
them.

### 10.1 World model query

`mesh.world.query` is an operator/RPC read of the local node's current world
model. It does not trigger gossip or anti-entropy and MUST NOT mutate the
world model. Returned `frames` are recent context frames in log order (oldest
to newest within the selected window) and MUST preserve `sourceDeviceId` and
`trust.evidence_trust_tier` exactly as ingested, so operator surfaces can
inspect provenance. `bySourceDeviceId`, `byKind`, and `byTrustTier` are
breakdowns over the returned frames, not over the entire retained history.

### 10.2 LLM inference RPC

LLM inference is a capability-forwarding control-plane RPC, not a context
frame type. A node that advertises `llm:<provider>/<model-id>` MUST serve
`llm.infer` for the matching `<provider>/<model-id>` model spec. The
concurrency cap is one active inference per node.

#### 10.2.1 `llm.infer` request/response

```jsonc
// req llm.infer
{
  "requestId": "<uuid>",
  "model": "provider/model-id",
  "messages": [
    { "role": "system", "content": "optional system prompt" },
    { "role": "user", "content": "prompt" }
  ],
  "maxTokens": 256,
  "temperature": 0.2
}

// event llm.chunk
{ "requestId": "<same uuid>", "seq": 0, "delta": "token text" }

// final res
{
  "requestId": "<same uuid>",
  "finishReason": "stop",
  "usage": { "inputTokens": 12, "outputTokens": 42 }
}
```

`messages[*].role` MUST be one of `system`, `user`, or `assistant`.
Responders MUST emit `llm.chunk` events with contiguous `seq` numbers
starting at 0 and MUST cap each `delta` at 8 KiB. The final RPC response is
sent only after all chunks have been emitted. `finishReason` is one of
`stop`, `length`, or `cancelled`.

Before sending each `llm.chunk`, the responder MUST inspect the WebSocket
`bufferedAmount`. If it exceeds 1 MiB, the responder MUST abort the stream
with `LLM_BACKPRESSURE`. This is stream abort, not flow control; the ClawMesh
wire remains a control plane and does not provide general backpressure (§11).

If no matching `llm:` capability/model is locally available, return
`LLM_MODEL_UNAVAILABLE`. If another inference is active, return `LLM_BUSY`.
The default server-side timeout is 120 s; timeout returns `LLM_TIMEOUT`.

#### 10.2.2 `llm.cancel`

`llm.cancel` takes `{ requestId }`. If the request is in flight, the responder
MUST stop producing chunks, complete the inference with final
`finishReason:"cancelled"`, and return `{ requestId, cancelled: true }` from
the cancel RPC. If no request is in flight, the responder returns
`LLM_CANCELLED` (idempotent callers MAY treat this as already gone).

#### 10.2.3 Provenance rule for inference output

`llm.chunk` events and `llm.infer` responses are transient RPC payloads. They
MUST NOT be ingested into the world model as observations by receivers. If a
caller wraps inference output into a context frame or command trust metadata,
the only legal evidence labeling is:

```jsonc
{
  "evidence_sources": ["llm"],
  "evidence_trust_tier": "T0_planning_inference"
}
```

This labeling MUST survive forwarding and gossip unchanged. Any actuation
command whose trust evidence sources are only `llm` remains hard-blocked by
`LLM_ONLY_ACTUATION_BLOCKED` at the sender gate, receiver forward handler, and
actuator executor (§8.3), regardless of which peer ran the model or how many
mesh hops carried the resulting context.

## 11. Explicit non-guarantees (read before claiming otherwise)

This protocol, as specified, does **not** provide:

- **Backpressure.** Sends are fire-and-forget; socket buffer growth is
  unmonitored. A slow peer degrades silently.
- **Delivery or ordering guarantees for events.** No acks, no retries, no
  sequence numbers. Request/response is at-most-once per request id.
- **Logical time.** Frame `timestamp` is originator wall clock; consumers
  MUST NOT assume cross-node monotonicity. There are no vector/Lamport
  clocks; last-write-wins semantics are by wall clock.
- **Guaranteed convergence.** Gossip is flood-with-hop-limit (radius 4);
  anti-entropy (§7.3) is single-shot, capped, and lookback-bounded.
- **Data-plane throughput.** JSON text frames, 1 MiB cap, no compression or
  binary encoding. Token streams and camera frames do not belong on this
  wire; advertise such endpoints as capabilities and move bulk data
  out-of-band.
- **Byzantine tolerance.** Trust gating assumes authenticated peers are
  honest about evidence metadata; a compromised *trusted* node can lie about
  tiers. The gate defends against LLM overreach and unauthenticated actors,
  not against malicious signed peers.

## 12. Error code registry

Handshake: `INVALID_PARAMS`, `AUTH_NONCE_REQUIRED`, `AUTH_NONCE_INVALID`,
`UNTRUSTED_PEER`, `PUBLIC_KEY_MISMATCH`, `AUTH_FAILED`, `MESH_ID_MISMATCH`.
Dispatch: `UNKNOWN_METHOD`, `INTERNAL_ERROR`.
Validation: `TOO_LARGE`, `DATA_TOO_LARGE`, `INVALID_JSON`, `MISSING_TYPE`,
`INVALID_TYPE`.
Forward/trust: `LOOP_DETECTED`, `INVALID_COMMAND_ENVELOPE`,
`TRUST_ENVELOPE_MISMATCH`, `INVALID_TRUST_POLICY`, `TRUST_METADATA_REQUIRED`,
`ACTUATION_DECLARATION_REQUIRED`, `LLM_ONLY_ACTUATION_BLOCKED`,
`INSUFFICIENT_TRUST_TIER`, `VERIFICATION_REQUIRED`, `DELIVERY_FAILED`.
LLM inference: `LLM_MODEL_UNAVAILABLE`, `LLM_BUSY`, `LLM_TIMEOUT`,
`LLM_BACKPRESSURE`, `LLM_CANCELLED`.

New codes MUST be added here before use.

## 13. Versioning and change policy

- Handshake auth format: versioned in the signed string (`v2`). Any change to
  field set, order, or encoding REQUIRES a version bump and a new section
  here.
- Frame/protocol evolution: bump the generation (§6) for changes that break
  frame interpretation; additive optional fields do not require a bump.
- This document is normative over the implementation: where the code and this
  spec disagree, one of them has a bug — file it, decide, and update both in
  the same change.

---

*Related documents: `CLAUDE.md` (project charter), `docs/ENGINEERING-LOG.md`
(dated design decisions / invention log),
`farm/bhoomi/governance/evidence-trust-policy-v0.yaml` (policy vocabulary
origin for the snake_case trust fields).*
