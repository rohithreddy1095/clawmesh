# Setting up a Command Center Node

The Command Center is the brain of your ClawMesh deployment. It runs the mesh networking core, the Pi intelligence layer (planner), and serves the Next.js UI Dashboard.

Typically, this runs on a Mac, PC, or a powerful home lab server.

## 1. Installation

Ensure Node.js 22+ and `pnpm` are installed.

```bash
cd clawmesh
pnpm install
```

*(Note: The command center requires the Pi-mono packages for the intelligence layer. If using local workspace links, ensure `pi-mono` is checked out adjacently and built.)*

## 2. Check Identity

Every ClawMesh node has a unique Ed25519 identity. Find your Command Center's identity:

```bash
npx tsx clawmesh.mjs identity
```

You will see output like:
```text
Device ID:   fb1621b47a389a492e6927cd2dec91e9f383701d153fca76b265f58503b0a387
Public Key:
-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----
```

**Keep this Device ID handy.** Field nodes will need it to establish mutual trust.

## 3. Establish Trust with Field Nodes

For the Command Center to talk to a Field Node, they must trust each other. Add the Field Node's Device ID to your Command Center's trust store:

```bash
npx tsx clawmesh.mjs trust add <FIELD_NODE_DEVICE_ID>
```

*(You must also run the equivalent command on the Field Node, adding the Command Center's Device ID).*

## 4. Start the Node

Start the node with the `--command-center` flag to enable the Pi-powered planner. You'll need an LLM API key (e.g., Anthropic, Google, OpenAI).

```bash
# Default (uses Anthropic Claude Sonnet 3.5)
ANTHROPIC_API_KEY=sk-... npx tsx clawmesh.mjs start \
  --name mac-main \
  --port 18790 \
  --command-center \
  --peer "<FIELD_NODE_DEVICE_ID>=ws://<FIELD_NODE_IP>:18789"
```

### Advanced LLM Options

Use a different provider (e.g., Google Gemini):
```bash
GOOGLE_API_KEY=... npx tsx clawmesh.mjs start \
  --name mac-main --port 18790 \
  --pi-session --pi-model "google/gemini-2.5-flash" \
  --peer "..."
```

Enable thinking/reasoning (for supported models):
```bash
npx tsx clawmesh.mjs start ... --command-center --thinking medium
```

## 5. Start the UI Dashboard

In a separate terminal, start the Next.js Dashboard:

```bash
cd clawmesh/ui
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The UI will automatically connect to the local mesh node on `ws://localhost:18790` (configured in `ui/src/lib/useMesh.ts`). You can now view the Digital Twin, telemetry data, and approve/reject proposals in the Command Center tab.
