'use strict';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FileManager } from '../../src/dos/file-manager.js';
import { hasDisk, isCompactDisc } from '../../src/dos/syscall/ioctl.js';
import { FATImage } from '../../src/file-systems/fat-image.js';
import { ISO9660 } from '../../src/file-systems/iso9660.js';

/**
 * A drive's disk swapped for another and taken out (`FileManager.swap`,
 * `eject`), as the Rust engine's `Files::swap` and `eject`
 * (`swaps_a_disk_keeping_the_folder_and_what_was_written`,
 * `ejects_a_disk_leaving_the_drive_empty`).
 */

const IMAGES = join(__dirname, '..', '..', 'oracle', 'probes', 'images');

function image(name: string) {
  return new Uint8Array(readFileSync(join(IMAGES, name)));
}

describe('swapping disks', () => {
  test('keeps the current folder, and the disk taken out keeps what was written', async () => {
    const files = new FileManager();
    const first = await FATImage.of(image('imgflop.img'), true);
    const second = await FATImage.of(image('imgwrite.img'), true);

    files.mount('A', first);
    files._pwd['A'] = 'A:\\SUBDIR\\';
    await first.create(['NEW.TXT']);
    expect(first.changed).toBe(true);

    expect(files.swap('a', second)).toBe(first);
    expect(files._pwd['A']).toBe('A:\\SUBDIR\\');
    expect(files.query('A')).toBe(second);
    expect(await second.open(['NEW.TXT'])).toBeFalsy();

    expect(files.swap('A', first)).toBe(second);
    expect(await first.open(['NEW.TXT'])).toBeTruthy();
    expect(hasDisk(files.query('A'))).toBe(true);
  });

  test('ejects a disk, leaving the drive empty', async () => {
    const files = new FileManager();
    const floppy = await FATImage.of(image('imgflop.img'), true);
    const disc = ISO9660.of(image('imgcd.iso'));

    files.mount('A', floppy);
    files.mount('D', disc);
    files.mount('C', { removable: false });

    expect(files.eject('A')).toBe(floppy);
    expect(files.eject('D')).toBe(disc);

    const a = files.query('A');
    const d = files.query('D');

    expect([a.removable, a.remote, hasDisk(a), a.mediaByte]).toEqual([true, false, false, 0xf0]);
    expect([d.removable, d.remote, hasDisk(d), d.mediaByte]).toEqual([true, true, false, 0xf8]);
    expect(isCompactDisc(d)).toBe(true);
    expect(await a.open(['README.TXT'])).toBeNull();

    expect(files.eject('C')).toBeUndefined();
    expect(files.eject('E')).toBeUndefined();
  });
});
