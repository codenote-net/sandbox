import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import encodePng, { init as initPngEncoder } from '@jsquash/png/encode.js';
import { loadPdfDocument } from '../pdfium/document.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PNG_WASM_RELATIVE_PATH = '../../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm';

let pngInitPromise;

async function ensurePngEncoderReady() {
  if (!pngInitPromise) {
    pngInitPromise = (async () => {
      const wasmPath = join(__dirname, PNG_WASM_RELATIVE_PATH);
      const wasmBinary = await fs.readFile(wasmPath);
      await initPngEncoder(wasmBinary);
    })().catch((error) => {
      pngInitPromise = undefined;
      throw error;
    });
  }
  return pngInitPromise;
}

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

function ensureRenderOptions(options) {
  const { scale, width, height, renderFormFields } = options;
  if (scale != null && (width != null || height != null)) {
    throw new Error('Use either scale or explicit width/height for rendering, not both.');
  }
  if ((width != null && height == null) || (height != null && width == null)) {
    throw new Error('Both width and height must be provided when using explicit sizing.');
  }
  if (width != null && width <= 0) {
    throw new RangeError('Width must be a positive number.');
  }
  if (height != null && height <= 0) {
    throw new RangeError('Height must be a positive number.');
  }
  const renderBase = { render: 'bitmap' };
  if (width != null && height != null) {
    return { ...renderBase, width: Math.floor(width), height: Math.floor(height), renderFormFields };
  }
  const safeScale = scale != null ? scale : 1;
  if (!(safeScale > 0)) {
    throw new RangeError('Scale must be greater than zero.');
  }
  return { ...renderBase, scale: safeScale, renderFormFields };
}

async function renderPageToBitmap(page, renderOptions) {
  const renderResult = await page.render(renderOptions);
  const { width, height, data, originalWidth, originalHeight } = renderResult;
  return {
    width,
    height,
    originalWidth,
    originalHeight,
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
  };
}

async function encodeBitmapToPng(bitmap) {
  await ensurePngEncoderReady();
  const arrayBuffer = await encodePng({
    data: bitmap.data,
    width: bitmap.width,
    height: bitmap.height,
  });
  return Buffer.from(arrayBuffer);
}

export async function renderPdfToPng(source, options = {}) {
  const { pages, password } = options;
  const renderOptions = ensureRenderOptions(options);
  const { document, cleanup } = await loadPdfDocument(source, { password });
  try {
    const pageCount = document.getPageCount();
    const pageIndices = resolvePageIndices(pageCount, pages);
    const outputs = [];

    for (const pageIndex of pageIndices) {
      const page = document.getPage(pageIndex);
      const bitmap = await renderPageToBitmap(page, renderOptions);
      const pngBuffer = await encodeBitmapToPng(bitmap);
      outputs.push({
        pageNumber: pageIndex + 1,
        width: bitmap.width,
        height: bitmap.height,
        originalWidth: bitmap.originalWidth,
        originalHeight: bitmap.originalHeight,
        png: pngBuffer,
      });
    }

    return outputs;
  } finally {
    cleanup();
  }
}
