import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const pinnedThreads = sqliteTable('pinned_threads', {
  threadId: text('thread_id').primaryKey(),
  pinnedAtIso: text('pinned_at_iso').notNull(),
})

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
