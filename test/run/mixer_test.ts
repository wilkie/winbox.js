import { Mixer, workletSource } from '../../src/run/engines/mixer.js';
import { Resampler } from '../../src/run/engines/sound.js';

/**
 * The page speaker's stream (`src/run/engines/mixer.ts`), and the
 * resampling that feeds it (`Resampler` in `src/run/engines/sound.ts`): one
 * unbroken output, whatever sizes the pieces come in, fading where a lane
 * starts, runs dry, is let go of or stopped, and never stepping further
 * than the sound itself does or a fade's slope.
 */

const RATE = 48000;

/** A sine of `amplitude` at `frequency`, `count` samples at `rate` from sample `from`. */
function sine(count: number, from = 0, frequency = 440, amplitude = 0.5, rate = RATE) {
  return Float32Array.from(
    { length: count },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * (from + i)) / rate)
  );
}

/** The largest step from one sample to the next. */
function largestStep(samples: ArrayLike<number>) {
  let largest = 0;

  for (let i = 1; i < samples.length; i++) {
    largest = Math.max(largest, Math.abs(samples[i] - samples[i - 1]));
  }

  return largest;
}

/** The stream rendered `frames` frames, in quanta of 128, both channels. */
function rendered(mixer: Mixer, frames: number) {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);

  for (let at = 0; at < frames; at += 128) {
    const end = Math.min(frames, at + 128);

    mixer.render(left.subarray(at, end), right.subarray(at, end));
  }

  return { left, right };
}

/* A 440 Hz sine of half the full height steps by this at most at 48,000;
 * a fade of 5 ms from half the full height by 0.5 / 240. */
const SLOPE = (0.5 * 2 * Math.PI * 440) / RATE;
const FADE_SLOPE = 0.5 / (0.005 * RATE);

describe('the page speaker stream', () => {
  test('plays pieces of odd sizes as one stream, faded in from nought', () => {
    const mixer = new Mixer(RATE, 0.01, 0.35, 0.005);
    const whole = sine(9000);
    let at = 0;

    for (const size of [1, 7, 129, 333, 1000, 2047, 17, 5466]) {
      mixer.push(1, whole.subarray(at, at + size));
      at += size;
    }

    expect(at).toBe(9000);

    const { left, right } = rendered(mixer, 9000);
    const fade = 0.005 * RATE;

    /* Faded in over the first 240 frames, then the sine as it was pushed. */
    expect(left[0]).toBe(0);
    expect([...left.subarray(fade)]).toEqual([...whole.subarray(fade)]);
    expect([...right]).toEqual([...left]);
    expect(largestStep(left)).toBeLessThanOrEqual(SLOPE);
    expect(mixer.queued(1)).toBe(0);
  });

  test('waits for the lead before playing, and plays in render quanta of any size', () => {
    const mixer = new Mixer(RATE, 0.01, 0.35, 0.005);

    mixer.push(0, sine(479));
    expect(largestStep(rendered(mixer, 256).left)).toBe(0);
    expect(mixer.queued(0)).toBe(479);

    mixer.push(0, sine(1, 479));

    const left = new Float32Array(480);

    for (const [from, to] of [
      [0, 3],
      [3, 130],
      [130, 480],
    ]) {
      const quantum = left.subarray(from, to);

      mixer.render(quantum, quantum);
    }

    expect(mixer.queued(0)).toBe(0);
    expect(left.subarray(240)).toEqual(sine(480).subarray(240));
  });

  test('lets a lane that runs dry die away, and fades it in again as it resumes', () => {
    const mixer = new Mixer(RATE, 0.01, 0.35, 0.005);
    const steady = sine(4800, 0, 440, 0.5);

    /* A sine whose last sample is near its peak, so that stopping dead
     * would step by half the full height. */
    const piece = steady.subarray(0, 1336);

    mixer.push(1, piece);

    const before = rendered(mixer, 2000).left;

    /* Its last frame held, then let die away over the fade. */
    expect(before[1335]).toBe(piece[1335]);
    expect(Math.abs(piece[1335])).toBeGreaterThan(0.45);
    expect(before[1336]).toBe(piece[1335]);
    expect(before[1336 + 240]).toBe(0);
    expect(largestStep(before)).toBeLessThanOrEqual(Math.max(SLOPE, FADE_SLOPE) + 1e-7);

    /* Resumed: waits for the lead, then fades in. */
    mixer.push(1, steady.subarray(1336));

    const after = rendered(mixer, 4000).left;

    expect(Math.abs(after[0])).toBeLessThanOrEqual(FADE_SLOPE);
    expect(after[1000]).toBe(steady[1336 + 1000]);
    expect(largestStep(after)).toBeLessThanOrEqual(SLOPE + 1e-7);
  });

  test('lets go of all but the lead where a lane holds too much, fading out and in', () => {
    const mixer = new Mixer(RATE, 0.01, 0.05, 0.005);
    const whole = sine(4800);

    mixer.push(0, whole.subarray(0, 1000));

    const first = rendered(mixer, 512).left;

    /* The machine runs ahead: more than the most queued. */
    mixer.push(0, whole.subarray(1000, 4800));
    expect(mixer.queued(0)).toBeGreaterThan(0.05 * RATE);

    const next = rendered(mixer, 1024).left;
    const joined = Float32Array.from([...first, ...next]);

    /* Faded out over 240 frames, let go of down to the lead, faded in. */
    expect(mixer.queued(0)).toBeLessThan(0.01 * RATE);
    expect(largestStep(joined)).toBeLessThanOrEqual(SLOPE + FADE_SLOPE + 1e-7);
    expect(Math.min(...next.subarray(0, 512).map(Math.abs))).toBe(0);
  });

  test('stops every lane, fading, and plays nothing more until filled again', () => {
    const mixer = new Mixer(RATE, 0.01, 0.35, 0.005);

    mixer.push(0, sine(2000, 0, 440, 0.4));
    mixer.push(1, sine(2000, 0, 330, 0.4));

    const playing = rendered(mixer, 1300).left;

    mixer.handle({ stop: true });

    const stopped = rendered(mixer, 1000).left;

    expect(mixer.queued(0)).toBe(0);
    expect(mixer.queued(1)).toBe(0);
    expect(stopped[0]).toBeCloseTo(playing[1299], 6);
    expect([...stopped.subarray(240)].every((sample) => sample === 0)).toBe(true);
    expect(largestStep([...playing, ...stopped])).toBeLessThan(2 * SLOPE + 2 * FADE_SLOPE);
  });

  test('adds the two lanes together, the left and right of each', () => {
    const mixer = new Mixer(RATE, 0.001, 0.35, 0.001);
    const fm = sine(1000, 0, 440, 0.25);
    const wave = sine(1000, 0, 330, 0.25);

    mixer.push(1, fm);
    mixer.push(0, wave, new Float32Array(1000).fill(0.125));

    const { left, right } = rendered(mixer, 1000);

    for (const at of [100, 500, 999]) {
      expect(left[at]).toBeCloseTo(fm[at] + wave[at], 6);
      expect(right[at]).toBeCloseTo(fm[at] + 0.125, 6);
    }
  });

  test('clips the sum to the full height', () => {
    const mixer = new Mixer(RATE, 0.001, 0.35, 0.001);

    mixer.push(0, new Float32Array(500).fill(0.75));
    mixer.push(1, new Float32Array(500).fill(0.75));

    expect(rendered(mixer, 400).left[300]).toBe(1);
  });

  test('stands alone as the worklet source, registering its processor', () => {
    const registered: Record<string, unknown> = {};
    const scope = {
      sampleRate: 44100,
      AudioWorkletProcessor: class {
        port = { onmessage: null as unknown };
      },
      registerProcessor: (name: string, processor: unknown) => (registered[name] = processor),
    };
    const run = new Function('globalThis', `${workletSource()}`) as (scope: unknown) => void;

    run(scope);

    const Processor = registered['winbox-speaker'] as new () => {
      port: { onmessage: (event: { data: unknown }) => void };
      process(inputs: unknown[], outputs: Float32Array[][]): boolean;
    };
    const processor = new Processor();
    const out = [new Float32Array(128), new Float32Array(128)];

    processor.port.onmessage({ data: { lane: 1, left: new Float32Array(10000).fill(0.5) } });

    for (let i = 0; i < 50; i++) {
      expect(processor.process([], [out])).toBe(true);
    }

    expect(out[0][127]).toBe(0.5);
    expect(out[1][127]).toBe(0.5);
  });
});

describe('the page speaker resampling', () => {
  test('resamples a stream in pieces of any size as it resamples it whole', () => {
    const whole = sine(44100, 0, 440, 0.5, 44100);
    const once = new Resampler(44100, 48000).run([whole])[0];
    const pieces: number[] = [];
    const resampler = new Resampler(44100, 48000);
    let at = 0;

    for (const size of [44, 45, 441, 1, 3, 440, 10000, 33126]) {
      pieces.push(...resampler.run([whole.subarray(at, at + size)])[0]);
      at += size;
    }

    expect(at).toBe(44100);
    expect(once.length).toBe(48000);
    expect(pieces).toHaveLength(48000);

    for (let i = 0; i < 48000; i++) {
      expect(Math.abs(pieces[i] - once[i])).toBeLessThan(1e-6);
    }

    /* Begun from silence, a sample in; never stepping further than the sine does. */
    expect(once[0]).toBe(0);
    expect(largestStep(once)).toBeLessThanOrEqual((0.5 * 2 * Math.PI * 440) / 48000 + 1e-6);
  });

  test('makes no sample from past the end of a piece, whatever the rates', () => {
    for (const [from, to, size] of [
      [11025, 48000, 1024],
      [11111.11, 48000, 1111],
      [44100, 48000, 441],
      [22050, 44100, 512],
      [8000, 44100, 333],
    ]) {
      const resampler = new Resampler(from, to);
      let made = 0;

      for (let piece = 0; piece < 500; piece++) {
        const [out] = resampler.run([new Float32Array(size).fill(0.5)]);

        expect(out.every((sample) => Number.isFinite(sample))).toBe(true);
        made += out.length;
      }

      expect(Math.abs(made - (500 * size * to) / from)).toBeLessThanOrEqual(1);
    }
  });

  test('resamples each channel alike, and a rate to itself a sample late', () => {
    const resampler = new Resampler(11025, 22050, 2);
    const [left, right] = resampler.run([
      Float32Array.from([1, 1, 1]),
      Float32Array.from([-1, -1, -1]),
    ]);

    expect([...left]).toEqual([0, 0.5, 1, 1, 1, 1]);
    expect([...right]).toEqual([0, -0.5, -1, -1, -1, -1]);
    expect([...new Resampler(100, 100).run([Float32Array.from([1, 2, 3])])[0]]).toEqual([0, 1, 2]);
  });
});
