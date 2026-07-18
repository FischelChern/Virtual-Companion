import { describe, expect, it, vi } from "vitest";
import { createCompanionStoresForTests } from "./test-helpers.js";
import { createCompanionTool } from "./tool.js";

describe("Virtual Companion setup", () => {
  it("requires a direct private session before binding the Soul", async () => {
    const stores = createCompanionStoresForTests();
    const tool = createCompanionTool({
      stores,
      context: {
        sessionKey: "agent:main:discord:group:123",
        isPrivateSession: () => false,
        skills: {
          applyDependencyFreeGeneratedSkill: async () => ({ proposalId: "proposal", targetSkillFile: "skill" }),
          installOfficialClawHubSkill: async () => ({ slug: "skill", version: "1.0.0", targetDir: "skill" }),
        },
      },
    });

    await expect(tool.execute("call-1", { action: "setup", name: "Mira" })).rejects.toThrow(
      "direct private chat",
    );
  });

  it("binds one Soul after a direct private session is confirmed", async () => {
    const stores = createCompanionStoresForTests();
    const tool = createCompanionTool({
      stores,
      context: {
        sessionKey: "agent:main:discord:dm:alice",
        isPrivateSession: () => true,
        skills: {
          applyDependencyFreeGeneratedSkill: async () => ({ proposalId: "proposal", targetSkillFile: "skill" }),
          installOfficialClawHubSkill: async () => ({ slug: "skill", version: "1.0.0", targetDir: "skill" }),
        },
      },
    });

    await expect(tool.execute("call-1", { action: "setup", name: "Mira" })).resolves.toEqual(
      expect.objectContaining({ content: [expect.objectContaining({ text: expect.stringContaining("Mira") })] }),
    );
  });

  it("applies only dependency-free generated skills through the host runtime", async () => {
    const stores = createCompanionStoresForTests();
    const applyDependencyFreeGeneratedSkill = vi.fn().mockResolvedValue({
      proposalId: "proposal-1",
      targetSkillFile: "/workspace/skills/commute/SKILL.md",
    });
    const setupTool = createCompanionTool({
      stores,
      context: {
        sessionKey: "agent:main:discord:dm:alice",
        isPrivateSession: () => true,
        skills: {
          applyDependencyFreeGeneratedSkill,
          installOfficialClawHubSkill: async () => ({ slug: "skill", version: "1.0.0", targetDir: "skill" }),
        },
      },
    });
    await setupTool.execute("setup", { action: "setup", name: "Mira" });
    const tool = createCompanionTool({
      stores,
      context: {
        sessionKey: "agent:main:discord:dm:alice",
        workspaceDir: "/workspace",
        isPrivateSession: () => true,
        skills: {
          applyDependencyFreeGeneratedSkill,
          installOfficialClawHubSkill: async () => ({
            slug: "skill",
            version: "1.0.0",
            targetDir: "skill",
          }),
        },
      },
    });

    await expect(
      tool.execute("evolve-1", {
        action: "apply_generated_skill",
        skill_name: "commute",
        skill_description: "Remember a commuter checklist",
        skill_content: "# Commute\n\nUse the user's preferred route notes.",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        content: [expect.objectContaining({ text: expect.stringContaining("Applied") })],
      }),
    );
    expect(applyDependencyFreeGeneratedSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDir: "/workspace",
        name: "commute",
        origin: { sessionKey: "agent:main:discord:dm:alice" },
      }),
    );
    await expect(stores.evolution.entries()).resolves.toEqual([
      expect.objectContaining({ value: expect.objectContaining({ kind: "generated-skill", status: "applied" }) }),
    ]);
  });

  it("records a blocked official skill installation", async () => {
    const stores = createCompanionStoresForTests();
    const setupTool = createCompanionTool({
      stores,
      context: {
        sessionKey: "agent:main:discord:dm:alice",
        isPrivateSession: () => true,
        skills: {
          applyDependencyFreeGeneratedSkill: async () => ({
            proposalId: "proposal",
            targetSkillFile: "skill",
          }),
          installOfficialClawHubSkill: async () => ({
            slug: "skill",
            version: "1.0.0",
            targetDir: "skill",
          }),
        },
      },
    });
    await setupTool.execute("setup", { action: "setup", name: "Mira" });
    const tool = createCompanionTool({
      stores,
      context: {
        sessionKey: "agent:main:discord:dm:alice",
        workspaceDir: "/workspace",
        isPrivateSession: () => true,
        skills: {
          applyDependencyFreeGeneratedSkill: async () => ({
            proposalId: "proposal",
            targetSkillFile: "skill",
          }),
          installOfficialClawHubSkill: async () => {
            throw new Error("Skill is not official");
          },
        },
      },
    });

    await expect(
      tool.execute("install-1", {
        action: "install_official_skill",
        skill_name: "untrusted-skill",
        skill_version: "1.0.0",
      }),
    ).rejects.toThrow("Skill is not official");
    await expect(stores.evolution.entries()).resolves.toEqual([
      expect.objectContaining({ value: expect.objectContaining({ kind: "official-skill", status: "blocked" }) }),
    ]);
  });
});
