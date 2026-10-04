//! A directory listed into a list box or a combo box, and an entry chosen
//! from one turned back into a path: `DlgDirList`, `DlgDirListComboBox`,
//! `LB_DIR`, `CB_DIR`, `LB_ADDFILE` and the `DlgDirSelect` family --
//! winbox.js's `dlgdir.ts`.
//!
//! **Read out of `USER.EXE`**, seg37, which asks DOS for all of it through
//! INT 21h: the drive (0Eh, 19h), the directory (3Bh, 47h), and the entries
//! (1Ah, 4Eh, 4Fh). Here those are DOS's own code, called directly.
//!
//! An entry's text: a directory's name in brackets, `[system]`, `[..]`; a
//! file's bare, `readme.txt`; a drive's letter between dashes in brackets,
//! `[-c-]`. Each is lowered, a name through `OemToAnsi` first, as DOS names
//! are OEM characters.
//!
//! Not followed, as the TypeScript engine does not follow them: a negative
//! static control identifier, which asks for the entries with their size,
//! date, time and attributes after tabs (seg37 `01f2`, `0a7d`); and the disk
//! transfer area `LB_DIR` leaves pointing into USER's own data (seg37
//! `e17`), where this leaves the program's alone.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::control_host::{bytes_of, text_of};
use crate::engine::Engine;
use crate::keyboard::translate_bytes;
use crate::listbox::{
    LB_ADDFILE, LB_ADDSTRING, LB_DIR, LB_GETCURSEL, LB_INSERTSTRING, ListAnswer, ListArg,
};
use crate::messages::{Param, WM_SETTEXT};
use crate::system::System;
use crate::user_misc::{ansi_lower_byte, ansi_upper_byte};

const DDL_DIRECTORY: u16 = 0x0010;
const DDL_POSTMSGS: u16 = 0x2000;
const DDL_DRIVES: u16 = 0x4000;
const DDL_EXCLUSIVE: u16 = 0x8000;

const WM_SETREDRAW: u16 = 0x000b;
const WM_GETFONT: u16 = 0x0031;
const LB_RESETCONTENT: u16 = 0x0405;
const CB_DIR: u16 = 0x0405;
const CB_RESETCONTENT: u16 = 0x040b;

/// `LB_ERRSPACE`, which ends a listing.
const ERRSPACE: i32 = -2;

/// What the list's `LB_DIR` is handed for its spec.
enum Spec {
    /// The program's string, by its far pointer.
    Far(u32),
    /// `*.*`, USER's own.
    All,
}

fn lower(text: &[u8]) -> Vec<u8> {
    text.iter().map(|&byte| ansi_lower_byte(byte)).collect()
}

fn upper(text: &[u8]) -> Vec<u8> {
    text.iter().map(|&byte| ansi_upper_byte(byte)).collect()
}

/// A string and its nought.
fn terminated(text: &[u8]) -> Vec<u8> {
    let mut bytes = text.to_vec();

    bytes.push(0);
    bytes
}

/// A DOS entry's name as a list shows it: a directory's in brackets, made
/// ANSI and lowered.
fn entry_text(name: &str, attributes: u8) -> Vec<u8> {
    let name = if u16::from(attributes) & DDL_DIRECTORY != 0 {
        format!("[{name}]")
    } else {
        name.to_string()
    };

    lower(&translate_bytes(false, &bytes_of(&name)))
}

impl System {
    /// A drive made current where it is there, as DOS's function 0Eh makes
    /// one (`selectDisk`).
    fn select_disk(&mut self, index: i32) {
        if let Ok(index) = u8::try_from(index)
            && index < 26
            && self.files.mounted(char::from(b'A' + index))
        {
            self.files.drive = char::from(b'A' + index);
        }
    }
}

impl Engine {
    /// An entry added to a list box as `LB_ADDSTRING` adds it -- sorted, as
    /// it sorts -- or appended as `LB_INSERTSTRING` at -1 appends: its
    /// index, or the error, as a signed word.
    async fn add_entry(
        &self,
        hwnd: u16,
        index: usize,
        text: Vec<u8>,
        append: bool,
    ) -> Result<i32, Stop> {
        let (message, wparam) = if append {
            (LB_INSERTSTRING, 0xffff)
        } else {
            (LB_ADDSTRING, 0)
        };
        let answer = self
            .list_message(hwnd, index, message, wparam, ListArg::Text(text))
            .await?;

        Ok(match answer {
            Some(ListAnswer::Number(number)) => i32::from(number as u16 as i16),
            _ => -1,
        })
    }

    /// `LB_DIR` and `LB_ADDFILE` to a list box: the entries added, and the
    /// list painted again if it changed. `LB_ADDFILE`, or a listing that ran
    /// out of room, answers what the last addition answered; `LB_DIR` the
    /// index of the last item. Either as a word, not widened.
    pub(crate) async fn list_directory(
        &self,
        hwnd: u16,
        index: usize,
        message: u16,
        wparam: u16,
        lparam: &mut Param,
    ) -> Result<u32, Stop> {
        let spec = self.system().message_string(lparam);
        let answer = if message == LB_DIR {
            self.fill_directory(hwnd, index, wparam, &spec).await?
        } else {
            self.add_file(hwnd, index, &spec).await?
        };
        let mut system = self.system();

        if std::mem::replace(&mut system.control_at(index).invalid, false) {
            let window = system.control_window_mut(index);

            window.needs_erase = true;
            window.needs_paint = true;
        }

        if message == LB_ADDFILE || answer == ERRSPACE {
            return Ok(answer as u32 & 0xffff);
        }

        Ok((system.control_at(index).items.len() as u32).wrapping_sub(1) & 0xffff)
    }

    /// A list filled with a directory's entries (seg37 `0832`), and the
    /// drives, if asked for, appended after them. The bits of `attributes`
    /// that DOS knows choose what it finds; with `DDL_EXCLUSIVE`, only what
    /// has one of the attributes asked for is kept, so that ordinary files
    /// are not. The entry `.` is never kept. Answers the last addition's
    /// answer, or -1 for none.
    async fn fill_directory(
        &self,
        hwnd: u16,
        index: usize,
        attributes: u16,
        spec: &[u8],
    ) -> Result<i32, Stop> {
        let mut answer = -1;
        let mut asked = attributes;

        if asked != DDL_DRIVES | DDL_EXCLUSIVE {
            let found = {
                let system = self.system();
                let oem = translate_bytes(true, &spec[..spec.len().min(0x80)]);

                system.search_directory(&text_of(&oem), (asked & 0x5fff) as u8)
            };

            if let Some(found) = found {
                asked ^= DDL_EXCLUSIVE;

                for info in found {
                    let kind = u16::from(info.attributes);

                    if asked & (kind | DDL_EXCLUSIVE) == 0
                        || (kind & DDL_DIRECTORY != 0 && info.name == ".")
                    {
                        continue;
                    }

                    answer = self
                        .add_entry(hwnd, index, entry_text(&info.name, info.attributes), false)
                        .await?;

                    if answer < -1 {
                        break;
                    }
                }
            }
        }

        // Each drive letter DOS will make current (seg37 `0943`), in order.
        if answer != ERRSPACE && attributes & DDL_DRIVES != 0 {
            for letter in b'A'..=b'Z' {
                if !self.system().files.mounted(char::from(letter)) {
                    continue;
                }

                let text = lower(&[b'[', b'-', letter, b'-', b']']);

                answer = self.add_entry(hwnd, index, text, true).await?;

                if answer < 0 {
                    break;
                }
            }
        }

        Ok(answer)
    }

    /// A single file's entry, added (seg37 `0a1a`): the index, or -1 when
    /// there is none.
    async fn add_file(&self, hwnd: u16, index: usize, spec: &[u8]) -> Result<i32, Stop> {
        let found = {
            let system = self.system();
            let oem = translate_bytes(true, &spec[..spec.len().min(0x80)]);

            system
                .search_directory(&text_of(&oem), 0x0f)
                .and_then(|found| found.into_iter().next())
        };
        let Some(info) = found else {
            return Ok(-1);
        };

        self.add_entry(hwnd, index, entry_text(&info.name, info.attributes), false)
            .await
    }

    /// A path made to fit a static control (seg37 `0000`): as it is if it
    /// fits; else its drive and `\...\` and as many of its last parts as fit
    /// after them; else the drive and `\...` alone. Measured in the
    /// control's font, in a device context of its own.
    async fn fit_path(&self, hwnd: u16, path: &[u8]) -> Result<Vec<u8>, Stop> {
        let (width, hdc) = {
            let mut system = self.system();
            let width = system
                .window_named(hwnd)
                .and_then(|index| system.windows[index].as_ref())
                .map_or(0, crate::windows::Window::client_width);

            (width, system.get_dc(hwnd))
        };
        let font = self
            .send_message(hwnd, WM_GETFONT, 0, &mut Param::Value(0))
            .await?;
        let mut guard = self.system();
        let system = &mut *guard;

        if font != 0 {
            crate::gdi::dc::select_object(system, hdc, font as u16);
        }

        let fitted = fitted(system, hdc, width, path);

        system.release_dc(hwnd, hdc)?;
        fitted
    }

    /// `DlgDirList` and `DlgDirListComboBox` (seg37 `0150`): a path taken
    /// apart and gone to, the current directory shown, the list filled.
    ///
    /// The path, upper-cased where it lies, may begin with a drive, which is
    /// made current, and may end with a file name. Without a wildcard `*` it
    /// is tried as a directory first. Otherwise it must hold a wildcard, or
    /// end in `\`, or nothing is done; the directory before its last
    /// separator is gone to, and the name after it -- `*.*` when there is
    /// none -- is written back over the path. Answers FALSE when the path
    /// would not do.
    ///
    /// The static control is given the drive and directory, lowered,
    /// shortened to fit. The list is emptied and given the files as
    /// `uFileType` asks, less the directories and drives, which come after
    /// in a pass of their own with `*.*` and `DDL_EXCLUSIVE`, so that they
    /// are listed whatever the name asked for.
    #[allow(clippy::too_many_lines)]
    async fn dir_list(
        &self,
        dialog: u16,
        far: u32,
        list_id: u16,
        static_id: u16,
        file_type: u16,
        is_list: bool,
    ) -> Result<u16, Stop> {
        let (dialog, list, static_id, drive, wild, spec) = {
            let mut guard = self.system();
            let system = &mut *guard;
            let dialog = if system.handles.resolve(dialog).is_some() {
                dialog
            } else {
                0
            };

            if dialog == 0 && (static_id != 0 || list_id != 0) {
                return Ok(0);
            }

            let list = if list_id == 0 {
                0
            } else {
                system.dlg_item(dialog, list_id)
            };

            // A negative identifier asks for the entries' details, which
            // are not followed.
            let static_id = if static_id & 0x8000 != 0 {
                0
            } else {
                static_id
            };
            let current = system.files.drive;
            let current_index = i32::from(current as u8) - 0x41;
            let mut drive = current;
            let mut wild = true;
            let mut spec = Spec::Far(far);
            let text = if far == 0 {
                Vec::new()
            } else {
                system.read_string(far)
            };

            if far != 0 && !text.is_empty() {
                if text.len() > 0x80 {
                    return Ok(0);
                }

                let upper_text = upper(&text);

                system.write_far(far, &terminated(&upper_text));

                let mut path = translate_bytes(true, &upper_text);

                if path.get(1) == Some(&b':') {
                    let index = i32::from(path[0]) - 0x41;

                    system.select_disk(index);

                    let there = u8::try_from(index)
                        .ok()
                        .filter(|&index| index < 26)
                        .is_some_and(|index| system.files.mounted(char::from(b'A' + index)));

                    if !there {
                        system.select_disk(current_index);
                        return Ok(0);
                    }

                    drive = char::from(path[0]);
                    path.drain(..2);
                }

                let done = !path.is_empty()
                    && !path.contains(&b'*')
                    && system.change_directory_to(&text_of(&path));
                let mut name = b"*.*".to_vec();

                if !path.is_empty() && !done {
                    wild = path.ends_with(b"\\");

                    let mut separator = None;

                    for at in (0..path.len()).rev() {
                        match path[at] {
                            b'\\' | b'/' | b':' => {
                                separator = Some(at);
                                break;
                            }
                            b'*' | b'?' => wild = true,
                            _ => {}
                        }
                    }

                    if !wild {
                        system.select_disk(current_index);
                        return Ok(0);
                    }

                    if let Some(separator) = separator {
                        let directory = if separator == 0 {
                            &path[..1]
                        } else {
                            &path[..separator]
                        };

                        if !system.change_directory_to(&text_of(directory)) {
                            system.select_disk(current_index);
                            return Ok(0);
                        }
                    }

                    name = path[separator.map_or(0, |at| at + 1)..].to_vec();
                }

                system.write_far(far, &terminated(&translate_bytes(false, &name)));
            } else if far != 0 {
                spec = Spec::All;
            }

            (dialog, list, static_id, drive, wild, spec)
        };

        if static_id != 0 {
            let (path, control) = {
                let system = self.system();
                let parts = system.directory_parts(drive);
                let path = format!("{drive}:\\{}", parts.join("\\"));

                (
                    lower(&translate_bytes(false, &bytes_of(&path))),
                    system.dlg_item(dialog, static_id),
                )
            };
            let fitted = self.fit_path(control, &path).await?;

            self.send_message(
                control,
                WM_SETTEXT,
                0,
                &mut Param::Struct(terminated(&fitted)),
            )
            .await?;
        }

        if !(wild && list_id != 0 && self.system().handles.resolve(list).is_some()) {
            return Ok(u16::from(wild));
        }

        let post = file_type & DDL_POSTMSGS != 0;
        let (reset, dir) = if is_list {
            (LB_RESETCONTENT, LB_DIR)
        } else {
            (CB_RESETCONTENT, CB_DIR)
        };
        let mut kind = file_type;

        if kind == DDL_DRIVES {
            kind |= DDL_EXCLUSIVE;
        }

        let files_pass = kind != DDL_DRIVES | DDL_EXCLUSIVE;
        let files = kind & !(DDL_DRIVES | DDL_DIRECTORY) & !if post { DDL_POSTMSGS } else { 0 };
        let others = if files_pass {
            kind & (DDL_DRIVES | DDL_DIRECTORY)
        } else {
            kind
        };

        // `*.*` is handed to the list as a string of USER's own, which a
        // message posted cannot carry here: the TypeScript engine posts its
        // text, which no program's queue holds.
        if post && (others != 0 || (files_pass && matches!(spec, Spec::All))) {
            return Err(Stop::Unsupported("DlgDirList posting *.* to its list"));
        }

        let all = || Param::Struct(b"*.*\0".to_vec());

        if post {
            let mut system = self.system();

            system.post_message(list, reset, 0, 0);

            if let (true, Spec::Far(far)) = (files_pass, &spec) {
                system.post_message(list, dir, files, *far);
            }

            return Ok(1);
        }

        self.send_message(list, WM_SETREDRAW, 0, &mut Param::Value(0))
            .await?;
        self.send_message(list, reset, 0, &mut Param::Value(0))
            .await?;

        if files_pass {
            let mut lparam = match spec {
                Spec::Far(far) => Param::Value(far),
                Spec::All => all(),
            };

            self.send_message(list, dir, files, &mut lparam).await?;
        }

        if others != 0 {
            self.send_message(list, dir, others | DDL_EXCLUSIVE, &mut all())
                .await?;
        }

        self.send_message(list, WM_SETREDRAW, 1, &mut Param::Value(0))
            .await?;

        let mut system = self.system();

        if let Some(index) = system.window_named(list) {
            system.invalidate(index, None, true);
        }

        Ok(1)
    }

    /// The selected entry as a path (seg37 `066a`): a directory's brackets
    /// become a `\` after it, a drive's `[-c-]` becomes `c:`, and a file
    /// name without a dot is given one -- cut to `limit` with its nought, at
    /// most 128, and written. Answers whether it was a directory or a drive;
    /// FALSE, and nothing written, with nothing selected.
    async fn dir_select(&self, list: u16, far: u32, limit: i32) -> Result<u16, Stop> {
        let selected = self
            .send_message(list, LB_GETCURSEL, 0, &mut Param::Value(0))
            .await?;
        let mut system = self.system();
        let Some(index) = system.window_named(list).filter(|_| selected & 0x8000 == 0) else {
            return Ok(0);
        };
        let item = system.windows[index]
            .as_ref()
            .and_then(|window| window.control.as_ref())
            .and_then(|control| control.items.get(selected as usize))
            .map(|item| bytes_of(item))
            .unwrap_or_default();
        let mut text: Vec<u8> = item
            .split(|&byte| byte == b'\t')
            .next()
            .unwrap_or(&[])
            .to_vec();
        let directory = text.first() == Some(&b'[');

        if directory {
            text = if text.get(1) == Some(&b'-') {
                // The letter, where there is one: an item of a program's own
                // `[-` has none, which the TypeScript engine writes as
                // `undefined`.
                let mut drive: Vec<u8> = text.get(2).copied().into_iter().collect();

                drive.push(b':');
                drive
            } else {
                // Between the brackets, as JavaScript's `substring` takes
                // its ends: the other way about for a lone `[`.
                let (from, to) = (1, text.len().saturating_sub(1));
                let mut name = text[from.min(to)..from.max(to).min(text.len())].to_vec();

                name.push(b'\\');
                name
            };
        } else if !text.contains(&b'.') {
            text.push(b'.');
        }

        let room = usize::try_from(limit.min(0x80) - 1).unwrap_or(0);

        text.truncate(room);
        system.write_far(far, &terminated(&text));
        Ok(u16::from(directory))
    }

    /// The list inside a dialog's combo box.
    fn combo_list(&self, dialog: u16, id: u16) -> u16 {
        let system = self.system();
        let combo = system.dlg_item(dialog, id);

        system
            .window_named(combo)
            .and_then(|index| system.windows[index].as_ref())
            .and_then(|window| window.control.as_ref())
            .and_then(|control| control.combo)
            .map_or(0, |combo| combo.list_box)
    }
}

/// The path as it fits, measured in a device context.
fn fitted(system: &mut System, hdc: u16, width: i32, path: &[u8]) -> Result<Vec<u8>, Stop> {
    let mut measure = |text: &[u8]| -> Result<i32, Stop> {
        Ok(
            (crate::gdi::text::get_text_extent(system, hdc, text, text.len() as i32)? & 0xffff)
                as i32,
        )
    };

    if measure(path)? <= width {
        return Ok(path.to_vec());
    }

    let mut prefix = vec![path.first().copied().unwrap_or(0)];

    prefix.extend_from_slice(b":\\...\\");

    let room = width - measure(&prefix)?;
    let mut at = path
        .iter()
        .skip(3)
        .position(|&byte| byte == b'\\')
        .map(|at| at + 3);

    while let Some(slash) = at {
        let tail = &path[slash + 1..];

        if measure(tail)? <= room {
            return Ok([prefix.as_slice(), tail].concat());
        }

        at = path[slash + 1..]
            .iter()
            .position(|&byte| byte == b'\\')
            .map(|next| slash + 1 + next);
    }

    prefix.pop();
    Ok(prefix)
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Async(match name {
        "DlgDirList" => dlg_dir_list,
        "DlgDirListComboBox" => dlg_dir_list_combo_box,
        "DlgDirSelect" => dlg_dir_select,
        "DlgDirSelectEx" => dlg_dir_select_ex,
        "DlgDirSelectComboBox" => dlg_dir_select_combo_box,
        "DlgDirSelectComboBoxEx" => dlg_dir_select_combo_box_ex,
        _ => return None,
    }))
}

/// The arguments both listing calls take: the dialog, the path, the list's
/// and the static control's identifiers, and the file type.
fn list_args(engine: &Engine, args: &mut Args) -> (u16, u32, u16, u16, u16) {
    let system = engine.system();

    (
        args.word(&system),
        args.dword(&system),
        args.word(&system),
        args.word(&system),
        args.word(&system),
    )
}

fn dlg_dir_list(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, far, list, path, kind) = list_args(engine, &mut args);

        Ok(Answer::Word(
            engine.dir_list(dialog, far, list, path, kind, true).await?,
        ))
    })
}

fn dlg_dir_list_combo_box(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, far, combo, path, kind) = list_args(engine, &mut args);

        Ok(Answer::Word(
            engine
                .dir_list(dialog, far, combo, path, kind, false)
                .await?,
        ))
    })
}

/// The arguments the choosing calls take: the dialog, the string, its
/// size if given, and the control's identifier.
fn select_args(engine: &Engine, args: &mut Args, sized: bool) -> (u16, u32, i32, u16) {
    let system = engine.system();
    let dialog = args.word(&system);
    let far = args.dword(&system);
    let limit = if sized {
        i32::from(args.signed(&system))
    } else {
        0x10000
    };

    (dialog, far, limit, args.word(&system))
}

fn dlg_dir_select(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, far, limit, id) = select_args(engine, &mut args, false);
        let list = engine.system().dlg_item(dialog, id);

        Ok(Answer::Word(engine.dir_select(list, far, limit).await?))
    })
}

fn dlg_dir_select_ex(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, far, limit, id) = select_args(engine, &mut args, true);
        let list = engine.system().dlg_item(dialog, id);

        Ok(Answer::Word(engine.dir_select(list, far, limit).await?))
    })
}

fn dlg_dir_select_combo_box(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, far, limit, id) = select_args(engine, &mut args, false);
        let list = engine.combo_list(dialog, id);

        Ok(Answer::Word(engine.dir_select(list, far, limit).await?))
    })
}

fn dlg_dir_select_combo_box_ex(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (dialog, far, limit, id) = select_args(engine, &mut args, true);
        let list = engine.combo_list(dialog, id);

        Ok(Answer::Word(engine.dir_select(list, far, limit).await?))
    })
}
