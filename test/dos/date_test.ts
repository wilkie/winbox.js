'use strict';

import { getDate } from '../../src/dos/syscall/getDate.js';

/** INT 21h function 2Ah gives the whole year and a month counted from 1. */
describe('getDate', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives the year, the month from 1, the day and the weekday', () => {
    expect(getDate()).toEqual([2026, 9, 25, 5]);
  });
});
