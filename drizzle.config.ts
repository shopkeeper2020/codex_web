import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './apps/server/src/db/schema.ts',
  out: './apps/server/drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/codex_web.sqlite',
  },
})
