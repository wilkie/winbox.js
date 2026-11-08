//! The library (`kb/formats/library.md`, `kb/guides/launcher.md`, step 5):
//! the folder the native front end keeps its programs in, by the host's
//! convention for an application's data -- `%APPDATA%\WinBox` on Windows,
//! `~/Library/Application Support/WinBox` on macOS, `$XDG_DATA_HOME/winbox`
//! or `~/.local/share/winbox` elsewhere -- or the one `--library` names.
//!
//! It is the store of `programs.rs` (blobs, layers, a record a program,
//! each stack's layers materialised, each program's user's layer, an
//! installer's staging), and beside it `bases.json`: where on the host each
//! base a program was kept on was last read from, so that a program's items
//! are listed and run without `--assets` or `--windows` given again.
//!
//! What a launcher lists of it, and what `--launch` runs, are each kept
//! program's groups as `launch_groups` lists them (`launch.rs` of
//! `winbox-win16`, the page's `launchGroups`), read on its whole stack --
//! its base, then its layers -- with each item's icon from its group file's
//! bits, and each item that cannot run given why, in the page's words
//! (`src/run/page/view.ts`, `launcherView`).

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use winbox_win16::assets::Assets;
use winbox_win16::groups::{Icon, groups_from, program_files};
use winbox_win16::launch::{FlatFiles, KeptStack, LaunchItem, stack_groups};
use winbox_win16::layers::{Flat, flatten};

use crate::programs::{Base, Program, Store};

/// The mode a program is kept for where its record names none: Windows'
/// standard mode, the one the engines run.
pub const STANDARD: &str = "standard";

/// The Windows directory, current where an item's working directory is
/// not there (`PROGMAN.EXE` seg5 `03f5`), as the page's launcher has it.
pub const WINDOWS: &str = "C:\\WINDOWS";

/// What the launcher says where nothing is kept: the page's
/// `LAUNCHER_EMPTY`, told how the native front end keeps one.
pub const EMPTY: &str = "No programs are kept yet. Install one with --install NAME MEDIA --keep, and its groups are listed here.";

/// The host's folder for an application's data, by its convention, with
/// `WinBox` (or `winbox`, on hosts whose folders are lower case) in it.
pub fn default_folder() -> PathBuf {
    let home = || std::env::var_os("HOME").map(PathBuf::from);

    if cfg!(windows) {
        std::env::var_os("APPDATA")
            .map_or_else(std::env::temp_dir, PathBuf::from)
            .join("WinBox")
    } else if cfg!(target_os = "macos") {
        home()
            .unwrap_or_else(std::env::temp_dir)
            .join("Library")
            .join("Application Support")
            .join("WinBox")
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|folder| folder.is_absolute())
            .or_else(|| home().map(|home| home.join(".local").join("share")))
            .unwrap_or_else(std::env::temp_dir)
            .join("winbox")
    }
}

/// The library's folder: the one given, else the host's.
pub fn folder(given: Option<&Path>) -> PathBuf {
    given.map_or_else(default_folder, Path::to_path_buf)
}

/// Where a base was read from on the host: the asset bundle, or an
/// installation's folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Assets(PathBuf),
    Windows(PathBuf),
}

impl Source {
    /// The switch that gives it, and its path: `--assets`, `--windows`.
    pub fn arguments(&self) -> [String; 2] {
        match self {
            Self::Assets(path) => ["--assets".to_string(), path.display().to_string()],
            Self::Windows(path) => ["--windows".to_string(), path.display().to_string()],
        }
    }
}

fn bases_file(store: &Store) -> PathBuf {
    store.root.join("bases.json")
}

/// Each base's name -- `base:<assets id>:<display>`, `folder:<id>` -- and
/// where it was last read from.
pub fn bases(store: &Store) -> BTreeMap<String, Source> {
    std::fs::read(bases_file(store))
        .ok()
        .and_then(|text| serde_json::from_slice(&text).ok())
        .unwrap_or_default()
}

/// Where a base was read from, remembered, its path made whole.
pub fn remember_base(store: &Store, name: &str, source: &Source) -> Result<(), String> {
    // Windows' whole paths come back verbatim, `\\?\C:\...`: a drive's path
    // is kept as a person writes it.
    let whole = |path: &Path| {
        let full = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let text = full.to_string_lossy();

        match text.strip_prefix(r"\\?\") {
            Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
            _ => full,
        }
    };
    let source = match source {
        Source::Assets(path) => Source::Assets(whole(path)),
        Source::Windows(path) => Source::Windows(whole(path)),
    };
    let mut known = bases(store);

    if known.get(name) == Some(&source) {
        return Ok(());
    }

    known.insert(name.to_string(), source);

    let mut text = serde_json::to_vec_pretty(&known).map_err(|error| error.to_string())?;

    text.push(b'\n');
    std::fs::create_dir_all(&store.root)
        .map_err(|error| format!("{}: {error}", store.root.display()))?;

    let file = bases_file(store);
    let staged = file.with_extension(format!("new-{}", std::process::id()));

    std::fs::write(&staged, &text).map_err(|error| format!("{}: {error}", staged.display()))?;
    std::fs::rename(&staged, &file).map_err(|error| format!("{}: {error}", file.display()))
}

/// The asset bundle at `path`, where it serves the display.
pub fn open_assets(path: &Path, display: &str) -> Result<Assets, String> {
    let assets = Assets::open(path)?;

    if !assets.displays.iter().any(|served| served == display) {
        return Err(format!(
            "it serves the displays {}, not {display}",
            assets.displays.join(", ")
        ));
    }

    Ok(assets)
}

/// A base read from where it is on the host, for a display: the asset
/// bundle's (its base written once into `cache`) with the bundle, or an
/// installation's folder.
pub fn open_base(
    source: &Source,
    display: &str,
    cache: &Path,
) -> Result<(Base, Option<Assets>), String> {
    match source {
        Source::Assets(path) => {
            let assets =
                open_assets(path, display).map_err(|error| format!("the asset bundle: {error}"))?;
            let base = Base::of_assets(&assets, display, cache)?;

            Ok((base, Some(assets)))
        }
        Source::Windows(path) => Ok((Base::of_folder(path, display)?, None)),
    }
}

/// A note where programs were kept before the library, in the cache
/// folder's `winbox` (`programs/` there), and the library has none: they
/// are not moved, only told of, with how they map.
pub fn earlier(store: &Store, cache: &Path) -> Option<String> {
    let names = |root: &Path| -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(root.join("programs"))
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .strip_suffix(".json")
                    .map(str::to_string)
            })
            .collect();

        names.sort();
        names
    };

    if cache == store.root || !names(&store.root).is_empty() {
        return None;
    }

    let before = names(cache);

    (!before.is_empty()).then(|| {
        format!(
            "{} kept before the library, in {}, are not in it, {}: move its blobs, layers, programs and users folders into the library to keep them (its layer-* folders are made again), or give --library {}",
            before.join(", "),
            cache.display(),
            store.root.display(),
            cache.display()
        )
    })
}

/// Bytes as text, a character a byte, as Program Manager's strings are.
pub fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&byte| char::from(byte)).collect()
}

/// Text as bytes, a byte a character; a character past one byte as `?`.
pub fn bytes_of(text: &str) -> Vec<u8> {
    text.chars()
        .map(|c| u8::try_from(u32::from(c)).unwrap_or(b'?'))
        .collect()
}

/// Whether a file is a Windows program: a New Executable's header where
/// the old one says (`kindOf`, `src/run/drive.ts`).
pub fn is_windows_program(data: &[u8]) -> bool {
    if data.len() < 0x40 || !data.starts_with(b"MZ") {
        return false;
    }

    let header = u32::from_le_bytes([data[0x3c], data[0x3d], data[0x3e], data[0x3f]]) as usize;

    header > 0 && header + 1 < data.len() && &data[header..header + 2] == b"NE"
}

/// An item as the launcher lists it and `--launch` runs it.
#[derive(Debug, Clone)]
pub struct Item {
    pub launch: LaunchItem,
    /// Its icon, from its group file's bits.
    pub icon: Option<Icon>,
    /// Why it cannot run, where it cannot.
    pub reason: Option<String>,
}

impl Item {
    pub fn name(&self) -> String {
        latin1(&self.launch.name)
    }
}

/// A group as the launcher lists it.
#[derive(Debug, Clone)]
pub struct Group {
    /// Its name, and its install's where another install's group has it
    /// too: `Accessories (Maxis)`.
    pub label: String,
    pub name: String,
    /// The kept program whose install made it.
    pub install: String,
    /// What is said of it where it has no items to list: why Program
    /// Manager would not load it, or that it has none.
    pub note: Option<String>,
    pub items: Vec<Item>,
}

/// A kept program's stack, as far as it is here: its whole stack flattened
/// where its base is, else its own layers over nothing; and why it cannot
/// run, where it cannot as a whole.
struct Read {
    flat: Flat,
    own: BTreeSet<String>,
    unrunnable: Option<String>,
}

/// A base read, with the asset bundle it was read from, where it was.
pub type Opened = (Base, Option<std::rc::Rc<Assets>>);

/// What the launcher is given of a library: the programs kept, the bases
/// they are on, read once each, and what gives them where the library
/// does not know.
#[derive(Debug)]
pub struct Reader<'a> {
    pub store: &'a Store,
    /// The cache folder an asset bundle's base is written into.
    pub cache: PathBuf,
    /// A base given on the command line, used for every program on it.
    pub given: Option<Source>,
    /// Whether the build runs a program kept for a mode other than the
    /// standard one.
    pub modes: bool,
    bases: BTreeMap<String, Option<Opened>>,
}

impl<'a> Reader<'a> {
    pub fn new(store: &'a Store, cache: PathBuf, given: Option<Source>) -> Self {
        Self {
            store,
            cache,
            given,
            modes: false,
            bases: BTreeMap::new(),
        }
    }

    /// A program's base, read already, used for it and every program on it.
    pub fn known(&mut self, program: &Program, base: Base) {
        self.bases.insert(
            format!("{}\n{}", program.base, program.display),
            Some((base, None)),
        );
    }

    /// A program's base, as the library or the command line gives it, read
    /// once for every program on it; none where it is not here.
    pub fn base(&mut self, program: &Program) -> Option<Opened> {
        let key = format!("{}\n{}", program.base, program.display);

        if let Some(read) = self.bases.get(&key) {
            return read.clone();
        }

        let known = bases(self.store);
        let read = self
            .given
            .iter()
            .chain(known.get(&program.base))
            .find_map(|source| {
                open_base(source, &program.display, &self.cache)
                    .ok()
                    .filter(|(base, _)| base.name() == program.base)
            })
            .map(|(base, assets)| (base, assets.map(std::rc::Rc::new)));

        self.bases.insert(key, read.clone());
        read
    }

    fn read(&mut self, program: &Program) -> Result<Read, String> {
        let layers = program
            .layers
            .iter()
            .map(|id| self.store.layer(id))
            .collect::<Result<Vec<_>, _>>()?;
        let own: BTreeSet<String> = program_files(&layers)?
            .files
            .into_iter()
            .map(|file| file.path)
            .collect();
        let based = self.base(program);
        let mode = (!self.modes && program.mode != STANDARD).then(|| {
            format!(
                "{} was kept for Windows' {} mode, which this build does not run",
                program.name, program.mode
            )
        });

        match based {
            Some((base, _)) => {
                let stack = self.store.stack(&base, program)?;

                Ok(Read {
                    flat: flatten(&stack)?,
                    own,
                    unrunnable: mode,
                })
            }
            None => Ok(Read {
                flat: program_files(&layers)?,
                own,
                unrunnable: Some(mode.unwrap_or_else(|| {
                    format!("{} was made on a Windows that is not here", program.name)
                })),
            }),
        }
    }

    /// A kept program's groups, as the launcher lists them, each label its
    /// group's name alone; or why its layers could not be read.
    pub fn groups(&mut self, program: &Program) -> Result<Vec<Group>, String> {
        let read = self.read(program)?;
        let files = FlatFiles::new(&read.flat, read.own.iter().cloned());
        let stack = KeptStack {
            name: bytes_of(&program.name),
            files: &files,
            exes: program.exes.iter().map(|exe| bytes_of(exe)).collect(),
            path: Vec::new(),
        };
        let data: BTreeMap<&str, &[u8]> = read
            .flat
            .files
            .iter()
            .map(|file| (file.path.as_str(), file.data.as_slice()))
            .collect();
        let loaded: BTreeMap<Option<String>, Option<winbox_win16::groups::Group>> =
            groups_from(|path| data.get(path).copied())
                .groups
                .into_iter()
                .map(|group| (group.file, group.group))
                .collect();

        Ok(stack_groups(&stack)
            .into_iter()
            .map(|group| {
                let icons = loaded.get(&group.file).and_then(Option::as_ref);
                let name = latin1(&group.name);
                let items: Vec<Item> = group
                    .items
                    .iter()
                    .enumerate()
                    .map(|(at, item)| {
                        let dos = item.run.program.as_deref().and_then(|program| {
                            let path = latin1(program.get(3..).unwrap_or_default());

                            data.get(path.as_str())
                                .filter(|bytes| !is_windows_program(bytes))
                                .map(|_| latin1(program))
                        });

                        Item {
                            launch: item.clone(),
                            icon: icons
                                .and_then(|loaded| loaded.items.get(at))
                                .and_then(|item| item.icon.clone()),
                            reason: read
                                .unrunnable
                                .clone()
                                .or_else(|| item.run.reason.clone())
                                .or_else(|| {
                                    dos.map(|path| {
                                        format!("{path} is a DOS program, which is not run here")
                                    })
                                }),
                        }
                    })
                    .collect();

                Group {
                    label: name.clone(),
                    name,
                    install: program.name.clone(),
                    note: match &group.refusal {
                        Some(refusal) => {
                            Some(format!("Program Manager would not load it: {refusal}"))
                        }
                        None if items.is_empty() => Some("No items".to_string()),
                        None => None,
                    },
                    items,
                }
            })
            .collect())
    }

    /// Every kept program's groups, as the launcher lists them: in the
    /// programs' order, a group whose name another install's group has too
    /// labelled with its install's; or what is said where nothing is kept.
    pub fn launcher(&mut self) -> (Vec<Group>, Option<String>) {
        let programs = self.store.programs();

        if programs.is_empty() {
            return (Vec::new(), Some(EMPTY.to_string()));
        }

        let mut groups = Vec::new();

        for program in &programs {
            match self.groups(program) {
                Ok(read) => groups.extend(read),
                Err(error) => groups.push(Group {
                    label: program.name.clone(),
                    name: program.name.clone(),
                    install: program.name.clone(),
                    note: Some(format!("Its layers could not be read: {error}")),
                    items: Vec::new(),
                }),
            }
        }

        let mut installs: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

        for group in &groups {
            installs
                .entry(group.name.clone())
                .or_default()
                .insert(group.install.clone());
        }

        for group in &mut groups {
            if installs.get(&group.name).is_some_and(|set| set.len() > 1) {
                group.label = format!("{} ({})", group.name, group.install);
            }
        }

        (groups, None)
    }
}

/// An item of a program's groups by its name -- and its group's, where
/// given -- each matched as Windows matches names, its case aside: the
/// first in the groups' order; refused where it is not there, or where
/// several groups have it and none is named.
pub fn find<'g>(groups: &'g [Group], item: &str, group: Option<&str>) -> Result<&'g Item, String> {
    let same = |one: &str, other: &str| one.eq_ignore_ascii_case(other);
    let found: Vec<(&Group, &Item)> = groups
        .iter()
        .filter(|one| group.is_none_or(|name| same(&one.name, name)))
        .flat_map(|one| {
            one.items
                .iter()
                .filter(|candidate| same(&candidate.name(), item))
                .map(move |candidate| (one, candidate))
        })
        .collect();
    let in_groups: BTreeSet<&str> = found.iter().map(|(one, _)| one.name.as_str()).collect();

    match found.first() {
        None => {
            let items: Vec<String> = groups
                .iter()
                .flat_map(|one| {
                    one.items
                        .iter()
                        .map(move |item| format!("{}: {}", one.name, item.name()))
                })
                .collect();

            Err(format!(
                "no item {item}{}; its items: {}",
                group.map_or_else(String::new, |group| format!(" in a group {group}")),
                if items.is_empty() {
                    "none".to_string()
                } else {
                    items.join(", ")
                }
            ))
        }
        Some(_) if group.is_none() && in_groups.len() > 1 => Err(format!(
            "{item} is in the groups {}: name one with --group",
            in_groups.into_iter().collect::<Vec<_>>().join(", ")
        )),
        Some((_, item)) => Ok(item),
    }
}

/// What an item's program is started with, as the page's launcher starts
/// it (`src/run/page/launcher.ts`): the program found for its command, the
/// rest of the command line, the working directory made upper case as the
/// current directory -- the Windows directory where it has none or it is
/// not there -- and its show command, 7 minimized, else 1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Start {
    pub path: String,
    pub command_line: String,
    pub directory: String,
    pub show: u16,
    /// Whether the item's working directory is not there, and the Windows
    /// directory taken in its place.
    pub directory_missing: bool,
}

/// An item's start, or why it cannot run.
pub fn start_of(item: &Item) -> Result<Start, String> {
    if let Some(reason) = &item.reason {
        return Err(format!("{} cannot be run: {reason}.", item.name()));
    }

    let run = &item.launch.run;
    let path = run
        .program
        .as_deref()
        .ok_or_else(|| format!("{} cannot be run: its program is not found.", item.name()))?;

    Ok(Start {
        path: latin1(path),
        command_line: latin1(&run.command_line),
        directory: if !run.directory.is_empty() && run.directory_there {
            latin1(&run.directory)
        } else {
            WINDOWS.to_string()
        },
        show: run.show,
        directory_missing: !run.directory_there,
    })
}

/// A program started on a system as a group's item is started, the first
/// program of its run (as `Session::start_item` starts the first, in
/// `winbox-web`): read from where C: and the drives of images have it,
/// refused where it is not a Windows program; loaded, linked and given the
/// item's command line and show command; the item's directory made
/// current, its drive's letter first.
pub fn start_item(system: &mut winbox_win16::System, start: &Start) -> Result<(), String> {
    let (folder, name) = start
        .path
        .rsplit_once('\\')
        .ok_or_else(|| format!("{}: not a path", start.path))?;
    let (_, bytes) = system
        .files
        .read_from(folder, name)
        .ok_or_else(|| format!("{}: not there", start.path))?;

    if !is_windows_program(&bytes) {
        return Err(format!(
            "{} is a DOS program, which is not run here.",
            start.path
        ));
    }

    let executable = winbox_ne::Executable::parse(bytes)
        .map_err(|error| format!("{}: {error:?}", start.path))?;
    let (program, libraries) = system.load(executable, &start.path);

    system.link(program);
    system
        .start_with(program, libraries, &start.command_line, start.show, 0, None)
        .map_err(|exit| format!("the program's registers: {exit:?}"))?;

    if let Some(drive) = start
        .directory
        .chars()
        .next()
        .filter(|_| start.directory.len() > 1)
    {
        system.files.drive = drive.to_ascii_uppercase();
        system.files.set_path(&start.directory);
    }

    Ok(())
}

#[cfg(test)]
pub(crate) mod tests;
