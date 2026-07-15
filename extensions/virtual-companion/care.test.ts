import { describe, expect, it } from "vitest";
import { claimCareEvent, isWithinSleepWindow } from "./care.js";
import type { CompanionProfile } from "./state.js";
import { createCompanionStoresForTests } from "./test-helpers.js";

const profile: CompanionProfile = {
  version: 1,
  sessionKey: "agent:main:dm:alice",
  soul: {
    name: "Mira",
    relationship: "partner",
    traits: ["warm"],
    communicationStyle: "natural",
    boundaries: "respect consent",
  },
  mood: { label: "bright", valence: 1, energy: 70, updatedAt: 0 },
  routine: {
    timeZone: "UTC",
    sleepStart: "23:00",
    sleepEnd: "07:00",
    workStart: "09:00",
    workEnd: "18:00",
  },
  activatedAt: 0,
  updatedAt: 0,
};

describe("virtual companion care", () => {
  it("handles sleep windows across midnight", () => {
    expect(isWithinSleepWindow({ sleepStart: "23:00", sleepEnd: "07:00", minutes: 30 })).toBe(true);
    expect(isWithinSleepWindow({ sleepStart: "23:00", sleepEnd: "07:00", minutes: 8 * 60 })).toBe(false);
  });

  it("never plans care during the configured sleep window", async () => {
    const stores = createCompanionStoresForTests();
    await expect(
      claimCareEvent({
        stores,
        profile,
        now: new Date("2026-07-16T01:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();
  });

  it("claims at most one care event for the same local window", async () => {
    const stores = createCompanionStoresForTests();
    const now = new Date("2026-07-16T12:00:00.000Z");
    const first = await claimCareEvent({ stores, profile, now });
    const second = await claimCareEvent({ stores, profile, now });
    expect(second).toBeUndefined();
    expect(first === undefined || first.window === "lunch").toBe(true);
  });
});
