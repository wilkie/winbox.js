//! The Print Setup dialog's procedure, `PrintSetupDlgProc` (22): COMMDLG's
//! dialog 1539, from `PrintDlg` or the Print dialog's Setup button -- the
//! printers from `WIN.INI`, the orientation, and the paper sizes and
//! sources the driver names (`COMMDLG.DLL` seg3 `307a`). As
//! `print-setup.ts`.

use super::api::{Arg, buffer, text};
use super::print_dlg::{
    CB_ADDSTRING, CB_GETCOUNT, CB_GETCURSEL, CB_GETDROPPEDSTATE, CB_GETITEMDATA, CB_INSERTSTRING,
    CB_RESETCONTENT, CB_SETCURSEL, CB_SETEXTENDEDUI, CB_SETITEMDATA, CDERR_MEMLOCKFAILURE,
    CDERR_NOHOOK, DEFAULT, DEVICE, DEVICE_CAPABILITIES, DEVMODE, DEVNAMES, DRIVER,
    DW_UP_ARROW_HACK, EXT_DEVICE_MODE, GWL_STYLE, GWL_WNDPROC, HDC, OWNER, PD_ENABLESETUPHOOK,
    PD_NOWARNING, PD_PRINTSETUP, PD_RETURNDC, PD_RETURNIC, PD_SHOWHELP, PDERR_GETDEVMODEFAIL,
    PDERR_INITFAILURE, PDERR_LOADDRVFAILURE, PDERR_NODEFAULTPRN, PDERR_NODEVICES,
    PDERR_PRINTERNOTFOUND, PORT, QUERYESCSUPPORT, SETUP_HOOK, STM_SETICON, SW_HIDE, SW_SHOWNA,
    WM_COMMAND, WM_GETFONT, WM_INITDIALOG, WM_MEASUREITEM, WM_NEXTDLGCTL, WS_TABSTOP, alloc, at,
    call, called, capabilities, check, check_names, check_radio, checked, default_names, dev_mode,
    dialog_data, driver_call, driver_entry, dword, enable, error, export, find_names, flags, free,
    free_library, give_property, globals, hooks, item, load_driver, lock, make_dc, message_box,
    name_of, number, on_port, profile, put_string, resource, same, send, send_item, set_dword,
    set_error, set_word, show, string, take_property, till_nought, unlock, version, wait,
    window_args, word,
};
use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg};

const IDOK: u16 = 1;
const PSH_OPTIONS: u16 = 0x400;
const PSH_HELP: u16 = 0x40e;
const RAD_PORTRAIT: u16 = 0x420;
const RAD_LANDSCAPE: u16 = 0x421;
const RAD_DEFAULT: u16 = 0x422;
const RAD_SPECIFIC: u16 = 0x423;
const GRP_ORIENTATION: u16 = 0x430;
const GRP_PAPER: u16 = 0x431;
const ICO_ORIENTATION: u16 = 0x43c;
const STC_CURRENT: u16 = 0x440;
const STC_SIZE: u16 = 0x441;
const STC_SOURCE: u16 = 0x442;
const CMB_PRINTERS: u16 = 0x470;
const CMB_SIZES: u16 = 0x471;
const CMB_SOURCES: u16 = 0x472;

const CBN_SELCHANGE: u16 = 1;
const CBN_SETFOCUS: u16 = 3;
const CBN_CLOSEUP: u16 = 8;

const DC_PAPERS: u16 = 2;
const DC_BINS: u16 = 6;
const DC_BINNAMES: u16 = 0xc;
const DC_PAPERNAMES: u16 = 0x10;
const DC_ORIENTATION: u16 = 0x11;
const GETSETPAPERBINS: u16 = 0x1d;
const ENUMPAPERBINS: u16 = 0x1f;

// The `DEVMODE`'s fields COMMDLG reads and writes.
const DM_SPEC_VERSION: u32 = 0x20;
const DM_DRIVER_VERSION: u32 = 0x22;
const DM_ORIENTATION: u32 = 0x2c;
const DM_PAPER_SIZE: u32 = 0x2e;
const DM_DEFAULT_SOURCE: u32 = 0x38;

/// Drivers COMMDLG does not ask for their paper sizes (`[232h]`, `02c1`).
const NO_PAPERS: [&[u8]; 7] = [
    b"CITOH",
    b"IBMGRX",
    b"TI850",
    b"TOSHIBA",
    b"THINKJET",
    b"IBMCOLOR",
    b"CANON10E",
];

/// Drivers COMMDLG treats apart before 3.10's `DEVMODE` (`[25Ah]`,
/// `0307`).
const OLD_HP: [&[u8]; 3] = [b"HPPCL", b"HPPCL5A", b"SD_LJET"];

pub fn print_setup_dlg_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let words = window_args(engine, &mut args);

        Ok(Answer::Word(procedure(engine, words).await?))
    })
}

/// The procedure (seg3 `307a`).
async fn procedure(engine: &Engine, words: (u16, u16, u16, u32)) -> Result<u16, Stop> {
    if let Some(answer) = hooks(engine, SETUP_HOOK, words).await? {
        return Ok(answer);
    }

    let (dialog, message, wparam, lparam) = words;

    match message {
        WM_MEASUREITEM => {
            measure(engine, dialog, lparam).await?;
            Ok(1)
        }
        WM_INITDIALOG => {
            globals(engine).hook = 0;

            let answer = start(engine, dialog, wparam, lparam).await?;

            wait(engine, false);
            Ok(answer)
        }
        WM_COMMAND => {
            let number = number(engine, dialog).await?;

            command(engine, dialog, number, wparam, lparam).await
        }
        _ => Ok(0),
    }
}

/// `WM_MEASUREITEM` (seg3 `2f59`): the height of the dialog's font, or
/// the System font's, measured once and kept.
async fn measure(engine: &Engine, dialog: u16, lparam: u32) -> Result<(), Stop> {
    if globals(engine).item_height == 0 {
        let hdc = call(engine, "USER", "GetDC", &[Arg::W(dialog)]).await? as u16;
        let mut font = send(engine, dialog, WM_GETFONT, 0, 0).await? as u16;

        if font == 0 {
            font = call(engine, "GDI", "GetStockObject", &[Arg::W(0xd)]).await? as u16;
        }

        let previous = call(engine, "GDI", "SelectObject", &[Arg::W(hdc), Arg::W(font)]).await?;
        let metrics = called(
            engine,
            "GDI",
            "GetTextMetrics",
            &[Arg::W(hdc), buffer(0x1f)],
        )
        .await?;

        call(
            engine,
            "GDI",
            "SelectObject",
            &[Arg::W(hdc), Arg::W(previous as u16)],
        )
        .await?;
        call(engine, "USER", "ReleaseDC", &[Arg::W(dialog), Arg::W(hdc)]).await?;
        globals(engine).item_height =
            u16::from_le_bytes([metrics.buffers[0][0], metrics.buffers[0][1]]);
    }

    let height = globals(engine).item_height;

    set_word(engine, lparam, 8, height);
    Ok(())
}

/// Whether the driver is one COMMDLG asks for paper sizes (`02c1`).
async fn asks_papers(engine: &Engine, names: u32) -> Result<bool, Stop> {
    for name in NO_PAPERS {
        if same(engine, text(name), Arg::D(name_of(engine, names, DRIVER))).await? {
            return Ok(false);
        }
    }

    Ok(true)
}

/// Which of the old Hewlett-Packard drivers the driver is, from 1, or
/// nought (`0307`).
async fn old_hp(engine: &Engine, names: u32) -> Result<u16, Stop> {
    for (index, name) in OLD_HP.iter().enumerate() {
        if same(engine, text(name), Arg::D(name_of(engine, names, DRIVER))).await? {
            return Ok(index as u16 + 1);
        }
    }

    Ok(0)
}

/// `WM_INITDIALOG` (seg3 `2559`).
#[allow(clippy::too_many_lines)]
async fn start(engine: &Engine, dialog: u16, wparam: u16, lppd: u32) -> Result<u16, Stop> {
    let list = item(engine, dialog, CMB_PRINTERS).await?;
    let number = give_property(engine, dialog, lppd).await?;

    'failed: {
        if flags(engine, lppd) & PD_ENABLESETUPHOOK != 0 {
            if dword(engine, lppd, SETUP_HOOK) == 0 {
                set_error(engine, CDERR_NOHOOK);
                break 'failed;
            }
        } else {
            set_dword(engine, lppd, SETUP_HOOK, 0);
        }

        'unlock: {
            // Opened from Print with a `DEVNAMES` but no `DEVMODE`: no
            // driver, and no Options (`2602`).
            // The `DEVNAMES` stays locked from here to the list's choice
            // (`2610`, `26cc`, `29ad`).
            let mut names = 0;

            if word(engine, lppd, DEVMODE) == 0 && word(engine, lppd, DEVNAMES) != 0 {
                names = lock(engine, word(engine, lppd, DEVNAMES)).await?;

                if names == 0 {
                    set_error(engine, CDERR_MEMLOCKFAILURE);
                    break 'failed;
                }

                if flags(engine, lppd) & PD_PRINTSETUP == 0 {
                    enable(engine, dialog, PSH_OPTIONS, false).await?;
                } else {
                    unlock(engine, word(engine, lppd, DEVNAMES)).await?;
                    names = 0;
                }
            }

            if names == 0 {
                let given = word(engine, lppd, DEVNAMES);

                if given != 0 && !check_names(engine, given).await? {
                    break 'failed;
                }

                let bits = find_names(engine, lppd).await?;

                if bits == 0 {
                    if error(engine) == PDERR_NODEFAULTPRN
                        && flags(engine, lppd) & PD_NOWARNING == 0
                    {
                        message_box(engine, dialog, &resource(0x45a), &resource(0x448)).await?;
                    }

                    break 'failed;
                }

                names = lock(engine, word(engine, lppd, DEVNAMES)).await?;

                if names == 0 {
                    set_error(engine, CDERR_MEMLOCKFAILURE);
                    break 'failed;
                }

                let wdefault = word(engine, names, DEFAULT);

                set_word(engine, names, DEFAULT, wdefault | bits);

                let driver = load_driver(engine, name_of(engine, names, DRIVER)).await?;

                if driver <= 0x20 {
                    set_error(engine, PDERR_LOADDRVFAILURE);
                    break 'unlock;
                }

                let given = word(engine, lppd, DEVMODE);
                let devmode = if given == 0 {
                    let devmode = dev_mode(engine, dialog, driver, 0, names, false).await?;

                    set_devmode(engine, number, devmode);

                    if devmode == 0 {
                        enable(engine, dialog, PSH_OPTIONS, false).await?;
                    }

                    devmode
                } else {
                    let devmode = dev_mode(engine, dialog, driver, given, names, true).await?;

                    set_devmode(engine, number, devmode);
                    devmode
                };

                if devmode == 0xffff || (given != 0 && devmode == 0) {
                    set_error(engine, PDERR_GETDEVMODEFAIL);
                    free_library(engine, driver).await?;
                    break 'unlock;
                }

                if devmode != 0 {
                    let mode = lock(engine, devmode).await?;

                    if mode == 0 {
                        set_error(engine, CDERR_MEMLOCKFAILURE);
                        break 'unlock;
                    }

                    let paper = sizes(engine, names, mode, driver, dialog).await?
                        | sources(engine, names, mode, driver, dialog).await?;

                    enable(engine, dialog, GRP_PAPER, paper).await?;
                    set_word(engine, lppd, HDC, 0);

                    if orientation(engine, names, mode, driver, dialog).await?
                        || enabled(engine, dialog, RAD_PORTRAIT).await?
                    {
                        orient(engine, dialog, word(engine, mode, DM_ORIENTATION) != 2).await?;
                    }

                    let options = advanced_setup(engine, driver).await? != 0
                        || driver_entry(engine, driver, EXT_DEVICE_MODE).await? != 0;

                    enable(engine, dialog, PSH_OPTIONS, options).await?;
                    unlock(engine, devmode).await?;
                }

                free_library(engine, driver).await?;
            }

            // (`28cb`)
            if dialog_data(engine, number).devmode == 0 {
                paper_and_orientation(engine, dialog, false).await?;
            }

            if list_printers(engine, dialog, CMB_PRINTERS).await? == 0 {
                break 'unlock;
            }

            if error(engine) == PDERR_NODEFAULTPRN {
                enable(engine, dialog, RAD_DEFAULT, false).await?;
            }

            let found = find_printer(engine, names, dialog).await?;
            let default = word(engine, names, DEFAULT) & 1 != 0;

            if found == 0xffff && !default {
                take_names(engine, dialog, lppd, false).await?;
                set_error(engine, PDERR_PRINTERNOTFOUND);
                break 'unlock;
            }

            check_radio(
                engine,
                dialog,
                RAD_DEFAULT,
                RAD_SPECIFIC,
                if default { RAD_DEFAULT } else { RAD_SPECIFIC },
            )
            .await?;

            if !default {
                let style = call(
                    engine,
                    "USER",
                    "GetWindowLong",
                    &[Arg::W(list), Arg::W(GWL_STYLE)],
                )
                .await?;

                call(
                    engine,
                    "USER",
                    "SetWindowLong",
                    &[Arg::W(list), Arg::W(GWL_STYLE), Arg::D(style | WS_TABSTOP)],
                )
                .await?;
            }

            send(
                engine,
                list,
                CB_SETCURSEL,
                if found == 0xffff { 0 } else { found },
                0,
            )
            .await?;
            unlock(engine, word(engine, lppd, DEVNAMES)).await?;

            if version(engine).await? >= 0x30a {
                send(engine, list, CB_SETEXTENDEDUI, 1, 0).await?;
                send_item(engine, dialog, CMB_SIZES, CB_SETEXTENDEDUI, 1, 0).await?;
                send_item(engine, dialog, CMB_SOURCES, CB_SETEXTENDEDUI, 1, 0).await?;

                let subclass = export(engine, DW_UP_ARROW_HACK);
                let previous = call(
                    engine,
                    "USER",
                    "SetWindowLong",
                    &[Arg::W(list), Arg::W(GWL_WNDPROC), Arg::D(subclass)],
                )
                .await?;

                globals(engine).list_proc = previous;
            }

            if flags(engine, lppd) & PD_SHOWHELP == 0 {
                enable(engine, dialog, PSH_HELP, false).await?;
                show(engine, dialog, PSH_HELP, SW_HIDE).await?;
            }

            if flags(engine, lppd) & PD_ENABLESETUPHOOK != 0 {
                let hook = dword(engine, lppd, SETUP_HOOK);

                return super::call_hook(engine, hook, dialog, WM_INITDIALOG, wparam, lppd).await;
            }

            return Ok(1);
        }

        // (`27a0`)
        unlock(engine, word(engine, lppd, DEVNAMES)).await?;
    }

    // (`27ac`)
    take_property(engine, dialog).await?;
    call(engine, "USER", "EndDialog", &[Arg::W(dialog), Arg::W(0)]).await?;

    if error(engine) == 0 {
        set_error(engine, PDERR_INITFAILURE);
    }

    Ok(0)
}

fn set_devmode(engine: &Engine, number: u16, devmode: u16) {
    if let Some(data) = globals(engine).dialogs.get_mut(&number) {
        data.devmode = devmode;
    }
}

async fn enabled(engine: &Engine, dialog: u16, id: u16) -> Result<bool, Stop> {
    let control = item(engine, dialog, id).await?;

    Ok(call(engine, "USER", "IsWindowEnabled", &[Arg::W(control)]).await? as u16 != 0)
}

/// The driver's `AdvancedSetupDialog` (`2474`).
async fn advanced_setup(engine: &Engine, driver: u16) -> Result<u32, Stop> {
    call(
        engine,
        "KERNEL",
        "GetProcAddress",
        &[Arg::W(driver), text(b"AdvancedSetupDialog")],
    )
    .await
}

/// The paper sizes filled (seg3 `1d7c`), from the driver's `DC_PAPERS`,
/// named by COMMDLG's strings or the driver's `DC_PAPERNAMES`. Whether
/// there are any.
#[allow(clippy::too_many_lines)]
async fn sizes(
    engine: &Engine,
    names: u32,
    mode: u32,
    driver: u16,
    dialog: u16,
) -> Result<bool, Stop> {
    let mut good = false;

    send_item(engine, dialog, CMB_SIZES, CB_RESETCONTENT, 0, 0).await?;

    'asked: {
        let spec = word(engine, mode, DM_SPEC_VERSION);

        if spec < 0x30a
            && word(engine, mode, DM_DRIVER_VERSION) < 0x3850
            && old_hp(engine, names).await? == 2
        {
            break 'asked;
        }

        if spec < 0x300 || !asks_papers(engine, names).await? {
            break 'asked;
        }

        let procedure = driver_entry(engine, driver, DEVICE_CAPABILITIES).await?;

        if procedure == 0 {
            break 'asked;
        }

        let count = capabilities(engine, procedure, names, DC_PAPERS, 0, mode).await?;

        if count == 0 || count == 0xffff_ffff {
            break 'asked;
        }

        let mut titles = 0u32;
        let mut titles_block = 0;
        let mut titles_far = 0;

        if spec >= 0x30a {
            titles = capabilities(engine, procedure, names, DC_PAPERNAMES, 0, mode).await?;

            if titles == 0xffff_ffff || titles == 0xffff {
                titles = 0;
            }
        }

        if titles != 0 {
            titles_block = alloc(engine, 0x42, u32::from((titles as u16) << 6)).await?;
            titles_far = lock(engine, titles_block).await?;
            capabilities(engine, procedure, names, DC_PAPERNAMES, titles_far, mode).await?;
        }

        let count = count as u16;
        let papers_block = alloc(engine, 0x42, u32::from(count << 1)).await?;
        let papers = lock(engine, papers_block).await?;

        capabilities(engine, procedure, names, DC_PAPERS, papers, mode).await?;

        let mut added = 0u16;

        for index in 0..count as i16 {
            let paper = word(engine, papers, u32::from(index as u16) * 2);
            let label = if paper <= 0x100 {
                let label = resource(0x480 + paper);

                if label.is_empty() {
                    continue;
                }

                text(&label)
            } else if titles != 0 {
                Arg::D(at(titles_far, u32::from(index as u16) << 6))
            } else {
                continue;
            };

            send_item_bytes(engine, dialog, CMB_SIZES, CB_INSERTSTRING, 0xffff, label).await?;

            if word(engine, mode, DM_PAPER_SIZE) == paper {
                send_item(engine, dialog, CMB_SIZES, CB_SETCURSEL, added, 0).await?;
            }

            send_item(
                engine,
                dialog,
                CMB_SIZES,
                CB_SETITEMDATA,
                added,
                u32::from(paper),
            )
            .await?;
            added += 1;
        }

        unlock(engine, papers_block).await?;
        free(engine, papers_block).await?;

        if titles != 0 {
            unlock(engine, titles_block).await?;
            free(engine, titles_block).await?;
        }

        good = true;
    }

    enable(engine, dialog, CMB_SIZES, good).await?;
    enable(engine, dialog, STC_SIZE, good).await?;
    Ok(good)
}

async fn send_item_bytes(
    engine: &Engine,
    dialog: u16,
    id: u16,
    message: u16,
    wparam: u16,
    lparam: Arg,
) -> Result<u32, Stop> {
    Ok(
        super::api::send_item_bytes(engine, dialog, id, message, wparam, lparam)
            .await?
            .value,
    )
}

/// The paper sources filled (seg3 `2026`), from the driver's `DC_BINS`
/// and `DC_BINNAMES`, or for an older driver its `GETSETPAPERBINS` and
/// `ENUMPAPERBINS` escapes. Whether there are any.
#[allow(clippy::too_many_lines)]
async fn sources(
    engine: &Engine,
    names: u32,
    mode: u32,
    driver: u16,
    dialog: u16,
) -> Result<bool, Stop> {
    let mut good = false;
    let mut count = 0u16;
    let mut block = 0;
    let mut bins = 0u32;

    send_item(engine, dialog, CMB_SOURCES, CB_RESETCONTENT, 0, 0).await?;

    'asked: {
        let spec = word(engine, mode, DM_SPEC_VERSION);

        if spec < 0x30a {
            let hp = old_hp(engine, names).await?;

            if hp != 0 && (hp != 2 || word(engine, mode, DM_DRIVER_VERSION) < 0x3850) {
                break 'asked;
            }
        }

        if spec >= 0x30a {
            let procedure = driver_entry(engine, driver, DEVICE_CAPABILITIES).await?;

            if procedure != 0 {
                let titles = capabilities(engine, procedure, names, DC_BINNAMES, 0, mode).await?;

                if titles != 0 && titles != 0xffff_ffff {
                    block = alloc(engine, 2, u32::from((titles as u16).wrapping_mul(0x1a))).await?;
                    bins = lock(engine, block).await?;
                    capabilities(engine, procedure, names, DC_BINS, bins, mode).await?;
                    count = capabilities(
                        engine,
                        procedure,
                        names,
                        DC_BINNAMES,
                        at(bins, u32::from(titles as u16) << 1),
                        mode,
                    )
                    .await? as u16;

                    if count != 0 {
                        good = true;
                    } else {
                        unlock(engine, block).await?;
                        free(engine, block).await?;
                    }
                }
            }
        }

        if good {
            break 'asked;
        }

        // An older driver's escapes, on an information context of it
        // (`2172`).
        let ic = call(
            engine,
            "GDI",
            "CreateIC",
            &[
                Arg::D(name_of(engine, names, DRIVER)),
                Arg::D(name_of(engine, names, DEVICE)),
                Arg::D(name_of(engine, names, PORT)),
                Arg::D(mode),
            ],
        )
        .await? as u16;

        if ic == 0 {
            break 'asked;
        }

        let supports = |escape: u16| async move {
            call(
                engine,
                "GDI",
                "Escape",
                &[
                    Arg::W(ic),
                    Arg::W(QUERYESCSUPPORT),
                    Arg::W(2),
                    Arg::B(escape.to_le_bytes().to_vec()),
                    Arg::D(0),
                ],
            )
            .await
        };

        if supports(ENUMPAPERBINS).await? as u16 != 0
            && supports(GETSETPAPERBINS).await? as u16 != 0
        {
            let info = called(
                engine,
                "GDI",
                "Escape",
                &[
                    Arg::W(ic),
                    Arg::W(GETSETPAPERBINS),
                    Arg::W(0),
                    Arg::D(0),
                    buffer(8),
                ],
            )
            .await?;

            count = u16::from_le_bytes([info.buffers[0][2], info.buffers[0][3]]);

            if count != 0 {
                good = true;
                block = alloc(engine, 0x42, u32::from(count.wrapping_mul(0x1a))).await?;
                bins = lock(engine, block).await?;
                call(
                    engine,
                    "GDI",
                    "Escape",
                    &[
                        Arg::W(ic),
                        Arg::W(ENUMPAPERBINS),
                        Arg::W(2),
                        Arg::B(count.to_le_bytes().to_vec()),
                        Arg::D(bins),
                    ],
                )
                .await?;
            }
        }

        call(engine, "GDI", "DeleteDC", &[Arg::W(ic)]).await?;
    }

    enable(engine, dialog, CMB_SOURCES, good).await?;
    enable(engine, dialog, STC_SOURCE, good).await?;

    if !good {
        return Ok(false);
    }

    // Each named bin an item, its data its number (`227b`): an empty name
    // holds both places where they are.
    let mut name = at(bins, u32::from(count) << 1);
    let mut number = bins;

    for index in 0..count {
        if engine.system().read_far(name, 1)[0] == 0 {
            continue;
        }

        send_item_bytes(
            engine,
            dialog,
            CMB_SOURCES,
            CB_INSERTSTRING,
            0xffff,
            Arg::D(name),
        )
        .await?;
        name = at(name, 0x18);

        let bin = word(engine, number, 0);

        send_item(
            engine,
            dialog,
            CMB_SOURCES,
            CB_SETITEMDATA,
            index,
            i32::from(bin as i16) as u32,
        )
        .await?;
        number = at(number, 2);

        if word(engine, mode, DM_DEFAULT_SOURCE) == bin {
            send_item(engine, dialog, CMB_SOURCES, CB_SETCURSEL, index, 0).await?;
        }
    }

    if send_item(engine, dialog, CMB_SOURCES, CB_GETCURSEL, 0, 0).await? == 0xffff_ffff {
        send_item(engine, dialog, CMB_SOURCES, CB_SETCURSEL, 0, 0).await?;
    }

    unlock(engine, block).await?;
    free(engine, block).await?;
    Ok(true)
}

/// Whether the driver can turn the page, and the orientation's controls
/// enabled or not to match (seg3 `236a`): nought where they already did.
async fn orientation(
    engine: &Engine,
    names: u32,
    mode: u32,
    driver: u16,
    dialog: u16,
) -> Result<bool, Stop> {
    let mut can = true;

    if word(engine, mode, DM_SPEC_VERSION) >= 0x30a {
        let procedure = driver_entry(engine, driver, DEVICE_CAPABILITIES).await?;

        if procedure != 0 {
            can = capabilities(engine, procedure, names, DC_ORIENTATION, 0, 0).await? != 0;
        }
    }

    if enabled(engine, dialog, RAD_PORTRAIT).await? == can {
        return Ok(false);
    }

    if !can {
        check(engine, dialog, RAD_PORTRAIT, 0).await?;
        check(engine, dialog, RAD_LANDSCAPE, 0).await?;
    }

    for id in [GRP_ORIENTATION, RAD_PORTRAIT, RAD_LANDSCAPE] {
        enable(engine, dialog, id, can).await?;
    }

    show(
        engine,
        dialog,
        ICO_ORIENTATION,
        if can { SW_SHOWNA } else { SW_HIDE },
    )
    .await?;
    Ok(can)
}

/// Portrait or Landscape checked, and its icon shown (seg3 `1bea`).
async fn orient(engine: &Engine, dialog: u16, portrait: bool) -> Result<(), Stop> {
    check_radio(
        engine,
        dialog,
        RAD_PORTRAIT,
        RAD_LANDSCAPE,
        if portrait {
            RAD_PORTRAIT
        } else {
            RAD_LANDSCAPE
        },
    )
    .await?;

    let icon = {
        let globals = globals(engine);

        if portrait {
            globals.portrait
        } else {
            globals.landscape
        }
    };

    if version(engine).await? >= 0x30a {
        send_item(engine, dialog, ICO_ORIENTATION, STM_SETICON, icon, 0).await?;
    } else {
        call(
            engine,
            "USER",
            "SetDlgItemText",
            &[
                Arg::W(dialog),
                Arg::W(ICO_ORIENTATION),
                Arg::D(u32::from(icon)),
            ],
        )
        .await?;
    }

    Ok(())
}

/// The orientation and paper enabled, or disabled and emptied (seg3
/// `1c5e`).
async fn paper_and_orientation(engine: &Engine, dialog: u16, on: bool) -> Result<(), Stop> {
    if !on {
        check(engine, dialog, RAD_PORTRAIT, 0).await?;
        check(engine, dialog, RAD_LANDSCAPE, 0).await?;
        send_item(engine, dialog, CMB_SIZES, CB_RESETCONTENT, 0, 0).await?;
        send_item(engine, dialog, CMB_SOURCES, CB_RESETCONTENT, 0, 0).await?;
    }

    for id in [GRP_ORIENTATION, RAD_PORTRAIT, RAD_LANDSCAPE] {
        enable(engine, dialog, id, on).await?;
    }

    show(
        engine,
        dialog,
        ICO_ORIENTATION,
        if on { SW_SHOWNA } else { SW_HIDE },
    )
    .await?;

    for id in [GRP_PAPER, STC_SIZE, CMB_SIZES, STC_SOURCE, CMB_SOURCES] {
        enable(engine, dialog, id, on).await?;
    }

    Ok(())
}

/// Every printer listed (seg3 `07ad`): an item for each key of `[devices]`
/// on each of its ports, its data a `DEVNAMES` of its own; the default
/// written in the "currently" line. Nought, the error set, for no printer
/// and no default.
async fn list_printers(engine: &Engine, dialog: u16, id: u16) -> Result<u16, Stop> {
    let (length, keys) = profile(engine, b"devices", Arg::D(0), 0x200).await?;
    let mut offset = 0usize;

    while offset < usize::from(length) {
        let key = till_nought(&keys[offset..]).to_vec();
        let key_length = key.len() + 1;
        let (size, value) = profile(engine, b"devices", text(&key), 0x200).await?;

        offset += key_length;

        if size == 0 {
            continue;
        }

        let value = &value[..usize::from(size).min(value.len())];
        // The driver to a dot or a comma; past a dot, to the comma
        // (`07e0`).
        let stop = value
            .iter()
            .position(|&b| b == b'.' || b == b',')
            .unwrap_or(value.len());
        let driver = value[..stop].to_vec();
        let mut start = stop + 1;

        // Past a dot, the ports start at the comma itself, not after it:
        // the first is empty (`0843`, `084c`).
        if value.get(stop) == Some(&b'.') {
            start = value[start..]
                .iter()
                .position(|&b| b == b',')
                .map_or(value.len(), |at| start + at);
        }

        // Each port to the next comma (`085c`).
        while start < usize::from(size) {
            let begin = start.min(value.len());
            let end = value[begin..]
                .iter()
                .position(|&b| b == b',')
                .map_or(value.len(), |at| begin + at);
            let port = value[begin..end].to_vec();

            add_printer(engine, dialog, id, &key, &driver, &port).await?;
            start = begin + port.len() + 1;
        }
    }

    let (device_length, line) = profile(engine, b"windows", text(b"device"), 0x200).await?;

    if device_length == 0 {
        set_error(engine, PDERR_NODEFAULTPRN);
    } else {
        let line = till_nought(&line);
        let comma = line.iter().position(|&b| b == b',').unwrap_or(line.len());
        let device = &line[..comma];
        let rest = &line[(comma + 1).min(line.len())..];
        let second = rest.iter().position(|&b| b == b',').unwrap_or(rest.len());
        let port = &rest[(second + 1).min(rest.len())..];
        let current = on_port(engine, device, port).await?;
        let mut whole = b"(currently ".to_vec();

        whole.extend_from_slice(&current);
        whole.push(b')');
        super::api::set_item_text(engine, dialog, STC_CURRENT, &whole).await?;
        set_error(engine, 0);
    }

    let any = length | device_length;

    if any == 0 {
        set_error(engine, PDERR_NODEVICES);
    }

    Ok(any)
}

/// One printer on one port added to the list (seg3 `06be`), its data a
/// `DEVNAMES` of its own marked made by COMMDLG: its index.
async fn add_printer(
    engine: &Engine,
    dialog: u16,
    id: u16,
    device: &[u8],
    driver: &[u8],
    port: &[u8],
) -> Result<u16, Stop> {
    let (device_length, driver_length, port_length) =
        (device.len() + 1, driver.len() + 1, port.len() + 1);
    let handle = alloc(
        engine,
        2,
        (port_length + driver_length + device_length + 0x28) as u32,
    )
    .await?;

    if handle == 0 {
        return Ok(0xffff);
    }

    let names = lock(engine, handle).await?;

    set_word(engine, names, DEFAULT, 0x4000);
    set_word(engine, names, DEVICE, 8);
    set_word(engine, names, DRIVER, device_length as u16 + 8);
    set_word(
        engine,
        names,
        PORT,
        (driver_length + device_length + 8) as u16,
    );
    put_string(engine, at(names, 8), device);
    put_string(engine, name_of(engine, names, DRIVER), driver);
    put_string(engine, name_of(engine, names, PORT), port);
    unlock(engine, handle).await?;

    let line = on_port(engine, device, port).await?;
    let index = send_item_bytes(engine, dialog, id, CB_ADDSTRING, 0, text(&line)).await? as u16;

    send_item(engine, dialog, id, CB_SETITEMDATA, index, u32::from(handle)).await?;
    Ok(index)
}

/// The printer of a `DEVNAMES` found in the list (seg3 `248a`): its index,
/// or `FFFFh`.
async fn find_printer(engine: &Engine, names: u32, dialog: u16) -> Result<u16, Stop> {
    let count = send_item(engine, dialog, CMB_PRINTERS, CB_GETCOUNT, 0, 0).await? as u16;
    let mut found = 0xffff;
    let mut index = 0;

    while index < count {
        let handle =
            send_item(engine, dialog, CMB_PRINTERS, CB_GETITEMDATA, index, 0).await? as u16;
        let other = lock(engine, handle).await?;

        if other != 0 {
            let mut alike = true;

            for which in [DEVICE, DRIVER, PORT] {
                if !same(
                    engine,
                    Arg::D(name_of(engine, other, which)),
                    Arg::D(name_of(engine, names, which)),
                )
                .await?
                {
                    alike = false;
                    break;
                }
            }

            if alike {
                found = index;
                index = count;
            }

            unlock(engine, handle).await?;
        }

        index += 1;
    }

    Ok(found)
}

/// The printers' `DEVNAMES` let go (seg3 `2a7a`), but, with `keep`, the
/// one chosen, which replaces the structure's -- for Default Printer, the
/// default's made afresh.
async fn take_names(engine: &Engine, dialog: u16, lppd: u32, keep: bool) -> Result<(), Stop> {
    if keep {
        free(engine, word(engine, lppd, DEVNAMES)).await?;
        set_word(engine, lppd, DEVNAMES, 0);
    }

    let chosen = if checked(engine, dialog, RAD_DEFAULT).await? != 0 {
        if keep {
            let names = default_names(engine).await?;

            set_word(engine, lppd, DEVNAMES, names);
        }

        0xffff
    } else {
        send_item(engine, dialog, CMB_PRINTERS, CB_GETCURSEL, 0, 0).await? as u16
    };
    let mut count = send_item(engine, dialog, CMB_PRINTERS, CB_GETCOUNT, 0, 0).await? as u16;

    while count as i16 > 0 {
        count -= 1;

        let handle =
            send_item(engine, dialog, CMB_PRINTERS, CB_GETITEMDATA, count, 0).await? as u16;

        if keep && chosen == count {
            set_word(engine, lppd, DEVNAMES, handle);
        } else {
            free(engine, handle).await?;
        }
    }

    Ok(())
}

/// The orientation, size and source written into a `DEVMODE` (seg3
/// `2b43`).
async fn write_paper(engine: &Engine, mode: u32, dialog: u16) -> Result<(), Stop> {
    let landscape = checked(engine, dialog, RAD_LANDSCAPE).await? != 0;

    set_word(engine, mode, DM_ORIENTATION, if landscape { 2 } else { 1 });

    for (id, at) in [(CMB_SIZES, DM_PAPER_SIZE), (CMB_SOURCES, DM_DEFAULT_SOURCE)] {
        let chosen = send_item(engine, dialog, id, CB_GETCURSEL, 0, 0).await? as u16;

        if chosen != 0xffff {
            let data = send_item(engine, dialog, id, CB_GETITEMDATA, chosen, 0).await?;

            set_word(engine, mode, at, data as u16);
        }
    }

    Ok(())
}

/// What OK leaves (seg3 `2bdb`): the `DEVMODE` written, and for
/// `PD_PRINTSETUP` the context asked for.
async fn finish_setup(engine: &Engine, lppd: u32, dialog: u16) -> Result<(), Stop> {
    let devmode = word(engine, lppd, DEVMODE);

    if devmode == 0 {
        return Ok(());
    }

    let mode = lock(engine, devmode).await?;

    if mode == 0 {
        return Ok(());
    }

    write_paper(engine, mode, dialog).await?;

    let flags = flags(engine, lppd);

    if flags & PD_PRINTSETUP != 0 && flags & (PD_RETURNDC | PD_RETURNIC) != 0 {
        let handle = word(engine, lppd, DEVNAMES);
        let names = lock(engine, handle).await?;

        if names != 0 {
            make_dc(engine, mode, names, lppd).await?;
            unlock(engine, handle).await?;
        }
    }

    unlock(engine, devmode).await?;
    Ok(())
}

/// The printer taken again (seg3 `2c62`), for a new choice or Options...:
/// its driver loaded, the working `DEVMODE` asked for again, or the
/// driver's own dialog run on it, and the paper and orientation filled.
/// Whether it was.
#[allow(clippy::too_many_lines)]
async fn take(engine: &Engine, dialog: u16, number: u16, id: u16) -> Result<bool, Stop> {
    let default = checked(engine, dialog, RAD_DEFAULT).await? != 0;
    let mut result = false;
    let mut answer = 0u16;

    globals(engine).missing = false;

    let handle = if default {
        default_names(engine).await?
    } else {
        let chosen = send_item(engine, dialog, CMB_PRINTERS, CB_GETCURSEL, 0, 0).await? as u16;

        if chosen as i16 >= 0 {
            answer = chosen;
        }

        if (chosen as i16) < 0 {
            return Ok(false);
        }

        send_item(engine, dialog, CMB_PRINTERS, CB_GETITEMDATA, chosen, 0).await? as u16
    };

    if handle == 0 {
        return Ok(false);
    }

    let names = lock(engine, handle).await?;

    if names == 0 {
        let devmode = dialog_data(engine, number).devmode;

        if devmode != 0 {
            free(engine, devmode).await?;
            set_devmode(engine, number, 0);
        }
    } else {
        result = true;

        let driver = load_driver(engine, name_of(engine, names, DRIVER)).await?;

        if driver < 0x20 {
            globals(engine).missing = true;
            paper_and_orientation(engine, dialog, false).await?;
            enable(engine, dialog, PSH_OPTIONS, false).await?;
        } else {
            let lppd = dialog_data(engine, number).lppd;
            let mut devmode = dialog_data(engine, number).devmode;

            if id != PSH_OPTIONS && devmode != 0 {
                free(engine, devmode).await?;
                set_devmode(engine, number, 0);
                devmode = 0;
            }

            if devmode == 0 {
                let owner = word(engine, lppd, OWNER);

                devmode = dev_mode(engine, owner, driver, 0, names, false).await?;
                set_devmode(engine, number, devmode);
            }

            if devmode == 0xffff {
                devmode = 0;
                set_devmode(engine, number, 0);
            }

            let mut advanced = 0;
            let mut extended = 0;

            if devmode == 0 {
                paper_and_orientation(engine, dialog, false).await?;
            } else {
                let mode = lock(engine, devmode).await?;

                if mode != 0 {
                    advanced = advanced_setup(engine, driver).await?;

                    if advanced == 0 {
                        extended = driver_entry(engine, driver, EXT_DEVICE_MODE).await?;
                    }

                    if id == PSH_OPTIONS {
                        write_paper(engine, mode, dialog).await?;

                        if advanced != 0 {
                            answer = driver_call(
                                engine,
                                advanced,
                                &[
                                    GuestArg::Word(dialog),
                                    GuestArg::Word(driver),
                                    GuestArg::Long(mode),
                                    GuestArg::Long(mode),
                                ],
                            )
                            .await? as u16;
                        } else if extended != 0 {
                            answer = driver_call(
                                engine,
                                extended,
                                &[
                                    GuestArg::Word(dialog),
                                    GuestArg::Word(driver),
                                    GuestArg::Long(mode),
                                    GuestArg::Long(name_of(engine, names, DEVICE)),
                                    GuestArg::Long(name_of(engine, names, PORT)),
                                    GuestArg::Long(mode),
                                    GuestArg::Long(0),
                                    GuestArg::Word(0xe),
                                ],
                            )
                            .await? as u16;
                        }
                    }

                    if id != PSH_OPTIONS || answer == 1 {
                        let paper = sizes(engine, names, mode, driver, dialog).await?
                            | sources(engine, names, mode, driver, dialog).await?;

                        enable(engine, dialog, GRP_PAPER, paper).await?;

                        if orientation(engine, names, mode, driver, dialog).await?
                            || enabled(engine, dialog, RAD_PORTRAIT).await?
                        {
                            orient(engine, dialog, word(engine, mode, DM_ORIENTATION) != 2).await?;
                        }
                    } else {
                        result = false;
                    }

                    unlock(engine, devmode).await?;
                }
            }

            enable(engine, dialog, PSH_OPTIONS, advanced != 0 || extended != 0).await?;
            free_library(engine, driver).await?;
        }

        unlock(engine, handle).await?;
    }

    if default {
        free(engine, handle).await?;
    }

    Ok(result)
}

/// `WM_COMMAND` (seg3 `3139`).
#[allow(clippy::too_many_lines)]
async fn command(
    engine: &Engine,
    dialog: u16,
    number: u16,
    id: u16,
    lparam: u32,
) -> Result<u16, Stop> {
    let lppd = dialog_data(engine, number).lppd;

    match id {
        IDOK => {
            // A choice made in the list as it is still dropped taken first
            // (`3190`).
            if version(engine).await? >= 0x30a
                && send_item(engine, dialog, CMB_PRINTERS, CB_GETDROPPEDSTATE, 0, 0).await? != 0
            {
                take(engine, dialog, number, CMB_PRINTERS).await?;
            }

            if globals(engine).missing {
                let chosen =
                    send_item(engine, dialog, CMB_PRINTERS, CB_GETCURSEL, 0, 0).await? as u16;
                let handle = send_item(engine, dialog, CMB_PRINTERS, CB_GETITEMDATA, chosen, 0)
                    .await? as u16;
                let names = lock(engine, handle).await?;

                not_found(engine, dialog, names).await?;
                unlock(engine, handle).await?;
                return Ok(1);
            }

            end(engine, dialog, number, lppd, id, lparam).await
        }
        2 | 3 => end(engine, dialog, number, lppd, id, lparam).await,
        4 => again(engine, dialog, number, lppd).await,
        PSH_OPTIONS => {
            if take(engine, dialog, number, PSH_OPTIONS).await? {
                let ok = item(engine, dialog, IDOK).await?;

                send(engine, dialog, WM_NEXTDLGCTL, ok, 1).await?;
            }

            Ok(1)
        }
        PSH_HELP => {
            let help = super::message(&mut engine.system(), "commdlg_help");
            let owner = word(engine, lppd, OWNER);

            if help != 0 && owner != 0 {
                send(engine, owner, help, dialog, lppd).await?;
            }

            Ok(1)
        }
        RAD_PORTRAIT | RAD_LANDSCAPE => {
            orient(engine, dialog, id != RAD_LANDSCAPE).await?;
            Ok(1)
        }
        RAD_DEFAULT | RAD_SPECIFIC => {
            let was = checked(engine, dialog, id).await?;
            let list = item(engine, dialog, CMB_PRINTERS).await?;
            let mut style = call(
                engine,
                "USER",
                "GetWindowLong",
                &[Arg::W(list), Arg::W(GWL_STYLE)],
            )
            .await?;

            if id == RAD_DEFAULT {
                style &= !WS_TABSTOP;
            } else {
                style |= WS_TABSTOP;
                send(engine, dialog, WM_NEXTDLGCTL, list, 1).await?;
            }

            call(
                engine,
                "USER",
                "SetWindowLong",
                &[Arg::W(list), Arg::W(GWL_STYLE), Arg::D(style)],
            )
            .await?;

            if was == 0 {
                check_radio(engine, dialog, RAD_DEFAULT, RAD_SPECIFIC, id).await?;
                take(engine, dialog, number, id).await?;
            }

            Ok(1)
        }
        CMB_PRINTERS => {
            let notification = (lparam >> 16) as u16;
            let choose = match notification {
                CBN_CLOSEUP => true,
                CBN_SELCHANGE => {
                    !(version(engine).await? >= 0x30a
                        && send_item(engine, dialog, CMB_PRINTERS, CB_GETDROPPEDSTATE, 0, 0)
                            .await?
                            != 0)
                }
                CBN_SETFOCUS => {
                    check_radio(engine, dialog, RAD_DEFAULT, RAD_SPECIFIC, RAD_SPECIFIC).await?;
                    false
                }
                _ => false,
            };

            if choose && super::print_dlg::number(engine, dialog).await? != 0 {
                wait(engine, true);
                check_radio(engine, dialog, RAD_DEFAULT, RAD_SPECIFIC, RAD_SPECIFIC).await?;
                take(engine, dialog, number, id).await?;
                wait(engine, false);
            }

            Ok(1)
        }
        _ => Ok(0),
    }
}

/// The box for a printer whose driver will not load (`3263`): string
/// 45Bh of its device and driver.
async fn not_found(engine: &Engine, dialog: u16, names: u32) -> Result<(), Stop> {
    let format = resource(0x45b);
    let device = string(engine, name_of(engine, names, DEVICE));
    let driver = string(engine, name_of(engine, names, DRIVER));
    let mut message = Vec::new();
    let mut parts = [device, driver].into_iter();
    let mut rest = &format[..];

    while let Some(at) = rest.windows(2).position(|pair| pair == b"%s") {
        message.extend_from_slice(&rest[..at]);
        message.extend_from_slice(&parts.next().unwrap_or_default());
        rest = &rest[at + 2..];
    }

    message.extend_from_slice(rest);
    message_box(engine, dialog, &message, &resource(0x448)).await
}

/// OK, Cancel and `WM_COMMAND` 3 (seg3 `31fd`): with OK the printer chosen
/// replaces the structure's, with the working `DEVMODE`; else the working
/// one let go. The dialog ended.
async fn end(
    engine: &Engine,
    dialog: u16,
    number: u16,
    lppd: u32,
    id: u16,
    lparam: u32,
) -> Result<u16, Stop> {
    wait(engine, true);

    let mut answer = u16::from(id == IDOK);

    take_names(engine, dialog, lppd, answer != 0).await?;

    let handle = word(engine, lppd, DEVNAMES);
    let names = lock(engine, handle).await?;

    'ended: {
        if names == 0 {
            set_error(engine, CDERR_MEMLOCKFAILURE);
            answer = 0;
            break 'ended;
        }

        let mut let_go = false;

        if answer != 0 {
            let driver = load_driver(engine, name_of(engine, names, DRIVER)).await?;

            if driver > 0x20 {
                free_library(engine, driver).await?;

                let wdefault = word(engine, names, DEFAULT);

                set_word(engine, names, DEFAULT, wdefault & !0x4000);
                set_word(engine, lppd, HDC, 0);

                let devmode = word(engine, lppd, DEVMODE);

                if devmode != 0 {
                    free(engine, devmode).await?;
                }

                set_word(engine, lppd, DEVMODE, dialog_data(engine, number).devmode);
                finish_setup(engine, lppd, dialog).await?;
            } else {
                wait(engine, false);
                not_found(engine, dialog, names).await?;

                if globals(engine).missing {
                    return Ok(1);
                }

                answer = 0;
            }
        }

        if answer == 0 {
            let devmode = dialog_data(engine, number).devmode;

            if devmode != 0 {
                free(engine, devmode).await?;
            }

            let_go = word(engine, names, DEFAULT) & 0x4000 != 0
                && flags(engine, lppd) & PD_PRINTSETUP != 0;
        }

        unlock(engine, handle).await?;

        if let_go {
            free(engine, handle).await?;
            set_word(engine, lppd, DEVNAMES, 0);
        }
    }

    // (`337e`)
    take_property(engine, dialog).await?;

    if flags(engine, lppd) & PD_ENABLESETUPHOOK != 0 {
        globals(engine).hook = dword(engine, lppd, SETUP_HOOK);
    }

    let answer = if id == 3 { lparam as u16 } else { answer };

    call(
        engine,
        "USER",
        "EndDialog",
        &[Arg::W(dialog), Arg::W(answer)],
    )
    .await?;
    Ok(1)
}

/// `WM_COMMAND` 4 (seg3 `33c8`): the structure's printer and `DEVMODE`
/// taken again, as the dialog started.
async fn again(engine: &Engine, dialog: u16, number: u16, lppd: u32) -> Result<u16, Stop> {
    if find_names(engine, lppd).await? == 0 {
        return Ok(0);
    }

    let handle = word(engine, lppd, DEVNAMES);

    if handle == 0 {
        return Ok(0);
    }

    let names = lock(engine, handle).await?;

    if names == 0 {
        return Ok(0);
    }

    let default = word(engine, names, DEFAULT) & 1 != 0;

    check_radio(
        engine,
        dialog,
        RAD_DEFAULT,
        RAD_SPECIFIC,
        if default { RAD_DEFAULT } else { RAD_SPECIFIC },
    )
    .await?;

    let found = find_printer(engine, names, dialog).await?;
    let driver = load_driver(engine, name_of(engine, names, DRIVER)).await?;

    if driver <= 0x20 {
        unlock(engine, handle).await?;
        unlock(engine, word(engine, lppd, DEVMODE)).await?;
        return Ok(0);
    }

    send_item(engine, dialog, CMB_PRINTERS, CB_SETCURSEL, found, 0).await?;

    let devmode = word(engine, lppd, DEVMODE);
    let mode = if devmode != 0 {
        lock(engine, devmode).await?
    } else {
        0
    };

    if mode == 0 {
        paper_and_orientation(engine, dialog, false).await?;
        return Ok(1);
    }

    paper_and_orientation(engine, dialog, true).await?;

    let paper = sizes(engine, names, mode, driver, dialog).await?
        | sources(engine, names, mode, driver, dialog).await?;

    enable(engine, dialog, GRP_PAPER, paper).await?;

    if orientation(engine, names, mode, driver, dialog).await? {
        orient(engine, dialog, word(engine, mode, DM_ORIENTATION) != 2).await?;
    }

    unlock(engine, devmode).await?;

    let working = dialog_data(engine, number).devmode;

    if working != 0 {
        free(engine, working).await?;
    }

    let devmode = dev_mode(engine, dialog, driver, devmode, names, true).await?;

    set_devmode(engine, number, devmode);
    free_library(engine, driver).await?;
    unlock(engine, handle).await?;
    Ok(1)
}
