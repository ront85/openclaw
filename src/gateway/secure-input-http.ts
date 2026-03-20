import type { IncomingMessage, ServerResponse } from "node:http";
import { detectApiKeys } from "../infra/guardian/api-key-detector.js";
import {
  resolveAgentEnvPath,
  storeApiKey,
  listStoredKeysWithRedacted,
  deleteStoredKey,
} from "../infra/guardian/env-manager.js";
import {
  extractJsonCredentials,
  redactValue,
  redactJsonCredentials,
} from "../infra/guardian/json-credential-extractor.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { sendJson } from "./http-common.js";
import { renderSecureInputHtml } from "./secure-input-html.js";
import {
  lookupSecureInputToken,
  peekSecureInputToken,
  validateSecureInputToken,
  consumeSecureInputToken,
} from "./secure-input-tokens.js";

/**
 * Read the request body as a JSON object.
 */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Validate the X-Secure-Input-Token header matches the query param token.
 * Provides CSRF protection via CORS preflight.
 */
function validateTokenHeader(req: IncomingMessage, queryToken: string): boolean {
  const headerToken = req.headers["x-secure-input-token"];
  if (!headerToken) {
    return false;
  }
  const tokenStr = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  return tokenStr === queryToken;
}

/**
 * Handle secure-input HTTP requests following the requestStages pattern.
 * Returns true if the request was handled, false to pass to next stage.
 *
 * Routes:
 * - GET /secure-input — serve HTML SPA (public, no auth required)
 * - GET /api/secure-input/status — peek token status (token-authed)
 * - POST /api/secure-input/preview — preview extracted credentials (token-authed)
 * - POST /api/secure-input/submit — store selected keys (token-authed)
 * - GET /api/secure-input/keys — list stored keys (token-authed)
 * - DELETE /api/secure-input/keys — delete a stored key (token-authed)
 */
export async function handleSecureInputHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  _opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  // GET /secure-input — serve HTML SPA (public)
  if (pathname === "/secure-input" && req.method === "GET") {
    const html = renderSecureInputHtml();
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(html);
    return true;
  }

  // All /api/secure-input/* routes require a token query param
  if (!pathname.startsWith("/api/secure-input/")) {
    return false;
  }

  const queryToken = url.searchParams.get("token");
  if (!queryToken) {
    sendJson(res, 400, { success: false, error: "Missing token parameter" });
    return true;
  }

  // GET /api/secure-input/status — peek token status
  if (pathname === "/api/secure-input/status" && req.method === "GET") {
    const status = peekSecureInputToken(queryToken);
    if (!status) {
      sendJson(res, 200, { success: false, expired: true });
      return true;
    }
    sendJson(res, 200, {
      success: true,
      expiresAt: status.expiresAt,
      used: status.used,
      expired: status.expired,
    });
    return true;
  }

  // All remaining endpoints require X-Secure-Input-Token header
  if (!validateTokenHeader(req, queryToken)) {
    sendJson(res, 403, { success: false, error: "Missing or invalid X-Secure-Input-Token header" });
    return true;
  }

  // POST /api/secure-input/preview — preview extracted credentials
  if (pathname === "/api/secure-input/preview" && req.method === "POST") {
    return handlePreview(req, res, queryToken);
  }

  // POST /api/secure-input/submit — store selected keys
  if (pathname === "/api/secure-input/submit" && req.method === "POST") {
    return handleSubmit(req, res, queryToken);
  }

  // GET /api/secure-input/keys — list stored keys
  if (pathname === "/api/secure-input/keys" && req.method === "GET") {
    return handleListKeys(res, queryToken);
  }

  // DELETE /api/secure-input/keys — delete a stored key
  if (pathname === "/api/secure-input/keys" && req.method === "DELETE") {
    const varName = url.searchParams.get("varName");
    return handleDeleteKey(res, queryToken, varName);
  }

  // Unknown /api/secure-input/* route
  sendJson(res, 404, { success: false, error: "Not found" });
  return true;
}

async function handlePreview(
  req: IncomingMessage,
  res: ServerResponse,
  queryToken: string,
): Promise<boolean> {
  const tokenData = peekSecureInputToken(queryToken);
  if (!tokenData || tokenData.expired || tokenData.used) {
    sendJson(res, 400, { success: false, error: "Invalid, expired, or already used token" });
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { success: false, error: "Invalid JSON body" });
    return true;
  }

  const value = typeof body.value === "string" ? body.value.trim() : "";
  const serviceName = typeof body.serviceName === "string" ? body.serviceName.trim() : undefined;

  if (!value) {
    sendJson(res, 400, { success: false, error: "No input value provided" });
    return true;
  }

  // Try JSON-aware extraction first
  const jsonCredentials = extractJsonCredentials(value, serviceName);

  if (jsonCredentials !== null) {
    // Valid JSON input
    const extracted = jsonCredentials.map((cred, i) => ({
      index: i,
      fieldName: cred.fieldName,
      path: cred.path,
      provider: cred.provider,
      redactedValue: redactValue(cred.value),
      suggestedVarName: cred.provider ?? `KEY_${i + 1}`,
    }));

    const redactedInput =
      jsonCredentials.length > 0 ? redactJsonCredentials(value, jsonCredentials) : value;

    sendJson(res, 200, {
      success: true,
      data: {
        isJson: true,
        extracted,
        redactedInput,
      },
    });
    return true;
  }

  // Not JSON — use regex-based detection
  const detected = detectApiKeys(value, {
    enabled: true,
    tier1: "auto-filter",
    tier2: "auto-filter",
    tier3: "allow",
    minKeyLength: 18,
    entropyThreshold: 4.5,
  });

  const extracted = detected.map((key, i) => ({
    index: i,
    fieldName: key.provider ?? "unknown",
    path: [],
    provider: key.provider,
    redactedValue: redactValue(key.value),
    suggestedVarName: key.provider ? `${key.provider}_API_KEY` : `KEY_${i + 1}`,
  }));

  sendJson(res, 200, {
    success: true,
    data: {
      isJson: false,
      extracted,
      redactedInput: null,
    },
  });
  return true;
}

async function handleSubmit(
  req: IncomingMessage,
  res: ServerResponse,
  queryToken: string,
): Promise<boolean> {
  const tokenData = validateSecureInputToken(queryToken);
  if (!tokenData) {
    sendJson(res, 400, { success: false, error: "Invalid, expired, or already used token" });
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { success: false, error: "Invalid JSON body" });
    return true;
  }

  const value = typeof body.value === "string" ? body.value.trim() : "";
  const serviceName = typeof body.serviceName === "string" ? body.serviceName.trim() : undefined;
  const variableNames = body.variableNames as Record<string, string> | undefined;
  const removedIndices = body.removedIndices as number[] | undefined;
  const removedSet = new Set(removedIndices ?? []);

  if (!value) {
    sendJson(res, 400, { success: false, error: "No input value provided" });
    return true;
  }

  const envPath = resolveAgentEnvPath(tokenData.agentId);
  const stored: Array<{ provider: string | null; varName: string }> = [];

  // Try JSON-aware extraction
  const jsonCredentials = extractJsonCredentials(value, serviceName);

  if (jsonCredentials !== null && jsonCredentials.length > 0) {
    for (let i = 0; i < jsonCredentials.length; i++) {
      if (removedSet.has(i)) {
        continue;
      }
      const cred = jsonCredentials[i];
      const customVarName = variableNames?.[String(i)];
      const { varName } = await storeApiKey(
        cred.value,
        cred.provider,
        envPath,
        {
          agentId: tokenData.agentId,
          sessionKey: tokenData.channelId ?? "secure-input",
          hookType: "secure-input",
        },
        customVarName,
      );
      stored.push({ provider: cred.provider, varName });
    }
  } else {
    // Regex-based detection
    const detected = detectApiKeys(value, {
      enabled: true,
      tier1: "auto-filter",
      tier2: "auto-filter",
      tier3: "allow",
      minKeyLength: 18,
      entropyThreshold: 4.5,
    });

    for (let i = 0; i < detected.length; i++) {
      if (removedSet.has(i)) {
        continue;
      }
      const key = detected[i];
      const customVarName = variableNames?.[String(i)];
      const { varName } = await storeApiKey(
        key.value,
        serviceName || key.provider,
        envPath,
        {
          agentId: tokenData.agentId,
          sessionKey: tokenData.channelId ?? "secure-input",
          hookType: "secure-input",
        },
        customVarName,
      );
      stored.push({ provider: serviceName || key.provider, varName });
    }
  }

  if (stored.length === 0) {
    sendJson(res, 400, { success: false, error: "No keys stored (all removed or none detected)" });
    return true;
  }

  // Mark token as consumed after successful storage
  consumeSecureInputToken(queryToken);

  sendJson(res, 200, {
    success: true,
    data: {
      stored,
      count: stored.length,
    },
  });
  return true;
}

async function handleListKeys(res: ServerResponse, queryToken: string): Promise<boolean> {
  const lookup = lookupSecureInputToken(queryToken);
  if (!lookup) {
    sendJson(res, 400, { success: false, error: "Invalid token" });
    return true;
  }

  const envPath = resolveAgentEnvPath(lookup.agentId);
  const keys = await listStoredKeysWithRedacted(envPath);

  sendJson(res, 200, {
    success: true,
    data: { keys },
  });
  return true;
}

async function handleDeleteKey(
  res: ServerResponse,
  queryToken: string,
  varName: string | null,
): Promise<boolean> {
  if (!varName) {
    sendJson(res, 400, { success: false, error: "Missing varName parameter" });
    return true;
  }

  const lookup = lookupSecureInputToken(queryToken);
  if (!lookup) {
    sendJson(res, 400, { success: false, error: "Invalid token" });
    return true;
  }

  const envPath = resolveAgentEnvPath(lookup.agentId);
  const result = await deleteStoredKey(varName, envPath);

  if (!result.deleted) {
    sendJson(res, 404, { success: false, error: `Key ${varName} not found` });
    return true;
  }

  sendJson(res, 200, { success: true });
  return true;
}
