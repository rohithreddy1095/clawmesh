# Setting up a Field Node (Jetson / Raspberry Pi)

A Field Node runs the ClawMesh core protocol. It connects to local hardware (sensors, GPIO, actuators) and gossips data to the rest of the mesh.

**Crucially, field nodes DO NOT need an LLM or Pi dependencies.** They are lean, edge-focused gateways.

## 1. Prerequisites

- A Linux device (e.g., Jetson Orin Nano, Raspberry Pi)
- Node.js 22+ (for `--experimental-strip-types` / `--experimental-transform-types` or use `tsx`)
- `pnpm`

To install pnpm via corepack on Node 22:
```bash
corepack enable pnpm
```
*(Or use `curl -fsSL https://get.pnpm.io/install.sh | sh -`)*

## 2. Deployment (No planner setup needed)

You do not need planner configuration on a field node unless you explicitly enable planner features. The repository now uses published `@mariozechner/pi-*` package versions by default, so a normal `pnpm install` works without editing `package.json` first.

```bash
# On the field node
git clone https://github.com/your-org/clawmesh.git
cd clawmesh
pnpm install
pnpm add -g tsx  # If your Node version requires tsx for execution
```

## 3. Establish Identity & Mutual Trust

Just like the Command Center, your field node has a unique identity.

```bash
npx tsx clawmesh.mjs identity
```
*Outputs the Field Node Device ID.*

Add the **Command Center's Device ID** to this node's trust store:
```bash
npx tsx clawmesh.mjs trust add <COMMAND_CENTER_DEVICE_ID>
```
*(The Command Center must also add the Field Node's Device ID to its trust store).*

## 4. Starting the Node

For testing, you can run the field node with mock sensors and actuators.

```bash
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"

nohup npx tsx clawmesh.mjs start \
  --name jetson-field-01 \
  --port 18789 \
  --field-node \
  --sensor-interval 5000 \
  > /tmp/clawmesh-field.log 2>&1 &
```

- `--field-node`: Shorthand for `--sensors --actuators` (enables mock implementations).
- `--port 18789`: The WebSocket port it listens on.

## 5. Verifying Connection

Once both the Field Node and the Command Center are running and trust each other, they will peer (either via mDNS auto-discovery or static peering).

Tail the logs on the Field Node:
```bash
tail -f /tmp/clawmesh-field.log
```
You should see output like:
```
[context] Broadcasting observation: {"zone":"zone-1","metric":"moisture","value":21.2,"unit":"%","threshold":20,"status":"low"}
mesh: inbound peer connected fb1621b47a38...
```

The sensor data will now flow across the mesh, be ingested into the Command Center's world model, and visualized on the UI dashboard.
