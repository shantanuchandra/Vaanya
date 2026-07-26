import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCorpus } from '../lib/contracts.mjs';

export function readJsonl(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const lines = source.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  const records = [];
  const errors = [];

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.trim() === '') {
      errors.push(`blank record at line ${lineNumber}`);
      continue;
    }
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      errors.push(`invalid JSON at line ${lineNumber}: ${error.message}`);
    }
  }

  return { records, errors };
}

export function validateJsonlFile(filePath) {
  const { records, errors } = readJsonl(filePath);
  if (errors.length) return { records, errors };
  return { records, errors: validateCorpus(records) };
}

function countLanguages(records) {
  return records.reduce(
    (counts, record) => {
      const pathName = record?.language?.path;
      if (pathName in counts) counts[pathName] += 1;
      return counts;
    },
    { 'hi-hinglish': 0, 'kn-kanglish': 0, en: 0 }
  );
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write('Usage: node validate-corpus.mjs <corpus.jsonl>\n');
    process.exitCode = 1;
    return;
  }

  const resolvedPath = path.resolve(inputPath);
  if (!fs.existsSync(resolvedPath)) {
    process.stderr.write(`Corpus file not found: ${resolvedPath}\n`);
    process.exitCode = 1;
    return;
  }

  const result = validateJsonlFile(resolvedPath);
  if (result.errors.length) {
    process.stderr.write(`${result.errors.slice(0, 100).join('\n')}\n`);
    if (result.errors.length > 100) {
      process.stderr.write(`...and ${result.errors.length - 100} more errors\n`);
    }
    process.stderr.write(`errors: ${result.errors.length}\n`);
    process.exitCode = 1;
    return;
  }

  const languages = countLanguages(result.records);
  process.stdout.write(`Validated ${result.records.length} cases\n`);
  process.stdout.write(`hi-hinglish: ${languages['hi-hinglish']}\n`);
  process.stdout.write(`kn-kanglish: ${languages['kn-kanglish']}\n`);
  process.stdout.write(`en: ${languages.en}\n`);
  process.stdout.write('errors: 0\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
