//! DOS's functions, `INT 21h`, as winbox.js's `SyscallManager` answers them:
//! by AH, else by AX. A function that says it failed by the carry flag
//! clears it when it succeeds, and sets it with AX the error when it does
//! not. A function not answered leaves the registers as they were, as the
//! TypeScript engine's do; each is kept in `System::unanswered_dos`.

use std::io::SeekFrom;

use winbox_cpu::{AX, BX, CX, DI, DS, DX, ES, SI};
use winbox_machine::{Entry, Files, civil_from_days, segment_selector};

use crate::call::Stop;
use crate::system::System;

/// The carry flag, which says a DOS function failed.
const CARRY: u16 = 0x0001;

const ERROR_INVALID_FUNCTION: u16 = 0x01;
const ERROR_FILE_NOT_FOUND: u16 = 0x02;
const ERROR_PATH_NOT_FOUND: u16 = 0x03;
const ERROR_ACCESS_DENIED: u16 = 0x05;
const ERROR_INVALID_HANDLE: u16 = 0x06;
const ERROR_INVALID_DRIVE: u16 = 0x0f;
const ERROR_CURRENT_DIRECTORY: u16 = 0x10;
const ERROR_NOT_SAME_DEVICE: u16 = 0x11;
const ERROR_NO_MORE_FILES: u16 = 0x12;
const ERROR_FILE_EXISTS: u16 = 0x50;

/// The attributes a program may set: read-only, hidden, system, archive.
const SETTABLE: u8 = 0x27;

/// Where the interrupt descriptor table is kept: see `task.rs`.
const IDT: u32 = 0xffd << 16;

/// A path as DOS takes it apart against the current drive and directory:
/// its drive, and its folders, upper case.
fn resolve_directory(files: &Files, path: &str) -> (char, Vec<String>) {
    let mut drive = files.drive;
    let mut rest = path.to_string();

    if rest.len() >= 2 && rest.as_bytes()[1] == b':' {
        drive = char::from(rest.as_bytes()[0]).to_ascii_uppercase();
        rest = rest[2..].to_string();
    }

    if !rest.starts_with('\\') && !rest.starts_with('/') {
        rest = format!("{}\\{rest}", &files.current(drive)[2..]);
    }

    let mut parts: Vec<String> = Vec::new();

    for part in rest.split(['\\', '/']) {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part.to_ascii_uppercase()),
        }
    }

    (drive, parts)
}

/// A file's path taken apart: its drive, its folder's names, and its name.
fn resolve_file(files: &Files, path: &str) -> (char, Vec<String>, String) {
    let slash = [path.rfind('\\'), path.rfind('/'), path.find(':')]
        .into_iter()
        .flatten()
        .max()
        .map_or(0, |at| at + 1);
    let (drive, parts) = resolve_directory(files, &path[..slash]);

    (drive, parts, path[slash..].to_ascii_uppercase())
}

/// A name as a search pattern's eleven characters: a `*` fills its part
/// with `?`.
fn eleven_of(name: &str) -> String {
    let (base, extension) = name.split_once('.').unwrap_or((name, ""));
    let field = |part: &str, width: usize| {
        let mut out = String::new();

        for character in part.to_ascii_uppercase().chars() {
            if out.len() >= width {
                break;
            }

            if character == '*' {
                return format!("{out:?<width$}");
            }

            out.push(character);
        }

        format!("{out:<width$}")
    };

    field(base, 8) + &field(extension, 3)
}

fn matches(pattern: &[u8], name: &str) -> bool {
    let eleven = if name == "." || name == ".." {
        format!("{name:<11}")
    } else {
        eleven_of(name)
    };

    pattern
        .iter()
        .zip(eleven.bytes())
        .all(|(&want, have)| want == b'?' || want == have)
}

/// Whether a search for these attributes admits an entry: a volume's label
/// only when asked for alone; a hidden, system or folder entry only when
/// asked for.
fn admits(asked: u8, attributes: u8) -> bool {
    if asked == 0x08 {
        return attributes & 0x08 != 0;
    }

    attributes & 0x08 == 0 && (attributes & (0x02 | 0x04 | 0x10)) & !asked == 0
}

impl System {
    /// The `INT 21h` at CS:IP answered; the program goes on after it.
    pub(crate) fn dos_interrupt(&mut self) -> Result<(), Stop> {
        self.dos_call()?;
        self.cpu.ip += 2;
        Ok(())
    }

    fn low(&self, register: usize) -> u8 {
        self.cpu.regs[register] as u8
    }

    fn set_low(&mut self, register: usize, value: u8) {
        self.cpu.regs[register] = (self.cpu.regs[register] & 0xff00) | u16::from(value);
    }

    fn set_high(&mut self, register: usize, value: u8) {
        self.cpu.regs[register] = (self.cpu.regs[register] & 0x00ff) | u16::from(value) << 8;
    }

    /// The far pointer a segment register and an offset register make.
    fn pointer(&self, segment: usize, offset: usize) -> u32 {
        u32::from(self.cpu.segments[segment].selector) << 16 | u32::from(self.cpu.regs[offset])
    }

    /// The string DS:DX points at.
    fn string_at(&self, segment: usize, offset: usize) -> String {
        self.read_string(self.pointer(segment, offset))
            .iter()
            .map(|&byte| char::from(byte))
            .collect()
    }

    /// The DOS function AH names, answered: by `INT 21h`, or by KERNEL's
    /// `Dos3Call`. One table, as DOS's is.
    #[allow(clippy::too_many_lines)]
    pub(crate) fn dos_call(&mut self) -> Result<(), Stop> {
        let ax = self.cpu.regs[AX];
        let flagged = match ax >> 8 {
            0x0e => {
                // The drive selected, if it is there: AL the drives there may be.
                let drive = self.low(DX);

                if drive < 26 && self.files.mounted(char::from(b'A' + drive)) {
                    self.files.drive = char::from(b'A' + drive);
                }

                self.set_low(AX, 26);
                None
            }
            0x19 => {
                self.set_low(AX, self.files.drive as u8 - b'A');
                None
            }
            0x1a => {
                let area = (self.cpu.segments[DS].selector, self.cpu.regs[DX]);

                if let Some(task) = self.task.as_mut() {
                    task.transfer_area = Some(area);
                } else {
                    self.transfer_area = area;
                }

                None
            }
            0x25 => {
                let at = IDT + 4 * u32::from(self.low(AX));
                let (segment, offset) = (self.cpu.segments[DS].selector, self.cpu.regs[DX]);

                self.cpu.bus.write16(at, offset);
                self.cpu.bus.write16(at + 2, segment);
                None
            }
            0x2a => {
                let [year, month, day, _, _, _, weekday] = self.date();

                self.cpu.regs[CX] = year;
                self.set_high(DX, month as u8);
                self.set_low(DX, day as u8);
                self.set_low(AX, weekday as u8);
                None
            }
            0x2c => {
                let [_, _, _, hour, minute, second, _] = self.date();
                let hundredths = (self.now_ms() % 1000) / 10;

                self.set_high(CX, hour as u8);
                self.set_low(CX, minute as u8);
                self.set_high(DX, second as u8);
                self.set_low(DX, hundredths as u8);
                None
            }
            0x2f => {
                let (segment, offset) = self.transfer();

                self.cpu
                    .load_segment(ES, segment)
                    .map_err(Stop::Processor)?;
                self.cpu.regs[BX] = offset;
                None
            }
            // DOS 6.0.
            0x30 => {
                self.cpu.regs[AX] = 0x0006;
                self.cpu.regs[BX] = 0;
                self.cpu.regs[CX] = 0;
                None
            }
            0x35 => {
                let at = IDT + 4 * u32::from(self.low(AX));
                let (offset, segment) = (self.cpu.bus.read16(at), self.cpu.bus.read16(at + 2));

                self.cpu
                    .load_segment(ES, segment)
                    .map_err(Stop::Processor)?;
                self.cpu.regs[BX] = offset;
                None
            }
            // A host's folder has no FAT's geometry: as for no drive.
            0x36 => {
                self.cpu.regs[AX] = 0xffff;
                self.cpu.regs[BX] = 0;
                self.cpu.regs[CX] = 0;
                self.cpu.regs[DX] = 0;
                None
            }
            0x39 => Some(self.make_directory()),
            0x3a => Some(self.remove_directory()),
            0x3b => Some(self.change_directory()),
            0x3c => Some(self.create(false)),
            0x3d => Some(self.open_file()),
            0x3e => Some(self.close_file()),
            0x3f => Some(self.read_file()),
            0x40 => Some(self.write_file()),
            0x41 => Some(self.delete_file()),
            0x42 => Some(self.seek_file()),
            0x43 => Some(self.file_attributes()),
            0x47 => Some(self.current_directory()),
            0x4c => {
                self.ended = true;
                return Err(Stop::Ended);
            }
            0x4e => Some(self.find_first()),
            0x4f => Some(self.find_next()),
            0x56 => Some(self.rename_file()),
            0x5b => Some(self.create(true)),
            _ => match ax {
                0x3305 => {
                    // The boot drive: C:.
                    self.set_low(DX, 3);
                    None
                }
                0x4400 => Some(self.device_information()),
                0x4408 => Some(self.drive_of(self.low(BX)).map(|()| self.cpu.regs[AX] = 1)),
                0x4409 => Some(self.drive_of(self.low(BX)).map(|()| self.cpu.regs[DX] = 0)),
                0x440d => Some(self.drive_of(self.low(BX)).and(Err(ERROR_INVALID_FUNCTION))),
                _ => {
                    self.unanswered_dos.push(ax);
                    None
                }
            },
        };

        if let Some(result) = flagged {
            match result {
                Ok(()) => self.cpu.flags &= !CARRY,
                Err(error) => {
                    self.cpu.flags |= CARRY;
                    self.cpu.regs[AX] = error;
                }
            }
        }

        Ok(())
    }

    /// The disk transfer area: the task's, its prefix's tail to begin with.
    fn transfer(&self) -> (u16, u16) {
        match &self.task {
            Some(task) => task
                .transfer_area
                .unwrap_or((segment_selector(task.program_segment), 0x80)),
            None => self.transfer_area,
        }
    }

    /// A drive by its number, nought the current one.
    fn drive_letter(&self, drive: u8) -> Option<char> {
        let letter = if drive == 0 {
            self.files.drive
        } else {
            char::from(0x40 + drive.min(26))
        };

        (drive <= 26 && self.files.mounted(letter)).then_some(letter)
    }

    fn drive_of(&self, drive: u8) -> Result<(), u16> {
        self.drive_letter(drive)
            .map(|_| ())
            .ok_or(ERROR_INVALID_DRIVE)
    }

    fn device_information(&mut self) -> Result<(), u16> {
        let handle = self.cpu.regs[BX];
        let drive = self
            .files
            .resolve(usize::from(handle))
            .map(|file| file.drive);

        self.cpu.regs[DX] = match drive {
            Some(letter) => u16::from(letter as u8 - b'A') & 0x3f,
            None if handle <= 4 => 0x80d3,
            None => return Err(ERROR_INVALID_HANDLE),
        };
        Ok(())
    }

    fn make_directory(&mut self) -> Result<(), u16> {
        let (drive, parts, name) = resolve_file(&self.files, &self.string_at(DS, DX));

        if name.is_empty() || !self.files.is_directory(drive, &parts) {
            return Err(ERROR_PATH_NOT_FOUND);
        }

        if self.files.lookup(drive, &parts, &name).is_some()
            || !self.files.make_directory(drive, &parts, &name)
        {
            return Err(ERROR_ACCESS_DENIED);
        }

        Ok(())
    }

    fn remove_directory(&mut self) -> Result<(), u16> {
        let (drive, parts, name) = resolve_file(&self.files, &self.string_at(DS, DX));
        let entry = (!name.is_empty())
            .then(|| self.files.lookup(drive, &parts, &name))
            .flatten();

        if entry.is_none_or(|entry| entry.attributes & 0x10 == 0) {
            return Err(ERROR_PATH_NOT_FOUND);
        }

        let full = format!(
            "{drive}:\\{}\\",
            [parts.clone(), vec![name.clone()]].concat().join("\\")
        );

        if self.files.current(drive).eq_ignore_ascii_case(&full) {
            return Err(ERROR_CURRENT_DIRECTORY);
        }

        let mut inside = parts.clone();

        inside.push(name.clone());

        let held = self
            .files
            .list(drive, &inside)
            .unwrap_or_default()
            .iter()
            .any(|entry| entry.name != "." && entry.name != "..");

        if held || !self.files.unlink(drive, &parts, &name) {
            return Err(ERROR_ACCESS_DENIED);
        }

        Ok(())
    }

    fn change_directory(&mut self) -> Result<(), u16> {
        let (drive, parts) = resolve_directory(&self.files, &self.string_at(DS, DX));

        if !self.files.is_directory(drive, &parts) {
            return Err(ERROR_PATH_NOT_FOUND);
        }

        let mut path = format!("{drive}:\\");

        for part in &parts {
            path.push_str(part);
            path.push('\\');
        }

        self.files.set_current(drive, path);
        Ok(())
    }

    /// A file created, or with `fresh` only where none is there: its handle
    /// in AX.
    fn create(&mut self, fresh: bool) -> Result<(), u16> {
        let (drive, parts, name) = resolve_file(&self.files, &self.string_at(DS, DX));

        if name.is_empty() || !self.files.is_directory(drive, &parts) {
            return Err(ERROR_PATH_NOT_FOUND);
        }

        if fresh && self.files.lookup(drive, &parts, &name).is_some() {
            return Err(ERROR_FILE_EXISTS);
        }

        let path = format!("{drive}:\\{}", [parts, vec![name]].concat().join("\\"));
        let handle = self.files.create(&path).ok_or(ERROR_ACCESS_DENIED)?;

        self.cpu.regs[AX] = handle as u16;
        Ok(())
    }

    fn open_file(&mut self) -> Result<(), u16> {
        let path = self.string_at(DS, DX);
        let handle = self.files.open(&path).ok_or(ERROR_FILE_NOT_FOUND)?;

        self.cpu.regs[AX] = handle as u16;
        Ok(())
    }

    fn close_file(&mut self) -> Result<(), u16> {
        if self.files.close(usize::from(self.cpu.regs[BX])) {
            Ok(())
        } else {
            Err(ERROR_INVALID_HANDLE)
        }
    }

    fn read_file(&mut self) -> Result<(), u16> {
        let handle = usize::from(self.cpu.regs[BX]);
        let buffer = self.pointer(DS, DX);
        let count = usize::from(self.cpu.regs[CX]);
        let bytes = self
            .files
            .resolve(handle)
            .ok_or(ERROR_INVALID_HANDLE)?
            .read(count);

        self.write_far(buffer, &bytes);
        self.cpu.regs[AX] = bytes.len() as u16;
        Ok(())
    }

    fn write_file(&mut self) -> Result<(), u16> {
        let handle = usize::from(self.cpu.regs[BX]);
        let bytes = self.read_far(self.pointer(DS, DX), usize::from(self.cpu.regs[CX]));
        let file = self.files.resolve(handle).ok_or(ERROR_INVALID_HANDLE)?;
        let written = if bytes.is_empty() {
            0
        } else {
            file.write(&bytes)
        };

        self.cpu.regs[AX] = written as u16;
        Ok(())
    }

    fn delete_file(&mut self) -> Result<(), u16> {
        let (drive, parts, name) = resolve_file(&self.files, &self.string_at(DS, DX));

        if !self.files.is_directory(drive, &parts) {
            return Err(ERROR_PATH_NOT_FOUND);
        }

        if self.files.lookup(drive, &parts, &name).is_none()
            || !self.files.unlink(drive, &parts, &name)
        {
            return Err(ERROR_FILE_NOT_FOUND);
        }

        Ok(())
    }

    /// A file's position moved: CX:DX from its start, from where it is, or
    /// from its end, the offset signed as DOS takes it. The TypeScript
    /// engine takes the offset from the end, not adds it.
    fn seek_file(&mut self) -> Result<(), u16> {
        let handle = usize::from(self.cpu.regs[BX]);
        let offset =
            i64::from((u32::from(self.cpu.regs[CX]) << 16 | u32::from(self.cpu.regs[DX])) as i32);
        let basis = self.low(AX);
        let file = self.files.resolve(handle).ok_or(ERROR_INVALID_HANDLE)?;
        let to = match basis {
            0 => SeekFrom::Start(u64::from(offset as u32)),
            1 => SeekFrom::Current(offset),
            _ => SeekFrom::End(offset),
        };
        let at = file.seek(to).unwrap_or(0) as u32;

        self.cpu.regs[DX] = (at >> 16) as u16;
        self.cpu.regs[AX] = at as u16;
        Ok(())
    }

    fn file_attributes(&mut self) -> Result<(), u16> {
        let (drive, parts, name) = resolve_file(&self.files, &self.string_at(DS, DX));

        if !self.files.is_directory(drive, &parts) {
            return Err(ERROR_PATH_NOT_FOUND);
        }

        let entry = self
            .files
            .lookup(drive, &parts, &name)
            .ok_or(ERROR_FILE_NOT_FOUND)?;

        if self.low(AX) == 0 {
            self.cpu.regs[CX] = u16::from(entry.attributes);
            return Ok(());
        }

        let attributes = self.cpu.regs[CX];

        if attributes & !u16::from(SETTABLE) != 0 {
            return Err(ERROR_ACCESS_DENIED);
        }

        self.files.set_attributes(
            drive,
            &parts,
            &name,
            (entry.attributes & 0x10) | attributes as u8,
        );
        Ok(())
    }

    /// The current directory of a drive, without its drive and first
    /// backslash, at DS:SI; AX 0100h, as DOS leaves it.
    fn current_directory(&mut self) -> Result<(), u16> {
        let letter = self.drive_letter(self.low(DX)).ok_or(ERROR_INVALID_DRIVE)?;
        let current = self.files.current(letter);
        let mut bytes = current[3..].trim_end_matches('\\').as_bytes().to_vec();

        bytes.push(0);
        self.write_far(self.pointer(DS, SI), &bytes);
        self.cpu.regs[AX] = 0x0100;
        Ok(())
    }

    fn rename_file(&mut self) -> Result<(), u16> {
        let (drive, parts, name) = resolve_file(&self.files, &self.string_at(DS, DX));
        let (to_drive, to_parts, to_name) = resolve_file(&self.files, &self.string_at(ES, DI));
        let entry = if self.files.is_directory(drive, &parts) && !name.is_empty() {
            self.files.lookup(drive, &parts, &name)
        } else {
            None
        };
        let entry = entry.ok_or(ERROR_FILE_NOT_FOUND)?;

        if drive != to_drive {
            return Err(ERROR_NOT_SAME_DEVICE);
        }

        if !self.files.is_directory(to_drive, &to_parts) || to_name.is_empty() {
            return Err(ERROR_PATH_NOT_FOUND);
        }

        let moved = parts != to_parts;

        if self.files.lookup(to_drive, &to_parts, &to_name).is_some()
            || (entry.attributes & 0x10 != 0 && moved)
            || !self
                .files
                .rename(drive, (&parts, &name), (&to_parts, &to_name))
        {
            return Err(ERROR_ACCESS_DENIED);
        }

        Ok(())
    }

    /// The first entry a search finds, in the transfer area with the
    /// search's state: its drive, its pattern, the attributes asked for,
    /// where it is, and its folder among those searched.
    fn find_first(&mut self) -> Result<(), u16> {
        let spec = self.string_at(DS, DX);
        let slash = [spec.rfind('\\'), spec.rfind('/'), spec.find(':')]
            .into_iter()
            .flatten()
            .max()
            .map_or(0, |at| at + 1);
        let (drive, parts) = resolve_directory(&self.files, &spec[..slash]);
        let name = &spec[slash..];

        if !self.files.is_directory(drive, &parts) {
            return Err(ERROR_PATH_NOT_FOUND);
        }

        let directory = parts.join("\\");
        let index = if let Some(index) = self.searched.iter().position(|one| *one == directory) {
            index
        } else {
            self.searched.push(directory);
            self.searched.len() - 1
        };
        let pattern = eleven_of(if name.is_empty() { "*.*" } else { name });
        let mut state = [0u8; 21];

        state[0] = drive as u8 - 0x40;
        state[1..12].copy_from_slice(&pattern.as_bytes()[..11]);
        state[12] = self.low(CX);
        state[15..17].copy_from_slice(&(index as u16).to_le_bytes());
        self.carry_on(state)
    }

    fn find_next(&mut self) -> Result<(), u16> {
        let (segment, offset) = self.transfer();
        let bytes = self.read_far(u32::from(segment) << 16 | u32::from(offset), 21);
        let mut state = [0u8; 21];

        state.copy_from_slice(&bytes);
        self.carry_on(state)
    }

    fn carry_on(&mut self, mut state: [u8; 21]) -> Result<(), u16> {
        let drive = char::from(state[0] + 0x40);
        let asked = state[12];
        let from = usize::from(u16::from_le_bytes([state[13], state[14]]));
        let directory = self
            .searched
            .get(usize::from(u16::from_le_bytes([state[15], state[16]])))
            .cloned()
            .unwrap_or_default();
        let parts: Vec<String> = if directory.is_empty() {
            Vec::new()
        } else {
            directory.split('\\').map(str::to_string).collect()
        };
        let entries = self.files.list(drive, &parts).unwrap_or_default();

        for (at, entry) in entries.iter().enumerate().skip(from) {
            if admits(asked, entry.attributes) && matches(&state[1..12], &entry.name) {
                state[13..15].copy_from_slice(&(at as u16 + 1).to_le_bytes());
                self.answer_found(&state, entry);
                return Ok(());
            }
        }

        state[13..15].copy_from_slice(&(entries.len() as u16).to_le_bytes());
        Err(ERROR_NO_MORE_FILES)
    }

    fn answer_found(&mut self, state: &[u8; 21], entry: &Entry) {
        let (segment, offset) = self.transfer();
        let [year, month, day, hour, minute, second] = entry.modified;
        let mut record = [0u8; 43];

        record[..21].copy_from_slice(state);
        record[0x15] = entry.attributes;
        record[0x16..0x18].copy_from_slice(&(hour << 11 | minute << 5 | second >> 1).to_le_bytes());
        record[0x18..0x1a]
            .copy_from_slice(&((year.saturating_sub(1980)) << 9 | month << 5 | day).to_le_bytes());
        record[0x1a..0x1e].copy_from_slice(&entry.size.to_le_bytes());

        for (at, byte) in entry.name.bytes().take(12).enumerate() {
            record[0x1e + at] = byte;
        }

        self.write_far(u32::from(segment) << 16 | u32::from(offset), &record);
    }

    /// The clock's milliseconds since its epoch.
    pub fn now_ms(&self) -> i64 {
        self.clock.now(self.instructions) as i64
    }

    /// The date and time it is: year, month, day, hour, minute, second, and
    /// the day of the week, nought a Sunday.
    pub fn date(&self) -> [u16; 7] {
        let ms = self.epoch_ms + self.now_ms();
        let days = ms.div_euclid(86_400_000);
        let of_day = ms.rem_euclid(86_400_000) / 1000;
        let (year, month, day) = civil_from_days(days);
        // 1970-01-01 was a Thursday.
        let weekday = (days + 4).rem_euclid(7);

        [
            year as u16,
            month,
            day,
            (of_day / 3600) as u16,
            (of_day / 60 % 60) as u16,
            (of_day % 60) as u16,
            weekday as u16,
        ]
    }
}
