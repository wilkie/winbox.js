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

//! The parts of DOSBox's mixer that decide what becomes of the FM
//! channel's samples, ported from DOSBox 0.74-3's src/hardware/mixer.cpp:
//! how many samples each 1 ms tick asks for (`MIXER_Mix`), and how a
//! sample reaches the output and a captured .wav (`AddSamples`, the FM
//! channel's scale of 2 from adlib.cpp, `MIXER_CLIP`), for the case of a
//! chip rate equal to the mixer rate (`oplrate` and `rate` are both 44100
//! by default), with the channel and master volumes at 100 and no other
//! channel sounding.

const MIXER_SHIFT: u32 = 14;
const MIXER_REMAIN: u32 = (1 << MIXER_SHIFT) - 1;
const MIXER_VOLSHIFT: u32 = 13;

/// How many samples each 1 ms tick of DOSBox's mixer asks for: the
/// mixer's `tick_add` and `tick_remain`, at a constant `tick_add`, which
/// is what DOSBox keeps while it captures a .wav (otherwise it nudges
/// `tick_add` to follow the host's sound card).
#[derive(Clone, Copy, Debug)]
pub struct MixerTicks {
    tick_add: u32,
    tick_remain: u32,
}

impl MixerTicks {
    /// The ticks of a mixer at `rate` Hz (DOSBox's `rate`, 44100 by
    /// default).
    pub fn new(rate: u32) -> Self {
        Self {
            tick_add: (rate << MIXER_SHIFT) / 1000,
            tick_remain: 0,
        }
    }

    /// The ticks of a mixer at `rate` Hz whose remainder is `remain`
    /// (under 16,384, the part of a sample carried to the next tick): where
    /// it is in its pattern of 44s and 45s, which for DOSBox depends on how
    /// it ran before, as it nudges its ticks to follow the host's sound
    /// card until a capture starts.
    pub fn with_remain(rate: u32, remain: u32) -> Self {
        Self {
            tick_remain: remain & MIXER_REMAIN,
            ..Self::new(rate)
        }
    }

    /// How many samples the next `tick` ticks add in all: the remainders
    /// carried from tick to tick come to this, so the tick `t` from now
    /// adds `before(t + 1) - before(t)`, without the ticks before it having
    /// been counted one by one.
    pub fn before(&self, tick: u64) -> u64 {
        (u64::from(self.tick_remain) + tick * u64::from(self.tick_add)) >> MIXER_SHIFT
    }

    /// The samples the next tick adds.
    pub fn next_tick(&mut self) -> usize {
        self.tick_remain += self.tick_add;
        let samples = self.tick_remain >> MIXER_SHIFT;
        self.tick_remain &= MIXER_REMAIN;
        samples as usize
    }
}

/// The FM channel's way into DOSBox's mix at equal rates: each output
/// sample is the previous chip sample plus 16383/16384ths of the step to
/// this one (so a rising step falls one short), times the channel's scale
/// of 2, clipped to 16 bits.
#[derive(Clone, Copy, Debug, Default)]
pub struct FmOutput {
    last: [i32; 2],
}

impl FmOutput {
    /// A channel that has not yet sounded.
    pub fn new() -> Self {
        Self::default()
    }

    fn step(last: &mut i32, sample: i32) -> i32 {
        let diff = sample - *last;
        let out = *last + ((diff * MIXER_REMAIN as i32) >> MIXER_SHIFT);
        *last = sample;
        out
    }

    fn clip(sample: i32) -> i16 {
        // The channel's volume multiplier, (1 << 13) * 2.0 * 1.0 * 1.0.
        let volmul = (1 << MIXER_VOLSHIFT) * 2;
        ((sample.wrapping_mul(volmul) >> MIXER_VOLSHIFT)
            .clamp(i32::from(i16::MIN), i32::from(i16::MAX))) as i16
    }

    /// The output of a mono chip sample: the same on left and right.
    pub fn mono(&mut self, sample: i32) -> i16 {
        Self::clip(Self::step(&mut self.last[0], sample))
    }

    /// The output of a stereo chip frame, left and right.
    pub fn stereo(&mut self, left: i32, right: i32) -> [i16; 2] {
        [
            Self::clip(Self::step(&mut self.last[0], left)),
            Self::clip(Self::step(&mut self.last[1], right)),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticks_at_44100_give_44_or_45() {
        let mut ticks = MixerTicks::new(44100);
        let counts: Vec<usize> = (0..20).map(|_| ticks.next_tick()).collect();
        assert_eq!(counts.iter().sum::<usize>(), 881);
        assert!(counts.iter().all(|&c| c == 44 || c == 45));

        let fresh = MixerTicks::with_remain(44100, 9000);
        let mut ticks = MixerTicks::with_remain(44100, 9000);

        for tick in 0..20_000 {
            let samples = fresh.before(tick + 1) - fresh.before(tick);

            assert_eq!(samples as usize, ticks.next_tick(), "tick {tick}");
        }
    }

    #[test]
    fn a_rising_step_falls_one_short() {
        let mut fm = FmOutput::new();
        assert_eq!(fm.mono(100), 2 * 99);
        assert_eq!(fm.mono(100), 2 * 100);
        assert_eq!(fm.mono(50), 2 * 50);
        assert_eq!(fm.mono(40_000), i16::MAX);
    }
}
