import type { GuardianConfig } from "../types.js";
import { detectApiKeys } from "../api-key-detector.js";
import { storeApiKey } from "../env-manager.js";
import { getKeyBuffer } from "../key-buffer.js";
import { replaceApiKeys, replaceInToolParams, extractTextFromObject } from "../key-replacer.js";

type HookContext = {
  hookName: string;
  payload: unknown;
  context: Record<string, unknown>;
};

/**
 * Create message filter hook for API key detection and filtering
 * Handles: message_received, message_sending, tool_result_persist
 */
export function createMessageFilterHook(config: GuardianConfig) {
  const apiKeyConfig = config.apiKeyDetection ?? {};

  // Disabled by default
  if (apiKeyConfig.enabled === false) {
    return async (context: HookContext) => context;
  }

  const buffer = getKeyBuffer();

  return async (context: HookContext) => {
    const hookType = context.hookName;

    // Extract text content based on hook type
    let textContent = "";
    let sessionKey = "";
    let agentId = "";

    if (hookType === "message_received" || hookType === "message_sending") {
      const message = context.payload as { text?: string; sessionKey?: string; agentId?: string };
      textContent = message.text ?? "";
      sessionKey = message.sessionKey ?? "";
      agentId = message.agentId ?? "";
    } else if (hookType === "tool_result_persist") {
      const payload = context.payload as {
        message?: unknown;
      };
      const ctx = context.context as { sessionKey?: string; agentId?: string } | undefined;
      textContent = extractTextFromObject(payload.message);
      sessionKey = ctx?.sessionKey ?? "";
      agentId = ctx?.agentId ?? "";
    }

    if (!textContent) {
      return context;
    }

    // Add to buffer (for split-key detection)
    if (sessionKey) {
      buffer.addMessage(sessionKey, textContent, Date.now());
    }

    // Detect API keys in current message
    const detected = detectApiKeys(textContent, apiKeyConfig);

    // Also check for split keys across buffered messages
    const splitKeys = sessionKey ? buffer.detectSplitKeys(sessionKey, apiKeyConfig) : [];
    const allDetected = [...detected, ...splitKeys];

    if (allDetected.length === 0) {
      return context;
    }

    // Filter keys based on tier configuration
    const keysToFilter = allDetected.filter((key) => {
      if (key.confidence === "tier1") {
        // tier1 defaults to auto-filter
        return apiKeyConfig.tier1 !== "prompt";
      }
      if (key.confidence === "tier2") {
        return apiKeyConfig.tier2 === "auto-filter" || apiKeyConfig.tier2 === "prompt";
      }
      if (key.confidence === "tier3") {
        return apiKeyConfig.tier3 === "auto-filter" || apiKeyConfig.tier3 === "prompt";
      }
      return false;
    });

    if (keysToFilter.length === 0) {
      return context;
    }

    // Store keys and build replacement map
    const varNameMap = new Map<string, string>();
    const source = { agentId, sessionKey, hookType };

    for (const key of keysToFilter) {
      const { varName } = await storeApiKey(key.value, key.provider, apiKeyConfig.envPath, source);
      varNameMap.set(key.value, varName);
    }

    // Replace keys in payload
    if (hookType === "message_received" || hookType === "message_sending") {
      const message = context.payload as { text?: string };
      if (
        message &&
        typeof message === "object" &&
        "text" in message &&
        typeof message.text === "string"
      ) {
        message.text = replaceApiKeys(message.text, keysToFilter, varNameMap);
      }
    } else if (hookType === "tool_result_persist") {
      const payload = context.payload as { message?: unknown };
      const message = payload?.message as Record<string, unknown> | undefined;

      if (!message) {
        return context;
      }

      // Replace in message content (handles user messages, assistant messages)
      if ("content" in message && typeof message.content === "string") {
        message.content = replaceApiKeys(message.content, keysToFilter, varNameMap);
      }

      // Replace in message text field (alternative content field)
      if ("text" in message && typeof message.text === "string") {
        message.text = replaceApiKeys(message.text, keysToFilter, varNameMap);
      }

      // Replace in tool use (input parameters)
      if (
        "type" in message &&
        message.type === "tool-use" &&
        "input" in message &&
        typeof message.input === "object"
      ) {
        message.input = replaceInToolParams(
          message.input as Record<string, unknown>,
          keysToFilter,
          varNameMap,
        );
      }

      // Replace in tool result (output content)
      if ("type" in message && message.type === "tool-result" && "content" in message) {
        if (typeof message.content === "string") {
          message.content = replaceApiKeys(message.content, keysToFilter, varNameMap);
        } else if (Array.isArray(message.content)) {
          for (const block of message.content) {
            if (
              block &&
              typeof block === "object" &&
              "type" in block &&
              block.type === "text" &&
              "text" in block &&
              typeof block.text === "string"
            ) {
              block.text = replaceApiKeys(block.text, keysToFilter, varNameMap);
            }
          }
        }
      }
    }

    // Optionally notify user
    if (apiKeyConfig.notifyUser && hookType === "message_received") {
      const varNames = Array.from(varNameMap.values());
      console.log(
        `🔒 Filtered ${varNames.length} API key(s) and stored securely in ~/.openclaw/.env`,
      );
    }

    return context;
  };
}

/**
 * Filter API keys from tool result (for session-tool-result-guard integration)
 */
export async function filterToolResultForApiKeys(
  message: unknown,
  meta: { sessionKey?: string; agentId?: string },
  config?: GuardianConfig,
): Promise<unknown> {
  if (!config?.apiKeyDetection?.enabled) {
    return message;
  }

  const hook = createMessageFilterHook(config);
  const hookContext = await hook({
    hookName: "tool_result_persist",
    payload: { message, meta },
    context: {},
  });

  return (hookContext.payload as { message: unknown }).message;
}
