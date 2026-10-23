//! A removable drive with nothing in it: a floppy drive whose disk was
//! taken out, or a CD-ROM drive whose disc was (`Files::eject`). DOS
//! answers it as DOSBox answers its floppy drive with nothing mounted: no
//! drive (`Files::has_disk`, error 0Fh). A CD-ROM drive stays remote, so
//! MSCDEX still counts it (`multiplex_interrupt`).

use std::io::{Error, ErrorKind};

use super::{Body, Entry, Volume};

/// An empty removable drive: only its root, with nothing in it.
#[derive(Debug, Clone, Copy, Default)]
pub struct EmptyDrive {
    /// A CD-ROM drive's, as DOSBox's are remote.
    pub remote: bool,
}

impl EmptyDrive {
    /// The drive another leaves when its disk is taken out: a CD-ROM
    /// drive's empty if it was one, else a floppy drive's.
    pub fn after(volume: &dyn Volume) -> Self {
        Self {
            remote: volume.remote(),
        }
    }
}

/// Whether a path is the root's.
fn is_root(parts: &[String]) -> bool {
    parts.iter().all(String::is_empty)
}

impl Volume for EmptyDrive {
    fn removable(&self) -> bool {
        true
    }

    fn is_directory(&self, parts: &[String]) -> bool {
        is_root(parts)
    }

    fn entry(&self, parts: &[String]) -> Option<Entry> {
        is_root(parts).then(|| Entry {
            name: String::new(),
            attributes: 0x10,
            size: 0,
            modified: [1980, 1, 1, 0, 0, 0],
        })
    }

    fn children(&self, parts: &[String]) -> Option<Vec<Entry>> {
        is_root(parts).then(Vec::new)
    }

    fn read(&self, _parts: &[String]) -> Option<Vec<u8>> {
        None
    }

    fn open(&mut self, _parts: &[String]) -> std::io::Result<Body> {
        Err(Error::from(ErrorKind::NotFound))
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

    fn remote(&self) -> bool {
        self.remote
    }

    /// A CD-ROM drive's F8h, as its disc's (`IsoVolume`); a floppy drive's
    /// F0h.
    fn media_byte(&self) -> u8 {
        if self.remote { 0xf8 } else { 0xf0 }
    }
}
