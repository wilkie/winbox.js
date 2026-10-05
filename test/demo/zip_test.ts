'use strict';

import { deflateRawSync } from 'node:zlib';

import { readZip } from '../../src/zip.js';

/**
 * A zip archive built here, byte by byte, so the reader is checked against
 * the format rather than against another reader's idea of it: one entry
 * stored, one deflated, and a directory, which is left out.
 */
function archive(
  files: { path: string; data: Uint8Array; deflate?: boolean; time?: number; date?: number }[]
) {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
  const u32 = (value: number) => [...u16(value & 0xffff), ...u16((value >>> 16) & 0xffff)];

  for (const file of files) {
    const name = Array.from(file.path, (character) => character.charCodeAt(0));
    const body = file.deflate ? new Uint8Array(deflateRawSync(file.data)) : file.data;
    const method = file.deflate ? 8 : 0;
    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u32(0),
      ...u32(0),
      ...u32(body.length),
      ...u32(file.data.length),
      ...u16(name.length),
      ...u16(0),
      ...name,
      ...body,
    ]);

    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(method),
        ...u16(file.time ?? 0),
        ...u16(file.date ?? 0),
        ...u32(0),
        ...u32(body.length),
        ...u32(file.data.length),
        ...u16(name.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...name,
      ])
    );

    locals.push(local);
    offset += local.length;
  }

  const directory = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(directory),
    ...u32(offset),
    ...u16(0),
  ]);

  const out = new Uint8Array(offset + directory + end.length);
  let at = 0;

  for (const part of [...locals, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}

describe('reading a zip archive', () => {
  const text = new TextEncoder().encode('Hello, Windows 3.1\r\n'.repeat(40));
  const binary = Uint8Array.from({ length: 300 }, (_, index) => (index * 7) & 0xff);

  it('reads stored and deflated entries, and leaves directories out', async () => {
    const entries = await readZip(
      archive([
        { path: 'GAMES/', data: new Uint8Array(0) },
        { path: 'GAMES/README.TXT', data: text, deflate: true },
        { path: 'GAMES/DATA.BIN', data: binary },
      ])
    );

    expect(entries.map((entry) => entry.path)).toEqual(['GAMES/README.TXT', 'GAMES/DATA.BIN']);
    expect(Array.from(entries[0].data)).toEqual(Array.from(text));
    expect(Array.from(entries[1].data)).toEqual(Array.from(binary));
  });

  it('reads when each entry was last written, where the archive gives a date', async () => {
    const entries = await readZip(
      archive([
        {
          path: 'SOL.EXE',
          data: binary,
          time: (3 << 11) | (10 << 5) | (8 >> 1),
          date: ((1992 - 1980) << 9) | (3 << 5) | 10,
        },
        { path: 'UNDATED.TXT', data: text },
      ])
    );

    expect(entries[0].modified).toBe(Date.UTC(1992, 2, 10, 3, 10, 8) / 1000);
    expect(entries[1].modified).toBeUndefined();
  });

  it('refuses something that is not an archive', async () => {
    await expect(readZip(new Uint8Array(100))).rejects.toThrow(/not a zip archive/);
  });
});

describe('putting archives on a drive', () => {
  /* A Windows program's first bytes: an MZ stub pointing at an NE header. */
  const program = () => {
    const data = new Uint8Array(0x60);
    data.set([0x4d, 0x5a]);
    data[0x3c] = 0x40;
    data.set([0x4e, 0x45], 0x40);
    return data;
  };

  it('places each archive in a directory of its own, as 8.3 names', async () => {
    const { Machine } = await import('../../src/emulator/machine.js');
    const { buildDrive } = await import('../../src/run/drive.js');
    const machine = new Machine();

    const drive = await buildDrive(
      machine,
      [
        {
          name: 'Games.zip',
          entries: [
            { path: 'SKI.EXE', data: program() },
            { path: 'Long File Name.txt', data: new Uint8Array([1, 2, 3]) },
          ],
        },
      ],
      null
    );

    expect(drive.programs).toEqual([
      { path: 'C:\\GAMES\\SKI.EXE', parts: ['GAMES', 'SKI.EXE'], kind: 'windows' },
    ]);
    expect(drive.files).toContain('C:\\GAMES\\LONGFI~1.TXT');
    expect(drive.renamed).toEqual([
      { from: 'Games.zip/Long File Name.txt', to: 'C:\\GAMES\\LONGFI~1.TXT' },
    ]);

    const file: any = await drive.fileSystem.open(['GAMES', 'LONGFI~1.TXT']);
    expect(Array.from(new Uint8Array(await file.read(0, 3)))).toEqual([1, 2, 3]);
  });

  it('plans the same places for either engine, each with when it was last written', async () => {
    const { planDrive } = await import('../../src/run/drive.js');

    const plan = planDrive(
      [
        {
          name: 'Games.zip',
          entries: [
            { path: 'SKI.EXE', data: program(), modified: 700_000_000 },
            { path: 'Long File Name.txt', data: new Uint8Array([1, 2, 3]) },
          ],
        },
      ],
      null
    );

    expect(
      plan.placements.map(({ parts, original, modified }) => ({ parts, original, modified }))
    ).toEqual([
      { parts: ['GAMES', 'SKI.EXE'], original: 'Games.zip/SKI.EXE', modified: 700_000_000 },
      {
        parts: ['GAMES', 'LONGFI~1.TXT'],
        original: 'Games.zip/Long File Name.txt',
        /* The FAT16 volume's own stamp, where the archive gives none. */
        modified: Date.UTC(2020, 0, 6, 10, 20, 40) / 1000,
      },
    ]);
    expect(plan.files).toEqual(['C:\\GAMES\\SKI.EXE', 'C:\\GAMES\\LONGFI~1.TXT']);
  });

  it('finds a Windows installation wherever it sits and puts it at C:\\WINDOWS', async () => {
    const { Machine } = await import('../../src/emulator/machine.js');
    const { buildDrive } = await import('../../src/run/drive.js');

    const drive = await buildDrive(new Machine(), [], {
      name: 'win31.zip',
      entries: [
        { path: 'backup/win31/WIN.INI', data: new Uint8Array([0x5b]) },
        { path: 'backup/win31/SYSTEM/VGASYS.FON', data: new Uint8Array([0]) },
      ],
    });

    expect(drive.windows).toBe(true);
    expect(drive.files).toEqual(['C:\\WINDOWS\\WIN.INI', 'C:\\WINDOWS\\SYSTEM\\VGASYS.FON']);
  });
});
