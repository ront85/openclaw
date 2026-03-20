import { randomUUID } from "node:crypto";

type SecureInputToken = {
  token: string;
  agentId: string;
  channelId?: string;
  /** Generic notification context for channel-agnostic delivery */
  notificationContext?: { channel?: string; sessionKey?: string };
  purpose: "apikey";
  createdAt: number;
  expiresAt: number;
  used: boolean;
};

const tokens = new Map<string, SecureInputToken>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/** Lazy-init the cleanup timer on first token creation */
function ensureCleanupTimer(): void {
  if (cleanupTimer) {
    return;
  }
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [token, data] of tokens.entries()) {
      if (data.expiresAt < now) {
        tokens.delete(token);
      }
    }
  }, 60 * 1000);
  // Don't block process exit
  cleanupTimer.unref();
}

/**
 * Generate a one-time secure input token.
 * Expires after `expiryMs` (default 5 minutes), single-use.
 */
export function createSecureInputToken(params: {
  agentId: string;
  channelId?: string;
  notificationContext?: { channel?: string; sessionKey?: string };
  purpose: "apikey";
  expiryMs?: number;
}): { token: string; url: string; expiresAt: number } {
  ensureCleanupTimer();

  const token = randomUUID();
  const now = Date.now();
  const expiryMs = params.expiryMs ?? 5 * 60 * 1000;
  const expiresAt = now + expiryMs;

  tokens.set(token, {
    token,
    agentId: params.agentId,
    channelId: params.channelId,
    notificationContext: params.notificationContext,
    purpose: params.purpose,
    createdAt: now,
    expiresAt,
    used: false,
  });

  // Use relative path — the gateway serves the HTML on the same host
  const baseUrl = process.env.OPENCLAW_SECURE_INPUT_URL ?? "http://localhost:18789";
  const url = `${baseUrl}/secure-input?token=${token}`;

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
 * Look up token data without enforcing used/expired checks.
 * Returns agentId even for consumed tokens (for key management endpoints).
 * Returns null only if the token doesn't exist at all.
 */
export function lookupSecureInputToken(
  token: string,
): { agentId: string; expired: boolean; used: boolean } | null {
  const data = tokens.get(token);
  if (!data) {
    return null;
  }
  return {
    agentId: data.agentId,
    expired: data.expiresAt < Date.now(),
    used: data.used,
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

/**
 * Dispose the cleanup timer and clear all tokens (for test cleanup).
 */
export function dispose(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  tokens.clear();
}
