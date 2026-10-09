/**
 * The host's speakers on a page: what the Rust engine's sound card plays
 * (`take_sound`), sounded through Web Audio, as winbox-native sounds it
 * through cpal (`crates/winbox-native/src/speaker.rs`).
 *
 * The card plays two things at once, each a lane of its own:
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
 * Both are played as one unbroken stream, as the native speaker plays
 * them. Each lane's pieces are resampled to the context's rate, linearly,
 * one piece carried on from the last (`Resampler`), and posted to a stream
 * of the speaker's own (`mixer.ts`): an `AudioWorkletNode`, or a
 * `ScriptProcessorNode` where the browser has no worklets, which queues
 * each lane, adds the two together and plays them a frame after another.
 *
 * Each piece was once a buffer of its own, started at its time. Joined end
 * to end, pieces at 44,100 played in a context at 48,000 are each
 * resampled on their own by Chromium, which, rendered offline, stepped at
 * some 180 of the joins a second by up to the whole height of the sound
 * (a sine of half the full height stepping by 0.49, where it never steps
 * by more than 0.029): static, under the notes. Firefox, and either at
 * 44,100, did not.
 *
 * Each piece comes with the machine's time it began at (`at`, in
 * milliseconds). A lane keeps a gap the machine left between one piece and
 * the next, a program resetting the card part way through a half, as
 * silence, where it is longer than `GAP` and shorter than the lead; a
 * longer one the lane runs dry in. The stream lets a lane that ran dry fill to `LEAD` before playing
 * it, and where the machine runs ahead of the speakers, a lane holding more
 * than `DRIFT` past the lead is let go of down to the lead; it fades rather
 * than stopping or starting dead. The native speaker plays what is queued
 * as the device asks for it, silence when nothing is: it is as late as its
 * queue is long, the half of the card's buffer it waits for and the
 * device's own; here that is the half and the lead.
 *
 * MIDI to the card's port is not played: there is nothing here to play it
 * on. What the synthesizer is sent is heard through the FM chip, so a
 * `silence` of the synthesizer's (`audio.rs`) stops nothing here: the chip
 * itself is let go, as the driver lets it go.
 *
 * Browsers start a context suspended until the page has been used (their
 * autoplay policy), so the context is made, or resumed, on a click or a key
 * (`wake`); until it is made, and its stream with it, what the card plays
 * is let go.
 */

import { Mixer, type MixerMessage, PROCESSOR, workletSource } from './mixer.js';

/** How much a lane holds before it plays after running dry, in seconds. */
export const LEAD = 0.1;

/** How much past the lead a lane may hold before the machine is taken to have run ahead, in seconds. */
export const DRIFT = 0.25;

/** How long a lane takes to fade in or out, in seconds. */
export const FADE = 0.005;

/**
 * The least gap between one piece and the next kept as silence, in
 * seconds: the FM chip's pieces are whole milliseconds of 44 or 45 samples
 * each, and laid end to end they are one stream, though a piece's samples
 * at 44,100 may end a sample short of, or past, the next's millisecond.
 */
export const GAP = 0.002;

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

/** As much of an audio node that takes the speaker's messages as is used here. */
export interface NodeLike {
  readonly port: { postMessage(message: MixerMessage, transfer?: Transferable[]): void };
  connect(destination: AudioNode): unknown;
}

/** As much of an `AudioContext` as is used here, so that a test may stand in for it. */
export interface ContextLike {
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: AudioNode;
  readonly audioWorklet?: { addModule(url: string): Promise<void> };
  resume(): Promise<void>;
  createScriptProcessor?(size: number, inputs: number, outputs: number): ScriptProcessorNode;
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

/**
 * Samples at one rate made samples at another, each between the two
 * around it, carried on from one piece to the next as one stream: each
 * piece's first samples made between the last piece's last sample and its
 * own first, as `Resampler` in the native speaker makes them. A stream
 * begins from silence.
 */
export class Resampler {
  /** The rate in over the rate out: how far apart the samples out are, in the samples in. */
  readonly step: number;

  /** The last sample in of each channel, and how far past it the next out is, in the samples in. */
  #previous: number[];
  #phase = 0;

  constructor(from: number, to: number, channels = 1) {
    this.step = from / to;
    this.#previous = new Array<number>(Math.max(1, channels)).fill(0);
  }

  /** A piece's channels, each the same length, resampled. */
  run(channels: Float32Array[]) {
    const length = channels[0]?.length ?? 0;
    const step = this.step;
    const phase = this.#phase;
    let count = Math.max(0, Math.ceil((length - phase) / step));

    /* Each sample out lies at `phase + i * step` in the samples in, counted
     * from the last piece's last: before this piece's last, which is at
     * `length`. Rounding may count one too many or too few. */
    while (count > 0 && phase + (count - 1) * step >= length) {
      count--;
    }

    while (phase + count * step < length) {
      count++;
    }

    const out = channels.map(() => new Float32Array(count));

    for (let i = 0; i < count; i++) {
      const at = phase + i * step;
      const whole = Math.floor(at);
      const part = at - whole;

      for (let channel = 0; channel < channels.length; channel++) {
        const samples = channels[channel];
        const from = whole === 0 ? this.#previous[channel] : samples[whole - 1];

        out[channel][i] = from * (1 - part) + samples[whole] * part;
      }
    }

    this.#phase = phase + count * step - length;

    if (length) {
      this.#previous = channels.map((samples) => samples[length - 1]);
    }

    return out;
  }
}

/** A lane's place between one piece and the next: its resampler, and when its next piece is due, in the machine's seconds. */
interface Lane {
  readonly index: number;
  resampler: Resampler | null;
  rate: number;
  channels: number;
  next: number | null;
}

/** The stream on the page's own thread, where the browser has no worklets: a script processor rendering it. */
function scriptStream(context: ContextLike): NodeLike | null {
  const processor = context.createScriptProcessor?.(2048, 0, 2);

  if (!processor) {
    return null;
  }

  const mixer = new Mixer(context.sampleRate, LEAD, LEAD + DRIFT, FADE);

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    const out = event.outputBuffer;

    mixer.render(out.getChannelData(0), out.getChannelData(out.numberOfChannels > 1 ? 1 : 0));
  };

  return {
    port: { postMessage: (message: MixerMessage) => mixer.handle(message) },
    connect: (destination: AudioNode) => processor.connect(destination),
  };
}

/** The stream as a worklet, in the context's audio thread. */
async function workletStream(context: ContextLike): Promise<NodeLike | null> {
  if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') {
    return null;
  }

  const url = URL.createObjectURL(new Blob([workletSource()], { type: 'text/javascript' }));

  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  return new AudioWorkletNode(context as unknown as BaseAudioContext, PROCESSOR, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { lead: LEAD, most: LEAD + DRIFT, fade: FADE },
  });
}

/** The stream a context plays the speaker's lanes through: a worklet, or else a script processor. */
async function stream(context: ContextLike): Promise<NodeLike | null> {
  try {
    const worklet = await workletStream(context);

    if (worklet) {
      return worklet;
    }
  } catch (error) {
    console.warn('No sound worklet:', error);
  }

  return scriptStream(context);
}

export class Speaker {
  readonly #make: () => ContextLike;
  readonly #stream: (context: ContextLike) => Promise<NodeLike | null>;
  #context: ContextLike | null = null;
  #ready: Promise<boolean> | null = null;

  /** Where the lanes are posted, once the stream is made. */
  #node: NodeLike | null = null;

  /** The waveform's lane and the FM chip's. */
  readonly #lanes: { samples: Lane; fm: Lane } = {
    samples: { index: 0, resampler: null, rate: 0, channels: 0, next: null },
    fm: { index: 1, resampler: null, rate: 0, channels: 0, next: null },
  };

  constructor(make: () => ContextLike, made = stream) {
    this.#make = make;
    this.#stream = made;
  }

  /** The context, where it has been made. */
  get context() {
    return this.#context;
  }

  /**
   * The context made, or resumed, as the page is used: called on a click or
   * a key, which a browser lets sound begin on. Whether there is a stream
   * to play through, once there is one.
   */
  wake(): Promise<boolean> {
    try {
      if (!this.#context) {
        const context = this.#make();

        this.#context = context;
        this.#ready = this.#stream(context).then(
          (node) => {
            node?.connect(context.destination);
            this.#node = node;
            return !!node;
          },
          (error) => {
            console.warn('No sound:', error);
            return false;
          }
        );
      }

      if (this.#context.state === 'suspended') {
        this.#context.resume().catch(() => {});
      }
    } catch (error) {
      /* A browser without Web Audio sounds nothing. */
      console.warn('No sound:', error);
    }

    return this.#ready ?? Promise.resolve(false);
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

  /** Everything queued let go, fading, and each lane begun afresh, as a run ends or another starts. */
  stop() {
    for (const lane of Object.values(this.#lanes)) {
      lane.resampler = null;
      lane.next = null;
    }

    this.#node?.port.postMessage({ stop: true });
  }

  #queue(lane: Lane, at: number, rate: number, channels: Float32Array[]) {
    const node = this.#node;
    const context = this.#context;

    if (!node || !context) {
      /* Nothing heard until the page has been used. */
      lane.resampler = null;
      lane.next = null;
      return;
    }

    if (!channels.length || !channels[0].length || !(rate > 0)) {
      return;
    }

    const gap = lane.next === null ? Infinity : at - lane.next;

    if (gap >= LEAD || rate !== lane.rate || channels.length !== lane.channels) {
      /* After a quiet spell, or a sound of another kind: begun afresh, from silence. */
      lane.resampler = new Resampler(rate, context.sampleRate, channels.length);
      lane.rate = rate;
      lane.channels = channels.length;
    } else if (gap > GAP && lane.resampler) {
      /* A gap the machine left: kept, as silence. */
      const silence = new Float32Array(Math.round(gap * rate));

      this.#post(
        node,
        lane,
        lane.resampler.run(channels.map(() => silence)),
        rate,
        channels.length
      );
    }

    lane.next = at + channels[0].length / rate;
    this.#post(node, lane, lane.resampler!.run(channels), rate, channels.length);
  }

  #post(node: NodeLike, lane: Lane, frames: Float32Array[], rate: number, channels: number) {
    if (!frames[0]?.length) {
      return;
    }

    const [left, right] = frames;
    const message: MixerMessage = { lane: lane.index, left, right, rate, channels };

    node.port.postMessage(
      message,
      right
        ? [left.buffer as ArrayBuffer, right.buffer as ArrayBuffer]
        : [left.buffer as ArrayBuffer]
    );
  }
}
