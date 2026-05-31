import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileBrowserError } from './fileBrowser.js'
import { detectFileMimeType, readFilePreview, resolveFilePreviewPath } from './filePreview.js'

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codex-web-filepreview-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('file preview', () => {
  it('reads text files from an allowed project root', async () => {
    const root = await createTempRoot()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'index.ts'), 'export const previewSentinel = true\n')

    const preview = await readFilePreview({
      filePath: 'src/index.ts',
      root,
      allowedRoots: [root],
    })

    expect(preview).toMatchObject({
      filename: 'index.ts',
      kind: 'text',
      mimeType: 'text/typescript',
      truncated: false,
    })
    expect(preview.content).toContain('previewSentinel')
  })

  it('recognizes images without reading image bytes into json content', async () => {
    const root = await createTempRoot()
    await writeFile(join(root, 'screenshot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const preview = await readFilePreview({
      filePath: join(root, 'screenshot.png'),
      allowedRoots: [root],
    })

    expect(preview.kind).toBe('image')
    expect(preview.mimeType).toBe('image/png')
    expect(preview.content).toBeNull()
  })

  it('rejects paths outside allowed roots', async () => {
    const root = await createTempRoot()
    const sibling = await createTempRoot()
    await writeFile(join(sibling, 'secret.txt'), 'secret')

    expect(() =>
      resolveFilePreviewPath({
        filePath: join(sibling, 'secret.txt'),
        allowedRoots: [root],
      }),
    ).toThrowError(FileBrowserError)
  })

  it('falls back to binary for unknown files with nul bytes', async () => {
    const root = await createTempRoot()
    await writeFile(join(root, 'asset.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]))

    const preview = await readFilePreview({
      filePath: 'asset.bin',
      root,
      allowedRoots: [root],
    })

    expect(preview.kind).toBe('binary')
    expect(preview.content).toBeNull()
    expect(detectFileMimeType(join(root, 'asset.bin'))).toBe('application/octet-stream')
  })
})
