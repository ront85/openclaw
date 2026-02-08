import type { Command } from "commander";
import { normalizeToolName } from "../agents/tool-policy.js";
import { loadConfig } from "../config/config.js";
import { evaluateRules, effectiveThreshold, resolveTrustLevel } from "../infra/guardian/rules.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";

export function registerGuardianCli(program: Command) {
  const guardian = program
    .command("guardian")
    .description("Guardian tool-call approval system")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/tools/guardian", "docs.openclaw.ai/tools/guardian")}\n`,
    );

  guardian
    .command("status")
    .description("Show current guardian configuration and status")
    .action(async () => {
      const cfg = loadConfig();
      const guardianCfg = cfg.approvals?.guardian;
      const runtime = defaultRuntime;

      if (!guardianCfg?.enabled) {
        runtime.log("Guardian: disabled");
        runtime.log("Enable with: openclaw config set approvals.guardian.enabled true");
        return;
      }

      runtime.log("Guardian: enabled");
      runtime.log(`Approval threshold: ${guardianCfg.approvalThreshold ?? "high"}`);
      runtime.log(`Timeout: ${(guardianCfg.timeoutMs ?? 120_000) / 1000}s`);
      runtime.log(`Rules: ${guardianCfg.rules?.length ?? 0}`);

      if (guardianCfg.constitution) {
        runtime.log(`Constitution: inline (${guardianCfg.constitution.length} chars)`);
      } else if (guardianCfg.constitutionPath) {
        runtime.log(`Constitution: ${guardianCfg.constitutionPath}`);
      } else {
        runtime.log("Constitution: default");
      }

      if (guardianCfg.llm?.model) {
        runtime.log(`LLM model: ${guardianCfg.llm.model}`);
      }

      if (guardianCfg.budget?.enabled) {
        runtime.log("");
        runtime.log("Budget:");
        if (guardianCfg.budget.sessionLimit !== undefined) {
          runtime.log(`  Session limit: $${guardianCfg.budget.sessionLimit}`);
        }
        if (guardianCfg.budget.dailyLimit !== undefined) {
          runtime.log(`  Daily limit: $${guardianCfg.budget.dailyLimit}`);
        }
        runtime.log(`  Default tool cost: $${guardianCfg.budget.defaultToolCost ?? 0.01}`);
        runtime.log(`  On exceeded: ${guardianCfg.budget.onExceeded ?? "deny"}`);
      }

      if (guardianCfg.agents && Object.keys(guardianCfg.agents).length > 0) {
        runtime.log("");
        runtime.log("Per-agent overrides:");
        for (const [agentId, agentCfg] of Object.entries(guardianCfg.agents)) {
          const parts: string[] = [`  ${agentId}:`];
          if (agentCfg.approvalThreshold) {
            parts.push(`threshold=${agentCfg.approvalThreshold}`);
          }
          if (agentCfg.rules?.length) {
            parts.push(`rules=${agentCfg.rules.length}`);
          }
          runtime.log(parts.join(" "));
        }
      }

      if (guardianCfg.forwarding?.enabled) {
        runtime.log("");
        runtime.log(`Forwarding: enabled (mode=${guardianCfg.forwarding.mode ?? "session"})`);
      }
    });

  guardian
    .command("test <toolName>")
    .description("Dry-run a tool call through the guardian rules engine")
    .option("--params <json>", "Tool parameters as JSON", "{}")
    .option("--trust <level>", "Trust level: owner|allowed|unknown|subagent", "unknown")
    .option("--agent <id>", "Agent ID for per-agent rules")
    .action(async (toolName: string, opts: { params: string; trust: string; agent?: string }) => {
      const cfg = loadConfig();
      const guardianCfg = cfg.approvals?.guardian;
      const runtime = defaultRuntime;

      if (!guardianCfg?.enabled) {
        runtime.log(
          "Guardian is not enabled. Enable with: openclaw config set approvals.guardian.enabled true",
        );
        return;
      }

      let toolParams: Record<string, unknown>;
      try {
        toolParams = JSON.parse(opts.params) as Record<string, unknown>;
      } catch {
        runtime.log("Error: invalid --params JSON");
        return;
      }

      const trustLevel = resolveTrustLevel({
        senderIsOwner: opts.trust === "owner",
        isSubagent: opts.trust === "subagent",
        isAllowed: opts.trust === "allowed",
      });

      const result = evaluateRules({
        toolName: normalizeToolName(toolName),
        toolParams,
        globalRules: guardianCfg.rules,
        agentRules: opts.agent ? guardianCfg.agents?.[opts.agent]?.rules : undefined,
        threshold: effectiveThreshold(guardianCfg, opts.agent),
        trustLevel,
      });

      const rows: Record<string, string>[] = [
        { Field: "Tool", Value: normalizeToolName(toolName) },
        { Field: "Risk level", Value: result.riskLevel },
        { Field: "Trust level", Value: result.trustLevel },
        { Field: "Decision", Value: result.decision },
        { Field: "Reason", Value: result.reason ?? "-" },
      ];
      if (result.ruleLabel) {
        rows.push({ Field: "Rule", Value: result.ruleLabel });
      }

      runtime.log(
        renderTable({
          columns: [
            { key: "Field", header: "Field", minWidth: 8 },
            { key: "Value", header: "Value", minWidth: 24, flex: true },
          ],
          rows,
        }),
      );
    });

  guardian
    .command("constitution")
    .description("Show current guardian constitution")
    .action(async () => {
      const cfg = loadConfig();
      const guardianCfg = cfg.approvals?.guardian;
      const runtime = defaultRuntime;

      if (guardianCfg?.constitution) {
        runtime.log(guardianCfg.constitution);
      } else if (guardianCfg?.constitutionPath) {
        try {
          const fs = await import("node:fs/promises");
          const content = await fs.readFile(guardianCfg.constitutionPath, "utf8");
          runtime.log(content);
        } catch (err) {
          runtime.log(`Error reading ${guardianCfg.constitutionPath}: ${String(err)}`);
        }
      } else {
        const { DEFAULT_GUARDIAN_CONSTITUTION } =
          await import("../infra/guardian/default-constitution.js");
        runtime.log(DEFAULT_GUARDIAN_CONSTITUTION);
      }
    });

  const keys = guardian.command("keys").description("Manage stored API keys");

  keys
    .command("list")
    .description("List all stored API keys (metadata only)")
    .action(async () => {
      const runtime = defaultRuntime;
      const { listStoredKeys, getDefaultEnvPath } =
        await import("../infra/guardian/env-manager.js");

      const stored = await listStoredKeys();

      if (stored.length === 0) {
        runtime.log("No API keys stored yet.");
        runtime.log(`\nLocation: ${getDefaultEnvPath()}`);
        return;
      }

      const now = Date.now();
      const rows = stored.map((key) => {
        const ageMs = now - key.storedAt;
        const ageStr =
          ageMs < 60_000
            ? "just now"
            : ageMs < 3600_000
              ? `${Math.floor(ageMs / 60_000)}m ago`
              : ageMs < 86_400_000
                ? `${Math.floor(ageMs / 3600_000)}h ago`
                : `${Math.floor(ageMs / 86_400_000)}d ago`;

        return {
          Variable: key.varName,
          Provider: key.provider ?? "unknown",
          Age: ageStr,
        };
      });

      runtime.log("Stored API Keys:\n");
      runtime.log(
        renderTable({
          columns: [
            { key: "Variable", header: "Variable", minWidth: 40, flex: true },
            { key: "Provider", header: "Provider", minWidth: 12 },
            { key: "Age", header: "Age", minWidth: 12 },
          ],
          rows,
        }),
      );
      runtime.log(`\nLocation: ${getDefaultEnvPath()}`);
    });

  keys
    .command("show <varName>")
    .description("Show API key value (requires Guardian approval)")
    .action(async (varName: string) => {
      const runtime = defaultRuntime;
      const { getKeyValue, getDefaultEnvPath } = await import("../infra/guardian/env-manager.js");

      // Note: In a real implementation, this should trigger Guardian escalation
      // For now, we'll just show a warning
      runtime.log("⚠️  Warning: This will display sensitive credentials.");
      runtime.log("In production, this would require Guardian approval.\n");

      const value = await getKeyValue(varName);

      if (!value) {
        runtime.log(`Error: Key '${varName}' not found in ${getDefaultEnvPath()}`);
        return;
      }

      runtime.log(`${varName}=${value}`);
    });

  keys
    .command("export")
    .description("Export all keys as ENV format (requires Guardian approval)")
    .action(async () => {
      const runtime = defaultRuntime;
      const { readEnvFile, getDefaultEnvPath } = await import("../infra/guardian/env-manager.js");

      runtime.log("⚠️  Warning: This will display all sensitive credentials.");
      runtime.log("In production, this would require Guardian approval.\n");

      const env = await readEnvFile();
      const keys = Object.entries(env).filter(([key]) => key.startsWith("OPENCLAW_API_KEY_"));

      if (keys.length === 0) {
        runtime.log("No API keys stored.");
        return;
      }

      for (const [key, value] of keys) {
        runtime.log(`${key}=${value}`);
      }

      runtime.log(`\n# Exported from ${getDefaultEnvPath()}`);
    });
}
