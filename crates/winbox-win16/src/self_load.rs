//! Self-loading programs: those whose header's flags have 0800h, whose own
//! loader, in their first segment, loads the others. **Read out** of
//! `KRNL386.EXE` (Windows 3.1), `kb/topics/self-loading.md`:
//!
//! * `LoadModule` tests the flag twice. Where it is set it allocates none of
//!   the program's segments (seg2 `188c`, past `1f4a`, which gives the
//!   others theirs) and boots the program's loader instead (`19df`-`1a1a`):
//!   it opens the program's file through its cache of handles (seg1
//!   `521c`), calls `1ea6` with the module's database and the handle, and
//!   closes the handle after (seg1 `52fc`). Where the boot answers nought,
//!   the load fails.
//! * `1ea6` loads segment 1 as any other, relocations and all (seg1 `0970`,
//!   `LoadSegment`), so long as its flags in memory have 10h and 40h. The
//!   segment starts with the loader's table, which must start `A0`
//!   (`3041h`); KERNEL writes into it, through a writable alias, far
//!   pointers to its own: at 0Ch its data's word 21Ah (the global heap's
//!   selector), at 10h `MyAlloc` (seg1 `09b3`), at 14h `EntryAddrProc`
//!   (`0946`), at 24h `SetOwner` (`7630`). Then it calls the table's word
//!   at 4, the boot procedure, with the module's handle and the file's
//!   (`1f26`-`1f2c`), ES the segment, on its caller's stack.
//! * `LoadSegment` (seg1 `76d1`) of any other segment of such a program
//!   answers its handle where its flags in memory have 4, loaded
//!   (`7749`-`776d`); else calls `75be`, which calls the table's word at 8
//!   with the module's handle, the file's handle it was given and the
//!   segment's number, and answers what it answers. Where that is nought,
//!   it opens the file again from the database's path (`OpenFile`,
//!   `OF_REOPEN | OF_PROMPT | OF_CANCEL | OF_VERIFY`) and asks once more
//!   with that handle, closing it after (`75f3`-`7626`).
//! * The program starts as any other: its data segment, then its entry
//!   point's and its stack's segments loaded by `LoadSegment` (seg2
//!   `13e8`-`140a`, `0ae3`, `0b14`) -- by the program's loader where its
//!   own boot left them unloaded.
//! * Deleting the module calls `1f43` where the flag is set (seg2 `0ca0`),
//!   which does nothing: Windows 3.1 never calls the table's word at 18h,
//!   the program's exit procedure.
//!
//! WinBox's first program has no caller to boot it on: the boot runs on a
//! stack of its own (`BOOT_STACK`), as the task starts, before its entry
//! point.

use winbox_cpu::{CS, DS, ES, FS, GS, SP, SS};
use winbox_machine::{index_for, segment_selector};
use winbox_ne::Executable;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::engine::{Engine, Register};
use crate::loader::NOT_LOADED;
use crate::module_database as layout;
use crate::modules::Export;
use crate::system::{STEP, System};

/// The header's flag of a self-loading program.
pub const FLAG: u16 = 0x0800;

/// The loader's table at the start of segment 1, as KERNEL reads and
/// writes it: its signature, `A0`; the boot procedure; the procedure that
/// loads a segment; KERNEL's pointer to its global heap's selector;
/// KERNEL's `MyAlloc`, `EntryAddrProc` and `SetOwner`; the program's exit
/// procedure, which KERNEL never calls.
const SIGNATURE: u16 = 0x3041;
const BOOT_APP: u32 = 0x04;
const LOAD_APP_SEG: u32 = 0x08;
const HEAP_POINTER: u32 = 0x0c;
const MY_ALLOC: u32 = 0x10;
const ENTRY_ADDR_PROC: u32 = 0x14;
const SET_OWNER: u32 = 0x24;

/// KERNEL's word that holds the global heap's selector (`thhook.rs`).
const HEAP_SELECTOR: u16 = 0x21a;

/// Where KERNEL's stubs keep its procedures the table points at, past its
/// resource handler's (`resources.rs`): no ordinal of KERNEL's exports.
pub const MY_ALLOC_ORDINAL: u16 = crate::resources::DEFAULT_ORDINAL + 1;
pub const ENTRY_ADDR_PROC_ORDINAL: u16 = crate::resources::DEFAULT_ORDINAL + 2;
pub const SET_OWNER_ORDINAL: u16 = crate::resources::DEFAULT_ORDINAL + 3;

/// The stack the boot runs on, WinBox's own (the module comment).
const BOOT_STACK: u32 = 0x2000;

/// A file handle KERNEL passes for none.
const NO_FILE: u16 = 0xffff;

/// The least answer `LoadModule` takes for a module rather than an error.
const LEAST_HANDLE: u16 = 0x20;

/// Segment 1's flags `1ea6` clears before it loads the segment (`and
/// FBF9h`): given a block, loaded, and 400h.
const BOOT_CLEARED: u16 = 0x0406;

/// Bits of a segment's flags `MyAlloc` reads (seg1 `4f4c`-`4f85`): the
/// segment's type, a data segment's, moveable and discardable.
const SEGMENT_TYPE: u16 = 0x0007;
const DATA_TYPE: u16 = 0x0001;
const NO_TYPE: u16 = 0x0007;
const MOVEABLE: u16 = 0x0010;
const DISCARDABLE: u16 = 0x1000;
/// What `MyAlloc` asks `GlobalAlloc` for (`4f58`-`4f85`): discardable for
/// a discardable segment, and 8 more for discardable code; 4 for data;
/// moveable; 200h for any segment of a type.
const GMEM_DISCARDABLE: u16 = 0x0100;
const DISCARDABLE_CODE: u16 = 0x0008;
const DATA_SEGMENT: u16 = 0x0004;
const GMEM_MOVEABLE: u16 = 0x0002;
const TYPED: u16 = 0x0200;

/// Whether a module is a self-loading program's.
pub fn is_self_loading(executable: &Executable) -> bool {
    executable.header.flags & FLAG != 0
}

/// KERNEL's procedures the table points at, as its stubs keep them.
pub fn hidden(ordinal: u16) -> Option<Export> {
    let (name, pops, returns) = match ordinal {
        MY_ALLOC_ORDINAL => ("MyAlloc", 6, 4),
        ENTRY_ADDR_PROC_ORDINAL => ("EntryAddrProc", 4, 4),
        SET_OWNER_ORDINAL => ("SetOwner", 4, 0),
        _ => return None,
    };

    Some(Export {
        name,
        pops,
        returns,
        stub: false,
    })
}

/// Their implementations, by name.
pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "MyAlloc" => Implementation::Sync(my_alloc),
        "EntryAddrProc" => Implementation::Sync(entry_addr_proc),
        "SetOwner" => Implementation::Sync(set_owner),
        _ => return None,
    })
}

/// `MyAlloc(wFlags, wSize, wElem)` (seg1 `09b3`, `4f33`): a block of
/// `wSize` shifted left `wElem` times, for a segment of the flags given;
/// the selector in AX and the handle in DX -- both the handle for a fixed
/// block.
pub fn my_alloc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let flags = args.word(system);
    let size = args.word(system);
    let shift = args.word(system);
    let bytes = u32::from(size).checked_shl(u32::from(shift)).unwrap_or(0);
    let kind = flags & SEGMENT_TYPE;
    let mut asked = 0;

    if flags & DISCARDABLE != 0 {
        asked |= GMEM_DISCARDABLE;

        if kind == 0 {
            asked |= DISCARDABLE_CODE;
        }
    }

    if kind == DATA_TYPE {
        asked |= DATA_SEGMENT;
    }

    if flags & MOVEABLE != 0 {
        asked |= GMEM_MOVEABLE;
    }

    if kind != NO_TYPE {
        asked |= TYPED;
    }

    let handle = crate::memory::global_alloc_handle(system, asked, bytes);
    // A moveable block's selector, as KERNEL's `GlobalHandle` (seg1 `0ede`)
    // answers it: none where the block has no memory, its selector not
    // present (`0eee`, `0f15`). **Recorded** by `selfld`: a block of nothing
    // answers nought in AX and its handle in DX.
    let present = handle != 0
        && winbox_machine::Descriptors::rights_of(&system.cpu.bus, index_for(handle)) & PRESENT
            != 0;
    let selector = match handle {
        _ if handle & 1 != 0 => handle,
        _ if present => handle | 1,
        _ => 0,
    };

    Ok(Answer::Dword(u32::from(handle) << 16 | u32::from(selector)))
}

/// `EntryAddrProc(hModule, wOrdinal)` (seg1 `0946`, `4fe7`): where an entry
/// of a module is, its ordinal's top bit dropped -- its segment's selector
/// and its offset, the segment's handle with its low bit set, nought where
/// the segment has no handle; `FFFFh` and the number for a constant. A fixed
/// segment not yet given its block is loaded (`505e`-`5067`); a moveable
/// one is not. A module of WinBox's own answers its stub, as the linker
/// links to it.
pub fn entry_addr_proc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let module = args.word(system);
    let ordinal = args.word(system) & 0x7fff;

    Ok(Answer::Dword(system.entry_address(module, ordinal)))
}

/// `SetOwner(wSelector, wOwner)` (seg1 `7630`): the block's owner changed.
pub fn set_owner(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let selector = args.word(system);
    let owner = args.word(system);

    if selector != 0 {
        system.block_owners.insert(index_for(selector), owner);
    }

    Ok(Answer::Nothing)
}

impl System {
    /// An entry's far address, as `EntryAddrProc` answers it.
    pub(crate) fn entry_address(&mut self, module: u16, ordinal: u16) -> u32 {
        if let Some(loaded) = self.modules.iter().position(|each| each.handle == module) {
            let entry = self.modules[loaded]
                .executable
                .entry_points
                .get(usize::from(ordinal))
                .copied();

            return match entry {
                Some(winbox_ne::EntryPoint::Constant { value, .. }) => {
                    u32::from(crate::linker::CONSTANT_SEGMENT) << 16 | u32::from(value)
                }
                Some(entry) => entry.place().map_or(0, |(segment, offset)| {
                    let handle = self.segment_handle(loaded, u16::from(segment));

                    match handle {
                        0 => 0,
                        handle => u32::from(handle | 1) << 16 | u32::from(offset),
                    }
                }),
                None => 0,
            };
        }

        let Some(kept) = self
            .kept
            .iter()
            .position(|kept| segment_selector(kept.database) == module)
        else {
            return 0;
        };
        let name = self.kept[kept].module.name;

        self.linked_address(name, ordinal).unwrap_or(0)
    }

    /// A segment's handle as a module's database has it, nought for none.
    pub(crate) fn segment_handle(&self, module: usize, number: u16) -> u16 {
        let Some(base) = self.database_base(module) else {
            return 0;
        };
        let database = self.module_bytes(base);

        if number == 0 || usize::from(number) > self.modules[module].executable.segments.len() {
            return 0;
        }

        let entry = layout::segment_entry(&database, number);

        u16::from_le_bytes([
            database[entry + layout::SEGMENT_HANDLE],
            database[entry + layout::SEGMENT_HANDLE + 1],
        ])
    }

    /// Where a module's database is: its handle's descriptor's base.
    fn database_base(&self, module: usize) -> Option<u32> {
        match self.modules[module].handle {
            0 => None,
            handle => Some((index_for(handle) as u32) << 16),
        }
    }

    /// A database's bytes, as far as its segment table reaches.
    fn module_bytes(&self, base: u32) -> Vec<u8> {
        let table = self.cpu.bus.read16(base + layout::SEGMENT_TABLE as u32);
        let count = self.cpu.bus.read16(base + layout::SEGMENT_COUNT as u32);
        let length = u32::from(table) + u32::from(count) * layout::SEGMENT_ENTRY as u32;

        (0..length)
            .map(|at| self.cpu.bus.read8(base + at))
            .collect()
    }

    /// The module's segments as its database's table has them now: each
    /// with a handle given its descriptor, each without none.
    pub(crate) fn segments_from_database(&mut self, module: usize) {
        let count = self.modules[module].executable.segments.len();
        let mut segments = Vec::with_capacity(count);

        for number in 1..=count {
            let handle = self.segment_handle(module, number as u16);

            segments.push(match handle {
                0 => NOT_LOADED,
                handle => index_for(handle | 1),
            });
        }

        self.modules[module].segments = segments;
    }

    /// Whether a segment's entry in a module's database is marked loaded.
    fn segment_loaded(&self, module: usize, number: u16) -> bool {
        let Some(base) = self.database_base(module) else {
            return false;
        };
        let database = self.module_bytes(base);

        if number == 0 || usize::from(number) > self.modules[module].executable.segments.len() {
            return false;
        }

        let entry = layout::segment_entry(&database, number) + layout::SEGMENT_FLAGS;

        u16::from_le_bytes([database[entry], database[entry + 1]]) & layout::LOADED != 0
    }

    /// KERNEL's pointers written into the loader's table at the start of a
    /// program's first segment (seg2 `1ee6`-`1f19`); false where the
    /// segment does not start with the table's signature.
    fn fill_loader_table(&mut self, module: usize) -> bool {
        let Some(first) = self.modules[module].translate(1) else {
            return false;
        };
        let base = (first as u32) << 16;

        if self.cpu.bus.read16(base) != SIGNATURE {
            return false;
        }

        let Some(kernel) = self.kept_named("KERNEL") else {
            return false;
        };

        // Its flags in the segment table as `1ea6` leaves them: 2, 4 and
        // 400h cleared before the load (`1ec3`), which sets 2 and 4 again
        // (**recorded** by `selfld`: 4156h, where a program's first
        // segment is 4556h by `moddb`).
        if let Some(base) = self.database_base(module) {
            let table = u32::from(self.cpu.bus.read16(base + layout::SEGMENT_TABLE as u32));
            let at = base + table + layout::SEGMENT_FLAGS as u32;
            let flags = self.cpu.bus.read16(at);

            self.cpu.bus.write16(at, flags & !BOOT_CLEARED);
            self.mark_segment_loaded(base + table, 0, first);
        }

        let stubs = segment_selector(self.stubs(kernel));
        let data = segment_selector(self.kept[kernel].data);

        for (at, selector, offset) in [
            (HEAP_POINTER, data, HEAP_SELECTOR),
            (MY_ALLOC, stubs, STEP * (MY_ALLOC_ORDINAL + 1)),
            (ENTRY_ADDR_PROC, stubs, STEP * (ENTRY_ADDR_PROC_ORDINAL + 1)),
            (SET_OWNER, stubs, STEP * (SET_OWNER_ORDINAL + 1)),
        ] {
            self.cpu.bus.write16(base + at, offset);
            self.cpu.bus.write16(base + at + 2, selector);
        }

        // KERNEL's word the table points at, laid out as `THHOOK`'s are.
        self.thhook_handed_out();
        true
    }

    /// A far pointer in the loader's table.
    fn loader_procedure(&self, module: usize, at: u32) -> Option<u32> {
        let base = (self.modules[module].translate(1)? as u32) << 16;
        let offset = self.cpu.bus.read16(base + at);
        let selector = self.cpu.bus.read16(base + at + 2);

        Some(u32::from(selector) << 16 | u32::from(offset))
    }
}

/// A self-loading program booted as its task starts, where it is yet to
/// be: the loader's table filled, its boot procedure called with the
/// module's handle and its file's, open for the call only; its data
/// segment, its entry point's and its stack's then loaded where its boot
/// left them unloaded; and the task's registers set at its entry point.
pub(crate) async fn boot(engine: &Engine) -> Result<(), Stop> {
    let (program, boot_app, handle, file, stack) = {
        let mut system = engine.system();
        let Some(task) = system.task.as_ref().filter(|task| task.booting) else {
            return Ok(());
        };
        let program = task.program;

        if !system.fill_loader_table(program) {
            return Err(Stop::Unsupported(
                "a self-loading program with no loader's table",
            ));
        }

        let boot_app = system
            .loader_procedure(program, BOOT_APP)
            .ok_or(Stop::Unsupported(
                "a self-loading program with no loader's table",
            ))?;
        let handle = system.modules[program].handle;
        let path = system.modules[program].path.clone();
        let file = system.files.open(&path).map_or(NO_FILE, |file| file as u16);
        let stack = crate::memory::allocate(&mut system, BOOT_STACK, 0).ok_or(
            Stop::Unsupported("no room for a self-loading program's boot"),
        )?;
        let first = system.modules[program]
            .translate(1)
            .map_or(0, segment_selector);
        let cpu = &mut system.cpu;

        cpu.load_segment(SS, segment_selector(stack))
            .map_err(Stop::Processor)?;
        cpu.regs[SP] = BOOT_STACK as u16;
        cpu.load_segment(DS, 0).map_err(Stop::Processor)?;
        cpu.load_segment(ES, first).map_err(Stop::Processor)?;

        (program, boot_app, handle, file, stack)
    };
    let first = engine.system().modules[program]
        .translate(1)
        .map_or(0, segment_selector);
    let booted = engine
        .call_guest(boot_app, &[handle, file], &[Register::Segment(ES, first)])
        .await?;

    {
        let mut system = engine.system();

        if file != NO_FILE {
            system.files.close(usize::from(file));
        }

        // `LoadModule` goes on with the boot's answer as with a module's
        // handle: below 20h it is an error's number, and the load fails
        // (seg2 `1652`-`1658`).
        if (booted as u16) < LEAST_HANDLE {
            return Err(Stop::Unsupported("a self-loading program's boot failed"));
        }

        system.segments_from_database(program);
    }

    // As the program starts (seg2 `13e8`, `0ae3`, `0b14`): its data
    // segment, its entry point's and its stack's, with no file's handle
    // (**recorded** by `selfld`: its data segment asked with FFFFh).
    let header = engine.system().modules[program].executable.header.clone();

    for number in [header.auto_data_segment, header.entry_cs, header.stack_ss] {
        load_segment(engine, program, number, NO_FILE).await?;
    }

    let mut system = engine.system();
    let program_segment = system.task.as_ref().map_or(0, |task| task.program_segment);

    if let Some(task) = system.task.as_mut() {
        task.booting = false;
    }

    system.segments_from_database(program);

    if system.modules[program].data().is_none()
        || system.modules[program].translate(header.entry_cs).is_none()
    {
        return Err(Stop::Unsupported(
            "a self-loading program's segments were not loaded",
        ));
    }

    system
        .entry_registers(program, program_segment)
        .map_err(Stop::Processor)?;

    let System {
        global,
        cpu,
        descriptors,
        ..
    } = &mut *system;

    global.free(&mut cpu.bus, descriptors, stack);
    Ok(())
}

/// A segment of a self-loading program loaded as `LoadSegment` loads one
/// (seg1 `7749`-`776d`, `75be`): its handle where it is loaded already;
/// else the loader's procedure at 8 asked with the file's handle given,
/// and asked again with the file opened afresh where it answers nought.
/// Its handle, nought where it could not be loaded.
pub(crate) async fn load_segment(
    engine: &Engine,
    program: usize,
    number: u16,
    file: u16,
) -> Result<u16, Stop> {
    let (procedure, handle, first, path) = {
        let system = engine.system();

        if number == 0 {
            return Ok(0);
        }

        if system.segment_loaded(program, number) {
            return Ok(system.segment_handle(program, number));
        }

        let Some(procedure) = system.loader_procedure(program, LOAD_APP_SEG) else {
            return Ok(0);
        };

        (
            procedure,
            system.modules[program].handle,
            system.modules[program]
                .translate(1)
                .map_or(0, segment_selector),
            system.modules[program].path.clone(),
        )
    };
    let registers = [Register::Segment(ES, first)];
    let mut answer = engine
        .call_guest(procedure, &[handle, file, number], &registers)
        .await? as u16;

    if answer == 0 {
        let reopened = engine.system().files.open(&path).map(|file| file as u16);

        if let Some(reopened) = reopened {
            answer = engine
                .call_guest(procedure, &[handle, reopened, number], &registers)
                .await? as u16;
            engine.system().files.close(usize::from(reopened));
        }
    }

    engine.system().segments_from_database(program);
    Ok(answer)
}

/// A segment loaded as KERNEL's handler of a segment that is not present
/// loads it (**read out**, seg1 `5fde`, the handler `KRNL386.EXE` sets for
/// fault 0Bh at `af9b`-`afa3`): the block's owner, which `SetOwner` gave it,
/// is a module whose segment table has the selector's handle (`601f`-
/// `6051`); `LoadSegment` loads that segment with no file's handle (`609a`-
/// `609e`, `60c3`), and the instruction runs again. Here each segment
/// register that holds the selector is read again, now it is present.
pub(crate) async fn demand_load(engine: &Engine, selector: u16) -> Result<(), Stop> {
    let Some((program, number)) = engine.system().segment_of(selector) else {
        return Err(Stop::Unsupported(
            "a segment not present that no module owns",
        ));
    };

    if load_segment(engine, program, number, NO_FILE).await? == 0 {
        return Err(Stop::Unsupported(
            "a segment a self-loading program's loader did not load",
        ));
    }

    let mut system = engine.system();

    for register in [CS, DS, ES, SS, FS, GS] {
        let held = system.cpu.segments[register].selector;

        if held != 0 && index_for(held) == index_for(selector) {
            system
                .cpu
                .load_segment(register, held)
                .map_err(Stop::Processor)?;
        }
    }

    // The fetch that ran past an absent CS is made again.
    system.cpu.fetched_past_limit = false;
    Ok(())
}

impl System {
    /// The selector of a segment of a self-loading program whose absence
    /// stopped the processor, where one did: CS where the fetch ran past
    /// it -- a far call, jump or return into it, which the core takes
    /// before it finds the segment absent -- the selector a load faulted
    /// on, or a segment register's selector that is absent.
    pub(crate) fn segment_to_load(&self, exit: winbox_cpu::Exit) -> Option<u16> {
        if !self.cpu.protected
            || !matches!(exit, winbox_cpu::Exit::Fault(_) | winbox_cpu::Exit::Host)
        {
            return None;
        }

        let mut candidates = Vec::new();

        if self.cpu.fetched_past_limit {
            candidates.push(self.cpu.segments[CS].selector);
        }

        if let Some((NOT_PRESENT_FAULT, code)) = self.fault_with_code(exit)
            && code != 0
        {
            candidates.push(code | 7);
        }

        candidates
            .extend([DS, ES, SS, FS, GS].map(|register| self.cpu.segments[register].selector));

        candidates
            .into_iter()
            .find(|&selector| self.segment_of(selector).is_some())
    }

    /// The self-loading program and the number of its segment a selector
    /// is, where it is absent: the module its block's owner names, whose
    /// segment table has its handle.
    fn segment_of(&self, selector: u16) -> Option<(usize, u16)> {
        if selector & 4 == 0 || selector & 0xfff8 == 0 {
            return None;
        }

        let index = index_for(selector);

        if winbox_machine::Descriptors::rights_of(&self.cpu.bus, index) & PRESENT != 0 {
            return None;
        }

        let owner = *self.block_owners.get(&index)?;
        let program = self
            .modules
            .iter()
            .position(|module| module.handle == owner && module.self_loading())?;
        let count = self.modules[program].executable.segments.len() as u16;

        (1..=count)
            .find(|&number| {
                let handle = self.segment_handle(program, number);

                handle != 0 && index_for(handle) == index
            })
            .map(|number| (program, number))
    }
}

/// The fault of a segment not present.
const NOT_PRESENT_FAULT: u8 = 11;
/// A descriptor's present bit.
const PRESENT: u16 = 0x0080;
