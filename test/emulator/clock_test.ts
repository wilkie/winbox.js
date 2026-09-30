'use strict';

import { CALL_INSTRUCTIONS, Clock, INSTRUCTIONS_PER_MS } from '../../src/emulator/clock.js';

describe('Clock', () => {
  describe('virtual', () => {
    let instructions: number;
    let clock: Clock;

    beforeEach(() => {
      instructions = 0;
      clock = new Clock({
        virtual: true,
        epoch: new Date(1992, 3, 6, 9, 0, 0).getTime(),
        instructions: () => instructions,
      });
    });

    it('counts the instructions run as time', () => {
      expect(clock.now()).toEqual(0);

      instructions = INSTRUCTIONS_PER_MS * 250;

      expect(clock.now()).toEqual(250);
    });

    it('counts a call as instructions', () => {
      for (let calls = 0; calls < INSTRUCTIONS_PER_MS; calls++) {
        clock.charge(CALL_INSTRUCTIONS);
      }

      expect(clock.now()).toEqual(CALL_INSTRUCTIONS);
    });

    it('gives the date from the epoch', () => {
      instructions = INSTRUCTIONS_PER_MS * 61000;

      const date = clock.date();

      expect([date.getHours(), date.getMinutes(), date.getSeconds()]).toEqual([9, 1, 1]);
    });

    it('calls what is due only as its time is passed', () => {
      const called: string[] = [];

      clock.after(10, () => called.push('ten'));
      clock.after(5, () => called.push('five'));

      clock.tick();
      expect(called).toEqual([]);

      instructions = INSTRUCTIONS_PER_MS * 20;
      clock.tick();
      expect(called).toEqual(['five', 'ten']);
    });

    it('forgets what is cancelled', () => {
      const called: string[] = [];
      const handle = clock.after(10, () => called.push('ten'));

      clock.cancel(handle);
      instructions = INSTRUCTIONS_PER_MS * 20;
      clock.tick();

      expect(called).toEqual([]);
    });

    it('goes straight to the next time when idle', () => {
      const called: number[] = [];

      clock.after(1000, () => called.push(clock.now()));

      expect(clock.idle()).toBe(true);
      expect(called).toEqual([1000]);
      expect(clock.idle()).toBe(false);
    });

    it('moves on when told time passed', () => {
      clock.advance(40);

      expect(clock.now()).toEqual(40);
    });
  });

  describe('real', () => {
    it('does not move for instructions, calls or idling', () => {
      let instructions = 0;
      const clock = new Clock({ instructions: () => instructions });

      instructions = INSTRUCTIONS_PER_MS * 100000;
      clock.charge(CALL_INSTRUCTIONS * 1000);
      clock.advance(100000);

      expect(clock.idle()).toBe(false);
      expect(clock.now()).toBeLessThan(10000);
    });
  });
});
