'use strict';

import { tickCount } from '../../src/win16/user/GetTickCount.js';

/**
 * `GetTickCount` steps by the timer's tick, as `tickstep` recorded Windows':
 * 55 milliseconds at a time, and 54 every thirteenth or fourteenth.
 */
describe('GetTickCount', () => {
  it('steps by whole ticks, 54 or 55 milliseconds', function () {
    const answers = new Set<number>();

    for (let ms = 0; ms < 2000; ms++) {
      answers.add(tickCount(ms));
    }

    const sorted = [...answers].sort((a, b) => a - b);
    const steps = sorted.slice(1).map((value, at) => value - sorted[at]);

    expect(new Set(steps)).toEqual(new Set([54, 55]));
    expect(steps.filter((step) => step === 54).length).toBeGreaterThanOrEqual(2);
    expect(sorted.length).toEqual(37);
  });

  it('answers 54 short once every 13 or 14 steps', function () {
    const steps: number[] = [];

    for (let tick = 1; tick < 200; tick++) {
      const at = Math.ceil((tick * 65536 * 1000) / 1193180);

      steps.push(tickCount(at) - tickCount(at - 1));
    }

    const shorts = steps.map((step, at) => (step === 54 ? at : -1)).filter((at) => at >= 0);
    const gaps = shorts.slice(1).map((value, at) => value - shorts[at]);

    expect(new Set(gaps)).toEqual(new Set([13, 14]));
  });
});
