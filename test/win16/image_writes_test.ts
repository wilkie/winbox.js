'use strict';

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FATImage } from '../../src/file-systems/fat-image.js';
import { IMAGE, PROBES, runProbe } from './run-probe.js';

/**
 * What a program writes to a disk image is kept apart from it, sector by
 * sector (`OverlayDisk`): after `imgwrite` has written all over its floppy,
 * the images the probes mount are as they were committed, and the image as
 * written -- what "Save image..." keeps -- holds what it wrote. As the Rust
 * engine's `image_probes_leave_their_images_as_they_were`.
 */

const IMAGES = join(__dirname, '..', '..', 'oracle', 'probes', 'images');

const hashes = () =>
  readdirSync(IMAGES)
    .sort()
    .map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(join(IMAGES, name)))
        .digest('hex'),
    ]);

const ready = existsSync(IMAGE) && existsSync(join(PROBES, 'IMGWRITE.EXE'));

describe('a disk image a program writes to', () => {
  (ready ? it : it.skip)(
    'is left as it was, what was written kept apart',
    async () => {
      const before = hashes();
      const { win16 } = await runProbe('imgwrite', 4000, false, true, 30);
      const drive = win16.dos.files.query('A');

      expect(drive.changed).toBe(true);
      expect(hashes()).toEqual(before);

      /* The image as written, mounted again: what the probe left on it. */
      const written = await FATImage.of(drive.image(), true);
      const names = (await (await written.open([])).list()).map((entry: any) => entry.info.name);

      expect(names).toContain('GROW.TXT');
      expect(names).toContain('SUBDIR.');
      expect((await written.space()).free).toBe(0x0b07);
    },
    300000
  );
});
