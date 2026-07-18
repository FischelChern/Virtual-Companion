import { describe, expect, it } from "vitest";
import {
  archiveKey,
  archiveMessage,
  chunkText,
  forgetSessionArchive,
  readArchivedAttachmentContent,
  searchArchive,
} from "./state.js";
import { createCompanionStoresForTests } from "./test-helpers.js";

describe("virtual companion archive", () => {
  it("splits UTF-8 content without dropping a character", () => {
    const text = "你".repeat(30_000);
    expect(chunkText(text).join("")).toBe(text);
    expect(chunkText(text)).toHaveLength(2);
  });

  it("keeps searchable private messages until an explicit forget request", async () => {
    const stores = createCompanionStoresForTests();
    await archiveMessage({
      stores,
      sessionKey: "agent:main:dm:alice",
      runId: "run-1",
      index: 0,
      role: "user",
      text: "I have a difficult commute today.",
      createdAt: 10,
    });
    await archiveMessage({
      stores,
      sessionKey: "agent:main:dm:alice",
      runId: "run-1",
      index: 1,
      role: "assistant",
      text: "Take your time. I am here when you arrive.",
      createdAt: 11,
    });

    await expect(
      searchArchive({
        stores,
        sessionKey: "agent:main:dm:alice",
        query: "commute",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ role: "user", text: "I have a difficult commute today." }),
    ]);

    await expect(forgetSessionArchive(stores, "agent:main:dm:alice")).resolves.toBe(2);
    await expect(
      searchArchive({
        stores,
        sessionKey: "agent:main:dm:alice",
        query: "commute",
      }),
    ).resolves.toEqual([]);
  });

  it("preserves inline attachment bytes and deletes them only with the chat archive", async () => {
    const stores = createCompanionStoresForTests();
    const sessionKey = "agent:main:dm:alice";
    await archiveMessage({
      stores,
      sessionKey,
      runId: "run-attachment",
      index: 0,
      role: "user",
      text: "This is the photo from my walk.",
      attachments: [{ type: "image_url", mimeType: "image/png", content: "aGVsbG8=" }],
    });

    const messageKey = archiveKey({
      sessionKey,
      runId: "run-attachment",
      index: 0,
      role: "user",
      text: "This is the photo from my walk.",
    });
    const attachment = await stores.attachments.lookup(`${messageKey}:attachment:0000`);
    expect(attachment).toEqual(expect.objectContaining({ mimeType: "image/png", chunkCount: 1 }));
    await expect(readArchivedAttachmentContent(stores, attachment!)).resolves.toBe("aGVsbG8=");

    await forgetSessionArchive(stores, sessionKey);
    await expect(stores.attachments.lookup(`${messageKey}:attachment:0000`)).resolves.toBeUndefined();
  });
});
