// Note: We define our own patterns instead of importing from redact.ts
// to avoid coupling and maintain tier-specific validation

export type DetectedKey = {
  value: string;
  start: number;
  end: number;
  provider: string | null;
  confidence: "tier1" | "tier2" | "tier3";
  pattern: string;
  context: string;
};

export type ApiKeyDetectionConfig = {
  enabled?: boolean;
  envPath?: string;
  tier1?: "auto-filter" | "prompt";
  tier2?: "auto-filter" | "prompt" | "allow";
  tier3?: "auto-filter" | "prompt" | "allow";
  minKeyLength?: number;
  entropyThreshold?: number;
  bufferWindowMs?: number;
  notifyUser?: boolean;
  allowedPatterns?: string[];
};

type PatternSpec = {
  pattern: RegExp;
  provider: string | null;
  confidence: "tier1" | "tier2" | "tier3";
  minLength?: number;
  validate?: (match: string) => boolean;
};

// Tier 1: High-confidence provider-specific patterns
const TIER1_PATTERNS: PatternSpec[] = [
  // OpenAI
  {
    pattern: /\bsk-proj-[A-Za-z0-9_-]{64,}\b/g,
    provider: "OPENAI",
    confidence: "tier1",
    minLength: 69,
  },
  {
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
    provider: "OPENAI",
    confidence: "tier1",
    minLength: 23,
  },
  // Anthropic
  {
    pattern: /\bsk-ant-api03-[A-Za-z0-9_-]{95,}\b/g,
    provider: "ANTHROPIC",
    confidence: "tier1",
    minLength: 108,
  },
  // GitHub
  {
    pattern: /\bghp_[A-Za-z0-9]{36,}\b/g,
    provider: "GITHUB",
    confidence: "tier1",
    minLength: 40,
  },
  {
    pattern: /\bgho_[A-Za-z0-9]{36,}\b/g,
    provider: "GITHUB",
    confidence: "tier1",
    minLength: 40,
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/g,
    provider: "GITHUB",
    confidence: "tier1",
    minLength: 93,
  },
  // Slack
  {
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    provider: "SLACK",
    confidence: "tier1",
    minLength: 15,
  },
  // Telegram
  {
    pattern: /\b\d{8,10}:[A-Za-z0-9_-]{35,}\b/g,
    provider: "TELEGRAM",
    confidence: "tier1",
    minLength: 44,
  },
  // Groq
  {
    pattern: /\bgsk_[A-Za-z0-9]{32,}\b/g,
    provider: "GROQ",
    confidence: "tier1",
    minLength: 36,
  },
  // Google
  {
    pattern: /\bAIza[A-Za-z0-9_-]{35,}\b/g,
    provider: "GOOGLE",
    confidence: "tier1",
    minLength: 39,
  },
  // Perplexity
  {
    pattern: /\bpplx-[A-Za-z0-9]{32,}\b/g,
    provider: "PERPLEXITY",
    confidence: "tier1",
    minLength: 37,
  },
  // OpenRouter
  {
    pattern: /\bsk-or-v1-[A-Za-z0-9]{32,}\b/g,
    provider: "OPENROUTER",
    confidence: "tier1",
    minLength: 41,
  },
  // Hugging Face
  {
    pattern: /\bhf_[A-Za-z0-9]{32,}\b/g,
    provider: "HUGGINGFACE",
    confidence: "tier1",
    minLength: 35,
  },
  // AWS
  {
    pattern: /AKIA[A-Z0-9]{16,}/g,
    provider: "AWS",
    confidence: "tier1",
    minLength: 20,
  },
  // Discord
  {
    pattern: /\b[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g,
    provider: "DISCORD",
    confidence: "tier1",
    minLength: 59,
  },
];

// Tier 2: Context-dependent patterns
const TIER2_PATTERNS: PatternSpec[] = [
  // ENV assignments: API_KEY=xxx, TOKEN=xxx
  {
    pattern:
      /(?:API_KEY|TOKEN|SECRET|PASSWORD|AUTH|BEARER)\s*[=:]\s*["']?([A-Za-z0-9_+/=.-]{18,})["']?/gi,
    provider: null,
    confidence: "tier2",
    minLength: 18,
    validate: (match) => {
      const value = match.split(/[=:]/)[1]?.trim().replace(/["']/g, "");
      return (value?.length ?? 0) >= 18;
    },
  },
  // JSON fields: "apiKey": "xxx"
  {
    pattern:
      /"(?:api[_-]?key|token|secret|password|auth|bearer)"\s*:\s*"([A-Za-z0-9_+/=.-]{18,})"/gi,
    provider: null,
    confidence: "tier2",
    minLength: 18,
  },
  // CLI flags: --api-key xxx, --token=xxx
  {
    pattern:
      /--(?:api[_-]?key|token|secret|password|auth)\s*[= ]\s*["']?([A-Za-z0-9_+/=.-]{18,})["']?/gi,
    provider: null,
    confidence: "tier2",
    minLength: 18,
  },
  // Bearer tokens
  {
    pattern: /Bearer\s+([A-Za-z0-9_+/=.-]{18,})/gi,
    provider: null,
    confidence: "tier2",
    minLength: 18,
  },
];

/**
 * Calculate Shannon entropy of a string (measure of randomness)
 * Higher entropy suggests more random/encrypted data
 */
export function calculateEntropy(str: string): number {
  if (str.length === 0) {
    return 0;
  }

  const freq = new Map<string, number>();
  for (const char of str) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Infer provider from key prefix/pattern
 */
export function inferProvider(key: string): string | null {
  if (key.startsWith("sk-proj-")) {
    return "OPENAI";
  }
  if (key.startsWith("sk-ant-")) {
    return "ANTHROPIC";
  }
  if (key.startsWith("sk-or-")) {
    return "OPENROUTER";
  }
  // Generic sk- (OpenAI fallback)
  if (key.startsWith("sk-")) {
    return "OPENAI";
  }
  if (key.startsWith("ghp_") || key.startsWith("gho_") || key.startsWith("github_pat_")) {
    return "GITHUB";
  }
  if (key.startsWith("xox")) {
    return "SLACK";
  }
  if (key.startsWith("gsk_")) {
    return "GROQ";
  }
  if (key.startsWith("AIza")) {
    return "GOOGLE";
  }
  if (key.startsWith("pplx-")) {
    return "PERPLEXITY";
  }
  if (key.startsWith("hf_")) {
    return "HUGGINGFACE";
  }
  if (key.startsWith("AKIA")) {
    return "AWS";
  }
  if (/^\d{8,10}:/.test(key)) {
    return "TELEGRAM";
  }

  // Check if it matches Discord token pattern (3 parts separated by dots)
  if (/^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}$/.test(key)) {
    return "DISCORD";
  }

  return null;
}

/**
 * Extract context around a match (50 chars before and after)
 */
function extractContext(text: string, start: number, end: number): string {
  const contextStart = Math.max(0, start - 50);
  const contextEnd = Math.min(text.length, end + 50);
  let context = text.slice(contextStart, contextEnd);

  if (contextStart > 0) {
    context = "..." + context;
  }
  if (contextEnd < text.length) {
    context = context + "...";
  }

  return context;
}

/**
 * Check if text should be skipped (no indicators present)
 */
function shouldSkipScan(text: string): boolean {
  // Fast-path rejection: no key/token/secret keywords
  if (
    !/\b(key|token|secret|password|auth|api|bearer|sk-|ghp_|xox|AIza|gsk_|pplx-|hf_|AKIA)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Decode Base64 strings and scan for keys
 */
function detectInBase64(
  text: string,
  config: ApiKeyDetectionConfig,
  seenValues: Set<string>,
): DetectedKey[] {
  const detected: DetectedKey[] = [];
  const base64Pattern = /([A-Za-z0-9+/]{40,}={0,2})/g;

  let match: RegExpExecArray | null;
  while ((match = base64Pattern.exec(text)) !== null) {
    try {
      const decoded = Buffer.from(match[1], "base64").toString("utf-8");

      // Recursively scan decoded content (but don't recurse into base64 again)
      const tempConfig = { ...config };
      const decodedKeys = detectInBase64Inner(decoded, tempConfig);

      // Add detected keys from decoded content
      for (const key of decodedKeys) {
        if (!seenValues.has(key.value)) {
          detected.push({
            ...key,
            start: match.index,
            end: match.index + match[1].length,
            context: extractContext(text, match.index, match.index + match[1].length),
          });
        }
      }
    } catch {
      // Not valid Base64 or not UTF-8, skip
    }
  }

  return detected;
}

/**
 * Inner helper that detects keys without base64 recursion
 */
function detectInBase64Inner(text: string, config: ApiKeyDetectionConfig): DetectedKey[] {
  const minKeyLength = config.minKeyLength ?? 18;
  const detected: DetectedKey[] = [];

  // Only scan tier1 patterns in base64 (high confidence only)
  if (config.tier1 !== "prompt") {
    for (const spec of TIER1_PATTERNS) {
      const regex = new RegExp(spec.pattern.source, spec.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const value = match[0];

        if (spec.minLength && value.length < spec.minLength) {
          continue;
        }

        if (spec.validate && !spec.validate(value)) {
          continue;
        }

        detected.push({
          value,
          start: match.index,
          end: match.index + value.length,
          provider: spec.provider ?? inferProvider(value),
          confidence: spec.confidence,
          pattern: spec.pattern.source,
          context: extractContext(text, match.index, match.index + value.length),
        });
      }
    }
  }

  return detected;
}

/**
 * Detect API keys in text with tiered confidence scoring
 */
export function detectApiKeys(text: string, config: ApiKeyDetectionConfig): DetectedKey[] {
  const minKeyLength = config.minKeyLength ?? 18;
  const entropyThreshold = config.entropyThreshold ?? 4.5;
  const allowedPatterns = config.allowedPatterns ?? [];

  // Fast-path rejection
  if (shouldSkipScan(text)) {
    return [];
  }

  const detected: DetectedKey[] = [];
  const seenValues = new Set<string>();

  // Tier 1: High-confidence provider patterns
  if (config.tier1 !== "prompt") {
    for (const spec of TIER1_PATTERNS) {
      const regex = new RegExp(spec.pattern.source, spec.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const value = match[0];

        // Skip if already detected or in allowlist
        if (seenValues.has(value) || allowedPatterns.includes(value)) {
          continue;
        }

        // Validate length
        if (spec.minLength && value.length < spec.minLength) {
          continue;
        }

        // Custom validation
        if (spec.validate && !spec.validate(value)) {
          continue;
        }

        seenValues.add(value);
        detected.push({
          value,
          start: match.index,
          end: match.index + value.length,
          provider: spec.provider ?? inferProvider(value),
          confidence: spec.confidence,
          pattern: spec.pattern.source,
          context: extractContext(text, match.index, match.index + value.length),
        });
      }
    }
  }

  // Tier 2: Context-dependent patterns
  if (config.tier2 === "auto-filter" || config.tier2 === "prompt") {
    for (const spec of TIER2_PATTERNS) {
      const regex = new RegExp(spec.pattern.source, spec.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        // Extract the actual key value from capture group
        let value = match[1];

        // If no capture group, try to extract from full match
        if (!value && match[0]) {
          // For patterns like "API_KEY=xxx", extract the value part
          const eqMatch = match[0].match(/[=:]\s*["']?([A-Za-z0-9_+/=.-]{18,})["']?$/);
          if (eqMatch?.[1]) {
            value = eqMatch[1].replace(/["']/g, "");
          } else {
            value = match[0];
          }
        }

        // Skip if no value or already detected or in allowlist
        if (!value || seenValues.has(value) || allowedPatterns.includes(value)) {
          continue;
        }

        // Validate length
        if (value.length < minKeyLength) {
          continue;
        }

        // Custom validation
        if (spec.validate && !spec.validate(match[0])) {
          continue;
        }

        seenValues.add(value);
        detected.push({
          value,
          start: match.index,
          end: match.index + match[0].length,
          provider: spec.provider ?? inferProvider(value),
          confidence: spec.confidence,
          pattern: spec.pattern.source,
          context: extractContext(text, match.index, match.index + match[0].length),
        });
      }
    }
  }

  // Tier 3: High-entropy strings in code contexts (disabled by default)
  if (config.tier3 === "auto-filter" || config.tier3 === "prompt") {
    // Extract code blocks (fenced and inline)
    const codeBlockPattern = /```[\s\S]*?```|`[^`]+`/g;
    let codeMatch: RegExpExecArray | null;

    while ((codeMatch = codeBlockPattern.exec(text)) !== null) {
      const codeText = codeMatch[0];
      const words = codeText.split(/[\s"'`,;:(){}[\]]+/);

      for (const word of words) {
        if (word.length < 24 || seenValues.has(word) || allowedPatterns.includes(word)) {
          continue;
        }

        const entropy = calculateEntropy(word);
        if (entropy >= entropyThreshold) {
          seenValues.add(word);
          detected.push({
            value: word,
            start: codeMatch.index,
            end: codeMatch.index + codeText.length,
            provider: inferProvider(word),
            confidence: "tier3",
            pattern: "high-entropy",
            context: extractContext(text, codeMatch.index, codeMatch.index + codeText.length),
          });
        }
      }
    }
  }

  // Also check for Base64-encoded keys
  const base64Keys = detectInBase64(text, config, seenValues);
  for (const key of base64Keys) {
    if (!seenValues.has(key.value)) {
      seenValues.add(key.value);
      detected.push(key);
    }
  }

  return detected;
}
