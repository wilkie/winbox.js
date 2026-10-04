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

/// The fonts of an installation, loaded as Windows' boot loads them: in the
/// order GDI's font directory holds them rather than the order the directory
/// listing hands them over, because the mapper's ties go to the earliest
/// entry and nothing else separates two faces with a strike at the height
/// asked for.
///
/// A TrueType face is installed as a `.FOT` stub, which goes to the manager
/// first -- its pitch and family are read from it -- and then the `.TTF` it
/// names. Every `.FON` the profiles do not
/// name is loaded after them, so that a program naming their faces is
/// answered, but is not in GDI's table and so never enumerated; those come in
/// the order DOS lists the folder, by name.
pub fn boot(files: &Files) -> FontManager {
    let mut manager = FontManager::new();
    let parsed = Files::parse(SYSTEM_FOLDER);
    let listing = parsed
        .drive
        .and_then(|letter| files.list(letter, &parsed.parts))
        .unwrap_or_default();
    let names: Vec<String> = listing
        .iter()
        .map(|entry| entry.name.to_uppercase())
        .collect();

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
    let order = font_directory_order(&profile("SYSTEM.INI"), &profile("WIN.INI"));

    let mut loaded: HashSet<String> = HashSet::new();
    let mut load = |manager: &mut FontManager, name: &str, listed: bool| -> Option<Vec<u8>> {
        if !names.iter().any(|named| named == name) || loaded.contains(name) {
            return None;
        }

        loaded.insert(name.to_string());

        let (_, bytes) = files.read_from(SYSTEM_FOLDER, name)?;

        manager.load(name, bytes.clone(), listed);
        Some(bytes)
    };

    for name in &order {
        if let Some(bytes) = load(&mut manager, name, true)
            && has_extension(name, "FOT")
        {
            load(&mut manager, &true_type_file_of(&bytes, name), true);
        }
    }

    let rest: Vec<String> = names
        .iter()
        .filter(|name| has_extension(name, "FON"))
        .cloned()
        .collect();

    for name in in_directory_order(rest, &order, Clone::clone) {
        load(&mut manager, &name, false);
    }

    manager
}
