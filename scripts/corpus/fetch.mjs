#!/usr/bin/env node
/**
 * Fetches the corpus: every program `corpus/manifest.json` names, from where
 * it is published, checked against the SHA-256 the manifest holds, and
 * unpacked into `corpus/programs/<id>/`. Nothing fetched is kept in the
 * repository; the manifest is enough to fetch the same bytes again.
 *
 *   node scripts/corpus/fetch.mjs            # everything
 *   node scripts/corpus/fetch.mjs skifree hearts # just these
 *   node scripts/corpus/fetch.mjs --hash     # print each download's SHA-256, for a new entry
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = join(ROOT, 'corpus');
const CACHE = join(CORPUS, 'cache');
const PROGRAMS = join(CORPUS, 'programs');

/** Where an entry's archive is fetched from. */
export function sourceUrl(entry) {
  if (entry.source.url) {
    return entry.source.url;
  }

  const { identifier, file } = entry.source.archiveOrg;

  return `https://archive.org/download/${identifier}/${encodeURIComponent(file)}`;
}

/**
 * The files of a zip, read from its central directory: stored and deflated
 * members here, anything older (PKZIP 1's shrink and implode) through the
 * system's `unzip`, which knows them.
 */
function unpack(archive, into) {
  const bytes = readFileSync(archive);
  let end = bytes.length - 22;

  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) {
    end--;
  }

  if (end < 0) {
    throw new Error(`${archive} is not a zip`);
  }

  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const members = [];

  for (let index = 0; index < count; index++) {
    const method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.toString('latin1', at + 46, at + 46 + nameLength);

    members.push({ method, compressed, local, name });
    at += 46 + nameLength + extraLength + commentLength;
  }

  if (members.some((member) => member.method !== 0 && member.method !== 8)) {
    mkdirSync(into, { recursive: true });
    execFileSync('unzip', ['-o', '-qq', archive, '-d', into]);
    return members.map((member) => member.name);
  }

  for (const member of members) {
    if (member.name.endsWith('/')) {
      continue;
    }

    const start =
      member.local +
      30 +
      bytes.readUInt16LE(member.local + 26) +
      bytes.readUInt16LE(member.local + 28);
    const data = bytes.subarray(start, start + member.compressed);
    const out = join(into, ...member.name.split(/[\\/]/));

    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, member.method === 8 ? inflateRawSync(data) : data);
  }

  return members.map((member) => member.name);
}

async function fetchEntry(entry, { hashOnly }) {
  const url = sourceUrl(entry);
  const archive = join(CACHE, `${entry.id}${entry.source.zip === false ? '' : '.zip'}`);

  mkdirSync(CACHE, { recursive: true });

  if (!existsSync(archive)) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`${entry.id}: ${url} answered ${response.status}`);
    }

    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  }

  const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');

  if (hashOnly) {
    console.log(`${entry.id}\t${hash}`);
    return;
  }

  if (hash !== entry.source.sha256) {
    throw new Error(`${entry.id}: ${url} is ${hash}, the manifest says ${entry.source.sha256}`);
  }

  const into = join(PROGRAMS, entry.id);

  rmSync(into, { recursive: true, force: true });
  const names = unpack(archive, into);

  console.log(`${entry.id}: ${names.length} files, runs ${entry.run}`);
}

async function main() {
  const args = process.argv.slice(2);
  const hashOnly = args.includes('--hash');
  const wanted = args.filter((argument) => !argument.startsWith('--'));
  const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8'));
  const entries = manifest.programs.filter((entry) => !wanted.length || wanted.includes(entry.id));
  let failed = 0;

  for (const entry of entries) {
    try {
      await fetchEntry(entry, { hashOnly });
    } catch (error) {
      failed++;
      console.error(error.message);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main();
