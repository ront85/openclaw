import type { GatewayRequestHandler } from "./types.js";
import { detectApiKeys } from "../../infra/guardian/api-key-detector.js";
import { storeApiKey } from "../../infra/guardian/env-manager.js";
import { createSecureInputToken, validateSecureInputToken } from "../secure-input-tokens.js";

/**
 * Create a secure input token for API key entry
 * POST /secure-input/create
 */
export const secureInputCreate: GatewayRequestHandler = async ({ params, respond }) => {
  const { agentId, channelId, discordChannelId } = params as {
    agentId: string;
    channelId?: string;
    discordChannelId?: string;
  };

  if (!agentId) {
    respond(false, undefined, { code: "INVALID_REQUEST", message: "agentId is required" });
    return;
  }

  const { token, url, expiresAt } = createSecureInputToken({
    agentId,
    channelId,
    discordChannelId,
    purpose: "apikey",
  });

  respond(true, {
    token,
    url,
    expiresAt,
    expiresIn: Math.floor((expiresAt - Date.now()) / 1000),
  });
};

/**
 * Submit API key via secure input
 * POST /secure-input/submit
 */
export const secureInputSubmit: GatewayRequestHandler = async ({ params, respond }) => {
  const { token, value } = params as {
    token: string;
    value: string;
  };

  if (!token || !value) {
    respond(false, undefined, {
      code: "INVALID_REQUEST",
      message: "token and value are required",
    });
    return;
  }

  // Validate token
  const tokenData = validateSecureInputToken(token);
  if (!tokenData) {
    respond(false, undefined, {
      code: "INVALID_REQUEST",
      message: "Invalid, expired, or already used token",
    });
    return;
  }

  // Detect API keys in the submitted value
  const detected = detectApiKeys(value, {
    enabled: true,
    tier1: "auto-filter",
    tier2: "auto-filter",
    tier3: "allow",
    minKeyLength: 18,
    entropyThreshold: 4.5,
  });

  if (detected.length === 0) {
    respond(false, undefined, {
      code: "INVALID_REQUEST",
      message: "No API keys detected in the provided input",
    });
    return;
  }

  // Store all detected keys
  const stored: Array<{ provider: string | null; varName: string }> = [];

  for (const key of detected) {
    const { varName } = await storeApiKey(
      key.value,
      key.provider,
      undefined, // Use default env path
      {
        agentId: tokenData.agentId,
        sessionKey: tokenData.channelId ?? "secure-input",
        hookType: "secure-input",
      },
    );

    stored.push({
      provider: key.provider,
      varName,
    });
  }

  respond(true, {
    stored,
    count: stored.length,
  });
};
