//! DOS's files, as winbox.js's `FileManager` keeps them: drives by letter,
//! each a file system, a current directory, and the open files by handle.
//! A drive is a directory of the host's (`HostDrive`), a tree held in
//! memory (`MemoryDrive`) or a disk image's FAT volume (`FatVolume`), its
//! names found without regard to case, as DOS finds them.

mod fat;
mod host;
mod mbr;
mod memory;
mod overlay;

use std::cell::Cell;
use std::collections::HashMap;
use std::fmt::Debug;
use std::io::{ErrorKind, SeekFrom};

use fat::same_name;
pub use fat::{FatError, FatVolume, ImageFile};
pub use host::{HostDrive, HostFile, HostLayer};
pub use mbr::{Sectors, is_floppy, volume_start};
pub use memory::{Change, MemoryDrive, MemoryFile, Stored, WallTime, host_seconds};
pub use overlay::Overlay;

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

    /// A file created with the attributes DOS's 3Ch was asked to make it
    /// with, which a disk image's entry keeps (`FatVolume`); a folder's
    /// drive keeps none.
    fn create_with(&mut self, parts: &[String], _attributes: u8) -> Option<Body> {
        self.create(parts)
    }

    /// A file or an empty folder let go of.
    fn unlink(&mut self, parts: &[String]) -> bool;

    /// A folder made.
    fn mkdir(&mut self, parts: &[String]) -> bool;

    /// An empty folder let go of, as DOS's 3Ah does: as `unlink`, but on a
    /// disk image, where deleting a file and removing a folder are DOSBox's
    /// two functions (`FileUnlink`, `RemoveDir`).
    fn remove_dir(&mut self, parts: &[String]) -> bool {
        self.unlink(parts)
    }

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

    /// Whether the drive is remote, as DOSBox's CD-ROM drives are
    /// (`isRemote`, `drive_iso.cpp` 374-376): IOCTL 4409h sets bit 12 of
    /// DX for it, and `GetDriveType` calls it `DRIVE_REMOTE`. A folder of
    /// the host's, or a disk image, is not.
    fn remote(&self) -> bool {
        false
    }

    /// The drive's own volume label, as a disk or disc keeps one; none for
    /// a folder, whose label DOSBox makes from its letter
    /// (`System::volume_label`).
    fn label(&self) -> Option<String> {
        None
    }

    /// The media byte DOSBox's table holds for the drive (`imgmount`,
    /// `dos_programs.cpp` 1095-1103, 1268): F0h for a floppy, F8h for a hard
    /// disk or a disc.
    fn media_byte(&self) -> u8 {
        if self.removable() { 0xf0 } else { 0xf8 }
    }

    /// The order a folder's entries are listed in (`Listing`).
    fn listing(&self) -> Listing {
        Listing::Sorted
    }

    /// A disk image's file's or folder's attributes, as DOSBox's
    /// `fatDrive::GetFileAttr` finds them; none for another drive, whose
    /// are its listing's.
    fn attributes(&self, _parts: &[String]) -> Option<u8> {
        None
    }

    /// A disk image's folder as DOSBox's search keeps it, by its first
    /// cluster, nought the root's; none for another drive, or a folder a
    /// search for folders does not find.
    fn search_folder(&self, _parts: &[String]) -> Option<u32> {
        None
    }

    /// A disk image's search carried on from a slot of a folder, as
    /// DOSBox's `FindNextInternal` carries it on: the entry found, and the
    /// slot after it in `at`; none for another drive.
    fn find_from(
        &self,
        _folder: u32,
        _attributes: u8,
        _pattern: &str,
        _at: &mut u16,
    ) -> Option<Entry> {
        None
    }

    /// A disk image as programs have written it; none for another drive.
    fn image(&self) -> Option<Vec<u8>> {
        None
    }
}

/// The order DOS's search lists a folder's entries in, as DOSBox's drives
/// list them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Listing {
    /// A folder of the host's: `.` and `..` in every folder, the root's
    /// too, then folders and files by name (`Files::list`).
    Sorted,
    /// A disk or disc image: its entries in the order the image keeps them,
    /// `.` and `..` only where the image has them, outside the root
    /// (`drive_fat.cpp` `FindNextInternal` 898-960, `drive_iso.cpp` 301).
    AsStored,
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

/// An open file's bytes: a host's file, a file of a drive held in memory,
/// or one of a disk image.
#[derive(Debug)]
pub enum Body {
    Host(HostFile),
    Memory(MemoryFile),
    Image(ImageFile),
}

/// A file open, and where in it the next read or write is.
#[derive(Debug)]
pub struct OpenFile {
    pub body: Body,
    pub drive: char,
    /// Its path as DOS names it: its drive, and its folders' and its own
    /// names, upper case.
    pub dos_path: String,
    /// DOS's clock as the file was last asked for (`Files::resolve`),
    /// seconds since 1970.
    now: Option<i64>,
    /// When it was last written, by DOS's clock: the stamp its entry is
    /// given as it is closed, as DOS gives a file written.
    written_at: Option<i64>,
}

impl Body {
    /// The file's entry stamped as last written at a time, seconds since
    /// 1970. Not a disk image's: DOSBox stamps nothing there, made,
    /// written or closed (`drive_fat.cpp` 270-275, 793-796).
    fn stamp(&mut self, seconds: i64) {
        match self {
            Body::Host(file) => file.stamp(seconds),
            Body::Memory(file) => file.stamp(seconds),
            Body::Image(_) => {}
        }
    }

    /// The file let go of: a disk image's writes its sector back
    /// (`fatFile::Close`).
    fn close(&mut self) {
        if let Body::Image(file) = self {
            file.close();
        }
    }
}

impl OpenFile {
    /// Bytes written where the file is at; how many.
    pub fn write(&mut self, bytes: &[u8]) -> usize {
        self.written_at = self.now.or(self.written_at);

        match &mut self.body {
            Body::Host(file) => file.write(bytes),
            Body::Memory(file) => file.write(bytes),
            Body::Image(file) => file.write(bytes),
        }
    }

    /// Bytes read from where the file is at.
    pub fn read(&mut self, length: usize) -> Vec<u8> {
        match &mut self.body {
            Body::Host(file) => file.read(length),
            Body::Memory(file) => file.read(length),
            Body::Image(file) => file.read(length),
        }
    }

    pub fn seek(&mut self, to: SeekFrom) -> Option<u64> {
        match &mut self.body {
            Body::Host(file) => file.seek(to),
            Body::Memory(file) => file.seek(to),
            Body::Image(file) => file.seek(to),
        }
    }

    /// The file cut to a length, as a profile written back shorter is.
    pub fn truncate(&mut self, length: u64) -> bool {
        self.written_at = self.now.or(self.written_at);

        match &mut self.body {
            Body::Host(file) => file.truncate(length),
            Body::Memory(file) => file.truncate(length),
            Body::Image(file) => file.truncate(length),
        }
    }

    pub fn size(&self) -> u64 {
        match &self.body {
            Body::Host(file) => file.size(),
            Body::Memory(file) => file.size(),
            Body::Image(file) => file.size(),
        }
    }

    /// The mode DOS's 3Dh opened it in, AL: a disk image's file keeps it,
    /// and refuses a write to one opened to read and a read from one opened
    /// to write, as DOSBox's `fatFile` does; another keeps none.
    pub fn set_mode(&mut self, mode: u8) {
        if let Body::Image(file) = &mut self.body {
            file.set_mode(mode);
        }
    }

    /// Whether a read is refused, error 5: a disk image's file opened to
    /// write alone (`fatFile::Read`, `drive_fat.cpp` 108-111).
    pub fn refuses_read(&self) -> bool {
        matches!(&self.body, Body::Image(file) if file.refuses_read())
    }

    /// Whether a write is refused, error 5: a disk image's file opened to
    /// read alone (`fatFile::Write`, `drive_fat.cpp` 163-166).
    pub fn refuses_write(&self) -> bool {
        matches!(&self.body, Body::Image(file) if file.refuses_write())
    }

    /// The time and date 5700h answers where the file keeps its own: a
    /// disk image's, its entry's creation stamp as it was opened
    /// (`FileOpen`, `drive_fat.cpp` 832-834).
    pub fn own_stamp(&self) -> Option<(u16, u16)> {
        match &self.body {
            Body::Image(file) => Some(file.stamp()),
            _ => None,
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
    /// Folders' stamps by path, from DOS's clock, as an entry was made in
    /// one, deleted from it or renamed: DOSBox's C: is a folder of the
    /// host's, whose stamp moves so and not when a file in it is written
    /// (**recorded** by `dirorder`). A host's folder keeps the host's
    /// clock's, not DOS's.
    folders: HashMap<String, i64>,
    /// DOS's clock, seconds since 1970, as the system last set it: what a
    /// file written is stamped with. None leaves each drive its own.
    pub now: Option<i64>,
    /// How many times DOS has been asked anything of its files: KERNEL's
    /// profiles look again at a file's stamp once there has been a DOS
    /// call since they last did (`KRNL386.EXE` seg1 `1b68`).
    activity: Cell<u64>,
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
            folders: HashMap::new(),
            now: None,
            activity: Cell::new(0),
        }
    }

    /// A DOS call noted: anything asked of DOS, files or not.
    pub fn touch(&self) {
        self.activity.set(self.activity.get().wrapping_add(1));
    }

    /// How many DOS calls there have been, as `touch` counts them.
    pub fn activity(&self) -> u64 {
        self.activity.get()
    }

    pub fn mount(&mut self, letter: char, drive: impl Volume + 'static) {
        self.mount_boxed(letter, Box::new(drive));
    }

    /// A drive mounted whose kind is chosen as it runs: a disk image's
    /// volume, or a folder.
    pub fn mount_boxed(&mut self, letter: char, drive: Box<dyn Volume>) {
        let letter = letter.to_ascii_uppercase();

        self.drives.insert(letter, drive);
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

    /// Whether a drive is remote (`Volume::remote`).
    pub fn remote(&self, letter: char) -> bool {
        self.drives.get(&letter).is_some_and(|drive| drive.remote())
    }

    /// The order a drive lists its folders in (`Volume::listing`); a
    /// folder's, `Sorted`, where no drive is.
    pub fn listing(&self, letter: char) -> Listing {
        self.drives
            .get(&letter)
            .map_or(Listing::Sorted, |drive| drive.listing())
    }

    /// A drive's own label (`Volume::label`).
    pub fn label(&self, letter: char) -> Option<String> {
        self.drives.get(&letter)?.label()
    }

    /// Whether DOS has the drive: mounted, and not a removable drive with
    /// no disk in it -- DOSBox's floppy drive with nothing mounted, which
    /// DOS answers as no drive (`dos_ioctl.cpp` 41-46: `Drives[drive]`
    /// none, error 0Fh).
    pub fn has_disk(&self, letter: char) -> bool {
        self.mounted(letter) && (!self.removable(letter) || self.allocation(letter).is_some())
    }

    /// How many floppy disks are in their drives: the drives removable and
    /// not remote with a disk in each, as DOSBox's BIOS counts a floppy
    /// image mounted in its equipment word (`bios_disk.cpp` 219-229).
    pub fn floppy_disks(&self) -> usize {
        self.drives
            .iter()
            .filter(|&(&letter, drive)| {
                drive.removable() && !drive.remote() && self.has_disk(letter)
            })
            .count()
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

    /// What a folder holds, as DOSBox lists a folder of the host's: `.`
    /// and `..` in every folder, the root's too, `.` with the folder's own
    /// stamp and `..` with the one above's; folders first, then files, each
    /// by its name byte by byte (`drive_cache.cpp` 52-56, `SortByDirName`,
    /// the order `DIRALPHABETICAL` its constructor sets at 71, 82). A name
    /// starting with a byte below `.`, `!D`, comes before `.`.
    /// **Recorded** by `dirorder`.
    ///
    /// A disk image's folder (`Listing::AsStored`) is listed as the image
    /// keeps it, `.` and `..` only where it has them, each entry's
    /// attributes and stamps its own: neither the attributes set nor the
    /// folders' stamps kept beside a folder's drive are its.
    pub fn list(&self, letter: char, parts: &[String]) -> Option<Vec<Entry>> {
        self.touch();
        let drive = self.drives.get(&letter)?;

        if drive.listing() == Listing::AsStored {
            return drive.children(parts);
        }
        let names: Vec<String> = parts
            .iter()
            .filter(|part| !part.is_empty())
            .cloned()
            .collect();
        let mut entries: Vec<Entry> = drive
            .children(parts)?
            .into_iter()
            .map(|mut entry| {
                if let Some(&attributes) =
                    self.attributes.get(&Self::key(letter, parts, &entry.name))
                {
                    entry.attributes = attributes;
                }

                self.stamped(letter, &Self::joined(parts, &entry.name), entry)
            })
            .collect();
        let own = self.stamped(letter, &names, drive.entry(&names)?);
        let above = match names.split_last() {
            Some((_, above)) => self.stamped(letter, above, drive.entry(above)?),
            None => own.clone(),
        };

        for (name, entry) in [(".", own), ("..", above)] {
            entries.push(Entry {
                name: name.to_string(),
                attributes: 0x10,
                size: 0,
                ..entry
            });
        }

        entries.sort_by(|a, b| {
            (b.attributes & 0x10)
                .cmp(&(a.attributes & 0x10))
                .then_with(|| a.name.as_bytes().cmp(b.name.as_bytes()))
        });

        Some(entries)
    }

    /// The key a folder's stamp is kept by: its drive and its names.
    fn folder_key(letter: char, names: &[String]) -> String {
        let mut key = format!("{letter}:");

        for name in names.iter().filter(|name| !name.is_empty()) {
            key.push('\\');
            key.push_str(&name.to_ascii_uppercase());
        }

        key
    }

    /// A folder's stamp as DOS's clock gave it, seconds since 1970, where
    /// an entry was made in it, deleted from it or renamed since its drive
    /// was mounted: what a program listing it is told (`list`). None where
    /// its stamp is still the drive's own. A drive held in memory keeps a
    /// folder's by its own clock, which a run on a virtual one does not
    /// share: a layer of what a program wrote takes a folder's from here.
    pub fn folder_stamp(&self, letter: char, path: &str) -> Option<i64> {
        let names: Vec<String> = path
            .split('\\')
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect();

        self.folders
            .get(&Self::folder_key(letter.to_ascii_uppercase(), &names))
            .copied()
    }

    /// An entry with the stamp DOS's clock gave it, where it is a folder
    /// whose entries changed.
    fn stamped(&self, letter: char, names: &[String], mut entry: Entry) -> Entry {
        if entry.attributes & 0x10 != 0
            && let Some(&seconds) = self.folders.get(&Self::folder_key(letter, names))
        {
            entry.modified = stamp(seconds);
        }

        entry
    }

    /// A folder's entries changed: its stamp DOS's clock's now. Not a disk
    /// image's, whose folders' stamps are its entries'.
    fn changed(&mut self, letter: char, names: &[String]) {
        if self.listing(letter) == Listing::AsStored {
            return;
        }

        if let Some(now) = self.now {
            self.folders.insert(Self::folder_key(letter, names), now);
        }
    }

    /// The folders' stamps kept under a path moved with it, or dropped.
    fn carried(&mut self, letter: char, from: &[String], to: Option<&[String]>) {
        let from = Self::folder_key(letter, from);
        let to = to.map(|to| Self::folder_key(letter, to));
        let moved: Vec<String> = self
            .folders
            .keys()
            .filter(|key| {
                **key == from
                    || key
                        .strip_prefix(from.as_str())
                        .is_some_and(|rest| rest.starts_with('\\'))
            })
            .cloned()
            .collect();

        for key in moved {
            let Some(seconds) = self.folders.remove(&key) else {
                continue;
            };

            if let Some(to) = &to {
                self.folders
                    .insert(format!("{to}{}", &key[from.len()..]), seconds);
            }
        }
    }

    /// An entry of a folder, by its name.
    pub fn lookup(&self, letter: char, parts: &[String], name: &str) -> Option<Entry> {
        self.touch();

        let stored = self.listing(letter) == Listing::AsStored;

        self.list(letter, parts)?.into_iter().find(|entry| {
            if stored {
                same_name(&entry.name, name)
            } else {
                entry.name.eq_ignore_ascii_case(name)
            }
        })
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
        self.touch();
        let path = Self::joined(parts, name);
        let gone = self
            .drives
            .get_mut(&letter)
            .is_some_and(|drive| drive.unlink(&path));

        if gone {
            self.carried(letter, &path, None);
            self.changed(letter, parts);
        }

        gone
    }

    /// An empty folder let go of, as DOS's 3Ah does (`Volume::remove_dir`).
    pub fn remove_directory(&mut self, letter: char, parts: &[String], name: &str) -> bool {
        self.touch();
        let path = Self::joined(parts, name);
        let gone = self
            .drives
            .get_mut(&letter)
            .is_some_and(|drive| drive.remove_dir(&path));

        if gone {
            self.carried(letter, &path, None);
            self.changed(letter, parts);
        }

        gone
    }

    pub fn make_directory(&mut self, letter: char, parts: &[String], name: &str) -> bool {
        self.touch();
        let made = self
            .drives
            .get_mut(&letter)
            .is_some_and(|drive| drive.mkdir(&Self::joined(parts, name)));

        if made {
            self.changed(letter, parts);
        }

        made
    }

    /// A file or folder renamed, or moved to another folder with all it
    /// holds, as DOSBox's host's `rename()` moves one (`drive_local.cpp`
    /// 347-362): its own stamp kept, its folders' made now.
    pub fn rename(&mut self, letter: char, from: (&[String], &str), to: (&[String], &str)) -> bool {
        self.touch();
        let source = Self::joined(from.0, from.1);
        let target = Self::joined(to.0, to.1);
        let moved = self
            .drives
            .get_mut(&letter)
            .is_some_and(|drive| drive.rename(&source, &target));

        if moved {
            self.carried(letter, &source, Some(&target));
            self.changed(letter, from.0);
            self.changed(letter, to.0);
        }

        moved
    }

    /// A file's attributes set, as no folder's drive keeps them: whether
    /// they were. A disk image's are its entries', which DOSBox leaves as
    /// they are: its `DOS_SetFileAttr` only looks for the file
    /// (`dos_files.cpp` 643-656), and it is found.
    pub fn set_attributes(
        &mut self,
        letter: char,
        parts: &[String],
        name: &str,
        attributes: u8,
    ) -> bool {
        if self.listing(letter) == Listing::AsStored {
            return true;
        }

        self.attributes
            .insert(Self::key(letter, parts, name), attributes);
        true
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
        self.touch();
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
                now: self.now,
                written_at: None,
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
        self.create_with(path, 0)
    }

    /// A file created with the attributes DOS's 3Ch was given, which a
    /// disk image's entry keeps (`Volume::create_with`).
    pub fn create_with(&mut self, path: &str, attributes: u8) -> Option<usize> {
        self.touch();
        let parsed = Self::parse(path);
        let letter = parsed.drive?;
        let drive = self.drives.get_mut(&letter)?;
        let made = drive.entry(&parsed.parts).is_none();
        let mut body = drive.create_with(&parsed.parts, attributes)?;

        // A file made where none was changes its folder; one emptied does
        // not: DOSBox's `localDrive::FileCreate` adds an entry only for a
        // file that was not there (`drive_local.cpp` 51-80).
        if made && let Some((_, folder)) = parsed.parts.split_last() {
            self.changed(letter, folder);
        }

        if let Some(now) = self.now {
            body.stamp(now);
        }

        // Made now, as DOS stamps a file it makes.
        self.allocate(OpenFile {
            body,
            drive: letter,
            dos_path: Self::dos_path(letter, &parsed.parts),
            now: self.now,
            written_at: self.now,
        })
    }

    /// An open file by its handle.
    pub fn resolve(&mut self, handle: usize) -> Option<&mut OpenFile> {
        self.touch();

        let now = self.now;
        let file = self.open.get_mut(&handle)?;

        file.now = now;
        Some(file)
    }

    /// A file let go of; one written is stamped with when it last was, by
    /// DOS's clock.
    pub fn close(&mut self, handle: usize) -> bool {
        self.touch();

        let Some(mut file) = self.open.remove(&handle) else {
            return false;
        };

        file.body.close();

        if let Some(at) = file.written_at {
            file.body.stamp(at);
        }

        true
    }

    /// A disk image's file's or folder's attributes, as DOSBox's
    /// `GetFileAttr` finds them (`Volume::attributes`); none where it finds
    /// none, or the drive is no image.
    pub fn image_attributes(&self, letter: char, parts: &[String], name: &str) -> Option<u8> {
        self.touch();
        self.drives
            .get(&letter)?
            .attributes(&Self::joined(parts, name))
    }

    /// A disk image's folder by its first cluster, as a search keeps it
    /// (`Volume::search_folder`).
    pub fn search_folder(&self, letter: char, parts: &[String]) -> Option<u32> {
        self.drives.get(&letter)?.search_folder(parts)
    }

    /// A disk image's search carried on from a slot (`Volume::find_from`).
    pub fn find_from(
        &self,
        letter: char,
        folder: u32,
        attributes: u8,
        pattern: &str,
        at: &mut u16,
    ) -> Option<Entry> {
        self.touch();
        self.drives
            .get(&letter)?
            .find_from(folder, attributes, pattern, at)
    }

    /// A disk image mounted, as programs have written it: its bytes, to be
    /// saved as a new image ("Save image..." on the page, `--write-back`
    /// natively); none for a drive that is no image.
    pub fn image(&self, letter: char) -> Option<Vec<u8>> {
        self.drives.get(&letter.to_ascii_uppercase())?.image()
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

        // `.` and `..` in the root too, and folders before files, as
        // DOSBox lists a host's folder (`dirorder`).
        assert_eq!(names, [".", "..", "WINDOWS", "AUTOEXEC.BAT"]);
        assert_eq!(root[3].attributes, 0x20);
        assert_eq!(root[3].size, 11);
        assert_eq!(root[3].modified, [1992, 3, 10, 3, 10, 2]);
        assert_eq!(root[2].attributes, 0x10);

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

        // Less `.` and `..`: the root's stamp, which they may give, is not
        // among the changes.
        let listed = |files: &Files, parts: &[String]| {
            files.list('C', parts).map(|entries| {
                entries
                    .into_iter()
                    .filter(|entry| entry.name != "." && entry.name != "..")
                    .collect::<Vec<_>>()
            })
        };

        for folder in ["C:\\", "C:\\WINDOWS", "C:\\WINDOWS\\SYSTEM", "C:\\GAMES"] {
            let parts = Files::parse(folder).parts;

            assert_eq!(listed(&written, &parts), listed(&made, &parts), "{folder}");
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
