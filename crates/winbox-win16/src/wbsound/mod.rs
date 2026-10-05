//! winbox.js's own sound card driver, `WBSOUND`: a waveform and MIDI
//! driver MMSYSTEM opens as it opens any `SYSTEM.INI` names in
//! `[drivers]` (`wave=wbsound.drv`, `midi=wbsound.drv`, written by
//! `install`). It is a module winbox.js keeps, with no file on the disk; it
//! is kept the first time it is loaded, as a driver's file is loaded only
//! once `SYSTEM.INI` names it, so an installation without it has the same
//! modules and selectors as one that never heard of it. For that it is
//! declared here, not among the modules kept as Windows starts (`kept.rs`,
//! written from the TypeScript engine's export tables), each of which
//! takes its selectors before any program's.
//!
//! What it does is what Windows' own Sound Blaster 1.5 driver,
//! `SNDBLST2.DRV`, does, and for its synthesizer what the Ad Lib driver,
//! `MSADLIB.DRV`, does: **recorded** by `wavedev` and `mididev` on the
//! oracle's installation with the card (`--display vgasound`), and **read
//! out** of the two drivers, whose places the modules here cite. Its
//! devices:
//!
//! * One waveform output device (`wave_out.rs`) and one waveform input
//!   device (`wave_in.rs`), which share the card's converter: one of them,
//!   or MIDI input, at a time.
//! * Two MIDI output devices (`midi.rs`): device 0 the card's MIDI port,
//!   as the Sound Blaster driver has it, and device 1 a synthesizer, as the
//!   Ad Lib driver has it under `MIDI1`; and the MIDI port's input.
//! * The synthesizer's sound (`synth.rs`): what it is sent written to the
//!   machine's FM chip, an OPL2 (`fm.rs`), register for register as the Ad
//!   Lib driver writes it (`kb/topics/adlib.md`).
//!
//! winbox.js's own, not Windows': the names its devices give -- "WinBox
//! Sound" for the waveform devices, "WinBox MIDI" for the MIDI port and
//! "WinBox MIDI Synthesizer" for the synthesizer -- and its
//! manufacturer and product numbers and version, below. Windows' drivers
//! give Microsoft's number (1), products 6, 7, 3, 4 and 9 and version 1.01.
//! The synthesizer's name is not the port's so that the two can be told
//! apart by name, which is how the MIDI Mapper tells devices apart.
//!
//! Windows' MIDI Mapper, `MIDIMAP.DRV`, finds each port its current setup
//! names by comparing the name with each output device's, without regard
//! to case (**read out**, seg3 `18b5`-`18c9`). The installation's setups
//! (`MIDIMAP.CFG`) name Windows' devices -- "Ad Lib", "`SoundBlaster` 1 MIDI
//! Output Port" and the like -- so with winbox.js's names opening it
//! answers `MIDIERR_NODEVICE` (68) where `mididev` recorded nought. The
//! driver is installed with winbox.js's own mapper instead (`wbmapper`),
//! whose setup names the synthesizer.
//!
//! What the card plays goes to the host (`audio.rs`). A program's sound is
//! timed by the card's interrupts on the machine's clock, as the Sound
//! Blaster's driver is (`wave_out.rs`).

// Each has the signature every function that answers a call has.
#![allow(clippy::unnecessary_wraps)]

use std::rc::Rc;

use winbox_machine::{TimerId, segment_selector};

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::interrupts::Interrupt;
use crate::mmsystem::callback;
use crate::mmsystem::devices::{Answering, Kind, Message, OwnDriver};
use crate::modules::{Export, Kept};
use crate::system::System;

pub mod midi;
pub mod synth;
pub mod wave_in;
pub mod wave_out;

#[cfg(test)]
mod tests;

/// The module's name, and its file's.
pub const NAME: &str = "WBSOUND";
pub const FILE: &str = "WBSOUND.DRV";

/// The module as programs link to it. Its exports are numbered as the
/// Sound Blaster driver numbers its own.
pub static MODULE: Kept = Kept {
    name: NAME,
    path: "C:\\WINDOWS\\SYSTEM\\WBSOUND.DRV",
    fixed: true,
    exports: &[
        None,
        Some(Export {
            name: "DriverProc",
            pops: 16,
            returns: 4,
            stub: false,
        }),
        Some(Export {
            name: "wodMessage",
            pops: 16,
            returns: 4,
            stub: false,
        }),
        Some(Export {
            name: "widMessage",
            pops: 16,
            returns: 4,
            stub: false,
        }),
        Some(Export {
            name: "modMessage",
            pops: 16,
            returns: 4,
            stub: false,
        }),
        Some(Export {
            name: "midMessage",
            pops: 16,
            returns: 4,
            stub: false,
        }),
        Some(Export {
            name: "WEP",
            pops: 2,
            returns: 2,
            stub: false,
        }),
    ],
};

/// The manufacturer's number its devices give: winbox.js's own, "WB",
/// far past any Windows 3.1 knows of.
pub const MANUFACTURER: u16 = 0x5742;

/// Each device's product number, winbox.js's own.
pub const WAVE_OUT_PRODUCT: u16 = 1;
pub const WAVE_IN_PRODUCT: u16 = 2;
pub const MIDI_OUT_PRODUCT: u16 = 3;
pub const MIDI_IN_PRODUCT: u16 = 4;
pub const SYNTHESIZER_PRODUCT: u16 = 5;

/// The driver's version, 1.00.
pub const VERSION: u16 = 0x0100;

/// Its devices' names.
pub const WAVE_NAME: &str = "WinBox Sound";
pub const MIDI_NAME: &str = "WinBox MIDI";
pub const SYNTHESIZER_NAME: &str = "WinBox MIDI Synthesizer";

pub const MMSYSERR_ERROR: u32 = 1;
pub const MMSYSERR_BADDEVICEID: u32 = 2;
pub const MMSYSERR_NOTENABLED: u32 = 3;
pub const MMSYSERR_ALLOCATED: u32 = 4;
pub const MMSYSERR_NOTSUPPORTED: u32 = 8;
pub const WAVERR_BADFORMAT: u32 = 32;
pub const WAVERR_STILLPLAYING: u32 = 33;
pub const WAVERR_UNPREPARED: u32 = 34;
pub const MIDIERR_UNPREPARED: u32 = 64;
pub const MIDIERR_STILLPLAYING: u32 = 65;
pub const MIDIERR_NOTREADY: u32 = 67;

/// What every driver is sent as MMSYSTEM installs it.
const DRVM_INIT: u16 = 0x64;

/// `DriverCallback`'s flag that no stack be switched to, which both
/// drivers add to the program's kind of callback.
const DCB_NOSWITCH: u16 = 8;

/// Which device has the card's converter, as the Sound Blaster driver keeps
/// it (`[63h]`): waveform output, input, or MIDI input, one at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Owner {
    #[default]
    None,
    WaveOut,
    WaveIn,
    MidiIn,
}

/// A device opened, as the driver keeps it: who it calls back and how, the
/// program's doubleword, the handle MMSYSTEM gave, the open's flags, and
/// for a waveform device its format and how many bytes it has played or
/// recorded.
#[derive(Debug, Clone, Copy, Default)]
pub struct Instance {
    pub callback: u32,
    pub user: u32,
    pub handle: u16,
    pub flags: u32,
    pub position: u32,
    pub format: [u8; 16],
    /// The task that opened it, woken for a callback at interrupt time.
    pub task: u16,
}

impl Instance {
    /// The instance a `WAVEOPENDESC` or `MIDIOPENDESC` describes -- the
    /// handle, then for a waveform device the format, then the callback
    /// and the program's doubleword -- and the open's flags.
    fn opened(system: &System, description: u32, wave: bool, flags: u32) -> Self {
        let at = if wave { 6 } else { 2 };

        Self {
            callback: dword(system, description, at),
            user: dword(system, description, at + 4),
            handle: word(system, description, 0),
            flags,
            position: 0,
            format: [0; 16],
            task: system.task_handle,
        }
    }

    /// A callback to the program from this device.
    fn callback(&self, message: u16, first: u32) -> Callback {
        Callback {
            callback: self.callback,
            flags: (self.flags >> 16) as u16 | DCB_NOSWITCH,
            device: self.handle,
            message,
            user: self.user,
            first,
            second: 0,
            task: self.task,
        }
    }
}

/// A call to a program's callback, through `DriverCallback`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Callback {
    pub callback: u32,
    pub flags: u16,
    pub device: u16,
    pub message: u16,
    pub user: u32,
    pub first: u32,
    pub second: u32,
    pub task: u16,
}

/// The card: who has its converter, its devices, its DMA buffer and its
/// interrupt.
#[derive(Debug, Default)]
pub struct Card {
    /// Whether `DRV_ENABLE` has readied it (`[76h]`).
    pub enabled: bool,
    pub owner: Owner,
    pub out: wave_out::WaveOut,
    pub input: wave_in::WaveIn,
    pub midi: midi::Midi,
    /// The synthesizer's driver state, as the Ad Lib driver keeps it, which
    /// writes the machine's FM chip (`synth.rs`).
    pub synth: synth::Synth,
    pub dma: Dma,
    /// Where the driver would fault, which winbox.js does not follow: the
    /// run stops at the driver's next message, or at once if in one.
    pub fault: Option<&'static str>,
}

/// The card's DMA buffer, 4 KB in two halves that it plays or records in
/// turn, an interrupt at the end of each.
#[derive(Debug)]
pub struct Dma {
    pub buffer: Vec<u8>,
    /// Which half was filled last, to be played next: 1 the first, 2 the
    /// second, nought for none, which stops the card at the next
    /// interrupt (`[61h]`).
    pub half: u8,
    /// Where the last fill left silence for a buffer written while the card
    /// plays to be put in, and how much (`[50h]`, `[54h]`).
    pub silence: Option<(u16, u16)>,
    /// Where the half the card plays or records now begins: nought, the
    /// first, as it starts, and the other at each interrupt.
    pub playing: u16,
    /// The divisor of a million the card's rate is (`1000000 / rate`),
    /// as its time constant sets it.
    pub divisor: u16,
    /// When the next interrupt comes, in the clock's milliseconds; none
    /// while the card is still.
    pub due: Option<f64>,
    /// The clock's timer for it, to wake a task that waits.
    pub timer: Option<TimerId>,
}

impl Default for Dma {
    fn default() -> Self {
        Self {
            buffer: vec![0x80; DMA_SIZE],
            half: 0,
            silence: None,
            playing: 0,
            divisor: 0,
            due: None,
            timer: None,
        }
    }
}

/// The DMA buffer's size, and a half's.
pub const DMA_SIZE: usize = 0x1000;
pub const HALF: u16 = 0x800;

impl Dma {
    /// The card's rate, samples a second.
    pub fn rate(&self) -> f64 {
        1_000_000.0 / f64::from(self.divisor.max(1))
    }

    /// How long a half of the buffer takes, in milliseconds.
    pub fn period(&self) -> f64 {
        f64::from(HALF) * f64::from(self.divisor) / 1000.0
    }

    /// The card's rate set for a format's (seg4 `732`): its time constant
    /// is 256 less a million over the rate, so it plays at a million over
    /// a whole number -- 11,025 a second is played at 11,111.
    pub fn set_rate(&mut self, rate: u16) {
        self.divisor = (1_000_000 / u32::from(rate.max(16))) as u16 & 0xff;
    }
}

/// The driver as MMSYSTEM calls it.
#[derive(Debug)]
pub struct WbSound;

impl OwnDriver for WbSound {
    fn message<'a>(&'a self, engine: &'a Engine, kind: Kind, message: Message) -> Answering<'a> {
        Box::pin(async move {
            if let Some(fault) = engine.system().sound_card.fault {
                return Err(Stop::Unsupported(fault));
            }

            match kind {
                Kind::WaveOut => wave_out::message(engine, message).await,
                Kind::WaveIn => wave_in::message(engine, message).await,
                Kind::MidiOut => midi::out_message(engine, message).await,
                Kind::MidiIn => midi::in_message(engine, message).await,
                Kind::Aux => Ok(MMSYSERR_NOTSUPPORTED),
            }
        })
    }
}

/// The driver for MMSYSTEM's table of drivers of winbox.js's own.
pub fn driver() -> Rc<dyn OwnDriver> {
    Rc::new(WbSound)
}

/// What `SYSTEM.INI` holds with the driver installed: its file named for
/// the waveform and MIDI drivers in `[drivers]`, as Control Panel names the
/// Sound Blaster's (`wave=`, `midi=`), and winbox.js's own MIDI Mapper for
/// the mapper (`midimapper=`, `wbmapper`), whose setup names the driver's
/// devices.
pub fn install(text: &[u8]) -> Vec<u8> {
    crate::printer::with_entries(
        text,
        &[
            ("drivers", "wave", FILE),
            ("drivers", "midi", FILE),
            ("drivers", "midimapper", crate::wbmapper::FILE),
        ],
    )
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "WEP" => Implementation::Sync(wep),
        "DriverProc" => Implementation::Sync(driver_proc_call),
        "wodMessage" => Implementation::Async(|engine, args| entry(engine, args, Kind::WaveOut)),
        "widMessage" => Implementation::Async(|engine, args| entry(engine, args, Kind::WaveIn)),
        "modMessage" => Implementation::Async(|engine, args| entry(engine, args, Kind::MidiOut)),
        "midMessage" => Implementation::Async(|engine, args| entry(engine, args, Kind::MidiIn)),
        _ => return None,
    })
}

/// The library let go: 1.
fn wep(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(1))
}

/// An entry point called by a program itself, as MMSYSTEM calls it.
fn entry(engine: &Engine, mut args: Args, kind: Kind) -> Later<'_> {
    Box::pin(async move {
        let message = {
            let system = engine.system();

            Message {
                device: args.word(&system),
                message: args.word(&system),
                user: args.dword(&system),
                first: args.dword(&system),
                second: args.dword(&system),
            }
        };

        Ok(Answer::Dword(WbSound.message(engine, kind, message).await?))
    })
}

fn driver_proc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _id = args.dword(system);
    let handle = args.word(system);
    let message = args.word(system);

    Ok(Answer::Dword(driver_proc(system, handle, message)))
}

/// The driver's `DriverProc`, as the Sound Blaster's answers (seg3 `0`):
/// `DRV_LOAD`, `DRV_OPEN`, `DRV_CLOSE` and `DRV_FREE` 1; `DRV_ENABLE`
/// readies the card and, readied, answers nought; `DRV_DISABLE` stops
/// it, 1; `DRV_INSTALL` and `DRV_REMOVE` 2, Windows to be restarted; the
/// rest as `DefDriverProc` answers.
///
/// Not as the Sound Blaster's: it has nothing to set up -- no port, no
/// interrupt -- so `DRV_QUERYCONFIGURE` and `DRV_CONFIGURE` are left to
/// `DefDriverProc`, which answers nought for each (`drivers.rs`), where the
/// Sound Blaster's answers 1 (seg3 `1a`: `8` goes to `6e`) and shows its
/// dialog (`7` goes to `60`, seg2 `ae4`).
pub fn driver_proc(system: &mut System, handle: u16, message: u16) -> u32 {
    match message {
        1 | 3 | 4 | 6 => 1,
        2 => {
            system.sound_card.enabled = true;
            with_synth(system, |synth, chip| {
                synth.enable(chip);
            });
            0
        }
        5 => {
            disable(system);
            1
        }
        9 | 10 => 2,
        _ => crate::drivers::def_driver_proc(handle, message),
    }
}

/// The synthesizer's driver state taken from the card for `act`, with the
/// machine's FM chip to write, and put back.
pub fn with_synth(
    system: &mut System,
    act: impl FnOnce(&mut synth::Synth, &mut crate::fm::DriverChip<'_>),
) {
    let mut synth = std::mem::take(&mut system.sound_card.synth);

    act(&mut synth, &mut crate::fm::DriverChip(system));
    system.sound_card.synth = synth;
}

/// The card stopped as it is disabled (seg2 `6a0`): what plays halted;
/// and the synthesizer's chip reset, as the Ad Lib driver resets it
/// (`MSADLIB` seg2 `59e`).
fn disable(system: &mut System) {
    with_synth(system, |synth, chip| synth.disable(chip));

    if system.sound_card.enabled {
        let mut card = std::mem::take(&mut system.sound_card);

        card.halt(system);
        system.sound_card = card;
    }

    system.sound_card.enabled = false;
}

impl Card {
    /// The card's DMA halted at once (seg1 `b08`), its interrupt let go.
    pub fn halt(&mut self, system: &mut System) {
        self.out.running = false;
        self.dma.due = None;

        if let Some(timer) = self.dma.timer.take() {
            system.clock.cancel(timer);
        }
    }

    /// The card's DMA started from the buffer's start: an interrupt each
    /// half of it from now.
    pub fn begin(&mut self, system: &mut System) {
        let now = system.clock.now(system.instructions);

        self.dma.playing = 0;
        self.dma.due = Some(now + self.dma.period());
        self.arm(system);
    }

    /// The clock's timer for the next interrupt, to wake a task that waits.
    fn arm(&mut self, system: &mut System) {
        if let Some(timer) = self.dma.timer.take() {
            system.clock.cancel(timer);
        }

        if let Some(due) = self.dma.due {
            let wait = due - system.clock.now(system.instructions);

            self.dma.timer = Some(system.clock.after(system.instructions, wait.max(0.0)));
        }
    }

    /// The card's interrupt, come due at `at`: what its owner does with a
    /// half played or recorded.
    fn interrupt(&mut self, system: &mut System, at: f64, calls: &mut Vec<Callback>) {
        let period = self.dma.period();

        self.dma.due = Some(at + period);

        match self.owner {
            Owner::WaveOut => wave_out::interrupt(self, system, at, calls),
            Owner::WaveIn => wave_in::interrupt(self, system, calls),
            Owner::MidiIn | Owner::None => self.dma.due = None,
        }
    }
}

impl System {
    /// The card's interrupts come due, at interrupt time: each half played
    /// or recorded in turn, as the clock passes it, and what the driver
    /// calls back with then -- a window posted, a function called as at
    /// interrupt time (`interrupts.rs`).
    pub(crate) fn poll_sound(&mut self) {
        // The FM chip's sound made up to now (`fm.rs`).
        self.poll_fm();

        if self.sound_card.dma.due.is_none() {
            return;
        }

        self.poll_card();
        // What MCI's waveform device makes of the buffers called done.
        self.poll_mci_wave();
    }

    fn poll_card(&mut self) {
        let mut card = std::mem::take(&mut self.sound_card);
        let mut calls = Vec::new();
        let now = self.clock.now(self.instructions);

        while let Some(due) = card.dma.due
            && due <= now
        {
            card.interrupt(self, due, &mut calls);
            self.note_sound_done(due);

            // Faulted, the driver goes no further.
            if card.fault.is_some() {
                card.halt(self);
            }
        }

        card.arm(self);
        self.sound_card = card;

        for call in calls {
            callback_at_interrupt(self, &call);
        }
    }
}

/// A driver's callback made from its interrupt: a window or task posted
/// at once, a function called as at interrupt time, as `DriverCallback`
/// does each (`callback.rs`).
fn callback_at_interrupt(system: &mut System, call: &Callback) {
    if call.flags & 7 == 3 {
        let code = call.callback != 0
            && system
                .peek_descriptor((call.callback >> 16) as u16)
                .is_some_and(|descriptor| descriptor.segment && descriptor.executable);

        if code {
            system.at_interrupt(
                Interrupt {
                    proc: call.callback,
                    args: vec![
                        GuestArg::Word(call.device),
                        GuestArg::Word(call.message),
                        GuestArg::Long(call.user),
                        GuestArg::Long(call.first),
                        GuestArg::Long(call.second),
                    ],
                    key: None,
                },
                Some(call.task),
            );
        }

        return;
    }

    callback::post_callback(
        system,
        call.callback,
        call.flags,
        call.device,
        call.message,
        call.first,
    );
}

/// The driver's callbacks made, in turn, from a message's own time: each
/// through `DriverCallback`, as the driver calls it.
pub async fn deliver(engine: &Engine, calls: Vec<Callback>) -> Result<(), Stop> {
    for call in calls {
        callback::driver_callback(
            engine,
            call.callback,
            call.flags,
            call.device,
            call.message,
            call.user,
            call.first,
            call.second,
        )
        .await?;
    }

    Ok(())
}

/// The card taken from the machine for `act`, and put back; the callbacks
/// it made then made.
pub async fn with_card(
    engine: &Engine,
    act: impl FnOnce(&mut Card, &mut System, &mut Vec<Callback>) -> u32,
) -> Result<u32, Stop> {
    let mut calls = Vec::new();
    let answer = {
        let mut system = engine.system();
        let mut card = std::mem::take(&mut system.sound_card);
        let answer = act(&mut card, &mut system, &mut calls);

        system.sound_card = card;

        if let Some(fault) = system.sound_card.fault {
            return Err(Stop::Unsupported(fault));
        }

        answer
    };

    deliver(engine, calls).await?;
    Ok(answer)
}

/// Waits, as the Sound Blaster's driver waits (seg4 `93b`), for the card
/// to stop by itself, for up to two seconds of the clock: the machine's
/// time passing to each interrupt in turn. Where it does not stop, the
/// card is halted and the driver disabled, as the driver gives up on it.
pub async fn wait_stopped(engine: &Engine) {
    let start = {
        let system = engine.system();

        system.clock.now(system.instructions)
    };

    loop {
        let wait = {
            let mut system = engine.system();
            let now = system.clock.now(system.instructions);

            if !system.sound_card.out.running {
                return;
            }

            if now - start >= 2000.0 {
                let mut card = std::mem::take(&mut system.sound_card);

                card.halt(&mut system);
                card.enabled = false;
                system.sound_card = card;
                return;
            }

            let due = system.sound_card.dma.due.unwrap_or(now + 1.0);
            let wait = (due - now).max(0.0);

            if system.clock.is_virtual() {
                let instructions = system.instructions;

                system.clock.advance(instructions, wait);
                system.poll_sound();
                0.0
            } else {
                wait
            }
        };

        if wait > 0.0 {
            engine.wait_host(wait).await;
            engine.system().poll_sound();
        }
    }
}

/// WBSOUND's data segment, as a far pointer's selector: where the driver
/// keeps a device's instance, and what a header it was given names.
pub fn data_segment(system: &System) -> u32 {
    system.kept_named(NAME).map_or(0, |kept| {
        u32::from(segment_selector(system.kept[kept].data)) << 16
    })
}

/// A word of a structure: `at` on from a far pointer, within its segment.
pub fn word(system: &System, far: u32, at: u16) -> u16 {
    let bytes = system.read_far(field(far, at), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

pub fn dword(system: &System, far: u32, at: u16) -> u32 {
    let bytes = system.read_far(field(far, at), 4);

    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

pub fn set_word(system: &mut System, far: u32, at: u16, value: u16) {
    system.write_far(field(far, at), &value.to_le_bytes());
}

pub fn set_dword(system: &mut System, far: u32, at: u16, value: u32) {
    system.write_far(field(far, at), &value.to_le_bytes());
}

fn field(far: u32, at: u16) -> u32 {
    (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(at))
}

/// A huge pointer moved on by `count` bytes: its selector eight on for
/// each 64 KB it crosses (`__AHINCR`), as the drivers move theirs.
pub fn huge_on(far: u32, count: u32) -> u32 {
    let offset = (far & 0xffff) + count;
    let selector = ((far >> 16) + (offset >> 16) * 8) & 0xffff;

    selector << 16 | (offset & 0xffff)
}

/// Bytes read through a huge pointer.
pub fn huge_read(system: &System, far: u32, count: u32) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(count as usize);

    while (bytes.len() as u32) < count {
        let at = huge_on(far, bytes.len() as u32);
        let run = (0x1_0000 - (at & 0xffff)).min(count - bytes.len() as u32);

        bytes.extend(system.read_far(at, run as usize));
    }

    bytes
}

/// Bytes written through a huge pointer.
pub fn huge_write(system: &mut System, far: u32, bytes: &[u8]) {
    let mut done = 0u32;

    while (done as usize) < bytes.len() {
        let at = huge_on(far, done);
        let run = (0x1_0000 - (at & 0xffff)).min(bytes.len() as u32 - done);

        system.write_far(at, &bytes[done as usize..(done + run) as usize]);
        done += run;
    }
}

/// A device's capabilities copied for the program, as much as it asked
/// for of them: the Sound Blaster's driver copies the lesser of the size
/// and the structure's (seg3 `12e`). The size is the low word of the
/// message's second doubleword, its high word unread (seg4 `46a`: `mov
/// ax,[bp+4]`, `cmp ax,30h`, `jna`).
pub fn copy_caps(system: &mut System, far: u32, size: u32, caps: &[u8]) {
    let size = usize::from(size as u16).min(caps.len());

    system.write_far(far, &caps[..size]);
}

/// A device's name as its capabilities hold it: 32 bytes, ended by
/// nought.
pub fn name_field(name: &str) -> [u8; 32] {
    let mut field = [0u8; 32];

    for (at, byte) in name.bytes().take(31).enumerate() {
        field[at] = byte;
    }

    field
}

/// The messages every kind shares: `DRVM_INIT`, answered unless the card
/// is not readied (seg4 `4c2`), and the number of the device, which must be
/// one there is (2). `None` where the kind's own messages answer.
pub fn common(enabled: bool, message: &Message, numdevs: u16, devices: u16) -> Option<u32> {
    if !enabled {
        return Some(match message.message {
            DRVM_INIT => 0,
            each if each == numdevs => 0,
            _ => MMSYSERR_NOTENABLED,
        });
    }

    (message.device >= devices).then_some(MMSYSERR_BADDEVICEID)
}
