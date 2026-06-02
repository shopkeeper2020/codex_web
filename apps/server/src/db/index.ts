import { resolve } from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import type {
  Attachment,
  Project,
  Thread,
  ThreadDetail,
} from "@codex-web/domain";
import { ensureDirectory, type RuntimeConfig } from "@codex-web/config";
import type { OfficialThreadStreamState } from "@codex-web/protocol";
import * as schema from "./schema.js";

export type DatabaseStoreStatus = {
  path: string;
  projectCount: number;
  threadCount: number;
  threadDetailCount: number;
  attachmentCount: number;
  officialStreamStateCount: number;
};

export type DerivedCacheCleanupResult = {
  projectCount: number;
  threadCount: number;
  threadDetailCount: number;
  officialStreamStateCount: number;
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

  upsertProjects(projects: Project[]): void {
    const nowIso = new Date().toISOString();
    const statement = this.sqlite.prepare(`
      INSERT INTO projects (id, name, path, source, updated_at_iso)
      VALUES (@id, @name, @path, @source, @updatedAtIso)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        path = excluded.path,
        source = excluded.source,
        updated_at_iso = excluded.updated_at_iso
    `);
    const transaction = this.sqlite.transaction((items: Project[]) => {
      for (const project of items) {
        statement.run({ ...project, updatedAtIso: nowIso });
      }
    });
    transaction(projects);
  }

  listProjects(): Project[] {
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM projects ORDER BY name COLLATE NOCASE ASC LIMIT 500`,
      )
      .all();
    return rows.map((row) => this.mapProjectRow(row));
  }

  upsertThreads(threads: Thread[]): void {
    const nowIso = new Date().toISOString();
    const statement = this.sqlite.prepare(`
      INSERT INTO threads (
        id, title, project_id, path, updated_at_iso, in_progress,
        owner_client_id, owner_kind, owner_source, cached_at_iso
      )
      VALUES (
        @id, @title, @projectId, @path, @updatedAtIso, @inProgress,
        @ownerClientId, @ownerKind, @ownerSource, @cachedAtIso
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        project_id = excluded.project_id,
        path = excluded.path,
        updated_at_iso = excluded.updated_at_iso,
        in_progress = excluded.in_progress,
        owner_client_id = excluded.owner_client_id,
        owner_kind = excluded.owner_kind,
        owner_source = excluded.owner_source,
        cached_at_iso = excluded.cached_at_iso
    `);
    const transaction = this.sqlite.transaction((items: Thread[]) => {
      for (const thread of items) {
        statement.run({
          id: thread.id,
          title: thread.title,
          projectId: thread.projectId,
          path: thread.path,
          updatedAtIso: thread.updatedAtIso,
          inProgress: thread.inProgress ? 1 : 0,
          ownerClientId: thread.owner?.clientId ?? null,
          ownerKind: thread.owner?.kind ?? null,
          ownerSource: thread.owner?.source ?? null,
          cachedAtIso: nowIso,
        });
      }
    });
    transaction(threads);
  }

  upsertThreadDetail(
    threadId: string,
    detail: ThreadDetail,
    source: string,
  ): void {
    this.sqlite
      .prepare(
        `
      INSERT INTO thread_details (thread_id, source, detail_json, cached_at_iso)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        source = excluded.source,
        detail_json = excluded.detail_json,
        cached_at_iso = excluded.cached_at_iso
    `,
      )
      .run(threadId, source, JSON.stringify(detail), new Date().toISOString());
  }

  readThreadDetail(threadId: string): ThreadDetail | null {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return null;
    const row = this.sqlite
      .prepare("SELECT detail_json FROM thread_details WHERE thread_id = ?")
      .get(normalizedThreadId) as { detail_json?: unknown } | undefined;
    if (typeof row?.detail_json !== "string") return null;
    try {
      return JSON.parse(row.detail_json) as ThreadDetail;
    } catch {
      return null;
    }
  }

  upsertOfficialStreamState(state: OfficialThreadStreamState): void {
    this.sqlite
      .prepare(
        `
      INSERT INTO official_stream_states (
        thread_id, conversation_id, host_id, owner_client_id,
        source_client_id, conversation_state_json, change_type,
        cache_version, updated_at_iso, is_in_progress, active_turn_id,
        cached_at_iso
      )
      VALUES (
        @threadId, @conversationId, @hostId, @ownerClientId,
        @sourceClientId, @conversationStateJson, @changeType,
        @cacheVersion, @updatedAtIso, @isInProgress, @activeTurnId,
        @cachedAtIso
      )
      ON CONFLICT(thread_id) DO UPDATE SET
        conversation_id = excluded.conversation_id,
        host_id = excluded.host_id,
        owner_client_id = excluded.owner_client_id,
        source_client_id = excluded.source_client_id,
        conversation_state_json = excluded.conversation_state_json,
        change_type = excluded.change_type,
        cache_version = excluded.cache_version,
        updated_at_iso = excluded.updated_at_iso,
        is_in_progress = excluded.is_in_progress,
        active_turn_id = excluded.active_turn_id,
        cached_at_iso = excluded.cached_at_iso
    `,
      )
      .run({
        threadId: state.threadId,
        conversationId: state.conversationId,
        hostId: state.hostId,
        ownerClientId: state.ownerClientId,
        sourceClientId: state.sourceClientId,
        conversationStateJson: JSON.stringify(state.conversationState),
        changeType: state.changeType,
        cacheVersion: state.cacheVersion,
        updatedAtIso: state.updatedAtIso,
        isInProgress: state.isInProgress ? 1 : 0,
        activeTurnId: state.activeTurnId,
        cachedAtIso: new Date().toISOString(),
      });
  }

  listOfficialStreamStates(limit = 200): OfficialThreadStreamState[] {
    const rows = this.sqlite
      .prepare(
        `
      SELECT * FROM official_stream_states
      ORDER BY updated_at_iso DESC
      LIMIT ?
    `,
      )
      .all(limit);
    return rows
      .map((row) => this.mapOfficialStreamStateRow(row))
      .filter((state): state is OfficialThreadStreamState => Boolean(state));
  }

  deleteOfficialStreamState(threadId: string): void {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return;
    this.sqlite
      .prepare("DELETE FROM official_stream_states WHERE thread_id = ?")
      .run(normalizedThreadId);
  }

  clearDerivedCaches(): DerivedCacheCleanupResult {
    const before = {
      projectCount: this.readCount("projects"),
      threadCount: this.readCount("threads"),
      threadDetailCount: this.readCount("thread_details"),
      officialStreamStateCount: this.readCount("official_stream_states"),
    };
    const transaction = this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM official_stream_states").run();
      this.sqlite.prepare("DELETE FROM thread_details").run();
      this.sqlite.prepare("DELETE FROM threads").run();
      this.sqlite.prepare("DELETE FROM projects").run();
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
      this.sqlite
        .prepare("DELETE FROM thread_details WHERE thread_id = ?")
        .run(id);
      this.sqlite.prepare("DELETE FROM threads WHERE id = ?").run(id);
      this.sqlite
        .prepare("DELETE FROM official_stream_states WHERE thread_id = ?")
        .run(id);
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
      projectCount: this.readCount("projects"),
      threadCount: this.readCount("threads"),
      threadDetailCount: this.readCount("thread_details"),
      attachmentCount: this.readCount("attachments"),
      officialStreamStateCount: this.readCount("official_stream_states"),
    };
  }

  private migrate(): void {
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT,
        source TEXT NOT NULL,
        updated_at_iso TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        project_id TEXT,
        path TEXT,
        updated_at_iso TEXT,
        in_progress INTEGER NOT NULL,
        owner_client_id TEXT,
        owner_kind TEXT,
        owner_source TEXT,
        cached_at_iso TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id);
      CREATE INDEX IF NOT EXISTS idx_threads_updated_at_iso ON threads(updated_at_iso);

      CREATE TABLE IF NOT EXISTS thread_details (
        thread_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        cached_at_iso TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pinned_threads (
        thread_id TEXT PRIMARY KEY,
        pinned_at_iso TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS official_stream_states (
        thread_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        host_id TEXT NOT NULL,
        owner_client_id TEXT,
        source_client_id TEXT,
        conversation_state_json TEXT NOT NULL,
        change_type TEXT NOT NULL,
        cache_version INTEGER NOT NULL,
        updated_at_iso TEXT NOT NULL,
        is_in_progress INTEGER NOT NULL,
        active_turn_id TEXT NOT NULL,
        cached_at_iso TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_official_stream_states_updated_at_iso
        ON official_stream_states(updated_at_iso);

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

  private mapProjectRow(row: unknown): Project {
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id ?? ""),
      name: String(record.name ?? ""),
      path: typeof record.path === "string" ? record.path : null,
      source: record.source === "web-favorite" ? "web-favorite" : "official",
    };
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

  private mapOfficialStreamStateRow(
    row: unknown,
  ): OfficialThreadStreamState | null {
    const record = row as Record<string, unknown>;
    try {
      const conversationState = JSON.parse(
        String(record.conversation_state_json ?? "null"),
      ) as unknown;
      if (!conversationState) return null;
      return {
        threadId: String(record.thread_id ?? ""),
        conversationId: String(record.conversation_id ?? ""),
        hostId: String(record.host_id ?? "local"),
        ownerClientId:
          typeof record.owner_client_id === "string"
            ? record.owner_client_id
            : null,
        sourceClientId:
          typeof record.source_client_id === "string"
            ? record.source_client_id
            : null,
        conversationState,
        changeType: record.change_type === "patches" ? "patches" : "snapshot",
        cacheVersion: Number(record.cache_version ?? 0),
        updatedAtIso: String(record.updated_at_iso ?? ""),
        isInProgress: Number(record.is_in_progress ?? 0) === 1,
        activeTurnId: String(record.active_turn_id ?? ""),
      };
    } catch {
      return null;
    }
  }
}
