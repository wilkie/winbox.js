//! `RegOpenKey` and the rest, over the database in `registry.rs`.
//!
//! **Read out of `SHELL.DLL`** (seg2 `0dbc`, `0b6a`, `1114`, `14dc`,
//! `16f4`, `168e`). A key's handle is `0001:` and its entry.
//! `HKEY_CLASSES_ROOT`, 1, is found again as `.classes` every time; any
//! other handle with nothing in its high word is the root; an entry below
//! the buckets is the root too, and one past the table's end is error 2.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use std::io::SeekFrom;

use super::registry::{
    ERROR_BADKEY, ERROR_CANTWRITE, ERROR_INVALID_PARAMETER, ERROR_SUCCESS, HKEY_CLASSES_ROOT,
    RegistryDatabase,
};
use super::{Text, text_argument};
use crate::call::{Answer, Args, Stop};
use crate::system::System;

const CLASSES: &[u8] = b".classes";

/// Where the database is: Windows' directory.
const PATH: &str = "C:\\WINDOWS\\REG.DAT";

/// What SHELL keeps of the database: it, once read, and how many keys are
/// open.
#[derive(Debug, Clone, Default)]
pub struct Registry {
    pub db: Option<RegistryDatabase>,
    pub open: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Open,
    Create,
}

/// A key's path, as a call names it: none, or its text. A path the
/// TypeScript engine cannot take apart -- a number, where the pointer's
/// segment is nought -- stops the program, as it throws there.
fn path_argument(system: &System, far: u32) -> Result<Result<Option<Vec<u8>>, Answer>, Stop> {
    Ok(match text_argument(system, far) {
        Text::Null => Ok(None),
        Text::Read(text) => Ok(Some(text)),
        Text::Refused => Err(Answer::Dword(0)),
        Text::Number(_) => {
            return Err(Stop::Unsupported("a registry key's path given as a number"));
        }
    })
}

impl System {
    /// The database, read when nothing is open (seg2 `0dbc`); a missing
    /// file is made empty at start.
    fn registry(&mut self) -> Result<&mut RegistryDatabase, u32> {
        if self.shell.registry.db.is_none() {
            let db = match self.files.open(PATH) {
                Some(handle) => {
                    let file = self.files.resolve(handle).expect("an open file");
                    let size = file.size() as usize;

                    file.seek(SeekFrom::Start(0));

                    let bytes = file.read(size);

                    self.files.close(handle);
                    RegistryDatabase::parse(&bytes)?
                }
                // SHELL makes the file from its empty database when it
                // starts; here, the first time it is wanted.
                None => RegistryDatabase {
                    dirty: true,
                    ..RegistryDatabase::empty()
                },
            };

            self.shell.registry.db = Some(db);
        }

        Ok(self.shell.registry.db.as_mut().expect("the database"))
    }

    /// Written back when the last key closes, if anything changed (seg2
    /// `1164`).
    fn flush_registry(&mut self) -> u32 {
        let registry = &self.shell.registry;
        let Some(db) = registry
            .db
            .as_ref()
            .filter(|db| registry.open <= 0 && db.dirty)
        else {
            return ERROR_SUCCESS;
        };
        let bytes = db.serialize();
        let Some(handle) = self.files.create(PATH) else {
            return ERROR_CANTWRITE;
        };

        if let Some(file) = self.files.resolve(handle) {
            file.write(&bytes);
        }

        self.files.close(handle);

        if let Some(db) = self.shell.registry.db.as_mut() {
            db.dirty = false;
        }

        ERROR_SUCCESS
    }

    /// Opens (or makes) a key below another: the entry, or an error.
    fn find_key(&mut self, hkey: u32, subkey: Option<&[u8]>, mode: Mode) -> Result<usize, u32> {
        let db = self.registry()?;
        let Some(mut at) = key_of(db, hkey, mode) else {
            return Err(ERROR_BADKEY);
        };
        let Some(parts) = parts_of(subkey, at == 0) else {
            return Err(ERROR_BADKEY);
        };

        for part in parts {
            let child = db.child_named(at, part);

            if child != 0 {
                at = child;
            } else if mode == Mode::Create {
                at = db.make_child(at, part);
            } else {
                return Err(ERROR_BADKEY);
            }
        }

        Ok(at)
    }

    /// A key's value, for SHELL's own use: the text, or the error
    /// `RegQueryValue` would answer.
    pub(crate) fn query_value(&mut self, hkey: u32, subkey: &[u8]) -> Result<Vec<u8>, u32> {
        let at = self.find_key(hkey, Some(subkey), Mode::Open)?;

        Ok(self.value_of(at))
    }

    /// A key's value, empty for none.
    fn value_of(&self, at: usize) -> Vec<u8> {
        let db = self.shell.registry.db.as_ref().expect("the database");

        db.text_of(db.entries[at][3]).unwrap_or_default().to_vec()
    }

    /// A string and its nought into a program's buffer, cut to `cb` less
    /// one: its length and one, or none where `cb` is nought.
    fn copy_out_text(&mut self, text: &[u8], buffer: u32, cb: u32) -> Option<u32> {
        if cb == 0 {
            return None;
        }

        let kept = &text[..text.len().min(cb as usize - 1)];
        let mut bytes = kept.to_vec();

        bytes.push(0);
        self.write_far(buffer, &bytes);
        Some(kept.len() as u32 + 1)
    }
}

/// The entry a handle names, making `.classes` when asked to; none for a
/// handle past the table.
fn key_of(db: &mut RegistryDatabase, hkey: u32, mode: Mode) -> Option<usize> {
    if hkey == HKEY_CLASSES_ROOT {
        let classes = db.child_named(0, CLASSES);

        return match (classes, mode) {
            (0, Mode::Create) => Some(db.make_child(0, CLASSES)),
            (0, Mode::Open) => None,
            (classes, _) => Some(classes),
        };
    }

    if hkey >> 16 == 0 {
        return Some(0);
    }

    let index = (hkey & 0xffff) as usize;

    if index >= db.entries.len() {
        return None;
    }

    Some(if index <= db.buckets { 0 } else { index })
}

/// A path's parts (seg2 `0b6a`), or none for one SHELL refuses: leading
/// spaces passed over; a leading backslash only from the root; each part
/// one to 63 characters, none a space, a control or above 7Fh.
fn parts_of(subkey: Option<&[u8]>, root: bool) -> Option<Vec<&[u8]>> {
    let Some(subkey) = subkey else {
        return Some(Vec::new());
    };
    let start = subkey.iter().take_while(|&&byte| byte == b' ').count();
    let mut text = &subkey[start..];

    if let Some(rest) = text.strip_prefix(b"\\") {
        if !root {
            return None;
        }

        text = rest;
    }

    if text.is_empty() {
        return Some(Vec::new());
    }

    let parts: Vec<&[u8]> = text.split(|&byte| byte == b'\\').collect();

    for part in &parts {
        if part.is_empty() || part.len() > 63 {
            return None;
        }

        if part.iter().any(|&byte| byte <= 0x20 || byte >= 0x80) {
            return None;
        }
    }

    Some(parts)
}

fn open_key(system: &mut System, args: &mut Args, mode: Mode) -> Result<Answer, Stop> {
    let hkey = args.dword(system);
    let far = args.dword(system);
    let phkey = args.dword(system);
    let subkey = match path_argument(system, far)? {
        Ok(subkey) => subkey,
        Err(refused) => return Ok(refused),
    };
    let at = match system.find_key(hkey, subkey.as_deref(), mode) {
        Ok(at) => at,
        Err(error) => return Ok(Answer::Dword(error)),
    };

    system.shell.registry.open += 1;
    system.write_far(phkey, &(1 << 16 | at as u32).to_le_bytes());
    Ok(Answer::Dword(ERROR_SUCCESS))
}

pub fn reg_open_key(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    open_key(system, args, Mode::Open)
}

pub fn reg_create_key(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    open_key(system, args, Mode::Create)
}

/// Closes a key -- any key: only the count of open keys is kept (seg2
/// `1114`).
pub fn reg_close_key(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.dword(system);

    if system.shell.registry.open <= 0 {
        return Ok(Answer::Dword(ERROR_INVALID_PARAMETER));
    }

    system.shell.registry.open -= 1;
    Ok(Answer::Dword(system.flush_registry()))
}

/// A key's value into a buffer, `*lpcb` its size: the size written back
/// is the length and its nought, cut to the buffer; with a size of nought,
/// nothing is written.
pub fn reg_query_value(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hkey = args.dword(system);
    let far = args.dword(system);
    let buffer = args.dword(system);
    let lpcb = args.dword(system);
    let subkey = match path_argument(system, far)? {
        Ok(subkey) => subkey,
        Err(refused) => return Ok(refused),
    };
    let at = match system.find_key(hkey, subkey.as_deref(), Mode::Open) {
        Ok(at) => at,
        Err(error) => return Ok(Answer::Dword(error)),
    };
    let size = system.read_far(lpcb, 2);
    let cb = u32::from(u16::from_le_bytes([size[0], size[1]]));
    let value = system.value_of(at);

    if let Some(length) = system.copy_out_text(&value, buffer, cb) {
        system.write_far(lpcb, &length.to_le_bytes());
    }

    Ok(Answer::Dword(ERROR_SUCCESS))
}

/// A key's value set, the key made if it is not there: only `REG_SZ`, 1,
/// is taken, and an empty value takes the value away.
pub fn reg_set_value(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hkey = args.dword(system);
    let far = args.dword(system);
    let kind = args.dword(system);
    let value_far = args.dword(system);

    args.dword(system);

    let text = match text_argument(system, value_far) {
        Text::Null => Vec::new(),
        Text::Number(number) => number.to_string().into_bytes(),
        Text::Read(text) => text,
        Text::Refused => return Ok(Answer::Dword(0)),
    };

    if matches!(text_argument(system, far), Text::Refused) {
        return Ok(Answer::Dword(0));
    }

    if kind != 1 {
        return Ok(Answer::Dword(ERROR_INVALID_PARAMETER));
    }

    let subkey = match path_argument(system, far)? {
        Ok(subkey) => subkey,
        Err(refused) => return Ok(refused),
    };

    system.shell.registry.open += 1;

    let at = match system.find_key(hkey, subkey.as_deref(), Mode::Create) {
        Ok(at) => at,
        Err(error) => {
            system.shell.registry.open -= 1;
            return Ok(Answer::Dword(error));
        }
    };
    let db = system.shell.registry.db.as_mut().expect("the database");
    let was = db.entries[at][3];

    if text.is_empty() {
        if was != 0 {
            db.entries[at][3] = 0;
            db.release_text(was);
            db.dirty = true;
        }
    } else if db.text_of(was) != Some(text.as_slice()) {
        db.entries[at][3] = db.use_text(&text, false);
        db.release_text(was);
        db.dirty = true;
    }

    system.shell.registry.open -= 1;
    Ok(Answer::Dword(system.flush_registry()))
}

/// A key and everything under it deleted: the last part of the path is
/// the key, found below the rest. Only a null path is error 2 at once.
pub fn reg_delete_key(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hkey = args.dword(system);
    let far = args.dword(system);
    let subkey = text_argument(system, far);

    Ok(delete_key(system, hkey, subkey))
}

/// `RegDeleteKey` given its path as read.
fn delete_key(system: &mut System, hkey: u32, subkey: Text) -> Answer {
    let subkey = match subkey {
        Text::Null => return Answer::Dword(ERROR_BADKEY),
        Text::Number(number) => number.to_string().into_bytes(),
        // An empty path is a string all the same, and goes on to be looked
        // for: the database is read, the handle checked, and a child of no
        // name sought.
        Text::Read(text) => text,
        Text::Refused => return Answer::Dword(0),
    };
    let (parent, name) = match subkey.iter().rposition(|&byte| byte == b'\\') {
        Some(at) => (Some(&subkey[..at]), &subkey[at + 1..]),
        None => (None, subkey.as_slice()),
    };
    let at = match system.find_key(hkey, parent, Mode::Open) {
        Ok(at) => at,
        Err(error) => return Answer::Dword(error),
    };
    let db = system.shell.registry.db.as_mut().expect("the database");
    let child = db.child_named(at, name);

    if child == 0 {
        return Answer::Dword(ERROR_BADKEY);
    }

    // Out of its parent's list, then gone.
    if db.entries[at][1] as usize == child {
        db.entries[at][1] = db.entries[child][0];
    } else {
        let mut before = db.entries[at][1] as usize;

        while db.entries[before][0] as usize != child {
            before = db.entries[before][0] as usize;
        }

        db.entries[before][0] = db.entries[child][0];
    }

    db.remove_tree(child);
    db.dirty = true;
    Answer::Dword(system.flush_registry())
}

/// A key's `index`th child's name, newest first; error 2 past the last
/// (seg2 `14dc`).
pub fn reg_enum_key(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hkey = args.dword(system);
    let index = args.dword(system);
    let buffer = args.dword(system);
    let size = args.dword(system);
    let at = match system.find_key(hkey, None, Mode::Open) {
        Ok(at) => at,
        Err(error) => return Ok(Answer::Dword(error)),
    };
    let db = system.shell.registry.db.as_ref().expect("the database");
    let mut child = db.entries[at][1] as usize;
    let mut i = 0;

    while i < index && child != 0 {
        child = db.entries[child][0] as usize;
        i += 1;
    }

    if child == 0 {
        return Ok(Answer::Dword(ERROR_BADKEY));
    }

    let name = db
        .text_of(db.entries[child][2])
        .unwrap_or_default()
        .to_vec();

    system.copy_out_text(&name, buffer, size & 0xffff);
    Ok(Answer::Dword(ERROR_SUCCESS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell::registry::ERROR_BADDB;
    use winbox_machine::HostDrive;

    /// A system whose drive C is a fresh folder, with `C:\WINDOWS` in it.
    fn system_on_drive(name: &str) -> (System, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("winbox-shell-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);

        std::fs::create_dir_all(root.join("WINDOWS")).unwrap();

        let mut system = System::new();

        system.files.mount('C', HostDrive::new(root.clone()));
        (system, root)
    }

    #[test]
    fn an_empty_path_to_delete_is_looked_for() {
        // A database SHELL will not take answers its error, where a null
        // path is error 2 before the database is read.
        let (mut system, root) = system_on_drive("delete-empty");

        std::fs::write(root.join("WINDOWS").join("REG.DAT"), [0u8; 32]).unwrap();
        assert_eq!(
            delete_key(&mut system, HKEY_CLASSES_ROOT, Text::Read(Vec::new())),
            Answer::Dword(ERROR_BADDB)
        );
        assert_eq!(
            delete_key(&mut system, HKEY_CLASSES_ROOT, Text::Null),
            Answer::Dword(ERROR_BADKEY)
        );

        // Read, and no child of no name below the root.
        std::fs::remove_file(root.join("WINDOWS").join("REG.DAT")).unwrap();
        assert_eq!(
            delete_key(&mut system, 0, Text::Read(Vec::new())),
            Answer::Dword(ERROR_BADKEY)
        );
        assert!(system.shell.registry.db.is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn paths_as_shell_takes_them_apart() {
        assert_eq!(parts_of(None, false), Some(vec![]));
        assert_eq!(
            parts_of(Some(b"  a\\b"), false),
            Some(vec![&b"a"[..], b"b"])
        );
        assert_eq!(parts_of(Some(b"\\a"), true), Some(vec![&b"a"[..]]));
        assert_eq!(parts_of(Some(b"\\a"), false), None);
        assert_eq!(parts_of(Some(b"a\\"), true), None);
        assert_eq!(parts_of(Some(b"a b"), true), None);
        assert_eq!(parts_of(Some(&[b'x'; 64]), true), None);
    }
}
