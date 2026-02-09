import { z } from "zod";

const ExecApprovalForwardTargetSchema = z
  .object({
    channel: z.string().min(1),
    to: z.string().min(1),
    accountId: z.string().optional(),
    threadId: z.union([z.string(), z.number()]).optional(),
  })
  .strict();

const ExecApprovalForwardingSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.union([z.literal("session"), z.literal("targets"), z.literal("both")]).optional(),
    agentFilter: z.array(z.string()).optional(),
    sessionFilter: z.array(z.string()).optional(),
    targets: z.array(ExecApprovalForwardTargetSchema).optional(),
  })
  .strict()
  .optional();

const ApiKeyDetectionSchema = z
  .object({
    enabled: z.boolean().optional(),
    envPath: z.string().optional(),
    tier1: z.union([z.literal("auto-filter"), z.literal("prompt")]).optional(),
    tier2: z.union([z.literal("auto-filter"), z.literal("prompt"), z.literal("allow")]).optional(),
    tier3: z.union([z.literal("auto-filter"), z.literal("prompt"), z.literal("allow")]).optional(),
    minKeyLength: z.number().int().positive().optional(),
    entropyThreshold: z.number().positive().optional(),
    bufferWindowMs: z.number().int().positive().optional(),
    notifyUser: z.boolean().optional(),
    allowedPatterns: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

const GuardianRuleSchema = z
  .object({
    label: z.string().optional(),
    pattern: z.string().min(1),
    action: z.union([
      z.literal("allow"),
      z.literal("deny"),
      z.literal("tier2"),
      z.literal("tier3"),
    ]),
    riskLevel: z.union([z.literal("low"), z.literal("medium"), z.literal("high")]).optional(),
    trustLevel: z
      .union([z.literal("trusted"), z.literal("neutral"), z.literal("risky")])
      .optional(),
    reason: z.string().optional(),
  })
  .strict();

const GuardianBudgetConfigSchema = z
  .object({
    tokenWindowMs: z.number().int().positive().optional(),
    maxTokensPerWindow: z.number().int().positive().optional(),
    exceedAction: z.union([z.literal("deny"), z.literal("escalate")]).optional(),
  })
  .strict()
  .optional();

const GuardianAgentOverrideSchema = z
  .object({
    approvalThreshold: z
      .union([z.literal("low"), z.literal("medium"), z.literal("high")])
      .optional(),
    rules: z.array(GuardianRuleSchema).optional(),
    constitution: z.string().optional(),
    budget: GuardianBudgetConfigSchema,
  })
  .strict();

const GuardianSchema = z
  .object({
    enabled: z.boolean().optional(),
    approvalThreshold: z
      .union([z.literal("low"), z.literal("medium"), z.literal("high")])
      .optional(),
    timeoutMs: z.number().int().positive().optional(),
    rules: z.array(GuardianRuleSchema).optional(),
    constitution: z.string().optional(),
    budget: GuardianBudgetConfigSchema,
    apiKeyDetection: ApiKeyDetectionSchema,
    llm: z
      .object({
        provider: z.string().optional(),
        model: z.string().optional(),
      })
      .strict()
      .optional(),
    forwarding: ExecApprovalForwardingSchema,
    agents: z.record(z.string(), GuardianAgentOverrideSchema).optional(),
  })
  .strict()
  .optional();

export const ApprovalsSchema = z
  .object({
    exec: ExecApprovalForwardingSchema,
    guardian: GuardianSchema,
  })
  .strict()
  .optional();
