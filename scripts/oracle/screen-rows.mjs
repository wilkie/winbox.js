#!/usr/bin/env node
/**
 * A screen taken by `record.mjs --shoot` made into records a test can read:
 * a rectangle of it, a row at a time, each pixel as the letter for the
 * nearest of the sixteen colours a VGA shows, runs of one letter as the
 * letter and its count. DOSBox shows the colours the VGA's own way -- navy
 * as 0,0,170 -- so the nearest is taken rather than an exact match.
 *
 *   node scripts/oracle/screen-rows.mjs <fixture> <name> <png> <left> <top> <right> <bottom> [mask l,t,r,b]
 *
 * adds `name` to `oracle/fixtures/screens/<fixture>.json`: `{ box, shots: { name: {rows, mask} } }`.
 * A mask is a rectangle not compared: the mouse cursor, which is drawn on the
 * screen and not into it.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The sixteen colours as a VGA shows them, and the letter each is written as. */
export const COLOURS = [
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

function nearest(red, green, blue) {
  let best = COLOURS[0][0];
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

function main() {
  const [fixture, name, png, ...numbers] = process.argv.slice(2);
  const [left, top, right, bottom] = numbers.slice(0, 4).map(Number);
  const mask = numbers[4] ? numbers[4].split(',').map(Number) : null;
  const raw = execFileSync('convert', [png, '-depth', '8', 'rgb:-'], { maxBuffer: 1 << 24 });
  const width = 640;
  const rows = [];

  for (let y = top; y < bottom; y++) {
    let row = '';
    let last = '';
    let count = 0;

    for (let x = left; x < right; x++) {
      const at = (y * width + x) * 3;
      const letter = nearest(raw[at], raw[at + 1], raw[at + 2]);

      if (letter === last) {
        count++;
      } else {
        if (count) {
          row += `${last}${count}`;
        }

        last = letter;
        count = 1;
      }
    }

    rows.push(`${row}${last}${count}`);
  }

  const path = join(ROOT, 'oracle', 'fixtures', 'screens', `${fixture}.json`);
  mkdirSync(dirname(path), { recursive: true });
  const data = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { box: [left, top, right, bottom], shots: {} };

  data.shots[name] = { rows, ...(mask ? { mask } : {}) };
  writeFileSync(path, `${JSON.stringify(data, null, 1)}\n`);
  console.log(`${name}: ${rows.length} rows -> ${fixture}.json`);
}

main();
