import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { acquireSessionWriteLock } from "../../agents/session-write-lock.js";
import { resolveStateDir } from "../../config/paths.js";

export type StoredKeyMetadata = {
  varName: string;
  provider: string | null;
  storedAt: number;
  hash: string;
  source?: {
    agentId?: string;
    sessionKey?: string;
    hookType?: string;
  };
};

// In-memory cache of stored keys (hash -> metadata)
const keyCache = new Map<string, StoredKeyMetadata>();
let cacheInitialized = false;

/**
 * Ensure cache is populated from disk before first use.
 */
async function ensureCacheLoaded(envPath?: string): Promise<void> {
  if (cacheInitialized) {
    return;
  }
  cacheInitialized = true;
  await listStoredKeys(envPath);
}

/**
 * Get default .env file path (respects OPENCLAW_STATE_DIR)
 */
export function getDefaultEnvPath(): string {
  return join(resolveStateDir(), ".env");
}

// Well-known provider -> env var mappings (e.g., GITHUB -> GH_TOKEN)
// so stored keys match what CLIs and model-auth.ts expect.
const WELL_KNOWN_PROVIDER_VARS: Record<string, string> = {
  GITHUB: "GH_TOKEN",
};

/**
 * Generate variable name for API key
 * Format: {PROVIDER}_API_KEY (or well-known override)
 */
export function generateVarName(provider: string | null): string {
  const providerPart = (provider ?? "UNKNOWN").toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const wellKnown = WELL_KNOWN_PROVIDER_VARS[providerPart];
  if (wellKnown) {
    return wellKnown;
  }
  const KEY_SUFFIXES = /_(?:API_KEY|KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS)(?:_\d+)?$/;
  if (KEY_SUFFIXES.test(providerPart)) {
    return providerPart;
  }
  return `${providerPart}_API_KEY`;
}

/**
 * Generate a unique variable name that doesn't collide with existing vars.
 * Tries {PROVIDER}_API_KEY, then {PROVIDER}_API_KEY_2, _3, etc.
 */
export function generateUniqueVarName(
  provider: string | null,
  existingVarNames: Iterable<string>,
): string {
  const base = generateVarName(provider);
  const existing = new Set(existingVarNames);

  if (!existing.has(base)) {
    return base;
  }

  for (let i = 2; ; i++) {
    const candidate = `${base}_${i}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * Extract provider name from a variable name (supports old and new format).
 * Old format: OPENCLAW_API_KEY_{PROVIDER}_{TIMESTAMP}
 * New format: {PROVIDER}_API_KEY or {PROVIDER}_API_KEY_{N}
 */
export function extractProviderFromVarName(varName: string): string | null {
  // Try old format first (backward compat)
  const oldMatch = varName.match(/^OPENCLAW_API_KEY_(.+)_(\d{10,})$/);
  if (oldMatch) {
    return oldMatch[1];
  }

  // Try new format: {PROVIDER}_API_KEY or {PROVIDER}_API_KEY_{N}
  const newMatch = varName.match(/^(.+?)_API_KEY(?:_\d+)?$/);
  if (newMatch) {
    return newMatch[1];
  }

  return null;
}

/**
 * Hash API key for deduplication (SHA256)
 */
function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Parse .env file into key-value pairs
 * Preserves comments and empty lines
 */
function parseEnvFile(content: string): { lines: string[]; vars: Map<string, string> } {
  const lines = content.split("\n");
  const vars = new Map<string, string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      vars.set(key, value);
    }
  }

  return { lines, vars };
}

/**
 * Read .env file (create if missing)
 */
export async function readEnvFile(envPath?: string): Promise<Record<string, string>> {
  const path = envPath ?? getDefaultEnvPath();

  // Create directory if missing
  await mkdir(dirname(path), { recursive: true });

  // Create file if missing
  if (!existsSync(path)) {
    await writeFile(path, "# OpenClaw API Keys\n", "utf-8");
    return {};
  }

  const content = await readFile(path, "utf-8");
  const { vars } = parseEnvFile(content);

  return Object.fromEntries(vars);
}

/**
 * Atomically write updates to .env file
 * Preserves existing variables and comments
 */
export async function atomicEnvWrite(
  updates: Record<string, string>,
  envPath?: string,
): Promise<void> {
  const path = envPath ?? getDefaultEnvPath();

  // Acquire file lock
  const lock = await acquireSessionWriteLock({ sessionFile: path });

  try {
    // Read existing content
    let content = "";
    if (existsSync(path)) {
      content = await readFile(path, "utf-8");
    } else {
      // Create directory if missing
      await mkdir(dirname(path), { recursive: true });
      content = "# OpenClaw API Keys\n";
    }

    const { lines, vars } = parseEnvFile(content);

    // Merge updates
    for (const [key, value] of Object.entries(updates)) {
      vars.set(key, value);
    }

    // Rebuild file content
    const newLines: string[] = [];

    // Preserve existing lines (update values if key exists)
    for (const line of lines) {
      const trimmed = line.trim();

      // Preserve comments and empty lines
      if (trimmed === "" || trimmed.startsWith("#")) {
        newLines.push(line);
        continue;
      }

      // Update existing variables
      const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*/);
      if (match) {
        const key = match[1];
        if (vars.has(key)) {
          newLines.push(`${key}=${vars.get(key)}`);
          vars.delete(key); // Mark as written
        } else {
          newLines.push(line);
        }
      } else {
        newLines.push(line);
      }
    }

    // Append new variables
    if (vars.size > 0) {
      newLines.push(""); // Blank line before new vars
      for (const [key, value] of vars.entries()) {
        newLines.push(`${key}=${value}`);
      }
    }

    // Write to temp file, then rename (atomic)
    const tempPath = `${path}.tmp`;
    await writeFile(tempPath, newLines.join("\n") + "\n", "utf-8");
    await rename(tempPath, path);
  } finally {
    // Release lock
    await lock.release();
  }
}

/**
 * Store API key in .env file
 * Returns variable name and checks for duplicates
 */
export async function storeApiKey(
  key: string,
  provider: string | null,
  envPath?: string,
  source?: StoredKeyMetadata["source"],
  customVarName?: string,
): Promise<{ varName: string; isDuplicate: boolean }> {
  // Ensure cache is populated from disk on first call
  await ensureCacheLoaded(envPath);

  const hash = hashKey(key);

  // Check cache for duplicate
  if (keyCache.has(hash)) {
    const cached = keyCache.get(hash)!;
    return { varName: cached.varName, isDuplicate: true };
  }

  // Generate variable name (collision-aware if no custom name)
  const timestamp = Date.now();
  let varName: string;
  if (customVarName) {
    varName = customVarName;
  } else {
    const existingVars = await readEnvFile(envPath);
    varName = generateUniqueVarName(provider, Object.keys(existingVars));
  }

  // Store in .env
  await atomicEnvWrite({ [varName]: key }, envPath);

  // Hot-inject into process.env so tools can use the key immediately
  // (loadDotEnv only runs at startup, so without this, newly stored keys
  // are invisible until the process restarts)
  process.env[varName] = key;

  // Cache metadata
  const metadata: StoredKeyMetadata = {
    varName,
    provider,
    storedAt: timestamp,
    hash,
    source,
  };
  keyCache.set(hash, metadata);

  return { varName, isDuplicate: false };
}

/**
 * List all stored API keys (metadata only)
 */
export async function listStoredKeys(envPath?: string): Promise<StoredKeyMetadata[]> {
  const vars = await readEnvFile(envPath);
  const keys: StoredKeyMetadata[] = [];

  for (const [varName, value] of Object.entries(vars)) {
    const hash = hashKey(value);
    let metadata = keyCache.get(hash);

    if (!metadata) {
      const provider = extractProviderFromVarName(varName);
      // Extract timestamp from old format for backward compat
      const oldMatch = varName.match(/^OPENCLAW_API_KEY_(.+)_(\d{10,})$/);
      metadata = {
        varName,
        provider,
        storedAt: oldMatch?.[2] ? Number.parseInt(oldMatch[2], 10) : 0,
        hash,
      };
      keyCache.set(hash, metadata);
    }

    keys.push(metadata);
  }

  return keys;
}

/**
 * Get API key value by variable name
 */
export async function getKeyValue(varName: string, envPath?: string): Promise<string | null> {
  const vars = await readEnvFile(envPath);
  return vars[varName] ?? null;
}

/**
 * Initialize cache from .env file
 */
export async function initializeCache(envPath?: string): Promise<void> {
  await listStoredKeys(envPath);
}

/**
 * Resolve the per-agent .env file path
 */
export function resolveAgentEnvPath(agentId: string): string {
  return join(resolveStateDir(), "agents", agentId, "agent", ".env");
}

/**
 * List all stored API keys with redacted values (never exposes raw values)
 */
export async function listStoredKeysWithRedacted(
  envPath?: string,
): Promise<Array<StoredKeyMetadata & { redactedValue: string }>> {
  // Lazy-import to avoid circular dependency at module load
  const { redactValue } = await import("./json-credential-extractor.js");
  const vars = await readEnvFile(envPath);
  const results: Array<StoredKeyMetadata & { redactedValue: string }> = [];

  for (const [varName, value] of Object.entries(vars)) {
    const provider = extractProviderFromVarName(varName);
    // Extract timestamp from old format for backward compat
    const oldMatch = varName.match(/^OPENCLAW_API_KEY_(.+)_(\d{10,})$/);
    results.push({
      varName,
      provider,
      storedAt: oldMatch?.[2] ? Number.parseInt(oldMatch[2], 10) : 0,
      hash: hashKey(value),
      redactedValue: redactValue(value),
    });
  }

  return results;
}

/**
 * Delete a stored API key from .env file
 */
export async function deleteStoredKey(
  varName: string,
  envPath?: string,
): Promise<{ deleted: boolean; reason?: string }> {
  const path = envPath ?? getDefaultEnvPath();

  if (!existsSync(path)) {
    return { deleted: false, reason: "not found" };
  }

  const lock = await acquireSessionWriteLock({ sessionFile: path });

  try {
    const content = await readFile(path, "utf-8");
    const lines = content.split("\n");
    let found = false;
    const newLines: string[] = [];

    for (const line of lines) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*/);
      if (match && match[1] === varName) {
        found = true;
        // Remove from keyCache by finding the hash
        const valueMatch = line.match(/^[A-Z_][A-Z0-9_]*\s*=\s*(.*)$/);
        if (valueMatch) {
          const hash = hashKey(valueMatch[1]);
          keyCache.delete(hash);
        }
        continue; // skip this line
      }
      newLines.push(line);
    }

    if (!found) {
      return { deleted: false, reason: "not found" };
    }

    const tempPath = `${path}.tmp`;
    await writeFile(tempPath, newLines.join("\n"), "utf-8");
    await rename(tempPath, path);

    // Remove from process.env
    delete process.env[varName];

    return { deleted: true };
  } finally {
    await lock.release();
  }
}
