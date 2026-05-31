import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadRuntimeConfig } from "@codex-web/config";
import type { Attachment } from "@codex-web/domain";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupUnassociatedAttachments } from "./attachmentCleanup.js";
import { DatabaseStore } from "./db/index.js";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codex-web-attachments-"));
  tempRoots.push(root);
  return root;
}

function attachment(
  input: Partial<Attachment> & Pick<Attachment, "id" | "path">,
): Attachment {
  return {
    filename: `${input.id}.txt`,
    mimeType: "text/plain",
    size: 5,
    sha256: input.id,
    createdAtIso: new Date().toISOString(),
    threadId: null,
    turnId: null,
    officialReferenceId: null,
    ...input,
  };
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("attachment cleanup", () => {
  it("tracks total and unassociated attachment storage separately", async () => {
    const root = await createTempRoot();
    const config = loadRuntimeConfig(root);
    const database = DatabaseStore.open(config);
    try {
      database.insertAttachment(
        attachment({
          id: "orphan",
          path: join(config.dataDir, "attachments", "orphan.txt"),
          size: 7,
        }),
      );
      database.insertAttachment(
        attachment({
          id: "thread-bound",
          path: join(config.dataDir, "attachments", "thread-bound.txt"),
          size: 11,
          threadId: "thread-1",
        }),
      );

      expect(database.attachmentStorageStatus()).toEqual({
        attachmentCount: 2,
        attachmentBytes: 18,
        unassociatedCount: 1,
        unassociatedBytes: 7,
      });
      expect(
        database.listUnassociatedAttachments().map((item) => item.id),
      ).toEqual(["orphan"]);
      expect(
        database.deleteAttachmentsByIds(["orphan", "orphan", "missing"]),
      ).toBe(1);
      expect(database.attachmentStorageStatus().attachmentCount).toBe(1);
    } finally {
      database.close();
    }
  });

  it("associates previously orphaned attachments with a thread after send", async () => {
    const root = await createTempRoot();
    const config = loadRuntimeConfig(root);
    const database = DatabaseStore.open(config);
    try {
      database.insertAttachment(
        attachment({
          id: "orphan",
          path: join(config.dataDir, "attachments", "orphan.txt"),
          size: 7,
        }),
      );
      database.insertAttachment(
        attachment({
          id: "already-bound",
          path: join(config.dataDir, "attachments", "already-bound.txt"),
          size: 11,
          threadId: "thread-1",
        }),
      );

      expect(
        database.associateAttachmentsWithThread(
          ["orphan", "orphan", "already-bound", "missing"],
          "thread-1",
        ),
      ).toBe(1);
      expect(database.readAttachmentById("orphan")?.threadId).toBe("thread-1");
      expect(database.readAttachmentById("already-bound")?.threadId).toBe(
        "thread-1",
      );
      expect(database.listUnassociatedAttachments()).toEqual([]);
      expect(database.attachmentStorageStatus()).toMatchObject({
        attachmentCount: 2,
        unassociatedCount: 0,
      });
    } finally {
      database.close();
    }
  });

  it("deletes only unassociated files inside the attachment root", async () => {
    const root = await createTempRoot();
    const outsideRoot = await createTempRoot();
    const config = loadRuntimeConfig(root);
    const database = DatabaseStore.open(config);
    const attachmentsRoot = resolve(config.dataDir, "attachments");
    const orphanPath = join(attachmentsRoot, "orphan.txt");
    const associatedPath = join(attachmentsRoot, "associated.txt");
    const outsidePath = join(outsideRoot, "outside.txt");
    const missingPath = join(attachmentsRoot, "missing.txt");
    const skipped: Array<{ id: string; reason: string }> = [];

    await mkdir(attachmentsRoot, { recursive: true });
    await writeFile(orphanPath, "orphan");
    await writeFile(associatedPath, "associated");
    await writeFile(outsidePath, "outside");

    try {
      database.insertAttachment(
        attachment({ id: "orphan", path: orphanPath, size: 6 }),
      );
      database.insertAttachment(
        attachment({ id: "missing", path: missingPath, size: 3 }),
      );
      database.insertAttachment(
        attachment({ id: "outside", path: outsidePath, size: 7 }),
      );
      database.insertAttachment(
        attachment({
          id: "associated",
          path: associatedPath,
          size: 10,
          threadId: "thread-1",
        }),
      );

      const result = await cleanupUnassociatedAttachments({
        database,
        attachmentsRoot,
        onSkip: (item, reason) => skipped.push({ id: item.id, reason }),
      });

      expect(result).toMatchObject({
        candidateCount: 3,
        deletedCount: 2,
        deletedBytes: 9,
        skippedCount: 1,
        skippedIds: ["outside"],
      });
      expect(skipped).toEqual([
        { id: "outside", reason: "path-outside-attachments-root" },
      ]);
      expect(existsSync(orphanPath)).toBe(false);
      expect(existsSync(associatedPath)).toBe(true);
      expect(existsSync(outsidePath)).toBe(true);
      expect(database.readAttachmentById("orphan")).toBeNull();
      expect(database.readAttachmentById("missing")).toBeNull();
      expect(database.readAttachmentById("outside")).not.toBeNull();
      expect(database.readAttachmentById("associated")).not.toBeNull();
    } finally {
      database.close();
    }
  });
});
