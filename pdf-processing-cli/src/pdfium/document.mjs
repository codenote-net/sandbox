import { promises as fs } from 'node:fs';
import { getPdfiumLibrary } from './library.mjs';

function toUint8Array(source) {
  if (source instanceof Uint8Array) {
    return source;
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer);
  }
  if (typeof source === 'string') {
    throw new TypeError('Expected PDF data, received file path string');
  }
  throw new TypeError('Unsupported PDF source type');
}

async function readSource(source) {
  if (typeof source === 'string') {
    return new Uint8Array(await fs.readFile(source));
  }
  return toUint8Array(source);
}

export async function loadPdfDocument(source, { password } = {}) {
  const data = await readSource(source);
  const library = await getPdfiumLibrary();
  const document = await library.loadDocument(data, password);
  const cleanup = () => {
    document.destroy();
  };
  return { document, cleanup };
}
