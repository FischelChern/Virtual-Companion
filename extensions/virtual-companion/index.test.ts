import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import entry from "./index.js";
import { createCompanionStoreOpenerForTests } from "./test-helpers.js";

type Hook = (event: unknown, context: unknown) => unknown;

async function runHook(hook: Hook, event: unknown, context: unknown): Promise<unknown> {
  return await hook(event, context);
}

afterEach(() => {
  vi.useRealTimers();
});

function registerCompanion() {
  const hooks = new Map<string, Hook>();
  let toolFactory: ((context: { sessionKey?: string; workspaceDir?: string }) => AnyAgentTool) | undefined;
  entry.register({
    runtime: {
      state: {
        openKeyedStore: createCompanionStoreOpenerForTests(),
      },
    },
    registerTool: (tool: unknown) => {
      toolFactory = tool as typeof toolFactory;
    },
    on: (name: string, handler: Hook) => {
      hooks.set(name, handler);
    },
  } as never);
  return {
    hook(name: string): Hook {
      const hook = hooks.get(name);
      if (!hook) {
        throw new Error(`missing hook ${name}`);
      }
      return hook;
    },
    tool(context: { sessionKey?: string; workspaceDir?: string }): AnyAgentTool {
      if (!toolFactory) {
        throw new Error("missing companion tool factory");
      }
      return toolFactory(context);
    },
  };
}

describe("Virtual Companion runtime policy", () => {
  it("requires a cloud endpoint and keeps sleep suppression limited to heartbeats", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T01:00:00.000Z"));
    const companion = registerCompanion();
    const sessionKey = "agent:main:discord:dm:alice";
    await runHook(companion.hook("inbound_claim"), { isGroup: false }, { sessionKey });
    const tool = companion.tool({ sessionKey });
    await tool.execute("setup", {
      action: "setup",
      name: "Mira",
      time_zone: "UTC",
      sleep_start: "23:00",
      sleep_end: "07:00",
    });

    await expect(
      runHook(companion.hook("before_agent_run"), {}, { sessionKey, modelEndpointLocation: "local" }),
    ).resolves.toEqual(expect.objectContaining({ outcome: "block" }));
    await expect(
      runHook(companion.hook("before_agent_run"), {}, { sessionKey, modelEndpointLocation: "unknown" }),
    ).resolves.toEqual(expect.objectContaining({ outcome: "block" }));
    await expect(
      runHook(companion.hook("before_agent_run"), {}, { sessionKey, modelEndpointLocation: "external" }),
    ).resolves.toBeUndefined();
    await expect(
      runHook(companion.hook("message_sending"), {}, { sessionKey, trigger: "heartbeat" }),
    ).resolves.toEqual(expect.objectContaining({ cancel: true }));
    await expect(
      runHook(companion.hook("message_sending"), {}, { sessionKey, trigger: "user" }),
    ).resolves.toBeUndefined();
  });
});
