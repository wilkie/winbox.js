//! The machine the Windows engine runs on, as winbox.js's emulator keeps
//! it: its memory, the descriptor tables and the selectors given out of
//! them, the global heap's blocks, and its clock.

mod clock;
mod descriptors;
mod global;
mod memory;

pub use clock::{
    CALL_INSTRUCTIONS, Clock, FAITHFUL_INSTRUCTIONS_PER_MS, INSTRUCTIONS_PER_MS, TimerId,
};
pub use descriptors::{
    BIOS_DATA_SELECTOR, CODE, DATA, Descriptors, GDT_BASE, LDT_BASE, SELECTORS, handle_for,
    index_for, segment_selector,
};
pub use global::{Block, FIRST_SELECTOR, GlobalHeap};
pub use memory::Memory;
