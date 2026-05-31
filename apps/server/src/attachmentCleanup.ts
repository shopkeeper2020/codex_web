import { unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Attachment } from "@codex-web/domain";

export type AttachmentCleanupStore = {
  listUnassociatedAttachments(): Attachment[];
  deleteAttachmentsByIds(ids: string[]): number;
};

export type AttachmentCleanupResult = {
  candidateCount: number;
  deletedCount: number;
  deletedBytes: number;
  skippedCount: number;
  skippedIds: string[];
};

type CleanupInput = {
  database: AttachmentCleanupStore;
  attachmentsRoot: string;
  unlinkFile?: (path: string) => Promise<void>;
  onSkip?: (attachment: Attachment, reason: string) => void;
};

function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

function isFileMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export async function cleanupUnassociatedAttachments({
  database,
  attachmentsRoot,
  unlinkFile = unlink,
  onSkip,
}: CleanupInput): Promise<AttachmentCleanupResult> {
  const root = resolve(attachmentsRoot);
  const candidates = database.listUnassociatedAttachments();
  const removableIds: string[] = [];
  let deletedBytes = 0;
  const skippedIds: string[] = [];

  for (const attachment of candidates) {
    const storedPath = resolve(attachment.path);
    if (!isPathInside(root, storedPath)) {
      skippedIds.push(attachment.id);
      onSkip?.(attachment, "path-outside-attachments-root");
      continue;
    }

    try {
      await unlinkFile(storedPath);
    } catch (error) {
      if (!isFileMissing(error)) {
        skippedIds.push(attachment.id);
        onSkip?.(
          attachment,
          error instanceof Error ? error.message : "unlink-failed",
        );
        continue;
      }
    }

    removableIds.push(attachment.id);
    deletedBytes += attachment.size;
  }

  return {
    candidateCount: candidates.length,
    deletedCount: database.deleteAttachmentsByIds(removableIds),
    deletedBytes,
    skippedCount: skippedIds.length,
    skippedIds,
  };
}
