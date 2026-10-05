import {
  type ContextLike,
  DRIFT,
  LEAD,
  resample,
  type SoundEvent,
  type SourceLike,
  Speaker,
  toSamples,
} from '../../src/run/engines/sound.js';

/**
 * The page's speaker (`src/run/engines/sound.ts`) against a context that
 * stands in for Web Audio's: the card's halves started by the machine's time
 * they began at, anchored a little ahead of the context's time after a quiet
 * spell, anchored afresh where the queue runs dry or the clocks drift apart.
 */

interface FakeBuffer {
  rate: number;
  length: number;
  samples: Float32Array;
}

class FakeSource implements SourceLike {
  buffer: AudioBuffer | null = null;
  onended: ((event: Event) => void) | null = null;
  when: number | null = null;
  stopped = false;

  constructor(private readonly started: FakeSource[]) {}

  connect() {}

  start(when: number) {
    this.when = when;
    this.started.push(this);
  }

  stop() {
    this.stopped = true;
  }

  get fake() {
    return this.buffer as unknown as FakeBuffer;
  }
}

class FakeContext implements ContextLike {
  currentTime = 0;
  sampleRate = 48000;
  state = 'suspended';
  destination = {} as AudioNode;
  started: FakeSource[] = [];

  /** The rates this browser makes buffers at. */
  constructor(private readonly rates = [3000, 768000]) {}

  async resume() {
    this.state = 'running';
  }

  createBuffer(channels: number, length: number, rate: number) {
    if (rate < this.rates[0] || rate > this.rates[1]) {
      throw new DOMException('rate', 'NotSupportedError');
    }

    const samples = new Float32Array(length);

    return {
      rate,
      length,
      samples,
      copyToChannel: (from: Float32Array) => samples.set(from),
    } as unknown as AudioBuffer;
  }

  createBufferSource() {
    return new FakeSource(this.started);
  }
}

/** A half of the card's buffer: `count` samples at `rate`, begun at `at` milliseconds. */
function half(at: number, count = 1111, rate = 11111.11): SoundEvent {
  const bytes = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    bytes[i] = i % 2 ? 0xc0 : 0x40;
  }

  return { kind: 'samples', at, rate, bytes };
}

async function speaking(context = new FakeContext()) {
  const speaker = new Speaker(() => context);

  speaker.wake();
  await Promise.resolve();
  return { speaker, context };
}

describe('the page speaker', () => {
  test('makes the card bytes samples from -1 to just under 1', () => {
    expect([...toSamples(new Uint8Array([0, 0x80, 0xff]))]).toEqual([-1, 0, 127 / 128]);
  });

  test('resamples linearly', () => {
    expect([...resample(new Float32Array([0, 1]), 1, 2)]).toEqual([0, 0.5, 1, 1]);
  });

  test('lets the sound go until the page has been used', () => {
    const context = new FakeContext();
    const speaker = new Speaker(() => context);
    const freed: number[] = [];

    speaker.play([{ ...half(0), free: () => freed.push(0) }]);

    expect(speaker.context).toBeNull();
    expect(context.started).toEqual([]);
    expect(freed).toEqual([0]);
  });

  test('makes the context on the first click, and resumes it', async () => {
    const { speaker, context } = await speaking();

    expect(speaker.context).toBe(context);
    expect(context.state).toBe('running');
  });

  test('starts the first half a lead ahead, and the next by the machine time', async () => {
    const { speaker, context } = await speaking();

    context.currentTime = 2;
    speaker.play([half(5000)]);
    context.currentTime = 2.05;
    speaker.play([half(5100)]);

    expect(context.started[0].when).toBeCloseTo(2 + LEAD);
    expect(context.started[1].when).toBeCloseTo(2.1 + LEAD);
    expect(context.started[0].fake.rate).toBeCloseTo(11111.11);
    expect(context.started[0].fake.length).toBe(1111);
    expect(context.started[0].fake.samples[0]).toBe(-0.5);
    expect(context.started[0].fake.samples[1]).toBe(0.5);
  });

  test('keeps a gap the card left', async () => {
    const { speaker, context } = await speaking();

    speaker.play([half(1000, 100), half(1009, 100), half(1060, 100)]);

    const when = context.started.map((source) => source.when!);

    expect(when[1] - when[0]).toBeCloseTo(0.009);
    expect(when[2] - when[0]).toBeCloseTo(0.06);
  });

  test('anchors afresh when the queue runs dry', async () => {
    const { speaker, context } = await speaking();

    speaker.play([half(0)]);
    context.currentTime = 1;
    speaker.play([half(200)]);

    expect(context.started.map((source) => source.when)).toEqual([LEAD, 1 + LEAD]);
  });

  test('stops what is queued and anchors afresh when the clocks drift apart', async () => {
    const { speaker, context } = await speaking();

    speaker.play([half(0)]);
    speaker.play([half((LEAD + DRIFT) * 1000 + 100)]);

    expect(context.started[0].stopped).toBe(true);
    expect(context.started[1].when).toBe(LEAD);
  });

  test('stops what is queued as a run ends, and anchors afresh after', async () => {
    const { speaker, context } = await speaking();

    speaker.play([half(0), half(100)]);
    context.started[0].onended?.(new Event('ended'));
    speaker.stop();

    expect(context.started.map((source) => source.stopped)).toEqual([false, true]);

    context.currentTime = 0.05;
    speaker.play([half(30000)]);
    expect(context.started[2].when).toBeCloseTo(0.05 + LEAD);
  });

  test('resamples a rate the browser does not take to its own', async () => {
    const { speaker, context } = await speaking(new FakeContext([8000, 96000]));

    speaker.play([half(0, 400, 4000)]);

    expect(context.started[0].fake.rate).toBe(48000);
    expect(context.started[0].fake.length).toBe(4800);
  });

  test('plays no MIDI, and a silence stops nothing of the waveform', async () => {
    const { speaker, context } = await speaking();
    const freed: string[] = [];

    speaker.play([half(0)]);
    speaker.play([
      { kind: 'midi', at: 10, rate: 0, bytes: new Uint8Array([0x90, 60, 64]) },
      { kind: 'silence', at: 20, rate: 0, bytes: new Uint8Array(), free: () => freed.push('s') },
    ]);

    expect(context.started).toHaveLength(1);
    expect(context.started[0].stopped).toBe(false);
    expect(freed).toEqual(['s']);
  });
});
