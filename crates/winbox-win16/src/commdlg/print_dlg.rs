//! COMMDLG's Print and Print Setup dialogs: `PrintDlg` (20), the Print
//! dialog's procedure `PrintDlgProc` (21, `print_proc.rs`), Print Setup's
//! `PrintSetupDlgProc` (22, `print_setup.rs`), and the subclasses
//! `EditIntegerOnly` (23) and `dwUpArrowHack` (30), which USER calls at
//! COMMDLG's own exports as it would Microsoft's. **Read out** of
//! `COMMDLG.DLL` seg3 and **recorded** by `prdlg`; each step is COMMDLG's,
//! at the address the comments give ([[topic:print-dialogs]] in the
//! knowledge base). As `print-dlg.ts`.
//!
//! This file holds the call itself and what both dialogs share: the
//! printers COMMDLG finds in `WIN.INI`, the `DEVNAMES` it makes and checks,
//! the printer's driver loaded and asked for its `DEVMODE`, the device or
//! information context made for the program, and the Print dialog's
//! qualities.

use std::collections::HashMap;

use winbox_cpu::DS;

use super::api::{self, Arg, Called, buffer, text};
use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};

// The `PRINTDLG`'s fields, by offset.
pub(super) const OWNER: u32 = 0x04;
pub(super) const DEVMODE: u32 = 0x06;
pub(super) const DEVNAMES: u32 = 0x08;
pub(super) const HDC: u32 = 0x0a;
pub(super) const FLAGS: u32 = 0x0c;
pub(super) const FROM_PAGE: u32 = 0x10;
pub(super) const TO_PAGE: u32 = 0x12;
pub(super) const MIN_PAGE: u32 = 0x14;
pub(super) const MAX_PAGE: u32 = 0x16;
pub(super) const COPIES: u32 = 0x18;
pub(super) const INSTANCE: u32 = 0x1a;
pub(super) const PRINT_HOOK: u32 = 0x20;
pub(super) const SETUP_HOOK: u32 = 0x24;
pub(super) const PRINT_TEMPLATE_NAME: u32 = 0x28;
pub(super) const SETUP_TEMPLATE_NAME: u32 = 0x2c;
pub(super) const PRINT_TEMPLATE: u32 = 0x30;
pub(super) const SETUP_TEMPLATE: u32 = 0x32;

// Its flags.
pub(super) const PD_SELECTION: u32 = 0x1;
pub(super) const PD_PAGENUMS: u32 = 0x2;
pub(super) const PD_NOSELECTION: u32 = 0x4;
pub(super) const PD_NOPAGENUMS: u32 = 0x8;
pub(super) const PD_COLLATE: u32 = 0x10;
pub(super) const PD_PRINTTOFILE: u32 = 0x20;
pub(super) const PD_PRINTSETUP: u32 = 0x40;
pub(super) const PD_NOWARNING: u32 = 0x80;
pub(super) const PD_RETURNDC: u32 = 0x100;
pub(super) const PD_RETURNIC: u32 = 0x200;
pub(super) const PD_RETURNDEFAULT: u32 = 0x400;
pub(super) const PD_SHOWHELP: u32 = 0x800;
pub(super) const PD_ENABLEPRINTHOOK: u32 = 0x1000;
pub(super) const PD_ENABLESETUPHOOK: u32 = 0x2000;
pub(super) const PD_ENABLEPRINTTEMPLATE: u32 = 0x4000;
pub(super) const PD_ENABLESETUPTEMPLATE: u32 = 0x8000;
pub(super) const PD_ENABLEPRINTTEMPLATEHANDLE: u32 = 0x1_0000;
pub(super) const PD_ENABLESETUPTEMPLATEHANDLE: u32 = 0x2_0000;
pub(super) const PD_USEDEVMODECOPIES: u32 = 0x4_0000;
pub(super) const PD_DISABLEPRINTTOFILE: u32 = 0x8_0000;
pub(super) const PD_HIDEPRINTTOFILE: u32 = 0x10_0000;

// The extended errors `PrintDlg` sets.
pub(super) const CDERR_STRUCTSIZE: u32 = 0x1;
pub(super) const CDERR_NOTEMPLATE: u32 = 0x3;
pub(super) const CDERR_NOHINSTANCE: u32 = 0x4;
pub(super) const CDERR_LOADRESFAILURE: u32 = 0x7;
pub(super) const CDERR_LOCKRESFAILURE: u32 = 0x8;
pub(super) const CDERR_MEMALLOCFAILURE: u32 = 0x9;
pub(super) const CDERR_MEMLOCKFAILURE: u32 = 0xa;
pub(super) const CDERR_NOHOOK: u32 = 0xb;
pub(super) const CDERR_DIALOGFAILURE: u32 = 0xffff;
pub(super) const PDERR_SETUPFAILURE: u32 = 0x1001;
pub(super) const PDERR_PARSEFAILURE: u32 = 0x1002;
pub(super) const PDERR_RETDEFFAILURE: u32 = 0x1003;
pub(super) const PDERR_LOADDRVFAILURE: u32 = 0x1004;
pub(super) const PDERR_GETDEVMODEFAIL: u32 = 0x1005;
pub(super) const PDERR_INITFAILURE: u32 = 0x1006;
pub(super) const PDERR_NODEVICES: u32 = 0x1007;
pub(super) const PDERR_NODEFAULTPRN: u32 = 0x1008;
pub(super) const PDERR_DNDMMISMATCH: u32 = 0x1009;
pub(super) const PDERR_CREATEICFAILURE: u32 = 0x100a;
pub(super) const PDERR_PRINTERNOTFOUND: u32 = 0x100b;
pub(super) const PDERR_DEFAULTDIFFERENT: u32 = 0x100c;

// Messages and the like, as COMMDLG passes them.
pub(super) const WM_INITDIALOG: u16 = 0x0110;
pub(super) const WM_COMMAND: u16 = 0x0111;
pub(super) const WM_NEXTDLGCTL: u16 = 0x0028;
pub(super) const WM_GETFONT: u16 = 0x0031;
pub(super) const WM_MEASUREITEM: u16 = 0x002c;
pub(super) const CB_ADDSTRING: u16 = 0x0403;
pub(super) const CB_GETCOUNT: u16 = 0x0406;
pub(super) const CB_GETCURSEL: u16 = 0x0407;
pub(super) const CB_INSERTSTRING: u16 = 0x040a;
pub(super) const CB_RESETCONTENT: u16 = 0x040b;
pub(super) const CB_SETCURSEL: u16 = 0x040e;
pub(super) const CB_GETITEMDATA: u16 = 0x0410;
pub(super) const CB_SETITEMDATA: u16 = 0x0411;
pub(super) const CB_SETEXTENDEDUI: u16 = 0x0415;
pub(super) const CB_GETDROPPEDSTATE: u16 = 0x0417;
pub(super) const EM_SETSEL: u16 = 0x0401;
pub(super) const EM_LIMITTEXT: u16 = 0x0415;
pub(super) const STM_SETICON: u16 = 0x0400;
pub(super) const GWL_WNDPROC: u16 = 0xfffc;
pub(super) const GWL_STYLE: u16 = 0xfff0;
pub(super) const WS_TABSTOP: u32 = 0x0001_0000;
pub(super) const MB_ICONEXCLAMATION: u16 = 0x30;
pub(super) const SW_HIDE: u16 = 0;
pub(super) const SW_SHOWNA: u16 = 8;
const RT_DIALOG: u32 = 5;
const DM_COPY: u16 = 2;
const DM_MODIFY: u16 = 8;
pub(super) const QUERYESCSUPPORT: u16 = 8;
pub(super) const SETCOPYCOUNT: u16 = 0x11;
const DC_ENUMRESOLUTIONS: u16 = 0xd;

// COMMDLG's own exports it hands USER.
pub(super) const PRINT_DLG_PROC: u16 = 21;
pub(super) const PRINT_SETUP_DLG_PROC: u16 = 22;
pub(super) const EDIT_INTEGER_ONLY: u16 = 23;
pub(super) const DW_UP_ARROW_HACK: u16 = 30;

/// What COMMDLG keeps for its print dialogs in its data.
#[derive(Debug, Default, Clone)]
pub(crate) struct PrintGlobals {
    /// `[1D2h]`: how many print calls are in progress (`3de2`, `3ed8`).
    count: u16,
    /// `[1D4h]`, `[1D6h]`: the portrait and landscape icons, loaded and
    /// locked on the first of the calls in progress.
    pub(super) portrait: u16,
    pub(super) landscape: u16,
    /// The icons made once: a module's icon stays loaded, and `LoadIcon`
    /// answers the same handle again (`3e11`).
    portrait_made: u16,
    landscape_made: u16,
    /// Whether strings 443h to 445h, the driver's entries' names, are read
    /// into `[928h]`, `[884h]` and `[938h]` (`3e56`): empty until the first
    /// call's setup reads them.
    names: bool,
    /// `[1F0h]`: a hook given the messages of a dialog with no property:
    /// `PrintDlg`'s, until `WM_INITDIALOG`, and each procedure's as it ends.
    pub(super) hook: u32,
    /// `[A7Ch]`: the From edit's own procedure, which `EditIntegerOnly`
    /// passes all three edits' messages to (`1b77`).
    pub(super) edit_proc: u32,
    /// `[A78h]`: the printers' combo box's own procedure (`2a19`).
    pub(super) list_proc: u32,
    /// `[1EEh]`: the printer Print Setup took has a driver that will not
    /// load (`2ef7`).
    pub(super) missing: bool,
    /// `[1ECh]`: the height Print Setup answers `WM_MEASUREITEM` with,
    /// measured once (`2f59`).
    pub(super) item_height: u16,
    /// Each dialog's six bytes of local memory, by the number under its
    /// property A000h.
    pub(super) dialogs: HashMap<u16, Dialog>,
}

/// A dialog's six bytes of COMMDLG's local memory: the structure, and
/// Print Setup's working `DEVMODE`.
#[derive(Debug, Default, Clone, Copy)]
pub(super) struct Dialog {
    pub lppd: u32,
    pub devmode: u16,
}

/// COMMDLG loaded from its file afresh: its data as the file has it, no
/// call in progress and no string read (`loader.rs`).
pub(crate) fn loaded(system: &mut crate::system::System) {
    system.commdlg.print = PrintGlobals::default();
}

pub(super) fn globals(engine: &Engine) -> std::cell::RefMut<'_, PrintGlobals> {
    std::cell::RefMut::map(engine.system(), |system| &mut system.commdlg.print)
}

// Reading and writing what a far pointer points to.

/// A far pointer `step` bytes further into its segment.
pub(super) fn at(far: u32, step: u32) -> u32 {
    (far & 0xffff_0000) | (far.wrapping_add(step) & 0xffff)
}

pub(super) fn word(engine: &Engine, far: u32, step: u32) -> u16 {
    let bytes = engine.system().read_far(at(far, step), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

pub(super) fn dword(engine: &Engine, far: u32, step: u32) -> u32 {
    let bytes = engine.system().read_far(at(far, step), 4);

    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

pub(super) fn set_word(engine: &Engine, far: u32, step: u32, value: u16) {
    engine
        .system()
        .write_far(at(far, step), &value.to_le_bytes());
}

pub(super) fn set_dword(engine: &Engine, far: u32, step: u32, value: u32) {
    engine
        .system()
        .write_far(at(far, step), &value.to_le_bytes());
}

/// The string a far pointer points to, without its nought.
pub(super) fn string(engine: &Engine, far: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    let system = engine.system();

    for step in 0..0x200 {
        match system.read_far(at(far, step), 1)[0] {
            0 => break,
            byte => bytes.push(byte),
        }
    }

    bytes
}

/// A string written where a far pointer points, with its nought: `lstrcpy`.
pub(super) fn put_string(engine: &Engine, far: u32, value: &[u8]) {
    let mut bytes = value.to_vec();

    bytes.push(0);
    engine.system().write_far(far, &bytes);
}

/// The flags.
pub(super) fn flags(engine: &Engine, lppd: u32) -> u32 {
    dword(engine, lppd, FLAGS)
}

/// One of a `DEVNAMES`' strings, by its offset's place: 0 the driver, 2
/// the device, 4 the port.
pub(super) fn name_of(engine: &Engine, names: u32, which: u32) -> u32 {
    at(names, u32::from(word(engine, names, which)))
}

pub(super) const DRIVER: u32 = 0;
pub(super) const DEVICE: u32 = 2;
pub(super) const PORT: u32 = 4;
pub(super) const DEFAULT: u32 = 6;

// Calls into USER, GDI and KERNEL, as COMMDLG makes them (`api.rs`).

pub(super) async fn call(
    engine: &Engine,
    module: &str,
    name: &str,
    args: &[Arg],
) -> Result<u32, Stop> {
    Ok(api::api(engine, module, name, args).await?.value)
}

pub(super) async fn called(
    engine: &Engine,
    module: &str,
    name: &str,
    args: &[Arg],
) -> Result<Called, Stop> {
    api::api(engine, module, name, args).await
}

pub(super) async fn lock(engine: &Engine, handle: u16) -> Result<u32, Stop> {
    call(engine, "KERNEL", "GlobalLock", &[Arg::W(handle)]).await
}

pub(super) async fn unlock(engine: &Engine, handle: u16) -> Result<(), Stop> {
    call(engine, "KERNEL", "GlobalUnlock", &[Arg::W(handle)]).await?;
    Ok(())
}

pub(super) async fn free(engine: &Engine, handle: u16) -> Result<(), Stop> {
    call(engine, "KERNEL", "GlobalFree", &[Arg::W(handle)]).await?;
    Ok(())
}

pub(super) async fn alloc(engine: &Engine, how: u16, size: u32) -> Result<u16, Stop> {
    Ok(call(
        engine,
        "KERNEL",
        "GlobalAlloc",
        &[Arg::W(how), Arg::D(size)],
    )
    .await? as u16)
}

pub(super) async fn item(engine: &Engine, dialog: u16, id: u16) -> Result<u16, Stop> {
    api::item(engine, dialog, id).await
}

/// `EnableWindow(GetDlgItem(dialog, id), on)`.
pub(super) async fn enable(engine: &Engine, dialog: u16, id: u16, on: bool) -> Result<(), Stop> {
    let control = item(engine, dialog, id).await?;

    call(
        engine,
        "USER",
        "EnableWindow",
        &[Arg::W(control), Arg::W(u16::from(on))],
    )
    .await?;
    Ok(())
}

/// `ShowWindow(GetDlgItem(dialog, id), how)`.
pub(super) async fn show(engine: &Engine, dialog: u16, id: u16, how: u16) -> Result<(), Stop> {
    let control = item(engine, dialog, id).await?;

    call(
        engine,
        "USER",
        "ShowWindow",
        &[Arg::W(control), Arg::W(how)],
    )
    .await?;
    Ok(())
}

pub(super) async fn send_item(
    engine: &Engine,
    dialog: u16,
    id: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u32, Stop> {
    api::send_item(engine, dialog, id, message, wparam, lparam).await
}

pub(super) async fn send(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u32, Stop> {
    api::send(engine, hwnd, message, wparam, lparam).await
}

pub(super) async fn check(engine: &Engine, dialog: u16, id: u16, on: u16) -> Result<(), Stop> {
    call(
        engine,
        "USER",
        "CheckDlgButton",
        &[Arg::W(dialog), Arg::W(id), Arg::W(on)],
    )
    .await?;
    Ok(())
}

pub(super) async fn check_radio(
    engine: &Engine,
    dialog: u16,
    first: u16,
    last: u16,
    id: u16,
) -> Result<(), Stop> {
    call(
        engine,
        "USER",
        "CheckRadioButton",
        &[Arg::W(dialog), Arg::W(first), Arg::W(last), Arg::W(id)],
    )
    .await?;
    Ok(())
}

pub(super) async fn checked(engine: &Engine, dialog: u16, id: u16) -> Result<u16, Stop> {
    Ok(call(
        engine,
        "USER",
        "IsDlgButtonChecked",
        &[Arg::W(dialog), Arg::W(id)],
    )
    .await? as u16)
}

pub(super) async fn set_item_int(
    engine: &Engine,
    dialog: u16,
    id: u16,
    value: u16,
) -> Result<(), Stop> {
    call(
        engine,
        "USER",
        "SetDlgItemInt",
        &[Arg::W(dialog), Arg::W(id), Arg::W(value), Arg::W(0)],
    )
    .await?;
    Ok(())
}

/// `MessageBox(owner, text, caption, MB_ICONEXCLAMATION)`.
pub(super) async fn message_box(
    engine: &Engine,
    owner: u16,
    message: &[u8],
    caption: &[u8],
) -> Result<(), Stop> {
    call(
        engine,
        "USER",
        "MessageBox",
        &[
            Arg::W(owner),
            text(message),
            text(caption),
            Arg::W(MB_ICONEXCLAMATION),
        ],
    )
    .await?;
    Ok(())
}

/// `lstrcmpi` of two far pointers, as COMMDLG compares names: whether
/// they are the same.
pub(super) async fn same(engine: &Engine, one: Arg, other: Arg) -> Result<bool, Stop> {
    Ok(call(engine, "USER", "lstrcmpi", &[one, other]).await? as u16 == 0)
}

/// `GetProfileString` into a buffer of `size`: the length, and the bytes.
pub(super) async fn profile(
    engine: &Engine,
    section: &[u8],
    key: Arg,
    size: u16,
) -> Result<(u16, Vec<u8>), Stop> {
    // The buffer is the third or fourth laid out, by whether the key is.
    let at = if matches!(key, Arg::B(_)) { 3 } else { 2 };
    let answer = called(
        engine,
        "KERNEL",
        "GetProfileString",
        &[
            text(section),
            key,
            text(b""),
            buffer(usize::from(size)),
            Arg::W(size),
        ],
    )
    .await?;
    let length = answer.word();
    let bytes = answer.buffers.get(at).cloned().unwrap_or_default();

    Ok((length, bytes))
}

/// The bytes up to the nought.
pub(super) fn till_nought(bytes: &[u8]) -> &[u8] {
    &bytes[..bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len())]
}

/// One of COMMDLG's strings (`LoadString` of its instance).
pub(super) fn resource(id: u16) -> Vec<u8> {
    super::resources::string(id)
        .map(|text| text.chars().map(|c| c as u32 as u8).collect())
        .unwrap_or_default()
}

/// The Windows version, as COMMDLG keeps it (`[0CAEh]`, `GetVersion` with
/// its bytes swapped, seg7 `00ef`): 30Ah on 3.10.
pub(super) async fn version(engine: &Engine) -> Result<u16, Stop> {
    let answer = call(engine, "KERNEL", "GetVersion", &[]).await? as u16;

    Ok(answer.swap_bytes())
}

/// The extended error set.
pub(super) fn set_error(engine: &Engine, code: u32) {
    super::set_error(&mut engine.system(), code);
}

pub(super) fn error(engine: &Engine) -> u32 {
    super::error(&engine.system())
}

pub(super) fn wait(engine: &Engine, busy: bool) {
    super::wait_cursor(&mut engine.system(), busy);
}

/// The far address of one of COMMDLG's exports, WinBox's own.
pub(super) fn export(engine: &Engine, ordinal: u16) -> u32 {
    super::proc_address(&mut engine.system(), ordinal)
}

/// A procedure of the printer's driver called as COMMDLG calls one, a far
/// Pascal call with its own data segment in DS: its answer, DX:AX.
pub(super) async fn driver_call(
    engine: &Engine,
    procedure: u32,
    args: &[GuestArg],
) -> Result<u32, Stop> {
    let ds = super::data_selector(&engine.system());

    Ok(engine
        .call_with(procedure, args, &[Register::Segment(DS, ds)])
        .await?
        .0)
}

/// `DeviceCapabilities(device, port, index, output, devmode)`.
pub(super) async fn capabilities(
    engine: &Engine,
    procedure: u32,
    names: u32,
    index: u16,
    output: u32,
    devmode: u32,
) -> Result<u32, Stop> {
    driver_call(
        engine,
        procedure,
        &[
            GuestArg::Long(name_of(engine, names, DEVICE)),
            GuestArg::Long(name_of(engine, names, PORT)),
            GuestArg::Word(index),
            GuestArg::Long(output),
            GuestArg::Long(devmode),
        ],
    )
    .await
}

/// The driver's procedure by one of the names of strings 443h to 445h, or
/// by an empty name before they are read (`3e56`).
pub(super) async fn driver_entry(engine: &Engine, driver: u16, id: u16) -> Result<u32, Stop> {
    let name = if globals(engine).names {
        resource(id)
    } else {
        Vec::new()
    };

    call(
        engine,
        "KERNEL",
        "GetProcAddress",
        &[Arg::W(driver), text(&name)],
    )
    .await
}

pub(super) const EXT_DEVICE_MODE: u16 = 0x443;
pub(super) const DEVICE_MODE: u16 = 0x444;
pub(super) const DEVICE_CAPABILITIES: u16 = 0x445;

// What both dialogs share.

/// The default printer's `DEVNAMES`, from `[windows]` `device=` (`00ef`):
/// nought, the error set, for none or for a line that does not parse.
pub(super) async fn default_names(engine: &Engine) -> Result<u16, Stop> {
    let (length, line) = profile(engine, b"windows", text(b"device"), 0x84).await?;
    let line = till_nought(&line).to_vec();

    if length == 0 {
        set_error(engine, PDERR_NODEFAULTPRN);
        return Ok(0);
    }

    let handle = alloc(engine, 0x42, u32::from(length) + 0x29).await?;

    if handle == 0 {
        set_error(engine, CDERR_MEMALLOCFAILURE);
        return Ok(0);
    }

    let names = lock(engine, handle).await?;

    set_word(engine, names, DEVICE, 8);
    put_string(engine, at(names, 8), &line);

    // The device to the first comma, the driver to the next, the port the
    // rest (`0187`, `01ef`).
    let first = line.iter().position(|&b| b == b',');
    let second = first.and_then(|first| {
        line[first + 1..]
            .iter()
            .position(|&b| b == b',')
            .map(|at| first + 1 + at)
    });
    let (Some(first), Some(second)) = (first, second) else {
        set_error(engine, PDERR_PARSEFAILURE);
        unlock(engine, handle).await?;
        free(engine, handle).await?;
        return Ok(0);
    };

    engine.system().write_far(at(names, 8 + first as u32), &[0]);
    set_word(engine, names, DRIVER, 8 + first as u16 + 1);
    engine
        .system()
        .write_far(at(names, 8 + second as u32), &[0]);
    set_word(engine, names, PORT, 8 + second as u16 + 1);
    set_word(engine, names, DEFAULT, 0x4001);
    unlock(engine, handle).await?;
    Ok(handle)
}

/// A program's `DEVNAMES` checked against `WIN.INI` (`0a93`): its device
/// a key of `[devices]` whose driver is its driver and whose ports include
/// its port; marked the default, the default printer too.
pub(super) async fn check_names(engine: &Engine, handle: u16) -> Result<bool, Stop> {
    let names = lock(engine, handle).await?;

    if names == 0 {
        set_error(engine, CDERR_MEMLOCKFAILURE);
        return Ok(false);
    }

    let mut found = false;
    let wdefault = word(engine, names, DEFAULT);

    set_word(engine, names, DEFAULT, wdefault & !0x4000);
    set_error(engine, PDERR_PRINTERNOTFOUND);

    let (length, value) = profile(
        engine,
        b"devices",
        Arg::D(name_of(engine, names, DEVICE)),
        0x200,
    )
    .await?;
    let value = till_nought(&value).to_vec();

    if length != 0
        && let Some(comma) = value.iter().position(|&b| b == b',')
        && same(
            engine,
            text(&value[..comma]),
            Arg::D(name_of(engine, names, DRIVER)),
        )
        .await?
    {
        let mut start = comma + 1;

        loop {
            let end = value[start.min(value.len())..]
                .iter()
                .position(|&b| b == b',')
                .map_or(value.len(), |at| start + at);
            let port = value[start.min(value.len())..end.max(start.min(value.len()))].to_vec();

            if same(engine, text(&port), Arg::D(name_of(engine, names, PORT))).await? {
                set_error(engine, 0);
                found = true;
                break;
            }

            start = end + 1;

            if start >= usize::from(length) {
                break;
            }
        }
    }

    if error(engine) == 0 && word(engine, names, DEFAULT) & 1 != 0 {
        let default = default_names(engine).await?;

        if default == 0 {
            found = false;
        } else {
            let other = lock(engine, default).await?;

            if other == 0 {
                found = false;
                set_error(engine, CDERR_MEMLOCKFAILURE);
            } else {
                let mut alike = true;

                for which in [DEVICE, DRIVER, PORT] {
                    if !same(
                        engine,
                        Arg::D(name_of(engine, names, which)),
                        Arg::D(name_of(engine, other, which)),
                    )
                    .await?
                    {
                        alike = false;
                        break;
                    }
                }

                if !alike {
                    set_error(engine, PDERR_DEFAULTDIFFERENT);
                    found = false;
                }

                unlock(engine, default).await?;
                free(engine, default).await?;
            }
        }
    }

    unlock(engine, handle).await?;
    Ok(found)
}

/// The structure's printer found or made (`1245`): its `DEVNAMES`, one
/// made of its `DEVMODE`'s device, or the default's. The bits for the
/// `DEVNAMES`' `wDefault` -- 8000h, and 4000h for the default's made here
/// -- or nought, the error set.
pub(super) async fn find_names(engine: &Engine, lppd: u32) -> Result<u16, Stop> {
    let mut bits = 0x8000;
    let devmode = word(engine, lppd, DEVMODE);

    if devmode == 0 {
        if word(engine, lppd, DEVNAMES) == 0 {
            let names = default_names(engine).await?;

            set_word(engine, lppd, DEVNAMES, names);

            if names == 0 {
                return Ok(0);
            }

            bits |= 0x4000;
        }

        return Ok(bits);
    }

    let mode = lock(engine, devmode).await?;

    if mode == 0 {
        set_error(engine, CDERR_MEMLOCKFAILURE);
        return Ok(0);
    }

    let handle = word(engine, lppd, DEVNAMES);

    if handle != 0 {
        if lock(engine, handle).await? == 0 {
            set_error(engine, CDERR_MEMLOCKFAILURE);
            unlock(engine, devmode).await?;
            return Ok(0);
        }

        unlock(engine, handle).await?;
        unlock(engine, devmode).await?;
        return Ok(bits);
    }

    // A `DEVNAMES` of the `DEVMODE`'s device, its driver and first port
    // from `[devices]` (`12b1`).
    let (length, value) = profile(engine, b"devices", Arg::D(mode), 0x200).await?;
    let value = till_nought(&value).to_vec();

    if length == 0 {
        set_error(engine, PDERR_NODEVICES);
        unlock(engine, devmode).await?;
        return Ok(0);
    }

    let Some(comma) = value.iter().position(|&b| b == b',') else {
        set_error(engine, PDERR_PARSEFAILURE);
        unlock(engine, devmode).await?;
        return Ok(0);
    };
    let driver = value[..comma].to_vec();
    let rest = &value[comma + 1..];
    let port = rest[..rest.iter().position(|&b| b == b',').unwrap_or(rest.len())].to_vec();
    let device = string(engine, mode);
    let size = port.len() + driver.len() + device.len() + 0x2b;
    let names = alloc(engine, 2, size as u32).await?;

    set_word(engine, lppd, DEVNAMES, names);

    if names == 0 {
        set_error(engine, CDERR_MEMALLOCFAILURE);
        unlock(engine, devmode).await?;
        return Ok(0);
    }

    let far = lock(engine, names).await?;
    let to_driver = device.len() as u16 + 9;
    let to_port = driver.len() as u16 + device.len() as u16 + 0xa;

    set_word(engine, far, DEVICE, 8);
    put_string(engine, at(far, 8), &device);
    set_word(engine, far, DRIVER, to_driver);
    put_string(engine, at(far, u32::from(to_driver)), &driver);
    set_word(engine, far, PORT, to_port);
    put_string(engine, at(far, u32::from(to_port)), &port);
    set_word(engine, far, DEFAULT, 0x4000);
    unlock(engine, names).await?;
    unlock(engine, devmode).await?;
    Ok(bits)
}

/// The printer's driver loaded (`0228`): its name cut at its first dot,
/// where it is in the `DEVNAMES`, and `.DRV` added, under
/// `SetErrorMode(8003h)`; tried twice, the second time without the system
/// folder COMMDLG never fills in (`[898h]`). Its instance, or what
/// `LoadLibrary` answered.
pub(super) async fn load_driver(engine: &Engine, name: u32) -> Result<u16, Stop> {
    let mut path = string(engine, name);

    if let Some(dot) = path.iter().position(|&b| b == b'.') {
        engine.system().write_far(at(name, dot as u32), &[0]);
        path.truncate(dot);
    }

    path.extend_from_slice(b".DRV");

    let previous = call(engine, "KERNEL", "SetErrorMode", &[Arg::W(0x8003)]).await? as u16;
    let mut driver = call(engine, "KERNEL", "LoadLibrary", &[text(&path)]).await? as u16;

    if driver < 0x20 {
        driver = call(engine, "KERNEL", "LoadLibrary", &[text(&path)]).await? as u16;
    }

    call(engine, "KERNEL", "SetErrorMode", &[Arg::W(previous)]).await?;
    Ok(driver)
}

pub(super) async fn free_library(engine: &Engine, module: u16) -> Result<(), Stop> {
    call(engine, "KERNEL", "FreeLibrary", &[Arg::W(module)]).await?;
    Ok(())
}

/// The driver's `ExtDeviceMode` (`108c`): nought where it has only
/// `DeviceMode`, all ones where it has neither.
pub(super) async fn ext_device_mode(engine: &Engine, driver: u16) -> Result<u32, Stop> {
    let found = driver_entry(engine, driver, EXT_DEVICE_MODE).await?;

    if found != 0 {
        return Ok(found);
    }

    Ok(if driver_entry(engine, driver, DEVICE_MODE).await? != 0 {
        0
    } else {
        0xffff_ffff
    })
}

/// A `DEVMODE` from the driver's `ExtDeviceMode` (`10cc`): `modify`, a new
/// block made from `given` with `DM_COPY | DM_MODIFY`; else the driver's
/// default with `DM_COPY`, in `given` made the size, or a new block. The
/// handle; nought where the driver has only `DeviceMode` or would not
/// answer; `FFFFh` where it has neither, or the memory was not had.
pub(super) async fn dev_mode(
    engine: &Engine,
    hwnd: u16,
    driver: u16,
    given: u16,
    names: u32,
    modify: bool,
) -> Result<u16, Stop> {
    let procedure = ext_device_mode(engine, driver).await?;

    if procedure == 0xffff_ffff {
        return Ok(0xffff);
    }

    if procedure == 0 {
        return Ok(0);
    }

    let device = name_of(engine, names, DEVICE);
    let port = name_of(engine, names, PORT);
    let ask = |output: u32, input: u32, mode: u16| async move {
        driver_call(
            engine,
            procedure,
            &[
                GuestArg::Word(hwnd),
                GuestArg::Word(driver),
                GuestArg::Long(output),
                GuestArg::Long(device),
                GuestArg::Long(port),
                GuestArg::Long(input),
                GuestArg::Long(0),
                GuestArg::Word(mode),
            ],
        )
        .await
    };
    let size = u32::from(ask(0, 0, 0).await? as u16);

    if modify {
        if given == 0 {
            return Ok(0);
        }

        let input = lock(engine, given).await?;

        if input == 0 {
            return Ok(0);
        }

        let mut handle = alloc(engine, 2, size).await?;

        if handle != 0 {
            let output = lock(engine, handle).await?;

            if output == 0 {
                handle = 0;
            } else {
                ask(output, input, DM_COPY | DM_MODIFY).await?;
                unlock(engine, handle).await?;
            }
        }

        unlock(engine, given).await?;
        return Ok(handle);
    }

    let handle = if given != 0 {
        call(
            engine,
            "KERNEL",
            "GlobalReAlloc",
            &[Arg::W(given), Arg::D(size), Arg::W(2)],
        )
        .await? as u16
    } else {
        alloc(engine, 2, size).await?
    };

    if handle == 0 {
        return Ok(0xffff);
    }

    let output = lock(engine, handle).await?;

    if ask(output, 0, DM_COPY).await? as u16 == 0 {
        unlock(engine, handle).await?;
        free(engine, handle).await?;
        return Ok(0);
    }

    unlock(engine, handle).await?;
    Ok(handle)
}

/// The device or information context `PD_RETURNDC` or `PD_RETURNIC` asks
/// for, on `FILE:` with `PD_PRINTTOFILE`, put in `hDC` (`2fdc`).
pub(super) async fn make_dc(
    engine: &Engine,
    devmode: u32,
    names: u32,
    lppd: u32,
) -> Result<(), Stop> {
    let flags = flags(engine, lppd);
    let function = if flags & PD_RETURNDC != 0 {
        "CreateDC"
    } else if flags & PD_RETURNIC != 0 {
        "CreateIC"
    } else {
        return Ok(());
    };
    let port = if flags & PD_PRINTTOFILE != 0 {
        text(b"FILE:")
    } else {
        Arg::D(name_of(engine, names, PORT))
    };
    let hdc = call(
        engine,
        "GDI",
        function,
        &[
            Arg::D(name_of(engine, names, DRIVER)),
            Arg::D(name_of(engine, names, DEVICE)),
            port,
            Arg::D(devmode),
        ],
    )
    .await? as u16;

    set_word(engine, lppd, HDC, hdc);
    Ok(())
}

/// One of the two icons, WinBox's own: made once, kept.
fn own_icon(engine: &Engine, landscape: bool) -> u16 {
    let made = {
        let globals = globals(engine);

        if landscape {
            globals.landscape_made
        } else {
            globals.portrait_made
        }
    };

    if made != 0 {
        return made;
    }

    let group = super::templates::bytes(if landscape {
        super::print_resources::LANDSCAPE_GROUP
    } else {
        super::print_resources::PORTRAIT_GROUP
    });
    let handle = crate::icons::icon_block_of(&mut engine.system(), &group, |id| {
        super::print_resources::icon(id).map(super::templates::bytes)
    });
    let mut globals = globals(engine);

    if landscape {
        globals.landscape_made = handle;
    } else {
        globals.portrait_made = handle;
    }

    handle
}

/// The first of COMMDLG's print calls in progress sets up (`3de2`): the
/// icons loaded and locked, the driver's entries' names read. A count of
/// the calls is kept; a later one does nothing. Whether it was set up.
async fn start(engine: &Engine) -> Result<bool, Stop> {
    let was = {
        let mut globals = globals(engine);
        let was = globals.count;

        globals.count = was.wrapping_add(1);
        was
    };

    if was != 0 {
        return Ok(true);
    }

    let portrait = own_icon(engine, false);

    globals(engine).portrait = portrait;

    let mut locked = (false, false);
    let mut good = portrait != 0;

    if good {
        locked.0 = call(engine, "KERNEL", "LockResource", &[Arg::W(portrait)]).await? != 0;
        good = locked.0;
    }

    if good {
        let landscape = own_icon(engine, true);

        globals(engine).landscape = landscape;
        good = landscape != 0;

        if good {
            locked.1 = call(engine, "KERNEL", "LockResource", &[Arg::W(landscape)]).await? != 0;
            good = locked.1;
        }
    }

    if good {
        globals(engine).names = true;
        return Ok(true);
    }

    let (portrait, landscape) = {
        let globals = globals(engine);

        (globals.portrait, globals.landscape)
    };

    if locked.0 {
        unlock(engine, portrait).await?;

        if locked.1 {
            unlock(engine, landscape).await?;
        }
    }

    let mut globals = globals(engine);

    globals.count = 0;
    globals.portrait = 0;
    globals.landscape = 0;
    Ok(false)
}

/// A print call ends (`3ed8`): the count taken down, and with the last
/// one, the icons unlocked and let go of.
async fn end(engine: &Engine) -> Result<(), Stop> {
    let (last, portrait, landscape) = {
        let mut globals = globals(engine);

        globals.count = globals.count.wrapping_sub(1);
        (globals.count == 0, globals.portrait, globals.landscape)
    };

    if last {
        unlock(engine, portrait).await?;
        unlock(engine, landscape).await?;

        let mut globals = globals(engine);

        globals.portrait = 0;
        globals.landscape = 0;
    }

    Ok(())
}

/// The printer as a line (`062e`): "`<device>` on `<port>`", or, for a
/// port the network knows, "`<device>` on `<network name>` (`<port>`)",
/// the name lowered.
pub(super) async fn on_port(engine: &Engine, device: &[u8], port: &[u8]) -> Result<Vec<u8>, Stop> {
    let connection = called(
        engine,
        "USER",
        "WNetGetConnection",
        &[text(port), buffer(0x40), Arg::B(vec![0x40, 0])],
    )
    .await?;
    let mut line = device.to_vec();

    line.extend_from_slice(b" on ");

    if connection.word() == 0 {
        let lowered = called(
            engine,
            "USER",
            "AnsiLower",
            &[text(till_nought(&connection.buffers[0]))],
        )
        .await?;

        line.extend_from_slice(till_nought(&lowered.buffers[0]));
        line.extend_from_slice(b" (");
        line.extend_from_slice(port);
        line.push(b')');
    } else {
        line.extend_from_slice(port);
    }

    Ok(line)
}

/// The Print dialog's printer line (`1471`): the printer on its port, for
/// the default "Default Printer (" before it and ")" after.
pub(super) async fn printer_line(engine: &Engine, names: u32) -> Result<Vec<u8>, Stop> {
    let device = string(engine, name_of(engine, names, DEVICE));
    let port = string(engine, name_of(engine, names, PORT));
    let line = on_port(engine, &device, &port).await?;

    if word(engine, names, DEFAULT) & 1 == 0 {
        return Ok(line);
    }

    let mut whole = resource(0x441);

    whole.extend_from_slice(&line);
    whole.push(b')');
    Ok(whole)
}

/// The Print dialog's qualities filled (`0350`): the driver's resolutions
/// where it has `DeviceCapabilities` and a `DEVMODE` of 3.10's, else
/// COMMDLG's four, the one of `quality` chosen. `lppd` nought for the four.
#[allow(clippy::too_many_lines)]
pub(super) async fn qualities(
    engine: &Engine,
    dialog: u16,
    quality: i16,
    lppd: u32,
) -> Result<(), Stop> {
    let list = item(engine, dialog, 0x470).await?;

    send(engine, list, CB_RESETCONTENT, 0, 0).await?;

    let mut driver = 0;
    let mut names_handle = 0;
    let mut mode_handle = 0;
    let mut chosen = None;

    'driver: {
        if lppd == 0 {
            break 'driver;
        }

        let devmode = word(engine, lppd, DEVMODE);
        let devnames = word(engine, lppd, DEVNAMES);

        if devmode == 0 || devnames == 0 {
            break 'driver;
        }

        names_handle = devnames;

        let names = lock(engine, devnames).await?;

        driver = load_driver(engine, name_of(engine, names, DRIVER)).await?;

        if driver < 0x20 {
            break 'driver;
        }

        mode_handle = devmode;

        let mode = lock(engine, devmode).await?;

        if word(engine, mode, 0x20) < 0x30a {
            break 'driver;
        }

        let procedure = driver_entry(engine, driver, DEVICE_CAPABILITIES).await?;

        if procedure == 0 {
            break 'driver;
        }

        let count = capabilities(engine, procedure, names, DC_ENUMRESOLUTIONS, 0, 0).await?;

        if count == 0 || count == 0xffff_ffff {
            break 'driver;
        }

        let block = alloc(engine, 0x42, ((count as u16) << 3) as i16 as u32).await?;

        if block == 0 {
            break 'driver;
        }

        let mut selected = 0u16;
        let pairs = lock(engine, block).await?;
        let count = capabilities(engine, procedure, names, DC_ENUMRESOLUTIONS, pairs, 0).await?;
        let new = version(engine).await? >= 0x30a;
        let mut index = count as u16 as i16 - 1;

        while index >= 0 {
            let step = u32::from(index as u16) << 3;
            let x = dword(engine, pairs, step);
            let y = dword(engine, pairs, step + 4);
            let label = if x == y {
                format!("{} dpi", x as i32)
            } else {
                format!("{} dpi x {} dpi", x as i32, y as i32)
            };

            send_bytes(engine, list, CB_INSERTSTRING, 0, text(label.as_bytes())).await?;
            send(
                engine,
                list,
                CB_SETITEMDATA,
                0,
                (y & 0xffff) << 16 | (x & 0xffff),
            )
            .await?;

            let y_resolution = word(engine, mode, 0x40);

            if x as u16 == quality as u16 && (!new || y_resolution == 0 || y_resolution == y as u16)
            {
                selected = index as u16;
            }

            index -= 1;
        }

        unlock(engine, block).await?;
        free(engine, block).await?;
        chosen = Some(selected);
    }

    let selected = if let Some(selected) = chosen {
        selected
    } else {
        // COMMDLG's four, Draft first, each put at the top (`056c`).
        let mut data = 0xffffu16;

        for id in (0x430..=0x433).rev() {
            send_bytes(engine, list, CB_INSERTSTRING, 0, text(&resource(id))).await?;
            send(engine, list, CB_SETITEMDATA, 0, u32::from(data)).await?;
            data = data.wrapping_sub(1);
        }

        let quality = if (-4..0).contains(&quality) {
            quality
        } else {
            -4
        };

        (quality + 4) as u16
    };

    send(engine, list, CB_SETCURSEL, selected, 0).await?;

    if driver != 0 {
        free_library(engine, driver).await?;
    }

    if names_handle != 0 {
        unlock(engine, names_handle).await?;
    }

    if mode_handle != 0 {
        unlock(engine, mode_handle).await?;
    }

    Ok(())
}

pub(super) async fn send_bytes(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: Arg,
) -> Result<u32, Stop> {
    Ok(api::send_bytes(engine, hwnd, message, wparam, lparam)
        .await?
        .value)
}

/// A program's template found and loaded (`0a5e`): nought for either
/// failing.
async fn find_template(engine: &Engine, instance: u16, name: u32) -> Result<u16, Stop> {
    let found = call(
        engine,
        "KERNEL",
        "FindResource",
        &[Arg::W(instance), Arg::D(name), Arg::D(RT_DIALOG)],
    )
    .await? as u16;

    if found == 0 {
        return Ok(0);
    }

    Ok(call(
        engine,
        "KERNEL",
        "LoadResource",
        &[Arg::W(instance), Arg::W(found)],
    )
    .await? as u16)
}

/// Where a dialog's template comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Template {
    /// The program's handle: left to it.
    Given,
    /// The program's, by name: let go with `FreeResource`.
    Named,
    /// COMMDLG's own, WinBox's: freed.
    Own,
}

/// The template for Print Setup, or the Print dialog, as `PrintDlg` and
/// Print's Setup button choose it (`0e23`, `0ec9`, `3bb4`): its handle,
/// and where it came from; nought and the error for none.
pub(super) async fn template(
    engine: &Engine,
    lppd: u32,
    setup: bool,
) -> Result<Result<(u16, Template), u32>, Stop> {
    let flags = flags(engine, lppd);
    let (handle_flag, name_flag, handle_at, name_at) = if setup {
        (
            PD_ENABLESETUPTEMPLATEHANDLE,
            PD_ENABLESETUPTEMPLATE,
            SETUP_TEMPLATE,
            SETUP_TEMPLATE_NAME,
        )
    } else {
        (
            PD_ENABLEPRINTTEMPLATEHANDLE,
            PD_ENABLEPRINTTEMPLATE,
            PRINT_TEMPLATE,
            PRINT_TEMPLATE_NAME,
        )
    };

    if flags & handle_flag != 0 {
        return Ok(Ok((word(engine, lppd, handle_at), Template::Given)));
    }

    if flags & name_flag != 0 {
        let name = dword(engine, lppd, name_at);

        if name == 0 {
            return Ok(Err(CDERR_NOTEMPLATE));
        }

        let instance = word(engine, lppd, INSTANCE);

        if instance == 0 {
            return Ok(Err(CDERR_NOHINSTANCE));
        }

        return Ok(match find_template(engine, instance, name).await? {
            0 => Err(CDERR_LOADRESFAILURE),
            handle => Ok((handle, Template::Named)),
        });
    }

    let hex = if setup {
        super::print_resources::SETUP_TEMPLATE
    } else {
        super::print_resources::PRINT_TEMPLATE
    };

    Ok(match super::guest_calls::own_template(engine, hex).await? {
        0 => Err(CDERR_LOADRESFAILURE),
        handle => Ok((handle, Template::Own)),
    })
}

/// A template let go of as `PrintDlg` lets it go (`0fe4`, `3cb4`).
pub(super) async fn let_go(engine: &Engine, handle: u16, from: Template) -> Result<(), Stop> {
    match from {
        Template::Given => {}
        Template::Named => {
            call(engine, "KERNEL", "FreeResource", &[Arg::W(handle)]).await?;
        }
        Template::Own => super::guest_calls::free_template(engine, handle).await?,
    }

    Ok(())
}

/// `PrintDlg` (seg3 `0c94`).
pub fn print_dlg(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let lppd = args.dword(&engine.system());

        wait(engine, true);

        let answer = call_print_dlg(engine, lppd).await?;

        end(engine).await?;
        wait(engine, false);
        Ok(Answer::Word(answer))
    })
}

/// The call between the hourglass and the count's taking down.
#[allow(clippy::too_many_lines)]
async fn call_print_dlg(engine: &Engine, lppd: u32) -> Result<u16, Stop> {
    if dword(engine, lppd, 0) != 0x34 {
        set_error(engine, CDERR_STRUCTSIZE);
        return Ok(0);
    }

    if !start(engine).await? {
        set_error(engine, PDERR_SETUPFAILURE);
        return Ok(0);
    }

    let given = word(engine, lppd, DEVNAMES);

    if given != 0 && !check_names(engine, given).await? {
        return Ok(0);
    }

    set_error(engine, 0);

    let flags = flags(engine, lppd);

    if flags & PD_RETURNDEFAULT != 0 {
        if word(engine, lppd, DEVNAMES) != 0 || word(engine, lppd, DEVMODE) != 0 {
            set_error(engine, PDERR_RETDEFFAILURE);
            return Ok(0);
        }

        let handle = default_names(engine).await?;

        set_word(engine, lppd, DEVNAMES, handle);

        if handle == 0 {
            return Ok(0);
        }

        let names = lock(engine, handle).await?;

        if names == 0 {
            set_error(engine, CDERR_MEMLOCKFAILURE);
            return Ok(0);
        }

        let mut answer = 0;
        let driver = load_driver(engine, name_of(engine, names, DRIVER)).await?;

        if driver < 0x20 {
            set_error(engine, PDERR_LOADDRVFAILURE);
        } else {
            let owner = word(engine, lppd, OWNER);
            let given = word(engine, lppd, DEVMODE);
            let mut devmode = dev_mode(engine, owner, driver, given, names, false).await?;

            if devmode == 0xffff {
                devmode = 0;
            }

            set_word(engine, lppd, DEVMODE, devmode);

            let mode = if devmode != 0 {
                lock(engine, devmode).await?
            } else {
                0
            };

            make_dc(engine, mode, names, lppd).await?;

            if devmode != 0 {
                unlock(engine, devmode).await?;
            }

            answer = 1;
            free_library(engine, driver).await?;
        }

        unlock(engine, handle).await?;

        if answer == 0 {
            free(engine, handle).await?;
            set_word(engine, lppd, DEVNAMES, 0);
        }

        return Ok(answer);
    }

    let setup = flags & PD_PRINTSETUP != 0;
    let (handle, from) = match template(engine, lppd, setup).await? {
        Ok(found) => found,
        Err(code) => {
            set_error(engine, code);
            return Ok(0);
        }
    };

    // The hook kept for the messages before `WM_INITDIALOG` (`0e48`,
    // `0f4e`).
    if setup && flags & PD_ENABLESETUPHOOK != 0 {
        globals(engine).hook = dword(engine, lppd, SETUP_HOOK);
    } else if !setup && flags & PD_ENABLEPRINTHOOK != 0 {
        globals(engine).hook = dword(engine, lppd, PRINT_HOOK);
    }

    if call(engine, "KERNEL", "LockResource", &[Arg::W(handle)]).await? == 0 {
        set_error(engine, CDERR_LOCKRESFAILURE);
        return Ok(0);
    }

    let instance = super::instance(&engine.system());
    let procedure = export(
        engine,
        if setup {
            PRINT_SETUP_DLG_PROC
        } else {
            PRINT_DLG_PROC
        },
    );
    let owner = word(engine, lppd, OWNER);
    let mut answer = call(
        engine,
        "USER",
        "DialogBoxIndirectParam",
        &[
            Arg::W(instance),
            Arg::W(handle),
            Arg::W(owner),
            Arg::D(procedure),
            Arg::D(lppd),
        ],
    )
    .await? as u16;

    globals(engine).hook = 0;

    if answer == 0xffff {
        set_error(engine, CDERR_DIALOGFAILURE);
        answer = 0;
    }

    unlock(engine, handle).await?;
    let_go(engine, handle, from).await?;
    Ok(answer)
}

/// A dialog's number under its property A000h: nought before it starts.
pub(super) async fn number(engine: &Engine, dialog: u16) -> Result<u16, Stop> {
    Ok(call(engine, "USER", "GetProp", &[Arg::W(dialog), Arg::D(0xa000)]).await? as u16)
}

/// The dialog's six bytes, by its number.
pub(super) fn dialog_data(engine: &Engine, number: u16) -> Dialog {
    globals(engine)
        .dialogs
        .get(&number)
        .copied()
        .unwrap_or_default()
}

/// A dialog given its six bytes and its property (`1750`, `2559`): its
/// number.
pub(super) async fn give_property(engine: &Engine, dialog: u16, lppd: u32) -> Result<u16, Stop> {
    let number = super::guest_calls::next_number(engine);

    call(
        engine,
        "USER",
        "SetProp",
        &[Arg::W(dialog), Arg::D(0xa000), Arg::W(number)],
    )
    .await?;
    globals(engine)
        .dialogs
        .insert(number, Dialog { lppd, devmode: 0 });
    Ok(number)
}

/// A dialog's property taken and its six bytes let go (`1974`, `337e`).
pub(super) async fn take_property(engine: &Engine, dialog: u16) -> Result<(), Stop> {
    let number = call(
        engine,
        "USER",
        "RemoveProp",
        &[Arg::W(dialog), Arg::D(0xa000)],
    )
    .await? as u16;

    globals(engine).dialogs.remove(&number);
    Ok(())
}

/// The hooks before a dialog's own code (`3757`, `30b1`): the structure's,
/// once there is a property, then the one kept, but for `WM_INITDIALOG`.
/// What answered, where something did.
pub(super) async fn hooks(
    engine: &Engine,
    hook_at: u32,
    words: (u16, u16, u16, u32),
) -> Result<Option<u16>, Stop> {
    let (dialog, message, wparam, lparam) = words;
    let number = number(engine, dialog).await?;

    if number != 0 {
        let lppd = dialog_data(engine, number).lppd;

        if lppd != 0 {
            let hook = dword(engine, lppd, hook_at);

            if hook != 0 {
                let answer =
                    super::call_hook(engine, hook, dialog, message, wparam, lparam).await?;

                if answer != 0 {
                    return Ok(Some(answer));
                }
            }
        }
    }

    let kept = globals(engine).hook;

    if kept != 0 && message != WM_INITDIALOG {
        let answer = super::call_hook(engine, kept, dialog, message, wparam, lparam).await?;

        if answer != 0 {
            return Ok(Some(answer));
        }
    }

    Ok(None)
}

/// The four arguments of a window procedure.
pub(super) fn window_args(engine: &Engine, args: &mut Args) -> (u16, u16, u16, u32) {
    let system = engine.system();
    let hwnd = args.word(&system);
    let message = args.word(&system);
    let wparam = args.word(&system);
    let lparam = args.dword(&system);

    (hwnd, message, wparam, lparam)
}

/// `CallWindowProc` of a subclassed control's own procedure.
pub(super) async fn call_window_proc(
    engine: &Engine,
    procedure: u32,
    words: (u16, u16, u16, u32),
) -> Result<u32, Stop> {
    let (hwnd, message, wparam, lparam) = words;

    call(
        engine,
        "USER",
        "CallWindowProc",
        &[
            Arg::D(procedure),
            Arg::W(hwnd),
            Arg::W(message),
            Arg::W(wparam),
            Arg::D(lparam),
        ],
    )
    .await
}

/// `EditIntegerOnly` (seg3 `0000`): a character but a digit or Backspace
/// refused with a beep; all else to the edit's own procedure.
pub fn edit_integer_only(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        const WM_CHAR: u16 = 0x0102;

        let words = window_args(engine, &mut args);
        let (_, message, wparam, _) = words;

        if message == WM_CHAR && wparam != 8 && !(0x30..=0x39).contains(&wparam) {
            call(engine, "USER", "MessageBeep", &[Arg::W(0)]).await?;
            return Ok(Answer::Dword(0));
        }

        let procedure = globals(engine).edit_proc;

        Ok(Answer::Dword(
            call_window_proc(engine, procedure, words).await?,
        ))
    })
}

/// `dwUpArrowHack` (seg3 `0056`): Up or Left in the closed printers' list
/// moves to Default Printer and checks it; all else to the combo box's own
/// procedure.
pub fn dw_up_arrow_hack(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        const WM_KEYDOWN: u16 = 0x0100;
        const VK_LEFT: u16 = 0x25;
        const VK_UP: u16 = 0x26;

        let words = window_args(engine, &mut args);
        let (hwnd, message, wparam, _) = words;

        if message == WM_KEYDOWN
            && (wparam == VK_UP || wparam == VK_LEFT)
            && send(engine, hwnd, CB_GETDROPPEDSTATE, 0, 0).await? == 0
        {
            let parent = call(engine, "USER", "GetParent", &[Arg::W(hwnd)]).await? as u16;
            let default = item(engine, parent, 0x422).await?;

            send(engine, parent, WM_NEXTDLGCTL, default, 1).await?;
            check_radio(engine, parent, 0x422, 0x423, 0x422).await?;
            return Ok(Answer::Dword(0));
        }

        let procedure = globals(engine).list_proc;

        Ok(Answer::Dword(
            call_window_proc(engine, procedure, words).await?,
        ))
    })
}
