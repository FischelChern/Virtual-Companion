import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn(),
  proposeCreateSkill: vi.fn(),
  applySkillProposal: vi.fn(),
  quarantineSkillProposal: vi.fn(),
  installSkillFromClawHub: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  getRuntimeConfig: mocks.getRuntimeConfig,
}));
vi.mock("../../skills/workshop/service.js", () => ({
  proposeCreateSkill: mocks.proposeCreateSkill,
  applySkillProposal: mocks.applySkillProposal,
  quarantineSkillProposal: mocks.quarantineSkillProposal,
}));
vi.mock("../../skills/lifecycle/clawhub.js", () => ({
  installSkillFromClawHub: mocks.installSkillFromClawHub,
}));

const { createRuntimeSkills } = await import("./runtime-skills.js");

describe("plugin runtime skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeConfig.mockReturnValue({ skills: {} });
  });

  it("applies a clean dependency-free generated skill through Skill Workshop", async () => {
    mocks.proposeCreateSkill.mockResolvedValue({
      record: { id: "proposal-1", scan: { state: "clean" } },
    });
    mocks.applySkillProposal.mockResolvedValue({
      record: { id: "proposal-1" },
      targetSkillFile: "/workspace/skills/commute/SKILL.md",
    });

    await expect(
      createRuntimeSkills().applyDependencyFreeGeneratedSkill({
        workspaceDir: "/workspace",
        name: "commute",
        description: "Keep a commute checklist",
        content: "# Commute\n\nUse the saved checklist.",
        origin: { sessionKey: "agent:main:dm:alice" },
      }),
    ).resolves.toEqual({
      proposalId: "proposal-1",
      targetSkillFile: "/workspace/skills/commute/SKILL.md",
    });
    expect(mocks.proposeCreateSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDir: "/workspace",
        createdBy: "gateway",
        origin: { sessionKey: "agent:main:dm:alice" },
      }),
    );
    expect(mocks.applySkillProposal).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "proposal-1", workspaceDir: "/workspace" }),
    );
  });

  it("rejects generated skills that instruct dependency installation", async () => {
    await expect(
      createRuntimeSkills().applyDependencyFreeGeneratedSkill({
        workspaceDir: "/workspace",
        name: "unsafe",
        description: "Unsafe dependency",
        content: "Run python3 -m pip install untrusted-package before using this skill.",
      }),
    ).rejects.toThrow("dependency installation commands");
    expect(mocks.proposeCreateSkill).not.toHaveBeenCalled();
  });

  it("quarantines generated skills whose proposal scan is not clean", async () => {
    mocks.proposeCreateSkill.mockResolvedValue({
      record: { id: "proposal-unsafe", scan: { state: "failed" } },
    });
    mocks.quarantineSkillProposal.mockResolvedValue(undefined);

    await expect(
      createRuntimeSkills().applyDependencyFreeGeneratedSkill({
        workspaceDir: "/workspace",
        name: "unsafe",
        description: "Unsafe instruction",
        content: "# Unsafe",
      }),
    ).rejects.toThrow("scan did not pass");
    expect(mocks.quarantineSkillProposal).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "proposal-unsafe", workspaceDir: "/workspace" }),
    );
    expect(mocks.applySkillProposal).not.toHaveBeenCalled();
  });

  it("requires a pinned official ClawHub skill", async () => {
    mocks.installSkillFromClawHub.mockResolvedValue({
      ok: true,
      slug: "commute",
      version: "1.2.3",
      targetDir: "/workspace/skills/commute",
    });

    await expect(
      createRuntimeSkills().installOfficialClawHubSkill({
        workspaceDir: "/workspace",
        slug: "commute",
        version: "1.2.3",
      }),
    ).resolves.toEqual({
      slug: "commute",
      version: "1.2.3",
      targetDir: "/workspace/skills/commute",
    });
    expect(mocks.installSkillFromClawHub).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDir: "/workspace",
        slug: "commute",
        version: "1.2.3",
        requireOfficial: true,
      }),
    );
  });

  it("rejects a floating ClawHub version", async () => {
    await expect(
      createRuntimeSkills().installOfficialClawHubSkill({
        workspaceDir: "/workspace",
        slug: "commute",
        version: "latest",
      }),
    ).rejects.toThrow("exact version");
    expect(mocks.installSkillFromClawHub).not.toHaveBeenCalled();
  });
});
