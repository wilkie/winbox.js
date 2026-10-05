/*
 *  Copyright (C) 2002-2010  The DOSBox Team
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA.
 */

//! DOSBox's OPL emulator, dbopl: a combined Yamaha YMF262 (OPL3) and
//! YM3812 (OPL2), ported from DOSBox 0.74-3's src/hardware/dbopl.cpp and
//! dbopl.h (`$Id: dbopl.cpp,v 1.10 2009-06-10 19:54:51 harekiet Exp $`),
//! in the configuration DOSBox builds: `DBOPL_WAVE == WAVE_TABLEMUL`, no
//! `WAVE_PRECISION`.
//!
//! The port keeps dbopl's integer arithmetic, its 32-bit wrap-arounds and
//! its tables, so that [`Handler::generate`] gives, sample for sample,
//! what DOSBox's `DBOPL::Handler::Generate` gives for the same register
//! writes and the same sequence of calls. Where C++ walks channels and
//! operators with pointer arithmetic (`this + 1`, `Op(index)`), the port
//! uses channel indices; where it picks a member-function pointer per
//! channel and per envelope state, the port matches on the same enum.
//!
//! As dbopl's own notes say: enabling the OPL3 bit switches the emulator to
//! stereo OPL3 output instead of regular mono OPL2; except for the table
//! generation it is all integer maths; the generation was based on MAME's
//! but uses smaller envelope tables, which is the main cause of it sounding
//! different at times.

// A faithful port keeps dbopl's mixed signed and unsigned 32-bit arithmetic,
// and its names for the chip's registers and fields.
#![allow(clippy::cast_lossless, clippy::similar_names)]
// Masks read as the C they port, more than `trailing_zeros` would.
#![allow(clippy::verbose_bit_mask)]

use crate::dbopl_tables::{EXPONENTIAL, MUL, SINE};

/// The OPL's own sample rate: the 14.31818 MHz clock divided by 288,
/// 49716 Hz and a little.
pub const OPLRATE: f64 = 14_318_180.0 / 288.0;
const TREMOLO_TABLE: usize = 52;

// Wave bits available in the top of the 32-bit range: the original Ad Lib
// uses 10.10, dbopl uses 10.22.
const WAVE_BITS: u32 = 10;
const WAVE_SH: u32 = 32 - WAVE_BITS;
const WAVE_MASK: u32 = (1 << WAVE_SH) - 1;

// The LFO uses the same accuracy as the waves, limited by the tremolo's
// 256-sample step.
const LFO_SH: u32 = WAVE_SH - 10;
const LFO_MAX: u32 = 256 << LFO_SH;

// The envelope goes to 511, 9 bits.
const ENV_BITS: u32 = 9;
const ENV_MIN: i32 = 0;
const ENV_EXTRA: u32 = ENV_BITS - 9;
const ENV_MAX: i32 = 511 << ENV_EXTRA;
const ENV_LIMIT: i32 = (12 * 256) >> (3 - ENV_EXTRA);

const fn env_silent(x: i32) -> bool {
    x >= ENV_LIMIT
}

/// `ENV_SILENT` on the unsigned sum `ForwardVolume` returns.
const fn env_silent_u(x: u32) -> bool {
    x >= ENV_LIMIT as u32
}

// Attack, decay and release rate counter shift.
const RATE_SH: u32 = 24;
const RATE_MASK: u32 = (1 << RATE_SH) - 1;
// Has to fit within a 16-bit look-up table.
const MUL_SH: u32 = 16;

// How much to subtract from the base value for the final attenuation.
const KSL_CREATE_TABLE: [u8; 16] = [64, 32, 24, 19, 16, 12, 11, 10, 8, 6, 5, 4, 3, 2, 1, 0];

// `M(x)` is `(Bit8u)(x * 2)`.
const FREQ_CREATE_TABLE: [u8; 16] = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];

// The highest attack rate is not included; it gets a special value.
const ATTACK_SAMPLES_TABLE: [u8; 13] = [69, 55, 46, 40, 35, 29, 23, 20, 19, 15, 11, 10, 9];
// On a real OPL these values take 8 samples to reach and are based upon
// larger tables.
const ENVELOPE_INCREASE_TABLE: [u8; 13] = [4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32];

// Layout of the waveform table in 512-entry intervals; with overlapping
// waves the table is half the size:
//
//	|    |//\\|____|WAV7|//__|/\  |____|/\/\|
//	|\\//|    |    |WAV7|    |  \/|    |    |
//	|06  |0126|17  |7   |3   |4   |4 5 |5   |
static WAVE_TABLE: [i16; 8 * 512] = build_wave_table();
// Distance into `WAVE_TABLE` that each wave starts.
const WAVE_BASE_TABLE: [u16; 8] = [0x000, 0x200, 0x200, 0x800, 0xa00, 0xc00, 0x100, 0x400];
// The counter is masked with this.
const WAVE_MASK_TABLE: [u16; 8] = [1023, 1023, 511, 511, 1023, 1023, 512, 1023];
// Where the counter starts at key-on.
const WAVE_START_TABLE: [u16; 8] = [512, 0, 0, 0, 0, 512, 512, 256];

static KSL_TABLE: [u8; 8 * 16] = build_ksl_table();
static TREMOLO_TABLE_VALUES: [u8; TREMOLO_TABLE] = build_tremolo_table();
// The channel each of the 32 channel register slots addresses, or `NONE`.
static CHAN_OFFSET_TABLE: [u8; 32] = build_chan_offset_table();
// The operator each of the 64 operator register slots addresses, as
// `channel * 2 + operator`, or `NONE`.
static OP_OFFSET_TABLE: [u8; 64] = build_op_offset_table();
const NONE: u8 = 0xff;

// The lower bits are the shift of the operator vibrato value; the highest
// bit is shifted right to make -1 or 0 for negation. So taking the highest
// input value of 7 this gives 3, 7, 3, 0, -3, -7, -3, 0.
// dbopl writes the second half as 1 - 0x80, 0 - 0x80, 1 - 0x80, 30 - 0x80.
const VIBRATO_TABLE: [i8; 8] = [1, 0, 1, 30, -127, -128, -127, -98];

// Shift strength for the KSL value, by the KSL bits.
const KSL_SHIFT_TABLE: [u8; 4] = [31, 1, 2, 0];

const fn build_wave_table() -> [i16; 8 * 512] {
    let mut w = [0i16; 8 * 512];
    // Sine wave base.
    let mut i = 0;
    while i < 512 {
        w[0x0200 + i] = SINE[i];
        w[i] = -w[0x200 + i];
        i += 1;
    }
    // Exponential wave.
    i = 0;
    while i < 256 {
        w[0x700 + i] = EXPONENTIAL[i];
        w[0x6ff - i] = -w[0x700 + i];
        i += 1;
    }
    i = 0;
    while i < 256 {
        // Fill the silence gaps.
        w[0x400 + i] = w[0];
        w[0x500 + i] = w[0];
        w[0x900 + i] = w[0];
        w[0xc00 + i] = w[0];
        w[0xd00 + i] = w[0];
        // Replicate the sines in other pieces.
        w[0x800 + i] = w[0x200 + i];
        // Double-speed sines.
        w[0xa00 + i] = w[0x200 + i * 2];
        w[0xb00 + i] = w[i * 2];
        w[0xe00 + i] = w[0x200 + i * 2];
        w[0xf00 + i] = w[0x200 + i * 2];
        i += 1;
    }
    w
}

const fn build_ksl_table() -> [u8; 8 * 16] {
    let mut t = [0u8; 8 * 16];
    let mut oct = 0;
    while oct < 8 {
        let base = oct as i32 * 8;
        let mut i = 0;
        while i < 16 {
            let mut val = base - KSL_CREATE_TABLE[i] as i32;
            if val < 0 {
                val = 0;
            }
            // Times 4 for the final range to match the attenuation range.
            t[oct * 16 + i] = (val * 4) as u8;
            i += 1;
        }
        oct += 1;
    }
    t
}

// Just an increasing and decreasing triangle wave.
const fn build_tremolo_table() -> [u8; TREMOLO_TABLE] {
    let mut t = [0u8; TREMOLO_TABLE];
    let mut i = 0;
    while i < TREMOLO_TABLE / 2 {
        let val = (i as u8) << ENV_EXTRA;
        t[i] = val;
        t[TREMOLO_TABLE - 1 - i] = val;
        i += 1;
    }
    t
}

const fn build_chan_offset_table() -> [u8; 32] {
    let mut t = [NONE; 32];
    let mut i = 0;
    while i < 32 {
        let mut index = i & 0xf;
        if index < 9 {
            // Make sure the four-operator channels follow each other.
            if index < 6 {
                index = (index % 3) * 2 + (index / 3);
            }
            // Add back the bits for the highest ones.
            if i >= 16 {
                index += 9;
            }
            t[i] = index as u8;
        }
        i += 1;
    }
    t
}

const fn build_op_offset_table() -> [u8; 64] {
    let chans = build_chan_offset_table();
    let mut t = [NONE; 64];
    let mut i = 0;
    while i < 64 {
        if !(i % 8 >= 6 || (i / 8) % 4 == 3) {
            let mut ch_num = (i / 8) * 3 + (i % 8) % 3;
            // Use 16 and up for the second range, to match the channel gap.
            if ch_num >= 12 {
                ch_num += 16 - 12;
            }
            let op_num = (i % 8) / 3;
            t[i] = chans[ch_num] * 2 + op_num as u8;
        }
        i += 1;
    }
    t
}

/// The table index and shift for a rate value, as `EnvelopeSelect`.
const fn envelope_select(val: u8) -> (u8, u8) {
    if val < 13 * 4 {
        // Rate 0 to 12.
        (val & 3, 12 - (val >> 2))
    } else if val < 15 * 4 {
        // Rate 13 to 14.
        (val - 12 * 4, 0)
    } else {
        // Rate 15 and up.
        (12, 0)
    }
}

/// The different modes in which a channel generates blocks of samples,
/// in dbopl's order (the order matters: `mode > sm4Start` and
/// `mode > sm6Start` pick how many operators to prepare).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
enum SynthMode {
    Sm2Am = 0,
    Sm2Fm = 1,
    Sm3Am = 2,
    Sm3Fm = 3,
    // sm4Start = 4
    Sm3FmFm = 5,
    Sm3AmFm = 6,
    Sm3FmAm = 7,
    Sm3AmAm = 8,
    // sm6Start = 9
    Sm2Percussion = 10,
    Sm3Percussion = 11,
}

const SM2AM: u8 = SynthMode::Sm2Am as u8;
const SM2FM: u8 = SynthMode::Sm2Fm as u8;
const SM3AM: u8 = SynthMode::Sm3Am as u8;
const SM3FM: u8 = SynthMode::Sm3Fm as u8;
const SM4START: u8 = 4;
const SM3FMFM: u8 = SynthMode::Sm3FmFm as u8;
const SM3AMFM: u8 = SynthMode::Sm3AmFm as u8;
const SM3FMAM: u8 = SynthMode::Sm3FmAm as u8;
const SM3AMAM: u8 = SynthMode::Sm3AmAm as u8;
const SM6START: u8 = 9;
const SM2PERCUSSION: u8 = SynthMode::Sm2Percussion as u8;
const SM3PERCUSSION: u8 = SynthMode::Sm3Percussion as u8;

// Shifts for the values held in `chan_data`.
const SHIFT_KSLBASE: u32 = 16;
const SHIFT_KEYCODE: u32 = 24;

// Masks for the operator's 20h register.
const MASK_KSR: u8 = 0x10;
const MASK_SUSTAIN: u8 = 0x20;
const MASK_VIBRATO: u8 = 0x40;

// Envelope states.
const OFF: u8 = 0;
const RELEASE: u8 = 1;
const SUSTAIN: u8 = 2;
const DECAY: u8 = 3;
const ATTACK: u8 = 4;

/// Rates and frequency scales for the chip's sample rate.
#[derive(Clone, Debug)]
struct RateTables {
    // Frequency scales for the different multiplications.
    freq_mul: [u32; 16],
    // Rates for decay and release at this chip's rate.
    linear_rates: [u32; 76],
    // Best-match attack rates at this chip's rate.
    attack_rates: [u32; 76],
}

/// What `Operator::Prepare` reads from the chip.
#[derive(Clone, Copy)]
struct Lfo {
    tremolo_value: u8,
    vibrato_shift: u8,
    vibrato_sign: i8,
}

#[derive(Clone, Debug)]
struct Operator {
    // `waveBase` as an offset into `WAVE_TABLE`.
    wave_base: usize,
    wave_mask: u32,
    wave_start: u32,
    // `WAVE_BITS`-shifted counter of the frequency index.
    wave_index: u32,
    // The base frequency without vibrato.
    wave_add: u32,
    // `wave_add` plus vibrato.
    wave_current: u32,

    // Frequency, octave and derived data from the controlling channel.
    chan_data: u32,
    // Scale the channel frequency with this.
    freq_mul: u32,
    // Scaled-up vibrato strength.
    vibrato: u32,
    // When stopping at the sustain level, stop here.
    sustain_level: i32,
    // Added to every generated volume.
    total_level: i32,
    // `total_level` plus tremolo.
    current_level: u32,
    // The currently active volume.
    volume: i32,

    attack_add: u32,
    decay_add: u32,
    release_add: u32,
    // Current position of the envelope.
    rate_index: u32,

    // A bit per envelope state in which the envelope does not change.
    rate_zero: u8,
    // Bit mask of the sources holding the key on.
    key_on: u8,
    reg20: u8,
    reg40: u8,
    reg60: u8,
    reg80: u8,
    reg_e0: u8,
    // The active part of the envelope.
    state: u8,
    // 0xff when tremolo is enabled.
    tremolo_mask: u8,
    // Strength of the vibrato.
    vib_strength: u8,
    // The KSR in effect, kept to see changes.
    ksr: u8,
}

impl Operator {
    fn new() -> Self {
        Self {
            wave_base: 0,
            wave_mask: 0,
            wave_start: 0,
            wave_index: 0,
            wave_add: 0,
            wave_current: 0,
            chan_data: 0,
            freq_mul: 0,
            vibrato: 0,
            sustain_level: ENV_MAX,
            total_level: ENV_MAX,
            current_level: ENV_MAX as u32,
            volume: ENV_MAX,
            attack_add: 0,
            decay_add: 0,
            release_add: 0,
            rate_index: 0,
            rate_zero: 1 << OFF,
            key_on: 0,
            reg20: 0,
            reg40: 0,
            reg60: 0,
            reg80: 0,
            reg_e0: 0,
            state: OFF,
            tremolo_mask: 0,
            vib_strength: 0,
            ksr: 0,
        }
    }

    // The rate is zeroed when it is 0.
    fn update_attack(&mut self, rates: &RateTables) {
        let rate = self.reg60 >> 4;
        if rate != 0 {
            let val = (rate << 2) + self.ksr;
            self.attack_add = rates.attack_rates[val as usize];
            self.rate_zero &= !(1 << ATTACK);
        } else {
            self.attack_add = 0;
            self.rate_zero |= 1 << ATTACK;
        }
    }

    fn update_decay(&mut self, rates: &RateTables) {
        let rate = self.reg60 & 0xf;
        if rate != 0 {
            let val = (rate << 2) + self.ksr;
            self.decay_add = rates.linear_rates[val as usize];
            self.rate_zero &= !(1 << DECAY);
        } else {
            self.decay_add = 0;
            self.rate_zero |= 1 << DECAY;
        }
    }

    fn update_release(&mut self, rates: &RateTables) {
        let rate = self.reg80 & 0xf;
        if rate != 0 {
            let val = (rate << 2) + self.ksr;
            self.release_add = rates.linear_rates[val as usize];
            self.rate_zero &= !(1 << RELEASE);
            if self.reg20 & MASK_SUSTAIN == 0 {
                self.rate_zero &= !(1 << SUSTAIN);
            }
        } else {
            self.rate_zero |= 1 << RELEASE;
            self.release_add = 0;
            if self.reg20 & MASK_SUSTAIN == 0 {
                self.rate_zero |= 1 << SUSTAIN;
            }
        }
    }

    fn update_attenuation(&mut self) {
        let ksl_base = ((self.chan_data >> SHIFT_KSLBASE) & 0xff) as u8;
        let tl = (self.reg40 & 0x3f) as u32;
        let ksl_shift = KSL_SHIFT_TABLE[(self.reg40 >> 6) as usize];
        // The total level goes 2 bits below the maximum.
        self.total_level = (tl << (ENV_BITS - 7)) as i32;
        self.total_level += (((ksl_base as u32) << ENV_EXTRA) >> ksl_shift) as i32;
    }

    fn update_frequency(&mut self) {
        let freq = self.chan_data & ((1 << 10) - 1);
        let block = (self.chan_data >> 10) & 0xff;
        self.wave_add = freq.wrapping_shl(block).wrapping_mul(self.freq_mul);
        if self.reg20 & MASK_VIBRATO != 0 {
            self.vib_strength = (freq >> 7) as u8;
            self.vibrato = (self.vib_strength as u32)
                .wrapping_shl(block)
                .wrapping_mul(self.freq_mul);
        } else {
            self.vib_strength = 0;
            self.vibrato = 0;
        }
    }

    fn update_rates(&mut self, rates: &RateTables) {
        // MAME seems to reverse this, where enabling KSR actually lowers
        // the rate, but the PDF manuals say otherwise.
        let mut new_ksr = ((self.chan_data >> SHIFT_KEYCODE) & 0xff) as u8;
        if self.reg20 & MASK_KSR == 0 {
            new_ksr >>= 2;
        }
        if self.ksr == new_ksr {
            return;
        }
        self.ksr = new_ksr;
        self.update_attack(rates);
        self.update_decay(rates);
        self.update_release(rates);
    }

    #[inline]
    fn rate_forward(&mut self, add: u32) -> i32 {
        self.rate_index = self.rate_index.wrapping_add(add);
        let ret = (self.rate_index >> RATE_SH) as i32;
        self.rate_index &= RATE_MASK;
        ret
    }

    /// `TemplateVolume<state>`, through `volHandler`.
    #[inline]
    fn template_volume(&mut self) -> i32 {
        let mut vol = self.volume;
        match self.state {
            ATTACK => {
                let change = self.rate_forward(self.attack_add);
                if change == 0 {
                    return vol;
                }
                vol = vol.wrapping_add((!vol).wrapping_mul(change) >> 3);
                if vol < ENV_MIN {
                    self.volume = ENV_MIN;
                    self.rate_index = 0;
                    self.set_state(DECAY);
                    return ENV_MIN;
                }
            }
            DECAY => {
                vol = vol.wrapping_add(self.rate_forward(self.decay_add));
                if vol >= self.sustain_level {
                    // Check whether it overshot the maximum attenuation;
                    // then it just goes off.
                    if vol >= ENV_MAX {
                        self.volume = ENV_MAX;
                        self.set_state(OFF);
                        return ENV_MAX;
                    }
                    // Continue as sustain.
                    self.rate_index = 0;
                    self.set_state(SUSTAIN);
                }
            }
            SUSTAIN | RELEASE => {
                if self.state == SUSTAIN && self.reg20 & MASK_SUSTAIN != 0 {
                    return vol;
                }
                // In the sustain phase but not sustaining: a regular
                // release.
                vol = vol.wrapping_add(self.rate_forward(self.release_add));
                if vol >= ENV_MAX {
                    self.volume = ENV_MAX;
                    self.set_state(OFF);
                    return ENV_MAX;
                }
            }
            _ => return ENV_MAX,
        }
        self.volume = vol;
        vol
    }

    #[inline]
    fn forward_volume(&mut self) -> u32 {
        self.current_level
            .wrapping_add(self.template_volume() as u32)
    }

    #[inline]
    fn forward_wave(&mut self) -> u32 {
        self.wave_index = self.wave_index.wrapping_add(self.wave_current);
        self.wave_index >> WAVE_SH
    }

    fn write20(&mut self, rates: &RateTables, val: u8) {
        let change = self.reg20 ^ val;
        if change == 0 {
            return;
        }
        self.reg20 = val;
        // Shift the tremolo bit over the entire register.
        self.tremolo_mask = ((val as i8) >> 7) as u8;
        self.tremolo_mask &= !((1u8 << ENV_EXTRA) - 1);
        // Update specific features based on the changes.
        if change & MASK_KSR != 0 {
            self.update_rates(rates);
        }
        // With sustain enabled the volume doesn't change.
        if self.reg20 & MASK_SUSTAIN != 0 || self.release_add == 0 {
            self.rate_zero |= 1 << SUSTAIN;
        } else {
            self.rate_zero &= !(1 << SUSTAIN);
        }
        // The frequency multiplier or vibrato changed.
        if change & (0xf | MASK_VIBRATO) != 0 {
            self.freq_mul = rates.freq_mul[(val & 0xf) as usize];
            self.update_frequency();
        }
    }

    fn write40(&mut self, val: u8) {
        if self.reg40 ^ val == 0 {
            return;
        }
        self.reg40 = val;
        self.update_attenuation();
    }

    fn write60(&mut self, rates: &RateTables, val: u8) {
        let change = self.reg60 ^ val;
        self.reg60 = val;
        if change & 0x0f != 0 {
            self.update_decay(rates);
        }
        if change & 0xf0 != 0 {
            self.update_attack(rates);
        }
    }

    fn write80(&mut self, rates: &RateTables, val: u8) {
        let change = self.reg80 ^ val;
        if change == 0 {
            return;
        }
        self.reg80 = val;
        let mut sustain = val >> 4;
        // Turn 0xf into 0x1f.
        sustain |= (sustain + 1) & 0x10;
        self.sustain_level = (sustain as i32) << (ENV_BITS - 5);
        if change & 0x0f != 0 {
            self.update_release(rates);
        }
    }

    fn write_e0(&mut self, wave_form_mask: u8, opl3_active: u8, val: u8) {
        if self.reg_e0 ^ val == 0 {
            return;
        }
        // In OPL3 mode all 8 waveforms can be selected, whatever the
        // waveform-select bit.
        let wave_form = val & ((0x3 & wave_form_mask) | (0x7 & opl3_active));
        self.reg_e0 = val;
        self.wave_base = WAVE_BASE_TABLE[wave_form as usize] as usize;
        self.wave_start = (WAVE_START_TABLE[wave_form as usize] as u32) << WAVE_SH;
        self.wave_mask = WAVE_MASK_TABLE[wave_form as usize] as u32;
    }

    #[inline]
    fn set_state(&mut self, s: u8) {
        self.state = s;
    }

    #[inline]
    fn silent(&self) -> bool {
        if !env_silent(self.total_level + self.volume) {
            return false;
        }
        if self.rate_zero & (1 << self.state) == 0 {
            return false;
        }
        true
    }

    #[inline]
    fn prepare(&mut self, lfo: Lfo) {
        self.current_level =
            (self.total_level as u32).wrapping_add((lfo.tremolo_value & self.tremolo_mask) as u32);
        self.wave_current = self.wave_add;
        if (self.vib_strength as u32) >> lfo.vibrato_shift != 0 {
            let mut add = (self.vibrato >> lfo.vibrato_shift) as i32;
            // Sign-extend over the shift value.
            let neg = lfo.vibrato_sign as i32;
            // Negate the add with -1 or 0.
            add = (add ^ neg).wrapping_sub(neg);
            self.wave_current = self.wave_current.wrapping_add(add as u32);
        }
    }

    fn key_on(&mut self, mask: u8) {
        if self.key_on == 0 {
            // Restart the frequency generator.
            self.wave_index = self.wave_start;
            self.rate_index = 0;
            self.set_state(ATTACK);
        }
        self.key_on |= mask;
    }

    fn key_off(&mut self, mask: u8) {
        self.key_on &= !mask;
        if self.key_on == 0 && self.state != OFF {
            self.set_state(RELEASE);
        }
    }

    #[inline]
    fn get_wave(&self, index: u32, vol: u32) -> i32 {
        let wave = WAVE_TABLE[self.wave_base + (index & self.wave_mask) as usize] as i32;
        (wave * MUL[(vol >> ENV_EXTRA) as usize] as i32) >> MUL_SH
    }

    #[inline]
    fn get_sample(&mut self, modulation: i32) -> i32 {
        let vol = self.forward_volume();
        if env_silent_u(vol) {
            // Simply forward the wave.
            self.wave_index = self.wave_index.wrapping_add(self.wave_current);
            0
        } else {
            let index = self.forward_wave().wrapping_add(modulation as u32);
            self.get_wave(index, vol)
        }
    }
}

#[derive(Clone, Debug)]
struct Channel {
    op: [Operator; 2],
    synth: SynthMode,
    // Frequency, octave and derived values.
    chan_data: u32,
    // Old data for feedback.
    old: [i32; 2],
    // Feedback shift.
    feedback: u8,
    reg_b0: u8,
    reg_c0: u8,
    // Corresponds with reg104: bit 6 marks a percussion channel, bit 7 a
    // silent one.
    four_mask: u8,
    // Sign-extended values for the channel's panning.
    mask_left: i8,
    mask_right: i8,
}

impl Channel {
    fn new() -> Self {
        Self {
            op: [Operator::new(), Operator::new()],
            synth: SynthMode::Sm2Fm,
            chan_data: 0,
            old: [0, 0],
            feedback: 31,
            reg_b0: 0,
            reg_c0: 0,
            four_mask: 0,
            mask_left: -1,
            mask_right: -1,
        }
    }
}

/// One dbopl chip: an OPL3, or in its OPL2 mode an OPL2, with its 18
/// channels of two operators each.
#[derive(Clone, Debug)]
pub struct Chip {
    // The base counter for vibrato and tremolo.
    lfo_counter: u32,
    lfo_add: u32,

    noise_counter: u32,
    noise_add: u32,
    noise_value: u32,

    rates: RateTables,

    chan: [Channel; 18],

    reg104: u8,
    reg08: u8,
    reg_bd: u8,
    vibrato_index: u8,
    tremolo_index: u8,
    vibrato_sign: i8,
    vibrato_shift: u8,
    tremolo_value: u8,
    vibrato_strength: u8,
    tremolo_strength: u8,
    // Mask for the allowed waveforms.
    wave_form_mask: u8,
    // 0, or 0xff when OPL3 mode is on.
    opl3_active: u8,
}

impl Chip {
    /// A chip set up for samples at `rate` Hz, as `Chip::Chip` and then
    /// `Chip::Setup(rate)`.
    pub fn new(rate: u32) -> Self {
        let mut chip = Self {
            lfo_counter: 0,
            lfo_add: 0,
            noise_counter: 0,
            noise_add: 0,
            noise_value: 0,
            rates: RateTables {
                freq_mul: [0; 16],
                linear_rates: [0; 76],
                attack_rates: [0; 76],
            },
            chan: core::array::from_fn(|_| Channel::new()),
            reg104: 0,
            reg08: 0,
            reg_bd: 0,
            vibrato_index: 0,
            tremolo_index: 0,
            vibrato_sign: 0,
            vibrato_shift: 0,
            tremolo_value: 0,
            vibrato_strength: 0,
            tremolo_strength: 0,
            wave_form_mask: 0,
            opl3_active: 0,
        };
        chip.setup(rate);
        chip
    }

    /// Whether the OPL3 bit (register 105h bit 0) is on: then the chip
    /// gives stereo frames rather than mono samples.
    pub fn opl3_active(&self) -> bool {
        self.opl3_active != 0
    }

    #[inline]
    fn op(&mut self, ch: usize, index: usize) -> &mut Operator {
        &mut self.chan[ch + (index >> 1)].op[index & 1]
    }

    fn lfo(&self) -> Lfo {
        Lfo {
            tremolo_value: self.tremolo_value,
            vibrato_shift: self.vibrato_shift,
            vibrato_sign: self.vibrato_sign,
        }
    }

    // Forwards the channel data to the operators of the channel.
    fn set_chan_data(&mut self, ch: usize, data: u32) {
        let channel = &mut self.chan[ch];
        let change = channel.chan_data ^ data;
        channel.chan_data = data;
        for op in &mut channel.op {
            op.chan_data = data;
        }
        // Since a frequency update triggered this, always update the
        // frequency.
        for op in &mut channel.op {
            op.update_frequency();
        }
        if change & (0xff << SHIFT_KSLBASE) != 0 {
            for op in &mut channel.op {
                op.update_attenuation();
            }
        }
        if change & (0xff << SHIFT_KEYCODE) != 0 {
            for op in &mut channel.op {
                op.update_rates(&self.rates);
            }
        }
    }

    // A change in the channel data: works out the new values and forwards
    // them to the operators.
    fn update_frequency(&mut self, ch: usize, four_op: u8) {
        // Extract the frequency bits.
        let mut data = self.chan[ch].chan_data & 0xffff;
        let ksl_base = KSL_TABLE[(data >> 6) as usize] as u32;
        let mut key_code = (data & 0x1c00) >> 9;
        if self.reg08 & 0x40 != 0 {
            // Note select 1.
            key_code |= (data & 0x100) >> 8;
        } else {
            // Note select 0.
            key_code |= (data & 0x200) >> 9;
        }
        // Add the key code and KSL into the highest bits of the data.
        data |= (key_code << SHIFT_KEYCODE) | (ksl_base << SHIFT_KSLBASE);
        self.set_chan_data(ch, data);
        if four_op & 0x3f != 0 {
            self.set_chan_data(ch + 1, data);
        }
    }

    fn four_op(&self, ch: usize) -> u8 {
        self.reg104 & self.opl3_active & self.chan[ch].four_mask
    }

    fn write_a0(&mut self, ch: usize, val: u8) {
        let four_op = self.four_op(ch);
        // Writes to silent four-operator channels are not handled.
        if four_op > 0x80 {
            return;
        }
        let change = (self.chan[ch].chan_data ^ val as u32) & 0xff;
        if change != 0 {
            self.chan[ch].chan_data ^= change;
            self.update_frequency(ch, four_op);
        }
    }

    fn write_b0(&mut self, ch: usize, val: u8) {
        let four_op = self.four_op(ch);
        // Writes to silent four-operator channels are not handled.
        if four_op > 0x80 {
            return;
        }
        let change = (self.chan[ch].chan_data ^ ((val as u32) << 8)) & 0x1f00;
        if change != 0 {
            self.chan[ch].chan_data ^= change;
            self.update_frequency(ch, four_op);
        }
        // Check for a change in the key-on state.
        if (val ^ self.chan[ch].reg_b0) & 0x20 == 0 {
            return;
        }
        self.chan[ch].reg_b0 = val;
        if val & 0x20 != 0 {
            self.op(ch, 0).key_on(0x1);
            self.op(ch, 1).key_on(0x1);
            if four_op & 0x3f != 0 {
                self.op(ch + 1, 0).key_on(1);
                self.op(ch + 1, 1).key_on(1);
            }
        } else {
            self.op(ch, 0).key_off(0x1);
            self.op(ch, 1).key_off(0x1);
            if four_op & 0x3f != 0 {
                self.op(ch + 1, 0).key_off(1);
                self.op(ch + 1, 1).key_off(1);
            }
        }
    }

    fn write_c0(&mut self, ch: usize, val: u8) {
        let change = val ^ self.chan[ch].reg_c0;
        if change == 0 {
            return;
        }
        let four_mask = self.chan[ch].four_mask;
        {
            let channel = &mut self.chan[ch];
            channel.reg_c0 = val;
            channel.feedback = (val >> 1) & 7;
            if channel.feedback != 0 {
                // The input is shifted to the right 10-bit wave index
                // value.
                channel.feedback = 9 - channel.feedback;
            } else {
                channel.feedback = 31;
            }
        }
        // Select the new synth mode.
        if self.opl3_active != 0 {
            if (self.reg104 & four_mask) & 0x3f != 0 {
                // Four-operator mode is on for this channel; check whether
                // it is the second channel of the pair.
                let (chan0, chan1) = if four_mask & 0x80 == 0 {
                    (ch, ch + 1)
                } else {
                    (ch - 1, ch)
                };
                let synth = (self.chan[chan0].reg_c0 & 1) | ((self.chan[chan1].reg_c0 & 1) << 1);
                self.chan[chan0].synth = match synth {
                    0 => SynthMode::Sm3FmFm,
                    1 => SynthMode::Sm3AmFm,
                    2 => SynthMode::Sm3FmAm,
                    _ => SynthMode::Sm3AmAm,
                };
            } else if (four_mask & 0x40) != 0 && (self.reg_bd & 0x20) != 0 {
                // Percussion channels are not updated.
            } else if val & 1 != 0 {
                // A regular two-operator channel, AM or FM.
                self.chan[ch].synth = SynthMode::Sm3Am;
            } else {
                self.chan[ch].synth = SynthMode::Sm3Fm;
            }
            self.chan[ch].mask_left = if val & 0x10 != 0 { -1 } else { 0 };
            self.chan[ch].mask_right = if val & 0x20 != 0 { -1 } else { 0 };
        } else if (four_mask & 0x40) != 0 && (self.reg_bd & 0x20) != 0 {
            // OPL2: percussion channels are not updated.
        } else if val & 1 != 0 {
            self.chan[ch].synth = SynthMode::Sm2Am;
        } else {
            self.chan[ch].synth = SynthMode::Sm2Fm;
        }
    }

    fn reset_c0(&mut self, ch: usize) {
        let val = self.chan[ch].reg_c0;
        self.chan[ch].reg_c0 ^= 0xff;
        self.write_c0(ch, val);
    }

    #[inline]
    fn forward_noise(&mut self) -> u32 {
        self.noise_counter = self.noise_counter.wrapping_add(self.noise_add);
        let mut count = self.noise_counter >> LFO_SH;
        self.noise_counter &= WAVE_MASK;
        while count > 0 {
            // The noise calculation from MAME.
            self.noise_value ^= 0x0080_0302 & 0u32.wrapping_sub(self.noise_value & 1);
            self.noise_value >>= 1;
            count -= 1;
        }
        self.noise_value
    }

    // Returns the largest number of samples before an LFO change.
    fn forward_lfo(&mut self, samples: u32) -> u32 {
        // The current vibrato value; it runs 4 times slower than tremolo.
        let vib = VIBRATO_TABLE[(self.vibrato_index >> 2) as usize];
        self.vibrato_sign = vib >> 7;
        self.vibrato_shift = ((vib & 7) as u8).wrapping_add(self.vibrato_strength);
        self.tremolo_value =
            TREMOLO_TABLE_VALUES[self.tremolo_index as usize] >> self.tremolo_strength;

        // How many samples can be done before the value changes.
        let todo = LFO_MAX.wrapping_sub(self.lfo_counter);
        let mut count = todo.wrapping_add(self.lfo_add).wrapping_sub(1) / self.lfo_add;
        if count > samples {
            count = samples;
            self.lfo_counter = self
                .lfo_counter
                .wrapping_add(count.wrapping_mul(self.lfo_add));
        } else {
            self.lfo_counter = self
                .lfo_counter
                .wrapping_add(count.wrapping_mul(self.lfo_add));
            self.lfo_counter &= LFO_MAX - 1;
            // A maximum of 7 vibrato values times 4.
            self.vibrato_index = (self.vibrato_index + 1) & 31;
            // Clip the tremolo to the table size.
            if (self.tremolo_index as usize) + 1 < TREMOLO_TABLE {
                self.tremolo_index += 1;
            } else {
                self.tremolo_index = 0;
            }
        }
        count
    }

    fn write_bd(&mut self, val: u8) {
        let change = self.reg_bd ^ val;
        if change == 0 {
            return;
        }
        self.reg_bd = val;
        self.vibrato_strength = u8::from(val & 0x40 == 0);
        self.tremolo_strength = if val & 0x80 != 0 { 0x00 } else { 0x02 };
        if val & 0x20 != 0 {
            // The drums were just enabled: give channel 6 the right synth.
            if change & 0x20 != 0 {
                self.chan[6].synth = if self.opl3_active != 0 {
                    SynthMode::Sm3Percussion
                } else {
                    SynthMode::Sm2Percussion
                };
            }
            // Bass drum.
            if val & 0x10 != 0 {
                self.chan[6].op[0].key_on(0x2);
                self.chan[6].op[1].key_on(0x2);
            } else {
                self.chan[6].op[0].key_off(0x2);
                self.chan[6].op[1].key_off(0x2);
            }
            // Hi-hat.
            if val & 0x1 != 0 {
                self.chan[7].op[0].key_on(0x2);
            } else {
                self.chan[7].op[0].key_off(0x2);
            }
            // Snare drum.
            if val & 0x8 != 0 {
                self.chan[7].op[1].key_on(0x2);
            } else {
                self.chan[7].op[1].key_off(0x2);
            }
            // Tom-tom.
            if val & 0x4 != 0 {
                self.chan[8].op[0].key_on(0x2);
            } else {
                self.chan[8].op[0].key_off(0x2);
            }
            // Top cymbal.
            if val & 0x2 != 0 {
                self.chan[8].op[1].key_on(0x2);
            } else {
                self.chan[8].op[1].key_off(0x2);
            }
        } else if change & 0x20 != 0 {
            // The drums were turned off: reset channel 6's synth and key
            // all the drums off.
            self.reset_c0(6);
            self.chan[6].op[0].key_off(0x2);
            self.chan[6].op[1].key_off(0x2);
            self.chan[7].op[0].key_off(0x2);
            self.chan[7].op[1].key_off(0x2);
            self.chan[8].op[0].key_off(0x2);
            self.chan[8].op[1].key_off(0x2);
        }
    }

    /// Writes `val` to register `reg` (0 to 1FFh; 100h and up are the
    /// OPL3's second bank), as `Chip::WriteReg`.
    pub fn write_reg(&mut self, reg: u32, val: u8) {
        match (reg & 0xf0) >> 4 {
            0x0 => {
                if reg == 0x01 {
                    self.wave_form_mask = if val & 0x20 != 0 { 0x7 } else { 0x0 };
                } else if reg == 0x104 {
                    // Only changes in the lowest 6 bits count.
                    if (self.reg104 ^ val) & 0x3f == 0 {
                        return;
                    }
                    // Always keep the highest bit on, for the `> 0x80`
                    // checks.
                    self.reg104 = 0x80 | (val & 0x3f);
                } else if reg == 0x105 {
                    // MAME says the real OPL3 doesn't reset anything on an
                    // OPL3 enable or disable until the next write to
                    // another register.
                    if (self.opl3_active ^ val) & 1 == 0 {
                        return;
                    }
                    self.opl3_active = if val & 1 != 0 { 0xff } else { 0 };
                    // Update the C0h register of every channel, to switch
                    // to the mono or stereo handlers.
                    for i in 0..18 {
                        self.reset_c0(i);
                    }
                } else if reg == 0x08 {
                    self.reg08 = val;
                }
            }
            0x2 | 0x3 => {
                if let Some((ch, o)) = op_slot(reg) {
                    self.chan[ch].op[o].write20(&self.rates, val);
                }
            }
            0x4 | 0x5 => {
                if let Some((ch, o)) = op_slot(reg) {
                    self.chan[ch].op[o].write40(val);
                }
            }
            0x6 | 0x7 => {
                if let Some((ch, o)) = op_slot(reg) {
                    self.chan[ch].op[o].write60(&self.rates, val);
                }
            }
            0x8 | 0x9 => {
                if let Some((ch, o)) = op_slot(reg) {
                    self.chan[ch].op[o].write80(&self.rates, val);
                }
            }
            0xa => {
                if let Some(ch) = chan_slot(reg) {
                    self.write_a0(ch, val);
                }
            }
            0xb => {
                if reg == 0xbd {
                    self.write_bd(val);
                } else if let Some(ch) = chan_slot(reg) {
                    self.write_b0(ch, val);
                }
            }
            0xc => {
                if let Some(ch) = chan_slot(reg) {
                    self.write_c0(ch, val);
                }
            }
            0xe | 0xf => {
                if let Some((ch, o)) = op_slot(reg) {
                    let (mask, opl3) = (self.wave_form_mask, self.opl3_active);
                    self.chan[ch].op[o].write_e0(mask, opl3, val);
                }
            }
            _ => {}
        }
    }

    /// The register an address write at `port` selects, as
    /// `Chip::WriteAddr`: the second bank's addresses (port + 2) reach
    /// 100h and up only in OPL3 mode, or for register 105h itself.
    pub fn write_addr(&self, port: u32, val: u8) -> u32 {
        match port & 3 {
            0 => val as u32,
            2 => {
                if self.opl3_active != 0 || val == 0x05 {
                    0x100 | val as u32
                } else {
                    val as u32
                }
            }
            _ => 0,
        }
    }

    /// Generates `total` mono samples into the start of `output`, as
    /// `Chip::GenerateBlock2`. `output` must have room for `2 * total`
    /// values, as the 1024-value buffer of `Handler::Generate` has for its
    /// 512 samples: when the rhythm channels keep their OPL3 handler after
    /// a switch back to OPL2 (with rhythm on), dbopl writes their samples
    /// in stereo positions, past the block, and the port does the same.
    pub fn generate_block2(&mut self, total: usize, output: &mut [i32]) {
        assert!(output.len() >= total * 2);
        let mut total = total as u32;
        let mut at = 0usize;
        while total > 0 {
            let samples = self.forward_lfo(total);
            output[at..at + samples as usize].fill(0);
            let mut ch = 0;
            while ch < 9 {
                ch = self.block(ch, samples as usize, &mut output[at..]);
            }
            total -= samples;
            at += samples as usize;
        }
    }

    /// Generates `total` stereo frames, interleaved left and right, into
    /// the start of `output`, as `Chip::GenerateBlock3`.
    pub fn generate_block3(&mut self, total: usize, output: &mut [i32]) {
        assert!(output.len() >= total * 2);
        let mut total = total as u32;
        let mut at = 0usize;
        while total > 0 {
            let samples = self.forward_lfo(total);
            output[at..at + samples as usize * 2].fill(0);
            let mut ch = 0;
            while ch < 18 {
                ch = self.block(ch, samples as usize, &mut output[at..]);
            }
            total -= samples;
            at += samples as usize * 2;
        }
    }

    // Calls the channel's synth handler; returns the next channel.
    fn block(&mut self, ch: usize, samples: usize, output: &mut [i32]) -> usize {
        match self.chan[ch].synth {
            SynthMode::Sm2Am => self.block_template::<SM2AM>(ch, samples, output),
            SynthMode::Sm2Fm => self.block_template::<SM2FM>(ch, samples, output),
            SynthMode::Sm3Am => self.block_template::<SM3AM>(ch, samples, output),
            SynthMode::Sm3Fm => self.block_template::<SM3FM>(ch, samples, output),
            SynthMode::Sm3FmFm => self.block_template::<SM3FMFM>(ch, samples, output),
            SynthMode::Sm3AmFm => self.block_template::<SM3AMFM>(ch, samples, output),
            SynthMode::Sm3FmAm => self.block_template::<SM3FMAM>(ch, samples, output),
            SynthMode::Sm3AmAm => self.block_template::<SM3AMAM>(ch, samples, output),
            SynthMode::Sm2Percussion => self.block_template::<SM2PERCUSSION>(ch, samples, output),
            SynthMode::Sm3Percussion => self.block_template::<SM3PERCUSSION>(ch, samples, output),
        }
    }

    #[inline]
    fn generate_percussion<const OPL3: bool>(&mut self, ch: usize, output: &mut [i32]) {
        // Bass drum.
        let channel = &mut self.chan[ch];
        let mut modulation =
            ((channel.old[0].wrapping_add(channel.old[1])) as u32 >> channel.feedback) as i32;
        channel.old[0] = channel.old[1];
        channel.old[1] = channel.op[0].get_sample(modulation);

        // When the bass drum is in AM mode the first operator is ignored.
        if channel.reg_c0 & 1 != 0 {
            modulation = 0;
        } else {
            modulation = channel.old[0];
        }
        let mut sample = channel.op[1].get_sample(modulation);

        // Precalculate what the other outputs use.
        let noise_bit = self.forward_noise() & 0x1;
        let c2 = self.op(ch, 2).forward_wave();
        let c5 = self.op(ch, 5).forward_wave();
        let phase_bit: u32 =
            if (((c2 & 0x88) ^ ((c2 << 5) & 0x80)) | ((c5 ^ (c5 << 2)) & 0x20)) != 0 {
                0x02
            } else {
                0x00
            };

        // Hi-hat.
        let hh_vol = self.op(ch, 2).forward_volume();
        if !env_silent_u(hh_vol) {
            let hh_index = (phase_bit << 8) | (0x34 << (phase_bit ^ (noise_bit << 1)));
            sample = sample.wrapping_add(self.op(ch, 2).get_wave(hh_index, hh_vol));
        }
        // Snare drum.
        let sd_vol = self.op(ch, 3).forward_volume();
        if !env_silent_u(sd_vol) {
            let sd_index = (0x100 + (c2 & 0x100)) ^ (noise_bit << 8);
            sample = sample.wrapping_add(self.op(ch, 3).get_wave(sd_index, sd_vol));
        }
        // Tom-tom.
        sample = sample.wrapping_add(self.op(ch, 4).get_sample(0));

        // Top cymbal.
        let tc_vol = self.op(ch, 5).forward_volume();
        if !env_silent_u(tc_vol) {
            let tc_index = (1 + phase_bit) << 8;
            sample = sample.wrapping_add(self.op(ch, 5).get_wave(tc_index, tc_vol));
        }
        sample = sample.wrapping_shl(1);
        if OPL3 {
            output[0] = output[0].wrapping_add(sample);
            output[1] = output[1].wrapping_add(sample);
        } else {
            output[0] = output[0].wrapping_add(sample);
        }
    }

    /// `Channel::BlockTemplate<mode>`: generates a block for the channel
    /// (and the channels it pairs with) and returns the next channel.
    #[allow(clippy::too_many_lines)] // One template, as in dbopl.
    fn block_template<const MODE: u8>(
        &mut self,
        ch: usize,
        samples: usize,
        output: &mut [i32],
    ) -> usize {
        let silent = match MODE {
            SM2AM | SM3AM => self.op(ch, 0).silent() && self.op(ch, 1).silent(),
            SM2FM | SM3FM => self.op(ch, 1).silent(),
            SM3FMFM => self.op(ch, 3).silent(),
            SM3AMFM => self.op(ch, 0).silent() && self.op(ch, 3).silent(),
            SM3FMAM => self.op(ch, 1).silent() && self.op(ch, 3).silent(),
            SM3AMAM => {
                self.op(ch, 0).silent() && self.op(ch, 2).silent() && self.op(ch, 3).silent()
            }
            _ => false,
        };
        if silent {
            self.chan[ch].old = [0, 0];
            return ch + if MODE > SM4START { 2 } else { 1 };
        }
        // Initialise the operators with the current vibrato and tremolo
        // values.
        let lfo = self.lfo();
        self.op(ch, 0).prepare(lfo);
        self.op(ch, 1).prepare(lfo);
        if MODE > SM4START {
            self.op(ch, 2).prepare(lfo);
            self.op(ch, 3).prepare(lfo);
        }
        if MODE > SM6START {
            self.op(ch, 4).prepare(lfo);
            self.op(ch, 5).prepare(lfo);
        }
        for i in 0..samples {
            // An early way out for the percussion handlers.
            if MODE == SM2PERCUSSION {
                self.generate_percussion::<false>(ch, &mut output[i..=i]);
                continue;
            } else if MODE == SM3PERCUSSION {
                self.generate_percussion::<true>(ch, &mut output[i * 2..i * 2 + 2]);
                continue;
            }

            // An unsigned shift, so all the bits can be shifted out while
            // otherwise staying in the 10-bit range.
            let channel = &mut self.chan[ch];
            let modulation =
                ((channel.old[0].wrapping_add(channel.old[1])) as u32 >> channel.feedback) as i32;
            channel.old[0] = channel.old[1];
            channel.old[1] = channel.op[0].get_sample(modulation);
            let out0 = channel.old[0];
            let sample: i32 = match MODE {
                SM2AM | SM3AM => out0.wrapping_add(channel.op[1].get_sample(0)),
                SM2FM | SM3FM => channel.op[1].get_sample(out0),
                SM3FMFM => {
                    let mut next = channel.op[1].get_sample(out0);
                    next = self.op(ch, 2).get_sample(next);
                    self.op(ch, 3).get_sample(next)
                }
                SM3AMFM => {
                    let mut sample = out0;
                    let mut next = channel.op[1].get_sample(0);
                    next = self.op(ch, 2).get_sample(next);
                    sample = sample.wrapping_add(self.op(ch, 3).get_sample(next));
                    sample
                }
                SM3FMAM => {
                    let mut sample = channel.op[1].get_sample(out0);
                    let next = self.op(ch, 2).get_sample(0);
                    sample = sample.wrapping_add(self.op(ch, 3).get_sample(next));
                    sample
                }
                SM3AMAM => {
                    let mut sample = out0;
                    let next = channel.op[1].get_sample(0);
                    sample = sample.wrapping_add(self.op(ch, 2).get_sample(next));
                    sample = sample.wrapping_add(self.op(ch, 3).get_sample(0));
                    sample
                }
                _ => 0,
            };
            match MODE {
                SM2AM | SM2FM => output[i] = output[i].wrapping_add(sample),
                _ => {
                    let (left, right) = (self.chan[ch].mask_left, self.chan[ch].mask_right);
                    output[i * 2] = output[i * 2].wrapping_add(sample & left as i32);
                    output[i * 2 + 1] = output[i * 2 + 1].wrapping_add(sample & right as i32);
                }
            }
        }
        match MODE {
            SM2AM | SM2FM | SM3AM | SM3FM => ch + 1,
            SM3FMFM | SM3AMFM | SM3FMAM | SM3AMAM => ch + 2,
            _ => ch + 3,
        }
    }

    fn setup(&mut self, rate: u32) {
        let original = OPLRATE;
        let scale = original / f64::from(rate);

        // The noise counter runs at the same precision as the waves.
        self.noise_add = (0.5 + scale * f64::from(1u32 << LFO_SH)) as u32;
        self.noise_counter = 0;
        // Make sure it triggers the noise XOR the first time.
        self.noise_value = 1;
        // The low-frequency oscillation counter: every time it overflows,
        // the vibrato and tremolo indices go up.
        self.lfo_add = (0.5 + scale * f64::from(1u32 << LFO_SH)) as u32;
        self.lfo_counter = 0;
        self.vibrato_index = 0;
        self.tremolo_index = 0;

        // Shifted up for higher octaves; -1 since FREQ_CREATE_TABLE is
        // doubled.
        let freq_scale = (0.5 + scale * f64::from(1u32 << (WAVE_SH - 1 - 10))) as u32;
        for (mul, &create) in self.rates.freq_mul.iter_mut().zip(&FREQ_CREATE_TABLE) {
            *mul = freq_scale.wrapping_mul(create as u32);
        }

        // -3 since the real envelope takes 8 steps to reach the single
        // value supplied.
        for i in 0..76u8 {
            let (index, shift) = envelope_select(i);
            let increase = (ENVELOPE_INCREASE_TABLE[index as usize] as i32)
                << (RATE_SH + ENV_EXTRA - shift as u32 - 3);
            self.rates.linear_rates[i as usize] = (scale * f64::from(increase)) as u32;
        }
        // Generate the best-matching attack rates.
        for i in 0..62u8 {
            let (index, shift) = envelope_select(i);
            // The original number of samples the attack would take.
            let original = (f64::from((ATTACK_SAMPLES_TABLE[index as usize] as i32) << shift)
                / scale) as u32 as i32;

            let increase =
                (ENVELOPE_INCREASE_TABLE[index as usize] as i32) << (RATE_SH - shift as u32 - 3);
            let mut guess_add = (scale * f64::from(increase)) as u32 as i32;
            let mut best_add = guess_add;
            let mut best_diff: u32 = 1 << 30;
            for _passes in 0..16 {
                let mut volume: i32 = ENV_MAX;
                let mut samples: i32 = 0;
                let mut count: u32 = 0;
                while volume > 0 && samples < original.wrapping_mul(2) {
                    count = count.wrapping_add(guess_add as u32);
                    let change = (count >> RATE_SH) as i32;
                    count &= RATE_MASK;
                    if change != 0 {
                        volume = volume.wrapping_add((!volume).wrapping_mul(change) >> 3);
                    }
                    samples += 1;
                }
                let diff = original.wrapping_sub(samples);
                let l_diff = diff.unsigned_abs();
                // Initialise the best on the first pass.
                if l_diff < best_diff {
                    best_diff = l_diff;
                    best_add = guess_add;
                    if best_diff == 0 {
                        break;
                    }
                }
                // C's signed overflow wraps on the machines DOSBox runs on;
                // the port wraps the same way.
                if diff < 0 {
                    // Below the target.
                    let mul = original.wrapping_sub(diff).wrapping_shl(12) / original;
                    guess_add = guess_add.wrapping_mul(mul) >> 12;
                    guess_add = guess_add.wrapping_add(1);
                } else if diff > 0 {
                    let mul = original.wrapping_sub(diff).wrapping_shl(12) / original;
                    guess_add = guess_add.wrapping_mul(mul) >> 12;
                    guess_add = guess_add.wrapping_sub(1);
                }
            }
            self.rates.attack_rates[i as usize] = best_add as u32;
        }
        for i in 62..76 {
            // Instant volume maximising.
            self.rates.attack_rates[i] = 8 << RATE_SH;
        }
        // Set up the channels with the right four-operator flags; the
        // channels are reached through a table, so they appear linear here.
        self.chan[0].four_mask = 1 << 0;
        self.chan[1].four_mask = 0x80 | (1 << 0);
        self.chan[2].four_mask = 1 << 1;
        self.chan[3].four_mask = 0x80 | (1 << 1);
        self.chan[4].four_mask = 1 << 2;
        self.chan[5].four_mask = 0x80 | (1 << 2);

        self.chan[9].four_mask = 1 << 3;
        self.chan[10].four_mask = 0x80 | (1 << 3);
        self.chan[11].four_mask = 1 << 4;
        self.chan[12].four_mask = 0x80 | (1 << 4);
        self.chan[13].four_mask = 1 << 5;
        self.chan[14].four_mask = 0x80 | (1 << 5);

        // Mark the percussion channels.
        self.chan[6].four_mask = 0x40;
        self.chan[7].four_mask = 0x40;
        self.chan[8].four_mask = 0x40;

        // Clear everything in OPL3 mode.
        self.write_reg(0x105, 0x1);
        for i in 0..512 {
            if i == 0x105 {
                continue;
            }
            self.write_reg(i, 0xff);
            self.write_reg(i, 0x0);
        }
        self.write_reg(0x105, 0x0);
        // Clear everything in OPL2 mode.
        for i in 0..255 {
            self.write_reg(i, 0xff);
            self.write_reg(i, 0x0);
        }
    }

    /// The chip's rate tables, for comparison with DOSBox's: the LFO and
    /// noise steps, the 16 frequency multipliers, the 76 linear rates and
    /// the 76 attack rates.
    pub fn rate_tables(&self) -> Vec<u32> {
        let mut out = vec![self.lfo_add, self.noise_add];
        out.extend_from_slice(&self.rates.freq_mul);
        out.extend_from_slice(&self.rates.linear_rates);
        out.extend_from_slice(&self.rates.attack_rates);
        out
    }
}

// `REGOP`: the operator an operator register addresses.
#[inline]
fn op_slot(reg: u32) -> Option<(usize, usize)> {
    let index = ((reg >> 3) & 0x20) | (reg & 0x1f);
    match OP_OFFSET_TABLE[index as usize] {
        NONE => None,
        slot => Some(((slot >> 1) as usize, (slot & 1) as usize)),
    }
}

// `REGCHAN`: the channel a channel register addresses.
#[inline]
fn chan_slot(reg: u32) -> Option<usize> {
    let index = ((reg >> 4) & 0x10) | (reg & 0xf);
    match CHAN_OFFSET_TABLE[index as usize] {
        NONE => None,
        ch => Some(ch as usize),
    }
}

/// The most samples one [`Handler::generate`] call gives, as the buffer in
/// `DBOPL::Handler::Generate`.
pub const MAX_GENERATE: usize = 512;

/// `DBOPL::Handler`: the chip as DOSBox's Adlib module drives it.
#[derive(Clone, Debug)]
pub struct Handler {
    /// The chip itself.
    pub chip: Chip,
}

impl Handler {
    /// A handler at `rate` Hz, as `Handler::Init(rate)`.
    pub fn new(rate: u32) -> Self {
        Self {
            chip: Chip::new(rate),
        }
    }

    /// The register an address write selects; see [`Chip::write_addr`].
    pub fn write_addr(&self, port: u32, val: u8) -> u32 {
        self.chip.write_addr(port, val)
    }

    /// Writes a register; see [`Chip::write_reg`].
    pub fn write_reg(&mut self, reg: u32, val: u8) {
        self.chip.write_reg(reg, val);
    }

    /// `Handler::Generate(chan, samples)`: generates up to
    /// [`MAX_GENERATE`] samples (DOSBox drops what is asked beyond that)
    /// and appends them to `out` — mono samples, or interleaved left and
    /// right when the OPL3 bit is on. Returns the number of samples (or
    /// frames) generated.
    pub fn generate(&mut self, samples: usize, out: &mut Vec<i32>) -> usize {
        let samples = samples.min(MAX_GENERATE);
        let mut buffer = [0i32; MAX_GENERATE * 2];
        if self.chip.opl3_active() {
            self.chip.generate_block3(samples, &mut buffer);
            out.extend_from_slice(&buffer[..samples * 2]);
        } else {
            self.chip.generate_block2(samples, &mut buffer);
            out.extend_from_slice(&buffer[..samples]);
        }
        samples
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The constants are what dbopl's expressions give with this platform's
    // maths library, which on Linux is the glibc DOSBox runs on.
    #[test]
    #[cfg(not(target_family = "wasm"))]
    fn float_tables_match_dbopl_expressions() {
        // dbopl's PI, 3.14159265358979323846, is this same double.
        use std::f64::consts::PI;
        for (i, &v) in SINE.iter().enumerate() {
            let s = ((f64::from(i as u32) + 0.5) * (PI / 512.0)).sin() * 4084.0;
            assert_eq!(v, s as i16, "sine {i}");
        }
        for (i, &v) in EXPONENTIAL.iter().enumerate() {
            let e = 2.0f64.powf(-1.0 + f64::from(255 - i as i32 * 8) * (1.0 / 256.0));
            assert_eq!(v, (0.5 + e * 4085.0) as i16, "exponential {i}");
        }
        for (i, &v) in MUL.iter().enumerate() {
            let s = i as i32 * 8;
            let val = 0.5
                + 2.0f64.powf(-1.0 + f64::from(255 - s) * (1.0 / 256.0)) * f64::from(1 << MUL_SH);
            assert_eq!(v, val as u16, "mul {i}");
        }
    }

    #[test]
    fn register_slots_follow_the_four_operator_order() {
        // 20h-22h are channels 0-2's first operators; channel 0 is chip
        // channel 0, channel 1 is chip channel 2 and channel 2 is chip
        // channel 4, so that four-operator pairs follow each other.
        assert_eq!(op_slot(0x20), Some((0, 0)));
        assert_eq!(op_slot(0x21), Some((2, 0)));
        assert_eq!(op_slot(0x23), Some((0, 1)));
        assert_eq!(op_slot(0x28), Some((1, 0)));
        assert_eq!(op_slot(0x30), Some((6, 0)));
        assert_eq!(op_slot(0x35), Some((8, 1)));
        assert_eq!(op_slot(0x36), None);
        assert_eq!(op_slot(0x38), None);
        assert_eq!(op_slot(0x120), Some((9, 0)));
        assert_eq!(chan_slot(0xa0), Some(0));
        assert_eq!(chan_slot(0xa1), Some(2));
        assert_eq!(chan_slot(0xa3), Some(1));
        assert_eq!(chan_slot(0xa8), Some(8));
        assert_eq!(chan_slot(0xa9), None);
        assert_eq!(chan_slot(0x1a8), Some(17));
    }
}
