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

use winbox_cpu::{Bus, Cpu, Exit, Segment};

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

/// A segment register's cache, as JavaScript writes it.
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
/// protected mode at 40, the descriptor table's base at 44, then ES, CS, SS,
/// DS, FS and GS, sixteen bytes each, from 48.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct State {
    pub regs: [u32; 8],
    pub ip: u32,
    pub flags: u32,
    pub protected: u32,
    pub gdt_base: u32,
    pub segments: [SegmentState; 6],
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
};

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

    for (into, from) in cpu.regs.iter_mut().zip(state.regs) {
        *into = from as u16;
    }

    cpu.ip = state.ip as u16;
    cpu.flags = state.flags as u16;
    cpu.protected = state.protected != 0;
    cpu.gdt_base = state.gdt_base;

    for (into, from) in cpu.segments.iter_mut().zip(state.segments) {
        *into = Segment {
            selector: from.selector as u16,
            base: from.base,
            past_limit: from.past_limit,
        };
    }

    let (ran, exit) = cpu.run(u64::from(budget));

    for (into, from) in state.regs.iter_mut().zip(cpu.regs) {
        *into = (*into & 0xffff_0000) | u32::from(from);
    }

    state.ip = (state.ip & 0xffff_0000) | u32::from(cpu.ip);
    state.flags = (state.flags & 0xffff_0000) | u32::from(cpu.flags);

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
    }
}
