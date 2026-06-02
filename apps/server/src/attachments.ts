import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { once } from 'node:events'
import type { MultipartFile } from '@fastify/multipart'
import type { Attachment } from '@codex-web/domain'
import { ensureDirectory, type RuntimeConfig } from '@codex-web/config'

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024

function sanitizeFilename(filename: string): string {
  const normalized = filename.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? 'attachment'
  const safe = normalized.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim()
  return safe || 'attachment'
}

function monthBucket(date = new Date()): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}`
}

export async function persistMultipartAttachment(input: {
  config: RuntimeConfig
  file: MultipartFile
  threadId?: string | null
}): Promise<Attachment> {
  const id = randomUUID()
  const filename = sanitizeFilename(input.file.filename || 'attachment')
  const extension = extname(filename)
  const bucket = monthBucket()
  const directory = resolve(input.config.dataDir, 'attachments', bucket)
  ensureDirectory(directory)

  const storedFilename = `${id}${extension}`
  const storedPath = resolve(directory, storedFilename)
  const output = createWriteStream(storedPath, { flags: 'wx' })
  const hash = createHash('sha256')
  let size = 0
  let outputError: Error | null = null

  output.on('error', (error) => {
    outputError = error
  })

  try {
    for await (const chunk of input.file.file) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_ATTACHMENT_BYTES) throw new Error('Attachment exceeds 50 MB')
      hash.update(buffer)
      if (!output.write(buffer)) await once(output, 'drain')
      if (outputError) throw outputError
    }
    output.end()
    await once(output, 'finish')
    if (outputError) throw outputError
  } catch (error) {
    output.destroy()
    await unlink(storedPath).catch(() => undefined)
    throw error
  }

  return {
    id,
    filename,
    mimeType: input.file.mimetype || 'application/octet-stream',
    size,
    path: storedPath,
    sha256: hash.digest('hex'),
    createdAtIso: new Date().toISOString(),
    threadId: input.threadId ?? null,
    turnId: null,
    officialReferenceId: null,
  }
}

export function toTurnStartAttachment(attachment: Attachment): Record<string, unknown> {
  return {
    id: attachment.id,
    type: attachment.mimeType.startsWith('image/') ? 'local_image' : 'local_file',
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    path: attachment.path,
    sha256: attachment.sha256,
  }
}

export type TurnStartImageInput = {
  input: Record<string, unknown>
  restoreAttachment: Record<string, unknown>
}

export async function toTurnStartImageInput(
  attachment: Attachment,
): Promise<TurnStartImageInput | null> {
  if (!attachment.mimeType.startsWith('image/')) return null
  if (attachment.size > MAX_INLINE_IMAGE_BYTES) return null
  const buffer = await readFile(attachment.path)
  const mimeType = attachment.mimeType || 'image/png'
  const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
  return {
    input: {
      type: 'localImage',
      path: attachment.path,
    },
    restoreAttachment: {
      id: attachment.id,
      src: dataUrl,
      filename: attachment.filename,
      localPath: attachment.path,
      path: attachment.path,
      mimeType,
      uploadStatus: 'idle',
    },
  }
}
