'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BinaryFile, CdImage, CueError } from '../../src/file-systems/cue.js';
import { ISO9660 } from '../../src/file-systems/iso9660.js';

/**
 * A CD image's tracks as DOSBox's `CDROM_Interface_Image` holds them
 * (`CdImage`): cue sheets read as `LoadCueSheet` reads them, laid out as
 * `AddTrack` lays them out; the same checks as `cue.rs`'s tests.
 */

const IMAGES = join(__dirname, '..', '..', 'oracle', 'probes', 'images');

const bytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

function sheet(text: string, files: Record<string, number>) {
  return CdImage.loadCueSheet(bytes(text), (name) =>
    Object.hasOwn(files, name) ? new Uint8Array(files[name]) : null
  );
}

const starts = (image: CdImage) =>
  image.tracks.map((track) => [track.number, track.start, track.length, track.skip]);

function reason(text: string) {
  try {
    sheet(text, { 'a.bin': 2352 * 20 });
  } catch (error) {
    return (error as CueError).reason;
  }

  return null;
}

describe('a cue sheet', () => {
  it('lays out one file as AddTrack does', () => {
    const image = sheet(
      'FILE "game.bin" BINARY\r\n  TRACK 01 MODE1/2352\r\n    INDEX 01 00:00:00\r\n  ' +
        'TRACK 02 AUDIO\r\n    INDEX 00 00:10:00\r\n    INDEX 01 00:12:00\r\n',
      { 'game.bin': 2352 * 1500 }
    );

    expect(starts(image)).toEqual([
      [1, 0, 750, 0],
      [2, 900, 600, 900 * 2352],
      [3, 1500, 0, 0],
    ]);
    expect([16, 899, 900, 1500].map((sector) => image.getTrack(sector))).toEqual([1, 1, 2, -1]);
  });

  it('lays out a file to a track', () => {
    const image = sheet(
      'FILE "Game (Track 1).bin" BINARY\n TRACK 01 MODE1/2352\n  INDEX 01 00:00:00\n' +
        'FILE "Game (Track 2).bin" BINARY\n TRACK 02 AUDIO\n  INDEX 00 00:00:00\n  ' +
        'INDEX 01 00:02:00\n',
      { 'Game (Track 1).bin': 2352 * 300 + 100, 'Game (Track 2).bin': 2352 * 450 }
    );

    /* Track 1 counted 301 sectors, its last cut short; track 2's index 0 at
     * 00:00:00 is no index 0 to `AddTrack`, so nothing is skipped. */
    expect(starts(image)).toEqual([
      [1, 0, 301, 0],
      [2, 451, 450, 0],
      [3, 901, 0, 0],
    ]);
  });

  it('refuses what DOSBox refuses', () => {
    expect(reason('\xef\xbb\xbfFILE a.bin BINARY\n')).toEqual({
      kind: 'command',
      command: '\xef\xbb\xbfFILE',
    });
    expect(reason('FILE b.bin BINARY\n')).toEqual({ kind: 'file', name: 'b.bin', type: 'BINARY' });
    expect(reason('FILE a.bin MOTOROLA\n')).toEqual({
      kind: 'file',
      name: 'a.bin',
      type: 'MOTOROLA',
    });
    expect(reason('FILE a.bin BINARY\nTRACK 01 MODE2/2048\n')).toEqual({
      kind: 'track-type',
      type: 'MODE2/2048',
    });
    expect(reason('FILE a.bin BINARY\nTRACK 02 MODE1/2352\nINDEX 01 00:00:00\n')).toEqual({
      kind: 'layout',
    });
    expect(reason('FILE a.bin BINARY\nTRACK 01 MODE1/2352\nINDEX 01 0:0\n')).toEqual({
      kind: 'frame',
    });
    expect(reason('FILE a.bin BINARY\nTRACK 01 MODE1/2352\nARRANGER x\n')).toEqual({
      kind: 'command',
      command: 'ARRANGER',
    });
    expect(reason('x'.repeat(600))).toEqual({ kind: 'not-text' });
  });

  it('reads words as its streams do', () => {
    const long = 'n'.repeat(255);
    const image = sheet(
      `rem a comment\r\ncatalog 0123456789012\r\nfile "${long}" binary\r\ntrack 1 mode1/2048\r\n` +
        'title "x y"\r\nindex 1 0:0:0',
      { [long]: 2048 * 20 }
    );

    expect(image.mcn).toBe('0123456789012');
    expect(starts(image)).toEqual([
      [1, 0, 20, 0],
      [2, 20, 0, 0],
    ]);

    /* A quoted name with a space is read by `getline`, 255 bytes at most. */
    const spaced = `a ${'n'.repeat(253)}`;

    expect(() =>
      sheet(`FILE "${spaced}" BINARY\nTRACK 01 MODE1/2048\nINDEX 01 00:00:00\n`, {
        [spaced]: 2048 * 20,
      })
    ).not.toThrow();

    const longer = `${spaced}n`;

    expect(reason(`FILE "${longer}" BINARY\n`)).toEqual({
      kind: 'file',
      name: longer.slice(0, 255),
      type: '',
    });
  });

  it('keeps audio files unplayed', () => {
    const image = sheet(
      'FILE data.bin BINARY\nTRACK 01 MODE1/2048\nINDEX 01 00:00:00\n' +
        'FILE "t2.ogg" OGG\nTRACK 02 AUDIO\nINDEX 01 00:00:00\n',
      { 'data.bin': 2048 * 40, 't2.ogg': 1000 }
    );

    expect(image.tracks).toHaveLength(3);
    expect(image.tracks[1].start).toBe(40);
    expect(image.tracks[2].known).toBe(false);
    expect(image.getTrack(16)).toBe(1);
    expect(image.getTrack(40)).toBe(-1);
  });

  it('fails a file for good once a read of it has failed', () => {
    const file = new BinaryFile(new Uint8Array(100));
    const buffer = new Uint8Array(50);

    expect(file.read(buffer, 0)).toBe(true);
    expect(file.read(buffer, 80)).toBe(false);
    expect(file.read(buffer, 0)).toBe(false);
    expect(file.getLength()).toBe(-1);
  });
});

describe("the probes' CD images", () => {
  const find = (name: string) => {
    const path = join(IMAGES, name);

    return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  };
  const readme = async (volume: any) => {
    const file = await volume.open(['README.TXT']);

    return new TextDecoder().decode(await file.read(0, file.size));
  };

  it('read alike, raw, as cue sheets of mode 1 and mode 2, and of two files', async () => {
    const iso = ISO9660.of(find('imgcd.iso')!);

    for (const name of ['imgcd.bin', 'imgcd.cue', 'imgcd2.cue', 'imgtrk.cue']) {
      const volume = ISO9660.of(find(name)!, find);

      expect(await readme(volume)).toBe(await readme(iso));
      expect(volume.label).toBe(iso.label);
    }

    const tracks = CdImage.setDevice(find('imgtrk.cue')!, find).tracks;

    expect(tracks.map((track) => [track.number, track.attr, track.start, track.known])).toEqual([
      [1, 0x40, 0, true],
      [2, 0, 193 + 150, true],
      [3, 0, 193 + 150, false],
    ]);
  });

  it('name the file a cue sheet wants', () => {
    expect(() => ISO9660.of(find('imgcd.cue')!)).toThrow('line 1: imgcd.bin not found');
  });
});
