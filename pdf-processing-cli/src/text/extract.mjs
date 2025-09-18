import { loadPdfDocument } from '../pdfium/document.mjs';

function resolvePageIndices(pageCount, pages) {
  if (!pages || pages.length === 0) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }
  return pages.map((pageNumber) => {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new RangeError(`Page number out of range: ${pageNumber}`);
    }
    return pageNumber - 1;
  });
}

function normalizeText(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function closePage(document, page) {
  if (document?.module && page?.pageIdx != null) {
    document.module._FPDF_ClosePage(page.pageIdx);
  }
}

export async function extractTextFromPdf(source, options = {}) {
  const { pages, joinPages = false, normalize = true, password } = options;
  const { document, cleanup } = await loadPdfDocument(source, { password });
  try {
    const pageCount = document.getPageCount();
    const pageIndices = resolvePageIndices(pageCount, pages);
    const results = [];

    for (const pageIndex of pageIndices) {
      const page = document.getPage(pageIndex);
      try {
        const rawText = page.getText() ?? '';
        const text = normalize ? normalizeText(rawText) : rawText;
        results.push({ pageNumber: pageIndex + 1, text });
      } finally {
        closePage(document, page);
      }
    }

    if (joinPages) {
      return results.map((result) => result.text).join('\n\n');
    }
    return results;
  } finally {
    cleanup();
  }
}
