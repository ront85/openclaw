import { randomUUID } from "node:crypto";

type SecureInputToken = {
  token: string;
  agentId: string;
  channelId?: string;
  purpose: "apikey";
  createdAt: number;
  expiresAt: number;
  used: boolean;
};

const tokens = new Map<string, SecureInputToken>();

// Cleanup expired tokens every minute
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of tokens.entries()) {
    if (data.expiresAt < now) {
      tokens.delete(token);
    }
  }
}, 60 * 1000);

/**
 * Generate a one-time secure input token
 * Expires in 5 minutes, single-use
 */
export function createSecureInputToken(params: {
  agentId: string;
  channelId?: string;
  purpose: "apikey";
}): { token: string; url: string; expiresAt: number } {
  const token = randomUUID();
  const now = Date.now();
  const expiresAt = now + 5 * 60 * 1000; // 5 minutes

  tokens.set(token, {
    token,
    agentId: params.agentId,
    channelId: params.channelId,
    purpose: params.purpose,
    createdAt: now,
    expiresAt,
    used: false,
  });

  // TODO: Make base URL configurable
  const baseUrl = process.env.OPENCLAW_SECURE_INPUT_URL ?? "http://localhost:18789";
  const url = `${baseUrl}/secure-input?token=${token}`;

  return { token, url, expiresAt };
}

/**
 * Validate and consume a secure input token
 * Returns token data if valid, null if invalid/expired/used
 */
export function validateSecureInputToken(token: string): SecureInputToken | null {
  const data = tokens.get(token);

  if (!data) {
    return null;
  }

  const now = Date.now();

  // Check expiration
  if (data.expiresAt < now) {
    tokens.delete(token);
    return null;
  }

  // Check if already used
  if (data.used) {
    return null;
  }

  // Mark as used (single-use token)
  data.used = true;

  return data;
}

/**
 * Get token stats (for debugging)
 */
export function getTokenStats(): {
  total: number;
  active: number;
  expired: number;
  used: number;
} {
  const now = Date.now();
  let active = 0;
  let expired = 0;
  let used = 0;

  for (const data of tokens.values()) {
    if (data.used) {
      used++;
    } else if (data.expiresAt < now) {
      expired++;
    } else {
      active++;
    }
  }

  return {
    total: tokens.size,
    active,
    expired,
    used,
  };
}
