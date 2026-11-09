//! KERNEL's profile functions over initialisation files: `WIN.INI`, by
//! default in Windows' directory, and a program's own. A file read or
//! written is held in memory, and read from there, until KERNEL lets it go
//! (`Profiles`).

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

/// A string argument: `None` for a null pointer, a number's digits where the
/// segment is nought.
fn lpcstr(system: &System, far: u32) -> Option<Vec<u8>> {
    match (far >> 16, far & 0xffff) {
        (0, 0) => None,
        (0, number) => Some(number.to_string().into_bytes()),
        _ => Some(system.read_string(far)),
    }
}

/// A name as text: `null` for none.
fn named(name: Option<&Vec<u8>>) -> Vec<u8> {
    name.cloned().unwrap_or_else(|| b"null".to_vec())
}

/// A file as KERNEL holds it: its whole path, upper case, its contents,
/// and the stamp DOS gave the file as KERNEL last opened it.
#[derive(Debug, Clone)]
pub struct Held {
    path: String,
    profile: Profile,
    stamp: Option<(u16, u16)>,
    /// The DOS calls there had been as it was last written: while there
    /// have been no more, it is still to go to the disk, and the stamp it
    /// keeps is the one from before the first of those writes.
    written: Option<u64>,
}

/// What KERNEL holds of the profiles: one buffer for `WIN.INI` and one for
/// a private file (`KRNL386.EXE` seg1 `636b`: `WIN.INI` is `ds:03e4`, any
/// other `ds:047e`). **Read out**, and **recorded** by `profhold`:
///
/// - A file read or written stays held. Another private file's name lets
///   the private one go (`63e7`-`6438`, `6b33`), its path compared whole,
///   a name without one in Windows' directory; `WIN.INI` does not.
/// - Every DOS call sets a flag (`1b68`). A profile call that finds the
///   flag set and its file held looks at the file's date and time (DOS
///   function 4Eh, `630f`-`635b`), and lets the buffer go where they are
///   not what KERNEL opened the file with (`6b33`); then clears the flag.
/// - A buffer written goes to the disk at the next DOS call (`1b6d`-`1b8c`,
///   `WriteOutProfiles` `708b`), the file opened again first (`70a7`):
///   what KERNEL keeps is the stamp from before the write. So a write is
///   seen as a change once two of DOS's seconds have passed, and a
///   value's leading spaces, which loading the file trims, last until then.
///   Here the file is written at once, and the DOS calls that writes make
///   are not counted: writes with no DOS call between are one write-out,
///   and keep the stamp from before the first.
#[derive(Debug, Clone, Default)]
pub struct Profiles {
    windows: Option<Held>,
    private: Option<Held>,
    /// The DOS calls there had been as the flag was last cleared.
    seen: u64,
}

/// Whether a name is `WIN.INI`'s, which KERNEL holds apart.
fn is_windows(name: &[u8]) -> bool {
    name.eq_ignore_ascii_case(WINDOWS_PROFILE.as_bytes())
        || path_of(name).eq_ignore_ascii_case("C:\\WINDOWS\\WIN.INI")
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
    /// The stamp DOS gives a file now: its time and date, as its entry has
    /// them.
    fn stamp_of(&self, path: &str) -> Option<(u16, u16)> {
        let parsed = winbox_machine::Files::parse(path);
        let (name, folders) = parsed.parts.split_last()?;
        let entry = self.files.lookup(parsed.drive?, folders, name)?;

        Some(crate::dos::dos_stamp(entry.modified))
    }

    fn profile_slot(&mut self, windows: bool) -> &mut Option<Held> {
        if windows {
            &mut self.profiles.windows
        } else {
            &mut self.profiles.private
        }
    }

    /// The buffer a file's profile call works on, where KERNEL still
    /// holds one (`Profiles`).
    fn held_profile(&mut self, name: &[u8]) -> Option<&Held> {
        let path = path_of(name).to_ascii_uppercase();
        let windows = is_windows(name);

        if !windows
            && self
                .profiles
                .private
                .as_ref()
                .is_some_and(|held| held.path != path)
        {
            self.profiles.private = None;
        }

        let looked = self
            .profile_slot(windows)
            .as_ref()
            .map(|held| (held.path.clone(), held.stamp));

        if let Some((path, stamp)) = looked
            && self.files.activity() != self.profiles.seen
        {
            if self.stamp_of(&path) != stamp {
                *self.profile_slot(windows) = None;
            }

            self.profiles.seen = self.files.activity();
        }

        self.profile_slot(windows).as_ref()
    }

    /// A file's buffer kept as KERNEL keeps it, with the stamp it was
    /// opened with.
    pub(crate) fn hold_profile(
        &mut self,
        name: &[u8],
        profile: Profile,
        stamp: Option<(u16, u16)>,
    ) {
        let path = path_of(name).to_ascii_uppercase();

        *self.profile_slot(is_windows(name)) = Some(Held {
            path,
            profile,
            stamp,
            written: None,
        });
    }

    /// The buffer KERNEL holds for a file changed where it is, as a read
    /// changes it, with nothing written.
    fn update_held_profile(&mut self, name: &[u8], profile: Profile) {
        let path = path_of(name).to_ascii_uppercase();

        if let Some(held) = self.profile_slot(is_windows(name))
            && held.path == path
        {
            held.profile = profile;
        }
    }

    /// The buffer a file has let go, as a flush does: the next read is of
    /// the disk.
    fn release_profile(&mut self, name: &[u8]) {
        let _ = self.held_profile(name);
        *self.profile_slot(is_windows(name)) = None;
    }

    /// A profile, as held, else as its file has it, held from then on,
    /// else empty.
    pub(crate) fn read_profile(&mut self, name: &[u8]) -> Profile {
        if let Some(held) = self.held_profile(name) {
            return held.profile.clone();
        }

        let path = path_of(name);
        let Some(handle) = self.files.open(&path) else {
            return Profile::new(b"");
        };
        let file = self.files.resolve(handle).expect("an open file");
        let size = file.size() as usize;
        let bytes = file.read(size);

        self.files.close(handle);

        let profile = Profile::new(&bytes);
        let stamp = self.stamp_of(&path);

        self.hold_profile(name, profile.clone(), stamp);
        profile
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

        self.write_profile(name, &profile)
    }

    /// A profile written back whole, the file made where it is not there
    /// (`profnew`), and cut to its length; and held as written, with the
    /// stamp the file had before (`Profiles`), or a file made its own.
    pub(crate) fn write_profile(&mut self, name: &[u8], profile: &Profile) -> bool {
        let path = path_of(name);
        let activity = self.files.activity();
        let unwritten = self
            .profile_slot(is_windows(name))
            .as_ref()
            .filter(|held| held.written == Some(activity) && held.path == path.to_ascii_uppercase())
            .map(|held| held.stamp);
        let before = self.stamp_of(&path);
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

        let stamp = unwritten.unwrap_or_else(|| before.or_else(|| self.stamp_of(&path)));

        self.hold_profile(name, profile.clone(), stamp);
        self.profiles.seen = self.files.activity();

        let seen = self.profiles.seen;

        if let Some(held) = self.profile_slot(is_windows(name)) {
            held.written = Some(seen);
        }

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
    // Read as KERNEL reads it, which cuts the value's trailing spaces in
    // the buffer it holds (`Profile::read`).
    let mut held = profile;
    let found = held.read(&section, &entry);

    if found.is_some() {
        system.update_held_profile(file, held);
    }

    let value = found.unwrap_or_else(|| default.unwrap_or_default());

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

/// An entry written (`WritePrivateProfileString`): all
/// three null lets the file held go. The section looked for first
/// (`KRNL386.EXE` seg1 `6d5a`-`6e1f`): missing, a null entry or value leaves
/// the file and answers 1 (`707c`, `profnul`); there, a null entry removes
/// it whatever the value (`6d97`, `703f`). An entry not there with a null
/// value leaves the file (`6db6`); one there loses its line (`6deb`,
/// `704b`). A value the buffer holds already is left (`7150`). Each string
/// written is measured as KERNEL measures it (`6e25`-`6e85`, `6864`), the
/// caller's own cut in place.
fn write_string(system: &mut System, section: u32, entry: u32, string: u32, file: &[u8]) -> Answer {
    let section_far = section;
    let entry_far = entry;
    let section = lpcstr(system, section);
    let entry = lpcstr(system, entry);
    let value = lpcstr(system, string);

    if section.is_none() && entry.is_none() && value.is_none() {
        system.release_profile(file);
        return Answer::Word(0);
    }

    let mut profile = system.read_profile(file);
    let section_name = named(section.as_ref());
    let has_section = profile.has_section(&section_name);

    if !has_section {
        if entry.is_none() || value.is_none() {
            return Answer::Word(1);
        }
    } else if entry.is_none() {
        profile.remove_section(&section_name);

        return Answer::Word(u16::from(system.write_profile(file, &profile)));
    }

    let entry_name = named(entry.as_ref());
    let present = profile.get(&section_name, &entry_name, false).is_some();

    let Some(value) = value else {
        if !present {
            return Answer::Word(1);
        }

        profile.set(&section_name, &entry_name, None);

        return Answer::Word(u16::from(system.write_profile(file, &profile)));
    };

    if present && profile.holds(&section_name, &entry_name, &value) {
        return Answer::Word(1);
    }

    let mut measured = |far: u32, text: &[u8]| {
        let (kept, after) = Profile::measure(text);

        if after != text && far >> 16 != 0 {
            let at = (far & 0xffff_0000) | (far.wrapping_add(kept.len() as u32) & 0xffff);

            system.write_far(at, &after[kept.len()..=kept.len()]);
        }

        kept
    };
    let section_written = if has_section {
        section_name.clone()
    } else {
        measured(section_far, &section_name)
    };
    let entry_written = if present {
        entry_name.clone()
    } else {
        measured(entry_far, &entry_name)
    };
    let value = measured(string, &value);

    profile.set(&section_written, &entry_written, Some(&value));

    Answer::Word(u16::from(system.write_profile(file, &profile)))
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

/// An entry of a profile as a number, as `GetPrivateProfileInt` reads it,
/// for a driver's own settings.
pub(crate) fn private_profile_int(
    system: &mut System,
    section: &[u8],
    entry: &[u8],
    default: u16,
    file: &[u8],
) -> u16 {
    match get_int(
        system,
        Some(section.to_vec()),
        Some(entry.to_vec()),
        default,
        file,
    ) {
        Answer::Word(word) => word,
        _ => default,
    }
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
