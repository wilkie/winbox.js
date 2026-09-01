/**
 * @jest-environment jsdom
 */
'use strict';
import { readFileSync } from 'node:fs';

const drawn = (hex: string) =>
  [...hex.replace(/[^0-9a-f]/gi, '')].some((d) => parseInt(d, 16) !== 15);

const CELL: Record<number, { cell: number; ppem: number }> = {
  10: { cell: 8, ppem: 8 },
  12: { cell: 12, ppem: 9 },
  14: { cell: 14, ppem: 11 },
  16: { cell: 16, ppem: 13 },
  18: { cell: 18, ppem: 16 },
  20: { cell: 20, ppem: 17 },
  24: { cell: 24, ppem: 22 },
};

it('brackets the limit at every size', () => {
  const fixture = JSON.parse(
    readFileSync('oracle/fixtures/fabricated/glyphs-cour-tall.json', 'utf8')
  );
  const UNITS: [string, number][] = [
    ['W', 33 * 128],
    ['g', 34 * 128],
    ['j', 35 * 128],
    ['1', 36 * 128],
    ['.', 37 * 128],
  ];
  for (const h of [10, 12, 14, 16, 18, 20, 24]) {
    const info = CELL[h];
    const line: string[] = [];
    let lastDrawn = 0;
    let firstBlank = 0;
    for (const [character, units] of UNITS) {
      const record = fixture.records.find(
        (r: any) => r.args === `"Courier New",h=${h},weight=400,italic=0,'${character}'`
      );
      if (!record) continue;
      const reach = (units * info.ppem) / 2048;
      const ok = drawn(record.result);
      line.push(`${reach.toFixed(2)}${ok ? '+' : '-'}`);
      if (ok) lastDrawn = reach;
      else if (!firstBlank) firstBlank = reach;
    }
    if (!line.length) continue;
    console.log(
      `cell ${String(info.cell).padStart(2)} ppem ${String(info.ppem).padStart(2)}: ${line.join(' ')} ` +
        `| limit in (${lastDrawn.toFixed(2)}, ${firstBlank ? firstBlank.toFixed(2) : '-'}] ` +
        `| 2xcell ${2 * info.cell}`
    );
  }
});
