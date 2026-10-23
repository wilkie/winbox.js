//! A FAT12 or FAT16 disk image as a drive, read and written as DOSBox
//! 0.74-3's `fatDrive` reads and writes one (`drive_fat.cpp`): its folders
//! listed in the order their slots keep them, each entry's creation stamp
//! given as its date and time, its attributes the entry's own, its room
//! counted from the FAT; a file made with a zeroed entry, nothing stamped
//! as it is written or closed, a cluster taken the first free, every copy
//! of the FAT written alike. **Recorded** by `imgflop`, `imghdd` and
//! `imgwrite`.
//!
//! What is written goes to an `Overlay` over the image's sectors, never to
//! the image itself (the owner's decision of 2026-10-22,
//! `kb/topics/drives-and-disks.md`); `FatVolume::image` gives the image as
//! written.
//!
//! The functions below are DOSBox's, by its names, and do what its do,
//! line for line where it matters -- its quirks with them: a file made over
//! one there keeps its clusters lost, a write that fills a cluster to its
//! end takes the next, a file's sector read as it is opened is written back
//! as it is closed.

use std::cell::RefCell;
use std::io::{ErrorKind, SeekFrom};
use std::rc::Rc;

use super::mbr::{Sectors, volume_start};
use super::overlay::{Overlay, SECTOR};
use super::{Allocation, Body, Entry, Listing, Volume};

/// Why an image could not be mounted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FatError {
    /// Its boot sector gives no sectors to a cluster, or no bytes to a
    /// sector: no FAT volume.
    NotFat,
    /// Its boot sector gives no sectors to a FAT, as FAT32's does, which
    /// DOSBox refuses (`drive_fat.cpp` 687-691).
    Fat32,
}

/// The attribute bits of a directory's entry.
const READ_ONLY: u8 = 0x01;
const HIDDEN: u8 = 0x02;
const SYSTEM: u8 = 0x04;
const VOLUME: u8 = 0x08;
const DIRECTORY: u8 = 0x10;

/// A file's open mode, its low four bits, as DOS's 3Dh takes it.
const OPEN_READ: u8 = 0;
const OPEN_WRITE: u8 = 1;
const OPEN_READWRITE: u8 = 2;

/// A directory's entry, 32 bytes (`direntry`): the name (0) and extension
/// (8), the attributes (0Bh), the creation time (0Eh) and date (10h), the
/// first cluster's high word (14h) and low (1Ah), the size (1Ch).
type Slot = [u8; 32];

fn word(slot: &Slot, at: usize) -> u16 {
    u16::from_le_bytes([slot[at], slot[at + 1]])
}

fn first_cluster(slot: &Slot) -> u32 {
    u32::from(word(slot, 26))
}

fn size_of(slot: &Slot) -> u32 {
    u32::from_le_bytes([slot[28], slot[29], slot[30], slot[31]])
}

/// The name DOSBox's search gives an entry (`FindNextInternal` 939-948):
/// the eight characters and the three, each trimmed of spaces at both
/// ends, joined by a dot -- a dot after the name even with no extension,
/// but for a folder.
fn find_name(slot: &Slot) -> String {
    let text = |bytes: &[u8]| {
        bytes
            .iter()
            .take_while(|&&byte| byte != 0)
            .map(|&byte| char::from(byte))
            .collect::<String>()
            .trim_matches(' ')
            .to_string()
    };
    let (mut name, extension) = (text(&slot[..8]), text(&slot[8..11]));

    if slot[11] & DIRECTORY == 0 || !extension.is_empty() {
        name.push('.');
        name.push_str(&extension);
    }

    name
}

/// An entry as DOSBox's search answers it: its name (`find_name`), its
/// size, its attributes, and its creation stamp as its date and time
/// (957).
pub fn slot_entry(slot: &[u8; 32]) -> Entry {
    let (time, date) = (word(slot, 14), word(slot, 16));

    Entry {
        name: find_name(slot),
        attributes: slot[11],
        size: size_of(slot),
        modified: [
            1980 + (date >> 9),
            date >> 5 & 0x0f,
            date & 0x1f,
            time >> 11,
            time >> 5 & 0x3f,
            (time & 0x1f) * 2,
        ],
    }
}

/// A name and a pattern compared as DOSBox's `WildFileCmp` compares them
/// (`drives.cpp` 27-77): each split at its last dot, the name cut to
/// eight and the extension to three, upper case; `?` any one character,
/// `*` the rest of its part.
pub fn wild_file_cmp(file: &str, wild: &str) -> bool {
    let split = |text: &str| {
        let mut name = [b' '; 8];
        let mut extension = [b' '; 3];
        let (base, ext) = match text.rfind('.') {
            Some(at) => (&text[..at], &text[at + 1..]),
            None => (text, ""),
        };

        for (to, byte) in name.iter_mut().zip(base.bytes()) {
            *to = byte.to_ascii_uppercase();
        }

        for (to, byte) in extension.iter_mut().zip(ext.bytes()) {
            *to = byte.to_ascii_uppercase();
        }

        (name, extension)
    };
    let (file_name, file_ext) = split(file);
    let (wild_name, wild_ext) = split(wild);
    let part = |wild: &[u8], file: &[u8]| {
        for (w, f) in wild.iter().zip(file) {
            if *w == b'*' {
                return true;
            }

            if *w != b'?' && w != f {
                return false;
            }
        }

        true
    };

    part(&wild_name, &file_name) && part(&wild_ext, &file_ext)
}

/// A name as eleven characters, as a directory's entry holds it
/// (`convToDirFile`, 73-87): up to a dot into the eight, after it into
/// the three, spaces else; upper case, as DOS makes a name.
fn conv_to_dir_file(name: &str) -> [u8; 11] {
    let mut eleven = [b' '; 11];
    let mut at = 0;

    for byte in name.bytes() {
        if at >= 11 {
            break;
        }

        if byte == b'.' {
            at = 8;
        } else {
            eleven[at] = byte.to_ascii_uppercase();
            at += 1;
        }
    }

    eleven
}

/// The names of a path, without the empty ones DOSBox's `strtok` passes
/// over.
fn names(parts: &[String]) -> Vec<&str> {
    parts
        .iter()
        .map(String::as_str)
        .filter(|part| !part.is_empty())
        .collect()
}

/// A disk image's FAT volume, as DOSBox's `fatDrive` holds it.
#[derive(Debug)]
struct Drive {
    disk: Overlay,
    /// The image's sectors before the volume (`partSectOff`).
    part_sect_off: u32,
    sectors_per_cluster: u32,
    reserved: u32,
    fat_copies: u32,
    sectors_per_fat: u32,
    root_entries: u32,
    /// The root's first sector and the first cluster's, in the image.
    first_root_dir_sect: u32,
    first_data_sector: u32,
    /// How many clusters the volume has, as DOSBox counts them (700-706).
    count_of_clusters: u32,
    /// FAT12's entries, a cluster count below 4,085; else FAT16's
    /// (711-721).
    twelve: bool,
}

impl Drive {
    fn read_sector(&self, number: u32) -> [u8; SECTOR] {
        self.disk.sector(u64::from(number))
    }

    fn write_sector(&mut self, number: u32, bytes: &[u8; SECTOR]) {
        self.disk.put(u64::from(number), bytes);
    }

    /// Where a cluster's FAT entry is: its sector in the image and its
    /// offset in it (`getClusterValue`, 289-307).
    fn fat_place(&self, cluster: u32) -> (u32, usize) {
        let offset = if self.twelve {
            cluster.wrapping_add(cluster / 2)
        } else {
            cluster.wrapping_mul(2)
        };

        (
            self.reserved
                .wrapping_add(offset / SECTOR as u32)
                .wrapping_add(self.part_sect_off),
            (offset % SECTOR as u32) as usize,
        )
    }

    /// The FAT's sector and, for FAT12, the next, as DOSBox loads them
    /// together (309-315).
    fn fat_buffer(&self, sector: u32) -> [u8; 2 * SECTOR] {
        let mut buffer = [0u8; 2 * SECTOR];

        buffer[..SECTOR].copy_from_slice(&self.read_sector(sector));

        if self.twelve {
            buffer[SECTOR..].copy_from_slice(&self.read_sector(sector.wrapping_add(1)));
        }

        buffer
    }

    /// A cluster's entry in the first FAT (`getClusterValue`, 289-335).
    fn get_cluster_value(&self, cluster: u32) -> u32 {
        let (sector, at) = self.fat_place(cluster);
        let buffer = self.fat_buffer(sector);
        let value = u32::from(u16::from_le_bytes([buffer[at], buffer[at + 1]]));

        match (self.twelve, cluster & 1) {
            (true, 1) => value >> 4,
            (true, _) => value & 0xfff,
            _ => value,
        }
    }

    /// A cluster's entry set, and the first FAT's sector it is in written
    /// to every copy of the FAT -- the next sector too where a FAT12 entry
    /// runs into it (`setClusterValue`, 337-395).
    fn set_cluster_value(&mut self, cluster: u32, value: u32) {
        let (sector, at) = self.fat_place(cluster);
        let mut buffer = self.fat_buffer(sector);
        let old = u16::from_le_bytes([buffer[at], buffer[at + 1]]);
        let new = if !self.twelve {
            value as u16
        } else if cluster & 1 == 1 {
            (old & 0x000f) | ((value & 0xfff) << 4) as u16
        } else {
            (old & 0xf000) | (value & 0xfff) as u16
        };

        buffer[at..at + 2].copy_from_slice(&new.to_le_bytes());

        let mut first = [0u8; SECTOR];
        let mut second = [0u8; SECTOR];

        first.copy_from_slice(&buffer[..SECTOR]);
        second.copy_from_slice(&buffer[SECTOR..]);

        for copy in 0..self.fat_copies {
            let at_copy = sector.wrapping_add(copy.wrapping_mul(self.sectors_per_fat));

            self.write_sector(at_copy, &first);

            if self.twelve && at >= 511 {
                self.write_sector(at_copy.wrapping_add(1), &second);
            }
        }
    }

    fn end_of_chain(&self, value: u32) -> bool {
        value >= if self.twelve { 0xff8 } else { 0xfff8 }
    }

    fn get_clust_first_sect(&self, cluster: u32) -> u32 {
        cluster
            .wrapping_sub(2)
            .wrapping_mul(self.sectors_per_cluster)
            .wrapping_add(self.first_data_sector)
    }

    /// The sector in the image a chain's logical sector is in; nought where
    /// the chain ends first (`getAbsoluteSectFromChain`, 509-539).
    fn get_absolute_sect_from_chain(&self, start: u32, logical: u32) -> u32 {
        let mut skip = logical / self.sectors_per_cluster;
        let within = logical % self.sectors_per_cluster;
        let mut cluster = start;

        while skip != 0 {
            let value = self.get_cluster_value(cluster);

            if self.end_of_chain(value) {
                return 0;
            }

            cluster = value;
            skip -= 1;
        }

        self.get_clust_first_sect(cluster).wrapping_add(within)
    }

    fn get_absolute_sect_from_byte_pos(&self, start: u32, position: u32) -> u32 {
        self.get_absolute_sect_from_chain(start, position / SECTOR as u32)
    }

    /// A chain freed, an entry at a time, up to its end or a free entry
    /// (`deleteClustChain`, 541-567).
    fn delete_clust_chain(&mut self, start: u32) {
        let mut cluster = start;

        loop {
            let value = self.get_cluster_value(cluster);

            if value == 0 {
                break;
            }

            self.set_cluster_value(cluster, 0);

            if self.end_of_chain(value) {
                break;
            }

            cluster = value;
        }
    }

    /// A cluster added at a chain's end, zeroed: its number, nought where
    /// none is free (`appendCluster`, 569-600).
    fn append_cluster(&mut self, start: u32) -> u32 {
        let mut cluster = start;

        loop {
            let value = self.get_cluster_value(cluster);

            if self.end_of_chain(value) {
                break;
            }

            cluster = value;
        }

        let new = self.get_first_free_clust();

        if new == 0 || !self.allocate_cluster(new, cluster) {
            return 0;
        }

        self.zero_out_cluster(new);
        new
    }

    /// A cluster made a chain's end, and the one before pointed at it
    /// (`allocateCluster`, 602-628).
    fn allocate_cluster(&mut self, cluster: u32, previous: u32) -> bool {
        if cluster == 0 {
            return false;
        }

        if previous != 0 {
            if self.get_cluster_value(previous) == 0 {
                return false;
            }

            self.set_cluster_value(previous, cluster);
        }

        self.set_cluster_value(cluster, if self.twelve { 0xfff } else { 0xffff });
        true
    }

    /// The first cluster whose entry is nought; nought where none is
    /// (`getFirstFreeClust`, 753-761).
    fn get_first_free_clust(&self) -> u32 {
        (0..self.count_of_clusters)
            .map(|at| at + 2)
            .find(|&cluster| self.get_cluster_value(cluster) == 0)
            .unwrap_or(0)
    }

    fn zero_out_cluster(&mut self, cluster: u32) {
        for at in 0..self.sectors_per_cluster {
            let sector = self.get_absolute_sect_from_chain(cluster, at);

            self.write_sector(sector, &[0; SECTOR]);
        }
    }

    /// A folder's slot as DOSBox reads it, nought its cluster for the
    /// root: the root's from its first sector on, with no end to them; a
    /// folder's along its chain, none past it.
    fn slot(&self, folder: u32, at: u16) -> Option<Slot> {
        let (logical, within) = (u32::from(at) / 16, usize::from(at % 16) * 32);
        let sector = if folder == 0 {
            self.first_root_dir_sect.wrapping_add(logical)
        } else {
            match self.get_absolute_sect_from_chain(folder, logical) {
                0 => return None,
                sector => sector,
            }
        };
        let bytes = self.read_sector(sector);
        let mut slot = [0u8; 32];

        slot.copy_from_slice(&bytes[within..within + 32]);
        Some(slot)
    }

    /// The next entry a search finds from a slot (`FindNextInternal`,
    /// 898-960): each slot read in turn, the slot after it kept; a deleted
    /// one (E5h) passed over; one beginning with nought the end; one with
    /// the volume label's bit passed over, the label and a long name's
    /// VFAT entries; one hidden, system or a folder passed over unless its
    /// bit is asked for; one the pattern does not take passed over.
    fn find_next_internal(
        &self,
        folder: u32,
        attributes: u8,
        pattern: &str,
        at: &mut u16,
    ) -> Option<Slot> {
        loop {
            let slot = self.slot(folder, *at)?;

            *at = at.wrapping_add(1);

            if slot[0] == 0xe5 {
                continue;
            }

            if slot[0] == 0 {
                return None;
            }

            if slot[11] & VOLUME != 0
                || !attributes & slot[11] & (DIRECTORY | HIDDEN | SYSTEM) != 0
                || !wild_file_cmp(&find_name(&slot), pattern)
            {
                continue;
            }

            return Some(slot);
        }
    }

    /// A file's entry, its folder's cluster and its slot (`getFileDirEntry`,
    /// 418-463): the folders of its path found as folders, the search
    /// stopping at a name that is not one; then the name looked for there
    /// as a file, hidden, system or read-only, not a folder.
    fn get_file_dir_entry(&self, parts: &[String]) -> Option<(Slot, u32, u32)> {
        let names = names(parts);
        let mut cluster = 0;
        let mut find_file = "";

        for name in &names {
            find_file = name;

            let mut at = 0;
            let Some(found) = self.find_next_internal(cluster, DIRECTORY, name, &mut at) else {
                break;
            };

            if found[11] & DIRECTORY == 0 {
                break;
            }

            cluster = first_cluster(&found);
        }

        let mut at = 0;
        let found =
            self.find_next_internal(cluster, READ_ONLY | HIDDEN | SYSTEM, find_file, &mut at)?;

        Some((found, cluster, u32::from(at.wrapping_sub(1))))
    }

    /// A folder's first cluster, nought the root's, or its parent's with
    /// `parent` (`getDirClustNum`, 465-499): each folder of the path found
    /// as a search for folders finds it -- a hidden or system one not.
    fn get_dir_clust_num(&self, parts: &[String], parent: bool) -> Option<u32> {
        let names = names(parts);
        let mut cluster = 0;

        for (index, name) in names.iter().enumerate() {
            if parent && index + 1 == names.len() {
                break;
            }

            let mut at = 0;
            let found = self.find_next_internal(cluster, DIRECTORY, name, &mut at)?;

            if found[11] & DIRECTORY == 0 {
                return None;
            }

            cluster = first_cluster(&found);
        }

        Some(cluster)
    }

    /// The slot a number of slots into a folder, none where one before it
    /// or it is the end, or past the root's room (`directoryBrowse`,
    /// 998-1030); and its sector.
    fn browse(&self, folder: u32, number: i64) -> Option<(Slot, u32, usize)> {
        let mut found = None;

        for position in 0..=number {
            let at = u16::try_from(position).ok()?;

            if folder == 0 && u32::from(at) >= self.root_entries {
                return None;
            }

            let slot = self.slot(folder, at)?;

            if slot[0] == 0 {
                return None;
            }

            let logical = u32::from(at) / 16;
            let sector = if folder == 0 {
                self.first_root_dir_sect.wrapping_add(logical)
            } else {
                self.get_absolute_sect_from_chain(folder, logical)
            };

            found = Some((slot, sector, usize::from(at % 16) * 32));
        }

        found
    }

    fn directory_browse(&self, folder: u32, number: i64) -> Option<Slot> {
        self.browse(folder, number).map(|(slot, ..)| slot)
    }

    /// The slot a number of slots into a folder written over
    /// (`directoryChange`, 1032-1068).
    fn directory_change(&mut self, folder: u32, slot: &Slot, number: i64) -> bool {
        let Some((_, sector, within)) = self.browse(folder, number) else {
            return false;
        };
        let mut bytes = self.read_sector(sector);

        bytes[within..within + 32].copy_from_slice(slot);
        self.write_sector(sector, &bytes);
        true
    }

    /// An entry put in the first slot of a folder deleted or never used, a
    /// folder grown by a cluster where its clusters have none; the root
    /// not past its room (`addDirectoryEntry`, 1070-1110).
    fn add_directory_entry(&mut self, folder: u32, slot: &Slot) -> bool {
        let mut at: u16 = 0;

        loop {
            let logical = u32::from(at) / 16;
            let within = usize::from(at % 16) * 32;
            let sector = if folder == 0 {
                if u32::from(at) >= self.root_entries {
                    return false;
                }

                self.first_root_dir_sect.wrapping_add(logical)
            } else {
                let mut sector = self.get_absolute_sect_from_chain(folder, logical);

                if sector == 0 {
                    if self.append_cluster(folder) == 0 {
                        return false;
                    }

                    sector = self.get_absolute_sect_from_chain(folder, logical);

                    if sector == 0 {
                        return false;
                    }
                }

                sector
            };
            let mut bytes = self.read_sector(sector);

            at = at.wrapping_add(1);

            if bytes[within] == 0xe5 || bytes[within] == 0 {
                bytes[within..within + 32].copy_from_slice(slot);
                self.write_sector(sector, &bytes);
                return true;
            }
        }
    }

    /// A file made, or emptied where it is there, and opened read and
    /// written (`FileCreate`, 773-814): one there keeps its clusters and
    /// attributes, its size nought; one made has a zeroed entry, its name
    /// and the attributes asked for alone.
    fn file_create(
        this: &Rc<RefCell<Self>>,
        parts: &[String],
        attributes: u8,
    ) -> Option<ImageFile> {
        let mut drive = this.borrow_mut();
        let (slot, folder, index) =
            if let Some((mut slot, folder, index)) = drive.get_file_dir_entry(parts) {
                slot[28..32].fill(0);
                drive.directory_change(folder, &slot, i64::from(index));
                (slot, folder, index)
            } else {
                let name = *names(parts).last()?;
                let folder = drive.get_dir_clust_num(parts, true)?;
                let mut slot = [0u8; 32];

                slot[..11].copy_from_slice(&conv_to_dir_file(name));
                slot[11] = attributes;
                drive.add_directory_entry(folder, &slot);
                drive.get_file_dir_entry(parts)?
            };

        drop(drive);

        Some(ImageFile::new(this, &slot, folder, index, OPEN_READWRITE))
    }

    /// A file deleted: its entry's first byte E5h, its chain freed
    /// (`FileUnlink`, 843-855). A folder is not found.
    fn file_unlink(&mut self, parts: &[String]) -> bool {
        let Some((mut slot, folder, index)) = self.get_file_dir_entry(parts) else {
            return false;
        };

        slot[0] = 0xe5;
        self.directory_change(folder, &slot, i64::from(index));

        if first_cluster(&slot) != 0 {
            self.delete_clust_chain(first_cluster(&slot));
        }

        true
    }

    /// A folder made where none is (`MakeDir`, 1123-1173): the first free
    /// cluster taken and zeroed, an entry with its name and the folder's
    /// bit alone, then `.` and `..` in it, each so, `..` the parent's
    /// cluster, nought the root's.
    fn make_dir(&mut self, parts: &[String]) -> bool {
        let Some(&name) = names(parts).last() else {
            return false;
        };

        if self.get_dir_clust_num(parts, false).is_some() {
            return false;
        }

        let cluster = self.get_first_free_clust();

        if cluster == 0 || !self.allocate_cluster(cluster, 0) {
            return false;
        }

        self.zero_out_cluster(cluster);

        let Some(parent) = self.get_dir_clust_num(parts, true) else {
            return false;
        };
        let entry = |name: &[u8; 11], cluster: u32| {
            let mut slot = [0u8; 32];

            slot[..11].copy_from_slice(name);
            slot[11] = DIRECTORY;
            slot[20..22].copy_from_slice(&((cluster >> 16) as u16).to_le_bytes());
            slot[26..28].copy_from_slice(&(cluster as u16).to_le_bytes());
            slot
        };

        self.add_directory_entry(parent, &entry(&conv_to_dir_file(name), cluster));
        self.add_directory_entry(cluster, &entry(b".          ", cluster));
        self.add_directory_entry(cluster, &entry(b"..         ", parent));
        true
    }

    /// An empty folder deleted (`RemoveDir`, 1175-1226): not the root; not
    /// one with a slot past `.` and `..` that is not deleted, a long
    /// name's VFAT entries among them; its entry found in its parent by its
    /// eleven characters, E5h put first, its chain freed.
    fn remove_dir(&mut self, parts: &[String]) -> bool {
        let Some(&name) = names(parts).last() else {
            return false;
        };
        let eleven = conv_to_dir_file(name);
        let Some(cluster) = self.get_dir_clust_num(parts, false) else {
            return false;
        };

        if cluster == 0 {
            return false;
        }

        let Some(parent) = self.get_dir_clust_num(parts, true) else {
            return false;
        };
        let mut index = 2;

        while let Some(slot) = self.directory_browse(cluster, index) {
            if slot[0] != 0xe5 {
                return false;
            }

            index += 1;
        }

        let mut index = if parent == 0 { 0 } else { 2 };

        while let Some(mut slot) = self.directory_browse(parent, index) {
            if slot[..11] == eleven {
                slot[0] = 0xe5;
                self.directory_change(parent, &slot, index);
                self.delete_clust_chain(cluster);
                return true;
            }

            index += 1;
        }

        false
    }

    /// A file renamed (`Rename`, 1228-1265): a copy of its entry, the new
    /// name in it, put in the first slot free of the folder named, and the
    /// old entry deleted; a folder is not found, nor a name there already.
    fn rename(&mut self, from: &[String], to: &[String]) -> bool {
        let Some((mut old, old_folder, old_index)) = self.get_file_dir_entry(from) else {
            return false;
        };

        if self.get_file_dir_entry(to).is_some() {
            return false;
        }

        let Some(&name) = names(to).last() else {
            return false;
        };
        let Some(folder) = self.get_dir_clust_num(to, true) else {
            return false;
        };
        let mut new = old;

        new[..11].copy_from_slice(&conv_to_dir_file(name));
        self.add_directory_entry(folder, &new);

        if self.get_file_dir_entry(to).is_none() {
            return false;
        }

        old[0] = 0xe5;
        self.directory_change(old_folder, &old, i64::from(old_index));
        true
    }

    /// A file's or folder's attributes (`GetFileAttr`, 969-996): a file's
    /// entry as it is found, else a folder's, looked for by its eleven
    /// characters among its parent's slots.
    fn get_file_attr(&self, parts: &[String]) -> Option<u8> {
        if let Some((slot, ..)) = self.get_file_dir_entry(parts) {
            return Some(slot[11]);
        }

        let eleven = conv_to_dir_file(names(parts).last()?);
        let parent = self.get_dir_clust_num(parts, true)?;
        let mut index = if parent == 0 { 0 } else { 2 };

        while let Some(slot) = self.directory_browse(parent, index) {
            if slot[..11] == eleven {
                return Some(slot[11]);
            }

            index += 1;
        }

        None
    }

    /// A folder's entries as a search for everything finds them, in the
    /// order of their slots.
    fn listed(&self, folder: u32) -> Vec<Slot> {
        let mut at = 0;
        let mut found = Vec::new();

        while let Some(slot) =
            self.find_next_internal(folder, DIRECTORY | HIDDEN | SYSTEM, "*.*", &mut at)
        {
            found.push(slot);

            // A folder's slots are numbered in a word.
            if at == 0 {
                break;
            }
        }

        found
    }
}

/// A disk image's FAT volume.
#[derive(Debug)]
pub struct FatVolume {
    drive: Rc<RefCell<Drive>>,
    /// Mounted as a floppy (`imgmount -t floppy`): removable, its media
    /// byte F0h.
    floppy: bool,
}

impl FatVolume {
    /// The volume an image holds, mounted as a floppy or a hard disk. Where
    /// it begins is DOSBox's choice (`mbr::volume_start`); so is FAT12 or
    /// FAT16, by the count of its clusters, whatever its boot sector calls
    /// it.
    pub fn new(sectors: impl Sectors + 'static, floppy: bool) -> Result<Self, FatError> {
        let sectors: Box<dyn Sectors> = Box::new(sectors);
        let first = volume_start(sectors.as_ref()) as u32;
        let disk = Overlay::new(sectors);
        let boot = disk.sector(u64::from(first));
        let word = |at: usize| u32::from(u16::from_le_bytes([boot[at], boot[at + 1]]));
        let bytes_per_sector = word(11);
        let sectors_per_cluster = u32::from(boot[13]);
        let reserved = word(14);
        let fat_copies = u32::from(boot[16]);
        let root_entries = word(17);
        let sectors_per_fat = word(22);
        let total = match word(19) {
            0 => u32::from_le_bytes([boot[32], boot[33], boot[34], boot[35]]),
            total => total,
        };

        if bytes_per_sector == 0 || sectors_per_cluster == 0 {
            return Err(FatError::NotFat);
        }

        if sectors_per_fat == 0 {
            return Err(FatError::Fat32);
        }

        let root_sectors = (root_entries * 32).div_ceil(bytes_per_sector);
        let before_data = reserved + fat_copies * sectors_per_fat + root_sectors;
        let count_of_clusters = total.wrapping_sub(before_data) / sectors_per_cluster;

        Ok(Self {
            drive: Rc::new(RefCell::new(Drive {
                disk,
                part_sect_off: first,
                sectors_per_cluster,
                reserved,
                fat_copies,
                sectors_per_fat,
                root_entries,
                first_root_dir_sect: reserved + fat_copies * sectors_per_fat + first,
                first_data_sector: before_data + first,
                count_of_clusters,
                twelve: count_of_clusters < 4085,
            })),
            floppy,
        })
    }

    /// Whether the volume's FAT has 12-bit entries.
    pub fn is_fat12(&self) -> bool {
        self.drive.borrow().twelve
    }

    /// The image as programs have written it, its own bytes where nothing
    /// has been: what "Save image..." or `--write-back` keeps.
    pub fn image(&self) -> Vec<u8> {
        self.drive.borrow().disk.image()
    }

    /// The sectors written, by their number in the image, each as last
    /// written.
    pub fn written(&self) -> Vec<(u64, Vec<u8>)> {
        self.drive
            .borrow()
            .disk
            .written()
            .map(|(number, bytes)| (number, bytes.to_vec()))
            .collect()
    }

    /// Whether programs have written anything to it that it did not hold.
    pub fn changed(&self) -> bool {
        self.drive.borrow().disk.changed()
    }

    /// What a path names, as its folder lists it.
    fn locate(&self, parts: &[String]) -> Option<Entry> {
        let names = names(parts);
        let Some(name) = names.last() else {
            return Some(Entry {
                name: String::new(),
                attributes: DIRECTORY,
                size: 0,
                modified: [1980, 0, 0, 0, 0, 0],
            });
        };
        let drive = self.drive.borrow();
        let folder = drive.get_dir_clust_num(parts, true)?;

        drive
            .listed(folder)
            .iter()
            .map(slot_entry)
            .find(|entry| same_name(&entry.name, name))
    }
}

/// Two names alike as a disk image's lookup takes them: without regard to
/// case, and a file with no extension, listed with a dot after its name,
/// named with it or without (`WildFileCmp`).
pub fn same_name(listed: &str, name: &str) -> bool {
    listed
        .trim_end_matches('.')
        .eq_ignore_ascii_case(name.trim_end_matches('.'))
}

impl Volume for FatVolume {
    fn removable(&self) -> bool {
        self.floppy
    }

    /// DOSBox's `TestDir`: the path's folders each found as a search for
    /// folders finds it.
    fn is_directory(&self, parts: &[String]) -> bool {
        self.drive
            .borrow()
            .get_dir_clust_num(parts, false)
            .is_some()
    }

    fn entry(&self, parts: &[String]) -> Option<Entry> {
        self.locate(parts)
    }

    fn children(&self, parts: &[String]) -> Option<Vec<Entry>> {
        let drive = self.drive.borrow();
        let folder = drive.get_dir_clust_num(parts, false)?;

        Some(drive.listed(folder).iter().map(slot_entry).collect())
    }

    fn read(&self, parts: &[String]) -> Option<Vec<u8>> {
        let (slot, folder, index) = self.drive.borrow().get_file_dir_entry(parts)?;
        let mut file = ImageFile::new(&self.drive, &slot, folder, index, OPEN_READ);

        Some(file.read(size_of(&slot) as usize))
    }

    fn open(&mut self, parts: &[String]) -> std::io::Result<Body> {
        let (slot, folder, index) = self
            .drive
            .borrow()
            .get_file_dir_entry(parts)
            .ok_or(ErrorKind::NotFound)?;

        Ok(Body::Image(ImageFile::new(
            &self.drive,
            &slot,
            folder,
            index,
            OPEN_READWRITE,
        )))
    }

    fn create(&mut self, parts: &[String]) -> Option<Body> {
        self.create_with(parts, 0)
    }

    fn create_with(&mut self, parts: &[String], attributes: u8) -> Option<Body> {
        Drive::file_create(&self.drive, parts, attributes).map(Body::Image)
    }

    fn unlink(&mut self, parts: &[String]) -> bool {
        self.drive.borrow_mut().file_unlink(parts)
    }

    fn remove_dir(&mut self, parts: &[String]) -> bool {
        self.drive.borrow_mut().remove_dir(parts)
    }

    fn mkdir(&mut self, parts: &[String]) -> bool {
        self.drive.borrow_mut().make_dir(parts)
    }

    fn rename(&mut self, from: &[String], to: &[String]) -> bool {
        self.drive.borrow_mut().rename(from, to)
    }

    /// The volume's own: its sectors to a cluster, its clusters, and those
    /// whose FAT entry is nought free, each count at most `FFFFh`
    /// (`AllocationInfo`, 730-751).
    fn allocation(&self) -> Option<Allocation> {
        let drive = self.drive.borrow();
        let free = (0..drive.count_of_clusters)
            .filter(|&at| drive.get_cluster_value(at + 2) == 0)
            .count();

        Some(Allocation {
            sectors_per_cluster: drive.sectors_per_cluster as u16,
            free_clusters: free.min(0xffff) as u16,
            bytes_per_sector: SECTOR as u16,
            clusters: drive.count_of_clusters.min(0xffff) as u16,
        })
    }

    fn listing(&self) -> Listing {
        Listing::AsStored
    }

    fn attributes(&self, parts: &[String]) -> Option<u8> {
        self.drive.borrow().get_file_attr(parts)
    }

    fn search_folder(&self, parts: &[String]) -> Option<u32> {
        self.drive.borrow().get_dir_clust_num(parts, false)
    }

    fn find_from(&self, folder: u32, attributes: u8, pattern: &str, at: &mut u16) -> Option<Entry> {
        self.drive
            .borrow()
            .find_next_internal(folder, attributes, pattern, at)
            .map(|slot| slot_entry(&slot))
    }

    fn image(&self) -> Option<Vec<u8>> {
        Some(FatVolume::image(self))
    }

    fn changed(&self) -> bool {
        FatVolume::changed(self)
    }
}

/// A file of a disk image open, as DOSBox's `fatFile` keeps one: where it
/// begins and how long it is, where the next read or write is, the sector
/// it is in read into a buffer of its own, and where its entry is.
#[derive(Debug)]
pub struct ImageFile {
    drive: Rc<RefCell<Drive>>,
    first_cluster: u32,
    seekpos: u32,
    filelength: u32,
    current_sector: u32,
    cur_sect_off: u32,
    sector_buffer: Box<[u8; SECTOR]>,
    loaded_sector: bool,
    dir_cluster: u32,
    dir_index: u32,
    /// The mode it was opened in, its low four bits as DOS's 3Dh takes
    /// them: one opened to read is not written, one opened to write not
    /// read (`fatFile::Read` 108, `Write` 163).
    flags: u8,
    /// Its entry's creation stamp as it was opened, which 5700h answers
    /// (`FileOpen` 832-834).
    time: u16,
    date: u16,
}

impl ImageFile {
    /// A file opened (`fatFile::fatFile`, 89-105): its first sector read,
    /// where it has any bytes.
    fn new(drive: &Rc<RefCell<Drive>>, slot: &Slot, folder: u32, index: u32, flags: u8) -> Self {
        let mut file = Self {
            drive: Rc::clone(drive),
            first_cluster: first_cluster(slot),
            seekpos: 0,
            filelength: size_of(slot),
            current_sector: 0,
            cur_sect_off: 0,
            sector_buffer: Box::new([0; SECTOR]),
            loaded_sector: false,
            dir_cluster: folder,
            dir_index: index,
            flags,
            time: word(slot, 14),
            date: word(slot, 16),
        };

        if file.filelength > 0 {
            file.dos_seek(0, 0);
            *file.sector_buffer = file.drive.borrow().read_sector(file.current_sector);
            file.loaded_sector = true;
        }

        file
    }

    /// The mode it is opened in, as DOS's 3Dh's AL gives it.
    pub fn set_mode(&mut self, mode: u8) {
        self.flags = mode;
    }

    /// Whether a read is refused: a file opened to write alone.
    pub fn refuses_read(&self) -> bool {
        self.flags & 0x0f == OPEN_WRITE
    }

    /// Whether a write is refused: a file opened to read alone.
    pub fn refuses_write(&self) -> bool {
        self.flags & 0x0f == OPEN_READ
    }

    /// Its entry's creation stamp as it was opened: the time and the date.
    pub fn stamp(&self) -> (u16, u16) {
        (self.time, self.date)
    }

    /// Bytes read from where it is (`fatFile::Read`, 107-158).
    pub fn read(&mut self, length: usize) -> Vec<u8> {
        let mut data = Vec::new();

        if self.seekpos >= self.filelength {
            return data;
        }

        let drive = Rc::clone(&self.drive);
        let drive = drive.borrow();

        if !self.loaded_sector {
            self.current_sector =
                drive.get_absolute_sect_from_byte_pos(self.first_cluster, self.seekpos);

            if self.current_sector == 0 {
                return data;
            }

            self.cur_sect_off = 0;
            *self.sector_buffer = drive.read_sector(self.current_sector);
            self.loaded_sector = true;
        }

        while data.len() < length {
            if self.seekpos >= self.filelength {
                return data;
            }

            data.push(self.sector_buffer[self.cur_sect_off as usize % SECTOR]);
            self.cur_sect_off += 1;
            self.seekpos += 1;

            if self.cur_sect_off >= SECTOR as u32 {
                self.current_sector =
                    drive.get_absolute_sect_from_byte_pos(self.first_cluster, self.seekpos);

                if self.current_sector == 0 {
                    self.loaded_sector = false;
                    return data;
                }

                self.cur_sect_off = 0;
                *self.sector_buffer = drive.read_sector(self.current_sector);
                self.loaded_sector = true;
            }
        }

        data
    }

    /// Bytes written where it is (`fatFile::Write`, 160-236): a file of
    /// none given the first free cluster, one at its chain's end another,
    /// each sector written as it is left and the last as the write ends;
    /// then its entry's size and first cluster -- and nothing else, no
    /// stamp. How many were written.
    pub fn write(&mut self, bytes: &[u8]) -> usize {
        let drive = Rc::clone(&self.drive);
        let mut drive = drive.borrow_mut();
        let mut count = 0;

        'write: {
            for &byte in bytes {
                if self.seekpos >= self.filelength {
                    if self.filelength == 0 {
                        self.first_cluster = drive.get_first_free_clust();
                        drive.allocate_cluster(self.first_cluster, 0);
                        self.current_sector =
                            drive.get_absolute_sect_from_byte_pos(self.first_cluster, self.seekpos);
                        *self.sector_buffer = drive.read_sector(self.current_sector);
                        self.loaded_sector = true;
                    }

                    self.filelength = self.seekpos + 1;

                    if !self.loaded_sector {
                        self.current_sector =
                            drive.get_absolute_sect_from_byte_pos(self.first_cluster, self.seekpos);

                        if self.current_sector == 0 {
                            drive.append_cluster(self.first_cluster);
                            self.current_sector = drive
                                .get_absolute_sect_from_byte_pos(self.first_cluster, self.seekpos);

                            if self.current_sector == 0 {
                                break 'write;
                            }
                        }

                        self.cur_sect_off = 0;
                        *self.sector_buffer = drive.read_sector(self.current_sector);
                        self.loaded_sector = true;
                    }
                }

                self.sector_buffer[self.cur_sect_off as usize % SECTOR] = byte;
                self.cur_sect_off += 1;
                count += 1;
                self.seekpos += 1;

                if self.cur_sect_off >= SECTOR as u32 {
                    if self.loaded_sector {
                        drive.write_sector(self.current_sector, &self.sector_buffer);
                    }

                    self.current_sector =
                        drive.get_absolute_sect_from_byte_pos(self.first_cluster, self.seekpos);

                    if self.current_sector == 0 {
                        drive.append_cluster(self.first_cluster);
                        self.current_sector =
                            drive.get_absolute_sect_from_byte_pos(self.first_cluster, self.seekpos);

                        if self.current_sector == 0 {
                            self.loaded_sector = false;
                            break 'write;
                        }
                    }

                    self.cur_sect_off = 0;
                    *self.sector_buffer = drive.read_sector(self.current_sector);
                    self.loaded_sector = true;
                }
            }

            if self.cur_sect_off > 0 && self.loaded_sector {
                drive.write_sector(self.current_sector, &self.sector_buffer);
            }
        }

        // `finalizeWrite`: the entry read again, its size and first cluster
        // set, written back.
        if let Some(mut slot) = drive.directory_browse(self.dir_cluster, i64::from(self.dir_index))
        {
            slot[28..32].copy_from_slice(&self.filelength.to_le_bytes());
            slot[26..28].copy_from_slice(&(self.first_cluster as u16).to_le_bytes());
            drive.directory_change(self.dir_cluster, &slot, i64::from(self.dir_index));
        }

        count
    }

    /// DOSBox's `fatFile::Seek` (238-268): from the start, from where it
    /// is or from its end; no further than its end, nor before its start;
    /// the sector there read.
    fn dos_seek(&mut self, position: u32, basis: u8) -> u32 {
        let mut to = match basis {
            0 => position as i32,
            1 => (position as i32).wrapping_add(self.seekpos as i32),
            _ => (self.filelength as i32).wrapping_add(position as i32),
        };

        if to as u32 > self.filelength {
            to = self.filelength as i32;
        }

        if to < 0 {
            to = 0;
        }

        self.seekpos = to as u32;

        let drive = self.drive.borrow();

        self.current_sector =
            drive.get_absolute_sect_from_byte_pos(self.first_cluster, self.seekpos);

        if self.current_sector == 0 {
            self.loaded_sector = false;
        } else {
            self.cur_sect_off = self.seekpos % SECTOR as u32;
            *self.sector_buffer = drive.read_sector(self.current_sector);
        }

        self.seekpos
    }

    /// Where it is moved to, as DOSBox's seek moves it; where it is, for
    /// `SeekFrom::Current(0)`, without a seek.
    pub fn seek(&mut self, to: SeekFrom) -> Option<u64> {
        let at = match to {
            SeekFrom::Current(0) => self.seekpos,
            SeekFrom::Start(at) => self.dos_seek(at as u32, 0),
            SeekFrom::Current(by) => self.dos_seek(by as u32, 1),
            SeekFrom::End(by) => self.dos_seek(by as u32, 2),
        };

        Some(u64::from(at))
    }

    /// DOS's write of nought bytes, which on an image cuts nothing: its
    /// sector written back where one is read, its entry's size and first
    /// cluster written again (`fatFile::Write` with nought to write).
    pub fn truncate(&mut self, _length: u64) -> bool {
        self.write(&[]);
        true
    }

    pub fn size(&self) -> u64 {
        u64::from(self.filelength)
    }

    /// Closed: its sector written back where one is read, written to or
    /// not (`fatFile::Close`, 270-275). No stamp.
    pub fn close(&mut self) {
        if self.loaded_sector {
            self.drive
                .borrow_mut()
                .write_sector(self.current_sector, &self.sector_buffer);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::Files;

    fn image(name: &str) -> Vec<u8> {
        std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../oracle/probes/images")
                .join(name),
        )
        .unwrap()
    }

    fn names_of(files: &Files, letter: char, parts: &[String]) -> Vec<String> {
        files
            .list(letter, parts)
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect()
    }

    /// `imgflop`'s floppy: FAT12, listed as the image keeps it, each
    /// entry's creation stamp its date and time.
    #[test]
    fn reads_a_floppy_image() {
        let volume = FatVolume::new(image("imgflop.img"), true).unwrap();

        assert!(volume.is_fat12());
        assert_eq!(volume.media_byte(), 0xf0);

        let mut files = Files::new();

        files.mount('A', volume);

        let root = files.list('A', &[String::new()]).unwrap();
        let names: Vec<&str> = root.iter().map(|entry| entry.name.as_str()).collect();

        assert_eq!(
            names,
            [
                "README.TXT",
                "ZEBRA.TXT",
                "APPLE.TXT",
                "LONGFI~1.TXT",
                "DATA.BIN",
                "SUBDIR",
                "HIDDEN.SYS"
            ]
        );
        // Created 1993-04-05 06:07:08, written 1992-03-10 03:10:00.
        assert_eq!(root[0].modified, [1993, 4, 5, 6, 7, 8]);
        assert_eq!(root[6].attributes, 0x27);
        assert_eq!(
            names_of(&files, 'A', &["subdir".into()]),
            [".", "..", "NESTED", "INNER.TXT"]
        );

        // Six clusters, through 12-bit entries.
        let (_, data) = files.read_from("A:\\", "data.bin").unwrap();

        assert_eq!(data.len(), 3000);
        assert_eq!(data[..4], [0x00, 0x07, 0x0e, 0x15]);
        assert!(files.read_from("A:\\", "Long File Name.txt").is_none());
        assert!(files.read_from("A:\\", "DELETED.TXT").is_none());
        assert_eq!(
            files.allocation('A'),
            Some(Allocation {
                sectors_per_cluster: 1,
                free_clusters: 2832,
                bytes_per_sector: 512,
                clusters: 2847,
            })
        );
    }

    /// What `imgflop` writes, as DOSBox writes it: a file made in the first
    /// deleted slot, a folder at the end, the rename at the end after it,
    /// the old name and the file deleted made E5h; every stamp nought; one
    /// cluster each taken, one given back. The image itself untouched.
    #[test]
    fn writes_a_floppy_image_as_dosbox_does() {
        let bytes = image("imgflop.img");
        let volume = FatVolume::new(Rc::new(bytes.clone()), true).unwrap();
        let mut files = Files::new();

        files.mount('A', volume);

        let handle = files.create("A:\\NEW.TXT").unwrap();

        assert_eq!(files.resolve(handle).unwrap().write(b"written\r\n"), 9);
        assert!(files.close(handle));
        assert!(files.make_directory('A', &[String::new()], "NEWDIR"));
        assert!(files.rename(
            'A',
            (&[String::new()], "NEW.TXT"),
            (&[String::new()], "RENAMED.TXT")
        ));
        assert!(files.unlink('A', &[String::new()], "ZEBRA.TXT"));

        let root = files.list('A', &[String::new()]).unwrap();
        let names: Vec<&str> = root.iter().map(|entry| entry.name.as_str()).collect();

        assert_eq!(
            names,
            [
                "README.TXT",
                "APPLE.TXT",
                "LONGFI~1.TXT",
                "DATA.BIN",
                "SUBDIR",
                "HIDDEN.SYS",
                "NEWDIR",
                "RENAMED.TXT"
            ]
        );
        assert_eq!(root[7].attributes, 0);
        assert_eq!(root[7].size, 9);
        assert_eq!(root[7].modified, [1980, 0, 0, 0, 0, 0]);
        assert_eq!(names_of(&files, 'A', &["NEWDIR".into()]), [".", ".."]);
        assert_eq!(files.allocation('A').unwrap().free_clusters, 2831);

        let (_, written) = files.read_from("A:\\", "renamed.txt").unwrap();

        assert_eq!(written, b"written\r\n");
        assert_eq!(bytes, image("imgflop.img"));
    }

    /// A write that fills its cluster to the end takes the next, zeroed, as
    /// DOSBox's does; a file made over one there keeps its clusters lost.
    #[test]
    fn writes_clusters_as_dosbox_takes_them() {
        let mut files = Files::new();

        files.mount('A', FatVolume::new(image("imgflop.img"), true).unwrap());

        let free = |files: &Files| files.allocation('A').unwrap().free_clusters;
        let before = free(&files);
        let handle = files.create("A:\\FULL.TXT").unwrap();

        assert_eq!(files.resolve(handle).unwrap().write(&[b'x'; 512]), 512);
        files.close(handle);
        assert_eq!(free(&files), before - 2);

        let handle = files.create("A:\\FULL.TXT").unwrap();

        assert_eq!(files.resolve(handle).unwrap().size(), 0);
        assert_eq!(files.resolve(handle).unwrap().write(b"y"), 1);
        files.close(handle);
        assert_eq!(free(&files), before - 3);
    }

    /// A seek stops at the file's end; a file with no extension lists with
    /// a dot after its name, and is found by it with or without.
    #[test]
    fn seeks_and_names_as_dosbox_does() {
        let mut files = Files::new();

        files.mount('A', FatVolume::new(image("imgflop.img"), true).unwrap());

        let handle = files.open("A:\\README.TXT").unwrap();
        let file = files.resolve(handle).unwrap();

        assert_eq!(file.seek(SeekFrom::Start(5000)), Some(0x39));
        assert_eq!(file.seek(SeekFrom::Current(-1)), Some(0x38));
        files.close(handle);

        let handle = files.create("A:\\NOEXT").unwrap();

        files.close(handle);
        assert!(names_of(&files, 'A', &[String::new()]).contains(&"NOEXT.".to_string()));
        assert!(files.lookup('A', &[String::new()], "NOEXT").is_some());
        assert!(files.open("A:\\NOEXT").is_some());
    }

    /// `imghdd`'s hard disk: its partition from sector 63, FAT16.
    #[test]
    fn reads_a_hard_disk_image() {
        let bytes = image("imghdd.img");

        assert_eq!(volume_start(&bytes), 63);

        let volume = FatVolume::new(bytes, false).unwrap();

        assert!(!volume.is_fat12());
        assert_eq!(volume.media_byte(), 0xf8);

        let names: Vec<String> = volume
            .children(&[String::new()])
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();

        assert_eq!(names, ["FIRST.TXT", "SECOND.TXT", "HARDSUB"]);
        assert_eq!(
            volume.allocation(),
            Some(Allocation {
                sectors_per_cluster: 1,
                free_clusters: 5917,
                bytes_per_sector: 512,
                clusters: 5921,
            })
        );
    }

    #[test]
    fn refuses_fat32_and_what_is_no_fat() {
        let mut boot = vec![0u8; 1_474_560];

        assert_eq!(
            FatVolume::new(boot.clone(), true).err(),
            Some(FatError::NotFat)
        );
        boot[11] = 0;
        boot[12] = 2;
        boot[13] = 1;
        assert_eq!(FatVolume::new(boot, true).err(), Some(FatError::Fat32));
    }

    #[test]
    fn compares_names_as_dosbox_does() {
        assert!(wild_file_cmp("README.TXT", "*.*"));
        assert!(wild_file_cmp("README.TXT", "readme.txt"));
        assert!(wild_file_cmp("NOEXT.", "NOEXT"));
        assert!(wild_file_cmp("ZEBRA.TXT", "?????.TXT"));
        assert!(!wild_file_cmp("README.TXT", "?????.TXT"));
        assert!(wild_file_cmp("SUBDIR", "SUBDIR"));
        assert_eq!(&conv_to_dir_file("new.txt"), b"NEW     TXT");
    }
}
