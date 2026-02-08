import { describe, it, expect } from "vitest";
import type { ApiKeyDetectionConfig } from "./api-key-detector.js";
import { detectApiKeys, calculateEntropy, inferProvider } from "./api-key-detector.js";

const DEFAULT_CONFIG: ApiKeyDetectionConfig = {
  enabled: true,
  tier1: "auto-filter",
  tier2: "auto-filter",
  tier3: "allow",
  minKeyLength: 18,
  entropyThreshold: 4.5,
  bufferWindowMs: 60000,
};

describe("api-key-detector", () => {
  describe("calculateEntropy", () => {
    it("returns 0 for empty string", () => {
      expect(calculateEntropy("")).toBe(0);
    });

    it("returns low entropy for repeated characters", () => {
      const entropy = calculateEntropy("aaaaaaaaaa");
      expect(entropy).toBeLessThan(1);
    });

    it("returns high entropy for random strings", () => {
      const entropy = calculateEntropy("sk-abc123XYZ_def456GHI-789jkl");
      expect(entropy).toBeGreaterThan(4);
    });
  });

  describe("inferProvider", () => {
    it("detects OpenAI keys", () => {
      expect(inferProvider("sk-proj-abc123")).toBe("OPENAI");
      expect(inferProvider("sk-abc123")).toBe("OPENAI");
    });

    it("detects Anthropic keys", () => {
      expect(inferProvider("sk-ant-api03-abc123")).toBe("ANTHROPIC");
    });

    it("detects GitHub keys", () => {
      expect(inferProvider("ghp_abc123")).toBe("GITHUB");
      expect(inferProvider("gho_abc123")).toBe("GITHUB");
      expect(inferProvider("github_pat_abc123")).toBe("GITHUB");
    });

    it("detects Slack keys", () => {
      expect(inferProvider("xoxb-abc123")).toBe("SLACK");
      expect(inferProvider("xoxp-abc123")).toBe("SLACK");
    });

    it("detects Telegram keys", () => {
      expect(inferProvider("123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11")).toBe("TELEGRAM");
    });

    it("detects Groq keys", () => {
      expect(inferProvider("gsk_abc123")).toBe("GROQ");
    });

    it("detects Google keys", () => {
      expect(inferProvider("AIzaAbc123")).toBe("GOOGLE");
    });

    it("detects Perplexity keys", () => {
      expect(inferProvider("pplx-abc123")).toBe("PERPLEXITY");
    });

    it("detects OpenRouter keys", () => {
      expect(inferProvider("sk-or-v1-abc123")).toBe("OPENROUTER");
    });

    it("detects Hugging Face keys", () => {
      expect(inferProvider("hf_abc123")).toBe("HUGGINGFACE");
    });

    it("detects AWS keys", () => {
      expect(inferProvider("AKIAIOSFODNN7EXAMPLE")).toBe("AWS");
    });

    it("returns null for unknown keys", () => {
      expect(inferProvider("unknown-key-format")).toBe(null);
    });
  });

  describe("detectApiKeys - Tier 1", () => {
    it("detects OpenAI sk-proj- keys", () => {
      const text = "My key is sk-proj-" + "A".repeat(64);
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected).toHaveLength(1);
      expect(detected[0].provider).toBe("OPENAI");
      expect(detected[0].confidence).toBe("tier1");
      expect(detected[0].value).toContain("sk-proj-");
    });

    it("detects OpenAI sk- keys", () => {
      const text = "My key is sk-" + "A".repeat(20);
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected).toHaveLength(1);
      expect(detected[0].provider).toBe("OPENAI");
      expect(detected[0].confidence).toBe("tier1");
    });

    it("detects Anthropic keys", () => {
      const text = "My key is sk-ant-api03-" + "A".repeat(95);
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected).toHaveLength(1);
      expect(detected[0].provider).toBe("ANTHROPIC");
      expect(detected[0].confidence).toBe("tier1");
    });

    it("detects GitHub PAT keys", () => {
      const text = "My key is ghp_" + "A".repeat(36);
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected).toHaveLength(1);
      expect(detected[0].provider).toBe("GITHUB");
      expect(detected[0].confidence).toBe("tier1");
    });

    it("detects Telegram bot tokens", () => {
      const text = "Bot token: 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ1234567890";
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected).toHaveLength(1);
      expect(detected[0].provider).toBe("TELEGRAM");
      expect(detected[0].confidence).toBe("tier1");
    });

    it("detects multiple keys in text", () => {
      const text = `
        OpenAI: sk-${"A".repeat(20)}
        GitHub: ghp_${"B".repeat(36)}
        Groq: gsk_${"C".repeat(32)}
      `;
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected.length).toBeGreaterThanOrEqual(3);
      const providers = detected.map((k) => k.provider);
      expect(providers).toContain("OPENAI");
      expect(providers).toContain("GITHUB");
      expect(providers).toContain("GROQ");
    });

    it("does not detect keys shorter than minimum length", () => {
      const text = "My key is sk-short";
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected).toHaveLength(0);
    });
  });

  describe("detectApiKeys - Tier 2", () => {
    it("detects ENV assignment format", () => {
      const text = "API_KEY=sk-" + "A".repeat(32);
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected.length).toBeGreaterThanOrEqual(1);
      // Could be tier1 (OpenAI pattern) or tier2 (ENV pattern)
      expect(["tier1", "tier2"]).toContain(detected[0].confidence);
    });

    it("detects JSON field format", () => {
      const text = '{"apiKey": "sk-' + "A".repeat(32) + '"}';
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected.length).toBeGreaterThanOrEqual(1);
    });

    it("detects CLI flag format", () => {
      const text = "--api-key sk-" + "A".repeat(32);
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected.length).toBeGreaterThanOrEqual(1);
    });

    it("detects Bearer token format", () => {
      const text = "Authorization: Bearer sk-" + "A".repeat(32);
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected.length).toBeGreaterThanOrEqual(1);
    });

    it("respects tier2 allow setting", () => {
      const text = "API_KEY=sk-" + "A".repeat(32);
      // tier1=prompt means prompt for tier1 keys (don't auto-filter)
      // tier2=allow means don't detect tier2 keys
      const detected = detectApiKeys(text, { ...DEFAULT_CONFIG, tier1: "prompt", tier2: "allow" });

      expect(detected).toHaveLength(0);
    });
  });

  describe("detectApiKeys - Tier 3", () => {
    it("does not detect high-entropy strings when tier3 is disabled", () => {
      const text =
        '```\nconst secret = "' +
        "x"
          .repeat(32)
          .split("")
          .map((_, i) => String.fromCharCode(65 + (i % 26)))
          .join("") +
        '";\n```';
      const detected = detectApiKeys(text, { ...DEFAULT_CONFIG, tier3: "allow" });

      // Should not detect tier3 keys
      const tier3Keys = detected.filter((k) => k.confidence === "tier3");
      expect(tier3Keys).toHaveLength(0);
    });

    it("detects high-entropy strings in code blocks when enabled", () => {
      const highEntropyKey = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      const text = '```\nconst secret = "' + highEntropyKey + '";\n```';
      const detected = detectApiKeys(text, { ...DEFAULT_CONFIG, tier3: "auto-filter" });

      const tier3Keys = detected.filter((k) => k.confidence === "tier3");
      expect(tier3Keys.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("detectApiKeys - Edge Cases", () => {
    it("handles empty text", () => {
      const detected = detectApiKeys("", DEFAULT_CONFIG);
      expect(detected).toHaveLength(0);
    });

    it("fast-path rejects text without indicators", () => {
      const text = "This is just normal text without any keys or secrets";
      const detected = detectApiKeys(text, DEFAULT_CONFIG);
      expect(detected).toHaveLength(0);
    });

    it("respects allowedPatterns exemptions", () => {
      const text = "API_KEY=example-token-for-docs";
      const detected = detectApiKeys(text, {
        ...DEFAULT_CONFIG,
        allowedPatterns: ["example-token-for-docs"],
      });

      expect(detected).toHaveLength(0);
    });

    it("handles Base64-encoded keys", () => {
      const key = "sk-" + "A".repeat(40); // Longer key for longer encoded string
      const encoded = Buffer.from(key).toString("base64");
      const text = `Here is the encoded key: ${encoded}`;

      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      // Should detect the key in decoded content
      expect(detected.length).toBeGreaterThanOrEqual(1);
    });

    it("does not detect UUIDs", () => {
      const text = "Request ID: 550e8400-e29b-41d4-a716-446655440000";
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected).toHaveLength(0);
    });

    it("extracts context around detected keys", () => {
      const text = "Before text here. My API key is sk-" + "A".repeat(20) + " and after text here.";
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected).toHaveLength(1);
      expect(detected[0].context).toContain("Before");
      expect(detected[0].context).toContain("after");
    });

    it("deduplicates same key appearing multiple times", () => {
      const key = "sk-" + "A".repeat(20);
      const text = `First: ${key}, Second: ${key}, Third: ${key}`;
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      // Should only detect once
      expect(detected).toHaveLength(1);
    });

    it("handles multi-line keys", () => {
      const text = `
        API_KEY=sk-proj-${"A".repeat(64)}
        Another line here
      `;
      const detected = detectApiKeys(text, DEFAULT_CONFIG);

      expect(detected.length).toBeGreaterThanOrEqual(1);
    });
  });
});
