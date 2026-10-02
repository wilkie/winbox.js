//! The WebAssembly boundary: the Rust core's machine, run from JavaScript.
//!
//! For the spike these are plain exports over one machine, so a run stays
//! inside WebAssembly from its first instruction to its last: JavaScript
//! writes the program into [`memory_ptr`]'s bytes, sets the registers and
//! segments, and calls [`run`]. `wasm-bindgen` comes with a boundary that
//! carries more than numbers.
//!
//! WebAssembly runs one thread, and the machine is only reached through
//! these calls, one at a time; that is what makes the one `static` sound.
#![allow(unsafe_code)]

use winbox_cpu::{Cpu, Exit};

static mut MACHINE: Option<Cpu> = None;

/// The machine, made by [`machine_new`].
fn machine() -> &'static mut Cpu {
    let slot = &raw mut MACHINE;

    // SAFETY: one thread, and no reference outlives the exported call that
    // took it (see the module's comment).
    unsafe { (*slot).as_mut() }.expect("machine_new was not called")
}

/// A new machine of `size` bytes of memory, in real mode.
#[unsafe(no_mangle)]
pub extern "C" fn machine_new(size: u32) {
    let slot = &raw mut MACHINE;

    // SAFETY: as for `machine`.
    unsafe {
        *slot = Some(Cpu::new(size as usize));
    }
}

/// Where the machine's memory starts in WebAssembly's, for JavaScript to
/// write a program and read results through.
#[unsafe(no_mangle)]
pub extern "C" fn memory_ptr() -> *mut u8 {
    machine().memory.as_mut_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn set_reg(index: u32, value: u32) {
    machine().regs[index as usize & 7] = value as u16;
}

#[unsafe(no_mangle)]
pub extern "C" fn get_reg(index: u32) -> u32 {
    u32::from(machine().regs[index as usize & 7])
}

#[unsafe(no_mangle)]
pub extern "C" fn set_ip(value: u32) {
    machine().ip = value as u16;
}

#[unsafe(no_mangle)]
pub extern "C" fn get_ip() -> u32 {
    u32::from(machine().ip)
}

/// Protected mode on or off, and where its descriptor table is.
#[unsafe(no_mangle)]
pub extern "C" fn set_protected(on: u32, gdt_base: u32) {
    let cpu = machine();

    cpu.protected = on != 0;
    cpu.gdt_base = gdt_base;
}

/// A segment register loaded, 0 to 3 for ES, CS, SS and DS.
#[unsafe(no_mangle)]
pub extern "C" fn load_segment(index: u32, selector: u32) {
    machine().load_segment(index as usize & 3, selector as u16);
}

/// Runs up to `budget` instructions, and answers how many ran; [`last_exit`]
/// says why it stopped.
#[unsafe(no_mangle)]
pub extern "C" fn run(budget: u32) -> u32 {
    let (ran, exit) = machine().run(u64::from(budget));

    // SAFETY: as for `machine`.
    unsafe {
        LAST_EXIT = exit;
    }

    ran as u32
}

static mut LAST_EXIT: Exit = Exit::Budget;

/// Why the last run stopped: 0 the budget, 1 `HLT`, 2 an unimplemented
/// opcode, 3 a fault; the opcode or the vector in the next byte up.
#[unsafe(no_mangle)]
pub extern "C" fn last_exit() -> u32 {
    // SAFETY: as for `machine`.
    match unsafe { LAST_EXIT } {
        Exit::Budget => 0,
        Exit::Halt => 1,
        Exit::Unimplemented(opcode) => 2 | (u32::from(opcode) << 8),
        Exit::Fault(vector) => 3 | (u32::from(vector) << 8),
    }
}
