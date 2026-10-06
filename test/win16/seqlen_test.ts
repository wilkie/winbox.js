'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { midiLengths } from '../../src/win16/mmsystem/mci-drivers.js';
import { colonized } from '../../src/win16/mmsystem/mci-string.js';
import { IMAGE, PROBES, outputOf, recordsFrom, runProbe } from './run-probe.js';

/**
 * A MIDI file's length as `MCISEQ.DRV` counts it: to its last event before
 * the end of its longest track, the end's own delta not counted, **read out**
 * of the driver (seg3 `19a2`-`1b78`, `17e6`, `1aba`-`1b1c`) and **recorded**
 * by `seqlen` in each time format. The probe was recorded on the installation
 * with a sound card (`--display vgasound`), which this engine's replay does
 * not take; but its lengths are the sequencer's alone, the same with no MIDI
 * device, so it is run here whole on the VGA installation and its answers
 * taken up to its first play or seek, which have nothing to play on here.
 */

const RECORDED = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'oracle', 'fixtures', 'seqlen.json'), 'utf8')
);

/** The probe's five files, as `seqlen.c` writes them. */
const HEADER = (format: number, tracks: number) => [
  0x4d,
  0x54,
  0x68,
  0x64,
  0,
  0,
  0,
  6,
  0,
  format,
  0,
  tracks,
  0,
  0x60,
];
const TRACK = (length: number) => [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, length];
const MARK_AND_TEMPO = [0, 0xff, 0x7f, 3, 0, 0, 0x41, 0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20];
const NOTE = (length: number) => [0, 0x90, 0x3c, 0x40, length, 0x80, 0x3c, 0x40];
const END = (delta: number) => [delta, 0xff, 0x2f, 0];

const FILES: [string, number[]][] = [
  ['EOT96', [...HEADER(0, 1), ...TRACK(26), ...MARK_AND_TEMPO, ...NOTE(0x60), ...END(0x60)]],
  ['EOT0', [...HEADER(0, 1), ...TRACK(26), ...MARK_AND_TEMPO, ...NOTE(0x60), ...END(0)]],
  [
    'TEXT',
    [
      ...HEADER(0, 1),
      ...TRACK(34),
      ...MARK_AND_TEMPO,
      ...NOTE(0x60),
      ...[0x60, 0xff, 1, 4, 0x65, 0x6e, 0x64, 0x2e],
      ...END(0x60),
    ],
  ],
  [
    'TWO',
    [
      ...HEADER(1, 2),
      ...TRACK(19),
      ...MARK_AND_TEMPO,
      ...[0x83, 0x60, 0xff, 0x2f, 0],
      ...TRACK(12),
      ...NOTE(0x60),
      ...END(0),
    ],
  ],
  ['ODD', [...HEADER(0, 1), ...TRACK(26), ...MARK_AND_TEMPO, ...NOTE(0x5f), ...END(1)]],
];

/** The time formats `seqlen` asks the length in, in its order, by their words. */
const FORMATS: [string, number][] = [
  ['song pointer', 0x4001],
  ['milliseconds', 0],
  ['smpte 24', 4],
  ['smpte 25', 5],
  ['smpte 30 drop', 7],
  ['smpte 30', 6],
];

/**
 * Windows' answers for each file, up to its first play or seek: `open`,
 * `set`, `status` and `close`, each as `mciSendString` gave it.
 */
function asked() {
  const kept: string[] = [];
  let moved = false;

  for (const { function: name, args, result } of RECORDED.records) {
    if (name !== 'mci') {
      continue;
    }

    if (args.startsWith('open ')) {
      moved = false;
    } else if (args.startsWith('play ') || args.startsWith('seek ')) {
      moved = true;
    }

    if (!moved && !args.startsWith('play ') && !args.startsWith('seek ')) {
      kept.push(`mci(${args}) = ${result}`);
    }
  }

  return kept;
}

describe("a MIDI file's length, as MCISEQ counts it", () => {
  it("is each file's recorded length in every format", () => {
    const sections = [...new Set(RECORDED.records.map(({ section }: any) => section))];

    expect(sections.length).toEqual(FILES.length);

    for (const [at, [, bytes]] of FILES.entries()) {
      const lengths = midiLengths(new Uint8Array(bytes));
      const recorded = RECORDED.records.filter(
        ({ section, args }: any) => section === sections[at] && args === 'status song length'
      );
      const shown = FORMATS.map(([, format]) =>
        format >= 4 && format <= 7 ? colonized(lengths[format]) : String(lengths[format])
      );

      /* In the probe's order: song pointer, milliseconds, the four SMPTE
       * formats, and song pointer again. */
      expect([...shown, shown[0]].map((text) => `0 [${text}]`)).toEqual(
        recorded.slice(0, 7).map(({ result }: any) => result)
      );
    }
  });

  it('is to the last event before the end of the longest track', () => {
    const lengths = (name: string) =>
      midiLengths(new Uint8Array(FILES.find(([file]) => file === name)![1]))[0x4001];

    /* The end's own delta not counted: 96 ticks either way. */
    expect(lengths('EOT96')).toEqual(4);
    expect(lengths('EOT0')).toEqual(4);
    /* A text event's delta counted as any event's. */
    expect(lengths('TEXT')).toEqual(8);
    /* A first track only of its end, 480 ticks in: nothing before it. */
    expect(lengths('TWO')).toEqual(4);
    /* 95 ticks, the fraction of a sixteenth dropped. */
    expect(lengths('ODD')).toEqual(3);
  });

  const available = existsSync(IMAGE) && existsSync(join(PROBES, 'SEQLEN.EXE'));

  (available ? it : it.skip)(
    'is what mciSendString answers, run whole',
    async () => {
      const { fileSystem } = await runProbe('seqlen', 4000, false, true, 30);
      const written = recordsFrom((await outputOf(fileSystem, 'seqlen')) ?? '');
      let moved = false;
      const kept = written.filter((line) => {
        if (!line.startsWith('mci(')) {
          return false;
        }

        if (line.startsWith('mci(open ')) {
          moved = false;
        } else if (line.startsWith('mci(play ') || line.startsWith('mci(seek ')) {
          moved = true;
        }

        return !moved;
      });

      expect(kept).toEqual(asked());
    },
    120000
  );
});
