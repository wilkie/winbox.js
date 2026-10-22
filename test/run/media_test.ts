'use strict';

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Assets } from '../../src/assets/bundle.js';
import { writeStoredZip } from '../../src/assets/zip.js';
import { Machine } from '../../src/emulator/machine.js';
import { fillDrive, planDrive } from '../../src/run/drive.js';
import { classify, makeFromMedia, orderMedia } from '../../src/run/media.js';
import { assetsIdentity, changesKey } from '../../src/run/store.js';
import { bundle, bundleDrive } from '../win16/run-probe.js';

/**
 * What the page makes of what is dropped on it, and the asset bundle's base
 * it puts on C: (`kb/topics/asset-bundle.md`): a bundle made from the disks
 * in the browser is the one `pnpm assets` makes, and the page's drive on
 * its base is the TypeScript harness's, sector for sector. Those two are
 * skipped without the media under `oracle/.cache`, or the bundle made into
 * `oracle/build/assets`.
 */

const ROOT = join(__dirname, '..', '..');
const CACHE = join(ROOT, 'oracle', '.cache');

const zip = (files: Record<string, string>) =>
  writeStoredZip(
    Object.entries(files).map(([path, text]) => ({
      path,
      data: new TextEncoder().encode(text),
      date: 0x21,
      time: 0,
    }))
  );

describe("what the page makes of what's dropped", () => {
  it('tells a bundle, an installation, the media and programs apart', async () => {
    expect((await classify('b.zip', zip({ 'winbox-assets.json': '{}' }))).kind).toBe('bundle');
    expect(
      (
        await classify(
          'w.zip',
          zip({ 'WINDOWS/SYSTEM/VGASYS.FON': 'x', 'WINDOWS/SYSTEM/SETUP.INF': 'x' })
        )
      ).kind
    ).toBe('installation');
    expect((await classify('d.zip', zip({ 'Disk01.img': 'x' }))).kind).toBe('media');
    expect((await classify('f.zip', zip({ 'disk1/SETUP.INF': 'x' }))).kind).toBe('media');
    expect((await classify('s.zip', zip({ 'OEMSETUP.INF': 'x', 'SVGA256.DRV': 'x' }))).kind).toBe(
      'media'
    );
    expect((await classify('c.zip', zip({ 'ARIAL.FO_': 'x' }))).kind).toBe('media');
    expect((await classify('g.zip', zip({ 'SKI.EXE': 'x' }))).kind).toBe('programs');
    expect((await classify('Disk01.img', new Uint8Array(16))).kind).toBe('media');
  });

  it("gives the maker the disks' images first, as the script does", () => {
    const one = (name: string) => ({ name, bytes: new Uint8Array() });

    expect(
      orderMedia([
        one('VGASYS.FON'),
        { name: 'zdisks.zip', bytes: zip({ 'Disk03.img': 'x' }) },
        one('Disk02.img'),
        one('OEMSETUP.INF'),
        one('Disk01.img'),
      ]).map((input) => input.name)
    ).toEqual(['Disk01.img', 'Disk02.img', 'zdisks.zip', 'OEMSETUP.INF', 'VGASYS.FON']);
  });

  it("keeps changes on a bundle's base by its display", () => {
    expect(changesKey(null)).toBe('C');
    expect(changesKey('0123abcd')).toBe('C');
    expect(changesKey(assetsIdentity('feed', 'vga'))).toBe('C:assets:feed:vga');
    expect(changesKey(assetsIdentity('feed', 'ega'))).not.toBe(
      changesKey(assetsIdentity('feed', 'vga'))
    );
  });
});

/** The disks' images and the Super VGA driver's files, as the user would drop them. */
function media() {
  const floppies = join(CACHE, 'floppies');
  const images: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);

      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.img$/i.test(entry.name)) {
        images.push(path);
      }
    }
  };

  walk(floppies);

  const svga = join(CACHE, 'svga256');
  const driver = existsSync(svga)
    ? readdirSync(svga)
        .filter((name) => !/\.exe$/i.test(name))
        .map((name) => join(svga, name))
    : [];

  return [...images, ...driver].map((path) => ({
    name: path.split(/[\\/]/).pop()!,
    bytes: new Uint8Array(readFileSync(path)),
  }));
}

const made = bundle();
const haveMedia = existsSync(join(CACHE, 'floppies'));

(made && haveMedia ? describe : describe.skip)('the bundle made on the page', () => {
  it("is the script's, whatever order the files are dropped in", async () => {
    /* The driver's files first, as a person might drop them. */
    const dropped = media().reverse();
    const { manifest } = await makeFromMedia(dropped);

    expect(manifest.id).toBe(made!.id);
    expect(manifest.files).toEqual(made!.manifest.files);
    expect(manifest.displays).toEqual(made!.displays);
    expect(manifest.sources.every((source) => source.known)).toBe(true);
  }, 60000);
});

(made ? describe : describe.skip)("the page's drive on the bundle's base", () => {
  for (const display of ['vga', 'ega', 'vga256']) {
    it(`is the TypeScript harness's, sector for sector, on ${display}`, async () => {
      if (!made!.displays.includes(display)) {
        return;
      }

      const assets: Assets = made!;
      const page: any = new Machine();
      const harness: any = new Machine();

      await fillDrive(page, planDrive([], null, assets.compose(display)));
      await bundleDrive(harness, assets, display);

      const blocks = (machine: any) =>
        Array.from(machine.disks[0]._blocks as (DataView | undefined)[], (block) =>
          block
            ? Buffer.from(block.buffer, block.byteOffset, block.byteLength).toString('base64')
            : null
        );

      expect(blocks(page).filter(Boolean).length).toBeGreaterThan(10);
      expect(blocks(page)).toEqual(blocks(harness));
    }, 60000);
  }
});
