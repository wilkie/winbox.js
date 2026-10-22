'use strict';

import {
  type AssetInput,
  type KnownMedia,
  makeAssets,
  MANIFEST,
  type Made,
} from '../assets/make.js';
import { readZip, type ZipEntry } from '../zip.js';

/**
 * What the page makes of a file dropped on it: an asset bundle already made
 * (`winbox-assets.zip`), a Windows installation's archive, the user's Windows
 * 3.1 media -- the setup disks' images, a zip of them or of their files, or
 * the Driver Library's Super VGA 256-colour driver's files -- from which a
 * bundle is made here, in the browser, by the same maker as `pnpm assets`
 * (`src/assets/make.ts`); or an archive of programs. See
 * `kb/topics/asset-bundle.md`.
 */
export type Dropped =
  | { kind: 'bundle'; name: string; bytes: Uint8Array }
  | { kind: 'installation'; name: string; bytes: Uint8Array; entries: ZipEntry[] }
  | { kind: 'media'; input: AssetInput }
  | { kind: 'programs'; name: string; entries: ZipEntry[] };

/** The names a floppy's image goes by, as the maker reads them (`make.ts`'s `isFloppy`). */
const IMAGE = /\.(img|ima|dsk|vfd)$/i;

const isZip = (bytes: Uint8Array) =>
  bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

const baseName = (path: string) => path.split('/').pop() ?? path;

/** Whether an archive's entry is of the media: an image, Setup's lists, or a file `COMPRESS`ed for a disk. */
const ofMedia = (entry: ZipEntry) =>
  IMAGE.test(entry.path) || /^(OEM)?SETUP\.INF$|_$/i.test(baseName(entry.path));

/** What a dropped file is. Anything not a zip is taken as media, a disk's image or a file of one. */
export async function classify(name: string, bytes: Uint8Array): Promise<Dropped> {
  if (!isZip(bytes)) {
    return { kind: 'media', input: { name, bytes } };
  }

  const entries = await readZip(bytes);

  if (entries.some((entry) => entry.path === MANIFEST)) {
    return { kind: 'bundle', name, bytes };
  }

  /* An installation is recognised by its SYSTEM directory of fonts, before
   * the media: its SYSTEM directory holds a SETUP.INF too. */
  if (entries.some((entry) => /(^|\/)SYSTEM\/[^/]+\.(FON|TTF)$/i.test(entry.path))) {
    return { kind: 'installation', name, bytes, entries };
  }

  if (entries.some(ofMedia)) {
    return { kind: 'media', input: { name, bytes } };
  }

  return { kind: 'programs', name, entries };
}

/**
 * The media in the order the maker is to be given them: the disks' images
 * first, by name, then zips, of images or of a disk's files, then loose
 * files -- the order `pnpm assets` gives them (`scripts/assets/media.mjs`),
 * the images before the driver's files. The maker keeps the first file it
 * finds of each name, and the Super VGA driver's files have fonts of the
 * disks' names, the same bytes with no stamp of a disk's: given first, the
 * base's fonts would be stamped as nothing on the disks is.
 */
export function orderMedia(inputs: AssetInput[]) {
  const rank = (input: AssetInput) => (IMAGE.test(input.name) ? 0 : isZip(input.bytes) ? 1 : 2);

  return inputs
    .map((input) => ({ input, rank: rank(input) }))
    .sort(
      (one, other) =>
        one.rank - other.rank ||
        (one.input.name < other.input.name ? -1 : one.input.name > other.input.name ? 1 : 0)
    )
    .map(({ input }) => input);
}

/** The bundle made from the media given, told against the known media's hashes. */
export async function makeFromMedia(inputs: AssetInput[]): Promise<Made> {
  const known = (await import('../../scripts/assets/known-media.json')).default as KnownMedia;

  return makeAssets(orderMedia(inputs), { known, made: { by: 'WinBox run page' } });
}
