//! What the machine's sound card plays, handed to the host to sound: the
//! waveform samples winbox.js's own driver (`wbsound`) puts out, at the
//! rate the card plays them, from the machine's time it starts them; the
//! FM chip's samples (`fm.rs`), a millisecond's at a time as DOSBox makes
//! them; and the MIDI bytes it sends its MIDI port and its synthesizer.
//!
//! A run with no host plays nothing, and nothing a program sees changes
//! with whether one is listening: the card keeps its time on the machine's
//! clock whatever the host does with what it is given.

use crate::system::System;

/// Which of the card's MIDI outputs a message went to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MidiOutput {
    /// The card's MIDI port, where an instrument would be plugged in.
    Port,
    /// The card's synthesizer.
    Synthesizer,
}

/// Something the card does, for the host to sound.
#[derive(Debug, Clone, PartialEq)]
pub enum Sound {
    /// Samples played from `at`, in the machine's milliseconds, at `rate`
    /// a second, which need not be whole: unsigned bytes, one channel, as
    /// the card played them. They are given once the card has played them
    /// -- half its buffer at a time, or as much of a half as it played
    /// before a program reset it -- so what is given is never taken back.
    Samples {
        at: f64,
        rate: f64,
        samples: Vec<u8>,
    },
    /// The FM chip's sound from `at`, a whole millisecond of the machine's,
    /// at `rate` a second (44,100): signed 16-bit samples, one channel, as
    /// DOSBox's mixer puts the Ad Lib's into its output (`fm.rs`). Given
    /// once the milliseconds they are of are over, a few at a time, one
    /// after another with no gap while the chip sounds; none while DOSBox's
    /// FM channel would be off.
    Fm {
        at: f64,
        rate: f64,
        samples: Vec<i16>,
    },
    /// Bytes sent to a MIDI output at `at`, as the driver sent them.
    Midi {
        at: f64,
        output: MidiOutput,
        bytes: Vec<u8>,
    },
    /// The synthesizer's voices all stopped at `at`.
    Silence { at: f64, output: MidiOutput },
}

impl System {
    /// What the card does handed to the host, if there is one.
    pub(crate) fn sound(&mut self, sound: &Sound) {
        if let Some(slot) = self.host.as_mut() {
            slot.sound(sound);
        }
    }
}
