import {
  type ContextLike,
  DRIFT,
  fromSigned,
  LEAD,
  resample,
  type SoundEvent,
  type SourceLike,
  Speaker,
  toChannels,
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
  /** The first channel's samples, and every channel's. */
  samples: Float32Array;
  channels: Float32Array[];
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

    const made = Array.from({ length: channels }, () => new Float32Array(length));

    return {
      rate,
      length,
      samples: made[0],
      channels: made,
      copyToChannel: (from: Float32Array, channel: number) => made[channel].set(from),
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

/** A piece of the FM chip's sound: `count` samples at 44,100, begun at `at` milliseconds. */
function fm(at: number, count: number): SoundEvent {
  const samples = new Int16Array(count);

  for (let i = 0; i < count; i++) {
    samples[i] = i % 2 ? 8192 : -8192;
  }

  return { kind: 'fm', at, rate: 44100, bytes: new Uint8Array(), samples };
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

  test('makes sixteen-bit stereo bytes each channel samples, the left first', () => {
    const bytes = new Uint8Array([0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f, 0x00, 0x80, 0x12]);
    const [left, right] = toChannels(bytes, 2, 16);

    expect([...left]).toEqual([0.5, 32767 / 32768]);
    expect([...right]).toEqual([-0.5, -1]);
  });

  test('makes eight-bit stereo and sixteen-bit mono bytes samples', () => {
    expect(toChannels(new Uint8Array([0xc0, 0x40]), 2, 8).map((each) => [...each])).toEqual([
      [0.5],
      [-0.5],
    ]);
    expect([...toChannels(new Uint8Array([0x00, 0xc0, 0x00, 0x20]), 1, 16)[0]]).toEqual([
      -0.5, 0.25,
    ]);
    /* With no channels or bits given, eight-bit mono, as `toSamples`. */
    expect([...toChannels(new Uint8Array([0, 0x80, 0xff]))[0]]).toEqual([-1, 0, 127 / 128]);
  });

  test('plays WinBox card sixteen-bit stereo as a buffer of two channels at its rate', async () => {
    const { speaker, context } = await speaking();
    const bytes = new Uint8Array(4 * 512);
    const view = new DataView(bytes.buffer);

    for (let i = 0; i < 512; i++) {
      view.setInt16(4 * i, 16384, true);
      view.setInt16(4 * i + 2, -16384, true);
    }

    speaker.play([{ kind: 'samples', at: 0, rate: 44100, channels: 2, bits: 16, bytes }]);

    const buffer = context.started[0].fake;

    expect(buffer.rate).toBe(44100);
    expect(buffer.length).toBe(512);
    expect(buffer.channels).toHaveLength(2);
    expect(buffer.channels[0][511]).toBe(0.5);
    expect(buffer.channels[1][0]).toBe(-0.5);
  });

  test('resamples each channel of a rate the browser does not take', async () => {
    const { speaker, context } = await speaking(new FakeContext([8000, 96000]));
    const bytes = new Uint8Array(800).fill(0xc0);

    speaker.play([{ kind: 'samples', at: 0, rate: 4000, channels: 2, bits: 8, bytes }]);

    const buffer = context.started[0].fake;

    expect(buffer.rate).toBe(48000);
    expect(buffer.channels.map((each) => each.length)).toEqual([4800, 4800]);
    expect(buffer.channels[1][4799]).toBe(0.5);
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

  test('makes the FM chip samples from -1 to just under 1', () => {
    expect([...fromSigned(new Int16Array([-32768, 0, 16384, 32767]))]).toEqual([
      -1,
      0,
      0.5,
      32767 / 32768,
    ]);
  });

  test('queues the FM chip beside the waveform, each piece after the last', async () => {
    const { speaker, context } = await speaking();

    context.currentTime = 1;
    speaker.play([half(4990), fm(5000, 441), fm(5010, 441)]);
    context.currentTime = 1.02;
    speaker.play([fm(5020, 441), half(5100)]);

    const fms = context.started.filter((source) => source.fake.rate === 44100);
    const halves = context.started.filter((source) => source.fake.rate !== 44100);

    /* Both play at once, the FM chip's own lane anchored by its own first. */
    expect(halves.map((source) => source.when)).toEqual([1 + LEAD, expect.closeTo(1.11 + LEAD)]);
    expect(fms.map((source) => source.when)).toEqual([
      1 + LEAD,
      expect.closeTo(1.01 + LEAD),
      expect.closeTo(1.02 + LEAD),
    ]);
    expect(fms[0].fake.length).toBe(441);
    expect(fms[0].fake.samples[1]).toBe(0.25);
  });

  test('stops the FM chip with the waveform as a run ends', async () => {
    const { speaker, context } = await speaking();

    speaker.play([half(0), fm(0, 441)]);
    speaker.stop();

    expect(context.started.map((source) => source.stopped)).toEqual([true, true]);
  });

  test('anchors the FM chip afresh when the clocks drift apart, the waveform left playing', async () => {
    const { speaker, context } = await speaking();

    speaker.play([half(0), fm(0, 441)]);
    speaker.play([fm((LEAD + DRIFT) * 1000 + 100, 441)]);

    expect(context.started.map((source) => source.stopped)).toEqual([false, true, false]);
    expect(context.started[2].when).toBe(LEAD);
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
