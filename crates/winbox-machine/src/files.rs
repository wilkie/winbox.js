//! DOS's files, as winbox.js's `FileManager` keeps them: drives by letter,
//! each a file system, a current directory, and the open files by handle.
//! A drive here is a directory of the host's, its names found without
//! regard to case, as DOS finds them.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;

/// The most files open at once.
pub const MAX_OPEN_FILES: usize = 512;

/// The first handle a file is given: 0 to 4 are DOS's own devices, so a
/// file's is the first free after them (`devinfo`).
const FIRST_HANDLE: usize = 5;

/// A drive: a directory of the host's.
#[derive(Debug, Clone)]
pub struct HostDrive {
    pub root: PathBuf,
}

impl HostDrive {
    /// The host's path for a DOS path's parts, each found without regard to
    /// case where it is there, else as it is, upper case.
    fn locate(&self, parts: &[String]) -> PathBuf {
        let mut path = self.root.clone();

        for part in parts.iter().filter(|part| !part.is_empty()) {
            let found = std::fs::read_dir(&path).ok().and_then(|entries| {
                entries
                    .flatten()
                    .find(|entry| {
                        entry
                            .file_name()
                            .to_string_lossy()
                            .eq_ignore_ascii_case(part)
                    })
                    .map(|entry| entry.path())
            });

            path = found.unwrap_or_else(|| path.join(part.to_ascii_uppercase()));
        }

        path
    }
}

/// A file open, and where in it the next read or write is.
#[derive(Debug)]
pub struct OpenFile {
    pub file: File,
    pub path: PathBuf,
    pub drive: char,
}

impl OpenFile {
    /// Bytes written where the file is at; how many.
    pub fn write(&mut self, bytes: &[u8]) -> usize {
        self.file.write(bytes).unwrap_or(0)
    }

    /// Bytes read from where the file is at.
    pub fn read(&mut self, length: usize) -> Vec<u8> {
        let mut bytes = vec![0; length];
        let read = self.file.read(&mut bytes).unwrap_or(0);

        bytes.truncate(read);
        bytes
    }

    pub fn seek(&mut self, to: SeekFrom) -> Option<u64> {
        self.file.seek(to).ok()
    }
}

/// A path taken apart as DOS reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed {
    /// Its drive's letter, upper case; `None` for a path that names none.
    pub drive: Option<char>,
    pub parts: Vec<String>,
}

/// DOS's files.
#[derive(Debug)]
pub struct Files {
    drives: HashMap<char, HostDrive>,
    /// Each drive's current directory, and the current drive.
    pwd: HashMap<char, String>,
    pub drive: char,
    open: HashMap<usize, OpenFile>,
}

impl Default for Files {
    fn default() -> Self {
        Self::new()
    }
}

impl Files {
    pub fn new() -> Self {
        Self {
            drives: HashMap::new(),
            pwd: HashMap::from([('C', "C:\\".to_string())]),
            drive: 'C',
            open: HashMap::new(),
        }
    }

    pub fn mount(&mut self, letter: char, drive: HostDrive) {
        self.drives.insert(letter.to_ascii_uppercase(), drive);
    }

    /// The current drive's directory, ending in a backslash.
    pub fn path(&self) -> String {
        self.pwd.get(&self.drive).cloned().unwrap_or_default()
    }

    pub fn set_path(&mut self, path: &str) {
        let mut path = path.to_string();

        if !path.ends_with('\\') {
            path.push('\\');
        }

        self.pwd.insert(self.drive, path);
    }

    /// A path taken apart: its drive, if it names one, and its names, with
    /// slashes as backslashes, `.` the folder it is in and `..` the one
    /// above; the folder itself one empty name.
    pub fn parse(path: &str) -> Parsed {
        let (drive, rest) = match path.split_once(':') {
            Some((drive, rest)) => (drive.chars().next().map(|c| c.to_ascii_uppercase()), rest),
            None => (None, path),
        };
        let rest = rest.replace('/', "\\");
        let rest = rest.strip_prefix('\\').unwrap_or(&rest);
        let mut parts: Vec<String> = Vec::new();

        for part in rest.split('\\') {
            match part {
                "." => {}
                ".." => {
                    parts.pop();
                }
                _ => parts.push(part.to_string()),
            }
        }

        if parts.is_empty() {
            parts.push(String::new());
        }

        Parsed { drive, parts }
    }

    /// A file created, replacing anything there, and opened: its handle.
    /// Not searched for: the path given and nowhere else, and a path that
    /// names no drive names none mounted.
    pub fn create(&mut self, path: &str) -> Option<usize> {
        let parsed = Self::parse(path);
        let letter = parsed.drive?;
        let drive = self.drives.get(&letter)?;
        let host = drive.locate(&parsed.parts);
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&host)
            .ok()?;

        self.allocate(OpenFile {
            file,
            path: host,
            drive: letter,
        })
    }

    /// An open file by its handle.
    pub fn resolve(&mut self, handle: usize) -> Option<&mut OpenFile> {
        self.open.get_mut(&handle)
    }

    pub fn close(&mut self, handle: usize) -> bool {
        self.open.remove(&handle).is_some()
    }

    fn allocate(&mut self, file: OpenFile) -> Option<usize> {
        let handle =
            (FIRST_HANDLE..MAX_OPEN_FILES).find(|handle| !self.open.contains_key(handle))?;

        self.open.insert(handle, file);
        Some(handle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_paths_as_dos_reads_them() {
        assert_eq!(
            Files::parse("c:/oracle\\.\\x\\..\\OUT.TXT"),
            Parsed {
                drive: Some('C'),
                parts: vec!["oracle".into(), "OUT.TXT".into()]
            }
        );
        assert_eq!(Files::parse("C:\\").parts, vec![String::new()]);
        assert_eq!(Files::parse("NAME").drive, None);
    }

    #[test]
    fn creates_files_from_handle_five() {
        let root = std::env::temp_dir().join(format!("winbox-files-{}", std::process::id()));

        std::fs::create_dir_all(root.join("ORACLE")).unwrap();

        let mut files = Files::new();

        files.mount('C', HostDrive { root: root.clone() });
        assert_eq!(files.create("C:\\oracle\\a.out"), Some(5));
        assert_eq!(files.create("C:\\ORACLE\\B.OUT"), Some(6));
        assert_eq!(files.resolve(5).unwrap().write(b"hi"), 2);
        assert!(files.close(5));
        assert_eq!(files.create("C:\\ORACLE\\C.OUT"), Some(5));
        assert_eq!(files.create("C.OUT"), None);
        assert_eq!(
            std::fs::read(root.join("ORACLE").join("A.OUT")).unwrap(),
            b"hi"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
