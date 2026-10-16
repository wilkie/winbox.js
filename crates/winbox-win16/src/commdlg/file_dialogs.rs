//! `GetOpenFileName` and `GetSaveFileName`: COMMDLG's Open and Save As
//! boxes, and the procedures they run, WinBox's own. As
//! `src/win16/commdlg/file-dialogs.ts`.
//!
//! **Read out of `COMMDLG.DLL`** seg2, and **recorded** by `ofnerr` and
//! `ofnopen`: the common start (`09eb`), `FileOpenDlgProc` and
//! `FileSaveDlgProc` (`42a3`, `446a`), their `WM_INITDIALOG` (`1153`),
//! `WM_COMMAND` (`31f4`) and OK (`22e7`), the lists (`039b`, `0180`), the
//! drives (`4827`), and the owner-drawn items (`4dcc`, `4e8a`). Each step
//! asks KERNEL, USER and GDI what the file asks them (`api.rs`), in its
//! order. The templates and strings are WinBox's own (`resources.rs`); the
//! folders' and drives' pictures are the installation's `COMMDLG.DLL`'s,
//! read as data, and are not drawn without it.

use std::collections::HashMap;

use super::api::{self, Arg};
use super::resources::{FILE_OPEN_DIALOG, MULTI_FILE_OPEN_DIALOG, string};
use crate::call::{Answer, Args, Later, Stop};
use crate::dialog_template::{DialogTemplate, parse_dialog_template};
use crate::dialogs::DialogProc;
use crate::engine::Engine;
use crate::menus::MenuName;

// OPENFILENAME's fields, by their offsets.
pub(super) const LSTRUCTSIZE: u32 = 0x00;
pub(super) const HWNDOWNER: u32 = 0x04;
pub(super) const HINSTANCE: u32 = 0x06;
pub(super) const LPSTRFILTER: u32 = 0x08;
pub(super) const LPSTRCUSTOMFILTER: u32 = 0x0c;
pub(super) const NMAXCUSTFILTER: u32 = 0x10;
pub(super) const NFILTERINDEX: u32 = 0x14;
pub(super) const LPSTRFILE: u32 = 0x18;
pub(super) const NMAXFILE: u32 = 0x1c;
pub(super) const LPSTRFILETITLE: u32 = 0x20;
pub(super) const NMAXFILETITLE: u32 = 0x24;
pub(super) const LPSTRINITIALDIR: u32 = 0x28;
pub(super) const LPSTRTITLE: u32 = 0x2c;
pub(super) const FLAGS: u32 = 0x30;
pub(super) const NFILEOFFSET: u32 = 0x34;
pub(super) const NFILEEXTENSION: u32 = 0x36;
pub(super) const LPSTRDEFEXT: u32 = 0x38;
pub(super) const LPFNHOOK: u32 = 0x40;
pub(super) const LPTEMPLATENAME: u32 = 0x44;

// Its flags.
pub(super) const OFN_READONLY: u32 = 0x0001;
pub(super) const OFN_OVERWRITEPROMPT: u32 = 0x0002;
pub(super) const OFN_HIDEREADONLY: u32 = 0x0004;
pub(super) const OFN_NOCHANGEDIR: u32 = 0x0008;
pub(super) const OFN_SHOWHELP: u32 = 0x0010;
pub(super) const OFN_ENABLEHOOK: u32 = 0x0020;
pub(super) const OFN_ENABLETEMPLATE: u32 = 0x0040;
pub(super) const OFN_ENABLETEMPLATEHANDLE: u32 = 0x0080;
pub(super) const OFN_NOVALIDATE: u32 = 0x0100;
pub(super) const OFN_ALLOWMULTISELECT: u32 = 0x0200;
pub(super) const OFN_EXTENSIONDIFFERENT: u32 = 0x0400;
pub(super) const OFN_PATHMUSTEXIST: u32 = 0x0800;
pub(super) const OFN_FILEMUSTEXIST: u32 = 0x1000;
pub(super) const OFN_CREATEPROMPT: u32 = 0x2000;
pub(super) const OFN_SHAREAWARE: u32 = 0x4000;
pub(super) const OFN_NOREADONLYRETURN: u32 = 0x8000;
pub(super) const OFN_NOTESTFILECREATE: u32 = 0x0001_0000;
/// The types', the drives' combo box dropped, and the folders' selection
/// moved but not taken: kept in the program's flags (seg2 `3925`, `3df9`,
/// `3bdd`), and cleared as the dialog starts (seg2 `138d`).
pub(super) const TYPES_DROPPED: u32 = 0x1000_0000;
pub(super) const DRIVES_DROPPED: u32 = 0x2000_0000;
pub(super) const FOLDER_MOVED: u32 = 0x4000_0000;

// The extended errors.
pub(super) const CDERR_STRUCTSIZE: u32 = 0x0001;
pub(super) const CDERR_NOTEMPLATE: u32 = 0x0003;
pub(super) const CDERR_NOHINSTANCE: u32 = 0x0004;
pub(super) const CDERR_FINDRESFAILURE: u32 = 0x0006;
pub(super) const CDERR_NOHOOK: u32 = 0x000b;
pub(super) const CDERR_DIALOGFAILURE: u32 = 0xffff;
pub(super) const FNERR_SUBCLASSFAILURE: u32 = 0x3001;
pub(super) const FNERR_INVALIDFILENAME: u32 = 0x3002;
pub(super) const FNERR_BUFFERTOOSMALL: u32 = 0x3003;

// The dialog's controls (`dlgs.h`).
pub(super) const IDOK: u16 = 1;
pub(super) const IDCANCEL: u16 = 2;
pub(super) const IDABORT: u16 = 3;
pub(super) const PSH_HELP: u16 = 0x040e;
pub(super) const CHX_READONLY: u16 = 0x0410;
pub(super) const STC_DIRECTORY: u16 = 0x0440;
pub(super) const STC_TYPES: u16 = 0x0441;
pub(super) const LST_FILES: u16 = 0x0460;
pub(super) const LST_FOLDERS: u16 = 0x0461;
pub(super) const CMB_TYPES: u16 = 0x0470;
pub(super) const CMB_DRIVES: u16 = 0x0471;
pub(super) const EDT_NAME: u16 = 0x0480;

// Messages.
pub(super) const WM_ACTIVATE: u16 = 0x0006;
pub(super) const WM_SETREDRAW: u16 = 0x000b;
pub(super) const WM_GETTEXT: u16 = 0x000d;
pub(super) const WM_GETTEXTLENGTH: u16 = 0x000e;
pub(super) const WM_SYSCOLORCHANGE: u16 = 0x0015;
pub(super) const WM_NEXTDLGCTL: u16 = 0x0028;
pub(super) const WM_DRAWITEM: u16 = 0x002b;
pub(super) const WM_MEASUREITEM: u16 = 0x002c;
pub(super) const WM_GETFONT: u16 = 0x0031;
pub(super) const WM_KILLFOCUS: u16 = 0x0008;
pub(super) const WM_INITDIALOG: u16 = 0x0110;
pub(super) const WM_COMMAND: u16 = 0x0111;
pub(super) const EM_SETSEL: u16 = 0x0401;
pub(super) const EM_LIMITTEXT: u16 = 0x0415;
pub(super) const BM_SETSTYLE: u16 = 0x0404;
pub(super) const LB_INSERTSTRING: u16 = 0x0402;
pub(super) const LB_ADDSTRING: u16 = 0x0401;
pub(super) const LB_RESETCONTENT: u16 = 0x0405;
pub(super) const LB_SETCURSEL: u16 = 0x0407;
pub(super) const LB_GETCURSEL: u16 = 0x0409;
pub(super) const LB_GETTEXT: u16 = 0x040a;
pub(super) const LB_GETTOPINDEX: u16 = 0x040f;
pub(super) const LB_FINDSTRING: u16 = 0x0410;
pub(super) const LB_GETSELCOUNT: u16 = 0x0411;
pub(super) const LB_GETSELITEMS: u16 = 0x0412;
pub(super) const LB_SETTOPINDEX: u16 = 0x0418;
pub(super) const LB_SETCARETINDEX: u16 = 0x041f;
pub(super) const LB_GETCARETINDEX: u16 = 0x0420;
pub(super) const LB_GETSEL: u16 = 0x0408;
pub(super) const CB_LIMITTEXT: u16 = 0x0401;
pub(super) const CB_ADDSTRING: u16 = 0x0403;
pub(super) const CB_GETCOUNT: u16 = 0x0406;
pub(super) const CB_GETCURSEL: u16 = 0x0407;
pub(super) const CB_GETLBTEXT: u16 = 0x0408;
pub(super) const CB_INSERTSTRING: u16 = 0x040a;
pub(super) const CB_RESETCONTENT: u16 = 0x040b;
pub(super) const CB_FINDSTRING: u16 = 0x040c;
pub(super) const CB_SETCURSEL: u16 = 0x040e;
pub(super) const CB_SHOWDROPDOWN: u16 = 0x040f;
pub(super) const CB_GETITEMDATA: u16 = 0x0410;
pub(super) const CB_SETITEMDATA: u16 = 0x0411;
pub(super) const CB_SETEXTENDEDUI: u16 = 0x0415;

// Notifications.
pub(super) const LBN_SELCHANGE: u16 = 1;
pub(super) const LBN_DBLCLK: u16 = 2;
pub(super) const LBN_SETFOCUS: u16 = 4;
pub(super) const LBN_KILLFOCUS: u16 = 5;
pub(super) const CBN_SELCHANGE: u16 = 1;
pub(super) const CBN_DROPDOWN: u16 = 7;
pub(super) const CBN_CLOSEUP: u16 = 8;
pub(super) const EN_CHANGE: u16 = 0x0300;
/// COMMDLG's own notification: a selection to be taken now (seg2 `1712`).
pub(super) const TAKE: u16 = 0x8000;

pub(super) const GWL_WNDPROC: i16 = -4;
pub(super) const GCL_WNDPROC: i16 = -24;
pub(super) const SW_HIDE: u16 = 0;
pub(super) const SWP_NOZORDER: u16 = 0x0004;
pub(super) const MB_ICONEXCLAMATION: u16 = 0x0030;
pub(super) const MB_YESNO: u16 = 0x0004;
pub(super) const MB_ICONQUESTION: u16 = 0x0020;
pub(super) const MB_DEFBUTTON2: u16 = 0x0100;
pub(super) const MB_RETRYCANCEL: u16 = 0x0005;
pub(super) const IDYES: u16 = 6;
pub(super) const IDRETRY: u16 = 4;

/// `COMMDLG`'s ordinals for the procedures it hands out.
pub(super) const FILE_OPEN_DLG_PROC: u16 = 6;
pub(super) const FILE_SAVE_DLG_PROC: u16 = 7;
pub(super) const DW_LB_SUBCLASS: u16 = 29;
pub(super) const DW_OK_SUBCLASS: u16 = 31;

/// What an Open or Save As box keeps, as COMMDLG keeps it in the block it
/// allocates for it (seg2 `115c`, 40Dh bytes).
#[derive(Debug, Clone, Default)]
pub struct FileDialog {
    /// The program's structure.
    pub(super) ofn: u32,
    /// The directory to go back to with `OFN_NOCHANGEDIR` (`+4`).
    pub(super) saved: Vec<u8>,
    /// The name being worked on (`+105h`).
    pub(super) scratch: Vec<u8>,
    /// The files' list's specs (`+205h`).
    pub(super) filter: Vec<u8>,
    /// The last spec chosen, which the custom filter is given (`+305h`).
    pub(super) spec: Vec<u8>,
    /// The folders' list's rows that are the current folder's path
    /// (`+40Bh`).
    pub(super) depth: u16,
}

/// COMMDLG's own for its file boxes, in its data segment.
#[derive(Debug, Clone, Default)]
pub struct Shared {
    /// The boxes open, by their windows (the property A000h).
    pub dialogs: HashMap<u16, FileDialog>,
    /// The hook to send what comes before `WM_INITDIALOG`, and what comes
    /// after the box has let its block go (`[4Ah]`).
    pub hook: u32,
    /// OK pressed with the folders' list's focus (`[54h]`).
    pub ok_from_folders: bool,
    /// Drawing held off while a list is filled (`[56h]`).
    pub redraw_off: u16,
    /// A box just made, not yet activated (`[0A9Eh]`).
    pub first_activate: bool,
    /// The create prompt up (`[0A80h]`).
    pub prompting: bool,
    /// The text's height and the pictures' rows' (`[776h]`, `[52h]`):
    /// measured once, by the first box.
    pub text_height: u16,
    pub item_height: u16,
    /// USER's list box and button procedures (`[24h]`, `[28h]`).
    pub list_proc: u32,
    pub button_proc: u32,
    /// The boxes using the pictures (`[2Ch]`).
    pub users: u16,
    /// The pictures: a memory device context with the bitmap of folders and
    /// drives in it, twice, for the window's colours and the highlight's.
    pub pictures: Option<(u16, u16)>,
    /// The system's colours as the pictures were made (`[2Eh]` on).
    pub colors: [u32; 5],
    /// DOS's last error, from the current directory asked for (`[0A50h]`).
    pub dos_error: u16,
}

/// The pictures' size: 8 pictures of 16 by 16 (bitmap 576). Read out of
/// the installation's `COMMDLG.DLL`; kept here so the rows are as high
/// without it.
pub(super) const PICTURES_WIDTH: u16 = 128;
pub(super) const PICTURES_HEIGHT: u16 = 16;

pub(super) fn latin1(text: &str) -> Vec<u8> {
    text.chars().map(|c| c as u8).collect()
}

pub(super) fn commdlg_string(id: u16) -> Vec<u8> {
    latin1(string(id).unwrap_or(""))
}

/// A string with its first `%s` or `%c` filled, as `wsprintf` fills it.
pub(super) fn filled(format: &[u8], value: &[u8]) -> Vec<u8> {
    for pattern in [&b"%s"[..], &b"%c"[..]] {
        if let Some(at) = format.windows(2).position(|w| w == pattern) {
            return [&format[..at], value, &format[at + 2..]].concat();
        }
    }

    format.to_vec()
}

/// ASCII letters lowered, as COMMDLG lowers them (seg2 `5625`).
pub(super) fn lower(text: &mut [u8]) {
    for byte in text {
        if byte.is_ascii_uppercase() {
            *byte += 0x20;
        }
    }
}

pub(super) fn has_wildcard(text: &[u8]) -> bool {
    text.iter().any(|&b| b == b'*' || b == b'?')
}

pub(super) fn terminated(text: &[u8]) -> Vec<u8> {
    let end = text.iter().position(|&b| b == 0).unwrap_or(text.len());

    text[..end].to_vec()
}

/// The structure's fields.
pub(super) struct Ofn(pub(super) u32);

impl Ofn {
    pub(super) fn at(&self, offset: u32) -> u32 {
        (self.0 & 0xffff_0000) | ((self.0 + offset) & 0xffff)
    }

    pub(super) fn word(&self, engine: &Engine, offset: u32) -> u16 {
        let bytes = engine.system().read_far(self.at(offset), 2);

        u16::from_le_bytes([bytes[0], bytes[1]])
    }

    pub(super) fn dword(&self, engine: &Engine, offset: u32) -> u32 {
        let bytes = engine.system().read_far(self.at(offset), 4);

        u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
    }

    pub(super) fn set_word(&self, engine: &Engine, offset: u32, value: u16) {
        engine
            .system()
            .write_far(self.at(offset), &value.to_le_bytes());
    }

    pub(super) fn set_dword(&self, engine: &Engine, offset: u32, value: u32) {
        engine
            .system()
            .write_far(self.at(offset), &value.to_le_bytes());
    }

    pub(super) fn flags(&self, engine: &Engine) -> u32 {
        self.dword(engine, FLAGS)
    }

    pub(super) fn set_flags(&self, engine: &Engine, flags: u32) {
        self.set_dword(engine, FLAGS, flags);
    }

    /// A string field's string; none for a null pointer.
    pub(super) fn string(&self, engine: &Engine, offset: u32) -> Option<Vec<u8>> {
        let far = self.dword(engine, offset);

        (far != 0).then(|| engine.system().read_string(far))
    }

    /// A string field's bytes written, its nought with them.
    pub(super) fn write(&self, engine: &Engine, offset: u32, bytes: &[u8]) {
        let far = self.dword(engine, offset);
        let mut copy = bytes.to_vec();

        copy.push(0);
        engine.system().write_far(far, &copy);
    }

    /// A name too long for the program's buffer: its length in the
    /// buffer's first two bytes and a nought (seg2 `23d4`).
    pub(super) fn write_size(&self, engine: &Engine, offset: u32, length: u16) {
        let far = self.dword(engine, offset);
        let [low, high] = length.to_le_bytes();

        engine.system().write_far(far, &[low, high, 0]);
    }
}

/// The custom filter's pattern, after its description; and a filter's,
/// at the offset the types' list keeps for it.
pub(super) fn after_string(engine: &Engine, far: u32, offset: u16) -> Vec<u8> {
    let at = (far & 0xffff_0000) | (far.wrapping_add(u32::from(offset)) & 0xffff);

    engine.system().read_string(at)
}

pub(super) fn custom_pattern(engine: &Engine, custom: u32) -> Vec<u8> {
    let description = engine.system().read_string(custom);

    after_string(engine, custom, description.len() as u16 + 1)
}

// ---------------------------------------------------------------------
// The start: GetOpenFileName and GetSaveFileName (seg2 `09eb`).

pub(crate) fn get_open_file_name(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let ofn = args.dword(&engine.system());

        start(engine, ofn, false).await
    })
}

pub(crate) fn get_save_file_name(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let ofn = args.dword(&engine.system());

        start(engine, ofn, true).await
    })
}

async fn start(engine: &Engine, far: u32, save: bool) -> Result<Answer, Stop> {
    let ofn = Ofn(far);

    // The structure's size first: the error is set and the call refused
    // before anything else (seg2 `09fc`).
    if ofn.dword(engine, LSTRUCTSIZE) != 0x48 {
        super::set_error(&mut engine.system(), CDERR_STRUCTSIZE);
        return Ok(Answer::Word(0));
    }

    super::wait_cursor(&mut engine.system(), true);
    super::set_error(&mut engine.system(), 0);
    pictures_used(engine).await?;

    let flags = ofn.flags(engine);
    let template = if flags & OFN_ENABLETEMPLATEHANDLE != 0 {
        let handle = ofn.word(engine, HINSTANCE);

        Ok(engine.system().memory_template(u32::from(handle | 1) << 16))
    } else if flags & OFN_ENABLETEMPLATE != 0 {
        let name = ofn.dword(engine, LPTEMPLATENAME);
        let instance = ofn.word(engine, HINSTANCE);

        if name == 0 {
            Err(CDERR_NOTEMPLATE)
        } else if instance == 0 {
            Err(CDERR_NOHINSTANCE)
        } else {
            let mut system = engine.system();
            let name = MenuName::read(&system, name);

            name.and_then(|name| system.resource_template(instance, &name))
                .ok_or(CDERR_FINDRESFAILURE)
        }
    } else {
        Ok(built_in(flags & OFN_ALLOWMULTISELECT != 0))
    };
    let answer = match template {
        Err(code) => {
            super::set_error(&mut engine.system(), code);
            0
        }
        Ok(template) => {
            let previous = api::word(engine, "KERNEL", "SetErrorMode", &[Arg::W(0x8003)]).await?;

            if flags & OFN_ENABLEHOOK != 0 {
                engine.system().commdlg.files.hook = ofn.dword(engine, LPFNHOOK);
            }

            let result =
                dialog_box(engine, &template, ofn.word(engine, HWNDOWNER), far, save).await?;

            engine.system().commdlg.files.hook = 0;

            let result = if result == -1 {
                super::set_error(&mut engine.system(), CDERR_DIALOGFAILURE);
                0
            } else {
                result
            };

            api::word(engine, "KERNEL", "SetErrorMode", &[Arg::W(previous)]).await?;
            result
        }
    };

    pictures_let_go(engine);
    super::wait_cursor(&mut engine.system(), false);

    Ok(Answer::Word(u16::from(answer == 1)))
}

/// COMMDLG's template, WinBox's own: 1536, or 1537 for several files.
fn built_in(multiple: bool) -> DialogTemplate {
    let hex = if multiple {
        MULTI_FILE_OPEN_DIALOG
    } else {
        FILE_OPEN_DIALOG
    };
    let bytes: Vec<u8> = (0..hex.len() / 2)
        .map(|at| u8::from_str_radix(&hex[at * 2..at * 2 + 2], 16).unwrap_or(0))
        .collect();

    parse_dialog_template(|at| bytes.get(at as usize).copied().unwrap_or(0))
}

/// `DialogBoxIndirectParam` with COMMDLG's instance, and its procedure for
/// the box (seg2 `0b9f`): what `EndDialog` was given.
async fn dialog_box(
    engine: &Engine,
    template: &DialogTemplate,
    owner: u16,
    ofn: u32,
    save: bool,
) -> Result<i16, Stop> {
    let (instance, proc) = {
        let mut system = engine.system();
        let ordinal = if save {
            FILE_SAVE_DLG_PROC
        } else {
            FILE_OPEN_DLG_PROC
        };

        (
            super::instance(&system),
            super::proc_address(&mut system, ordinal),
        )
    };
    let (owner, disabled, active) = engine.begin_modal(owner).await?;
    let hwnd = engine
        .create_dialog(
            instance,
            template,
            owner,
            DialogProc::Guest(proc),
            ofn,
            true,
        )
        .await?;

    Ok(engine.run_modal(hwnd, owner, disabled, active).await? as i16)
}

// ---------------------------------------------------------------------
// The pictures (seg2 `0fb3`, `0fe2`, `0d58`).

/// A box starting: with the first, the system's colours read and the
/// pictures made (seg2 `0fb3`). Without the installation's `COMMDLG.DLL`
/// there are none to make.
async fn pictures_used(engine: &Engine) -> Result<(), Stop> {
    let first = {
        let mut system = engine.system();
        let shared = &mut system.commdlg.files;

        shared.users += 1;
        shared.users == 1
    };

    if first {
        super::file_lists::colors_and_pictures(engine).await?;
    }

    Ok(())
}

/// A box ended: with the last, nothing more kept selected (seg2 `0fe2`).
fn pictures_let_go(engine: &Engine) {
    let mut system = engine.system();
    let shared = &mut system.commdlg.files;

    shared.users = shared.users.saturating_sub(1);
}

/// `COLOR_WINDOW`, `COLOR_HIGHLIGHT`, `COLOR_WINDOWTEXT`, `COLOR_HIGHLIGHTTEXT` and
/// `COLOR_GRAYTEXT` (seg2 `0f54`).
pub(super) async fn read_colors_now(engine: &Engine) -> Result<(), Stop> {
    let mut colors = [0u32; 5];

    for (at, index) in [5u16, 0x0d, 8, 0x0e, 0x11].into_iter().enumerate() {
        colors[at] = api::api(engine, "USER", "GetSysColor", &[Arg::W(index)])
            .await?
            .value;
    }

    engine.system().commdlg.files.colors = colors;
    Ok(())
}

/// The pictures made from bitmap 576 of the installation's `COMMDLG.DLL`:
/// its blue made the window's colour, and beside it again with the blue
/// made the highlight's (seg2 `0d58`, `LoadAlterBitmap` seg6 `0000`).
pub(super) fn make_pictures_now(engine: &Engine) {
    let mut system = engine.system();
    let [window, highlight, ..] = system.commdlg.files.colors;
    let Some(bitmap) = super::pictures::pictures(&mut system, window, highlight) else {
        return;
    };

    if let Some((memory, old)) = system.commdlg.files.pictures.take() {
        let previous = crate::gdi::dc::select_object(&mut system, memory, old);

        crate::gdi::objects::delete_object(&mut system, previous);
        crate::gdi::dc::delete_dc(&mut system, memory);
    }

    let memory = crate::gdi::dc::create_compatible_dc(&mut system, 0);
    let handle = system.gdi_allocate(crate::gdi::GdiObject::Bitmap(Box::new(bitmap)));
    let old = crate::gdi::dc::select_object(&mut system, memory, handle);

    system.commdlg.files.pictures = Some((memory, old));
}
