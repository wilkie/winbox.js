//! What a program writes to a disk image, kept apart from it a sector at a
//! time: the image itself is never changed (the owner's decision of
//! 2026-10-22, `kb/topics/drives-and-disks.md`). DOSBox writes straight
//! into the image's file (`fopen(..., "rb+")`, `drive_fat.cpp` 642;
//! `imageDisk::Write_AbsoluteSector`, `bios_disk.cpp` 169-181); here the
//! sectors it would write are held over the image's, and the image as
//! written is given back only when asked (`Overlay::image`).

use std::collections::BTreeMap;

use super::mbr::Sectors;

/// The bytes of a sector, as DOSBox's `imageDisk` reads and writes them:
/// 512 whatever the volume's boot sector says (`sector_size`,
/// `bios_disk.cpp` 187).
pub const SECTOR: usize = 512;

/// An image's sectors with what has been written over them.
#[derive(Debug)]
pub struct Overlay {
    base: Box<dyn Sectors>,
    /// The sectors written, by their number in the image, each as it was
    /// last written; a sector written as it already was is not kept.
    written: BTreeMap<u64, Box<[u8; SECTOR]>>,
}

impl Overlay {
    pub fn new(base: Box<dyn Sectors>) -> Self {
        Self {
            base,
            written: BTreeMap::new(),
        }
    }

    /// A sector, as last written or as the image holds it; noughts past
    /// the image's end.
    pub fn sector(&self, number: u64) -> [u8; SECTOR] {
        if let Some(bytes) = self.written.get(&number) {
            return **bytes;
        }

        let mut bytes = [0u8; SECTOR];

        self.base
            .read_at(number.saturating_mul(SECTOR as u64), &mut bytes);
        bytes
    }

    /// A sector written, over the image's.
    pub fn put(&mut self, number: u64, bytes: &[u8; SECTOR]) {
        if self.sector(number) != *bytes {
            self.written.insert(number, Box::new(*bytes));
        }
    }

    /// Whether anything has been written that the image did not hold.
    pub fn changed(&self) -> bool {
        !self.written.is_empty()
    }

    /// The sectors written, by their number in the image, in order: what a
    /// copy of the image needs to be the image written.
    pub fn written(&self) -> impl Iterator<Item = (u64, &[u8; SECTOR])> {
        self.written
            .iter()
            .map(|(&number, bytes)| (number, &**bytes))
    }

    /// The image as written: its bytes, each sector written put over them,
    /// longer where a sector past its end was written, as DOSBox's `fwrite`
    /// past the end of the file makes it.
    pub fn image(&self) -> Vec<u8> {
        let size = self.base.size();
        let end = self
            .written
            .keys()
            .next_back()
            .map_or(0, |&last| (last + 1) * SECTOR as u64);
        let mut bytes = vec![0u8; usize::try_from(size.max(end)).unwrap_or(0)];

        self.base.read_at(0, &mut bytes[..size as usize]);

        for (&number, sector) in &self.written {
            let at = number as usize * SECTOR;

            bytes[at..at + SECTOR].copy_from_slice(&**sector);
        }

        bytes
    }
}

impl Sectors for Overlay {
    fn size(&self) -> u64 {
        self.base.size()
    }

    fn read_at(&self, offset: u64, into: &mut [u8]) {
        let mut done = 0;

        while done < into.len() {
            let at = offset + done as u64;
            let number = at / SECTOR as u64;
            let within = (at % SECTOR as u64) as usize;
            let count = (SECTOR - within).min(into.len() - done);

            into[done..done + count].copy_from_slice(&self.sector(number)[within..within + count]);
            done += count;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_writes_apart_from_the_image() {
        let image = vec![7u8; 4 * SECTOR];
        let mut overlay = Overlay::new(Box::new(image.clone()));
        let mut sector = overlay.sector(1);

        // As it was: nothing kept.
        overlay.put(1, &sector);
        assert!(!overlay.changed());

        sector[3] = 9;
        overlay.put(1, &sector);
        assert!(overlay.changed());
        assert_eq!(overlay.sector(1)[3], 9);

        let mut read = [0u8; 4];

        overlay.read_at(SECTOR as u64 + 2, &mut read);
        assert_eq!(read, [7, 9, 7, 7]);

        // Past the end, the image grows.
        overlay.put(5, &[1; SECTOR]);

        let written = overlay.image();

        assert_eq!(written.len(), 6 * SECTOR);
        assert_eq!(written[SECTOR + 3], 9);
        assert_eq!(written[4 * SECTOR], 0);
        assert_eq!(written[5 * SECTOR], 1);
        assert_eq!(overlay.written().count(), 2);
    }
}
