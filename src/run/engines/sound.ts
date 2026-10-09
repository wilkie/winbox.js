/**
 * The host's speakers on a page: what the Rust engine's sound card plays
 * (`take_sound`), sounded through Web Audio, as winbox-native sounds it
 * through cpal (`crates/winbox-native/src/speaker.rs`).
 *
 * The card plays two things at once, each queued in a lane of its own and
 * mixed by the context as it plays them together:
 *
 * - Its waveform: eight-bit samples, unsigned, or sixteen-bit, signed and
 *   least significant byte first; one channel, or two, the left's sample
 *   then the right's; at the card's own rate -- the program's own on
 *   WinBox's card, 11,111 a second for a program's 11,025 on the Sound
 *   Blaster's -- handed over half its buffer at a time, once the card has
 *   played them.
 * - Its FM chip's sound (`crates/winbox-win16/src/fm.rs`): signed 16-bit
 *   samples, one channel, at 44,100 a second, handed over a few
 *   milliseconds at a time as the machine makes them, one piece straight
 *   after another while the chip sounds, and nothing while it is quiet.
 *
 * Each piece comes with the machine's time it began at (`at`, in
 * milliseconds), and becomes a buffer of its own channels at its own rate,
 * which the browser resamples, and spreads to the speakers, as it plays; a
 * rate the browser will not make a buffer at is resampled here, linearly,
 * to the context's own, as the native speaker resamples everything.
 *
 * The machine runs on the page's clock (`performance.now`), the context on
 * the audio device's. Each buffer is started by its `at`, against its lane's
 * anchor: the first sound after a quiet spell is started a little ahead of
 * the context's time (`LEAD`), and what follows it at the same distance from
 * it in the context's time as in the machine's, so a gap the card left -- a
 * program resetting it part way through a half -- is kept, and the FM chip's
 * pieces join end to end. Where the next would start already past, the lane
 * has run dry: the machine fell behind, or the page was away, and it is
 * anchored afresh. Where it would start too far ahead (`DRIFT` past the
 * lead), the two clocks have drifted apart, and what the lane has queued is
 * stopped and the anchor made afresh, so the speaker never lags the machine
 * by more than that. The native speaker plays what is queued as the device
 * asks for it, silence when nothing is: it is as late as its queue is long,
 * the half of the card's buffer it waits for and the device's own; here
 * that is the half and the lead.
 *
 * MIDI to the card's port is not played: there is nothing here to play it
 * on. What the synthesizer is sent is heard through the FM chip, so a
 * `silence` of the synthesizer's (`audio.rs`) stops nothing here: the chip
 * itself is let go, as the driver lets it go.
 *
 * Browsers start a context suspended until the page has been used (their
 * autoplay policy), so the context is made, or resumed, on a click or a key
 * (`wake`); until it runs, what the card plays is let go.
 */

/** How far ahead of the context's time a sound after a quiet spell starts, in seconds. */
export const LEAD = 0.1;

/** How far past the lead a sound may be due before the clocks are taken to have drifted, in seconds. */
export const DRIFT = 0.25;

/** What the card did, as the module hands it over (`SoundEvent` in `crates/winbox-web/src/lib.rs`). */
export interface SoundEvent {
  readonly kind: string;
  readonly at: number;
  readonly rate: number;
  /** The waveform's channels, one where not given. */
  readonly channels?: number;
  /** The waveform's bits a sample, eight where not given. */
  readonly bits?: number;
  readonly bytes: Uint8Array;
  /** The FM chip's samples, for kind `fm`. */
  readonly samples?: Int16Array;
  free?(): void;
}

/** As much of a buffer's source as is used here. */
export interface SourceLike {
  buffer: AudioBuffer | null;
  onended: ((event: Event) => void) | null;
  connect(destination: AudioNode): unknown;
  start(when: number): void;
  stop(): void;
}

/** As much of an `AudioContext` as is used here, so that a test may stand in for it. */
export interface ContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: AudioNode;
  resume(): Promise<void>;
  createBuffer(channels: number, length: number, rate: number): AudioBuffer;
  createBufferSource(): SourceLike;
}

/** The card's bytes as the samples a buffer holds, from -1 to just under 1. */
export function toSamples(bytes: Uint8Array) {
  const samples = new Float32Array(bytes.length);

  for (let i = 0; i < bytes.length; i++) {
    samples[i] = (bytes[i] - 128) / 128;
  }

  return samples;
}

/**
 * The card's waveform bytes as each channel's samples, from -1 to just
 * under 1: eight-bit samples unsigned, sixteen-bit signed and least
 * significant byte first, a sample of each channel in turn. A sample of
 * fewer than every channel left at the end is let go.
 */
export function toChannels(bytes: Uint8Array, channels = 1, bits = 8) {
  const size = bits === 16 ? 2 : 1;
  const count = Math.max(1, channels);
  const length = Math.floor(bytes.length / (size * count));
  const out = Array.from({ length: count }, () => new Float32Array(length));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < count; channel++) {
      const at = (i * count + channel) * size;

      out[channel][i] = size === 2 ? view.getInt16(at, true) / 32768 : (bytes[at] - 128) / 128;
    }
  }

  return out;
}

/** The FM chip's 16-bit samples as the samples a buffer holds, from -1 to just under 1. */
export function fromSigned(samples: Int16Array) {
  const out = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] / 32768;
  }

  return out;
}

/** Samples at `from` a second made samples at `to`, each between the two around it. */
export function resample(samples: Float32Array, from: number, to: number) {
  const length = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Float32Array(length);
  const step = from / to;
  const last = samples.length - 1;

  for (let i = 0; i < length; i++) {
    const at = Math.min(i * step, last);
    const whole = Math.floor(at);
    const part = at - whole;
    const next = Math.min(whole + 1, last);

    out[i] = samples[whole] * (1 - part) + samples[next] * part;
  }

  return out;
}

/** What the card plays in one stream: its anchor and the buffers it has started. */
class Lane {
  /** The machine's time, in seconds, and the context's that it was anchored to; none after a quiet spell. */
  anchor: { machine: number; context: number } | null = null;

  /** The buffers started and not yet ended, to be stopped together. */
  readonly queued = new Set<SourceLike>();

  /** Everything queued stopped and the anchor let go. */
  stop() {
    for (const source of this.queued) {
      try {
        source.stop();
      } catch {
        /* One not yet started, in some browsers, or ended already. */
      }
    }

    this.queued.clear();
    this.anchor = null;
  }
}

export class Speaker {
  readonly #make: () => ContextLike;
  #context: ContextLike | null = null;

  /** The waveform's lane and the FM chip's. */
  readonly #lanes = { samples: new Lane(), fm: new Lane() };

  constructor(make: () => ContextLike) {
    this.#make = make;
  }

  /** The context, where it has been made. */
  get context() {
    return this.#context;
  }

  /**
   * The context made, or resumed, as the page is used: called on a click or
   * a key, which a browser lets sound begin on.
   */
  wake() {
    try {
      this.#context ??= this.#make();

      if (this.#context.state === 'suspended') {
        this.#context.resume().catch(() => {});
      }
    } catch (error) {
      /* A browser without Web Audio sounds nothing. */
      console.warn('No sound:', error);
    }
  }

  /** What the card did, sounded: its waveform and FM chip queued, the rest let go; each event freed. */
  play(events: Iterable<SoundEvent>) {
    for (const event of events) {
      try {
        if (event.kind === 'samples') {
          this.#queue(
            this.#lanes.samples,
            event.at / 1000,
            event.rate,
            toChannels(event.bytes, event.channels ?? 1, event.bits ?? 8)
          );
        } else if (event.kind === 'fm' && event.samples) {
          this.#queue(this.#lanes.fm, event.at / 1000, event.rate, [fromSigned(event.samples)]);
        }
      } finally {
        event.free?.();
      }
    }
  }

  /** Everything queued stopped and the anchors let go, as a run ends or another starts. */
  stop() {
    this.#lanes.samples.stop();
    this.#lanes.fm.stop();
  }

  #queue(lane: Lane, at: number, rate: number, channels: Float32Array<ArrayBuffer>[]) {
    const context = this.#context;

    if (!context || context.state !== 'running') {
      /* Nothing heard until the page has been used: the anchor is made
       * afresh when it has. */
      lane.anchor = null;
      return;
    }

    if (!channels.length || !channels[0].length || !(rate > 0)) {
      return;
    }

    const now = context.currentTime;
    let start = lane.anchor
      ? lane.anchor.context + (at - lane.anchor.machine)
      : Number.NEGATIVE_INFINITY;

    if (start > now + LEAD + DRIFT) {
      /* The speaker is behind the machine by more than it should be. */
      lane.stop();
      start = Number.NEGATIVE_INFINITY;
    }

    if (start < now) {
      /* The lane ran dry, or this is the first: anchored afresh. */
      lane.anchor = { machine: at, context: now + LEAD };
      start = now + LEAD;
    }

    const buffer = this.#buffer(context, channels, rate);
    const source = context.createBufferSource();

    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => lane.queued.delete(source);
    lane.queued.add(source);
    source.start(start);
  }

  /**
   * Each channel's samples as a buffer of as many channels at their own
   * rate, or at the context's where the browser will not make one at theirs.
   */
  #buffer(context: ContextLike, channels: Float32Array<ArrayBuffer>[], rate: number) {
    let buffer: AudioBuffer | null = null;

    /* Browsers take 8,000 to 96,000 a second at the least, Chromium's and
     * Firefox's from 3,000, whole or not; the card plays from 4,000. */
    try {
      buffer = context.createBuffer(channels.length, channels[0].length, rate);
    } catch {
      /* A rate this browser does not take: resampled below. */
    }

    if (!buffer) {
      channels = channels.map((samples) => resample(samples, rate, context.sampleRate));
      buffer = context.createBuffer(channels.length, channels[0].length, context.sampleRate);
    }

    const made = buffer;

    channels.forEach((samples, channel) => made.copyToChannel(samples, channel));
    return made;
  }
}
