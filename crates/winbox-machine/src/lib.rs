//! The machine the Windows engine runs on, as winbox.js's emulator keeps
//! it: its memory, the descriptor tables and the selectors given out of
//! them, the global heap's blocks, and its clock.

mod clock;
mod descriptors;
mod files;
mod global;
mod local;
mod memory;
mod pages;

pub use clock::{
    CALL_INSTRUCTIONS, Clock, FAITHFUL_INSTRUCTIONS_PER_MS, HostTime, INSTRUCTIONS_PER_MS, TimerId,
    instant_ms,
};
pub use descriptors::{
    BIOS_DATA_SELECTOR, CODE, DATA, Descriptors, FIRST_MEGABYTE, FIRST_MEGABYTE_SELECTORS,
    GDT_BASE, LDT_BASE, MODULE_DATABASES, SELECTORS, first_megabyte_selector, handle_for,
    index_for, segment_selector,
};
pub use files::{
    AUDIO_TYPES, Allocation, Begun, Body, CdImage, CdTrack, Change, CueError, CueFailure, DiscFile,
    EmptyDrive, Entry, FatError, FatVolume, Files, HostDrive, HostFile, HostLayer, ImageFile,
    IsoError, IsoVolume, Listing, MAX_OPEN_FILES, MemoryDrive, MemoryFile, OpenFile, Overlay,
    Parsed, Sectors, Stored, Volume, WallTime, civil_from_days, days_from_civil, host_seconds,
    is_floppy, volume_start,
};
pub use global::{Block, FIRST_SELECTOR, Figures, GlobalHeap, block_size, within_limit};
pub use local::{LocalHeap, Options as LocalOptions};
pub use memory::Memory;
#[cfg(feature = "audit")]
pub use memory::Audit;
pub use pages::{
    BLOCKS_END, FIRST_MEGABYTE_LENGTH, OWN_PAGES_ABOVE, PAGE_BITS, PAGE_SIZE, Pages, Print,
};
