'use strict';

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readFat12 } from '../../src/file-systems/fat12.js';
import { expandSzdd, expandedName, isSzdd } from '../../src/assets/szdd.js';

/**
 * Reading the media: the floppy images by WinBox's own FAT12 reader, and the
 * `COMPRESS`ed files by its own expander, which follows `LZEXPAND`'s
 * decoder. Checked against `scripts/oracle/szdd.mjs`'s compressor (itself
 * checked against `LZEXPAND.DLL` on DOSBox by the `lzfiles` probe), against
 * `mtools`' reading of the same disks (the staged disk `install-windows.mjs`
 * made), and against what Windows' own Setup expanded onto the oracle's
 * drives. The media are the user's, under `oracle/.cache`; without them
 * those tests are skipped.
 */

const ROOT = join(__dirname, '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache');
const FLOPPIES = join(CACHE, 'floppies');
const STAGE = join(CACHE, 'setup-disk');
const BUILD = join(ROOT, 'oracle', 'build');

function images() {
  if (!existsSync(FLOPPIES)) {
    return [];
  }

  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(at, entry.name));
      } else if (/\.img$/i.test(entry.name)) {
        found.push(join(at, entry.name));
      }
    }
  };

  walk(FLOPPIES);
  return found.sort();
}

const IMAGES = images();
const withMedia = IMAGES.length === 6 ? it : it.skip;
const DRIVES = existsSync(BUILD)
  ? readdirSync(BUILD).filter((name) => name.startsWith('drive-c'))
  : [];

/** The probes' files compressed by `szdd.mjs`, with the data they hold. */
function compressedByScript(): Record<string, { packed: number[]; data: number[] }> {
  const script = `
    import { FILES, compress } from ${JSON.stringify(join(ROOT, 'scripts', 'oracle', 'szdd.mjs'))};
    const out = {};
    for (const [name, { data, last }] of Object.entries(FILES)) {
      const bytes = data();
      out[name] = { packed: [...compress(bytes, last)], data: [...bytes] };
    }
    process.stdout.write(JSON.stringify(out));
  `;

  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    })
  );
}

describe('COMPRESS files', () => {
  it('expand to what szdd.mjs compressed', () => {
    for (const [name, { packed, data }] of Object.entries(compressedByScript())) {
      const expanded = expandSzdd(Uint8Array.from(packed));

      expect([name, Buffer.from(expanded.data).equals(Buffer.from(data))]).toEqual([name, true]);
    }
  });

  it('are refused where LZCopy fails', () => {
    const { TEXT } = compressedByScript();
    const packed = Uint8Array.from(TEXT.packed);
    const otherAlgorithm = packed.slice();

    otherAlgorithm[8] = 0x42;

    expect(() => expandSzdd(otherAlgorithm)).toThrow(/LZERROR_UNKNOWNALG/);
    expect(() => expandSzdd(packed.slice(0, packed.length - 1))).toThrow(/LZERROR_READ/);

    const longer = packed.slice();

    longer[10] += 1;
    expect(() => expandSzdd(longer)).toThrow(/LZERROR_READ/);

    const unsigned = packed.slice();

    unsigned[3] = 0;
    expect(isSzdd(unsigned)).toBe(false);
  });

  it('are named as Setup names them', () => {
    expect(expandedName('arial.fo_', 0x54)).toBe('ARIAL.FOT');
    expect(expandedName('VGA.DR_', 0x56)).toBe('VGA.DRV');
    expect(expandedName('SETUP.INF', 0)).toBe('SETUP.INF');
  });
});

describe('the setup disks', () => {
  withMedia('read as mtools reads them', () => {
    if (!existsSync(STAGE)) {
      return;
    }

    let compared = 0;

    for (const image of IMAGES) {
      for (const file of readFat12(readFileSync(image))) {
        const staged = join(STAGE, file.path);

        /* The staged SETUP.INF may have had a driver disk's lines added. */
        if (file.path === 'SETUP.INF' || !existsSync(staged)) {
          continue;
        }

        expect([
          file.path,
          Buffer.from(readFileSync(staged)).equals(Buffer.from(file.data)),
        ]).toEqual([file.path, true]);
        compared++;
      }
    }

    expect(compared).toBeGreaterThan(400);
  });

  withMedia('expand to what Setup put on the drives', () => {
    let same = 0;
    const differ: string[] = [];

    for (const image of IMAGES) {
      for (const file of readFat12(readFileSync(image))) {
        let { data } = file;
        let name = file.path;

        if (isSzdd(data)) {
          const expanded = expandSzdd(data);

          data = expanded.data;
          name = expandedName(name, expanded.last);
        }

        for (const drive of DRIVES) {
          for (const folder of ['WINDOWS', 'WINDOWS/SYSTEM']) {
            const installed = join(BUILD, drive, folder, name);

            if (existsSync(installed)) {
              if (Buffer.from(readFileSync(installed)).equals(Buffer.from(data))) {
                same++;
              } else {
                differ.push(`${drive}/${folder}/${name}`);
              }
            }
          }
        }
      }
    }

    /* Setup writes the user's name and company into USER.EXE, and the
     * vga256 installation's SETUP.INF is the staged one, with the Driver
     * Library's display added (`install-windows.mjs`, `addDriver`). */
    expect(
      differ.filter(
        (path) => !/\/USER\.EXE$/.test(path) && path !== 'drive-c-vga256/WINDOWS/SYSTEM/SETUP.INF'
      )
    ).toEqual([]);

    if (DRIVES.length > 0) {
      expect(same).toBeGreaterThan(1000);
    }
  });

  withMedia('are the media known-media.json lists', () => {
    const known = JSON.parse(
      readFileSync(join(ROOT, 'scripts', 'assets', 'known-media.json'), 'utf8')
    );
    const listed = new Set(
      known.media[0].files.map(
        (file: any) => `${file.disk} ${file.name} ${file.size} ${file.sha256}`
      )
    );
    let count = 0;

    for (const image of IMAGES) {
      const files = readFat12(readFileSync(image));
      const disk = files.find((file) => /^DISK\d$/.test(file.path))!.path.toLowerCase();

      for (const file of files) {
        const hash = createHash('sha256').update(file.data).digest('hex');

        expect(listed.has(`${disk} ${file.path} ${file.data.length} ${hash}`)).toBe(true);
        count++;
      }
    }

    expect(count).toBe(listed.size);
  });
});
