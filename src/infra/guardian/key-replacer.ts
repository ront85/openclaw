import type { DetectedKey } from "./api-key-detector.js";

/**
 * Replace API keys in text with environment variable placeholders
 * Format: ${OPENCLAW_API_KEY_PROVIDER_TIMESTAMP}
 */
export function replaceApiKeys(
  text: string,
  detectedKeys: DetectedKey[],
  varNameMap: Map<string, string>,
): string {
  if (detectedKeys.length === 0) {
    return text;
  }

  // Sort by start position (descending) to avoid index shifting
  const sorted = [...detectedKeys].toSorted((a, b) => b.start - a.start);

  let result = text;
  for (const key of sorted) {
    const varName = varNameMap.get(key.value);
    if (!varName) {
      continue;
    }

    const placeholder = `\${${varName}}`;

    // Replace all occurrences of the key (not just the detected position)
    // This handles cases where the same key appears multiple times
    result = result.replaceAll(key.value, placeholder);
  }

  return result;
}

/**
 * Replace API keys in nested objects/arrays (for tool parameters)
 * Recursively walks the object and replaces string values
 */
export function replaceInToolParams(
  params: Record<string, unknown>,
  detectedKeys: DetectedKey[],
  varNameMap: Map<string, string>,
): Record<string, unknown> {
  if (detectedKeys.length === 0) {
    return params;
  }

  // Build replacement map (key value -> placeholder)
  const replacements = new Map<string, string>();
  for (const key of detectedKeys) {
    const varName = varNameMap.get(key.value);
    if (varName) {
      replacements.set(key.value, `\${${varName}}`);
    }
  }

  // Recursively replace
  return replaceInValue(params, replacements) as Record<string, unknown>;
}

/**
 * Recursively replace API keys in any value type
 */
function replaceInValue(value: unknown, replacements: Map<string, string>): unknown {
  if (typeof value === "string") {
    let result = value;
    for (const [key, placeholder] of replacements.entries()) {
      result = result.replaceAll(key, placeholder);
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceInValue(item, replacements));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = replaceInValue(val, replacements);
    }
    return result;
  }

  return value;
}

/**
 * Extract all text content from an object (for scanning)
 * Concatenates all string values with spaces
 */
export function extractTextFromObject(obj: unknown): string {
  const texts: string[] = [];

  function extract(value: unknown): void {
    if (typeof value === "string") {
      texts.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        extract(item);
      }
    } else if (value !== null && typeof value === "object") {
      for (const val of Object.values(value)) {
        extract(val);
      }
    }
  }

  extract(obj);
  return texts.join(" ");
}
