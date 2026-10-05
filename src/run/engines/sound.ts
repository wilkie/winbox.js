/**
 * The host's speakers on a page: what the Rust engine's sound card plays
 * (`take_sound`), sounded through Web Audio, as winbox-native sounds it
 * through cpal (`crates/winbox-native/src/speaker.rs`).
 *
 * The card's samples are unsigned bytes, one channel, at the card's own rate
 * -- 11,111 a second for a program's 11,025 -- handed over half its buffer at
 * a time, once the card has played them, each with the machine's time it
 * began at (`at`, in milliseconds). Each becomes a buffer at its own rate,
 * which the browser resamples as it plays; a rate the browser will not make a
 * buffer at is resampled here, linearly, to the context's own, as the native
 * speaker resamples everything.
 *
 * The machine runs on the page's clock (`performance.now`), the context on
 * the audio device's. Each buffer is started by its `at`, against an anchor:
 * the first sound after a quiet spell is started a little ahead of the
 * context's time (`LEAD`), and what follows it at the same distance from it in
 * the context's time as in the machine's, so a gap the card left -- a program
 * resetting it part way through a half -- is kept. Where the next would start
 * already past, the queue has run dry: the machine fell behind, or the page
 * was away, and it is anchored afresh. Where it would start too far ahead
 * (`DRIFT` past the lead), the two clocks have drifted apart, and what is
 * queued is stopped and the anchor made afresh, so the speaker never lags the
 * machine by more than that. The native speaker plays what is queued as the
 * device asks for it, silence when nothing is: it is as late as its queue is
 * long, the half of the card's buffer it waits for and the device's own; here
 * that is the half and the lead.
 *
 * MIDI is not played, as natively: there is no synthesizer here to play it on
 * yet. A `silence` stops the synthesizer's voices (`audio.rs`), not the card's
 * waveform, so it stops nothing here either; a synthesizer, when there is one,
 * would take both.
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
  readonly bytes: Uint8Array;
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

export class Speaker {
  readonly #make: () => ContextLike;
  #context: ContextLike | null = null;

  /** The machine's time, in seconds, and the context's that it was anchored to; none after a quiet spell. */
  #anchor: { machine: number; context: number } | null = null;

  /** The buffers started and not yet ended, to be stopped together. */
  #queued = new Set<SourceLike>();

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

  /** What the card did, sounded: its samples queued, the rest let go; each event freed. */
  play(events: Iterable<SoundEvent>) {
    for (const event of events) {
      try {
        if (event.kind === 'samples') {
          this.#samples(event.at / 1000, event.rate, event.bytes);
        }
      } finally {
        event.free?.();
      }
    }
  }

  /** Everything queued stopped and the anchor let go, as a run ends or another starts. */
  stop() {
    for (const source of this.#queued) {
      try {
        source.stop();
      } catch {
        /* One not yet started, in some browsers, or ended already. */
      }
    }

    this.#queued.clear();
    this.#anchor = null;
  }

  #samples(at: number, rate: number, bytes: Uint8Array) {
    const context = this.#context;

    if (!context || context.state !== 'running') {
      /* Nothing heard until the page has been used: the anchor is made
       * afresh when it has. */
      this.#anchor = null;
      return;
    }

    if (!bytes.length || !(rate > 0)) {
      return;
    }

    const now = context.currentTime;
    let start = this.#anchor
      ? this.#anchor.context + (at - this.#anchor.machine)
      : Number.NEGATIVE_INFINITY;

    if (start > now + LEAD + DRIFT) {
      /* The speaker is behind the machine by more than it should be. */
      this.stop();
      start = Number.NEGATIVE_INFINITY;
    }

    if (start < now) {
      /* The queue ran dry, or this is the first: anchored afresh. */
      this.#anchor = { machine: at, context: now + LEAD };
      start = now + LEAD;
    }

    const buffer = this.#buffer(context, toSamples(bytes), rate);
    const source = context.createBufferSource();

    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => this.#queued.delete(source);
    this.#queued.add(source);
    source.start(start);
  }

  /** The samples as a buffer at their own rate, or at the context's where the browser will not make one at theirs. */
  #buffer(context: ContextLike, samples: Float32Array<ArrayBuffer>, rate: number) {
    let buffer: AudioBuffer | null = null;

    /* Browsers take 8,000 to 96,000 a second at the least, Chromium's and
     * Firefox's from 3,000, whole or not; the card plays from 4,000. */
    try {
      buffer = context.createBuffer(1, samples.length, rate);
    } catch {
      /* A rate this browser does not take: resampled below. */
    }

    if (!buffer) {
      samples = resample(samples, rate, context.sampleRate);
      buffer = context.createBuffer(1, samples.length, context.sampleRate);
    }

    buffer.copyToChannel(samples, 0);
    return buffer;
  }
}
