interface MammothLike {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>
}

/**
 * Word (.docx) 文本提取。使用 mammoth 提取正文纯文本，
 * 保留段落换行，便于后续按行解析词条。
 */
export class DocxTextExtractor {
  async extract(data: Buffer): Promise<string> {
    const loaded = (await import('mammoth')) as unknown as MammothLike & {
      default?: MammothLike
    }
    const mammoth = loaded.default ?? loaded
    try {
      const result = await mammoth.extractRawText({ buffer: data })
      return result.value
    } catch {
      throw new Error('DOCX_UNREADABLE')
    }
  }
}
