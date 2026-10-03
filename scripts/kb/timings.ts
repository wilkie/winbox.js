/**
 * How long calls take Windows, from the timing recordings in
 * `oracle/fixtures/timings/` -- `speed`, `callcost` and `wingcost` -- for
 * each function's page: the time a call took under the recorder's DOSBox,
 * and the same as the instructions Windows ran in that time, at the rate the
 * recording measured in the same run. Those recordings are not replayed;
 * they vary with the host and from run to run, and each figure here is the
 * middle of the runs recorded.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Timing {
  /** The probe that recorded it, and the display it ran on. */
  probe: string;
  display: string;
  /** How the call was made, where the probe made it more than one way. */
  variant: string | null;
  /** The calls timed with it as one, for a pair such as `GetDC` and `ReleaseDC`. */
  with: string[];
  micros: number;
  /** Instructions a millisecond, as the same recording measured them. */
  rate: number;
  instructions: number;
}

const middle = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)];
};

/** `speed`'s names, which are its own: the functions and how each was made. */
const SPEED: Record<string, [string, string | null]> = {
  'getpixel-screen': ['GetPixel', "the screen's device context"],
  'getpixel-memory': ['GetPixel', 'a memory device context'],
  'setpixel-memory': ['SetPixel', 'a memory device context'],
  peek: ['PeekMessage', '`PM_NOREMOVE`, nothing waiting'],
  tick: ['GetTickCount', null],
};

/**
 * How `callcost` and `wingcost` made a call they name without a variant, as
 * each probe's own description gives it.
 */
const MADE: Record<string, string> = {
  'callcost:PeekMessage': '`PM_REMOVE`, nothing waiting',
  'callcost:PostMessage+GetMessage': "`WM_USER` to the probe's own window, posted and taken",
  'callcost:SendMessage': "`WM_USER` to the probe's own window, answered by `DefWindowProc`",
  'callcost:SetPixel': 'in a window',
  'callcost:BitBlt': '16 by 16 within a window, `SRCCOPY`',
  'callcost:TextOut': 'eight characters in a window',
  'wingcost:SelectObject':
    'a pen into the WinG device context and the one before back: two calls, timed as one',
  'wingcost:MoveTo+LineTo': 'a line of 10 pixels in the WinG device context',
  'wingcost:Rectangle': '10 by 10 in the WinG device context',
  'wingcost:GetNearestColor': 'of the WinG device context',
  'wingcost:SaveDC+RestoreDC': 'of the WinG device context',
  'wingcost:WinGBitBlt': 'from a WinG bitmap to a window',
  'twrcost:SetRect': "of a window's size",
  'twrcost:OffsetRect': 'by 1 and 1',
  'twrcost:IntersectRect': 'of two that overlap',
  'twrcost:PtInRect': 'a point inside',
  'twrcost:GetWindowRect': 'of a window',
  'twrcost:IsIconic': 'of a window not minimized',
  'twrcost:ScreenToClient': 'of a window',
  'twrcost:SetWindowPos': 'moving, sizing and ordering nothing',
  'twrcost:LoadCursor+SetCursor': 'the arrow',
  'twrcost:DefWindowProc': '`WM_NULL`',
  'twrcost:DispatchMessage': '`WM_NULL` to a window of `DefWindowProc`',
  'twrcost:TranslateMessage': 'a `WM_MOUSEMOVE`',
  'twrcost:SelectPalette': 'the palette selected already, of 256 colours',
  'twrcost:RealizePalette': 'realized already',
  'twrcost:GetPaletteEntries': 'all 256',
  'twrcost:GetStockObject': 'the white brush',
  'twrcost:CreatePen+DeleteObject': 'a solid pen, made and deleted',
  'twrcost:CreateSolidBrush+DeleteObject': 'a solid brush, made and deleted',
  'twrcost:GlobalLock+GlobalUnlock': 'a 1 KiB block',
  'twrcost:FindResource': "the probe's own",
  'twrcost:LoadResource+FreeResource': "the probe's own, loaded already",
  'twrcost:LockResource+GlobalUnlock': "the probe's own",
};

/** A variant as the recordings name it, in words: `16x16` as 16 by 16, and so on. */
function variantText(_name: string, variant: string) {
  if (variant === 'noyield') {
    return 'and `PM_NOYIELD`';
  }

  if (/^\d+$/.test(variant)) {
    return `${variant} entries`;
  }

  return variant.replace(/(\d)x(\d)/g, '$1 by $2').replace(/-/g, ' to ');
}

/** Every timing recorded, by the function it times. */
export function readTimings(root: string): Map<string, Timing[]> {
  const directory = join(root, 'oracle', 'fixtures', 'timings');
  const found = new Map<string, Timing[]>();
  const add = (name: string, timing: Timing) => {
    found.set(name, [...(found.get(name) ?? []), timing]);
  };

  for (const file of readdirSync(directory).filter((name) => name.endsWith('.json'))) {
    const fixture = JSON.parse(readFileSync(join(directory, file), 'utf8'));
    const records: { function: string; args: string; result: string }[] = fixture.records ?? [];
    const display = fixture.source?.displayDescription ?? fixture.display;
    const probe = fixture.probe;

    if (probe === 'speed') {
      const loop = records.find((record) => record.args === 'loop');

      if (!loop) {
        continue;
      }

      const [passes, ms] = loop.result.split(',').map(Number);
      const rate = (passes * 65535) / ms;

      for (const record of records) {
        const known = SPEED[record.args];

        if (record.function !== 'speed' || !known) {
          continue;
        }

        const [count, elapsed] = record.result.split(',').map(Number);
        const micros = (elapsed * 1000) / count;

        add(known[0], {
          probe,
          display,
          variant: known[1],
          with: [],
          micros,
          rate,
          instructions: (micros * rate) / 1000,
        });
      }

      continue;
    }

    const rates = records
      .filter((record) => record.function === 'rate')
      .map((record) => Number(record.result.split(',')[0]));

    if (!rates.length) {
      continue;
    }

    const rate = middle(rates);
    const runs = new Map<string, number[]>();

    for (const record of records.filter((each) => each.function === 'cost')) {
      const name = record.args.replace(/,\d+$/, '');

      runs.set(name, [...(runs.get(name) ?? []), Number(record.result.split(',')[0])]);
    }

    for (const [name, times] of runs) {
      const [calls, variant] = name.split('/');
      const functions = calls.split('+');
      const micros = middle(times) / 1000;

      const made = MADE[`${probe}:${calls}`];

      for (const each of functions) {
        add(each, {
          probe,
          display,
          variant:
            [made, variant ? variantText(each, variant) : null].filter(Boolean).join(', ') || null,
          with: functions.filter((other) => other !== each),
          micros,
          rate,
          instructions: (micros * rate) / 1000,
        });
      }
    }
  }

  return found;
}
