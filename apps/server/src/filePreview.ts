import { createReadStream } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { basename, extname, isAbsolute, resolve } from 'node:path'
import type { FilePreview } from '@codex-web/api'
import * as mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import { FileBrowserError, isPathInsideOrEqual } from './fileBrowser.js'

export const DEFAULT_FILE_PREVIEW_MAX_BYTES = 256 * 1024
const MARKDOWN_PREVIEW_MIME = 'text/markdown'
const OFFICE_PREVIEW_SHEET_LIMIT = 6
const OFFICE_PREVIEW_ROW_LIMIT = 80
const OFFICE_PREVIEW_COLUMN_LIMIT = 18

const IMAGE_MIME_BY_EXTENSION = new Map<string, string>([
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
])

const VIDEO_MIME_BY_EXTENSION = new Map<string, string>([
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.mp4', 'video/mp4'],
  ['.ogv', 'video/ogg'],
  ['.webm', 'video/webm'],
])

const BINARY_MIME_BY_EXTENSION = new Map<string, string>([
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsm', 'application/vnd.ms-excel.sheet.macroenabled.12'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.pdf', 'application/pdf'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
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

function decodePercentEncodedPath(path: string): string {
  if (!/%[0-9a-f]{2}/i.test(path)) return path
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function stripFileLocationSuffix(path: string): string {
  const cleaned = path.replace(/\s+\((?:line|行)\s+\d+\)$/i, '')
  const match = /^(.*\.[a-z0-9]{1,12})(?::\d+){1,2}$/i.exec(cleaned)
  return match?.[1] ?? cleaned
}

export function resolveFilePreviewPath(input: {
  filePath: string
  root?: string | null
  allowedRoots: string[]
  allowAbsolutePath?: boolean
}): string {
  const filePath = stripFileLocationSuffix(decodePercentEncodedPath(input.filePath.trim()))
  if (!filePath) {
    throw new FileBrowserError('File path is required', 400)
  }
  const allowedRoots = uniqueResolvedPaths(input.allowedRoots)
  const baseRoot = input.root ? resolve(input.root) : allowedRoots[0]
  if (!baseRoot) {
    throw new FileBrowserError('No file preview roots are configured', 403)
  }
  const target = isAbsolute(filePath) ? resolve(filePath) : resolve(baseRoot, filePath)
  const absolutePathAllowed = Boolean(input.allowAbsolutePath && isAbsolute(filePath))
  if (!absolutePathAllowed && !allowedRoots.some((root) => isPathInsideOrEqual(root, target))) {
    throw new FileBrowserError('File path is outside the allowed preview roots', 403)
  }
  return target
}

export function detectFileMimeType(filePath: string): string {
  const extension = extname(filePath).toLowerCase()
  return (
    IMAGE_MIME_BY_EXTENSION.get(extension) ??
    VIDEO_MIME_BY_EXTENSION.get(extension) ??
    BINARY_MIME_BY_EXTENSION.get(extension) ??
    TEXT_MIME_BY_EXTENSION.get(extension) ??
    'application/octet-stream'
  )
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

function isTextExtension(filePath: string): boolean {
  return TEXT_MIME_BY_EXTENSION.has(extname(filePath).toLowerCase())
}

function isKnownBinaryExtension(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase()
  return BINARY_MIME_BY_EXTENSION.has(extension) || VIDEO_MIME_BY_EXTENSION.has(extension)
}

function isWordPreviewExtension(filePath: string): boolean {
  return ['.docx'].includes(extname(filePath).toLowerCase())
}

function isSpreadsheetPreviewExtension(filePath: string): boolean {
  return ['.ods', '.xls', '.xlsm', '.xlsx'].includes(extname(filePath).toLowerCase())
}

function truncatePreviewContent(content: string, maxBytes: number): { content: string; truncated: boolean } {
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return { content, truncated: false }
  let visible = content
  while (visible && Buffer.byteLength(`${visible}\n\n_文件较大，已截断预览。_`, 'utf8') > maxBytes) {
    visible = visible.slice(0, Math.floor(visible.length * 0.9))
  }
  return {
    content: `${visible.trimEnd()}\n\n_文件较大，已截断预览。_`,
    truncated: true,
  }
}

function markdownCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

function markdownTable(rows: unknown[][]): string {
  const visibleRows = rows
    .filter((row) => row.some((cell) => markdownCell(cell)))
    .slice(0, OFFICE_PREVIEW_ROW_LIMIT)
    .map((row) => row.slice(0, OFFICE_PREVIEW_COLUMN_LIMIT).map(markdownCell))
  if (!visibleRows.length) return '_空工作表_'
  const width = Math.max(1, ...visibleRows.map((row) => row.length))
  const normalizeRow = (row: string[]): string[] => [
    ...row,
    ...Array.from({ length: Math.max(0, width - row.length) }, () => ''),
  ]
  const header = normalizeRow(visibleRows[0] ?? []).map((cell, index) => cell || `列 ${index + 1}`)
  const body = visibleRows.slice(1).map(normalizeRow)
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

async function readWordMarkdownPreview(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath })
  const messages = result.messages.length
    ? `\n\n_转换提示：${result.messages.map((message) => message.message).join('；')}_`
    : ''
  return `${result.value.trim() || '_未能从 Word 文件抽取到可预览文字。_'}${messages}`
}

function readSpreadsheetMarkdownPreview(filePath: string): string {
  const workbook = XLSX.readFile(filePath, {
    cellDates: true,
    sheetRows: OFFICE_PREVIEW_ROW_LIMIT,
  })
  const sheetNames = workbook.SheetNames.slice(0, OFFICE_PREVIEW_SHEET_LIMIT)
  if (!sheetNames.length) return '_未找到可预览的工作表。_'
  return sheetNames
    .map((sheetName) => {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) return `## ${sheetName}\n\n_空工作表_`
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        blankrows: false,
        defval: '',
        header: 1,
        raw: false,
      })
      return `## ${sheetName}\n\n${markdownTable(rows)}`
    })
    .join('\n\n')
}

async function readOfficeMarkdownPreview(filePath: string, maxBytes: number): Promise<{ content: string; truncated: boolean } | null> {
  let markdown: string | null = null
  if (isWordPreviewExtension(filePath)) {
    markdown = await readWordMarkdownPreview(filePath)
  } else if (isSpreadsheetPreviewExtension(filePath)) {
    markdown = readSpreadsheetMarkdownPreview(filePath)
  }
  if (markdown === null) return null
  return truncatePreviewContent(`# ${basename(filePath)}\n\n${markdown}`, maxBytes)
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
  allowAbsolutePath?: boolean
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

  if (isWordPreviewExtension(target) || isSpreadsheetPreviewExtension(target)) {
    try {
      const officePreview = await readOfficeMarkdownPreview(target, maxBytes)
      if (officePreview) {
        return {
          path: target,
          filename: basename(target),
          mimeType: MARKDOWN_PREVIEW_MIME,
          size: stats.size,
          kind: 'text',
          content: officePreview.content,
          truncated: officePreview.truncated,
        }
      }
    } catch {
      // Fall back to the binary preview path when structured extraction fails.
    }
  }

  if (isKnownBinaryExtension(target)) {
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
