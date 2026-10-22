//! The base of drive C: for a display, composed from the asset bundle's
//! pool as Windows 3.1's Setup laid it out on the oracle's installation for
//! that display (`data/setup.json`, written by
//! `scripts/assets/survey-installs.mjs`): the fonts and data files where
//! Setup put them, `WIN.INI` and `SYSTEM.INI` as Setup wrote them, and
//! `REG.DAT` made from `SETUP.REG` as Setup makes it.
//!
//! The TypeScript engine's twin is `src/assets/compose.ts`; the two give
//! the same placements, byte for byte (`tests/asset_compose.rs` and
//! `test/assets/compose_test.ts` hold both to one listing).
//!
//! Only data: no code of Windows' is placed. The bundle's modules are not
//! files on C: at all.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::Deserialize;

use crate::shell::reg_api::{Mode, find_in, put_value};
use crate::shell::registry::{HKEY_CLASSES_ROOT, RegistryDatabase};

/// When the files WinBox writes were last written: the stamp the page's
/// FAT16 volume gives everything it makes (`src/run/drive.ts`), 10:20:40
/// on 6 January 2020, local time read as universal.
pub const STAMP: i64 = 1_578_306_040;

/// A pool file, with the DOS date and time of the file on the disk it came
/// from.
#[derive(Debug, Clone)]
pub struct PoolFile {
    pub data: Vec<u8>,
    pub date: u16,
    pub time: u16,
}

/// A file put on C:, its path below the root with `/`, and when it was last
/// written: seconds since 1970, local time read as universal, as DOS keeps
/// it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Placement {
    pub path: String,
    pub data: Vec<u8>,
    pub modified: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Composed {
    /// The folders, made whether or not anything is placed in them.
    pub directories: Vec<String>,
    /// Sorted by path.
    pub files: Vec<Placement>,
}

#[derive(Debug, Deserialize)]
struct Setup {
    displays: BTreeMap<String, SetupDisplay>,
    profiles: BTreeMap<String, SetupProfile>,
}

#[derive(Debug, Deserialize)]
struct SetupDisplay {
    directories: Vec<String>,
    files: Vec<(String, String)>,
    profiles: BTreeMap<String, String>,
    registry: Option<SetupRegistry>,
}

#[derive(Debug, Deserialize)]
struct SetupRegistry {
    path: String,
    script: String,
}

#[derive(Debug, Deserialize)]
struct SetupProfile {
    end: String,
    lines: Vec<(String, String)>,
}

fn setup() -> &'static Setup {
    static SETUP: OnceLock<Setup> = OnceLock::new();

    SETUP.get_or_init(|| {
        serde_json::from_str(include_str!("../data/setup.json")).expect("the setup survey")
    })
}

/// The display modes there is a composition for.
pub fn composed_displays() -> Vec<String> {
    setup().displays.keys().cloned().collect()
}

/// Days from 1 January 1970 to a date of the proleptic Gregorian calendar.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let of_era = year - era * 400;
    let of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let of_cycle = of_era * 365 + of_era / 4 - of_era / 100 + of_year;

    era * 146_097 + of_cycle - 719_468
}

/// A DOS date and time as seconds since 1970, local time read as universal.
pub fn dos_seconds(date: u16, time: u16) -> i64 {
    let days = days_from_civil(
        1980 + i64::from(date >> 9),
        i64::from((date >> 5) & 0x0f),
        i64::from(date & 0x1f),
    );

    days * 86_400
        + i64::from(time >> 11) * 3600
        + i64::from((time >> 5) & 0x3f) * 60
        + i64::from(time & 0x1f) * 2
}

/// A profile's text, line for line as Setup wrote it; none for a name the
/// survey has not.
pub fn profile_text(key: &str) -> Option<Vec<u8>> {
    let profile = setup().profiles.get(key)?;
    let text = profile
        .lines
        .iter()
        .map(|(line, _)| line.as_str())
        .collect::<Vec<_>>()
        .join("\r\n")
        + &profile.end;

    Some(text.chars().map(|character| character as u8).collect())
}

/// The prefixes of `REGEDIT`'s table at DS:00C6, in its order, and the
/// handle each stands for.
const PREFIXES: [(&[u8], u32); 2] = [
    (b"HKEY_CLASSES_ROOT\\", HKEY_CLASSES_ROOT),
    (b"\\.classes\\", HKEY_CLASSES_ROOT),
];

/// A script's lines put into a database, as `REGEDIT /S` puts them.
///
/// **Read out of `REGEDIT.EXE`** seg1: `HKEY_CLASSES_ROOT` opened with
/// `RegCreateKey` (SHELL 2) at `4357`-`4364` and held open while the
/// script is read, so the database is written once, at the end (`442d`);
/// each line held to the prefixes in turn by USER's `lstrcmp` of its first
/// characters (`4370`-`43be`), a line with neither passed over; the key the
/// text after the prefix up to the first space, then the spaces passed
/// over, an `=` and the one space after it, and the value the rest of the
/// line (`43c0`-`440e`); and `RegSetValue` (SHELL 5) of the key, `REG_SZ`,
/// the value (`0010`, through `[0036]` at `0077`).
pub fn regedit_import(db: &mut RegistryDatabase, script: &[u8]) {
    // A database that will not take the key has no `.classes`: nothing
    // else to put in either.
    let _ = find_in(db, HKEY_CLASSES_ROOT, None, Mode::Create);

    for raw in script.split(|&byte| byte == b'\n') {
        let line = raw.strip_suffix(b"\r").unwrap_or(raw);
        let Some((prefix, hkey)) = PREFIXES.iter().find(|(prefix, _)| line.starts_with(prefix))
        else {
            continue;
        };
        let rest = &line[prefix.len()..];
        let space = rest.iter().position(|&byte| byte == b' ');
        let key = &rest[..space.unwrap_or(rest.len())];
        let mut at = space.unwrap_or(rest.len());

        while rest.get(at) == Some(&b' ') {
            at += 1;
        }

        if rest.get(at) == Some(&b'=') {
            at += 1;

            if rest.get(at) == Some(&b' ') {
                at += 1;
            }
        }

        if let Ok(entry) = find_in(db, *hkey, Some(key), Mode::Create) {
            put_value(db, entry, &rest[at..]);
        }
    }
}

/// The `REG.DAT` a script makes from nothing: SHELL's empty database, the
/// script put in, written.
pub fn reg_dat_from(script: &[u8]) -> Vec<u8> {
    let mut db = RegistryDatabase::empty();

    regedit_import(&mut db, script);
    db.serialize()
}

/// What goes on C: for a display, from the pool's files by name.
///
/// # Errors
///
/// A display there is no composition for, or a pool file the bundle lacks.
pub fn compose(pool: &dyn Fn(&str) -> Option<PoolFile>, display: &str) -> Result<Composed, String> {
    let setup = setup();
    let layout = setup
        .displays
        .get(display)
        .ok_or_else(|| format!("no composition for the display {display}"))?;
    let take =
        |name: &str| pool(name).ok_or_else(|| format!("{name} is not in the asset bundle's pool"));
    let mut files = Vec::new();

    for (path, _) in &layout.files {
        let name = path.rsplit('/').next().unwrap_or(path);
        let file = take(name)?;

        files.push(Placement {
            path: path.clone(),
            modified: dos_seconds(file.date, file.time),
            data: file.data,
        });
    }

    for (path, key) in &layout.profiles {
        files.push(Placement {
            path: path.clone(),
            data: profile_text(key).ok_or_else(|| format!("no profile {key}"))?,
            modified: STAMP,
        });
    }

    if let Some(registry) = &layout.registry {
        files.push(Placement {
            path: registry.path.clone(),
            data: reg_dat_from(&take(&registry.script)?.data),
            modified: STAMP,
        });
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(Composed {
        directories: layout.directories.clone(),
        files,
    })
}

/// The asset bundle's manifest's format this engine reads.
pub const FORMAT: u64 = 1;

/// An asset bundle, read: its pool of files, and its modules -- `USER.EXE`,
/// `SHELL.DLL` and the display drivers, their code taken out -- the store
/// the kept modules' resources are read from where C: has no file of
/// theirs (`System::kept_file`). `kb/topics/asset-bundle.md`.
#[derive(Debug, Clone, Default)]
pub struct Assets {
    /// The bundle's id: the sha256 of its files' sha256s.
    pub id: String,
    /// The display modes it serves.
    pub displays: Vec<String>,
    /// The pool's files, by their names, upper case.
    pub pool: BTreeMap<String, PoolFile>,
    /// The modules' files, by their names, upper case.
    pub modules: BTreeMap<String, Vec<u8>>,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    format: u64,
    id: String,
    #[serde(default)]
    displays: Vec<String>,
    files: Vec<ManifestFile>,
}

#[derive(Debug, Deserialize)]
struct ManifestFile {
    path: String,
    size: usize,
    #[serde(default)]
    date: u16,
    #[serde(default)]
    time: u16,
}

/// The name of the manifest, at the bundle's root.
const MANIFEST: &str = "winbox-assets.json";

/// The entries of a zip archive of stored entries, as the maker writes the
/// bundle (`src/assets/zip.ts`): their data by their paths. An entry that
/// is compressed is refused.
///
/// # Errors
///
/// What is not such an archive.
pub fn stored_zip_entries(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let short = || "a zip archive cut short".to_string();
    let word = |at: usize| {
        bytes
            .get(at..at + 2)
            .map(|b| usize::from(u16::from_le_bytes([b[0], b[1]])))
            .ok_or_else(short)
    };
    let dword = |at: usize| {
        bytes
            .get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
            .ok_or_else(short)
    };
    // The end record: 22 bytes, after the entries and before a comment of
    // up to 65,535.
    let end = (0..=bytes.len().saturating_sub(22))
        .rev()
        .take(65_536)
        .find(|&at| bytes[at..].starts_with(&[0x50, 0x4b, 0x05, 0x06]))
        .ok_or_else(|| "not a zip archive".to_string())?;
    let count = word(end + 10)?;
    let mut at = dword(end + 16)?;
    let mut entries = BTreeMap::new();

    for _ in 0..count {
        if dword(at)? != 0x0201_4b50 {
            return Err("a zip archive's directory broken".to_string());
        }

        let method = word(at + 10)?;
        let size = dword(at + 20)?;
        let stored = dword(at + 24)?;
        let name_length = word(at + 28)?;
        let local = dword(at + 42)?;
        let name: String = bytes
            .get(at + 46..at + 46 + name_length)
            .ok_or_else(short)?
            .iter()
            .map(|&byte| char::from(byte))
            .collect();

        if method != 0 || size != stored {
            return Err(format!(
                "{name} is compressed: the bundle's entries are stored"
            ));
        }

        if dword(local)? != 0x0403_4b50 {
            return Err(format!("{name}: no local header"));
        }

        let data_at = local + 30 + word(local + 26)? + word(local + 28)?;
        let data = bytes.get(data_at..data_at + size).ok_or_else(short)?;

        if !name.ends_with('/') {
            entries.insert(name, data.to_vec());
        }

        at += 46 + name_length + word(at + 30)? + word(at + 32)?;
    }

    Ok(entries)
}

/// Zip's CRC-32 of an entry's data.
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;

    for &byte in data {
        crc ^= u32::from(byte);

        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                0xedb8_8320 ^ (crc >> 1)
            } else {
                crc >> 1
            };
        }
    }

    !crc
}

/// An entry of a zip archive of stored entries: its path, its data, and
/// the DOS date and time words.
#[derive(Debug, Clone)]
pub struct StoredEntry<'a> {
    pub path: &'a str,
    pub data: &'a [u8],
    pub date: u16,
    pub time: u16,
}

/// A zip archive of stored entries -- no compression -- as the
/// TypeScript engine's `writeStoredZip` (`src/assets/zip.ts`) writes one,
/// byte for byte: each entry a local header, the name and the data; then
/// the central directory and the end record. No extra fields, no
/// comments, names in ASCII.
///
/// # Errors
///
/// More entries or bytes than a zip without zip64 holds.
pub fn write_stored_zip(entries: &[StoredEntry]) -> Result<Vec<u8>, String> {
    let too_many = || "too many files for a zip archive without zip64".to_string();
    let count = u16::try_from(entries.len()).map_err(|_| too_many())?;
    let mut out = Vec::new();
    let mut central = Vec::new();

    for entry in entries {
        let name = entry.path.as_bytes();
        let crc = crc32(entry.data);
        let size = u32::try_from(entry.data.len()).map_err(|_| too_many())?;
        let name_length = u16::try_from(name.len()).map_err(|_| too_many())?;
        let offset = u32::try_from(out.len()).map_err(|_| too_many())?;

        out.extend_from_slice(&0x0403_4b50_u32.to_le_bytes());
        out.extend_from_slice(&10u16.to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&entry.time.to_le_bytes());
        out.extend_from_slice(&entry.date.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&name_length.to_le_bytes());
        out.extend_from_slice(&[0; 2]);
        out.extend_from_slice(name);
        out.extend_from_slice(entry.data);

        central.extend_from_slice(&0x0201_4b50_u32.to_le_bytes());
        central.extend_from_slice(&10u16.to_le_bytes());
        central.extend_from_slice(&10u16.to_le_bytes());
        central.extend_from_slice(&[0; 4]);
        central.extend_from_slice(&entry.time.to_le_bytes());
        central.extend_from_slice(&entry.date.to_le_bytes());
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&name_length.to_le_bytes());
        central.extend_from_slice(&[0; 12]);
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name);
    }

    let at = u32::try_from(out.len()).map_err(|_| too_many())?;
    let central_size = u32::try_from(central.len()).map_err(|_| too_many())?;

    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50_u32.to_le_bytes());
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&central_size.to_le_bytes());
    out.extend_from_slice(&at.to_le_bytes());
    out.extend_from_slice(&[0; 2]);

    Ok(out)
}

impl Assets {
    /// A bundle from its files by their paths in it, the manifest among
    /// them.
    ///
    /// # Errors
    ///
    /// No manifest, a format this engine does not know, or a file the
    /// manifest names missing or of another size.
    pub fn from_files(read: &dyn Fn(&str) -> Option<Vec<u8>>) -> Result<Self, String> {
        let manifest =
            read(MANIFEST).ok_or_else(|| format!("no {MANIFEST}: not an asset bundle"))?;
        let manifest: Manifest =
            serde_json::from_slice(&manifest).map_err(|error| format!("{MANIFEST}: {error}"))?;

        if manifest.format != FORMAT {
            return Err(format!(
                "an asset bundle of format {}: this WinBox reads {FORMAT}",
                manifest.format
            ));
        }

        let mut assets = Self {
            id: manifest.id,
            displays: manifest.displays,
            ..Self::default()
        };

        for file in manifest.files {
            let data = read(&file.path).ok_or_else(|| format!("{} is missing", file.path))?;

            if data.len() != file.size {
                return Err(format!("{} is not the size the manifest says", file.path));
            }

            if let Some(name) = file.path.strip_prefix("pool/") {
                assets.pool.insert(
                    name.to_ascii_uppercase(),
                    PoolFile {
                        data,
                        date: file.date,
                        time: file.time,
                    },
                );
            } else if let Some(name) = file.path.strip_prefix("modules/") {
                assets.modules.insert(name.to_ascii_uppercase(), data);
            }
        }

        Ok(assets)
    }

    /// A bundle from `winbox-assets.zip`'s bytes.
    ///
    /// # Errors
    ///
    /// As `stored_zip_entries` and `from_files`.
    pub fn from_zip(bytes: &[u8]) -> Result<Self, String> {
        let entries = stored_zip_entries(bytes)?;

        Self::from_files(&|path| entries.get(path).cloned())
    }

    /// A bundle from a file, `winbox-assets.zip`, or a folder it was
    /// unpacked into.
    ///
    /// # Errors
    ///
    /// What cannot be read, and as `from_zip` and `from_files`.
    pub fn open(path: &Path) -> Result<Self, String> {
        if path.is_dir() {
            Self::from_files(&|name| std::fs::read(path.join(name)).ok())
        } else {
            let bytes =
                std::fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;

            Self::from_zip(&bytes)
        }
    }

    /// A module's file by its name, `VGA.DRV`; none where the bundle has
    /// none.
    pub fn module(&self, name: &str) -> Option<&[u8]> {
        self.modules
            .get(&name.to_ascii_uppercase())
            .map(Vec::as_slice)
    }

    /// A module's file put in the store, as the page hands one over.
    pub fn add_module(&mut self, name: &str, bytes: Vec<u8>) {
        self.modules.insert(name.to_ascii_uppercase(), bytes);
    }

    /// The base of C: for a display, from the bundle's pool.
    ///
    /// # Errors
    ///
    /// As `compose`.
    pub fn compose(&self, display: &str) -> Result<Composed, String> {
        compose(
            &|name: &str| self.pool.get(&name.to_ascii_uppercase()).cloned(),
            display,
        )
    }

    /// The base of C: for a display, written into the folder
    /// `base-<id>-<display>` of `cache` once: where it is there already,
    /// it is taken as it is. Written beside and renamed into place, so a
    /// run beside another never finds half of one.
    ///
    /// # Errors
    ///
    /// As `compose`, and what cannot be written.
    pub fn base_in(&self, cache: &Path, display: &str) -> Result<PathBuf, String> {
        static MADE: AtomicUsize = AtomicUsize::new(0);
        let folder = cache.join(format!("base-{}-{display}", self.id));

        if folder.is_dir() {
            return Ok(folder);
        }

        let composed = self.compose(display)?;
        let building = cache.join(format!(
            ".base-{}-{display}-{}-{}",
            self.id,
            std::process::id(),
            MADE.fetch_add(1, Ordering::Relaxed)
        ));

        write_base(&composed, &building)
            .map_err(|error| format!("{}: {error}", building.display()))?;

        if std::fs::rename(&building, &folder).is_err() {
            // Another run made it first.
            let _ = std::fs::remove_dir_all(&building);

            if !folder.is_dir() {
                return Err(format!("{}: could not be made", folder.display()));
            }
        }

        Ok(folder)
    }
}

/// A host's file or folder last written at seconds since 1970, local time
/// read as universal, as a host drive reads it back.
pub fn set_written(path: &Path, seconds: i64) -> std::io::Result<()> {
    let at = std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds.max(0).unsigned_abs());
    let mut options = std::fs::File::options();

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

/// A composed base written into a folder of the host's: its files, each
/// last written when its placement says, and its folders, made and last
/// written at `STAMP`, as the page's drive stamps a folder it makes.
///
/// # Errors
///
/// What cannot be written.
pub fn write_base(composed: &Composed, root: &Path) -> std::io::Result<()> {
    let on_host = |path: &str| {
        path.split('/')
            .fold(root.to_path_buf(), |at, part| at.join(part))
    };
    let mut folders = std::collections::BTreeSet::new();

    std::fs::create_dir_all(root)?;

    for directory in &composed.directories {
        std::fs::create_dir_all(on_host(directory))?;
        folders.insert(directory.clone());
    }

    for file in &composed.files {
        if let Some((parent, _)) = file.path.rsplit_once('/') {
            std::fs::create_dir_all(on_host(parent))?;
            folders.insert(parent.to_string());
        }

        let path = on_host(&file.path);

        std::fs::write(&path, &file.data)?;
        set_written(&path, file.modified)?;
    }

    // The deepest first, as making a folder in one moves its stamp.
    for folder in folders.iter().rev() {
        set_written(&on_host(folder), STAMP)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dos_stamps_read_as_the_typescript_engine_reads_them() {
        // 10 March 1992, 3:10:00, as the setup disks' files are stamped.
        assert_eq!(dos_seconds(0x186a, 0x1940), 700_197_000);
        assert_eq!(dos_seconds(0x0021, 0), 315_532_800);
    }

    #[test]
    fn regedit_takes_each_line_as_a_key_and_a_value() {
        let mut db = RegistryDatabase::empty();

        regedit_import(
            &mut db,
            b"REGEDIT\r\nA comment = not a key\r\nHKEY_CLASSES_ROOT\\.txt = txtfile\r\n\
              HKEY_CLASSES_ROOT\\Alone\r\nHKEY_CLASSES_ROOT\\Spaced   =  two spaces\r\n\
              \\.classes\\.ini = inifile\r\n",
        );

        let value = |db: &mut RegistryDatabase, path: &[u8]| {
            find_in(db, HKEY_CLASSES_ROOT, Some(path), Mode::Open)
                .ok()
                .map(|at| db.text_of(db.entries[at][3]).map(<[u8]>::to_vec))
        };

        assert_eq!(value(&mut db, b".txt"), Some(Some(b"txtfile".to_vec())));
        assert_eq!(value(&mut db, b"Alone"), Some(None));
        assert_eq!(
            value(&mut db, b"Spaced"),
            Some(Some(b" two spaces".to_vec()))
        );
        assert_eq!(value(&mut db, b".ini"), Some(Some(b"inifile".to_vec())));
        assert_eq!(value(&mut db, b"A"), None);
    }
}
