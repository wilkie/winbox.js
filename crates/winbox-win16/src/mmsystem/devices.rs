//! MMSYSTEM's device layer: the waveform, MIDI and auxiliary drivers it
//! installs, how it numbers their devices, the handles it makes for the
//! devices a program opens, and the messages it sends a driver.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg2 `101`-`6e8`, seg3 `79c`-`864`,
//! seg6 `bc`-`15c`, seg8 `492`-`52e`, seg1 `1e8`, seg4 `2e6`-`350`):
//!
//! * As it loads, MMSYSTEM opens each driver `[drivers]` names `wave`,
//!   `wave1` to `wave9`, through USER's `OpenDriver`, and installs it as a
//!   waveform output driver; then opens the name again and installs that as
//!   a waveform input driver. A name with no value is passed over. If any
//!   waveform device came of it, `wavemapper` is opened and installed the
//!   same two ways as each kind's mapper. `midi` to `midi9` and
//!   `midimapper` follow, output then input; then, if there is any device
//!   at all, MMSYSTEM readies its interrupt stacks; then `aux` to `aux9`,
//!   and `auxmapper` if an auxiliary device came of them.
//! * Installing (`mmDrvInstall`, seg2 `484`) finds the driver's entry point
//!   by its name -- `wodMessage`, `widMessage`, `modMessage`, `midMessage`
//!   or `auxMessage` -- in the driver's module. One not there, or already
//!   installed, is refused. Each kind has ten places and the mapper's: the
//!   first free place takes a driver. The driver is sent `DRVM_INIT`
//!   (64h), whatever it answers, and then asked how many devices it has
//!   (`WODM_GETNUMDEVS` and the like); an answer of 64 K or more is
//!   refused. A refused driver is closed. The kind's count is the sum of
//!   its drivers' devices, the mapper's left out.
//! * A device's number counts across the drivers in their places, each
//!   driver's devices numbered from nought within it: device 2 of a kind
//!   whose first driver has two is the second driver's device 0. A number
//!   past the count is `MMSYSERR_BADDEVICEID` (2); the mapper's,
//!   `WAVE_MAPPER` or `MIDI_MAPPER` (`FFFFh`), is the mapper's place, and
//!   where no mapper was installed a message for it is
//!   `MMSYSERR_NODRIVER` (6).
//! * A device opened has a handle MMSYSTEM makes: a block of its own local
//!   heap, past a header holding the kind it is -- waveform output 1, input
//!   2, MIDI output 3, input 4 -- and the task that made it. Every call on
//!   a handle checks the kind first: a handle of another kind, or one
//!   closed, is `MMSYSERR_INVALHANDLE` (5). The block holds the driver's
//!   place, the device's number within the driver, the doubleword the
//!   driver gave as its own at the open, and the number the device was
//!   opened by.
//! * A message for a handle goes to the driver's entry point with the
//!   device's number within the driver, the message, the driver's own
//!   doubleword and the two parameters; one for a device by number, with
//!   nought for the driver's own.
//!
//! The handles' numbers are winbox.js's own: MMSYSTEM's are offsets of
//! blocks in its local heap, which winbox.js does not keep; it numbers them
//! from `1006h` in steps of `10h`, a freed one taken again first, as a freed
//! block is. The doubleword a driver keeps for a MIDI device is in
//! MMSYSTEM's data segment, at the handle and 4, as it is in Windows.
//!
//! A driver of winbox.js's own (`OwnDriver`) is a kept module whose
//! `wodMessage` and the like winbox.js answers; one from a file runs on the
//! processor. Not followed: the interrupt stacks; and the handles of a task
//! closed as it ends (`DRV_EXITAPPLICATION`), which USER does not send.

use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;

use winbox_cpu::{SP, SS};
use winbox_machine::{index_for, segment_selector};

use crate::call::Stop;
use crate::engine::{Engine, GuestArg};
use crate::system::{STEP, System};

pub const MMSYSERR_NOERROR: u16 = 0;
pub const MMSYSERR_BADDEVICEID: u16 = 2;
pub const MMSYSERR_ALLOCATED: u16 = 4;
pub const MMSYSERR_INVALHANDLE: u16 = 5;
pub const MMSYSERR_NODRIVER: u16 = 6;
pub const MMSYSERR_NOMEM: u16 = 7;
pub const MMSYSERR_NOTSUPPORTED: u16 = 8;
pub const MMSYSERR_BADERRNUM: u16 = 9;
pub const MMSYSERR_INVALFLAG: u16 = 10;
pub const MMSYSERR_INVALPARAM: u16 = 11;

/// The number a mapper is opened and asked by.
pub const MAPPER: u16 = 0xffff;

/// What every driver is sent as it is installed.
pub const DRVM_INIT: u16 = 0x64;

/// `mmDrvInstall`'s flags: the handle is a driver's, not a module's; the
/// driver is the kind's mapper; the driver is to be removed.
pub const MMDRVI_HDRV: u16 = 0x4000;
pub const MMDRVI_MAPPER: u16 = 0x8000;
pub const MMDRVI_REMOVE: u16 = 0x2000;

/// The places of a kind's table: ten drivers, then the mapper's.
const PLACES: usize = 11;
const MAPPER_PLACE: usize = 10;

/// The first handle's number, and the step to the next.
const HANDLE_FIRST: u16 = 0x1006;
const HANDLE_STEP: u16 = 0x10;

/// A kind of device, numbered as `mmDrvInstall`'s flags number them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    WaveIn = 1,
    WaveOut = 2,
    MidiIn = 3,
    MidiOut = 4,
    Aux = 5,
}

impl Kind {
    pub const ALL: [Self; 5] = [
        Self::WaveIn,
        Self::WaveOut,
        Self::MidiIn,
        Self::MidiOut,
        Self::Aux,
    ];

    /// The kind `mmDrvInstall`'s flags name, in their low four bits.
    pub fn from_flags(flags: u16) -> Option<Self> {
        Some(match flags & 0xf {
            1 => Self::WaveIn,
            2 => Self::WaveOut,
            3 => Self::MidiIn,
            4 => Self::MidiOut,
            5 => Self::Aux,
            _ => return None,
        })
    }

    fn index(self) -> usize {
        self as usize - 1
    }

    /// The driver's entry point for the kind, by its exported name.
    pub fn entry_point(self) -> &'static str {
        match self {
            Self::WaveIn => "widMessage",
            Self::WaveOut => "wodMessage",
            Self::MidiIn => "midMessage",
            Self::MidiOut => "modMessage",
            Self::Aux => "auxMessage",
        }
    }

    /// The message that asks a driver how many devices it has.
    pub fn get_num_devs(self) -> u16 {
        match self {
            Self::WaveIn => 50,
            Self::WaveOut | Self::Aux => 3,
            Self::MidiIn => 53,
            Self::MidiOut => 1,
        }
    }

    /// The kind a handle's header names: none for an auxiliary device,
    /// which is never opened.
    pub fn handle_type(self) -> u16 {
        match self {
            Self::WaveOut => 1,
            Self::WaveIn => 2,
            Self::MidiOut => 3,
            Self::MidiIn => 4,
            Self::Aux => 0,
        }
    }
}

/// A message to a driver's device, as `wodMessage` and the like are
/// called: the device's number within the driver, the message, the
/// doubleword the driver keeps for an open device, and two parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Message {
    pub device: u16,
    pub message: u16,
    pub user: u32,
    pub first: u32,
    pub second: u32,
}

/// What a driver of winbox.js's own answers in its time.
pub type Answering<'a> = Pin<Box<dyn Future<Output = Result<u32, Stop>> + 'a>>;

/// A driver of winbox.js's own: a kept module whose `wodMessage`,
/// `widMessage`, `modMessage`, `midMessage` or `auxMessage` winbox.js
/// answers. It is given each message as a driver from a file is, its
/// structures in the program's memory, and answers as one would; it calls
/// a program back with `callback::driver_callback`, as a driver calls
/// `DriverCallback`.
pub trait OwnDriver {
    /// A message for one of its devices of a kind.
    fn message<'a>(&'a self, engine: &'a Engine, kind: Kind, message: Message) -> Answering<'a>;
}

/// The drivers of winbox.js's own, by the kept module each is. There are
/// none yet.
fn make_own(_module: &str) -> Option<Rc<dyn OwnDriver>> {
    None
}

/// A driver's entry point: where it is, and, for a driver of winbox.js's
/// own, the driver that answers it.
#[derive(Clone)]
pub struct Procedure {
    pub address: u32,
    pub own: Option<Rc<dyn OwnDriver>>,
}

impl fmt::Debug for Procedure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Procedure")
            .field("address", &format_args!("{:#010x}", self.address))
            .field("own", &self.own.is_some())
            .finish()
    }
}

/// One place of a kind's table.
#[derive(Debug, Clone, Default)]
pub struct Entry {
    /// The driver's handle, USER's; nought for one installed by its module.
    pub driver: u16,
    pub procedure: Option<Procedure>,
    /// How many devices it has, as MMSYSTEM keeps it: a byte.
    pub devices: u8,
    /// How many of its devices are open.
    pub busy: u8,
}

/// A kind's drivers, and how many devices they have.
#[derive(Debug, Clone, Default)]
pub struct Table {
    pub entries: [Entry; PLACES],
    pub count: u16,
}

/// A device opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Handle {
    pub kind: Kind,
    /// The driver's place in its kind's table.
    pub place: usize,
    /// The device's number within its driver.
    pub device: u16,
    /// The doubleword the driver keeps for it.
    pub user: u32,
    /// The number it was opened by: a mapper's, for one opened through it.
    pub id: u16,
    pub task: u16,
}

/// MMSYSTEM's devices.
#[derive(Debug, Default)]
pub struct Devices {
    tables: [Table; 5],
    handles: Vec<Option<Handle>>,
    own: Vec<(&'static str, Rc<dyn OwnDriver>)>,
}

impl fmt::Debug for dyn OwnDriver {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("OwnDriver")
    }
}

impl Devices {
    pub fn table(&self, kind: Kind) -> &Table {
        &self.tables[kind.index()]
    }

    fn table_mut(&mut self, kind: Kind) -> &mut Table {
        &mut self.tables[kind.index()]
    }

    /// How many devices of a kind there are.
    pub fn count(&self, kind: Kind) -> u16 {
        self.table(kind).count
    }

    /// Where a device's number is (seg3 `79c`): its driver's place and its
    /// number within the driver. The mapper's number is the mapper's place,
    /// device nought; a number past the count is none.
    pub fn place_of(&self, kind: Kind, id: u16) -> Option<(usize, u16)> {
        let table = self.table(kind);

        if id == MAPPER {
            return Some((MAPPER_PLACE, 0));
        }

        if id >= table.count {
            return None;
        }

        let mut left = id;

        for (place, entry) in table.entries.iter().take(MAPPER_PLACE).enumerate() {
            // MMSYSTEM sets the byte it keeps against the number's low byte.
            if entry.devices > left as u8 {
                return Some((place, left));
            }

            left = left.wrapping_sub(u16::from(entry.devices));
        }

        None
    }

    /// The handle of a kind with a number, if it is open (seg1 `1e8`).
    pub fn handle(&self, number: u16, kind: Kind) -> Option<Handle> {
        let slot = number.checked_sub(HANDLE_FIRST)?;

        if !slot.is_multiple_of(HANDLE_STEP) {
            return None;
        }

        self.handles
            .get(usize::from(slot / HANDLE_STEP))
            .copied()
            .flatten()
            .filter(|handle| handle.kind.handle_type() == kind.handle_type())
    }

    /// A handle made (seg4 `2e6`): its number.
    fn make_handle(&mut self, handle: Handle) -> u16 {
        let slot = self
            .handles
            .iter()
            .position(Option::is_none)
            .unwrap_or_else(|| {
                self.handles.push(None);
                self.handles.len() - 1
            });

        self.handles[slot] = Some(handle);
        HANDLE_FIRST + HANDLE_STEP * slot as u16
    }

    /// A handle freed (seg4 `31b`).
    fn free_handle(&mut self, number: u16) {
        if let Some(slot) = number.checked_sub(HANDLE_FIRST)
            && let Some(handle) = self.handles.get_mut(usize::from(slot / HANDLE_STEP))
        {
            *handle = None;
        }
    }

    fn set_user(&mut self, number: u16, user: u32) {
        if let Some(Some(handle)) = number
            .checked_sub(HANDLE_FIRST)
            .and_then(|slot| self.handles.get_mut(usize::from(slot / HANDLE_STEP)))
        {
            handle.user = user;
        }
    }

    /// A driver of winbox.js's own put in place of a kept module's, as
    /// stage of its making or a test makes one.
    pub fn register_own(&mut self, module: &'static str, driver: Rc<dyn OwnDriver>) {
        self.own.retain(|(name, _)| *name != module);
        self.own.push((module, driver));
    }

    fn own_driver(&mut self, module: &'static str) -> Option<Rc<dyn OwnDriver>> {
        if let Some((_, driver)) = self.own.iter().find(|(name, _)| *name == module) {
            return Some(Rc::clone(driver));
        }

        let driver = make_own(module)?;

        self.own.push((module, Rc::clone(&driver)));
        Some(driver)
    }
}

/// The entry point at an address: a driver of winbox.js's own where it is
/// a kept module's export, else a procedure to run on the processor.
fn procedure_at(system: &mut System, address: u32) -> Result<Procedure, Stop> {
    let offset = (address & 0xffff) as u16;
    let kept = system
        .kept_at(index_for((address >> 16) as u16))
        .filter(|_| offset.is_multiple_of(STEP))
        .map(|kept| kept.module.name);

    let Some(module) = kept else {
        return Ok(Procedure { address, own: None });
    };

    match system.mmsystem.devices.own_driver(module) {
        Some(driver) => Ok(Procedure {
            address,
            own: Some(driver),
        }),
        None => Err(Stop::Unsupported(
            "a kept module's device entry point, no driver of winbox.js's answering it",
        )),
    }
}

/// A message sent to a driver's entry point: what it answers, DX:AX.
pub async fn call(
    engine: &Engine,
    procedure: &Procedure,
    kind: Kind,
    message: Message,
) -> Result<u32, Stop> {
    if let Some(driver) = procedure.own.clone() {
        return driver.message(engine, kind, message).await;
    }

    let args = [
        GuestArg::Word(message.device),
        GuestArg::Word(message.message),
        GuestArg::Long(message.user),
        GuestArg::Long(message.first),
        GuestArg::Long(message.second),
    ];

    Ok(Box::pin(engine.call_with(procedure.address, &args, &[]))
        .await?
        .0)
}

/// A message for a device by its number (seg3 `817`): `MMSYSERR_BADDEVICEID`
/// for a number there is no device of, `MMSYSERR_NODRIVER` for a place no
/// driver has; else what the driver answers, given nought as its own.
pub async fn send_by_id(
    engine: &Engine,
    kind: Kind,
    id: u16,
    message: u16,
    first: u32,
    second: u32,
) -> Result<u32, Stop> {
    let found = {
        let system = engine.system();
        let devices = &system.mmsystem.devices;

        devices
            .place_of(kind, id)
            .map(|(place, device)| (device, devices.table(kind).entries[place].procedure.clone()))
    };
    let Some((device, procedure)) = found else {
        return Ok(u32::from(MMSYSERR_BADDEVICEID));
    };
    let Some(procedure) = procedure else {
        return Ok(u32::from(MMSYSERR_NODRIVER));
    };

    call(
        engine,
        &procedure,
        kind,
        Message {
            device,
            message,
            user: 0,
            first,
            second,
        },
    )
    .await
}

/// A message for an open device (seg3 `7f0`, seg1 `c4`): what its driver
/// answers, or `None` for a number that is no open handle of the kind.
pub async fn send_by_handle(
    engine: &Engine,
    number: u16,
    kind: Kind,
    message: u16,
    first: u32,
    second: u32,
) -> Result<Option<u32>, Stop> {
    let found = {
        let system = engine.system();
        let devices = &system.mmsystem.devices;

        devices.handle(number, kind).map(|handle| {
            (
                handle,
                devices.table(kind).entries[handle.place].procedure.clone(),
            )
        })
    };
    let Some((handle, Some(procedure))) = found else {
        return Ok(None);
    };

    call(
        engine,
        &procedure,
        kind,
        Message {
            device: handle.device,
            message,
            user: handle.user,
            first,
            second,
        },
    )
    .await
    .map(Some)
}

/// The open handles a driver installed: how many of its devices are open,
/// one more or one fewer.
fn count_busy(system: &mut System, kind: Kind, place: usize, more: bool) {
    let entry = &mut system.mmsystem.devices.table_mut(kind).entries[place];

    entry.busy = if more {
        entry.busy.wrapping_add(1)
    } else {
        entry.busy.wrapping_sub(1)
    };
}

/// What a driver gets to open a device with, and where its own doubleword
/// is to be kept.
#[derive(Debug, Clone, Copy)]
pub enum Keep {
    /// In MMSYSTEM's frame, on the program's stack: waveform devices.
    Stack,
    /// In the handle's block in MMSYSTEM's data segment: MIDI devices.
    Handle,
}

/// A device opened (seg3 `9e3` from `a5e`, seg6 `2a7` from `308`), its
/// arguments checked: its driver found, a handle made unless only a
/// question is asked (`query`), and the driver sent `open` with the
/// doubleword it is to keep and the description `describe` makes of the
/// handle. What the driver answers, and the handle, if one was made and the
/// driver agreed.
#[allow(clippy::too_many_arguments)]
pub async fn open(
    engine: &Engine,
    kind: Kind,
    place: usize,
    device: u16,
    id: u16,
    open: u16,
    describe: impl Fn(u16) -> Vec<u8>,
    flags: u32,
    query: bool,
    keep: Keep,
) -> Result<(u16, Option<u16>), Stop> {
    let (procedure, number) = {
        let mut system = engine.system();
        let task = system.task_handle;
        let procedure = system.mmsystem.devices.table(kind).entries[place]
            .procedure
            .clone();
        let number = (!query).then(|| {
            system.mmsystem.devices.make_handle(Handle {
                kind,
                place,
                device,
                user: 0,
                id,
                task,
            })
        });

        (procedure, number)
    };
    let Some(procedure) = procedure else {
        if let Some(number) = number {
            engine.system().mmsystem.devices.free_handle(number);
        }

        return Ok((MMSYSERR_NODRIVER, None));
    };
    let description = describe(number.unwrap_or(0));
    let (user_at, frame) = {
        let mut system = engine.system();

        if let (Keep::Handle, Some(number)) = (keep, number) {
            let at = mmsystem_data(&system) | u32::from(number.wrapping_add(4));

            system.write_far(at, &[0; 4]);
            (at, below_stack(&mut system, &[&description]))
        } else {
            // MMSYSTEM's doubleword is left as its frame had it; winbox.js's
            // starts at nought.
            let frame = below_stack(&mut system, &[&[0; 4], &description]);

            (frame.pointers[0], frame)
        }
    };
    let answer = call(
        engine,
        &procedure,
        kind,
        Message {
            device,
            message: open,
            user: user_at,
            first: *frame.pointers.last().unwrap_or(&0),
            second: flags,
        },
    )
    .await? as u16;
    let user = {
        let mut system = engine.system();
        let bytes = system.read_far(user_at, 4);

        frame.release(&mut system);
        u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
    };

    let Some(number) = number else {
        return Ok((answer, None));
    };

    let mut system = engine.system();

    if answer != MMSYSERR_NOERROR {
        system.mmsystem.devices.free_handle(number);
        return Ok((answer, None));
    }

    count_busy(&mut system, kind, place, true);
    system.mmsystem.devices.set_user(number, user);
    Ok((answer, Some(number)))
}

/// A device closed (seg3 `b81`, seg6 `3c4`): the driver sent `close`, and,
/// if it agrees, the handle freed. What the driver answered, or
/// `MMSYSERR_INVALHANDLE`.
pub async fn close(engine: &Engine, number: u16, kind: Kind, close: u16) -> Result<u16, Stop> {
    let Some(answer) = send_by_handle(engine, number, kind, close, 0, 0).await? else {
        return Ok(MMSYSERR_INVALHANDLE);
    };
    let answer = answer as u16;

    if answer == MMSYSERR_NOERROR {
        let mut system = engine.system();

        if let Some(handle) = system.mmsystem.devices.handle(number, kind) {
            count_busy(&mut system, kind, handle.place, false);
        }

        system.mmsystem.devices.free_handle(number);
    }

    Ok(answer)
}

/// MMSYSTEM's data segment, as a far pointer's selector.
fn mmsystem_data(system: &System) -> u32 {
    system.kept_named("MMSYSTEM").map_or(0, |kept| {
        u32::from(segment_selector(system.kept[kept].data)) << 16
    })
}

/// Structures laid below the program's stack, as MMSYSTEM keeps them in its
/// frame, the stack pointer moved past them while they are there.
#[derive(Debug)]
pub struct Frame {
    saved: u16,
    pub pointers: Vec<u32>,
}

impl Frame {
    /// The stack pointer put back.
    pub fn release(&self, system: &mut System) {
        system.cpu.regs[SP] = self.saved;
    }
}

/// Each structure put below the stack, the first highest: their far
/// pointers.
pub fn below_stack(system: &mut System, structures: &[&[u8]]) -> Frame {
    let saved = system.cpu.regs[SP];
    let base = system.cpu.segments[SS].base;
    let selector = system.cpu.segments[SS].selector;
    let mut offset = saved;
    let mut pointers = Vec::with_capacity(structures.len());

    for bytes in structures {
        // Kept to a word's boundary, as a frame's locals are.
        offset = offset.wrapping_sub(bytes.len() as u16) & !1;
        system.cpu.bus.write(base + u32::from(offset), bytes);
        pointers.push(u32::from(selector) << 16 | u32::from(offset));
    }

    system.cpu.regs[SP] = offset;
    Frame { saved, pointers }
}

/// A driver installed, or removed, as `mmDrvInstall` does (seg2 `484`): by
/// the driver's handle, or a module's, an entry point given or found by its
/// name, and the flags that say the kind, whether it is the mapper and
/// whether it is to be removed. The driver's place and one, or nought for
/// one refused; 1 for one removed.
pub async fn install(
    engine: &Engine,
    handle: u16,
    procedure: Option<u32>,
    flags: u16,
) -> Result<u16, Stop> {
    let remove = flags & MMDRVI_REMOVE != 0;
    let (driver, module) = if handle != 0 && flags & MMDRVI_HDRV != 0 {
        (
            handle,
            crate::drivers::driver_module(&engine.system(), handle),
        )
    } else {
        (0, handle)
    };
    let refuse = async || -> Result<u16, Stop> {
        if driver != 0 && !remove {
            engine.close_driver(driver, 0, 0).await?;
        }

        Ok(0)
    };
    let Some(kind) = Kind::from_flags(flags) else {
        return refuse().await;
    };
    let address = match procedure.filter(|&address| address != 0) {
        Some(address) => address,
        None if module != 0 => {
            crate::modules_kernel::proc_named(&mut engine.system(), module, kind.entry_point())
        }
        None => 0,
    };

    if address == 0 {
        return refuse().await;
    }

    let found = engine
        .system()
        .mmsystem
        .devices
        .table(kind)
        .entries
        .iter()
        .position(|entry| {
            entry
                .procedure
                .as_ref()
                .is_some_and(|procedure| procedure.address == address)
        });

    if remove {
        return match found {
            Some(place) => uninstall(engine, kind, place).await,
            None => Ok(0),
        };
    }

    if found.is_some() {
        return refuse().await;
    }

    let place = {
        let system = engine.system();
        let table = system.mmsystem.devices.table(kind);

        if flags & MMDRVI_MAPPER != 0 {
            table.entries[MAPPER_PLACE]
                .procedure
                .is_none()
                .then_some(MAPPER_PLACE)
        } else {
            table.entries[..MAPPER_PLACE]
                .iter()
                .position(|entry| entry.procedure.is_none())
        }
    };
    let Some(place) = place else {
        return refuse().await;
    };
    let procedure = procedure_at(&mut engine.system(), address)?;
    let message = |message| Message {
        device: 0,
        message,
        user: 0,
        first: 0,
        second: 0,
    };

    call(engine, &procedure, kind, message(DRVM_INIT)).await?;

    let devices = call(engine, &procedure, kind, message(kind.get_num_devs())).await?;

    if devices >> 16 != 0 {
        return refuse().await;
    }

    let mut system = engine.system();
    let table = system.mmsystem.devices.table_mut(kind);

    table.entries[place] = Entry {
        driver,
        procedure: Some(procedure),
        devices: devices as u8,
        busy: 0,
    };

    if place != MAPPER_PLACE {
        table.count = table.count.wrapping_add(u16::from(devices as u8));
    }

    Ok(place as u16 + 1)
}

/// A driver removed from its place (seg2 `56f`), unless a device of it is
/// open: its devices no longer counted, and it closed. 1, or nought.
async fn uninstall(engine: &Engine, kind: Kind, place: usize) -> Result<u16, Stop> {
    let entry = {
        let mut system = engine.system();
        let table = system.mmsystem.devices.table_mut(kind);

        if table.entries[place].busy != 0 {
            return Ok(0);
        }

        if place != MAPPER_PLACE {
            table.count = table
                .count
                .wrapping_sub(u16::from(table.entries[place].devices));
        }

        std::mem::take(&mut table.entries[place])
    };

    if entry.driver != 0 {
        engine.close_driver(entry.driver, 0, 0).await?;
    }

    Ok(1)
}

/// Opens a driver `[drivers]` names (seg2 `443`), if it names it with a
/// value: its handle, or nought.
async fn open_named(engine: &Engine, name: &[u8]) -> Result<u16, Stop> {
    let named = {
        let mut system = engine.system();
        let profile = system.read_profile(b"SYSTEM.INI");

        profile
            .get(b"Drivers", name, true)
            .is_some_and(|value| !value.is_empty())
    };

    if !named {
        return Ok(0);
    }

    engine.open_driver(name, None, 0).await
}

/// The drivers of two kinds `[drivers]` names by a stem -- `wave` and
/// `wave1` to `wave9` -- each opened and installed as the first kind, then
/// opened again and installed as the second (seg2 `2bb`, `34b`, `3db`);
/// then, if either has a device, the mapper.
async fn open_kinds(
    engine: &Engine,
    stem: &[u8],
    first: Kind,
    second: Option<Kind>,
    mapper: &[u8],
) -> Result<(), Stop> {
    for digit in 0..10u8 {
        let mut name = stem.to_vec();

        if digit > 0 {
            name.push(b'0' + digit);
        }

        let handle = open_named(engine, &name).await?;

        if handle == 0 {
            continue;
        }

        install(engine, handle, None, MMDRVI_HDRV | first as u16).await?;

        if let Some(second) = second {
            let handle = open_named(engine, &name).await?;

            install(engine, handle, None, MMDRVI_HDRV | second as u16).await?;
        }
    }

    let any = {
        let system = engine.system();
        let devices = &system.mmsystem.devices;

        devices.count(first) != 0 || second.is_some_and(|second| devices.count(second) != 0)
    };

    if !any {
        return Ok(());
    }

    let handle = open_named(engine, mapper).await?;

    if handle == 0 {
        return Ok(());
    }

    install(
        engine,
        handle,
        None,
        MMDRVI_HDRV | MMDRVI_MAPPER | first as u16,
    )
    .await?;

    if let Some(second) = second {
        let handle = open_named(engine, mapper).await?;

        install(
            engine,
            handle,
            None,
            MMDRVI_HDRV | MMDRVI_MAPPER | second as u16,
        )
        .await?;
    }

    Ok(())
}

/// The waveform, MIDI and auxiliary drivers opened and installed, as
/// MMSYSTEM's first load readies them after the timer's.
pub async fn open_drivers(engine: &Engine) -> Result<(), Stop> {
    open_kinds(
        engine,
        b"wave",
        Kind::WaveOut,
        Some(Kind::WaveIn),
        b"wavemapper",
    )
    .await?;
    open_kinds(
        engine,
        b"midi",
        Kind::MidiOut,
        Some(Kind::MidiIn),
        b"midimapper",
    )
    .await?;
    open_kinds(engine, b"aux", Kind::Aux, None, b"auxmapper").await
}
