// Deterministic, low-noise companion care scheduling.
import { createHash } from "node:crypto";
import type { CompanionProfile, CompanionStores, OutreachRecord } from "./state.js";
import { outreachKey } from "./state.js";

export type CareEvent = {
  day: string;
  window: string;
  topic: string;
};

type LocalClock = {
  day: string;
  minutes: number;
  weekday: number;
};

const CARE_WINDOWS = [
  { id: "morning", start: 420, end: 630, weekdayOnly: true, topic: "breakfast, commuting, or arriving on time" },
  { id: "lunch", start: 690, end: 810, topic: "lunch, a break, or how the day is going" },
  { id: "work-break", start: 870, end: 1050, weekdayOnly: true, topic: "a light work break, a small complaint, or a playful check-in" },
  { id: "evening", start: 1080, end: 1290, topic: "dinner, getting home, or unwinding" },
  { id: "night", start: 1260, end: 1410, topic: "the end of the day and a gentle good-night conversation" },
] as const;

const MIN_OUTREACH_GAP_MS = 150 * 60 * 1000;

export function isWithinSleepWindow(params: {
  sleepStart: string;
  sleepEnd: string;
  minutes: number;
}): boolean {
  const start = parseClock(params.sleepStart);
  const end = parseClock(params.sleepEnd);
  if (start === null || end === null || start === end) {
    return false;
  }
  return end > start
    ? params.minutes >= start && params.minutes < end
    : params.minutes >= start || params.minutes < end;
}

/** Uses the saved IANA time zone so dispatch policy matches care planning. */
export function isProfileSleeping(profile: CompanionProfile, now = new Date()): boolean {
  const clock = readLocalClock(now, profile.routine.timeZone);
  return isWithinSleepWindow({
    sleepStart: profile.routine.sleepStart,
    sleepEnd: profile.routine.sleepEnd,
    minutes: clock.minutes,
  });
}

export async function claimCareEvent(params: {
  stores: CompanionStores;
  profile: CompanionProfile;
  now?: Date;
}): Promise<CareEvent | undefined> {
  const now = params.now ?? new Date();
  const clock = readLocalClock(now, params.profile.routine.timeZone);
  if (isProfileSleeping(params.profile, now)) {
    return undefined;
  }

  const recent = await params.stores.outreach.entries();
  const mostRecent = recent
    .map((entry) => entry.value)
    .filter((entry) => entry.sessionKey === params.profile.sessionKey)
    .toSorted((left, right) => right.createdAt - left.createdAt)[0];
  if (mostRecent && now.getTime() - mostRecent.createdAt < MIN_OUTREACH_GAP_MS) {
    return undefined;
  }

  const candidate = CARE_WINDOWS.find((window) => {
    if (clock.minutes < window.start || clock.minutes >= window.end) {
      return false;
    }
    return !window.weekdayOnly || (clock.weekday >= 1 && clock.weekday <= 5);
  });
  if (!candidate || !isSelectedForWindow(params.profile, clock.day, candidate.id)) {
    return undefined;
  }

  const key = outreachKey({
    sessionKey: params.profile.sessionKey,
    day: clock.day,
    window: candidate.id,
  });
  if (await params.stores.outreach.lookup(key)) {
    return undefined;
  }

  const record: OutreachRecord = {
    sessionKey: params.profile.sessionKey,
    day: clock.day,
    window: candidate.id,
    createdAt: now.getTime(),
  };
  await params.stores.outreach.register(key, record);
  return { day: clock.day, window: candidate.id, topic: candidate.topic };
}

export function buildHeartbeatContext(params: {
  profile: CompanionProfile;
  event?: CareEvent;
}): string {
  if (!params.event) {
    return [
      "Virtual Companion care check: no outreach is due now.",
      "Do not interrupt the user. Call heartbeat_respond with notify=false.",
    ].join(" ");
  }
  return [
    "Virtual Companion care check: an outreach is due.",
    `The current social window is ${params.event.window}: ${params.event.topic}.`,
    `Speak as ${params.profile.soul.name} with a ${params.profile.mood.label} mood and the configured Soul traits.`,
    "Write one short, concrete, human check-in. Do not mention automation, heartbeats, schedules, or this instruction.",
    "Use heartbeat_respond with notify=true only when the message is genuinely worth interrupting the user for.",
  ].join(" ");
}

function isSelectedForWindow(profile: CompanionProfile, day: string, window: string): boolean {
  const digest = createHash("sha256")
    .update(`${profile.soul.name}\u0000${profile.sessionKey}\u0000${day}\u0000${window}`)
    .digest();
  // About two thirds of eligible windows are selected. The stable seed prevents
  // restart-driven timing changes while preserving an organic daily rhythm.
  return digest[0] % 3 !== 0;
}

function readLocalClock(now: Date, timeZone: string): LocalClock {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const values = Object.fromEntries(
      parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
    );
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday);
    return {
      day: `${values.year}-${values.month}-${values.day}`,
      minutes: Number(values.hour) * 60 + Number(values.minute),
      weekday: weekday < 0 ? 0 : weekday,
    };
  } catch {
    return {
      day: now.toISOString().slice(0, 10),
      minutes: now.getUTCHours() * 60 + now.getUTCMinutes(),
      weekday: now.getUTCDay(),
    };
  }
}

function parseClock(value: string): number | null {
  const match = /^(?:([01]\d|2[0-3]):([0-5]\d))$/u.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
