//! The host a machine runs in: what shows the screen and hands in the
//! mouse and keyboard, as winbox.js's page does with its canvas. The run
//! hands it the machine about once a frame of the host's own time, between
//! two slices of a program's instructions or while every task waits, so a
//! program that never waits is shown and given its input all the same.

use crate::system::System;

/// How often the host is given the machine: a frame at 60 a second, in
/// the host's milliseconds.
const FRAME: f64 = 16.667;

/// What a front end does between the machine's slices.
pub trait Host {
    /// The machine, for the host to show its screen (`present.rs`) and
    /// hand in what the mouse and keyboard did (`raster_input.rs`,
    /// `key_input.rs`). False when the host is closing: the run stops.
    fn frame(&mut self, system: &mut System) -> bool;

    /// What the machine's sound card does, as it does it (`audio.rs`), for
    /// the host to sound. A host that sounds nothing need not take it.
    fn sound(&mut self, _sound: &crate::audio::Sound) {}
}

/// The host a machine has, and when it was last given the machine.
pub struct HostSlot {
    host: Box<dyn Host>,
    /// When, in the host's time as the machine's clock reads it
    /// (`Clock::host_ms`); none until the run first looks.
    last: Option<f64>,
    /// Whether it said it is closing.
    closed: bool,
}

impl std::fmt::Debug for HostSlot {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("HostSlot").finish_non_exhaustive()
    }
}

impl HostSlot {
    pub fn new(host: Box<dyn Host>) -> Self {
        Self {
            host,
            last: None,
            closed: false,
        }
    }
}

impl HostSlot {
    /// What the sound card does handed to the host.
    pub(crate) fn sound(&mut self, sound: &crate::audio::Sound) {
        self.host.sound(sound);
    }
}

impl System {
    /// The host given the machine if a frame of its time has passed since
    /// it last was: false when it is closing.
    pub(crate) fn host_frame(&mut self) -> bool {
        let Some(slot) = self.host.as_mut() else {
            return true;
        };
        let now = self.clock.host_ms();

        // The first look: a frame of the host's time from now.
        let last = *slot.last.get_or_insert(now);

        if now - last < FRAME {
            return true;
        }

        let mut slot = self.host.take().expect("a host");
        let going = slot.host.frame(self);

        slot.last = Some(self.clock.host_ms());
        slot.closed |= !going;
        self.host = Some(slot);
        going
    }

    /// Whether the host has said it is closing.
    pub(crate) fn host_closed(&self) -> bool {
        self.host.as_ref().is_some_and(|slot| slot.closed)
    }
}
