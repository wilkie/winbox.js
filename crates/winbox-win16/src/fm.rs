//! The machine's FM chip: the Ad Lib's OPL2, at ports 388h to 38Bh, and
//! the Sound Blaster 2.0's way to it at 228h and 229h, as the oracle's
//! DOSBox has it (`sbtype=sb2`, `oplmode=auto`: one OPL2). It is
//! `winbox_opl`'s port of DOSBox 0.74-3's own (`kb/topics/adlib.md`, "The
//! reference"): its ports and timers, and its sound, sample for sample.
//!
//! Two write to it: a program's own `IN` and `OUT` (`ports.rs`), and WinBox's
//! synthesizer (`wbsound/synth.rs`), which writes what Windows' Ad Lib
//! driver writes, each write taking what the driver's delay loops take on
//! the machine's clock (`DriverChip`).
//!
//! Its sound is made as DOSBox's mixer makes it: a millisecond at a time,
//! once the millisecond is over, so that every write made within a
//! millisecond is in force for the whole of it -- 44 or 45 samples a
//! millisecond, 44,100 a second (`MixerTicks`), each through the FM
//! channel's way into the mix (`FmOutput`) -- and handed to the host as
//! `Sound::Fm`. Only while there is a host to hear it, and only while
//! DOSBox's FM channel is on: from a write until 30 seconds pass with no
//! write and no key held (`Adlib::enabled`). A machine that never sounds
//! its chip, or has no host, makes no samples, and pays nothing for it.

use winbox_opl::mixer::{FmOutput, MixerTicks};
use winbox_opl::{Adlib, Mode};

use crate::audio::Sound;
use crate::system::System;
use crate::wbsound::synth::Chip;

/// The rate the chip and the mixer run at: DOSBox's `oplrate` and `rate`.
pub const RATE: u32 = 44_100;

/// The Sound Blaster's base port, whose +8 and +9 reach the chip.
pub const SOUND_BLASTER: u16 = 0x220;

/// How many milliseconds of samples are handed to the host at a time.
const HANDED: usize = 10;

/// What a write of the Ad Lib driver's takes, in the machine's
/// instructions, as DOSBox at a fixed 3,000 cycles a millisecond took it
/// with the driver's delay of 41 (a 486's): 90 from the register's number
/// to its value, the routine's first delay loop (seg1 `6`); and 618 from
/// the value to the next number, the routine's second loop -- at least 587
/// -- and its caller's own code, which runs from 589 to 757 by caller and
/// is 618 on average over the three traces' 3,480 writes made back to back
/// (`oracle/fixtures/opl/*-trace.json`; `kb/topics/adlib.md`, "Writing to
/// the chip").
pub const ADDRESS_DELAY: f64 = 90.0;
pub const VALUE_DELAY: f64 = 618.0;

/// A port of the chip's read or written, as a log of them keeps it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Access {
    /// The machine's time, in milliseconds.
    pub at: f64,
    pub port: u16,
    pub value: u8,
    pub read: bool,
}

/// The chip, and where its sound has been made to.
#[derive(Debug, Clone)]
pub struct Fm {
    pub adlib: Adlib,
    output: FmOutput,
    ticks: MixerTicks,
    /// The next millisecond whose samples are to be made.
    made: u64,
    /// Samples made and not yet handed over, and the millisecond the first
    /// of them is of.
    pending: Vec<i16>,
    pending_at: u64,
    chip: Vec<i32>,
    /// Every access to the chip's ports, where kept.
    pub log: Option<Vec<Access>>,
}

impl Default for Fm {
    fn default() -> Self {
        Self::new()
    }
}

impl Fm {
    pub fn new() -> Self {
        Self {
            adlib: Adlib::new(Mode::Opl2, RATE),
            output: FmOutput::new(),
            ticks: MixerTicks::new(RATE),
            made: 0,
            pending: Vec::new(),
            pending_at: 0,
            chip: Vec::new(),
            log: None,
        }
    }

    /// The mixer's remainder as the machine started (`MixerTicks`): where
    /// in its pattern of 44 and 45 samples a millisecond DOSBox's mixer
    /// was, which nothing a program does can tell, so nought unless set.
    pub fn set_phase(&mut self, remain: u32) {
        self.ticks = MixerTicks::with_remain(RATE, remain);
    }

    /// Whether a program's `port` reaches the chip, written or read.
    pub fn decodes(port: u16, read: bool) -> bool {
        if read {
            Mode::Opl2.decodes_read(SOUND_BLASTER, port)
        } else {
            Mode::Opl2.decodes_write(SOUND_BLASTER, port)
        }
    }

    /// A port written at `at`, the machine's milliseconds.
    pub fn write(&mut self, port: u16, value: u8, at: f64) {
        if let Some(log) = self.log.as_mut() {
            log.push(Access {
                at,
                port,
                value,
                read: false,
            });
        }

        self.adlib.write(port, value, at);
    }

    /// A port read at `at`.
    pub fn read(&mut self, port: u16, at: f64) -> u8 {
        let value = self.adlib.read(port, at);

        if let Some(log) = self.log.as_mut() {
            log.push(Access {
                at,
                port,
                value,
                read: true,
            });
        }

        value
    }

    /// The samples of each millisecond before `until` made, as DOSBox's
    /// mixer makes them at each tick, while its FM channel is on; what is
    /// made handed to `hand` in pieces of `HANDED` milliseconds, and the
    /// rest when the channel goes off. With `sounding` false, nothing is
    /// made: the milliseconds are passed over.
    #[allow(clippy::cast_precision_loss)]
    pub fn make_until(&mut self, until: u64, sounding: bool, hand: &mut dyn FnMut(Sound)) {
        while self.made < until {
            if !sounding || !self.adlib.enabled() {
                self.flush(hand);
                self.made = until;
                return;
            }

            let tick = self.made;
            let count = (self.ticks.before(tick + 1) - self.ticks.before(tick)) as usize;

            if self.pending.is_empty() {
                self.pending_at = tick;
            }

            self.chip.clear();
            // DOSBox's mixer runs its channels at the tick that ends the
            // millisecond.
            self.adlib.mix(count, (tick + 1) as f64, &mut self.chip);

            for &sample in &self.chip {
                self.pending.push(self.output.mono(sample));
            }

            self.made += 1;

            if self.made - self.pending_at >= HANDED as u64 || !self.adlib.enabled() {
                self.flush(hand);
            }
        }
    }

    fn flush(&mut self, hand: &mut dyn FnMut(Sound)) {
        if self.pending.is_empty() {
            return;
        }

        #[allow(clippy::cast_precision_loss)]
        hand(Sound::Fm {
            at: self.pending_at as f64,
            rate: f64::from(RATE),
            samples: std::mem::take(&mut self.pending),
        });
    }
}

impl System {
    /// The machine's time to a fraction of a millisecond.
    fn precise_now(&self) -> f64 {
        self.clock.precise(self.instructions)
    }

    /// The chip's sound made up to the millisecond under way, and handed to
    /// the host: from between two slices of the program's instructions
    /// (`poll_sound`), and before each write, so the write changes only
    /// the samples of its own millisecond on.
    pub(crate) fn poll_fm(&mut self) {
        if !self.fm.adlib.enabled() && self.fm.pending.is_empty() {
            return;
        }

        let until = self.precise_now().floor().max(0.0) as u64;

        self.fm_until(until);
    }

    fn fm_until(&mut self, until: u64) {
        let sounding = self.host.is_some();
        let mut handed = Vec::new();

        self.fm
            .make_until(until, sounding, &mut |sound| handed.push(sound));

        for sound in handed {
            self.sound(&sound);
        }
    }

    /// A port of the chip's written, now.
    pub fn fm_write(&mut self, port: u16, value: u8) {
        let at = self.precise_now();

        self.fm_until(at.floor().max(0.0) as u64);
        self.fm.write(port, value, at);
    }

    /// A port of the chip's read, now.
    pub fn fm_read(&mut self, port: u16) -> u8 {
        let at = self.precise_now();

        self.fm.read(port, at)
    }
}

/// The chip as WinBox's synthesizer writes to it: through ports 388h and
/// 389h, each write taking the driver's delays on the machine's clock.
#[derive(Debug)]
pub struct DriverChip<'a>(pub &'a mut System);

impl Chip for DriverChip<'_> {
    fn write(&mut self, register: u8, value: u8) {
        self.0.fm_write(0x388, register);
        self.0.clock.charge(ADDRESS_DELAY);
        self.0.fm_write(0x389, value);
        self.0.clock.charge(VALUE_DELAY);
    }

    fn status(&mut self) -> u8 {
        self.0.fm_read(0x388)
    }

    fn count(&mut self, count: u32) {
        self.0.clock.charge(f64::from(count));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wbsound::synth::Synth;

    /// The Ad Lib driver finds the card by its timers, its writes taking
    /// their time on the survey's clock, 3,000 instructions a millisecond,
    /// as on the oracle's DOSBox: the timer's 80 microseconds are past by
    /// the second read.
    #[test]
    fn the_driver_finds_the_card_on_the_clock() {
        let mut system = System::new();
        let mut synth = Synth::new();

        system.fm.log = Some(Vec::new());

        assert!(synth.enable(&mut DriverChip(&mut system)));

        let log = system.fm.log.take().unwrap();
        let reads: Vec<u8> = log
            .iter()
            .filter(|access| access.read)
            .map(|access| access.value)
            .collect();
        let writes = log.iter().filter(|access| !access.read).count() / 2;

        assert_eq!(reads, [0x06, 0xc6]);
        // The six that look for the card, and the reset's 43, its
        // F-numbers worked out between them.
        let f_numbers = f64::from(crate::wbsound::synth::costs::F_NUMBERS);

        assert_eq!(writes, 49);
        assert!(
            (system.clock.precise(0) - (49.0 * 708.0 + 599.0 + f_numbers) / 3000.0).abs() < 1e-9
        );
        // Waveforms allowed last.
        assert_eq!(
            log.last().map(|access| (access.port, access.value)),
            Some((0x389, 0x20))
        );
    }

    /// The ports a program reaches the chip at: the Ad Lib's, and the
    /// Sound Blaster 2.0's +8 and +9.
    #[test]
    fn the_chip_is_at_388h_and_228h() {
        assert!(Fm::decodes(0x388, true) && Fm::decodes(0x389, false));
        assert!(Fm::decodes(0x228, true) && Fm::decodes(0x229, false));
        assert!(!Fm::decodes(0x229, true) && !Fm::decodes(0x220, false));
    }
}
