//! `COMMDLG`'s file name parser, and `GetFileTitle`, which answers with it.
//! As `src/win16/commdlg/parse-file.ts`.
//!
//! **Read out of `COMMDLG.DLL`** seg2 `5664`, and **recorded** by `ftitle`.
//! The parser walks a name and answers where its last part starts and where
//! that part's extension starts, or an error and where it was found. It
//! changes the name in place: spaces before it are taken off, by copying
//! the name down; spaces after it end it; a period that ends it is taken
//! off.

use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// The parser's errors (`PARSE_*`): a name of a directory alone, which has
/// no last part, is `DIRECTORY`.
pub const DIRECTORY: i16 = -1;
pub const INVALID_DRIVE: i16 = -2;
pub const INVALID_PERIOD: i16 = -3;
pub const INVALID_CHARACTER: i16 = -5;
pub const INVALID_SEPARATOR: i16 = -6;
pub const INVALID_SPACE: i16 = -7;
pub const EXTENSION_TOO_LONG: i16 = -8;
pub const NAME_TOO_LONG: i16 = -9;
pub const EMPTY: i16 = -10;
pub const WILDCARD_IN_DIRECTORY: i16 = -11;
pub const WILDCARD_IN_NAME: i16 = -12;
pub const INVALID_NETWORK: i16 = -13;

/// `GetFileTitle`'s answer for a title with a wildcard (seg2 `0ce8`).
const TITLE_WILDCARD: i16 = -12;

/// A name parsed, as seg2 `5664` parses one, in `name`: its bytes up to and
/// including its nought, and any after, changed in place as COMMDLG changes
/// them. The answer is AX and DX: where the last part starts, or an error;
/// and where its extension starts -- the end, for none; nought, for a
/// period that ended the name -- or, with an error, where it was found.
#[allow(clippy::too_many_lines)]
pub fn parse_file(name: &mut [u8]) -> (i16, u16) {
    let at = |name: &[u8], i: usize| name.get(i).copied().unwrap_or(0);
    let mut p = 0usize;
    // Folders gone through; -1 in a network path until its server is named.
    let mut folders: i16 = 0;
    let mut network = false;
    let fail = |code: i16, p: usize| (code, p as u16);

    while at(name, p) == b' ' {
        p += 1;
    }

    if at(name, p) == 0 {
        return fail(EMPTY, p);
    }

    // The spaces taken off: the name copied down, its nought with it.
    if p != 0 {
        let end = name[p..]
            .iter()
            .position(|&b| b == 0)
            .map_or(name.len(), |n| p + n + 1);

        name.copy_within(p..end, 0);
        p = 0;
    }

    if at(name, p + 1) == b':' {
        let letter = at(name, p) | 0x20;

        if !letter.is_ascii_lowercase() {
            return fail(INVALID_DRIVE, p);
        }

        p += 2;
    }

    // What comes before the name's parts: a root, a network path's `\\`, a
    // `.` or a `..` (seg2 `56fe`).
    if matches!(at(name, p), b'\\' | b'/') {
        p += 1;

        if at(name, p) == b'.' {
            p += 1;

            match at(name, p) {
                b'\\' | b'/' => p += 1,
                0 => return fail(DIRECTORY, p),
                _ => return fail(INVALID_PERIOD, p),
            }
        } else if at(name, p) == b'\\' && at(name, p - 1) == b'\\' {
            p += 1;
            folders = -1;
            network = true;
        } else if at(name, p) == b'/' {
            return fail(INVALID_SEPARATOR, p);
        }
    } else if at(name, p) == b'.' {
        p += 1;

        if at(name, p) == b'.' {
            p += 1;
        }

        match at(name, p) {
            0 => return fail(DIRECTORY, p),
            b'\\' | b'/' => p += 1,
            _ => return fail(INVALID_PERIOD, p),
        }
    }

    if at(name, p) == 0 {
        return fail(DIRECTORY, p);
    }

    let mut extension_length: i16 = 0;
    let mut name_length: i16 = 0;
    let mut extension: u16 = 0;
    let mut offset: u16 = 0;
    let mut in_extension = false;
    let mut wildcard = false;

    loop {
        let c = at(name, p);

        if c == 0 {
            break;
        }

        match c {
            0x01..=0x1f
            | b'|'
            | b'"'
            | b'+'
            | b','
            | b':'
            | b';'
            | b'<'
            | b'='
            | b'>'
            | b'['
            | b']' => {
                return fail(INVALID_CHARACTER, p);
            }
            b'\\' | b'/' => {
                folders += 1;

                if wildcard {
                    return fail(WILDCARD_IN_DIRECTORY, p);
                }

                if name_length == 0 {
                    return fail(INVALID_SEPARATOR, p);
                }

                p += 1;

                if folders == 0 && at(name, p) == 0 {
                    return fail(INVALID_NETWORK, p);
                }

                extension_length = 0;
                name_length = 0;
                in_extension = false;
                continue;
            }
            b' ' => {
                // Spaces to the end end the name there; any other after them
                // is an error (seg2 `586d`).
                let mut q = p + 1;

                while at(name, q) == b' ' {
                    q += 1;
                }

                if at(name, q) == 0 {
                    name[p] = 0;
                    continue;
                }

                return fail(INVALID_SPACE, p);
            }
            b'.' => {
                if name_length == 0 {
                    p += 1;

                    if at(name, p) == b'.' {
                        p += 1;
                    }

                    match at(name, p) {
                        0 => return fail(DIRECTORY, p),
                        b'\\' | b'/' => {
                            p += 1;
                            continue;
                        }
                        _ => return fail(INVALID_PERIOD, p),
                    }
                }

                if in_extension {
                    return fail(INVALID_PERIOD, p);
                }

                extension = 0;
                p += 1;
                in_extension = true;
                continue;
            }
            b'*' | b'?' => {
                if network {
                    return fail(INVALID_NETWORK, p);
                }

                wildcard = true;
            }
            _ => {}
        }

        // A character of the part: counted, and where the part and its
        // extension start kept (seg2 `58fe`).
        if in_extension {
            extension_length += 1;

            if extension_length == 1 {
                extension = p as u16;
            } else if extension_length > 3 {
                return fail(EXTENSION_TOO_LONG, p);
            }

            if folders == -1 && extension_length + name_length > 11 {
                return fail(INVALID_NETWORK, p);
            }
        } else {
            name_length += 1;

            if name_length == 1 {
                offset = p as u16;
            } else if name_length > 8 {
                if folders != -1 {
                    return fail(NAME_TOO_LONG, p);
                }

                if name_length > 11 {
                    return fail(INVALID_NETWORK, p);
                }
            }
        }

        p += 1;
    }

    if folders == -1 {
        return fail(INVALID_NETWORK, p);
    }

    if name_length == 0 {
        return fail(DIRECTORY, p);
    }

    // A period that ends it taken off (seg2 `5990`).
    if p > 0 && at(name, p - 1) == b'.' {
        name[p - 1] = 0;
        return (offset as i16, extension);
    }

    if extension_length == 0 {
        extension = p as u16;
    }

    (offset as i16, extension)
}

/// A file's title: its last part, without its folders (`COMMDLG.DLL` seg2
/// `0c79`). Nought, the title copied; the size a buffer must have, where
/// `size` is less; a parser's error; or -12 for a title with a wildcard.
/// The name is changed as the parser changes it. **Recorded** by `ftitle`.
#[allow(clippy::unnecessary_wraps)]
pub(crate) fn get_file_title(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let file = args.dword(system);
    let title = args.dword(system);
    let size = args.signed(system);
    let mut name = system.read_string(file);

    name.push(0);

    let length = name.len();
    let (offset, _) = parse_file(&mut name);

    system.write_far(file, &name[..length]);

    if offset < 0 {
        return Ok(Answer::Word(offset as u16));
    }

    let part: Vec<u8> = name[offset as usize..]
        .iter()
        .take_while(|&&b| b != 0)
        .copied()
        .collect();
    let needed = part.len() as i16 + 1;

    if needed > size {
        return Ok(Answer::Word(needed as u16));
    }

    if part.iter().any(|&b| b == b'*' || b == b'?') {
        return Ok(Answer::Word(TITLE_WILDCARD as u16));
    }

    let mut copy = part;

    copy.push(0);
    system.write_far(title, &copy);
    Ok(Answer::Word(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(text: &str) -> (i16, u16, String) {
        let mut name: Vec<u8> = text.bytes().chain([0]).collect();
        let (ax, dx) = parse_file(&mut name);
        let end = name.iter().position(|&b| b == 0).unwrap_or(name.len());

        (ax, dx, String::from_utf8_lossy(&name[..end]).into_owned())
    }

    /// As `ftitle` recorded them.
    #[test]
    fn names_parse_as_recorded() {
        assert_eq!(
            parsed("C:\\DIR\\FILE.TXT"),
            (7, 12, "C:\\DIR\\FILE.TXT".into())
        );
        assert_eq!(parsed("FILE.").0, 0);
        assert_eq!(parsed("FILE.").2, "FILE");
        assert_eq!(parsed(".TXT").0, INVALID_PERIOD);
        assert_eq!(parsed("  LEAD.TXT").2, "LEAD.TXT");
        assert_eq!(parsed("TRAIL.TXT  ").2, "TRAIL.TXT");
        assert_eq!(parsed("IN SIDE.TXT").0, INVALID_SPACE);
        assert_eq!(parsed("   ").0, EMPTY);
        assert_eq!(parsed("C:\\").0, DIRECTORY);
        assert_eq!(parsed("C:").0, DIRECTORY);
        assert_eq!(parsed("1:\\FILE").0, INVALID_DRIVE);
        assert_eq!(parsed("C:\\D*R\\FILE.TXT").0, WILDCARD_IN_DIRECTORY);
        assert_eq!(parsed("LONGFILENAME.TXT").0, NAME_TOO_LONG);
        assert_eq!(parsed("FILE.TEXT").0, EXTENSION_TOO_LONG);
        assert_eq!(parsed("FILE.T.X").0, INVALID_PERIOD);
        assert_eq!(parsed("A;B").0, INVALID_CHARACTER);
        assert_eq!(parsed("C:\\..\\FILE").0, INVALID_PERIOD);
        assert_eq!(parsed("..\\FILE.TXT").0, 3);
        assert_eq!(parsed("..").0, DIRECTORY);
        assert_eq!(parsed("\\.\\FILE").0, 3);
        assert_eq!(parsed("\\..\\FILE").0, INVALID_PERIOD);
        assert_eq!(parsed("C:\\DIR\\\\FILE").0, INVALID_SEPARATOR);
        assert_eq!(parsed("\\\\SERVER\\SHARE").0, 9);
        assert_eq!(parsed("\\\\SERVER\\").0, INVALID_NETWORK);
        assert_eq!(parsed("\\\\SERVERNAMEXX\\SHARE\\F").0, INVALID_NETWORK);
        assert_eq!(parsed("A\tB").0, INVALID_CHARACTER);
        assert_eq!(parsed("*.*").0, 0);
        assert_eq!(parsed("FILE").1, 4);
    }
}
