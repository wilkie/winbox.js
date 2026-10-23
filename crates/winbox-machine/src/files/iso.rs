//! An ISO 9660 disc image as a CD-ROM drive, read as DOSBox 0.74-3's
//! `isoDrive` reads one (`drive_iso.cpp`, its image through
//! `CDROM_Interface_Image`, `cdrom_image.cpp`): the primary volume
//! descriptor at sector 16 alone, no Joliet or Rock Ridge; each record's
//! name as `readDirEntry` makes it (its `;1` and a trailing dot gone, cut
//! to eight before its dot and twelve in all); folders in the disc's order,
//! the root without `.` and `..`; names upper-cased as a search lists them
//! and found without regard to case; nothing written. **Recorded** by
//! `imgcd` and `drvioctl`.
//!
//! The functions below are DOSBox's, by its names, and do what its do,
//! line for line where it matters: a record is copied over the one before
//! it as `memcpy` copies it, a record DOSBox cannot read ends its folder,
//! and a search's place is one of the drive's 2,048 directory iterators,
//! taken and let go as `GetDirIterator` and `FreeDirIterator` take and let
//! them go, its number in the search's record.

use std::cell::RefCell;
use std::io::{ErrorKind, SeekFrom};
use std::rc::Rc;

use super::fat::wild_file_cmp;
use super::mbr::Sectors;
use super::{Allocation, Begun, Body, Entry, Listing, Volume};

/// A sector's bytes as a drive reads them, cooked (`ISO_FRAMESIZE`).
pub const ISO_FRAMESIZE: usize = 2048;

/// A raw sector's bytes, sync and header with them (`RAW_SECTOR_SIZE`).
const RAW_SECTOR_SIZE: u64 = 2352;

/// The first volume descriptor's sector (`ISO_FIRST_VD`).
const ISO_FIRST_VD: u32 = 16;

/// A record's flags (`ISO_DIRECTORY`, `ISO_HIDDEN`): bit 1 a folder, bit 0
/// the existence bit, which DOSBox takes for hidden.
const ISO_DIRECTORY: u8 = 2;
const ISO_HIDDEN: u8 = 1;

/// How much of two names `lookup` compares (`ISO_MAX_FILENAME_LENGTH`).
const ISO_MAX_FILENAME_LENGTH: usize = 37;

/// How many directory iterators a drive has (`MAX_OPENDIRS`,
/// `dos_system.h` 124).
const MAX_OPENDIRS: usize = 2048;

/// DOS's attribute bits.
const DOS_ATTR_READ_ONLY: u8 = 0x01;
const DOS_ATTR_HIDDEN: u8 = 0x02;
const DOS_ATTR_SYSTEM: u8 = 0x04;
const DOS_ATTR_VOLUME: u8 = 0x08;
const DOS_ATTR_DIRECTORY: u8 = 0x10;
const DOS_ATTR_ARCHIVE: u8 = 0x20;

/// Why an image could not be mounted as a disc.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IsoError {
    /// No primary volume descriptor at sector 16 in any layout DOSBox
    /// tries (`LoadIsoFile`, `cdrom_image.cpp` 366-379): "could not load
    /// image file".
    NotIso,
    /// A descriptor whose root record DOSBox cannot read (`loadImage`,
    /// `drive_iso.cpp` 516-526): error 6, a corrupt image.
    Corrupt,
}

/// The disc's one data track as `LoadIsoFile` finds it (`cdrom_image.cpp`
/// 350-382): its sectors' size, where a sector's 2,048 bytes begin in it,
/// and how many whole sectors the image holds.
#[derive(Debug, Clone, Copy)]
struct Track {
    sector_size: u64,
    skip: u64,
    length: u64,
}

impl Track {
    /// The first layout whose sector 16 is a primary volume descriptor
    /// (`CanReadPVD`, 395-404): cooked 2,048-byte sectors, raw 2,352 (their
    /// data 16 in), mode 2 of 2,336 or 2,352 (24 in).
    fn detect(sectors: &dyn Sectors) -> Option<Self> {
        [
            (2048, 0),
            (RAW_SECTOR_SIZE, 16),
            (2336, 24),
            (RAW_SECTOR_SIZE, 24),
        ]
        .into_iter()
        .map(|(sector_size, skip)| Self {
            sector_size,
            skip,
            length: sectors.size() / sector_size,
        })
        .find(|track| {
            let seek = 16 * track.sector_size + track.skip;
            let mut pvd = [0u8; ISO_FRAMESIZE];

            // An image too short to hold it fails the stream's read.
            if seek + ISO_FRAMESIZE as u64 > sectors.size() {
                return false;
            }

            sectors.read_at(seek, &mut pvd);
            pvd[0] == 1 && &pvd[1..6] == b"CD001" && pvd[6] == 1
        })
    }
}

/// A directory record as DOSBox's `isoDirEntry` holds it, its bytes as
/// the disc has them but its name, which `readDirEntry` makes a C string
/// in place: the length (0), the extended attributes' (1), the extent (2)
/// and the data's length (10), each little-endian first, the date and time
/// from 1900 (18-24), the flags (25), the unit size and gap (26, 27), the
/// name's length (32) and the name (33).
#[derive(Clone)]
struct DirEntry([u8; 256]);

impl std::fmt::Debug for DirEntry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("DirEntry")
            .field(&String::from_utf8_lossy(self.ident()))
            .finish()
    }
}

impl DirEntry {
    const EMPTY: Self = Self([0; 256]);

    fn long(&self, at: usize) -> u32 {
        u32::from_le_bytes([self.0[at], self.0[at + 1], self.0[at + 2], self.0[at + 3]])
    }

    /// `EXTENT_LOCATION`.
    fn extent(&self) -> u32 {
        self.long(2)
    }

    /// `DATA_LENGTH`.
    fn data_length(&self) -> u32 {
        self.long(10)
    }

    fn is_dir(&self) -> bool {
        self.0[25] & ISO_DIRECTORY != 0
    }

    fn is_hidden(&self) -> bool {
        self.0[25] & ISO_HIDDEN != 0
    }

    /// The name as `readDirEntry` left it, to its first nought.
    fn ident(&self) -> &[u8] {
        let name = &self.0[33..];
        let end = name
            .iter()
            .position(|&byte| byte == 0)
            .unwrap_or(name.len());

        &name[..end]
    }

    /// A C string written over the name from a place in it, as `strcpy`
    /// writes one.
    fn set_ident_at(&mut self, at: usize, text: &[u8]) {
        let start = 33 + at;

        self.0[start..start + text.len()].copy_from_slice(text);
        self.0[start + text.len()] = 0;
    }

    /// The time `DOS_PackTime(hour, minute, second)` and the date
    /// `DOS_PackDate(1900 + year, month, day)` make of its stamp, each part
    /// masked as they mask it (`dos_inc.h` 220-226), the offset from GMT
    /// not looked at (`drive_iso.cpp` 312-313).
    fn stamp(&self) -> (u16, u16) {
        let byte = |at: usize| u16::from(self.0[at]);

        (
            (byte(21) & 0x1f) << 11 | (byte(22) & 0x3f) << 5 | (byte(23) / 2) & 0x1f,
            ((1900 + byte(18)).wrapping_sub(1980) & 0x7f) << 9
                | (byte(19) & 0x3f) << 5
                | (byte(20) & 0x1f),
        )
    }

    /// Its stamp as an entry's date and time, which DOS's search packs back
    /// into the same two words.
    fn modified(&self) -> [u16; 6] {
        let (time, date) = self.stamp();

        [
            1980 + (date >> 9),
            date >> 5 & 0x0f,
            date & 0x1f,
            time >> 11,
            time >> 5 & 0x3f,
            (time & 0x1f) * 2,
        ]
    }

    /// What a search lists it as (`FindNext`, 296-314): its name upper
    /// case, its size, 10h a folder or else 20h, 02h with it where it is
    /// hidden.
    fn find_entry(&self) -> Entry {
        let mut attributes = if self.is_dir() {
            DOS_ATTR_DIRECTORY
        } else {
            DOS_ATTR_ARCHIVE
        };

        if self.is_hidden() {
            attributes |= DOS_ATTR_HIDDEN;
        }

        Entry {
            name: self
                .ident()
                .iter()
                .map(|&byte| char::from(byte.to_ascii_uppercase()))
                .collect(),
            attributes,
            size: self.data_length(),
            modified: self.modified(),
        }
    }
}

/// `readDirEntry` (476-514): a record copied over `de` -- its first byte's
/// count of bytes, what was there before kept past them -- and its name
/// made DOS's: `.` and `..` for a folder's own two, a file's version from
/// its first `;` and a dot left at its end taken off, the part before its
/// dot cut to eight and the whole to twelve. Its length, or -1 for a record
/// DOSBox does not read: extended attributes, interleaving, a name longer
/// than the record or than 200 bytes.
fn read_dir_entry(de: &mut DirEntry, data: &[u8]) -> i32 {
    let count = usize::from(data[0]).min(data.len());

    de.0[..count].copy_from_slice(&data[..count]);

    // XA and interleaved files are not read.
    if de.0[1] != 0 || de.0[26] != 0 || de.0[27] != 0 {
        return -1;
    }

    let ident_length = usize::from(de.0[32]);

    if usize::from(de.0[0]) < 33 + ident_length {
        return -1;
    }

    if de.is_dir() {
        if ident_length == 1 && de.0[33] == 0 {
            de.set_ident_at(0, b".");
        } else if ident_length == 1 && de.0[33] == 1 {
            de.set_ident_at(0, b"..");
        } else {
            if ident_length > 200 {
                return -1;
            }

            de.0[33 + ident_length] = 0;
        }
    } else {
        if ident_length > 200 {
            return -1;
        }

        de.0[33 + ident_length] = 0;

        // `strreplace(ident, ';', 0)`: the name ends at its first `;`.
        if let Some(at) = de.ident().iter().position(|&byte| byte == b';') {
            de.0[33 + at] = 0;
        }

        let length = de.ident().len();

        if length > 0 && de.0[33 + length - 1] == b'.' {
            de.0[33 + length - 1] = 0;
        }
    }

    if let Some(dot) = de.ident().iter().position(|&byte| byte == b'.')
        && dot > 8
    {
        let rest = de.ident()[dot..].to_vec();

        de.set_ident_at(8, &rest);
    }

    if de.ident().len() > 12 {
        de.0[33 + 12] = 0;
    }

    i32::from(de.0[0])
}

/// One of the drive's directory iterators (`dirIterators`): whether it is
/// in use, whether it is the root's, the sector it is at and the last of
/// its folder, and where in the sector.
#[derive(Debug, Clone, Copy, Default)]
struct DirIterator {
    valid: bool,
    root: bool,
    current_sector: u32,
    end_sector: u32,
    pos: u32,
}

/// The disc as DOSBox's `isoDrive` holds it.
#[derive(Debug)]
struct Disc {
    sectors: Box<dyn Sectors>,
    track: Track,
    root_entry: DirEntry,
    /// The label `Set_Label` makes of the volume's name (`discLabel`).
    label: String,
    dir_iterators: Vec<DirIterator>,
    next_free_dir_iterator: usize,
}

impl Disc {
    /// A cooked sector of the data track (`CDROM_Interface_Image::
    /// ReadSector`, `cdrom_image.cpp` 301-313); none past the track's
    /// whole sectors (`GetTrack`).
    fn read_sector(&self, sector: u32) -> Option<[u8; ISO_FRAMESIZE]> {
        if u64::from(sector) >= self.track.length {
            return None;
        }

        let mut buffer = [0u8; ISO_FRAMESIZE];

        self.sectors.read_at(
            u64::from(sector) * self.track.sector_size + self.track.skip,
            &mut buffer,
        );
        Some(buffer)
    }

    /// `GetDirIterator` (390-408): the next iterator in turn, at the
    /// folder's first sector, its last the one its length ends in.
    fn get_dir_iterator(&mut self, de: &DirEntry) -> usize {
        let handle = self.next_free_dir_iterator;
        let length = de.data_length();
        let mut end_sector = de
            .extent()
            .wrapping_add(length / ISO_FRAMESIZE as u32)
            .wrapping_sub(1);

        if !length.is_multiple_of(ISO_FRAMESIZE as u32) {
            end_sector = end_sector.wrapping_add(1);
        }

        self.dir_iterators[handle] = DirIterator {
            valid: true,
            root: self.dir_iterators[handle].root,
            current_sector: de.extent(),
            end_sector,
            pos: 0,
        };
        self.next_free_dir_iterator = (self.next_free_dir_iterator + 1) % MAX_OPENDIRS;
        handle
    }

    /// `GetNextDirEntry` (410-439): the next record into `de`, on into the
    /// next sector where this one has none left; false at the folder's
    /// end, or where the record cannot be read.
    fn get_next_dir_entry(&mut self, handle: usize, de: &mut DirEntry) -> bool {
        let iterator = self.dir_iterators[handle];

        if !iterator.valid {
            return false;
        }

        let Some(mut buffer) = self.read_sector(iterator.current_sector) else {
            return false;
        };
        let mut iterator = iterator;
        let pos = iterator.pos as usize;

        if pos >= ISO_FRAMESIZE
            || buffer[pos] == 0
            || pos + usize::from(buffer[pos]) > ISO_FRAMESIZE
        {
            if iterator.current_sector < iterator.end_sector {
                iterator.pos = 0;
                iterator.current_sector += 1;
                self.dir_iterators[handle] = iterator;

                let Some(next) = self.read_sector(iterator.current_sector) else {
                    return false;
                };

                buffer = next;
            } else {
                return false;
            }
        }

        let length = read_dir_entry(de, &buffer[iterator.pos as usize..]);

        iterator.pos = iterator.pos.wrapping_add_signed(length);
        self.dir_iterators[handle] = iterator;
        length >= 0
    }

    /// `FreeDirIterator` (441-452): let go, and the next to be taken this
    /// one where it was the last taken.
    fn free_dir_iterator(&mut self, handle: usize) {
        self.dir_iterators[handle].valid = false;

        if (handle + 1) % MAX_OPENDIRS == self.next_free_dir_iterator {
            self.next_free_dir_iterator = if self.next_free_dir_iterator > 0 {
                self.next_free_dir_iterator - 1
            } else {
                MAX_OPENDIRS - 1
            };
        }
    }

    /// `lookup` (528-562): from the root, each name of the path looked for
    /// in the folder before it, a dot at its end taken off, compared with
    /// each record's name without regard to case.
    fn lookup(&mut self, names: &[&str]) -> Option<DirEntry> {
        let mut de = self.root_entry.clone();

        for name in names {
            let mut found = false;

            if de.is_dir() {
                let name = name.strip_suffix('.').unwrap_or(name).as_bytes();
                let handle = self.get_dir_iterator(&de.clone());

                while !found && self.get_next_dir_entry(handle, &mut de) {
                    found = strncasecmp(de.ident(), name);
                }

                self.free_dir_iterator(handle);
            }

            if !found {
                return None;
            }
        }

        Some(de)
    }

    /// `FindNext` (286-323): on through the iterator's folder to the next
    /// record the pattern and the attributes take -- not `.` or `..` in the
    /// root, nor a hidden one or a folder not asked for -- and the iterator
    /// let go at the folder's end.
    fn find_next(&mut self, handle: usize, attributes: u8, pattern: &str) -> Option<Entry> {
        let is_root = self.dir_iterators[handle].root;
        let mut de = DirEntry::EMPTY;

        while self.get_next_dir_entry(handle, &mut de) {
            let entry = de.find_entry();
            let name: String = de.ident().iter().map(|&byte| char::from(byte)).collect();

            if !(is_root && de.ident().first() == Some(&b'.'))
                && wild_file_cmp(&name, pattern)
                && !attributes
                    & entry.attributes
                    & (DOS_ATTR_DIRECTORY | DOS_ATTR_HIDDEN | DOS_ATTR_SYSTEM)
                    == 0
            {
                return Some(entry);
            }
        }

        self.free_dir_iterator(handle);
        None
    }
}

/// `strncasecmp(a, b, ISO_MAX_FILENAME_LENGTH) == 0`.
fn strncasecmp(a: &[u8], b: &[u8]) -> bool {
    let cut = |text: &[u8]| text[..text.len().min(ISO_MAX_FILENAME_LENGTH)].to_ascii_lowercase();

    cut(a) == cut(b)
}

/// `Set_Label(input, output, cdrom = true)` (`drives.cpp` 80-108): eight
/// characters, a dot, three more, case kept; a dot at its end taken off but
/// where it is the ninth, MSCDEX's way.
fn set_label(input: &[u8]) -> String {
    let mut output = Vec::new();
    let mut togo = 8;
    let mut vname_pos = 0;
    let mut point = false;

    while togo > 0 {
        let Some(&byte) = input.get(vname_pos) else {
            break;
        };

        if byte == 0 {
            break;
        }

        if !point && byte == b'.' {
            togo = 4;
            point = true;
        }

        output.push(byte);
        vname_pos += 1;
        togo -= 1;

        if togo == 0 && !point {
            if input.get(vname_pos) == Some(&b'.') {
                vname_pos += 1;
            }

            output.push(b'.');
            point = true;
            togo = 3;
        }
    }

    if output.last() == Some(&b'.') && output.len() != 9 {
        output.pop();
    }

    output.into_iter().map(char::from).collect()
}

/// The volume's name as MSCDEX's `GetVolumeName` reads it (`dos_mscdex.cpp`
/// 561-597): sector 16's bytes from 40, at most 31 and to a nought, white
/// space at the end taken off (`rtrim`).
fn volume_name(pvd: &[u8; ISO_FRAMESIZE]) -> Vec<u8> {
    let mut name: Vec<u8> = pvd[40..71]
        .iter()
        .copied()
        .take_while(|&b| b != 0)
        .collect();

    while name
        .last()
        .is_some_and(|&byte| matches!(byte, b' ' | b'\t' | b'\n' | 0x0b | 0x0c | b'\r'))
    {
        name.pop();
    }

    name
}

/// An ISO 9660 disc image mounted as a CD-ROM drive.
#[derive(Debug)]
pub struct IsoVolume {
    disc: Rc<RefCell<Disc>>,
}

impl IsoVolume {
    /// The disc an image holds, as `isoDrive`'s constructor mounts it
    /// (141-177): its track found, sector 16 a primary volume descriptor
    /// whose root record is read (`loadImage`), its label from the volume's
    /// name.
    pub fn new(sectors: impl Sectors + 'static) -> Result<Self, IsoError> {
        let sectors: Box<dyn Sectors> = Box::new(sectors);
        let track = Track::detect(sectors.as_ref()).ok_or(IsoError::NotIso)?;
        let mut disc = Disc {
            sectors,
            track,
            root_entry: DirEntry::EMPTY,
            label: String::new(),
            dir_iterators: vec![DirIterator::default(); MAX_OPENDIRS],
            next_free_dir_iterator: 0,
        };
        let pvd = disc.read_sector(ISO_FIRST_VD).ok_or(IsoError::NotIso)?;

        if pvd[0] != 1 || &pvd[1..6] != b"CD001" || pvd[6] != 1 {
            return Err(IsoError::NotIso);
        }

        let mut root = DirEntry::EMPTY;

        if read_dir_entry(&mut root, &pvd[156..]) <= 0 {
            return Err(IsoError::Corrupt);
        }

        disc.root_entry = root;
        disc.label = set_label(&volume_name(&pvd));

        Ok(Self {
            disc: Rc::new(RefCell::new(disc)),
        })
    }

    /// The record a path names, as `lookup` finds it.
    fn lookup(&self, parts: &[String]) -> Option<DirEntry> {
        let names: Vec<&str> = parts
            .iter()
            .map(String::as_str)
            .filter(|part| !part.is_empty())
            .collect();

        self.disc.borrow_mut().lookup(&names)
    }

    /// A file's record, as `FileOpen` finds one: there, and not a folder.
    fn file(&self, parts: &[String]) -> Option<DirEntry> {
        self.lookup(parts).filter(|de| !de.is_dir())
    }
}

impl Volume for IsoVolume {
    /// `isRemovable` (378-380).
    fn removable(&self) -> bool {
        true
    }

    /// `TestDir` (245-248).
    fn is_directory(&self, parts: &[String]) -> bool {
        self.lookup(parts).is_some_and(|de| de.is_dir())
    }

    fn entry(&self, parts: &[String]) -> Option<Entry> {
        let de = self.lookup(parts)?;

        if parts.iter().all(String::is_empty) {
            return Some(Entry {
                name: String::new(),
                ..de.find_entry()
            });
        }

        Some(de.find_entry())
    }

    /// The folder's records as a search for everything lists them, in the
    /// disc's order, the root's `.` and `..` left out.
    fn children(&self, parts: &[String]) -> Option<Vec<Entry>> {
        let de = self.lookup(parts)?;
        let mut disc = self.disc.borrow_mut();
        let handle = disc.get_dir_iterator(&de);

        disc.dir_iterators[handle].root = parts.iter().all(String::is_empty);

        let mut entries = Vec::new();

        while let Some(entry) = disc.find_next(handle, 0xff, "????????.???") {
            entries.push(entry);
        }

        Some(entries)
    }

    fn read(&self, parts: &[String]) -> Option<Vec<u8>> {
        let de = self.file(parts)?;
        let mut file = DiscFile::new(&self.disc, &de);

        Some(file.read(de.data_length() as usize))
    }

    /// `FileOpen` (204-223): a file there and not a folder. Its mode is the
    /// DOS's to refuse (`refuses_mode`).
    fn open(&mut self, parts: &[String]) -> std::io::Result<Body> {
        let de = self.file(parts).ok_or(ErrorKind::NotFound)?;

        Ok(Body::Disc(DiscFile::new(&self.disc, &de)))
    }

    /// `FileCreate` (225-228): access denied.
    fn create(&mut self, _parts: &[String]) -> Option<Body> {
        None
    }

    /// `FileUnlink` (230-233).
    fn unlink(&mut self, _parts: &[String]) -> bool {
        false
    }

    /// `RemoveDir` (235-238).
    fn remove_dir(&mut self, _parts: &[String]) -> bool {
        false
    }

    /// `MakeDir` (240-243).
    fn mkdir(&mut self, _parts: &[String]) -> bool {
        false
    }

    /// `Rename` (325-328).
    fn rename(&mut self, _from: &[String], _to: &[String]) -> bool {
        false
    }

    /// `AllocationInfo` (342-348): 2,048 bytes to a sector, a sector to a
    /// cluster, 60,000 clusters and none free, whatever the disc.
    fn allocation(&self) -> Option<Allocation> {
        Some(Allocation {
            sectors_per_cluster: 1,
            free_clusters: 0,
            bytes_per_sector: ISO_FRAMESIZE as u16,
            clusters: 60000,
        })
    }

    /// `isRemote` (374-376).
    fn remote(&self) -> bool {
        true
    }

    fn label(&self) -> Option<String> {
        let label = self.disc.borrow().label.clone();

        (!label.is_empty()).then_some(label)
    }

    /// `imgmount -t iso`'s media byte (`dos_programs.cpp` 1102-1104).
    fn media_byte(&self) -> u8 {
        0xf8
    }

    fn listing(&self) -> Listing {
        Listing::AsStored
    }

    /// `GetFileAttr` (330-340): 21h, 02h with it where hidden, 10h where a
    /// folder.
    fn attributes(&self, parts: &[String]) -> Option<u8> {
        let de = self.lookup(parts)?;
        let mut attributes = DOS_ATTR_ARCHIVE | DOS_ATTR_READ_ONLY;

        if de.is_hidden() {
            attributes |= DOS_ATTR_HIDDEN;
        }

        if de.is_dir() {
            attributes |= DOS_ATTR_DIRECTORY;
        }

        Some(attributes)
    }

    /// `FindFirst` (250-284): the folder looked up, folder or not; an
    /// iterator taken for it, whose number the search's record keeps; the
    /// label alone asked for, the label or no more files; the label with
    /// other attributes, in the root, where the pattern takes it, the label
    /// first; else `FindNext`.
    fn find_first(&self, parts: &[String], attributes: u8, pattern: &str) -> Option<Begun> {
        let Some(de) = self.lookup(parts) else {
            return Some(Err(3));
        };
        let mut disc = self.disc.borrow_mut();
        let handle = disc.get_dir_iterator(&de);
        let is_root = parts.iter().all(String::is_empty);
        let label = Entry {
            name: disc.label.clone(),
            attributes: DOS_ATTR_VOLUME,
            size: 0,
            modified: [1980, 0, 0, 0, 0, 0],
        };

        disc.dir_iterators[handle].root = is_root;

        if attributes == DOS_ATTR_VOLUME {
            return Some(Ok((
                handle as u16,
                (!disc.label.is_empty()).then_some(label),
            )));
        }

        if attributes & DOS_ATTR_VOLUME != 0 && is_root && wild_file_cmp(&label.name, pattern) {
            return Some(Ok((handle as u16, Some(label))));
        }

        Some(Ok((
            handle as u16,
            disc.find_next(handle, attributes, pattern),
        )))
    }

    /// `FindNext` from the iterator the search's record names.
    fn find_from(
        &self,
        _folder: u32,
        attributes: u8,
        pattern: &str,
        at: &mut u16,
    ) -> Option<Entry> {
        let handle = usize::from(*at) % MAX_OPENDIRS;

        self.disc
            .borrow_mut()
            .find_next(handle, attributes, pattern)
    }
}

/// A file of the disc open, as DOSBox's `isoFile` keeps one (31-132):
/// where it begins and ends in the image, by the cooked sector, where the
/// next read is, and its record's stamp.
#[derive(Debug)]
pub struct DiscFile {
    disc: Rc<RefCell<Disc>>,
    file_begin: u32,
    file_pos: u32,
    file_end: u32,
    time: u16,
    date: u16,
}

impl DiscFile {
    fn new(disc: &Rc<RefCell<Disc>>, de: &DirEntry) -> Self {
        let file_begin = de.extent().wrapping_mul(ISO_FRAMESIZE as u32);
        let (time, date) = de.stamp();

        Self {
            disc: Rc::clone(disc),
            file_begin,
            file_pos: file_begin,
            file_end: file_begin.wrapping_add(de.data_length()),
            time,
            date,
        }
    }

    /// Its record's stamp as it was opened, which 5700h answers: the time
    /// and the date (`FileOpen`, 217-218).
    pub fn stamp(&self) -> (u16, u16) {
        (self.time, self.date)
    }

    /// Bytes read from where it is (`isoFile::Read`, 63-98): no more than
    /// is left of it, a sector at a time, stopping at a sector the image
    /// does not hold.
    pub fn read(&mut self, length: usize) -> Vec<u8> {
        let length = (length.min(0xffff) as u32).min(self.file_end.wrapping_sub(self.file_pos));
        let disc = self.disc.borrow();
        let mut data = Vec::with_capacity(length as usize);
        let mut sector = self.file_pos / ISO_FRAMESIZE as u32;
        let mut sector_pos = (self.file_pos % ISO_FRAMESIZE as u32) as usize;

        while data.len() < length as usize {
            let Some(buffer) = disc.read_sector(sector) else {
                break;
            };
            let take = (ISO_FRAMESIZE - sector_pos).min(length as usize - data.len());

            data.extend_from_slice(&buffer[sector_pos..sector_pos + take]);
            sector_pos = 0;
            sector += 1;
        }

        self.file_pos = self.file_pos.wrapping_add(data.len() as u32);
        data
    }

    /// Where it is moved to (`isoFile::Seek`, 104-123): past its end, or
    /// before its start, its end.
    pub fn seek(&mut self, to: SeekFrom) -> Option<u64> {
        self.file_pos = match to {
            SeekFrom::Start(at) => self.file_begin.wrapping_add(at as u32),
            SeekFrom::Current(by) => self.file_pos.wrapping_add(by as u32),
            SeekFrom::End(by) => self.file_end.wrapping_add(by as u32),
        };

        if self.file_pos > self.file_end || self.file_pos < self.file_begin {
            self.file_pos = self.file_end;
        }

        Some(u64::from(self.file_pos - self.file_begin))
    }

    pub fn size(&self) -> u64 {
        u64::from(self.file_end.wrapping_sub(self.file_begin))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disc() -> IsoVolume {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../oracle/probes/images/imgcd.iso"
        );

        IsoVolume::new(std::fs::read(path).unwrap()).unwrap()
    }

    fn parts(path: &[&str]) -> Vec<String> {
        path.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn lists_the_disc_as_dosbox_does() {
        let volume = disc();
        let root: Vec<String> = volume
            .children(&parts(&[""]))
            .unwrap()
            .into_iter()
            .map(|entry| format!("{} {:02x}", entry.name, entry.attributes))
            .collect();

        assert_eq!(
            root,
            [
                "A_VERY_L.TEX 20",
                "HIDDEN.TXT 22",
                "LONGNAMEDFOL 10",
                "MIXEDCAS.TXT 20",
                "NOEXT 20",
                "README.TXT 20",
                "SUBDIR 10",
                "ZONE.TXT 20"
            ]
        );
        assert_eq!(
            volume.children(&parts(&["SUBDIR"])).unwrap()[..2]
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            [".", ".."]
        );
        assert_eq!(volume.label().as_deref(), Some("WINBOXCD.202"));
        assert_eq!(volume.attributes(&parts(&["SUBDIR"])), Some(0x31));
        assert_eq!(volume.attributes(&parts(&["readme.txt"])), Some(0x21));
        assert!(volume.attributes(&parts(&["LONGNAME"])).is_none());
        assert!(volume.is_directory(&parts(&["subdir", "deeper"])));
    }

    #[test]
    fn reads_a_file_and_its_stamp() {
        let mut volume = disc();
        let Ok(Body::Disc(mut file)) = volume.open(&parts(&["NOEXT."])) else {
            panic!("NOEXT not opened");
        };

        assert_eq!(file.size(), 14);
        assert_eq!(file.read(16), b"NOEXT line 1\r\n");
        assert_eq!(file.stamp(), (0x30e4, 0x1e85));
        assert_eq!(file.seek(SeekFrom::Start(100)), Some(14));
    }

    #[test]
    fn makes_labels_as_mscdex_does() {
        assert_eq!(set_label(b"WINBOXCD2026"), "WINBOXCD.202");
        assert_eq!(set_label(b"CDROM"), "CDROM");
        assert_eq!(set_label(b"ABCDEFGH"), "ABCDEFGH.");
        assert_eq!(set_label(b"Game.cd"), "Game.cd");
        assert_eq!(set_label(b"ABCDEFGH.IJKL"), "ABCDEFGH.IJK");
    }

    #[test]
    fn takes_and_lets_go_of_iterators_in_turn() {
        let volume = disc();
        let pattern = "????????.???";
        let Some(Ok((first, Some(_)))) = volume.find_first(&parts(&[""]), 0x16, pattern) else {
            panic!("no search");
        };
        let Some(Ok((second, _))) = volume.find_first(&parts(&["SUBDIR"]), 0x16, pattern) else {
            panic!("no search");
        };

        assert_eq!((first, second), (0, 1));

        let mut at = second;

        while volume.find_from(0, 0x16, pattern, &mut at).is_some() {}

        let Some(Ok((third, _))) = volume.find_first(&parts(&[""]), 0x08, pattern) else {
            panic!("no search");
        };

        assert_eq!(third, 1);
    }
}
