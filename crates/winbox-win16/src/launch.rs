//! The launcher's list (`kb/guides/launcher.md`): every kept program's
//! Program Manager groups, as one list each front end reads, and for each
//! item what running it does -- the program found as Program Manager and
//! SHELL find it, or why there is none -- as pure code: no task, no disk.
//! The cases in `test/layers/launch.json` hold it.
//!
//! - `launch_groups`: for each kept program, in the order given, the groups
//!   its install made, in Program Manager's start-up order (`groups_from`),
//!   from the `PROGMAN.INI` its own layers keep and only the group files
//!   its layers carry; a program kept loose has WinBox's own group of its
//!   `.EXE` files instead.
//! - `item_run`: an item run as File Open runs it (`PROGMAN.EXE` seg5
//!   `03e7`, `ShellExecute` by seg5 `01b3`; SHELL's `commandFor`, seg4
//!   `082e`; KERNEL's search).
//!
//! Assumed, as a stack seen from outside a machine cannot know it: no
//! environment variable is put into a command, PATH is what the caller
//! passes, and only drive C: -- the stack -- is there. Strings are bytes,
//! one character to a byte, as `groups.rs` has them.

use std::collections::{BTreeMap, BTreeSet};

use crate::groups::{PROGMAN_INI, groups_from};
use crate::layers::Flat;
use crate::profile::Profile;
use crate::shell::reg_api::{Mode, find_in};
use crate::shell::registry::{HKEY_CLASSES_ROOT, RegistryDatabase};
use crate::user_misc::{ansi_lower_byte, ansi_upper_byte};

/// The Windows directory, current as Program Manager runs an item (seg5
/// `03f5`-`03f9`), and the system directory.
const WINDOWS: &[u8] = b"C:\\WINDOWS";
const SYSTEM: &[u8] = b"C:\\WINDOWS\\SYSTEM";

/// What a path on the flattened drive is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    File,
    Folder,
}

/// A kept program's files, as the launcher sees them (`KeptStack`'s
/// `read`, `kind` and `own`).
pub trait StackFiles {
    /// A file of the whole stack -- the base, then the program's layers --
    /// by its path on the flattened drive (`WINDOWS\WIN.INI`).
    fn read(&self, path: &str) -> Option<&[u8]>;
    /// What a path on the flattened drive is, or none.
    fn kind(&self, path: &str) -> Option<Kind>;
    /// Whether the program's own layers carry a file.
    fn own(&self, path: &str) -> bool;
}

/// A kept program's stack, as the launcher sees it (`KeptStack`).
pub struct KeptStack<'a> {
    /// The kept program's name: its install's.
    pub name: Vec<u8>,
    pub files: &'a dyn StackFiles,
    /// The `.EXE` files its layers hold, as C: names them.
    pub exes: Vec<Vec<u8>>,
    /// `PATH`'s directories, as C: names them.
    pub path: Vec<Vec<u8>>,
}

/// A flattened stack's files, and which its program's own layers carry:
/// the native front end's library and the tests read a stack so
/// (`flat_files`).
#[derive(Debug)]
pub struct FlatFiles<'a> {
    files: BTreeMap<&'a str, &'a [u8]>,
    folders: BTreeSet<&'a str>,
    own: BTreeSet<String>,
}

impl<'a> FlatFiles<'a> {
    pub fn new(flat: &'a Flat, own: impl IntoIterator<Item = String>) -> Self {
        Self {
            files: flat
                .files
                .iter()
                .map(|file| (file.path.as_str(), file.data.as_slice()))
                .collect(),
            folders: flat
                .folders
                .iter()
                .map(|folder| folder.path.as_str())
                .collect(),
            own: own.into_iter().collect(),
        }
    }
}

impl StackFiles for FlatFiles<'_> {
    fn read(&self, path: &str) -> Option<&[u8]> {
        self.files.get(path).copied()
    }

    fn kind(&self, path: &str) -> Option<Kind> {
        if self.files.contains_key(path) {
            Some(Kind::File)
        } else if self.folders.contains(path) {
            Some(Kind::Folder)
        } else {
            None
        }
    }

    fn own(&self, path: &str) -> bool {
        self.own.contains(path)
    }
}

impl std::fmt::Debug for KeptStack<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KeptStack")
            .field("name", &latin1(&self.name))
            .field("exes", &self.exes.len())
            .finish_non_exhaustive()
    }
}

/// What running an item does (`ItemRun`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemRun {
    pub file: Vec<u8>,
    pub parameters: Vec<u8>,
    pub directory: Vec<u8>,
    pub show: u16,
    pub directory_there: bool,
    pub program: Option<Vec<u8>>,
    pub command_line: Vec<u8>,
    pub error: u16,
    pub missing: Option<Vec<u8>>,
    pub reason: Option<String>,
}

/// An item as the launcher lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchItem {
    pub name: Vec<u8>,
    pub command: Vec<u8>,
    pub directory: Vec<u8>,
    pub icon_path: Vec<u8>,
    pub icon_index: u16,
    pub hot_key: u16,
    pub minimized: bool,
    pub run: ItemRun,
}

/// A group as the launcher lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchGroup {
    pub install: Vec<u8>,
    pub name: Vec<u8>,
    /// WinBox's own group of a program kept loose.
    pub winbox: bool,
    pub file: Option<String>,
    pub refusal: Option<String>,
    pub items: Vec<LaunchItem>,
}

fn upper(value: &[u8]) -> Vec<u8> {
    value.iter().map(|&byte| ansi_upper_byte(byte)).collect()
}

fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

fn strip_leading_spaces(value: &[u8]) -> &[u8] {
    let start = value
        .iter()
        .position(|&byte| byte != b' ')
        .unwrap_or(value.len());

    &value[start..]
}

/// A DOS path, upper case, made whole from the current directory: its path
/// on the flattened drive, the root empty; none for a drive other than C:.
pub fn stack_path(path: &[u8], current: &[u8]) -> Option<String> {
    let mut rest = upper(path);
    let mut base = upper(current);

    if rest.len() >= 2 && rest[0].is_ascii_uppercase() && rest[1] == b':' {
        if rest[0] != b'C' {
            return None;
        }

        rest.drain(..2);

        if rest.first() != Some(&b'\\') && !base.starts_with(b"C:") {
            base = b"C:\\".to_vec();
        }
    }

    let mut names: Vec<&[u8]> = Vec::new();
    let base_rest: &[u8] = if base.len() >= 2 && base[0].is_ascii_uppercase() && base[1] == b':' {
        &base[2..]
    } else {
        &base
    };

    if rest.first() != Some(&b'\\') {
        names.extend(
            base_rest
                .split(|&b| b == b'\\')
                .filter(|name| !name.is_empty()),
        );
    }

    for name in rest.split(|&b| b == b'\\') {
        match name {
            b"" | b"." => {}
            b".." => {
                names.pop();
            }
            _ => names.push(name),
        }
    }

    Some(latin1(&names.join(&b'\\')))
}

fn dos_path(path: &str) -> Vec<u8> {
    let mut whole = b"C:\\".to_vec();

    whole.extend(path.chars().map(|c| c as u8));
    whole
}

fn last_part(path: &[u8]) -> &[u8] {
    let at = path
        .iter()
        .rposition(|&b| b == b'\\' || b == b':')
        .map_or(0, |at| at + 1);

    &path[at..]
}

fn trim_slash(place: &[u8]) -> Vec<u8> {
    let mut it = place.to_vec();

    if it.last() == Some(&b'\\') {
        it.pop();
    }

    it
}

/// KERNEL's places, the first given, those the same as one before left
/// out, then PATH's.
fn places(first: &[u8], path: &[Vec<u8>]) -> Vec<Vec<u8>> {
    let mut kept: Vec<Vec<u8>> = Vec::new();

    for place in [first, WINDOWS, SYSTEM, WINDOWS] {
        let it = trim_slash(place);

        if !kept.contains(&it) {
            kept.push(it);
        }
    }

    kept.extend(path.iter().map(|place| trim_slash(&upper(place))));
    kept
}

/// A file found as `OpenFile` finds it, or 2 for no file, 3 for no path.
fn locate(stack: &KeptStack<'_>, name: &[u8], current: &[u8]) -> Result<Vec<u8>, u16> {
    if name.iter().any(|&b| b == b'\\' || b == b':') {
        let path = stack_path(name, current);

        if let Some(path) = &path
            && stack.files.kind(path) == Some(Kind::File)
        {
            return Ok(dos_path(path));
        }

        let folder_there = path.as_ref().is_some_and(|path| {
            let folder = &path[..path.rfind('\\').unwrap_or(0)];

            folder.is_empty() || stack.files.kind(folder) == Some(Kind::Folder)
        });

        return Err(if folder_there { 2 } else { 3 });
    }

    for place in places(current, &stack.path) {
        let mut whole = place.clone();

        whole.push(b'\\');
        whole.extend_from_slice(name);

        if let Some(path) = stack_path(&whole, current)
            && stack.files.kind(&path) == Some(Kind::File)
        {
            return Ok(dos_path(&path));
        }
    }

    Err(2)
}

fn win_ini(stack: &KeptStack<'_>) -> Profile {
    Profile::new(stack.files.read("WINDOWS\\WIN.INI").unwrap_or_default())
}

fn registry_value(db: Option<&mut RegistryDatabase>, key: &[u8]) -> Option<Vec<u8>> {
    let db = db?;
    let at = find_in(db, HKEY_CLASSES_ROOT, Some(key), Mode::Open).ok()?;
    let value = db.entries[at][3];

    Some(db.text_of(value).unwrap_or_default().to_vec())
}

/// Each `pattern` byte of `text` replaced by `with`.
fn replace_byte(text: &[u8], pattern: u8, with: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();

    for &byte in text {
        if byte == pattern {
            out.extend_from_slice(with);
        } else {
            out.push(byte);
        }
    }

    out
}

/// A path less its extension: to its last `.` after its last `\` or `:`.
fn stem(path: &[u8]) -> &[u8] {
    let part = path.len() - last_part(path).len();

    match path[part..].iter().rposition(|&b| b == b'.') {
        Some(dot) => &path[..part + dot],
        None => path,
    }
}

/// The command `ShellExecute` starts for a file (SHELL's `commandFor`), or
/// the error and what is missing.
fn command_for(
    stack: &KeptStack<'_>,
    file: &[u8],
    current: &[u8],
    parameters: &[u8],
) -> Result<Vec<u8>, (u16, Vec<u8>)> {
    let name = upper(file);
    let part = last_part(&name).to_vec();
    let mut extension = match part.iter().rposition(|&b| b == b'.') {
        Some(dot) => part[dot + 1..part.len().min(dot + 4)].to_vec(),
        None => Vec::new(),
    };
    let profile = win_ini(stack);
    let programs: Vec<Vec<u8>> = profile
        .get(b"windows", b"Programs", true)
        .unwrap_or_else(|| b"exe com bat pif".to_vec())
        .split(|&b| b == b' ')
        .filter(|each| !each.is_empty())
        .map(upper)
        .collect();
    let path = if extension.is_empty() {
        let mut found = None;

        for each in &programs {
            let mut tried = name.clone();

            tried.push(b'.');
            tried.extend_from_slice(each);

            if let Ok(path) = locate(stack, &tried, current) {
                found = Some(path);
                extension.clone_from(each);
                break;
            }
        }

        let Some(path) = found else {
            let mut missing = part.clone();

            missing.push(b'.');
            missing.extend_from_slice(programs.first().map_or(&b"EXE"[..], |p| p));
            return Err((2, missing));
        };

        path
    } else {
        locate(stack, &name, current).map_err(|error| (error, part.clone()))?
    };

    if programs.contains(&extension) {
        let mut command = path;

        command.push(b' ');
        command.extend_from_slice(parameters);
        return Ok(command);
    }

    let mut db = stack
        .files
        .read("WINDOWS\\REG.DAT")
        .and_then(|reg| RegistryDatabase::parse(reg).ok());
    let mut key = b".".to_vec();

    key.extend_from_slice(&extension);

    let class = registry_value(db.as_mut(), &key);

    if let Some(class) = &class {
        let mut key = class.clone();

        if !key.is_empty() {
            key.push(b'\\');
        }

        key.extend_from_slice(b"shell\\open\\command");

        if let Some(command) = registry_value(db.as_mut(), &key)
            && !command.is_empty()
        {
            let words: Vec<&[u8]> = parameters
                .split(|&b| b == b' ')
                .filter(|word| !word.is_empty())
                .collect();
            let mut out = Vec::new();
            let mut at = 0;

            while at < command.len() {
                if command[at] == b'%' && command.get(at + 1).is_some_and(u8::is_ascii_digit) {
                    let digit = command[at + 1] - b'0';

                    if digit <= 1 {
                        out.extend_from_slice(&path);
                    } else if let Some(word) = words.get(usize::from(digit) - 2) {
                        out.extend_from_slice(word);
                    }

                    at += 2;
                } else {
                    out.push(command[at]);
                    at += 1;
                }
            }

            return Ok(out);
        }
    }

    let entry = profile
        .get(b"extensions", &extension, true)
        .unwrap_or_default();

    if entry.is_empty() {
        let mut missing = b".".to_vec();

        missing.extend_from_slice(&extension);
        return Err((if class.is_some() { 27 } else { 31 }, missing));
    }

    Ok(replace_byte(&entry, b'^', stem(&path)))
}

/// An item run as Program Manager's File Open runs it (seg5 `03e7`), on a
/// stack (`itemRun`).
pub fn item_run(
    stack: &KeptStack<'_>,
    command: &[u8],
    directory: &[u8],
    minimized: bool,
) -> ItemRun {
    let directory = upper(directory);
    let directory_path = if directory.is_empty() {
        Some(String::new())
    } else {
        stack_path(&directory, WINDOWS)
    };
    let directory_there = directory.is_empty()
        || directory_path
            .as_ref()
            .is_some_and(|path| path.is_empty() || stack.files.kind(path) == Some(Kind::Folder));
    let current: &[u8] = if !directory.is_empty() && directory_there {
        &directory
    } else {
        WINDOWS
    };
    let command = strip_leading_spaces(command);
    let (file, parameters) = match command.iter().position(|&b| b == b' ') {
        Some(space) => (&command[..space], &command[space + 1..]),
        None => (command, &b""[..]),
    };
    let mut run = ItemRun {
        file: file.to_vec(),
        parameters: parameters.to_vec(),
        directory: directory.clone(),
        show: if minimized { 7 } else { 1 },
        directory_there,
        program: None,
        command_line: Vec::new(),
        error: 0,
        missing: None,
        reason: None,
    };
    let searched: &[u8] = if directory.is_empty() {
        WINDOWS
    } else {
        &directory
    };

    let found = match command_for(stack, file, searched, parameters) {
        Ok(found) => found,
        Err((error, missing)) => {
            run.error = error;
            run.reason = Some(if error == 31 || error == 27 {
                format!("nothing in this Windows opens {} files", latin1(&missing))
            } else {
                format!("needs {}, which is not in this Windows", latin1(&missing))
            });
            run.missing = Some(missing);
            return run;
        }
    };
    let line = strip_leading_spaces(&found);
    let (first, rest) = match line.iter().position(|&b| b == b' ') {
        Some(at) => (&line[..at], &line[at + 1..]),
        None => (line, &b""[..]),
    };
    let mut name = upper(first);

    run.command_line = rest.to_vec();

    if !last_part(&name).contains(&b'.') {
        name.extend_from_slice(b".EXE");
    }

    match locate(stack, &name, current) {
        Ok(program) => run.program = Some(program),
        Err(error) => {
            let missing = last_part(&name).to_vec();

            run.error = error;
            run.reason = Some(format!(
                "needs {}, which is not in this Windows",
                latin1(&missing)
            ));
            run.missing = Some(missing);
        }
    }

    run
}

/// The name Program Manager gives an item made from a command alone (seg5
/// `00ed`), as `itemName`.
pub fn item_name(command: &[u8]) -> Vec<u8> {
    let file = command
        .iter()
        .rposition(|&b| b == b'\\')
        .map_or(0, |at| at + 1);
    let end = match command.iter().rposition(|&b| b == b'.') {
        Some(dot) if dot >= file => dot,
        _ => command.len(),
    };
    let name = &command[file..end.min(file + 40)];

    name.iter()
        .enumerate()
        .map(|(at, &byte)| {
            if at == 0 {
                ansi_upper_byte(byte)
            } else {
                ansi_lower_byte(byte)
            }
        })
        .collect()
}

/// The directory of a path, its last `\` dropped but a root's.
fn directory_of(path: &[u8]) -> Vec<u8> {
    match path.iter().rposition(|&b| b == b'\\') {
        Some(slash) if slash <= 2 => path[..=slash].to_vec(),
        Some(slash) => path[..slash].to_vec(),
        None => Vec::new(),
    }
}

/// A kept program's groups as the launcher lists them (`stackGroups`).
pub fn stack_groups(stack: &KeptStack<'_>) -> Vec<LaunchGroup> {
    if !stack.files.own(PROGMAN_INI) {
        let items = stack
            .exes
            .iter()
            .map(|exe| {
                let directory = directory_of(exe);

                LaunchItem {
                    name: item_name(exe),
                    command: exe.clone(),
                    directory: directory.clone(),
                    icon_path: exe.clone(),
                    icon_index: 0,
                    hot_key: 0,
                    minimized: false,
                    run: item_run(stack, exe, &directory, false),
                }
            })
            .collect();

        return vec![LaunchGroup {
            install: stack.name.clone(),
            name: stack.name.clone(),
            winbox: true,
            file: None,
            refusal: None,
            items,
        }];
    }

    groups_from(|path| stack.files.read(path))
        .groups
        .into_iter()
        .filter(|group| {
            group
                .file
                .as_deref()
                .is_some_and(|file| stack.files.own(file))
        })
        .map(|group| {
            let (name, items) = match &group.group {
                Some(loaded) => (
                    loaded.name.clone(),
                    loaded
                        .items
                        .iter()
                        .map(|item| LaunchItem {
                            name: item.name.clone(),
                            command: item.command.clone(),
                            directory: item.directory.clone(),
                            icon_path: item.icon_path.clone(),
                            icon_index: item.icon_index,
                            hot_key: item.hot_key,
                            minimized: item.minimized,
                            run: item_run(stack, &item.command, &item.directory, item.minimized),
                        })
                        .collect(),
                ),
                None => (Vec::new(), Vec::new()),
            };

            LaunchGroup {
                install: stack.name.clone(),
                name,
                winbox: false,
                file: group.file,
                refusal: group.refusal,
                items,
            }
        })
        .collect()
}

/// Every kept program's groups, in the order the programs are given, as
/// one list (`launchGroups`).
pub fn launch_groups(stacks: &[KeptStack<'_>]) -> Vec<LaunchGroup> {
    stacks.iter().flat_map(stack_groups).collect()
}
