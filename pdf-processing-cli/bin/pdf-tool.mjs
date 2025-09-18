#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import process from 'node:process';
import { extractTextFromPdf } from '../src/text/extract.mjs';
import { renderPdfToPng } from '../src/image/render.mjs';

function printUsage() {
  const script = 'pdf-tool';
  console.log(`Usage: ${script} <pdf-path> [options]\n\n` +
    'Options:\n' +
    '  --text-out <file>          Write extracted text to the specified file.\n' +
    '  --text-format <plain|json> Output format for extracted text (default: plain).\n' +
    '  --text-join                Join extracted text into a single block (plain only).\n' +
    '  --png-dir <directory>      Directory to write rendered PNG files.\n' +
    '  --scale <number>           Scale factor for rendering (mutually exclusive with width/height).\n' +
    '  --width <pixels>           Target width for rendering (requires --height).\n' +
    '  --height <pixels>          Target height for rendering (requires --width).\n' +
    '  --pages <list>             Comma separated list of pages or ranges (e.g. 1,3-5).\n' +
    '  --password <string>        Password for encrypted PDFs.\n' +
    '  --render-form-fields       Draw interactive form fields in the rendered images.\n' +
    '  --help                     Show this help message.\n');
}

function parseRange(part) {
  const [startRaw, endRaw] = part.split('-').map((value) => value.trim());
  const start = Number.parseInt(startRaw, 10);
  const end = Number.parseInt(endRaw, 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0) {
    throw new Error(`Invalid page range: ${part}`);
  }
  if (end < start) {
    throw new Error(`Page range must be ascending: ${part}`);
  }
  const values = [];
  for (let page = start; page <= end; page += 1) {
    values.push(page);
  }
  return values;
}

function parsePages(value) {
  return value.split(',').flatMap((part) => {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      return [];
    }
    if (trimmed.includes('-')) {
      return parseRange(trimmed);
    }
    const page = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(page) || page <= 0) {
      throw new Error(`Invalid page number: ${trimmed}`);
    }
    return [page];
  });
}

function parseArgs(argv) {
  const options = {
    positional: [],
    textJoin: false,
    renderFormFields: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      options.positional.push(arg);
      continue;
    }

    const [flag, maybeValue] = arg.split('=', 2);
    const readValue = () => {
      if (maybeValue !== undefined) {
        return maybeValue;
      }
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Missing value for ${flag}`);
      }
      index += 1;
      return next;
    };

    switch (flag) {
      case '--help':
        options.help = true;
        break;
      case '--text-out':
        options.textOut = readValue();
        break;
      case '--text-format':
        options.textFormat = readValue();
        break;
      case '--text-join':
        options.textJoin = true;
        break;
      case '--png-dir':
        options.pngDir = readValue();
        break;
      case '--scale':
        options.scale = Number.parseFloat(readValue());
        break;
      case '--width':
        options.width = Number.parseFloat(readValue());
        break;
      case '--height':
        options.height = Number.parseFloat(readValue());
        break;
      case '--pages':
        options.pages = parsePages(readValue());
        break;
      case '--password':
        options.password = readValue();
        break;
      case '--render-form-fields':
        options.renderFormFields = true;
        break;
      default:
        throw new Error(`Unknown option: ${flag}`);
    }
  }

  return options;
}

function validateOptions(options) {
  if (options.help) {
    return options;
  }
  if (options.positional.length === 0) {
    throw new Error('PDF path is required.');
  }
  if (!options.textOut && !options.pngDir) {
    throw new Error('Specify at least one output: --text-out or --png-dir.');
  }
  if (options.textFormat && !['plain', 'json'].includes(options.textFormat)) {
    throw new Error('Unsupported --text-format value. Use "plain" or "json".');
  }
  if (options.textJoin && options.textFormat === 'json') {
    throw new Error('--text-join cannot be combined with --text-format json.');
  }
  if (options.scale != null && !(options.scale > 0)) {
    throw new Error('Scale must be a positive number.');
  }
  if (options.width != null && !(options.width > 0)) {
    throw new Error('Width must be a positive number.');
  }
  if (options.height != null && !(options.height > 0)) {
    throw new Error('Height must be a positive number.');
  }
  return options;
}

async function writeTextOutput(textResults, options, outputPath) {
  const absolutePath = resolve(process.cwd(), outputPath);
  await fs.mkdir(dirname(absolutePath), { recursive: true });
  const format = options.textFormat ?? 'plain';

  if (format === 'json') {
    const jsonPayload = JSON.stringify(textResults, null, 2);
    await fs.writeFile(absolutePath, jsonPayload, 'utf8');
    return { type: 'json', path: absolutePath };
  }

  const content = options.textJoin
    ? textResults.map(({ text }) => text).join('\n\n')
    : textResults.map(({ pageNumber, text }) => `# Page ${pageNumber}\n${text}`).join('\n\n');
  await fs.writeFile(absolutePath, content, 'utf8');
  return { type: 'plain', path: absolutePath };
}

function determineFilename(pageNumber, pad) {
  return `page-${String(pageNumber).padStart(pad, '0')}.png`;
}

async function writePngOutputs(pngResults, outputDir) {
  const absoluteDir = resolve(process.cwd(), outputDir ?? '.');
  await fs.mkdir(absoluteDir, { recursive: true });
  const maxPage = pngResults.reduce((acc, result) => Math.max(acc, result.pageNumber), 0);
  const pad = Math.max(3, String(maxPage).length);

  const written = [];
  for (const result of pngResults) {
    const filename = determineFilename(result.pageNumber, pad);
    const destination = resolve(absoluteDir, filename);
    await fs.writeFile(destination, result.png);
    written.push({ ...result, path: destination });
  }
  return written;
}

async function main() {
  try {
    const options = validateOptions(parseArgs(process.argv));

    if (options.help) {
      printUsage();
      return;
    }

    const pdfPath = resolve(process.cwd(), options.positional[0]);
    const sharedOptions = {
      pages: options.pages,
      password: options.password,
    };

    if (options.textOut) {
      const textResults = await extractTextFromPdf(pdfPath, {
        ...sharedOptions,
        joinPages: false,
      });
      const output = await writeTextOutput(textResults, options, options.textOut);
      console.log(`Text extracted to ${output.path} (${output.type})`);
    }

    if (options.pngDir) {
      const pngResults = await renderPdfToPng(pdfPath, {
        ...sharedOptions,
        scale: options.scale,
        width: options.width,
        height: options.height,
        renderFormFields: options.renderFormFields,
      });
      const written = await writePngOutputs(pngResults, options.pngDir);
      for (const file of written) {
        console.log(`Rendered page ${file.pageNumber} -> ${file.path} (${file.width}x${file.height})`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

await main();
