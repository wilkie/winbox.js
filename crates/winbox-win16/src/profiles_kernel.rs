//! KERNEL's profile functions over initialisation files: `WIN.INI`, by
//! default in Windows' directory, and a program's own. A file written is
//! held in memory until a flush lets it go, and read from there.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program; and the arguments, read out of the stack,
// are handed on whole.
#![allow(clippy::unnecessary_wraps, clippy::needless_pass_by_value)]

use std::io::SeekFrom;

use crate::call::{Answer, Args, Stop};
use crate::profile::{Profile, js_space};
use crate::system::System;

/// Windows' own profile.
const WINDOWS_PROFILE: &str = "WIN.INI";

/// A string argument as the TypeScript engine reads one: `None` for a null
/// pointer, a number's digits where the segment is nought.
fn lpcstr(system: &System, far: u32) -> Option<Vec<u8>> {
    match (far >> 16, far & 0xffff) {
        (0, 0) => None,
        (0, number) => Some(number.to_string().into_bytes()),
        _ => Some(system.read_string(far)),
    }
}

/// A name as the TypeScript engine's `String` makes it: `null` for none.
fn named(name: Option<&Vec<u8>>) -> Vec<u8> {
    name.cloned().unwrap_or_else(|| b"null".to_vec())
}

/// The key a held file is kept by: its name, upper case.
fn key_of(name: &[u8]) -> Vec<u8> {
    name.rsplit(|&byte| byte == b'\\' || byte == b'/' || byte == b':')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase()
}

/// Where a profile is: its path as given, or a name alone in Windows'
/// directory.
fn path_of(name: &[u8]) -> String {
    let text: String = name.iter().map(|&byte| char::from(byte)).collect();

    if text.contains(['\\', '/', ':']) {
        text
    } else {
        format!("C:\\WINDOWS\\{text}")
    }
}

impl System {
    /// A profile, as held, else as its file has it, else empty.
    pub(crate) fn read_profile(&mut self, name: &[u8]) -> Profile {
        if let Some(profile) = self.profiles.get(&key_of(name)) {
            return profile.clone();
        }

        let Some(handle) = self.files.open(&path_of(name)) else {
            return Profile::new(b"");
        };
        let file = self.files.resolve(handle).expect("an open file");
        let size = file.size() as usize;
        let bytes = file.read(size);

        self.files.close(handle);
        Profile::new(&bytes)
    }

    /// An entry written as `WritePrivateProfileString` writes one, for a
    /// module winbox.js keeps: whether it was written.
    pub(crate) fn write_profile_entry(
        &mut self,
        name: &[u8],
        section: &[u8],
        entry: &[u8],
        value: &[u8],
    ) -> bool {
        let mut profile = self.read_profile(name);

        profile.set(section, entry, Some(value));

        let written = self.write_profile(name, &profile);

        if written {
            self.profiles.insert(key_of(name), profile);
        }

        written
    }

    /// A profile written back whole, the file made where it is not there
    /// (`profnew`), and cut to its length.
    fn write_profile(&mut self, name: &[u8], profile: &Profile) -> bool {
        let path = path_of(name);
        let Some(handle) = self.files.open(&path).or_else(|| self.files.create(&path)) else {
            return false;
        };
        let file = self.files.resolve(handle).expect("an open file");
        let bytes = profile.text();

        file.seek(SeekFrom::Start(0));
        file.write(&bytes);

        if file.size() > bytes.len() as u64 {
            file.truncate(bytes.len() as u64);
        }

        self.files.close(handle);
        true
    }

    /// Text copied out with its nought, as much as fits: how many bytes.
    fn copy_out(&mut self, far: u32, text: &[u8], size: i16) -> i16 {
        if size == 0 {
            return 0;
        }

        let count = (text.len() as i32).min(i32::from(size) - 1);
        let step = |at: i32| (far & 0xffff_0000) | (far.wrapping_add(at as u32) & 0xffff);

        for at in 0..count.max(0) {
            self.write_far(step(at), &[text[at as usize]]);
        }

        self.write_far(step(count), &[0]);
        count as i16
    }

    /// Names copied out, each ended by a nought and the list by another,
    /// two bytes held back; a list cut short still ends in a nought: the
    /// bytes, the closing nought not counted.
    fn copy_out_list(&mut self, far: u32, names: &[Vec<u8>], size: i16) -> i16 {
        if size == 0 {
            return 0;
        }

        let text: Vec<u8> = names
            .iter()
            .flat_map(|name| name.iter().copied().chain([0]))
            .collect();
        let count = (text.len() as i32).min(i32::from(size) - 2);
        let step = |at: i32| (far & 0xffff_0000) | (far.wrapping_add(at as u32) & 0xffff);

        for at in 0..count.max(0) {
            self.write_far(step(at), &[text[at as usize]]);
        }

        if count > 0 {
            self.write_far(step(count - 1), &[0]);
        }

        self.write_far(step(count), &[0]);
        count as i16
    }
}

/// A value's number: leading whitespace, a sign and digits; nought for
/// none; the default where there is no value.
fn to_integer(value: Option<&[u8]>, fallback: u16) -> u16 {
    let Some(value) = value else {
        return fallback;
    };
    let value = &value[value
        .iter()
        .position(|&byte| !js_space(byte))
        .unwrap_or(value.len())..];
    let (negative, digits) = match value.strip_prefix(b"-") {
        Some(rest) => (true, rest),
        None => (false, value),
    };
    let count = digits
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count();

    if count == 0 {
        return 0;
    }

    let magnitude = digits[..count].iter().fold(0u32, |sum, &digit| {
        sum.wrapping_mul(10).wrapping_add(u32::from(digit - b'0'))
    });

    (if negative {
        magnitude.wrapping_neg()
    } else {
        magnitude
    }) as u16
}

fn get_string(
    system: &mut System,
    section: Option<Vec<u8>>,
    entry: Option<Vec<u8>>,
    default: Option<Vec<u8>>,
    buffer: u32,
    size: i16,
    file: &[u8],
) -> Answer {
    let profile = system.read_profile(file);
    let section = named(section.as_ref());

    // No entry named: the section's entries' names.
    let Some(entry) = entry else {
        let names = profile.entries(&section);

        return Answer::Word(system.copy_out_list(buffer, &names, size) as u16);
    };
    let value = profile
        .get(&section, &entry, true)
        .unwrap_or_else(|| default.unwrap_or_default());

    Answer::Word(system.copy_out(buffer, &value, size) as u16)
}

fn get_int(
    system: &mut System,
    section: Option<Vec<u8>>,
    entry: Option<Vec<u8>>,
    default: u16,
    file: &[u8],
) -> Answer {
    let profile = system.read_profile(file);
    // Quotes kept: `"7"` is nought here.
    let value = profile.get(&named(section.as_ref()), &named(entry.as_ref()), false);

    Answer::Word(to_integer(value.as_deref(), default))
}

/// An entry written; a null value removes it, a null entry the section's
/// entries; all three null lets the file held go. The caller's string has
/// its trailing spaces cut, in place, as Windows does.
fn write_string(system: &mut System, section: u32, entry: u32, string: u32, file: &[u8]) -> Answer {
    let section = lpcstr(system, section);
    let entry = lpcstr(system, entry);
    let value = lpcstr(system, string);

    if section.is_none() && entry.is_none() && value.is_none() {
        system.profiles.remove(&key_of(file));
        return Answer::Word(0);
    }

    let value = value.map(|value| {
        let kept = value
            .iter()
            .rposition(|&byte| byte != b' ')
            .map_or(0, |at| at + 1);

        if kept < value.len() && string >> 16 != 0 {
            let at = (string & 0xffff_0000) | (string.wrapping_add(kept as u32) & 0xffff);

            system.write_far(at, &[0]);
        }

        let value = &value[..kept];
        let end = value
            .iter()
            .rposition(|&byte| byte != b' ' && byte != b'\t')
            .map_or(0, |at| at + 1);

        value[..end].to_vec()
    });
    let mut profile = system.read_profile(file);
    let section = named(section.as_ref());

    match entry {
        None => {
            for name in profile.entries(&section) {
                profile.set(&section, &name, None);
            }
        }
        Some(entry) => profile.set(&section, &entry, value.as_deref()),
    }

    let written = system.write_profile(file, &profile);

    if written {
        system.profiles.insert(key_of(file), profile);
    }

    Answer::Word(u16::from(written))
}

/// An entry of `WIN.INI` as a number, as `GetProfileInt` reads it, for
/// USER's own settings.
pub(crate) fn profile_int(system: &mut System, section: &[u8], entry: &[u8], default: u16) -> u16 {
    let answer = get_int(
        system,
        Some(section.to_vec()),
        Some(entry.to_vec()),
        default,
        WINDOWS_PROFILE.as_bytes(),
    );

    answer.value().map_or(default, |value| value as u16)
}

pub fn get_profile_int(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let section = args.dword(system);
    let entry = args.dword(system);
    let default = args.word(system);
    let (section, entry) = (lpcstr(system, section), lpcstr(system, entry));

    Ok(get_int(
        system,
        section,
        entry,
        default,
        WINDOWS_PROFILE.as_bytes(),
    ))
}

pub fn get_private_profile_int(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let section = args.dword(system);
    let entry = args.dword(system);
    let default = args.word(system);
    let file = args.dword(system);
    let (section, entry) = (lpcstr(system, section), lpcstr(system, entry));
    let file = named(lpcstr(system, file).as_ref());

    Ok(get_int(system, section, entry, default, &file))
}

pub fn get_profile_string(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let section = args.dword(system);
    let entry = args.dword(system);
    let default = args.dword(system);
    let buffer = args.dword(system);
    let size = args.signed(system);
    let (section, entry, default) = (
        lpcstr(system, section),
        lpcstr(system, entry),
        lpcstr(system, default),
    );

    Ok(get_string(
        system,
        section,
        entry,
        default,
        buffer,
        size,
        WINDOWS_PROFILE.as_bytes(),
    ))
}

pub fn get_private_profile_string(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let section = args.dword(system);
    let entry = args.dword(system);
    let default = args.dword(system);
    let buffer = args.dword(system);
    let size = args.signed(system);
    let file = args.dword(system);
    let (section, entry, default) = (
        lpcstr(system, section),
        lpcstr(system, entry),
        lpcstr(system, default),
    );
    let file = named(lpcstr(system, file).as_ref());

    Ok(get_string(
        system, section, entry, default, buffer, size, &file,
    ))
}

pub fn write_profile_string(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let section = args.dword(system);
    let entry = args.dword(system);
    let string = args.dword(system);

    Ok(write_string(
        system,
        section,
        entry,
        string,
        WINDOWS_PROFILE.as_bytes(),
    ))
}

pub fn write_private_profile_string(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let section = args.dword(system);
    let entry = args.dword(system);
    let string = args.dword(system);
    let file = args.dword(system);
    let file = named(lpcstr(system, file).as_ref());

    Ok(write_string(system, section, entry, string, &file))
}
