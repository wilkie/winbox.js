#!/usr/bin/env node
/**
 * The Ad Lib driver's read-out, `kb/topics/adlib.md`, as a program: what
 * Windows 3.1's `MSADLIB.DRV` writes to the OPL2 for each thing it is
 * asked, write for write, held against what DOSBox's OPL was sent while
 * the probes played (`oracle/fixtures/opl/*-trace.json`).
 *
 *   node scripts/oracle/msadlib.mjs            # every probe, compared
 *
 * It is not a synthesizer and not WinBox's driver: it is the evidence that
 * the read-out says all of what the driver does. Each function names the
 * place in `MSADLIB.DRV` it follows; seg1 is the fixed code, seg2 the code
 * that loads, enables and resets, seg3 the data.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = JSON.parse(
  readFileSync(join(ROOT, 'crates', 'winbox-win16', 'data', 'adlib-patches.json'), 'utf8')
);
const FIXTURES = join(ROOT, 'oracle', 'fixtures');

/** The driver, its state as its data segment holds it. */
export function createAdlib(data = DATA, out = () => {}) {
  const PARAMETERS = [
    'ksl',
    'multiple',
    'feedback',
    'attack',
    'sustain',
    'sustaining',
    'decay',
    'release',
    'level',
    'tremolo',
    'vibrato',
    'ksr',
    'fm',
  ];
  const drumOf = new Map(data.drums.map((drum) => [drum.key, drum]));

  /* Each operator's 13 parameters and its waveform (seg3 `1cc`, 14 bytes
   * each), its volume (`1bb2`). */
  const slots = Array.from({ length: 18 }, () => ({
    ...Object.fromEntries(PARAMETERS.map((name) => [name, 0])),
    wave: 0,
  }));
  const slotVolume = new Array(18).fill(0);

  /* Each voice's frequency state (`1c0`, `2c8`, `1bc4`, `1b9a`) and its
   * allocation (`2dc`, 8 bytes each: in use, note, channel, volume, stamp). */
  const voices = Array.from({ length: 11 }, () => ({
    note: 0,
    keyOn: 0,
    half: 0,
    row: 0,
    used: 0,
    key: 0,
    channel: 0,
    volume: 0,
    stamp: 0,
  }));

  /* Each channel's program and bend (seg3 `6e`, 3 bytes each): channel 16's
   * program starts as 81h, the others 0, every bend 2000h. */
  const channels = Array.from({ length: 16 }, (_, channel) => ({
    patch: channel === 15 ? 0x81 : 0,
    bend: 0x2000,
  }));

  const chip = {
    tremoloDepth: 0, // [1bdb]
    vibratoDepth: 0, // [1bb0]
    noteSelect: 0, // [1bb1]
    percussion: 0, // [193e]
    drumBits: 0, // [193c]
    waveSelect: 0, // [1bda]
    bendRange: 0, // [1c3c], semitones times 25
  };

  /* The last bend worked out, shared by every voice (`6c`, `2d4`, `2d6`). */
  const bendCache = { steps: -1, row: 0, half: 0 };
  let counter = 0; // [2d8], a doubleword
  let enabled = false; // [34e]

  /* What the message parser keeps (seg1 `56a`). */
  const parse = { remaining: 0, index: 0, channel: 0, one: 0, two: 0, status: 0, running: 0 };

  const voiceCount = () => (chip.percussion ? 11 : 9);

  /* seg1 `6`: the address, then the value, at port 388h. */
  const write = (register, value) => out(register & 0xff, value & 0xff);

  /* seg1 `f6`. */
  const writeBD = () =>
    write(
      0xbd,
      (chip.tremoloDepth ? 0x80 : 0) |
        (chip.vibratoDepth ? 0x40 : 0) |
        (chip.percussion ? 0x20 : 0) |
        chip.drumBits
    );

  /* seg1 `128`. */
  const writeNoteSelect = () => write(0x08, chip.noteSelect ? 0x40 : 0);

  /* seg1 `13b`: the level, scaled by the operator's volume. */
  const writeLevel = (slot) => {
    const p = slots[slot];
    const scaled = Math.floor(((63 - (p.level & 63)) * slotVolume[slot] * 2 + 127) / 254);

    write(0x40 | data.slotOffsets[slot], ((p.ksl << 6) & 0xff) | ((63 - scaled) & 0xff));
  };

  /* seg1 `418`: everything of an operator, in this order. */
  const writeSlot = (slot) => {
    const p = slots[slot];
    const offset = data.slotOffsets[slot];

    writeBD();
    writeNoteSelect();
    writeLevel(slot);

    /* seg1 `4a5`: a modulator's channel's feedback and connection. */
    if (!data.carrier[slot]) {
      write(0xc0 | data.slotChannel[slot], ((p.feedback << 1) & 0xff) | (p.fm ? 0 : 1));
    }

    write(0x60 | offset, ((p.attack << 4) & 0xff) | (p.decay & 0xf));
    write(0x80 | offset, ((p.sustain << 4) & 0xff) | (p.release & 0xf));
    write(
      0x20 | offset,
      (p.tremolo ? 0x80 : 0) +
        (p.vibrato ? 0x40 : 0) +
        (p.sustaining ? 0x20 : 0) +
        (p.ksr ? 0x10 : 0) +
        (p.multiple & 0xf)
    );
    write(0xe0 | offset, chip.waveSelect ? p.wave & 3 : 0);
  };

  /* seg1 `32`: an operator's parameters from a bank record. */
  const setSlot = (slot, operator) => {
    Object.assign(slots[slot], operator, { wave: operator.wave & 3 });
    writeSlot(slot);
  };

  /* seg1 `183`: a voice's instrument. */
  const setTimbre = (voice, patch) => {
    const [first, second] = data.bank[patch].operators;

    if (chip.percussion && voice >= 6) {
      if (voice === 6) {
        setSlot(data.percussionSlots[0][0], first);
        setSlot(data.percussionSlots[0][1], second);
      } else {
        setSlot(data.percussionSlots[voice - 6][0], first);
      }

      return;
    }

    setSlot(data.voiceSlots[voice][0], first);
    setSlot(data.voiceSlots[voice][1], second);
  };

  /* seg1 `73`: a voice's F-number and block, and its key. */
  const setFrequency = (voice, note, keyOn) => {
    const v = voices[voice];

    v.keyOn = keyOn;
    v.note = note;

    let n = (note + v.half) & 0xff;

    if (n > 0x5f) {
      n = 0x5f;
    }

    const fnumber = data.fnumbers[v.row][n % 12];

    write(0xa0 | voice, fnumber & 0xff);
    write(
      0xb0 | voice,
      (((Math.floor(n / 12) << 2) & 0xff) + (keyOn >= 1 ? 0x20 : 0) + ((fnumber >> 8) & 3)) & 0xff
    );
  };

  /* seg1 `361`: a bend into a whole semitone and a row of 25ths. */
  const computeBend = (voice, bend) => {
    const product = (((bend - 0x2000) << 16) >> 16) * chip.bendRange;
    const steps = ((((product >> 8) & 0xffff) << 16) >> 16) >> 5;
    const v = voices[voice];

    if (steps === bendCache.steps) {
      v.row = bendCache.row;
      v.half = bendCache.half;
      return;
    }

    let row;

    if (steps < 0) {
      const tmp = 24 - steps;
      const half = Math.trunc(tmp / -25);
      const rest = (tmp - 24) % 25;

      v.half = half;
      bendCache.half = half;
      row = rest ? 25 - rest : 0;
    } else {
      v.half = Math.trunc(steps / 25);
      bendCache.half = v.half;
      row = steps % 25;
    }

    v.row = row;
    bendCache.row = row;
    bendCache.steps = steps;
  };

  /* seg1 `1fc`. */
  const setBend = (voice, bend) => {
    if (chip.percussion && voice > 6) {
      return;
    }

    computeBend(voice, Math.min(bend, 0x3fff));
    setFrequency(voice, voices[voice].note, voices[voice].keyOn);
  };

  /* seg1 `23c`: a voice's volume, on its carrier and, when the voice adds
   * its operators rather than modulating, its modulator. */
  const setVolume = (voice, volume) => {
    const level = Math.min(volume, 0x7f);

    if (chip.percussion && voice > 6) {
      const slot = data.percussionSlots[voice - 6][0];

      slotVolume[slot] = level;
      writeLevel(slot);
      return;
    }

    const [modulator, carrier] = data.voiceSlots[voice];

    slotVolume[carrier] = level;
    writeLevel(carrier);

    if (slots[modulator].fm === 0) {
      slotVolume[modulator] = level;
      writeLevel(modulator);
    }
  };

  /* seg1 `2b3`: the key down, an octave lower. */
  const noteOnVoice = (voice, key) => {
    const note = key < 12 ? 0 : key - 12;

    if (voice >= 6 && chip.percussion) {
      if (voice === 6) {
        setFrequency(6, note, 0);
      } else if (voice === 8) {
        setFrequency(8, note, 0);
        setFrequency(7, (note + 7) & 0xff, 0);
      }

      chip.drumBits |= data.percussionBits[voice - 6];
      writeBD();
      return;
    }

    setFrequency(voice, note, 1);
  };

  /* seg1 `325`. */
  const keyOff = (voice) => {
    if (chip.percussion && voice >= 6) {
      chip.drumBits &= ~data.percussionBits[voice - 6] & 0xff;
      writeBD();
      return;
    }

    setFrequency(voice, voices[voice].note, 0);
  };

  /* seg1 `6a3`: a melodic channel's note moved by its program's
   * transposition, unless that leaves 0-127. */
  const transpose = (channel, key) => {
    if (channel === 15 || channels[channel].patch > 0x7f) {
      return key;
    }

    const moved = data.transpose[channels[channel].patch] + key;

    return moved < 0 || moved > 0x7f ? key : moved;
  };

  /* seg1 `931`: the voice playing a channel's note. Channel 16's is the
   * voice of the drum last struck, whatever the note. */
  const find = (channel, key) => {
    if (channel === 15) {
      const voice = data.bank[channels[15].patch].voice;

      return voices[voice].used ? voice : 0xff;
    }

    for (let voice = 0; voice < voiceCount(); voice++) {
      const v = voices[voice];

      if (v.used && v.key === key && v.channel === channel) {
        v.stamp = counter++;
        return voice;
      }
    }

    return 0xff;
  };

  /* seg1 `9c4`: a voice for a note, its instrument set. */
  const allocate = (channel, key) => {
    const patch = channels[channel].patch;
    const record = data.bank[patch];

    if (record.percussive) {
      const v = voices[record.voice];

      Object.assign(v, { used: 1, key, channel, stamp: patch });
      setTimbre(record.voice, patch);
      return record.voice;
    }

    const count = chip.percussion ? 6 : 9;
    let oldest = counter;
    let chosen = null;

    for (let voice = 0; voice < count; voice++) {
      if (!voices[voice].used) {
        chosen = voice;
        break;
      }

      if (voices[voice].stamp < oldest) {
        oldest = voices[voice].stamp;
        chosen = voice;
      }
    }

    if (voices[chosen].used) {
      keyOff(chosen);
    }

    Object.assign(voices[chosen], { used: 1, key, channel, stamp: counter++ });
    setTimbre(chosen, patch);
    return chosen;
  };

  /* seg1 `7d8`. */
  const noteOff = (channel, key) => {
    let note = transpose(channel, key);

    if (channel === 15) {
      if (note < 35 || note > 81) {
        return;
      }

      const { patch, note: drumNote } = drumOf.get(note);

      note = drumNote;

      const voice = find(15, note);

      if (voice === 0xff || voices[voice].stamp !== patch) {
        return;
      }

      keyOff(voice);
      voices[voice].used = 0;
      return;
    }

    const voice = find(channel, note);

    if (voice === 0xff || voices[voice].key === 0) {
      return;
    }

    keyOff(voice);
    voices[voice].used = 0;
  };

  /* seg1 `702`. */
  const noteOn = (channel, key, velocity) => {
    if (velocity === 0) {
      noteOff(channel, key);
      return;
    }

    let note = transpose(channel, key);
    const volume = data.velocity[velocity];
    let voice;

    if (channel === 15) {
      if (note < 35 || note > 81) {
        return;
      }

      const drum = drumOf.get(note);

      channels[15].patch = drum.patch;
      note = drum.note;
      voice = find(15, note);

      if (voice !== 0xff) {
        keyOff(voice);
      }

      voice = allocate(15, note);
    } else {
      voice = find(channel, note);

      if (voice === 0xff) {
        voice = allocate(channel, note);
      } else {
        keyOff(voice);
      }
    }

    if (voices[voice].volume !== volume) {
      setVolume(voice, volume);
      voices[voice].volume = volume;
    }

    setBend(voice, channels[channel].bend);
    noteOnVoice(voice, note);
  };

  /* seg1 `65e`: every voice in use let go as its note's note-off would. */
  const allNotesOff = () => {
    for (let voice = 0; voice < voiceCount(); voice++) {
      if (voices[voice].used) {
        noteOff(voices[voice].channel, voices[voice].key);
      }
    }
  };

  /* seg1 `8ce`. */
  const programChange = (channel, patch) => {
    if (channel === 15) {
      return;
    }

    for (let voice = 0; voice < voiceCount(); voice++) {
      const v = voices[voice];

      if (v.used && v.channel === channel && v.key !== 0) {
        keyOff(voice);
        v.used = 0;
      }
    }

    channels[channel].patch = patch;
  };

  /* seg1 `861`. */
  const pitchBend = (channel, low, high) => {
    const bend = ((high << 7) | low) & 0xffff;

    for (let voice = 0; voice < voiceCount(); voice++) {
      if (voices[voice].used && voices[voice].channel === channel) {
        setBend(voice, bend);
      }
    }

    channels[channel].bend = bend;
  };

  /* seg1 `8be`: only the channel mode messages from 7Bh, all notes off,
   * and on every channel. */
  const controller = (channel, number) => {
    if (number >= 0x7b) {
      allNotesOff();
    }
  };

  const HANDLERS = [
    (c, a) => noteOff(c, a),
    (c, a, b) => noteOn(c, a, b),
    null,
    (c, a, b) => controller(c, a, b),
    (c, a) => programChange(c, a),
    null,
    (c, a, b) => pitchBend(c, a, b),
    null,
  ];

  const dispatch = () => {
    if (parse.remaining !== 0) {
      return;
    }

    const handler = HANDLERS[(parse.status & 0x70) >> 4];

    if (handler) {
      handler(parse.channel, parse.one, parse.two);
    }
  };

  /* seg1 `56a`: bytes into messages, with running status. */
  const parseBytes = (bytes) => {
    for (const byte of bytes) {
      if (byte >= 0xf8) {
        continue;
      }

      if (parse.remaining !== 0 && byte < 0x80) {
        if (parse.index === 0) {
          parse.index++;
          parse.one = byte;
        } else {
          parse.two = byte;
        }

        parse.remaining = (parse.remaining - 1) & 0xff;
        dispatch();
        continue;
      }

      parse.index = 0;

      if (byte >= 0xf0) {
        parse.status = byte;
        parse.running = 0;
        parse.remaining = (data.systemLengths[byte & 7] - 1) & 0xff;
        parse.channel = parse.status & 0xf;
        dispatch();
        continue;
      }

      if (byte >= 0x80) {
        parse.running = byte;
      } else if (!parse.running) {
        continue;
      }

      parse.status = parse.running;
      parse.remaining = (data.lengths[(parse.running & 0x70) >> 4] - 1) & 0xff;

      if (byte >= 0x80) {
        parse.channel = parse.status & 0xf;
        dispatch();
        continue;
      }

      parse.index++;
      parse.one = byte;
      parse.remaining = (parse.remaining - 1) & 0xff;
      dispatch();
    }
  };

  /* seg2 `11b`: the chip and the driver's state put back. */
  const reset = () => {
    chip.tremoloDepth = 0;
    chip.vibratoDepth = 0;
    chip.noteSelect = 0;
    writeBD();
    writeNoteSelect();
    slotVolume.fill(0x7f);

    for (const v of voices) {
      v.row = 0;
      v.half = 0;
    }

    for (let channel = 0; channel <= 8; channel++) {
      write(0xa0 | channel, 0);
      write(0xb0 | channel, 0);
    }

    /* seg2 `1cc`: percussion mode, the tom and snare tuned. */
    setFrequency(8, 0x18, 0);
    setFrequency(7, 0x1f, 0);
    chip.percussion = 1;
    chip.drumBits = 0;
    /* seg2 `2de`: two semitones of bend. */
    chip.bendRange = 2 * 25;

    /* seg2 `21a`: every waveform plain, then waveforms allowed. */
    for (let slot = 0; slot < 18; slot++) {
      write(0xe0 | data.slotOffsets[slot], 0);
    }

    chip.waveSelect = 0x20;
    write(0x01, 0x20);
  };

  return {
    /* seg2 `55e`, DRV_ENABLE: the card looked for (its timers, `15a`) the
     * first time, the chip reset. Status reads are not modelled: the
     * driver writes 04h, 04h, reads, writes 02h and 04h, reads, writes
     * 04h, 04h. */
    enable() {
      if (!enabled) {
        write(0x04, 0x60);
        write(0x04, 0x80);
        write(0x02, 0xff);
        write(0x04, 0x21);
        write(0x04, 0x60);
        write(0x04, 0x80);
      }

      reset();
      enabled = true;
    },
    /* seg2 `59e`, DRV_DISABLE, as Windows ends: the chip reset. */
    disable() {
      if (enabled) {
        reset();
      }
    },
    /* seg1 `ba5`, MODM_OPEN. */
    open() {
      reset();
      parse.remaining = 0;
      parse.running = 0;
    },
    /* seg1 `c36`, MODM_CLOSE; seg1 `d57`, MODM_RESET. */
    close: allNotesOff,
    reset: allNotesOff,
    /* seg1 `c65`, MODM_DATA. */
    short(message) {
      const status = message & 0xff;
      let count;

      parse.remaining = 0;

      if (status & 0x80) {
        count = data.lengths[(status & 0x70) >> 4];
      } else if (!parse.running) {
        return;
      } else {
        count = data.lengths[(parse.running & 0x70) >> 4] - 1;
      }

      parseBytes([status, (message >> 8) & 0xff, (message >> 16) & 0xff].slice(0, count));
    },
    /* seg1 `cf8`, MODM_LONGDATA. */
    long(bytes) {
      parseBytes(bytes);
    },
  };
}

/* The probes' long messages, as they send them (`oracle/probes/adlibout.c`). */
const LONG = {
  chord: [0x90, 60, 100, 64, 100, 67, 100],
  unchord: [0x80, 60, 0, 64, 0, 67, 0],
  exclusive: [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7, 0x90, 72, 90],
  unexclusive: [0x80, 72, 0],
};

/**
 * What a probe asked of the driver, in order, from its records: opening
 * (`open`), each message (`at`), and closing (`close`); through the mapper
 * the channels its setup sends to the Ad Lib, 13 to 16.
 */
function stepsOf(probe) {
  if (probe === 'adlibseq') {
    return sequencerSteps();
  }

  const { records } = JSON.parse(readFileSync(join(FIXTURES, `${probe}.json`), 'utf8'));
  const mapper = probe === 'adlibmap';
  const steps = [];

  for (const { function: name, args } of records) {
    if (name === 'open') {
      steps.push({ open: true });
    } else if (name === 'close') {
      /* The mapper resets each device before it closes it. */
      if (mapper) {
        steps.push({ reset: true });
      }

      steps.push({ close: true });
    } else if (name === 'at') {
      const [, what, hex] = args.split(',');

      if (what === 'reset') {
        steps.push({ reset: true });
      } else if (LONG[what]) {
        steps.push({ long: LONG[what] });
      } else {
        const message = parseInt(hex, 16);

        if (!mapper || (message & 0xf) >= 12) {
          steps.push({ short: message });
        }
      }
    }
  }

  return steps;
}

/**
 * What MCI's sequencer is inferred to have sent the Ad Lib, through the
 * mapper, for `adlibseq` -- not read out of `MCISEQ.DRV`: each `play` opens
 * the device and closes it when it ends; the whole song, then the song to
 * 1,000 milliseconds (192 ticks), which plays the first event at the end
 * tick and then lets each note still sounding go, by channel and key.
 */
function sequencerSteps() {
  const source = readFileSync(join(ROOT, 'oracle', 'probes', 'adlibseq.c'), 'latin1');
  const song = source.slice(source.indexOf('SONG['), source.indexOf('};', source.indexOf('SONG[')));
  const bytes = [...song.matchAll(/0x([0-9a-f]{2})/g)].map((match) => parseInt(match[1], 16));
  const events = [];
  let at = 22;
  let tick = 0;

  const number = () => {
    let value = 0;
    let byte;

    do {
      byte = bytes[at++];
      value = (value << 7) | (byte & 0x7f);
    } while (byte & 0x80);

    return value;
  };

  while (at < bytes.length) {
    tick += number();

    if (bytes[at] === 0xff) {
      at += 2;

      const length = number();

      at += length;
      continue;
    }

    const length = (bytes[at] & 0xf0) === 0xc0 ? 2 : 3;

    events.push({ tick, message: bytes.slice(at, at + length) });
    at += length;
  }

  const steps = [];
  const play = (end) => {
    const sounding = new Set();
    let atEnd = 0;

    steps.push({ open: true });

    for (const { tick: when, message } of events) {
      if (when > end || (when === end && atEnd++)) {
        break;
      }

      const [status, key, velocity = 0] = message;
      const note = (status & 0xf) * 128 + key;

      if ((status & 0xf0) === 0x90 && velocity) {
        sounding.add(note);
      } else if ((status & 0xf0) === 0x80 || (status & 0xf0) === 0x90) {
        sounding.delete(note);
      }

      steps.push({ short: status | (key << 8) | (velocity << 16) });
    }

    for (const note of [...sounding].sort((a, b) => a - b)) {
      steps.push({ short: 0x80 | (note >> 7) | ((note & 0x7f) << 8) });
    }

    steps.push({ close: true });
  };

  play(Infinity);
  play(192);

  return steps;
}

/** The writes the driver made, from the trace: `[register, value]`. */
function tracedWrites(probe) {
  const { trace } = JSON.parse(readFileSync(join(FIXTURES, 'opl', `${probe}-trace.json`), 'utf8'));
  const writes = [];
  let register = 0;

  for (const { op, port, value } of trace) {
    if (op === 'w' && (port & 1) === 0) {
      register = value;
    } else if (op === 'w') {
      writes.push([register, value]);
    }
  }

  return writes;
}

/** The model's writes for a probe: enabled at boot, then its steps. */
export function predict(probe) {
  const writes = [];
  const adlib = createAdlib(DATA, (register, value) => writes.push([register, value]));

  adlib.enable();

  for (const step of stepsOf(probe)) {
    if (step.open) {
      adlib.open();
    } else if (step.close) {
      adlib.close();
    } else if (step.reset) {
      adlib.reset();
    } else if (step.long) {
      adlib.long(step.long);
    } else {
      adlib.short(step.short);
    }
  }

  /* Windows ending disables the driver. */
  adlib.disable();

  return writes;
}

if (process.argv[1]?.endsWith('msadlib.mjs')) {
  const hex = ([register, value]) =>
    `${register.toString(16).padStart(2, '0')}=${value.toString(16).padStart(2, '0')}`;

  for (const probe of ['adlibout', 'adlibmap', 'adlibseq']) {
    const traced = tracedWrites(probe);
    const predicted = predict(probe);
    let same = 0;

    while (
      same < traced.length &&
      same < predicted.length &&
      hex(traced[same]) === hex(predicted[same])
    ) {
      same++;
    }

    console.log(
      `${probe}: ${same} of ${traced.length} traced writes predicted in order` +
        (predicted.length !== traced.length ? ` (the model made ${predicted.length})` : '')
    );

    if (same < Math.max(traced.length, predicted.length)) {
      console.log(
        `  traced:    ${traced
          .slice(Math.max(0, same - 4), same + 8)
          .map(hex)
          .join(' ')}`
      );
      console.log(
        `  predicted: ${predicted
          .slice(Math.max(0, same - 4), same + 8)
          .map(hex)
          .join(' ')}`
      );
      process.exitCode = 1;
    }
  }
}
