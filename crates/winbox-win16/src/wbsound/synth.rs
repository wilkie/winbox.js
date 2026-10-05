//! The synthesizer's sound: what WinBox's MIDI synthesizer writes to the
//! card's FM chip, an OPL2, for each message it is sent. It writes what
//! Windows 3.1's Ad Lib driver, `MSADLIB.DRV`, writes, register for
//! register and in the same order, repeats and bugs and all: **read out**
//! of the driver in `kb/topics/adlib.md`, whose places (seg1 its fixed
//! code, seg2 the code that loads, enables and resets it, seg3 its data)
//! the functions here cite, and **recorded** as DOSBox's OPL was sent them
//! by `adlibout`, `adlibmap` and `adlibseq` (`oracle/fixtures/opl`).
//! `scripts/oracle/msadlib.mjs` is the same read-out as a program, held to
//! those recordings write for write.
//!
//! The driver's instruments and tables -- its bank of 180 records, the drum
//! keys, each program's transposition, the velocity table, the operator
//! tables and the F-numbers -- are in `data/adlib-patches.json`, extracted
//! from the driver by `scripts/oracle/adlib-patches.mjs`.
//!
//! The driver's bugs are kept, as they change what is heard (`adlib.md`,
//! "Percussion" and "Controllers and resetting"):
//!
//! * a note off is moved by its program's transposition, and the notes let
//!   go together (all notes off, a reset, a close) are moved again, so a
//!   note of a transposed program is not found and keeps sounding;
//! * a drum's note off finds the voice of the drum last struck, not of its
//!   own key;
//! * all notes off, from any channel, lets go of the notes of every
//!   channel;
//! * a stolen voice's instrument is always set again, and the bend is
//!   written before the note.
//!
//! Where it writes is the card's chip (`Chip`): ports 388h and 389h, each
//! write taking the time the driver's delay loops take (`fm.rs`).

use std::sync::OnceLock;

use serde::Deserialize;

/// An operator of an instrument, as the bank's records hold it: 13
/// parameters, then its waveform.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct Operator {
    pub ksl: u8,
    pub multiple: u8,
    pub feedback: u8,
    pub attack: u8,
    pub sustain: u8,
    pub sustaining: u8,
    pub decay: u8,
    pub release: u8,
    pub level: u8,
    pub tremolo: u8,
    pub vibrato: u8,
    pub ksr: u8,
    pub fm: u8,
    pub wave: u8,
}

/// A record of the bank: whether it is a percussion instrument, the voice
/// one plays on, and its two operators.
#[derive(Debug, Clone, Deserialize)]
pub struct Record {
    pub percussive: u8,
    pub voice: u8,
    pub operators: [Operator; 2],
}

/// A drum key: the bank record it strikes, and the note it plays.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Drum {
    pub key: u8,
    pub patch: u8,
    pub note: u8,
}

/// What the driver keeps of its instruments and tables, as
/// `data/adlib-patches.json` holds it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Patches {
    pub bank: Vec<Record>,
    pub drums: Vec<Drum>,
    pub transpose: Vec<i8>,
    pub velocity: Vec<u8>,
    pub slot_offsets: [u8; 18],
    pub carrier: [u8; 18],
    pub slot_channel: [u8; 18],
    pub voice_slots: [[usize; 2]; 9],
    pub percussion_slots: Vec<Vec<usize>>,
    pub percussion_bits: [u8; 5],
    pub lengths: [u8; 8],
    pub system_lengths: [u8; 8],
    pub fnumbers: Vec<[u16; 12]>,
}

/// The driver's instruments and tables, read once.
pub fn patches() -> &'static Patches {
    static PATCHES: OnceLock<Patches> = OnceLock::new();

    PATCHES.get_or_init(|| {
        serde_json::from_str(include_str!("../../data/adlib-patches.json"))
            .expect("the Ad Lib driver's tables")
    })
}

/// Where the synthesizer writes: the card's FM chip, through its ports.
pub trait Chip {
    /// A register written as the driver writes one (seg1 `6`): its number
    /// to port 388h, then its value to 389h.
    fn write(&mut self, register: u8, value: u8);
    /// The chip's status, port 388h read.
    fn status(&mut self) -> u8;
    /// The driver counting in a loop for `count` of its instructions.
    fn count(&mut self, count: u32);
}

/// An operator as the driver keeps it (seg3 `1cc`, 14 bytes each).
type Slot = Operator;

/// A voice: its frequency state (`1c0`, `2c8`, `1bc4`, `1b9a`) and its
/// allocation (`2dc`, 8 bytes each: in use, note, channel, volume, stamp).
#[derive(Debug, Clone, Copy, Default)]
struct Voice {
    note: u8,
    key_on: bool,
    half: i32,
    row: usize,
    used: bool,
    key: u8,
    channel: u8,
    volume: u8,
    stamp: u32,
}

/// A channel's program and bend (seg3 `6e`, 3 bytes each).
#[derive(Debug, Clone, Copy)]
struct Channel {
    patch: u8,
    bend: u16,
}

/// What the chip's registers `BDh` and `08h` hold, as the driver keeps
/// them, a byte each, and the bend range.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Copy, Default)]
struct Rhythm {
    tremolo_depth: bool, // [1bdb]
    vibrato_depth: bool, // [1bb0]
    note_select: bool,   // [1bb1]
    percussion: bool,    // [193e]
    drum_bits: u8,       // [193c]
    wave_select: bool,   // [1bda]
    /// Semitones times 25 ([1c3c]).
    bend_range: i32,
}

/// The last bend worked out, shared by every voice (`6c`, `2d4`, `2d6`).
#[derive(Debug, Clone, Copy)]
struct BendCache {
    steps: i32,
    row: usize,
    half: i32,
}

/// What the message parser keeps (seg1 `56a`).
#[derive(Debug, Clone, Copy, Default)]
struct Parse {
    remaining: u8,
    index: u8,
    channel: u8,
    one: u8,
    two: u8,
    status: u8,
    running: u8,
}

/// The driver, its state as its data segment holds it.
#[derive(Debug, Clone)]
pub struct Synth {
    slots: [Slot; 18],
    /// Each operator's volume (`1bb2`).
    slot_volume: [u8; 18],
    voices: [Voice; 11],
    channels: [Channel; 16],
    rhythm: Rhythm,
    bend_cache: BendCache,
    /// The stamp counter ([2d8], a doubleword).
    counter: u32,
    /// Whether it has been enabled once ([34e]).
    enabled: bool,
    parse: Parse,
}

impl Default for Synth {
    fn default() -> Self {
        Self::new()
    }
}

/// What a voice is not: none found.
const NONE: usize = 0xff;

/// The channel that plays percussion: 16.
const DRUMS: u8 = 15;

impl Synth {
    /// The driver as it loads: channel 16's program 81h, every other's
    /// nought, every bend 2000h.
    pub fn new() -> Self {
        let mut channels = [Channel {
            patch: 0,
            bend: 0x2000,
        }; 16];

        channels[usize::from(DRUMS)].patch = 0x81;

        Self {
            slots: [Slot::default(); 18],
            slot_volume: [0; 18],
            voices: [Voice::default(); 11],
            channels,
            rhythm: Rhythm::default(),
            bend_cache: BendCache {
                steps: -1,
                row: 0,
                half: 0,
            },
            counter: 0,
            enabled: false,
            parse: Parse::default(),
        }
    }

    fn voice_count(&self) -> usize {
        if self.rhythm.percussion { 11 } else { 9 }
    }

    /// seg1 `f6`.
    fn write_bd(&self, chip: &mut dyn Chip) {
        let r = &self.rhythm;

        chip.write(
            0xbd,
            (if r.tremolo_depth { 0x80 } else { 0 })
                | (if r.vibrato_depth { 0x40 } else { 0 })
                | (if r.percussion { 0x20 } else { 0 })
                | r.drum_bits,
        );
    }

    /// seg1 `128`.
    fn write_note_select(&self, chip: &mut dyn Chip) {
        chip.write(0x08, if self.rhythm.note_select { 0x40 } else { 0 });
    }

    /// seg1 `13b`: the level, scaled by the operator's volume.
    fn write_level(&self, chip: &mut dyn Chip, slot: usize) {
        let p = &self.slots[slot];
        let scaled =
            ((63 - u32::from(p.level & 63)) * u32::from(self.slot_volume[slot]) * 2 + 127) / 254;

        chip.write(
            0x40 | patches().slot_offsets[slot],
            (p.ksl << 6) | (63u32.wrapping_sub(scaled) as u8),
        );
    }

    /// seg1 `418`: everything of an operator, in this order.
    fn write_slot(&self, chip: &mut dyn Chip, slot: usize) {
        let data = patches();
        let p = self.slots[slot];
        let offset = data.slot_offsets[slot];

        self.write_bd(chip);
        self.write_note_select(chip);
        self.write_level(chip, slot);

        // seg1 `4a5`: a modulator's channel's feedback and connection.
        if data.carrier[slot] == 0 {
            chip.write(
                0xc0 | data.slot_channel[slot],
                (p.feedback << 1) | u8::from(p.fm == 0),
            );
        }

        chip.write(0x60 | offset, (p.attack << 4) | (p.decay & 0xf));
        chip.write(0x80 | offset, (p.sustain << 4) | (p.release & 0xf));
        chip.write(
            0x20 | offset,
            (if p.tremolo != 0 { 0x80u8 } else { 0 })
                .wrapping_add(if p.vibrato != 0 { 0x40 } else { 0 })
                .wrapping_add(if p.sustaining != 0 { 0x20 } else { 0 })
                .wrapping_add(if p.ksr != 0 { 0x10 } else { 0 })
                .wrapping_add(p.multiple & 0xf),
        );
        chip.write(
            0xe0 | offset,
            if self.rhythm.wave_select {
                p.wave & 3
            } else {
                0
            },
        );
    }

    /// seg1 `32`: an operator's parameters from a bank record.
    fn set_slot(&mut self, chip: &mut dyn Chip, slot: usize, operator: &Operator) {
        self.slots[slot] = Slot {
            wave: operator.wave & 3,
            ..*operator
        };
        self.write_slot(chip, slot);
    }

    /// seg1 `183`: a voice's instrument.
    fn set_timbre(&mut self, chip: &mut dyn Chip, voice: usize, patch: u8) {
        let data = patches();
        let [first, second] = data.bank[usize::from(patch)].operators;

        if self.rhythm.percussion && voice >= 6 {
            let slots = &data.percussion_slots[voice - 6];

            self.set_slot(chip, slots[0], &first);

            if voice == 6 {
                self.set_slot(chip, slots[1], &second);
            }

            return;
        }

        let [modulator, carrier] = data.voice_slots[voice];

        self.set_slot(chip, modulator, &first);
        self.set_slot(chip, carrier, &second);
    }

    /// seg1 `73`: a voice's F-number and block, and its key.
    fn set_frequency(&mut self, chip: &mut dyn Chip, voice: usize, note: u8, key_on: bool) {
        let v = &mut self.voices[voice];

        v.key_on = key_on;
        v.note = note;

        // A byte: a bend below nought wraps, past 5Fh.
        let n = ((i32::from(note) + v.half) as u8).min(0x5f);
        let fnumber = patches().fnumbers[v.row][usize::from(n % 12)];

        chip.write(0xa0 | voice as u8, fnumber as u8);
        chip.write(
            0xb0 | voice as u8,
            ((n / 12) << 2)
                .wrapping_add(if key_on { 0x20 } else { 0 })
                .wrapping_add(((fnumber >> 8) & 3) as u8),
        );
    }

    /// seg1 `361`: a bend into a whole semitone and a row of 25ths of one.
    fn compute_bend(&mut self, voice: usize, bend: u16) {
        let product = i32::from((i32::from(bend) - 0x2000) as i16) * self.rhythm.bend_range;
        let steps = i32::from((product >> 8) as u16 as i16) >> 5;
        let cache = &mut self.bend_cache;
        let v = &mut self.voices[voice];

        if steps == cache.steps {
            v.row = cache.row;
            v.half = cache.half;
            return;
        }

        let row = if steps < 0 {
            let tmp = 24 - steps;
            let rest = (tmp - 24) % 25;

            v.half = tmp / -25;

            if rest == 0 { 0 } else { (25 - rest) as usize }
        } else {
            v.half = steps / 25;

            (steps % 25) as usize
        };

        cache.half = v.half;
        v.row = row;
        cache.row = row;
        cache.steps = steps;
    }

    /// seg1 `1fc`: the bend applied, the voice's note written again as it
    /// was.
    fn set_bend(&mut self, chip: &mut dyn Chip, voice: usize, bend: u16) {
        if self.rhythm.percussion && voice > 6 {
            return;
        }

        self.compute_bend(voice, bend.min(0x3fff));

        let Voice { note, key_on, .. } = self.voices[voice];

        self.set_frequency(chip, voice, note, key_on);
    }

    /// seg1 `23c`: a voice's volume, on its carrier and, when the voice
    /// adds its operators rather than modulating, its modulator.
    fn set_volume(&mut self, chip: &mut dyn Chip, voice: usize, volume: u8) {
        let data = patches();
        let level = volume.min(0x7f);

        if self.rhythm.percussion && voice > 6 {
            let slot = data.percussion_slots[voice - 6][0];

            self.slot_volume[slot] = level;
            self.write_level(chip, slot);
            return;
        }

        let [modulator, carrier] = data.voice_slots[voice];

        self.slot_volume[carrier] = level;
        self.write_level(chip, carrier);

        if self.slots[modulator].fm == 0 {
            self.slot_volume[modulator] = level;
            self.write_level(chip, modulator);
        }
    }

    /// seg1 `2b3`: the key down, an octave lower; a drum struck.
    fn note_on_voice(&mut self, chip: &mut dyn Chip, voice: usize, key: u8) {
        // Below 12, nought.
        let note = key.saturating_sub(12);

        if voice >= 6 && self.rhythm.percussion {
            if voice == 6 {
                self.set_frequency(chip, 6, note, false);
            } else if voice == 8 {
                // The tom-tom's note, and the snare's a fifth above it.
                self.set_frequency(chip, 8, note, false);
                self.set_frequency(chip, 7, note.wrapping_add(7), false);
            }

            self.rhythm.drum_bits |= patches().percussion_bits[voice - 6];
            self.write_bd(chip);
            return;
        }

        self.set_frequency(chip, voice, note, true);
    }

    /// seg1 `325`.
    fn key_off(&mut self, chip: &mut dyn Chip, voice: usize) {
        if self.rhythm.percussion && voice >= 6 {
            self.rhythm.drum_bits &= !patches().percussion_bits[voice - 6];
            self.write_bd(chip);
            return;
        }

        let note = self.voices[voice].note;

        self.set_frequency(chip, voice, note, false);
    }

    /// seg1 `6a3`: a melodic channel's note moved by its program's
    /// transposition, unless that leaves 0 to 127.
    fn transpose(&self, channel: u8, key: u8) -> u8 {
        let patch = self.channels[usize::from(channel)].patch;

        if channel == DRUMS || patch > 0x7f {
            return key;
        }

        let moved = i32::from(patches().transpose[usize::from(patch)]) + i32::from(key);

        if (0..=0x7f).contains(&moved) {
            moved as u8
        } else {
            key
        }
    }

    /// seg1 `931`: the voice playing a channel's note. Channel 16's is the
    /// voice of the drum last struck, whatever the note.
    fn find(&mut self, channel: u8, key: u8) -> usize {
        if channel == DRUMS {
            let patch = self.channels[usize::from(DRUMS)].patch;
            let voice = usize::from(patches().bank[usize::from(patch)].voice);

            return if self.voices[voice].used { voice } else { NONE };
        }

        for voice in 0..self.voice_count() {
            let v = &mut self.voices[voice];

            if v.used && v.key == key && v.channel == channel {
                v.stamp = self.counter;
                self.counter = self.counter.wrapping_add(1);
                return voice;
            }
        }

        NONE
    }

    /// seg1 `9c4`: a voice for a note, its instrument set. A percussion
    /// record takes its own voice; a melodic note the first free voice of
    /// the six, else the one struck longest ago, let go first.
    fn allocate(&mut self, chip: &mut dyn Chip, channel: u8, key: u8) -> usize {
        let patch = self.channels[usize::from(channel)].patch;
        let record = &patches().bank[usize::from(patch)];

        if record.percussive != 0 {
            let voice = usize::from(record.voice);

            self.voices[voice] = Voice {
                used: true,
                key,
                channel,
                stamp: u32::from(patch),
                ..self.voices[voice]
            };
            self.set_timbre(chip, voice, patch);
            return voice;
        }

        let count = if self.rhythm.percussion { 6 } else { 9 };
        let mut oldest = self.counter;
        let mut chosen = 0;

        for voice in 0..count {
            if !self.voices[voice].used {
                chosen = voice;
                break;
            }

            if self.voices[voice].stamp < oldest {
                oldest = self.voices[voice].stamp;
                chosen = voice;
            }
        }

        if self.voices[chosen].used {
            self.key_off(chip, chosen);
        }

        self.voices[chosen] = Voice {
            used: true,
            key,
            channel,
            stamp: self.counter,
            ..self.voices[chosen]
        };
        self.counter = self.counter.wrapping_add(1);
        self.set_timbre(chip, chosen, patch);
        chosen
    }

    /// The drum a key of channel 16 strikes, if it has one: keys 35 to 81.
    fn drum(key: u8) -> Option<&'static Drum> {
        if !(35..=81).contains(&key) {
            return None;
        }

        patches().drums.iter().find(|drum| drum.key == key)
    }

    /// seg1 `7d8`.
    fn note_off(&mut self, chip: &mut dyn Chip, channel: u8, key: u8) {
        let note = self.transpose(channel, key);

        if channel == DRUMS {
            let Some(&Drum { patch, note, .. }) = Self::drum(note) else {
                return;
            };
            let voice = self.find(DRUMS, note);

            if voice == NONE || self.voices[voice].stamp != u32::from(patch) {
                return;
            }

            self.key_off(chip, voice);
            self.voices[voice].used = false;
            return;
        }

        let voice = self.find(channel, note);

        if voice == NONE || self.voices[voice].key == 0 {
            return;
        }

        self.key_off(chip, voice);
        self.voices[voice].used = false;
    }

    /// seg1 `702`.
    fn note_on(&mut self, chip: &mut dyn Chip, channel: u8, key: u8, velocity: u8) {
        if velocity == 0 {
            self.note_off(chip, channel, key);
            return;
        }

        let mut note = self.transpose(channel, key);
        let volume = patches().velocity[usize::from(velocity & 0x7f)];
        let voice = if channel == DRUMS {
            let Some(drum) = Self::drum(note) else {
                return;
            };

            self.channels[usize::from(DRUMS)].patch = drum.patch;
            note = drum.note;

            let voice = self.find(DRUMS, note);

            if voice != NONE {
                self.key_off(chip, voice);
            }

            self.allocate(chip, DRUMS, note)
        } else {
            match self.find(channel, note) {
                NONE => self.allocate(chip, channel, note),
                voice => {
                    self.key_off(chip, voice);
                    voice
                }
            }
        };

        if self.voices[voice].volume != volume {
            self.set_volume(chip, voice, volume);
            self.voices[voice].volume = volume;
        }

        self.set_bend(chip, voice, self.channels[usize::from(channel)].bend);
        self.note_on_voice(chip, voice, note);
    }

    /// seg1 `65e`: every voice in use let go as its note's note off would,
    /// whatever its channel -- its note moved by its program again.
    fn all_notes_off(&mut self, chip: &mut dyn Chip) {
        for voice in 0..self.voice_count() {
            let Voice {
                used, channel, key, ..
            } = self.voices[voice];

            if used {
                self.note_off(chip, channel, key);
            }
        }
    }

    /// seg1 `8ce`: a channel's voices let go, then its program set; not on
    /// channel 16, whose program is the drum last struck.
    fn program_change(&mut self, chip: &mut dyn Chip, channel: u8, patch: u8) {
        if channel == DRUMS {
            return;
        }

        for voice in 0..self.voice_count() {
            let v = self.voices[voice];

            if v.used && v.channel == channel && v.key != 0 {
                self.key_off(chip, voice);
                self.voices[voice].used = false;
            }
        }

        self.channels[usize::from(channel)].patch = patch;
    }

    /// seg1 `861`: the bend applied to each voice of the channel, and kept
    /// for its next note.
    fn pitch_bend(&mut self, chip: &mut dyn Chip, channel: u8, low: u8, high: u8) {
        let bend = (u16::from(high) << 7) | u16::from(low);

        for voice in 0..self.voice_count() {
            if self.voices[voice].used && self.voices[voice].channel == channel {
                self.set_bend(chip, voice, bend);
            }
        }

        self.channels[usize::from(channel)].bend = bend;
    }

    /// A message parsed whole, to its handler (seg1 `56a`): note off, note
    /// on, a controller -- only the channel mode messages from 7Bh, all
    /// notes off, act (seg1 `8be`) -- a program change and a bend. Key and
    /// channel pressure and system messages have none.
    fn dispatch(&mut self, chip: &mut dyn Chip) {
        if self.parse.remaining != 0 {
            return;
        }

        let Parse {
            channel, one, two, ..
        } = self.parse;

        match (self.parse.status & 0x70) >> 4 {
            0 => self.note_off(chip, channel, one),
            1 => self.note_on(chip, channel, one, two),
            3 if one >= 0x7b => self.all_notes_off(chip),
            4 => self.program_change(chip, channel, one),
            6 => self.pitch_bend(chip, channel, one, two),
            _ => {}
        }
    }

    /// seg1 `56a`: bytes into messages, with running status. Real-time
    /// bytes are skipped; a system status ends running status, and its
    /// bytes are dropped.
    fn parse_bytes(&mut self, chip: &mut dyn Chip, bytes: &[u8]) {
        let data = patches();

        for &byte in bytes {
            if byte >= 0xf8 {
                continue;
            }

            let parse = &mut self.parse;

            if parse.remaining != 0 && byte < 0x80 {
                if parse.index == 0 {
                    parse.index += 1;
                    parse.one = byte;
                } else {
                    parse.two = byte;
                }

                parse.remaining = parse.remaining.wrapping_sub(1);
                self.dispatch(chip);
                continue;
            }

            parse.index = 0;

            if byte >= 0xf0 {
                parse.status = byte;
                parse.running = 0;
                parse.remaining = data.system_lengths[usize::from(byte & 7)].wrapping_sub(1);
                parse.channel = byte & 0xf;
                self.dispatch(chip);
                continue;
            }

            if byte >= 0x80 {
                parse.running = byte;
            } else if parse.running == 0 {
                continue;
            }

            parse.status = parse.running;
            parse.remaining =
                data.lengths[usize::from((parse.running & 0x70) >> 4)].wrapping_sub(1);

            if byte >= 0x80 {
                parse.channel = parse.status & 0xf;
                self.dispatch(chip);
                continue;
            }

            parse.index += 1;
            parse.one = byte;
            parse.remaining = parse.remaining.wrapping_sub(1);
            self.dispatch(chip);
        }
    }

    /// seg2 `11b`: the chip and the driver's state put back. `BDh` is
    /// written before the drum bits are cleared, so the chip keeps them
    /// until it is next written.
    fn reset(&mut self, chip: &mut dyn Chip) {
        let data = patches();

        self.rhythm.tremolo_depth = false;
        self.rhythm.vibrato_depth = false;
        self.rhythm.note_select = false;
        self.write_bd(chip);
        self.write_note_select(chip);
        self.slot_volume = [0x7f; 18];

        for voice in &mut self.voices {
            voice.row = 0;
            voice.half = 0;
        }

        for channel in 0..=8 {
            chip.write(0xa0 | channel, 0);
            chip.write(0xb0 | channel, 0);
        }

        // seg2 `1cc`: percussion mode, the tom-tom and snare tuned.
        self.set_frequency(chip, 8, 0x18, false);
        self.set_frequency(chip, 7, 0x1f, false);
        self.rhythm.percussion = true;
        self.rhythm.drum_bits = 0;
        // seg2 `2de`: two semitones of bend.
        self.rhythm.bend_range = 2 * 25;

        // seg2 `21a`: every waveform plain, then waveforms allowed.
        for slot in 0..18 {
            chip.write(0xe0 | data.slot_offsets[slot], 0);
        }

        self.rhythm.wave_select = true;
        chip.write(0x01, 0x20);
    }

    /// `DRV_ENABLE` (seg2 `55e`): the first time, the card looked for by its
    /// timers (seg2 `15a`), then the chip reset. Whether it was found is
    /// answered; WinBox's card is always there, so what is found is not
    /// acted on.
    pub fn enable(&mut self, chip: &mut dyn Chip) -> bool {
        let mut found = true;

        if !self.enabled {
            // Both timers' flags reset, and the status read; timer 1
            // started at FFh, 80 microseconds, counted out (`mov cx,200`,
            // `loop`), and the status read again.
            chip.write(0x04, 0x60);
            chip.write(0x04, 0x80);

            let before = chip.status();

            chip.write(0x02, 0xff);
            chip.write(0x04, 0x21);
            chip.count(DETECTION_COUNT);

            let after = chip.status();

            chip.write(0x04, 0x60);
            chip.write(0x04, 0x80);
            found = before & 0xe0 == 0 && after & 0xe0 == 0xc0;
        }

        self.reset(chip);
        self.enabled = true;
        found
    }

    /// `DRV_DISABLE` (seg2 `59e`), as Windows ends: the chip reset.
    pub fn disable(&mut self, chip: &mut dyn Chip) {
        if self.enabled {
            self.reset(chip);
        }
    }

    /// `MODM_OPEN` (seg1 `ba5`): the chip reset, running status ended.
    pub fn open(&mut self, chip: &mut dyn Chip) {
        self.reset(chip);
        self.parse.remaining = 0;
        self.parse.running = 0;
    }

    /// `MODM_CLOSE` (seg1 `c36`) and `MODM_RESET` (seg1 `d57`): every note
    /// let go.
    pub fn all_off(&mut self, chip: &mut dyn Chip) {
        self.all_notes_off(chip);
    }

    /// `MODM_DATA` (seg1 `c65`): a short message, as many bytes as its
    /// status says, or its running status's one fewer.
    pub fn short(&mut self, chip: &mut dyn Chip, message: u32) {
        let data = patches();
        let status = message as u8;

        self.parse.remaining = 0;

        let count = if status & 0x80 != 0 {
            data.lengths[usize::from((status & 0x70) >> 4)]
        } else if self.parse.running == 0 {
            return;
        } else {
            data.lengths[usize::from((self.parse.running & 0x70) >> 4)] - 1
        };
        let bytes = message.to_le_bytes();

        self.parse_bytes(chip, &bytes[..usize::from(count).min(3)]);
    }

    /// `MODM_LONGDATA` (seg1 `cf8`): a long message's bytes.
    pub fn long(&mut self, chip: &mut dyn Chip, bytes: &[u8]) {
        self.parse_bytes(chip, bytes);
    }
}

/// The driver's count as it looks for the card (seg2 `15a`), as DOSBox at a
/// fixed 3,000 cycles a millisecond took it: 599 of its instructions
/// between the write that starts the timer and the status read
/// (`adlibout`'s trace, 0.395 ms from the value to the read, less the
/// write's own delay).
const DETECTION_COUNT: u32 = 599;

#[cfg(test)]
mod tests {
    use super::*;

    /// A chip that keeps what is written to it.
    #[derive(Default)]
    struct Kept(Vec<(u8, u8)>);

    impl Chip for Kept {
        fn write(&mut self, register: u8, value: u8) {
            self.0.push((register, value));
        }

        fn status(&mut self) -> u8 {
            0x06
        }

        fn count(&mut self, _: u32) {}
    }

    #[test]
    fn the_tables_read() {
        let data = patches();

        assert_eq!(data.bank.len(), 180);
        assert_eq!(data.fnumbers[0][0], 343);
        assert_eq!(data.velocity[127], 127);
    }

    #[test]
    fn middle_c_plays_block_4_f_number_343() {
        let mut synth = Synth::new();
        let mut chip = Kept::default();

        synth.enable(&mut chip);
        synth.open(&mut chip);
        chip.0.clear();
        synth.short(&mut chip, 0x0064_3c90);

        // The bend writes the note unkeyed, then the key goes down.
        assert_eq!(&chip.0[chip.0.len() - 2..], &[(0xa0, 0x57), (0xb0, 0x31)]);
    }

    #[test]
    fn bends_choose_semitones_and_rows() {
        let mut synth = Synth::new();
        let mut chip = Kept::default();

        synth.enable(&mut chip);

        for (bend, half, row) in [
            (0x2000, 0, 0),
            (0x2100, 0, 1),
            (0x3fff, 1, 24),
            (0x0000, -2, 0),
            (0x1fff, -1, 24),
        ] {
            synth.compute_bend(0, bend);
            assert_eq!(
                (synth.voices[0].half, synth.voices[0].row),
                (half, row),
                "{bend:x}"
            );
        }
    }
}
