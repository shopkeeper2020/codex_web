import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path'),
  source: text('source').notNull(),
  updatedAtIso: text('updated_at_iso').notNull(),
})

export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    projectId: text('project_id'),
    path: text('path'),
    updatedAtIso: text('updated_at_iso'),
    inProgress: integer('in_progress', { mode: 'boolean' }).notNull(),
    ownerClientId: text('owner_client_id'),
    ownerKind: text('owner_kind'),
    ownerSource: text('owner_source'),
    cachedAtIso: text('cached_at_iso').notNull(),
  },
  (table) => [
    index('idx_threads_project_id').on(table.projectId),
    index('idx_threads_updated_at_iso').on(table.updatedAtIso),
  ],
)

export const threadDetails = sqliteTable('thread_details', {
  threadId: text('thread_id').primaryKey(),
  source: text('source').notNull(),
  detailJson: text('detail_json').notNull(),
  cachedAtIso: text('cached_at_iso').notNull(),
})

export const pinnedThreads = sqliteTable('pinned_threads', {
  threadId: text('thread_id').primaryKey(),
  pinnedAtIso: text('pinned_at_iso').notNull(),
})

export const officialStreamStates = sqliteTable(
  'official_stream_states',
  {
    threadId: text('thread_id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    hostId: text('host_id').notNull(),
    ownerClientId: text('owner_client_id'),
    sourceClientId: text('source_client_id'),
    conversationStateJson: text('conversation_state_json').notNull(),
    changeType: text('change_type').notNull(),
    cacheVersion: integer('cache_version').notNull(),
    updatedAtIso: text('updated_at_iso').notNull(),
    isInProgress: integer('is_in_progress', { mode: 'boolean' }).notNull(),
    activeTurnId: text('active_turn_id').notNull(),
    cachedAtIso: text('cached_at_iso').notNull(),
  },
  (table) => [
    index('idx_official_stream_states_updated_at_iso').on(table.updatedAtIso),
  ],
)

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    path: text('path').notNull(),
    sha256: text('sha256').notNull(),
    createdAtIso: text('created_at_iso').notNull(),
    threadId: text('thread_id'),
    turnId: text('turn_id'),
    officialReferenceId: text('official_reference_id'),
  },
  (table) => [
    index('idx_attachments_thread_id').on(table.threadId),
    index('idx_attachments_created_at_iso').on(table.createdAtIso),
  ],
)
