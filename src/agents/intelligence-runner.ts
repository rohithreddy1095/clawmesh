import * as readline from "node:readline";
import type { MeshTool } from "./tools/mesh-tools.js";

/**
 * Minimal Anthropic Messages API types for tool use.
 * (No SDK dependency — uses fetch directly.)
 */

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
type Message = { role: "user" | "assistant"; content: string | ContentBlock[] };

type ApiResponse = {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: { input_tokens: number; output_tokens: number };
};

export type IntelligenceRunnerOptions = {
  model: string;
  systemPrompt: string;
  tools: MeshTool[];
  signal?: AbortSignal;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

/**
 * Run an interactive intelligence agent with tool use.
 *
 * Reads user input from stdin, calls Anthropic Messages API,
 * executes tool calls against mesh tools, and prints responses.
 */
export async function runIntelligenceAgent(opts: IntelligenceRunnerOptions): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    opts.log.error(
      "intelligence: ANTHROPIC_API_KEY not set. Export it to enable intelligence mode.",
    );
    return;
  }

  const messages: Message[] = [];
  const toolDefs = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  const toolsByName = new Map(opts.tools.map((t) => [t.name, t]));

  opts.log.info("intelligence: agent ready — type a message to interact with Pi");
  opts.log.info('intelligence: type "exit" or press Ctrl+C to stop');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\nYou > ",
  });

  // Handle abort signal
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      rl.close();
    }, { once: true });
  }

  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input.toLowerCase() === "exit") {
      rl.close();
      break;
    }

    // Add user message
    messages.push({ role: "user", content: input });

    // Run the agent turn (may involve multiple API calls for tool use)
    try {
      await runAgentTurn({
        apiKey,
        model: opts.model,
        systemPrompt: opts.systemPrompt,
        toolDefs,
        toolsByName,
        messages,
        log: opts.log,
      });
    } catch (err) {
      opts.log.error(`intelligence: error: ${err}`);
    }

    rl.prompt();
  }

  opts.log.info("intelligence: agent stopped");
}

async function runAgentTurn(ctx: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  toolDefs: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  toolsByName: Map<string, MeshTool>;
  messages: Message[];
  log: IntelligenceRunnerOptions["log"];
}): Promise<void> {
  // Loop to handle multi-step tool use
  for (let step = 0; step < 10; step++) {
    const response = await callAnthropicApi({
      apiKey: ctx.apiKey,
      model: ctx.model,
      system: ctx.systemPrompt,
      messages: ctx.messages,
      tools: ctx.toolDefs,
    });

    if (!response) {
      ctx.log.error("intelligence: empty API response");
      return;
    }

    // Print any text blocks
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(`\nPi > ${block.text}`);
      }
    }

    // If the model stopped normally (no tool use), we're done
    if (response.stop_reason !== "tool_use") {
      // Push assistant response to history
      ctx.messages.push({ role: "assistant", content: response.content });
      return;
    }

    // Push assistant response (with tool_use blocks) to history
    ctx.messages.push({ role: "assistant", content: response.content });

    // Execute tool calls
    const toolResults: ToolResultBlock[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      const tool = ctx.toolsByName.get(block.name);
      if (!tool) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: `Unknown tool: ${block.name}` }),
        });
        continue;
      }

      ctx.log.info(`intelligence: executing tool ${block.name}(${JSON.stringify(block.input).slice(0, 120)})`);

      try {
        const result = await tool.execute(block.input);
        const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultStr,
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: String(err) }),
        });
      }
    }

    // Push tool results as a user message (per Anthropic API format)
    ctx.messages.push({ role: "user", content: toolResults });
  }

  ctx.log.warn("intelligence: max tool-use steps reached (10)");
}

async function callAnthropicApi(params: {
  apiKey: string;
  model: string;
  system: string;
  messages: Message[];
  tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}): Promise<ApiResponse | null> {
  const body = {
    model: params.model,
    max_tokens: 4096,
    system: params.system,
    messages: params.messages,
    tools: params.tools.length > 0 ? params.tools : undefined,
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
  }

  return (await res.json()) as ApiResponse;
}
