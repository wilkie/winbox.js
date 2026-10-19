'use strict';

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { MANIFEST, makeAssets, type AssetInput, type Made } from '../../src/assets/make.js';
import { segmentSpans, zeroSegments } from '../../src/assets/ne.js';
import { readZip } from '../../src/zip.js';

/**
 * The maker: the bundle made from the user's own media, its manifest, and
 * its files held to what Windows' own Setup put on the oracle's drives.
 * Skipped without the media under `oracle/.cache`.
 */

const ROOT = join(__dirname, '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache');
const BUILD = join(ROOT, 'oracle', 'build');

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
const withMedia = INPUTS.length >= 6 ? it : it.skip;
/* The Driver Library's 256-colour driver, where `fetch-svga256.mjs` fetched it. */
const SVGA = INPUTS.some((input) => /SVGA256\.DRV$/i.test(input.name));
const DRIVES = existsSync(BUILD)
  ? readdirSync(BUILD).filter((name) => name.startsWith('drive-c'))
  : [];
const KNOWN = JSON.parse(readFileSync(join(ROOT, 'scripts', 'assets', 'known-media.json'), 'utf8'));
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

const RT_STRING = 0x8006;

/** Where two files of a length differ, the first byte to past the last; none where they agree. */
function changedSpan(a: Uint8Array, b: Uint8Array) {
  expect(a.length).toBe(b.length);

  let start = -1;
  let end = -1;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      start = start === -1 ? i : start;
      end = i + 1;
    }
  }

  return start === -1 ? null : { start, end };
}

/** Each resource's type and where its bytes are, from the resource table. */
function resourcesOf(file: Uint8Array) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const header = view.getUint32(0x3c, true);
  let at = header + view.getUint16(header + 0x24, true);
  const shift = view.getUint16(at, true);
  const found: { type: number; start: number; end: number }[] = [];

  for (at += 2; view.getUint16(at, true) !== 0;) {
    const type = view.getUint16(at, true);
    const count = view.getUint16(at + 2, true);

    at += 8;

    for (let i = 0; i < count; i++, at += 12) {
      const start = view.getUint16(at, true) << shift;

      found.push({ type, start, end: start + (view.getUint16(at + 2, true) << shift) });
    }
  }

  return found;
}

const latin1 = (data: Uint8Array, { start, end }: { start: number; end: number }) =>
  String.fromCharCode(...data.subarray(start, end));

let made: Made | null = null;

async function bundle() {
  made ??= await makeAssets(INPUTS, { known: KNOWN, made: { by: 'test' } });

  return made;
}

/** The same-named file on each of the oracle's drives that has it. */
function installed(name: string) {
  return DRIVES.flatMap((drive) =>
    ['WINDOWS', 'WINDOWS/SYSTEM']
      .map((folder) => join(BUILD, drive, folder, name))
      .filter((path) => existsSync(path))
  );
}

describe('the asset bundle', () => {
  withMedia('lists its files with their hashes, and its id is theirs', async () => {
    const { manifest, files, zip } = await bundle();
    const read = await readZip(zip);

    expect(read.map((entry) => entry.path)).toEqual(files.map((file) => file.path));
    expect(read[0].path).toBe(MANIFEST);
    expect(JSON.parse(new TextDecoder().decode(read[0].data))).toEqual(manifest);
    expect(manifest.format).toBe(1);

    for (const file of manifest.files) {
      const entry = read.find((found) => found.path === file.path)!;

      expect([file.path, sha256(entry.data), entry.data.length]).toEqual([
        file.path,
        file.sha256,
        file.size,
      ]);
    }

    const hashes = manifest.files.map((file) => file.sha256).sort();

    expect(manifest.id).toBe(sha256(new TextEncoder().encode(hashes.join('\n'))));
    expect(manifest.sources.every((source) => source.known)).toBe(true);
    expect(manifest.displays).toEqual(
      [
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
      ].filter((display) => SVGA || display !== 'vga256')
    );
  });

  withMedia('is the same bundle made twice', async () => {
    const again = await makeAssets(INPUTS, { known: KNOWN, made: { by: 'test' } });
    const first = await bundle();

    expect(again.manifest.id).toBe(first.manifest.id);
    expect(Buffer.from(again.zip).equals(Buffer.from(first.zip))).toBe(true);
  });

  withMedia("holds in its pool what Setup put on the oracle's drives", async () => {
    const { files } = await bundle();
    const pool = files.filter((file) => file.path.startsWith('pool/'));
    const notInstalled: string[] = [];

    for (const file of pool) {
      const name = file.path.slice('pool/'.length);
      const paths = installed(name);

      if (paths.length === 0) {
        notInstalled.push(name);
      }

      for (const path of paths) {
        expect([path, Buffer.from(readFileSync(path)).equals(Buffer.from(file.data))]).toEqual([
          path,
          true,
        ]);
      }
    }

    /* The sounds are the pool's only: the oracle answers Setup's
     * `[dontinstall] bitmaps`, and [win.bmps] is where they are. */
    if (DRIVES.length > 0) {
      expect(notInstalled.sort()).toEqual(['CHIMES.WAV', 'CHORD.WAV', 'DING.WAV', 'TADA.WAV']);
    }
  });

  withMedia(
    "holds the modules with no code, and otherwise the installed file's bytes",
    async () => {
      const { files } = await bundle();
      const modules = files.filter((file) => file.path.startsWith('modules/'));

      expect(modules.map((file) => file.path.slice('modules/'.length))).toEqual(
        [
          '8514.DRV',
          'EGA.DRV',
          'HERCULES.DRV',
          'SHELL.DLL',
          'SUPERVGA.DRV',
          'SVGA256.DRV',
          'USER.EXE',
          'VGA.DRV',
          'XGA.DRV',
        ].filter((name) => SVGA || name !== 'SVGA256.DRV')
      );

      for (const file of modules) {
        const name = file.path.slice('modules/'.length);
        const paths = installed(name);

        expect(paths.length).toBeGreaterThan(0);

        for (const span of segmentSpans(file.data)) {
          expect(file.data.subarray(span.start, span.end).every((byte) => byte === 0)).toBe(true);
        }

        /* Every installed copy, zeroed, is the bundle's; USER.EXE's but for
         * the licensee Setup writes into one of its string tables, where
         * the media's says "Unknown User" and "Unknown Organization". */
        for (const path of paths) {
          const zeroed = zeroSegments(new Uint8Array(readFileSync(path)));
          const differ = changedSpan(zeroed, file.data);

          if (name === 'USER.EXE') {
            const strings = resourcesOf(file.data).find(
              (resource) => differ && differ.start >= resource.start && differ.end <= resource.end
            );

            expect([path, strings?.type]).toEqual([path, RT_STRING]);
            expect(latin1(file.data, strings!)).toContain('Unknown User');
            expect(latin1(zeroed, strings!)).toContain('WinBox.js oracle');
          } else {
            expect([path, differ]).toEqual([path, null]);
          }
        }
      }
    }
  );
});
