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
  it("does not create an official stream state table for new databases", async () => {
    const root = await createTempRoot();
    const config = loadRuntimeConfig(root);
    const database = DatabaseStore.open(config);
    try {
      expect(database.status()).toEqual({
        path: join(config.dataDir, "codex_web.sqlite"),
        projectCount: 0,
        threadCount: 0,
        threadDetailCount: 0,
        attachmentCount: 0,
      });
    } finally {
      database.close();
    }

    expect(
      tableExists(
        join(config.dataDir, "codex_web.sqlite"),
        "official_stream_states",
      ),
    ).toBe(false);
  });

  it("drops the legacy official stream state table during derived cache cleanup", async () => {
    const root = await createTempRoot();
    const config = loadRuntimeConfig(root);
    await mkdir(config.dataDir, { recursive: true });
    const dbPath = join(config.dataDir, "codex_web.sqlite");
    const sqlite = new SqliteDatabase(dbPath);
    try {
      sqlite.exec(`
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
        projectCount: 0,
        threadCount: 0,
        threadDetailCount: 0,
        legacyOfficialStreamStateCount: 1,
      });
    } finally {
      database.close();
    }

    expect(tableExists(dbPath, "official_stream_states")).toBe(false);
  });
});
