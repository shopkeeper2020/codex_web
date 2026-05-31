import { lstat, readdir } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import type { FileBrowserEntry, FileBrowserListing } from '@codex-web/domain'

const DEFAULT_ENTRY_LIMIT = 300

export class FileBrowserError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
  }
}

function comparablePath(value: string): string {
  return process.platform === 'win32' ? value.toLocaleLowerCase() : value
}

export function isPathInsideOrEqual(parent: string, child: string): boolean {
  const normalizedParent = comparablePath(resolve(parent))
  const normalizedChild = comparablePath(resolve(child))
  if (normalizedParent === normalizedChild) return true
  const relativePath = relative(normalizedParent, normalizedChild)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

function toBrowserPath(value: string): string {
  return value.split(/[\\/]+/).filter(Boolean).join('/')
}

function relativeToRoot(root: string, target: string): string {
  return toBrowserPath(relative(root, target))
}

function entryKind(entry: Awaited<ReturnType<typeof lstat>>, direntKind: {
  isDirectory: () => boolean
  isFile: () => boolean
  isSymbolicLink: () => boolean
}): FileBrowserEntry['kind'] {
  if (direntKind.isSymbolicLink() || entry.isSymbolicLink()) return 'symlink'
  if (direntKind.isDirectory() || entry.isDirectory()) return 'directory'
  if (direntKind.isFile() || entry.isFile()) return 'file'
  return 'other'
}

export async function listProjectDirectory(input: {
  root: string
  relativePath?: string | null
  limit?: number
}): Promise<FileBrowserListing> {
  const root = resolve(input.root)
  const target = resolve(root, input.relativePath || '.')
  const limit = Math.max(20, Math.min(input.limit ?? DEFAULT_ENTRY_LIMIT, 1000))

  if (!isPathInsideOrEqual(root, target)) {
    throw new FileBrowserError('Path is outside the project root', 403)
  }

  const rootStats = await lstat(root).catch(() => null)
  if (!rootStats?.isDirectory()) {
    throw new FileBrowserError('Project root is not an existing directory', 404)
  }

  const targetStats = await lstat(target).catch(() => null)
  if (!targetStats?.isDirectory()) {
    throw new FileBrowserError('Path is not an existing directory', 404)
  }

  const dirents = await readdir(target, { withFileTypes: true })
  const entries = await Promise.all(
    dirents.map(async (dirent): Promise<FileBrowserEntry | null> => {
      const fullPath = resolve(target, dirent.name)
      if (!isPathInsideOrEqual(root, fullPath)) return null
      const stats = await lstat(fullPath).catch(() => null)
      if (!stats) return null
      const kind = entryKind(stats, dirent)
      const relativePath = relativeToRoot(root, fullPath)
      return {
        name: dirent.name,
        kind,
        path: fullPath,
        relativePath,
        size: kind === 'file' ? stats.size : null,
        mtimeIso: Number.isFinite(stats.mtimeMs) ? stats.mtime.toISOString() : null,
        extension: kind === 'file' ? extname(dirent.name).slice(1).toLowerCase() || null : null,
      }
    }),
  )

  const visibleEntries = entries
    .filter((entry): entry is FileBrowserEntry => Boolean(entry))
    .sort((left, right) => {
      const leftRank = left.kind === 'directory' ? 0 : left.kind === 'file' ? 1 : 2
      const rightRank = right.kind === 'directory' ? 0 : right.kind === 'file' ? 1 : 2
      return leftRank - rightRank || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    })

  const relativePath = relativeToRoot(root, target)
  const parentTarget = relativePath ? resolve(target, '..') : null

  return {
    root,
    path: target,
    relativePath,
    parentRelativePath: parentTarget && isPathInsideOrEqual(root, parentTarget) ? relativeToRoot(root, parentTarget) : null,
    entries: visibleEntries.slice(0, limit),
    limited: visibleEntries.length > limit,
  }
}

export function projectRootLabel(root: string): string {
  return basename(resolve(root)) || resolve(root)
}
