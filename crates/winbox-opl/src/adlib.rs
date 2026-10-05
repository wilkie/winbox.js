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

//! The Ad Lib as a program sees it: DOSBox's Adlib module, ported from
//! DOSBox 0.74-3's src/hardware/adlib.cpp (`$Id: adlib.cpp,v 1.42
//! 2009-11-03 20:17:42 qbix79 Exp $`) and adlib.h (`$Id: adlib.h,v 1.5
//! 2009-04-28 21:45:43 c2woody Exp $`): the address and data ports, the
//! two timers and the status register that drivers poll to find the card,
//! and the mixer callback that runs the chip and switches it off after 30
//! seconds of silence.
//!
//! Left out: the DRO capture (`Capture`) and the RAD instrument dump, which
//! only write files; the MAME-derived "compat" cores, which DOSBox uses
//! only when `oplemu=compat` is set.
//!
//! DOSBox models no write delays: a register write takes effect at once,
//! and the samples it changes are the ones the mixer next asks for. Times
//! are in milliseconds of emulated time, DOSBox's `PIC_FullIndex()`; its
//! whole part is `PIC_Ticks`.

// `port & 3 == 0` reads as the C it ports, more than `trailing_zeros` would.
#![allow(clippy::verbose_bit_mask)]

use crate::dbopl::Handler;

/// Which chips the card has, as `Adlib::Mode`. DOSBox picks it from
/// `oplmode`, and when that is `auto` (the default) from `sbtype`: `sb1`
/// and `sb2` get [`Mode::Opl2`], `sbpro1` [`Mode::DualOpl2`], and `sbpro2`
/// and `sb16` [`Mode::Opl3`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// One OPL2: an Ad Lib, or the FM part of a Sound Blaster 1 or 2.
    Opl2,
    /// Two OPL2s, left and right: the Sound Blaster Pro 1.
    DualOpl2,
    /// One OPL3: the Sound Blaster Pro 2 and 16.
    Opl3,
}

impl Mode {
    /// Whether DOSBox's module answers a write to `port`, given the Sound
    /// Blaster's `base` (`sbbase`, 220h by default): 388h-38Bh always,
    /// `base`-`base`+3 except in [`Mode::Opl2`], and `base`+8 and +9.
    ///
    /// With `sbtype=sb1` or `sb2`, the mode is [`Mode::Opl2`] and DOSBox
    /// gives `base`-`base`+3 to the Game Blaster (CMS) chips instead.
    pub fn decodes_write(self, base: u16, port: u16) -> bool {
        (0x388..=0x38b).contains(&port)
            || (self != Mode::Opl2 && (base..=base + 3).contains(&port))
            || (base + 8..=base + 9).contains(&port)
    }

    /// Whether DOSBox's module answers a read of `port`: as
    /// [`Mode::decodes_write`], except that only `base`+8 of the pair at
    /// `base`+8 reads.
    pub fn decodes_read(self, base: u16, port: u16) -> bool {
        (0x388..=0x38b).contains(&port)
            || (self != Mode::Opl2 && (base..=base + 3).contains(&port))
            || port == base + 8
    }
}

/// One of the chip's two timers, as `Adlib::Timer`.
#[derive(Clone, Copy, Debug, Default)]
struct Timer {
    start: f64,
    delay: f64,
    enabled: bool,
    overflow: bool,
    masked: bool,
    counter: u8,
}

impl Timer {
    // Call update before making any further changes.
    fn update(&mut self, time: f64) {
        if !self.enabled || self.delay == 0.0 {
            return;
        }
        let delta_start = time - self.start;
        // Only set the overflow flag when not masked.
        if delta_start >= 0.0 && !self.masked {
            self.overflow = true;
        }
    }

    // On a reset make sure the start is in sync with the next cycle.
    fn reset(&mut self, time: f64) {
        self.overflow = false;
        if self.delay == 0.0 || !self.enabled {
            return;
        }
        let delta = time - self.start;
        // `%` on floats is C's `fmod`.
        let rem = delta % self.delay;
        let next = self.delay - rem;
        self.start = time + next;
    }

    fn stop(&mut self) {
        self.enabled = false;
    }

    fn start(&mut self, time: f64, scale: i32) {
        // Don't enable again.
        if self.enabled {
            return;
        }
        self.enabled = true;
        self.delay = 0.001 * f64::from(256 - i32::from(self.counter)) * f64::from(scale);
        self.start = time + self.delay;
    }
}

/// The timer half of a chip, as `Adlib::Chip`.
#[derive(Clone, Copy, Debug, Default)]
struct TimerChip {
    timer: [Timer; 2],
}

impl TimerChip {
    // Whether the write was to a timer register.
    fn write(&mut self, reg: u32, val: u8, time: f64) -> bool {
        match reg {
            0x02 => {
                self.timer[0].counter = val;
                true
            }
            0x03 => {
                self.timer[1].counter = val;
                true
            }
            0x04 => {
                if val & 0x80 != 0 {
                    self.timer[0].reset(time);
                    self.timer[1].reset(time);
                } else {
                    self.timer[0].update(time);
                    self.timer[1].update(time);
                    if val & 0x1 != 0 {
                        // 80 microseconds a count.
                        self.timer[0].start(time, 80);
                    } else {
                        self.timer[0].stop();
                    }
                    self.timer[0].masked = (val & 0x40) > 0;
                    if self.timer[0].masked {
                        self.timer[0].overflow = false;
                    }
                    if val & 0x2 != 0 {
                        // 320 microseconds a count.
                        self.timer[1].start(time, 320);
                    } else {
                        self.timer[1].stop();
                    }
                    self.timer[1].masked = (val & 0x20) > 0;
                    if self.timer[1].masked {
                        self.timer[1].overflow = false;
                    }
                }
                true
            }
            _ => false,
        }
    }

    // The status register.
    fn read(&mut self, time: f64) -> u8 {
        self.timer[0].update(time);
        self.timer[1].update(time);
        let mut ret = 0;
        // Overflow won't be set if a channel is masked.
        if self.timer[0].overflow {
            ret |= 0x40;
            ret |= 0x80;
        }
        if self.timer[1].overflow {
            ret |= 0x20;
            ret |= 0x80;
        }
        ret
    }
}

/// How long DOSBox lets the FM channel run without a write and without a
/// key held before it switches the channel off, in milliseconds.
pub const SILENCE_OFF_MS: u32 = 30_000;

/// DOSBox's Adlib module: the ports, the timers and the dbopl chip behind
/// them, as `Adlib::Module` with DOSBox's default `oplemu`.
#[derive(Clone, Debug)]
pub struct Adlib {
    mode: Mode,
    rate: u32,
    // The last address selected, in OPL2 and OPL3 modes.
    reg_normal: u32,
    // The last address selected on each chip, in dual-OPL2 mode.
    reg_dual: [u8; 2],
    handler: Handler,
    chip: [TimerChip; 2],
    cache: [u8; 512],
    // `PIC_Ticks` at the last write.
    last_used: u32,
    // Whether the mixer channel is on: the chip only runs while it is.
    enabled: bool,
}

impl Adlib {
    /// A card in `mode` whose chip generates `rate` samples a second
    /// (DOSBox's `oplrate`, 44100 by default; DOSBox raises anything under
    /// 8000 to 8000).
    pub fn new(mode: Mode, rate: u32) -> Self {
        let rate = rate.max(8000);
        let mut adlib = Self {
            mode,
            rate,
            reg_normal: 0,
            reg_dual: [0, 0],
            handler: Handler::new(rate),
            chip: [TimerChip::default(); 2],
            cache: [0; 512],
            last_used: 0,
            enabled: false,
        };
        if mode == Mode::DualOpl2 {
            // Set up OPL3 mode in the handler, and in the cache.
            adlib.handler.write_reg(0x105, 1);
            adlib.cache_write(0x105, 1);
        }
        adlib
    }

    /// The card's mode.
    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// The chip's sample rate.
    pub fn rate(&self) -> u32 {
        self.rate
    }

    /// The dbopl handler behind the ports.
    pub fn handler(&self) -> &Handler {
        &self.handler
    }

    /// Whether the samples come as left and right pairs: in
    /// [`Mode::DualOpl2`], and in [`Mode::Opl3`] once a program sets the
    /// OPL3 bit.
    pub fn stereo(&self) -> bool {
        self.handler.chip.opl3_active()
    }

    /// Whether DOSBox's FM mixer channel is on. It goes on at the first
    /// port write and off after [`SILENCE_OFF_MS`] without a write while
    /// no key is held; while it is off the chip does not run.
    pub fn enabled(&self) -> bool {
        self.enabled
    }

    fn cache_write(&mut self, reg: u32, val: u8) {
        self.cache[reg as usize] = val;
    }

    fn dual_write(&mut self, index: usize, reg: u8, mut val: u8, time: f64) {
        // Make sure the OPL3 features aren't used: a write can't disable
        // OPL3 mode.
        if reg == 5 {
            return;
        }
        // Only allow 4 waveforms.
        if reg >= 0xe0 {
            val &= 3;
        }
        // A write to the timers?
        if self.chip[index].write(u32::from(reg), val, time) {
            return;
        }
        // Panning: the first chip left, the second right.
        if (0xc0..=0xc8).contains(&reg) {
            val &= 0x0f;
            val |= if index != 0 { 0xa0 } else { 0x50 };
        }
        let full_reg = u32::from(reg) + if index != 0 { 0x100 } else { 0 };
        self.handler.write_reg(full_reg, val);
        self.cache_write(full_reg, val);
    }

    /// A write of `val` to `port` at `now` milliseconds, as
    /// `Module::PortWrite`: odd ports take data, even ports an address.
    pub fn write(&mut self, port: u16, val: u8, now: f64) {
        // Keep track of the last write time.
        self.last_used = pic_ticks(now);
        self.enabled = true;
        let port = u32::from(port);
        if port & 1 != 0 {
            match self.mode {
                Mode::Opl2 | Mode::Opl3 => {
                    if !self.chip[0].write(self.reg_normal, val, now) {
                        self.handler.write_reg(self.reg_normal, val);
                        self.cache_write(self.reg_normal, val);
                    }
                }
                Mode::DualOpl2 => {
                    // Not a ??8h port: write to one chip.
                    if port & 0x8 == 0 {
                        let index = ((port & 2) >> 1) as usize;
                        self.dual_write(index, self.reg_dual[index], val, now);
                    } else {
                        // Write to both.
                        self.dual_write(0, self.reg_dual[0], val, now);
                        self.dual_write(1, self.reg_dual[1], val, now);
                    }
                }
            }
        } else {
            // Ask the handler to write the address, clipped to the range.
            match self.mode {
                Mode::Opl2 => self.reg_normal = self.handler.write_addr(port, val) & 0xff,
                Mode::Opl3 => self.reg_normal = self.handler.write_addr(port, val) & 0x1ff,
                Mode::DualOpl2 => {
                    // Not a ??8h port: the address of one chip.
                    if port & 0x8 == 0 {
                        let index = ((port & 2) >> 1) as usize;
                        self.reg_dual[index] = val;
                    } else {
                        self.reg_dual[0] = val;
                        self.reg_dual[1] = val;
                    }
                }
            }
        }
    }

    /// A read of `port` at `now` milliseconds, as `Module::PortRead`: the
    /// status register (timer flags in bits 7, 6 and 5; an OPL2 also sets
    /// bits 2 and 1) on the address ports, and `0xff` on the others.
    pub fn read(&mut self, port: u16, now: f64) -> u8 {
        match self.mode {
            Mode::Opl2 => {
                // Four ports are allocated; the higher ones give FFh.
                if port & 3 == 0 {
                    // Make sure the low bits are 6 on an OPL2.
                    self.chip[0].read(now) | 0x6
                } else {
                    0xff
                }
            }
            Mode::Opl3 => {
                if port & 3 == 0 {
                    self.chip[0].read(now)
                } else {
                    0xff
                }
            }
            Mode::DualOpl2 => {
                // Only the lower ports answer.
                if port & 1 != 0 {
                    0xff
                } else {
                    self.chip[((port >> 1) & 1) as usize].read(now) | 0x6
                }
            }
        }
    }

    /// `OPL_CallBack(len)`: what DOSBox's mixer calls for `len` more
    /// samples at `now` milliseconds. Generates up to 512 samples (frames
    /// in stereo) onto `out` and returns how many; then, as DOSBox does,
    /// switches the channel off after [`SILENCE_OFF_MS`] without a write
    /// while no key is on.
    pub fn callback(&mut self, len: usize, now: f64, out: &mut Vec<i32>) -> usize {
        let done = self.handler.generate(len, out);
        // Disable the sound generation after 30 seconds of silence.
        let ticks = pic_ticks(now);
        if ticks.wrapping_sub(self.last_used) > SILENCE_OFF_MS {
            let keyed = (0xb0..0xb9)
                .any(|i| self.cache[i] & 0x20 != 0 || self.cache[i + 0x100] & 0x20 != 0);
            if keyed {
                self.last_used = ticks;
            } else {
                self.enabled = false;
            }
        }
        done
    }

    /// `MixerChannel::Mix` for the FM channel when the chip's rate is the
    /// mixer's (both 44100 by default): `frames` samples (frames in
    /// stereo) for one go of the mixer at `now` milliseconds, asked of
    /// [`Adlib::callback`] in pieces of at most 512, appended to `out`.
    /// While the channel is off, the chip does not run and the frames are
    /// silence (zeros).
    pub fn mix(&mut self, frames: usize, now: f64, out: &mut Vec<i32>) {
        let mut done = 0;
        while self.enabled && frames > done {
            done += self.callback(frames - done, now, out);
        }
        let width = if self.stereo() { 2 } else { 1 };
        out.resize(out.len() + (frames - done) * width, 0);
    }

    /// Generates `n` samples (frames in stereo) straight from the chip,
    /// in pieces of at most 512 as DOSBox's mixer asks for them, whether
    /// or not the mixer channel is on.
    pub fn generate(&mut self, n: usize) -> Vec<i32> {
        let mut out = Vec::with_capacity(n * 2);
        let mut done = 0;
        while done < n {
            done += self.handler.generate(n - done, &mut out);
        }
        out
    }
}

/// `PIC_Ticks` for a `PIC_FullIndex()` of `now` milliseconds.
fn pic_ticks(now: f64) -> u32 {
    now.floor() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    // The detection drivers do: reset both timers' flags, start timer 1 at
    // FFh (80 microseconds), wait, read the status.
    #[test]
    fn timer_1_overflows_after_80_microseconds() {
        let mut card = Adlib::new(Mode::Opl2, 44100);
        let write = |card: &mut Adlib, reg: u8, val: u8, t: f64| {
            card.write(0x388, reg, t);
            card.write(0x389, val, t);
        };
        write(&mut card, 4, 0x60, 0.0);
        write(&mut card, 4, 0x80, 0.0);
        assert_eq!(card.read(0x388, 0.0) & 0xe0, 0);
        write(&mut card, 2, 0xff, 1.0);
        write(&mut card, 4, 0x21, 1.0);
        assert_eq!(card.read(0x388, 1.05), 0x06);
        assert_eq!(card.read(0x388, 1.09), 0xc6);
        write(&mut card, 4, 0x60, 2.0);
        write(&mut card, 4, 0x80, 2.0);
        assert_eq!(card.read(0x388, 2.0), 0x06);
        assert_eq!(card.read(0x389, 2.0), 0xff);
    }

    #[test]
    fn sb2_ports() {
        assert!(Mode::Opl2.decodes_write(0x220, 0x228));
        assert!(Mode::Opl2.decodes_write(0x220, 0x229));
        assert!(Mode::Opl2.decodes_read(0x220, 0x228));
        assert!(!Mode::Opl2.decodes_read(0x220, 0x229));
        assert!(!Mode::Opl2.decodes_write(0x220, 0x220));
        assert!(Mode::Opl3.decodes_write(0x220, 0x223));
        assert!(Mode::Opl2.decodes_read(0x220, 0x38b));
    }

    #[test]
    fn the_channel_goes_off_after_30_silent_seconds() {
        let mut card = Adlib::new(Mode::Opl2, 44100);
        let mut out = Vec::new();
        card.mix(44, 0.0, &mut out);
        assert!(!card.enabled());
        assert_eq!(out, vec![0; 44]);
        card.write(0x388, 0x20, 1.0);
        assert!(card.enabled());
        card.mix(44, 30_001.0, &mut out);
        assert!(card.enabled());
        card.mix(44, 30_001.5, &mut out);
        assert!(card.enabled());
        card.mix(44, 30_002.0, &mut out);
        assert!(!card.enabled());
    }
}
