//! SHELL's calls about programs and their files: the environment's
//! variables in a string, the program that opens a file, and a program's
//! icons. **Read out of `SHELL.DLL`** and **recorded** by `shell2`.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::Files;
use winbox_raster::{decode_icon, icon_entries, pick_icon, scale_icon};

use super::registry::{ERROR_BADKEY, ERROR_OUTOFMEMORY, HKEY_CLASSES_ROOT};
use super::{Text, text_argument};
use crate::call::{Answer, Args, Stop};
use crate::profile::js_space;
use crate::system::System;

const RT_ICON: i32 = 3;
const RT_GROUP_ICON: i32 = 14;

/// Bytes as the TypeScript engine's strings hold them, a character each.
fn text(bytes: &[u8]) -> String {
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

/// A string's characters as bytes, each cut to its low eight bits.
fn bytes_of(text: &str) -> Vec<u8> {
    text.chars().map(|c| c as u32 as u8).collect()
}

/// A string and its nought written to a program's buffer.
fn write_string(system: &mut System, far: u32, text: &[u8]) {
    let mut bytes = text.to_vec();

    bytes.push(0);
    system.write_far(far, &bytes);
}

/// A string argument as the TypeScript engine's `String(x ?? '')` makes
/// it: empty for none, a number's digits; `None` for one that cannot be
/// read, which turns the call away.
fn string_argument(system: &System, far: u32) -> Option<String> {
    match text_argument(system, far) {
        Text::Null => Some(String::new()),
        Text::Number(number) => Some(number.to_string()),
        Text::Read(bytes) => Some(text(&bytes)),
        Text::Refused => None,
    }
}

/// JavaScript's `trim`, over the bytes it counts as space.
fn trim(text: &str) -> String {
    text.trim_matches(|c: char| u8::try_from(u32::from(c)).is_ok_and(js_space))
        .to_string()
}

/// The task's environment's segment, as `GetDOSEnvironment` gives it.
fn environment_far(system: &mut System) -> u32 {
    match crate::modules_kernel::get_dos_environment(system, &mut Args::repeat(0)) {
        Ok(Answer::Dword(far)) => far,
        _ => 0,
    }
}

/// The task's environment, `NAME=value` each (see `task.rs`).
fn environment(system: &mut System) -> Vec<Vec<u8>> {
    let far = environment_far(system);
    let mut entries = Vec::new();
    let mut at = far & 0xffff;

    loop {
        let entry = system.read_string((far & 0xffff_0000) | at);

        if entry.is_empty() {
            return entries;
        }

        at = (at + entry.len() as u32 + 1) & 0xffff;
        entries.push(entry);
    }
}

/// An entry's name and value: the whole name before its `=`; an entry
/// with no `=` has an empty value.
fn split_entry(entry: &str) -> (&str, &str) {
    entry.split_once('=').unwrap_or((entry, ""))
}

/// A variable's value, or none: the whole name before its `=`, without
/// regard to case; an entry with no `=` has an empty value (seg5 `0000`).
fn variable(system: &mut System, name: &str) -> Option<String> {
    let wanted = name.to_uppercase();

    environment(system).iter().find_map(|entry| {
        let entry = text(entry);
        let (key, value) = split_entry(&entry);

        (key.chars().count() == name.chars().count() && key.to_uppercase() == wanted)
            .then(|| value.to_string())
    })
}

/// A string's `%NAME%`s replaced by the environment's values. **Read out**
/// (seg5 `00ae`): a name not there is left as it is; `%%` is one `%`; a
/// `%` with no name after it stays. It answers 1 in the high word and the
/// length in the low when the result and its nought fit the size given,
/// and nought and the string's own length otherwise, the string as it was.
pub fn do_environment_subst(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let size = u32::from(args.word(system));
    let source = system.read_string(far);
    let mut out: Vec<u8> = Vec::new();
    let mut start: Option<usize> = None;
    let mut start_out = 0;
    let mut at = 0;

    while at < source.len() && out.len() < 0x100 {
        let ch = source[at];

        if ch != b'%' {
            out.push(ch);
            at += 1;
            continue;
        }

        let Some(begun) = start else {
            start = Some(at);
            start_out = out.len();
            out.push(ch);
            at += 1;
            continue;
        };

        // `%%`: the one already written.
        if at == begun + 1 {
            start = None;
            at += 1;
            continue;
        }

        match variable(system, &text(&source[begun + 1..at])) {
            None => out.push(ch),
            Some(value) => {
                let value = bytes_of(&value);

                if value.len() > 0x100 - (start_out + 1) {
                    write_string(system, far, &source[..at]);
                    return Ok(Answer::Dword(at as u32 & 0xffff));
                }

                out.truncate(start_out);
                out.extend_from_slice(&value);
            }
        }

        start = None;
        at += 1;
    }

    if out.len() as u32 >= size {
        return Ok(Answer::Dword(source.len() as u32 & 0xffff));
    }

    write_string(system, far, &out);
    Ok(Answer::Dword(1 << 16 | out.len() as u32))
}

/// A variable's value, as a pointer into the environment, or null (seg5
/// `0000`).
pub fn find_environment_string(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let name = text(&system.read_string(far)).to_uppercase();
    let environment_far = environment_far(system);
    let mut at = environment_far & 0xffff;

    for entry in environment(system) {
        let eq = entry.iter().position(|&byte| byte == b'=');
        let key = &entry[..eq.unwrap_or(entry.len())];

        if text(key).to_uppercase() == name {
            let past = eq.map_or(entry.len(), |eq| eq + 1);

            return Ok(Answer::Dword(
                (environment_far & 0xffff_0000) | ((at + past as u32) & 0xffff),
            ));
        }

        at += entry.len() as u32 + 1;
    }

    Ok(Answer::Dword(0))
}

/// Whether a file is there.
fn exists(system: &mut System, path: &str) -> bool {
    let Some(handle) = system.files.open(path) else {
        return false;
    };

    system.files.close(handle);
    true
}

/// Whether a directory is there. A folder on no drive mounted -- or that
/// names none -- is listed as empty by the TypeScript engine's file
/// manager rather than refused, so is there.
fn directory_exists(system: &System, folder: &str) -> bool {
    let parsed = Files::parse(folder);

    match parsed.drive {
        Some(letter) if system.files.mounted(letter) => {
            system.files.is_directory(letter, &parsed.parts)
        }
        _ => true,
    }
}

/// Where a file is, as `OpenFile` finds it: a path as given, or a name in
/// the directory given -- else Windows' -- then Windows' and its system
/// directory; or the DOS error, 2 for no file and 3 for no path. The
/// TypeScript engine's DOS has no current directory to offer here, so
/// Windows' stands in for it.
pub(crate) fn locate(system: &mut System, name: &str, directory: &str) -> Result<String, u16> {
    if name.contains(['\\', ':']) {
        let slash = name.rfind(['\\', ':']).unwrap_or(0);
        let mut folder = &name[..slash + usize::from(name[slash..].starts_with(':'))];

        if folder.is_empty() {
            folder = "\\";
        }

        if exists(system, name) {
            return Ok(name.to_string());
        }

        return Err(if directory_exists(system, folder) {
            2
        } else {
            3
        });
    }

    let current = if directory.is_empty() {
        "C:\\WINDOWS"
    } else {
        directory
    };

    for place in [current, "C:\\WINDOWS", "C:\\WINDOWS\\SYSTEM"] {
        let path = format!("{}\\{name}", place.strip_suffix('\\').unwrap_or(place));

        if exists(system, &path) {
            return Ok(path);
        }
    }

    Err(2)
}

/// `WIN.INI`'s `[windows]` `Programs=`: the extensions of programs.
fn program_extensions(system: &mut System) -> Vec<String> {
    let profile = system.read_profile(b"WIN.INI");
    let programs = profile
        .get(b"windows", b"Programs", true)
        .map_or_else(|| "exe com bat pif".to_string(), |value| text(&value));

    programs
        .split(' ')
        .filter(|each| !each.is_empty())
        .map(str::to_uppercase)
        .collect()
}

/// The command that opens a file, or the error (seg4 `082e`): the file
/// found; itself if it is a program; else the registration database's
/// `.EXT`'s class's `shell\open\command`, `%1` its path; else `WIN.INI`'s
/// `[extensions]`, each `^` its path less the extension.
fn command_for(
    system: &mut System,
    file: &str,
    directory: &str,
    verb: &str,
    parameters: &str,
) -> Result<String, u16> {
    let is_open = verb.to_uppercase() == "OPEN";
    let name = file.to_uppercase();
    let part = name
        .rfind(['\\', ':'])
        .map_or(name.as_str(), |at| &name[at + 1..]);
    let mut extension: String = match part.rfind('.') {
        Some(dot) => part[dot + 1..].chars().take(3).collect(),
        None => String::new(),
    };
    let programs = program_extensions(system);
    let path = if extension.is_empty() {
        let mut found = None;

        for each in &programs {
            if let Ok(path) = locate(system, &format!("{name}.{each}"), &directory.to_uppercase()) {
                found = Some(path);
                extension.clone_from(each);
                break;
            }
        }

        found.ok_or(2u16)?
    } else {
        locate(system, &name, &directory.to_uppercase())?
    };

    if programs.contains(&extension) {
        return if is_open {
            Ok(format!("{path} {parameters}"))
        } else {
            Err(31)
        };
    }

    let mut had_class = false;

    match system.query_value(HKEY_CLASSES_ROOT, &bytes_of(&format!(".{extension}"))) {
        Err(ERROR_OUTOFMEMORY) => return Err(8),
        Err(ERROR_BADKEY) => {}
        Err(_) => return Err(27),
        Ok(class) => {
            had_class = true;

            let class = text(&class);
            let key = if class.is_empty() {
                format!("shell\\{verb}\\command")
            } else {
                format!("{class}\\shell\\{verb}\\command")
            };

            match system.query_value(HKEY_CLASSES_ROOT, &bytes_of(&key)) {
                Err(ERROR_BADKEY) => {}
                Err(_) => return Err(8),
                Ok(command) if !command.is_empty() => {
                    return Ok(substitute(&text(&command), &path, parameters));
                }
                Ok(_) => {}
            }
        }
    }

    let entry = if is_open {
        system
            .read_profile(b"WIN.INI")
            .get(b"extensions", &bytes_of(&extension), true)
            .map(|value| text(&value))
            .unwrap_or_default()
    } else {
        String::new()
    };

    if entry.is_empty() {
        return Err(if had_class { 27 } else { 31 });
    }

    Ok(entry.replace('^', stem(&path)))
}

/// A path less its extension: a dot and what follows it to the end, where
/// no dot, backslash or colon follows it.
fn stem(path: &str) -> &str {
    match path.rfind('.') {
        Some(dot) if !path[dot + 1..].contains(['\\', ':']) => &path[..dot],
        _ => path,
    }
}

/// An association's command with `%0` and `%1` the file's path and `%2`
/// on the parameters' words (seg4 `03d8`).
fn substitute(command: &str, path: &str, parameters: &str) -> String {
    let words: Vec<&str> = parameters
        .split(' ')
        .filter(|word| !word.is_empty())
        .collect();
    let mut out = String::new();
    let mut chars = command.chars().peekable();

    while let Some(c) = chars.next() {
        match (c, chars.peek().and_then(|next| next.to_digit(10))) {
            ('%', Some(digit)) => {
                chars.next();

                match digit {
                    0 | 1 => out.push_str(path),
                    _ => out.push_str(words.get(digit as usize - 2).copied().unwrap_or("")),
                }
            }
            _ => out.push(c),
        }
    }

    out
}

/// The program that opens a file. **Read out** (seg4 `1154`) and
/// **recorded**: it answers 1000 and the program's name as the association
/// writes it, cut at its first space -- or for a program, its own path --
/// and else an error, the result emptied: 2 for no file, 3 for no path, 31
/// for no association.
pub fn find_executable(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let file = args.dword(system);
    let directory = args.dword(system);
    let result = args.dword(system);
    let (Some(file), Some(directory)) = (
        string_argument(system, file),
        string_argument(system, directory),
    ) else {
        return Ok(Answer::Word(0));
    };

    write_string(system, result, b"");

    let command = match command_for(system, &file, &trim(&directory), "open", "") {
        Ok(command) => command,
        Err(error) => return Ok(Answer::Word(error)),
    };
    let program = command.split(' ').next().unwrap_or_default();

    if program.is_empty() {
        return Ok(Answer::Word(2));
    }

    write_string(system, result, &bytes_of(program));
    Ok(Answer::Word(1000))
}

/// Opens a file with its program, or starts a program. **Read out** (seg4
/// `082e`, the body `FindExecutable` shares) and **recorded** by
/// `shellex`: the command is found as `FindExecutable` finds it, for the
/// verb given -- `open` when none -- and started by `WinExec`: a program
/// with the parameters after it, a text file with Notepad. Another verb
/// for a program, or a file with no association, answers 31.
///
/// Starting the command needs a second task, which the Rust engine does
/// not run yet: where the TypeScript engine would start one, this stops.
///
/// Not followed: an association that asks for DDE.
pub fn shell_execute(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);

    let far = [(); 4].map(|()| args.dword(system));

    args.word(system);

    let [Some(verb), Some(file), Some(parameters), Some(directory)] =
        far.map(|far| string_argument(system, far))
    else {
        return Ok(Answer::Word(0));
    };
    let verb = if verb.is_empty() {
        "open".to_string()
    } else {
        verb
    };

    match command_for(system, &file, &trim(&directory), &verb, &parameters) {
        Ok(_) => Err(Stop::Unsupported("ShellExecute starting a program")),
        Err(error) => Ok(Answer::Word(error)),
    }
}

/// A resource as `resourcesOf` reads a file's table: its type and number
/// where they are numbers, and its bytes.
struct Resource<'a> {
    kind: i32,
    id: Option<u16>,
    data: &'a [u8],
}

/// A file's resources, in the order of its resource table; none where the
/// table runs past the file's end, where the TypeScript engine throws.
fn resources_of(bytes: &[u8]) -> Option<Vec<Resource<'_>>> {
    let word = |at: usize| Some(u16::from_le_bytes([*bytes.get(at)?, *bytes.get(at + 1)?]));
    let header = u32::from_le_bytes(bytes.get(0x3c..0x40)?.try_into().ok()?) as usize;
    let table = header + usize::from(word(header + 0x24)?);
    let shift = word(table)?;
    let mut resources = Vec::new();
    let mut at = table + 2;

    loop {
        let kind = word(at)?;

        if kind == 0 {
            return Some(resources);
        }

        let count = word(at + 2)?;

        at += 8;

        for _ in 0..count {
            let offset = (u32::from(word(at)?) << shift) as usize;
            let length = (u32::from(word(at + 2)?) << shift) as usize;
            let id = word(at + 6)?;
            let start = offset.min(bytes.len());

            resources.push(Resource {
                kind: if kind & 0x8000 == 0 {
                    -1
                } else {
                    i32::from(kind & 0x7fff)
                },
                id: (id & 0x8000 != 0).then_some(id & 0x7fff),
                data: &bytes[start..(offset + length).clamp(start, bytes.len())],
            });
            at += 12;
        }
    }
}

/// A program's icon, by its place among the icons, or with -1 how many it
/// has. **Read out** (seg10 `026e`) and **recorded**: a file not there
/// answers nought; a file that is no Windows program answers 1, or for -1
/// nought; an index past the last answers nought. The icons are counted in
/// the order of the resource table, and the image is the one for the
/// display.
pub fn extract_icon(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);

    let far = args.dword(system);
    let index = args.signed(system);
    let Some(name) = string_argument(system, far) else {
        return Ok(Answer::Word(0));
    };
    let Some(handle) = system.files.open(&name) else {
        return Ok(Answer::Word(0));
    };
    let bytes = {
        let file = system.files.resolve(handle).expect("an open file");
        let size = file.size() as usize;

        file.seek(std::io::SeekFrom::Start(0));
        file.read(size)
    };

    system.files.close(handle);

    let none = Answer::Word(u16::from(index != -1));
    let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);

    if bytes.len() < 0x40 || bytes[0] != 0x4d || bytes[1] != 0x5a {
        return Ok(none);
    }

    let ne = u32::from_le_bytes([bytes[0x3c], bytes[0x3d], bytes[0x3e], bytes[0x3f]]) as usize;

    if ne == 0 || ne + 0x40 > bytes.len() || word(ne) != 0x454e {
        return Ok(none);
    }

    if ![0, 2, 4].contains(&bytes[ne + 0x36]) {
        return Ok(none);
    }

    if word(ne + 0x24) == word(ne + 0x26) {
        return Ok(Answer::Word(0));
    }

    let modern = word(ne + 0x3e) >= 0x300;
    let resources = resources_of(&bytes).ok_or(Stop::Unsupported(
        "ExtractIcon of a file whose resource table cannot be read",
    ))?;
    let wanted = if modern { RT_GROUP_ICON } else { RT_ICON };
    let groups: Vec<&Resource> = resources
        .iter()
        .filter(|each| each.kind == wanted)
        .collect();

    if index == -1 {
        return Ok(Answer::Word(groups.len() as u16));
    }

    let Some(group) = usize::try_from(index)
        .ok()
        .and_then(|index| groups.get(index))
    else {
        return Ok(Answer::Word(0));
    };
    let mut image = group.data;

    if modern {
        let entry = pick_icon(&icon_entries(group.data), 32, system.display.colors);
        let icon = entry.and_then(|entry| {
            resources
                .iter()
                .find(|each| each.kind == RT_ICON && each.id == Some(entry.id))
        });
        let Some(icon) = icon else {
            return Ok(Answer::Word(0));
        };

        image = icon.data;
    }

    let mut palette = system.palette();
    let icon = scale_icon(decode_icon(image, &mut palette), 32);

    Ok(Answer::Word(system.icon_block(&icon)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_association_given_the_file_and_the_parameters() {
        assert_eq!(
            substitute("notepad.exe %1", "C:\\A.TXT", ""),
            "notepad.exe C:\\A.TXT"
        );
        assert_eq!(substitute("x %0 %2 %3 %9 %", "P", "a  b"), "x P a b  %");
    }

    #[test]
    fn a_path_less_its_extension() {
        assert_eq!(stem("C:\\ORACLE\\SAMPLE.TXT"), "C:\\ORACLE\\SAMPLE");
        assert_eq!(stem("C:\\A.B\\NAME"), "C:\\A.B\\NAME");
    }
}
