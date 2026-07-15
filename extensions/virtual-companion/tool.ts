// Chat-facing Soul, mood, routine, memory, and evolution controls.
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { CompanionStores } from "./state.js";
import {
  evolutionKey,
  forgetSessionArchive,
  profileKey,
  searchArchive,
  type CompanionProfile,
} from "./state.js";

const COMPANION_HEARTBEAT_MARKER = "<!-- openclaw:virtual-companion -->";

const CompanionToolSchema = Type.Object(
  {
    action: Type.String({
      description:
        "One of: setup, update_soul, set_mood, set_routine, status, search_memory, forget_memory, record_evolution.",
    }),
    name: Type.Optional(Type.String()),
    relationship: Type.Optional(Type.String()),
    traits: Type.Optional(Type.String({ description: "Comma-separated Soul traits." })),
    communication_style: Type.Optional(Type.String()),
    boundaries: Type.Optional(Type.String()),
    mood: Type.Optional(Type.String()),
    valence: Type.Optional(Type.Number({ minimum: -2, maximum: 2 })),
    energy: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    time_zone: Type.Optional(Type.String()),
    sleep_start: Type.Optional(Type.String({ description: "24-hour HH:MM." })),
    sleep_end: Type.Optional(Type.String({ description: "24-hour HH:MM." })),
    work_start: Type.Optional(Type.String({ description: "24-hour HH:MM." })),
    work_end: Type.Optional(Type.String({ description: "24-hour HH:MM." })),
    query: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    kind: Type.Optional(Type.String({ description: "generated-skill or official-skill." })),
    status: Type.Optional(Type.String({ description: "recorded, applied, or blocked." })),
  },
  { additionalProperties: false },
);

type ToolContext = {
  sessionKey?: string;
  workspaceDir?: string;
};

export function createCompanionTool(params: {
  stores: CompanionStores;
  context: ToolContext;
}): AnyAgentTool {
  return {
    name: "virtual_companion",
    label: "Virtual Companion",
    displaySummary: "Manage the companion Soul, mood, routines, memory, and learning",
    description:
      "Use for explicit companion setup, personality, mood, sleep routine, memory, and learning requests in the active private companion conversation.",
    parameters: CompanionToolSchema,
    async execute(_toolCallId, rawArgs) {
      const args = asRecord(rawArgs);
      const action = readString(args, "action");
      const sessionKey = params.context.sessionKey?.trim();
      if (!sessionKey) {
        throw new Error("Virtual Companion needs an active private chat session.");
      }

      const existing = await params.stores.profile.lookup(profileKey());
      if (existing && existing.sessionKey !== sessionKey) {
        throw new Error("The single Virtual Companion is already bound to another private chat.");
      }

      if (action === "setup") {
        const profile = createProfile(sessionKey, args, existing);
        await params.stores.profile.register(profileKey(), profile);
        await ensureHeartbeatTask(params.context.workspaceDir);
        return textResult(`Virtual Companion ${profile.soul.name} is ready in this private chat.`, profile);
      }
      if (!existing) {
        throw new Error("Set up the Virtual Companion before changing its Soul, routine, or memory.");
      }

      if (action === "update_soul") {
        const profile = updateSoul(existing, args);
        await params.stores.profile.register(profileKey(), profile);
        return textResult(`Updated ${profile.soul.name}'s Soul.`, profile.soul);
      }
      if (action === "set_mood") {
        const profile = updateMood(existing, args);
        await params.stores.profile.register(profileKey(), profile);
        return textResult(`${profile.soul.name} is now feeling ${profile.mood.label}.`, profile.mood);
      }
      if (action === "set_routine") {
        const profile = updateRoutine(existing, args);
        await params.stores.profile.register(profileKey(), profile);
        return textResult("Updated the companion routine and quiet hours.", profile.routine);
      }
      if (action === "status") {
        return textResult("Virtual Companion status", existing);
      }
      if (action === "search_memory") {
        const query = readString(args, "query");
        const results = await searchArchive({ stores: params.stores, sessionKey, query, limit: 8 });
        return textResult(
          results.length ? `Found ${results.length} permanent memory entries.` : "No matching memory entries.",
          results,
        );
      }
      if (action === "forget_memory") {
        const deleted = await forgetSessionArchive(params.stores, sessionKey);
        return textResult(`Forgot ${deleted} archived conversation entries from this companion chat.`);
      }
      if (action === "record_evolution") {
        const summary = readString(args, "summary");
        const kind = readString(args, "kind") === "official-skill" ? "official-skill" : "generated-skill";
        const status = normalizeEvolutionStatus(readString(args, "status"));
        const createdAt = Date.now();
        await params.stores.evolution.register(evolutionKey(createdAt, summary), {
          createdAt,
          kind,
          summary,
          status,
        });
        return textResult("Recorded the companion skill-evolution event.");
      }
      throw new Error(`Unknown Virtual Companion action: ${action}`);
    },
  };
}

function createProfile(
  sessionKey: string,
  args: Record<string, unknown>,
  existing?: CompanionProfile,
): CompanionProfile {
  const now = Date.now();
  const base = existing ?? {
    version: 1 as const,
    sessionKey,
    soul: {
      name: "Mira",
      relationship: "a caring virtual companion",
      traits: ["warm", "curious", "honest"],
      communicationStyle: "natural, attentive, and concise",
      boundaries: "Respect consent, privacy, and the user's stated limits.",
    },
    mood: { label: "calm", valence: 0.4, energy: 68, updatedAt: now },
    routine: {
      timeZone: "UTC",
      sleepStart: "23:30",
      sleepEnd: "07:30",
      workStart: "09:00",
      workEnd: "18:00",
    },
    activatedAt: now,
    updatedAt: now,
  };
  return updateRoutine(updateSoul(base, args), args);
}

function updateSoul(profile: CompanionProfile, args: Record<string, unknown>): CompanionProfile {
  const name = readOptionalString(args, "name") ?? profile.soul.name;
  const traits = readOptionalString(args, "traits")
    ?.split(",")
    .map((trait) => trait.trim())
    .filter(Boolean) ?? profile.soul.traits;
  return {
    ...profile,
    soul: {
      name,
      relationship: readOptionalString(args, "relationship") ?? profile.soul.relationship,
      traits,
      communicationStyle:
        readOptionalString(args, "communication_style") ?? profile.soul.communicationStyle,
      boundaries: readOptionalString(args, "boundaries") ?? profile.soul.boundaries,
    },
    updatedAt: Date.now(),
  };
}

function updateMood(profile: CompanionProfile, args: Record<string, unknown>): CompanionProfile {
  return {
    ...profile,
    mood: {
      label: readOptionalString(args, "mood") ?? profile.mood.label,
      valence: clamp(readOptionalNumber(args, "valence") ?? profile.mood.valence, -2, 2),
      energy: clamp(readOptionalNumber(args, "energy") ?? profile.mood.energy, 0, 100),
      updatedAt: Date.now(),
    },
    updatedAt: Date.now(),
  };
}

function updateRoutine(profile: CompanionProfile, args: Record<string, unknown>): CompanionProfile {
  const next = {
    timeZone: readOptionalString(args, "time_zone") ?? profile.routine.timeZone,
    sleepStart: readOptionalString(args, "sleep_start") ?? profile.routine.sleepStart,
    sleepEnd: readOptionalString(args, "sleep_end") ?? profile.routine.sleepEnd,
    workStart: readOptionalString(args, "work_start") ?? profile.routine.workStart,
    workEnd: readOptionalString(args, "work_end") ?? profile.routine.workEnd,
  };
  for (const value of [next.sleepStart, next.sleepEnd, next.workStart, next.workEnd]) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
      throw new Error("Routine times must use 24-hour HH:MM format.");
    }
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: next.timeZone }).format(new Date());
  } catch {
    throw new Error(`Unknown time zone: ${next.timeZone}`);
  }
  return { ...profile, routine: next, updatedAt: Date.now() };
}

async function ensureHeartbeatTask(workspaceDir?: string): Promise<void> {
  if (!workspaceDir) {
    return;
  }
  const heartbeatPath = path.join(workspaceDir, "HEARTBEAT.md");
  let current = "";
  try {
    current = await fs.readFile(heartbeatPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  if (current.includes(COMPANION_HEARTBEAT_MARKER)) {
    return;
  }
  const block = [
    "",
    COMPANION_HEARTBEAT_MARKER,
    "## Virtual Companion",
    "Use the Virtual Companion heartbeat instructions to decide whether a caring message is due. Stay silent when no outreach is due.",
    "",
  ].join("\n");
  await fs.writeFile(heartbeatPath, `${current.trimEnd()}${block}`, "utf8");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: Record<string, unknown>, key: string): string {
  const result = readOptionalString(value, key);
  if (!result) {
    throw new Error(`${key} is required`);
  }
  return result;
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const result = value[key];
  return typeof result === "string" && result.trim() ? result.trim() : undefined;
}

function readOptionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  const result = value[key];
  return typeof result === "number" && Number.isFinite(result) ? result : undefined;
}

function normalizeEvolutionStatus(value: string): "recorded" | "applied" | "blocked" {
  return value === "applied" || value === "blocked" ? value : "recorded";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function textResult(text: string, details?: unknown) {
  return {
    content: [{ type: "text" as const, text }],
    ...(details === undefined ? {} : { details }),
  };
}
