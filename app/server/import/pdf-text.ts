// PDF → text, one string per page, lines in reading order. unpdf wraps pdf.js and runs in Node without a
// canvas or a worker. A scanned PDF (images only) comes back as empty pages: no OCR here.
import { extractText, getDocumentProxy } from 'unpdf'

export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { text } = await extractText(pdf, { mergePages: false })
  return Array.isArray(text) ? text : [text]
}

export const isPdf = (bytes: Uint8Array) => bytes.length > 4 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-'
