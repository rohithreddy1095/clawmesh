/**
 * ClawMesh Credential Store — persistent local key-value store for API keys,
 * bot tokens, and other secrets.
 *
 * Stored at `~/.clawmesh/credentials.json` (file permissions 600).
 * The store auto-loads on construction and auto-saves on mutation.
 *
 * Keys follow a namespaced convention:
 *   - `provider/<name>`  → LLM provider API keys (e.g. `provider/google`)
 *   - `channel/<name>`   → Channel credentials (e.g. `channel/telegram`)
 *   - `custom/<name>`    → User-defined secrets
 *
 * The Pi planner integration injects stored provider keys into `process.env`
 * before creating the agent session, so the Pi SDK's `getEnvApiKey()` picks
 * them up automatically.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Provider → env var mapping (mirrors Pi SDK's env-api-keys.ts) ────

const PROVIDER_ENV_MAP: Record<string, string> = {
  google: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  "github-copilot": "COPILOT_GITHUB_TOKEN",
  "google-vertex": "GOOGLE_APPLICATION_CREDENTIALS",
  "azure-openai-responses": "AZURE_OPENAI_API_KEY",
  huggingface: "HF_TOKEN",
};

// ─── Types ──────────────────────────────────────────────────

export type CredentialEntry = {
  value: string;
  /** ISO timestamp when the credential was stored. */
  addedAt: string;
  /** Optional label (e.g. "Rohith's Google AI key"). */
  label?: string;
};

type CredentialFile = {
  version: 1;
  credentials: Record<string, CredentialEntry>;
};

// ─── CredentialStore ─────────────────────────────────────────

export class CredentialStore {
  private readonly filePath: string;
  private data: CredentialFile;

  constructor(basePath?: string) {
    const base = basePath ?? join(homedir(), ".clawmesh");
    if (!existsSync(base)) {
      mkdirSync(base, { recursive: true });
    }
    this.filePath = join(base, "credentials.json");
    this.data = this.load();
  }

  // ─── Core CRUD ─────────────────────────────────────────

  /** Get a credential value by key. Returns undefined if not found. */
  get(key: string): string | undefined {
    return this.data.credentials[key]?.value;
  }

  /** Get the full entry (value + metadata) by key. */
  getEntry(key: string): CredentialEntry | undefined {
    return this.data.credentials[key];
  }

  /** Set a credential. Persists immediately. */
  set(key: string, value: string, label?: string): void {
    this.data.credentials[key] = {
      value,
      addedAt: new Date().toISOString(),
      label,
    };
    this.save();
  }

  /** Delete a credential. Returns true if it existed. */
  delete(key: string): boolean {
    if (key in this.data.credentials) {
      delete this.data.credentials[key];
      this.save();
      return true;
    }
    return false;
  }

  /** List all credential keys (values are NOT exposed). */
  keys(): string[] {
    return Object.keys(this.data.credentials);
  }

  /** List all entries with key and metadata (value masked). */
  list(): Array<{ key: string; label?: string; addedAt: string; masked: string }> {
    return Object.entries(this.data.credentials).map(([key, entry]) => ({
      key,
      label: entry.label,
      addedAt: entry.addedAt,
      masked: CredentialStore.maskValue(entry.value),
    }));
  }

  /** Check if a key exists. */
  has(key: string): boolean {
    return key in this.data.credentials;
  }

  // ─── Provider helpers ──────────────────────────────────

  /** Get the env var name for a provider. */
  static envVarForProvider(provider: string): string | undefined {
    return PROVIDER_ENV_MAP[provider];
  }

  /**
   * Return a non-reversible display string for a secret.
   * We avoid showing any raw prefix/suffix characters so list/get output
   * does not leak partial credential material into logs or screenshots.
   */
  static maskValue(value: string): string {
    const fingerprint = createHash("sha256")
      .update(value, "utf8")
      .digest("hex")
      .slice(0, 12);
    return `[redacted len=${value.length} sha256=${fingerprint}]`;
  }

  /**
   * Inject all `provider/*` credentials into `process.env` so the Pi SDK
   * picks them up via `getEnvApiKey()`.
   *
   * Only sets env vars that are NOT already set (env vars take precedence).
   * Returns the list of injected env var names.
   */
  injectProviderEnvVars(): string[] {
    const injected: string[] = [];
    for (const [key, entry] of Object.entries(this.data.credentials)) {
      if (!key.startsWith("provider/")) continue;
      const provider = key.slice("provider/".length);
      const envVar = PROVIDER_ENV_MAP[provider];
      if (!envVar) continue;
      if (process.env[envVar]) continue; // Don't override explicit env vars
      process.env[envVar] = entry.value;
      injected.push(envVar);
    }
    return injected;
  }

  /**
   * Get a channel credential (e.g. `channel/telegram` → bot token).
   */
  getChannelToken(channel: string): string | undefined {
    return this.get(`channel/${channel}`);
  }

  /**
   * Set a channel credential.
   */
  setChannelToken(channel: string, token: string, label?: string): void {
    this.set(`channel/${channel}`, token, label);
  }

  // ─── Persistence ───────────────────────────────────────

  private load(): CredentialFile {
    if (!existsSync(this.filePath)) {
      return { version: 1, credentials: {} };
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.version === 1 && typeof parsed.credentials === "object") {
        return parsed as CredentialFile;
      }
      // Unknown version — start fresh but don't overwrite
      console.warn(`[credential-store] Unknown version in ${this.filePath}, starting fresh`);
      return { version: 1, credentials: {} };
    } catch (err) {
      console.warn(`[credential-store] Failed to read ${this.filePath}: ${err}`);
      return { version: 1, credentials: {} };
    }
  }

  private save(): void {
    const json = JSON.stringify(this.data, null, 2);
    writeFileSync(this.filePath, json, { encoding: "utf-8", mode: 0o600 });
    // Ensure permissions are correct even if file existed
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      // Ignore chmod errors on systems that don't support it
    }
  }
}
