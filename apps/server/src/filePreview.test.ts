import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
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

  it('recognizes PDFs as inline binary previews', async () => {
    const root = await createTempRoot()
    await writeFile(join(root, 'report.pdf'), Buffer.from('%PDF-1.7\n% preview\n'))

    const preview = await readFilePreview({
      filePath: 'report.pdf',
      root,
      allowedRoots: [root],
    })

    expect(preview.kind).toBe('binary')
    expect(preview.mimeType).toBe('application/pdf')
    expect(preview.content).toBeNull()
  })

  it('recognizes common video files as streamed binary previews', async () => {
    const root = await createTempRoot()
    await writeFile(join(root, 'joined.mp4'), Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))

    const preview = await readFilePreview({
      filePath: 'joined.mp4',
      root,
      allowedRoots: [root],
    })

    expect(preview.kind).toBe('binary')
    expect(preview.mimeType).toBe('video/mp4')
    expect(preview.content).toBeNull()
  })

  it('extracts spreadsheet files into a markdown preview', async () => {
    const root = await createTempRoot()
    const filePath = join(root, 'sheet.xlsx')
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Name', 'Score'],
      ['Darwin', 98],
      ['Locke', 87],
    ])
    XLSX.utils.book_append_sheet(workbook, sheet, 'Scores')
    XLSX.writeFile(workbook, filePath)

    const preview = await readFilePreview({
      filePath: 'sheet.xlsx',
      root,
      allowedRoots: [root],
    })

    expect(preview).toMatchObject({
      filename: 'sheet.xlsx',
      kind: 'text',
      mimeType: 'text/markdown',
    })
    expect(preview.content).toContain('## Scores')
    expect(preview.content).toContain('| Name | Score |')
    expect(preview.content).toContain('| Darwin | 98 |')
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

  it('allows direct previews for absolute local file paths', async () => {
    const root = await createTempRoot()
    const sibling = await createTempRoot()
    await writeFile(join(sibling, 'report.md'), '# report outside project\n')

    const preview = await readFilePreview({
      filePath: join(sibling, 'report.md'),
      allowedRoots: [root],
      allowAbsolutePath: true,
    })

    expect(preview).toMatchObject({
      filename: 'report.md',
      kind: 'text',
      mimeType: 'text/markdown',
    })
    expect(preview.content).toContain('report outside project')
  })

  it('decodes percent-encoded absolute local file paths before previewing', async () => {
    const root = await createTempRoot()
    const sibling = await createTempRoot()
    const filePath = join(sibling, '日報核對.md')
    await writeFile(filePath, '# encoded path preview\n')

    const preview = await readFilePreview({
      filePath: encodeURI(filePath),
      allowedRoots: [root],
      allowAbsolutePath: true,
    })

    expect(preview).toMatchObject({
      filename: '日報核對.md',
      kind: 'text',
      mimeType: 'text/markdown',
    })
    expect(preview.content).toContain('encoded path preview')
  })

  it('strips editor line suffixes before resolving preview paths', async () => {
    const root = await createTempRoot()
    await writeFile(join(root, 'report.md'), '# report with line suffix\n')

    const preview = await readFilePreview({
      filePath: 'report.md:1',
      root,
      allowedRoots: [root],
    })

    expect(preview).toMatchObject({
      filename: 'report.md',
      kind: 'text',
    })
    expect(preview.content).toContain('line suffix')
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
