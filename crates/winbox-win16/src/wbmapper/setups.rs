//! The MIDI Mapper's setups, as Windows' `MIDIMAP.DRV` keeps them in
//! `MIDIMAP.CFG` and reads them as it opens (**read out**, cited by
//! `MIDIMAP` segment and offset; `kb/topics/midi-mapper.md`), and the
//! installation's own setups that name a device WinBox has, kept in code
//! for a machine with no `MIDIMAP.CFG`.
//!
//! **The file.** `MIDIMAP.CFG`, in Windows' system directory (seg3 `4063`),
//! begins with seven words (seg3 `16ee`, `3aaa`): a version (1), two words
//! the mapper does not read, the current setup's number, and where in the
//! file its three tables are -- the setups', the patch maps' and the key
//! maps' (`0Eh`, `152Ah` and `2A46h` in the installation's). Each table is
//! a word of room (100), a word of entries in use, then its room of entries
//! of `36h` bytes (seg3 `3b8e`): a name of 16 bytes, a description of 32,
//! the entry's number and where in the file what it names is kept. An
//! entry is found by its number, the first 1, or by its name, compared
//! with each named entry's without regard to case (seg3 `3d05`).
//!
//! * A setup, `284h` bytes (seg3 `1b7f`): for each of the 16 channels in
//!   turn, `28h` bytes -- the channel it is sent as (a word, from nought),
//!   the device's name (32 bytes; none, a channel sent nowhere), the
//!   number of its patch map (a word; nought, none) and its flags (a
//!   doubleword: 1, sent; 2, through its patch map).
//! * A patch map, `20Bh` bytes (seg3 `1de2`): a word, the volume's divisor
//!   (a byte), then for each of the 128 programs the program it is sent as
//!   and its volume (seg3 `1e39`), and then the number of each program's
//!   key map (128 words; nought, none: seg3 `1e8b`).
//! * A key map, `86h` bytes (seg3 `1fb5`): a word, then the key each of
//!   the 128 keys is sent as.
//!
//! The mapper reads the file each time it opens, its current setup the one
//! the header names (seg3 `16ca`); the installation's is the seventh, "Ad
//! Lib". WinBox's mapper reads it as it opens too, the same way. The sound
//! card's installation writes the file (`install`): its setups naming
//! WinBox's devices, and its setup current. With no file, its setup is
//! "Ad Lib general", General MIDI on WinBox's synthesizer, of those kept
//! here.

use std::rc::Rc;

/// Where Windows keeps the mapper's setups: its system directory (seg3
/// `4063`, `GetSystemDirectory` and the string `73h`).
pub const FILE: &str = "C:\\WINDOWS\\SYSTEM\\MIDIMAP.CFG";

/// The installation's base-level setup, channels 13 to 16 to the Ad Lib.
pub const BASE_LEVEL: &str = "Ad Lib";
/// The installation's General MIDI setup for the Ad Lib: every channel to
/// it, 10 and 16 swapped.
pub const GENERAL_MIDI: &str = "Ad Lib general";

/// `MIDIMAP`'s answers to an open whose setup it could not read (seg3
/// `db8`): the setup not in the file, `MIDIERR_INVALIDSETUP` (69); the file
/// not read, `MIDIERR_NOMAP` (66).
pub const MIDIERR_INVALIDSETUP: u32 = 69;
pub const MIDIERR_NOMAP: u32 = 66;

/// The names Windows' devices have in the installation's setups, and the
/// WinBox device that is each one's: the Ad Lib's (`MSADLIB.DRV`'s one
/// device) WinBox's synthesizer, which does what it does; the Sound
/// Blaster 1.5's MIDI port (`SNDBLST2.DRV`'s, as `mididev` recorded it)
/// WinBox's card's MIDI port. A setup naming another, as "LAPC1" names the
/// "Roland MPU-401", finds none, as Windows' mapper finds none without
/// that card.
const WINDOWS_NAMES: [(&str, &str); 2] = [
    ("Ad Lib", crate::wbsound::SYNTHESIZER_NAME),
    ("Creative Labs Sound Blaster 1.5", crate::wbsound::MIDI_NAME),
];

/// A device's name as a setup gives it, as WinBox's devices have it.
pub fn device_named(name: &[u8]) -> Vec<u8> {
    WINDOWS_NAMES
        .iter()
        .find(|(windows, _)| name.eq_ignore_ascii_case(windows.as_bytes()))
        .map_or_else(|| name.to_vec(), |(_, ours)| ours.as_bytes().to_vec())
}

/// A program of a patch map: the program it is sent as, its volume, and the
/// key map its notes go through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Patch {
    pub program: u8,
    pub volume: u8,
    pub keys: Option<Rc<[u8; 128]>>,
}

/// A patch map: its programs, and what a volume is divided by after being
/// multiplied by a program's (100 in each of the installation's).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchMap {
    pub divisor: u8,
    pub patches: Vec<Patch>,
}

/// A channel of a setup: the device it goes to, by the name the setup
/// gives (none, nowhere); whether it is sent at all; the channel it is sent
/// as, from nought; and its patch map, where its flags say to use one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Channel {
    pub device: Option<Vec<u8>>,
    pub sent: bool,
    pub channel: u8,
    pub patches: Option<Rc<PatchMap>>,
}

impl Channel {
    const NOWHERE: Self = Self {
        device: None,
        sent: false,
        channel: 0,
        patches: None,
    };
}

/// A setup: its name, and its sixteen channels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Setup {
    pub name: String,
    pub channels: Vec<Channel>,
}

/// Which setup is wanted: by its name, or by its number in the file.
#[derive(Debug, Clone, Copy)]
pub enum Wanted<'a> {
    Named(&'a [u8]),
    Current,
}

/// The setup `wanted` from the file's bytes, as `MIDIMAP` reads it as it
/// opens (seg3 `1b0f`); its answer where it cannot be.
pub fn from_file(bytes: &[u8], wanted: Wanted<'_>) -> Result<Setup, u32> {
    let word = |at: usize| -> Result<u16, u32> {
        bytes
            .get(at..at + 2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .ok_or(MIDIERR_NOMAP)
    };
    let current = word(6)?;
    let tables = [word(8)?, word(10)?, word(12)?].map(usize::from);
    let setup = match wanted {
        Wanted::Named(name) => entry_named(bytes, tables[0], name)?,
        Wanted::Current => entry(bytes, tables[0], current)?,
    };
    let record = bytes
        .get(setup.place..setup.place + 0x284)
        .ok_or(MIDIERR_NOMAP)?;
    let mut channels = Vec::with_capacity(16);

    for each in record.chunks_exact(0x28).take(16) {
        let name = text(&each[2..0x22]);
        let flags = u32::from_le_bytes([each[0x24], each[0x25], each[0x26], each[0x27]]);
        let map = u16::from_le_bytes([each[0x22], each[0x23]]);
        // A patch map is read where the channel names one, sent or not
        // (seg3 `1c91`); it is used where the flags say (seg2 `2ab`).
        let patches = if map == 0 {
            None
        } else {
            Some(Rc::new(patch_map(bytes, tables, map)?))
        };

        channels.push(Channel {
            device: (!name.is_empty()).then(|| name.to_vec()),
            sent: flags & 1 != 0,
            channel: each[0],
            patches: patches.filter(|_| flags & 2 != 0),
        });
    }

    Ok(Setup {
        name: setup.name,
        channels,
    })
}

/// An entry of a table: its name, and where what it names is kept.
struct Entry {
    name: String,
    place: usize,
}

/// `MIDIMAP.CFG` as the sound card installs it, from the installation's:
/// each setup's channels that name a device of Windows' that WinBox does
/// the same as (`WINDOWS_NAMES`) naming WinBox's, and the setup named
/// `current` made current, its number in the word at 6 as `MIDIMAP` makes
/// a setup current (seg3 `15fe`). None where the file is not one or has no
/// such setup.
///
/// The names are WinBox's because the applet `MIDIMAP.DRV` keeps for
/// Control Panel finds each setup's devices by asking MMSYSTEM's MIDI
/// output devices their names (seg3 `1843`-`18df`): a setup naming one
/// there is none of shows "[ None ]" for its port and warns that its
/// device is not installed (string `91h`), and saving it would write no
/// device at all. A card's own `MIDIMAP.CFG` named its card's devices as
/// they name themselves; this one names WinBox's.
pub fn install(bytes: &[u8], current: &str) -> Option<Vec<u8>> {
    let mut out = bytes.to_vec();
    let word = |at: usize| {
        bytes
            .get(at..at + 2)
            .map(|pair| usize::from(u16::from_le_bytes([pair[0], pair[1]])))
    };
    let table = word(8)?;
    let room = u16::try_from(word(table)?).ok()?;
    let mut number = None;

    for each in 1..=room {
        let found = entry(bytes, table, each).ok()?;

        if found.name.is_empty() {
            continue;
        }

        if found.name.eq_ignore_ascii_case(current) {
            number = Some(each);
        }

        for channel in 0..16 {
            let at = found.place + channel * 0x28 + 2;
            let name = text(bytes.get(at..at + 32)?);

            if let Some((_, ours)) = WINDOWS_NAMES
                .iter()
                .find(|(windows, _)| name.eq_ignore_ascii_case(windows.as_bytes()))
            {
                let field = &mut out[at..at + 32];

                field.fill(0);
                field[..ours.len()].copy_from_slice(ours.as_bytes());
            }
        }
    }

    out[6..8].copy_from_slice(&number?.to_le_bytes());
    Some(out)
}

/// The entry numbered `number` of the table at `table` (seg3 `3d41`):
/// counted from 1, named or not.
fn entry(bytes: &[u8], table: usize, number: u16) -> Result<Entry, u32> {
    let room = usize::from(
        bytes
            .get(table..table + 2)
            .map_or(0, |pair| u16::from_le_bytes([pair[0], pair[1]])),
    );
    let number = usize::from(number);

    if number == 0 || number > room {
        return Err(MIDIERR_INVALIDSETUP);
    }

    let at = table + 4 + (number - 1) * 0x36;
    let entry = bytes.get(at..at + 0x36).ok_or(MIDIERR_NOMAP)?;

    Ok(Entry {
        name: text(&entry[..16])
            .iter()
            .map(|&byte| char::from(byte))
            .collect(),
        place: u32::from_le_bytes([entry[0x32], entry[0x33], entry[0x34], entry[0x35]]) as usize,
    })
}

/// The entry of the table at `table` named `name`, without regard to case,
/// among those with names (seg3 `3d8b`-`3dba`): none, the setup is not
/// there (seg3 `1b54`).
fn entry_named(bytes: &[u8], table: usize, name: &[u8]) -> Result<Entry, u32> {
    let word = |at: usize| {
        bytes
            .get(at..at + 2)
            .map_or(0, |pair| u16::from_le_bytes([pair[0], pair[1]]))
    };
    let room = word(table);

    for number in 1..=room {
        let found = entry(bytes, table, number)?;

        if !found.name.is_empty() && found.name.as_bytes().eq_ignore_ascii_case(name) {
            return Ok(found);
        }
    }

    Err(MIDIERR_INVALIDSETUP)
}

/// The patch map numbered `number` (seg3 `1d75`), with the key maps its
/// programs name (seg3 `1f62`).
fn patch_map(bytes: &[u8], tables: [usize; 3], number: u16) -> Result<PatchMap, u32> {
    let place = entry(bytes, tables[1], number)
        .map_err(|_| MIDIERR_NOMAP)?
        .place;
    let record = bytes.get(place..place + 0x20b).ok_or(MIDIERR_NOMAP)?;
    let mut patches = Vec::with_capacity(128);

    for program in 0..128 {
        let keys = u16::from_le_bytes([record[0x107 + 2 * program], record[0x108 + 2 * program]]);
        let keys = if keys == 0 {
            None
        } else {
            let place = entry(bytes, tables[2], keys)
                .map_err(|_| MIDIERR_NOMAP)?
                .place;
            let record = bytes.get(place..place + 0x86).ok_or(MIDIERR_NOMAP)?;
            let mut map = [0u8; 128];

            map.copy_from_slice(&record[2..0x82]);
            Some(Rc::new(map))
        };

        patches.push(Patch {
            program: record[3 + 2 * program],
            volume: record[4 + 2 * program],
            keys,
        });
    }

    Ok(PatchMap {
        divisor: record[2],
        patches,
    })
}

/// A name's bytes, to its first nought.
fn text(bytes: &[u8]) -> &[u8] {
    let end = bytes
        .iter()
        .position(|&byte| byte == 0)
        .unwrap_or(bytes.len());

    &bytes[..end]
}

/// The installation's setups that name only devices WinBox has, and need
/// no patch map, as its `MIDIMAP.CFG` has them: by name, each channel's
/// device and the channel it is sent as, from 1. The rest of its setups
/// ("LAPC1", "MT32", "Proteus/1", "Proteus general") name a card WinBox
/// does not have or need the file's patch maps.
const KEPT: [(&str, [(&str, u8); 16]); 4] = [
    (
        BASE_LEVEL,
        [
            ("", 1),
            ("", 2),
            ("", 3),
            ("", 4),
            ("", 5),
            ("", 6),
            ("", 7),
            ("", 8),
            ("", 9),
            ("", 10),
            ("", 11),
            ("", 12),
            ("Ad Lib", 13),
            ("Ad Lib", 14),
            ("Ad Lib", 15),
            ("Ad Lib", 16),
        ],
    ),
    (
        GENERAL_MIDI,
        [
            ("Ad Lib", 1),
            ("Ad Lib", 2),
            ("Ad Lib", 3),
            ("Ad Lib", 4),
            ("Ad Lib", 5),
            ("Ad Lib", 6),
            ("Ad Lib", 7),
            ("Ad Lib", 8),
            ("Ad Lib", 9),
            ("Ad Lib", 16),
            ("Ad Lib", 11),
            ("Ad Lib", 12),
            ("Ad Lib", 13),
            ("Ad Lib", 14),
            ("Ad Lib", 15),
            ("Ad Lib", 10),
        ],
    ),
    (
        "General MIDI",
        [
            ("Creative Labs Sound Blaster 1.5", 1),
            ("Creative Labs Sound Blaster 1.5", 2),
            ("Creative Labs Sound Blaster 1.5", 3),
            ("Creative Labs Sound Blaster 1.5", 4),
            ("Creative Labs Sound Blaster 1.5", 5),
            ("Creative Labs Sound Blaster 1.5", 6),
            ("Creative Labs Sound Blaster 1.5", 7),
            ("Creative Labs Sound Blaster 1.5", 8),
            ("Creative Labs Sound Blaster 1.5", 9),
            ("Creative Labs Sound Blaster 1.5", 10),
            ("Creative Labs Sound Blaster 1.5", 11),
            ("Creative Labs Sound Blaster 1.5", 12),
            ("Creative Labs Sound Blaster 1.5", 13),
            ("Creative Labs Sound Blaster 1.5", 14),
            ("Creative Labs Sound Blaster 1.5", 15),
            ("Creative Labs Sound Blaster 1.5", 16),
        ],
    ),
    (
        "Extended MIDI",
        [
            ("Creative Labs Sound Blaster 1.5", 1),
            ("Creative Labs Sound Blaster 1.5", 2),
            ("Creative Labs Sound Blaster 1.5", 3),
            ("Creative Labs Sound Blaster 1.5", 4),
            ("Creative Labs Sound Blaster 1.5", 5),
            ("Creative Labs Sound Blaster 1.5", 6),
            ("Creative Labs Sound Blaster 1.5", 7),
            ("Creative Labs Sound Blaster 1.5", 8),
            ("Creative Labs Sound Blaster 1.5", 9),
            ("Creative Labs Sound Blaster 1.5", 10),
            ("", 11),
            ("", 12),
            ("", 13),
            ("", 14),
            ("", 15),
            ("", 16),
        ],
    ),
];

/// A setup kept here, by its name without regard to case: none, the setup
/// is not there.
pub fn kept(name: &[u8]) -> Result<Setup, u32> {
    let (name, channels) = KEPT
        .iter()
        .find(|(each, _)| name.eq_ignore_ascii_case(each.as_bytes()))
        .ok_or(MIDIERR_INVALIDSETUP)?;

    Ok(Setup {
        name: (*name).to_string(),
        channels: channels
            .iter()
            .map(|&(device, channel)| {
                if device.is_empty() {
                    Channel {
                        channel: channel - 1,
                        ..Channel::NOWHERE
                    }
                } else {
                    Channel {
                        device: Some(device.as_bytes().to_vec()),
                        sent: true,
                        channel: channel - 1,
                        patches: None,
                    }
                }
            })
            .collect(),
    })
}

/// A `MIDIMAP.CFG` of one setup, the one kept here by `name`, current:
/// for a test with no installation's file to hand. Its tables of patch
/// maps and key maps are empty.
#[cfg(test)]
pub(crate) fn file_of(name: &str) -> Vec<u8> {
    let (name, channels) = KEPT
        .iter()
        .find(|(each, _)| name.eq_ignore_ascii_case(each))
        .expect("a setup kept here");
    let setups = 0x0eu16;
    let patches = setups + 4 + 0x36;
    let keys = patches + 4;
    let place = u32::from(keys + 4);
    let mut bytes = Vec::new();

    for word in [1, 0, 0, 1, setups, patches, keys, 1, 1] {
        bytes.extend_from_slice(&u16::to_le_bytes(word));
    }

    let mut entry = [0u8; 0x36];

    entry[..name.len()].copy_from_slice(name.as_bytes());
    entry[0x30..0x32].copy_from_slice(&1u16.to_le_bytes());
    entry[0x32..].copy_from_slice(&place.to_le_bytes());
    bytes.extend_from_slice(&entry);
    bytes.extend_from_slice(&[0; 8]);

    for (device, channel) in channels {
        let mut each = [0u8; 0x28];

        each[0] = channel - 1;
        each[2..2 + device.len()].copy_from_slice(device.as_bytes());
        each[0x24] = u8::from(!device.is_empty());
        bytes.extend_from_slice(&each);
    }

    bytes.extend_from_slice(&[0; 4]);
    bytes
}

/// A short message of a channel the setup sends, its status `running` (the
/// mapper's running status), mapped as `MIDIMAP` maps it (seg2 `24b`):
/// where it has its status, the status's channel the setup's; then, where
/// the channel goes through a patch map, a note's key (note off, note on
/// and key pressure) through the key map of the channel's program, a
/// program change's program through the patch map -- the program asked for
/// kept as the channel's (`programs`) -- and controller 7, the volume,
/// multiplied by the channel's program's volume and divided by the map's
/// divisor. Nothing else is changed: not a note's velocity, nor any other
/// controller.
pub fn map(
    channel: &Channel,
    programs: &mut [u8; 16],
    running: u8,
    message: u32,
    given: bool,
) -> u32 {
    let mut bytes = message.to_le_bytes();
    let source = usize::from(running & 0xf);
    // The first data byte: after the status where the message has it.
    let data = usize::from(given);

    if given {
        bytes[0] = (running & 0xf0).wrapping_add(channel.channel);
    }

    let Some(map) = channel.patches.as_deref() else {
        return u32::from_le_bytes(bytes);
    };
    let program = usize::from(programs[source] & 0x7f);

    match running & 0xf0 {
        0x80 | 0x90 | 0xa0 => {
            // A key past 127 is no MIDI key; `MIDIMAP` would read past the
            // key map for it (seg2 `33b`), which is not followed.
            if let (Some(keys), Some(&key)) = (&map.patches[program].keys, keys_key(&bytes, data)) {
                bytes[data] = keys[usize::from(key)];
            }
        }
        // A divisor of nought would fault the division (seg3 `4aa0`); no
        // file has one.
        0xb0 if bytes[data] == 7 && map.divisor != 0 => {
            let volume = u32::from(bytes[data + 1]) * u32::from(map.patches[program].volume)
                / u32::from(map.divisor);

            bytes[data + 1] = volume as u8;
        }
        0xc0 => {
            programs[source] = bytes[data];

            if let Some(patch) = map.patches.get(usize::from(bytes[data])) {
                bytes[data] = patch.program;
            }
        }
        _ => {}
    }

    u32::from_le_bytes(bytes)
}

/// A note's key, where it is a MIDI key.
fn keys_key(bytes: &[u8; 4], data: usize) -> Option<&u8> {
    bytes.get(data).filter(|&&key| key < 0x80)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn installation() -> Option<Vec<u8>> {
        std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../oracle/build/drive-c-vgasound/WINDOWS/SYSTEM/MIDIMAP.CFG"),
        )
        .ok()
    }

    /// **Read out**: the installation's current setup is the seventh, "Ad
    /// Lib", and the setups kept here are the file's.
    #[test]
    fn the_kept_setups_are_the_installations() {
        let Some(bytes) = installation() else {
            return;
        };

        assert_eq!(from_file(&bytes, Wanted::Current).unwrap().name, BASE_LEVEL);

        for (name, _) in KEPT {
            assert_eq!(
                from_file(&bytes, Wanted::Named(name.as_bytes())),
                kept(name.as_bytes()),
                "{name}"
            );
        }

        assert_eq!(
            from_file(&bytes, Wanted::Named(b"no such setup")),
            Err(MIDIERR_INVALIDSETUP)
        );
    }

    /// A file of one setup kept here reads back as that setup.
    #[test]
    fn a_file_of_one_setup_reads_back() {
        for (name, _) in KEPT {
            assert_eq!(
                from_file(&file_of(name), Wanted::Current),
                kept(name.as_bytes())
            );
        }
    }

    /// **Read out**: "Proteus general" sends each channel through its
    /// patch map: a program to the Proteus's, a note of a program with a
    /// key map through it, and the volume scaled.
    #[test]
    fn a_patch_map_maps_programs_keys_and_volume() {
        let Some(bytes) = installation() else {
            return;
        };
        let setup = from_file(&bytes, Wanted::Named(b"proteus general")).unwrap();
        let channel = &setup.channels[0];
        let patches = channel.patches.as_deref().unwrap();
        let mut programs = [0u8; 16];

        assert_eq!(patches.divisor, 100);
        // Program 1 is sent as the map has it, and kept as asked.
        let sent = map(channel, &mut programs, 0xc0, 0x01c0, true);

        assert_eq!(sent, 0x00c0 | u32::from(patches.patches[1].program) << 8);
        assert_eq!(programs[0], 1);

        // A program with a key map: its notes' keys through it.
        let (program, keys) = patches
            .patches
            .iter()
            .enumerate()
            .find_map(|(at, patch)| patch.keys.clone().map(|keys| (at as u8, keys)))
            .unwrap();

        map(
            channel,
            &mut programs,
            0xc0,
            u32::from(program) << 8 | 0xc0,
            true,
        );
        assert_eq!(
            map(channel, &mut programs, 0x90, 0x0064_3c90, true),
            0x0064_0090 | u32::from(keys[60]) << 8
        );
        // By running status too: the key, not the status.
        assert_eq!(
            map(channel, &mut programs, 0x90, 0x0000_643c, false),
            0x0000_6400 | u32::from(keys[60])
        );
        // The velocity is not scaled; the volume is.
        assert_eq!(
            map(channel, &mut programs, 0xb0, 0x0050_07b0, true),
            0x0000_07b0
                | (80 * u32::from(patches.patches[usize::from(program)].volume) / 100) << 16
        );
    }
}
