//! SHELL's About box. **Read out of `SHELL.DLL`** (seg9 `0000`, `0136`) and
//! **recorded** by `about`:
//!
//! * The caption is `About` and the program's name; or, when the name has a
//!   `#`, what is before it, and the `#` is made the end of the caller's
//!   string. The first line is `Microsoft Windows` and the name, or what is
//!   after the `#`.
//! * The other text is shown as it is, and nothing for none. The icon is
//!   shown where the template puts it; with none, its control is hidden and
//!   SHELL's Windows logo is drawn there, 64 pixels square at (10,10).
//! * The version is USER's string 204h, `3.1`, as `Version 3.1 `: a space
//!   where a debugging Windows says `(Debug)`. The licensee's lines and the
//!   serial number's are USER's strings 202h, 203h and 205h.
//! * The mode is standard mode; the memory free is `GetFreeSpace(1000h)` in
//!   kilobytes, truncated, its thousands separated by `WIN.INI`'s `[intl]`
//!   `sThousand`, its first character only; and the resources free are
//!   `GetFreeSystemResources(0)`. `SMARTDrive`'s line is hidden.
//! * Any command ends it, answering 1.
//!
//! The strings and the dialog are winbox.js's own (`STRINGS`,
//! `ABOUT_DIALOG`). The logo is read from the installation's `SHELL.DLL`,
//! as the display's artwork is, and is not drawn without it.
//!
//! Not followed: the credits hidden behind a double click.

use std::rc::Rc;

use winbox_raster::{decode_dib, dib_to_device, palette_for_display};

use crate::call::{Answer, Args, Later, Stop};
use crate::dialog_template::{DialogTemplate, Named, parse_dialog_template};
use crate::dialogs::DialogProc;
use crate::engine::Engine;
use crate::gdi::GdiObject;
use crate::messages::Param;
use crate::shell::programs::resources_of;
use crate::shell::{Text, text_argument};
use crate::system::System;
use crate::user_misc::user_string;

const ID_LINE: u16 = 101;
const ID_MODE: u16 = 102;
const ID_MEMORY: u16 = 104;
const ID_RESOURCES: u16 = 105;
const ID_SMARTDRIVE: u16 = 106;
const ID_NAME: u16 = 108;
const ID_COMPANY: u16 = 109;
const ID_SERIAL: u16 = 110;
const ID_ICON: u16 = 111;
const ID_VERSION: u16 = 112;
const ID_RESOURCES_LABEL: u16 = 113;
const ID_OTHER: u16 = 115;

const WM_SETTEXT: u16 = 0x000c;
const WM_PAINT: u16 = 0x000f;
const WM_INITDIALOG: u16 = 0x0110;
const WM_COMMAND: u16 = 0x0111;
const STM_SETICON: u16 = 0x0400;
const STM_GETICON: u16 = 0x0401;
const WF_PMODE: u32 = 0x0001;
const WF_STANDARD: u32 = 0x0010;
const WF_WLO: u32 = 0x8000;
const SRCCOPY: u32 = 0x00cc_0020;
const RT_BITMAP: i32 = 2;
const LOGO: u16 = 130;

const SW_HIDE: u16 = 0;

/// SHELL's strings, by their resource numbers: the About box's lines, the
/// registration database's name, and the messages of finding a program.
/// winbox.js keeps them itself, as it keeps SHELL: no Windows file is
/// shipped. Made to match the Windows 3.1 the recordings are made on by
/// `scripts/oracle/strings-table.mjs`.
const STRINGS: &[(u16, &str)] = &[
    (0x0d0, "REG.DAT"),
    (0x0d1, "Real Mode"),
    (0x0d2, "Real Mode (Large Frame EMS)"),
    (0x0d3, "Real Mode (Small Frame EMS)"),
    (0x0d4, "Standard Mode"),
    (0x0d5, "386 Enhanced Mode"),
    (0x0d7, "System Resources:"),
    (0x0d8, "Version %s %s"),
    (0x0d9, "(Debug)"),
    (0x0da, "%s KB Free"),
    (0x0db, "%s KB Free (%s KB in EMS)"),
    (0x0dc, "%d%% Free"),
    (0x0df, "Cannot find file '%s'."),
    (0x0e0, "(found)"),
    (0x0e1, "(not found)"),
    (0x0e2, "Cannot load COMMDLG.DLL"),
    (
        0x0e3,
        "\r\nSHELL.DLL: RegCloseKey called with no corresponding RegOpenKey",
    ),
];

/// SHELL's dialog 100: the About box `ShellAbout` shows. winbox.js keeps it
/// itself, as it keeps SHELL: no Windows file is shipped. Made to match the
/// Windows 3.1 the recordings are made on by
/// `scripts/oracle/dialog-template.mjs`.
const ABOUT_DIALOG: &str = concat!(
    "c000c8801314001400dc009e00000041626f75742025730008004d532053616e",
    "73205365726966000a000300120010006f000300005082ff0000002d0005007f",
    "000a00650080000050824d6963726f736f66742057696e646f77732025730000",
    "2d000f0064000a007000800000508200002d00190091000a00ffff8000005082",
    "436f7079726967687420a920313938352d31393932204d6963726f736f667420",
    "436f72702e00002d002300910014007300800000508200002d00370091000a00",
    "0f278000005082546869732070726f64756374206973206c6963656e73656420",
    "746f3a00002d00410091000a006c00800000508255736572204e616d6520676f",
    "6573206865726500002d004b0091000a006d0080000050824f7267616e697a61",
    "74696f6e204e616d6520676f6573206865726500002d005500ac0001000e2704",
    "0000508200002d005d00a50014006e00800000508200002d007300ac0001000d",
    "27040000508200002d00780096000a00660080000050825265616c204d6f6465",
    "00002d00820046000a00670080000050824d656d6f72793a0000780082004a00",
    "0a006800800000508200002d008c0046000a0071008000005082457870616e64",
    "6564204d656d6f7279000078008c0041000a006900800000508200002d009600",
    "46000a006a008000005082534d4152544472697665205573696e670000780096",
    "0041000a006b0080000050820000b100050028000e00010001000150804f4b00",
    "00000000000000000000000000000000",
);

/// One of SHELL's strings by its resource number.
pub fn shell_string(id: u16) -> Option<&'static str> {
    STRINGS
        .iter()
        .find(|&&(number, _)| number == id)
        .map(|&(_, text)| text)
}

/// The About box's template, read as the TypeScript engine reads it.
fn template() -> DialogTemplate {
    let bytes: Vec<u8> = (0..ABOUT_DIALOG.len() / 2)
        .map(|at| u8::from_str_radix(&ABOUT_DIALOG[at * 2..at * 2 + 2], 16).unwrap_or(0))
        .collect();

    parse_dialog_template(|at| bytes.get(at as usize).copied().unwrap_or(0))
}

/// A string as bytes, a character to a byte, as the TypeScript engine's
/// strings are.
fn latin1(text: &str) -> Vec<u8> {
    text.chars().map(|c| c as u8).collect()
}

/// A string with its first `pattern` replaced, as JavaScript's `replace`
/// replaces it.
fn replaced(format: &[u8], pattern: &[u8], value: &[u8]) -> Vec<u8> {
    match format
        .windows(pattern.len())
        .position(|window| window == pattern)
    {
        Some(at) => [&format[..at], value, &format[at + pattern.len()..]].concat(),
        None => format.to_vec(),
    }
}

/// A string with one `%s` filled, as `wsprintf` fills it.
fn filled(format: &[u8], value: &[u8]) -> Vec<u8> {
    replaced(format, b"%s", value)
}

/// One of SHELL's strings as bytes, nothing for none.
fn shell_bytes(id: u16) -> Vec<u8> {
    latin1(shell_string(id).unwrap_or(""))
}

/// One of USER's strings as bytes, nothing for none.
fn user_bytes(id: u16) -> Vec<u8> {
    latin1(user_string(id).unwrap_or(""))
}

/// A number of kilobytes as the box shows it, its thousands separated
/// (seg9 `0050`). A separator that is nothing is a NUL, and ends the
/// string there.
fn thousands(n: u32, separator: u8) -> Vec<u8> {
    let digits = n.to_string().into_bytes();
    let mut out = Vec::new();

    for (i, &digit) in digits.iter().enumerate() {
        if i != 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(separator);
        }

        out.push(digit);
    }

    match out.iter().position(|&byte| byte == 0) {
        Some(end) => out[..end].to_vec(),
        None => out,
    }
}

/// What the box's procedure keeps: the program's name's pointer, the other
/// text as it was read, and the icon.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AboutProc {
    app: u32,
    other: Rc<[u8]>,
    icon: u16,
}

impl AboutProc {
    /// What the procedure answers a message.
    pub(crate) async fn answer(
        &self,
        engine: &Engine,
        hwnd: u16,
        message: u16,
    ) -> Result<u32, Stop> {
        match message {
            WM_INITDIALOG => {
                self.initialise(engine, hwnd).await?;
                Ok(1)
            }
            WM_PAINT => {
                self.paint(engine, hwnd).await?;
                Ok(1)
            }
            WM_COMMAND => {
                engine.end_dialog(hwnd, 1).await?;
                Ok(1)
            }
            _ => Ok(0),
        }
    }

    async fn initialise(&self, engine: &Engine, hwnd: u16) -> Result<(), Stop> {
        let template = template();
        let item = |id: u16| match template.items.iter().find(|each| each.id == id) {
            Some(each) => match &each.text {
                Named::Text(text) => latin1(text),
                Named::Number(number) => number.to_string().into_bytes(),
            },
            None => Vec::new(),
        };
        let app = engine.system().read_string(self.app);
        let line = if let Some(hash) = app.iter().position(|&byte| byte == b'#') {
            let at = (self.app & 0xffff_0000) | (self.app.wrapping_add(hash as u32) & 0xffff);

            engine.system().write_far(at, &[0]);
            set_text(engine, hwnd, &app[..hash]).await?;
            app[hash + 1..].to_vec()
        } else {
            set_text(engine, hwnd, &filled(&latin1(&template.caption), &app)).await?;
            app
        };

        set_item_text(engine, hwnd, ID_LINE, &filled(&item(ID_LINE), &line)).await?;
        set_item_text(engine, hwnd, ID_OTHER, &self.other).await?;
        send_item(
            engine,
            hwnd,
            ID_ICON,
            STM_SETICON,
            self.icon,
            &mut Param::Value(0),
        )
        .await?;

        if self.icon == 0 {
            hide_item(engine, hwnd, ID_ICON).await?;
        }

        set_item_text(engine, hwnd, ID_SERIAL, &user_bytes(0x205)).await?;

        let version = replaced(&shell_bytes(0xd8), b"%s", &user_bytes(0x204));

        set_item_text(engine, hwnd, ID_VERSION, &replaced(&version, b"%s", b"")).await?;

        let (flags, free, separator) = {
            let mut system = engine.system();
            let flags = crate::kernel::get_win_flags(&mut system, &mut Args::repeat(0))?
                .value()
                .unwrap_or(0);
            let space = crate::pointers::get_free_space(&mut system, &mut Args::repeat(0x1000))?
                .value()
                .unwrap_or(0);
            let profile = system.read_profile(b"WIN.INI");
            let separator = profile
                .get(b"intl", b"sThousand", true)
                .unwrap_or_else(|| b",".to_vec())
                .first()
                .copied()
                .unwrap_or(0);

            (flags, space / 1024, separator)
        };
        let mode = if flags & WF_PMODE == 0 {
            0xd1
        } else if flags & WF_STANDARD != 0 {
            0xd4
        } else {
            0xd5
        };

        set_item_text(engine, hwnd, ID_MODE, &shell_bytes(mode)).await?;
        set_item_text(
            engine,
            hwnd,
            ID_MEMORY,
            &filled(&shell_bytes(0xda), &thousands(free, separator)),
        )
        .await?;
        hide_item(engine, hwnd, ID_SMARTDRIVE).await?;

        if flags & WF_PMODE != 0 && flags & WF_WLO == 0 {
            let resources = {
                let mut system = engine.system();

                crate::user_misc::get_free_system_resources(&mut system, &mut Args::repeat(0))?
                    .value()
                    .unwrap_or(0)
            };
            let percent = replaced(&shell_bytes(0xdc), b"%d", resources.to_string().as_bytes());

            set_item_text(engine, hwnd, ID_RESOURCES_LABEL, &shell_bytes(0xd7)).await?;
            set_item_text(engine, hwnd, ID_RESOURCES, &replaced(&percent, b"%%", b"%")).await?;
        } else {
            hide_item(engine, hwnd, ID_RESOURCES_LABEL).await?;
        }

        set_item_text(engine, hwnd, ID_NAME, &user_bytes(0x202)).await?;
        set_item_text(engine, hwnd, ID_COMPANY, &user_bytes(0x203)).await
    }

    /// The box painted: the Windows logo where there is no icon.
    async fn paint(&self, engine: &Engine, hwnd: u16) -> Result<(), Stop> {
        let Some(index) = engine.system().window_named(hwnd) else {
            return Ok(());
        };
        let (hdc, _) = engine.begin_paint(hwnd, index).await?;
        let icon = send_item(engine, hwnd, ID_ICON, STM_GETICON, 0, &mut Param::Value(0)).await?;
        let mut system = engine.system();

        if icon == 0 {
            let memory = crate::gdi::dc::create_compatible_dc(&mut system, hdc);
            let bitmap = if memory == 0 { None } else { logo(&mut system) };

            if let Some(bitmap) = bitmap {
                let hbm = system.gdi_allocate(GdiObject::Bitmap(Box::new(bitmap)));
                let old = crate::gdi::dc::select_object(&mut system, memory, hbm);

                crate::gdi::draw::bit_blt(
                    &mut system,
                    hdc,
                    [10, 10, 64, 64],
                    memory,
                    0,
                    0,
                    SRCCOPY,
                );
                crate::gdi::dc::select_object(&mut system, memory, old);
                crate::gdi::objects::delete_object(&mut system, hbm);
            }

            if memory != 0 {
                crate::gdi::dc::delete_dc(&mut system, memory);
            }
        }

        system.end_paint(hwnd, index, hdc);
        Ok(())
    }
}

/// SHELL's Windows logo, from the installation's file; none without it.
fn logo(system: &mut System) -> Option<crate::gdi::ddb::Bitmap> {
    let handle = system.files.open("C:\\WINDOWS\\SYSTEM\\SHELL.DLL")?;
    let bytes = {
        let file = system.files.resolve(handle).expect("an open file");
        let size = file.size() as usize;

        file.seek(std::io::SeekFrom::Start(0));
        file.read(size)
    };

    system.files.close(handle);

    let resources = resources_of(&bytes)?;
    let resource = resources
        .iter()
        .find(|each| each.kind == RT_BITMAP && each.id == Some(LOGO))?;
    let dib = decode_dib(resource.data).ok()?;
    let display = system.display_kind();
    let pixels = dib_to_device(
        &dib,
        display.depth(),
        Some(palette_for_display(display, None)),
        None,
        None,
    );

    Some(crate::gdi::ddb::Bitmap {
        pixels,
        padding: None,
        dimension: None,
    })
}

/// A window's text set with text of USER's own.
async fn set_text(engine: &Engine, hwnd: u16, text: &[u8]) -> Result<(), Stop> {
    let mut bytes = text.to_vec();

    bytes.push(0);
    engine
        .send_message(hwnd, WM_SETTEXT, 0, &mut Param::Struct(bytes))
        .await?;
    Ok(())
}

/// A message to one of the box's controls: nought for no such control.
async fn send_item(
    engine: &Engine,
    dialog: u16,
    id: u16,
    message: u16,
    wparam: u16,
    lparam: &mut Param,
) -> Result<u32, Stop> {
    let hwnd = engine.system().dlg_item(dialog, id);

    if hwnd == 0 {
        return Ok(0);
    }

    engine.send_message(hwnd, message, wparam, lparam).await
}

/// One of the box's controls given text of USER's own.
async fn set_item_text(engine: &Engine, dialog: u16, id: u16, text: &[u8]) -> Result<(), Stop> {
    let mut bytes = text.to_vec();

    bytes.push(0);
    send_item(engine, dialog, id, WM_SETTEXT, 0, &mut Param::Struct(bytes)).await?;
    Ok(())
}

/// One of the box's controls hidden.
async fn hide_item(engine: &Engine, dialog: u16, id: u16) -> Result<(), Stop> {
    let hwnd = engine.system().dlg_item(dialog, id);

    engine.show(hwnd, SW_HIDE).await
}

/// Shows the About box for a program, its owner, its name -- and after a
/// `#` the first line -- text of its own or none, and an icon or none for
/// the Windows logo: 1 once it is closed. A string that cannot be read
/// turns the call away, answering nought, before any box is made.
pub fn shell_about(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (owner, about) = {
            let system = engine.system();
            let owner = args.word(&system);
            let app = args.dword(&system);
            let other = match text_argument(&system, args.dword(&system)) {
                Text::Refused => return Ok(Answer::Word(0)),
                Text::Null => Vec::new(),
                Text::Number(number) => number.to_string().into_bytes(),
                Text::Read(bytes) => bytes,
            };
            let icon = args.word(&system);

            (
                owner,
                AboutProc {
                    app,
                    other: other.into(),
                    icon,
                },
            )
        };
        let hwnd = engine
            .create_dialog(0, &template(), owner, DialogProc::About(about), 0, true)
            .await?;

        Ok(Answer::Word(engine.run_modal(hwnd, owner).await? as u16))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thousands_separated_and_cut_at_a_nought() {
        assert_eq!(thousands(16384, b','), b"16,384");
        assert_eq!(thousands(1_234_567, b'.'), b"1.234.567");
        assert_eq!(thousands(999, b','), b"999");
        assert_eq!(thousands(16384, 0), b"16");
    }

    #[test]
    fn the_template_is_the_about_box() {
        let template = template();

        assert_eq!(template.caption, "About %s");
        assert!(template.items.iter().any(|item| item.id == ID_ICON));
    }
}
