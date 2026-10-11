'use strict';

import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IMAGE, runProbe } from './run-probe.js';

/**
 * Sound Recorder opening a waveform file, changing it and saving it through
 * MMSYSTEM's `mmio` functions (`src/win16/mmsystem/mmio.ts`). This engine
 * has no sound card, so Sound Recorder first says it cannot play or record,
 * and goes on. The Rust engine's `crates/winbox-web/tests/sound_recorder.rs`
 * plays the file too. Sound Recorder runs from `C:\CORPUS\SWEEP`, with the
 * file beside it.
 */

const WINDOWS = join(__dirname, '..', '..', 'oracle', 'build', 'drive-c', 'WINDOWS');

/** A step: keys and clicks, `;` between them, then the seconds run on. */
const step = (keys: string, seconds = 1, then?: (win16: any) => void) => ({
  keys: keys.split(';'),
  seconds,
  then,
});

/** Letters, digits and Return typed, as keysyms. */
const typed = (text: string) => [...text].map((c) => (c === '\n' ? 'Return' : c)).join(';');

/** A waveform file of eight-bit mono samples at 11,025 a second. */
function wave(samples: number[]) {
  const data = samples.length;
  const bytes: number[] = [];
  const long = (value: number) =>
    bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24);
  const text = (value: string) => bytes.push(...[...value].map((c) => c.charCodeAt(0)));

  text('RIFF');
  long(36 + data + (data & 1));
  text('WAVEfmt ');
  long(16);
  bytes.push(1, 0, 1, 0);
  long(11025);
  long(11025);
  bytes.push(1, 0, 8, 0);
  text('data');
  long(data);
  bytes.push(...samples);

  if (data & 1) {
    bytes.push(0);
  }

  return Buffer.from(bytes);
}

/** Half a second of a tone: a triangle of 50 samples, from 40h to C0h, as the Rust engine's test makes it. */
function tone() {
  return Array.from({ length: 5512 }, (_, at) => {
    const phase = at % 50;
    const rise = phase < 25 ? phase : 50 - phase;

    return 0x40 + rise * 5;
  });
}

/** The text of Sound Recorder's control with an identifier: 202 its length. */
function textOf(win16: any, id: number) {
  const windows = win16.rasterDesktop.windows;
  const parent = windows.find(
    (w: any) => w.visible && !w.parent && String(w.title).startsWith('Sound Recorder')
  );

  const control = windows.find((w: any) => parent && w.parent === parent && w.controlId === id);

  return control?.control?.text ?? control?.title ?? '';
}

const titles = (win16: any): string[] =>
  win16.rasterDesktop.windows.filter((w: any) => w.visible && !w.parent).map((w: any) => w.title);

(existsSync(IMAGE) && existsSync(join(WINDOWS, 'SOUNDREC.EXE')) ? describe : describe.skip)(
  'Sound Recorder',
  () => {
    /* Once, Sound Recorder said there was not enough disk space to open a
     * file: MMSYSTEM's `mmio` functions were stubs. It opens one through them
     * now, and Effects' Reverse then Save As writes a RIFF `WAVE` whose sizes
     * are filled in, its samples the other way round. The `sndrec` probe holds
     * Windows' own Sound Recorder's saves to the byte. */
    it('opens a file, reverses it and saves it', async () => {
      const copied = mkdtempSync(join(tmpdir(), 'winbox-soundrec-'));
      let opened: string[] = [];
      let length = '';
      let saved: string[] = [];

      try {
        copyFileSync(join(WINDOWS, 'SOUNDREC.EXE'), join(copied, 'SOUNDREC.EXE'));
        writeFileSync(join(copied, 'TONE.WAV'), wave(tone()));

        const ran: any = await runProbe('sweep', 0, false, true, 3, {
          program: { directory: copied, file: 'SOUNDREC.EXE', folder: 'SWEEP' },
          virtual: true,
          keepCalls: 0,
          steps: [
            step('Return', 2),
            step('Alt_L+f;o', 2),
            step(typed('TONE.WAV\n'), 3, (win16) => {
              opened = titles(win16);
              length = textOf(win16, 202);
            }),
            step('Alt_L+s;r', 2),
            step('Alt_L+f;a', 2),
            step(typed('OUT.WAV\n'), 3, (win16) => {
              saved = titles(win16);
            }),
          ],
        });

        expect(opened).toContain('Sound Recorder - TONE.WAV');
        expect(length).toBe('0.50 sec.');
        expect(saved).toContain('Sound Recorder - OUT.WAV');

        const file = await ran.fileSystem.open(['CORPUS', 'SWEEP', 'OUT.WAV']);
        const bytes = file ? Buffer.from(await file.read(0, file.info.size)) : null;

        expect(bytes?.toString('hex')).toBe(wave(tone().reverse()).toString('hex'));
      } finally {
        rmSync(copied, { recursive: true, force: true });
      }
    }, 300000);

    /* A file larger than 64 KiB, read and written with counts and buffers
     * past a segment through `mmio`'s huge pointers: 100,001 samples of a
     * ramp whose every 256 samples step on, as the `sndbig` probe writes it,
     * whose recording holds Windows' own Sound Recorder's save to the byte.
     * As the Rust engine's `sound_recorder_reverses_a_file_larger_than_a_segment`. */
    it('reverses a file larger than a segment and saves it', async () => {
      const copied = mkdtempSync(join(tmpdir(), 'winbox-soundrec-'));
      const big = Array.from({ length: 100001 }, (_, at) => (0x30 + at + (at >> 8)) & 0xff);
      let opened: string[] = [];
      let length = '';
      let saved: string[] = [];

      try {
        copyFileSync(join(WINDOWS, 'SOUNDREC.EXE'), join(copied, 'SOUNDREC.EXE'));
        writeFileSync(join(copied, 'BIG.WAV'), wave(big));

        const ran: any = await runProbe('sweep', 0, false, true, 3, {
          program: { directory: copied, file: 'SOUNDREC.EXE', folder: 'SWEEP' },
          virtual: true,
          keepCalls: 0,
          steps: [
            step('Return', 2),
            step('Alt_L+f;o', 2),
            step(typed('BIG.WAV\n'), 4, (win16) => {
              opened = titles(win16);
              length = textOf(win16, 202);
            }),
            step('Alt_L+s;r', 3),
            step('Alt_L+f;a', 2),
            step(typed('OUT.WAV\n'), 4, (win16) => {
              saved = titles(win16);
            }),
          ],
        });

        expect(opened).toContain('Sound Recorder - BIG.WAV');
        expect(length).toBe('9.07 sec.');
        expect(saved).toContain('Sound Recorder - OUT.WAV');

        const file = await ran.fileSystem.open(['CORPUS', 'SWEEP', 'OUT.WAV']);
        const bytes = file ? Buffer.from(await file.read(0, file.info.size)) : null;

        expect(bytes?.equals(wave([...big].reverse()))).toBe(true);
      } finally {
        rmSync(copied, { recursive: true, force: true });
      }
    }, 300000);
  }
);
