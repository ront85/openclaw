import type { PluginRegistry } from "../../plugins/registry.js";
import type { GuardianHumanApprovalFn } from "./hook.js";
import type { GuardianLLMCaller } from "./llm-evaluator.js";
import type { GuardianConfig } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { createBudgetTracker } from "./budget.js";
import { createGuardianHook } from "./hook.js";
import { createMessageFilterHook } from "./hooks/message-filter.js";

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

  // Register API key filtering hooks (if enabled)
  if (params.config.apiKeyDetection?.enabled !== false) {
    const messageFilter = createMessageFilterHook(params.config);

    // Note: Using type assertion because the hook handler signature is generic
    // Runtime behavior is correct; types don't perfectly align due to plugin hook variability
    params.registry.typedHooks.push({
      pluginId: "guardian",
      hookName: "message_received",
      handler: messageFilter as never,
      priority: 1100, // higher priority than guardian tool hook
      source: "built-in:guardian:api-key-filter",
    });

    params.registry.typedHooks.push({
      pluginId: "guardian",
      hookName: "message_sending",
      handler: messageFilter as never,
      priority: 1100,
      source: "built-in:guardian:api-key-filter",
    });

    params.registry.typedHooks.push({
      pluginId: "guardian",
      hookName: "tool_result_persist",
      handler: messageFilter as never,
      priority: 1100,
      source: "built-in:guardian:api-key-filter",
    });

    log.info("Guardian API key filter hooks registered");
  }
}
