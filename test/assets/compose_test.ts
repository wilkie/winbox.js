'use strict';

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { composeBase, composedDisplays, type PoolFile } from '../../src/assets/compose.js';
import { makeAssets, type AssetInput } from '../../src/assets/make.js';
import { regeditImport } from '../../src/assets/regedit.js';
import { crc32 } from '../../src/assets/zip.js';
import { HKEY_CLASSES_ROOT, RegistryDatabase } from '../../src/win16/shell/registry.js';
import { findIn } from '../../src/win16/shell/reg-api.js';

/**
 * The base of C: composed from the asset bundle for each display, held to
 * what Windows' own Setup put on the oracle's installation for it: every
 * placed file byte for byte -- the fonts, the profiles, REG.DAT -- and no
 * data file of the installation's left out. And the Rust engine's composer
 * gives the same placements: both are held to `composed.json`, which this
 * writes with `ASSETS_UPDATE=1`. Skipped without the media.
 */

const ROOT = join(__dirname, '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache');
const BUILD = join(ROOT, 'oracle', 'build');
const LISTING = join(__dirname, 'composed.json');
const SETUP = JSON.parse(
  readFileSync(join(ROOT, 'crates', 'winbox-win16', 'data', 'setup.json'), 'utf8')
);

function below(folder: string, keep: (path: string) => boolean) {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);

      if (entry.isDirectory()) {
        walk(path);
      } else if (keep(path)) {
        found.push(path);
      }
    }
  };

  if (existsSync(folder)) {
    walk(folder);
  }

  return found.sort();
}

function inputs(): AssetInput[] {
  const floppies = join(CACHE, 'floppies');
  const svga = join(CACHE, 'svga256');

  return [
    ...below(floppies, (path) => /\.img$/i.test(path)).map((path) => ({
      name: relative(floppies, path),
      bytes: new Uint8Array(readFileSync(path)),
    })),
    ...below(svga, (path) => !/\.exe$/i.test(path)).map((path) => ({
      name: relative(svga, path),
      bytes: new Uint8Array(readFileSync(path)),
    })),
  ];
}

const INPUTS = inputs();
const withMedia = INPUTS.length >= 6 && existsSync(BUILD) ? it : it.skip;

async function pool() {
  const { files } = await makeAssets(INPUTS, { made: { by: 'test' } });
  const byName = new Map<string, PoolFile>();

  for (const file of files) {
    if (file.path.startsWith('pool/')) {
      byName.set(file.path.slice('pool/'.length), file);
    }
  }

  return (name: string) => byName.get(name);
}

describe('REGEDIT /s', () => {
  it('takes each HKEY_CLASSES_ROOT line as a key and a value, and passes over the rest', () => {
    const db = RegistryDatabase.empty();

    regeditImport(
      db,
      [
        'REGEDIT',
        'A comment = not a key',
        'HKEY_CLASSES_ROOT\\.txt = txtfile',
        'HKEY_CLASSES_ROOT\\txtfile\\shell\\open\\command = notepad.exe %1',
        'HKEY_CLASSES_ROOT\\Alone',
        'HKEY_CLASSES_ROOT\\Spaced   =  two spaces',
        '\\.classes\\.ini = inifile',
        '',
      ].join('\r\n')
    );

    const value = (path: string) => {
      const found = findIn(db, HKEY_CLASSES_ROOT, path, 'open');

      return 'at' in found ? db.textOf(db.entries[found.at][3]) : 'missing';
    };

    expect(value('.txt')).toBe('txtfile');
    expect(value('txtfile\\shell\\open\\command')).toBe('notepad.exe %1');
    expect(value('Alone')).toBeNull();
    expect(value('Spaced')).toBe(' two spaces');
    expect(value('.ini')).toBe('inifile');
    expect(value('A')).toBe('missing');
  });
});

describe('the composed base', () => {
  withMedia("is what Setup put on the oracle's drive for each display", async () => {
    const lookup = await pool();
    const listing: Record<string, [string, number, string, number][]> = {};
    const data = new Set(
      [...new Set(SETUP.displays && Object.values<any>(SETUP.displays).flatMap((d) => d.files))]
        .map((entry: any) => entry[0].split('/').pop())
        .concat(['WIN.INI', 'SYSTEM.INI', 'REG.DAT'])
    );

    expect(composedDisplays().sort()).toEqual([
      '8514',
      '8514s',
      'ega',
      'hercules',
      'svga',
      'vga',
      'vga256',
      'xga256',
      'xga256s',
      'xga640',
    ]);

    for (const display of composedDisplays()) {
      const drive = join(BUILD, SETUP.displays[display].drive);
      const composed = composeBase(lookup, display);
      const installed = below(drive, () => true).map((path) =>
        relative(drive, path).split('\\').join('/')
      );

      for (const file of composed.files) {
        const theirs = readFileSync(join(drive, file.path));

        expect([display, file.path, Buffer.from(file.data).equals(theirs)]).toEqual([
          display,
          file.path,
          true,
        ]);
      }

      /* Every data file of the installation's is placed, and nothing else. */
      expect(composed.files.map((file) => file.path)).toEqual(
        installed.filter((path) => data.has(path.split('/').pop()!)).sort()
      );

      for (const folder of composed.directories) {
        expect(existsSync(join(drive, folder))).toBe(true);
      }

      listing[display] = composed.files.map((file) => [
        file.path,
        file.data.length,
        crc32(file.data).toString(16).padStart(8, '0'),
        file.modified,
      ]);
    }

    if (process.env.ASSETS_UPDATE === '1') {
      writeFileSync(LISTING, `${JSON.stringify(listing, null, 1)}\n`);
    }

    expect(listing).toEqual(JSON.parse(readFileSync(LISTING, 'utf8')));
  });
});
