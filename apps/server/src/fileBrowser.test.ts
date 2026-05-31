import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileBrowserError, listProjectDirectory } from './fileBrowser.js'

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codex-web-filebrowser-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('file browser', () => {
  it('lists directories before files and preserves project-relative paths', async () => {
    const root = await createTempRoot()
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'README.md'), '# readme')
    await writeFile(join(root, 'src', 'index.ts'), 'export {}')

    const listing = await listProjectDirectory({ root, limit: 20 })

    expect(listing.root).toBe(root)
    expect(listing.relativePath).toBe('')
    expect(listing.parentRelativePath).toBeNull()
    expect(listing.limited).toBe(false)
    expect(listing.entries.map((entry) => [entry.name, entry.kind, entry.relativePath])).toEqual([
      ['docs', 'directory', 'docs'],
      ['src', 'directory', 'src'],
      ['README.md', 'file', 'README.md'],
    ])

    const srcListing = await listProjectDirectory({ root, relativePath: 'src' })
    expect(srcListing.relativePath).toBe('src')
    expect(srcListing.parentRelativePath).toBe('')
    expect(srcListing.entries).toMatchObject([
      {
        name: 'index.ts',
        kind: 'file',
        relativePath: 'src/index.ts',
        extension: 'ts',
      },
    ])
  })

  it('rejects traversal outside the allowed project root', async () => {
    const root = await createTempRoot()
    const sibling = await createTempRoot()
    await writeFile(join(sibling, 'secret.txt'), 'secret')

    await expect(listProjectDirectory({ root, relativePath: '..' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Path is outside the project root',
    } satisfies Partial<FileBrowserError>)
  })

  it('limits large listings and marks the response as limited', async () => {
    const root = await createTempRoot()
    await Promise.all(
      Array.from({ length: 30 }, (_, index) => writeFile(join(root, `file-${String(index).padStart(2, '0')}.txt`), 'x')),
    )

    const listing = await listProjectDirectory({ root, limit: 20 })

    expect(listing.entries).toHaveLength(20)
    expect(listing.limited).toBe(true)
  })

  it('rejects file targets because only directories can be browsed', async () => {
    const root = await createTempRoot()
    await writeFile(join(root, 'README.md'), '# readme')

    await expect(listProjectDirectory({ root, relativePath: 'README.md' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Path is not an existing directory',
    } satisfies Partial<FileBrowserError>)
  })
})
