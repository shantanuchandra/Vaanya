import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(CURRENT_DIR, '..');
const VALIDATOR = path.join(ROOT_DIR, 'scripts', 'validate-corpus.mjs');
const CORPUS = path.join(ROOT_DIR, 'corpus', 'vaanaya-pac-v1.jsonl');

test('accepts the generated 1000-case corpus', () => {
  const output = execFileSync(process.execPath, [VALIDATOR, CORPUS], {
    encoding: 'utf8'
  });
  assert.match(output, /Validated 1000 cases/);
  assert.match(output, /errors: 0/);
});

test('rejects malformed JSON and identifies the line', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaanaya-corpus-'));
  const malformedPath = path.join(tempDir, 'malformed.jsonl');
  fs.writeFileSync(malformedPath, '{"case_id":"PAC-SYN-0001"}\n{not-json}\n');

  const result = spawnSync(process.execPath, [VALIDATOR, malformedPath], {
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /line 2/i);
});

test('rejects a blank record with a line-specific error', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaanaya-corpus-'));
  const malformedPath = path.join(tempDir, 'blank.jsonl');
  fs.writeFileSync(malformedPath, '{"case_id":"PAC-SYN-0001"}\n\n');

  const result = spawnSync(process.execPath, [VALIDATOR, malformedPath], {
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /blank record.*line 2/i);
});

