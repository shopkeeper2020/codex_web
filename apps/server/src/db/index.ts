import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import type { Attachment } from "@codex-web/domain";
import { ensureDirectory, type RuntimeConfig } from "@codex-web/config";
import * as schema from "./schema.js";

export type DatabaseStoreStatus = {
  path: string;
  attachmentCount: number;
};

export type DerivedCacheCleanupResult = {
  legacyProjectCount: number;
  legacyThreadCount: number;
  legacyThreadDetailCount: number;
  legacyOfficialStreamStateCount: number;
};

export class DatabaseStore {
  readonly db: BetterSQLite3Database<typeof schema>;

  constructor(private readonly sqlite: Database.Database) {
    this.db = drizzle(sqlite, { schema });
    this.migrate();
  }

  static open(config: RuntimeConfig): DatabaseStore {
    ensureDirectory(config.dataDir);
    const dbPath = resolve(config.dataDir, "codex_web.sqlite");
    return new DatabaseStore(new Database(dbPath));
  }

  get path(): string {
    return this.sqlite.name;
  }

  close(): void {
    this.sqlite.close();
  }

  clearDerivedCaches(): DerivedCacheCleanupResult {
    const before = {
      legacyProjectCount: this.readCountIfTableExists("projects"),
      legacyThreadCount: this.readCountIfTableExists("threads"),
      legacyThreadDetailCount: this.readCountIfTableExists("thread_details"),
      legacyOfficialStreamStateCount: this.readCountIfTableExists(
        "official_stream_states",
      ),
    };
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.exec("DROP TABLE IF EXISTS official_stream_states");
      this.sqlite.exec("DROP TABLE IF EXISTS thread_details");
      this.sqlite.exec("DROP TABLE IF EXISTS threads");
      this.sqlite.exec("DROP TABLE IF EXISTS projects");
    });
    transaction();
    return before;
  }

  compactStorage(): void {
    this.sqlite.pragma("wal_checkpoint(TRUNCATE)");
    this.sqlite.exec("VACUUM");
    this.sqlite.pragma("wal_checkpoint(TRUNCATE)");
  }

  setThreadPinned(threadId: string, pinned: boolean): void {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return;
    if (!pinned) {
      this.sqlite
        .prepare("DELETE FROM pinned_threads WHERE thread_id = ?")
        .run(normalizedThreadId);
      return;
    }
    this.sqlite
      .prepare(
        `
      INSERT INTO pinned_threads (thread_id, pinned_at_iso)
      VALUES (?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        pinned_at_iso = excluded.pinned_at_iso
    `,
      )
      .run(normalizedThreadId, new Date().toISOString());
  }

  listPinnedThreadIds(): string[] {
    const rows = this.sqlite
      .prepare(
        `
      SELECT thread_id FROM pinned_threads
      ORDER BY pinned_at_iso DESC
      LIMIT 500
    `,
      )
      .all() as Array<{ thread_id?: unknown }>;
    return rows
      .map((row) => String(row.thread_id ?? "").trim())
      .filter(Boolean);
  }

  deleteThread(threadId: string): void {
    const transaction = this.sqlite.transaction((id: string) => {
      this.sqlite.prepare("DELETE FROM pinned_threads WHERE thread_id = ?").run(id);
    });
    transaction(threadId);
  }

  insertAttachment(attachment: Attachment): void {
    this.sqlite
      .prepare(
        `
      INSERT INTO attachments (
        id, filename, mime_type, size, path, sha256, created_at_iso,
        thread_id, turn_id, official_reference_id
      )
      VALUES (
        @id, @filename, @mimeType, @size, @path, @sha256, @createdAtIso,
        @threadId, @turnId, @officialReferenceId
      )
    `,
      )
      .run(attachment);
  }

  listAttachments(threadId?: string | null): Attachment[] {
    const sql = threadId
      ? `SELECT * FROM attachments WHERE thread_id = ? ORDER BY created_at_iso DESC LIMIT 100`
      : `SELECT * FROM attachments ORDER BY created_at_iso DESC LIMIT 100`;
    const rows = threadId
      ? this.sqlite.prepare(sql).all(threadId)
      : this.sqlite.prepare(sql).all();
    return rows.map((row) => this.mapAttachmentRow(row));
  }

  listUnassociatedAttachments(): Attachment[] {
    const rows = this.sqlite
      .prepare(
        `
      SELECT * FROM attachments
      WHERE thread_id IS NULL AND turn_id IS NULL AND official_reference_id IS NULL
      ORDER BY created_at_iso DESC
      LIMIT 500
    `,
      )
      .all();
    return rows.map((row) => this.mapAttachmentRow(row));
  }

  readAttachmentsByIds(ids: string[]): Attachment[] {
    const normalizedIds = [
      ...new Set(ids.map((id) => id.trim()).filter(Boolean)),
    ];
    if (normalizedIds.length === 0) return [];
    const placeholders = normalizedIds.map(() => "?").join(",");
    const rows = this.sqlite
      .prepare(`SELECT * FROM attachments WHERE id IN (${placeholders})`)
      .all(...normalizedIds);
    return rows.map((row) => this.mapAttachmentRow(row));
  }

  associateAttachmentsWithThread(ids: string[], threadId: string): number {
    const normalizedIds = [
      ...new Set(ids.map((id) => id.trim()).filter(Boolean)),
    ];
    const normalizedThreadId = threadId.trim();
    if (normalizedIds.length === 0 || !normalizedThreadId) return 0;
    const statement = this.sqlite.prepare(`
      UPDATE attachments
      SET thread_id = ?
      WHERE id = ? AND thread_id IS NULL
    `);
    const transaction = this.sqlite.transaction((items: string[]) => {
      let updated = 0;
      for (const id of items) {
        updated += Number(statement.run(normalizedThreadId, id).changes ?? 0);
      }
      return updated;
    });
    return transaction(normalizedIds) as number;
  }

  readAttachmentById(id: string): Attachment | null {
    const normalizedId = id.trim();
    if (!normalizedId) return null;
    const row = this.sqlite
      .prepare(`SELECT * FROM attachments WHERE id = ?`)
      .get(normalizedId);
    return row ? this.mapAttachmentRow(row) : null;
  }

  deleteAttachmentsByIds(ids: string[]): number {
    const normalizedIds = [
      ...new Set(ids.map((id) => id.trim()).filter(Boolean)),
    ];
    if (normalizedIds.length === 0) return 0;
    const statement = this.sqlite.prepare(
      "DELETE FROM attachments WHERE id = ?",
    );
    const transaction = this.sqlite.transaction((items: string[]) => {
      let deleted = 0;
      for (const id of items) deleted += Number(statement.run(id).changes ?? 0);
      return deleted;
    });
    return transaction(normalizedIds) as number;
  }

  attachmentStorageStatus(): {
    attachmentCount: number;
    attachmentBytes: number;
    unassociatedCount: number;
    unassociatedBytes: number;
  } {
    const total = this.sqlite
      .prepare(
        `
      SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM attachments
    `,
      )
      .get() as { count?: number; bytes?: number };
    const unassociated = this.sqlite
      .prepare(
        `
      SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM attachments
      WHERE thread_id IS NULL AND turn_id IS NULL AND official_reference_id IS NULL
    `,
      )
      .get() as { count?: number; bytes?: number };
    return {
      attachmentCount: Number(total.count ?? 0),
      attachmentBytes: Number(total.bytes ?? 0),
      unassociatedCount: Number(unassociated.count ?? 0),
      unassociatedBytes: Number(unassociated.bytes ?? 0),
    };
  }

  status(): DatabaseStoreStatus {
    return {
      path: this.path,
      attachmentCount: this.readCount("attachments"),
    };
  }

  private migrate(): void {
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS pinned_threads (
        thread_id TEXT PRIMARY KEY,
        pinned_at_iso TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        created_at_iso TEXT NOT NULL,
        thread_id TEXT,
        turn_id TEXT,
        official_reference_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_attachments_thread_id ON attachments(thread_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_created_at_iso ON attachments(created_at_iso);
    `);
  }

  private readCount(table: string): number {
    const row = this.sqlite
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { count?: number };
    return Number(row.count ?? 0);
  }

  private readCountIfTableExists(table: string): number {
    const tableRow = this.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table);
    return tableRow ? this.readCount(table) : 0;
  }

  private mapAttachmentRow(row: unknown): Attachment {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id ?? ""),
      filename: String(record.filename ?? ""),
      mimeType: String(record.mime_type ?? ""),
      size: Number(record.size ?? 0),
      path: String(record.path ?? ""),
      sha256: String(record.sha256 ?? ""),
      createdAtIso: String(record.created_at_iso ?? ""),
      threadId: typeof record.thread_id === "string" ? record.thread_id : null,
      turnId: typeof record.turn_id === "string" ? record.turn_id : null,
      officialReferenceId:
        typeof record.official_reference_id === "string"
          ? record.official_reference_id
          : null,
    };
  }

}
