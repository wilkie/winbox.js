/**
 * The page's speaker's own stream (`sound.ts`): what the card plays, each
 * lane's samples already at the context's rate, queued and mixed into one
 * unbroken output, a render quantum at a time, on the audio thread (an
 * `AudioWorkletProcessor`), or on the page's where the browser has no
 * worklets (a `ScriptProcessorNode`).
 *
 * Each lane -- the waveform's, the FM chip's -- is a ring of frames, left
 * and right. A lane that has run dry waits until it holds `lead` seconds
 * before it plays again, so that the next few pieces have time to come; it
 * then plays from the ring frame by frame, its gain brought up from nought
 * over `fade` seconds. Where it runs dry while playing, it does not stop
 * dead: its last frame is let die away over `fade` seconds. Where it holds
 * more than `most` seconds, the machine has run ahead of the speakers, and
 * the lane is faded out, what it holds let go down to `lead`, and faded in
 * again; and `stop` fades every lane out and lets everything go. Nothing
 * here steps from one frame to the next by more than the sound does, or by
 * a fade's slope.
 *
 * The class is written to stand alone, referring to nothing outside
 * itself, as its source is the worklet's (`workletSource`).
 */

/** What the page posts to the stream: frames for a lane, or a stop. */
export type MixerMessage =
  | {
      /** The lane: 0 the waveform, 1 the FM chip. */
      readonly lane: number;
      /** Its frames at the context's rate, the right the same as the left where not given. */
      readonly left: Float32Array;
      readonly right?: Float32Array;
      /** The rate and channels the card made them at, before resampling, for whoever watches. */
      readonly rate?: number;
      readonly channels?: number;
    }
  | { readonly stop: true };

export class Mixer {
  readonly lead: number;
  readonly most: number;
  readonly fade: number;
  readonly lanes: {
    left: Float32Array;
    right: Float32Array;
    /** Where the oldest frame is, and how many there are. */
    read: number;
    size: number;
    playing: boolean;
    /** The gain now, from 0 to 1; whether the lane is being faded out to let go of what it holds. */
    gain: number;
    skipping: boolean;
    /** The last frame played; the frame dying away, and how many frames of it are left. */
    lastLeft: number;
    lastRight: number;
    tailLeft: number;
    tailRight: number;
    tail: number;
  }[];

  /**
   * A stream at `rate` frames a second, of `lanes` lanes, `lead`, `most`
   * and `fade` in seconds.
   */
  constructor(rate: number, lead = 0.1, most = 0.35, fade = 0.005, lanes = 2) {
    this.lead = Math.max(1, Math.round(lead * rate));
    this.most = Math.max(this.lead + 1, Math.round(most * rate));
    this.fade = Math.max(1, Math.round(fade * rate));

    const capacity = 2 * this.most + 4096;

    this.lanes = Array.from({ length: lanes }, () => ({
      left: new Float32Array(capacity),
      right: new Float32Array(capacity),
      read: 0,
      size: 0,
      playing: false,
      gain: 0,
      skipping: false,
      lastLeft: 0,
      lastRight: 0,
      tailLeft: 0,
      tailRight: 0,
      tail: 0,
    }));
  }

  /** A message from the page, acted on. */
  handle(message: MixerMessage) {
    if ('stop' in message) {
      this.stop();
    } else {
      this.push(message.lane, message.left, message.right);
    }
  }

  /** How many frames a lane holds. */
  queued(lane: number) {
    return this.lanes[lane]?.size ?? 0;
  }

  /**
   * Frames queued on a lane, after what it holds. Where its ring is full,
   * the oldest are let go: only where the speakers have stopped asking.
   */
  push(index: number, left: Float32Array, right = left) {
    const lane = this.lanes[index];

    if (!lane) {
      return;
    }

    const capacity = lane.left.length;
    let from = 0;

    if (left.length > capacity) {
      from = left.length - capacity;
    }

    const count = left.length - from;
    const over = lane.size + count - capacity;

    if (over > 0) {
      lane.read = (lane.read + over) % capacity;
      lane.size -= over;
    }

    let write = (lane.read + lane.size) % capacity;

    for (let i = from; i < left.length; i++) {
      lane.left[write] = left[i];
      lane.right[write] = right[i] ?? left[i];
      write = write + 1 === capacity ? 0 : write + 1;
    }

    lane.size += count;
  }

  /** Every lane faded out from where it is, and what each holds let go. */
  stop() {
    for (const lane of this.lanes) {
      if (lane.playing) {
        this.#dieAway(lane);
      }

      lane.playing = false;
      lane.skipping = false;
      lane.size = 0;
      lane.gain = 0;
    }
  }

  /** A lane's last frame let die away, from where it is, over the fade. */
  #dieAway(lane: Mixer['lanes'][number]) {
    lane.tailLeft = lane.lastLeft;
    lane.tailRight = lane.lastRight;
    lane.tail = this.fade;
    lane.lastLeft = 0;
    lane.lastRight = 0;
  }

  /** The next frames of the stream, every lane added together, written over `left` and `right`. */
  render(left: Float32Array, right: Float32Array) {
    const frames = left.length;

    left.fill(0);

    if (right !== left) {
      right.fill(0);
    }

    const step = 1 / this.fade;

    for (const lane of this.lanes) {
      const capacity = lane.left.length;

      for (let i = 0; i < frames; i++) {
        if (!lane.playing && lane.size >= this.lead) {
          lane.playing = true;
          lane.gain = 0;
        }

        if (lane.playing && lane.size > 0) {
          if (!lane.skipping && lane.size > this.most) {
            lane.skipping = true;
          }

          lane.gain = lane.skipping ? Math.max(0, lane.gain - step) : Math.min(1, lane.gain + step);

          const l = lane.left[lane.read] * lane.gain;
          const r = lane.right[lane.read] * lane.gain;

          lane.read = lane.read + 1 === capacity ? 0 : lane.read + 1;
          lane.size--;
          lane.lastLeft = l;
          lane.lastRight = r;
          left[i] += l;

          if (right !== left) {
            right[i] += r;
          }

          if (lane.skipping && lane.gain === 0) {
            /* Faded out: let go of all but the lead, and fade in again. */
            const drop = Math.max(0, lane.size - this.lead);

            lane.read = (lane.read + drop) % capacity;
            lane.size -= drop;
            lane.skipping = false;
          }
        } else if (lane.playing) {
          /* Run dry. */
          lane.playing = false;
          this.#dieAway(lane);
        }

        if (lane.tail > 0) {
          const part = lane.tail / this.fade;

          left[i] += lane.tailLeft * part;

          if (right !== left) {
            right[i] += lane.tailRight * part;
          }

          lane.tail--;
        }
      }
    }

    for (let i = 0; i < frames; i++) {
      left[i] = Math.max(-1, Math.min(1, left[i]));

      if (right !== left) {
        right[i] = Math.max(-1, Math.min(1, right[i]));
      }
    }
  }
}

/** The name the worklet's processor is registered by. */
export const PROCESSOR = 'winbox-speaker';

/** As much of an `AudioWorkletGlobalScope` as the processor uses. */
interface WorkletScope {
  readonly sampleRate: number;
  readonly AudioWorkletProcessor: new (options?: unknown) => { readonly port: MessagePort };
  registerProcessor(name: string, processor: unknown): void;
}

/** The stream's own times, in seconds, as the page makes its node (`processorOptions`). */
export interface MixerOptions {
  readonly lead?: number;
  readonly most?: number;
  readonly fade?: number;
}

/**
 * The processor registered in the worklet's scope: a stream (`Mixer`) at
 * the context's rate, fed by the page's messages, rendering a quantum at a
 * time into an output of two channels. Its source is the worklet's, so it
 * too refers to nothing outside itself but what it is given.
 */
function install(MixerClass: typeof Mixer, name: string) {
  const scope = globalThis as unknown as WorkletScope;

  class Processor extends scope.AudioWorkletProcessor {
    readonly mixer: Mixer;

    constructor(options?: { processorOptions?: MixerOptions }) {
      super(options);

      const { lead, most, fade } = options?.processorOptions ?? {};

      this.mixer = new MixerClass(scope.sampleRate, lead, most, fade);
      this.port.onmessage = (event: MessageEvent<MixerMessage>) => this.mixer.handle(event.data);
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
      const [output] = outputs;

      if (output?.length) {
        this.mixer.render(output[0], output[1] ?? output[0]);
      }

      return true;
    }
  }

  scope.registerProcessor(name, Processor);
}

/** The worklet's module, as source: the stream and its processor, standing alone. */
export function workletSource() {
  return `(${install.toString()})(${Mixer.toString()}, ${JSON.stringify(PROCESSOR)});\n`;
}
