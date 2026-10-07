//! DOS's files, as winbox.js's `FileManager` keeps them: drives by letter,
//! each a file system, a current directory, and the open files by handle.
//! A drive is a directory of the host's (`HostDrive`) or a tree held in
//! memory (`MemoryDrive`), its names found without regard to case, as DOS
//! finds them.

mod host;
mod memory;

use std::collections::HashMap;
use std::fmt::Debug;
use std::io::{ErrorKind, SeekFrom};

pub use host::{HostDrive, HostFile};
pub use memory::{Change, MemoryDrive, MemoryFile, Stored, WallTime, host_seconds};

/// The most files open at once.
pub const MAX_OPEN_FILES: usize = 512;

/// A drive's size and room as DOS's function 36h answers them: sectors to a
/// cluster, the clusters free, bytes to a sector and all the clusters.
///
/// A drive here has no FAT of its own, so it answers what DOSBox answers for
/// the drives the oracle's Windows ran on, which are folders of the host's
/// as these are. DOSBox 0.74-3's `MOUNT` gives a folder a fixed geometry,
/// whatever the host's disk holds (`dos_programs.cpp`): "512,127,16383,4031"
/// for a hard disk, about 1 GB with about 250 MB free, and "512,1,2880,2880"
/// for a floppy, all of it free; `localDrive::AllocationInfo` answers it as
/// given. **Recorded** by `diskfree`: C: answers 007Fh, 0FBFh, 0200h and
/// 3FFFh.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Allocation {
    pub sectors_per_cluster: u16,
    pub free_clusters: u16,
    pub bytes_per_sector: u16,
    pub clusters: u16,
}

impl Allocation {
    /// DOSBox's hard disk: `mount c` of a folder.
    pub const FIXED: Self = Self {
        sectors_per_cluster: 127,
        free_clusters: 4031,
        bytes_per_sector: 512,
        clusters: 16383,
    };

    /// DOSBox's floppy: `mount a` of a folder with `-t floppy`.
    pub const FLOPPY: Self = Self {
        sectors_per_cluster: 1,
        free_clusters: 2880,
        bytes_per_sector: 512,
        clusters: 2880,
    };
}

/// The first handle a file is given: 0 to 4 are DOS's own devices, so a
/// file's is the first free after them (`devinfo`).
const FIRST_HANDLE: usize = 5;

/// A drive's file system, which DOS's files are kept on: a directory of
/// the host's (`HostDrive`), or a tree held in memory (`MemoryDrive`). A
/// path is given as its names, the folder's own an empty one, each found
/// without regard to case.
pub trait Volume: Debug {
    /// Whether the drive is removable, as a floppy is.
    fn removable(&self) -> bool;

    /// Whether a folder is there.
    fn is_directory(&self, parts: &[String]) -> bool;

    /// What a path names, as its folder lists it.
    fn entry(&self, parts: &[String]) -> Option<Entry>;

    /// What a folder holds, in no order; `None` where it is not there.
    fn children(&self, parts: &[String]) -> Option<Vec<Entry>>;

    /// A file's bytes.
    fn read(&self, parts: &[String]) -> Option<Vec<u8>>;

    /// A file there opened, at its start; `NotFound` where none is, to be
    /// looked for elsewhere, another error where it could not be opened.
    fn open(&mut self, parts: &[String]) -> std::io::Result<Body>;

    /// A file created where its folder is, replacing anything there, and
    /// opened.
    fn create(&mut self, parts: &[String]) -> Option<Body>;

    /// A file or an empty folder let go of.
    fn unlink(&mut self, parts: &[String]) -> bool;

    /// A folder made.
    fn mkdir(&mut self, parts: &[String]) -> bool;

    /// A file or folder moved, or renamed.
    fn rename(&mut self, from: &[String], to: &[String]) -> bool;

    /// The drive held in memory this is, for what is written on it to be
    /// told (`MemoryDrive::changes_from`); none for a host's.
    fn memory(&self) -> Option<&MemoryDrive> {
        None
    }

    /// Its size and room, as DOSBox answers them for a folder mounted
    /// (`Allocation`); none for a removable drive with nothing on it. Under
    /// DOSBox the oracle's A: is the BIOS's floppy drive with nothing
    /// mounted: `GetDriveType` calls it removable (`drivetyp`), and 36h
    /// answers `FFFFh` for it (`diskfree`), as for no drive. An empty
    /// removable drive stands in for it.
    fn allocation(&self) -> Option<Allocation> {
        if !self.removable() {
            Some(Allocation::FIXED)
        } else if self
            .children(&[])
            .is_some_and(|entries| !entries.is_empty())
        {
            Some(Allocation::FLOPPY)
        } else {
            None
        }
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

/// Seconds since 1970 as a file's time: year, month, day, hour, minute,
/// second.
pub(crate) fn stamp(seconds: i64) -> [u16; 6] {
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let of_day = seconds.rem_euclid(86_400);

    [
        year as u16,
        month,
        day,
        (of_day / 3600) as u16,
        (of_day / 60 % 60) as u16,
        (of_day % 60) as u16,
    ]
}

/// An open file's bytes: a host's file, or a file of a drive held in
/// memory.
#[derive(Debug)]
pub enum Body {
    Host(HostFile),
    Memory(MemoryFile),
}

/// A file open, and where in it the next read or write is.
#[derive(Debug)]
pub struct OpenFile {
    pub body: Body,
    pub drive: char,
    /// Its path as DOS names it: its drive, and its folders' and its own
    /// names, upper case.
    pub dos_path: String,
}

impl OpenFile {
    /// Bytes written where the file is at; how many.
    pub fn write(&mut self, bytes: &[u8]) -> usize {
        match &mut self.body {
            Body::Host(file) => file.write(bytes),
            Body::Memory(file) => file.write(bytes),
        }
    }

    /// Bytes read from where the file is at.
    pub fn read(&mut self, length: usize) -> Vec<u8> {
        match &mut self.body {
            Body::Host(file) => file.read(length),
            Body::Memory(file) => file.read(length),
        }
    }

    pub fn seek(&mut self, to: SeekFrom) -> Option<u64> {
        match &mut self.body {
            Body::Host(file) => file.seek(to),
            Body::Memory(file) => file.seek(to),
        }
    }

    /// The file cut to a length, as a profile written back shorter is.
    pub fn truncate(&mut self, length: u64) -> bool {
        match &mut self.body {
            Body::Host(file) => file.truncate(length),
            Body::Memory(file) => file.truncate(length),
        }
    }

    pub fn size(&self) -> u64 {
        match &self.body {
            Body::Host(file) => file.size(),
            Body::Memory(file) => file.size(),
        }
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
    drives: HashMap<char, Box<dyn Volume>>,
    /// Each drive's current directory, and the current drive.
    pwd: HashMap<char, String>,
    pub drive: char,
    open: HashMap<usize, OpenFile>,
    /// Attributes set on files, which no drive keeps of its own, by path.
    attributes: HashMap<String, u8>,
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

    pub fn mount(&mut self, letter: char, drive: impl Volume + 'static) {
        let letter = letter.to_ascii_uppercase();

        self.drives.insert(letter, Box::new(drive));
        self.pwd
            .entry(letter)
            .or_insert_with(|| format!("{letter}:\\"));
    }

    /// A drive mounted, where it is held in memory, as programs have
    /// written it.
    pub fn memory(&self, letter: char) -> Option<&MemoryDrive> {
        self.drives.get(&letter.to_ascii_uppercase())?.memory()
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

    /// A drive's size and room (`Volume::allocation`); none where no drive
    /// is, or no disk is in it.
    pub fn allocation(&self, letter: char) -> Option<Allocation> {
        self.drives.get(&letter)?.allocation()
    }

    /// Whether a drive is removable.
    pub fn removable(&self, letter: char) -> bool {
        self.drives
            .get(&letter)
            .is_some_and(|drive| drive.removable())
    }

    /// Whether a folder is there.
    pub fn is_directory(&self, letter: char, parts: &[String]) -> bool {
        self.drives
            .get(&letter)
            .is_some_and(|drive| drive.is_directory(parts))
    }

    /// The key a file's attributes are kept by.
    fn key(letter: char, parts: &[String], name: &str) -> String {
        let mut key = format!("{letter}:");

        for part in parts.iter().filter(|part| !part.is_empty()) {
            key.push('\\');
            key.push_str(&part.to_ascii_uppercase());
        }

        key.push('\\');
        key.push_str(&name.to_ascii_uppercase());
        key
    }

    /// What a folder holds, as DOS lists it: `.` and `..` first in a folder
    /// not the root, then by name -- a host's folder keeps no order of its
    /// own, where a FAT's is the order its entries were made in.
    pub fn list(&self, letter: char, parts: &[String]) -> Option<Vec<Entry>> {
        let drive = self.drives.get(&letter)?;
        let mut entries: Vec<Entry> = drive
            .children(parts)?
            .into_iter()
            .map(|mut entry| {
                if let Some(&attributes) =
                    self.attributes.get(&Self::key(letter, parts, &entry.name))
                {
                    entry.attributes = attributes;
                }

                entry
            })
            .collect();

        entries.sort_by(|a, b| a.name.cmp(&b.name));

        if parts.iter().any(|part| !part.is_empty()) {
            let folder = drive.entry(parts)?;

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

    fn joined(parts: &[String], name: &str) -> Vec<String> {
        let mut joined: Vec<String> = parts
            .iter()
            .filter(|part| !part.is_empty())
            .cloned()
            .collect();

        joined.push(name.to_string());
        joined
    }

    /// A file or an empty folder let go of.
    pub fn unlink(&mut self, letter: char, parts: &[String], name: &str) -> bool {
        self.drives
            .get_mut(&letter)
            .is_some_and(|drive| drive.unlink(&Self::joined(parts, name)))
    }

    pub fn make_directory(&mut self, letter: char, parts: &[String], name: &str) -> bool {
        self.drives
            .get_mut(&letter)
            .is_some_and(|drive| drive.mkdir(&Self::joined(parts, name)))
    }

    pub fn rename(&mut self, letter: char, from: (&[String], &str), to: (&[String], &str)) -> bool {
        self.drives.get_mut(&letter).is_some_and(|drive| {
            drive.rename(&Self::joined(from.0, from.1), &Self::joined(to.0, to.1))
        })
    }

    /// A file's attributes set, as no drive keeps them.
    pub fn set_attributes(&mut self, letter: char, parts: &[String], name: &str, attributes: u8) {
        self.attributes
            .insert(Self::key(letter, parts, name), attributes);
    }

    /// A file's bytes, from a folder named by its path, the file found by
    /// its name without regard to case: its path, as DOS names it, and its
    /// bytes.
    pub fn read_from(&self, folder: &str, name: &str) -> Option<(String, Vec<u8>)> {
        let parsed = Self::parse(folder);
        let letter = parsed.drive?;
        let entry = self.lookup(letter, &parsed.parts, name)?;
        let bytes = self
            .drives
            .get(&letter)?
            .read(&Self::joined(&parsed.parts, &entry.name))?;
        let path = format!("{}\\{}", folder.trim_end_matches('\\'), entry.name);

        Some((path, bytes))
    }

    /// Whether a folder named by its path is there.
    pub fn folder_exists(&self, folder: &str) -> bool {
        let parsed = Self::parse(folder);

        parsed
            .drive
            .is_some_and(|letter| self.is_directory(letter, &parsed.parts))
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
            let Some(drive) = self.drives.get_mut(&letter) else {
                continue;
            };
            let body = match drive.open(&parsed.parts) {
                Ok(body) => body,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(_) => return None,
            };
            let dos_path = Self::dos_path(letter, &parsed.parts);

            return self.allocate(OpenFile {
                body,
                drive: letter,
                dos_path,
            });
        }

        None
    }

    /// A path as DOS names it: `C:\\` and its names, upper case.
    fn dos_path(letter: char, parts: &[String]) -> String {
        let names: Vec<String> = parts
            .iter()
            .filter(|part| !part.is_empty())
            .map(|part| part.to_ascii_uppercase())
            .collect();

        format!("{letter}:\\{}", names.join("\\"))
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
        let body = self.drives.get_mut(&letter)?.create(&parsed.parts)?;

        self.allocate(OpenFile {
            body,
            drive: letter,
            dos_path: Self::dos_path(letter, &parsed.parts),
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
    use std::rc::Rc;

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

        files.mount('C', HostDrive::new(root.clone()));
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

    #[test]
    fn creates_memory_files_from_handle_five() {
        let mut drive = MemoryDrive::new();

        drive.add_folder("ORACLE", 0);

        let mut files = Files::new();

        files.mount('C', drive);
        assert_eq!(files.create("C:\\oracle\\a.out"), Some(5));
        assert_eq!(files.create("C:\\ORACLE\\B.OUT"), Some(6));
        assert_eq!(files.resolve(5).unwrap().write(b"hi"), 2);
        assert!(files.close(5));
        assert_eq!(files.create("C:\\ORACLE\\C.OUT"), Some(5));
        assert_eq!(files.create("C.OUT"), None);
        // Not where no folder is.
        assert_eq!(files.create("C:\\NONE\\D.OUT"), None);
        assert_eq!(
            files.read_from("C:\\ORACLE", "a.out"),
            Some(("C:\\ORACLE\\A.OUT".to_string(), b"hi".to_vec()))
        );
    }

    /// A folder of more files than one of FAT's clusters has entries for,
    /// and past the 1,024 the TypeScript engine's FAT once stopped at:
    /// Catz's `PTZFILES\CAT\RESOURCE` holds nearly 300. Each file created
    /// is listed and opened again.
    #[test]
    fn holds_a_folder_of_many_files() {
        let mut drive = MemoryDrive::new();

        drive.add_folder("MANY", 0);

        let mut files = Files::new();

        files.mount('C', drive);

        for number in 0..1500 {
            let handle = files.create(&format!("C:\\MANY\\F{number}.DAT")).unwrap();

            assert!(files.close(handle));
        }

        let listed = files.list('C', &["MANY".into()]).unwrap();

        assert_eq!(listed.len(), 2 + 1500);
        assert!(files.open("C:\\MANY\\F1499.DAT").is_some());
    }

    /// A drive held in memory with what the tests below look for: a file
    /// at the root, Windows' folder and its system folder.
    fn installation() -> MemoryDrive {
        let at = days_from_civil(1992, 3, 10) * 86_400 + 3 * 3600 + 10 * 60 + 2;
        let mut drive = MemoryDrive::new();

        assert!(drive.add_folder("C:\\WINDOWS", at));
        assert!(drive.add_file("C:\\WINDOWS\\WIN.INI", b"[windows]\r\n".to_vec(), at));
        assert!(drive.add_file("\\windows\\system\\gdi.exe", vec![1, 2, 3], at + 60));
        assert!(drive.add_file("AUTOEXEC.BAT", b"@ECHO OFF\r\n".to_vec(), at));
        drive
    }

    #[test]
    fn lists_memory_folders_as_dos_does() {
        let mut files = Files::new();

        files.mount('C', installation());

        let root = files.list('C', &[String::new()]).unwrap();
        let names: Vec<&str> = root.iter().map(|entry| entry.name.as_str()).collect();

        assert_eq!(names, ["AUTOEXEC.BAT", "WINDOWS"]);
        assert_eq!(root[0].attributes, 0x20);
        assert_eq!(root[0].size, 11);
        assert_eq!(root[0].modified, [1992, 3, 10, 3, 10, 2]);
        assert_eq!(root[1].attributes, 0x10);

        let windows = files.list('C', &["windows".into()]).unwrap();
        let names: Vec<&str> = windows.iter().map(|entry| entry.name.as_str()).collect();

        assert_eq!(names, [".", "..", "SYSTEM", "WIN.INI"]);
        assert_eq!(windows[0].modified, [1992, 3, 10, 3, 10, 2]);
        // A folder made for a file is written when the file is.
        assert_eq!(
            files
                .lookup('C', &["WINDOWS".into()], "system")
                .unwrap()
                .modified,
            [1992, 3, 10, 3, 11, 2]
        );
        assert!(files.is_directory('C', &["Windows".into(), "System".into()]));
        assert!(!files.is_directory('C', &["WINDOWS".into(), "WIN.INI".into()]));
        assert!(files.is_directory('C', &[String::new()]));
        assert!(files.folder_exists("C:\\WINDOWS\\SYSTEM"));
        assert!(files.list('C', &["NONE".into()]).is_none());
    }

    #[test]
    fn opens_memory_files_where_dos_looks() {
        let mut files = Files::new();

        files.mount('C', installation());

        // A path that names no drive: the current directory, then Windows'
        // and its system directory.
        let gdi = files.open("GDI.EXE").unwrap();

        assert_eq!(
            files.resolve(gdi).unwrap().dos_path,
            "C:\\WINDOWS\\SYSTEM\\GDI.EXE"
        );
        assert_eq!(files.resolve(gdi).unwrap().read(16), [1, 2, 3]);
        assert_eq!(files.resolve(gdi).unwrap().read(16), [0u8; 0]);
        assert!(files.open("c:\\autoexec.bat").is_some());
        assert_eq!(files.open("NONE.TXT"), None);
        // A folder is no file to open.
        assert_eq!(files.open("C:\\WINDOWS"), None);
    }

    #[test]
    fn reads_seeks_and_writes_memory_files() {
        let mut files = Files::new();

        files.mount('C', installation());

        let handle = files.open("C:\\AUTOEXEC.BAT").unwrap();
        let file = files.resolve(handle).unwrap();

        assert_eq!(file.size(), 11);
        assert_eq!(file.seek(SeekFrom::Start(1)), Some(1));
        assert_eq!(file.read(4), b"ECHO");
        assert_eq!(file.seek(SeekFrom::Current(-2)), Some(3));
        assert_eq!(file.seek(SeekFrom::Current(-4)), None);
        assert_eq!(file.seek(SeekFrom::End(2)), Some(13));
        // Past the end: nothing read, and where it is kept.
        assert_eq!(file.read(4), [0u8; 0]);
        assert_eq!(file.seek(SeekFrom::Current(0)), Some(13));
        // A write past the end fills up to it with noughts.
        assert_eq!(file.write(b"X"), 1);
        assert_eq!(file.size(), 14);
        assert_eq!(file.write(b""), 0);
        assert!(file.truncate(3));
        assert_eq!(file.size(), 3);
        assert_eq!(
            files.read_from("C:\\", "AUTOEXEC.BAT").unwrap().1,
            b"@EC".to_vec()
        );

        let handle = files.open("C:\\AUTOEXEC.BAT").unwrap();
        let file = files.resolve(handle).unwrap();

        assert!(file.truncate(14));
        assert_eq!(file.seek(SeekFrom::Start(13)), Some(13));
        assert_eq!(file.read(1), [0]);
    }

    #[test]
    fn shares_memory_files_until_written() {
        let installed = installation();
        let mut files = Files::new();

        files.mount('C', installed.clone());

        let handle = files.open("C:\\WINDOWS\\WIN.INI").unwrap();

        assert_eq!(files.resolve(handle).unwrap().write(b"[changed]"), 9);

        let handle = files.create("C:\\AUTOEXEC.BAT").unwrap();

        assert_eq!(files.resolve(handle).unwrap().write(b"REM"), 3);
        assert!(files.unlink('C', &["WINDOWS".into(), "SYSTEM".into()], "GDI.EXE"));
        assert!(files.rename(
            'C',
            (&[String::new()], "AUTOEXEC.BAT"),
            (&[String::new()], "A.BAT")
        ));

        // The drive mounted sees what was written.
        assert_eq!(
            files.read_from("C:\\WINDOWS", "WIN.INI").unwrap().1,
            b"[changed]\r\n".to_vec()
        );
        assert_eq!(files.read_from("C:\\", "A.BAT").unwrap().1, b"REM".to_vec());
        assert!(files.read_from("C:\\", "AUTOEXEC.BAT").is_none());
        // The drive it was made from does not.
        assert_eq!(
            installed.data("C:\\WINDOWS\\WIN.INI").unwrap().as_slice(),
            b"[windows]\r\n"
        );
        assert_eq!(
            installed.data("AUTOEXEC.BAT").unwrap().as_slice(),
            b"@ECHO OFF\r\n"
        );
        assert_eq!(
            installed
                .data("WINDOWS\\SYSTEM\\GDI.EXE")
                .unwrap()
                .as_slice(),
            [1, 2, 3]
        );
        assert!(installed.data("A.BAT").is_none());
    }

    #[test]
    fn tells_what_was_written_and_puts_it_back() {
        fn noon() -> i64 {
            days_from_civil(1993, 1, 2) * 86_400 + 12 * 3600
        }

        let mut installed = installation();

        installed.set_clock(noon);

        let mut files = Files::new();

        files.mount('C', installed.clone());

        // Nothing written, nothing told; read, a file is not written.
        let handle = files.open("C:\\AUTOEXEC.BAT").unwrap();

        files.resolve(handle).unwrap().read(4);
        assert_eq!(
            files.memory('C').unwrap().changes_from(&installed),
            Vec::new()
        );

        // A file written in place, and one written back as it was.
        let handle = files.open("C:\\WINDOWS\\WIN.INI").unwrap();

        files.resolve(handle).unwrap().write(b"[changed]");

        let handle = files.open("C:\\AUTOEXEC.BAT").unwrap();

        files.resolve(handle).unwrap().write(b"@ECHO");
        // A folder made, with a file in it, still open; a file let go of;
        // a folder taking a file's place.
        assert!(files.make_directory('C', &[String::new()], "GAMES"));

        let open = files.create("C:\\GAMES\\SKI.INI").unwrap();

        files.resolve(open).unwrap().write(b"[ski]");
        assert!(files.unlink('C', &["WINDOWS".into(), "SYSTEM".into()], "GDI.EXE"));
        assert!(files.unlink('C', &[String::new()], "AUTOEXEC.BAT"));
        assert!(files.make_directory('C', &[String::new()], "AUTOEXEC.BAT"));

        let at = noon();
        let changes = files.memory('C').unwrap().changes_from(&installed);

        assert_eq!(
            changes,
            [
                Change::Removed {
                    path: "AUTOEXEC.BAT".into()
                },
                Change::Removed {
                    path: "WINDOWS\\SYSTEM\\GDI.EXE".into()
                },
                Change::Folder {
                    path: "AUTOEXEC.BAT".into(),
                    modified: at
                },
                Change::Folder {
                    path: "GAMES".into(),
                    modified: at
                },
                // Written, a file in it let go of.
                Change::Folder {
                    path: "WINDOWS\\SYSTEM".into(),
                    modified: at
                },
                Change::File {
                    path: "GAMES\\SKI.INI".into(),
                    data: Rc::new(b"[ski]".to_vec()),
                    modified: at
                },
                Change::File {
                    path: "WINDOWS\\WIN.INI".into(),
                    data: Rc::new(b"[changed]\r\n".to_vec()),
                    modified: at
                },
            ]
        );

        // Put back on a drive made afresh as the first was, they are what
        // it tells, and it is what the drive written is.
        let mut again = installation();

        again.apply(&changes);
        assert_eq!(again.changes_from(&installed), changes);

        let mut written = Files::new();
        let mut made = Files::new();

        written.mount('C', files.memory('C').unwrap().clone());
        made.mount('C', again);

        for folder in ["C:\\", "C:\\WINDOWS", "C:\\WINDOWS\\SYSTEM", "C:\\GAMES"] {
            let parts = Files::parse(folder).parts;

            assert_eq!(
                written.list('C', &parts),
                made.list('C', &parts),
                "{folder}"
            );
        }

        assert_eq!(
            made.read_from("C:\\GAMES", "SKI.INI").unwrap().1,
            b"[ski]".to_vec()
        );
        // A folder let go of goes with everything in it.
        let mut drive = installation();

        assert!(drive.remove("WINDOWS"));
        assert!(!drive.remove("WINDOWS\\WIN.INI"));
        assert_eq!(
            drive.changes_from(&installation()),
            [Change::Removed {
                path: "WINDOWS".into()
            }]
        );
    }

    #[test]
    fn stamps_memory_files_when_written() {
        fn noon() -> i64 {
            days_from_civil(1993, 1, 2) * 86_400 + 12 * 3600
        }

        let mut drive = installation();

        drive.set_clock(noon);

        let mut files = Files::new();
        let root = [String::new()];

        files.mount('C', drive);

        let handle = files.open("C:\\AUTOEXEC.BAT").unwrap();

        // Read, a file is not written.
        files.resolve(handle).unwrap().read(4);
        assert_eq!(
            files.lookup('C', &root, "AUTOEXEC.BAT").unwrap().modified,
            [1992, 3, 10, 3, 10, 2]
        );
        files.resolve(handle).unwrap().write(b"!");
        assert_eq!(
            files.lookup('C', &root, "AUTOEXEC.BAT").unwrap().modified,
            [1993, 1, 2, 12, 0, 0]
        );
        // Nor is its folder; a file made in it writes it.
        assert_eq!(
            files.lookup('C', &root, "WINDOWS").unwrap().modified,
            [1992, 3, 10, 3, 10, 2]
        );
        files.create("C:\\WINDOWS\\NEW.INI").unwrap();
        assert_eq!(
            files.lookup('C', &root, "WINDOWS").unwrap().modified,
            [1993, 1, 2, 12, 0, 0]
        );
    }

    #[test]
    fn keeps_memory_files_open_when_let_go_of() {
        let mut files = Files::new();

        files.mount('C', installation());

        let handle = files.open("C:\\AUTOEXEC.BAT").unwrap();

        assert!(files.unlink('C', &[String::new()], "AUTOEXEC.BAT"));
        assert!(!files.unlink('C', &[String::new()], "AUTOEXEC.BAT"));
        assert_eq!(files.resolve(handle).unwrap().read(5), b"@ECHO");

        // Made again over a file open, the file open is emptied, as a
        // host's is.
        let first = files.create("C:\\NEW.TXT").unwrap();

        files.resolve(first).unwrap().write(b"abc");

        let second = files.create("C:\\NEW.TXT").unwrap();

        assert_eq!(files.resolve(first).unwrap().size(), 0);
        assert_eq!(files.resolve(second).unwrap().size(), 0);
    }

    #[test]
    fn makes_removes_and_renames_memory_folders() {
        let mut files = Files::new();
        let root = [String::new()];
        let windows = ["WINDOWS".to_string()];

        files.mount('C', installation());
        files.mount('A', MemoryDrive::removable());
        assert!(files.removable('A'));
        assert!(!files.removable('C'));

        assert!(files.make_directory('C', &root, "temp"));
        assert!(!files.make_directory('C', &root, "TEMP"));
        assert!(!files.make_directory('C', &root, "AUTOEXEC.BAT"));
        // The folders above made, as the host's are.
        assert!(files.make_directory('C', &["A".into(), "B".into()], "C"));
        assert!(files.folder_exists("C:\\A\\B\\C"));

        // Only an empty folder is let go of.
        assert!(!files.unlink('C', &root, "WINDOWS"));
        assert!(files.unlink('C', &root, "TEMP"));
        assert!(!files.folder_exists("C:\\TEMP"));

        // Over a file, a file; over an empty folder, a folder; never a
        // folder into itself, nor a file over a folder.
        assert!(files.rename('C', (&windows, "WIN.INI"), (&root, "AUTOEXEC.BAT")));
        assert_eq!(
            files.read_from("C:\\", "AUTOEXEC.BAT").unwrap().1,
            b"[windows]\r\n".to_vec()
        );
        assert!(!files.rename('C', (&root, "AUTOEXEC.BAT"), (&root, "WINDOWS")));
        assert!(!files.rename('C', (&root, "WINDOWS"), (&windows, "INNER")));
        assert!(!files.rename('C', (&root, "WINDOWS"), (&root, "A")));
        assert!(files.rename('C', (&["A".into(), "B".into()], "C"), (&root, "D")));
        assert!(files.rename('C', (&root, "WINDOWS"), (&root, "D")));
        assert!(files.folder_exists("C:\\D\\SYSTEM"));
        assert!(files.rename('C', (&root, "d"), (&["X".into()], "WIN")));
        assert!(files.folder_exists("C:\\X\\WIN\\SYSTEM"));
        assert!(files.rename('C', (&root, "AUTOEXEC.BAT"), (&root, "autoexec.bat")));
        assert!(!files.rename('C', (&root, "NONE"), (&root, "OTHER")));
    }

    /// The same calls on a host's directory over an installation and on a
    /// drive held in memory that holds what it does: the same answers, and
    /// the same files.
    #[test]
    fn host_and_memory_drives_agree() {
        let root = std::env::temp_dir().join(format!("winbox-agree-{}", std::process::id()));
        let lower = root.join("lower");
        let upper = root.join("upper");

        std::fs::create_dir_all(lower.join("WINDOWS").join("SYSTEM")).unwrap();
        std::fs::create_dir_all(&upper).unwrap();
        std::fs::write(lower.join("WINDOWS").join("WIN.INI"), b"[windows]\r\n").unwrap();
        std::fs::write(
            lower.join("WINDOWS").join("SYSTEM").join("GDI.EXE"),
            [1, 2, 3],
        )
        .unwrap();
        std::fs::write(lower.join("AUTOEXEC.BAT"), b"@ECHO OFF\r\n").unwrap();

        let mut host = Files::new();
        let mut memory = Files::new();

        host.mount('C', HostDrive::over(upper.clone(), lower.clone()));
        memory.mount('C', installation());

        for files in [&mut host, &mut memory] {
            let ini = files.open("C:\\windows\\win.ini").unwrap();
            let file = files.resolve(ini).unwrap();

            file.seek(SeekFrom::End(0));
            assert_eq!(file.write(b"x=1\r\n"), 5);

            let made = files.create("C:\\WINDOWS\\NEW.TXT").unwrap();

            files.resolve(made).unwrap().write(b"new");
            assert!(files.make_directory('C', &[String::new()], "TEMP"));
            assert!(files.rename(
                'C',
                (&["WINDOWS".into()], "NEW.TXT"),
                (&["TEMP".into()], "OLD.TXT"),
            ));
            assert!(files.unlink('C', &[String::new()], "AUTOEXEC.BAT"));
            assert!(files.create("C:\\NONE\\X").is_none());
        }

        let shape = |files: &Files, folder: &[String]| -> Vec<(String, u8, Option<u32>)> {
            files
                .list('C', folder)
                .unwrap()
                .into_iter()
                .map(|entry| {
                    // A host's folder has a size of its own; DOS's none.
                    let size = (entry.attributes & 0x10 == 0).then_some(entry.size);

                    (entry.name, entry.attributes, size)
                })
                .collect()
        };

        for folder in [
            vec![String::new()],
            vec!["WINDOWS".into()],
            vec!["WINDOWS".into(), "SYSTEM".into()],
            vec!["TEMP".into()],
        ] {
            assert_eq!(shape(&host, &folder), shape(&memory, &folder), "{folder:?}");
        }

        for (folder, name) in [("C:\\WINDOWS", "WIN.INI"), ("C:\\TEMP", "OLD.TXT")] {
            assert_eq!(host.read_from(folder, name), memory.read_from(folder, name));
        }

        // Neither changed the installation beneath.
        assert_eq!(
            std::fs::read(lower.join("WINDOWS").join("WIN.INI")).unwrap(),
            b"[windows]\r\n"
        );
        assert!(lower.join("AUTOEXEC.BAT").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
