'use strict';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ISO9660, setLabel } from '../../src/file-systems/iso9660.js';

/**
 * An ISO 9660 disc image as a CD-ROM drive (`ISO9660`), as DOSBox's
 * `isoDrive` reads one; the same checks as `iso.rs`'s tests.
 */

const IMAGES = join(__dirname, '..', '..', 'oracle', 'probes', 'images');

function disc() {
  return ISO9660.of(new Uint8Array(readFileSync(join(IMAGES, 'imgcd.iso'))));
}

describe('an ISO 9660 disc', () => {
  it('is listed as DOSBox lists it', () => {
    const volume = disc();

    expect(
      volume
        .children([])
        .map((info: any) => `${info.name} ${info.attributes.toString(16).padStart(2, '0')}`)
    ).toEqual([
      'A_VERY_L.TEX 20',
      'HIDDEN.TXT 22',
      'LONGNAMEDFOL 10',
      'MIXEDCAS.TXT 20',
      'NOEXT 20',
      'README.TXT 20',
      'SUBDIR 10',
      'ZONE.TXT 20',
    ]);
    expect(
      volume
        .children(['SUBDIR'])
        .slice(0, 2)
        .map((info: any) => info.name)
    ).toEqual(['.', '..']);
    expect(volume.label).toBe('WINBOXCD.202');
    expect(volume.attributes(['SUBDIR'])).toBe(0x31);
    expect(volume.attributes(['readme.txt'])).toBe(0x21);
    expect(volume.attributes(['LONGNAME'])).toBeNull();
    expect(volume.testDir(['subdir', 'deeper'])).toBe(true);
  });

  it('reads a file and its stamp', async () => {
    const file = await disc().open(['NOEXT.']);

    expect(file.size).toBe(14);
    expect(new TextDecoder().decode(await file.read(0, 16))).toBe('NOEXT line 1\r\n');
    expect(file.dosStamp).toEqual([0x30e4, 0x1e85]);
    expect(file.dosSeek(100, 0)).toBe(14);
  });

  it('makes labels as MSCDEX does', () => {
    expect(setLabel('WINBOXCD2026')).toBe('WINBOXCD.202');
    expect(setLabel('CDROM')).toBe('CDROM');
    expect(setLabel('ABCDEFGH')).toBe('ABCDEFGH.');
    expect(setLabel('Game.cd')).toBe('Game.cd');
    expect(setLabel('ABCDEFGH.IJKL')).toBe('ABCDEFGH.IJK');
  });

  it('takes and lets go of iterators in turn', () => {
    const volume = disc();
    const pattern = '????????.???';
    const [first, found] = volume.findFirst([], 0x16, pattern) as [number, any];
    const [second] = volume.findFirst(['SUBDIR'], 0x16, pattern) as [number, any];

    expect(found).not.toBeNull();
    expect([first, second]).toEqual([0, 1]);

    while (volume.findFrom(0, 0x16, pattern, second)[0]) {
      /* to the folder's end */
    }

    expect((volume.findFirst([], 0x08, pattern) as [number, any])[0]).toBe(1);
  });
});
