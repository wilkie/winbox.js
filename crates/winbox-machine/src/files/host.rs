//! A drive that is a directory of the host's, its names found without
//! regard to case, as DOS finds them.

use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use super::{Body, Entry, Volume, stamp};

/// A drive: a directory of the host's, over which may lie another it only
/// reads -- an installation's, which a program's writes must not change.
/// What the drive's own directory holds is found first, then what the
/// other does; a file written that is only in the other is copied up
/// first, and one deleted there is hidden.
#[derive(Debug, Clone)]
pub struct HostDrive {
    pub root: PathBuf,
    /// The directory read beneath it, if any.
    pub lower: Option<PathBuf>,
    /// Whether the drive is removable, as a floppy is.
    pub removable: bool,
    /// What of the lower directory is deleted, as far as the drive goes.
    hidden: HashSet<PathBuf>,
}

impl HostDrive {
    /// A fixed drive of a directory of the host's.
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            lower: None,
            removable: false,
            hidden: HashSet::new(),
        }
    }

    /// A fixed drive of a directory over another it only reads.
    pub fn over(root: PathBuf, lower: PathBuf) -> Self {
        Self {
            lower: Some(lower),
            ..Self::new(root)
        }
    }

    /// A removable drive.
    pub fn removable(root: PathBuf) -> Self {
        Self {
            removable: true,
            ..Self::new(root)
        }
    }

    /// A name in a host folder, found without regard to case.
    fn found_in(folder: &Path, name: &str) -> Option<PathBuf> {
        std::fs::read_dir(folder).ok().and_then(|entries| {
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
    }

    /// A DOS path's parts under a host directory, each there.
    fn resolve_in(base: &Path, parts: &[String]) -> Option<PathBuf> {
        let mut path = base.to_path_buf();

        for part in parts.iter().filter(|part| !part.is_empty()) {
            path = Self::found_in(&path, part)?;
        }

        Some(path)
    }

    fn is_hidden(&self, path: &Path) -> bool {
        path.ancestors()
            .any(|ancestor| self.hidden.contains(ancestor))
    }

    /// Where the lower directory has a path, if it does and it is not
    /// hidden.
    fn in_lower(&self, parts: &[String]) -> Option<PathBuf> {
        let path = Self::resolve_in(self.lower.as_ref()?, parts)?;

        (!self.is_hidden(&path)).then_some(path)
    }

    /// Where a path is: the drive's own directory's, else the lower one's.
    fn find(&self, parts: &[String]) -> Option<PathBuf> {
        Self::resolve_in(&self.root, parts).or_else(|| self.in_lower(parts))
    }

    /// Where a path is or would be in the drive's own directory: each name
    /// as it is there, else upper case.
    fn upper(&self, parts: &[String]) -> PathBuf {
        let mut path = self.root.clone();

        for part in parts.iter().filter(|part| !part.is_empty()) {
            path =
                Self::found_in(&path, part).unwrap_or_else(|| path.join(part.to_ascii_uppercase()));
        }

        path
    }

    /// Where a path is to be written, in the drive's own directory: its
    /// folders made, and a file only the lower directory has copied up.
    fn writable(&mut self, parts: &[String]) -> Option<PathBuf> {
        let target = self.upper(parts);

        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).ok()?;
        }

        if !target.exists()
            && let Some(lower) = self.in_lower(parts)
            && lower.is_file()
        {
            std::fs::copy(&lower, &target).ok()?;
        }

        Some(target)
    }
}

/// A host file's entry.
fn entry_of(path: &Path) -> Option<Entry> {
    let metadata = std::fs::metadata(path).ok()?;
    let seconds = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_secs() as i64);

    Some(Entry {
        name: path.file_name()?.to_string_lossy().to_ascii_uppercase(),
        attributes: if metadata.is_dir() { 0x10 } else { 0x20 },
        size: metadata.len().min(u64::from(u32::MAX)) as u32,
        modified: stamp(seconds),
    })
}

impl Volume for HostDrive {
    fn removable(&self) -> bool {
        self.removable
    }

    fn is_directory(&self, parts: &[String]) -> bool {
        self.find(parts).is_some_and(|path| path.is_dir())
    }

    fn entry(&self, parts: &[String]) -> Option<Entry> {
        entry_of(&self.find(parts)?)
    }

    /// The entries a folder holds, the drive's own directory's first.
    fn children(&self, parts: &[String]) -> Option<Vec<Entry>> {
        let upper = Self::resolve_in(&self.root, parts);
        let lower = self.in_lower(parts);

        if upper.is_none() && lower.is_none() {
            return None;
        }

        let mut names = HashSet::new();
        let mut paths = Vec::new();

        for folder in [upper, lower].into_iter().flatten() {
            for entry in std::fs::read_dir(&folder).into_iter().flatten().flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_ascii_uppercase();

                if !self.is_hidden(&path) && names.insert(name) {
                    paths.push(path);
                }
            }
        }

        Some(paths.iter().filter_map(|path| entry_of(path)).collect())
    }

    fn read(&self, parts: &[String]) -> Option<Vec<u8>> {
        std::fs::read(self.find(parts)?).ok()
    }

    /// The drive's own file opened to read and write, else to read; else
    /// the lower directory's, to read, copied up when first written.
    fn open(&mut self, parts: &[String]) -> std::io::Result<Body> {
        let own = Self::resolve_in(&self.root, parts).filter(|path| path.is_file());

        if let Some(own) = own {
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .open(&own)
                .or_else(|_| File::open(&own))?;

            Ok(Body::Host(HostFile {
                file,
                path: own,
                copy_to: None,
            }))
        } else if let Some(lower) = self.in_lower(parts).filter(|path| path.is_file()) {
            Ok(Body::Host(HostFile {
                file: File::open(&lower)?,
                path: lower,
                copy_to: Some(self.upper(parts)),
            }))
        } else {
            Err(ErrorKind::NotFound.into())
        }
    }

    fn create(&mut self, parts: &[String]) -> Option<Body> {
        let host = self.upper(parts);

        // Made where its folder is: a folder only the lower directory has is
        // made in the drive's own.
        if !host.parent().is_some_and(Path::is_dir)
            && let Some(folder) = parts.split_last().map(|(_, folders)| folders)
            && self.find(folder).is_some_and(|path| path.is_dir())
        {
            std::fs::create_dir_all(host.parent()?).ok()?;
        }

        if let Some(lower) = self.in_lower(parts) {
            self.hidden.insert(lower);
        }

        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&host)
            .ok()?;

        Some(Body::Host(HostFile {
            file,
            path: host,
            copy_to: None,
        }))
    }

    /// A file or an empty folder let go of: the drive's own removed, the
    /// lower directory's hidden.
    fn unlink(&mut self, parts: &[String]) -> bool {
        let mut gone = false;

        if let Some(path) = Self::resolve_in(&self.root, parts) {
            gone = std::fs::remove_file(&path).is_ok() || std::fs::remove_dir(&path).is_ok();
        }

        if let Some(lower) = self.in_lower(parts) {
            self.hidden.insert(lower);
            gone = true;
        }

        gone
    }

    fn mkdir(&mut self, parts: &[String]) -> bool {
        let target = self.upper(parts);

        target
            .parent()
            .is_some_and(|parent| std::fs::create_dir_all(parent).is_ok())
            && std::fs::create_dir(&target).is_ok()
    }

    fn rename(&mut self, from: &[String], to: &[String]) -> bool {
        let lower = self.in_lower(from);
        let Some(upper) = self.writable(from) else {
            return false;
        };

        // A folder only the lower directory has is made in the drive's own.
        if !upper.exists() && lower.as_ref().is_some_and(|lower| lower.is_dir()) {
            let _ = std::fs::create_dir_all(&upper);
        }

        let target = self.upper(to);
        let moved = target
            .parent()
            .is_none_or(|parent| std::fs::create_dir_all(parent).is_ok())
            && std::fs::rename(&upper, &target).is_ok();

        if moved && let Some(lower) = lower {
            self.hidden.insert(lower);
        }

        moved
    }
}

/// A host file open, and where in it the next read or write is.
#[derive(Debug)]
pub struct HostFile {
    pub file: File,
    pub path: PathBuf,
    /// Where a file opened from a drive's lower directory is copied to
    /// when it is first written.
    copy_to: Option<PathBuf>,
}

impl HostFile {
    /// Bytes written where the file is at; how many.
    pub fn write(&mut self, bytes: &[u8]) -> usize {
        if let Some(target) = self.copy_to.take() {
            let at = self.file.stream_position().unwrap_or(0);
            let copied = target
                .parent()
                .is_none_or(|parent| std::fs::create_dir_all(parent).is_ok())
                && std::fs::copy(&self.path, &target).is_ok();
            let Some(mut file) = copied
                .then(|| OpenOptions::new().read(true).write(true).open(&target).ok())
                .flatten()
            else {
                return 0;
            };

            let _ = file.seek(SeekFrom::Start(at));
            self.file = file;
            self.path = target;
        }

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

    pub fn truncate(&mut self, length: u64) -> bool {
        self.file.set_len(length).is_ok()
    }

    pub fn size(&self) -> u64 {
        self.file.metadata().map_or(0, |metadata| metadata.len())
    }
}
