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

/// A file's position moved as DOSBox moves it (`localFile::Seek`): from
/// its start, where it is, or its end (`basis` 0, 1, 2); a position before
/// the start fails on the host, and DOSBox puts the file at its end
/// instead (**recorded** by `lzfiles`). The new position.
pub(crate) fn dos_seek(file: &mut winbox_machine::OpenFile, offset: i32, basis: u8) -> u32 {
    let current = file.seek(SeekFrom::Current(0)).unwrap_or(0) as i64;
    let size = file.size() as i64;
    let to = match basis {
        0 => i64::from(offset),
        1 => current + i64::from(offset),
        _ => size + i64::from(offset),
    };
    let to = if to < 0 { size } else { to };

    file.seek(SeekFrom::Start(to as u64)).unwrap_or(0) as u32
}

/// When a file was last written as a directory's entry keeps it: the time,
/// hours, minutes and seconds halved, and the date, years from 1980, the
/// month and the day.
pub(crate) fn dos_stamp([year, month, day, hour, minute, second]: [u16; 6]) -> (u16, u16) {
    (
        hour << 11 | minute << 5 | second >> 1,
        year.saturating_sub(1980) << 9 | month << 5 | day,
    )
}

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
    /// `Dos3Call`. A change to a file it makes is noted for `FileCdr`'s
    /// procedure (`kernel_calls/file_cdr.rs`): the path as given, and a
    /// rename's new name.
    pub(crate) fn dos_call(&mut self) -> Result<(), Stop> {
        // Every DOS call is one KERNEL's profiles look again after
        // (`KRNL386.EXE` seg1 `1b68`), and what it writes is written now.
        self.files.touch();
        self.files.now = Some(self.dos_seconds());

        let ax = self.cpu.regs[AX];
        let telling = (self.file_cdr_set() && crate::kernel_calls::tells(ax)).then(|| {
            let path = self.read_string(self.pointer(DS, DX));
            let second = (ax >> 8 == 0x56).then(|| self.read_string(self.pointer(ES, DI)));

            (path, second)
        });

        self.dos_function()?;

        if let Some((path, second)) = telling
            && self.cpu.flags & CARRY == 0
        {
            self.note_file_change(ax, &path, second.as_deref());
        }

        Ok(())
    }

    /// The DOS function AH names, answered. One table, as DOS's is.
    #[allow(clippy::too_many_lines)]
    fn dos_function(&mut self) -> Result<(), Stop> {
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
            // A drive's size and room: DOSBox's geometry for a folder it
            // mounts (`Allocation`). For no drive, FFFFh in AX and the other
            // registers left as they were (`diskfree`).
            0x36 => {
                if let Some(allocation) = self
                    .drive_letter(self.low(DX))
                    .and_then(|letter| self.files.allocation(letter))
                {
                    self.cpu.regs[AX] = allocation.sectors_per_cluster;
                    self.cpu.regs[BX] = allocation.free_clusters;
                    self.cpu.regs[CX] = allocation.bytes_per_sector;
                    self.cpu.regs[DX] = allocation.clusters;
                } else {
                    self.cpu.regs[AX] = 0xffff;
                }
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
            // The task ends: with others left, they run on; with none, and
            // Windows staying up, it waits for the next.
            0x4c => {
                self.exit_code = Some(self.cpu.regs[AX] as u8);

                if self.task_count() > 1 || self.stays_up {
                    self.exit_task(self.cpu.regs[AX] as u8);
                } else {
                    self.ended = true;
                }

                return Err(Stop::Ended);
            }
            0x4e => Some(self.find_first()),
            0x4f => Some(self.find_next()),
            0x56 => Some(self.rename_file()),
            0x57 => match self.low(AX) {
                0 => Some(self.file_stamp()),
                // DOSBox only says it set it: "DOS:57:Set File Date Time
                // Faked" (`dos.cpp`), the file keeping the host's stamp.
                1 => Some(Ok(())),
                _ => {
                    self.unanswered_dos.push(ax);
                    None
                }
            },
            0x5b => Some(self.create(true)),
            0x6c => Some(self.extended_open()),
            _ => match ax {
                0x3305 => {
                    // The boot drive: C:.
                    self.set_low(DX, 3);
                    None
                }
                0x4400 => Some(self.device_information()),
                0x4401 => Some(self.set_device_information()),
                0x4408 | 0x4409 | 0x440d | 0x440e => Some(self.drive_ioctl(ax)),
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

    /// IOCTL of a drive, BL the drive, nought the current one: as DOSBox
    /// answers them (`dos_ioctl.cpp` 41-46, 127-204), **recorded** through
    /// Windows by `drvioctl`. A drive DOS has not got -- a floppy drive
    /// with nothing in it among them (`Files::has_disk`) -- is error 0Fh.
    /// DOSBox's removable drives are its CD-ROMs alone (`isRemovable`),
    /// here a drive removable and remote; A: and B: are its floppies,
    /// whatever is mounted.
    ///
    /// * 4408h: AX 0 (removable) for A: and B:, 1 (fixed) for another, a
    ///   CD-ROM error 1.
    /// * 4409h: DX 1000h for a remote drive, else 0802h; AX 0300h.
    /// * 440Dh: a CD-ROM error 1. CL 60h, get device parameters: special
    ///   functions 3, the type 14h (a 1.44 MB floppy) for A: and B: else 5
    ///   (a fixed disk), the word "not removable", nought cylinders and
    ///   media type, then DOSBox's own drive number and nought where the
    ///   parameter block's bytes per sector begin, and `FFFFFFFFh` at 1Fh; the
    ///   rest as it was. CL 46h or 66h, the media id: DOSBox writes it, but
    ///   through Windows' DOS extender nothing comes back, AX left as it
    ///   was. Another CL, error 1. CH is not looked at.
    /// * 440Eh: a CD-ROM error 1, else AL 0, the drive its own only.
    fn drive_ioctl(&mut self, ax: u16) -> Result<(), u16> {
        let letter = self
            .drive_letter(self.low(BX))
            .filter(|&letter| self.files.has_disk(letter))
            .ok_or(ERROR_INVALID_DRIVE)?;
        let number = letter as u8 - b'A';
        let compact_disc = self.files.removable(letter) && self.files.remote(letter);

        match ax {
            0x4408 if number < 2 => self.cpu.regs[AX] = 0,
            0x4408 if compact_disc => return Err(ERROR_INVALID_FUNCTION),
            0x4408 => self.cpu.regs[AX] = 1,
            0x4409 => {
                self.cpu.regs[DX] = if self.files.remote(letter) {
                    0x1000
                } else {
                    0x0802
                };
                self.cpu.regs[AX] = 0x0300;
            }
            _ if compact_disc => return Err(ERROR_INVALID_FUNCTION),
            0x440e => self.set_low(AX, 0),
            _ => match self.low(CX) {
                0x60 => {
                    let at = self.pointer(DS, DX);
                    let floppy = number < 2;

                    self.write_far(
                        at,
                        &[
                            3,
                            if floppy { 0x14 } else { 5 },
                            u8::from(!floppy),
                            0,
                            0,
                            0,
                            0,
                            number,
                            0,
                        ],
                    );
                    let next = (at & 0xffff_0000) | u32::from((at as u16).wrapping_add(0x1f));

                    self.write_far(next, &[0xff; 4]);
                }
                0x46 | 0x66 => {}
                _ => return Err(ERROR_INVALID_FUNCTION),
            },
        }

        Ok(())
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

    /// 4401h: a device's information set, DX the new, as DOSBox's IOCTL
    /// sets it (`dos_ioctl.cpp`): DH not nought is refused, and a file,
    /// not a device, has none to set. File Manager asks it of each file it
    /// copies, and goes on whatever is answered (`WINFILE.EXE` `1f7ab`).
    fn set_device_information(&mut self) -> Result<(), u16> {
        const ERROR_INVALID_DATA: u16 = 0x0d;

        let handle = self.cpu.regs[BX];
        let file = self.files.resolve(usize::from(handle)).is_some();

        if !file && handle > 4 {
            return Err(ERROR_INVALID_HANDLE);
        }

        if self.cpu.regs[DX] >> 8 != 0 {
            return Err(ERROR_INVALID_DATA);
        }

        if file {
            return Err(ERROR_INVALID_FUNCTION);
        }

        self.set_low(AX, 0xd3);
        Ok(())
    }

    /// 5700h: when a file open was last written, the time in CX and the
    /// date in DX, as a directory's entry has them.
    fn file_stamp(&mut self) -> Result<(), u16> {
        let (time, date) = self
            .handle_stamp(usize::from(self.cpu.regs[BX]))
            .ok_or(ERROR_INVALID_HANDLE)?;

        self.cpu.regs[CX] = time;
        self.cpu.regs[DX] = date;
        Ok(())
    }

    /// When the file a handle has open was last written, the time and the
    /// date as its directory's entry has them; none for a handle that names
    /// no file. `OpenFile` keeps the two in its structure (`openfile`).
    pub(crate) fn handle_stamp(&mut self, handle: usize) -> Option<(u16, u16)> {
        let file = self.files.resolve(handle)?;
        let path = file.dos_path.clone();
        let (drive, parts, name) = resolve_file(&self.files, &path);
        let entry = self.files.lookup(drive, &parts, &name)?;

        Some(dos_stamp(entry.modified))
    }

    /// 6C00h: a file opened, created or replaced, as DOSBox's
    /// `DOS_OpenFileExtended` does it (`dos_files.cpp`): DS:SI its name, BL
    /// the mode it is opened in, CX the attributes it is made with, and DX
    /// what is done -- its low digit where it is there (1 open it, 2
    /// replace it), its high where it is not (1 make it). The handle in AX,
    /// and in CX what was done: 1 opened, 2 made, 3 replaced. File Manager
    /// makes each file it copies to so (`WINFILE.EXE` `1f785`).
    fn extended_open(&mut self) -> Result<(), u16> {
        let action = self.cpu.regs[DX];

        if action == 0 || action & 0x0f > 2 || action & 0xf0 > 0x10 {
            return Err(ERROR_INVALID_FUNCTION);
        }

        let path = self.string_at(DS, SI);
        let (handle, done) = match self.files.open(&path) {
            Some(handle) => match action & 0x0f {
                1 => (handle, 1),
                2 => {
                    self.files.close(handle);
                    (self.make_file(&path, false)?, 3)
                }
                _ => {
                    self.files.close(handle);
                    return Err(ERROR_FILE_EXISTS);
                }
            },
            None if action & 0xf0 == 0 => return Err(ERROR_FILE_NOT_FOUND),
            None => (self.make_file(&path, false)?, 2),
        };

        self.cpu.regs[AX] = handle as u16;
        self.cpu.regs[CX] = done;
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
        let path = self.string_at(DS, DX);

        if self.change_directory_to(&path) {
            Ok(())
        } else {
            Err(ERROR_PATH_NOT_FOUND)
        }
    }

    /// The current directory of a path's drive changed to it, as function
    /// 3Bh changes it: whether it was a directory.
    pub(crate) fn change_directory_to(&mut self, path: &str) -> bool {
        let (drive, parts) = resolve_directory(&self.files, path);

        if !self.files.is_directory(drive, &parts) {
            return false;
        }

        let mut path = format!("{drive}:\\");

        for part in &parts {
            path.push_str(part);
            path.push('\\');
        }

        self.files.set_current(drive, path);
        true
    }

    /// A drive's current directory, its folders from the root.
    pub(crate) fn directory_parts(&self, drive: char) -> Vec<String> {
        resolve_directory(&self.files, &format!("{drive}:")).1
    }

    /// Every entry a search finds, in the order functions 4Eh and 4Fh would
    /// find them, for USER's own calls rather than a program's: none when
    /// the directory is not there.
    pub(crate) fn search_directory(&self, spec: &str, attributes: u8) -> Option<Vec<Entry>> {
        let slash = [spec.rfind('\\'), spec.rfind('/'), spec.find(':')]
            .into_iter()
            .flatten()
            .max()
            .map_or(0, |at| at + 1);
        let (drive, parts) = resolve_directory(&self.files, &spec[..slash]);
        let name = &spec[slash..];

        if !self.files.is_directory(drive, &parts) {
            return None;
        }

        let pattern = eleven_of(if name.is_empty() { "*.*" } else { name });

        Some(
            self.files
                .list(drive, &parts)
                .unwrap_or_default()
                .into_iter()
                .filter(|entry| {
                    admits(attributes, entry.attributes) && matches(pattern.as_bytes(), &entry.name)
                })
                .collect(),
        )
    }

    /// A file created, or with `fresh` only where none is there: its handle
    /// in AX.
    fn create(&mut self, fresh: bool) -> Result<(), u16> {
        let handle = self.make_file(&self.string_at(DS, DX), fresh)?;

        self.cpu.regs[AX] = handle as u16;
        Ok(())
    }

    /// A file's path as DOS places it, against the current drive and its
    /// directory: whole, from its drive's root.
    pub(crate) fn placed_path(&self, path: &str) -> String {
        let (drive, parts, name) = resolve_file(&self.files, path);

        format!("{drive}:\\{}", [parts, vec![name]].concat().join("\\"))
    }

    /// A file created at a path, as functions 3Ch and 5Bh create one --
    /// with `fresh` only where none is there: its handle, or DOS's error.
    pub(crate) fn make_file(&mut self, path: &str, fresh: bool) -> Result<usize, u16> {
        let (drive, parts, name) = resolve_file(&self.files, path);

        if name.is_empty() || !self.files.is_directory(drive, &parts) {
            return Err(ERROR_PATH_NOT_FOUND);
        }

        if fresh && self.files.lookup(drive, &parts, &name).is_some() {
            return Err(ERROR_FILE_EXISTS);
        }

        let path = format!("{drive}:\\{}", [parts, vec![name]].concat().join("\\"));

        self.files.create(&path).ok_or(ERROR_ACCESS_DENIED)
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
        let at = self.linear(buffer);

        // On from DS:DX through the selector's limit, past its first 64 KiB
        // where the block goes on (`lwrhuge`), as the write's are taken.
        self.cpu.bus.write(at, &bytes);
        self.cpu.regs[AX] = bytes.len() as u16;
        Ok(())
    }

    /// DOS's write: the bytes taken on from DS:DX, past offset `FFFFh` where
    /// the selector's block goes on rather than round to its start, as
    /// Windows' DOS takes them (`lwrhuge`).
    fn write_file(&mut self) -> Result<(), u16> {
        let handle = usize::from(self.cpu.regs[BX]);
        let at = self.linear(self.pointer(DS, DX));
        let bytes = self.cpu.bus.read(at, usize::from(self.cpu.regs[CX]));
        let file = self.files.resolve(handle).ok_or(ERROR_INVALID_HANDLE)?;

        // Nought bytes make the file end where it is, and stamp it: DOSBox
        // truncates the host's file there (`localFile::Write`,
        // `drive_local.cpp` 454-468), which moves its stamp. **Recorded**
        // by `dirorder`.
        let written = if bytes.is_empty() {
            if let Some(at) = file.seek(SeekFrom::Current(0)) {
                file.truncate(at);
            }

            0
        } else {
            file.write(&bytes)
        };

        self.cpu.regs[AX] = written as u16;
        Ok(())
    }

    fn delete_file(&mut self) -> Result<(), u16> {
        let path = self.string_at(DS, DX);

        self.delete_path(&path)
    }

    /// A file deleted, as DOS's function 41h deletes one.
    pub(crate) fn delete_path(&mut self, path: &str) -> Result<(), u16> {
        let (drive, parts, name) = resolve_file(&self.files, path);

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
        let at = dos_seek(file, offset as i32, basis.min(2));

        self.cpu.regs[DX] = (at >> 16) as u16;
        self.cpu.regs[AX] = at as u16;
        Ok(())
    }

    /// A drive's current directory as function 47h answers it: without
    /// its drive and first backslash. A removable drive with no disk in it
    /// answers as no drive, as DOSBox's floppy drive does (**recorded** by
    /// `ofnopen`: COMMDLG cannot read drive A:).
    pub(crate) fn directory_of(&self, letter: char) -> Result<String, u16> {
        if !self.files.mounted(letter)
            || (self.files.removable(letter) && self.files.allocation(letter).is_none())
        {
            return Err(ERROR_INVALID_DRIVE);
        }

        Ok(self.files.current(letter)[3..]
            .trim_end_matches('\\')
            .to_string())
    }

    /// A file's attributes, as function 4300h answers them; DOS's error
    /// where it is not there.
    pub(crate) fn attributes_of(&self, path: &str) -> Result<u8, u16> {
        let (drive, parts, name) = resolve_file(&self.files, path);

        if !self.files.is_directory(drive, &parts) {
            return Err(ERROR_PATH_NOT_FOUND);
        }

        self.files
            .lookup(drive, &parts, &name)
            .map(|entry| entry.attributes)
            .ok_or(ERROR_FILE_NOT_FOUND)
    }

    /// A drive's volume label, as DOS's search for one answers it: none
    /// for a removable drive, `DOSBOX` for DOSBox's own drive Z:, and
    /// `C_DRIVE` and the like for a folder it mounts, as DOSBox names
    /// them. **Recorded** by `ofnopen`: COMMDLG's drives' list shows
    /// `c: c_drive` and `z: dosbox`.
    pub(crate) fn volume_label(&self, letter: char) -> Option<String> {
        if let Some(label) = self.files.label(letter) {
            return Some(label);
        }

        if !self.files.mounted(letter) || self.files.removable(letter) {
            return None;
        }

        Some(if letter == 'Z' {
            "DOSBOX".to_string()
        } else {
            format!("{letter}_DRIVE")
        })
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
        let mut bytes = self.directory_of(letter)?.into_bytes();

        bytes.push(0);
        self.write_far(self.pointer(DS, SI), &bytes);
        self.cpu.regs[AX] = 0x0100;
        Ok(())
    }

    fn rename_file(&mut self) -> Result<(), u16> {
        let from = self.string_at(DS, DX);
        let to = self.string_at(ES, DI);

        self.rename_path(&from, &to)
    }

    /// A file or folder renamed, or moved to another folder, as DOSBox's
    /// `DOS_Rename` renames one (`dos_files.cpp` 263-296): another drive is
    /// error 11h; a name there already, file or folder, 5; nothing to
    /// rename, 2; and a rename the host refuses -- into a folder not there,
    /// a folder into itself -- 2 as well. A folder moves with all it holds.
    /// **Recorded** by `dirorder`.
    fn rename_path(&mut self, from: &str, to: &str) -> Result<(), u16> {
        let (drive, parts, name) = resolve_file(&self.files, from);
        let (to_drive, to_parts, to_name) = resolve_file(&self.files, to);
        let found = |files: &Files, drive: char, parts: &[String], name: &str| {
            if files.is_directory(drive, parts) && !name.is_empty() {
                files.lookup(drive, parts, name)
            } else {
                None
            }
        };

        if drive != to_drive {
            return Err(ERROR_NOT_SAME_DEVICE);
        }

        if found(&self.files, to_drive, &to_parts, &to_name).is_some() {
            return Err(ERROR_ACCESS_DENIED);
        }

        let entry = found(&self.files, drive, &parts, &name).ok_or(ERROR_FILE_NOT_FOUND)?;
        let source = [parts.clone(), vec![name.clone()]].concat();
        let into_itself = entry.attributes & 0x10 != 0
            && to_parts.len() >= source.len()
            && to_parts
                .iter()
                .zip(&source)
                .all(|(a, b)| a.eq_ignore_ascii_case(b));

        if !self.files.is_directory(to_drive, &to_parts)
            || to_name.is_empty()
            || into_itself
            || !self
                .files
                .rename(drive, (&parts, &name), (&to_parts, &to_name))
        {
            return Err(ERROR_FILE_NOT_FOUND);
        }

        Ok(())
    }

    /// A file renamed by `INT 21h` function 56h from a module's own code,
    /// as MMSYSTEM's DOS procedure renames one. Not followed: `FileCdr`'s
    /// procedure told of it.
    pub(crate) fn rename_names(&mut self, from: &[u8], to: &[u8]) -> Result<(), u16> {
        let text = |bytes: &[u8]| {
            bytes
                .iter()
                .map(|&byte| char::from(byte))
                .collect::<String>()
        };

        self.rename_path(&text(from), &text(to))
    }

    /// The first entry a search finds, in the transfer area with the
    /// search's state: its drive, its pattern, the attributes asked for,
    /// and its number among the searches (`Searches`).
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

        let names = self
            .files
            .list(drive, &parts)
            .unwrap_or_default()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        let number = self.searches.begin(Search {
            drive,
            parts,
            names,
            at: 0,
        });
        let pattern = eleven_of(if name.is_empty() { "*.*" } else { name });
        let mut state = [0u8; 21];

        state[0] = drive as u8 - 0x40;
        state[1..12].copy_from_slice(&pattern.as_bytes()[..11]);
        state[12] = self.low(CX);
        state[13..15].copy_from_slice(&number.to_le_bytes());
        self.carry_on(state)
    }

    fn find_next(&mut self) -> Result<(), u16> {
        let (segment, offset) = self.transfer();
        let bytes = self.read_far(u32::from(segment) << 16 | u32::from(offset), 21);
        let mut state = [0u8; 21];

        state.copy_from_slice(&bytes);
        self.carry_on(state)
    }

    /// The search carried on through the names it began with: each that
    /// matches looked for again as the folder is now, one gone passed over,
    /// as DOSBox's `localDrive::FindNext` stats each (`drive_local.cpp`
    /// 231-280). Its last name passed, the search is over.
    fn carry_on(&mut self, state: [u8; 21]) -> Result<(), u16> {
        let asked = state[12];
        let number = u16::from_le_bytes([state[13], state[14]]);
        let Some(search) = self.searches.get(number) else {
            return Err(ERROR_NO_MORE_FILES);
        };
        let (drive, parts) = (search.drive, search.parts.clone());
        let entries = self.files.list(drive, &parts).unwrap_or_default();

        while let Some(search) = self.searches.get(number)
            && let Some(name) = search.names.get(search.at).cloned()
        {
            search.at += 1;

            if !matches(&state[1..12], &name) {
                continue;
            }

            if let Some(entry) = entries.iter().find(|entry| entry.name == name)
                && admits(asked, entry.attributes)
            {
                self.answer_found(&state, entry);
                return Ok(());
            }
        }

        self.searches.end(number);
        Err(ERROR_NO_MORE_FILES)
    }

    fn answer_found(&mut self, state: &[u8; 21], entry: &Entry) {
        let (segment, offset) = self.transfer();
        let (time, date) = dos_stamp(entry.modified);
        let mut record = [0u8; 43];

        record[..21].copy_from_slice(state);
        record[0x15] = entry.attributes;
        record[0x16..0x18].copy_from_slice(&time.to_le_bytes());
        record[0x18..0x1a].copy_from_slice(&date.to_le_bytes());
        record[0x1a..0x1e].copy_from_slice(&entry.size.to_le_bytes());

        for (at, byte) in entry.name.bytes().take(12).enumerate() {
            record[0x1e + at] = byte;
        }

        self.write_far(u32::from(segment) << 16 | u32::from(offset), &record);
    }

    /// DOS's clock, seconds since 1970: what a file written is stamped
    /// with.
    pub(crate) fn dos_seconds(&self) -> i64 {
        (self.epoch_ms + self.now_ms()).div_euclid(1000)
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

/// The most searches open at once: DOSBox's `MAX_OPENDIRS`
/// (`dos_system.h` 124).
const MAX_SEARCHES: usize = 2048;

/// One search: its folder, and the names the folder had as the search
/// began, in DOSBox's order, and how far through them it is. DOSBox copies
/// the folder's names as a search begins (`DOS_Drive_Cache::FindFirst`,
/// `drive_cache.cpp` 777-826): a file made while it is open is not found by
/// it, and one deleted is passed over. **Recorded** by `dirorder`.
#[derive(Debug, Clone)]
pub struct Search {
    drive: char,
    parts: Vec<String>,
    names: Vec<String>,
    at: usize,
}

/// DOS's searches, by the number a search's state keeps, as DOSBox keeps
/// them: each begun in the next number free after the last, round from the
/// first, and freed once it is over; with none free, all are let go and
/// the first is taken (`drive_cache.cpp` 783-805).
#[derive(Debug, Clone, Default)]
pub struct Searches {
    open: Vec<Option<Search>>,
    next: usize,
}

impl Searches {
    fn begin(&mut self, search: Search) -> u16 {
        if self.open.is_empty() {
            self.open = vec![None; MAX_SEARCHES];
        }

        let mut tried = 0;

        while tried < MAX_SEARCHES && self.open[self.next].is_some() {
            self.next = (self.next + 1) % MAX_SEARCHES;
            tried += 1;
        }

        let mut number = self.next;

        self.next = (self.next + 1) % MAX_SEARCHES;

        if tried == MAX_SEARCHES {
            self.open.iter_mut().for_each(|one| *one = None);
            number = 0;
            self.next = 1;
        }

        self.open[number] = Some(search);
        number as u16
    }

    fn get(&mut self, number: u16) -> Option<&mut Search> {
        self.open.get_mut(usize::from(number))?.as_mut()
    }

    fn end(&mut self, number: u16) {
        if let Some(one) = self.open.get_mut(usize::from(number)) {
            *one = None;
        }
    }
}
