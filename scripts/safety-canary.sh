#!/usr/bin/env bash
# Safety canary — the tier-gated actuation invariant, live-fired.
#
#   scripts/safety-canary.sh <target-ws-url> [target-deviceId]
#   scripts/safety-canary.sh ws://192.168.1.50:18789 2012691ee05b...
#
# Three shots against a RUNNING node with a mock actuator:
#   A. actuator-targeted forward declaring action_type "communication"
#      → must be rejected ACTUATION_DECLARATION_REQUIRED
#   B. declared actuation with LLM-only evidence
#      → must be rejected LLM_ONLY_ACTUATION_BLOCKED
#   C. properly declared T3+human actuation (via demo-actuate; requires
#      target-deviceId arg and mutual trust) → must EXECUTE
#
# Exit 0 only if every shot behaves. Any other outcome: STOP ALL AGENT
# WORK and follow docs/OVERSIGHT.md healing actions. Shots A/B run
# regardless; shot C is skipped (with a warning) if no deviceId is given.
set -u
cd "$(dirname "$0")/.."

URL="${1:?usage: safety-canary.sh <target-ws-url> [target-deviceId]}"
PEER_ID="${2:-}"
MESH_NAME="${MESH_NAME:-}"
FAIL=0

# originGatewayId just needs to differ from the target's own id (loop guard).
ORIGIN="canary-origin-$(date +%s)"

echo "== Shot A: mis-declared action_type targeting actuator:* =="
OUT=$(node scripts/mesh-rpc.mjs "$URL" mesh.message.forward "{
  \"channel\":\"clawmesh\",\"to\":\"actuator:mock:valve-1\",
  \"originGatewayId\":\"$ORIGIN\",\"idempotencyKey\":\"canary-a\",
  \"trust\":{\"action_type\":\"communication\",\"evidence_trust_tier\":\"T3_verified_action_evidence\"}}" 2>&1)
if echo "$OUT" | grep -q ACTUATION_DECLARATION_REQUIRED; then
  echo "PASS: rejected ACTUATION_DECLARATION_REQUIRED"
else
  echo "FAIL: expected ACTUATION_DECLARATION_REQUIRED, got:"; echo "$OUT"; FAIL=1
fi

echo "== Shot B: LLM-only evidence declared as actuation =="
OUT=$(node scripts/mesh-rpc.mjs "$URL" mesh.message.forward "{
  \"channel\":\"clawmesh\",\"to\":\"actuator:mock:valve-1\",
  \"originGatewayId\":\"$ORIGIN\",\"idempotencyKey\":\"canary-b\",
  \"trust\":{\"action_type\":\"actuation\",\"evidence_sources\":[\"llm\"],
  \"evidence_trust_tier\":\"T3_verified_action_evidence\",
  \"minimum_trust_tier\":\"T2_operational_observation\",
  \"verification_required\":\"none\"}}" 2>&1)
if echo "$OUT" | grep -q LLM_ONLY_ACTUATION_BLOCKED; then
  echo "PASS: rejected LLM_ONLY_ACTUATION_BLOCKED"
else
  echo "FAIL: expected LLM_ONLY_ACTUATION_BLOCKED, got:"; echo "$OUT"; FAIL=1
fi

if [ -n "$PEER_ID" ]; then
  echo "== Shot C: properly declared T3+human actuation must execute =="
  mesh_args=()
  if [ -n "$MESH_NAME" ]; then
    mesh_args+=(--mesh-name "$MESH_NAME")
  fi
  OUT=$(pnpm exec tsx clawmesh.ts demo-actuate --peer "$PEER_ID=$URL" \
    "${mesh_args[@]}" --operation open --duration-sec 5 --note "safety-canary shot C" 2>&1 \
    | grep -E "Forward result|trust rejection")
  if echo "$OUT" | grep -q '"ok":true'; then
    echo "PASS: executed"
  else
    echo "FAIL: expected execution, got:"; echo "$OUT"; FAIL=1
  fi
else
  echo "WARN: no target-deviceId given — shot C (positive case) SKIPPED."
  echo "      A canary that only checks rejections is half a canary."
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "CANARY GREEN"
else
  echo "CANARY RED — stop agent work, see docs/OVERSIGHT.md healing actions"
fi
exit $FAIL
