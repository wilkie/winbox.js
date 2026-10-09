//! winbox.js's own MIDI Mapper, `WBMAPPER`: the driver MMSYSTEM opens as
//! `SYSTEM.INI`'s `midimapper` and installs as the MIDI mapper, the device
//! a program opens as `MIDI_MAPPER` (`FFFFh`). It sends what it is given on
//! to the devices its setup names, a channel to a device, as Windows' own
//! MIDI Mapper, `MIDIMAP.DRV`, does: **read out** of `MIDIMAP.DRV`, whose
//! places the doc comments cite, and **recorded** by `mididev` on the
//! oracle's installation with the Sound Blaster and the Ad Lib, and by
//! `adlibmap` and `adlibgm` with its "Ad Lib general" setup current.
//!
//! It is a module winbox.js keeps, with no file on the disk, kept the first
//! time it is loaded, as winbox.js's sound card driver is (`wbsound`), and
//! named in `SYSTEM.INI` with that driver (`wbsound::install`). Windows'
//! `MIDIMAP.DRV` reads its setups from `MIDIMAP.CFG` and finds each device a
//! setup names by its name; the installation's setups name Windows' own
//! devices, so with winbox.js's driver in their place Windows' mapper finds
//! none of them and opening it answers `MIDIERR_NODEVICE` (68), where
//! `mididev` recorded nought.
//!
//! **The setups.** WinBox's mapper reads the same setups as it opens, from
//! the installation's `MIDIMAP.CFG` -- their channels, patch maps and key
//! maps -- or, with no file, from those of them kept in code (`setups`).
//! Where a setup names a device of Windows' by its name, it finds WinBox's
//! that does the same: the Ad Lib's, "Ad Lib", is WinBox's synthesizer, and
//! the Sound Blaster 1.5's MIDI port, "Creative Labs Sound Blaster 1.5", is
//! WinBox's card's. Its current setup is the one `MIDIMAP.CFG`'s header
//! names (seg3 `16ca`), as Windows' is: the file is the one place it is
//! kept, which Control Panel's MIDI Mapper changes (`applet`). The card's
//! installation writes the file with its setups naming WinBox's devices
//! (`wbsound::install_setups`) and makes "Ad Lib general" current, General
//! MIDI on the synthesizer, every channel there but 10 and 16, which are
//! swapped so that General MIDI's drums play on the synthesizer's
//! percussion channel; the probe survey's makes the installation's own
//! current, "Ad Lib", the base-level setup, channels 13 to 16 and no
//! others, that the oracle recorded with.
//!
//! **What it answers**, as `MIDIMAP`'s `modMessage` (seg2 `91`) answers:
//!
//! * One device; a message for another is `MMSYSERR_BADDEVICEID` (2).
//! * Its capabilities (seg3 `efa`): a mapper (technology 5) of no voices
//!   and no notes, that can cache patches (support 4), its channels those
//!   its setup sends somewhere -- nought until it is first opened, as
//!   `mididev` recorded, the setup's since. Its name, manufacturer, product
//!   and version are winbox.js's own: Windows' are "Microsoft MIDI Mapper",
//!   Microsoft's number (1), product 1 and version 1.00.
//! * Opening (seg3 `1188`): a second open while it is open is
//!   `MMSYSERR_ALLOCATED` (4). The current setup is read (`setups`): one
//!   not there is `MIDIERR_INVALIDSETUP` (69), a file it cannot read
//!   `MIDIERR_NOMAP` (66). The devices of the setup are found by their
//!   names, each compared with each MIDI output device's without regard to
//!   case, each device asked for its capabilities in turn until one is the
//!   same (seg3 `1bd7`-`1c77`): one not there is `MIDIERR_NODEVICE` (68)
//!   once every channel has been looked for, nothing opened (seg3 `1d57`,
//!   `db8`). Each device the setup sends a channel to
//!   is opened once, with no callback and the program's flags, its kind of
//!   callback cleared (seg3 `1347`), and a header for system-exclusive
//!   messages prepared on it; a device that fails to open fails the open
//!   with its answer, every device closed again. The program is called
//!   back `MM_MOM_OPEN` (seg3 `13fa`).
//! * Closing (seg3 `ee8`, `e3d`): each device reset, its header unprepared
//!   and it closed; the program called back `MM_MOM_CLOSE`.
//! * A short message (seg2 `3c2`, `24b`): a channel message of a channel
//!   the setup sends somewhere goes to its device, its status's channel the
//!   one the setup gives, and through the channel's patch map where it has
//!   one (`setups::map`); one of another channel goes nowhere. A data byte
//!   runs on the mapper's own running status, which a channel message sets
//!   and a system message, `F0h` to `F7h`, clears; with none it goes
//!   nowhere. A system message goes to every device. It answers nought.
//! * Preparing and unpreparing a header are `MMSYSERR_NOTSUPPORTED` (8):
//!   MMSYSTEM does them.
//! * Caching patches or drum patches (seg3 `10a7`): each device asked to
//!   cache the patches of the channels it plays, and the program given
//!   back what the devices kept; the last device's answer.
//! * Anything else -- resetting, the volume, a message it does not know --
//!   goes to every device it has open, and the last one's answer is its
//!   (seg2 `d6`). With none open, as when a program asks the closed
//!   mapper's volume by its number, `MIDIMAP` answers a doubleword of its
//!   frame it never set, and caching patches likewise (seg3 `1127`): there
//!   is no saying what, and the run stops.
//!
//! Not followed: long messages (seg2 `169`, `4ab`), which `MIDIMAP` breaks
//! up into short messages and system-exclusive ones in a buffer of its own,
//! and which stop the run.
//!
//! **Control Panel's MIDI Mapper** is Windows' own: WinBox's mapper exports
//! `CPlApplet`, as `MIDIMAP` does (seg1 `11f`), and passes it on to the
//! installation's `MIDIMAP.DRV`, loaded as a library for its applet alone
//! (`applet`).

// Each has the signature every function that answers a call has.
#![allow(clippy::unnecessary_wraps)]

use std::cell::RefCell;
use std::rc::Rc;

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::mmsystem::callback;
use crate::mmsystem::checks::{self, MIDI_INQUEUE, PREPARED};
use crate::mmsystem::devices::{self, Answering, Keep, Kind, Message, OwnDriver};
use crate::modules::{Export, Kept};
use crate::system::System;

pub mod applet;
pub mod setups;

#[cfg(test)]
mod tests;

/// The module's name, and its file's.
pub const NAME: &str = "WBMAPPER";
pub const FILE: &str = "WBMAPPER.DRV";

/// The module as programs link to it. Its exports are numbered as
/// `MIDIMAP.DRV` numbers its own, its first `CPlApplet`, which passes
/// Control Panel's messages to `MIDIMAP.DRV`'s own (`applet`).
pub static MODULE: Kept = Kept {
    name: NAME,
    path: "C:\\WINDOWS\\SYSTEM\\WBMAPPER.DRV",
    fixed: true,
    exports: &[
        None,
        Some(Export {
            name: "CPlApplet",
            pops: 12,
            returns: 4,
            stub: false,
        }),
        Some(Export {
            name: "WEP",
            pops: 2,
            returns: 2,
            stub: false,
        }),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(Export {
            name: "DriverProc",
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
    ],
};

/// Its name, product number and version, winbox.js's own; its manufacturer
/// winbox.js's, as its sound card's is.
pub const MAPPER_NAME: &str = "WinBox MIDI Mapper";
pub const PRODUCT: u16 = 6;
pub const VERSION: u16 = 0x0100;

const MODM_GETNUMDEVS: u16 = 1;
const MODM_GETDEVCAPS: u16 = 2;
const MODM_OPEN: u16 = 3;
const MODM_CLOSE: u16 = 4;
const MODM_PREPARE: u16 = 5;
const MODM_UNPREPARE: u16 = 6;
const MODM_DATA: u16 = 7;
const MODM_LONGDATA: u16 = 8;
const MODM_RESET: u16 = 9;
const MODM_CACHEPATCHES: u16 = 12;
const MODM_CACHEDRUMPATCHES: u16 = 13;

const MM_MOM_OPEN: u16 = 0x3c7;
const MM_MOM_CLOSE: u16 = 0x3c8;

const MMSYSERR_BADDEVICEID: u32 = 2;
const MMSYSERR_ALLOCATED: u32 = 4;
const MMSYSERR_NODRIVER: u16 = 6;
const MMSYSERR_NOTSUPPORTED: u32 = 8;
const MIDIERR_STILLPLAYING: u16 = 65;
const MIDIERR_NODEVICE: u32 = 68;

/// `MIDIOUTCAPS`'s technology for a mapper, and its support for caching
/// patches.
const MOD_MAPPER: u16 = 5;
const MIDICAPS_CACHE: u32 = 4;

/// `DriverCallback`'s flag that no stack be switched to, which the mapper
/// adds to the program's kind of callback (seg2 `17`).
const DCB_NOSWITCH: u16 = 8;

/// Where in its data segment the mapper keeps its header for
/// system-exclusive messages, and the buffer it points at: `MIDIMAP`
/// allocates them (seg3 `12dd`), `1Ch` bytes of header and 200h of data.
const HEADER: u16 = 0;
const HEADER_SIZE: u16 = 0x1c;
const BUFFER_SIZE: u32 = 0x200;

/// A device the setup sends to, opened: its number, the channels it plays,
/// whether the header is prepared on it, and its handle (seg6 `154h`, eight
/// bytes each).
#[derive(Debug, Clone, Copy)]
struct Port {
    id: u16,
    channels: u16,
    prepared: bool,
    handle: u16,
}

/// The mapper opened: who it calls back and how, the program's doubleword
/// and the handle MMSYSTEM gave (seg6 `26Eh`-`27Ch`, `1DAh`); the devices
/// it opened, and for each channel the device's place among them (`1DEh`).
#[derive(Debug, Clone, Default)]
struct Opened {
    callback: u32,
    user: u32,
    flags: u32,
    handle: u16,
    ports: Vec<Port>,
    channels: [Option<usize>; 16],
    /// The setup it opened with, held until it closes, as `MIDIMAP` holds
    /// it (`[1D4h]`).
    setup: Option<Rc<setups::Setup>>,
}

/// What the mapper keeps.
#[derive(Debug, Default)]
struct State {
    opened: Option<Opened>,
    /// The channels the setup sends somewhere, as the last open found them
    /// (`[272h]`): its capabilities' channels.
    mask: u16,
    /// Its running status (`[286h]`).
    running: u8,
    /// Who it called back last, kept past a close as `MIDIMAP` keeps it.
    last: Option<(u32, u32, u32, u16)>,
    /// The program last asked for on each channel through a patch map
    /// (`[25Eh]`), by which its notes' keys and its volume are mapped:
    /// kept from the driver's loading, past each close, none at first.
    programs: [u8; 16],
}

/// The driver as MMSYSTEM calls it.
#[derive(Debug, Default)]
pub struct WbMapper {
    state: RefCell<State>,
}

/// The driver for MMSYSTEM's table of drivers of winbox.js's own.
pub fn driver() -> Rc<dyn OwnDriver> {
    Rc::new(WbMapper::default())
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "WEP" => Implementation::Sync(wep),
        "DriverProc" => Implementation::Sync(driver_proc_call),
        "modMessage" => Implementation::Async(entry),
        "CPlApplet" => Implementation::Async(applet::cpl_applet),
        _ => return None,
    })
}

/// The library let go: 1.
fn wep(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(1))
}

fn driver_proc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _id = args.dword(system);
    let handle = args.word(system);
    let message = args.word(system);

    Ok(Answer::Dword(driver_proc(handle, message)))
}

/// `MIDIMAP`'s `DriverProc` (seg2 `3c`): `DRV_LOAD`, `DRV_OPEN`,
/// `DRV_CLOSE` and `DRV_FREE` 1; `DRV_INSTALL` and `DRV_REMOVE` 2,
/// Windows to be restarted; the rest as `DefDriverProc` answers.
pub fn driver_proc(handle: u16, message: u16) -> u32 {
    match message {
        1 | 3 | 4 | 6 => 1,
        9 | 10 => 2,
        _ => crate::drivers::def_driver_proc(handle, message),
    }
}

/// `modMessage` called by a program itself, as MMSYSTEM calls it.
fn entry(engine: &Engine, mut args: Args) -> Later<'_> {
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
        let driver = engine.system().mmsystem.devices.own_driver(NAME);
        let answer = match driver {
            Some(driver) => driver.message(engine, Kind::MidiOut, message).await?,
            None => return Err(Stop::Unsupported("the MIDI Mapper with no driver")),
        };

        Ok(Answer::Dword(answer))
    })
}

impl OwnDriver for WbMapper {
    fn message<'a>(&'a self, engine: &'a Engine, kind: Kind, message: Message) -> Answering<'a> {
        Box::pin(async move {
            // It is installed only for output, the one kind it has an entry
            // point for.
            if kind != Kind::MidiOut {
                return Ok(MMSYSERR_NOTSUPPORTED);
            }

            if message.device != 0 {
                return Ok(MMSYSERR_BADDEVICEID);
            }

            match message.message {
                MODM_GETNUMDEVS => Ok(1),
                MODM_GETDEVCAPS => {
                    self.caps(&mut engine.system(), message.first, message.second);
                    Ok(0)
                }
                MODM_OPEN => {
                    // Open, or Control Panel's MIDI Mapper editing the
                    // setups (seg2 `12b`-`14c`, `applet`).
                    if self.state.borrow().opened.is_some() || applet::editing(&engine.system()) {
                        return Ok(MMSYSERR_ALLOCATED);
                    }

                    engine.system().clock.charge(costs::OPEN);

                    let answer = self.open(engine, message.first, message.second).await;

                    engine.system().clock.charge(costs::OPENED);
                    self.tell_applet(engine);
                    answer
                }
                MODM_CLOSE => {
                    engine.system().clock.charge(costs::CLOSE);
                    let answer = self.close(engine).await;

                    self.tell_applet(engine);
                    answer
                }
                MODM_PREPARE | MODM_UNPREPARE => Ok(MMSYSERR_NOTSUPPORTED),
                MODM_DATA => {
                    self.data(engine, message.first).await?;
                    Ok(0)
                }
                MODM_LONGDATA => Err(Stop::Unsupported("the MIDI Mapper's long messages")),
                MODM_CACHEPATCHES | MODM_CACHEDRUMPATCHES => self.cache(engine, &message).await,
                MODM_RESET => {
                    engine.system().clock.charge(costs::RESET);
                    self.to_every_device(engine, &message).await
                }
                _ => self.to_every_device(engine, &message).await,
            }
        })
    }
}

/// A setup's device by the name it gives, as WinBox's devices are named
/// (`setups::device_named`): WinBox's synthesizer given another, as a test
/// that finds the Ad Lib by Windows' name gives it, is still the setup's.
fn named(engine: &Engine, device: &[u8]) -> Vec<u8> {
    let ours = setups::device_named(device);

    if ours == crate::wbsound::SYNTHESIZER_NAME.as_bytes() {
        engine
            .system()
            .sound_card
            .midi
            .synthesizer_name
            .map_or(ours, |name| name.as_bytes().to_vec())
    } else {
        ours
    }
}

/// The current setup, as the mapper reads it as it opens (seg3 `16ca`,
/// `1b0f`): the one `MIDIMAP.CFG`'s header names, as Control Panel's MIDI
/// Mapper makes it current (`applet`); with no file, "Ad Lib general" of
/// those kept in code (`setups`). Its answer where there is none:
/// `MIDIERR_INVALIDSETUP` for a setup not there, `MIDIERR_NOMAP` for a
/// file it cannot read.
fn current_setup(system: &mut System) -> Result<setups::Setup, u32> {
    let file = system.files.open(setups::FILE).map(|handle| {
        let file = system.files.resolve(handle).expect("an open file");
        let size = file.size() as usize;
        let bytes = file.read(size);

        system.files.close(handle);
        bytes
    });

    match file {
        Some(bytes) => setups::from_file(&bytes, setups::Wanted::Current),
        None => setups::kept(setups::GENERAL_MIDI.as_bytes()),
    }
}

/// What `MIDIMAP.DRV`'s own code takes, in instructions: **measured** by
/// `adlibgap` on DOSBox's traced build at a fixed 3,000 cycles a
/// millisecond, the mapper's parts against the same sent to the Ad Lib
/// directly, less WinBox's own for them (`kb/topics/adlib.md`, "The time
/// between messages").
mod costs {
    /// A short message to the mapper through MMSYSTEM, its channel looked
    /// up: one on a channel sent nowhere, 121.
    pub const DATA: f64 = 121.0;
    /// Sending it on to a device, through MMSYSTEM: a message to the Ad
    /// Lib writes first 147 to 150 later through the mapper than sent to
    /// it directly, less `DATA`.
    pub const SENT: f64 = 29.0;
    /// And back: its last write 17 further from the return.
    pub const RETURNED: f64 = 17.0;
    /// `MODM_RESET`, before each device is reset: 308 in all, the Ad Lib's
    /// reset 207 of it.
    pub const RESET: f64 = 101.0;
    /// `MODM_OPEN`, before its devices are opened: its setup read from
    /// `MIDIMAP.CFG` and looked for. The Ad Lib's reset writes first
    /// 98,948 later through the mapper than WinBox's mapper alone gives,
    /// less the Ad Lib's own `OPEN`: 95,721 with "Ad Lib" current, whose
    /// four channels each ask two devices for their capabilities to find
    /// the Ad Lib, less those eight `ASKED`.
    pub const OPEN: f64 = 95_721.0 - 8.0 * ASKED;
    /// A device asked for its capabilities as the setup's devices are looked
    /// for (seg3 `1c47`): **measured** by `adlibmap` with "Ad Lib general"
    /// current, whose sixteen channels ask 32 times, against "Ad Lib": the
    /// first open's reset writes first 9.169 ms later, 27,507 instructions,
    /// over 24 more asks.
    pub const ASKED: f64 = 1146.0;
    /// And after: 25,869 from the reset's last write to the return, less
    /// the Ad Lib's own `OPENED`.
    pub const OPENED: f64 = 18_973.0;
    /// `MODM_CLOSE`: 5,082 in all, less the Ad Lib's close.
    pub const CLOSE: f64 = 4107.0;
}

impl WbMapper {
    /// Whether it is open kept where Control Panel's MIDI Mapper looks
    /// (`applet`), as `MIDIMAP`'s applet looks at its own `[1D4h]`.
    fn tell_applet(&self, engine: &Engine) {
        engine.system().mapper_applet.mapper_open = self.state.borrow().opened.is_some();
    }

    /// `MIDIOUTCAPS` (seg3 `efa`), as much as the program asked for, the
    /// low word of the message's second doubleword; nothing for none.
    fn caps(&self, system: &mut System, far: u32, size: u32) {
        let size = usize::from(size as u16);

        if size == 0 {
            return;
        }

        let mut caps = Vec::with_capacity(0x32);

        caps.extend_from_slice(&crate::wbsound::MANUFACTURER.to_le_bytes());
        caps.extend_from_slice(&PRODUCT.to_le_bytes());
        caps.extend_from_slice(&VERSION.to_le_bytes());
        caps.extend_from_slice(&crate::wbsound::name_field(MAPPER_NAME));
        caps.extend_from_slice(&MOD_MAPPER.to_le_bytes());
        caps.extend_from_slice(&0u16.to_le_bytes());
        caps.extend_from_slice(&0u16.to_le_bytes());
        caps.extend_from_slice(&self.state.borrow().mask.to_le_bytes());
        caps.extend_from_slice(&MIDICAPS_CACHE.to_le_bytes());
        system.write_far(far, &caps[..size.min(caps.len())]);
    }

    /// The mapper opened (seg3 `1188`) for the `MIDIOPENDESC` at `far`,
    /// with the program's flags.
    async fn open(&self, engine: &Engine, far: u32, flags: u32) -> Result<u32, Stop> {
        let setup = match current_setup(&mut engine.system()) {
            Ok(setup) => Rc::new(setup),
            Err(answer) => return Ok(answer),
        };
        let Some(devices) = devices_of(engine, &setup).await? else {
            return Ok(MIDIERR_NODEVICE);
        };

        // The channels it sends, and each device once, in the order of the
        // channels that first name it (seg3 `1201`-`12d8`).
        let mut opened = Opened {
            setup: Some(Rc::clone(&setup)),
            ..Opened::default()
        };
        let mut mask = 0u16;

        for (channel, id) in devices.iter().enumerate() {
            let Some(id) = *id else { continue };
            let bit = 1u16 << channel;

            mask |= bit;

            match opened.ports.iter().position(|port| port.id == id) {
                Some(at) => opened.ports[at].channels |= bit,
                None => opened.ports.push(Port {
                    id,
                    channels: bit,
                    prepared: false,
                    handle: 0,
                }),
            }
        }

        {
            let mut state = self.state.borrow_mut();

            state.mask = mask;
            state.opened = Some(opened.clone());
        }

        // The header for system-exclusive messages (seg3 `12dd`-`1319`).
        let header = {
            let mut system = engine.system();
            let header = data_segment(&system) | u32::from(HEADER);
            let mut bytes = vec![0u8; usize::from(HEADER_SIZE)];

            bytes[..4].copy_from_slice(&(header + u32::from(HEADER_SIZE)).to_le_bytes());
            bytes[4..8].copy_from_slice(&BUFFER_SIZE.to_le_bytes());
            system.write_far(header, &bytes);
            header
        };

        // Each device opened, and the header prepared on it (seg3
        // `131f`-`138e`).
        for at in 0..opened.ports.len() {
            let id = opened.ports[at].id;
            let (answer, handle) = open_device(engine, id, flags & !0x7_0000).await?;

            let Some(handle) = handle.filter(|_| answer == 0) else {
                self.release(engine).await?;
                return Ok(u32::from(answer));
            };

            opened.ports[at].handle = handle;
            self.keep_ports(&opened.ports);

            let answer = prepare(engine, handle, header).await?;

            if answer != 0 {
                self.release(engine).await?;
                return Ok(u32::from(answer));
            }

            opened.ports[at].prepared = true;
            self.keep_ports(&opened.ports);
        }

        for (channel, id) in devices.iter().enumerate() {
            opened.channels[channel] =
                id.and_then(|id| opened.ports.iter().position(|port| port.id == id));
        }

        // Who it calls back, and its running status gone (seg3
        // `1397`-`13d3`).
        let (callback, user, flags, handle) = {
            let system = engine.system();
            let dword = |at: u32| checks::dword_at(&system, far_on(far, at));
            let handle = system.read_far(far, 2);

            (
                dword(2),
                dword(6),
                flags,
                u16::from_le_bytes([handle[0], handle[1]]),
            )
        };

        opened.callback = callback;
        opened.user = user;
        opened.flags = flags;
        opened.handle = handle;

        {
            let mut state = self.state.borrow_mut();

            state.opened = Some(opened);
            state.running = 0;
            state.last = Some((callback, user, flags, handle));
        }

        self.call_back(engine, MM_MOM_OPEN).await?;
        Ok(0)
    }

    fn keep_ports(&self, ports: &[Port]) {
        if let Some(opened) = self.state.borrow_mut().opened.as_mut() {
            opened.ports = ports.to_vec();
        }
    }

    /// The program called back, as it asked at the open (seg2 `0`).
    async fn call_back(&self, engine: &Engine, message: u16) -> Result<(), Stop> {
        let Some((callback, user, flags, handle)) = self.state.borrow().last else {
            return Ok(());
        };

        callback::driver_callback(
            engine,
            callback,
            (flags >> 16) as u16 | DCB_NOSWITCH,
            handle,
            message,
            user,
            0,
            0,
        )
        .await?;
        Ok(())
    }

    /// Each device it opened reset, its header unprepared and it closed;
    /// the setup let go (seg3 `e3d`).
    async fn release(&self, engine: &Engine) -> Result<(), Stop> {
        let ports = self
            .state
            .borrow_mut()
            .opened
            .take()
            .map(|opened| opened.ports)
            .unwrap_or_default();
        let header = data_segment(&engine.system()) | u32::from(HEADER);

        for port in ports.iter().filter(|port| port.handle != 0) {
            devices::send_by_handle(engine, port.handle, Kind::MidiOut, MODM_RESET, 0, 0).await?;

            if port.prepared {
                unprepare(engine, port.handle, header).await?;
            }

            devices::close(engine, port.handle, Kind::MidiOut, MODM_CLOSE).await?;
        }

        Ok(())
    }

    /// Closed (seg3 `ee8`): its devices let go, the program called back.
    async fn close(&self, engine: &Engine) -> Result<u32, Stop> {
        self.release(engine).await?;
        self.call_back(engine, MM_MOM_CLOSE).await?;
        Ok(0)
    }

    /// A short message (seg2 `3c2`), sent on as the setup has it.
    async fn data(&self, engine: &Engine, message: u32) -> Result<(), Stop> {
        let status = message as u8;

        engine.system().clock.charge(costs::DATA);
        let to = {
            let mut state = self.state.borrow_mut();
            let State {
                opened,
                running,
                programs,
                ..
            } = &mut *state;
            let Some(opened) = opened.as_ref() else {
                return Ok(());
            };
            let every: Vec<u16> = opened.ports.iter().map(|port| port.handle).collect();

            if status >= 0xf8 {
                Some((every, message))
            } else if status >= 0xf0 {
                *running = 0;
                Some((every, message))
            } else {
                let given = status & 0x80 != 0;

                if given {
                    *running = status;
                }

                if *running == 0 {
                    None
                } else {
                    channel_message(opened, programs, *running, message, given)
                }
            }
        };

        if let Some((handles, message)) = to {
            for handle in handles {
                engine.system().clock.charge(costs::SENT);
                devices::send_by_handle(engine, handle, Kind::MidiOut, MODM_DATA, message, 0)
                    .await?;
                engine.system().clock.charge(costs::RETURNED);
            }
        }

        Ok(())
    }

    /// Patches or drum patches cached on each device (seg3 `10a7`): the
    /// program's array of 128 words, a bit for each channel, given each
    /// device as the channels it plays, and given back as the devices left
    /// it. The last device's answer.
    async fn cache(&self, engine: &Engine, message: &Message) -> Result<u32, Stop> {
        let ports = self
            .state
            .borrow()
            .opened
            .as_ref()
            .map(|opened| opened.ports.clone())
            .unwrap_or_default();
        // Its answer is the last device's, kept in a word of its frame
        // nothing sets first (seg3 `1127`, `1161`): with no device open
        // there is no saying what it is.
        if ports.is_empty() {
            return Err(Stop::Unsupported(
                "the MIDI Mapper caching patches with no device open",
            ));
        }

        let asked = words(&engine.system().read_far(message.first, 0x100));
        let mut kept = [0u16; 128];
        let mut answer = 0;

        for port in &ports {
            let given: Vec<u8> = asked
                .iter()
                .flat_map(|&word| (word & port.channels).to_le_bytes())
                .collect();
            let frame = devices::below_stack(&mut engine.system(), &[&given]);
            let far = frame.pointers[0];

            // `midiOutCachePatches` answers a word, and the mapper gives
            // back no more (seg2 `1ac`).
            answer = devices::send_by_handle(
                engine,
                port.handle,
                Kind::MidiOut,
                message.message,
                far,
                message.second,
            )
            .await?
            .unwrap_or(0)
                & 0xffff;

            let mut system = engine.system();
            let left = words(&system.read_far(far, 0x100));

            frame.release(&mut system);

            for (kept, left) in kept.iter_mut().zip(left) {
                *kept |= left & port.channels;
            }
        }

        let bytes: Vec<u8> = kept.iter().flat_map(|word| word.to_le_bytes()).collect();

        engine.system().write_far(message.first, &bytes);
        Ok(answer)
    }

    /// A message for every device it has open (seg2 `d6`), as
    /// `midiOutMessage` sends it, in the order they were opened up to the
    /// first place with no handle: the last one's answer, a doubleword.
    /// With none open -- the mapper asked by its number while it is
    /// closed, as `midiOutGetVolume` asks it -- `MIDIMAP` answers the
    /// doubleword of its frame nothing set (`[bp-4]`), which there is no
    /// saying; that stops the run.
    async fn to_every_device(&self, engine: &Engine, message: &Message) -> Result<u32, Stop> {
        let handles: Vec<u16> = self
            .state
            .borrow()
            .opened
            .as_ref()
            .map(|opened| {
                opened
                    .ports
                    .iter()
                    .map(|port| port.handle)
                    .take_while(|&handle| handle != 0)
                    .collect()
            })
            .unwrap_or_default();
        let mut answer = 0;

        // `DRVM_INIT`, sent as MMSYSTEM installs the mapper, before it is
        // ever opened, comes here too; MMSYSTEM does not look at what it
        // answers (`devices.rs`), so any answer is as good.
        if handles.is_empty() && message.message != devices::DRVM_INIT {
            return Err(Stop::Unsupported(
                "a message for the MIDI Mapper's devices with none open",
            ));
        }

        for handle in handles {
            answer = devices::send_by_handle(
                engine,
                handle,
                Kind::MidiOut,
                message.message,
                message.first,
                message.second,
            )
            .await?
            .unwrap_or(0);
        }

        Ok(answer)
    }
}

/// A channel message, by the running status, as the setup sends it (seg2
/// `24b`): to its channel's device, mapped as the setup's channel maps it
/// (`setups::map`); none for a channel the setup sends nowhere.
fn channel_message(
    opened: &Opened,
    programs: &mut [u8; 16],
    running: u8,
    message: u32,
    given: bool,
) -> Option<(Vec<u16>, u32)> {
    let channel = usize::from(running & 0xf);
    let port = opened.channels[channel]?;
    let setup = opened.setup.as_ref()?;
    let message = setups::map(&setup.channels[channel], programs, running, message, given);

    Some((vec![opened.ports[port].handle], message))
}

/// Each channel's device found by its name (seg3 `1bd7`-`1c8c`): the
/// devices counted once, then for each channel that names one each
/// device's capabilities asked for in turn until a name is the same. Each
/// device named is looked for, and only a channel the setup sends is given
/// one (seg3 `1243`). A device not found leaves its channel nowhere and the
/// rest still looked for; then there are none (seg3 `1d57`).
async fn devices_of(
    engine: &Engine,
    setup: &setups::Setup,
) -> Result<Option<[Option<u16>; 16]>, Stop> {
    let count = engine.system().mmsystem.devices.count(Kind::MidiOut);
    let mut devices = [None; 16];
    let mut missing = false;

    for (channel, each) in setup.channels.iter().enumerate().take(16) {
        let Some(device) = &each.device else { continue };
        let mut found = None;
        let name = named(engine, device);

        for id in 0..count {
            engine.system().clock.charge(costs::ASKED);

            if device_name(engine, id).await?.eq_ignore_ascii_case(&name) {
                found = Some(id);
                break;
            }
        }

        devices[channel] = found.filter(|_| each.sent);
        missing |= found.is_none();
    }

    Ok((!missing).then_some(devices))
}

/// A MIDI output device's name, as `midiOutGetDevCaps` gives it into
/// `MIDIOUTCAPS`' 32h bytes (seg3 `1c47`).
async fn device_name(engine: &Engine, id: u16) -> Result<Vec<u8>, Stop> {
    let frame = devices::below_stack(&mut engine.system(), &[&[0u8; 0x32]]);
    let far = frame.pointers[0];

    devices::send_by_id(engine, Kind::MidiOut, id, MODM_GETDEVCAPS, far, 0x32).await?;

    let mut system = engine.system();
    let name: Vec<u8> = system
        .read_far(far_on(far, 6), 32)
        .into_iter()
        .take_while(|&byte| byte != 0)
        .collect();

    frame.release(&mut system);
    Ok(name)
}

/// A MIDI output device opened as `midiOutOpen` opens it, with no callback:
/// what it answered, and the handle.
async fn open_device(engine: &Engine, id: u16, flags: u32) -> Result<(u16, Option<u16>), Stop> {
    let found = {
        let system = engine.system();
        let devices = &system.mmsystem.devices;

        devices.place_of(Kind::MidiOut, id).map(|(place, device)| {
            (
                place,
                device,
                devices.table(Kind::MidiOut).entries[place]
                    .procedure
                    .is_some(),
            )
        })
    };
    let Some((place, device, installed)) = found else {
        return Ok((MMSYSERR_BADDEVICEID as u16, None));
    };

    if !installed {
        return Ok((MMSYSERR_NODRIVER, None));
    }

    let describe = |opened: u16| {
        let mut bytes = opened.to_le_bytes().to_vec();

        bytes.extend_from_slice(&[0; 8]);
        bytes
    };

    devices::open(
        engine,
        Kind::MidiOut,
        place,
        device,
        id,
        MODM_OPEN,
        describe,
        flags,
        false,
        Keep::Handle,
    )
    .await
}

/// A header prepared on a device as `midiOutPrepareHeader` prepares it: one
/// prepared already answers nought; the driver asked, and MMSYSTEM marking
/// it prepared itself where the driver does not.
async fn prepare(engine: &Engine, handle: u16, header: u32) -> Result<u16, Stop> {
    {
        let mut system = engine.system();

        if checks::header_flags(&system, header) & PREPARED != 0 {
            return Ok(0);
        }

        checks::set_header_flags(&mut system, header, 0);
    }

    let answer = devices::send_by_handle(
        engine,
        handle,
        Kind::MidiOut,
        MODM_PREPARE,
        header,
        u32::from(HEADER_SIZE),
    )
    .await?
    .unwrap_or(0) as u16;

    if u32::from(answer) == MMSYSERR_NOTSUPPORTED {
        let mut system = engine.system();
        let flags = checks::header_flags(&system, header);

        checks::set_header_flags(&mut system, header, flags | PREPARED);
        return Ok(0);
    }

    Ok(answer)
}

/// A header unprepared as `midiOutUnprepareHeader` unprepares it.
async fn unprepare(engine: &Engine, handle: u16, header: u32) -> Result<u16, Stop> {
    {
        let flags = checks::header_flags(&engine.system(), header);

        if flags & PREPARED == 0 {
            return Ok(0);
        }

        if flags & MIDI_INQUEUE != 0 {
            return Ok(MIDIERR_STILLPLAYING);
        }
    }

    let answer = devices::send_by_handle(
        engine,
        handle,
        Kind::MidiOut,
        MODM_UNPREPARE,
        header,
        u32::from(HEADER_SIZE),
    )
    .await?
    .unwrap_or(0) as u16;

    if u32::from(answer) == MMSYSERR_NOTSUPPORTED {
        let mut system = engine.system();
        let flags = checks::header_flags(&system, header);

        checks::set_header_flags(&mut system, header, flags & !PREPARED);
        return Ok(0);
    }

    Ok(answer)
}

/// The mapper's data segment, as a far pointer's selector.
fn data_segment(system: &System) -> u32 {
    system.kept_named(NAME).map_or(0, |kept| {
        u32::from(segment_selector(system.kept[kept].data)) << 16
    })
}

/// A far pointer `at` bytes on, within its segment.
fn far_on(far: u32, at: u32) -> u32 {
    (far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff)
}

/// Bytes read as little-endian words.
fn words(bytes: &[u8]) -> Vec<u16> {
    bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect()
}
