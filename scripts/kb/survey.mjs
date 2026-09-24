#!/usr/bin/env node
/**
 * Surveys what a Windows installation's libraries actually export, for the
 * knowledge base.
 *
 * The export tables in `src/win16` say what winbox.js declares. They are not
 * an authority on what Windows exports: they carry placeholder entries for
 * unused ordinals, names a later or earlier Windows used, and they leave out
 * whole libraries. So the knowledge base takes the list of exports from the
 * binaries themselves -- one page per export Windows really has -- and joins
 * our tables to it.
 *
 * An export exists when the binary's entry table has an entry for its ordinal.
 * Its name comes from the binary's resident or non-resident name table, and
 * where the binary exports it by number alone, from the SDK import library
 * that turns names into ordinals at link time (`scripts/oracle/dump-exports.mjs`
 * reads it). Names and ordinals are facts about the interface, not code, and
 * the survey is committed so that the site builds without the Windows media.
 *
 *   node scripts/kb/survey.mjs [version]    # default 3.1
 *
 * Reads the installed drive from `scripts/oracle/install-windows.mjs` and
 * writes `kb/data/exports-<version>.json`.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { entriesOf, readNE } from '../oracle/ne.mjs';
import { readLibrary } from '../oracle/dump-exports.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYSTEM = join(ROOT, 'oracle', 'build', 'drive-c', 'WINDOWS', 'SYSTEM');
const version = process.argv[2] ?? '3.1';

/**
 * The libraries an application calls, in the order an index lists them. A
 * module Windows ships in two builds names both; the survey records which
 * build has which export. Display, printer and network drivers export a
 * driver interface rather than an application one and are left for later.
 */
const LIBRARIES = [
  ['KERNEL', ['KRNL386.EXE', 'KRNL286.EXE']],
  ['USER', ['USER.EXE']],
  ['GDI', ['GDI.EXE']],
  ['KEYBOARD', ['KEYBOARD.DRV']],
  ['SYSTEM', ['SYSTEM.DRV']],
  ['SOUND', ['SOUND.DRV']],
  ['COMMDLG', ['COMMDLG.DLL']],
  ['SHELL', ['SHELL.DLL']],
  ['MMSYSTEM', ['MMSYSTEM.DLL']],
  ['TOOLHELP', ['TOOLHELP.DLL']],
  ['VER', ['VER.DLL']],
  ['LZEXPAND', ['LZEXPAND.DLL']],
  ['DDEML', ['DDEML.DLL']],
  ['OLECLI', ['OLECLI.DLL']],
  ['OLESVR', ['OLESVR.DLL']],
  ['WIN87EM', ['WIN87EM.DLL']],
];

/** Every name in one of a module's name tables, by ordinal. */
function namesOf(ne) {
  const { view } = ne;
  const names = new Map();
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

  const read = (at, end) => {
    while (at < end && bytes[at]) {
      const length = bytes[at];
      const name = String.fromCharCode(...bytes.subarray(at + 1, at + 1 + length));
      const ordinal = view.getUint16(at + 1 + length, true);

      if (ordinal) {
        names.set(ordinal, name);
      }

      at += length + 3;
    }
  };

  const ne0 = view.getUint16(0x3c, true);
  read(ne0 + view.getUint16(ne0 + 0x26, true), bytes.length);
  const nonResident = view.getUint32(ne0 + 0x2c, true);
  read(nonResident, nonResident + view.getUint16(ne0 + 0x20, true));

  return names;
}

const library = await readLibrary().catch(() => new Map());
const survey = { version, generated: 'scripts/kb/survey.mjs', modules: [] };

for (const [module, files] of LIBRARIES) {
  const exports = new Map();
  const present = [];

  for (const file of files) {
    const path = join(SYSTEM, file);

    if (!existsSync(path)) {
      continue;
    }

    present.push(file);

    const ne = readNE(path);
    const names = namesOf(ne);

    for (const { ordinal } of entriesOf(ne)) {
      const entry = exports.get(ordinal) ?? { ordinal, name: null, nameFrom: null, in: [] };

      entry.in.push(file);

      if (!entry.name && names.get(ordinal)) {
        entry.name = names.get(ordinal);
        entry.nameFrom = 'binary';
      }

      exports.set(ordinal, entry);
    }
  }

  if (!present.length) {
    console.log(`${module}: not on the drive, left out`);
    continue;
  }

  /* An export the binary leaves unnamed takes its name from the import
   * library, if the library knows the module. */
  const imported = library.get(module);

  for (const entry of exports.values()) {
    if (!entry.name && imported?.has(entry.ordinal)) {
      entry.name = imported.get(entry.ordinal);
      entry.nameFrom = 'import library';
    }
  }

  const list = [...exports.values()].sort((a, b) => a.ordinal - b.ordinal);

  /* Where the module has two builds, say which exports are only in one. */
  for (const entry of list) {
    if (entry.in.length === present.length) {
      delete entry.in;
    }
  }

  survey.modules.push({ name: module, files: present, exports: list });
  console.log(`${module}: ${list.length} exports from ${present.join(', ')}`);
}

const out = join(ROOT, 'kb', 'data', `exports-${version}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(survey, null, 1) + '\n');
console.log(`-> ${out}`);
