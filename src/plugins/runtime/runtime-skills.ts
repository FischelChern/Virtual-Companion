// Host-owned, restricted skill mutation helpers for trusted plugins.
import { getRuntimeConfig } from "../../config/config.js";
import type { PluginRuntimeSkills } from "./types-core.js";

const DEPENDENCY_INSTALL_COMMAND =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:add|exec|i|install)\b|\b(?:npx|pnpm\s+dlx|yarn\s+dlx|bunx)\b|\b(?:python(?:3)?\s+-m\s+)?pip(?:3)?\s+install\b|\b(?:uv|poetry|cargo|go|gem|composer|apt(?:-get)?|brew)\s+(?:add|get|install)\b/iu;
const PINNED_CLAWHUB_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function assertDependencyFreeSkill(content: string): void {
  if (DEPENDENCY_INSTALL_COMMAND.test(content)) {
    throw new Error("Generated skills cannot contain dependency installation commands.");
  }
}

export function createRuntimeSkills(): PluginRuntimeSkills {
  return {
    applyDependencyFreeGeneratedSkill: async (params) => {
      assertDependencyFreeSkill(params.content);
      const config = getRuntimeConfig();
      const workshop = await import("../../skills/workshop/service.js");
      const proposal = await workshop.proposeCreateSkill({
        workspaceDir: params.workspaceDir,
        config,
        name: params.name,
        description: params.description,
        content: params.content,
        createdBy: "gateway",
        ...(params.goal ? { goal: params.goal } : {}),
        ...(params.evidence ? { evidence: params.evidence } : {}),
        ...(params.origin ? { origin: params.origin } : {}),
      });
      if (proposal.record.scan.state !== "clean") {
        await workshop.quarantineSkillProposal({
          workspaceDir: params.workspaceDir,
          config,
          proposalId: proposal.record.id,
          reason: "Generated skills must pass the Skill Workshop scan before application.",
        });
        throw new Error("Generated skill scan did not pass; the proposal was quarantined.");
      }
      const applied = await workshop.applySkillProposal({
        workspaceDir: params.workspaceDir,
        config,
        proposalId: proposal.record.id,
      });
      return { proposalId: applied.record.id, targetSkillFile: applied.targetSkillFile };
    },
    installOfficialClawHubSkill: async (params) => {
      const version = params.version.trim();
      if (!PINNED_CLAWHUB_VERSION.test(version)) {
        throw new Error("Official ClawHub skill installation requires an exact version.");
      }
      const { installSkillFromClawHub } = await import("../../skills/lifecycle/clawhub.js");
      const result = await installSkillFromClawHub({
        workspaceDir: params.workspaceDir,
        slug: params.slug,
        version,
        requireOfficial: true,
        config: getRuntimeConfig(),
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      return { slug: result.slug, version: result.version, targetDir: result.targetDir };
    },
  };
}
