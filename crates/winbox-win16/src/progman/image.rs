//! The module WinBox's Program Manager runs as, made in memory: a program's
//! executable with no file behind it, so the task is made as `WinExec`
//! makes any program's -- its segments placed, its data segment its own
//! instance, its start-up run by the processor -- by the loader, the linker
//! and KERNEL's `InitTask` as they are. As `src/win16/progman/image.ts`;
//! the two make the same bytes (`progman.rs`'s test, `progman_test.ts`).
//!
//! It is `PROGMAN`, "WinBox Program Manager", with Microsoft's header's
//! sizes: its data segment as large as `PROGMAN.EXE`'s (8A3h bytes, seg8),
//! a local heap of 200h and a stack of 17D0h, Windows 3.10, flags 0312h.
//! Its one code segment is a C program's start-up and nothing more:
//! `InitTask`, `WaitEvent(0)`, `InitApp(hInstance)`, then `WinMain` --
//! WinBox's (`main.rs`), its far address in the data segment at
//! `WINMAIN_SLOT`, written as the module is loaded -- and DOS's function
//! 4Ch with what `WinMain` answered. A failed `InitTask` or `InitApp` ends
//! it with 255.

/// Where the data segment holds `WinMain`'s far address: past
/// `PROGMAN.EXE`'s own data, whose places WinBox keeps its own in
/// (`main.rs`).
pub const WINMAIN_SLOT: u16 = 0x8a4;

/// The data segment's size: `PROGMAN.EXE`'s and the slot.
const DATA_SIZE: usize = 0x8a8;

/// The module's name and its description.
const NAME: &[u8] = b"PROGMAN";
const DESCRIPTION: &[u8] = b"WinBox Program Manager";

/// The start-up, with each call's far address `FFFF:0000` for the linker
/// to fill (a chain of one).
const CODE: [u8; 0x31] = [
    0x9a, 0xff, 0xff, 0x00, 0x00, // 00 call far KERNEL.InitTask
    0x0b, 0xc0, // 05 or ax, ax
    0x74, 0x23, // 07 jz 2C
    0x57, // 09 push di       hInstance
    0x56, // 0A push si       hPrevInstance
    0x06, // 0B push es       lpCmdLine
    0x53, // 0C push bx
    0x52, // 0D push dx       nCmdShow
    0x33, 0xc0, // 0E xor ax, ax
    0x50, // 10 push ax
    0x9a, 0xff, 0xff, 0x00, 0x00, // 11 call far KERNEL.WaitEvent
    0x8b, 0xec, // 16 mov bp, sp
    0xff, 0x76, 0x08, // 18 push word [bp+8]  hInstance
    0x9a, 0xff, 0xff, 0x00, 0x00, // 1B call far USER.InitApp
    0x0b, 0xc0, // 20 or ax, ax
    0x74, 0x08, // 22 jz 2C
    0xff, 0x1e, 0xa4, 0x08, // 24 call far [WINMAIN_SLOT]
    0xb4, 0x4c, // 28 mov ah, 4Ch
    0xcd, 0x21, // 2A int 21h
    0xb8, 0xff, 0x4c, // 2C mov ax, 4CFFh
    0xcd, 0x21, // 2F int 21h
];

/// The imports, each a far address at an offset of the code: its module's
/// number in the module reference table and its ordinal.
const IMPORTS: [(u16, u16, u16); 3] = [
    // KERNEL.InitTask
    (0x01, 1, 91),
    // KERNEL.WaitEvent
    (0x12, 1, 30),
    // USER.InitApp
    (0x1c, 2, 5),
];

/// Where the NE header is, and the size of a sector (`1 << SHIFT`).
const NE: usize = 0x40;
const SHIFT: u16 = 4;

fn put16(bytes: &mut [u8], at: usize, value: u16) {
    bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
}

/// A counted string.
fn counted(bytes: &mut Vec<u8>, text: &[u8]) {
    bytes.push(text.len() as u8);
    bytes.extend_from_slice(text);
}

/// Bytes padded to the next sector.
fn align(bytes: &mut Vec<u8>) {
    let unit = 1usize << SHIFT;

    bytes.resize(bytes.len().div_ceil(unit) * unit, 0);
}

/// The executable's bytes.
#[must_use]
pub fn image() -> Vec<u8> {
    let mut bytes = vec![0u8; NE + 0x40];

    // The MZ header: its signature, a page of 40h bytes, a header of four
    // paragraphs, its relocations at 40h -- a Windows program's mark -- and
    // the NE header's place.
    bytes[0..2].copy_from_slice(b"MZ");
    put16(&mut bytes, 0x02, 0x40);
    put16(&mut bytes, 0x04, 1);
    put16(&mut bytes, 0x08, 4);
    put16(&mut bytes, 0x18, 0x40);
    put16(&mut bytes, 0x3c, NE as u16);

    // The tables after the NE header, each placed as it is written.
    let segment_table = bytes.len();

    bytes.extend_from_slice(&[0; 16]);

    let resident = bytes.len();

    counted(&mut bytes, NAME);
    bytes.extend_from_slice(&[0, 0, 0]);

    let references = bytes.len();

    bytes.extend_from_slice(&[1, 0, 8, 0]);

    let imported = bytes.len();

    bytes.push(0);
    counted(&mut bytes, b"KERNEL");
    counted(&mut bytes, b"USER");

    let entries = bytes.len();

    bytes.extend_from_slice(&[0, 0]);

    let nonresident = bytes.len();

    counted(&mut bytes, DESCRIPTION);
    bytes.extend_from_slice(&[0, 0, 0]);

    let nonresident_size = bytes.len() - nonresident;

    // The code segment and its relocations.
    align(&mut bytes);

    let code = bytes.len();

    bytes.extend_from_slice(&CODE);
    bytes.extend_from_slice(&(IMPORTS.len() as u16).to_le_bytes());

    for (offset, module, ordinal) in IMPORTS {
        // A far address (3), an import by ordinal (1).
        bytes.extend_from_slice(&[3, 1]);
        bytes.extend_from_slice(&offset.to_le_bytes());
        bytes.extend_from_slice(&module.to_le_bytes());
        bytes.extend_from_slice(&ordinal.to_le_bytes());
    }

    // The data segment: noughts.
    align(&mut bytes);

    let data = bytes.len();

    bytes.resize(data + DATA_SIZE, 0);

    let relative = |at: usize| (at - NE) as u16;
    let header: [(usize, u16); 27] = [
        (0x00, 0x454e),
        // Linker 5.20, as PROGMAN.EXE's.
        (0x02, 0x1405),
        (0x04, relative(entries)),
        (0x06, 2),
        (0x0c, 0x0312),
        // The data segment, the second.
        (0x0e, 2),
        (0x10, 0x0200),
        (0x12, 0x17d0),
        // CS:IP 1:0000, SS:SP 2:0000.
        (0x14, 0),
        (0x16, 1),
        (0x18, 0),
        (0x1a, 2),
        (0x1c, 2),
        (0x1e, 2),
        (0x20, nonresident_size as u16),
        (0x22, relative(segment_table)),
        // No resources: the resource table where the resident names are.
        (0x24, relative(resident)),
        (0x26, relative(resident)),
        (0x28, relative(references)),
        (0x2a, relative(imported)),
        (0x2c, nonresident as u16),
        (0x2e, 0),
        (0x32, SHIFT),
        // Windows; its fonts proportional (08h), as PROGMAN.EXE's.
        (0x36, 0x0802),
        (0x3e, 0x030a),
        (0x30, 0),
        (0x34, 0),
    ];

    for (at, value) in header {
        put16(&mut bytes, NE + at, value);
    }

    // The segment table: each one's sector, length, flags and allocation.
    // Code: moveable, preloaded, with relocations, discardable (1D50h);
    // data: moveable, preloaded (0C51h), as PROGMAN.EXE's.
    let sector = |at: usize| (at >> SHIFT) as u16;
    let table: [u16; 8] = [
        sector(code),
        CODE.len() as u16,
        0x1d50,
        CODE.len() as u16,
        sector(data),
        DATA_SIZE as u16,
        0x0c51,
        DATA_SIZE as u16,
    ];

    for (index, value) in table.into_iter().enumerate() {
        put16(&mut bytes, segment_table + 2 * index, value);
    }

    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    /// It reads as the program it is: named, described, its two segments
    /// and three imports, its start at 1:0000.
    #[test]
    fn it_reads_as_a_program() {
        let executable = winbox_ne::Executable::parse(image()).expect("an NE image");

        assert_eq!(executable.module_name(), Some("PROGMAN"));
        assert_eq!(executable.description(), Some("WinBox Program Manager"));
        assert_eq!(executable.segments.len(), 2);
        assert_eq!(executable.segment_bytes(0), CODE.to_vec());
        assert_eq!(executable.segment_bytes(1).len(), DATA_SIZE);
        assert_eq!(executable.segments[0].relocations.len(), 3);
        assert_eq!(executable.header.auto_data_segment, 2);
        assert_eq!(
            (executable.header.entry_cs, executable.header.entry_ip),
            (1, 0)
        );
        assert!(executable.resources.is_empty());
    }

    /// The bytes the TypeScript engine makes: `progman_test.ts` holds the
    /// same digest and sizes.
    #[test]
    fn it_is_the_typescript_engines() {
        let bytes = image();

        assert_eq!(bytes.len(), IMAGE_SIZE);
        assert_eq!(crate::sha256::sha256_hex(&bytes), IMAGE_SHA256);
        assert_eq!(super::super::main::menu_template().len(), MENU_SIZE);
    }

    const IMAGE_SHA256: &str = "89a699814c6d1b516817239577f2e6df0ed59ea978ba4fc7f6acf456d1aa4d16";
    const IMAGE_SIZE: usize = 2504;
    const MENU_SIZE: usize = 439;
}
