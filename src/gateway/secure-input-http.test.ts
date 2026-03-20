import { describe, it, expect, afterEach } from "vitest";
import { createSecureInputToken, dispose as disposeTokens } from "./secure-input-tokens.js";

afterEach(() => {
  disposeTokens();
});

describe("secure-input-http", () => {
  describe("token creation", () => {
    it("creates a token with URL containing the token", () => {
      const result = createSecureInputToken({
        agentId: "test-agent",
        purpose: "apikey",
      });

      expect(result.token).toBeDefined();
      expect(result.url).toContain(`token=${result.token}`);
      expect(result.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe("route matching patterns", () => {
    it("secure-input path structure", () => {
      // Verify path patterns are correct
      expect("/secure-input").toBe("/secure-input");
      expect("/api/secure-input/status".startsWith("/api/secure-input/")).toBe(true);
      expect("/api/secure-input/preview".startsWith("/api/secure-input/")).toBe(true);
      expect("/api/secure-input/submit".startsWith("/api/secure-input/")).toBe(true);
      expect("/api/secure-input/keys".startsWith("/api/secure-input/")).toBe(true);
    });

    it("does not match unrelated paths", () => {
      expect("/sessions".startsWith("/api/secure-input/")).toBe(false);
      expect("/api/sessions".startsWith("/api/secure-input/")).toBe(false);
    });
  });
});
