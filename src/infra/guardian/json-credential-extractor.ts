import { calculateEntropy, inferProvider } from "./api-key-detector.js";

export type ExtractedCredential = {
  value: string;
  fieldName: string;
  provider: string | null;
  path: string[];
};

/**
 * Credential-like field name suffixes.
 * If the last meaningful token of a field name is one of these, it's likely a credential.
 */
const CREDENTIAL_SUFFIXES = new Set(["token", "key", "secret", "password", "credential", "auth"]);

/**
 * When the credential suffix is NOT the last token, skip if the last token is metadata.
 */
const METADATA_LAST_TOKENS = new Set([
  "type",
  "name",
  "id",
  "url",
  "uri",
  "format",
  "length",
  "count",
  "expires",
  "scope",
  "version",
  "file",
  "path",
  "algorithm",
  "encoding",
]);

/**
 * Check if a field name looks like a credential field.
 */
function isCredentialField(fieldName: string): boolean {
  const tokens = fieldName
    .toLowerCase()
    .split(/[_\-.]/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  const lastToken = tokens[tokens.length - 1];

  // Direct match: last token is a credential suffix
  if (CREDENTIAL_SUFFIXES.has(lastToken)) {
    return true;
  }

  // Check if ANY token is a credential suffix
  const hasCredSuffix = tokens.some((t) => CREDENTIAL_SUFFIXES.has(t));
  if (!hasCredSuffix) {
    return false;
  }

  // Has a credential suffix but it's not last — skip if last token is metadata
  if (METADATA_LAST_TOKENS.has(lastToken)) {
    return false;
  }

  // "private_key" is a special compound that should match
  if (tokens.includes("private") && tokens.includes("key")) {
    return true;
  }

  return true;
}

/**
 * Check if a string value is viable as a credential.
 * Skips URLs, emails, pure numbers, booleans, file paths.
 */
function isViableValue(value: string): boolean {
  if (value.length < 8) {
    return false;
  }

  // Skip URLs
  if (/^https?:\/\//i.test(value)) {
    return false;
  }

  // Skip emails
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return false;
  }

  // Skip pure numeric
  if (/^\d+$/.test(value)) {
    return false;
  }

  // Skip boolean strings
  if (value === "true" || value === "false") {
    return false;
  }

  // Skip file paths
  if (/^[/~.]/.test(value) && /\//.test(value)) {
    return false;
  }

  // PEM keys — skip entropy check
  if (value.startsWith("-----BEGIN")) {
    return true;
  }

  // Entropy check
  const entropy = calculateEntropy(value);
  const threshold = value.length > 64 ? 2.0 : 2.5;
  if (entropy < threshold) {
    return false;
  }

  return true;
}

/**
 * Build a provider/var-name prefix from context.
 * - If serviceName provided: "SERVICENAME_FIELDNAME"
 * - Otherwise: "PARENTKEY_FIELDNAME" (from path)
 */
function deriveProvider(
  fieldName: string,
  path: string[],
  serviceName?: string,
  value?: string,
): string | null {
  // First try to infer from the value itself (e.g. sk-proj-... → OPENAI)
  if (value) {
    const fromValue = inferProvider(value);
    if (fromValue) {
      return fromValue;
    }
  }

  const upperField = fieldName.toUpperCase().replace(/[^A-Z0-9]/g, "_");

  if (serviceName) {
    const upperService = serviceName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    return `${upperService}_${upperField}`;
  }

  // Use parent key from path if available
  if (path.length > 0) {
    const parentKey = path[path.length - 1];
    // Skip numeric array indices
    if (!/^\d+$/.test(parentKey)) {
      const upperParent = parentKey.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      return `${upperParent}_${upperField}`;
    }
    // Walk up to find a non-numeric parent
    for (let i = path.length - 2; i >= 0; i--) {
      if (!/^\d+$/.test(path[i])) {
        const upperParent = path[i].toUpperCase().replace(/[^A-Z0-9]/g, "_");
        return `${upperParent}_${upperField}`;
      }
    }
  }

  return upperField;
}

/**
 * Recursively walk a parsed JSON value, extracting credential-like string leaves.
 */
function walkObject(
  obj: unknown,
  path: string[],
  serviceName: string | undefined,
  results: ExtractedCredential[],
): void {
  if (obj === null || obj === undefined) {
    return;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      // Arrays of strings: skip (likely scopes, tags, etc.)
      if (typeof item === "string") {
        continue;
      }
      // Arrays of objects: recurse into each
      if (typeof item === "object" && item !== null) {
        walkObject(item, [...path, String(i)], serviceName, results);
      }
    }
    return;
  }

  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === "string") {
        if (isCredentialField(key) && isViableValue(value)) {
          results.push({
            value,
            fieldName: key,
            provider: deriveProvider(key, path, serviceName, value),
            path: [...path, key],
          });
        }
      } else if (typeof value === "object" && value !== null) {
        walkObject(value, [...path, key], serviceName, results);
      }
    }
  }
}

/**
 * Extract credentials from JSON text.
 *
 * Returns `null` if the text is not valid JSON (caller should fall through to regex-based detection).
 * Returns an empty array if valid JSON but no credentials found.
 * Returns extracted credentials if found.
 */
export function extractJsonCredentials(
  text: string,
  serviceName?: string,
): ExtractedCredential[] | null {
  const trimmed = text.trim();

  // Quick check: must start with { or [
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const results: ExtractedCredential[] = [];
  walkObject(parsed, [], serviceName, results);
  return results;
}
