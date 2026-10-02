'use strict';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { IMAGE, runProbe } from '../win16/run-probe.js';
import { withCursor } from '../../src/win16/user/cursor-api.js';

/**
 * The corpus, surveyed: each program `corpus/manifest.json` names, fetched by
 * `scripts/corpus/fetch.mjs`, run on the raster desktop for a while, and
 * what came of it written to `corpus/reports/`: how far it got, whether it
 * faulted, the calls it made that reach nothing yet, and the screen, as a
 * PNG. `summary.md` ranks what is missing by how many programs want it.
 *
 * Not part of the ordinary run: `CORPUS=1 npx jest test/corpus --forceExit`, or
 * `CORPUS=ski,bandit` for some. A box that lets no program run is answered
 * Enter, as its default button: an Application Error box is closed.
 */

const ROOT = join(__dirname, '..', '..');
const CORPUS = join(ROOT, 'corpus');
const REPORTS = join(CORPUS, 'reports');
const wanted = process.env.CORPUS ?? '';
const manifest = existsSync(join(CORPUS, 'manifest.json'))
  ? JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8'))
  : { programs: [] };
/* Programs that cannot be fetched -- placed by hand, so another checkout
 * cannot have them -- are listed in `manifest.local.json`, which git ignores
 * with the programs themselves, and surveyed only when named. */
const local = existsSync(join(CORPUS, 'manifest.local.json'))
  ? JSON.parse(readFileSync(join(CORPUS, 'manifest.local.json'), 'utf8'))
  : { programs: [] };
const entries = [
  ...manifest.programs.filter((entry: any) => wanted === '1' || wanted.split(',').includes(entry.id)),
  ...local.programs.filter((entry: any) => wanted.split(',').includes(entry.id)),
];

/** An argument or answer as the calls file shows it: a structure as its fields. */
function shown(value: any): string {
  if (value === undefined || value === null) {
    return '';
  }

  /* A structure: its fields and their values, not the memory it is in. */
  if (value && Array.isArray(value._items) && Array.isArray(value._data)) {
    return `{${value._items.map(([name]: [string], at: number) => `${name}:${shown(value._data[at])}`).join(',')}}`;
  }

  if (Array.isArray(value)) {
    return `[${value.map(shown).join(',')}]`;
  }

  if (typeof value === 'object' && !(value instanceof String)) {
    try {
      return JSON.stringify(value, (_key, field) =>
        typeof field === 'object' && field && Object.keys(field).length > 12 ? '{..}' : field
      );
    } catch {
      return '{?}';
    }
  }

  return String(value);
}

/** The screen as a PNG, each index through the display's palette. */
function png(width: number, height: number, indices: Uint8Array, colours: number[][]) {
  const table = [...Array(256)].map((_, n) => {
    let c = n;

    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;

    for (const byte of bytes) {
      c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    }

    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    const body = Buffer.concat([Buffer.from(type), data]);
    const check = Buffer.alloc(4);

    length.writeUInt32BE(data.length);
    check.writeUInt32BE(crc(body));

    return Buffer.concat([length, body, check]);
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let at = 0;

  for (let y = 0; y < height; y++) {
    raw[at++] = 0;

    for (let x = 0; x < width; x++) {
      const [r, g, b] = colours[indices[y * width + x]] ?? [0, 0, 0];

      raw[at++] = r;
      raw[at++] = g;
      raw[at++] = b;
    }
  }

  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const reports: any[] = [];

(entries.length && existsSync(IMAGE) ? describe : describe.skip)('the corpus', () => {
  afterAll(() => {
    if (!reports.length) {
      return;
    }

    /* What is missing, by how many programs call it. */
    const wants = new Map<string, Set<string>>();

    for (const report of reports) {
      for (const name of Object.keys(report.stubs)) {
        wants.set(name, (wants.get(name) ?? new Set()).add(report.id));
      }
    }

    const lines = [
      '# The corpus, surveyed',
      '',
      '| program | calls | stubs | faulted | ended | failure |',
      '|---|---|---|---|---|---|',
      ...reports.map(
        (report) =>
          `| ${report.id} | ${report.calls} | ${Object.keys(report.stubs).length} | ${report.faulted ? 'yes' : ''} | ${report.ended ? 'yes' : ''} | ${report.failure ?? ''} |`
      ),
      '',
      '## Missing, by how many programs call it',
      '',
      ...[...wants]
        .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
        .map(([name, ids]) => `- ${name}: ${ids.size} (${[...ids].join(', ')})`),
      '',
    ];

    writeFileSync(join(REPORTS, 'summary.md'), lines.join('\n'));
  });

  /* Unasked for, it stands aside rather than leaving jest a suite with nothing
   * in it, which jest counts as a failure. */
  if (!entries.length) {
    it.skip('runs the programs CORPUS names', () => {});
  }

  for (const entry of entries) {
    it(`runs ${entry.id}`, async () => {
      const directory = join(CORPUS, 'programs', entry.id);

      if (!existsSync(join(directory, entry.run))) {
        throw new Error(`${entry.id} is not fetched: node scripts/corpus/fetch.mjs ${entry.id}`);
      }

      const run: any = await runProbe(
        entry.id,
        entry.survey?.frames ?? 3000,
        false,
        true,
        /* As long as Windows' screen had run for: `record.mjs --shoot
         * starting:10` takes it ten seconds after the program is started,
         * on DOSBox's clock, which keeps the host's time. */
        entry.survey?.seconds ?? 10,
        {
          boxKeys: [['Enter'], ['Enter'], ['Enter']],
          program: { directory, file: entry.run, folder: entry.id.toUpperCase().slice(0, 8) },
          /* The screen compared is the same each run: a program that reads
           * the time -- SkiFree does, starting -- reads the instructions run,
           * not how busy the host was. */
          virtual: true,
          keepCalls: 100_000,
          /* A program that wants a palette display names it: `vga256`. */
          display: entry.survey?.display ?? 'vga',
          /* And keys pressed after, as `record.mjs --then` presses them:
           * `"y:30"` is y, then thirty seconds. */
          steps: (entry.survey?.steps ?? []).map((step: string) => ({
            keys: step.split(':')[0].split(','),
            seconds: Number(step.split(':')[1] ?? 3),
          })),
        }
      );

      const stubs: Record<string, number> = run.stubs;
      const last = [...run.calls, ...run.tail];

      const tasks = Object.values(run.win16.scheduler._tasks ?? {}) as any[];
      const report = {
        id: entry.id,
        title: entry.title,
        calls: run.callCount,
        functions: run.functions.size,
        stubs,
        faulted: run.shots.length > 0,
        ended: tasks.length > 0 && tasks.every((task) => task.ended),
        failure: run.failure
          ? String(run.failure.message ?? run.failure)
              .split('\n')[0]
              .slice(0, 200)
          : null,
        last: last.slice(-15).map((call: any) => `${call.module}.${call.name}`),
      };

      mkdirSync(REPORTS, { recursive: true });
      writeFileSync(join(REPORTS, `${entry.id}.json`), `${JSON.stringify(report, null, 1)}\n`);

      /* Every call in order, what was asked and answered, to read beside the report. */
      const line = (call: any) =>
        `${call.module}.${call.name}(${(call.args ?? []).map(shown).join(', ')}) = ${shown(call.result)}${call.stub ? ' stub' : ''}${call.caller ? ` @${call.caller.segment.toString(16)}:${call.caller.offset.toString(16)}` : ''}`;
      const skipped = run.callCount - run.calls.length - run.tail.length;

      /* The first calls kept and the last, the rest counted between. */
      writeFileSync(
        join(REPORTS, `${entry.id}.calls.txt`),
        [
          ...run.calls.map(line),
          ...(skipped > 0 ? [`... ${skipped} calls not kept ...`] : []),
          ...run.tail.map(line),
        ].join('\n')
      );

      const screen = run.win16.rasterDesktop.screen;

      /* With steps, the screen after the main run, and after each step as
       * `<id>-2.png` on, as the recorder names Windows'. */
      const screens: Uint8Array[] = run.stepShots.length ? run.stepShots : [screen.indices];

      screens.forEach((indices: Uint8Array, at: number) =>
        writeFileSync(
          join(REPORTS, at ? `${entry.id}-${at + 1}.png` : `${entry.id}.png`),
          png(
            screen.width,
            screen.height,
            withCursor(run.win16, indices, screen.width, screen.height),
            screen.devicePalette.colours
          )
        )
      );
      /* Each box USER put up, as it was when it came up. */
      run.shots.forEach((indices: Uint8Array, at: number) =>
        writeFileSync(
          join(REPORTS, `${entry.id}.box${at + 1}.png`),
          png(screen.width, screen.height, indices, screen.devicePalette.colours)
        )
      );
      reports.push(report);
      /* A program surveyed into a game runs longer than a screen takes: its
       * entry may give itself more, in seconds. */
    }, (entry.survey?.timeout ?? 600) * 1000);
  }
});
