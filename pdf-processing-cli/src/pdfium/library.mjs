import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFiumLibrary } from '@hyzyla/pdfium';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_RELATIVE_PATH = '../../node_modules/@hyzyla/pdfium/dist/pdfium.wasm';

let libraryPromise;
let libraryInstance;
let destroyRegistered = false;

function resolveWasmPath() {
  return join(__dirname, WASM_RELATIVE_PATH);
}

async function initLibrary() {
  const wasmUrl = resolveWasmPath();
  const library = await PDFiumLibrary.init({ wasmUrl });
  if (!destroyRegistered) {
    destroyRegistered = true;
    process.once('exit', () => {
      library.destroy();
    });
  }
  return library;
}

export async function getPdfiumLibrary() {
  if (!libraryPromise) {
    libraryPromise = initLibrary()
      .then((library) => {
        libraryInstance = library;
        return library;
      })
      .catch((error) => {
        libraryPromise = undefined;
        throw error;
      });
  }
  return libraryPromise;
}

export function getInitializedLibrary() {
  if (!libraryInstance) {
    throw new Error('PDFium library has not been initialized yet');
  }
  return libraryInstance;
}

export async function withPdfiumLibrary(fn) {
  const library = await getPdfiumLibrary();
  return fn(library);
}
