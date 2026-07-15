// Persistent state helpers for the virtual companion plugin.
import { createHash } from "node:crypto";
import type {
  OpenKeyedStoreOptions,
  PluginStateKeyedStore,
} from "openclaw/plugin-sdk/plugin-state-runtime";

const MAX_ARCHIVE_ENTRIES = 12_000;
const MAX_ARCHIVE_CHUNKS = 28_000;
const MAX_ATTACHMENT_ENTRIES = 24_000;
const MAX_ATTACHMENT_CHUNKS = 28_000;
const MAX_TEXT_CHUNK_BYTES = 48 * 1024;

export type CompanionMood = {
  label: string;
  valence: number;
  energy: number;
  updatedAt: number;
};

export type CompanionRoutine = {
  timeZone: string;
  sleepStart: string;
  sleepEnd: string;
  workStart: string;
  workEnd: string;
};

export type CompanionSoul = {
  name: string;
  relationship: string;
  traits: string[];
  communicationStyle: string;
  boundaries: string;
};

export type CompanionProfile = {
  version: 1;
  sessionKey: string;
  soul: CompanionSoul;
  mood: CompanionMood;
  routine: CompanionRoutine;
  activatedAt: number;
  updatedAt: number;
};

export type ArchivedMessage = {
  sessionKey: string;
  role: "user" | "assistant";
  createdAt: number;
  chunkCount: number;
  attachmentSummary?: string;
};

export type ArchiveChunk = {
  index: number;
  text: string;
};

export type ArchivedAttachment = {
  messageKey: string;
  index: number;
  type: string;
  byteLength: number;
  contentHash: string;
  chunkCount: number;
  mimeType?: string;
  sourceUrl?: string;
};

export type ArchivedAttachmentChunk = {
  index: number;
  text: string;
};

export type ArchivedAttachmentInput = {
  type: string;
  content?: string;
  mimeType?: string;
  sourceUrl?: string;
};

export type OutreachRecord = {
  sessionKey: string;
  day: string;
  window: string;
  createdAt: number;
};

export type EvolutionRecord = {
  createdAt: number;
  kind: "generated-skill" | "official-skill";
  summary: string;
  status: "recorded" | "applied" | "blocked";
};

type OpenStore = <T>(options: OpenKeyedStoreOptions) => PluginStateKeyedStore<T>;

export type CompanionStores = {
  profile: PluginStateKeyedStore<CompanionProfile>;
  archive: PluginStateKeyedStore<ArchivedMessage>;
  chunks: PluginStateKeyedStore<ArchiveChunk>;
  attachments: PluginStateKeyedStore<ArchivedAttachment>;
  attachmentChunks: PluginStateKeyedStore<ArchivedAttachmentChunk>;
  outreach: PluginStateKeyedStore<OutreachRecord>;
  evolution: PluginStateKeyedStore<EvolutionRecord>;
};

export function createCompanionStores(openStore: OpenStore): CompanionStores {
  return {
    profile: openStore({
      namespace: "virtual-companion-profile",
      maxEntries: 4,
      overflowPolicy: "reject-new",
    }),
    archive: openStore({
      namespace: "virtual-companion-archive",
      maxEntries: MAX_ARCHIVE_ENTRIES,
      overflowPolicy: "reject-new",
    }),
    chunks: openStore({
      namespace: "virtual-companion-archive-chunks",
      maxEntries: MAX_ARCHIVE_CHUNKS,
      overflowPolicy: "reject-new",
    }),
    attachments: openStore({
      namespace: "virtual-companion-attachments",
      maxEntries: MAX_ATTACHMENT_ENTRIES,
      overflowPolicy: "reject-new",
    }),
    attachmentChunks: openStore({
      namespace: "virtual-companion-attachment-chunks",
      maxEntries: MAX_ATTACHMENT_CHUNKS,
      overflowPolicy: "reject-new",
    }),
    outreach: openStore({
      namespace: "virtual-companion-outreach",
      maxEntries: 2_000,
      overflowPolicy: "reject-new",
    }),
    evolution: openStore({
      namespace: "virtual-companion-evolution",
      maxEntries: 1_000,
      overflowPolicy: "reject-new",
    }),
  };
}

export function profileKey(): string {
  return "active";
}

export function archiveKey(params: {
  sessionKey: string;
  runId: string;
  index: number;
  role: string;
  text: string;
}): string {
  return `message:${digest([params.sessionKey, params.runId, String(params.index), params.role, params.text])}`;
}

export function archiveChunkKey(messageKey: string, index: number): string {
  return `${messageKey}:chunk:${String(index).padStart(4, "0")}`;
}

export function attachmentKey(messageKey: string, index: number): string {
  return `${messageKey}:attachment:${String(index).padStart(4, "0")}`;
}

export function attachmentChunkKey(attachmentKeyValue: string, index: number): string {
  return `${attachmentKeyValue}:chunk:${String(index).padStart(4, "0")}`;
}

export function outreachKey(params: { sessionKey: string; day: string; window: string }): string {
  return `outreach:${digest([params.sessionKey, params.day, params.window])}`;
}

export function evolutionKey(createdAt: number, summary: string): string {
  return `evolution:${createdAt.toString(36)}:${digest([summary]).slice(0, 16)}`;
}

export function chunkText(text: string): string[] {
  if (Buffer.byteLength(text, "utf8") <= MAX_TEXT_CHUNK_BYTES) {
    return [text];
  }

  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (current && currentBytes + characterBytes > MAX_TEXT_CHUNK_BYTES) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export async function readArchiveText(
  stores: CompanionStores,
  messageKey: string,
  chunkCount: number,
): Promise<string> {
  const chunks = await Promise.all(
    Array.from({ length: chunkCount }, async (_, index) => {
      return await stores.chunks.lookup(archiveChunkKey(messageKey, index));
    }),
  );
  return chunks.map((chunk) => chunk?.text ?? "").join("");
}

export async function archiveMessage(params: {
  stores: CompanionStores;
  sessionKey: string;
  runId: string;
  index: number;
  role: "user" | "assistant";
  text: string;
  createdAt?: number;
  attachmentSummary?: string;
  attachments?: readonly ArchivedAttachmentInput[];
}): Promise<void> {
  const messageKey = archiveKey(params);
  if (await params.stores.archive.lookup(messageKey)) {
    return;
  }

  const chunks = chunkText(params.text);
  await Promise.all(
    chunks.map(async (text, index) => {
      await params.stores.chunks.register(archiveChunkKey(messageKey, index), { index, text });
    }),
  );
  await params.stores.archive.register(messageKey, {
    sessionKey: params.sessionKey,
    role: params.role,
    createdAt: params.createdAt ?? Date.now(),
    chunkCount: chunks.length,
    ...(params.attachmentSummary ? { attachmentSummary: params.attachmentSummary } : {}),
  });
  await archiveAttachments({
    stores: params.stores,
    messageKey,
    attachments: params.attachments ?? [],
  });
}

export async function readArchivedAttachmentContent(
  stores: CompanionStores,
  attachment: ArchivedAttachment,
): Promise<string | undefined> {
  if (attachment.chunkCount === 0) {
    return undefined;
  }
  const key = attachmentKey(attachment.messageKey, attachment.index);
  const chunks = await Promise.all(
    Array.from({ length: attachment.chunkCount }, async (_, index) => {
      return await stores.attachmentChunks.lookup(attachmentChunkKey(key, index));
    }),
  );
  return chunks.map((chunk) => chunk?.text ?? "").join("");
}

async function archiveAttachments(params: {
  stores: CompanionStores;
  messageKey: string;
  attachments: readonly ArchivedAttachmentInput[];
}): Promise<void> {
  for (const [index, attachment] of params.attachments.entries()) {
    const key = attachmentKey(params.messageKey, index);
    if (await params.stores.attachments.lookup(key)) {
      continue;
    }
    const content = attachment.content;
    const chunks = content ? chunkText(content) : [];
    await Promise.all(
      chunks.map(async (text, chunkIndex) => {
        await params.stores.attachmentChunks.register(attachmentChunkKey(key, chunkIndex), {
          index: chunkIndex,
          text,
        });
      }),
    );
    await params.stores.attachments.register(key, {
      messageKey: params.messageKey,
      index,
      type: attachment.type,
      byteLength: content ? Buffer.byteLength(content, "utf8") : 0,
      contentHash: createHash("sha256").update(content ?? attachment.sourceUrl ?? "").digest("hex"),
      chunkCount: chunks.length,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      ...(attachment.sourceUrl ? { sourceUrl: attachment.sourceUrl } : {}),
    });
  }
}

export async function searchArchive(params: {
  stores: CompanionStores;
  sessionKey: string;
  query: string;
  limit?: number;
}): Promise<Array<{ role: "user" | "assistant"; text: string; createdAt: number }>> {
  const tokens = params.query
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1)
    .slice(0, 8);
  const entries = (await params.stores.archive.entries())
    .filter((entry) => entry.value.sessionKey === params.sessionKey)
    .toSorted((left, right) => right.value.createdAt - left.value.createdAt);
  const results: Array<{ role: "user" | "assistant"; text: string; createdAt: number; score: number }> = [];

  for (const entry of entries) {
    const text = await readArchiveText(params.stores, entry.key, entry.value.chunkCount);
    const lowered = text.toLocaleLowerCase();
    const score = tokens.reduce((total, token) => total + (lowered.includes(token) ? 1 : 0), 0);
    if (tokens.length && score === 0) {
      continue;
    }
    results.push({
      role: entry.value.role,
      text,
      createdAt: entry.value.createdAt,
      score,
    });
    if (results.length >= (params.limit ?? 8) * 2) {
      break;
    }
  }

  return results
    .toSorted((left, right) => right.score - left.score || right.createdAt - left.createdAt)
    .slice(0, params.limit ?? 8)
    .map(({ score: _score, ...result }) => result);
}

export async function forgetSessionArchive(
  stores: CompanionStores,
  sessionKey: string,
): Promise<number> {
  const entries = (await stores.archive.entries()).filter(
    (entry) => entry.value.sessionKey === sessionKey,
  );
  await Promise.all(
    entries.flatMap((entry) => [
      stores.archive.delete(entry.key),
      ...Array.from({ length: entry.value.chunkCount }, (_, index) =>
        stores.chunks.delete(archiveChunkKey(entry.key, index)),
      ),
    ]),
  );
  const attachmentEntries = (await stores.attachments.entries()).filter((entry) =>
    entries.some((message) => message.key === entry.value.messageKey),
  );
  await Promise.all(
    attachmentEntries.flatMap((entry) => [
      stores.attachments.delete(entry.key),
      ...Array.from({ length: entry.value.chunkCount }, (_, index) =>
        stores.attachmentChunks.delete(attachmentChunkKey(entry.key, index)),
      ),
    ]),
  );
  return entries.length;
}

function digest(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}
