//! Where temporary files go, and a name for one: `GetTempDrive` and
//! `GetTempFileName`.
//!
//! **Read out of `KRNL386.EXE`** (seg3 `0508`, `056a`).

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Stop};
use crate::shell::{Text, text_argument};
use crate::system::System;

const TF_FORCEDRIVE: u16 = 0x80;

/// DOS's error for a file already there, which moves the number on.
const ERROR_FILE_EXISTS: u16 = 0x50;

/// Whether a drive, by its number from A's nought, is a fixed disk, as
/// `GetDriveType` says `DRIVE_FIXED`.
fn fixed(system: &System, drive: u8) -> bool {
    let letter = char::from(b'A' + drive);

    system.files.mounted(letter) && !system.files.removable(letter)
}

/// The drive temporary files go on: the one given, with `TF_FORCEDRIVE`;
/// otherwise the first fixed disk, whatever was given, or the given drive
/// -- the current one for nought -- when there is none. The letter is the
/// low byte and a colon the high. `TEMP` is not looked at.
pub fn temp_drive(system: &System, given: u16) -> u16 {
    let mut letter = given & 0x7f;

    if letter == 0 {
        letter = u16::from(system.files.drive as u8);
    }

    letter &= 0x5f;

    if given & TF_FORCEDRIVE == 0
        && let Some(drive) = (0..=25).find(|&drive| fixed(system, drive))
    {
        return 0x3a << 8 | (0x41 + u16::from(drive));
    }

    0x3a << 8 | letter
}

pub(super) fn get_temp_drive(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let given = args.word(system) & 0xff;

    Ok(Answer::Word(temp_drive(system, given)))
}

/// A variable of the task's DOS environment, or none: matched as the
/// words it compares, case and all.
fn environment_variable(system: &System, name: &str) -> Option<String> {
    let environment = system.task.as_ref()?.environment;

    if environment == 0 {
        return None;
    }

    let segment = u32::from(segment_selector(environment)) << 16;
    let wanted = format!("{name}=");
    let mut at: u32 = 0;

    loop {
        let mut entry = String::new();

        loop {
            let byte = system.read_far(segment | (at & 0xffff), 1)[0];

            at += 1;

            if byte == 0 {
                break;
            }

            entry.push(char::from(byte));
        }

        if entry.is_empty() {
            return None;
        }

        if let Some(value) = entry.strip_prefix(&wanted) {
            return Some(value.to_string());
        }
    }
}

/// A temporary file's name, written to `lpszTempFileName`: `TEMP`'s
/// directory, or else the Windows directory -- or with `TF_FORCEDRIVE` the
/// drive alone -- then `~`, three characters of the prefix, four
/// hexadecimal digits and `.TMP`. With `uUnique` nought, the digits are the
/// time's seconds and hundredths exclusive-ored with its hours and minutes,
/// and the file is made, empty, to be sure of it: one there already moves
/// the number on by one until one is not. Answers the number, or nought
/// when the file could not be made; the name is written either way.
pub(super) fn get_temp_file_name(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let given = args.word(system) & 0xff;
    let prefix = args.dword(system);
    let unique = args.word(system);
    let buffer = args.dword(system);
    let prefix = match text_argument(system, prefix) {
        Text::Refused => return Ok(Answer::Word(0)),
        Text::Null => String::new(),
        Text::Number(number) => number.to_string(),
        Text::Read(bytes) => bytes.iter().map(|&byte| char::from(byte)).collect(),
    };
    let drive = char::from(temp_drive(system, given) as u8);
    let mut path = if given & TF_FORCEDRIVE != 0 {
        format!("{drive}:~")
    } else {
        let directory = match environment_variable(system, "TEMP") {
            Some(temp) if temp.as_bytes().get(1) == Some(&b':') => temp,
            Some(temp) => format!("{drive}:{temp}"),
            None => "C:\\WINDOWS".to_string(),
        };
        let slash = if directory.ends_with('\\') { "" } else { "\\" };

        format!("{directory}{slash}~")
    };

    path.extend(prefix.chars().take(3));

    let mut number = unique;

    if number == 0 {
        let ms = system.epoch_ms + system.now_ms();
        let [_, _, _, hour, minute, second, _] = system.date();
        let hundredths = (ms.rem_euclid(1000) / 10) as u16;

        number = (second << 8 | hundredths) ^ (hour << 8 | minute);
    }

    if number == 0 {
        number = 1;
    }

    let named = |number: u16| format!("{path}{:04X}.TMP", number.max(1));
    let mut name = named(number);

    if unique == 0 {
        loop {
            match system.make_file(&name, true) {
                Ok(handle) => {
                    system.files.close(handle);
                    break;
                }
                Err(ERROR_FILE_EXISTS) => {
                    number = number.wrapping_add(1).max(1);
                    name = named(number);
                }
                Err(_) => {
                    number = 0;
                    break;
                }
            }
        }
    }

    let mut bytes: Vec<u8> = name.chars().map(|ch| ch as u8).collect();

    bytes.push(0);

    for (at, byte) in bytes.into_iter().enumerate() {
        let far = (buffer & 0xffff_0000) | (buffer.wrapping_add(at as u32) & 0xffff);

        system.write_far(far, &[byte]);
    }

    Ok(Answer::Word(number))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use winbox_machine::HostDrive;

    use super::*;

    #[test]
    fn the_first_fixed_disk_unless_forced() {
        let mut system = System::new();

        system
            .files
            .mount('A', HostDrive::removable(PathBuf::from("/nonexistent-a")));
        system
            .files
            .mount('C', HostDrive::new(PathBuf::from("/nonexistent-c")));
        system.files.drive = 'C';

        assert_eq!(temp_drive(&system, 0), 0x3a43);
        assert_eq!(temp_drive(&system, u16::from(b'a')), 0x3a43);
        assert_eq!(temp_drive(&system, 0x80 | u16::from(b'a')), 0x3a41);
        assert_eq!(temp_drive(&system, 0x80), 0x3a43);
    }
}
