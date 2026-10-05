//! A drive held in memory, for a host with no file system of its own to
//! give DOS: a browser's page. Its names are kept upper case, as DOS has
//! them, and found without regard to case.
//!
//! A file's bytes are shared until they are first written: a drive made
//! from another -- each run's from an installation's -- shares every file
//! of it, and a program's write copies only the file it writes, so the
//! installation's own bytes are never changed.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::io::{ErrorKind, SeekFrom};
use std::rc::Rc;

use super::{Body, Entry, Files, Volume, stamp};

/// The host's time as seconds since 1970, which a file written is stamped
/// with.
pub type WallTime = fn() -> i64;

/// The host's time, as the standard library reads it; where there is no
/// clock to read -- WebAssembly with no system beneath it -- the first day
/// DOS can date a file, 1 January 1980, until the host gives its own.
pub fn host_seconds() -> i64 {
    #[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_secs() as i64)
    }
    #[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
    {
        super::days_from_civil(1980, 1, 1) * 86_400
    }
}

/// A file's bytes and when they were last written, in seconds since 1970.
#[derive(Debug, Clone)]
pub struct Stored {
    pub data: Rc<Vec<u8>>,
    pub modified: i64,
}

#[derive(Debug)]
enum Node {
    Folder(Folder),
    /// A file, shared with what has it open.
    File(Rc<RefCell<Stored>>),
}

impl Clone for Node {
    /// A node of a drive of its own: a file's bytes shared until written,
    /// but not what is open of it.
    fn clone(&self) -> Self {
        match self {
            Self::Folder(folder) => Self::Folder(folder.clone()),
            Self::File(stored) => Self::File(Rc::new(RefCell::new(stored.borrow().clone()))),
        }
    }
}

impl Node {
    fn entry(&self, name: &str) -> Entry {
        match self {
            Self::Folder(folder) => Entry {
                name: name.to_string(),
                attributes: 0x10,
                size: 0,
                modified: stamp(folder.modified),
            },
            Self::File(stored) => {
                let stored = stored.borrow();

                Entry {
                    name: name.to_string(),
                    attributes: 0x20,
                    size: stored.data.len().min(u32::MAX as usize) as u32,
                    modified: stamp(stored.modified),
                }
            }
        }
    }
}

#[derive(Debug, Clone, Default)]
struct Folder {
    modified: i64,
    /// What it holds, by name, upper case.
    children: BTreeMap<String, Node>,
}

/// A path's names, upper case, the folder's own empty ones left out.
fn names(parts: &[String]) -> Vec<String> {
    parts
        .iter()
        .filter(|part| !part.is_empty())
        .map(|part| part.to_ascii_uppercase())
        .collect()
}

/// A drive held in memory. A clone is a drive of its own that shares the
/// bytes of every file until it is written.
#[derive(Debug, Clone)]
pub struct MemoryDrive {
    root: Folder,
    /// Whether the drive is removable, as a floppy is.
    pub removable: bool,
    /// Where the time a file is written is read from.
    now: WallTime,
}

impl Default for MemoryDrive {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryDrive {
    /// An empty fixed drive.
    pub fn new() -> Self {
        Self {
            root: Folder::default(),
            removable: false,
            now: host_seconds,
        }
    }

    /// An empty removable drive.
    pub fn removable() -> Self {
        Self {
            removable: true,
            ..Self::new()
        }
    }

    /// The time a file written is stamped with read from `now` from now on.
    pub fn set_clock(&mut self, now: WallTime) {
        self.now = now;
    }

    /// A folder, as a DOS path names it -- its drive, if named, left out --
    /// last written at `modified`, seconds since 1970; the folders above it
    /// made where they are not there, written then too. `false` where a
    /// file is in the way.
    pub fn add_folder(&mut self, path: &str, modified: i64) -> bool {
        let names = names(&Files::parse(path).parts);

        Self::made(&mut self.root, &names, modified).is_some_and(|folder| {
            folder.modified = modified;
            true
        })
    }

    /// A file, as a DOS path names it -- its drive, if named, left out --
    /// with its bytes, last written at `modified`, seconds since 1970; the
    /// folders above it made where they are not there, written then too.
    /// What was there is replaced; `false` where a folder or a file is in
    /// the way.
    pub fn add_file(&mut self, path: &str, data: impl Into<Rc<Vec<u8>>>, modified: i64) -> bool {
        let names = names(&Files::parse(path).parts);
        let Some((name, folders)) = names.split_last() else {
            return false;
        };
        let Some(folder) = Self::made(&mut self.root, folders, modified) else {
            return false;
        };

        if matches!(folder.children.get(name), Some(Node::Folder(_))) {
            return false;
        }

        folder.children.insert(
            name.clone(),
            Node::File(Rc::new(RefCell::new(Stored {
                data: data.into(),
                modified,
            }))),
        );
        true
    }

    /// A file's bytes, as a DOS path names it.
    pub fn data(&self, path: &str) -> Option<Rc<Vec<u8>>> {
        match self.node(&names(&Files::parse(path).parts))? {
            Node::File(stored) => Some(Rc::clone(&stored.borrow().data)),
            Node::Folder(_) => None,
        }
    }

    /// A folder by its names, upper case.
    fn folder(&self, names: &[String]) -> Option<&Folder> {
        names.iter().try_fold(&self.root, |folder, name| {
            match folder.children.get(name)? {
                Node::Folder(inner) => Some(inner),
                Node::File(_) => None,
            }
        })
    }

    fn folder_mut(&mut self, names: &[String]) -> Option<&mut Folder> {
        names.iter().try_fold(&mut self.root, |folder, name| {
            match folder.children.get_mut(name)? {
                Node::Folder(inner) => Some(inner),
                Node::File(_) => None,
            }
        })
    }

    /// A folder by its names, made where it is not there, as are those
    /// above it, written at `modified`; `None` where a file is in the way.
    fn made<'a>(root: &'a mut Folder, names: &[String], modified: i64) -> Option<&'a mut Folder> {
        names.iter().try_fold(root, |folder, name| {
            let node = folder.children.entry(name.clone()).or_insert_with(|| {
                Node::Folder(Folder {
                    modified,
                    children: BTreeMap::new(),
                })
            });

            match node {
                Node::Folder(inner) => Some(inner),
                Node::File(_) => None,
            }
        })
    }

    /// What a path's names name; `None` for the drive's root, which is no
    /// folder's child.
    fn node(&self, names: &[String]) -> Option<&Node> {
        let (name, folders) = names.split_last()?;

        self.folder(folders)?.children.get(name)
    }
}

impl Volume for MemoryDrive {
    fn removable(&self) -> bool {
        self.removable
    }

    fn is_directory(&self, parts: &[String]) -> bool {
        self.folder(&names(parts)).is_some()
    }

    fn entry(&self, parts: &[String]) -> Option<Entry> {
        let names = names(parts);

        match names.last() {
            Some(name) => Some(self.node(&names)?.entry(name)),
            None => Some(Entry {
                name: String::new(),
                attributes: 0x10,
                size: 0,
                modified: stamp(self.root.modified),
            }),
        }
    }

    fn children(&self, parts: &[String]) -> Option<Vec<Entry>> {
        Some(
            self.folder(&names(parts))?
                .children
                .iter()
                .map(|(name, node)| node.entry(name))
                .collect(),
        )
    }

    fn read(&self, parts: &[String]) -> Option<Vec<u8>> {
        match self.node(&names(parts))? {
            Node::File(stored) => Some(stored.borrow().data.to_vec()),
            Node::Folder(_) => None,
        }
    }

    fn open(&mut self, parts: &[String]) -> std::io::Result<Body> {
        match self.node(&names(parts)) {
            Some(Node::File(stored)) => Ok(Body::Memory(MemoryFile {
                stored: Rc::clone(stored),
                at: 0,
                now: self.now,
            })),
            _ => Err(ErrorKind::NotFound.into()),
        }
    }

    /// A file made empty where its folder is, written now; what file was
    /// there is emptied, its handles left open on it, as a host's is.
    fn create(&mut self, parts: &[String]) -> Option<Body> {
        let now = (self.now)();
        let names = names(parts);
        let (name, folders) = names.split_last()?;
        let folder = self.folder_mut(folders)?;
        let stored = match folder.children.get(name) {
            Some(Node::Folder(_)) => return None,
            Some(Node::File(stored)) => {
                let mut emptied = stored.borrow_mut();

                emptied.data = Rc::new(Vec::new());
                emptied.modified = now;
                Rc::clone(stored)
            }
            None => {
                let stored = Rc::new(RefCell::new(Stored {
                    data: Rc::new(Vec::new()),
                    modified: now,
                }));

                folder
                    .children
                    .insert(name.clone(), Node::File(Rc::clone(&stored)));
                folder.modified = now;
                stored
            }
        };

        Some(Body::Memory(MemoryFile {
            stored,
            at: 0,
            now: self.now,
        }))
    }

    /// A file or an empty folder let go of; a file's handles left open on
    /// it, as a host's are.
    fn unlink(&mut self, parts: &[String]) -> bool {
        let now = (self.now)();
        let names = names(parts);
        let Some((name, folders)) = names.split_last() else {
            return false;
        };
        let Some(folder) = self.folder_mut(folders) else {
            return false;
        };
        let empty = match folder.children.get(name) {
            Some(Node::Folder(inner)) => inner.children.is_empty(),
            Some(Node::File(_)) => true,
            None => false,
        };

        if empty {
            folder.children.remove(name);
            folder.modified = now;
        }

        empty
    }

    /// A folder made, and the folders above it where they are not there;
    /// `false` where anything is there already.
    fn mkdir(&mut self, parts: &[String]) -> bool {
        let now = (self.now)();
        let names = names(parts);
        let Some((name, folders)) = names.split_last() else {
            return false;
        };
        let Some(folder) = Self::made(&mut self.root, folders, now) else {
            return false;
        };

        if folder.children.contains_key(name) {
            return false;
        }

        folder.children.insert(
            name.clone(),
            Node::Folder(Folder {
                modified: now,
                children: BTreeMap::new(),
            }),
        );
        folder.modified = now;
        true
    }

    /// A file or folder moved, the folders above where it goes made where
    /// they are not there, as a host's rename is: over a file, a file; over
    /// an empty folder, a folder; never into itself.
    fn rename(&mut self, from: &[String], to: &[String]) -> bool {
        let now = (self.now)();
        let from = names(from);
        let to = names(to);
        let (Some((name, folders)), Some((new_name, new_folders))) =
            (from.split_last(), to.split_last())
        else {
            return false;
        };
        let Some(node) = self.node(&from) else {
            return false;
        };

        if from == to {
            return true;
        }

        let is_folder = matches!(node, Node::Folder(_));

        if is_folder && to.starts_with(&from) {
            return false;
        }

        let replaces = match self.node(&to) {
            None => true,
            Some(Node::File(_)) => !is_folder,
            Some(Node::Folder(inner)) => is_folder && inner.children.is_empty(),
        };

        if !replaces || Self::made(&mut self.root, new_folders, now).is_none() {
            return false;
        }

        let Some(source) = self.folder_mut(folders) else {
            return false;
        };
        let Some(node) = source.children.remove(name) else {
            return false;
        };

        source.modified = now;

        let Some(target) = self.folder_mut(new_folders) else {
            return false;
        };

        target.children.insert(new_name.clone(), node);
        target.modified = now;
        true
    }
}

/// A file of a drive held in memory open, and where in it the next read or
/// write is.
#[derive(Debug)]
pub struct MemoryFile {
    stored: Rc<RefCell<Stored>>,
    at: u64,
    now: WallTime,
}

impl MemoryFile {
    /// Bytes written where the file is at, past its end filled with
    /// noughts up to there; how many. Its bytes are its own from the first
    /// write.
    pub fn write(&mut self, bytes: &[u8]) -> usize {
        let Ok(at) = usize::try_from(self.at) else {
            return 0;
        };

        if bytes.is_empty() || at > u32::MAX as usize {
            return 0;
        }

        let mut stored = self.stored.borrow_mut();
        let data = Rc::make_mut(&mut stored.data);
        let end = at + bytes.len();

        if data.len() < end {
            data.resize(end, 0);
        }

        data[at..end].copy_from_slice(bytes);
        stored.modified = (self.now)();
        self.at = end as u64;
        bytes.len()
    }

    /// Bytes read from where the file is at.
    pub fn read(&mut self, length: usize) -> Vec<u8> {
        let stored = self.stored.borrow();
        let start = usize::try_from(self.at)
            .unwrap_or(usize::MAX)
            .min(stored.data.len());
        let end = start + length.min(stored.data.len() - start);

        // Past the end, nothing is read, and the file stays where it is.
        self.at += (end - start) as u64;
        stored.data[start..end].to_vec()
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

    pub fn truncate(&mut self, length: u64) -> bool {
        let Ok(length) = usize::try_from(length) else {
            return false;
        };

        if length > u32::MAX as usize {
            return false;
        }

        let mut stored = self.stored.borrow_mut();

        Rc::make_mut(&mut stored.data).resize(length, 0);
        stored.modified = (self.now)();
        true
    }

    pub fn size(&self) -> u64 {
        self.stored.borrow().data.len() as u64
    }
}
