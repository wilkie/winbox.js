//! `CreateScalableFontResource`: the `.FOT` stub `AddFontResource` installs
//! for a TrueType file.
//!
//! The stub is a library of header and resources and nothing else, whose
//! one font directory entry describes the face in its own design units and
//! whose other resource is the path to the `.TTF`. `FONTS.md` 8c decodes it
//! field by field from `fotmake`'s five recordings, which this reproduces
//! byte for byte.
//!
//! Every number in the entry comes out of the `.TTF` except what is copied
//! as recorded: `dfType`'s `0x4083`, the font ordinal of nought, a `0xc3`
//! byte at `0x200` in the padding, and four bytes after the copyright
//! string's terminator. `dfReserved` is `head.lowestRecPPEM` in its low word
//! and `OS/2`'s first character's high byte in its high word.
//!
//! Only regular faces were recorded. The face string is the `name` table's
//! full name, which for those is the family's.

use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// A `.TTF`'s bytes, read big-end first; a read past the end is nought, the
/// TypeScript engine's `DataView` throwing there for a file that is no font.
struct Big<'a>(&'a [u8]);

impl Big<'_> {
    fn u8(&self, at: usize) -> u8 {
        self.0.get(at).copied().unwrap_or(0)
    }

    fn u16(&self, at: usize) -> u16 {
        u16::from_be_bytes([self.u8(at), self.u8(at + 1)])
    }

    fn i16(&self, at: usize) -> i16 {
        self.u16(at) as i16
    }

    fn u32(&self, at: usize) -> u32 {
        u32::from(self.u16(at)) << 16 | u32::from(self.u16(at + 2))
    }
}

/// The stub's bytes for a TrueType file, named by the path it is given.
#[allow(clippy::too_many_lines)]
pub fn scalable_font_resource(ttf: &[u8], font_path: &str) -> Vec<u8> {
    let view = Big(ttf);
    let mut tables = std::collections::HashMap::new();

    for index in 0..usize::from(view.u16(4)) {
        let at = 12 + 16 * index;
        let tag: String = (0..4).map(|byte| char::from(view.u8(at + byte))).collect();

        tables.insert(tag, view.u32(at + 8) as usize);
    }

    let table = |tag: &str| tables.get(tag).copied().unwrap_or(0);
    let head = table("head");
    let hhea = table("hhea");
    let os2 = table("OS/2");

    let units_per_em = view.u16(head + 18);
    let x_min = view.i16(head + 36);
    let x_max = view.i16(head + 40);
    let lowest_rec_ppem = view.u16(head + 46);
    let ascender = view.i16(hhea + 4);
    let descender = view.i16(hhea + 6);
    let line_gap = view.i16(hhea + 8);
    let average_width = view.i16(os2 + 2);
    let weight = view.u16(os2 + 4);
    let panose: Vec<u8> = (0..10).map(|at| view.u8(os2 + 32 + at)).collect();
    let first_char = view.u16(os2 + 64);

    // The `name` table's strings, from the Microsoft platform's English
    // entry: big-endian UTF-16, a code unit a character.
    let name_of = |id: u16| -> Vec<u16> {
        let table = table("name");
        let count = usize::from(view.u16(table + 2));
        let strings = table + usize::from(view.u16(table + 4));

        for index in 0..count {
            let record = table + 6 + 12 * index;
            let platform = view.u16(record);
            let language = view.u16(record + 4);

            if view.u16(record + 6) != id || platform != 3 || language & 0xff != 0x09 {
                continue;
            }

            let length = usize::from(view.u16(record + 8));
            let offset = strings + usize::from(view.u16(record + 10));

            return (0..length)
                .step_by(2)
                .map(|at| view.u16(offset + at))
                .collect();
        }

        Vec::new()
    };

    let face = name_of(4);
    let family = name_of(1);
    let style = name_of(2);

    // The family from PANOSE, in the order the cases take precedence; see
    // `FONTS.md` 8c.
    let monospaced = panose[3] == 9;
    let family_bits = if panose[0] == 3 {
        0x40
    } else if panose[0] == 4 {
        0x50
    } else if monospaced {
        0x30
    } else if panose[1] >= 11 {
        0x20
    } else if panose[1] >= 2 {
        0x10
    } else {
        0x00
    };
    let pitch_and_family = family_bits | if monospaced { 0x06 } else { 0x07 };
    let char_set = if panose[0] == 5 { 2 } else { 0 };

    let file = font_path
        .rsplit(['\\', '/', ':'])
        .next()
        .unwrap_or(font_path)
        .to_string();
    let base = match file.rfind('.') {
        Some(at) => file[..at].to_uppercase(),
        None => file.to_uppercase(),
    };
    let file_name = file.to_uppercase();
    let mut non_resident: Vec<u16> = "FONTRES:".encode_utf16().collect();

    non_resident.extend_from_slice(&face);

    let length = 0x480 + 4 + 113 + 1 + face.len() + family.len() + style.len() + 3 + 16;
    let mut bytes = vec![0u8; length];

    let put_units = |bytes: &mut Vec<u8>, at: usize, text: &[u16]| {
        for (index, unit) in text.iter().enumerate() {
            if let Some(byte) = bytes.get_mut(at + index) {
                *byte = (*unit & 0xff) as u8;
            }
        }
    };
    let put = |bytes: &mut Vec<u8>, at: usize, text: &str| {
        for (index, character) in text.chars().enumerate() {
            if let Some(byte) = bytes.get_mut(at + index) {
                *byte = (u32::from(character) & 0xff) as u8;
            }
        }
    };
    let word = |bytes: &mut Vec<u8>, at: usize, value: u16| {
        bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
    };
    let dword = |bytes: &mut Vec<u8>, at: usize, value: u32| {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    };

    // The DOS stub, as recorded, message and signature included.
    let stub = [
        "4d5a0100020000000400",
        "0f00ffff0000b8000000",
        "00000000400000000000",
        &"0000".repeat(15),
        "800000000e1fba0e00b409cd21b8014ccd21",
    ]
    .concat();
    let stub: Vec<u8> = (0..stub.len() / 2)
        .map(|at| u8::from_str_radix(&stub[at * 2..at * 2 + 2], 16).unwrap_or(0))
        .collect();

    bytes[..stub.len()].copy_from_slice(&stub);
    put(
        &mut bytes,
        0x4e,
        "This is a TrueType font, not a program.\r\r\n$",
    );
    put(&mut bytes, 0x7a, "Kiesa");

    // The NE header. Everything after the resource table chains from the
    // lengths of the three names.
    let ne = 0x80;
    let resident_length = base.len() + 6;
    let module_references = 0x74 + resident_length;
    let imported = file_name.len() + 1;
    let entry = module_references + imported + 1;
    let non_resident_at = ne + entry + 4;

    put(&mut bytes, ne, "NE");
    bytes[ne + 2] = 5;
    bytes[ne + 3] = 0x10;
    word(&mut bytes, ne + 0x04, entry as u16);
    word(&mut bytes, ne + 0x06, 2);
    word(&mut bytes, ne + 0x0c, 0x8000);
    word(&mut bytes, ne + 0x20, (non_resident.len() + 4) as u16);
    word(&mut bytes, ne + 0x22, 0x40);
    word(&mut bytes, ne + 0x24, 0x40);
    word(&mut bytes, ne + 0x26, 0x74);
    word(&mut bytes, ne + 0x28, module_references as u16);
    word(&mut bytes, ne + 0x2a, module_references as u16);
    dword(&mut bytes, ne + 0x2c, non_resident_at as u32);
    word(&mut bytes, ne + 0x32, 4);
    word(&mut bytes, ne + 0x34, 2);
    bytes[ne + 0x36] = 2;
    word(&mut bytes, ne + 0x3e, 0x0300);

    // The resource table: alignment shift 4, the font directory and the path.
    let font_directory_length = 4 + 113 + 1 + face.len() + family.len() + style.len() + 3;
    let resources: [u16; 22] = [
        0x0004,
        0x8007,
        1,
        0,
        0,
        0x48,
        ((font_directory_length + 15) >> 4) as u16,
        0x0c50,
        0x002c,
        0,
        0,
        0x80cc,
        1,
        0,
        0,
        0x40,
        0x08,
        0x0c50,
        0x8001,
        0,
        0,
        0,
    ];

    for (index, value) in resources.iter().enumerate() {
        word(&mut bytes, ne + 0x40 + 2 * index, *value);
    }

    bytes[ne + 0x6c] = 7;
    put(&mut bytes, ne + 0x6d, "FONTDIR");

    bytes[ne + 0x74] = base.len() as u8;
    put(&mut bytes, ne + 0x75, &base);
    bytes[ne + module_references] = imported as u8;
    put(&mut bytes, ne + module_references + 1, &file_name);
    bytes[non_resident_at] = (non_resident.len() + 4) as u8;
    put_units(&mut bytes, non_resident_at + 1, &non_resident);

    // Something in the padding, the same in every recording.
    bytes[0x200] = 0xc3;

    // Resource 204: the path, NUL-padded to 128.
    put(&mut bytes, 0x400, font_path);

    // The font directory: a count, an ordinal of nought, and the entry.
    let d = 0x480;

    word(&mut bytes, d, 1);
    word(&mut bytes, d + 2, 0);

    let e = d + 4;

    word(&mut bytes, e, 0x0200);
    dword(&mut bytes, e + 2, 149);
    put(&mut bytes, e + 6, "Windows! Windows! Windows!");
    // And four bytes after the string's terminator, the same in every
    // recording: left over in the buffer the copyright was built in.
    bytes[e + 33..e + 37].copy_from_slice(&[0x10, 0x03, 0x01, 0x01]);
    word(&mut bytes, e + 66, 0x4083);
    word(&mut bytes, e + 68, units_per_em);
    word(&mut bytes, e + 70, 72);
    word(&mut bytes, e + 72, 72);
    word(&mut bytes, e + 74, ascender as u16);
    word(
        &mut bytes,
        e + 76,
        (i32::from(ascender) - i32::from(descender) - i32::from(units_per_em)) as u16,
    );
    word(&mut bytes, e + 78, line_gap as u16);
    word(&mut bytes, e + 83, weight);
    bytes[e + 85] = char_set;
    word(
        &mut bytes,
        e + 88,
        (i32::from(ascender) - i32::from(descender)) as u16,
    );
    bytes[e + 90] = pitch_and_family;
    word(&mut bytes, e + 91, average_width as u16);
    word(
        &mut bytes,
        e + 93,
        (i32::from(x_max) - i32::from(x_min)) as u16,
    );
    bytes[e + 95] = 30;
    bytes[e + 96] = 255;
    bytes[e + 97] = 1;
    bytes[e + 98] = 2;
    dword(&mut bytes, e + 105, 118);
    dword(
        &mut bytes,
        e + 109,
        (u32::from(first_char & 0xff00) << 16) | u32::from(lowest_rec_ppem),
    );
    put_units(&mut bytes, e + 114, &face);
    put_units(&mut bytes, e + 115 + face.len(), &family);
    put_units(&mut bytes, e + 116 + face.len() + family.len(), &style);

    bytes
}

/// A string argument, or nothing for a null pointer or an empty string.
fn string_argument(system: &System, far: u32) -> Option<String> {
    if far == 0 {
        return None;
    }

    let text: String = system
        .read_string(far)
        .iter()
        .map(|&byte| char::from(byte))
        .collect();

    (!text.is_empty()).then_some(text)
}

/// Writes the stub for a `.TTF`, which is looked for as `OpenFile` looks
/// for a file -- under the current path where one is given -- and made
/// where the program says. Nonzero if the file was written. Only a hidden
/// font, `fHidden` 1, has been recorded, and it is not read.
pub(crate) fn create_scalable_font_resource_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    args.word(system);

    let resource_far = args.dword(system);
    let font_far = args.dword(system);
    let current_far = args.dword(system);

    let (Some(resource_file), Some(font_file)) = (
        string_argument(system, resource_far),
        string_argument(system, font_far),
    ) else {
        return Ok(Answer::Word(0));
    };

    let font_path = match string_argument(system, current_far) {
        Some(current) => format!("{current}\\{font_file}"),
        None => font_file.clone(),
    };

    let Some(source) = system.files.open(&font_path) else {
        return Ok(Answer::Word(0));
    };
    let ttf = match system.files.resolve(source) {
        Some(file) => {
            let size = file.size() as usize;

            file.read(size)
        }
        None => return Ok(Answer::Word(0)),
    };

    system.files.close(source);

    let Some(target) = system.files.create(&resource_file) else {
        return Ok(Answer::Word(0));
    };

    // A handle that stands for no file answers nought, and is left open, as
    // the TypeScript engine leaves it.
    let Some(file) = system.files.resolve(target) else {
        return Ok(Answer::Word(0));
    };

    file.write(&scalable_font_resource(&ttf, &font_file));
    system.files.close(target);
    Ok(Answer::Word(1))
}
