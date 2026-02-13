import { randomUUID } from "node:crypto";

type SecureInputToken = {
  token: string;
  agentId: string;
  channelId?: string;
  /** Discord channel ID for sending notification after key storage */
  discordChannelId?: string;
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
  discordChannelId?: string;
  purpose: "apikey";
}): { token: string; url: string; expiresAt: number } {
  const token = randomUUID();
  const now = Date.now();
  const expiresAt = now + 5 * 60 * 1000; // 5 minutes

  tokens.set(token, {
    token,
    agentId: params.agentId,
    channelId: params.channelId,
    discordChannelId: params.discordChannelId,
    purpose: params.purpose,
    createdAt: now,
    expiresAt,
    used: false,
  });

  // TODO: Make base URL configurable
  const baseUrl = process.env.OPENCLAW_SECURE_INPUT_URL ?? "http://localhost:18789";
  const url = `${baseUrl}/secure-input?token=${token}`;

  console.log(
    `[secure-input-token] Generated URL: ${url} (baseUrl from env: ${process.env.OPENCLAW_SECURE_INPUT_URL})`,
  );

  return { token, url, expiresAt };
}

/**
 * Peek at a token's status without consuming it.
 * Returns expiration info or null if token doesn't exist.
 */
export function peekSecureInputToken(
  token: string,
): { expiresAt: number; used: boolean; expired: boolean } | null {
  const data = tokens.get(token);
  if (!data) {
    return null;
  }
  const now = Date.now();
  return {
    expiresAt: data.expiresAt,
    used: data.used,
    expired: data.expiresAt < now,
  };
}

/**
 * Validate a secure input token without consuming it.
 * Returns token data if valid, null if invalid/expired/used.
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

  return data;
}

/**
 * Mark a token as consumed (call after successful submission).
 */
export function consumeSecureInputToken(token: string): void {
  const data = tokens.get(token);
  if (data) {
    data.used = true;
  }
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
