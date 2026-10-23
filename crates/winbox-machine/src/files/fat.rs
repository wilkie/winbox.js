//! A FAT12 or FAT16 disk image as a drive, read as DOSBox 0.74-3's
//! `fatDrive` reads one (`drive_fat.cpp`): its folders listed in the order
//! the image keeps them, each entry's creation stamp given as its date and
//! time, its attributes the entry's own, and its room counted from the
//! FAT. **Recorded** by `imgflop` and `imghdd`.
//!
//! Nothing is written to it yet: a file made, written, renamed or deleted,
//! or a folder made, is refused. What a program writes is to be kept apart
//! from the image, the image itself never changed (the owner's decision of
//! 2026-10-22, `kb/topics/drives-and-disks.md`).

use std::io::{ErrorKind, SeekFrom};

use super::mbr::{Sectors, volume_start};
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
const VOLUME: u8 = 0x08;
const DIRECTORY: u8 = 0x10;

/// A disk image's FAT volume.
#[derive(Debug)]
pub struct FatVolume {
    sectors: Box<dyn Sectors>,
    /// Mounted as a floppy (`imgmount -t floppy`): removable, its media
    /// byte F0h.
    floppy: bool,
    /// Where the volume begins in the image, in bytes.
    start: u64,
    bytes_per_sector: u32,
    sectors_per_cluster: u32,
    root_entries: u32,
    /// The first FAT's, the root's and the first cluster's sectors, from
    /// the volume's start.
    fat_sector: u32,
    root_sector: u32,
    data_sector: u32,
    /// How many clusters the volume has, as DOSBox counts them (700-706).
    clusters: u32,
    /// FAT12's entries, a cluster count below 4,085; else FAT16's
    /// (711-721).
    twelve: bool,
}

/// What a path names: the root, which no entry names, or an entry.
#[derive(Debug, Clone)]
enum Located {
    Root,
    Entry(Found),
}

/// An entry of a folder as the image holds it.
#[derive(Debug, Clone)]
struct Found {
    entry: Entry,
    cluster: u32,
}

impl FatVolume {
    /// The volume an image holds, mounted as a floppy or a hard disk. Where
    /// it begins is DOSBox's choice (`mbr::volume_start`); so is FAT12 or
    /// FAT16, by the count of its clusters, whatever its boot sector calls
    /// it.
    pub fn new(sectors: impl Sectors + 'static, floppy: bool) -> Result<Self, FatError> {
        let sectors: Box<dyn Sectors> = Box::new(sectors);
        let first = volume_start(sectors.as_ref());
        let mut boot = [0u8; 512];

        sectors.read_at(first * 512, &mut boot);

        let word = |at: usize| u32::from(u16::from_le_bytes([boot[at], boot[at + 1]]));
        let bytes_per_sector = word(11);
        let sectors_per_cluster = u32::from(boot[13]);
        let reserved = word(14);
        let fats = u32::from(boot[16]);
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
        let root_sector = reserved + fats * sectors_per_fat;
        let data_sector = root_sector + root_sectors;
        let clusters = total.saturating_sub(data_sector) / sectors_per_cluster;

        Ok(Self {
            sectors,
            floppy,
            start: first * 512,
            bytes_per_sector,
            sectors_per_cluster,
            root_entries,
            fat_sector: reserved,
            root_sector,
            data_sector,
            clusters,
            twelve: clusters < 4085,
        })
    }

    /// Whether the volume's FAT has 12-bit entries.
    pub fn is_fat12(&self) -> bool {
        self.twelve
    }

    fn read(&self, sector: u32, offset: u32, into: &mut [u8]) {
        self.sectors.read_at(
            self.start + u64::from(sector) * u64::from(self.bytes_per_sector) + u64::from(offset),
            into,
        );
    }

    /// A cluster's entry in the first FAT (`getClusterValue`, 289-335).
    fn cluster_value(&self, cluster: u32) -> u32 {
        let offset = if self.twelve {
            cluster + cluster / 2
        } else {
            cluster * 2
        };
        let mut two = [0u8; 2];

        self.read(self.fat_sector, offset, &mut two);

        let value = u32::from(u16::from_le_bytes(two));

        match (self.twelve, cluster & 1) {
            (true, 1) => value >> 4,
            (true, _) => value & 0xfff,
            _ => value,
        }
    }

    /// The clusters a chain runs through from its first, to the end of
    /// the chain (`FF8h` and above, `FFF8h` for FAT16, 516-536), or to a
    /// cluster no volume has.
    fn chain(&self, first: u32) -> Vec<u32> {
        let end = if self.twelve { 0xff8 } else { 0xfff8 };
        let mut chain = Vec::new();
        let mut cluster = first;

        while (2..self.clusters + 2).contains(&cluster) && chain.len() <= self.clusters as usize {
            chain.push(cluster);

            let next = self.cluster_value(cluster);

            if next >= end {
                break;
            }

            cluster = next;
        }

        chain
    }

    fn cluster_bytes(&self) -> u32 {
        self.bytes_per_sector * self.sectors_per_cluster
    }

    /// A chain's bytes, as many as `length` where it holds them.
    fn chain_bytes(&self, first: u32, length: usize) -> Vec<u8> {
        let size = self.cluster_bytes() as usize;
        let mut bytes = Vec::with_capacity(length.min(1 << 20));

        for cluster in self.chain(first) {
            if bytes.len() >= length {
                break;
            }

            let at = bytes.len();

            bytes.resize(at + size, 0);
            self.read(
                (cluster - 2) * self.sectors_per_cluster + self.data_sector,
                0,
                &mut bytes[at..],
            );
        }

        bytes.truncate(length);
        bytes
    }

    /// A folder's entries' slots, nought its cluster for the root, up to
    /// the first whose name begins with nought.
    fn slots(&self, cluster: u32) -> Vec<[u8; 32]> {
        let bytes = if cluster == 0 {
            let mut root = vec![0u8; self.root_entries as usize * 32];

            self.read(self.root_sector, 0, &mut root);
            root
        } else {
            self.chain_bytes(cluster, usize::MAX)
        };

        bytes
            .chunks_exact(32)
            .map(|slot| <[u8; 32]>::try_from(slot).unwrap_or([0; 32]))
            .take_while(|slot| slot[0] != 0)
            .collect()
    }

    /// A folder's entries as DOSBox's search finds them
    /// (`FindNextInternal`, 898-960): in the order of their slots, a
    /// deleted entry (E5h) passed over, and every entry with the volume
    /// label's bit -- the label, and a long name's VFAT entries (0Fh); the
    /// name and extension each trimmed, joined by a dot where there is an
    /// extension; the date and time the entry's creation stamp (bytes
    /// 0Eh-11h, 957).
    fn listed(&self, cluster: u32) -> Vec<Found> {
        self.slots(cluster)
            .into_iter()
            .filter(|slot| slot[0] != 0xe5 && slot[11] & VOLUME == 0)
            .map(|slot| {
                let text = |bytes: &[u8]| {
                    bytes
                        .iter()
                        .map(|&byte| char::from(byte))
                        .collect::<String>()
                        .trim_matches(' ')
                        .to_string()
                };
                let (base, extension) = (text(&slot[..8]), text(&slot[8..11]));
                let name = if extension.is_empty() {
                    base
                } else {
                    format!("{base}.{extension}")
                };
                let word = |at: usize| u16::from_le_bytes([slot[at], slot[at + 1]]);
                let (time, date) = (word(14), word(16));

                Found {
                    entry: Entry {
                        name,
                        attributes: slot[11],
                        size: u32::from_le_bytes([slot[28], slot[29], slot[30], slot[31]]),
                        modified: [
                            1980 + (date >> 9),
                            date >> 5 & 0x0f,
                            date & 0x1f,
                            time >> 11,
                            time >> 5 & 0x3f,
                            (time & 0x1f) * 2,
                        ],
                    },
                    cluster: u32::from(word(26)),
                }
            })
            .collect()
    }

    /// What a path names, found a name at a time without regard to case,
    /// each but the last a folder.
    fn locate(&self, parts: &[String]) -> Option<Located> {
        let names: Vec<&String> = parts.iter().filter(|part| !part.is_empty()).collect();
        let mut cluster = 0;
        let mut found = None;

        for (at, name) in names.iter().enumerate() {
            if at > 0 && found.as_ref().is_none_or(|found: &Found| !is_folder(found)) {
                return None;
            }

            let next = self
                .listed(cluster)
                .into_iter()
                .find(|entry| entry.entry.name.eq_ignore_ascii_case(name))?;

            cluster = next.cluster;
            found = Some(next);
        }

        Some(found.map_or(Located::Root, Located::Entry))
    }

    /// A folder's first cluster, nought the root's.
    fn folder(&self, parts: &[String]) -> Option<u32> {
        match self.locate(parts)? {
            Located::Root => Some(0),
            Located::Entry(found) if is_folder(&found) => Some(found.cluster),
            Located::Entry(_) => None,
        }
    }

    /// A file's bytes, as long as its entry says where its chain holds
    /// them (`fatFile::Read`, 107-158).
    fn file(&self, parts: &[String]) -> Option<Vec<u8>> {
        let Located::Entry(found) = self.locate(parts)? else {
            return None;
        };

        if is_folder(&found) {
            return None;
        }

        Some(self.chain_bytes(found.cluster, found.entry.size as usize))
    }
}

fn is_folder(found: &Found) -> bool {
    found.entry.attributes & DIRECTORY != 0
}

impl Volume for FatVolume {
    fn removable(&self) -> bool {
        self.floppy
    }

    fn is_directory(&self, parts: &[String]) -> bool {
        self.folder(parts).is_some()
    }

    fn entry(&self, parts: &[String]) -> Option<Entry> {
        match self.locate(parts)? {
            Located::Entry(found) => Some(found.entry),
            Located::Root => Some(Entry {
                name: String::new(),
                attributes: DIRECTORY,
                size: 0,
                modified: [1980, 0, 0, 0, 0, 0],
            }),
        }
    }

    fn children(&self, parts: &[String]) -> Option<Vec<Entry>> {
        Some(
            self.listed(self.folder(parts)?)
                .into_iter()
                .map(|found| found.entry)
                .collect(),
        )
    }

    fn read(&self, parts: &[String]) -> Option<Vec<u8>> {
        self.file(parts)
    }

    fn open(&mut self, parts: &[String]) -> std::io::Result<Body> {
        let data = self.file(parts).ok_or(ErrorKind::NotFound)?;

        Ok(Body::Image(ImageFile { data, at: 0 }))
    }

    fn create(&mut self, _parts: &[String]) -> Option<Body> {
        None
    }

    fn unlink(&mut self, _parts: &[String]) -> bool {
        false
    }

    fn mkdir(&mut self, _parts: &[String]) -> bool {
        false
    }

    fn rename(&mut self, _from: &[String], _to: &[String]) -> bool {
        false
    }

    /// The volume's own: its sectors to a cluster, its clusters, and those
    /// whose FAT entry is nought free, each count at most `FFFFh`
    /// (`AllocationInfo`, 730-751).
    fn allocation(&self) -> Option<Allocation> {
        let free = (2..self.clusters + 2)
            .filter(|&cluster| self.cluster_value(cluster) == 0)
            .count();

        Some(Allocation {
            sectors_per_cluster: self.sectors_per_cluster as u16,
            free_clusters: free.min(0xffff) as u16,
            bytes_per_sector: self.bytes_per_sector as u16,
            clusters: self.clusters.min(0xffff) as u16,
        })
    }

    fn listing(&self) -> Listing {
        Listing::AsStored
    }
}

/// A file of a disk image open: its bytes, read as it was opened, and
/// where in them the next read is. Nothing is written to it yet.
#[derive(Debug)]
pub struct ImageFile {
    data: Vec<u8>,
    at: u64,
}

impl ImageFile {
    /// Nothing written: the image is not written to yet.
    pub fn write(&mut self, _bytes: &[u8]) -> usize {
        0
    }

    pub fn read(&mut self, length: usize) -> Vec<u8> {
        let start = usize::try_from(self.at)
            .unwrap_or(usize::MAX)
            .min(self.data.len());
        let end = start + length.min(self.data.len() - start);

        self.at += (end - start) as u64;
        self.data[start..end].to_vec()
    }

    pub fn seek(&mut self, to: SeekFrom) -> Option<u64> {
        let (base, by) = match to {
            SeekFrom::Start(at) => (at, 0),
            SeekFrom::End(by) => (self.size(), by),
            SeekFrom::Current(by) => (self.at, by),
        };

        self.at = base.checked_add_signed(by)?;
        Some(self.at)
    }

    /// Not cut: the image is not written to yet.
    pub fn truncate(&mut self, _length: u64) -> bool {
        false
    }

    pub fn size(&self) -> u64 {
        self.data.len() as u64
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

        let inner: Vec<String> = files
            .list('A', &["subdir".into()])
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();

        assert_eq!(inner, [".", "..", "NESTED", "INNER.TXT"]);

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

        // Not written to.
        assert_eq!(files.create("A:\\NEW.TXT"), None);
        assert!(!files.make_directory('A', &[String::new()], "NEWDIR"));
        assert!(!files.unlink('A', &[String::new()], "ZEBRA.TXT"));
        assert!(!files.set_attributes('A', &[String::new()], "ZEBRA.TXT", 0));

        let handle = files.open("A:\\README.TXT").unwrap();

        assert_eq!(files.resolve(handle).unwrap().write(b"x"), 0);
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
}
