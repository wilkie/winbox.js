//! Where a disk image's FAT volume begins, as DOSBox 0.74-3's `fatDrive`
//! finds it (`drive_fat.cpp` 642-679): an image of 2,880 KB or less is a
//! floppy, its volume from the first sector; a larger one is a hard disk,
//! its volume the first partition of the master boot record with any
//! sectors, else from sector 63.

use std::fmt::Debug;
use std::rc::Rc;

/// A disk image's bytes, read by sector: held in memory here, a file of the
/// host's for the native build later.
pub trait Sectors: Debug {
    /// How many bytes the image holds.
    fn size(&self) -> u64;

    /// Bytes from an offset into `into`; noughts past the image's end.
    fn read_at(&self, offset: u64, into: &mut [u8]);
}

impl Sectors for Vec<u8> {
    fn size(&self) -> u64 {
        self.len() as u64
    }

    fn read_at(&self, offset: u64, into: &mut [u8]) {
        read_slice(self, offset, into);
    }
}

impl Sectors for Rc<Vec<u8>> {
    fn size(&self) -> u64 {
        self.len() as u64
    }

    fn read_at(&self, offset: u64, into: &mut [u8]) {
        read_slice(self, offset, into);
    }
}

fn read_slice(bytes: &[u8], offset: u64, into: &mut [u8]) {
    into.fill(0);

    let Ok(start) = usize::try_from(offset) else {
        return;
    };

    if start < bytes.len() {
        let end = bytes.len().min(start + into.len());

        into[..end - start].copy_from_slice(&bytes[start..end]);
    }
}

/// The largest image DOSBox takes for a floppy, in KB: `filesize > 2880`
/// makes it a hard disk (`drive_fat.cpp` 645-654), the size in whole KB.
pub const FLOPPY_KB: u64 = 2880;

/// Whether DOSBox takes an image for a floppy: 2,880 KB or less, counted
/// in whole KB.
pub fn is_floppy(sectors: &dyn Sectors) -> bool {
    sectors.size() / 1024 <= FLOPPY_KB
}

/// The sector a FAT volume begins at in an image: nought for a floppy; for
/// a hard disk, the first of the four partition entries at 1BEh with a
/// size other than nought, its first sector (an entry's bytes 8-11, its
/// size 12-15); with none, 63 (`drive_fat.cpp` 654-679). DOSBox only logs
/// a table without 55AAh, and reads it all the same.
pub fn volume_start(sectors: &dyn Sectors) -> u64 {
    if is_floppy(sectors) {
        return 0;
    }

    let mut table = [0u8; 64];

    sectors.read_at(0x1be, &mut table);

    table
        .chunks_exact(16)
        .find(|entry| u32::from_le_bytes([entry[12], entry[13], entry[14], entry[15]]) != 0)
        .map_or(63, |entry| {
            u64::from(u32::from_le_bytes([
                entry[8], entry[9], entry[10], entry[11],
            ]))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_volume_as_dosbox_does() {
        // A floppy: no table is read.
        let mut floppy = vec![0u8; 1_474_560];

        floppy[0x1be + 8] = 9;
        floppy[0x1be + 12] = 1;
        assert_eq!(volume_start(&floppy), 0);

        // 2,880 KB and a byte more is still 2,880 in whole KB.
        assert!(is_floppy(&vec![0u8; 2880 * 1024 + 1023]));

        // A hard disk: the first entry with sectors, past an empty one.
        let mut disk = vec![0u8; 3 * 1024 * 1024];

        disk[0x1ce + 8..0x1ce + 12].copy_from_slice(&100u32.to_le_bytes());
        disk[0x1ce + 12..0x1ce + 16].copy_from_slice(&50u32.to_le_bytes());
        assert_eq!(volume_start(&disk), 100);

        // With none, sector 63.
        assert_eq!(volume_start(&vec![0u8; 3 * 1024 * 1024]), 63);
    }
}
