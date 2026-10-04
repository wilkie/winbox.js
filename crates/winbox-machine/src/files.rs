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
            path = Self::locate_in(&path, part);
        }

        path
    }

    /// A name in a host folder, found without regard to case, else as it
    /// is, upper case.
    fn locate_in(folder: &std::path::Path, name: &str) -> PathBuf {
        std::fs::read_dir(folder)
            .ok()
            .and_then(|entries| {
                entries
                    .flatten()
                    .find(|entry| {
                        entry
                            .file_name()
                            .to_string_lossy()
                            .eq_ignore_ascii_case(name)
                    })
                    .map(|entry| entry.path())
            })
            .unwrap_or_else(|| folder.join(name.to_ascii_uppercase()))
    }
}

/// A file or folder as a directory lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// Its name, upper case, as DOS has it.
    pub name: String,
    /// Its attributes: 10h a folder, 20h a file to be archived.
    pub attributes: u8,
    pub size: u32,
    /// When it was last written: year, month, day, hour, minute, second.
    pub modified: [u16; 6],
}

/// Days since 1970 as a year, a month and a day of the proleptic Gregorian
/// calendar.
pub fn civil_from_days(days: i64) -> (i64, u16, u16) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted + 2) / 5 + 1) as u16;
    let month = if shifted < 10 {
        shifted + 3
    } else {
        shifted - 9
    } as u16;
    let year = year_of_era + era * 400 + i64::from(month <= 2);

    (year, month, day)
}

/// A year, month and day as days since 1970.
pub fn days_from_civil(year: i64, month: u16, day: u16) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year.rem_euclid(400);
    let month = i64::from(month);
    let day_of_year =
        (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;

    era * 146_097 + day_of_era - 719_468
}

/// A host file's entry.
fn entry_of(path: &std::path::Path) -> Option<Entry> {
    let metadata = std::fs::metadata(path).ok()?;
    let seconds = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_secs() as i64);
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let of_day = seconds.rem_euclid(86_400);

    Some(Entry {
        name: path.file_name()?.to_string_lossy().to_ascii_uppercase(),
        attributes: if metadata.is_dir() { 0x10 } else { 0x20 },
        size: metadata.len().min(u64::from(u32::MAX)) as u32,
        modified: [
            year as u16,
            month,
            day,
            (of_day / 3600) as u16,
            (of_day / 60 % 60) as u16,
            (of_day % 60) as u16,
        ],
    })
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

    pub fn size(&self) -> u64 {
        self.file.metadata().map_or(0, |metadata| metadata.len())
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
    /// Attributes set on host files, which keep none of DOS's.
    attributes: HashMap<PathBuf, u8>,
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
            attributes: HashMap::new(),
        }
    }

    pub fn mount(&mut self, letter: char, drive: HostDrive) {
        let letter = letter.to_ascii_uppercase();

        self.drives.insert(letter, drive);
        self.pwd
            .entry(letter)
            .or_insert_with(|| format!("{letter}:\\"));
    }

    /// Whether a drive is there.
    pub fn mounted(&self, letter: char) -> bool {
        self.drives.contains_key(&letter.to_ascii_uppercase())
    }

    /// A drive's current directory, `C:\` and its folders each ending in
    /// a backslash.
    pub fn current(&self, letter: char) -> String {
        self.pwd
            .get(&letter)
            .cloned()
            .unwrap_or_else(|| format!("{letter}:\\"))
    }

    pub fn set_current(&mut self, letter: char, path: String) {
        self.pwd.insert(letter, path);
    }

    /// Where a drive's folder is on the host.
    fn host(&self, letter: char, parts: &[String]) -> Option<PathBuf> {
        Some(self.drives.get(&letter)?.locate(parts))
    }

    /// Whether a folder is there.
    pub fn is_directory(&self, letter: char, parts: &[String]) -> bool {
        self.host(letter, parts).is_some_and(|path| path.is_dir())
    }

    /// What a folder holds, as DOS lists it: `.` and `..` first in a folder
    /// not the root, then by name -- a host's folder keeps no order of its
    /// own, where a FAT's is the order its entries were made in.
    pub fn list(&self, letter: char, parts: &[String]) -> Option<Vec<Entry>> {
        let path = self.host(letter, parts)?;
        let mut entries: Vec<Entry> = std::fs::read_dir(&path)
            .ok()?
            .flatten()
            .filter_map(|entry| entry_of(&entry.path()))
            .map(|mut entry| {
                if let Some(&attributes) = self.attributes.get(&path.join(&entry.name)) {
                    entry.attributes = attributes;
                }

                entry
            })
            .collect();

        entries.sort_by(|a, b| a.name.cmp(&b.name));

        if parts.iter().any(|part| !part.is_empty()) {
            let folder = entry_of(&path)?;

            for name in ["..", "."] {
                entries.insert(
                    0,
                    Entry {
                        name: name.to_string(),
                        ..folder.clone()
                    },
                );
            }
        }

        Some(entries)
    }

    /// An entry of a folder, by its name.
    pub fn lookup(&self, letter: char, parts: &[String], name: &str) -> Option<Entry> {
        self.list(letter, parts)?
            .into_iter()
            .find(|entry| entry.name.eq_ignore_ascii_case(name))
    }

    /// A file let go of.
    pub fn unlink(&mut self, letter: char, parts: &[String], name: &str) -> bool {
        let Some(mut path) = self.host(letter, parts) else {
            return false;
        };

        path = HostDrive::locate_in(&path, name);
        std::fs::remove_file(&path).is_ok() || std::fs::remove_dir(&path).is_ok()
    }

    pub fn make_directory(&mut self, letter: char, parts: &[String], name: &str) -> bool {
        self.host(letter, parts)
            .is_some_and(|path| std::fs::create_dir(path.join(name.to_ascii_uppercase())).is_ok())
    }

    pub fn rename(&mut self, letter: char, from: (&[String], &str), to: (&[String], &str)) -> bool {
        let (Some(source), Some(target)) = (self.host(letter, from.0), self.host(letter, to.0))
        else {
            return false;
        };
        let source = HostDrive::locate_in(&source, from.1);

        std::fs::rename(source, target.join(to.1.to_ascii_uppercase())).is_ok()
    }

    /// A file's attributes set, as a host file cannot keep them.
    pub fn set_attributes(&mut self, letter: char, parts: &[String], name: &str, attributes: u8) {
        if let Some(path) = self.host(letter, parts) {
            let found = self
                .lookup(letter, parts, name)
                .map_or(name.to_ascii_uppercase(), |entry| entry.name);

            self.attributes.insert(path.join(found), attributes);
        }
    }

    /// A file opened, looked for -- a path that names no drive -- in the
    /// current directory, then Windows' and its system directory: its
    /// handle.
    pub fn open(&mut self, path: &str) -> Option<usize> {
        let places: Vec<String> = if path.contains(':') {
            vec![String::new()]
        } else {
            vec![
                self.path(),
                "C:\\WINDOWS\\".to_string(),
                "C:\\WINDOWS\\SYSTEM\\".to_string(),
            ]
        };

        for place in places {
            let parsed = Self::parse(&format!("{place}{path}"));
            let Some(letter) = parsed.drive else {
                continue;
            };
            let Some(drive) = self.drives.get(&letter) else {
                continue;
            };
            let host = drive.locate(&parsed.parts);

            if !host.is_file() {
                continue;
            }

            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .open(&host)
                .or_else(|_| File::open(&host))
                .ok()?;

            return self.allocate(OpenFile {
                file,
                path: host,
                drive: letter,
            });
        }

        None
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
