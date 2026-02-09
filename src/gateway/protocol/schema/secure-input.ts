import { Type } from "@sinclair/typebox";

/**
 * Params for creating a secure input token
 * Method: secure-input.create
 */
export const SecureInputCreateParamsSchema = Type.Object({
  agentId: Type.Optional(Type.String()),
  channelId: Type.Optional(Type.String()),
});

/**
 * Result from creating a secure input token
 */
export const SecureInputCreateResultSchema = Type.Object({
  token: Type.String(),
  url: Type.String(),
  expiresAt: Type.Number(),
});

/**
 * Params for submitting via secure input
 * Method: secure-input.submit
 */
export const SecureInputSubmitParamsSchema = Type.Object({
  token: Type.String(),
  value: Type.String(),
});

/**
 * Result from submitting via secure input
 */
export const SecureInputSubmitResultSchema = Type.Object({
  ok: Type.Boolean(),
  stored: Type.Array(
    Type.Object({
      varName: Type.String(),
      provider: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
});
