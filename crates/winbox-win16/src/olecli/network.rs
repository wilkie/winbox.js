//! `OLECLI`'s network helpers, exports 950-954: a link's document on a
//! drive connected to a share -- its network name, kept in its stream --
//! told, checked, and connected again through a dialog, "Connect Network
//! Drive". As `src/win16/olecli/network.ts`, where what each does is told:
//! **read out** of `OLECLI.DLL` seg8 in prose, **measured** by `olenet`.

use crate::commdlg::api::{Arg, text};
use crate::dialog_template::{DialogTemplate, parse_dialog_template};
use crate::dialogs::DialogProc;

use super::core::{OLE_OK, Ole, R, SCRATCH};
use super::linked::{le_of, with_le};

/// `OLE_ERROR_BLANK`, `OLE_ERROR_DRIVE`, `OLE_ERROR_NETWORK` (ole.h).
const OLE_ERROR_BLANK: u16 = 7;
const OLE_ERROR_DRIVE: u16 = 27;
const OLE_ERROR_NETWORK: u16 = 28;
const DRIVE_REMOTE: u16 = 4;
const OT_EMBEDDED: u32 = 2;

/// Where `OLECLI` keeps a share's name and a connection's while it asks
/// (its data segment, beside `handlers.rs`' path).
const NAME_AT: u16 = SCRATCH + 0x700;
const CONNECTION_AT: u16 = SCRATCH + 0x800;
const SIZE_AT: u16 = SCRATCH + 0x900;
const DRIVE_AT: u16 = SCRATCH + 0x904;
const NAME_SIZE: u16 = 0x100;

/// The share a drive is connected to; none where it is none.
async fn connection(ole: &Ole<'_>, letter: u8) -> R<Option<Vec<u8>>> {
    ole.w16(ole.near(SIZE_AT), NAME_SIZE);

    let error = ole
        .user(
            "WNetGetConnection",
            &[
                text(&[letter, b':']),
                Arg::D(ole.near(CONNECTION_AT)),
                Arg::D(ole.near(SIZE_AT)),
            ],
        )
        .await? as u16;

    Ok((error == 0).then(|| ole.string(ole.near(CONNECTION_AT))))
}

/// A drive's type by its number, A: nought.
async fn drive_type(ole: &Ole<'_>, drive: u16) -> R<u16> {
    Ok(ole.kernel("GetDriveType", &[Arg::W(drive)]).await? as u16)
}

/// `SETNETNAME` (951), given an object (**read out**, seg8 `0000`;
/// **measured** by `olenet`'s `named` records).
pub(crate) async fn set_net_name(ole: &Ole<'_>, object: u32) -> R<u16> {
    let Some(le) = le_of(ole, object) else {
        return Ok(OLE_OK);
    };

    if le.kind == OT_EMBEDDED {
        return Ok(OLE_OK);
    }

    if le.topic.is_empty() {
        return Ok(OLE_ERROR_BLANK);
    }

    if le.topic.get(1) != Some(&b':') {
        with_le(ole, object, |le| le.network.clear());
        return Ok(OLE_OK);
    }

    let letter = le.topic[0].to_ascii_uppercase();
    let kind = drive_type(ole, u16::from(letter.wrapping_sub(b'A'))).await?;

    if kind == 0 {
        return Ok(OLE_ERROR_DRIVE);
    }

    if kind != DRIVE_REMOTE {
        with_le(ole, object, |le| le.network.clear());
        return Ok(OLE_OK);
    }

    let Some(share) = connection(ole, letter).await? else {
        return Ok(OLE_ERROR_DRIVE);
    };

    with_le(ole, object, |le| {
        le.drive = letter;
        le.network = share;
    });
    Ok(OLE_OK)
}

/// A link's document moved to the drive connected: its first letter the
/// drive's (**read out**, seg8 `031a`).
fn move_topic(ole: &Ole<'_>, object: u32) -> bool {
    with_le(ole, object, |le| {
        if le.topic.is_empty() {
            false
        } else {
            le.topic[0] = le.drive;
            true
        }
    })
    .unwrap_or(false)
}

/// The next drive after the one numbered at `at` that is remote and
/// connected to the share (**read out**, seg8 `025c`).
async fn next_drive(ole: &Ole<'_>, object: u32, at: u32, share: &[u8]) -> R<u16> {
    while (ole.r16(at) as i16) < 26 {
        let drive = ole.r16(at) + 1;

        ole.w16(at, drive);

        if drive_type(ole, drive).await? != DRIVE_REMOTE {
            continue;
        }

        let letter = b'A' + drive as u8;
        let connected = connection(ole, letter).await?;

        if connected.is_some_and(|connected| connected.eq_ignore_ascii_case(share)) {
            with_le(ole, object, |le| le.drive = letter);
            return Ok(u16::from(move_topic(ole, object)));
        }
    }

    Ok(0)
}

/// `SETNEXTNETDRIVE` (953), given an object, a far pointer to a drive's
/// number and a buffer for a share's name (**read out**, seg8 `025c`;
/// **measured** by `olenet`'s `next` records).
pub(crate) async fn set_next_net_drive(ole: &Ole<'_>, object: u32, at: u32, name: u32) -> R<u16> {
    let Some(le) = le_of(ole, object) else {
        return Ok(0);
    };

    if ole.r8(name) == 0 {
        if le.network.is_empty() {
            return Ok(0);
        }

        let mut bytes = le.network.clone();

        bytes.truncate(usize::from(NAME_SIZE) - 1);
        bytes.push(0);
        ole.write(name, &bytes);
    }

    next_drive(ole, object, at, &ole.string(name)).await
}

/// `CHECKNETDRIVE` (952), given an object and whether to ask (**read
/// out**, seg8 `011a`-`0259`; **measured** by `olenet`'s `check` records).
pub(crate) async fn check_net_drive(ole: &Ole<'_>, object: u32, ask: u16) -> R<u16> {
    let Some(le) = le_of(ole, object) else {
        return Ok(OLE_OK);
    };

    if le.kind == OT_EMBEDDED || le.network.is_empty() {
        return Ok(OLE_OK);
    }

    let mut drive = le.drive;

    if drive == 0 && !le.topic.is_empty() {
        drive = le.topic[0];
        with_le(ole, object, |le| le.drive = drive);
    }

    if connection(ole, drive)
        .await?
        .is_some_and(|connected| connected.eq_ignore_ascii_case(&le.network))
    {
        return Ok(OLE_OK);
    }

    let number = ole.near(DRIVE_AT);

    ole.w16(number, 2);

    if next_drive(ole, object, number, &le.network).await? != 0 {
        return Ok(OLE_OK);
    }

    if ask != 1 {
        return Ok(OLE_ERROR_NETWORK);
    }

    let name = ole.near(NAME_AT);
    let mut bytes = le.network.clone();

    bytes.truncate(usize::from(NAME_SIZE) - 1);
    bytes.push(0);
    ole.write(name, &bytes);

    let answer = connect(ole, object, name).await?;

    if answer != 0 {
        return Ok(answer);
    }

    Ok(if move_topic(ole, object) {
        OLE_OK
    } else {
        OLE_ERROR_BLANK
    })
}

/// `GETTASKVISIBLEWINDOW` (954), `EnumTaskWindows`' procedure (**read
/// out**, seg8 `0696`; **measured** by `olenet`'s `window` records).
pub(crate) async fn get_task_visible_window(ole: &Ole<'_>, hwnd: u16, out: u32) -> R<u16> {
    if ole.user("IsWindowVisible", &[Arg::W(hwnd)]).await? as u16 == 0 {
        return Ok(1);
    }

    ole.w16(out, hwnd);
    Ok(0)
}

// The dialog.

const WS_POPUP: u32 = 0x8000_0000;
const WS_CHILD: u32 = 0x4000_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_CAPTION: u32 = 0x00c0_0000;
const WS_BORDER: u32 = 0x0080_0000;
const WS_SYSMENU: u32 = 0x0008_0000;
const WS_GROUP: u32 = 0x0002_0000;
const WS_TABSTOP: u32 = 0x0001_0000;
const DS_MODALFRAME: u32 = 0x80;
const SS_RIGHT: u32 = 0x0002;
const ES_PASSWORD: u32 = 0x0020;
const ES_AUTOHSCROLL: u32 = 0x0080;
const ES_OEMCONVERT: u32 = 0x0400;
const CBS_DROPDOWNLIST: u32 = 0x0003;
const CBS_SORT: u32 = 0x0200;
const BS_DEFPUSHBUTTON: u32 = 1;
const CLASS_BUTTON: u8 = 0x80;
const CLASS_EDIT: u8 = 0x81;
const CLASS_STATIC: u8 = 0x82;
const CLASS_COMBOBOX: u8 = 0x85;

const IDOK: u16 = 1;
const IDCANCEL: u16 = 2;
/// The dialog's controls: the drives' list, the password, the share (seg8
/// `04e7`, `04fa`, `0498`).
const ID_DRIVE: u16 = 500;
const ID_PASSWORD: u16 = 501;
const ID_PATH: u16 = 502;

/// The dialog's procedure and the window procedure finding its owner, as
/// `OLECLI`'s ordinals.
const CONNECT_DLG_PROC: u16 = 950;
const GET_TASK_VISIBLE_WINDOW: u16 = 954;

/// `OLECLI`'s strings for a connection that fails (its string table, 600
/// and 601).
const NETWORK_ERROR: &[u8] = b"Network Error";
const CANNOT_CONNECT: &[u8] = b"Unable to connect to network drive.";
const MB_RETRYCANCEL: u16 = 0x0005;
const MB_SYSTEMMODAL: u16 = 0x1000;
/// The error after which the drives are listed again (seg8 `05c9`).
const LIST_AGAIN: u16 = 0x34;
const PASSWORD_SIZE: u16 = 0x20;

struct Control {
    place: (u16, u16, u16, u16),
    id: u16,
    style: u32,
    class: u8,
    text: &'static str,
}

/// The dialog, `CONNECTDLG`, laid out from what `olenet` measured of it
/// (`network.ts`). No byte of `OLECLI.DLL`'s resource is copied.
const STYLE: u32 = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME;
const BOX: (u16, u16, u16, u16) = (78, 55, 155, 76);
const CAPTION: &str = "Connect Network Drive";
const TEXT: u32 = WS_CHILD | WS_VISIBLE | WS_GROUP | SS_RIGHT;
const FIELD: u32 = WS_CHILD | WS_VISIBLE | WS_GROUP | WS_TABSTOP | WS_BORDER;

const CONTROLS: [Control; 8] = [
    Control {
        place: (9, 7, 40, 9),
        id: 0xffff,
        style: TEXT,
        class: CLASS_STATIC,
        text: "D&rive:",
    },
    Control {
        place: (53, 3, 20, 40),
        id: ID_DRIVE,
        style: WS_CHILD | WS_VISIBLE | WS_GROUP | WS_TABSTOP | CBS_DROPDOWNLIST | CBS_SORT,
        class: CLASS_COMBOBOX,
        text: "",
    },
    Control {
        place: (3, 21, 46, 8),
        id: 0xffff,
        style: TEXT,
        class: CLASS_STATIC,
        text: "&Network Path:",
    },
    Control {
        place: (53, 20, 96, 12),
        id: ID_PATH,
        style: FIELD | ES_AUTOHSCROLL | ES_OEMCONVERT,
        class: CLASS_EDIT,
        text: "",
    },
    Control {
        place: (13, 37, 36, 10),
        id: 0xffff,
        style: TEXT,
        class: CLASS_STATIC,
        text: "Pass&word:",
    },
    Control {
        place: (53, 35, 60, 12),
        id: ID_PASSWORD,
        style: FIELD | ES_PASSWORD | ES_AUTOHSCROLL | ES_OEMCONVERT,
        class: CLASS_EDIT,
        text: "",
    },
    Control {
        place: (23, 54, 42, 14),
        id: IDOK,
        style: WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON,
        class: CLASS_BUTTON,
        text: "&Connect",
    },
    Control {
        place: (91, 55, 43, 14),
        id: IDCANCEL,
        style: WS_CHILD | WS_VISIBLE | WS_GROUP | WS_TABSTOP,
        class: CLASS_BUTTON,
        text: "C&ancel",
    },
];

/// The dialog's `DLGTEMPLATE`, made from its controls.
pub fn build_template() -> Vec<u8> {
    let mut bytes = Vec::new();
    let string = |bytes: &mut Vec<u8>, value: &str| {
        bytes.extend(value.bytes());
        bytes.push(0);
    };

    bytes.extend(STYLE.to_le_bytes());
    bytes.push(CONTROLS.len() as u8);

    for value in [BOX.0, BOX.1, BOX.2, BOX.3] {
        bytes.extend(value.to_le_bytes());
    }

    string(&mut bytes, ""); // menu
    string(&mut bytes, ""); // class
    string(&mut bytes, CAPTION);

    for control in &CONTROLS {
        for value in [
            control.place.0,
            control.place.1,
            control.place.2,
            control.place.3,
            control.id,
        ] {
            bytes.extend(value.to_le_bytes());
        }

        bytes.extend(control.style.to_le_bytes());
        bytes.push(control.class);
        string(&mut bytes, control.text);
        bytes.push(0); // no extra data
    }

    bytes
}

fn template() -> DialogTemplate {
    let bytes = build_template();

    parse_dialog_template(|at| bytes.get(at as usize).copied().unwrap_or(0))
}

/// The dialog shown, its owner the task's first visible window, given the
/// share's name: the letter of the drive connected becomes the link's,
/// nought where none was, `OLE_ERROR_NETWORK` (**read out**, seg8 `03a4`).
async fn connect(ole: &Ole<'_>, object: u32, name: u32) -> R<u16> {
    let owner = ole.near(DRIVE_AT);
    let task = ole.kernel("GetCurrentTask", &[]).await? as u16;

    ole.w16(owner, 0);
    ole.user(
        "EnumTaskWindows",
        &[
            Arg::W(task),
            Arg::D(super::export_address(ole.e, GET_TASK_VISIBLE_WINDOW)),
            Arg::D(owner),
        ],
    )
    .await?;

    let instance = super::instance(&ole.e.system());
    let proc = super::export_address(ole.e, CONNECT_DLG_PROC);
    let (owner, disabled, active) = ole.e.begin_modal(ole.r16(owner)).await?;
    let hwnd = ole
        .e
        .create_dialog(
            instance,
            &template(),
            owner,
            DialogProc::Guest(proc),
            name,
            true,
        )
        .await?;
    let letter = ole.e.run_modal(hwnd, owner, disabled, active).await? as u8;

    with_le(ole, object, |le| le.drive = letter);
    Ok(if letter == 0 {
        OLE_ERROR_NETWORK
    } else {
        OLE_OK
    })
}

/// The drives not there, D: to Z:, listed, the first chosen (**read out**,
/// seg8 `0624`).
async fn list_drives(ole: &Ole<'_>, dialog: u16) -> R<()> {
    const CB_ADDSTRING: u16 = 0x403;
    const CB_RESETCONTENT: u16 = 0x40b;
    const CB_SETCURSEL: u16 = 0x40e;
    let list = ole
        .user("GetDlgItem", &[Arg::W(dialog), Arg::W(ID_DRIVE)])
        .await? as u16;

    ole.user(
        "SendMessage",
        &[Arg::W(list), Arg::W(CB_RESETCONTENT), Arg::W(0), Arg::D(0)],
    )
    .await?;

    for drive in 3..26u16 {
        if drive_type(ole, drive).await? == 0 {
            ole.user(
                "SendMessage",
                &[
                    Arg::W(list),
                    Arg::W(CB_ADDSTRING),
                    Arg::W(0),
                    text(&[b'A' + drive as u8, b':']),
                ],
            )
            .await?;
        }
    }

    ole.user(
        "SendMessage",
        &[Arg::W(list), Arg::W(CB_SETCURSEL), Arg::W(0), Arg::D(0)],
    )
    .await?;
    Ok(())
}

/// `CONNECTDLGPROC` (950): the dialog's procedure (**read out**, seg8
/// `0456`-`0620`; shown and cancelled, **measured** by `olenet`; what
/// Connect does `unrecorded`). `network.ts` tells each message.
#[allow(clippy::too_many_lines)]
pub(crate) async fn connect_dlg_proc(
    ole: &Ole<'_>,
    dialog: u16,
    message: u16,
    w_param: u16,
    l_param: u32,
) -> R<u32> {
    const WM_INITDIALOG: u16 = 0x110;
    const WM_COMMAND: u16 = 0x111;
    const WM_SETTEXT: u16 = 0x0c;
    const EN_KILLFOCUS: u32 = 0x200;

    if message == WM_INITDIALOG {
        ole.state().connecting = l_param;
        list_drives(ole, dialog).await?;
        ole.user(
            "SetDlgItemText",
            &[Arg::W(dialog), Arg::W(ID_PATH), Arg::D(l_param)],
        )
        .await?;
        return Ok(0);
    }

    if message != WM_COMMAND {
        return Ok(0);
    }

    if w_param == IDCANCEL {
        ole.user("EndDialog", &[Arg::W(dialog), Arg::W(0)]).await?;
        return Ok(1);
    }

    if w_param == ID_PATH && l_param >> 16 == EN_KILLFOCUS {
        let connecting = ole.state().connecting;

        ole.user(
            "SendDlgItemMessage",
            &[
                Arg::W(dialog),
                Arg::W(ID_PATH),
                Arg::W(WM_SETTEXT),
                Arg::W(0),
                Arg::D(connecting),
            ],
        )
        .await?;
        return Ok(0);
    }

    if w_param != IDOK {
        return Ok(0);
    }

    let drive = ole.near(CONNECTION_AT);
    let password = ole.near(CONNECTION_AT + 0x10);
    let connecting = ole.state().connecting;

    ole.user(
        "GetDlgItemText",
        &[Arg::W(dialog), Arg::W(ID_DRIVE), Arg::D(drive), Arg::W(3)],
    )
    .await?;
    ole.user(
        "GetDlgItemText",
        &[
            Arg::W(dialog),
            Arg::W(ID_PASSWORD),
            Arg::D(password),
            Arg::W(PASSWORD_SIZE),
        ],
    )
    .await?;

    let error = ole
        .user(
            "WNetAddConnection",
            &[Arg::D(connecting), Arg::D(password), Arg::D(drive)],
        )
        .await? as u16;

    if error == 0 {
        ole.user(
            "EndDialog",
            &[Arg::W(dialog), Arg::W(u16::from(ole.r8(drive)))],
        )
        .await?;
        return Ok(1);
    }

    let said = ole.near(CONNECTION_AT + 0x40);

    ole.w16(ole.near(SIZE_AT), 0x80);

    if ole
        .user(
            "WNetGetErrorText",
            &[Arg::W(error), Arg::D(said), Arg::D(ole.near(SIZE_AT))],
        )
        .await? as u16
        != 0
    {
        let mut bytes = CANNOT_CONNECT.to_vec();

        bytes.push(0);
        ole.write(said, &bytes);
    }

    let answer = ole
        .user(
            "MessageBox",
            &[
                Arg::W(dialog),
                Arg::D(said),
                text(NETWORK_ERROR),
                Arg::W(MB_SYSTEMMODAL | MB_RETRYCANCEL),
            ],
        )
        .await? as u16;

    if answer == IDCANCEL {
        ole.user("EndDialog", &[Arg::W(dialog), Arg::W(0)]).await?;
        return Ok(1);
    }

    if error == LIST_AGAIN {
        list_drives(ole, dialog).await?;
    }

    ole.user(
        "SetDlgItemText",
        &[Arg::W(dialog), Arg::W(ID_PASSWORD), text(&[])],
    )
    .await?;
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_template_is_the_connect_box() {
        let template = template();

        assert_eq!(template.caption, "Connect Network Drive");
        assert_eq!(template.items.len(), 8);
    }
}
