#!/usr/bin/env node
/**
 * Checks our ordinal numbering against the Windows SDK's.
 *
 * An ordinal is not a detail we get to choose. A Win16 program does not import
 * `lstrcmpi` by name -- it imports USER.471, and the loader is expected to know
 * that 471 is `lstrcmpi`. If our table puts something else at 471, every call
 * lands in the wrong function, and nothing about the resulting failure points
 * at the numbering.
 *
 * The modules themselves are a poor authority here: `USER.EXE` names only a few
 * dozen of its exports in its name tables and exports the rest by number alone.
 * The import library is the complete record. `windows.lib` exists precisely to
 * turn a name into a module and an ordinal at link time, and it carries one
 * IMPDEF record per export to do it:
 *
 *     A0 01 01 <len> NAME <len> MODULE <ordinal:16>
 *
 * where A0 is a COMENT record of class IMPDEF, the second 01 says this import
 * is by ordinal, and the rest is the mapping.
 *
 *   node scripts/oracle/dump-exports.mjs                # check ours against it
 *   node scripts/oracle/dump-exports.mjs --find lstrcmpi
 *   node scripts/oracle/dump-exports.mjs --list USER
 *
 * Needs the toolchain from fetch-toolchain.mjs.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIBRARY = join(ROOT, 'oracle', '.cache', 'watcom', 'lib286', 'win', 'windows.lib');

/** The modules we reimplement, and the file each one's table lives in. */
export const MODULES = { KERNEL: 'kernel.ts', USER: 'user.ts', GDI: 'gdi.ts' };

function log(...args) {
  console.log(...args);
}

/**
 * Reads every name-to-ordinal mapping out of the import library.
 *
 * Scanning for the record signature rather than walking the OMF structure:
 * the library is a few hundred kilobytes of records in a dozen shapes, and the
 * three bytes that introduce an IMPDEF are distinctive enough that finding
 * them directly is both shorter and harder to get wrong than parsing around
 * everything else.
 */
export async function readLibrary() {
  const data = await readFile(LIBRARY).catch(() => {
    throw new Error(`no ${LIBRARY}; run scripts/oracle/fetch-toolchain.mjs first`);
  });

  const modules = new Map();

  for (let at = 0; at < data.length - 8; at++) {
    // COMENT, class IMPDEF, imported by ordinal.
    if (data[at] !== 0xa0 || data[at + 1] !== 0x01 || data[at + 2] !== 0x01) {
      continue;
    }

    const nameLength = data[at + 3];
    const nameAt = at + 4;
    const moduleLength = data[nameAt + nameLength];
    const moduleAt = nameAt + nameLength + 1;

    if (nameLength === 0 || moduleLength === 0 || moduleAt + moduleLength + 2 > data.length) {
      continue;
    }

    const name = data.subarray(nameAt, nameAt + nameLength).toString('ascii');
    const module = data.subarray(moduleAt, moduleAt + moduleLength).toString('ascii');
    const ordinal = data.readUInt16LE(moduleAt + moduleLength);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !/^[A-Z0-9]+$/.test(module)) {
      continue;
    }

    if (!modules.has(module)) {
      modules.set(module, new Map());
    }

    modules.get(module).set(ordinal, name);
  }

  return modules;
}

/**
 * Reads the ordinals one of our modules declares.
 *
 * The table is positional: an entry's index in the array is its ordinal, and
 * index zero is a `null` placeholder because there is no ordinal zero. Counting
 * entries rather than parsing expressions keeps this out of the business of
 * understanding TypeScript, and the `// N //` markers scattered through the
 * table make the count check itself.
 */
export async function readOurs(file) {
  const source = await readFile(join(ROOT, 'src', 'win16', file), 'utf8');

  const start = source.indexOf('static get exports()');

  if (start === -1) {
    throw new Error(`no export table in ${file}`);
  }

  const open = source.indexOf('return [', start);

  if (open === -1) {
    throw new Error(`no export array in ${file}`);
  }

  const entries = [];

  let at = open + 'return ['.length;
  let depth = 1;
  let entry = '';
  let quote = null;

  while (at < source.length) {
    const character = source[at];

    if (quote) {
      // Inside a string nothing is punctuation.
      if (character === quote && source[at - 1] !== '\\') {
        quote = null;
      }

      entry += character;
      at++;
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      entry += character;
      at++;
      continue;
    }

    /* Entries wrap across lines once they get long enough for the formatter to
     * break them, so this counts brackets rather than newlines.
     */
    if (character === '/' && source[at + 1] === '/') {
      const end = source.indexOf('\n', at);
      const comment = source.slice(at, end);
      const marker = /^\/\/\s*(\d+)\s*\/\//.exec(comment);

      // The markers count entries; disagreeing with them means misreading.
      if (marker && depth === 1 && entries.length !== Number(marker[1])) {
        throw new Error(
          `${file}: counted ${entries.length} entries where the table says ${marker[1]}`
        );
      }

      at = end;
      continue;
    }

    if (character === '[' || character === '(' || character === '{') {
      depth++;
    } else if (character === ']' || character === ')' || character === '}') {
      depth--;

      if (depth === 0) {
        break;
      }
    }

    if (character === ',' && depth === 1) {
      entries.push(entry);
      entry = '';
      at++;
      continue;
    }

    entry += character;
    at++;
  }

  if (entry.trim() !== '') {
    entries.push(entry);
  }

  const ours = new Map();

  entries.forEach((text, ordinal) => {
    const named = /'([^']+)'/.exec(text);

    if (named) {
      ours.set(ordinal, named[1]);
    }
  });

  return ours;
}

async function main() {
  const args = process.argv.slice(2);
  const library = await readLibrary();

  const findAt = args.indexOf('--find');

  if (findAt !== -1) {
    const wanted = args[findAt + 1]?.toLowerCase();
    let found = false;

    for (const [module, exports] of library) {
      for (const [ordinal, name] of exports) {
        if (name.toLowerCase() === wanted) {
          log(`${module}.${ordinal}  ${name}`);
          found = true;
        }
      }
    }

    if (!found) {
      log(`nothing named ${args[findAt + 1]}`);
    }

    return;
  }

  const listAt = args.indexOf('--list');

  if (listAt !== -1) {
    const module = args[listAt + 1]?.toUpperCase();
    const exports = library.get(module);

    if (!exports) {
      throw new Error(`no module ${module}; the library has ${[...library.keys()].join(', ')}`);
    }

    for (const ordinal of [...exports.keys()].sort((a, b) => a - b)) {
      log(`  ${String(ordinal).padStart(4)}  ${exports.get(ordinal)}`);
    }

    return;
  }

  let disagreed = 0;
  let checked = 0;
  let unknown = 0;

  for (const [module, file] of Object.entries(MODULES)) {
    const theirs = library.get(module) ?? new Map();
    const ours = await readOurs(file);
    const wrong = [];

    for (const [ordinal, name] of ours) {
      const real = theirs.get(ordinal);

      // Plenty of ordinals the SDK never gave a name to; silence is not evidence.
      if (real === undefined) {
        unknown++;
        continue;
      }

      checked++;

      if (real.toLowerCase() !== name.toLowerCase()) {
        wrong.push(`  ${String(ordinal).padStart(4)}  we say ${name}, the SDK says ${real}`);
      }
    }

    log(`${module}: ${ours.size} declared, ${theirs.size} in the import library`);

    if (wrong.length > 0) {
      disagreed += wrong.length;
      log(wrong.join('\n'));
    }
  }

  log(`\n${checked} ordinals checked, ${disagreed} disagree (${unknown} unnamed by the SDK)`);

  if (disagreed > 0) {
    process.exitCode = 1;
  }
}

// Importing this for its parsers should not also run the comparison.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`dump-exports: ${error.message}`);
    process.exitCode = 1;
  });
}
