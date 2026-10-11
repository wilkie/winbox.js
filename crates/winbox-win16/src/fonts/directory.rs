//! GDI's font directory: which files it is built from, and in what order,
//! read from `SYSTEM.INI` and `WIN.INI` as Windows' boot reads them.

use std::collections::HashSet;

use winbox_machine::Files;

use super::{FontManager, has_extension};

/// JavaScript's `trim`, over the characters a Latin-1 string can hold.
fn trim(text: &str) -> &str {
    text.trim_matches(|c: char| {
        matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}')
    })
}

/// A `[section]` of a profile, as key and value pairs in the order written:
/// the lines after a line that is the section's name in brackets, up to the
/// next line that begins with a bracket. A line with no `=`, more than one,
/// or nothing after it is left out.
pub fn profile_section(text: &str, name: &str) -> Vec<(String, String)> {
    let chars: Vec<char> = text.chars().collect();
    let header: Vec<char> = format!("[{name}]").chars().collect();
    let line_start = |at: usize| at == 0 || matches!(chars[at - 1], '\n' | '\r');

    // The header: at a line's start, its name without regard to case, then
    // spaces and tabs to the line's end.
    let body = (0..chars.len()).find_map(|at| {
        if !line_start(at) || at + header.len() > chars.len() {
            return None;
        }

        let named = chars[at..at + header.len()]
            .iter()
            .zip(&header)
            .all(|(a, b)| a.to_lowercase().eq(b.to_lowercase()));

        if !named {
            return None;
        }

        let mut after = at + header.len();

        while after < chars.len() && matches!(chars[after], ' ' | '\t') {
            after += 1;
        }

        if chars.get(after) == Some(&'\r') {
            after += 1;
        }

        (chars.get(after) == Some(&'\n')).then_some(after + 1)
    });

    let Some(start) = body else {
        return Vec::new();
    };
    let end = (start..chars.len())
        .find(|&at| line_start(at) && chars[at] == '[')
        .unwrap_or(chars.len());
    let section: String = chars[start..end].iter().collect();

    section
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('=').map(trim).collect();

            (parts.len() == 2 && !parts[1].is_empty())
                .then(|| (parts[0].to_string(), parts[1].to_string()))
        })
        .collect()
}

/// The boot fonts, in the order GDI loads them whatever order `SYSTEM.INI`
/// writes them in (`GDI.EXE` seg2 `0527`): the EGA's installation lists them
/// the other way round.
const BOOT_FONTS: [&str; 3] = ["fonts.fon", "fixedfon.fon", "oemfonts.fon"];

/// The file names GDI's font directory is built from, upper case and in
/// order.
///
/// It matters because the mapper's ties go to the earliest entry: two faces
/// can both have a strike at exactly the height asked for, and which one
/// answers is decided by nothing else.
///
/// GDI's directory is not the `SYSTEM` directory. It is the three boot fonts
/// named in `SYSTEM.INI` `[boot]`, which GDI loads first, and then every line
/// of `WIN.INI` `[fonts]` in the order written, which USER adds at start-up.
/// Reading the directory instead gets a different order and, on a system that
/// has `DOSAPP.FON` installed, a different set: that file carries five more
/// faces called Terminal that GDI never has in its directory at all.
pub fn font_directory_order(system_profile: &str, windows_profile: &str) -> Vec<String> {
    let lines = profile_section(system_profile, "boot");
    let boot = BOOT_FONTS.iter().flat_map(|font| {
        lines
            .iter()
            .filter(move |(key, _)| key.to_lowercase() == *font)
            .cloned()
    });
    let mut names: Vec<String> = Vec::new();

    for (_, value) in boot.chain(profile_section(windows_profile, "fonts")) {
        let name = value
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or("")
            .to_uppercase();

        if !names.contains(&name) {
            names.push(name);
        }
    }

    names
}

/// A profile's number as `GetProfileInt` reads it: the key's value's
/// leading digits, a minus before them taken, nought where there are none;
/// `default` where the key is not there.
pub fn profile_number(text: &str, section: &str, key: &str, default: i32) -> i32 {
    let Some((_, value)) = profile_section(text, section)
        .into_iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
    else {
        return default;
    };
    let (sign, digits) = match value.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, value.as_str()),
    };
    let digits: String = digits.chars().take_while(char::is_ascii_digit).collect();

    sign * digits.parse::<i32>().unwrap_or(0)
}

/// What `WIN.INI` `[TrueType]` says GDI reads at start-up (`GDI.EXE` seg2
/// `110e`): whether TrueType is enabled, `TTEnable`, 1 where it is not
/// there and any number but nought on; and whether programs are shown
/// TrueType fonts alone, `TTOnly`. **Recorded** by `fontboot`.
pub fn true_type_settings(windows_profile: &str) -> (bool, bool) {
    (
        profile_number(windows_profile, "TrueType", "TTEnable", 1) != 0,
        profile_number(windows_profile, "TrueType", "TTOnly", 0) != 0,
    )
}

/// The file a `WIN.INI` `[fonts]` line's value names, as USER adds it at
/// start-up (`USER.EXE` seg3 `1b9a`): `.FON` put after a value with no `.`
/// anywhere in it, and the file found as `LoadLibrary` finds it -- a path
/// where the value has one, else the Windows directory and then the system
/// directory. Its folder and its name. **Recorded** by `fontboot`: a path
/// outside the system directory, a name with no extension, and a name
/// alone are each added. A path without a drive or a root is taken from
/// the Windows directory [inferred]: the directory current at start-up is
/// not read out.
pub fn font_line_file(files: &Files, value: &str) -> Option<(String, String)> {
    let value = if value.contains('.') {
        value.to_string()
    } else {
        format!("{value}.FON")
    };

    let Some((folder, name)) = value.rsplit_once('\\') else {
        return [WINDOWS_FOLDER, SYSTEM_FOLDER]
            .iter()
            .find(|folder| files.read_from(folder, &value).is_some())
            .map(|folder| (folder.to_string(), value.clone()));
    };
    let folder = if folder.contains(':') || folder.starts_with('\\') {
        folder.to_string()
    } else {
        format!("{WINDOWS_FOLDER}\\{folder}")
    };

    files
        .read_from(&folder, name)
        .is_some()
        .then(|| (folder, name.to_string()))
}

/// The TrueType file a `.FOT` stub stands for: the stub is a font resource
/// whose one face names its `.TTF` by file name. `WIN.INI` `[fonts]` lists the
/// stub, and GDI loads the stub -- where the face's pitch and family come from
/// -- and then the outlines it names.
pub fn true_type_file_of(stub: &[u8], stub_name: &str) -> String {
    let word = |byte: u8| byte.is_ascii_alphanumeric() || byte == b'_';
    let mut at = 0;

    // The first run of letters, digits and underscores followed by `.TTF`.
    while at < stub.len() {
        if !word(stub[at]) {
            at += 1;
            continue;
        }

        let start = at;

        while at < stub.len() && word(stub[at]) {
            at += 1;
        }

        if stub
            .get(at..at + 4)
            .is_some_and(|ending| ending.eq_ignore_ascii_case(b".TTF"))
        {
            return stub[start..at + 4]
                .iter()
                .map(|&byte| char::from(byte.to_ascii_uppercase()))
                .collect();
        }
    }

    let upper = stub_name.to_uppercase();

    match upper.strip_suffix(".FOT") {
        Some(stem) => format!("{stem}.TTF"),
        None => upper,
    }
}

/// Sorts font files into the order GDI's directory would hold them.
///
/// Stable, so files the profiles do not name keep the order they arrived in
/// and sit after the ones they do.
pub fn in_directory_order<T>(
    files: Vec<T>,
    order: &[String],
    name_of: impl Fn(&T) -> String,
) -> Vec<T> {
    let rank = |file: &T| {
        let name = name_of(file).to_uppercase();

        order
            .iter()
            .position(|named| *named == name)
            .unwrap_or(order.len())
    };
    let mut ranked: Vec<(usize, T)> = files.into_iter().map(|file| (rank(&file), file)).collect();

    ranked.sort_by_key(|(rank, _)| *rank);
    ranked.into_iter().map(|(_, file)| file).collect()
}

/// Where the fonts are, and the profiles that say which GDI has.
const SYSTEM_FOLDER: &str = "C:\\WINDOWS\\SYSTEM";
const WINDOWS_FOLDER: &str = "C:\\WINDOWS";

/// The fonts of an installation, loaded as Windows' boot loads them: GDI's
/// three boot fonts from the system directory, and then each line of
/// `WIN.INI` `[fonts]`, as USER adds it (`font_line_file`), in that order
/// -- the order GDI's font directory holds them, which the mapper's ties
/// go to the earliest of.
///
/// A TrueType face is installed as a `.FOT` stub, which goes to the manager
/// first -- its pitch and family are read from it -- and then the `.TTF` it
/// names; with `[TrueType]` `TTEnable` nought, not at all. A file the
/// profiles do not name is not GDI's: not enumerated, and no answer to a
/// request (**recorded** by `fontboot`: Terminal asked for at eight pixels
/// in the OEM set is VGAOEM.FON's twelve-row strike, not DOSAPP.FON's
/// eight).
pub fn boot(files: &Files) -> FontManager {
    let mut manager = FontManager::new();

    let profile = |name: &str| {
        files
            .read_from(WINDOWS_FOLDER, name)
            .map(|(_, bytes)| {
                bytes
                    .iter()
                    .map(|&byte| char::from(byte))
                    .collect::<String>()
            })
            .unwrap_or_default()
    };
    let system_profile = profile("SYSTEM.INI");
    let windows_profile = profile("WIN.INI");
    let (true_type, true_type_only) = true_type_settings(&windows_profile);

    manager.true_type_off = !true_type;
    manager.true_type_only = true_type_only;

    let mut loaded: HashSet<String> = HashSet::new();
    let mut load =
        |manager: &mut FontManager, folder: &str, name: &str, listed: bool| -> Option<Vec<u8>> {
            let (path, bytes) = files.read_from(folder, name)?;
            let upper = path.to_uppercase();

            if loaded.contains(&upper) {
                return None;
            }

            loaded.insert(upper);
            manager.load(name, bytes.clone(), listed);
            Some(bytes)
        };

    // GDI's boot fonts, from the system directory (`GDI.EXE` seg2 `0527`).
    let boot = profile_section(&system_profile, "boot");

    for font in BOOT_FONTS {
        for (_, value) in boot
            .iter()
            .filter(|(key, _)| key.eq_ignore_ascii_case(font))
        {
            load(&mut manager, SYSTEM_FOLDER, value, true);
        }
    }

    // Then each `[fonts]` line, as USER adds it. With TrueType off GDI has
    // no TrueType table, and a stub's add fails (seg2 `0f38`).
    for (_, value) in profile_section(&windows_profile, "fonts") {
        let Some((folder, name)) = font_line_file(files, &value) else {
            continue;
        };

        if has_extension(&name, "FOT") && !true_type {
            continue;
        }

        if let Some(bytes) = load(&mut manager, &folder, &name, true)
            && has_extension(&name, "FOT")
        {
            load(
                &mut manager,
                SYSTEM_FOLDER,
                &true_type_file_of(&bytes, &name),
                true,
            );
        }
    }

    manager
}
