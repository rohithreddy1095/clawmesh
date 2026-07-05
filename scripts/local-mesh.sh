#!/usr/bin/env bash
# local-mesh.sh — spin up an N-node ClawMesh CHAIN on localhost, no
# hardware needed. Each node gets its own identity/state dir; trust is
# exchanged pairwise along the chain before start.
#
#   scripts/local-mesh.sh up [N]     # default 2, chain: n1 <- n2 <- ... <- nN
#   scripts/local-mesh.sh status     # mesh.peers probe on every node
#   scripts/local-mesh.sh down       # kill nodes (state dirs are kept)
#   scripts/local-mesh.sh clean      # down + delete state dirs and logs
#
# Ports: 19001, 19002, ... Node 1 has a mock sensor+actuator (so frames
# flow and the canary has a target); the rest are plain nodes. With N=3
# a frame from node 1 reaching node 3 is a real 2-hop gossip delivery
# (node 3 only connects to node 2).
#
# Env: LOCALMESH_DIR (default /tmp/clawmesh-local-mesh), MESH_NAME
# (default localmesh).
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${LOCALMESH_DIR:-/tmp/clawmesh-local-mesh}"
MESH_NAME="${MESH_NAME:-localmesh}"
CMD="${1:?usage: local-mesh.sh up [N] | status | down | clean}"
PORT_BASE=19000

node_dir()  { echo "$BASE/node$1"; }
node_port() { echo $((PORT_BASE + $1)); }

get_device_id() {
  CLAWMESH_STATE_DIR="$(node_dir "$1")" pnpm exec tsx clawmesh.ts identity 2>/dev/null \
    | awk '/Device ID:/{print $3}'
}

case "$CMD" in
up)
  N="${2:-2}"
  mkdir -p "$BASE"
  if [ -f "$BASE/pids" ] && kill -0 "$(head -1 "$BASE/pids")" 2>/dev/null; then
    echo "local mesh already running (see $BASE/pids); run 'down' first"; exit 1
  fi
  : > "$BASE/pids"

  declare -a IDS
  echo "creating $N identities..."
  for i in $(seq 1 "$N"); do
    mkdir -p "$(node_dir "$i")"
    IDS[$i]="$(get_device_id "$i")"
    echo "  node$i: ${IDS[$i]}"
  done

  echo "exchanging trust along the chain (both directions)..."
  for i in $(seq 2 "$N"); do
    prev=$((i - 1))
    CLAWMESH_STATE_DIR="$(node_dir "$i")"    pnpm exec tsx clawmesh.ts trust add "${IDS[$prev]}" >/dev/null 2>&1 || true
    CLAWMESH_STATE_DIR="$(node_dir "$prev")" pnpm exec tsx clawmesh.ts trust add "${IDS[$i]}"    >/dev/null 2>&1 || true
  done

  echo "starting nodes (chain topology)..."
  for i in $(seq 1 "$N"); do
    port="$(node_port "$i")"
    args=(start --host 127.0.0.1 --port "$port" --name "local-node$i" --role node --mesh-name "$MESH_NAME" --no-discovery)
    if [ "$i" -eq 1 ]; then
      args+=(--field-node)  # sensor+actuator so frames flow and canary has a target
    else
      prev=$((i - 1))
      args+=(--peer "${IDS[$prev]}=ws://127.0.0.1:$(node_port "$prev")")
    fi
    CLAWMESH_STATE_DIR="$(node_dir "$i")" nohup pnpm exec tsx clawmesh.ts "${args[@]}" \
      > "$BASE/node$i.log" 2>&1 &
    echo $! >> "$BASE/pids"
    echo "  node$i pid=$! port=$port log=$BASE/node$i.log"
  done
  sleep 8
  "$0" status
  ;;

status)
  N=0
  for d in "$BASE"/node*/; do [ -d "$d" ] && N=$((N + 1)); done
  [ "$N" -gt 0 ] || { echo "no local mesh at $BASE"; exit 1; }
  for i in $(seq 1 "$N"); do
    port="$(node_port "$i")"
    peers=$(node scripts/mesh-rpc.mjs "ws://127.0.0.1:$port" mesh.peers 2>/dev/null \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).payload.peers.map(p=>p.displayName).join(","))}catch{console.log("UNREACHABLE")}})')
    echo "node$i (port $port) peers: ${peers:-UNREACHABLE}"
  done
  ;;

down)
  if [ -f "$BASE/pids" ]; then
    while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$BASE/pids"
    rm -f "$BASE/pids"
    echo "stopped"
  else
    echo "nothing to stop"
  fi
  ;;

clean)
  "$0" down || true
  rm -rf "$BASE"
  echo "cleaned $BASE"
  ;;

*)
  echo "usage: local-mesh.sh up [N] | status | down | clean"; exit 2
  ;;
esac
