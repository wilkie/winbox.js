//! The WebAssembly boundary: the Rust core, run on the machine JavaScript
//! keeps.
//!
//! The module imports the WebAssembly memory `src/emulator/memory.ts` keeps
//! the machine's memory in, and reads it as that file lays it out: a 32-bit
//! entry for each mebibyte block of the machine's address space at
//! [`TABLE_AT`], saying where the block is, nought for one never written;
//! and a byte for each 64 KiB segment at [`HANDLED_AT`], set where the
//! segment's bytes are a JavaScript handler's. Memory of either kind stops a
//! run, for JavaScript to take the instruction ([`Exit::Host`]).
//!
//! The registers cross in [`State`], at [`state_ptr`]: JavaScript writes
//! them, calls [`run`], and reads them back. Nothing here allocates, so the
//! WebAssembly memory grows only when JavaScript grows it, and its views of
//! it stay good.
//!
//! WebAssembly runs one thread, and the state is only reached through these
//! calls, one at a time; that is what makes the `static`s sound.
#![allow(unsafe_code)]

use winbox_cpu::{Bus, Cpu, Exit, LOADS, LOGGED, QuickClock, Segment, THUNKS, Thunk};

/// Where the block table is, as `src/emulator/memory.ts` puts it.
pub const TABLE_AT: u32 = 0x0002_0000;

/// Where the handled-segment bytes are.
pub const HANDLED_AT: u32 = TABLE_AT + 4096 * 4;

/// The machine's memory, through the block table.
#[derive(Debug, Clone, Copy)]
struct SharedBus;

impl SharedBus {
    /// Where a linear address's byte is in WebAssembly's memory, or `None`.
    #[inline]
    fn place(at: u32) -> Option<*mut u8> {
        // SAFETY: the table and the handled bytes are inside the imported
        // memory, at the places memory.ts keeps them; a block's address is
        // one memory.ts made, a mebibyte of it.
        unsafe {
            let block = *(TABLE_AT as *const u32).add((at >> 20) as usize);

            if block == 0 || *(HANDLED_AT as *const u8).add((at >> 16) as usize) != 0 {
                return None;
            }

            Some((block + (at & 0x000f_ffff)) as *mut u8)
        }
    }
}

impl Bus for SharedBus {
    #[inline]
    fn read8(&self, at: u32) -> Option<u8> {
        // SAFETY: `place` gives only addresses inside a block.
        Self::place(at).map(|byte| unsafe { *byte })
    }

    #[inline]
    fn write8(&mut self, at: u32, value: u8) -> Option<()> {
        // SAFETY: as for `read8`.
        Self::place(at).map(|byte| unsafe { *byte = value })
    }

    #[inline]
    fn read16(&self, at: u32) -> Option<u16> {
        // Both bytes in one segment: one read. Else a byte at a time.
        if at & 0xffff != 0xffff {
            let byte = Self::place(at)?;

            // SAFETY: both bytes are in the segment `place` checked.
            return Some(unsafe { byte.cast::<u16>().read_unaligned() });
        }

        Some(u16::from(self.read8(at)?) | (u16::from(self.read8(at.wrapping_add(1))?) << 8))
    }

    #[inline]
    fn write16(&mut self, at: u32, value: u16) -> Option<()> {
        if at & 0xffff != 0xffff {
            let byte = Self::place(at)?;

            // SAFETY: as for `read16`.
            unsafe { byte.cast::<u16>().write_unaligned(value) };
            return Some(());
        }

        self.write8(at, value as u8)?;
        self.write8(at.wrapping_add(1), (value >> 8) as u8)
    }
}

/// A segment register's cache, as JavaScript writes it: `attributes` bit 0
/// the descriptor's D bit.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct SegmentState {
    pub selector: u32,
    pub base: u32,
    /// One past the last offset that may be reached.
    pub past_limit: u32,
    pub attributes: u32,
}

/// The registers, as they cross between the cores. Offsets in bytes: the
/// eight general registers at 0, IP at 32, FLAGS at 36, whether in
/// protected mode at 40, the global descriptor table's base at 44, then ES,
/// CS, SS, DS, FS and GS, sixteen bytes each, from 48; the global table's
/// limit at 144, the local table's base and limit at 148 and 152, at 156
/// the segment registers a run loaded, a bit each, at 160 how many
/// selectors it loaded, and from 164 those selectors.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct State {
    pub regs: [u32; 8],
    pub ip: u32,
    pub flags: u32,
    pub protected: u32,
    pub gdt_base: u32,
    pub segments: [SegmentState; 6],
    pub gdt_limit: u32,
    pub ldt_base: u32,
    pub ldt_limit: u32,
    pub loaded: u32,
    pub load_count: u32,
    pub loads: [u32; LOADS],
}

const EMPTY: SegmentState = SegmentState {
    selector: 0,
    base: 0,
    past_limit: 0,
    attributes: 0,
};

static mut STATE: State = State {
    regs: [0; 8],
    ip: 0,
    flags: 2,
    protected: 0,
    gdt_base: 0,
    segments: [EMPTY; 6],
    gdt_limit: 0,
    ldt_base: 0,
    ldt_limit: 0,
    loaded: 0,
    load_count: 0,
    loads: [0; LOADS],
};

/// A thunk the Rust core answers, as JavaScript writes it: where its `INT`
/// is, which function (`winbox_cpu::Function`), and the instructions a call
/// is charged, and `PeekMessage` with `PM_NOYIELD`.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct QuickThunk {
    pub linear: u32,
    pub function: u32,
    pub charge: f64,
    pub charge_alt: f64,
}

/// A call the Rust core answered, as JavaScript reads it.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct QuickLog {
    pub function: u32,
    pub caller: u32,
    pub args: [u16; 8],
    pub result: u32,
    pub reserved: u32,
}

/// The calls the Rust core answers (`winbox_cpu::Quick`), as they cross:
/// JavaScript writes whether, the thunks and its virtual clock before a
/// run, and reads the clock's charges and the calls answered after. Offsets
/// in bytes: `enabled` 0 (bit 1, nothing waiting for `PeekMessage`),
/// `thunk_count` 4, `virtual_clock` 8, `logged` 12; the clock's rate,
/// instructions, charged, skipped and next due, doubles, from 16; the
/// thunks, 24 bytes each, from 56; the log, 32 bytes a call, from 440.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct QuickState {
    pub enabled: u32,
    pub thunk_count: u32,
    pub virtual_clock: u32,
    pub logged: u32,
    pub rate: f64,
    pub instructions: f64,
    pub charged: f64,
    pub skipped: f64,
    pub next_due: f64,
    pub thunks: [QuickThunk; THUNKS],
    pub log: [QuickLog; LOGGED],
}

const NO_THUNK: QuickThunk = QuickThunk {
    linear: 0,
    function: 0,
    charge: 0.0,
    charge_alt: 0.0,
};

const NO_LOG: QuickLog = QuickLog {
    function: 0,
    caller: 0,
    args: [0; 8],
    result: 0,
    reserved: 0,
};

static mut QUICK: QuickState = QuickState {
    enabled: 0,
    thunk_count: 0,
    virtual_clock: 0,
    logged: 0,
    rate: 1.0,
    instructions: 0.0,
    charged: 0.0,
    skipped: 0.0,
    next_due: 0.0,
    thunks: [NO_THUNK; THUNKS],
    log: [NO_LOG; LOGGED],
};

/// Where [`QuickState`] is, for JavaScript to read and write.
#[unsafe(no_mangle)]
pub extern "C" fn quick_ptr() -> *mut QuickState {
    &raw mut QUICK
}

static mut LAST_EXIT: Exit = Exit::Budget;

/// Where [`State`] is, for JavaScript to read and write.
#[unsafe(no_mangle)]
pub extern "C" fn state_ptr() -> *mut State {
    &raw mut STATE
}

/// Runs up to `budget` instructions from the state, and writes the state
/// back: how many ran. [`last_exit`] says why it stopped; at anything but
/// the budget or `HLT`, IP is at the instruction, for JavaScript to run.
#[unsafe(no_mangle)]
pub extern "C" fn run(budget: u32) -> u32 {
    let slot = &raw mut STATE;

    // SAFETY: see the module's comment.
    let state = unsafe { &mut *slot };
    let mut cpu = Cpu::new(SharedBus);

    for (index, from) in state.regs.into_iter().enumerate() {
        cpu.regs[index] = from as u16;
        cpu.high[index] = (from >> 16) as u16;
    }

    cpu.ip = state.ip as u16;
    cpu.flags = state.flags as u16;
    cpu.protected = state.protected != 0;
    cpu.gdt_base = state.gdt_base;
    cpu.gdt_limit = state.gdt_limit;
    cpu.ldt_base = state.ldt_base;
    cpu.ldt_limit = state.ldt_limit;

    for (into, from) in cpu.segments.iter_mut().zip(state.segments) {
        *into = Segment {
            selector: from.selector as u16,
            base: from.base,
            past_limit: from.past_limit,
            big: from.attributes & 1 != 0,
        };
    }

    let quick_slot = &raw mut QUICK;

    // SAFETY: see the module's comment.
    let quick = unsafe { &mut *quick_slot };

    cpu.quick.enabled = quick.enabled & 1 != 0;
    cpu.quick.peek = quick.enabled & 2 != 0;

    if cpu.quick.enabled {
        cpu.quick.thunk_count = (quick.thunk_count as usize).min(THUNKS);

        for (into, from) in cpu.quick.thunks.iter_mut().zip(quick.thunks) {
            *into = Thunk {
                linear: from.linear,
                function: from.function,
                charge: from.charge,
                charge_alt: from.charge_alt,
            };
        }

        cpu.quick.clock = (quick.virtual_clock != 0).then_some(QuickClock {
            rate: quick.rate,
            instructions: quick.instructions,
            charged: quick.charged,
            skipped: quick.skipped,
            next_due: quick.next_due,
        });
    }

    let (ran, exit) = cpu.run(u64::from(budget));

    quick.logged = cpu.quick.logged as u32;

    if let Some(clock) = cpu.quick.clock {
        quick.charged = clock.charged;
    }

    for (into, from) in quick.log.iter_mut().zip(&cpu.quick.log[..cpu.quick.logged]) {
        *into = QuickLog {
            function: from.function,
            caller: from.caller,
            args: from.args,
            result: from.result,
            reserved: 0,
        };
    }

    for (index, into) in state.regs.iter_mut().enumerate() {
        *into = u32::from(cpu.regs[index]) | (u32::from(cpu.high[index]) << 16);
    }

    state.ip = (state.ip & 0xffff_0000) | u32::from(cpu.ip);
    state.flags = (state.flags & 0xffff_0000) | u32::from(cpu.flags);
    state.loaded = u32::from(cpu.loaded);
    state.load_count = cpu.load_count as u32;

    for (into, from) in state.loads.iter_mut().zip(cpu.loads) {
        *into = u32::from(from);
    }

    for (into, from) in state.segments.iter_mut().zip(cpu.segments) {
        into.selector = u32::from(from.selector);
        into.base = from.base;
        into.past_limit = from.past_limit;
        into.attributes = u32::from(from.big);
    }

    let last = &raw mut LAST_EXIT;

    // SAFETY: as above.
    unsafe {
        *last = exit;
    }

    ran as u32
}

/// Why the last run stopped: 0 the budget, 1 `HLT`, 2 an unimplemented
/// opcode, 3 a fault, 4 memory only JavaScript can answer for; the opcode or
/// the vector in the next byte up.
#[unsafe(no_mangle)]
pub extern "C" fn last_exit() -> u32 {
    let last = &raw const LAST_EXIT;

    // SAFETY: see the module's comment.
    match unsafe { *last } {
        Exit::Budget => 0,
        Exit::Halt => 1,
        Exit::Unimplemented(opcode) => 2 | (u32::from(opcode) << 8),
        Exit::Fault(vector) => 3 | (u32::from(vector) << 8),
        Exit::Host => 4,
        Exit::Loads => 5,
        Exit::Logged => 6,
    }
}
