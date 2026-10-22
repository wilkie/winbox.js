//! A layer of drive C: (`kb/formats/layer.md`): what a program's
//! installer, or a program as it ran, added to a drive, deleted of it, or
//! wrote -- kept by itself, content-addressed, to be put over a base and
//! other layers. The manifest, `winbox-layer.json`, lists the layer's
//! entries; a file's bytes are a blob named by their sha256, and its stamp
//! is in its entry, so two files of the same bytes share one blob.
//!
//! A stack is a base (`Layer::base`, composed from the asset bundle and
//! never stored) and layers over it, the lowest first; `flatten` gives what
//! C: holds, one flat drive, and `materialise_stack` writes each layer into
//! a cache folder of the host's for `HostDrive::layered` to put together,
//! which must show the same.
//!
//! The TypeScript engine's twin is `src/layers/layer.ts`; the two give the
//! same ids, the same flattened listing and the same zip bytes
//! (`test/layers/stack.json`, `tests/layers.rs`).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::{Deserialize, Serialize};
use winbox_machine::{Change, HostLayer, MemoryDrive};

use crate::assets::{
    Composed, STAMP, StoredEntry, set_written, stored_zip_entries, write_stored_zip,
};
use crate::sha256::sha256_hex;

/// The manifest's format this engine reads and writes.
pub const FORMAT: u64 = 1;

/// The manifest's name, at the root of the exchange zip.
pub const MANIFEST: &str = "winbox-layer.json";

/// DOS's first date, 1 January 1980, which the zip's entries carry: a
/// blob has no stamp of its own.
const ZIP_DATE: u16 = 0x0021;

/// An entry of a layer, its path DOS's beneath the drive's root, upper
/// case: `WINDOWS\WIN.INI`. Stamps are seconds since 1970, local time read
/// as universal, as DOS keeps it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LayerEntry {
    /// What it deletes of the layers beneath it, a folder with everything
    /// in it.
    Removed { path: String },
    /// A folder it makes, or whose stamp it moves.
    Folder { path: String, modified: i64 },
    /// A file it makes or writes, as it stands.
    File {
        path: String,
        sha256: String,
        size: u64,
        modified: i64,
    },
}

impl LayerEntry {
    pub fn path(&self) -> &str {
        match self {
            Self::Removed { path } | Self::Folder { path, .. } | Self::File { path, .. } => path,
        }
    }

    fn rank(&self) -> u8 {
        match self {
            Self::Removed { .. } => 0,
            Self::Folder { .. } => 1,
            Self::File { .. } => 2,
        }
    }

    /// The line the id is made of.
    pub fn line(&self) -> String {
        match self {
            Self::Removed { path } => format!("removed {path}"),
            Self::Folder { path, modified } => format!("folder {path} {modified}"),
            Self::File {
                path,
                sha256,
                size,
                modified,
            } => format!("file {path} {sha256} {size} {modified}"),
        }
    }
}

/// Who made a layer: WinBox's part that did, its version, and from what.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Made {
    pub by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
}

impl Default for Made {
    fn default() -> Self {
        Self {
            by: "WinBox".to_string(),
            version: None,
            from: None,
        }
    }
}

/// `winbox-layer.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub format: u64,
    /// `layer_id` of the entries; a base's is its name,
    /// `base:<assets id>:<display>`.
    pub id: String,
    /// The stack it was made on, the base first, then the layers' ids, the
    /// lowest first; empty for a layer made over nothing.
    pub over: Vec<String>,
    pub made: Made,
    /// In their canonical order (`order_entries`).
    pub entries: Vec<LayerEntry>,
}

/// A layer: its manifest and the blobs its files' bytes are, by sha256.
#[derive(Debug, Clone)]
pub struct Layer {
    pub manifest: Manifest,
    pub blobs: BTreeMap<String, Rc<Vec<u8>>>,
}

/// A folder of a flattened stack, and its stamp.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlatFolder {
    pub path: String,
    pub modified: i64,
}

/// A file of a flattened stack.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlatFile {
    pub path: String,
    pub sha256: String,
    pub size: u64,
    pub modified: i64,
    pub data: Rc<Vec<u8>>,
}

/// What a stack holds, as one flat drive: each sorted by path.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Flat {
    pub folders: Vec<FlatFolder>,
    pub files: Vec<FlatFile>,
}

fn depth(path: &str) -> usize {
    path.split('\\').count()
}

/// Entries in their canonical order, the order a layer keeps them and puts
/// them on a drive in: what is deleted first, by path; then the folders,
/// the shallowest first, each depth by path; then the files, by path.
/// Paths are compared byte by byte. A path named twice by one kind is
/// refused.
pub fn order_entries(mut entries: Vec<LayerEntry>) -> Result<Vec<LayerEntry>, String> {
    entries.sort_by(|one, other| {
        one.rank()
            .cmp(&other.rank())
            .then_with(|| match one {
                LayerEntry::Folder { .. } => depth(one.path()).cmp(&depth(other.path())),
                _ => std::cmp::Ordering::Equal,
            })
            .then_with(|| one.path().cmp(other.path()))
    });

    for pair in entries.windows(2) {
        if pair[0].rank() == pair[1].rank() && pair[0].path() == pair[1].path() {
            return Err(format!("a layer names {} twice", pair[0].path()));
        }
    }

    Ok(entries)
}

/// A layer's id: the sha256 of its entries' lines (`LayerEntry::line`), in
/// their canonical order, joined by line feeds with none after the last --
/// as the asset bundle's id is the sha256 of its files' hashes, one to a
/// line.
pub fn layer_id(entries: &[LayerEntry]) -> Result<String, String> {
    let lines: Vec<String> = order_entries(entries.to_vec())?
        .iter()
        .map(LayerEntry::line)
        .collect();

    Ok(sha256_hex(lines.join("\n").as_bytes()))
}

/// A DOS path as a layer keeps it: back slashes, upper case, no slash at
/// either end.
pub fn layer_path(path: &str) -> String {
    path.replace('/', "\\")
        .split('\\')
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>()
        .join("\\")
        .to_ascii_uppercase()
}

/// The name of the base composed from an asset bundle for a display.
pub fn base_name(assets_id: &str, display: &str) -> String {
    format!("base:{assets_id}:{display}")
}

/// The id of a stack, the base first: the sha256 of its layers' ids, one
/// to a line -- what the folder a layer is materialised into for that
/// stack is named by (`materialise`).
pub fn stack_id(stack: &[Layer]) -> String {
    let ids: Vec<&str> = stack
        .iter()
        .map(|layer| layer.manifest.id.as_str())
        .collect();

    sha256_hex(ids.join("\n").as_bytes())
}

impl Layer {
    /// A layer of a drive's changes (`MemoryDrive::changes_from`): each
    /// file's bytes a blob, its stamp in its entry.
    pub fn from_changes(changes: &[Change], over: Vec<String>, made: Made) -> Result<Self, String> {
        let mut blobs = BTreeMap::new();
        let entries = changes
            .iter()
            .map(|change| match change {
                Change::Removed { path } => LayerEntry::Removed {
                    path: layer_path(path),
                },
                Change::Folder { path, modified } => LayerEntry::Folder {
                    path: layer_path(path),
                    modified: *modified,
                },
                Change::File {
                    path,
                    data,
                    modified,
                } => {
                    let hash = sha256_hex(data);

                    blobs.insert(hash.clone(), Rc::clone(data));
                    LayerEntry::File {
                        path: layer_path(path),
                        sha256: hash,
                        size: data.len() as u64,
                        modified: *modified,
                    }
                }
            })
            .collect();
        let entries = order_entries(entries)?;

        Ok(Self {
            manifest: Manifest {
                format: FORMAT,
                id: layer_id(&entries)?,
                over,
                made,
                entries,
            },
            blobs,
        })
    }

    /// The base of C: composed from an asset bundle (`assets::compose`) as
    /// the lowest layer of a stack: its folders, those it names and those
    /// above its files, each stamped `STAMP` as `write_base` and the page's
    /// drive stamp them; its files with their stamps. Named, not hashed
    /// (`base_name`): it is made again from the bundle, never stored.
    pub fn base(composed: &Composed, assets_id: &str, display: &str) -> Self {
        let mut folders = BTreeSet::new();
        let mut blobs = BTreeMap::new();
        let mut entries = Vec::new();
        let above = |path: &str, folders: &mut BTreeSet<String>| {
            let names: Vec<&str> = path.split('\\').collect();

            for at in 1..names.len() {
                folders.insert(names[..at].join("\\"));
            }
        };

        for directory in &composed.directories {
            let path = layer_path(directory);

            above(&path, &mut folders);
            folders.insert(path);
        }

        for file in &composed.files {
            let path = layer_path(&file.path);
            let hash = sha256_hex(&file.data);

            above(&path, &mut folders);
            blobs.insert(hash.clone(), Rc::new(file.data.clone()));
            entries.push(LayerEntry::File {
                path,
                sha256: hash,
                size: file.data.len() as u64,
                modified: file.modified,
            });
        }

        entries.extend(folders.into_iter().map(|path| LayerEntry::Folder {
            path,
            modified: STAMP,
        }));

        Self {
            manifest: Manifest {
                format: FORMAT,
                id: base_name(assets_id, display),
                over: Vec::new(),
                made: Made::default(),
                entries: order_entries(entries).unwrap_or_default(),
            },
            blobs,
        }
    }

    /// A blob of the layer's, refused where it has none.
    fn blob(&self, hash: &str) -> Result<Rc<Vec<u8>>, String> {
        self.blobs
            .get(hash)
            .cloned()
            .ok_or_else(|| format!("layer {} has no blob {hash}", self.manifest.id))
    }

    /// The layer as a drive's changes, in its order: what
    /// `MemoryDrive::apply` puts on a drive.
    pub fn changes(&self) -> Result<Vec<Change>, String> {
        self.manifest
            .entries
            .iter()
            .map(|entry| {
                Ok(match entry {
                    LayerEntry::Removed { path } => Change::Removed { path: path.clone() },
                    LayerEntry::Folder { path, modified } => Change::Folder {
                        path: path.clone(),
                        modified: *modified,
                    },
                    LayerEntry::File {
                        path,
                        sha256,
                        modified,
                        ..
                    } => Change::File {
                        path: path.clone(),
                        data: self.blob(sha256)?,
                        modified: *modified,
                    },
                })
            })
            .collect()
    }

    /// The layer as the zip it is exchanged in: stored entries, the
    /// manifest first, then each blob its files name, once, as
    /// `blobs/<sha256>`, by hash.
    pub fn zip(&self) -> Result<Vec<u8>, String> {
        let text = manifest_text(&self.manifest)?;
        let hashes: BTreeSet<&str> = self
            .manifest
            .entries
            .iter()
            .filter_map(|entry| match entry {
                LayerEntry::File { sha256, .. } => Some(sha256.as_str()),
                _ => None,
            })
            .collect();
        let blobs = hashes
            .iter()
            .map(|hash| Ok((format!("blobs/{hash}"), self.blob(hash)?)))
            .collect::<Result<Vec<_>, String>>()?;
        let mut entries = vec![StoredEntry {
            path: MANIFEST,
            data: &text,
            date: ZIP_DATE,
            time: 0,
        }];

        entries.extend(blobs.iter().map(|(path, data)| StoredEntry {
            path,
            data,
            date: ZIP_DATE,
            time: 0,
        }));

        write_stored_zip(&entries)
    }

    /// A layer from its exchange zip. Refused: no manifest, a format this
    /// engine does not know, a blob missing or not the bytes its name says,
    /// or an id that is not its entries'.
    pub fn from_zip(bytes: &[u8]) -> Result<Self, String> {
        let files = stored_zip_entries(bytes)?;
        let text = files
            .get(MANIFEST)
            .ok_or_else(|| format!("no {MANIFEST}: not a layer"))?;
        let mut manifest: Manifest =
            serde_json::from_slice(text).map_err(|error| format!("{MANIFEST}: {error}"))?;

        if manifest.format != FORMAT {
            return Err(format!(
                "a layer of format {}: this WinBox reads {FORMAT}",
                manifest.format
            ));
        }

        manifest.entries = order_entries(manifest.entries)?;

        let mut blobs = BTreeMap::new();

        for entry in &manifest.entries {
            let LayerEntry::File {
                path, sha256, size, ..
            } = entry
            else {
                continue;
            };

            if blobs.contains_key(sha256) {
                continue;
            }

            match files.get(&format!("blobs/{sha256}")) {
                Some(data) if data.len() as u64 == *size && sha256_hex(data) == *sha256 => {
                    blobs.insert(sha256.clone(), Rc::new(data.clone()));
                }
                _ => return Err(format!("the blob of {path} is missing or not its bytes")),
            }
        }

        if layer_id(&manifest.entries)? != manifest.id {
            return Err(format!(
                "layer {}: its entries' id is not that",
                manifest.id
            ));
        }

        Ok(Self { manifest, blobs })
    }

    /// What the layer hides of those beneath it.
    pub fn removed(&self) -> impl Iterator<Item = &str> {
        self.manifest
            .entries
            .iter()
            .filter_map(|entry| match entry {
                LayerEntry::Removed { path } => Some(path.as_str()),
                _ => None,
            })
    }
}

/// A manifest's text, as the exchange zip holds it: as the TypeScript
/// engine's `JSON.stringify(manifest, null, 2)`, and a line feed.
pub fn manifest_text(manifest: &Manifest) -> Result<Vec<u8>, String> {
    let mut text = serde_json::to_vec_pretty(manifest).map_err(|error| error.to_string())?;

    text.push(b'\n');
    Ok(text)
}

/// Whether a path is a folder's, or beneath it.
fn within(path: &str, folder: &str) -> bool {
    path == folder
        || path
            .strip_prefix(folder)
            .is_some_and(|rest| rest.starts_with('\\'))
}

/// Where two layers touch: a path both name, or one beneath what the other
/// deletes. None where they touch nowhere.
pub fn touching(one: &Manifest, other: &Manifest) -> Option<String> {
    let named: BTreeSet<&str> = other.entries.iter().map(LayerEntry::path).collect();

    if let Some(entry) = one
        .entries
        .iter()
        .find(|entry| named.contains(entry.path()))
    {
        return Some(entry.path().to_string());
    }

    for (deleting, naming) in [(one, other), (other, one)] {
        for entry in &deleting.entries {
            let LayerEntry::Removed { path: folder } = entry else {
                continue;
            };

            if let Some(found) = naming
                .entries
                .iter()
                .find(|entry| within(entry.path(), folder))
            {
                return Some(found.path().to_string());
            }
        }
    }

    None
}

/// Whether a stack may be put together, the base first: each layer made
/// over that base or over nothing, the layers it was made over beneath it,
/// and two layers that touch the same path only where the higher was made
/// over the lower (the owner's "install in turn"). Refused with why;
/// nothing where it may.
pub fn stack_refusal(stack: &[&Manifest]) -> Option<String> {
    let base = stack.first().map(|base| base.id.as_str())?;

    for (at, layer) in stack.iter().enumerate().skip(1) {
        let beneath: BTreeSet<&str> = stack[..at].iter().map(|below| below.id.as_str()).collect();

        if let Some(first) = layer.over.first()
            && first != base
        {
            return Some(format!(
                "layer {} was made on {first}, not on {base}",
                layer.id
            ));
        }

        if let Some(id) = layer
            .over
            .iter()
            .skip(1)
            .find(|id| !beneath.contains(id.as_str()))
        {
            return Some(format!(
                "layer {} was made over {id}, which is not beneath it",
                layer.id
            ));
        }

        for below in &stack[..at] {
            if let Some(path) = touching(below, layer)
                && !layer.over.contains(&below.id)
            {
                return Some(format!(
                    "layers {} and {} both touch {path}, and neither was made over the other",
                    below.id, layer.id
                ));
            }
        }
    }

    None
}

#[derive(Debug)]
enum Node {
    Folder {
        modified: i64,
        children: BTreeMap<String, Node>,
    },
    File {
        modified: i64,
        sha256: String,
        data: Rc<Vec<u8>>,
    },
}

/// A folder by its names, made where it is not there, as are those above
/// it, stamped `modified`; none where a file is in the way -- as
/// `MemoryDrive` makes one.
fn made<'a>(
    root: &'a mut BTreeMap<String, Node>,
    names: &[&str],
    modified: i64,
) -> Option<(&'a mut BTreeMap<String, Node>, &'a mut i64)> {
    let (first, rest) = names.split_first()?;
    let node = root.entry((*first).to_string()).or_insert(Node::Folder {
        modified,
        children: BTreeMap::new(),
    });

    match node {
        Node::Folder {
            modified: stamp,
            children,
        } => {
            if rest.is_empty() {
                Some((children, stamp))
            } else {
                made(children, rest, modified)
            }
        }
        Node::File { .. } => None,
    }
}

/// A flattened folder's entries put in a `Flat`, beneath `prefix`.
fn walk_flat(folder: &BTreeMap<String, Node>, prefix: &str, flat: &mut Flat) {
    for (name, node) in folder {
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}\\{name}")
        };

        match node {
            Node::Folder { modified, children } => {
                flat.folders.push(FlatFolder {
                    path: path.clone(),
                    modified: *modified,
                });
                walk_flat(children, &path, flat);
            }
            Node::File {
                modified,
                sha256,
                data,
            } => flat.files.push(FlatFile {
                path,
                sha256: sha256.clone(),
                size: data.len() as u64,
                modified: *modified,
                data: Rc::clone(data),
            }),
        }
    }
}

/// A stack, the base first, as one flat drive: each layer's entries put on
/// what is beneath, in their order, as `MemoryDrive::apply` puts changes on
/// a drive -- a deleted path let go of with all beneath it; a folder made,
/// and those above it where they are not there, stamped then, or its stamp
/// moved where it is; a file put there, the folders above made as for a
/// folder. Refused as `stack_refusal` refuses it.
pub fn flatten(stack: &[Layer]) -> Result<Flat, String> {
    let manifests: Vec<&Manifest> = stack.iter().map(|layer| &layer.manifest).collect();

    if let Some(refusal) = stack_refusal(&manifests) {
        return Err(refusal);
    }

    let mut root: BTreeMap<String, Node> = BTreeMap::new();

    for layer in stack {
        for entry in &layer.manifest.entries {
            let names: Vec<&str> = entry.path().split('\\').collect();
            let Some((name, folders)) = names.split_last() else {
                continue;
            };

            match entry {
                LayerEntry::Removed { .. } => {
                    let mut folder = Some(&mut root);

                    for above in folders {
                        folder = match folder.and_then(|folder| folder.get_mut(*above)) {
                            Some(Node::Folder { children, .. }) => Some(children),
                            _ => None,
                        };
                    }

                    if let Some(folder) = folder {
                        folder.remove(*name);
                    }
                }
                LayerEntry::Folder { modified, .. } => {
                    if let Some((_, stamp)) = made(&mut root, &names, *modified) {
                        *stamp = *modified;
                    }
                }
                LayerEntry::File {
                    sha256, modified, ..
                } => {
                    let folder = if folders.is_empty() {
                        Some(&mut root)
                    } else {
                        made(&mut root, folders, *modified).map(|(children, _)| children)
                    };

                    if let Some(folder) = folder
                        && !matches!(folder.get(*name), Some(Node::Folder { .. }))
                    {
                        folder.insert(
                            (*name).to_string(),
                            Node::File {
                                modified: *modified,
                                sha256: sha256.clone(),
                                data: layer.blob(sha256)?,
                            },
                        );
                    }
                }
            }
        }
    }

    let mut flat = Flat::default();

    walk_flat(&root, "", &mut flat);
    flat.folders.sort_by(|one, other| one.path.cmp(&other.path));
    flat.files.sort_by(|one, other| one.path.cmp(&other.path));

    Ok(flat)
}

impl Flat {
    /// The flattened stack as lines, one to an entry: how the two engines'
    /// are compared.
    pub fn lines(&self) -> Vec<String> {
        self.folders
            .iter()
            .map(|folder| format!("folder {} {}", folder.path, folder.modified))
            .chain(self.files.iter().map(|file| {
                format!(
                    "file {} {} {} {}",
                    file.path, file.sha256, file.size, file.modified
                )
            }))
            .collect()
    }

    /// The flattened stack as a drive held in memory.
    pub fn drive(&self) -> MemoryDrive {
        let mut drive = MemoryDrive::new();

        for folder in &self.folders {
            drive.add_folder(&folder.path, folder.modified);
        }

        for file in &self.files {
            drive.add_file(&file.path, Rc::clone(&file.data), file.modified);
        }

        drive
    }
}

/// Where a DOS path beneath a layer's folder is on the host.
fn on_host(root: &Path, path: &str) -> PathBuf {
    path.split('\\')
        .fold(root.to_path_buf(), |at, name| at.join(name))
}

/// A layer of a stack written into a folder of `cache`, the stack's id
/// through it (`stack_id`) naming it, `layer-<id>`, once: where it is there
/// already, it is taken as it is. Written beside and renamed into place, as
/// `Assets::base_in` writes the base, so a run beside another never finds
/// half of one. Its folders and files, each stamped as the stack through
/// it has them (`flatten`): a folder the layer names but does not stamp
/// (one a file it writes is in) shows the stamp of the stack beneath, for a
/// host drive of layers takes a folder's stamp from the highest layer that
/// has it -- which is why the folder is the stack's and not the layer's
/// alone. With what it hides of the layers beneath, as `HostDrive::layered`
/// takes it.
pub fn materialise(stack: &[Layer], at: usize, cache: &Path) -> Result<HostLayer, String> {
    static MADE: AtomicUsize = AtomicUsize::new(0);
    let through = &stack[..=at];
    let id = stack_id(through);
    let layer = &stack[at];
    let folder = cache.join(format!("layer-{id}"));
    let host_layer = |path: PathBuf| HostLayer::new(path).removing(layer.removed());

    if folder.is_dir() {
        return Ok(host_layer(folder));
    }

    let flat = flatten(through)?;
    let stamps: BTreeMap<&str, i64> = flat
        .folders
        .iter()
        .map(|folder| (folder.path.as_str(), folder.modified))
        .collect();
    let building = cache.join(format!(
        ".layer-{id}-{}-{}",
        std::process::id(),
        MADE.fetch_add(1, Ordering::Relaxed)
    ));
    let failed = |error: std::io::Error| format!("{}: {error}", building.display());
    let mut folders = BTreeSet::new();

    std::fs::create_dir_all(&building).map_err(failed)?;

    for entry in &layer.manifest.entries {
        let path = entry.path();
        let names: Vec<&str> = path.split('\\').collect();

        for depth in 1..names.len() {
            folders.insert(names[..depth].join("\\"));
        }

        match entry {
            LayerEntry::Removed { .. } => {}
            LayerEntry::Folder { .. } => {
                std::fs::create_dir_all(on_host(&building, path)).map_err(failed)?;
                folders.insert(path.to_string());
            }
            LayerEntry::File {
                sha256, modified, ..
            } => {
                let host = on_host(&building, path);

                if let Some(parent) = host.parent() {
                    std::fs::create_dir_all(parent).map_err(failed)?;
                }

                std::fs::write(&host, &*layer.blob(sha256)?).map_err(failed)?;
                set_written(&host, *modified).map_err(failed)?;
            }
        }
    }

    // A path removed and not made again names folders above it that the
    // layer need not hold.
    folders.retain(|path| on_host(&building, path).is_dir());

    // The deepest first, as making a folder in one moves its stamp.
    let mut deepest: Vec<&String> = folders.iter().collect();

    deepest.sort_by_key(|path| std::cmp::Reverse(depth(path)));

    for path in deepest {
        if let Some(&modified) = stamps.get(path.as_str()) {
            set_written(&on_host(&building, path), modified).map_err(failed)?;
        }
    }

    if std::fs::rename(&building, &folder).is_err() {
        // Another run made it first.
        let _ = std::fs::remove_dir_all(&building);

        if !folder.is_dir() {
            return Err(format!("{}: could not be made", folder.display()));
        }
    }

    Ok(host_layer(folder))
}

/// Every layer of a stack, the base first, materialised into `cache`
/// (`materialise`): the layers `HostDrive::layered` takes, the highest
/// first.
pub fn materialise_stack(stack: &[Layer], cache: &Path) -> Result<Vec<HostLayer>, String> {
    let mut layers = (0..stack.len())
        .map(|at| materialise(stack, at, cache))
        .collect::<Result<Vec<_>, String>>()?;

    layers.reverse();
    Ok(layers)
}
