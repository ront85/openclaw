import { describe, it, expect, afterEach } from "vitest";
import {
  createSecureInputToken,
  peekSecureInputToken,
  validateSecureInputToken,
  consumeSecureInputToken,
  getTokenStats,
  dispose,
} from "./secure-input-tokens.js";

afterEach(() => {
  dispose();
});

describe("secure-input-tokens", () => {
  it("creates a token with URL and expiry", () => {
    const result = createSecureInputToken({
      agentId: "test-agent",
      purpose: "apikey",
    });

    expect(result.token).toBeDefined();
    expect(result.url).toContain("/secure-input?token=");
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("validates a fresh token", () => {
    const { token } = createSecureInputToken({
      agentId: "test-agent",
      purpose: "apikey",
    });

    const data = validateSecureInputToken(token);
    expect(data).not.toBeNull();
    expect(data!.agentId).toBe("test-agent");
    expect(data!.used).toBe(false);
  });

  it("returns null for unknown token", () => {
    expect(validateSecureInputToken("nonexistent")).toBeNull();
    expect(peekSecureInputToken("nonexistent")).toBeNull();
  });

  it("token is single-use after consumption", () => {
    const { token } = createSecureInputToken({
      agentId: "test-agent",
      purpose: "apikey",
    });

    consumeSecureInputToken(token);

    // Should not validate after use
    expect(validateSecureInputToken(token)).toBeNull();

    // Peek still reports it exists but used
    const peek = peekSecureInputToken(token);
    expect(peek).not.toBeNull();
    expect(peek!.used).toBe(true);
  });

  it("expired token returns null on validate", async () => {
    const { token } = createSecureInputToken({
      agentId: "test-agent",
      purpose: "apikey",
      expiryMs: 1, // 1ms — expires immediately
    });

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 10));
    const result = validateSecureInputToken(token);
    expect(result).toBeNull();
  });

  it("configurable expiry", () => {
    const { expiresAt } = createSecureInputToken({
      agentId: "test-agent",
      purpose: "apikey",
      expiryMs: 10 * 60 * 1000, // 10 minutes
    });

    const expectedMinExpiry = Date.now() + 9 * 60 * 1000;
    expect(expiresAt).toBeGreaterThan(expectedMinExpiry);
  });

  it("getTokenStats reports counts", () => {
    createSecureInputToken({ agentId: "a1", purpose: "apikey" });
    createSecureInputToken({ agentId: "a2", purpose: "apikey" });
    const { token: t3 } = createSecureInputToken({ agentId: "a3", purpose: "apikey" });
    consumeSecureInputToken(t3);

    const stats = getTokenStats();
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(2);
    expect(stats.used).toBe(1);
  });

  it("dispose clears all tokens and timer", () => {
    createSecureInputToken({ agentId: "a1", purpose: "apikey" });

    dispose();

    const stats = getTokenStats();
    expect(stats.total).toBe(0);
  });
});
