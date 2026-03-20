import { existsSync } from "node:fs";
import { mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  generateVarName,
  generateUniqueVarName,
  extractProviderFromVarName,
  storeApiKey,
  readEnvFile,
  listStoredKeys,
  deleteStoredKey,
  atomicEnvWrite,
} from "./env-manager.js";

describe("generateVarName", () => {
  it("maps GITHUB to GH_TOKEN", () => {
    expect(generateVarName("GITHUB")).toBe("GH_TOKEN");
    expect(generateVarName("github")).toBe("GH_TOKEN");
    expect(generateVarName("GitHub")).toBe("GH_TOKEN");
  });

  it("returns {PROVIDER}_API_KEY for unknown providers", () => {
    expect(generateVarName("OPENAI")).toBe("OPENAI_API_KEY");
    expect(generateVarName("anthropic")).toBe("ANTHROPIC_API_KEY");
  });

  it("preserves var names that already have key suffixes", () => {
    expect(generateVarName("OPENAI_API_KEY")).toBe("OPENAI_API_KEY");
    expect(generateVarName("MY_SECRET")).toBe("MY_SECRET");
    expect(generateVarName("AUTH_TOKEN")).toBe("AUTH_TOKEN");
  });

  it("returns UNKNOWN_API_KEY for null provider", () => {
    expect(generateVarName(null)).toBe("UNKNOWN_API_KEY");
  });
});

describe("generateUniqueVarName", () => {
  it("uses GH_TOKEN for GITHUB even with collision avoidance", () => {
    expect(generateUniqueVarName("GITHUB", [])).toBe("GH_TOKEN");
  });

  it("appends suffix on collision with GH_TOKEN", () => {
    expect(generateUniqueVarName("GITHUB", ["GH_TOKEN"])).toBe("GH_TOKEN_2");
  });

  it("increments suffix on multiple collisions", () => {
    expect(generateUniqueVarName("OPENAI", ["OPENAI_API_KEY", "OPENAI_API_KEY_2"])).toBe(
      "OPENAI_API_KEY_3",
    );
  });
});

describe("extractProviderFromVarName", () => {
  it("extracts from new format", () => {
    expect(extractProviderFromVarName("OPENAI_API_KEY")).toBe("OPENAI");
    expect(extractProviderFromVarName("OPENAI_API_KEY_2")).toBe("OPENAI");
  });

  it("extracts from old format", () => {
    expect(extractProviderFromVarName("OPENCLAW_API_KEY_OPENAI_1707418234567")).toBe("OPENAI");
  });

  it("returns null for unrecognized format", () => {
    expect(extractProviderFromVarName("RANDOM_VAR")).toBeNull();
  });
});

describe("env-manager file operations", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(
      tmpdir(),
      `env-manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("atomicEnvWrite creates file if missing", async () => {
    const envPath = join(tmpDir, "sub", ".env");
    await atomicEnvWrite({ MY_KEY: "my-value" }, envPath);

    expect(existsSync(envPath)).toBe(true);
    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("MY_KEY=my-value");
  });

  it("atomicEnvWrite preserves existing vars and comments", async () => {
    const envPath = join(tmpDir, ".env");
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(envPath, "# header\nEXISTING=old\n", "utf-8");

    await atomicEnvWrite({ NEW_VAR: "new-value" }, envPath);

    const content = await readFile(envPath, "utf-8");
    expect(content).toContain("# header");
    expect(content).toContain("EXISTING=old");
    expect(content).toContain("NEW_VAR=new-value");
  });

  it("storeApiKey deduplicates by SHA256 hash", async () => {
    const envPath = join(tmpDir, ".env");
    const key = "sk-test-dedup-" + "A".repeat(20);

    const r1 = await storeApiKey(key, "OPENAI", envPath);
    expect(r1.isDuplicate).toBe(false);

    const r2 = await storeApiKey(key, "OPENAI", envPath);
    expect(r2.isDuplicate).toBe(true);
    expect(r2.varName).toBe(r1.varName);
  });

  it("storeApiKey hot-injects into process.env", async () => {
    const envPath = join(tmpDir, ".env");
    const key = "sk-hotinject-" + "B".repeat(20);

    const { varName } = await storeApiKey(key, "TEST_PROVIDER", envPath);
    expect(process.env[varName]).toBe(key);

    // Cleanup
    delete process.env[varName];
  });

  it("listStoredKeys returns metadata for stored keys", async () => {
    const envPath = join(tmpDir, ".env");
    await storeApiKey("sk-list-" + "C".repeat(20), "OPENAI", envPath);

    const keys = await listStoredKeys(envPath);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(keys[0].varName).toBeDefined();
    expect(keys[0].hash).toBeDefined();
  });

  it("deleteStoredKey removes key from file and process.env", async () => {
    const envPath = join(tmpDir, ".env");
    const key = "sk-delete-" + "D".repeat(20);

    const { varName } = await storeApiKey(key, "DELETEME", envPath);
    expect(process.env[varName]).toBe(key);

    const result = await deleteStoredKey(varName, envPath);
    expect(result.deleted).toBe(true);
    expect(process.env[varName]).toBeUndefined();

    // Verify removed from file
    const vars = await readEnvFile(envPath);
    expect(vars[varName]).toBeUndefined();
  });

  it("deleteStoredKey returns not found for missing key", async () => {
    const envPath = join(tmpDir, ".env");
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(envPath, "# empty\n", "utf-8");

    const result = await deleteStoredKey("NONEXISTENT_KEY", envPath);
    expect(result.deleted).toBe(false);
    expect(result.reason).toBe("not found");
  });

  it("readEnvFile creates file if missing", async () => {
    const envPath = join(tmpDir, "new-dir", ".env");
    const vars = await readEnvFile(envPath);
    expect(vars).toEqual({});
    expect(existsSync(envPath)).toBe(true);
  });
});
