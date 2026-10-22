//! A drive that is a directory of the host's, its names found without
//! regard to case, as DOS finds them; and one that is several of the host's
//! directories in layers, which must look as one directory of what they
//! hold together would.
//!
//! The oracle's C: is one DOSBox `localDrive` over one folder of the host's
//! (`drive_local.cpp`): each of its calls is the host's own -- a rename is
//! the host's `rename()` (`localDrive::Rename`, 347-362), keeping what is in
//! a folder moved and each file's stamp; a folder's stamp is the host's
//! (`FindNext`, `stat`'s `st_mtime`, 268-282), which moves as an entry is
//! made, let go of or moved in it and not as a file already in it is
//! written. A drive of layers does what one folder does, whichever layer a
//! file is in.

use std::collections::{BTreeSet, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::{Body, Entry, Files, Volume, stamp};

/// A directory of the host's read beneath a drive's own, which the drive
/// never writes: an installation's, or a layer of what a program has added
/// to one.
#[derive(Debug, Clone)]
pub struct HostLayer {
    pub path: PathBuf,
    /// What of the layers beneath this one is deleted, as far as this one
    /// and those above it go: DOS paths beneath the drive's root, upper
    /// case (`WINDOWS\WIN.INI`), each hiding what is there and beneath it.
    /// A folder this layer has where it hides one is the only folder there.
    pub removed: BTreeSet<String>,
}

impl HostLayer {
    /// A layer that hides nothing beneath it.
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            removed: BTreeSet::new(),
        }
    }

    /// The layer hiding paths of the layers beneath it, as DOS names them
    /// beneath the drive's root.
    #[must_use]
    pub fn removing<S: AsRef<str>>(mut self, paths: impl IntoIterator<Item = S>) -> Self {
        self.removed.extend(
            paths
                .into_iter()
                .map(|path| key(&Files::parse(path.as_ref()).parts)),
        );
        self
    }
}

/// A drive: a directory of the host's, over which may lie others it only
/// reads -- an installation's, and layers of what was added to it, which a
/// program's writes must not change. What is in a higher layer is found
/// before what is in a lower one; a file is copied up into the drive's own
/// directory as it is first written, a folder with everything in it as it
/// is renamed, and what is deleted of a lower layer is hidden.
#[derive(Debug, Clone)]
pub struct HostDrive {
    pub root: PathBuf,
    /// The directories read beneath it, the highest first.
    lowers: Vec<HostLayer>,
    /// Whether the drive is removable, as a floppy is.
    pub removable: bool,
    /// What of the lower directories is deleted, as far as the drive goes,
    /// as `HostLayer::removed` has it.
    removed: BTreeSet<String>,
    /// The file `removed` is kept in from run to run, if it is: outside the
    /// drive's own directory, one path a line.
    removed_file: Option<PathBuf>,
}

/// A path's names, upper case, the folder's own empty ones left out.
fn names(parts: &[String]) -> Vec<String> {
    parts
        .iter()
        .filter(|part| !part.is_empty())
        .map(|part| part.to_ascii_uppercase())
        .collect()
}

/// A path as `HostLayer::removed` keeps it.
fn key(parts: &[String]) -> String {
    names(parts).join("\\")
}

/// When a host's file or folder was last written.
fn written(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok()?.modified().ok()
}

/// A host's file or folder stamped as last written at a time.
fn set_written(path: &Path, at: SystemTime) -> std::io::Result<()> {
    let mut options = OpenOptions::new();

    if path.is_dir() {
        // Windows opens a folder only with `FILE_FLAG_BACKUP_SEMANTICS`.
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;

            options.custom_flags(0x0200_0000).write(true);
        }
        #[cfg(not(windows))]
        options.read(true);
    } else {
        options.write(true);
    }

    options.open(path)?.set_modified(at)
}

/// A folder's stamp put back as it was before what was done in it, where
/// it was there.
fn put_back(folder: &Path, was: Option<SystemTime>) {
    if let Some(was) = was {
        let _ = set_written(folder, was);
    }
}

/// A file copied, its stamp with it, as a host's rename keeps it.
fn copy_file(from: &Path, to: &Path) -> Option<()> {
    std::fs::copy(from, to).ok()?;

    if let Some(at) = written(from) {
        set_written(to, at).ok()?;
    }

    Some(())
}

/// What is to be made in the drive's own directory for a file of a lower
/// one to be written there: the folders above it each the drive's own
/// (where it is to be, and the folder whose stamp it takes), and the file
/// (the lower one's, and where it is to be).
#[derive(Debug, Clone)]
struct CopyUp {
    folders: Vec<(PathBuf, PathBuf)>,
    file: (PathBuf, PathBuf),
}

impl CopyUp {
    /// The folders made where they are not there, each last written when
    /// the folder it stands for was, and the file copied, its stamp with
    /// it; a folder's stamp put back as each is made in it, as a folder of
    /// one directory's would not move for what was there already: where
    /// the file is now.
    fn make(&self) -> Option<PathBuf> {
        make_folders(&self.folders)?;

        let (from, to) = &self.file;
        let folder = to.parent()?;
        let was = written(folder);
        let copied = copy_file(from, to);

        put_back(folder, was);
        copied.map(|()| to.clone())
    }
}

/// Folders of the drive's own made where they are not there, each last
/// written when the folder it stands for was; the folder above each put
/// back as it was.
fn make_folders(folders: &[(PathBuf, PathBuf)]) -> Option<()> {
    for (own, standing_for) in folders {
        if own.is_dir() {
            continue;
        }

        let above = own.parent()?;
        let was = written(above);
        let made = std::fs::create_dir(own).is_ok();

        if made && let Some(at) = written(standing_for) {
            let _ = set_written(own, at);
        }

        put_back(above, was);
        made.then_some(())?;
    }

    Some(())
}

impl HostDrive {
    /// A fixed drive of a directory of the host's.
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            lowers: Vec::new(),
            removable: false,
            removed: BTreeSet::new(),
            removed_file: None,
        }
    }

    /// A fixed drive of a directory over another it only reads.
    pub fn over(root: PathBuf, lower: PathBuf) -> Self {
        Self::layered(root, vec![HostLayer::new(lower)])
    }

    /// A fixed drive of a directory over layers it only reads, the highest
    /// first.
    pub fn layered(root: PathBuf, lowers: Vec<HostLayer>) -> Self {
        Self {
            lowers,
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

    /// The drive keeping what of its lower layers is deleted in a file,
    /// outside its own directory, from run to run: what the file holds
    /// read, if it is there, and the file written as each is deleted.
    ///
    /// # Errors
    ///
    /// A file inside the drive's own directory, or one that cannot be read.
    pub fn keeping_removed(mut self, file: PathBuf) -> std::io::Result<Self> {
        if file.starts_with(&self.root) {
            return Err(ErrorKind::InvalidInput.into());
        }

        match std::fs::read_to_string(&file) {
            Ok(text) => {
                self.removed.extend(
                    text.lines()
                        .map(str::trim)
                        .filter(|line| !line.is_empty())
                        .map(str::to_ascii_uppercase),
                );
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }

        self.removed_file = Some(file);
        Ok(self)
    }

    /// The layers read beneath the drive's own directory, the highest
    /// first.
    pub fn lowers(&self) -> &[HostLayer] {
        &self.lowers
    }

    /// What of the lower layers is deleted, as far as the drive goes.
    pub fn removed(&self) -> &BTreeSet<String> {
        &self.removed
    }

    /// A layer's directory: the drive's own the first, nought.
    fn layer(&self, at: usize) -> &Path {
        match at {
            0 => &self.root,
            _ => &self.lowers[at - 1].path,
        }
    }

    /// What a layer hides of those beneath it.
    fn hides(&self, at: usize) -> &BTreeSet<String> {
        match at {
            0 => &self.removed,
            _ => &self.lowers[at - 1].removed,
        }
    }

    /// Whether a layer's path is hidden by one above it.
    fn hidden_above(&self, at: usize, key: &str) -> bool {
        (0..at).any(|above| self.hides(above).contains(key))
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

    /// Where a path is in each layer that shows it, the highest first: one
    /// file, the highest; or folders, each layer's down to one that hides
    /// what is beneath it, or to a file beneath them, which the folders
    /// hide. None where the drive has no such path.
    fn stack(&self, parts: &[String]) -> Vec<(usize, PathBuf)> {
        let names = names(parts);
        let mut stack: Vec<(usize, PathBuf)> = (0..=self.lowers.len())
            .map(|at| (at, self.layer(at).to_path_buf()))
            .filter(|(_, path)| path.is_dir())
            .collect();

        for depth in 0..names.len() {
            let key = names[..=depth].join("\\");
            let mut next: Vec<(usize, PathBuf)> = Vec::new();

            for (at, folder) in &stack {
                if self.hidden_above(*at, &key) {
                    break;
                }

                let Some(path) = Self::found_in(folder, &names[depth]) else {
                    continue;
                };

                if !path.is_dir() {
                    if next.is_empty() {
                        next.push((*at, path));
                    }

                    break;
                }

                next.push((*at, path));
            }

            stack = next;

            if stack.is_empty() {
                break;
            }
        }

        stack
    }

    /// Where a path is: in the highest layer that shows it.
    fn find(&self, parts: &[String]) -> Option<PathBuf> {
        self.stack(parts).into_iter().next().map(|(_, path)| path)
    }

    /// What a folder holds, each entry from the highest layer that shows
    /// it: its name, upper case, its layer, and where it is.
    fn merged(&self, parts: &[String]) -> Option<Vec<(String, usize, PathBuf)>> {
        let stack = self.stack(parts);

        if !stack.first()?.1.is_dir() {
            return None;
        }

        let prefix = key(parts);
        let mut seen = HashSet::new();
        let mut entries = Vec::new();

        for (at, folder) in stack {
            for entry in std::fs::read_dir(&folder).into_iter().flatten().flatten() {
                let name = entry.file_name().to_string_lossy().to_ascii_uppercase();
                let key = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}\\{name}")
                };

                // Hidden from one layer, hidden from those beneath.
                if seen.insert(name.clone()) && !self.hidden_above(at, &key) {
                    entries.push((name, at, entry.path()));
                }
            }
        }

        Some(entries)
    }

    /// Whether any lower layer has a path, shown or not: what is to be
    /// hidden as the drive's path is let go of, or taken.
    fn beneath(&self, parts: &[String]) -> bool {
        let names = names(parts);

        (1..=self.lowers.len()).any(|at| {
            names
                .iter()
                .try_fold(self.layer(at).to_path_buf(), |path, name| {
                    Self::found_in(&path, name)
                })
                .is_some()
        })
    }

    /// A path hidden in the lower layers, and the file kept of what is,
    /// if there is one, written.
    fn hide(&mut self, parts: &[String]) {
        if self.removed.insert(key(parts))
            && let Some(file) = &self.removed_file
        {
            let mut text = String::new();

            for path in &self.removed {
                text.push_str(path);
                text.push_str("\r\n");
            }

            let staged = file.with_extension("new");

            if std::fs::write(&staged, text).is_ok() {
                let _ = std::fs::rename(&staged, file);
            }
        }
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

    /// The folders a folder of the drive is beneath the drive's own
    /// directory, and itself: each where it is or would be there, and the
    /// highest layer's, whose stamp it takes. None where the drive has no
    /// such folder.
    fn own_folders(&self, parts: &[String]) -> Option<Vec<(PathBuf, PathBuf)>> {
        let names = names(parts);
        let mut folders = Vec::new();

        for depth in 1..=names.len() {
            let path = &names[..depth];
            let standing_for = self.find(path).filter(|path| path.is_dir())?;

            folders.push((self.upper(path), standing_for));
        }

        Some(folders)
    }

    /// A folder of the drive made the drive's own, as it stands, where it
    /// is not already: where it is.
    fn own_folder(&self, parts: &[String]) -> Option<PathBuf> {
        make_folders(&self.own_folders(parts)?)?;

        Some(self.upper(parts))
    }

    /// Folders made where the drive has none, as a host makes the folders
    /// above where a file is moved, and those it has made its own: where
    /// the last is.
    fn make_path(&self, parts: &[String]) -> Option<PathBuf> {
        let names = names(parts);

        for depth in 1..=names.len() {
            let path = &names[..depth];

            match self.find(path) {
                Some(found) if found.is_dir() => {
                    self.own_folder(path)?;
                }
                Some(_) => return None,
                None => std::fs::create_dir(self.upper(path)).ok()?,
            }
        }

        Some(self.upper(parts))
    }

    /// A file of a lower layer copied into the drive's own directory, as
    /// it stands: where it is now.
    fn copy_up_file(&self, parts: &[String]) -> Option<PathBuf> {
        let names = names(parts);
        let (_, folders) = names.split_last()?;

        CopyUp {
            folders: self.own_folders(folders)?,
            file: (self.find(&names)?, self.upper(&names)),
        }
        .make()
    }

    /// A folder made the drive's own with everything in it, as it stands:
    /// where it is now.
    fn copy_up_tree(&self, parts: &[String]) -> Option<PathBuf> {
        let own = self.own_folder(parts)?;
        let was = written(&own);
        let mut copied = Some(());

        for (name, at, path) in self.merged(parts)? {
            let mut inner = names(parts);

            inner.push(name);

            if path.is_dir() {
                copied = copied.and(self.copy_up_tree(&inner).map(|_| ()));
            } else if at > 0 {
                copied = copied.and(copy_file(&path, &self.upper(&inner)));
            }
        }

        put_back(&own, was);
        copied.map(|()| own)
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

    /// The entries a folder holds, each from the highest layer that shows
    /// it.
    fn children(&self, parts: &[String]) -> Option<Vec<Entry>> {
        Some(
            self.merged(parts)?
                .iter()
                .filter_map(|(_, _, path)| entry_of(path))
                .collect(),
        )
    }

    fn read(&self, parts: &[String]) -> Option<Vec<u8>> {
        std::fs::read(self.find(parts)?).ok()
    }

    /// The drive's own file opened to read and write, else to read; else
    /// a lower layer's, to read, copied up when first written.
    fn open(&mut self, parts: &[String]) -> std::io::Result<Body> {
        let Some((at, path)) = self
            .stack(parts)
            .into_iter()
            .next()
            .filter(|(_, path)| path.is_file())
        else {
            return Err(ErrorKind::NotFound.into());
        };

        if at == 0 {
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .open(&path)
                .or_else(|_| File::open(&path))?;

            return Ok(Body::Host(HostFile {
                file,
                path,
                copy_up: None,
            }));
        }

        let names = names(parts);
        let folders = names
            .split_last()
            .and_then(|(_, folders)| self.own_folders(folders))
            .ok_or(ErrorKind::NotFound)?;

        Ok(Body::Host(HostFile {
            file: File::open(&path)?,
            path: path.clone(),
            copy_up: Some(CopyUp {
                folders,
                file: (path, self.upper(&names)),
            }),
        }))
    }

    /// A file made where its folder is, or one there emptied; the folder's
    /// stamp moved only for a file new to it, as a host's is.
    fn create(&mut self, parts: &[String]) -> Option<Body> {
        let names = names(parts);
        let (name, folders) = names.split_last()?;
        let there = self.stack(&names).into_iter().next();

        if there.as_ref().is_some_and(|(_, path)| path.is_dir()) {
            return None;
        }

        let folder = self.own_folder(folders)?;
        let host = Self::found_in(&folder, name).unwrap_or_else(|| folder.join(name));
        let was = there.and_then(|_| written(&folder));
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&host);

        put_back(&folder, was);

        Some(Body::Host(HostFile {
            file: file.ok()?,
            path: host,
            copy_up: None,
        }))
    }

    /// A file or an empty folder let go of: the drive's own removed, a
    /// lower layer's hidden, its folder's stamp moved.
    fn unlink(&mut self, parts: &[String]) -> bool {
        let names = names(parts);
        let Some((_, folders)) = names.split_last() else {
            return false;
        };
        let Some((at, path)) = self.stack(&names).into_iter().next() else {
            return false;
        };

        if path.is_dir() && !self.merged(&names).is_some_and(|inner| inner.is_empty()) {
            return false;
        }

        let Some(folder) = self.own_folder(folders) else {
            return false;
        };

        if at == 0 && std::fs::remove_file(&path).is_err() && std::fs::remove_dir(&path).is_err() {
            return false;
        }

        if self.beneath(&names) {
            self.hide(&names);
        }

        let _ = set_written(&folder, SystemTime::now());
        true
    }

    /// A folder made, and the folders above it where they are not there;
    /// `false` where anything is there already. One made where a lower
    /// layer's was deleted is the only folder there.
    fn mkdir(&mut self, parts: &[String]) -> bool {
        let names = names(parts);
        let Some((name, folders)) = names.split_last() else {
            return false;
        };

        !names.is_empty()
            && self.find(&names).is_none()
            && self
                .make_path(folders)
                .is_some_and(|folder| std::fs::create_dir(folder.join(name)).is_ok())
    }

    /// A file or folder moved, as a host's rename moves it: a lower
    /// layer's copied up first, a folder with everything in it, each
    /// stamp kept, and hidden where it was. Over a file, a file; over an
    /// empty folder, a folder; never into itself.
    fn rename(&mut self, from: &[String], to: &[String]) -> bool {
        let from = names(from);
        let to = names(to);
        let Some((new_name, new_folders)) = to.split_last() else {
            return false;
        };
        let Some((at, source)) = self.stack(&from).into_iter().next() else {
            return false;
        };

        if from.is_empty() {
            return false;
        }

        if from == to {
            return true;
        }

        let is_folder = source.is_dir();

        if is_folder && to.starts_with(&from) {
            return false;
        }

        let replaces = match self.find(&to) {
            None => true,
            Some(path) if path.is_dir() => {
                is_folder && self.merged(&to).is_some_and(|inner| inner.is_empty())
            }
            Some(_) => !is_folder,
        };

        if !replaces {
            return false;
        }

        let Some(folder) = self.make_path(new_folders) else {
            return false;
        };
        // What no lower layer has is the drive's own as it stands; a file
        // the drive has is its own.
        let own = if at == 0 && (!is_folder || !self.beneath(&from)) {
            Some(source)
        } else if is_folder {
            self.copy_up_tree(&from)
        } else {
            self.copy_up_file(&from)
        };
        let Some(own) = own else {
            return false;
        };
        let target = Self::found_in(&folder, new_name).unwrap_or_else(|| folder.join(new_name));
        let taken = self.beneath(&to);

        if std::fs::rename(&own, &target).is_err() {
            return false;
        }

        if self.beneath(&from) {
            self.hide(&from);
        }

        if taken {
            self.hide(&to);
        }

        true
    }
}

/// A host file open, and where in it the next read or write is.
#[derive(Debug)]
pub struct HostFile {
    pub file: File,
    pub path: PathBuf,
    /// What is made in the drive's own directory for a file opened from a
    /// lower layer as it is first written.
    copy_up: Option<CopyUp>,
}

impl HostFile {
    /// The file, if it is a lower layer's, copied up to be written, where
    /// it is at kept; whether it is the drive's own.
    fn own(&mut self) -> bool {
        let Some(copy_up) = self.copy_up.take() else {
            return true;
        };
        let at = self.file.stream_position().unwrap_or(0);
        let Some(mut file) = copy_up
            .make()
            .and_then(|target| OpenOptions::new().read(true).write(true).open(target).ok())
        else {
            return false;
        };

        let _ = file.seek(SeekFrom::Start(at));
        self.file = file;
        self.path = copy_up.file.1;
        true
    }

    /// Bytes written where the file is at; how many.
    pub fn write(&mut self, bytes: &[u8]) -> usize {
        if !self.own() {
            return 0;
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

    /// The file cut to a length, a lower layer's copied up first.
    pub fn truncate(&mut self, length: u64) -> bool {
        self.own() && self.file.set_len(length).is_ok()
    }

    pub fn size(&self) -> u64 {
        self.file.metadata().map_or(0, |metadata| metadata.len())
    }

    /// The host's file stamped as last written at a time, seconds since
    /// 1970; one only read, from a lower layer, is left as it is.
    pub fn stamp(&mut self, seconds: i64) {
        if self.copy_up.is_none()
            && let Ok(since) = u64::try_from(seconds)
        {
            let _ = self
                .file
                .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(since));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::{MemoryDrive, days_from_civil};
    use std::time::{Duration, UNIX_EPOCH};

    /// A folder of the host's for a test, let go of after it.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("winbox-{name}-{}", std::process::id()));

            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn at(year: i64, month: u16, day: u16, hour: i64) -> i64 {
        days_from_civil(year, month, day) * 86_400 + hour * 3600
    }

    fn system_time(seconds: i64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(seconds.unsigned_abs())
    }

    fn on_host(root: &Path, path: &str) -> PathBuf {
        path.split('\\')
            .fold(root.to_path_buf(), |at, name| at.join(name))
    }

    /// A layer: what it hides of those beneath, its folders and its files,
    /// each with its stamp.
    struct Spec {
        removed: Vec<&'static str>,
        folders: Vec<(&'static str, i64)>,
        files: Vec<(&'static str, &'static [u8], i64)>,
    }

    /// A layer written into a folder of the host's, each stamp set, the
    /// folders' last.
    fn write_layer(root: &Path, spec: &Spec) -> HostLayer {
        std::fs::create_dir_all(root).unwrap();

        for (folder, _) in &spec.folders {
            std::fs::create_dir_all(on_host(root, folder)).unwrap();
        }

        for (file, bytes, modified) in &spec.files {
            let path = on_host(root, file);

            std::fs::write(&path, bytes).unwrap();
            set_written(&path, system_time(*modified)).unwrap();
        }

        let mut folders = spec.folders.clone();

        folders.sort_by_key(|(folder, _)| std::cmp::Reverse(folder.matches('\\').count()));

        for (folder, modified) in folders {
            set_written(&on_host(root, folder), system_time(modified)).unwrap();
        }

        HostLayer::new(root.to_path_buf()).removing(spec.removed.iter())
    }

    /// The layers, the lowest first, put one over another on a drive held
    /// in memory, as the page puts back what was written over what it was
    /// written on: what each hides let go of, then what it holds.
    fn flattened(specs: &[Spec]) -> MemoryDrive {
        let mut drive = MemoryDrive::new();

        for spec in specs {
            for path in &spec.removed {
                drive.remove(path);
            }

            for (folder, modified) in &spec.folders {
                assert!(drive.add_folder(folder, *modified));
            }

            for (file, bytes, modified) in &spec.files {
                assert!(drive.add_file(file, bytes.to_vec(), *modified));
            }
        }

        drive
    }

    /// A drive held in memory written into a folder of the host's, as one
    /// flat directory, each stamp set.
    fn write_flat(drive: &MemoryDrive, parts: &mut Vec<String>, root: &Path) {
        let folder = parts
            .iter()
            .fold(root.to_path_buf(), |at, name| at.join(name));

        std::fs::create_dir_all(&folder).unwrap();

        for entry in drive.children(parts).unwrap() {
            parts.push(entry.name.clone());

            let path = folder.join(&entry.name);
            let [year, month, day, hour, minute, second] = entry.modified;
            let seconds = days_from_civil(i64::from(year), month, day) * 86_400
                + i64::from(hour) * 3600
                + i64::from(minute) * 60
                + i64::from(second);

            if entry.attributes & 0x10 != 0 {
                write_flat(drive, parts, root);
            } else {
                std::fs::write(&path, drive.read(parts).unwrap()).unwrap();
            }

            set_written(&path, system_time(seconds)).unwrap();
            parts.pop();
        }
    }

    /// Three layers beneath a drive: an installation, a program over it
    /// that deleted one of its files and made one of its folders afresh,
    /// and a layer over both that deleted another.
    fn specs() -> Vec<Spec> {
        let install = at(1992, 3, 10, 3);
        let program = at(1994, 6, 1, 12);
        let later = at(1995, 1, 2, 9);

        vec![
            Spec {
                removed: vec![],
                folders: vec![
                    ("WINDOWS", install),
                    ("WINDOWS\\SYSTEM", install + 60),
                    ("OLDAPP", install + 120),
                    ("OLDAPP\\SUB", install + 180),
                ],
                files: vec![
                    ("AUTOEXEC.BAT", b"@ECHO OFF\r\n", install),
                    ("WINDOWS\\WIN.INI", b"[windows]\r\n", install + 1),
                    ("WINDOWS\\GONE.TXT", b"gone", install + 2),
                    ("WINDOWS\\NEW.INI", b"[new]\r\n", install + 3),
                    ("WINDOWS\\SYSTEM\\GDI.EXE", &[1, 2, 3], install + 4),
                    ("WINDOWS\\SYSTEM\\OLD.DRV", b"driver", install + 5),
                    ("OLDAPP\\A.TXT", b"a", install + 6),
                    ("OLDAPP\\SUB\\B.TXT", b"b", install + 7),
                ],
            },
            Spec {
                removed: vec!["WINDOWS\\GONE.TXT", "OLDAPP"],
                folders: vec![
                    ("WINDOWS", program),
                    ("OLDAPP", program + 60),
                    ("GAME", program + 120),
                    ("GAME\\DATA", program + 180),
                ],
                files: vec![
                    ("WINDOWS\\WIN.INI", b"[windows]\r\nload=\r\n", program + 1),
                    ("OLDAPP\\C.TXT", b"c", program + 2),
                    ("GAME\\GAME.EXE", b"MZ", program + 3),
                    ("GAME\\DATA\\LEVEL.DAT", b"level", program + 4),
                ],
            },
            Spec {
                removed: vec!["AUTOEXEC.BAT"],
                folders: vec![("GAME", later)],
                files: vec![
                    ("GAME\\SAVE.DAT", b"save", later + 1),
                    ("CONFIG.SYS", b"FILES=30\r\n", later + 2),
                ],
            },
        ]
    }

    /// A DOS path's folder's names and its own name.
    fn split(path: &str) -> (Vec<String>, String) {
        let mut parts = Files::parse(path).parts;
        let name = parts.pop().unwrap();

        if parts.is_empty() {
            parts.push(String::new());
        }

        (parts, name)
    }

    /// Everything on C:, as DOS lists it: each entry's name, attributes,
    /// a file's size and bytes, and its stamp -- one made or written as the
    /// test runs, by the host's clock, told only as written now. A host's
    /// folder has a size of its own (`st_size`, which DOSBox answers too),
    /// a drive in memory's none; so a folder's is left out.
    fn tree(files: &Files) -> Vec<String> {
        fn walk(files: &Files, parts: &mut Vec<String>, out: &mut Vec<String>) {
            let folder = parts.join("\\");

            for entry in files.list('C', parts).unwrap() {
                // The root's own stamp, which its `.` and `..` and a
                // top-level folder's `..` carry, is the host folder's or
                // none on a MemoryDrive, and is not measured
                // (`kb/topics/drives-and-disks.md`): not compared.
                let root = (entry.name == ".." && parts.len() <= 2)
                    || (entry.name == "." && folder.is_empty());
                let stamp = if root {
                    "root".to_string()
                } else if entry.modified[0] >= 2020 {
                    "now".to_string()
                } else {
                    format!("{:?}", entry.modified)
                };
                let is_folder = entry.attributes & 0x10 != 0;
                let what = if is_folder {
                    String::new()
                } else {
                    let (_, bytes) = files
                        .read_from(&format!("C:\\{folder}"), &entry.name)
                        .unwrap();

                    format!("{} {bytes:?}", entry.size)
                };

                out.push(format!(
                    "{folder}\\{} {:02x} {stamp} {what}",
                    entry.name, entry.attributes
                ));

                if is_folder && entry.name != "." && entry.name != ".." {
                    parts.push(entry.name);
                    walk(files, parts, out);
                    parts.pop();
                }
            }
        }

        let mut out = Vec::new();

        walk(files, &mut vec![String::new()], &mut out);
        out
    }

    /// A DOS call made of C:.
    #[derive(Debug, Clone, Copy)]
    enum Op {
        /// A file made, written if there are bytes, and closed.
        Create(&'static str, Option<&'static [u8]>),
        /// A file opened, written at its end, and closed.
        Append(&'static str, &'static [u8]),
        /// A file opened, read and closed, nothing written.
        Touch(&'static str),
        /// A file opened, cut to a length, and closed.
        Truncate(&'static str, u64),
        /// A file or an empty folder let go of.
        Delete(&'static str),
        Mkdir(&'static str),
        Rename(&'static str, &'static str),
    }

    /// A call made: what it answered.
    fn apply(files: &mut Files, op: Op) -> String {
        match op {
            Op::Create(path, bytes) => {
                let Some(handle) = files.create(path) else {
                    return "none".into();
                };
                let written = bytes.map(|bytes| files.resolve(handle).unwrap().write(bytes));

                files.close(handle);
                format!("written {written:?}")
            }
            Op::Append(path, bytes) => {
                let Some(handle) = files.open(path) else {
                    return "none".into();
                };
                let file = files.resolve(handle).unwrap();

                file.seek(SeekFrom::End(0));

                let written = file.write(bytes);

                files.close(handle);
                format!("written {written}")
            }
            Op::Touch(path) => {
                let Some(handle) = files.open(path) else {
                    return "none".into();
                };
                let read = files.resolve(handle).unwrap().read(4);

                files.close(handle);
                format!("read {read:?}")
            }
            Op::Truncate(path, length) => {
                let Some(handle) = files.open(path) else {
                    return "none".into();
                };
                let cut = files.resolve(handle).unwrap().truncate(length);

                files.close(handle);
                format!("cut {cut}")
            }
            Op::Delete(path) => {
                let (parts, name) = split(path);

                files.unlink('C', &parts, &name).to_string()
            }
            Op::Mkdir(path) => {
                let (parts, name) = split(path);

                files.make_directory('C', &parts, &name).to_string()
            }
            Op::Rename(from, to) => {
                let (from_parts, from_name) = split(from);
                let (to_parts, to_name) = split(to);

                files
                    .rename('C', (&from_parts, &from_name), (&to_parts, &to_name))
                    .to_string()
            }
        }
    }

    const SCRIPT: &[Op] = &[
        // Read, and opened and closed unwritten: nothing moves.
        Op::Touch("C:\\WINDOWS\\WIN.INI"),
        Op::Touch("C:\\WINDOWS\\GONE.TXT"),
        Op::Touch("C:\\AUTOEXEC.BAT"),
        // A file of the lowest layer written in its folder of the lowest
        // layer: the folders' stamps stay.
        Op::Append("C:\\WINDOWS\\SYSTEM\\GDI.EXE", &[4]),
        Op::Truncate("C:\\WINDOWS\\SYSTEM\\OLD.DRV", 3),
        Op::Create("C:\\WINDOWS\\NEW.TXT", Some(b"new")),
        // Made again, where a lower layer has it, and where one deleted it.
        Op::Create("C:\\CONFIG.SYS", Some(b"FILES=40\r\n")),
        Op::Create("C:\\WINDOWS\\GONE.TXT", None),
        Op::Create("C:\\NONE\\X.TXT", Some(b"x")),
        Op::Create("C:\\WINDOWS", None),
        // Let go of, and made again where a lower layer has it.
        Op::Delete("C:\\OLDAPP\\C.TXT"),
        Op::Delete("C:\\OLDAPP\\A.TXT"),
        Op::Delete("C:\\OLDAPP"),
        Op::Mkdir("C:\\OLDAPP"),
        Op::Mkdir("C:\\OLDAPP\\SUB"),
        Op::Mkdir("C:\\WINDOWS"),
        Op::Delete("C:\\WINDOWS"),
        Op::Delete("C:\\NONE"),
        Op::Delete("C:\\CONFIG.SYS"),
        // Renamed: a folder only lower layers have, with everything in it;
        // a file only a lower layer has; one moved to another folder; one
        // over another; a folder moved to another folder.
        Op::Rename("C:\\GAME", "C:\\PLAY"),
        Op::Rename("C:\\GAME", "C:\\AGAIN"),
        Op::Rename("C:\\WINDOWS\\NEW.INI", "C:\\WINDOWS\\RENAMED.INI"),
        Op::Rename("C:\\WINDOWS\\WIN.INI", "C:\\OLDAPP\\WIN.INI"),
        Op::Rename("C:\\WINDOWS\\NEW.TXT", "C:\\WINDOWS\\RENAMED.INI"),
        Op::Rename("C:\\PLAY", "C:\\PLAY\\DATA\\IN"),
        Op::Rename("C:\\PLAY", "C:\\WINDOWS"),
        Op::Rename("C:\\PLAY\\DATA", "C:\\WINDOWS\\DATA"),
        Op::Rename("C:\\WINDOWS\\SYSTEM\\GDI.EXE", "C:\\OLDAPP\\SUB"),
        Op::Rename("C:\\OLDAPP", "C:\\PLAY\\OLD"),
        // A folder of the lowest layer emptied, let go of and made again.
        Op::Delete("C:\\WINDOWS\\SYSTEM\\GDI.EXE"),
        Op::Delete("C:\\WINDOWS\\SYSTEM\\OLD.DRV"),
        Op::Delete("C:\\WINDOWS\\SYSTEM"),
        Op::Mkdir("C:\\WINDOWS\\SYSTEM"),
        Op::Create("C:\\WINDOWS\\SYSTEM\\GDI.EXE", Some(&[9])),
        Op::Append("C:\\PLAY\\SAVE.DAT", b"!"),
        Op::Rename("C:\\PLAY\\SAVE.DAT", "C:\\SAVE.DAT"),
    ];

    /// Each call of the script made on a drive of layers, on one directory
    /// of what the layers hold together, and on a drive held in memory of
    /// it: the same answers, and the same files, bytes and stamps, after
    /// each.
    #[test]
    fn layers_look_as_one_folder_does() {
        let scratch = Scratch::new("layers-agree");
        let specs = specs();
        let lowers: Vec<HostLayer> = specs
            .iter()
            .enumerate()
            .rev()
            .map(|(at, spec)| write_layer(&scratch.0.join(format!("L{at}")), spec))
            .collect();
        let top = scratch.0.join("top");
        let flat = scratch.0.join("flat");
        let memory = flattened(&specs);

        std::fs::create_dir_all(&top).unwrap();
        write_flat(&memory, &mut Vec::new(), &flat);

        let mut drives: Vec<(&str, Files)> = vec![
            ("layers", Files::new()),
            ("flat", Files::new()),
            ("memory", Files::new()),
        ];

        drives[0]
            .1
            .mount('C', HostDrive::layered(top.clone(), lowers));
        drives[1].1.mount('C', HostDrive::new(flat.clone()));
        drives[2].1.mount('C', memory);

        for (_, files) in &mut drives {
            files.now = Some(at(2001, 2, 3, 4));
        }

        let first: Vec<Vec<String>> = drives.iter().map(|(_, files)| tree(files)).collect();

        assert_eq!(first[0], first[2], "layers and memory, as made");
        assert_eq!(first[1], first[2], "flat and memory, as made");
        assert!(!first[0].iter().any(|line| line.contains("GONE.TXT")
            || line.contains("AUTOEXEC")
            || line.contains("A.TXT")
            || line.contains("SUB")));

        for op in SCRIPT {
            let seen: Vec<(String, Vec<String>)> = drives
                .iter_mut()
                .map(|(_, files)| (apply(files, *op), tree(files)))
                .collect();

            for (index, (name, _)) in drives.iter().enumerate().take(2) {
                assert_eq!(seen[index].0, seen[2].0, "{name}'s answer to {op:?}");
                assert_eq!(seen[index].1, seen[2].1, "{name}'s files after {op:?}");
            }
        }

        // Nothing of a lower layer was written.
        assert_eq!(
            std::fs::read(scratch.0.join("L0").join("WINDOWS").join("WIN.INI")).unwrap(),
            b"[windows]\r\n"
        );
        assert!(scratch.0.join("L1").join("GAME").join("DATA").is_dir());
        assert_eq!(
            written(&scratch.0.join("L0").join("WINDOWS").join("SYSTEM")),
            Some(system_time(at(1992, 3, 10, 3) + 60))
        );
    }

    fn parts(path: &str) -> Vec<String> {
        Files::parse(path).parts
    }

    /// Bug 1: a folder only the lower directory has, renamed, keeps what is
    /// in it, as the host's rename keeps it (`localDrive::Rename`,
    /// `drive_local.cpp` 347-362); as does one both have.
    #[test]
    fn renames_a_lower_folder_with_what_is_in_it() {
        let scratch = Scratch::new("layers-rename-folder");
        let lower = scratch.0.join("lower");
        let top = scratch.0.join("top");

        std::fs::create_dir_all(lower.join("GAME").join("DATA")).unwrap();
        std::fs::create_dir_all(&top).unwrap();
        std::fs::write(lower.join("GAME").join("GAME.EXE"), b"MZ").unwrap();
        std::fs::write(lower.join("GAME").join("DATA").join("LEVEL.DAT"), b"1").unwrap();

        let mut drive = HostDrive::over(top.clone(), lower.clone());

        assert!(drive.rename(&parts("GAME"), &parts("PLAY")));
        assert!(drive.entry(&parts("GAME")).is_none());
        assert_eq!(drive.read(&parts("PLAY\\GAME.EXE")).unwrap(), b"MZ");
        assert_eq!(drive.read(&parts("PLAY\\DATA\\LEVEL.DAT")).unwrap(), b"1");
        assert!(lower.join("GAME").join("DATA").join("LEVEL.DAT").is_file());

        // A folder both have: what each has.
        std::fs::create_dir_all(top.join("PLAY").join("MORE")).unwrap();
        std::fs::create_dir_all(lower.join("PLAY")).unwrap();
        std::fs::write(lower.join("PLAY").join("OLD.TXT"), b"old").unwrap();

        let names = |drive: &HostDrive, folder: &str| -> Option<Vec<String>> {
            let mut names: Vec<String> = drive
                .children(&parts(folder))?
                .into_iter()
                .map(|entry| entry.name)
                .collect();

            names.sort();
            Some(names)
        };

        assert_eq!(
            names(&drive, "PLAY").unwrap(),
            ["DATA", "GAME.EXE", "MORE", "OLD.TXT"]
        );
        assert!(drive.rename(&parts("PLAY"), &parts("BOTH")));
        assert_eq!(
            names(&drive, "BOTH").unwrap(),
            ["DATA", "GAME.EXE", "MORE", "OLD.TXT"]
        );
        assert_eq!(names(&drive, "PLAY"), None);
    }

    /// Bug 2: a file of the lower directory keeps its stamp until it is
    /// written -- opened and closed unwritten, or renamed, as the host's
    /// rename keeps it -- where `std::fs::copy` does not keep it on Linux.
    #[test]
    fn keeps_a_lower_files_stamp_until_written() {
        let scratch = Scratch::new("layers-file-stamp");
        let lower = scratch.0.join("lower");
        let top = scratch.0.join("top");
        let stamped = at(1992, 3, 10, 3);

        std::fs::create_dir_all(lower.join("WINDOWS")).unwrap();
        std::fs::create_dir_all(&top).unwrap();

        for name in ["WIN.INI", "OTHER.INI"] {
            let path = lower.join("WINDOWS").join(name);

            std::fs::write(&path, b"[windows]\r\n").unwrap();
            set_written(&path, system_time(stamped)).unwrap();
        }

        let mut files = Files::new();

        files.mount('C', HostDrive::over(top.clone(), lower.clone()));

        let handle = files.open("C:\\WINDOWS\\WIN.INI").unwrap();

        files.close(handle);
        assert!(files.rename(
            'C',
            (&parts("WINDOWS"), "WIN.INI"),
            (&parts("WINDOWS"), "SYSTEM.INI")
        ));
        assert!(files.rename(
            'C',
            (&parts("WINDOWS"), "OTHER.INI"),
            (&parts(""), "OTHER.INI")
        ));

        for (folder, name) in [("WINDOWS", "SYSTEM.INI"), ("", "OTHER.INI")] {
            assert_eq!(
                files.lookup('C', &parts(folder), name).unwrap().modified,
                stamp(stamped),
                "{name}"
            );
        }

        assert_eq!(
            written(&top.join("WINDOWS").join("SYSTEM.INI")),
            Some(system_time(stamped))
        );
    }

    /// Bug 3: a lower file written in a folder only the lower directory
    /// has leaves the folders above it as they were, as a host's folder's
    /// stamp stays as a file already in it is written; the folders made
    /// for it in the drive's own directory take the lower ones' stamps.
    #[test]
    fn keeps_a_lower_folders_stamp_as_a_file_in_it_is_written() {
        let scratch = Scratch::new("layers-folder-stamp");
        let lower = scratch.0.join("lower");
        let top = scratch.0.join("top");
        let windows = at(1992, 3, 10, 3);
        let system = windows + 60;

        std::fs::create_dir_all(lower.join("WINDOWS").join("SYSTEM")).unwrap();
        std::fs::create_dir_all(top.join("WINDOWS")).unwrap();
        std::fs::write(lower.join("WINDOWS").join("SYSTEM").join("GDI.EXE"), [1]).unwrap();
        set_written(&lower.join("WINDOWS").join("SYSTEM"), system_time(system)).unwrap();
        set_written(&top.join("WINDOWS"), system_time(windows)).unwrap();

        let mut files = Files::new();

        files.mount('C', HostDrive::over(top.clone(), lower.clone()));

        let handle = files.open("C:\\WINDOWS\\SYSTEM\\GDI.EXE").unwrap();

        assert_eq!(files.resolve(handle).unwrap().write(&[2]), 1);
        files.close(handle);

        assert!(top.join("WINDOWS").join("SYSTEM").join("GDI.EXE").is_file());
        assert_eq!(
            files
                .lookup('C', &parts("WINDOWS"), "SYSTEM")
                .unwrap()
                .modified,
            stamp(system)
        );
        assert_eq!(
            files.lookup('C', &parts(""), "WINDOWS").unwrap().modified,
            stamp(windows)
        );
    }

    /// Bug 4's means: what of a lower layer is deleted kept outside the
    /// drive's own directory, and read back by the next drive over it.
    #[test]
    fn keeps_what_is_deleted_from_run_to_run() {
        let scratch = Scratch::new("layers-kept");
        let lower = scratch.0.join("lower");
        let top = scratch.0.join("top");
        let kept = scratch.0.join("removed");

        std::fs::create_dir_all(lower.join("WINDOWS")).unwrap();
        std::fs::create_dir_all(&top).unwrap();
        std::fs::write(lower.join("WINDOWS").join("WIN.INI"), b"").unwrap();
        std::fs::write(lower.join("AUTOEXEC.BAT"), b"").unwrap();

        assert!(
            HostDrive::over(top.clone(), lower.clone())
                .keeping_removed(top.join("REMOVED"))
                .is_err()
        );

        let mut drive = HostDrive::over(top.clone(), lower.clone())
            .keeping_removed(kept.clone())
            .unwrap();

        assert!(drive.unlink(&parts("windows\\win.ini")));
        assert!(drive.unlink(&parts("AUTOEXEC.BAT")));
        assert!(drive.unlink(&parts("WINDOWS")));
        assert_eq!(
            std::fs::read_to_string(&kept).unwrap(),
            "AUTOEXEC.BAT\r\nWINDOWS\r\nWINDOWS\\WIN.INI\r\n"
        );

        let again = HostDrive::over(top.clone(), lower.clone())
            .keeping_removed(kept)
            .unwrap();

        assert_eq!(again.children(&parts("")).unwrap(), Vec::new());

        // A drive that does not keep them forgets them, as before.
        let forgetting = HostDrive::over(top, lower);

        assert_eq!(forgetting.children(&parts("")).unwrap().len(), 2);
    }
}
