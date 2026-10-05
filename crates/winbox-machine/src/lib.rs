//! The machine the Windows engine runs on, as winbox.js's emulator keeps
//! it: its memory, the descriptor tables and the selectors given out of
//! them, the global heap's blocks, and its clock.

mod clock;
mod descriptors;
mod files;
mod global;
mod local;
mod memory;

pub use clock::{
    CALL_INSTRUCTIONS, Clock, FAITHFUL_INSTRUCTIONS_PER_MS, HostTime, INSTRUCTIONS_PER_MS, TimerId,
    instant_ms,
};
pub use descriptors::{
    BIOS_DATA_SELECTOR, CODE, DATA, Descriptors, GDT_BASE, LDT_BASE, SELECTORS, handle_for,
    index_for, segment_selector,
};
pub use files::{
    Body, Entry, Files, HostDrive, HostFile, MAX_OPEN_FILES, MemoryDrive, MemoryFile, OpenFile,
    Parsed, Stored, Volume, WallTime, civil_from_days, days_from_civil, host_seconds,
};
pub use global::{Block, FIRST_SELECTOR, GlobalHeap};
pub use local::{LocalHeap, Options as LocalOptions};
pub use memory::Memory;
