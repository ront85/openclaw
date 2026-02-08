import type { PluginRegistry } from "../../plugins/registry.js";
import type { GuardianHumanApprovalFn } from "./hook.js";
import type { GuardianLLMCaller } from "./llm-evaluator.js";
import type { GuardianConfig } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { createBudgetTracker } from "./budget.js";
import { createGuardianHook } from "./hook.js";

const log = createSubsystemLogger("guardian");

export type GuardianRegistrationParams = {
  registry: PluginRegistry;
  config: GuardianConfig;
  agentId?: string;
  sessionKey?: string;
  senderIsOwner?: boolean;
  isSubagent?: boolean;
  isAllowed?: boolean;
  callLLM?: GuardianLLMCaller;
  requestHumanApproval?: GuardianHumanApprovalFn;
  budgetPath?: string;
};

/**
 * Register the guardian as a before_tool_call hook in the plugin registry.
 * Should be called during plugin/hook initialization when guardian is enabled.
 */
export function registerGuardianHook(params: GuardianRegistrationParams): void {
  if (!params.config.enabled) {
    return;
  }

  const budgetTracker = params.config.budget?.enabled
    ? createBudgetTracker(params.budgetPath)
    : undefined;

  const guardian = createGuardianHook({
    config: params.config,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    senderIsOwner: params.senderIsOwner,
    isSubagent: params.isSubagent,
    isAllowed: params.isAllowed,
    callLLM: params.callLLM,
    requestHumanApproval: params.requestHumanApproval,
    budgetTracker,
  });

  // Register as a high-priority before_tool_call hook
  params.registry.typedHooks.push({
    pluginId: "guardian",
    hookName: "before_tool_call",
    handler: guardian.handler,
    priority: 1000, // high priority: guardian runs before other hooks
    source: "built-in:guardian",
  });

  log.info("Guardian hook registered for before_tool_call");
}
