'use strict';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IMAGE, PROBES, outputOf, recordsFrom, runProbe } from './run-probe.js';

/**
 * A program that faults, run whole: the `fault` probe starts one that loads a
 * selector that does not exist, and KERNEL's boxes come up. Nothing of
 * Windows' own could see them -- they are drawn on the screen and let no
 * program run -- so they were recorded as the screen itself, taken under
 * DOSBox with `record.mjs --shoot`, and answered with the keys a person would
 * press. Here the same keys are pressed, the screen is taken at the same
 * moments, and the box is compared pixel for pixel: each as the nearest of
 * the sixteen colours, as `screen-rows.mjs` wrote Windows'.
 */

const FIXTURES = join(__dirname, '..', '..', 'oracle', 'fixtures');
const SCREENS = JSON.parse(readFileSync(join(FIXTURES, 'screens', 'fault.json'), 'utf8'));
const RECORDED = JSON.parse(readFileSync(join(FIXTURES, 'fault.json'), 'utf8'));

/** The sixteen colours, and the letter each is written as: see `screen-rows.mjs`. */
const COLOURS: [string, number, number, number][] = [
  ['#', 0, 0, 0],
  ['m', 170, 0, 0],
  ['d', 0, 170, 0],
  ['y', 170, 170, 0],
  ['n', 0, 0, 170],
  ['p', 170, 0, 170],
  ['t', 0, 170, 170],
  ['s', 192, 192, 192],
  ['g', 128, 128, 128],
  ['r', 255, 0, 0],
  ['l', 0, 255, 0],
  ['Y', 255, 255, 0],
  ['b', 0, 0, 255],
  ['P', 255, 0, 255],
  ['c', 0, 255, 255],
  ['.', 255, 255, 255],
];

function letterOf([red, green, blue]: number[]) {
  let best = '#';
  let distance = Infinity;

  for (const [letter, r, g, b] of COLOURS) {
    const d = (r - red) ** 2 + (g - green) ** 2 + (b - blue) ** 2;

    if (d < distance) {
      distance = d;
      best = letter;
    }
  }

  return best;
}

/** Windows' rows, run-length encoded, spelled out. */
function expand(row: string) {
  return row.replace(/(.)(\d+)/g, (_, letter, count) => letter.repeat(Number(count)));
}

/** The box's rectangle of a screen taken here, as rows of letters, the mask blanked. */
function rowsOf(win16: any, indices: Uint8Array, mask?: number[]) {
  const [left, top, right, bottom] = SCREENS.box;
  const screen = win16.rasterDesktop.screen;
  const palette = screen.devicePalette;
  const rows: string[] = [];

  for (let y = top; y < bottom; y++) {
    let row = '';

    for (let x = left; x < right; x++) {
      const masked = mask && x >= mask[0] && x < mask[2] && y >= mask[1] && y < mask[3];

      row += masked ? '?' : letterOf(palette.colours[indices[y * screen.width + x]]);
    }

    rows.push(row);
  }

  return rows;
}

function recorded(name: string) {
  const shot = SCREENS.shots[name];
  const [left, top] = SCREENS.box;
  const mask = shot.mask;

  return shot.rows.map((row: string, y: number) =>
    [...expand(row)]
      .map((letter, x) =>
        mask && x + left >= mask[0] && x + left < mask[2] && y + top >= mask[1] && y + top < mask[3]
          ? '?'
          : letter
      )
      .join('')
  );
}

const available = existsSync(IMAGE) && existsSync(join(PROBES, 'FAULT.EXE'));

(available ? describe : describe.skip)('a program that faults', () => {
  it('shows the first box, then Application Error, and ends the program (Enter, Enter)', async () => {
    const run: any = await runProbe('fault', 4000, false, true, 20, {
      boxKeys: [['Enter'], ['Enter']],
    });

    expect(run.shots).toHaveLength(2);
    expect(rowsOf(run.win16, run.shots[0], SCREENS.shots.first.mask)).toEqual(recorded('first'));
    expect(rowsOf(run.win16, run.shots[1])).toEqual(recorded('second'));
    expect(recordsFrom((await outputOf(run.fileSystem, 'fault')) ?? '')).toEqual(
      RECORDED.records.map((record: any) => `${record.function}(${record.args}) = ${record.result}`)
    );
  }, 180000);

  it('moves to Ignore with Tab, and lets the program go on (Tab, Enter)', async () => {
    const run: any = await runProbe('fault', 4000, false, true, 20, {
      boxKeys: [['Tab', 'shoot', 'Enter']],
    });

    expect(run.shots).toHaveLength(2);
    expect(rowsOf(run.win16, run.shots[1])).toEqual(recorded('first, after Tab'));
    expect(recordsFrom((await outputOf(run.fileSystem, 'fault')) ?? '')).toEqual(
      SCREENS.runs['Tab, Enter'].map(
        (record: any) => `${record.function}(${record.args}) = ${record.result}`
      )
    );
  }, 180000);
});
