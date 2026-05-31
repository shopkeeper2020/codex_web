import { createReadStream } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { basename, extname, isAbsolute, resolve } from 'node:path'
import type { FilePreview } from '@codex-web/api'
import { FileBrowserError, isPathInsideOrEqual } from './fileBrowser.js'

export const DEFAULT_FILE_PREVIEW_MAX_BYTES = 256 * 1024

const IMAGE_MIME_BY_EXTENSION = new Map<string, string>([
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
])

const TEXT_MIME_BY_EXTENSION = new Map<string, string>([
  ['.c', 'text/x-c'],
  ['.cpp', 'text/x-c++'],
  ['.cs', 'text/x-csharp'],
  ['.css', 'text/css'],
  ['.csv', 'text/csv'],
  ['.diff', 'text/x-diff'],
  ['.go', 'text/x-go'],
  ['.h', 'text/x-c'],
  ['.hpp', 'text/x-c++'],
  ['.html', 'text/html'],
  ['.ini', 'text/plain'],
  ['.java', 'text/x-java'],
  ['.js', 'text/javascript'],
  ['.jsx', 'text/javascript'],
  ['.json', 'application/json'],
  ['.log', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.patch', 'text/x-diff'],
  ['.ps1', 'text/x-powershell'],
  ['.py', 'text/x-python'],
  ['.rs', 'text/x-rust'],
  ['.sql', 'text/x-sql'],
  ['.toml', 'text/plain'],
  ['.ts', 'text/typescript'],
  ['.tsx', 'text/typescript'],
  ['.txt', 'text/plain'],
  ['.xml', 'application/xml'],
  ['.yaml', 'text/yaml'],
  ['.yml', 'text/yaml'],
])

function uniqueResolvedPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const path of paths) {
    const root = resolve(path)
    const key = process.platform === 'win32' ? root.toLocaleLowerCase() : root
    if (seen.has(key)) continue
    seen.add(key)
    roots.push(root)
  }
  return roots
}

export function resolveFilePreviewPath(input: {
  filePath: string
  root?: string | null
  allowedRoots: string[]
}): string {
  const filePath = input.filePath.trim()
  if (!filePath) {
    throw new FileBrowserError('File path is required', 400)
  }
  const allowedRoots = uniqueResolvedPaths(input.allowedRoots)
  const baseRoot = input.root ? resolve(input.root) : allowedRoots[0]
  if (!baseRoot) {
    throw new FileBrowserError('No file preview roots are configured', 403)
  }
  const target = isAbsolute(filePath) ? resolve(filePath) : resolve(baseRoot, filePath)
  if (!allowedRoots.some((root) => isPathInsideOrEqual(root, target))) {
    throw new FileBrowserError('File path is outside the allowed preview roots', 403)
  }
  return target
}

export function detectFileMimeType(filePath: string): string {
  const extension = extname(filePath).toLowerCase()
  return IMAGE_MIME_BY_EXTENSION.get(extension) ?? TEXT_MIME_BY_EXTENSION.get(extension) ?? 'application/octet-stream'
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

function isTextExtension(filePath: string): boolean {
  return TEXT_MIME_BY_EXTENSION.has(extname(filePath).toLowerCase())
}

function looksLikeText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true
  return !buffer.includes(0)
}

async function readFirstBytes(filePath: string, byteLimit: number): Promise<Buffer> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(byteLimit)
    const result = await handle.read(buffer, 0, byteLimit, 0)
    return buffer.subarray(0, result.bytesRead)
  } finally {
    await handle.close()
  }
}

export async function readFilePreview(input: {
  filePath: string
  root?: string | null
  allowedRoots: string[]
  maxBytes?: number
}): Promise<FilePreview> {
  const target = resolveFilePreviewPath(input)
  const stats = await lstat(target).catch(() => null)
  if (!stats?.isFile()) {
    throw new FileBrowserError('File is not available for preview', 404)
  }

  const mimeType = detectFileMimeType(target)
  const image = isImageMimeType(mimeType)
  const maxBytes = Math.max(4096, Math.min(input.maxBytes ?? DEFAULT_FILE_PREVIEW_MAX_BYTES, 1024 * 1024))

  if (image) {
    return {
      path: target,
      filename: basename(target),
      mimeType,
      size: stats.size,
      kind: 'image',
      content: null,
      truncated: false,
    }
  }

  const sample = await readFirstBytes(target, Math.min(Number(stats.size), Math.min(maxBytes + 1, 8192)))
  const text = isTextExtension(target) || looksLikeText(sample)
  if (!text) {
    return {
      path: target,
      filename: basename(target),
      mimeType,
      size: stats.size,
      kind: 'binary',
      content: null,
      truncated: false,
    }
  }

  const contentBuffer = await readFirstBytes(target, Math.min(stats.size, maxBytes + 1))
  const truncated = contentBuffer.length > maxBytes || stats.size > maxBytes
  const visibleBuffer = truncated ? contentBuffer.subarray(0, maxBytes) : contentBuffer
  return {
    path: target,
    filename: basename(target),
    mimeType,
    size: stats.size,
    kind: 'text',
    content: visibleBuffer.toString('utf8'),
    truncated,
  }
}

export function createFilePreviewStream(filePath: string): ReturnType<typeof createReadStream> {
  return createReadStream(filePath)
}
