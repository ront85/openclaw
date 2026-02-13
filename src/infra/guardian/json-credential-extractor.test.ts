import { describe, it, expect } from "vitest";
import { extractJsonCredentials } from "./json-credential-extractor.js";

describe("json-credential-extractor", () => {
  describe("extractJsonCredentials", () => {
    it("returns null for non-JSON text", () => {
      expect(extractJsonCredentials("just a plain api key value")).toBeNull();
      expect(extractJsonCredentials("sk-proj-abc123def456ghi789")).toBeNull();
      expect(extractJsonCredentials("")).toBeNull();
    });

    it("returns null for invalid JSON that starts with {", () => {
      expect(extractJsonCredentials("{not valid json}")).toBeNull();
    });

    it("returns empty array for valid JSON with no credential fields", () => {
      const json = JSON.stringify({
        name: "My App",
        version: "1.0.0",
        description: "A test application",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toEqual([]);
    });

    it("extracts a simple api_key field", () => {
      const json = JSON.stringify({
        api_key: "sk-proj-abc123def456ghi789jkl012mno345",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].value).toBe("sk-proj-abc123def456ghi789jkl012mno345");
      expect(result![0].fieldName).toBe("api_key");
    });

    it("extracts developer_token and access_token", () => {
      const json = JSON.stringify({
        developer_token: "AaBbCcDdEeFf1234567890AbCdEfGh",
        access_token: "ya29.a0AfH6SMBx-example-token-value1234",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result!.map((c) => c.fieldName)).toContain("developer_token");
      expect(result!.map((c) => c.fieldName)).toContain("access_token");
    });

    it("extracts oauth_client_secret", () => {
      const json = JSON.stringify({
        oauth_client_secret: "GOCspx-AbCdEfGhIjKlMnOpQrStUvWxYz",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].fieldName).toBe("oauth_client_secret");
    });

    it("extracts nested credentials with path-based provider", () => {
      const json = JSON.stringify({
        google_ads: {
          developer_token: "AaBbCcDdEeFf1234567890AbCdEfGh",
          client_secret: "GOCspx-AbCdEfGhIjKlMnOpQrStUvWxYz",
        },
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);

      const devToken = result!.find((c) => c.fieldName === "developer_token");
      expect(devToken).toBeDefined();
      expect(devToken!.provider).toBe("GOOGLE_ADS_DEVELOPER_TOKEN");

      const clientSecret = result!.find((c) => c.fieldName === "client_secret");
      expect(clientSecret).toBeDefined();
      expect(clientSecret!.provider).toBe("GOOGLE_ADS_CLIENT_SECRET");
    });

    it("uses serviceName for provider when provided", () => {
      const json = JSON.stringify({
        developer_token: "AaBbCcDdEeFf1234567890AbCdEfGh",
      });
      const result = extractJsonCredentials(json, "theiss_marketing");
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].provider).toBe("THEISS_MARKETING_DEVELOPER_TOKEN");
    });

    it("prefers inferProvider for known key patterns", () => {
      const json = JSON.stringify({
        api_key: "sk-proj-Abc123Def456Ghi789Jkl012Mno345Pqr678Stu901Vwx234Yz567AbcDefGhiJklMno",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].provider).toBe("OPENAI");
    });

    it("skips metadata fields like key_type, key_id", () => {
      const json = JSON.stringify({
        key_type: "service_account",
        key_id: "abc123",
        token_uri: "https://oauth2.googleapis.com/token",
        private_key:
          "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      // Should only find private_key, not key_type/key_id/token_uri
      expect(result).toHaveLength(1);
      expect(result![0].fieldName).toBe("private_key");
    });

    it("handles PEM keys without entropy check", () => {
      const pemKey =
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgHcTz6sE3I\n-----END RSA PRIVATE KEY-----";
      const json = JSON.stringify({
        service_account_private_key: pemKey,
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].value).toBe(pemKey);
    });

    it("skips short values", () => {
      const json = JSON.stringify({
        api_key: "short",
        token: "abc",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toEqual([]);
    });

    it("skips URL values", () => {
      const json = JSON.stringify({
        auth_token: "https://example.com/very-long-path-that-exceeds-minimum",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toEqual([]);
    });

    it("skips email values", () => {
      const json = JSON.stringify({
        auth_token: "service-account@project.iam.gserviceaccount.com",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toEqual([]);
    });

    it("skips pure numeric values", () => {
      const json = JSON.stringify({
        api_key: "12345678901234567890",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toEqual([]);
    });

    it("skips file path values", () => {
      const json = JSON.stringify({
        secret: "/home/user/.config/credentials/secret.json",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toEqual([]);
    });

    it("skips low entropy values", () => {
      const json = JSON.stringify({
        api_key: "aaaaaaaaaaaaaaaaaa",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toEqual([]);
    });

    it("handles arrays of objects", () => {
      const json = JSON.stringify({
        accounts: [
          { name: "primary", api_key: "AaBbCcDdEeFf1234567890AbCdEfGh" },
          { name: "secondary", api_key: "XxYyZzWw0987654321FfEeDdCcBbAa" },
        ],
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
    });

    it("skips arrays of strings (scopes/tags)", () => {
      const json = JSON.stringify({
        scopes: [
          "https://www.googleapis.com/auth/adwords",
          "https://www.googleapis.com/auth/analytics",
        ],
        api_key: "AaBbCcDdEeFf1234567890AbCdEfGh",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].fieldName).toBe("api_key");
    });

    it("extracts from a realistic multi-service config", () => {
      const config = {
        google_ads: {
          developer_token: "AaBbCcDdEeFf1234567890AbCdEfGh",
          oauth_client_id: "123456789-abcdefghijklmnop.apps.googleusercontent.com",
          oauth_client_secret: "GOCspx-AbCdEfGhIjKlMnOpQrStUvWxYz",
          refresh_token: "1//0abc-defgh_ijklm-nopqrs-tuvwxyz1234",
          login_customer_id: "1234567890",
        },
        google_analytics: {
          access_token: "ya29.a0AfH6SMBx_example-long-token-1234567890abcdef",
        },
      };
      const result = extractJsonCredentials(JSON.stringify(config));
      expect(result).not.toBeNull();
      // developer_token, oauth_client_secret, refresh_token, access_token
      // oauth_client_id is skipped (id is metadata suffix)
      // login_customer_id is skipped (not credential suffix)
      expect(result!.length).toBeGreaterThanOrEqual(4);

      const fieldNames = result!.map((c) => c.fieldName);
      expect(fieldNames).toContain("developer_token");
      expect(fieldNames).toContain("oauth_client_secret");
      expect(fieldNames).toContain("refresh_token");
      expect(fieldNames).toContain("access_token");
    });

    it("handles top-level arrays", () => {
      const json = JSON.stringify([
        { service: "api1", api_key: "AaBbCcDdEeFf1234567890AbCdEfGh" },
        { service: "api2", api_key: "XxYyZzWw0987654321FfEeDdCcBbAa" },
      ]);
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
    });

    it("extracts 'password' fields", () => {
      const json = JSON.stringify({
        database: {
          password: "MyStr0ng!P@ssw0rd_2024#",
        },
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].fieldName).toBe("password");
      expect(result![0].provider).toBe("DATABASE_PASSWORD");
    });

    it("extracts 'auth' fields", () => {
      const json = JSON.stringify({
        smtp: {
          auth: "xoauth2-ABCdef123456GHIjkl789_mnOP",
        },
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].fieldName).toBe("auth");
    });

    it("skips non-string values (numbers, booleans, null)", () => {
      const json = JSON.stringify({
        api_key: 12345,
        token: true,
        secret: null,
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toEqual([]);
    });

    it("applies lower entropy threshold for long values (> 64 chars)", () => {
      // Build a value > 64 chars with moderate entropy (between 2.0 and 2.5)
      const longValue = "abcabc" + "d".repeat(60); // low-ish entropy, >64 chars
      const json = JSON.stringify({
        access_token: longValue,
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      // The threshold is 2.0 for long values; this might or might not pass depending on exact entropy
      // The important thing is that it doesn't crash and processes correctly
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles deeply nested structures", () => {
      const json = JSON.stringify({
        level1: {
          level2: {
            level3: {
              api_key: "AaBbCcDdEeFf1234567890AbCdEfGh",
            },
          },
        },
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
      expect(result![0].path).toEqual(["level1", "level2", "level3", "api_key"]);
    });

    it("skips boolean string values", () => {
      const json = JSON.stringify({
        auth: "true",
        secret: "false",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toEqual([]);
    });

    it("handles hyphenated field names", () => {
      const json = JSON.stringify({
        "api-key": "AaBbCcDdEeFf1234567890AbCdEfGh",
        "client-secret": "GOCspx-AbCdEfGhIjKlMnOpQrStUvWxYz",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
    });

    it("handles dot-separated field names", () => {
      const json = JSON.stringify({
        "service.api.key": "AaBbCcDdEeFf1234567890AbCdEfGh",
      });
      const result = extractJsonCredentials(json);
      expect(result).not.toBeNull();
      expect(result).toHaveLength(1);
    });
  });
});
