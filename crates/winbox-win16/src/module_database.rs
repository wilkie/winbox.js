//! A module's database as KERNEL lays it out in memory from the file's
//! header (**read out**, `KRNL386.EXE` seg2 `0d66`, the routine that reads
//! a module's header for `LoadModule`): the header's 40h bytes, then each
//! table in the order the file has them, some of them changed on the way.
//! A program reads it through its module's handle -- its flags, as
//! `solodata` does -- and a self-loading program's own loader reads and
//! writes its segment table (`self_load.rs`).
//!
//! * The header (`0f21`-`0f33`): the file's, its flags' bit 3 cleared
//!   (`0ecd`).
//! * The segment table, at 40h (`0f37`-`0f70`): ten bytes a segment where
//!   the file has eight -- its sector, its length, its flags, its minimum
//!   allocation, then a word for the handle KERNEL or the program's own
//!   loader gives it. The flags are the file's but bits 1, 2 and 9 to 11
//!   (`and 13F9h`), with 4000h for a code segment and 8000h for a library's;
//!   a program's every segment moveable (10h).
//! * The resource table, the resident names -- the module's name made
//!   upper case (`1059`-`106e`) -- the module references, the imported
//!   names, each copied as it is (`102f`-`109d`); words 38h and 3Ah given
//!   where the imported names start (`1082`-`1087`).
//! * The entry table, made over (`109f`-`10f2`): bundles, each a word of
//!   the ordinal before its first entry, a word of its last, and a word of
//!   the next bundle's offset, nought for none, then five bytes an entry --
//!   the file's bundle's type (`FFh` for a moveable segment), the entry's
//!   flags, its segment's number and its offset. A run of ordinals the file
//!   skips moves an empty bundle's start on, or starts a new bundle.
//! * Words 2, 6 and 0Ah nought (`1146`-`114e`), then the file's own
//!   description, where the loader was given one, at 0Ah's offset
//!   (`115e`-`116a`); word 8 the offset of the data segment's entry in the
//!   segment table (`116c`-`1184`); a shift of nought made 9 (`1152`-`1158`)
//!   and an expected version of nought 201h (`118e`-`1199`).
//! * The stack's offset, where the file gives none: its size and the data
//!   segment's minimum allocation (seg2 `0b14`, as the task starts).
//! * Every data segment, and every code segment of a program that cannot
//!   be discarded, is made one to load at once (40h), a data segment no
//!   longer discardable (`11b1`-`1205`); so are the entry point's and the
//!   data segment's (`1207`-`1238`), the entry point's marked 400h where
//!   there is a data segment. A program's stack is made 1400h at least, a
//!   heap that is not nought 64h at least (`123d`-`1264`).

use winbox_ne::Executable;

/// The header's length, which the segment table follows.
pub const HEADER: usize = 0x40;
/// A segment's entry in memory: the file's eight bytes and its handle.
pub const SEGMENT_ENTRY: usize = 10;
/// The word of the segment's handle in its entry.
pub const SEGMENT_HANDLE: usize = 8;
/// The word of the segment's flags in its entry.
pub const SEGMENT_FLAGS: usize = 4;

/// The header's words KERNEL reads and rewrites.
pub const FLAGS: usize = 0x0c;
pub const AUTO_DATA: usize = 0x0e;
pub const HEAP: usize = 0x10;
pub const STACK: usize = 0x12;
pub const ENTRY_CS: usize = 0x16;
pub const STACK_POINTER: usize = 0x18;
pub const SEGMENT_COUNT: usize = 0x1c;
pub const SEGMENT_TABLE: usize = 0x22;
pub const RESOURCE_TABLE: usize = 0x24;
pub const RESIDENT_NAMES: usize = 0x26;
pub const MODULE_REFERENCES: usize = 0x28;
pub const IMPORTED_NAMES: usize = 0x2a;
pub const ENTRY_TABLE: usize = 0x04;
pub const USAGE: usize = 0x02;
pub const NEXT: usize = 0x06;
pub const DATA_ENTRY: usize = 0x08;
pub const FILE_INFO: usize = 0x0a;
pub const SHIFT: usize = 0x32;
pub const GANG_START: usize = 0x38;
pub const GANG_LENGTH: usize = 0x3a;
pub const EXPECTED_VERSION: usize = 0x3e;

/// The header's flags KERNEL takes as they are, and the bit it clears.
const LIBRARY: u16 = 0x8000;
const CLEARED_FLAG: u16 = 0x0008;
const MULTIPLE_DATA: u16 = 0x0002;
const IMPORTS: u16 = 0x0040;
const MODULE_REFERENCE_COUNT: usize = 0x1e;
/// A segment's flags KERNEL keeps from the file's, and what it adds.
const KEPT_SEGMENT_FLAGS: u16 = 0x13f9;
const SEGMENT_TYPE: u16 = 0x0007;
const CODE_MARK: u16 = 0x4000;
const LIBRARY_MARK: u16 = 0x8000;
pub const MOVEABLE: u16 = 0x0010;
pub const PRELOAD: u16 = 0x0040;
const DISCARDABLE: u16 = 0x1000;
const DATA: u16 = 0x0001;
const ENTRY_WITH_DATA: u16 = 0x0400;
/// A segment given its block, and one whose bytes are in it.
pub const ALLOCATED: u16 = 0x0002;
pub const LOADED: u16 = 0x0004;

const DEFAULT_SHIFT: u16 = 9;
const DEFAULT_VERSION: u16 = 0x0201;
const LEAST_STACK: u16 = 0x1400;
const LEAST_HEAP: u16 = 0x64;

/// A bundle's header: its first ordinal less one, its last, and the next's
/// offset.
const BUNDLE_HEADER: usize = 6;
/// An entry's bytes in a bundle.
pub const BUNDLE_ENTRY: usize = 5;
const MOVEABLE_BUNDLE: u8 = 0xff;

fn word(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn set_word(bytes: &mut [u8], at: usize, value: u16) {
    bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
}

/// A header's word made the offset of what comes next.
fn mark(out: &mut [u8], field: usize) {
    let here = out.len() as u16;

    set_word(out, field, here);
}

/// The description of a module's file KERNEL keeps after its tables: the
/// `OFSTRUCT` `OpenFile` filled as `LoadModule` opened it, copied to its
/// path's nought (`cBytes` and one more, seg2 `0d7d`-`0d83`, `115e`-`116a`).
/// **Recorded** by `moddb`: `cBytes` is eight and the path's length, then
/// `fFixedDisk` 1 and `nErrCode` nought, and the path. Its four reserved
/// bytes, the file's date and time, are not recorded (they are the host's),
/// and are nought here.
pub fn file_info(path: &str) -> Vec<u8> {
    let mut info = vec![
        (OFSTRUCT_PATH + path.len()) as u8,
        FIXED_DISK,
        0,
        0,
        0,
        0,
        0,
        0,
    ];

    info.extend(path.bytes());
    info.push(0);
    info
}

/// Where an `OFSTRUCT`'s path starts, and its `fFixedDisk` for a hard disk.
const OFSTRUCT_PATH: usize = 8;
const FIXED_DISK: u8 = 1;

/// A module's database as KERNEL lays it out, `file_info` the description
/// of its file the loader keeps at word 0Ah, if any.
pub fn layout(executable: &Executable, file_info: &[u8]) -> Vec<u8> {
    let file = executable.bytes();
    let start = executable.header_offset as usize;
    let header = |at: usize| word(file, start + at);
    let from = |at: usize| start + usize::from(header(at));
    let library = header(FLAGS) & LIBRARY != 0;
    let mut out = file[start..start + HEADER].to_vec();

    // Then, as `LoadModule` goes on, a program marked as having multiple
    // data (seg2 `17e5`-`17ee`) and a module that imports from others 40h
    // (`1878`-`1885`, where KERNEL's byte at 326h lacks 10h). **Recorded**
    // by `solodata` (201h made 243h) and `moddb` (202h made 242h).
    let mut flags = header(FLAGS) & !CLEARED_FLAG;

    if !library {
        flags |= MULTIPLE_DATA;
    }

    if header(MODULE_REFERENCE_COUNT) != 0 {
        flags |= IMPORTS;
    }

    set_word(&mut out, FLAGS, flags);

    // The segment table, ten bytes an entry.
    let count = usize::from(header(SEGMENT_COUNT));
    let table = from(SEGMENT_TABLE);

    mark(&mut out, SEGMENT_TABLE);

    for segment in 0..count {
        let entry = &file[table + 8 * segment..table + 8 * segment + 8];
        let mut flags = word(entry, 4) & KEPT_SEGMENT_FLAGS;

        if flags & SEGMENT_TYPE == 0 {
            flags |= CODE_MARK;
        }

        flags |= LIBRARY_MARK;

        if !library {
            flags ^= LIBRARY_MARK;
            flags |= MOVEABLE;
        }

        out.extend_from_slice(&entry[..4]);
        out.extend_from_slice(&flags.to_le_bytes());
        out.extend_from_slice(&entry[6..8]);
        out.extend_from_slice(&[0, 0]);
    }

    // The resource table, the resident names, the module references and
    // the imported names, as they are, each at its new place.
    for (field, next) in [
        (RESOURCE_TABLE, RESIDENT_NAMES),
        (RESIDENT_NAMES, MODULE_REFERENCES),
        (MODULE_REFERENCES, IMPORTED_NAMES),
    ] {
        let length = usize::from(header(next).wrapping_sub(header(field)));
        let at = from(field);

        mark(&mut out, field);

        if field == MODULE_REFERENCES {
            let end = (out.len() + length) as u16;

            set_word(&mut out, GANG_LENGTH, end);
            set_word(&mut out, GANG_START, end);
        }

        out.extend_from_slice(&file[at..(at + length).min(file.len())]);

        // The module's name, the first of the resident names, upper case.
        if field == RESIDENT_NAMES {
            let name = usize::from(word(&out, RESIDENT_NAMES));
            let length = usize::from(out[name]);

            out[name + 1..name + 1 + length].make_ascii_uppercase();
        }
    }

    let length = usize::from(header(ENTRY_TABLE).wrapping_sub(header(IMPORTED_NAMES)));
    let at = from(IMPORTED_NAMES);

    mark(&mut out, IMPORTED_NAMES);
    out.extend_from_slice(&file[at..(at + length).min(file.len())]);

    entry_bundles(&mut out, &file[from(ENTRY_TABLE)..]);

    set_word(&mut out, USAGE, 0);
    set_word(&mut out, NEXT, 0);
    set_word(&mut out, FILE_INFO, 0);

    if word(&out, SHIFT) == 0 {
        set_word(&mut out, SHIFT, DEFAULT_SHIFT);
    }

    if !file_info.is_empty() {
        mark(&mut out, FILE_INFO);
        out.extend_from_slice(file_info);
    }

    let data_entry = match word(&out, AUTO_DATA) {
        0 => 0,
        number => word(&out, SEGMENT_TABLE) + (number - 1) * SEGMENT_ENTRY as u16,
    };

    set_word(&mut out, DATA_ENTRY, data_entry);

    if word(&out, EXPECTED_VERSION) == 0 {
        set_word(&mut out, EXPECTED_VERSION, DEFAULT_VERSION);
    }

    mark_preloaded(&mut out, library);
    stack_pointer(&mut out);
    out
}

/// The stack's starting offset, where the header gives none: the stack's
/// size and the data segment's minimum allocation, on a word
/// (`KRNL386.EXE` seg2 `0b14`-`0b38`, as the task is made; **recorded** by
/// `moddb`: 2000h and `BE0h` make `2BE0h`).
fn stack_pointer(out: &mut [u8]) {
    let data = usize::from(word(out, DATA_ENTRY));

    if word(out, STACK_POINTER) != 0 || data == 0 {
        return;
    }

    let minimum = word(out, data + 6);

    set_word(
        out,
        STACK_POINTER,
        word(out, STACK).wrapping_add(minimum) & !1,
    );
}

/// The file's entry table made bundles, appended at `out`'s end, its
/// offset at word 4.
fn entry_bundles(out: &mut Vec<u8>, table: &[u8]) {
    let mut bundle = out.len();
    let mut at = 0;

    set_word(out, ENTRY_TABLE, bundle as u16);
    out.extend_from_slice(&[0; BUNDLE_HEADER]);

    while at + 2 <= table.len() {
        let count = table[at];
        let kind = table[at + 1];

        at += 2;

        if count == 0 {
            break;
        }

        let count16 = u16::from(count);

        if kind == 0 {
            let first = word(out, bundle);
            let last = word(out, bundle + 2);

            if first == last {
                set_word(out, bundle, first + count16);
                set_word(out, bundle + 2, last + count16);
            } else {
                let next = out.len();

                set_word(out, bundle + 4, next as u16);
                bundle = next;
                out.extend_from_slice(&(last + count16).to_le_bytes());
                out.extend_from_slice(&(last + count16).to_le_bytes());
                out.extend_from_slice(&[0, 0]);
            }

            continue;
        }

        let last = word(out, bundle + 2);

        set_word(out, bundle + 2, last + count16);

        for _ in 0..count {
            if kind == MOVEABLE_BUNDLE {
                // Flags, `INT 3Fh`, the segment's number, the offset.
                let Some(entry) = table.get(at..at + 6) else {
                    return;
                };

                out.extend_from_slice(&[kind, entry[0], entry[3], entry[4], entry[5]]);
                at += 6;
            } else {
                let Some(entry) = table.get(at..at + 3) else {
                    return;
                };

                out.extend_from_slice(&[kind, entry[0], kind, entry[1], entry[2]]);
                at += 3;
            }
        }
    }
}

/// The segments KERNEL loads at once, marked so (`11b1`-`1264`).
fn mark_preloaded(out: &mut [u8], library: bool) {
    let table = usize::from(word(out, SEGMENT_TABLE));
    let count = usize::from(word(out, SEGMENT_COUNT));

    for segment in 0..count {
        let at = table + segment * SEGMENT_ENTRY + SEGMENT_FLAGS;
        let mut flags = word(out, at);

        if flags & DATA != 0 {
            flags &= !DISCARDABLE;
            flags |= PRELOAD;
        } else if flags & MOVEABLE == 0 || flags & DISCARDABLE == 0 {
            // A fixed code segment is loaded at once where KERNEL's byte at
            // 32Ch is nought, as it is here [[inferred]].
            flags |= PRELOAD;
        }

        set_word(out, at, flags);
    }

    let entry_cs = usize::from(word(out, ENTRY_CS));

    if entry_cs != 0 {
        let at = table + (entry_cs - 1) * SEGMENT_ENTRY + SEGMENT_FLAGS;
        let mut flags = word(out, at) | PRELOAD;

        if word(out, AUTO_DATA) != 0 {
            flags |= ENTRY_WITH_DATA;

            let data = usize::from(word(out, DATA_ENTRY)) + SEGMENT_FLAGS;

            set_word(out, at, flags);
            set_word(out, data, word(out, data) | PRELOAD);
        } else {
            set_word(out, at, flags);
        }
    }

    if !library {
        if word(out, STACK) < LEAST_STACK {
            set_word(out, STACK, LEAST_STACK);
        }

        let heap = word(out, HEAP);

        if heap != 0 && heap < LEAST_HEAP {
            set_word(out, HEAP, LEAST_HEAP);
        }
    }
}

/// A segment's entry's offset in a database's bytes, by its number from 1.
pub fn segment_entry(database: &[u8], number: u16) -> usize {
    usize::from(word(database, SEGMENT_TABLE)) + usize::from(number - 1) * SEGMENT_ENTRY
}
