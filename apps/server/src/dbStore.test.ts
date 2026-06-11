import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import SqliteDatabase from "better-sqlite3";
import { loadRuntimeConfig } from "@codex-web/config";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseStore } from "./db/index.js";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codex-web-db-"));
  tempRoots.push(root);
  return root;
}

function tableExists(dbPath: string, tableName: string): boolean {
  const sqlite = new SqliteDatabase(dbPath);
  try {
    const row = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(tableName);
    return Boolean(row);
  } finally {
    sqlite.close();
  }
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("database store", () => {
  it("creates only Web-owned tables for new databases", async () => {
    const root = await createTempRoot();
    const config = loadRuntimeConfig(root);
    const database = DatabaseStore.open(config);
    try {
      expect(database.status()).toEqual({
        path: join(config.dataDir, "codex_web.sqlite"),
        attachmentCount: 0,
      });
    } finally {
      database.close();
    }

    const dbPath = join(config.dataDir, "codex_web.sqlite");
    expect(tableExists(dbPath, "pinned_threads")).toBe(true);
    expect(tableExists(dbPath, "attachments")).toBe(true);
    expect(tableExists(dbPath, "projects")).toBe(false);
    expect(tableExists(dbPath, "threads")).toBe(false);
    expect(tableExists(dbPath, "thread_details")).toBe(false);
    expect(tableExists(dbPath, "official_stream_states")).toBe(false);
  });

  it("drops legacy official derived cache tables during cleanup", async () => {
    const root = await createTempRoot();
    const config = loadRuntimeConfig(root);
    await mkdir(config.dataDir, { recursive: true });
    const dbPath = join(config.dataDir, "codex_web.sqlite");
    const sqlite = new SqliteDatabase(dbPath);
    try {
      sqlite.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT,
          source TEXT NOT NULL,
          updated_at_iso TEXT NOT NULL
        );
        INSERT INTO projects (id, name, path, source, updated_at_iso)
        VALUES ('project-1', 'Project', 'C:\\workspace\\project', 'official', '2026-06-01T00:00:00.000Z');

        CREATE TABLE threads (
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
        INSERT INTO threads (
          id, title, project_id, path, updated_at_iso, in_progress,
          owner_client_id, owner_kind, owner_source, cached_at_iso
        )
        VALUES (
          'thread-1', 'Thread', 'project-1', 'C:\\workspace\\project',
          '2026-06-01T00:00:00.000Z', 0, NULL, NULL, NULL,
          '2026-06-01T00:00:00.000Z'
        );

        CREATE TABLE thread_details (
          thread_id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          detail_json TEXT NOT NULL,
          cached_at_iso TEXT NOT NULL
        );
        INSERT INTO thread_details (thread_id, source, detail_json, cached_at_iso)
        VALUES ('thread-1', 'app-server', '{}', '2026-06-01T00:00:00.000Z');

        CREATE TABLE official_stream_states (
          thread_id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          host_id TEXT NOT NULL,
          conversation_state_json TEXT NOT NULL
        );
        INSERT INTO official_stream_states (
          thread_id, conversation_id, host_id, conversation_state_json
        )
        VALUES ('thread-1', 'thread-1', 'local', '{}');
      `);
    } finally {
      sqlite.close();
    }

    const database = DatabaseStore.open(config);
    try {
      expect(database.clearDerivedCaches()).toMatchObject({
        legacyProjectCount: 1,
        legacyThreadCount: 1,
        legacyThreadDetailCount: 1,
        legacyOfficialStreamStateCount: 1,
      });
    } finally {
      database.close();
    }

    expect(tableExists(dbPath, "projects")).toBe(false);
    expect(tableExists(dbPath, "threads")).toBe(false);
    expect(tableExists(dbPath, "thread_details")).toBe(false);
    expect(tableExists(dbPath, "official_stream_states")).toBe(false);
  });
});
