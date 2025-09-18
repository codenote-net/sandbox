# PDF Processing CLI

A Node.js command-line utility for extracting text and rendering PNG images from PDF files using the WebAssembly build of PDFium and a WASM-based PNG encoder.

## Prerequisites

- Node.js 24.8.0 (matching the project engine constraint)
- npm (bundled with Node.js)

## Setup

```bash
npm install
```

This downloads the required WebAssembly assets for `@hyzyla/pdfium` and `@jsquash/png`.

## Usage

```bash
node ./bin/pdf-tool.mjs <pdf-path> [options]
```

After running `npm install`, you can also add the command to your PATH via `npx pdf-tool` or by installing the package globally.

### Options

- `--text-out <file>`: Write extracted text to the specified file.
- `--text-format <plain|json>`: Choose plain text (default) or JSON output.
- `--text-join`: Join all page text into a single block (plain text only).
- `--png-dir <directory>`: Directory to write rendered PNG files (one per page).
- `--scale <number>`: Render scale multiplier (default: 1). Mutually exclusive with `--width`/`--height`.
- `--width <pixels>` and `--height <pixels>`: Explicit output size (both required when used).
- `--pages <list>`: Comma-separated page numbers or ranges (e.g. `1,3-5`). Defaults to all pages.
- `--password <string>`: Password for encrypted PDFs.
- `--render-form-fields`: Draw interactive form fields when rendering PNGs.
- `--help`: Show usage information.

### Examples

Extract text as JSON and render PNGs for pages 1–3 at 2× scale:

```bash
node ./bin/pdf-tool.mjs ./docs/sample.pdf \
  --pages 1-3 \
  --text-out output/sample.json \
  --text-format json \
  --png-dir output/images \
  --scale 2
```

Extract all text into a single plain-text file:

```bash
node ./bin/pdf-tool.mjs ./docs/sample.pdf --text-out output/sample.txt --text-join
```

Render form fields at 300 dpi (scale 4.17) for every page:

```bash
node ./bin/pdf-tool.mjs ./docs/sample.pdf --png-dir output/images --scale 4.17 --render-form-fields
```

## Project Structure

- `src/pdfium/`: Pdfium initialisation helpers and document loading utilities.
- `src/text/`: Text extraction module.
- `src/image/`: PDF page rendering and PNG encoding module.
- `bin/pdf-tool.mjs`: CLI entrypoint that wires text extraction and rendering features.

## Notes

- WASM binaries are loaded directly from the installed packages at runtime; no additional build step is required.
- Ensure the runtime has permission to read the target PDF and write to the requested output paths.
