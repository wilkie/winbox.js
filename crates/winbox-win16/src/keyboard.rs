//! The keyboard driver, `KEYBOARD.DRV`, as winbox.js keeps it: the US
//! keyboard's tables, made to match the Windows 3.1 the recordings were
//! made on, and the calls that read them. The rest of its exports are
//! stubs.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

/// ANSI to OEM: 01h to 1Fh, then 80h up.
const ANSI_TO_OEM: [u8; 160] = [
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
    0x80, 0x81, 0x2c, 0x9f, 0x2c, 0x5f, 0xfd, 0xfc, 0x88, 0x25, 0x53, 0x3c, 0x4f, 0x8d, 0x8e, 0x8f,
    0x90, 0x60, 0x27, 0x22, 0x22, 0xf9, 0x2d, 0x5f, 0x98, 0x99, 0x73, 0x3e, 0x6f, 0x9d, 0x9e, 0x59,
    0x20, 0xad, 0x9b, 0x9c, 0x0f, 0x9d, 0xdd, 0x15, 0x22, 0x63, 0xa6, 0xae, 0xaa, 0x2d, 0x72, 0x5f,
    0xf8, 0xf1, 0xfd, 0x33, 0x27, 0xe6, 0x14, 0xfa, 0x2c, 0x31, 0xa7, 0xaf, 0xac, 0xab, 0x5f, 0xa8,
    0x41, 0x41, 0x41, 0x41, 0x8e, 0x8f, 0x92, 0x80, 0x45, 0x90, 0x45, 0x45, 0x49, 0x49, 0x49, 0x49,
    0x44, 0xa5, 0x4f, 0x4f, 0x4f, 0x4f, 0x99, 0x78, 0x4f, 0x55, 0x55, 0x55, 0x9a, 0x59, 0x5f, 0xe1,
    0x85, 0xa0, 0x83, 0x61, 0x84, 0x86, 0x91, 0x87, 0x8a, 0x82, 0x88, 0x89, 0x8d, 0xa1, 0x8c, 0x8b,
    0x64, 0xa4, 0x95, 0xa2, 0x93, 0x6f, 0x94, 0xf6, 0x6f, 0x97, 0xa3, 0x96, 0x81, 0x79, 0x5f, 0x98,
];

/// OEM to ANSI: 01h to 1Fh, then 80h up.
const OEM_TO_ANSI: [u8; 160] = [
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0xa4,
    0x10, 0x11, 0x12, 0x13, 0xb6, 0xa7, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
    0xc7, 0xfc, 0xe9, 0xe2, 0xe4, 0xe0, 0xe5, 0xe7, 0xea, 0xeb, 0xe8, 0xef, 0xee, 0xec, 0xc4, 0xc5,
    0xc9, 0xe6, 0xc6, 0xf4, 0xf6, 0xf2, 0xfb, 0xf9, 0xff, 0xd6, 0xdc, 0xa2, 0xa3, 0xa5, 0x50, 0x83,
    0xe1, 0xed, 0xf3, 0xfa, 0xf1, 0xd1, 0xaa, 0xba, 0xbf, 0x5f, 0xac, 0xbd, 0xbc, 0xa1, 0xab, 0xbb,
    0x5f, 0x5f, 0x5f, 0xa6, 0xa6, 0xa6, 0xa6, 0x2b, 0x2b, 0xa6, 0xa6, 0x2b, 0x2b, 0x2b, 0x2b, 0x2b,
    0x2b, 0x2d, 0x2d, 0x2b, 0x2d, 0x2b, 0xa6, 0xa6, 0x2b, 0x2b, 0x2d, 0x2d, 0xa6, 0x2d, 0x2b, 0x2d,
    0x2d, 0x2d, 0x2d, 0x2b, 0x2b, 0x2b, 0x2b, 0x2b, 0x2b, 0x2b, 0x2b, 0x5f, 0x5f, 0xa6, 0x5f, 0x5f,
    0x5f, 0xdf, 0x5f, 0xb6, 0x5f, 0x5f, 0xb5, 0x5f, 0x5f, 0x5f, 0x5f, 0x5f, 0x5f, 0x5f, 0x5f, 0x5f,
    0x5f, 0xb1, 0x5f, 0x5f, 0x5f, 0x5f, 0xf7, 0x5f, 0xb0, 0x95, 0xb7, 0x5f, 0x6e, 0xb2, 0x5f, 0x5f,
];

/// Each scan code's virtual key, from 0 to `SCAN_LIMIT` and the byte after,
/// which `MapVirtualKey` reads (seg11 `0048`).
const SCAN_TO_VK: [u8; 90] = [
    0xff, 0x1b, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x30, 0xbd, 0xbb, 0x08, 0x09,
    0x51, 0x57, 0x45, 0x52, 0x54, 0x59, 0x55, 0x49, 0x4f, 0x50, 0xdb, 0xdd, 0x0d, 0x11, 0x41, 0x53,
    0x44, 0x46, 0x47, 0x48, 0x4a, 0x4b, 0x4c, 0xba, 0xde, 0xc0, 0x10, 0xdc, 0x5a, 0x58, 0x43, 0x56,
    0x42, 0x4e, 0x4d, 0xbc, 0xbe, 0xbf, 0x10, 0x6a, 0x12, 0x20, 0x14, 0x70, 0x71, 0x72, 0x73, 0x74,
    0x75, 0x76, 0x77, 0x78, 0x79, 0x90, 0x91, 0x24, 0x26, 0x21, 0x6d, 0x25, 0x0c, 0x27, 0x6b, 0x23,
    0x28, 0x22, 0x2d, 0x2e, 0xff, 0xff, 0xe2, 0x7a, 0x7b, 0x00,
];

/// The last scan code `SCAN_TO_VK` answers for.
const SCAN_LIMIT: u16 = 89;

/// The numeric keypad's virtual keys, for scan codes 47h to 53h (seg11
/// `00ea`).
const NUMPAD_VK: [u8; 13] = [
    0x67, 0x68, 0x69, 0x6d, 0x64, 0x65, 0x66, 0x6b, 0x61, 0x62, 0x63, 0x60, 0x6e,
];

/// The layout `VkKeyScan` reads: each table's keys, the characters they
/// type -- table 0 unshifted and shifted, in pairs -- and its shift state.
const LAYOUT: [(&[u8], &[u8], u16); 4] = [
    (
        &[
            0x20, 0x09, 0x0d, 0x08, 0x1b, 0x03, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
            0x38, 0x39, 0xbc, 0xbe, 0xbd, 0xbb, 0xba, 0xbf, 0xc0, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
            0xe2, 0x6e, 0x6a, 0x6d, 0x6b, 0x6f,
        ],
        &[
            0x20, 0x20, 0x09, 0x09, 0x0d, 0x0d, 0x08, 0x08, 0x1b, 0x1b, 0x03, 0x03, 0x30, 0x29,
            0x31, 0x21, 0x32, 0x40, 0x33, 0x23, 0x34, 0x24, 0x35, 0x25, 0x36, 0x5e, 0x37, 0x26,
            0x38, 0x2a, 0x39, 0x28, 0x2c, 0x3c, 0x2e, 0x3e, 0x2d, 0x5f, 0x3d, 0x2b, 0x3b, 0x3a,
            0x2f, 0x3f, 0x60, 0x7e, 0x5b, 0x7b, 0x5c, 0x7c, 0x5d, 0x7d, 0x27, 0x22, 0xff, 0xff,
            0x5c, 0x7c, 0x2e, 0x2e, 0x2a, 0x2a, 0x2d, 0x2d, 0x2b, 0x2b, 0x2f, 0x2f,
        ],
        0,
    ),
    (
        &[
            0x03, 0x08, 0x0d, 0x1b, 0x20, 0x32, 0x36, 0xdb, 0xdc, 0xdd, 0xbd, 0xe2,
        ],
        &[
            0x03, 0x7f, 0x0a, 0x1b, 0x20, 0x80, 0x9e, 0x1b, 0x1c, 0x1d, 0x9f, 0x1c,
        ],
        2,
    ),
    (&[], &[], 6),
    (&[], &[], 7),
];

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "AnsiToOem" => ansi_to_oem,
        "OemToAnsi" => oem_to_ansi,
        "AnsiToOemBuff" => ansi_to_oem_buff,
        "OemToAnsiBuff" => oem_to_ansi_buff,
        "VkKeyScan" => vk_key_scan,
        "MapVirtualKey" => map_virtual_key,
        _ => return None,
    }))
}

/// One byte through a table: 80h up from its last 128, 01h to 1Fh from its
/// first 32, the rest as they are. **Read out** (seg10 `0843`).
fn translate(table: &[u8; 160], byte: u8) -> u8 {
    if byte >= 0x80 {
        table[usize::from(byte) - 0x80 + 0x20]
    } else if byte != 0 && byte < 0x20 {
        table[usize::from(byte)]
    } else {
        byte
    }
}

/// A far pointer one byte on, carrying into the next selector at the end of
/// its segment, as a huge pointer does (`__AHINCR`, seg10 `08c1`).
fn next(far: u32) -> u32 {
    let offset = (far as u16).wrapping_add(1);
    let segment = if offset == 0 {
        (far >> 16) as u16 + 8
    } else {
        (far >> 16) as u16
    };

    u32::from(segment) << 16 | u32::from(offset)
}

/// A string through a table, up to and with its null, read before it is
/// written so that it may be translated in place. `0xffff` (seg10 `08dd`).
fn string(system: &mut System, table: &[u8; 160], mut source: u32, mut target: u32) -> u16 {
    loop {
        let byte = translate(table, system.read_far(source, 1)[0]);

        system.write_far(target, &[byte]);
        source = next(source);
        target = next(target);

        if byte == 0 {
            return 0xffff;
        }
    }
}

/// `count` bytes through a table, nulls and all, within their segments.
fn buffer(system: &mut System, table: &[u8; 160], source: u32, target: u32, count: u16) {
    for at in 0..count {
        let from = source & 0xffff_0000 | u32::from((source as u16).wrapping_add(at));
        let to = target & 0xffff_0000 | u32::from((target as u16).wrapping_add(at));
        let byte = translate(table, system.read_far(from, 1)[0]);

        system.write_far(to, &[byte]);
    }
}

/// A string translated to the OEM character set, or with `to_oem` false
/// from it, as `AnsiToOem` and `OemToAnsi` translate one: for USER's own
/// calls to them.
pub(crate) fn translate_string(system: &mut System, to_oem: bool, source: u32, target: u32) {
    string(
        system,
        if to_oem { &ANSI_TO_OEM } else { &OEM_TO_ANSI },
        source,
        target,
    );
}

/// Text USER holds itself translated to the OEM character set, or with
/// `to_oem` false from it (`translateText`).
pub(crate) fn translate_bytes(to_oem: bool, bytes: &[u8]) -> Vec<u8> {
    let table = if to_oem { &ANSI_TO_OEM } else { &OEM_TO_ANSI };

    bytes.iter().map(|&byte| translate(table, byte)).collect()
}

fn ansi_to_oem(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let source = args.dword(system);
    let target = args.dword(system);

    Ok(Answer::Word(string(system, &ANSI_TO_OEM, source, target)))
}

fn oem_to_ansi(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let source = args.dword(system);
    let target = args.dword(system);

    Ok(Answer::Word(string(system, &OEM_TO_ANSI, source, target)))
}

/// No answer is made: AX is what the loop left.
fn ansi_to_oem_buff(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let source = args.dword(system);
    let target = args.dword(system);
    let count = args.word(system);

    buffer(system, &ANSI_TO_OEM, source, target, count);
    Ok(Answer::Nothing)
}

fn oem_to_ansi_buff(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let source = args.dword(system);
    let target = args.dword(system);
    let count = args.word(system);

    buffer(system, &OEM_TO_ANSI, source, target, count);
    Ok(Answer::Nothing)
}

/// The virtual key a character is typed with, and the shift state it takes.
/// **Read out** (seg5 `0007`) and **recorded** by `misc`, every character:
/// `FFh` answers `ffff`; a capital is its own key with Shift, a small letter
/// the capital's key alone; anything else is looked for in the layout's
/// tables in order, the high byte the table's shift state, plus 1 for a
/// shifted character of table 0; one no table has is Ctrl and its letter
/// from 01h to 1Ah, and `ffff` else.
fn vk_key_scan(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let character = args.word(system) as u8;

    if character == 0xff {
        return Ok(Answer::Word(0xffff));
    }

    if character.is_ascii_uppercase() {
        return Ok(Answer::Word(0x100 | u16::from(character)));
    }

    if character.is_ascii_lowercase() {
        return Ok(Answer::Word(u16::from(character - 0x20)));
    }

    for (n, (keys, characters, shift)) in LAYOUT.iter().enumerate() {
        let Some(index) = characters.iter().position(|&each| each == character) else {
            continue;
        };

        return Ok(Answer::Word(if n == 0 {
            (shift + (index as u16 & 1)) << 8 | u16::from(keys[index >> 1])
        } else {
            shift << 8 | u16::from(keys[index])
        }));
    }

    if (0x01..=0x1a).contains(&character) {
        return Ok(Answer::Word(0x200 | u16::from(character + 0x40)));
    }

    Ok(Answer::Word(0xffff))
}

/// A key's scan code, a scan code's virtual key, or a key's character.
/// **Read out** (seg8 `0000`) and **recorded** by `minis2`, every code of
/// each type: 0, the scan code whose virtual key it is, else the numeric
/// keypad's from 47h, else nought; 1, the scan code's virtual key, the code
/// one past the table reading the byte after it; 2, a digit or a capital
/// itself, any other key its character unshifted, the code's high byte
/// kept, else nought. Only the low byte of the type is looked at.
fn map_virtual_key(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let code = args.word(system);
    let kind = args.word(system) as u8;
    let low = code as u8;

    Ok(Answer::Word(match kind {
        0 => match SCAN_TO_VK[..usize::from(SCAN_LIMIT)]
            .iter()
            .position(|&vk| vk == low)
        {
            Some(at) => at as u16,
            None => NUMPAD_VK
                .iter()
                .position(|&vk| vk == low)
                .map_or(0, |pad| pad as u16 + 0x47),
        },
        1 if code > SCAN_LIMIT => 0,
        1 => u16::from(SCAN_TO_VK[usize::from(code)]),
        _ => {
            if low.is_ascii_digit() || low.is_ascii_uppercase() {
                code
            } else {
                let (keys, characters, _) = LAYOUT[0];

                match keys.iter().position(|&key| key == low) {
                    Some(index) if characters[index * 2] != 0xff => {
                        code & 0xff00 | u16::from(characters[index * 2])
                    }
                    _ => 0,
                }
            }
        }
    }))
}
