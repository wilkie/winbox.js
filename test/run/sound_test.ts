import { Mixer, type MixerMessage } from '../../src/run/engines/mixer.js';
import {
  type ContextLike,
  DRIFT,
  FADE,
  fromSigned,
  LEAD,
  type NodeLike,
  Resampler,
  type SoundEvent,
  Speaker,
  toChannels,
  toSamples,
} from '../../src/run/engines/sound.js';

/**
 * The page's speaker (`src/run/engines/sound.ts`) against a context that
 * stands in for Web Audio's: each lane's pieces resampled to the context's
 * rate as one stream and posted to the speaker's own stream (`mixer.ts`),
 * here a `Mixer` on this thread, as the page's fallback has it; a gap the
 * card left kept, the joins between the FM chip's pieces left alone.
 */

class FakeContext implements ContextLike {
  sampleRate: number;
  state = 'suspended';
  destination = {} as AudioNode;

  constructor(rate = 48000) {
    this.sampleRate = rate;
  }

  async resume() {
    this.state = 'running';
  }
}

/** The speaker's stream stood in for: each message kept, and acted on by a mixer. */
class FakeStream implements NodeLike {
  readonly messages: MixerMessage[] = [];
  readonly mixer: Mixer;
  connected: AudioNode | null = null;

  constructor(rate: number) {
    this.mixer = new Mixer(rate, LEAD, LEAD + DRIFT, FADE);
  }

  readonly port = {
    postMessage: (message: MixerMessage) => {
      this.messages.push(message);
      this.mixer.handle(message);
    },
  };

  connect(destination: AudioNode) {
    this.connected = destination;
  }

  /** The frames posted for a lane, its left channel's, end to end. */
  frames(lane: number) {
    return this.messages.flatMap((message) =>
      'lane' in message && message.lane === lane ? [...message.left] : []
    );
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

/** A piece of the FM chip's sound: `count` samples at 44,100, begun at `at` milliseconds, from sample `from` of a sine. */
function fm(at: number, count: number, from = 0, frequency = 440): SoundEvent {
  const samples = new Int16Array(count);

  for (let i = 0; i < count; i++) {
    samples[i] = Math.round(16384 * Math.sin((2 * Math.PI * frequency * (from + i)) / 44100));
  }

  return { kind: 'fm', at, rate: 44100, bytes: new Uint8Array(), samples };
}

/**
 * The FM chip's pieces as the machine hands them over: ten milliseconds
 * each, 44 or 45 samples a millisecond as DOSBox's mixer makes them,
 * `seconds` long, of a sine at `frequency`, from `at` milliseconds.
 */
function fmPieces(seconds: number, at = 0, frequency = 440) {
  const add = Math.floor((44100 << 14) / 1000);
  const pieces: SoundEvent[] = [];
  let remain = 0;
  let from = 0;

  for (let ms = 0; ms < seconds * 1000; ms += 10) {
    let count = 0;

    for (let tick = 0; tick < 10; tick++) {
      remain += add;
      count += remain >> 14;
      remain &= 16383;
    }

    pieces.push(fm(at + ms, count, from, frequency));
    from += count;
  }

  return pieces;
}

/** The largest step from one sample to the next. */
function largestStep(samples: ArrayLike<number>) {
  let largest = 0;

  for (let i = 1; i < samples.length; i++) {
    largest = Math.max(largest, Math.abs(samples[i] - samples[i - 1]));
  }

  return largest;
}

/** The largest difference between two runs of samples, sample by sample. */
function largestDifference(a: ArrayLike<number>, b: ArrayLike<number>) {
  let largest = 0;

  for (let i = 0; i < a.length; i++) {
    largest = Math.max(largest, Math.abs(a[i] - b[i]));
  }

  return largest;
}

async function speaking(context = new FakeContext()) {
  let stream: FakeStream | null = null;
  const speaker = new Speaker(
    () => context,
    async (made) => (stream = new FakeStream(made.sampleRate))
  );

  expect(await speaker.wake()).toBe(true);
  return { speaker, context, stream: stream! };
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

  test('makes the FM chip samples from -1 to just under 1', () => {
    expect([...fromSigned(new Int16Array([-32768, 0, 16384, 32767]))]).toEqual([
      -1,
      0,
      0.5,
      32767 / 32768,
    ]);
  });

  test('lets the sound go until the page has been used', () => {
    const context = new FakeContext();
    let made = 0;
    const speaker = new Speaker(
      () => context,
      async (each) => (made++, new FakeStream(each.sampleRate))
    );
    const freed: number[] = [];

    speaker.play([{ ...half(0), free: () => freed.push(0) }]);

    expect(speaker.context).toBeNull();
    expect(made).toBe(0);
    expect(freed).toEqual([0]);
  });

  test('makes the context and its stream on the first click, and resumes it', async () => {
    const { speaker, context, stream } = await speaking();

    expect(speaker.context).toBe(context);
    expect(context.state).toBe('running');
    expect(stream.connected).toBe(context.destination);

    /* A second click makes nothing more. */
    expect(await speaker.wake()).toBe(true);
  });

  test('sounds nothing where there is no stream to play through', async () => {
    const context = new FakeContext();
    const speaker = new Speaker(
      () => context,
      async () => null
    );

    expect(await speaker.wake()).toBe(false);
    speaker.play([half(0)]);
  });

  test('posts WinBox card sixteen-bit stereo as two channels at the context rate', async () => {
    const { speaker, stream } = await speaking(new FakeContext(44100));
    const bytes = new Uint8Array(4 * 512);
    const view = new DataView(bytes.buffer);

    for (let i = 0; i < 512; i++) {
      view.setInt16(4 * i, 16384, true);
      view.setInt16(4 * i + 2, -16384, true);
    }

    speaker.play([{ kind: 'samples', at: 0, rate: 44100, channels: 2, bits: 16, bytes }]);

    const [message] = stream.messages as Extract<MixerMessage, { lane: number }>[];

    expect(message).toMatchObject({ lane: 0, rate: 44100, channels: 2 });
    /* Begun from silence: a sample late. */
    expect(message.left).toHaveLength(512);
    expect(message.left[0]).toBe(0);
    expect(message.left[511]).toBe(0.5);
    expect(message.right![511]).toBe(-0.5);
  });

  test('resamples the card rate to the context rate, half after half, as one stream', async () => {
    const { speaker, stream } = await speaking();

    speaker.play([half(0, 1111), half(100, 1111), half(200, 1111)]);

    const frames = stream.frames(0);
    const whole = new Resampler(11111.11, 48000).run(
      toChannels(Uint8Array.from({ length: 3333 }, (_, i) => ((i % 1111) % 2 ? 0xc0 : 0x40)))
    )[0];

    expect(frames).toHaveLength(whole.length);
    expect(largestDifference(frames, whole)).toBeLessThan(1e-6);
    expect(stream.messages.every((message) => 'rate' in message && message.rate === 11111.11)).toBe(
      true
    );
  });

  test('keeps a gap the card left, as silence', async () => {
    const { speaker, stream } = await speaking();

    /* 100 samples at 11,111 are nine milliseconds: the second follows at
     * once, the third 42 milliseconds after it ends. */
    speaker.play([half(1000, 100), half(1009, 100), half(1060, 100)]);

    const frames = stream.frames(0);
    const silence = Math.round(0.042 * 11111.11) * (48000 / 11111.11);

    expect(stream.messages).toHaveLength(4);
    expect(frames.length).toBeCloseTo((300 * 48000) / 11111.11 + silence, -1);
    expect(frames.slice(900, 900 + 150).every((frame) => frame === 0)).toBe(true);
  });

  test('begins a lane afresh after a gap of the lead or more', async () => {
    const { speaker, stream } = await speaking();

    speaker.play([half(0, 1111)]);
    speaker.play([half(100 + LEAD * 1000, 1111)]);

    const [first, second] = stream.messages as Extract<MixerMessage, { lane: number }>[];

    /* No silence between them, the second begun from silence as the first was. */
    expect(stream.messages).toHaveLength(2);
    expect(first.left[0]).toBe(0);
    expect(second.left[0]).toBe(0);
  });

  test('joins the FM chip pieces end to end, whether 44 or 45 samples a millisecond', async () => {
    const { speaker, stream } = await speaking();
    const pieces = fmPieces(5);

    expect(pieces.some((piece) => piece.samples!.length === 440)).toBe(true);
    speaker.play(pieces);

    const frames = stream.frames(1);
    const all = new Int16Array(pieces.reduce((sum, piece) => sum + piece.samples!.length, 0));
    let at = 0;

    for (const piece of pieces) {
      all.set(piece.samples!, at);
      at += piece.samples!.length;
    }

    const whole = new Resampler(44100, 48000).run([fromSigned(all)])[0];

    expect(frames).toHaveLength(whole.length);
    expect(largestDifference(frames, whole)).toBeLessThan(1e-6);
    expect(largestStep(frames)).toBeLessThanOrEqual((0.5 * 2 * Math.PI * 440) / 48000 + 1e-4);
  });

  test('plays the FM chip pieces as the page hands them over, without a click', async () => {
    const { speaker, stream } = await speaking();
    const pieces = fmPieces(2, 1000, 440);
    const out = new Float32Array(48000 * 2);

    /* As the page plays them: a frame's worth at a time, the stream rendering between. */
    for (let ms = 0, rendered = 0; ms < 2000; ms += 20) {
      speaker.play(pieces.filter((piece) => piece.at >= 1000 + ms && piece.at < 1020 + ms));

      for (const end = Math.min(out.length, ((ms + 20) * 48000) / 1000); rendered < end;) {
        const quantum = out.subarray(rendered, Math.min(end, rendered + 128));

        stream.mixer.render(quantum, new Float32Array(quantum.length));
        rendered += quantum.length;
      }
    }

    const steady = out.subarray(48000 * 0.2, 48000 * 1.9);

    expect(steady.reduce((most, sample) => Math.max(most, sample), 0)).toBeGreaterThan(0.45);
    expect(largestStep(steady)).toBeLessThanOrEqual((0.5 * 2 * Math.PI * 440) / 48000 + 1e-4);
  });

  test('stops what is queued as a run ends, and begins afresh after', async () => {
    const { speaker, stream } = await speaking();

    speaker.play([half(0), half(100)]);
    speaker.stop();

    expect(stream.messages.at(-1)).toEqual({ stop: true });
    expect(stream.mixer.queued(0)).toBe(0);

    speaker.play([half(30000)]);

    const last = stream.messages.at(-1) as Extract<MixerMessage, { lane: number }>;

    expect(last.left[0]).toBe(0);
  });

  test('plays no MIDI, and a silence stops nothing of the waveform', async () => {
    const { speaker, stream } = await speaking();
    const freed: string[] = [];

    speaker.play([half(0)]);
    speaker.play([
      { kind: 'midi', at: 10, rate: 0, bytes: new Uint8Array([0x90, 60, 64]) },
      { kind: 'silence', at: 20, rate: 0, bytes: new Uint8Array(), free: () => freed.push('s') },
    ]);

    expect(stream.messages).toHaveLength(1);
    expect(stream.mixer.queued(0)).toBeGreaterThan(0);
    expect(freed).toEqual(['s']);
  });
});
