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
use std::sync::OnceLock;

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
