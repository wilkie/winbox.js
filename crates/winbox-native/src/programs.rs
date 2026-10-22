//! Programs kept as layers of drive C:, on the host's disk
//! (`kb/formats/layer.md`, "On the native build's disk"): what the page
//! keeps in `IndexedDB`, kept in the cache folder, `winbox`, in the page's
//! own format.
//!
//! ```text
//! winbox/blobs/<sha256>                a file's bytes, kept once
//! winbox/layers/<id>.json              a layer's manifest, as its zip has it
//! winbox/programs/<name>.json          a program: its base, display, layers, EXEs
//! winbox/layer-<stack id>/             a layer materialised for its stack
//! winbox/users/<name>/C/               what the program wrote: the top of C:
//! winbox/users/<name>/removed          what it deleted beneath, one a line
//! winbox/users/<name>/identity         the stack its writes were made on
//! winbox/staging/<name>-<pid>/         an installer's run: media/ and C/
//! ```
//!
//! A program's C: is its base (the asset bundle's for its display, or an
//! installation's folder), its layers over it, each materialised once
//! (`layers::materialise`), and its user's layer on top, a writable folder
//! whose deletes of what is beneath are kept in a file beside it
//! (`HostDrive::keeping_removed`). An installer is run over the same stack
//! with its media beneath an empty top; what it left in the top, its
//! media's paths dropped, is the layer kept.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use winbox_machine::{Change, Files, HostDrive, HostLayer, MemoryDrive, Volume, days_from_civil};
use winbox_win16::assets::{Assets, STAMP, dos_seconds, set_written};
use winbox_win16::layers::{
    Layer, LayerEntry, Made, Manifest, flatten, manifest_text, materialise, stack_refusal,
};
use winbox_win16::sha256::sha256_hex;

/// Who makes the layers kept here.
pub const MADE_BY: &str = "WinBox native";

/// A program kept: the page's `KeptProgram` (`src/run/store.ts`), field
/// for field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Program {
    pub name: String,
    /// The base it was made on: `base:<assets id>:<display>`, or
    /// `folder:<layer id of the installation's folder>`.
    pub base: String,
    pub display: String,
    /// Its layers' ids, the lowest first.
    pub layers: Vec<String>,
    /// Its programs, as C: names them: `C:\GAMES\SKI.EXE`.
    pub exes: Vec<String>,
    /// The page's order of a layer's files; the native build keeps none.
    #[serde(default)]
    pub orders: BTreeMap<String, Vec<String>>,
    /// When it was kept, in milliseconds since 1970.
    #[serde(default)]
    pub kept: u64,
}

impl Program {
    /// A program of nothing yet, on a base.
    pub fn new(name: &str, base: &Base) -> Self {
        Self {
            name: name.to_string(),
            base: base.name().to_string(),
            display: base.display.clone(),
            layers: Vec::new(),
            exes: Vec::new(),
            orders: BTreeMap::new(),
            kept: 0,
        }
    }

    /// What its user's layer is told against, as the page's
    /// `programIdentity` has it: the name, the base, the display and the
    /// layers' ids.
    pub fn identity(&self) -> String {
        format!(
            "program:{}:{}:{}:{}",
            encode_component(&self.name),
            self.base,
            self.display,
            self.layers.join(",")
        )
    }
}

/// A name as JavaScript's `encodeURIComponent` writes it.
fn encode_component(text: &str) -> String {
    let mut encoded = String::new();

    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char);
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }

    encoded
}

/// The base of C: a stack is put on: its layer (its manifest's id its
/// name), the host's folder `HostDrive::layered` reads it from, and its
/// display.
#[derive(Debug, Clone)]
pub struct Base {
    pub layer: Layer,
    pub folder: PathBuf,
    pub display: String,
}

impl Base {
    /// The asset bundle's base for a display, written once into `cache`
    /// (`Assets::base_in`), named `base:<assets id>:<display>`.
    pub fn of_assets(assets: &Assets, display: &str, cache: &Path) -> Result<Self, String> {
        let folder = assets.base_in(cache, display)?;
        let layer = Layer::base(&assets.compose(display)?, &assets.id, display);

        Ok(Self {
            layer,
            folder,
            display: display.to_string(),
        })
    }

    /// An installation's folder as a base, read as it stands and named by
    /// what it holds: `folder:<id>`, its id the layer id of its folders and
    /// files (`layer_id`). The page names an installation by its archive's
    /// sha256; a folder has none.
    pub fn of_folder(folder: &Path, display: &str) -> Result<Self, String> {
        let held = held(&HostDrive::new(folder.to_path_buf()));
        let mut layer = Layer::from_changes(
            &held.changes_from(&MemoryDrive::new()),
            Vec::new(),
            Made::default(),
        )?;

        layer.manifest.id = format!("folder:{}", layer.manifest.id);
        Ok(Self {
            layer,
            folder: folder.to_path_buf(),
            display: display.to_string(),
        })
    }

    pub fn name(&self) -> &str {
        &self.layer.manifest.id
    }
}

/// A DOS date as seconds since 1970, local time read as universal.
fn seconds_of(stamp: [u16; 6]) -> i64 {
    let [year, month, day, hour, minute, second] = stamp;

    days_from_civil(i64::from(year), month, day) * 86_400
        + i64::from(hour) * 3600
        + i64::from(minute) * 60
        + i64::from(second)
}

/// A drive held in memory as it lists and reads: each folder and file,
/// stamped as it shows.
pub fn held(volume: &dyn Volume) -> MemoryDrive {
    fn walk(volume: &dyn Volume, parts: &mut Vec<String>, drive: &mut MemoryDrive) {
        let Some(mut entries) = volume.children(parts) else {
            return;
        };

        entries.sort_by(|one, other| one.name.cmp(&other.name));

        for entry in entries {
            parts.push(entry.name.clone());

            let path = parts.join("\\");
            let at = seconds_of(entry.modified);

            if entry.attributes & 0x10 != 0 {
                drive.add_folder(&path, at);
                walk(volume, parts, drive);
            } else if let Some(data) = volume.read(parts) {
                drive.add_file(&path, data, at);
            }

            parts.pop();
        }
    }

    let mut drive = MemoryDrive::new();

    walk(volume, &mut Vec::new(), &mut drive);
    drive
}

/// A name as DOS has it, upper case, where it is one: eight characters at
/// most, and an extension of three at most. WinBox does not shorten names.
pub fn dos_name(name: &str) -> Option<String> {
    let upper = name.to_ascii_uppercase();
    let (stem, extension) = upper.split_once('.').unwrap_or((&upper, ""));
    let allowed = |text: &str| {
        text.bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'()-@^_`{}~".contains(&byte))
    };

    (!stem.is_empty()
        && stem.len() <= 8
        && extension.len() <= 3
        && allowed(stem)
        && allowed(extension))
    .then_some(upper)
}

/// When a host's file or folder was last written, in seconds since 1970.
fn host_seconds_of(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_secs() as i64)
}

/// A host's folder of files laid out as C: (or beneath `prefix` on it)
/// held in memory, each stamped as the host has it. Refused where a name
/// is not a DOS name.
pub fn host_tree(folder: &Path, prefix: &str) -> Result<MemoryDrive, String> {
    fn walk(folder: &Path, dos: &str, drive: &mut MemoryDrive) -> Result<(), String> {
        let entries =
            std::fs::read_dir(folder).map_err(|error| format!("{}: {error}", folder.display()))?;

        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(name) = dos_name(&name) else {
                return Err(format!(
                    "{}: not a DOS name of eight letters and three; WinBox does not shorten names",
                    path.display()
                ));
            };
            let dos = if dos.is_empty() {
                name
            } else {
                format!("{dos}\\{name}")
            };

            if path.is_dir() {
                drive.add_folder(&dos, host_seconds_of(&path));
                walk(&path, &dos, drive)?;
            } else {
                let data =
                    std::fs::read(&path).map_err(|error| format!("{}: {error}", path.display()))?;

                drive.add_file(&dos, data, host_seconds_of(&path));
            }
        }

        // The folder's stamp after what was put in it.
        if !dos.is_empty() {
            drive.add_folder(dos, host_seconds_of(folder));
        }

        Ok(())
    }

    let mut drive = MemoryDrive::new();

    if !prefix.is_empty() {
        drive.add_folder(prefix, host_seconds_of(folder));
    }

    walk(folder, prefix, &mut drive)?;
    Ok(drive)
}

/// A zip archive's files laid out beneath `prefix` on a drive held in
/// memory: its entries stored or deflated, each stamped with its DOS date
/// and time; a folder without an entry of its own stamped `STAMP`, as the
/// page stamps the folders it makes.
pub fn zip_tree(bytes: &[u8], prefix: &str) -> Result<MemoryDrive, String> {
    let short = || "a zip archive cut short".to_string();
    let word = |at: usize| {
        bytes
            .get(at..at + 2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .ok_or_else(short)
    };
    let long = |at: usize| {
        bytes
            .get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
            .ok_or_else(short)
    };
    let end = (0..bytes.len().saturating_sub(21))
        .rev()
        .find(|&at| bytes[at..].starts_with(&[0x50, 0x4b, 0x05, 0x06]))
        .ok_or_else(|| "not a zip archive".to_string())?;
    let count = usize::from(word(end + 10)?);
    let mut at = long(end + 16)?;
    let mut drive = MemoryDrive::new();
    let mut stamped = Vec::new();

    if !prefix.is_empty() {
        drive.add_folder(prefix, STAMP);
    }

    for _ in 0..count {
        if long(at)? != 0x0201_4b50 {
            return Err("a zip archive's directory is not as it should be".to_string());
        }

        let method = word(at + 10)?;
        let modified = dos_seconds(word(at + 14)?, word(at + 12)?);
        let packed = long(at + 20)?;
        let size = long(at + 24)?;
        let name_length = usize::from(word(at + 28)?);
        let skip = name_length + usize::from(word(at + 30)?) + usize::from(word(at + 32)?);
        let local = long(at + 42)?;
        let name = String::from_utf8_lossy(
            bytes
                .get(at + 46..at + 46 + name_length)
                .ok_or_else(short)?,
        )
        .replace('/', "\\");

        at += 46 + skip;

        let mut path = Vec::new();

        for part in name.split('\\').filter(|part| !part.is_empty()) {
            path.push(dos_name(part).ok_or_else(|| {
                format!("{name}: not a DOS name of eight letters and three; WinBox does not shorten names")
            })?);
        }

        let path = std::iter::once(prefix)
            .filter(|prefix| !prefix.is_empty())
            .chain(path.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join("\\");

        if name.ends_with('\\') {
            drive.add_folder(&path, modified);
            stamped.push((path, modified));
            continue;
        }

        if long(local)? != 0x0403_4b50 {
            return Err(format!("{name}: its local header is not as it should be"));
        }

        let start = local + 30 + usize::from(word(local + 26)?) + usize::from(word(local + 28)?);
        let data = bytes.get(start..start + packed).ok_or_else(short)?;
        let data = match method {
            0 => data.to_vec(),
            8 => miniz_oxide::inflate::decompress_to_vec(data)
                .map_err(|error| format!("{name}: {error:?}"))?,
            _ => {
                return Err(format!(
                    "{name}: compressed by method {method}, which WinBox does not read"
                ));
            }
        };

        if data.len() != size {
            return Err(format!("{name}: not the size its directory gives"));
        }

        drive.add_file(&path, data, modified);
    }

    // A folder's own entry stamps it, whatever was put in it after.
    for (path, modified) in stamped {
        drive.add_folder(&path, modified);
    }

    Ok(drive)
}

/// What a drive held in memory holds, as changes from nothing.
fn everything(drive: &MemoryDrive) -> Vec<Change> {
    drive.changes_from(&MemoryDrive::new())
}

/// Folders and files written into a host's folder, each stamped: the
/// folders last, the deepest first, as making one in a folder moves its
/// stamp.
fn write_tree(changes: &[Change], root: &Path) -> Result<(), String> {
    let on_host = |path: &str| {
        path.split('\\')
            .fold(root.to_path_buf(), |at, name| at.join(name))
    };
    let failed = |error: std::io::Error| format!("{}: {error}", root.display());
    let mut folders = Vec::new();

    std::fs::create_dir_all(root).map_err(failed)?;

    for change in changes {
        match change {
            Change::Folder { path, modified } => {
                std::fs::create_dir_all(on_host(path)).map_err(failed)?;
                folders.push((path.clone(), *modified));
            }
            Change::File {
                path,
                data,
                modified,
            } => {
                let host = on_host(path);

                if let Some(parent) = host.parent() {
                    std::fs::create_dir_all(parent).map_err(failed)?;
                }

                std::fs::write(&host, &**data).map_err(failed)?;
                set_written(&host, *modified).map_err(failed)?;
            }
            Change::Removed { .. } => {}
        }
    }

    folders.sort_by_key(|(path, _)| std::cmp::Reverse(path.split('\\').count()));

    for (path, modified) in folders {
        set_written(&on_host(&path), modified).map_err(failed)?;
    }

    Ok(())
}

/// A file written beside where it is to be and moved into place, so a run
/// beside never finds half of one.
fn write_whole(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let failed = |error: std::io::Error| format!("{}: {error}", path.display());

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(failed)?;
    }

    let staged = path.with_extension(format!("new-{}", std::process::id()));

    std::fs::write(&staged, bytes).map_err(failed)?;
    std::fs::rename(&staged, path).map_err(failed)
}

/// Whether a program's name may name its files: not empty, no folder's
/// separator or what Windows refuses in a file's name.
pub fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 64
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err(format!(
            "{name:?}: a program's name names its files, so it is 64 characters at most, with none of <>:\"/\\|?*"
        ));
    }

    Ok(())
}

/// The folder an installer's media are put in on C:, `C:\<NAME>`: the
/// program's name as a DOS name, its letters kept, eight at most.
pub fn media_folder(name: &str) -> Result<String, String> {
    let folder: String = name
        .to_ascii_uppercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "_-$~!#%&@^".contains(*c))
        .take(8)
        .collect();

    if folder.is_empty() {
        return Err(format!("{name:?} makes no DOS name for its media's folder"));
    }

    Ok(folder)
}

/// Whether a path is a folder's, or beneath it.
fn within(path: &str, folder: &str) -> bool {
    path == folder
        || path
            .strip_prefix(folder)
            .is_some_and(|rest| rest.starts_with('\\'))
}

/// The programs a stack's layers hold, as C: names them, sorted: each
/// `.EXE` a layer writes, and not deleted by one above.
pub fn exes_of(layers: &[Layer]) -> Vec<String> {
    let mut exes = BTreeSet::new();

    for layer in layers {
        for entry in &layer.manifest.entries {
            match entry {
                LayerEntry::Removed { path } => exes.retain(|exe: &String| !within(exe, path)),
                LayerEntry::File { path, .. } if path.to_ascii_uppercase().ends_with(".EXE") => {
                    exes.insert(path.clone());
                }
                _ => {}
            }
        }
    }

    exes.into_iter().map(|path| format!("C:\\{path}")).collect()
}

/// What the user's layer of a program was made on, against the program's
/// stack now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UserLayer {
    /// None made yet.
    New,
    /// Made on this stack.
    Same,
    /// Made on another: the program's layers have changed since.
    Other(String),
}

/// An installer's run: its folder in `staging`, where its media are put
/// (`media/`, laid at `C:\<media>`) and its top (`C/`, its deletes in
/// `removed`); and the installer as C: names it.
#[derive(Debug, Clone)]
pub struct Staging {
    pub folder: PathBuf,
    pub media: String,
    pub setup: String,
    /// The media as they were put on C:.
    pub laid: Vec<Change>,
}

impl Staging {
    pub fn top(&self) -> PathBuf {
        self.folder.join("C")
    }

    pub fn removed(&self) -> PathBuf {
        self.folder.join("removed")
    }

    /// The layers beneath the top: the media over the stack's.
    pub fn lowers(&self, stack: Vec<HostLayer>) -> Vec<HostLayer> {
        std::iter::once(HostLayer::new(self.folder.join("media")))
            .chain(stack)
            .collect()
    }

    /// The drive the installer runs on: the empty top over the media and
    /// the stack, what it deletes kept beside the top.
    pub fn drive(&self, stack: Vec<HostLayer>) -> Result<HostDrive, String> {
        HostDrive::layered(self.top(), self.lowers(stack))
            .keeping_removed(self.removed())
            .map_err(|error| format!("{}: {error}", self.removed().display()))
    }

    /// The staging let go of.
    pub fn discard(&self) {
        let _ = std::fs::remove_dir_all(&self.folder);
    }
}

/// Where programs and their layers are kept: the cache folder's `winbox`.
#[derive(Debug, Clone)]
pub struct Store {
    pub root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn blob_file(&self, hash: &str) -> PathBuf {
        self.root.join("blobs").join(hash)
    }

    fn manifest_file(&self, id: &str) -> PathBuf {
        self.root.join("layers").join(format!("{id}.json"))
    }

    fn program_file(&self, name: &str) -> PathBuf {
        self.root.join("programs").join(format!("{name}.json"))
    }

    /// A program's user's folder: `C/`, `removed` and `identity`.
    pub fn user(&self, name: &str) -> PathBuf {
        self.root.join("users").join(name)
    }

    /// A layer kept: each blob not kept already, then its manifest.
    pub fn put_layer(&self, layer: &Layer) -> Result<(), String> {
        for (hash, data) in &layer.blobs {
            let file = self.blob_file(hash);

            if !file.is_file() {
                write_whole(&file, data)?;
            }
        }

        write_whole(
            &self.manifest_file(&layer.manifest.id),
            &manifest_text(&layer.manifest)?,
        )
    }

    /// A layer kept, its blobs read and each held to its hash.
    pub fn layer(&self, id: &str) -> Result<Layer, String> {
        let file = self.manifest_file(id);
        let text = std::fs::read(&file).map_err(|error| format!("{}: {error}", file.display()))?;
        let manifest: Manifest = serde_json::from_slice(&text)
            .map_err(|error| format!("{}: {error}", file.display()))?;
        let mut blobs = BTreeMap::new();

        for entry in &manifest.entries {
            if let LayerEntry::File { sha256, .. } = entry
                && !blobs.contains_key(sha256)
            {
                let file = self.blob_file(sha256);
                let data =
                    std::fs::read(&file).map_err(|error| format!("{}: {error}", file.display()))?;

                if sha256_hex(&data) != *sha256 {
                    return Err(format!("{}: not the bytes its name says", file.display()));
                }

                blobs.insert(sha256.clone(), std::rc::Rc::new(data));
            }
        }

        Ok(Layer { manifest, blobs })
    }

    /// A program kept, if it is.
    pub fn program(&self, name: &str) -> Result<Option<Program>, String> {
        check_name(name)?;

        let file = self.program_file(name);

        match std::fs::read(&file) {
            Ok(text) => serde_json::from_slice(&text)
                .map(Some)
                .map_err(|error| format!("{}: {error}", file.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("{}: {error}", file.display())),
        }
    }

    pub fn put_program(&self, program: &Program) -> Result<(), String> {
        check_name(&program.name)?;

        let mut text = serde_json::to_vec_pretty(program).map_err(|error| error.to_string())?;

        text.push(b'\n');
        write_whole(&self.program_file(&program.name), &text)
    }

    /// The programs kept, by name.
    pub fn programs(&self) -> Vec<Program> {
        let mut programs: Vec<Program> = std::fs::read_dir(self.root.join("programs"))
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| serde_json::from_slice(&std::fs::read(entry.path()).ok()?).ok())
            .collect();

        programs.sort_by(|one, other| one.name.cmp(&other.name));
        programs
    }

    /// A program's stack, the base first, refused where the program was
    /// kept on another display or another base -- its layers are bound to
    /// the display they were installed on -- or where its layers may not
    /// be stacked (`stack_refusal`).
    pub fn stack(&self, base: &Base, program: &Program) -> Result<Vec<Layer>, String> {
        if program.display != base.display {
            return Err(format!(
                "{} was installed on the {} display, and its layers are bound to it: run it with --display {}",
                program.name, program.display, program.display
            ));
        }

        if program.base != base.name() {
            return Err(format!(
                "{} was kept on the base {}, not on {}",
                program.name,
                program.base,
                base.name()
            ));
        }

        let mut stack = vec![base.layer.clone()];

        for id in &program.layers {
            stack.push(self.layer(id)?);
        }

        let manifests: Vec<&Manifest> = stack.iter().map(|layer| &layer.manifest).collect();

        match stack_refusal(&manifests) {
            Some(why) => Err(format!("{}'s layers: {why}", program.name)),
            None => Ok(stack),
        }
    }

    /// The layers `HostDrive::layered` puts beneath a stack's top, the
    /// highest first: each layer over the base materialised once into
    /// `layer-<stack id>`, and the base's own folder.
    pub fn lowers(&self, base: &Base, stack: &[Layer]) -> Result<Vec<HostLayer>, String> {
        let mut lowers = vec![HostLayer::new(base.folder.clone())];

        for at in 1..stack.len() {
            lowers.push(materialise(stack, at, &self.root)?);
        }

        lowers.reverse();
        Ok(lowers)
    }

    /// What the program's user's layer was made on.
    pub fn user_layer(&self, program: &Program) -> UserLayer {
        match std::fs::read_to_string(self.user(&program.name).join("identity")) {
            Ok(identity) if identity.trim() == program.identity() => UserLayer::Same,
            Ok(identity) => UserLayer::Other(identity.trim().to_string()),
            Err(_) => UserLayer::New,
        }
    }

    /// The program's user's layer set aside, as it was, in `users-aside`:
    /// where it is now.
    pub fn set_user_aside(&self, name: &str) -> Result<PathBuf, String> {
        let aside = self.root.join("users-aside").join(format!(
            "{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |since| since.as_millis())
        ));
        let failed = |error: std::io::Error| format!("{}: {error}", aside.display());

        std::fs::create_dir_all(aside.parent().unwrap_or(&self.root)).map_err(failed)?;
        std::fs::rename(self.user(name), &aside).map_err(failed)?;
        Ok(aside)
    }

    /// Drive C: of a program: its user's folder over its stack, what it
    /// deletes of the stack kept in `removed` beside the folder from run
    /// to run, and the stack it is on written in `identity`.
    pub fn user_drive(
        &self,
        program: &Program,
        lowers: Vec<HostLayer>,
    ) -> Result<HostDrive, String> {
        let user = self.user(&program.name);
        let failed = |error: std::io::Error| format!("{}: {error}", user.display());

        std::fs::create_dir_all(user.join("C")).map_err(failed)?;
        write_whole(&user.join("identity"), program.identity().as_bytes())?;
        HostDrive::layered(user.join("C"), lowers)
            .keeping_removed(user.join("removed"))
            .map_err(failed)
    }

    /// An installer's run made ready: its media -- a folder, or a zip
    /// archive -- put at `C:\<media folder>` beneath an empty top, in a
    /// folder of `staging` of its own. The installer is `setup` in the
    /// media, else `SETUP.EXE`.
    pub fn stage(&self, name: &str, media: &Path, setup: Option<&str>) -> Result<Staging, String> {
        let folder_name = media_folder(name)?;
        let tree = if media.is_dir() {
            host_tree(media, &folder_name)?
        } else {
            let bytes =
                std::fs::read(media).map_err(|error| format!("{}: {error}", media.display()))?;

            zip_tree(&bytes, &folder_name)?
        };
        let laid = everything(&tree);
        let setup = setup
            .unwrap_or("SETUP.EXE")
            .replace('/', "\\")
            .to_ascii_uppercase();
        let setup = format!("{folder_name}\\{}", setup.trim_start_matches('\\'));

        if !laid
            .iter()
            .any(|change| matches!(change, Change::File { path, .. } if *path == setup))
        {
            return Err(format!(
                "the media have no {}",
                &setup[folder_name.len() + 1..]
            ));
        }

        let folder = self
            .root
            .join("staging")
            .join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);

        write_tree(&laid, &folder.join("media"))?;
        std::fs::create_dir_all(folder.join("C"))
            .map_err(|error| format!("{}: {error}", folder.display()))?;

        Ok(Staging {
            folder,
            media: folder_name,
            setup: format!("C:\\{setup}"),
            laid,
        })
    }

    /// A layer put on a program's stack, at its top: refused where it may
    /// not go there (`stack_refusal`) or is there already; kept, its id
    /// added to the program's, the program's EXEs told again, and the
    /// program kept.
    pub fn add_layer(
        &self,
        program: &mut Program,
        stack: &[Layer],
        layer: &Layer,
    ) -> Result<(), String> {
        if program.layers.contains(&layer.manifest.id) {
            return Err(format!(
                "{} has layer {} already",
                program.name, layer.manifest.id
            ));
        }

        let mut manifests: Vec<&Manifest> = stack.iter().map(|layer| &layer.manifest).collect();

        manifests.push(&layer.manifest);

        if let Some(why) = stack_refusal(&manifests) {
            return Err(format!("the layer may not go on {}: {why}", program.name));
        }

        self.put_layer(layer)?;

        let mut layers = stack[1..].to_vec();

        layers.push(layer.clone());
        program.layers.push(layer.manifest.id.clone());
        program.exes = exes_of(&layers);
        program.kept = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_millis() as u64);
        self.put_program(program)
    }
}

/// Who made a layer here, from what.
fn made_from(from: Option<String>) -> Made {
    Made {
        by: MADE_BY.to_string(),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        from,
    }
}

/// The ids of a stack's layers, the base first: a layer's `over`.
fn ids(stack: &[Layer]) -> Vec<String> {
    stack
        .iter()
        .map(|layer| layer.manifest.id.clone())
        .collect()
}

/// What an installer left in its top, as a layer over the stack it ran
/// on: the drive as it stands told against the stack and the media
/// (`MemoryDrive::changes_from`), and of that, what names the media's
/// folders or deletes their paths dropped, where the stack beneath has no
/// such path -- the media are discarded after installing. A file the
/// installer wrote over one of the media's is its own, and kept. None
/// where it left nothing.
pub fn installed(
    staging: &Staging,
    stack: &[Layer],
    lowers: Vec<HostLayer>,
) -> Result<Option<Layer>, String> {
    let beneath = flatten(stack)?.drive();
    let mut before = beneath.clone();

    before.apply(&staging.laid);

    let after = held(&staging.drive(lowers)?);
    let media: BTreeSet<&str> = staging.laid.iter().map(Change::path).collect();
    let on_stack = |path: &str| {
        let parts = Files::parse(path).parts;

        beneath.is_directory(&parts) || beneath.entry(&parts).is_some()
    };
    let changes: Vec<Change> = after
        .changes_from(&before)
        .into_iter()
        .filter(|change| match change {
            Change::File { .. } => true,
            Change::Folder { path, .. } | Change::Removed { path } => {
                !media.contains(path.as_str()) || on_stack(path)
            }
        })
        .collect();

    if changes.is_empty() {
        return Ok(None);
    }

    Layer::from_changes(&changes, ids(stack), made_from(Some(staging.setup.clone()))).map(Some)
}

/// A layer of the user's own files, laid out in a folder as C: has them,
/// over a program's stack: each file as it stands, with its stamp, and
/// each folder the stack has not, with its. A file the stack has already,
/// bytes and stamp, is left out.
pub fn layer_of_folder(folder: &Path, stack: &[Layer]) -> Result<Layer, String> {
    let beneath = flatten(stack)?.drive();
    let tree = host_tree(folder, "")?;
    let changes: Vec<Change> = everything(&tree)
        .into_iter()
        .filter(|change| {
            let parts = Files::parse(change.path()).parts;

            match change {
                Change::Folder { .. } => !beneath.is_directory(&parts),
                Change::File {
                    path,
                    data,
                    modified,
                } => {
                    !(beneath.data(path).is_some_and(|there| *there == **data)
                        && beneath
                            .entry(&parts)
                            .is_some_and(|entry| seconds_of(entry.modified) == *modified))
                }
                Change::Removed { .. } => true,
            }
        })
        .collect();

    if changes.is_empty() {
        return Err(format!("{}: nothing the stack has not", folder.display()));
    }

    Layer::from_changes(
        &changes,
        ids(stack),
        made_from(
            folder
                .file_name()
                .map(|name| name.to_string_lossy().to_string()),
        ),
    )
}

/// The file `--drive DIR`'s deletes of what is beneath it are kept in,
/// from run to run: in the cache folder, `drives/<sha256 of DIR's full
/// path>.removed`, outside the drive, as `HostDrive::keeping_removed` must
/// have it.
pub fn drive_removed(cache: &Path, drive: &Path) -> PathBuf {
    let full = std::fs::canonicalize(drive).unwrap_or_else(|_| drive.to_path_buf());

    cache.join("drives").join(format!(
        "{}.removed",
        sha256_hex(full.to_string_lossy().as_bytes())
    ))
}

#[cfg(test)]
mod tests;
