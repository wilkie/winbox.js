//! The `.FOT` file the installer writes beside a TrueType face.
//!
//! `CreateScalableFontResource` makes one for every TrueType file Windows 3.1
//! installs: a stub NE executable whose resources are a `FONTDIR` entry -- the
//! same `FONTINFO` header a bitmap strike carries, filled in for the outline --
//! and the path of the `.TTF` it stands for. GDI enumerates the face from this
//! file, and what a program is told about the face's pitch and family is what
//! the installer wrote here, not what the `.TTF` says at run time.
//!
//! **Recorded**: Symbol's entry carries `0x17`, `FF_ROMAN`, and Wingdings'
//! `0x07`, `FF_DONTCARE`, which is what `GetTextMetrics` reports for each;
//! and swapping the `OS/2` class and the PANOSE between the two faces in the
//! `.TTF` -- four fabricated recordings of the `styles` probe -- changes nothing
//! Windows reports, which is what reading the answer from somewhere else looks
//! like. How the installer arrived at `0x07` is not known.

/// What a `.FOT` stub says about the face it stands for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FontResource {
    /// The `.TTF` file the resource stands for, by its name alone, upper case.
    pub file: String,
    /// `dfPitchAndFamily` from the `FONTINFO` header.
    pub pitch_and_family: u8,
    /// `dfCharSet` from the same header.
    pub char_set: u8,
    /// What GDI's TrueType directory keeps of the entry (`GDI.EXE` seg2
    /// `0f2c`): `dfType`'s high byte, the style flags `EnumFontFamilies` hands
    /// out as `ntmFlags`; `dfPoints`, the em in font units; `dfPixHeight` and
    /// `dfAvgWidth`, the cell's height and the average width in those units;
    /// `dfWeight` and `dfItalic`.
    pub flags: u8,
    pub size_em: u16,
    /// `dfAscent`, `dfExternalLeading` and `dfMaxWidth`, in font units.
    pub ascent: u16,
    pub external_leading: u16,
    pub max_width: u16,
    pub cell_height: u16,
    pub avg_width: u16,
    pub weight: u16,
    pub italic: u8,
    /// The family, full and style names the stub carries past its entry.
    pub family: String,
    pub full_name: String,
    pub style: String,
}

const RT_FONTDIR: u16 = 0x8007;

/// The other resource a stub has that is not a path.
const RT_FONT: u16 = 0x8008;

/// The stub's bytes, read where they are there. Where the TypeScript
/// engine's `DataView` throws on a read past the end, this answers nothing
/// and the file is not one.
struct Bytes<'a>(&'a [u8]);

impl Bytes<'_> {
    fn byte(&self, at: usize) -> Option<u8> {
        self.0.get(at).copied()
    }

    fn word(&self, at: usize) -> Option<u16> {
        Some(u16::from_le_bytes([self.byte(at)?, self.byte(at + 1)?]))
    }

    fn dword(&self, at: usize) -> Option<u32> {
        Some(u32::from(self.word(at)?) | u32::from(self.word(at + 2)?) << 16)
    }
}

/// Bytes as the characters they are, one each.
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

/// A path's file name: what follows the last `\` or `/` on its first line.
///
/// The TypeScript engine strips `^.*[\\/]`, and `.` does not match a line
/// break: only the first line's separators count, and everything up to the
/// last of them goes, whatever follows the break.
fn file_name(path: &str) -> &str {
    let line = path.find(['\n', '\r']).unwrap_or(path.len());

    match path[..line].rfind(['\\', '/']) {
        Some(at) => &path[at + 1..],
        None => path,
    }
}

/// Reads the resource, or nothing if the file is not one.
pub fn read_font_resource(bytes: &[u8]) -> Option<FontResource> {
    let view = Bytes(bytes);

    if bytes.len() < 0x40 || view.word(0)? != 0x5a4d {
        return None;
    }

    let ne = view.dword(0x3c)? as usize;

    if ne + 0x40 > bytes.len() || view.word(ne)? != 0x454e {
        return None;
    }

    let table = ne + usize::from(view.word(ne + 0x24)?);
    let shift = view.word(table)?;

    let mut at = table + 2;
    let mut fontdir: Option<usize> = None;
    let mut path: Option<String> = None;

    // Type entries until a type of nought; each carries `count` name entries.
    while at + 8 <= bytes.len() {
        let kind = view.word(at)?;

        if kind == 0 {
            break;
        }

        let count = view.word(at + 2)?;
        at += 8;

        for _ in 0..count {
            // The shift count taken modulo 32, as JavaScript's `<<` takes it.
            // Its result is unsigned here where JavaScript's is a signed 32
            // bit number: a shift that carries a bit into the sign makes the
            // TypeScript engine's offset negative and its reads past it throw,
            // and here the entry lies past the file's end and is passed over.
            let offset = (u32::from(view.word(at)?) << (shift & 31)) as usize;
            let length = (u32::from(view.word(at + 2)?) << (shift & 31)) as usize;

            if offset + length <= bytes.len() {
                if kind == RT_FONTDIR {
                    fontdir = Some(offset);
                } else if kind != RT_FONT {
                    // The other resource is the path of the `.TTF`, a string.
                    // Anything else that is a plain string is read the same
                    // way and only the one ending in `.TTF` is kept.
                    let text: Vec<u8> = bytes[offset..offset + length]
                        .iter()
                        .copied()
                        .take_while(|&byte| byte != 0)
                        .collect();

                    if text.len() >= 4 && text[text.len() - 4..].eq_ignore_ascii_case(b".TTF") {
                        path = Some(latin1(&text));
                    }
                }
            }

            at += 12;
        }
    }

    let (fontdir, path) = (fontdir?, path?);

    // Count, ordinal, then the `FONTINFO` header; the two bytes wanted are at
    // 85 and 90.
    let info = fontdir + 4;

    if info + 113 > bytes.len() {
        return None;
    }

    // Past the 113 bytes of the entry: the device's name, then the family,
    // full and style names, each ended with a nought.
    let mut strings: Vec<String> = Vec::new();
    let mut text = Vec::new();

    for &byte in &bytes[info + 113..] {
        if strings.len() >= 4 {
            break;
        }

        if byte == 0 {
            strings.push(latin1(&text));
            text.clear();
        } else {
            text.push(byte);
        }
    }

    let string = |index: usize| strings.get(index).cloned().unwrap_or_default();

    Some(FontResource {
        file: file_name(&path).to_uppercase(),
        pitch_and_family: view.byte(info + 90)?,
        char_set: view.byte(info + 85)?,
        flags: view.byte(info + 67)?,
        size_em: view.word(info + 68)?,
        ascent: view.word(info + 74)?,
        external_leading: view.word(info + 78)?,
        max_width: view.word(info + 93)?,
        cell_height: view.word(info + 88)?,
        avg_width: view.word(info + 91)?,
        weight: view.word(info + 83)?,
        italic: view.byte(info + 80)?,
        family: string(1),
        full_name: string(2),
        style: string(3),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stub with a `FONTDIR` entry and a path, laid out as the installer
    /// lays one out.
    fn stub(path: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0u8; 0x400];

        bytes[0..2].copy_from_slice(b"MZ");
        bytes[0x3c] = 0x40;
        bytes[0x40..0x42].copy_from_slice(b"NE");
        // The resource table, at 0x40 + 0x40.
        bytes[0x40 + 0x24] = 0x40;

        let table = 0x80;

        bytes[table] = 0; // shift
        // FONTDIR: one entry at 0x100, 0x100 long.
        bytes[table + 2..table + 4].copy_from_slice(&0x8007u16.to_le_bytes());
        bytes[table + 4] = 1;
        bytes[table + 10..table + 12].copy_from_slice(&0x100u16.to_le_bytes());
        bytes[table + 12..table + 14].copy_from_slice(&0x100u16.to_le_bytes());
        // A string resource: one entry at 0x300.
        bytes[table + 22..table + 24].copy_from_slice(&0x80ccu16.to_le_bytes());
        bytes[table + 24] = 1;
        bytes[table + 30..table + 32].copy_from_slice(&0x300u16.to_le_bytes());
        bytes[table + 32..table + 34].copy_from_slice(&0x40u16.to_le_bytes());
        bytes[0x300..0x300 + path.len()].copy_from_slice(path);

        let info = 0x104;

        bytes[info + 85] = 2;
        bytes[info + 90] = 0x17;
        bytes[info + 67] = 0x20;
        bytes[info + 68..info + 70].copy_from_slice(&2048u16.to_le_bytes());
        bytes[info + 83..info + 85].copy_from_slice(&400u16.to_le_bytes());

        let names = b"\0Symbol\0Symbol\0Regular\0";

        bytes[info + 113..info + 113 + names.len()].copy_from_slice(names);
        bytes
    }

    #[test]
    fn reads_what_the_stub_says() {
        let resource = read_font_resource(&stub(b"C:\\WINDOWS\\SYSTEM\\symbol.ttf")).unwrap();

        assert_eq!(resource.file, "SYMBOL.TTF");
        assert_eq!(resource.pitch_and_family, 0x17);
        assert_eq!(resource.char_set, 2);
        assert_eq!(resource.flags, 0x20);
        assert_eq!(resource.size_em, 2048);
        assert_eq!(resource.weight, 400);
        assert_eq!(resource.family, "Symbol");
        assert_eq!(resource.full_name, "Symbol");
        assert_eq!(resource.style, "Regular");
    }

    #[test]
    fn names_the_file_by_the_first_lines_last_separator() {
        assert_eq!(file_name("C:\\WINDOWS\\SYSTEM\\symbol.ttf"), "symbol.ttf");
        assert_eq!(file_name("fonts/arial.ttf"), "arial.ttf");
        assert_eq!(file_name("arial.ttf"), "arial.ttf");
        assert_eq!(file_name("A\\B\nC\\D.TTF"), "B\nC\\D.TTF");
        assert_eq!(file_name("AB\r\\D.TTF"), "AB\r\\D.TTF");

        let resource = read_font_resource(&stub(b"A\\B\nC\\d.ttf")).unwrap();

        assert_eq!(resource.file, "B\nC\\D.TTF");
    }

    #[test]
    fn refuses_a_stub_with_no_path_to_an_outline() {
        assert_eq!(read_font_resource(&stub(b"SYMBOL.FON")), None);
        assert_eq!(read_font_resource(b"not an executable"), None);
    }
}
