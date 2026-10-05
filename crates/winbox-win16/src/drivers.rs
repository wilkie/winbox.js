//! Installable drivers: the table USER keeps of them, and the calls that
//! open, ask, walk and close them.
//!
//! **Read out** of `USER.EXE` (seg41 `0`-`67c`, seg2 `4cc`-`821`, seg3
//! `2644`) and **recorded** by `drivers`, the list Windows starts with, and
//! `drvmsg`, whose own driver logs every call it is given:
//!
//! * The table is a row of slots, and a driver's handle is its slot's place
//!   plus one. An open takes the first free slot; the slots are linked in a
//!   list, a new one at its end once it has loaded. Each open of a module
//!   has a slot of its own and a `LoadLibrary` of its own; the first
//!   instance is the one that was loaded and enabled.
//! * A driver's name is looked up in `SYSTEM.INI`, in `[drivers]` unless a
//!   section is named: the value is the file, and the words after it are
//!   the text `DRV_OPEN` is given. A name not there is the file itself. The
//!   entry point is the module's export named `DriverProc`.
//! * A module's first open sends a call of message nought, then `DRV_LOAD`,
//!   then `DRV_ENABLE`, each with an identifier of nought; every open then
//!   sends `DRV_OPEN` with the handle as its identifier, and what it
//!   answers is the identifier after -- nought refusing the open.
//! * `CloseDriver` sends `DRV_CLOSE`, and nought refuses it. The last
//!   instance then gets `DRV_DISABLE` and `DRV_FREE`, with an identifier of
//!   nought. Every close frees the library once.
//!
//! The drivers `SYSTEM.INI`'s `[boot]` names are loaded the first time a
//! program starts, as USER loads them from its first `InitApp`: loaded and
//! enabled, but not opened.
//!
//! Not followed: the check that a driver takes exactly its 16 bytes of
//! arguments off the stack, which USER makes around the call of message
//! nought; the `OpenFile` USER makes before `LoadLibrary`, which fails as
//! `LoadLibrary` then would; the error mode it sets around the load; and
//! the messages USER broadcasts to every driver as Windows ends and as a
//! program does.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::{handle_for, index_for};

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::system::{STEP, System};

const DRV_LOAD: u16 = 1;
const DRV_ENABLE: u16 = 2;
pub const DRV_OPEN: u16 = 3;
pub const DRV_CLOSE: u16 = 4;
const DRV_DISABLE: u16 = 5;
const DRV_FREE: u16 = 6;

const GND_FIRSTINSTANCEONLY: u32 = 1;
const GND_REVERSE: u32 = 2;

/// `GetDriverInfo`'s structure, whose length must be this.
const DRIVERINFO_SIZE: u16 = 0x86;

/// One slot of USER's table.
#[derive(Debug, Clone, Default)]
struct Slot {
    /// Whether this is the instance that was loaded and enabled.
    first: bool,
    next: Option<usize>,
    prev: Option<usize>,
    /// The module's instance; nought for a free slot, 1 while it loads.
    module: u16,
    id: u32,
    alias: Vec<u8>,
    /// `DriverProc`, as `GetProcAddress` gave it.
    proc: u32,
}

/// USER's table of installable drivers.
#[derive(Debug, Default)]
pub struct Drivers {
    slots: Vec<Slot>,
    head: Option<usize>,
    tail: Option<usize>,
    /// Whether `[boot]`'s drivers have been loaded.
    loaded: bool,
}

impl Drivers {
    /// The slot a handle names, if it is in use.
    fn slot_of(&self, handle: u16) -> Option<&Slot> {
        let slot = self.slots.get(usize::from(handle).checked_sub(1)?)?;

        (slot.module != 0).then_some(slot)
    }

    /// How many slots hold a module: its instances.
    fn instances(&self, module: u16) -> usize {
        self.slots
            .iter()
            .filter(|slot| slot.module == module)
            .count()
    }

    fn link(&mut self, index: usize) {
        match self.tail {
            Some(tail) if self.head.is_some() => {
                self.slots[index].prev = Some(tail);
                self.slots[index].next = None;
                self.slots[tail].next = Some(index);
                self.tail = Some(index);
            }
            _ => {
                self.head = Some(index);
                self.tail = Some(index);
                self.slots[index].next = None;
                self.slots[index].prev = None;
            }
        }
    }

    fn unlink(&mut self, index: usize) {
        let (prev, next) = (self.slots[index].prev, self.slots[index].next);

        if Some(index) == self.head {
            self.head = next;

            match next {
                None => {
                    // The list empty, the row goes with it.
                    self.tail = None;
                    self.slots.clear();
                }
                Some(head) => self.slots[head].prev = None,
            }
        } else if Some(index) == self.tail {
            self.tail = prev;

            if let Some(tail) = prev {
                self.slots[tail].next = None;
            }
        } else {
            if let Some(prev) = prev {
                self.slots[prev].next = next;
            }

            if let Some(next) = next {
                self.slots[next].prev = prev;
            }
        }
    }
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "OpenDriver" => Implementation::Async(open_driver_call),
        "CloseDriver" => Implementation::Async(close_driver),
        "SendDriverMessage" => Implementation::Async(send_driver_message),
        "GetNextDriver" => Implementation::Sync(get_next_driver),
        "GetDriverInfo" => Implementation::Sync(get_driver_info),
        "GetDriverModuleHandle" => Implementation::Sync(get_driver_module_handle),
        "DefDriverProc" => Implementation::Sync(def_driver_proc_call),
        _ => return None,
    })
}

/// A string argument as the TypeScript engine reads one: `None` for a null
/// pointer, a number's digits where the segment is nought.
pub(crate) fn lpcstr(system: &System, far: u32) -> Option<Vec<u8>> {
    match (far >> 16, far & 0xffff) {
        (0, 0) => None,
        (0, number) => Some(number.to_string().into_bytes()),
        _ => Some(system.read_string(far)),
    }
}

/// Bytes as the TypeScript engine's strings hold them, a character each.
pub(crate) fn text_of(bytes: &[u8]) -> String {
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

impl System {
    /// A block of the global heap, moveable and zeroed, as winbox.js takes
    /// one for itself (`GlobalAlloc` 42h): its handle, and where it is.
    pub(crate) fn scratch_block(&mut self, size: u32) -> (u16, u32) {
        let handle = self
            .global
            .allocate(&mut self.cpu.bus, &mut self.descriptors, size, 0x42)
            .map_or(0, handle_for);
        let far = self.global_pointer(handle);

        (handle, far)
    }

    /// A block taken with `scratch_block` let go.
    pub(crate) fn free_scratch(&mut self, handle: u16) {
        let _ = crate::memory::global_free(self, &mut Args::repeat(handle));
    }

    /// Text in a block of its own, for a driver to read: its handle and
    /// where it is.
    pub(crate) fn scratch_text(&mut self, text: &[u8]) -> (u16, u32) {
        let (handle, far) = self.scratch_block(text.len() as u32 + 1);

        self.write_far(far, text);
        self.write_far(far.wrapping_add(text.len() as u32), &[0]);
        (handle, far)
    }
}

impl Engine {
    /// Calls a driver's `DriverProc`. One winbox.js keeps itself is called
    /// as the function it is; one from a file, on the processor.
    async fn call_driver(
        &self,
        proc: u32,
        id: u32,
        handle: u16,
        message: u16,
        first: u32,
        second: u32,
    ) -> Result<u32, Stop> {
        // A kept module's export, where the procedure is one's: its stub,
        // a step past the callback thunk for each ordinal.
        let kept = {
            let system = self.system();
            let offset = (proc & 0xffff) as u16;

            system
                .kept_at(index_for((proc >> 16) as u16))
                .filter(|_| offset.is_multiple_of(STEP))
                .and_then(|kept| {
                    let export = kept.module.export((offset / STEP).checked_sub(1)?)?;

                    Some((kept.module.name, export))
                })
        };

        // winbox.js calls the export's own function with the driver's five
        // arguments: a stub answers nothing, nought; a kept driver's `WEP`,
        // 1.
        if let Some((module, export)) = kept {
            return match export.name {
                _ if export.stub => Ok(0),
                "DriverProc" => {
                    Box::pin(self.kept_driver_proc(module, id, handle, message, first, second))
                        .await
                }
                "WEP" => Ok(1),
                _ => Err(Stop::Unsupported(
                    "a kept module's export called as a driver",
                )),
            };
        }

        let args = [
            GuestArg::Long(id),
            GuestArg::Word(handle),
            GuestArg::Word(message),
            GuestArg::Long(first),
            GuestArg::Long(second),
        ];

        Ok(Box::pin(self.call_with(proc, &args, &[])).await?.0)
    }

    /// The `DriverProc` of a module winbox.js keeps.
    async fn kept_driver_proc(
        &self,
        module: &str,
        id: u32,
        handle: u16,
        message: u16,
        first: u32,
        second: u32,
    ) -> Result<u32, Stop> {
        match module {
            "MMSYSTEM" => {
                crate::mmsystem::driver::driver_proc(self, id, handle, message, first, second).await
            }
            "TIMER" => Ok(crate::timer::driver_proc(message)),
            "MCIWAVE" if crate::mmsystem::mci_wave::takes(&self.system(), id, message) => {
                crate::mmsystem::mci_wave::command(self, id as u16, handle, message, first, second)
                    .await
            }
            "MCISEQ" => {
                crate::mmsystem::sequencer::driver_proc(self, id, handle, message, first, second)
                    .await
            }
            "MCIWAVE" => crate::mmsystem::mci_drivers::driver_proc(
                &mut self.system(),
                module,
                id,
                handle,
                message,
                first,
                second,
            ),
            crate::wbsound::NAME => Ok(crate::wbsound::driver_proc(
                &mut self.system(),
                handle,
                message,
            )),
            crate::wbmapper::NAME => Ok(crate::wbmapper::driver_proc(handle, message)),
            _ => Err(Stop::Unsupported("a kept module without a DriverProc")),
        }
    }

    /// A message to one driver, by its handle, as `SendDriverMessage` sends
    /// it (seg2 `4cc`).
    pub async fn send_to_driver(
        &self,
        handle: u16,
        message: u16,
        first: u32,
        second: u32,
    ) -> Result<u32, Stop> {
        let target = {
            let system = self.system();
            let table = &system.drivers;

            if table.slots.is_empty()
                || usize::from(handle) > table.slots.len()
                || table.head.is_none()
                || handle == 0
            {
                return Ok(0);
            }

            match table.slot_of(handle) {
                Some(slot) if slot.proc != 0 => (slot.proc, slot.id),
                _ => return Ok(0),
            }
        };

        self.call_driver(target.0, target.1, handle, message, first, second)
            .await
    }

    /// Loads a driver into a slot of its own, as USER's loader does (seg41
    /// `165`): its handle, and the text after its file's name, or `None`.
    async fn load_driver(
        &self,
        name: &[u8],
        section: Option<&[u8]>,
        enable: bool,
    ) -> Result<Option<(u16, Vec<u8>)>, Stop> {
        if name.is_empty() {
            return Ok(None);
        }

        let (index, file, words) = {
            let mut system = self.system();
            let table = &mut system.drivers;

            // The row grows by one, and the first free slot is taken; the
            // row gives the slot back if it was not the new last one.
            table.slots.push(Slot::default());

            let mut index = table
                .slots
                .iter()
                .position(|slot| slot.module == 0)
                .unwrap_or(0);

            if index != table.slots.len() - 1 {
                table.slots.pop();
                index = table
                    .slots
                    .iter()
                    .position(|slot| slot.module == 0)
                    .unwrap_or(0);
            }

            table.slots[index] = Slot {
                module: 1,
                ..Slot::default()
            };

            let profile = system.read_profile(b"SYSTEM.INI");
            let value = profile
                .get(section.unwrap_or(b"DRIVERS"), name, true)
                .unwrap_or_else(|| name.to_vec());
            let (file, words) = match value.iter().position(|&byte| byte == b' ') {
                Some(space) => (value[..space].to_vec(), value[space + 1..].to_vec()),
                None => (value, Vec::new()),
            };

            (index, file, words)
        };
        let handle = (index + 1) as u16;
        let module = crate::modules_kernel::load_library_named(self, &text_of(&file)).await?;

        if module < 32 {
            if let Some(slot) = self.system().drivers.slots.get_mut(index) {
                slot.module = 0;
            }

            return Ok(None);
        }

        let proc = crate::modules_kernel::proc_named(&mut self.system(), module, "DriverProc");

        if proc == 0 {
            crate::modules_kernel::free_library_handle(self, module).await?;

            if let Some(slot) = self.system().drivers.slots.get_mut(index) {
                slot.module = 0;
            }

            return Ok(None);
        }

        let first = {
            let mut system = self.system();
            let table = &mut system.drivers;

            if let Some(slot) = table.slots.get_mut(index) {
                slot.module = module;
                slot.alias = name.to_vec();
                slot.proc = proc;
            }

            table.instances(module) == 1
        };

        if first {
            self.call_driver(proc, 0, handle, 0, 0, 0).await?;

            let id = self
                .system()
                .drivers
                .slots
                .get(index)
                .map_or(0, |slot| slot.id);

            if self.call_driver(proc, id, handle, DRV_LOAD, 0, 0).await? == 0 {
                crate::modules_kernel::free_library_handle(self, module).await?;

                if let Some(slot) = self.system().drivers.slots.get_mut(index) {
                    *slot = Slot::default();
                }

                return Ok(None);
            }

            if let Some(slot) = self.system().drivers.slots.get_mut(index) {
                slot.first = true;
            }
        }

        let enabled = {
            let mut system = self.system();
            let table = &mut system.drivers;

            if index < table.slots.len() {
                table.link(index);
            }

            table.slots.get(index).is_some_and(|slot| slot.first)
        };

        if enable && enabled {
            self.send_to_driver(handle, DRV_ENABLE, 0, 0).await?;
        }

        Ok(Some((handle, words)))
    }

    /// Lets a slot go (seg41 `38a`): the last instance disabled, if asked,
    /// and freed; the library freed once; the slot out of the list. Answers
    /// how many instances are left.
    async fn release_slot(&self, handle: u16, disable: bool) -> Result<usize, Stop> {
        let index = usize::from(handle) - 1;
        let (module, count) = {
            let mut system = self.system();
            let table = &mut system.drivers;
            let Some(slot) = table.slots.get_mut(index) else {
                return Err(Stop::Unsupported("a driver let go whose slot is gone"));
            };
            let module = slot.module;

            slot.id = 0;
            (module, table.instances(module))
        };

        if count == 1 {
            if disable {
                self.send_to_driver(handle, DRV_DISABLE, 0, 0).await?;
            }

            self.send_to_driver(handle, DRV_FREE, 0, 0).await?;
        }

        crate::modules_kernel::free_library_handle(self, module).await?;

        let mut system = self.system();
        let table = &mut system.drivers;

        if let Some(slot) = table.slots.get_mut(index) {
            slot.module = 0;
            slot.first = false;
            slot.proc = 0;
            table.unlink(index);
        }

        Ok(count - 1)
    }

    /// Loads the drivers `SYSTEM.INI`'s `[boot]` names in `drivers=`, as USER
    /// does from the first `InitApp` (seg3 `2644`): each loaded and enabled,
    /// under the name as written, and not opened. One that fails is passed
    /// over.
    pub async fn load_installable_drivers(&self) -> Result<(), Stop> {
        let names: Vec<Vec<u8>> = {
            let mut system = self.system();

            if system.drivers.loaded {
                return Ok(());
            }

            system.drivers.loaded = true;

            let profile = system.read_profile(b"SYSTEM.INI");

            profile
                .get(b"boot", b"DRIVERS", true)
                .unwrap_or_default()
                .split(|&byte| byte == b' ' || byte == b',')
                .filter(|name| !name.is_empty())
                .map(<[u8]>::to_vec)
                .collect()
        };

        for name in names {
            self.load_driver(&name, None, true).await?;
        }

        Ok(())
    }

    /// Opens a driver, loading it if it is not: its handle, or nought.
    pub async fn open_driver(
        &self,
        name: &[u8],
        section: Option<&[u8]>,
        lparam: u32,
    ) -> Result<u16, Stop> {
        let Some((handle, words)) = self.load_driver(name, section, true).await? else {
            return Ok(0);
        };
        let index = usize::from(handle) - 1;
        let (block, far) = {
            let mut system = self.system();

            if let Some(slot) = system.drivers.slots.get_mut(index) {
                slot.id = u32::from(handle);
            }

            system.scratch_text(&words)
        };
        let answer = self.send_to_driver(handle, DRV_OPEN, far, lparam).await?;

        self.system().free_scratch(block);

        if answer == 0 {
            self.release_slot(handle, true).await?;
            return Ok(0);
        }

        if let Some(slot) = self.system().drivers.slots.get_mut(index) {
            slot.id = answer;
        }

        Ok(handle)
    }

    /// Closes a driver: `DRV_CLOSE`, and, if it agrees, the instance let go.
    /// What `DRV_CLOSE` answered.
    pub async fn close_driver(&self, handle: u16, first: u32, second: u32) -> Result<u32, Stop> {
        if self.system().drivers.slot_of(handle).is_none() {
            return Ok(0);
        }

        let answer = self
            .send_to_driver(handle, DRV_CLOSE, first, second)
            .await?;

        if answer == 0 {
            return Ok(0);
        }

        let (was_first, module) = {
            let system = self.system();

            system
                .drivers
                .slots
                .get(usize::from(handle) - 1)
                .map_or((false, 0), |slot| (slot.first, slot.module))
        };
        let left = self.release_slot(handle, true).await?;

        // The lowest remaining instance is the first now (seg41 `5e8`).
        if left > 0 && was_first {
            let mut system = self.system();

            if let Some(heir) = system
                .drivers
                .slots
                .iter_mut()
                .find(|one| one.module == module)
            {
                heir.first = true;
            }
        }

        Ok(answer)
    }
}

/// The driver's module, as `GetDriverModuleHandle` answers it: nought for a
/// handle past the table.
pub(crate) fn driver_module(system: &System, handle: u16) -> u16 {
    let table = &system.drivers;

    if handle >= 1 && usize::from(handle) <= table.slots.len() {
        table.slots[usize::from(handle) - 1].module
    } else {
        0
    }
}

/// Opens a driver, loading it if it is not: by its name in the section,
/// or its file; `[drivers]` for no section; `lParam` handed to `DRV_OPEN`.
fn open_driver_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (name, section, lparam) = {
            let system = engine.system();
            let name = args.dword(&system);
            let section = args.dword(&system);
            let lparam = args.dword(&system);

            (lpcstr(&system, name), lpcstr(&system, section), lparam)
        };
        let handle = engine
            .open_driver(&name.unwrap_or_default(), section.as_deref(), lparam)
            .await?;

        Ok(Answer::Word(handle))
    })
}

fn close_driver(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, first, second) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.dword(&system))
        };

        Ok(Answer::Dword(
            engine.close_driver(handle, first, second).await?,
        ))
    })
}

/// A message to a driver, answered by its `DriverProc` with its
/// identifier; nought for a handle that is no driver's.
fn send_driver_message(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (handle, message, first, second) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            engine
                .send_to_driver(handle, message, first, second)
                .await?,
        ))
    })
}

/// The next driver in the list: from its start for none, backwards with
/// `GND_REVERSE`, only the instances that were loaded with
/// `GND_FIRSTINSTANCEONLY` (seg2 `6dd`); nought at the end.
fn get_next_driver(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let flags = args.dword(system);
    let table = &system.drivers;

    let (Some(head), Some(tail)) = (table.head, table.tail) else {
        return Ok(Answer::Word(0));
    };

    if table.slots.is_empty() || usize::from(handle) > table.slots.len() {
        return Ok(Answer::Word(0));
    }

    let reverse = flags & GND_REVERSE != 0;
    let mut index = if handle == 0 {
        Some(if reverse { tail } else { head })
    } else if usize::from(handle) - 1 == if reverse { head } else { tail } {
        return Ok(Answer::Word(0));
    } else {
        let slot = &table.slots[usize::from(handle) - 1];

        if reverse { slot.prev } else { slot.next }
    };

    while let Some(at) = index {
        let slot = &table.slots[at];

        if slot.module == 0 {
            return Ok(Answer::Word(0));
        }

        if flags & GND_FIRSTINSTANCEONLY == 0 || slot.first {
            return Ok(Answer::Word((at + 1) as u16));
        }

        index = if reverse { slot.prev } else { slot.next };
    }

    Ok(Answer::Word(0))
}

/// A driver's handle, module and alias, into a structure whose length must
/// be 86h: 1, or nought.
fn get_driver_info(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let far = args.dword(system);
    let Some(slot) = system.drivers.slot_of(handle).cloned().filter(|_| far != 0) else {
        return Ok(Answer::Word(0));
    };
    let length = system.read_far(far, 2);

    if u16::from_le_bytes([length[0], length[1]]) != DRIVERINFO_SIZE {
        return Ok(Answer::Word(0));
    }

    let step = |at: u32| (far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff);
    let mut alias = slot.alias.clone();

    alias.push(0);
    system.write_far(step(2), &handle.to_le_bytes());
    system.write_far(step(4), &slot.module.to_le_bytes());
    system.write_far(step(6), &alias);
    Ok(Answer::Word(1))
}

/// The driver's module, or nought.
fn get_driver_module_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    Ok(Answer::Word(driver_module(system, handle)))
}

/// What a driver answers for a message it leaves alone: 1 for `DRV_LOAD`,
/// `DRV_ENABLE`, `DRV_DISABLE`, `DRV_FREE` and `DRV_INSTALL`, nought for
/// the rest (seg2 `7f3`). **Recorded** by `drvmsg` with an open driver.
/// With no driver, every one answered nought, which is the argument
/// check's.
pub fn def_driver_proc(handle: u16, message: u16) -> u32 {
    if handle == 0 {
        return 0;
    }

    u32::from([DRV_LOAD, DRV_ENABLE, DRV_DISABLE, DRV_FREE, 9].contains(&message))
}

fn def_driver_proc_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _id = args.dword(system);
    let handle = args.word(system);
    let message = args.word(system);

    Ok(Answer::Dword(def_driver_proc(handle, message)))
}
