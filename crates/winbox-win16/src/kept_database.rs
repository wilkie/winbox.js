//! The module database of a module WinBox keeps with no file (`kept.rs`):
//! the header and tables KERNEL keeps in memory for a module it loaded,
//! read through the module's handle, its selector (`module_database.rs`
//! lays one out from a file). A program reads them: a sound mixer built
//! into 69 of the compatibility catalog's programs reads word 1Ch of
//! MMSYSTEM's and of the wave driver's, the number of segments, and asks
//! `GetCodeHandle` for each by the module's handle and its number, to
//! page-lock it (`kb/topics/self-loading.md`, "A kept module's database").
//!
//! Laid out as KERNEL lays a database out (`KRNL386.EXE` seg2 `0d66`-
//! `1264`), from what WinBox's stand-in has, never from Windows' bytes:
//!
//! * The segment table holds WinBox's own two segments: the stubs, the
//!   code every export is in, first; the data segment second. Windows'
//!   files have more (MMSYSTEM.DLL ten, USER.EXE 45), for code WinBox does
//!   not have. Each segment's handle is its selector for a fixed one, one
//!   below for a moveable one; the stubs' is nought, and the segment not
//!   marked loaded, until a program links to the module and they are
//!   made, as a segment not yet loaded has none (**recorded** by `keptdb`:
//!   a fixed segment's handle odd, a moveable one's even, the data
//!   segment's the module's instance).
//! * The entry table has an entry for each export `kept.rs` has, by its
//!   ordinal, but those whose place it only holds: in the stubs, where the linker puts it; in the data segment
//!   for an export that is a place there (`exported_data.rs`); a constant
//!   for each of KERNEL's (`linker::kernel_constant`). **Recorded** by
//!   `keptdb`: the ordinals each module's table has.
//! * The resident names: the module's name, then the names Windows' file
//!   keeps resident (`RECORDED`); no resources, no module references, no
//!   imported names: the stand-ins import nothing.
//! * The file's description: the path the module's file is at, as
//!   `GetModuleFileName` answers it.
//! * The header's words that describe Windows' file -- its flags, its
//!   heap, its sector shift and its target system -- as `keptdb` recorded
//!   them, for each module it recorded (`RECORDED`); for another, the flags
//!   of a library with a data segment and nought.

use winbox_machine::segment_selector;

use crate::module_database as layout;
use crate::system::{STEP, System};

/// What `keptdb` recorded of a module's database in Windows 3.1, standard
/// and enhanced mode alike: the header's flags (0Ch), the heap's size
/// (10h), the sector shift (32h) and the target system's word (36h), and
/// the resident names after the module's, each with its ordinal.
struct Recorded {
    name: &'static str,
    flags: u16,
    heap: u16,
    shift: u16,
    system: u16,
    resident: &'static [(&'static str, u16)],
}

/// Windows (2), its fonts proportional (800h), as every module but KERNEL
/// has it.
const WINDOWS_PROPORTIONAL: u16 = 0x0802;
/// Windows alone, KERNEL's.
const WINDOWS: u16 = 0x0002;
/// The sector shift of most of Windows' files: 16 bytes.
const SHIFT_16: u16 = 4;
/// DDEML.DLL's, 512 bytes.
const SHIFT_512: u16 = 9;

/// Windows' library flags in memory: a library (8000h), its
/// initialization done (4000h), a Windows program (300h), importing
/// (40h), with a data segment of its own (1); 4 for one with code for
/// each process (COMMDLG, SHELL, DDEML).
const LIBRARY_LOADED: u16 = 0xc341;
const LIBRARY_PER_PROCESS: u16 = 0xc345;

/// What `keptdb` recorded, module by module (`oracle/fixtures/keptdb.json`
/// and `enhanced/keptdb.json`).
const RECORDED: &[Recorded] = &[
    Recorded {
        name: "KERNEL",
        // A library (8000h), with its data (1), its own flags 8 (KERNEL's
        // file's) and 40h and 80h.
        flags: 0x80c9,
        heap: 0x0200,
        shift: SHIFT_16,
        system: WINDOWS,
        resident: &[("__GP", 342)],
    },
    Recorded {
        name: "USER",
        flags: LIBRARY_LOADED,
        heap: 0x157c,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 8), ("__GP", 484)],
    },
    Recorded {
        name: "GDI",
        flags: LIBRARY_LOADED,
        heap: 0x2710,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 59), ("__GP", 46)],
    },
    Recorded {
        name: "MMSYSTEM",
        flags: LIBRARY_LOADED,
        heap: 0x0080,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 1), ("DRIVERPROC", 6)],
    },
    Recorded {
        name: "SOUND",
        flags: LIBRARY_LOADED,
        heap: 0,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 18)],
    },
    Recorded {
        name: "KEYBOARD",
        flags: LIBRARY_LOADED,
        heap: 0,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 8)],
    },
    Recorded {
        name: "SYSTEM",
        // No data segment of its own.
        flags: 0xc340,
        heap: 0,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 10)],
    },
    Recorded {
        name: "COMMDLG",
        flags: LIBRARY_PER_PROCESS,
        heap: 0x0400,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 28)],
    },
    Recorded {
        name: "SHELL",
        flags: LIBRARY_PER_PROCESS,
        heap: 0x0100,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 8)],
    },
    Recorded {
        name: "TOOLHELP",
        flags: LIBRARY_LOADED,
        heap: 0x0200,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 1)],
    },
    Recorded {
        name: "DDEML",
        flags: LIBRARY_PER_PROCESS,
        heap: 0x2000,
        shift: SHIFT_512,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 1)],
    },
    Recorded {
        name: "TIMER",
        // Loaded by MMSYSTEM as it starts, without 40h.
        flags: 0xc301,
        heap: 0,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 1), ("DRIVERPROC", 2)],
    },
    Recorded {
        name: "LZEXPAND",
        flags: LIBRARY_LOADED,
        heap: 0x0400,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 11), ("___EXPORTEDSTUB", 12)],
    },
    Recorded {
        name: "VER",
        flags: LIBRARY_LOADED,
        heap: 0x0200,
        shift: SHIFT_16,
        system: WINDOWS_PROPORTIONAL,
        resident: &[("WEP", 1)],
    },
];

/// `VGA.DRV`'s, the display `keptdb` was recorded on: no resident names
/// but the module's.
const VGA_DISPLAY: Recorded = Recorded {
    name: "DISPLAY",
    flags: LIBRARY_LOADED,
    heap: 0,
    shift: SHIFT_16,
    system: WINDOWS_PROPORTIONAL,
    resident: &[],
};

/// The header's flags that say the module has a data segment of its own:
/// one (1) or one for each instance (2).
const DATA_KINDS: u16 = 0x0003;

/// A module no recording has: a library (8000h) with a data segment of its
/// own (1), as WinBox's stand-in is.
const LIBRARY_WITH_DATA: u16 = 0x8001;

/// The segments' numbers: the stubs, then the data.
pub const STUBS_SEGMENT: u16 = 1;
pub const DATA_SEGMENT: u16 = 2;
const SEGMENTS: u16 = 2;

/// An entry's flags: exported (1). WinBox's stubs use no data segment of
/// the module's, so none has 2, the shared data's.
const EXPORTED: u8 = 0x01;

/// A bundle's type in the file's entry table: none (a run of ordinals with
/// no entry), a constant's.
const NO_ENTRY: u8 = 0x00;
const CONSTANT: u8 = 0xfe;
/// The most entries in one of the file's bundles.
const BUNDLE_MOST: usize = 255;

/// The header's words `module_database` does not name.
const SIGNATURE: usize = 0x00;
const SEGMENT_NE: u16 = 0x454e;
const TARGET_SYSTEM: usize = 0x36;
const NONRESIDENT_SIZE: usize = 0x20;

/// The version KERNEL sets in its own module as it starts, 3.10
/// (`KRNL386.EXE` seg1 `c285`-`c288`).
const KERNEL_VERSION: u16 = 0x030a;

/// The two flags a segment has once given its block and loaded.
const PRESENT: u16 = layout::ALLOCATED | layout::LOADED;

/// The bytes of a kept module's stubs: one stub a step apart from the
/// first after a callback thunk, for as many ordinals as `System::stubs`
/// makes.
pub fn stubs_length(ordinals: usize) -> usize {
    (ordinals + 1) * usize::from(STEP)
}

/// A kept module's database as it stands.
pub fn database(system: &mut System, kept: usize) -> Vec<u8> {
    let module = system.module_of(&system.kept[kept]);
    let name = module.name;
    let display_vga =
        name == "DISPLAY" && system.display.driver_file.eq_ignore_ascii_case("VGA.DRV");
    let recorded = if display_vga {
        Some(&VGA_DISPLAY)
    } else if name == "DISPLAY" {
        None
    } else {
        RECORDED.iter().find(|each| each.name == name)
    };
    let flags = recorded.map_or(LIBRARY_WITH_DATA, |each| each.flags);
    let handle = system.kept[kept].handle();
    let mut out = vec![0u8; layout::HEADER];

    put(&mut out, SIGNATURE, SEGMENT_NE);
    put(
        &mut out,
        layout::USAGE,
        crate::modules_kernel::module_usage(system, handle),
    );
    put(&mut out, layout::FLAGS, flags);
    // The data segment, where the flags say the module has one of its own.
    put(
        &mut out,
        layout::AUTO_DATA,
        if flags & DATA_KINDS == 0 {
            0
        } else {
            DATA_SEGMENT
        },
    );
    put(&mut out, layout::HEAP, recorded.map_or(0, |each| each.heap));
    put(&mut out, layout::SEGMENT_COUNT, SEGMENTS);
    put(
        &mut out,
        layout::SHIFT,
        recorded.map_or(0, |each| each.shift),
    );
    put(
        &mut out,
        TARGET_SYSTEM,
        recorded.map_or(0, |each| each.system),
    );
    // The Windows version its file says, KERNEL's the Windows version, as
    // `GetExpWinVer` answers them (`System::expected_windows_version`),
    // here without reading the file, which may not be there yet.
    put(
        &mut out,
        layout::EXPECTED_VERSION,
        if name == "KERNEL" {
            KERNEL_VERSION
        } else {
            crate::system::kept_version(name).unwrap_or(0)
        },
    );
    put(&mut out, NONRESIDENT_SIZE, 0);

    // The segment table: the stubs, then the data.
    mark(&mut out, layout::SEGMENT_TABLE);

    let stubs = system.kept[kept].stubs;
    let length = stubs_length(crate::system::stub_ordinals(module)) as u16;
    let code_flags = layout::LIBRARY_MARK | layout::CODE_MARK | layout::PRELOAD;

    segment(
        &mut out,
        length,
        code_flags | if stubs.is_some() { PRESENT } else { 0 },
        stubs.map_or(0, segment_selector),
    );

    let fixed = system.kept[kept].module.fixed;
    let data_flags = layout::LIBRARY_MARK
        | layout::DATA
        | layout::PRELOAD
        | PRESENT
        | if fixed { 0 } else { layout::MOVEABLE };

    // Its 64K, a length and an allocation of nought.
    segment(&mut out, 0, data_flags, system.kept[kept].instance());

    // No resources: the resident names where the resource table is.
    mark(&mut out, layout::RESOURCE_TABLE);
    mark(&mut out, layout::RESIDENT_NAMES);
    name_entry(&mut out, name, 0);

    for &(resident, ordinal) in recorded.map_or(&[][..], |each| each.resident) {
        name_entry(&mut out, resident, ordinal);
    }

    out.push(0);

    // No module references and no imported names.
    mark(&mut out, layout::MODULE_REFERENCES);
    mark(&mut out, layout::GANG_START);
    mark(&mut out, layout::GANG_LENGTH);
    mark(&mut out, layout::IMPORTED_NAMES);

    let table = entry_table(system, kept);

    layout::entry_bundles(&mut out, &table);

    // The file's description.
    mark(&mut out, layout::FILE_INFO);

    let path = system.kept_path(kept);

    out.extend_from_slice(&layout::file_info(&path));
    out
}

/// The file's entry table WinBox's stand-in would have: each export at its
/// ordinal, bundled as a file has them.
fn entry_table(system: &mut System, kept: usize) -> Vec<u8> {
    let module = system.module_of(&system.kept[kept]);
    let kernel = module.name == "KERNEL";
    let win_flags = system.win_flags();
    let mut places: Vec<Option<(u8, u16)>> = Vec::with_capacity(module.exports.len());

    for ordinal in 1..module.exports.len() as u16 {
        // An ordinal whose place `kept.rs` only holds is one Windows' file
        // has no entry at (`Export::holds_place`).
        let place = if module
            .export(ordinal)
            .is_none_or(|export| export.holds_place())
        {
            None
        } else if let Some(value) = kernel
            .then(|| crate::linker::kernel_constant(ordinal, win_flags))
            .flatten()
        {
            Some((CONSTANT, value))
        } else if let Some(crate::exported_data::ExportedData::Data(offset)) =
            crate::exported_data::exported_data(module.name, ordinal)
        {
            Some((DATA_SEGMENT as u8, offset))
        } else {
            Some((STUBS_SEGMENT as u8, STEP * (ordinal + 1)))
        };

        places.push(place);
    }

    let mut table = Vec::new();
    let mut at = 0;

    while at < places.len() {
        let kind = places[at].map_or(NO_ENTRY, |(kind, _)| kind);
        let mut run = 1;

        while at + run < places.len()
            && run < BUNDLE_MOST
            && places[at + run].map_or(NO_ENTRY, |(kind, _)| kind) == kind
        {
            run += 1;
        }

        table.extend_from_slice(&[run as u8, kind]);

        if kind != NO_ENTRY {
            for place in &places[at..at + run] {
                let (_, offset) = place.expect("an entry of the run");

                table.push(EXPORTED);
                table.extend_from_slice(&offset.to_le_bytes());
            }
        }

        at += run;
    }

    table.push(0);
    table
}

fn put(out: &mut [u8], at: usize, value: u16) {
    out[at..at + 2].copy_from_slice(&value.to_le_bytes());
}

/// A header's word made the offset of what comes next.
fn mark(out: &mut [u8], at: usize) {
    let here = out.len() as u16;

    put(out, at, here);
}

/// A segment's entry: no sector, its length and allocation, its flags and
/// its handle.
fn segment(out: &mut Vec<u8>, length: u16, flags: u16, handle: u16) {
    for word in [0, length, flags, length, handle] {
        out.extend_from_slice(&word.to_le_bytes());
    }
}

/// A name of the resident names: its length, its letters, its ordinal.
fn name_entry(out: &mut Vec<u8>, name: &str, ordinal: u16) {
    out.push(name.len() as u8);
    out.extend_from_slice(name.as_bytes());
    out.extend_from_slice(&ordinal.to_le_bytes());
}

impl System {
    /// A kept module's database written where its handle's selector is,
    /// its size what `GlobalSize` answers, rounded as a block is.
    pub(crate) fn write_kept_database(&mut self, kept: usize) {
        let bytes = database(self, kept);
        let index = self.kept[kept].database;

        self.descriptors
            .map(&mut self.cpu.bus, index, &bytes, false);
        self.global.set_segment_size(
            &mut self.cpu.bus,
            &mut self.descriptors,
            index,
            (bytes.len() as u32 + 31) & !31,
        );
    }

    /// Every kept module's database written afresh: as a program is
    /// loaded, `DISPLAY`'s then the display's own driver's.
    pub(crate) fn write_kept_databases(&mut self) {
        for kept in 0..self.kept.len() {
            self.write_kept_database(kept);
        }
    }

    /// The handle of a kept module's segment by its number, as KERNEL
    /// answers `GetCodeHandle` for a module's handle and a segment's
    /// number (`KRNL386.EXE` seg1 `483e`-`48b2`): its handle in the
    /// database's table, the stubs made where they were not, as KERNEL
    /// loads a segment that is not loaded. Nought for no such segment.
    pub(crate) fn kept_segment_handle(&mut self, kept: usize, number: u16) -> u16 {
        match number {
            STUBS_SEGMENT => {
                let index = self.stubs(kept);

                segment_selector(index)
            }
            DATA_SEGMENT => self.kept[kept].instance(),
            _ => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(bytes: &[u8], at: usize) -> u16 {
        u16::from_le_bytes([bytes[at], bytes[at + 1]])
    }

    /// MMSYSTEM's: two segments, its name first among the resident names,
    /// its data the module's instance, its path.
    #[test]
    fn lays_out_mmsystem() {
        let mut system = System::new();
        let kept = system.kept_named("MMSYSTEM").expect("MMSYSTEM is kept");
        let bytes = database(&mut system, kept);

        assert_eq!(word(&bytes, 0), 0x454e);
        assert_eq!(word(&bytes, layout::SEGMENT_COUNT), 2);
        assert_eq!(word(&bytes, layout::AUTO_DATA), DATA_SEGMENT);
        assert_eq!(word(&bytes, layout::FLAGS), LIBRARY_LOADED);

        let table = usize::from(word(&bytes, layout::SEGMENT_TABLE));
        let data = table + layout::SEGMENT_ENTRY;

        assert_eq!(
            word(&bytes, data + layout::SEGMENT_HANDLE),
            system.kept[kept].instance()
        );
        // The stubs not yet made: no handle.
        assert_eq!(word(&bytes, table + layout::SEGMENT_HANDLE), 0);

        let names = usize::from(word(&bytes, layout::RESIDENT_NAMES));

        assert_eq!(&bytes[names..names + 9], b"\x08MMSYSTEM");

        let info = usize::from(word(&bytes, layout::FILE_INFO));

        assert!(bytes[info + 8..].starts_with(b"C:\\WINDOWS\\SYSTEM\\MMSYSTEM.DLL\0"));
    }
}
