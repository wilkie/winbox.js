'use strict';

import { dropMedia, installedLayer } from '../../src/layers/install.js';
import { type Change } from '../../src/run/changes.js';

/**
 * An installer's media on another drive than C:, the floppy it ran from:
 * nothing of C:'s layer is dropped for them, and what names them is told
 * with their letter. As `layers.rs`'s
 * `media_on_a_floppy_drop_nothing_and_are_named_with_their_letter`.
 */

const file = (path: string, text: string): Change => ({
  kind: 'file',
  path,
  data: new TextEncoder().encode(text),
  modified: 800_000_000,
});

const changes = [
  file('WINDOWS\\WIN.INI', '[Game]\r\nDisk=a:\\SETUP.EXE\r\nHome=C:\\GAME\r\n'),
  file('GAME\\GAME.INI', 'Source=A:\\DATA\r\nSetup=C:\\WBSETUP\\X\r\n'),
  file('WBSETUP\\LOG.TXT', 'A:\\'),
];

describe('media on another drive', () => {
  test('a floppy drops nothing and is named with its letter', async () => {
    const { kept, dropped } = dropMedia(changes, ['A:\\']);

    expect(kept).toHaveLength(3);
    expect(dropped).toEqual([]);

    const installed = await installedLayer(changes, { media: ['A:\\'], over: [] });

    expect(installed.references.map(({ path, line }) => `${path}: ${line}`)).toEqual([
      'GAME\\GAME.INI: Source=A:\\DATA',
      'WBSETUP\\LOG.TXT: A:\\',
      'WINDOWS\\WIN.INI: Disk=a:\\SETUP.EXE',
    ]);
  });

  test("C:'s media, by its letter or none, as before", async () => {
    for (const media of ['WBSETUP', 'C:\\WBSETUP']) {
      const { kept, dropped } = dropMedia(changes, [media]);

      expect(kept).toHaveLength(2);
      expect(dropped).toEqual(['WBSETUP\\LOG.TXT']);

      const installed = await installedLayer(changes, { media: [media], over: [] });

      expect(installed.references.map(({ line }) => line)).toEqual(['Setup=C:\\WBSETUP\\X']);
    }
  });
});
