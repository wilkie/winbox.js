#!/usr/bin/env node
/**
 * Fetches the hardware-generated 80286 instruction tests used by the CPU
 * conformance oracle -- or, with `--cpu 386`, the 80386's
 * (https://github.com/SingleStepTests/80386, captured from a 386EX: every
 * opcode under every operand- and address-size prefix it takes). The 386's
 * are kept as the suite publishes them, `.MOO.gz`, in
 * test/conformance/vectors386/, and read by `test/conformance/moo.ts`.
 *
 *   node scripts/fetch-cpu-tests.mjs --cpu 386         # a subset
 *   node scripts/fetch-cpu-tests.mjs --cpu 386 --all   # all of it, ~600 MiB
 *
 * The corpus is produced by Daniel Balsom from a real Harris N80C286 using an
 * ArduinoX86 interface board: for each instruction form it records the full
 * register, flag and memory state before and after execution. That makes it an
 * oracle in the strict sense -- the expected answers come from silicon, not
 * from another emulator that might share our misconceptions.
 *
 *   https://github.com/SingleStepTests/80286
 *
 * The whole real-mode suite is roughly 310 MiB compressed, so nothing is
 * committed. By default this fetches a representative subset; pass --all for
 * everything, or name opcodes to fetch just those.
 *
 *   node scripts/fetch-cpu-tests.mjs                 # the default subset
 *   node scripts/fetch-cpu-tests.mjs --all           # every opcode
 *   node scripts/fetch-cpu-tests.mjs 00 01 D0 F6     # specific opcodes
 *   node scripts/fetch-cpu-tests.mjs --list          # what is available
 *
 * Tests land in test/conformance/vectors/ as JSON, which is gitignored.
 */

import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const run = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'test', 'conformance', '.cache');
const VECTORS = join(ROOT, 'test', 'conformance', 'vectors');

/* The 386's suite with `--cpu 386`, the 286's otherwise. */
const CPU386 =
  process.argv.includes('--cpu') && process.argv[process.argv.indexOf('--cpu') + 1] === '386';
const REPO = CPU386 ? 'SingleStepTests/80386' : 'SingleStepTests/80286';
const BRANCH = 'main';
const SUITE = CPU386 ? 'v1_ex_real_mode' : 'v1_real_mode';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
const VECTORS386 = join(ROOT, 'test', 'conformance', 'vectors386');

/**
 * The 386's own instructions, which have no 286 file to follow: the
 * extensions after 0F -- MOVZX and MOVSX, the bit tests and scans, the double
 * shifts, IMUL, SETcc, the far-pointer loads and FS and GS -- by file name.
 */
const DEFAULT_386 = [
  '0FB6',
  '0FB7',
  '0FBE',
  '0FBF',
  '0FA3',
  '0FAB',
  '0FB3',
  '0FBB',
  '0FBA',
  '0FBC',
  '0FBD',
  '0FA4',
  '0FA5',
  '0FAC',
  '0FAD',
  '0FAF',
  '0FB2',
  '0FB4',
  '0FB5',
  '0FA0',
  '0FA1',
  '0FA8',
  '0FA9',
  '0F90',
  '0F94',
  '0F95',
  '0F9C',
  '0F84',
  '0F85',
];

/**
 * A cross-section of the instruction set rather than an arbitrary prefix:
 * the ALU forms where flag handling is easiest to get wrong, the shift and
 * rotate group, string operations, multiply and divide, and BCD adjust.
 */
const DEFAULT_OPCODES = [
  '00',
  '01',
  '02',
  '03',
  '04',
  '05', // ADD
  '10',
  '11',
  '12',
  '13', // ADC
  '18',
  '19',
  '1A',
  '1B', // SBB
  '20',
  '21',
  '28',
  '29', // AND, SUB
  '30',
  '31',
  '38',
  '39', // XOR, CMP
  '40',
  '48', // INC/DEC reg
  '84',
  '85',
  '86',
  '87', // TEST, XCHG
  '88',
  '89',
  '8A',
  '8B', // MOV
  'A4',
  'A5',
  'A6',
  'A7', // MOVS, CMPS
  'AA',
  'AB',
  'AC',
  'AD',
  'AE',
  'AF', // STOS, LODS, SCAS
  'C0',
  'C1',
  'D0',
  'D1',
  'D2',
  'D3', // shifts and rotates
  'D4',
  'D5',
  '27',
  '2F',
  '37',
  '3F', // AAM, AAD, DAA, DAS, AAA, AAS
  'F6',
  'F7', // NOT/NEG/MUL/IMUL/DIV/IDIV
  'F8',
  'F9',
  'FA',
  'FB',
  'FC',
  'FD',
  'FE',
  'FF',
];

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listAvailable() {
  const url = `https://api.github.com/repos/${REPO}/contents/${SUITE}`;
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'winbox.js' },
  });

  if (!response.ok) {
    throw new Error(`listing ${SUITE} failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json())
    .filter((entry) => entry.name.toLowerCase().endsWith('.moo.gz'))
    .map((entry) => ({
      name: entry.name,
      // 'C0.3.MOO.gz' -> 'C0.3'. Opcodes with a /r extension group publish one
      // file per group, and they must not collapse onto a single name.
      stem: entry.name.replace(/\.MOO\.gz$/i, ''),
      opcode: entry.name.split('.')[0],
      size: entry.size,
    }));
}

async function download(name, destination) {
  const url = `${RAW}/${SUITE}/${name}`;
  const response = await fetch(url, { headers: { 'user-agent': 'winbox.js' } });

  if (!response.ok) {
    throw new Error(`${name}: ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function ensureConverter() {
  const converter = join(CACHE, 'moo2json.py');

  if (!(await exists(converter))) {
    log('Fetching the MOO -> JSON converter from the test suite repository');
    const response = await fetch(`${RAW}/tools/moo2json.py`, {
      headers: { 'user-agent': 'winbox.js' },
    });

    if (!response.ok) {
      throw new Error(`moo2json.py: ${response.status} ${response.statusText}`);
    }

    await writeFile(converter, await response.text());
  }

  return converter;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    log(
      [
        'Usage: node scripts/fetch-cpu-tests.mjs [--cpu 386] [--all|--list|OPCODE...]',
        '',
        '  --cpu 386       the 80386 suite rather than the 80286 one',
        '  (no arguments)  fetch a representative subset',
        '  --all           fetch every opcode (~310 MiB compressed)',
        '  --list          list the opcodes the suite publishes',
        '  OPCODE...       fetch specific opcodes, e.g. 00 D0 F7',
      ].join('\n')
    );
    return;
  }

  await mkdir(CACHE, { recursive: true });
  await mkdir(VECTORS, { recursive: true });

  const available = await listAvailable();

  if (args.includes('--list')) {
    log(`${available.length} opcode files in ${REPO}/${SUITE}:`);
    for (const entry of available) {
      log(`  ${entry.stem}  ${(entry.size / 1024 / 1024).toFixed(1)} MiB  ${entry.name}`);
    }
    return;
  }

  const requested = args
    .filter((arg, at) => !arg.startsWith('-') && args[at - 1] !== '--cpu')
    .map((arg) => arg.toUpperCase());

  /* A 386 file is named for its prefixes too: `6601`, `676601`. It is
   * wanted when what follows them is. */
  const base = (entry) =>
    CPU386
      ? entry.opcode.toUpperCase().replace(/^(?:6[67])+(?=..)/, '')
      : entry.opcode.toUpperCase();
  const defaults = CPU386 ? [...DEFAULT_OPCODES, ...DEFAULT_386] : DEFAULT_OPCODES;
  const wanted = args.includes('--all')
    ? available
    : available.filter((entry) => (requested.length ? requested : defaults).includes(base(entry)));

  if (!wanted.length) {
    log('Nothing matched. Try --list to see what the suite publishes.');
    process.exitCode = 1;
    return;
  }

  const megabytes = wanted.reduce((sum, entry) => sum + entry.size, 0) / 1024 / 1024;
  log(`Fetching ${wanted.length} opcode files (~${megabytes.toFixed(0)} MiB compressed)`);

  if (CPU386) {
    await fetch386(wanted);
    return;
  }

  const converter = await ensureConverter();
  let done = 0;

  for (const entry of wanted) {
    const archive = join(CACHE, entry.name);
    const json = join(VECTORS, `${entry.stem}.json`);

    if (await exists(json)) {
      done += 1;
      continue;
    }

    if (!(await exists(archive))) {
      await download(entry.name, archive);
    }

    await run('python3', [converter, archive, json]);
    await rm(archive, { force: true });

    done += 1;
    process.stdout.write(`\r  ${done}/${wanted.length} ${entry.stem}   `);
  }

  const written = (await readdir(VECTORS)).filter((name) => name.endsWith('.json'));
  log(`\nVectors ready: ${written.length} opcode files in test/conformance/vectors/`);
  log('Run the oracle with: pnpm test:conformance');
}

/** The 386's files, kept as published, the suite's list of revoked tests, and its table of opcodes. */
async function fetch386(wanted) {
  await mkdir(VECTORS386, { recursive: true });

  const list = await fetch(`${RAW}/revocation_list.txt`, {
    headers: { 'user-agent': 'winbox.js' },
  });

  if (list.ok) {
    await writeFile(join(VECTORS386, 'revocation_list.txt'), await list.text());
  }

  /* Which flags each opcode leaves undefined, among much else: its
   * `f_umask` column is what the oracle compares the flags under. */
  const table = await fetch(`${RAW}/80386.csv`, { headers: { 'user-agent': 'winbox.js' } });

  if (table.ok) {
    await writeFile(join(VECTORS386, '80386.csv'), await table.text());
  }

  let done = 0;

  for (const entry of wanted) {
    const archive = join(VECTORS386, entry.name);

    if (!(await exists(archive))) {
      await download(entry.name, archive);
    }

    done += 1;
    process.stdout.write(`\r  ${done}/${wanted.length} ${entry.stem}   `);
  }

  log(`\nVectors ready: ${done} files in test/conformance/vectors386/`);
  log('Run the oracle with: pnpm test:conformance');
}

main().catch((error) => {
  process.stderr.write(`\n${error.message}\n`);
  process.exitCode = 1;
});
