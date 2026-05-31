import { fileURLToPath } from 'node:url'
import { createServer } from './app.js'

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url))
const context = await createServer(projectRoot)

await context.app.listen({
  host: context.config.server.host,
  port: context.config.server.port,
})

context.app.log.info(
  {
    host: context.config.server.host,
    port: context.config.server.port,
    dataDir: context.config.dataDir,
  },
  'codex_web server listening',
)
