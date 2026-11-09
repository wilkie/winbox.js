'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Assets } from '../../src/assets/bundle.js';
import { bundle } from './built.js';

/**
 * The asset bundle read from its zip, as the page reads what is dropped on
 * it, is the bundle unpacked into its folder (`pnpm assets`). Skipped
 * without them.
 */

const ZIP = join(__dirname, '..', '..', 'oracle', 'build', 'winbox-assets.zip');

(bundle() !== null && existsSync(ZIP) ? describe : describe.skip)('the asset bundle', () => {
  it('reads the zip as the folder', async () => {
    const zip = await Assets.fromZip(new Uint8Array(readFileSync(ZIP)));
    const folder = bundle()!;

    expect(zip.id).toBe(folder.id);
    expect([...zip.modules.keys()]).toEqual([...folder.modules.keys()]);
    expect([...zip.pool.keys()]).toEqual([...folder.pool.keys()]);
    expect(zip.module('vga.drv')).toEqual(folder.module('VGA.DRV'));
  });
});
