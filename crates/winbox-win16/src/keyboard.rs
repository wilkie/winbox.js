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
        "Inquire" => inquire,
        "ToAscii" => to_ascii,
        "SetSpeed" => set_speed,
        "WEP" => |system, args| {
            let _ = args.word(system);
            Ok(Answer::Nothing)
        },
        "ScreenSwitchEnable" => screen_switch_enable,
        "GetTableSeg" => get_table_seg,
        "NewTable" => new_table_call,
        "OemKeyScan" => oem_key_scan,
        "GetKeyboardType" => get_keyboard_type,
        "GetKeyNameText" => get_key_name_text,
        "EnableKBSysReq" => enable_kb_sys_req,
        "GetBIOSKeyProc" => get_bios_key_proc,
        "AnsiToOem" => ansi_to_oem,
        "OemToAnsi" => oem_to_ansi,
        "AnsiToOemBuff" => ansi_to_oem_buff,
        "OemToAnsiBuff" => oem_to_ansi_buff,
        "VkKeyScan" => vk_key_scan,
        "MapVirtualKey" => map_virtual_key,
        "GetKbCodePage" => get_kb_code_page,
        "Enable" => enable,
        "Disable" => disable,
        _ => return None,
    }))
}

/// The keyboard's OEM code page: the word the driver keeps at seg10 `06fc`,
/// before its tables, which nothing writes (**read out**, seg10 `083e`):
/// 437 for the US driver. DDEML takes it for a string handle's code page
/// besides `CP_WINANSI` (**recorded** by `ddemgmt`).
fn get_kb_code_page(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(437))
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

    Ok(Answer::Word(vk_key_scan_of(character)))
}

/// `VkKeyScan`'s answer for a character.
fn vk_key_scan_of(character: u8) -> u16 {
    if character == 0xff {
        return 0xffff;
    }

    if character.is_ascii_uppercase() {
        return 0x100 | u16::from(character);
    }

    if character.is_ascii_lowercase() {
        return u16::from(character - 0x20);
    }

    for (n, (keys, characters, shift)) in LAYOUT.iter().enumerate() {
        let Some(index) = characters.iter().position(|&each| each == character) else {
            continue;
        };

        return if n == 0 {
            (shift + (index as u16 & 1)) << 8 | u16::from(keys[index >> 1])
        } else {
            shift << 8 | u16::from(keys[index])
        };
    }

    if (0x01..=0x1a).contains(&character) {
        return 0x200 | u16::from(character + 0x40);
    }

    0xffff
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

    Ok(Answer::Word(map_virtual_key_of(code, kind)))
}

/// `MapVirtualKey`'s answer for a code and a type.
fn map_virtual_key_of(code: u16, kind: u8) -> u16 {
    let low = code as u8;

    match kind {
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
    }
}

// The rest of the driver's exports: what it answers of the keyboard and
// its tables, `ToAscii`, `OemKeyScan` and `GetKeyNameText`. **Read out of
// `KEYBOARD.DRV`** (the US driver the installation has) and **recorded** by
// `kbdrv`. The driver's state is kept in its data segment where the driver
// keeps it (seg11).

const TYPE: u16 = 0x0c;
const SUBTYPE: u16 = 0x0f;
const SWITCH: u16 = 0x104;
const BIOS_PROC: u16 = 0x108;
const ALT_TYPED: u16 = 0x128;
const PAD_KEY: u16 = 0x129;
const ENABLED: u16 = 0x12e;
const TABLE_READ: u16 = 0x12f;
const EVENT_PROC: u16 = 0xfa;
const ENHANCED_KEPT: u16 = 0x13a;

/// The BIOS's shift flags, and its keyboard's, in its data at 400h.
const SHIFT_FLAGS: u32 = 0x417;
const KEYBOARD_FLAGS: u32 = 0x496;

/// USER's `keybd_event`, which USER enables the driver with (`kbenable`).
const KEYBD_EVENT: u16 = 289;
const SYSREQ: u16 = 0x130;
const INQUIRE_AT: u16 = 0x131;
const KEYS: u16 = 0x137;

impl System {
    /// The driver's data segment's selector.
    fn keyboard_data(&self) -> u16 {
        self.kept_named("KEYBOARD").map_or(0, |kept| {
            winbox_machine::segment_selector(self.kept[kept].data)
        })
    }

    fn keyboard_byte(&self, at: u16) -> u8 {
        let base = self.base_of(self.keyboard_data());

        self.cpu.bus.read8(base + u32::from(at))
    }

    fn set_keyboard_byte(&mut self, at: u16, value: u8) {
        let base = self.base_of(self.keyboard_data());

        self.cpu.bus.write8(base + u32::from(at), value);
    }

    fn keyboard_word(&self, at: u16) -> u16 {
        let base = self.base_of(self.keyboard_data());

        self.cpu.bus.read16(base + u32::from(at))
    }

    fn set_keyboard_word(&mut self, at: u16, value: u16) {
        let base = self.base_of(self.keyboard_data());

        self.cpu.bus.write16(base + u32::from(at), value);
    }

    /// The driver's state as USER leaves it once Windows has started:
    /// enabled, the BIOS's INT 9 handler kept as DOS answers for it here,
    /// the type read (`new_table`), the `SysRq` flags 2 (**recorded**).
    fn keyboard_started(&mut self) {
        // Laid out once: the type read (12Fh) marks it, as `Disable`
        // leaves the driver not enabled.
        if self.keyboard_data() == 0 || self.keyboard_byte(TABLE_READ) != 0 {
            return;
        }

        self.set_keyboard_byte(ENABLED, 0xff);

        for (i, byte) in crate::keyboard_tables::INQUIRE.iter().enumerate() {
            self.set_keyboard_byte(INQUIRE_AT + i as u16, *byte);
        }

        self.set_keyboard_byte(SWITCH, 1);
        self.set_keyboard_byte(SYSREQ, 2);

        let vector = IDT + 9 * 4;
        let (offset, segment) = (self.cpu.bus.read16(vector), self.cpu.bus.read16(vector + 2));

        self.set_keyboard_word(BIOS_PROC, offset);
        self.set_keyboard_word(BIOS_PROC + 2, segment);

        // The event procedure USER enabled it with: its own `keybd_event`
        // (**recorded** by `kbenable`).
        if let Some(user) = self.kept_named("USER") {
            let stubs = self.stubs(user);

            self.set_keyboard_word(EVENT_PROC, crate::system::STEP * (KEYBD_EVENT + 1));
            self.set_keyboard_word(EVENT_PROC + 2, winbox_machine::segment_selector(stubs));
        }

        self.set_keyboard_byte(TABLE_READ, 1);
        self.new_table();
    }

    /// The type read again (seg3 `00cd`-`0151`): one already known, 1 to
    /// 6, taken for 4; none, the BIOS's -- 4 on DOSBox's machine -- then
    /// `SYSTEM.INI`'s `[keyboard]` `type=` unless past 4. The function keys
    /// are the type's.
    fn new_table(&mut self) {
        let mut kind = self.keyboard_byte(TYPE);

        if (1..=6).contains(&kind) {
            kind = 4;
        } else {
            let given = crate::profiles_kernel::private_profile_int(
                self,
                b"keyboard",
                b"type",
                4,
                b"SYSTEM.INI",
            ) as u8;

            kind = if given == 0 { 4 } else { given };

            if kind > 4 {
                self.set_keyboard_byte(TYPE, 4);
                return;
            }
        }

        self.set_keyboard_byte(TYPE, kind);
        self.set_keyboard_word(
            KEYS,
            u16::from(crate::keyboard_tables::FUNCTION_KEYS[usize::from(kind) - 1]),
        );
    }
}

/// Where the interrupt descriptor table is kept: see `task.rs`.
const IDT: u32 = 0xffd << 16;

/// What the keyboard is: six bytes copied, and 6 (seg10 `09b8`).
fn inquire(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    system.keyboard_started();

    let bytes: Vec<u8> = (0..6)
        .map(|i| system.keyboard_byte(INQUIRE_AT + i))
        .collect();

    system.write_far(far, &bytes);
    Ok(Answer::Word(6))
}

/// The type read again. What it leaves in AX is no answer.
fn new_table_call(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.keyboard_started();
    system.new_table();
    Ok(Answer::Nothing)
}

/// The keyboard's type (0), its subtype (1), its function keys (2); nought
/// for anything else, by the low byte (seg7 `000c`-`002a`).
fn get_keyboard_type(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let flag = args.word(system) as u8;

    system.keyboard_started();
    Ok(Answer::Word(match flag {
        0 => u16::from(system.keyboard_byte(TYPE)),
        1 => u16::from(system.keyboard_byte(SUBTYPE)),
        2 => system.keyboard_word(KEYS),
        _ => 0,
    }))
}

/// The typematic rate set: the rate given, or nought for -1 (seg6
/// `002a`-`006a`); DOSBox's controller takes it.
fn set_speed(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let rate = args.word(system);

    system.keyboard_started();
    Ok(Answer::Word(if rate == 0xffff { 0 } else { rate }))
}

/// Whether a screen switch is allowed: the word's bytes or-ed together
/// kept, and the word answered with its low byte so (seg10 `095c`).
fn screen_switch_enable(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let word = args.word(system);
    let low = (word as u8) | (word >> 8) as u8;

    system.keyboard_started();
    system.set_keyboard_byte(SWITCH, low);
    Ok(Answer::Word(word & 0xff00 | u16::from(low)))
}

/// The `SysRq` flags: 1 sets bit 0, 2 clears it, 4 sets bit 1, 8 clears it;
/// the flags then (seg10 `0977`-`09a0`).
fn enable_kb_sys_req(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let given = args.word(system);

    system.keyboard_started();

    let mut flags = system.keyboard_byte(SYSREQ);

    if given & 1 != 0 {
        flags |= 1;
    }

    if given & 2 != 0 {
        flags &= !1;
    }

    if given & 4 != 0 {
        flags |= 2;
    }

    if given & 8 != 0 {
        flags &= !2;
    }

    system.set_keyboard_byte(SYSREQ, flags);
    Ok(Answer::Word(u16::from(flags)))
}

/// The BIOS's INT 9 handler the driver found as it was enabled (seg10
/// `0028`).
fn get_bios_key_proc(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.keyboard_started();
    Ok(Answer::Dword(
        u32::from(system.keyboard_word(BIOS_PROC + 2)) << 16
            | u32::from(system.keyboard_word(BIOS_PROC)),
    ))
}

/// A selector of the segment the layout's tables are in (seg2 `0094`):
/// here a block of WinBox's own holding them, made as it is first asked
/// for.
fn get_table_seg(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.keyboard_started();

    if system.keyboard_tables == 0 {
        let table = crate::keyboard_tables::TABLE_SEGMENT;
        let (_, far) = system.scratch_block(table.len() as u32);

        system.write_far(far, &table);
        system.keyboard_tables = (far >> 16) as u16;
    }

    Ok(Answer::Word(system.keyboard_tables))
}

/// The character a key types (seg10 `0430`-`06c5`).
fn to_ascii(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let vk = args.word(system);
    let scan = args.word(system);
    let states = args.dword(system);
    let target = args.dword(system);
    let flags = args.word(system);

    system.keyboard_started();

    let key = |system: &System, at: u16| {
        system.read_far(
            states & 0xffff_0000 | u32::from((states as u16).wrapping_add(at)),
            1,
        )[0]
    };
    let nothing = |system: &mut System| {
        system.write_far(target, &[0, 0]);
        Ok(Answer::Word(0))
    };
    let typed = |system: &mut System, character: u8| {
        system.write_far(target, &[character]);
        Ok(Answer::Word(1))
    };
    let low = vk as u8;

    if vk == 0 {
        return nothing(system);
    }

    if scan & 0x8000 != 0 {
        if low == 0x12 {
            system.set_keyboard_byte(PAD_KEY, 0);

            let pending = system.keyboard_byte(ALT_TYPED);

            system.set_keyboard_byte(ALT_TYPED, 0);

            if system.read_far(target, 1)[0] == 0 {
                return nothing(system);
            }

            if pending == 0 {
                string(system, &OEM_TO_ANSI, target, target);
            }

            return Ok(Answer::Word(1));
        }

        if scan as u8 == system.keyboard_byte(PAD_KEY) {
            system.set_keyboard_byte(PAD_KEY, 0);
        }

        return Ok(Answer::Word(0));
    }

    if low == 0x12 {
        system.write_far(target, &[0, 0]);
        system.set_keyboard_byte(ALT_TYPED, 0);
    }

    let mut shift = u8::from(key(system, 0x10) & 0x80 != 0)
        + 2 * u8::from(key(system, 0x11) & 0x80 != 0)
        + 4 * u8::from(key(system, 0x12) & 0x80 != 0);

    if shift == 4 || shift == 5 {
        if let Some(answer) = alt_digit(system, scan as u8, target, flags) {
            return answer;
        }

        shift &= 3;
    }

    let pair: (u8, u8);

    if shift <= 3 && low.is_ascii_uppercase() {
        if shift >= 2 {
            return typed(system, low & 0x1f);
        }

        pair = (low + 0x20, low);
    } else if (0x60..=0x69).contains(&low) {
        return if shift <= 1 {
            typed(system, low.wrapping_add(0xd0))
        } else {
            nothing(system)
        };
    } else {
        let table = crate::keyboard_tables::SHIFT_TABLES[usize::from(shift)];

        if table == 0xff {
            return nothing(system);
        }

        let (keys, characters, _) = LAYOUT[usize::from(table >> 1)];
        let Some(index) = keys.iter().position(|&each| each == low) else {
            return nothing(system);
        };

        if shift > 1 {
            let character = characters[index];

            return match shift {
                2 if character & 0x80 != 0 => nothing(system),
                3 if character & 0x80 == 0 => nothing(system),
                3 => typed(system, character & 0x1f),
                _ => typed(system, character),
            };
        }

        pair = (characters[index * 2], characters[index * 2 + 1]);
    }

    let mut character = if shift != 0 { pair.1 } else { pair.0 };

    if key(system, 0x14) & 1 != 0 && low.is_ascii_uppercase() {
        character = if character == pair.0 { pair.1 } else { pair.0 };
    }

    if character == 0xff {
        nothing(system)
    } else {
        typed(system, character)
    }
}

/// A digit of the numeric keypad typed with Alt (seg10 `0515`-`056a`):
/// the byte at `target` ten times itself plus the digit, in a byte, and
/// nought; the same key again nought and nothing written; with flag 2
/// nothing typed. None where the key is no digit, or with flag 1.
fn alt_digit(
    system: &mut System,
    code: u8,
    target: u32,
    flags: u16,
) -> Option<Result<Answer, Stop>> {
    let digit = if (0x47..=0x52).contains(&code) {
        crate::keyboard_tables::PAD_DIGITS[usize::from(code - 0x47)]
    } else {
        0xff
    };

    if flags & 1 != 0 || digit == 0xff {
        return None;
    }

    if flags & 2 != 0 {
        system.write_far(target, &[0, 0]);
        return Some(Ok(Answer::Word(0)));
    }

    let last = system.keyboard_byte(PAD_KEY);

    system.set_keyboard_byte(PAD_KEY, code);

    if last == code {
        return Some(Ok(Answer::Word(0)));
    }

    let old = system.read_far(target, 1)[0];
    let value = old.wrapping_mul(10).wrapping_add(digit);

    system.write_far(target, &[value, 0]);

    if value == old {
        system.set_keyboard_byte(ALT_TYPED, 1);
    }

    Some(Ok(Answer::Word(0)))
}

/// The scan code and shift state that type an OEM character (seg4
/// `000c`-`00b6`).
fn oem_key_scan(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let mut character = args.word(system) as u8;
    let mut shifts = 0u8;
    let mut via_scan = false;

    system.keyboard_started();

    if character >= 0x80 {
        let ansi = translate(&OEM_TO_ANSI, character);

        if ansi < 0x80 || translate(&ANSI_TO_OEM, ansi) != character {
            return Ok(Answer::Dword(0xffff_ffff));
        }

        character = ansi;
        via_scan = true;
    } else if character.is_ascii_uppercase() {
        shifts = 2;
    } else if matches!(character, 0x20 | 0x0d | 0x09 | 0x08) {
        // their own keys
    } else if character.is_ascii_lowercase() {
        character -= 0x20;
    } else if character != 0x0a && (0x01..=0x1a).contains(&character) {
        character += 0x40;
        shifts = 4;
    } else {
        via_scan = true;
    }

    if via_scan {
        let found = vk_key_scan_of(character);

        if found == 0xffff || (found >> 8) & 4 != 0 {
            return Ok(Answer::Dword(0xffff_ffff));
        }

        shifts = ((found >> 8) << 1) as u8;
        character = found as u8;
    }

    Ok(Answer::Dword(
        match SCAN_TO_VK[..0x3a].iter().position(|&vk| vk == character) {
            Some(scan) => u32::from(shifts) << 16 | scan as u32,
            None => 0xffff_ffff,
        },
    ))
}

/// A byte's partner in a pair of tables: `to`'s byte where `from` has it
/// first.
fn partner(from: &[u8], to: &[u8], byte: u8) -> Option<u8> {
    from.iter().position(|&each| each == byte).map(|at| to[at])
}

/// A key's name (seg9 `0311`-`040c`).
fn get_key_name_text(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    use crate::keyboard_tables::{
        DEAD_NAME_CHARACTERS, DEAD_NAME_INDEX, DONT_CARE_FROM, DONT_CARE_TO, EXTENDED_NAME_INDEX,
        EXTENDED_NAME_SCANS, KEY_NAMES, PLAIN_NAME_INDEX, PLAIN_NAME_SCANS,
    };

    let l_param = args.dword(system);
    let buffer = args.dword(system);
    let size = args.signed(system);

    system.keyboard_started();

    if size < 1 {
        return Ok(Answer::Word(0));
    }

    let code = (l_param >> 16) as u8;
    let mut flags = (l_param >> 24) as u8;
    let mut index = None;

    if code == 0x56 || code < 0x35 || (code == 0x35 && flags & 1 == 0) {
        let vk = map_virtual_key_of(u16::from(code), 1) as u8;

        if vk != 0 {
            let typed = map_virtual_key_of(u16::from(vk), 2);

            if typed & 0x8000 != 0 {
                flags = (typed >> 8) as u8;
                index = partner(&DEAD_NAME_CHARACTERS, &DEAD_NAME_INDEX, typed as u8);

                if index.is_none() {
                    return Ok(Answer::Word(0));
                }
            } else if typed as u8 > 0x20 {
                system.write_far(buffer, &[typed as u8]);
                system.write_far(
                    buffer & 0xffff_0000 | u32::from((buffer as u16).wrapping_add(1)),
                    &[0],
                );

                return Ok(Answer::Word(1));
            }
        }
    }

    let index = if let Some(index) = index {
        index
    } else {
        let found = if (l_param >> 24) & 1 != 0 {
            partner(&EXTENDED_NAME_SCANS, &EXTENDED_NAME_INDEX, code)
        } else {
            partner(&PLAIN_NAME_SCANS, &PLAIN_NAME_INDEX, code)
        };

        match found {
            Some(index) => index,
            None => return Ok(Answer::Word(0)),
        }
    };
    let index = if flags & 2 != 0 {
        partner(&DONT_CARE_FROM, &DONT_CARE_TO, index).unwrap_or(index)
    } else {
        index
    };
    let name = KEY_NAMES
        .get(usize::from(index))
        .map_or(&b""[..], |name| name.as_bytes());
    let size = size as usize;
    let at = |offset: usize| {
        buffer & 0xffff_0000 | u32::from((buffer as u16).wrapping_add(offset as u16))
    };

    if name.len() < size {
        system.write_far(at(0), name);
        system.write_far(at(name.len()), &[0]);
        return Ok(Answer::Word(name.len() as u16));
    }

    system.write_far(at(0), &name[..size - 1]);
    system.write_far(at(size - 1), &[0]);
    Ok(Answer::Word(size as u16))
}

/// The driver enabled (`KEYBOARD.DRV` seg10 `09d0`-`0a65`). **Recorded** by
/// `kbenable`.
fn enable(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let procedure = args.dword(system);
    let state = args.dword(system);

    system.keyboard_started();
    system.set_keyboard_word(EVENT_PROC, procedure as u16);
    system.set_keyboard_word(EVENT_PROC + 2, (procedure >> 16) as u16);

    let flags = system
        .cpu
        .bus
        .read8(winbox_machine::FIRST_MEGABYTE + SHIFT_FLAGS);

    for (bit, key, on) in [
        (0x03, 0x10, 0x80),
        (0x04, 0x11, 0x80),
        (0x08, 0x12, 0x80),
        (0x10, 0x91, 0x01),
        (0x20, 0x90, 0x01),
        (0x40, 0x14, 0x01),
    ] {
        let at = (state & 0xffff_0000) | (state.wrapping_add(key) & 0xffff);

        system.write_far(at, &[if flags & bit != 0 { on } else { 0 }]);
    }

    if system.keyboard_byte(ENABLED) != 0 {
        return Ok(Answer::Nothing);
    }

    if system.keyboard_byte(TABLE_READ) == 0 {
        system.set_keyboard_byte(TABLE_READ, 1);
        system.new_table();
    }

    if system.keyboard_byte(TYPE) == 4 {
        let at = winbox_machine::FIRST_MEGABYTE + KEYBOARD_FLAGS;
        let kept = system.cpu.bus.read8(at);

        system.cpu.bus.write8(at, kept & 0xef);
        system.set_keyboard_byte(ENHANCED_KEPT, kept);
    }

    system.set_keyboard_byte(ENABLED, 0xff);
    Ok(Answer::Nothing)
}

/// The driver disabled (`KEYBOARD.DRV` seg10 `0aac`-`0afb`). **Recorded** by
/// `kbenable`.
fn disable(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.keyboard_started();

    if system.keyboard_byte(ENABLED) == 0 {
        return Ok(Answer::Nothing);
    }

    if system.keyboard_byte(TYPE) == 4 {
        let kept = system.keyboard_byte(ENHANCED_KEPT);

        system
            .cpu
            .bus
            .write8(winbox_machine::FIRST_MEGABYTE + KEYBOARD_FLAGS, kept);
    }

    let at = winbox_machine::FIRST_MEGABYTE + SHIFT_FLAGS;
    let flags = system.cpu.bus.read16(at);

    system.cpu.bus.write16(at, flags & 0xfcff);
    system.set_keyboard_byte(ENABLED, 0);
    Ok(Answer::Nothing)
}
