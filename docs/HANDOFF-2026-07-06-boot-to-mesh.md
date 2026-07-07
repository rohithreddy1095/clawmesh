# Handoff: Phase 3 — boot-to-mesh (the appliance phase)

For: long-running implementation agent sessions. Read `CLAUDE.md`, this
file, `PROTOCOL.md`, the 2026-07-05 engineering-log entries (Phase 2 +
review), and `scripts/README.md` before any code. `docs/OVERSIGHT.md`
governs review; never edit it. This file contains no credentials.

## Where things stand (reviewed 2026-07-05, tag checkpoint-20260705-phase2-reviewed)

Phase 2 is accepted: mDNS discovery works both ways on real hardware
(mesh forms with zero `--peer` flags), CLI tells the truth, `llm.infer`
streams cross-hardware with T0 provenance enforced, dial tie-break
(PROTOCOL.md §4) prevents crossing-dial churn. Canary GREEN 3/3 on
hardware. Suites: 143 files / 2233 tests; `tsc --noEmit` clean.

**Phase 2 residuals — DO NOT attempt from a sandbox; they need the real
LAN and are reserved for the review session:** N=3 measurements on
hardware; real-model (nanochat) serving on the Jetson.

## The phase mission

Turn a ClawMesh node from an engineer-started process into an appliance:
power a device on and it loads its config, discovers the network, joins
the meshes it has been paired into, and serves its capabilities — with
the trust story intact at every step. This is "Bluetooth for agents"
made literal: pairing ceremony, remembered networks, auto-join,
service lifecycle.

The invariant is unchanged and outranks every feature: provenance-gated
actuation; LLM-only evidence never actuates; discovery and auto-join
never bypass trust.

Slices in order. Every slice: spec-first (PROTOCOL.md same commit or
earlier), Red/Green, full gate `pnpm exec vitest run src/mesh/
src/agents/ src/cli/` + `pnpm exec tsc --noEmit`, live-verify on
`scripts/local-mesh.sh`, canary before commit, dated log entry.
All five slices are fully verifiable on localhost.

---

## Slice 1 — Node config file

`clawmesh start` currently needs six flags to be a field node. An
appliance boots from persisted config.

**Decisions (do not reopen):**
- File: `<state-dir>/node.json` (state dir = `CLAWMESH_STATE_DIR` or
  `~/.clawmesh`). Shape (all optional, exact keys):
  ```json
  {
    "name": "jetson-field-01",
    "role": "field",
    "port": 18789,
    "host": "0.0.0.0",
    "meshName": "bhoomi",
    "discovery": true,
    "capabilities": [],
    "mockSensor": false,
    "mockActuator": false,
    "serveLlm": [],
    "staticPeers": ["<deviceId>=<url>"]
  }
  ```
- Precedence: CLI flag > node.json > built-in default. A flag explicitly
  given always wins; absence of a flag falls through to the file.
- New CLI: `clawmesh config show` (prints effective config and where each
  value came from), `clawmesh config set <key> <value>`, `clawmesh config
  init` (writes a commented starter file — JSON, comments in a `_doc`
  key, do not invent JSON5).
- Unknown keys in node.json: warn, ignore, never crash.

**Acceptance:** a node started with bare `clawmesh start` and a full
node.json behaves identically to the flag invocation (test: construct
both, compare effective runtime options). `config show` provenance is
tested. local-mesh.sh keeps working unchanged.

## Slice 2 — Known-meshes store (plural)

Today one `mesh-id` file persists one mesh. Bluetooth remembers every
pairing; ClawMesh must remember every mesh.

**Decisions:**
- File: `<state-dir>/meshes.json`:
  ```json
  { "meshes": [ { "meshId": "<hex>", "name": "bhoomi",
      "joinPolicy": "auto", "addedAtMs": 0 } ] }
  ```
  `joinPolicy`: `"auto" | "ask" | "never"`. Exactly one mesh may be
  active per running node (multi-mesh runtime is NOT this phase).
- Discovery TXT gains `meshId` (PROTOCOL.md §4 TXT table). Browsers use
  it to decide joinability BEFORE dialing: peer's mesh unknown or
  policy `never` → log and skip; `ask` → log "join requires operator"
  and skip (the interactive path arrives with pairing UX later);
  `auto` → adopt that mesh as the active mesh for this run if the node
  has no explicit `meshName` configured, then normal trust check +
  dial tie-break.
- `--mesh-name` / node.json `meshName` still forces a single mesh and
  registers it in meshes.json (policy auto) on first use.
- New CLI: `clawmesh meshes` (list), `clawmesh meshes set-policy
  <meshId|name> <auto|ask|never>`, `clawmesh meshes forget <meshId|name>`.
- Trust stays per-DEVICE and unchanged. Mesh membership gates which
  networks we join; device trust gates who we talk to. Do not merge them.

**Acceptance:** node with meshes.json entries {A:auto, B:never} on a LAN
where both are audible joins A, logs-and-skips B (localhost test: two
local-mesh instances with different MESH_NAMEs + injected discovery
events). meshId present in TXT records (unit-test the advertiser).

## Slice 3 — Pairing ceremony (the invariant-critical slice)

Replaces manual two-sided `trust add` with a Bluetooth-style ceremony.
Every design decision here is part of the core composition (explicit
human-confirmed pairing gating a self-forming actuation-capable mesh).
Log design decisions as dated entries; flag them for the review session.

**Decisions:**
- Flow (exactly this, both CLIs interactive):
  1. Accepter: `clawmesh pair --accept [--window 120]` → the RUNNING
     node enters a pairing window (default 120 s), adds `pairing=1` to
     its TXT record, and enables the `pair.*` RPC family for the window.
  2. Initiator: `clawmesh pair` → browses for `pairing=1` beacons,
     lists them (name, host, deviceId prefix), operator picks one
     (or `clawmesh pair --url ws://host:port` direct).
  3. Initiator sends `pair.request { deviceId, publicKey, displayName }`;
     accepter responds with its own `{ deviceId, publicKey, displayName,
     meshId?, meshName? }`.
  4. BOTH sides compute and display the SAS:
     `SAS = decimal( first4bytes( SHA256( "clawmesh-pair|" +
     min(pkA,pkB) + "|" + max(pkA,pkB) ) ) mod 1_000_000 )`, rendered
     as 6 digits with leading zeros (pkX = base64url raw Ed25519, the
     handshake encoding). Comparison-based binding of the two identity
     keys — a MITM cannot present the same 6 digits on both screens.
  5. Each operator answers y/n. Initiator sends
     `pair.confirm { deviceId, sasConfirmed: true }` only on local yes;
     accepter's RPC response carries its own confirmation. Trust is
     persisted on a side ONLY when that side saw local-yes AND
     remote-yes. On yes, initiator also adds the accepter's
     meshId/meshName (if offered) to meshes.json with policy `ask`.
  6. Any timeout/mismatch/no → nothing persisted, window stays open
     until it expires.
- Error codes (PROTOCOL.md error registry): `PAIRING_NOT_ACTIVE`,
  `PAIRING_REJECTED`, `PAIRING_TIMEOUT`, `PAIRING_SAS_MISMATCH`.
- Hard rules: pairing NEVER auto-trusts (no --yes flag; a human confirms
  on both ends, full stop). `pair.*` methods outside an active window →
  `PAIRING_NOT_ACTIVE`. The window closes after one successful pairing.
- PROTOCOL.md gets a new §"Pairing" with the message schemas, SAS
  derivation, and state machine.

**Acceptance:** two localhost nodes pair end-to-end driven by tests
(stdin scripted or the prompt logic factored to be injectable — factor
it; don't shell-puppet). SAS mismatch path, window expiry, and
`PAIRING_NOT_ACTIVE` all tested. After pairing, discovery auto-connects
the two nodes with no `trust add` ever run (integration test).

## Slice 4 — Operator RPC auth

The node port answers unauthenticated RPCs today. Fine on a dev desk;
not for an appliance that wakes up on arbitrary WiFi.

**Decisions:**
- Token: `<state-dir>/operator.token`, 32 random bytes hex, file mode
  0600, auto-created at node start if absent.
- New RPC `operator.auth { token }` → marks that WS connection as
  operator-authenticated.
- Connection privilege tiers (PROTOCOL.md threat-model section):
  - Unauthenticated: ONLY `mesh.challenge`, `mesh.connect`, `mesh.ping`,
    `operator.auth`, and `pair.*` during an active pairing window.
    Everything else → error code `NOT_AUTHORIZED`.
  - Mesh-authenticated peer (post `mesh.connect`): the peer RPC family
    (context/forward/llm/sync/trace) — unchanged semantics.
  - Operator-authenticated: everything, including `chat.subscribe`,
    `mesh.world.query`, `mesh.events`, actuator state.
- CLI and UI read the token from the state dir automatically (same
  machine); `CLAWMESH_OPERATOR_TOKEN` env overrides (remote UI).
- Escape hatch for tests/dev: start flag `--insecure-local-rpc`
  (logged loudly at startup). local-mesh.sh uses the token, NOT the
  escape hatch — the harness must exercise the real path.
- Update harness scripts (mesh-rpc.mjs, frame-listen.mjs,
  safety-canary.sh) to send `operator.auth` first when a token is
  available (env `CLAWMESH_OPERATOR_TOKEN` or `--token-file`); shots
  A/B of the canary intentionally REMAIN unauthenticated forwards? No —
  `mesh.message.forward` is a peer-tier method: after this slice the
  canary's raw-RPC shots MUST authenticate as operator first, and a new
  shot D asserts that the same forward WITHOUT auth gets
  `NOT_AUTHORIZED`. Update scripts/README.md accordingly.

**Acceptance:** privilege matrix unit-tested per tier; canary extended
with shot D and GREEN against a localhost node; UI still works against
a token-protected node on the same machine (manual check note is
acceptable; UI code change if needed is in scope).

## Slice 5 — Service lifecycle

**Decisions:**
- New CLI family: `clawmesh service install|uninstall|status`.
- macOS: generates `~/Library/LaunchAgents/com.clawmesh.node.plist`
  (launchd, RunAtLoad + KeepAlive, logs to
  `<state-dir>/logs/node.log`). Linux: generates a systemd USER unit
  `~/.config/systemd/user/clawmesh-node.service` (Restart=on-failure,
  WantedBy=default.target) and prints the `systemctl --user
  enable/start` commands; `--system` flag emits a system unit to stdout
  for manual sudo install (never sudo yourself).
- The service ExecStart is `clawmesh start` with NO flags — node.json
  (Slice 1) is the single source of truth. `service install` errors if
  node.json is missing.
- `service status` shells out to launchctl/systemctl and also probes
  `ws://localhost:<port>` with `mesh.ping`.

**Acceptance:** unit generation is snapshot-tested for both platforms
(fixed inputs → exact file contents). Install/uninstall round-trip
tested against a temp dir with the launchctl/systemctl calls injected
as a fake. Do NOT enable real services inside the agent sandbox —
generating + validating files is the agent-verifiable part; a real
reboot-rejoin run on the Jetson is the review session's job.

---

## Hardware appendix — REVIEW SESSION ONLY (agents: leave unchecked)

- [ ] Jetson: `clawmesh service install` + reboot → node rejoins the
      mesh with no human action; canary GREEN afterwards.
- [ ] Real pairing ceremony Mac↔Jetson (two terminals, real SAS compare).
- [ ] N=3 on real LAN (third node = second Mac process w/ own state
      dir): 2-hop delivery + propagation numbers into the log.
- [ ] nanochat actually served from the Jetson via `--serve-llm
      nanochat/<id>` (check `~/repo/nanochat` on the device) and
      consumed from the Mac; first-token latency + tok/s logged.
- [ ] Operator-auth verified over the LAN (Mac UI → Jetson node with
      token via env).

## Known traps (Phase 1+2, all hit for real — do not rediscover)

1. All traps in `docs/HANDOFF-2026-07-05-inference-phase.md` still hold
   (pkill self-match, nohup+pgrep, mesh-id mismatch, same-identity
   displacement, chat.subscribe, port 3000, suite timings).
2. Ephemeral tool runtimes MUST set `disableDiscovery: true` — ciao's
   prober races short-lived shutdown and crashes the process.
3. Dial tie-break: only the lower deviceId dials a discovered peer.
   Tests that inject `peer-discovered` must inject on the designated
   dialer or they flake 50% of runs.
4. Harness shell scripts run on macOS bash 3.2: empty-array expansion
   under `set -u` needs the `${arr[@]+"${arr[@]}"}` guard.
5. The localhost mesh (`scripts/local-mesh.sh`) runs `--no-discovery`;
   discovery behavior is only provable with real mDNS (two localhost
   processes CAN mDNS each other — use that for discovery tests, but
   know that loopback multicast can behave differently from a real LAN;
   flag any discovery acceptance as "localhost mDNS" in the log).

## Definition of done for this phase (agent-verifiable part)

1. A node with node.json + meshes.json + a paired peer, started with
   bare `clawmesh start`, joins its mesh with zero flags and zero
   manual trust commands (integration test, localhost mDNS).
2. Pairing ceremony works end-to-end in tests incl. all failure paths;
   PROTOCOL.md fully specs `pair.*` and the SAS.
3. Privilege tiers enforced and specced; canary (with shot D) GREEN.
4. Service unit generation snapshot-tested for both platforms.
5. Suites + tsc green; dated log entries per slice; REVIEW package
   (per the long-run directive) appended to the log at the end;
   hardware appendix left explicitly unchecked; main + tags pushed to
   origin after each slice (authorized 2026-07-07; never force-push).
