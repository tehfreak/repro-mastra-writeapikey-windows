import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

const SANDBOX = path.join(os.tmpdir(), 'repro-mastra-writeapikey');

const KEYS = [
  { label: 'alphanumeric', key: 'sk-proj-abc123' },
  { label: 'contains-equals', key: 'sk-proj-a+b/c=d' },
  { label: 'base64-padded', key: 'AIzaSyBx9K2mQ==' },
];

interface Row {
  label: string;
  key: string;
  raw: string | null;
  value: string | null;
  ok: boolean | null;
}

function section(title: string): void {
  console.log('\n' + title);
  console.log('-'.repeat(title.length));
}

async function scaffold(label: string, key: string): Promise<{ raw: string; value: string }> {
  const dir = path.join(SANDBOX, label);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  await execa(
    'npx',
    [
      '--yes',
      'create-mastra@1.19.0',
      'myapp',
      '--llm',
      'openai',
      '--llm-api-key',
      key,
      '-c',
      'agents,tools',
      '--no-example',
      '--dir',
      'src/',
    ],
    { cwd: dir, stdio: 'pipe' },
  );

  const raw = await fs.readFile(path.join(dir, 'myapp', '.env'), 'utf8');
  const line = raw.split(/\r?\n/)[0];
  const value = line.slice(line.indexOf('=') + 1);
  return { raw, value };
}

section('environment');
console.log('  platform:', process.platform);
console.log('  node:', process.version);
console.log('  ComSpec:', process.env.ComSpec ?? '(not windows)');

section('scaffolding one project per key shape');

let corrupted = false;
const rows: Row[] = [];

for (const { label, key } of KEYS) {
  process.stdout.write(`  ${label.padEnd(16)} `);
  try {
    const { raw, value } = await scaffold(label, key);
    const ok = value === key;
    if (!ok) corrupted = true;
    console.log(ok ? 'round-trips' : 'corrupted');
    rows.push({ label, key, raw, value, ok });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.log('scaffold failed');
    console.log('    ' + message.split('\n').slice(0, 2).join('\n    '));
    rows.push({ label, key, raw: null, value: null, ok: null });
  }
}

section('results');
for (const row of rows) {
  console.log(`\n  [${row.label}]`);
  console.log('    passed to --llm-api-key:', JSON.stringify(row.key));
  console.log('    bytes written to .env  :', row.raw === null ? '(scaffold failed)' : JSON.stringify(row.raw));
  console.log('    value read back        :', row.value === null ? '(n/a)' : JSON.stringify(row.value));
  console.log('    round-trips            :', row.ok === null ? 'unknown' : row.ok ? 'yes' : 'no');
}

section('verdict');
console.log(corrupted ? 'VERDICT: CORRUPTED' : 'VERDICT: CLEAN');
console.log('sandbox:', SANDBOX);
