//! Program Manager's `WinMain` and its frame's window procedure, as
//! `PROGMAN.EXE`'s are read out (`kb/topics/program-manager-dde.md`):
//! `WinMain` seg1 `0010`, its start-up seg3 `09fd`, the frame's procedure
//! seg2 `2229`. Every call into KERNEL, USER and SHELL is made as the file
//! makes it (`commdlg/api.rs`), and what the file keeps in its data segment
//! is kept at the same places in the instance's own (`D_*`). As
//! `src/win16/progman/main.ts`.
//!
//! What it does not do yet, each left where the file does it: its icons,
//! accelerators and fonts (it has no resources); the groups (`[Groups]` and
//! `Order=` are read, and nothing is loaded); DDE (seg7); saving the
//! settings (seg4 `2845`); as the shell, `load=` and `run=` and ending
//! Windows; its command line; and the messages of its menus and help.
//! WinBox's is hidden, by the owner's decision: its frame is never shown,
//! so it is not painted or made active.

use winbox_cpu::{DS, SP, SS};

use crate::call::{Answer, Args, Later, Stop};
use crate::commdlg::api::{self, Arg, Called};
use crate::engine::Engine;

type R<T> = Result<T, Stop>;

// What `PROGMAN.EXE` keeps in its data segment (seg8), by its places.

/// `[Settings]` `MinOnRun`, `AutoArrange`, `SaveSettings`.
const D_MIN_ON_RUN: u16 = 0x12;
const D_AUTO_ARRANGE: u16 = 0x14;
const D_SAVE_SETTINGS: u16 = 0x1c;
/// Whether it is the shell.
const D_SHELL: u16 = 0x18;
/// `[Restrictions]` `NoRun`, `NoClose`, `NoSaveSettings`, `NoFileMenu`,
/// `EditLevel`.
const D_NO_RUN: u16 = 0x28;
const D_NO_CLOSE: u16 = 0x2a;
const D_NO_SAVE_SETTINGS: u16 = 0x2c;
const D_NO_FILE_MENU: u16 = 0x2e;
const D_EDIT_LEVEL: u16 = 0x12e;
/// Set as `WM_CLOSE` is taken.
const D_CLOSING: u16 = 0x32;
/// The frame, which a second instance asks for by `GetInstanceData`.
pub(crate) const D_FRAME: u16 = 0x126;
/// The registered messages `OTHERWINDOWCREATED` and `ACTIVATESHELLWINDOW`,
/// `ShellHelp` and `commdlg_help`.
const D_OTHER_WINDOW: u16 = 0x132;
const D_ACTIVATE_SHELL: u16 = 0x134;
const D_SHELL_HELP: u16 = 0x81c;
const D_COMMDLG_HELP: u16 = 0x450;
/// Its instance.
const D_INSTANCE: u16 = 0x72a;
/// The MDI client.
pub(crate) const D_CLIENT: u16 = 0x76c;

/// The messages it answers itself.
const WM_CREATE: u16 = 0x01;
const WM_DESTROY: u16 = 0x02;
const WM_SIZE: u16 = 0x05;
const WM_CLOSE: u16 = 0x10;
const WM_ENDSESSION: u16 = 0x16;
const WM_SYSCOMMAND: u16 = 0x112;
/// A second instance's, and a program's it started (seg2 `2762`).
const WM_ACTIVATE_FIRST: u16 = 0x464;
const SC_CLOSE: u16 = 0xf060;
const SIZE_MINIMIZED: u16 = 1;

/// Its menu, as `PROGMAN.EXE`'s menu 5 has it: each popup's title and its
/// items, an item an identifier and its text, a separator nought and
/// nothing.
const MENU: [(&str, &[(u16, &str)]); 4] = [
    (
        "&File",
        &[
            (101, "&New..."),
            (102, "&Open\tEnter"),
            (103, "&Move...\tF7"),
            (104, "&Copy...\tF8"),
            (105, "&Delete\tDel"),
            (106, "&Properties...\tAlt+Enter"),
            (0, ""),
            (107, "&Run..."),
            (0, ""),
            (108, "E&xit Windows..."),
        ],
    ),
    (
        "&Options",
        &[
            (201, "&Auto Arrange"),
            (202, "&Minimize on Use"),
            (204, "&Save Settings on Exit"),
        ],
    ),
    (
        "&Window",
        &[
            (301, "&Cascade\tShift+F5"),
            (302, "&Tile\tShift+F4"),
            (303, "&Arrange Icons"),
        ],
    ),
    (
        "&Help",
        &[
            (401, "&Contents"),
            (404, "&Search for Help on..."),
            (0, ""),
            (402, "&How to Use Help"),
            (405, "&Windows Tutorial"),
            (0, ""),
            (403, "&About Program Manager..."),
        ],
    ),
];

/// The menu as a template for `LoadMenuIndirect`: a header of two noughts,
/// each popup `MF_POPUP` and its title, each item its flags, identifier and
/// text, the last of each list `MF_END`.
pub fn menu_template() -> Vec<u8> {
    const MF_POPUP: u16 = 0x10;
    const MF_END: u16 = 0x80;
    let mut bytes = vec![0, 0, 0, 0];

    for (index, (title, items)) in MENU.iter().enumerate() {
        let last = if index + 1 == MENU.len() { MF_END } else { 0 };

        bytes.extend_from_slice(&(MF_POPUP | last).to_le_bytes());
        bytes.extend_from_slice(title.as_bytes());
        bytes.push(0);

        for (at, (id, text)) in items.iter().enumerate() {
            let end = if at + 1 == items.len() { MF_END } else { 0 };

            bytes.extend_from_slice(&end.to_le_bytes());
            bytes.extend_from_slice(&id.to_le_bytes());
            bytes.extend_from_slice(text.as_bytes());
            bytes.push(0);
        }
    }

    bytes
}

/// One instance's Program Manager, as its calls are made: its engine and
/// its data segment.
pub(crate) struct Pm<'e> {
    e: &'e Engine,
    ds: u16,
}

impl<'e> Pm<'e> {
    /// An instance's: its data segment's selector, one above the instance
    /// (`instds`).
    fn new(e: &'e Engine, instance: u16) -> Self {
        Self {
            e,
            ds: instance.wrapping_add(1),
        }
    }

    fn at(&self, offset: u16) -> u32 {
        u32::from(self.ds) << 16 | u32::from(offset)
    }

    /// A word of its data.
    fn d16(&self, offset: u16) -> u16 {
        let bytes = self.e.system().read_far(self.at(offset), 2);

        u16::from_le_bytes([bytes[0], bytes[1]])
    }

    fn sd16(&self, offset: u16, value: u16) {
        self.e
            .system()
            .write_far(self.at(offset), &value.to_le_bytes());
    }

    async fn call(&self, module: &str, name: &str, args: &[Arg]) -> R<Called> {
        api::api(self.e, module, name, args).await
    }

    async fn user(&self, name: &str, args: &[Arg]) -> R<u32> {
        Ok(self.call("USER", name, args).await?.value)
    }

    async fn kernel(&self, name: &str, args: &[Arg]) -> R<u32> {
        Ok(self.call("KERNEL", name, args).await?.value)
    }

    /// A KERNEL call that works on DS, made with DS its data segment, as
    /// the file's code runs with it.
    async fn kernel_in_ds(&self, name: &str, args: &[Arg]) -> R<u32> {
        let saved = self.e.system().cpu.segments[DS].selector;

        self.load_ds(self.ds)?;

        let answer = self.kernel(name, args).await;

        self.load_ds(saved)?;
        answer
    }

    fn load_ds(&self, selector: u16) -> R<()> {
        self.e
            .system()
            .cpu
            .load_segment(DS, selector)
            .map_err(Stop::Processor)
    }

    /// `n` bytes of its stack, written, for a structure that points at
    /// them: their far address, and the stack pointer to give back.
    fn reserve(&self, bytes: &[u8]) -> (u32, u16) {
        let mut system = self.e.system();
        let saved = system.cpu.regs[SP];
        let at = saved.wrapping_sub((bytes.len() as u16 + 1) & !1);
        let far = u32::from(system.cpu.segments[SS].selector) << 16 | u32::from(at);

        system.cpu.regs[SP] = at;
        system.write_far(far, bytes);
        (far, saved)
    }

    fn release(&self, saved: u16) {
        self.e.system().cpu.regs[SP] = saved;
    }

    /// `GetPrivateProfileInt(section, key, default, "PROGMAN.INI")`.
    async fn profile_int(&self, section: &[u8], key: &[u8], default: u16) -> R<u16> {
        Ok(self
            .kernel(
                "GetPrivateProfileInt",
                &[
                    api::text(section),
                    api::text(key),
                    Arg::W(default),
                    api::text(INI),
                ],
            )
            .await? as u16)
    }

    /// `GetPrivateProfileString` into a buffer of `size`: what it read.
    async fn profile_string(
        &self,
        section: &[u8],
        key: Option<&[u8]>,
        size: u16,
        file: &[u8],
    ) -> R<Vec<u8>> {
        let called = self
            .call(
                "KERNEL",
                "GetPrivateProfileString",
                &[
                    api::text(section),
                    key.map_or(Arg::D(0), api::text),
                    api::text(b""),
                    api::buffer(usize::from(size)),
                    Arg::W(size),
                    api::text(file),
                ],
            )
            .await?;

        // The buffer, after the strings laid out before it.
        Ok(called.string(if key.is_some() { 3 } else { 2 }))
    }

    async fn send(&self, hwnd: u16, message: u16, wparam: u16, lparam: u32) -> R<u32> {
        api::send(self.e, hwnd, message, wparam, lparam).await
    }
}

/// Its profile, by the name it loads (string 6), which KERNEL finds in the
/// Windows directory.
const INI: &[u8] = b"PROGMAN.INI";

/// `WinMain` (seg1 `0010`): a command line makes the show command 7,
/// `SW_SHOWMINNOACTIVE`; the start-up; and the message loop, until
/// `WM_QUIT`, whose `wParam` it answers. A start-up that fails answers
/// nought.
pub(crate) fn win_main(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (instance, previous, line, show) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.word(&system),
            )
        };
        let pm = Pm::new(engine, instance);
        let given = line != 0 && engine.system().read_far(line, 1)[0] != 0;
        let show = if given { 7 } else { show };

        if !start(&pm, instance, previous, show).await? {
            return Ok(Answer::Word(0));
        }

        Ok(Answer::Word(message_loop(&pm).await?))
    })
}

/// The loop (seg1 `003e`-`00e3`): each message taken, offered to the MDI
/// client's system menu keys, and else translated and dispatched. The
/// file's own keys -- its accelerators, and the frame's when it is active
/// -- are not here: it has no accelerators, and its frame is never active.
async fn message_loop(pm: &Pm<'_>) -> R<u16> {
    loop {
        let called = pm
            .call(
                "USER",
                "GetMessage",
                &[api::buffer(18), Arg::W(0), Arg::W(0), Arg::W(0)],
            )
            .await?;
        let message = called.buffers[0].clone();

        if called.word() == 0 {
            return Ok(u16::from_le_bytes([message[4], message[5]]));
        }

        let client = pm.d16(D_CLIENT);
        let taken = pm
            .user(
                "TranslateMDISysAccel",
                &[Arg::W(client), Arg::B(message.clone())],
            )
            .await?;

        if taken as u16 == 0 {
            pm.user("TranslateMessage", &[Arg::B(message.clone())])
                .await?;
            pm.user("DispatchMessage", &[Arg::B(message)]).await?;
        }
    }
}

/// The start-up (seg3 `09fd`): whether it went on to the loop.
async fn start(pm: &Pm<'_>, instance: u16, previous: u16, show: u16) -> R<bool> {
    pm.sd16(D_INSTANCE, instance);

    // A second instance: the first's frame by `GetInstanceData`, sent 464h,
    // and the end (`0a12`-`0a3e`).
    if previous != 0 {
        pm.kernel_in_ds(
            "GetInstanceData",
            &[Arg::W(previous), Arg::W(D_FRAME), Arg::W(2)],
        )
        .await?;

        let frame = pm.d16(D_FRAME);

        if frame != 0 {
            pm.send(frame, WM_ACTIVATE_FIRST, 0, 0).await?;
        }

        return Ok(false);
    }

    // SYSTEM.INI's path: the Windows directory, a backslash where it is
    // longer than a root's, and `system.ini` (`0b3c`-`0b78`).
    let directory = pm
        .call(
            "KERNEL",
            "GetWindowsDirectory",
            &[api::buffer(0x81), Arg::W(0x81)],
        )
        .await?
        .string(0);
    let mut system_ini = directory;

    if system_ini.len() > 3 {
        system_ini.push(b'\\');
    }

    system_ini.extend_from_slice(b"system.ini");

    // The shell: the only task, or `shell=` holding `PROGMAN.EXE` at any
    // place along it, without regard to case (`0b88`-`0c0a`).
    let shell = if pm.kernel("GetNumTasks", &[]).await? as u16 == 1 {
        true
    } else {
        let line = pm
            .profile_string(b"Boot", Some(b"shell"), 0x80, &system_ini)
            .await?;

        holds_progman(&line)
    };

    pm.sd16(D_SHELL, u16::from(shell));
    pm.kernel("SetErrorMode", &[Arg::W(1)]).await?;
    pm.sd16(D_CLOSING, 0);

    for (place, name) in [
        (D_SHELL_HELP, &b"ShellHelp"[..]),
        (D_COMMDLG_HELP, b"commdlg_help"),
        (D_OTHER_WINDOW, b"OTHERWINDOWCREATED"),
        (D_ACTIVATE_SHELL, b"ACTIVATESHELLWINDOW"),
    ] {
        let message = pm.user("RegisterWindowMessage", &[api::text(name)]).await?;

        pm.sd16(place, message as u16);
    }

    if !register_frame(pm, instance).await? {
        return Ok(false);
    }

    // Its settings, the frame placed and made, the groups loaded and the
    // display written (seg3 `08ff`).
    let window = settings(pm).await?;
    let mut place = [0x8000, 0x8000, 0, 0, 1];

    if let Some(numbers) = window.as_deref().and_then(window_numbers) {
        place = numbers;
    }

    let shown = if show == 1 { place[4] } else { show };
    let frame = create_frame(pm, instance, place, shown).await?;

    if frame == 0 {
        return Ok(false);
    }

    load_groups(pm, &system_ini).await?;
    pm.user("ShowWindow", &[Arg::W(pm.d16(D_CLIENT)), Arg::W(1)])
        .await?;

    Ok(true)
}

/// Whether a `shell=` line holds `PROGMAN.EXE` at some place along it,
/// compared as `lstrcmpi` compares it, eleven characters at a time from
/// each place on.
fn holds_progman(line: &[u8]) -> bool {
    line.windows(super::FILE.len())
        .any(|part| part.eq_ignore_ascii_case(super::FILE.as_bytes()))
}

/// `RegisterClass` of the frame's class, `Progman` (string 2): byte-aligned
/// (`CS_BYTEALIGNWINDOW`), its procedure WinBox's `FRAMEWNDPROC`, the arrow
/// cursor, no background brush (seg3 `0d02`-`0d6e`). It has no icon of its
/// own, and its menu is made as the frame is (`create_frame`).
async fn register_frame(pm: &Pm<'_>, instance: u16) -> R<bool> {
    let cursor = pm.user("LoadCursor", &[Arg::W(0), Arg::D(0x7f00)]).await? as u16;
    let procedure = {
        let mut system = pm.e.system();

        super::export_address(&mut system, super::FRAME_PROC)
    };
    let (name, saved) = pm.reserve(b"Progman\0");
    let mut class = 0x1000u16.to_le_bytes().to_vec();

    class.extend_from_slice(&procedure.to_le_bytes());

    for word in [0u16, 0, instance, 0, cursor, 0] {
        class.extend_from_slice(&word.to_le_bytes());
    }

    class.extend_from_slice(&0u32.to_le_bytes());
    class.extend_from_slice(&name.to_le_bytes());

    let answer = pm.user("RegisterClass", &[Arg::B(class)]).await;

    pm.release(saved);
    Ok(answer? as u16 != 0)
}

/// Its settings (seg3 `02e3`): `[Settings]` `MinOnRun`, `AutoArrange` and
/// `SaveSettings`, defaults 0, 0 and 1; `[Restrictions]` `NoRun`,
/// `NoClose`, `NoSaveSettings` and `EditLevel`, `NoSaveSettings` turning
/// `SaveSettings` off; and `Window=`, if there is one.
async fn settings(pm: &Pm<'_>) -> R<Option<Vec<u8>>> {
    for (place, section, key, default) in [
        (D_MIN_ON_RUN, &b"Settings"[..], &b"MinOnRun"[..], 0),
        (D_AUTO_ARRANGE, b"Settings", b"AutoArrange", 0),
        (D_SAVE_SETTINGS, b"Settings", b"SaveSettings", 1),
        (D_NO_RUN, b"Restrictions", b"NoRun", 0),
        (D_NO_CLOSE, b"Restrictions", b"NoClose", 0),
        (D_NO_SAVE_SETTINGS, b"Restrictions", b"NoSaveSettings", 0),
        (D_EDIT_LEVEL, b"Restrictions", b"EditLevel", 0),
    ] {
        let value = pm.profile_int(section, key, default).await?;

        pm.sd16(place, value);
    }

    if pm.d16(D_NO_SAVE_SETTINGS) != 0 {
        pm.sd16(D_SAVE_SETTINGS, 0);
    }

    let window = pm
        .profile_string(b"Settings", Some(b"Window"), 0xa0, INI)
        .await?;

    Ok((!window.is_empty()).then_some(window))
}

/// `Window=`'s five numbers, as seg3 `092c`-`099c` reads them: each after
/// what is not a digit or `-`, read as seg3 `0285` reads one; fewer than
/// five, and none of them is used.
fn window_numbers(line: &[u8]) -> Option<[u16; 5]> {
    let number = |byte: u8| byte.is_ascii_digit() || byte == b'-';
    let mut numbers = [0u16; 5];
    let mut at = 0;

    for each in &mut numbers {
        while at < line.len() && !number(line[at]) {
            at += 1;
        }

        if at == line.len() {
            return None;
        }

        *each = read_number(&line[at..]);

        while at < line.len() && number(line[at]) {
            at += 1;
        }
    }

    Some(numbers)
}

/// A number as seg3 `0285` reads one: an optional `-`, then decimal digits
/// up to the first other character.
pub(crate) fn read_number(text: &[u8]) -> u16 {
    let (negative, digits) = match text.first() {
        Some(b'-') => (true, &text[1..]),
        _ => (false, text),
    };
    let value = digits
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .fold(0u16, |value, &digit| {
            value.wrapping_mul(10).wrapping_add(u16::from(digit - b'0'))
        });

    if negative {
        value.wrapping_neg()
    } else {
        value
    }
}

/// The frame (seg3 `045c`): `CreateWindow` of `Progman`, "Program Manager"
/// (string 1), `WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN`, at the place given
/// -- `CW_USEDEFAULT` with no `Window=` -- with its menu; `E&xit Windows...`
/// made `E&xit` where it is not the shell (string 124); the File menu gone
/// with `NoFileMenu`, Save Settings greyed with `NoSaveSettings`, and the
/// options on checked. The file then shows it as `show` says, and paints
/// its client: WinBox's is hidden, so neither.
async fn create_frame(pm: &Pm<'_>, instance: u16, place: [u16; 5], _show: u16) -> R<u16> {
    let menu = pm
        .user("LoadMenuIndirect", &[Arg::B(menu_template())])
        .await? as u16;
    let [left, top, right, bottom, _] = place;
    let frame = pm
        .user(
            "CreateWindow",
            &[
                api::text(b"Progman"),
                api::text(b"Program Manager"),
                Arg::D(0x02cf_0000),
                Arg::W(left),
                Arg::W(top),
                Arg::W(right.wrapping_sub(left)),
                Arg::W(bottom.wrapping_sub(top)),
                Arg::W(0),
                Arg::W(menu),
                Arg::W(instance),
                Arg::D(0),
            ],
        )
        .await? as u16;

    pm.sd16(D_FRAME, frame);

    if frame == 0 {
        return Ok(0);
    }

    let menu = pm.user("GetMenu", &[Arg::W(frame)]).await? as u16;

    if pm.d16(D_SHELL) == 0 {
        pm.user(
            "ModifyMenu",
            &[
                Arg::W(menu),
                Arg::W(108),
                Arg::W(0),
                Arg::W(108),
                api::text(b"E&xit"),
            ],
        )
        .await?;
    }

    if pm.profile_int(b"Restrictions", b"NoFileMenu", 0).await? != 0 {
        pm.user("DeleteMenu", &[Arg::W(menu), Arg::W(0), Arg::W(0x400)])
            .await?;
        pm.sd16(D_NO_FILE_MENU, 1);
    }

    if pm.d16(D_NO_SAVE_SETTINGS) != 0 {
        pm.sd16(D_SAVE_SETTINGS, 0);
        pm.user("EnableMenuItem", &[Arg::W(menu), Arg::W(204), Arg::W(3)])
            .await?;
    }

    for (place, item) in [
        (D_MIN_ON_RUN, 202),
        (D_AUTO_ARRANGE, 201),
        (D_SAVE_SETTINGS, 204),
    ] {
        if pm.d16(place) != 0 {
            pm.user("CheckMenuItem", &[Arg::W(menu), Arg::W(item), Arg::W(8)])
                .await?;
        }
    }

    Ok(frame)
}

/// The groups (seg3 `0809`, `06c1`): `[Groups]`' keys and `Order=` read,
/// and -- not yet -- each group loaded from its file; then `[Settings]`
/// `display.drv=` written with `SYSTEM.INI`'s `[boot]` `display.drv=`
/// (`08ab`-`08d8`).
async fn load_groups(pm: &Pm<'_>, system_ini: &[u8]) -> R<()> {
    pm.profile_string(b"Groups", None, 0x140, INI).await?;
    pm.profile_string(b"Settings", Some(b"Order"), 0x7f, INI)
        .await?;

    let display = pm
        .profile_string(b"Boot", Some(b"display.drv"), 0x78, system_ini)
        .await?;

    pm.kernel(
        "WritePrivateProfileString",
        &[
            api::text(b"Settings"),
            api::text(b"display.drv"),
            api::text(&display),
            api::text(INI),
        ],
    )
    .await?;

    Ok(())
}

/// The frame's window procedure (seg2 `2229`).
pub(crate) fn frame_proc(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, wparam, lparam) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
            )
        };
        let instance = api::word(
            engine,
            "USER",
            "GetWindowWord",
            &[Arg::W(hwnd), Arg::W(0xfffa)],
        )
        .await?;
        let pm = Pm::new(engine, instance);

        Ok(Answer::Dword(
            frame_message(&pm, hwnd, message, wparam, lparam).await?,
        ))
    })
}

/// What the frame answers a message.
async fn frame_message(pm: &Pm<'_>, hwnd: u16, message: u16, wparam: u16, lparam: u32) -> R<u32> {
    match message {
        WM_CREATE => created(pm, hwnd).await,
        WM_DESTROY => {
            // `2410`-`2483`: SHELL's hook let go, and the loop ended. Help
            // and pen windows, which it has had nothing of, are not.
            pm.call("SHELL", "RegisterShellHook", &[Arg::W(hwnd), Arg::W(0)])
                .await?;
            pm.user("PostQuitMessage", &[Arg::W(0)]).await?;
            Ok(0)
        }
        // `268b`: the MDI client sized to the frame's client, a pixel past
        // it each way, unless the frame is an icon.
        WM_SIZE => {
            if wparam != SIZE_MINIMIZED {
                pm.user(
                    "MoveWindow",
                    &[
                        Arg::W(pm.d16(D_CLIENT)),
                        Arg::W(0xffff),
                        Arg::W(0xffff),
                        Arg::W((lparam as u16).wrapping_add(2)),
                        Arg::W(((lparam >> 16) as u16).wrapping_add(2)),
                        Arg::W(1),
                    ],
                )
                .await?;
            }

            Ok(0)
        }
        WM_CLOSE => close(pm, hwnd, message, wparam, lparam).await,
        // `2353`: the settings saved where Windows ends, `SaveSettings` is
        // on and `NoClose` is not -- not yet (`save`).
        WM_ENDSESSION => {
            if wparam != 0 && pm.d16(D_NO_CLOSE) == 0 && pm.d16(D_SAVE_SETTINGS) != 0 {
                save(pm);
            }

            Ok(0)
        }
        // `26b1`: with `NoClose`, `SC_CLOSE` does nothing.
        WM_SYSCOMMAND if pm.d16(D_NO_CLOSE) != 0 && wparam == SC_CLOSE => Ok(0),
        WM_ACTIVATE_FIRST => {
            activated(pm, hwnd).await?;
            Ok(0)
        }
        _ if message == pm.d16(D_ACTIVATE_SHELL) => {
            // `22b9`-`22d4`: restored where it is an icon, else brought to
            // the top.
            if pm.user("IsIconic", &[Arg::W(hwnd)]).await? as u16 != 0 {
                pm.user("ShowWindow", &[Arg::W(hwnd), Arg::W(9)]).await?;
            } else {
                pm.user("BringWindowToTop", &[Arg::W(hwnd)]).await?;
            }

            Ok(0)
        }
        // `1fb8`: a window made by a program one of its items started gets
        // the item's hot key; with no groups, there are none.
        _ if message == pm.d16(D_OTHER_WINDOW) => Ok(0),
        _ => default(pm, hwnd, message, wparam, lparam).await,
    }
}

/// `DefFrameProc` with the MDI client (`29be`).
async fn default(pm: &Pm<'_>, hwnd: u16, message: u16, wparam: u16, lparam: u32) -> R<u32> {
    pm.user(
        "DefFrameProc",
        &[
            Arg::W(hwnd),
            Arg::W(pm.d16(D_CLIENT)),
            Arg::W(message),
            Arg::W(wparam),
            Arg::D(lparam),
        ],
    )
    .await
}

/// `WM_CREATE` (`22d7`-`2350`): the frame kept, SHELL told of it -- 2, the
/// shell's own window, where it is the shell, else 1 -- and the MDI client
/// made over its client, a pixel past it each way, with the menu's third
/// popup for its windows and 500 its first child's identifier. Without
/// one, -1.
async fn created(pm: &Pm<'_>, hwnd: u16) -> R<u32> {
    pm.sd16(D_FRAME, hwnd);

    let shell = pm.d16(D_SHELL) != 0;

    pm.call(
        "SHELL",
        "RegisterShellHook",
        &[Arg::W(hwnd), Arg::W(if shell { 2 } else { 1 })],
    )
    .await?;

    let menu = pm.user("GetMenu", &[Arg::W(hwnd)]).await? as u16;
    let windows = pm.user("GetSubMenu", &[Arg::W(menu), Arg::W(2)]).await? as u16;
    let rect = pm
        .call("USER", "GetClientRect", &[Arg::W(hwnd), api::buffer(8)])
        .await?
        .buffers[0]
        .clone();
    let word = |at: usize| u16::from_le_bytes([rect[at], rect[at + 1]]);
    let mut create = windows.to_le_bytes().to_vec();

    create.extend_from_slice(&500u16.to_le_bytes());

    let instance = pm.d16(D_INSTANCE);
    let client = pm
        .user(
            "CreateWindow",
            &[
                api::text(b"MDIClient"),
                Arg::D(0),
                Arg::D(0x42b0_0000),
                Arg::W(word(0).wrapping_sub(1)),
                Arg::W(word(2).wrapping_sub(1)),
                Arg::W(word(4).wrapping_add(2)),
                Arg::W(word(6).wrapping_add(2)),
                Arg::W(hwnd),
                Arg::W(1),
                Arg::W(instance),
                Arg::B(create),
            ],
        )
        .await? as u16;

    pm.sd16(D_CLIENT, client);
    Ok(if client == 0 { 0xffff_ffff } else { 0 })
}

/// `WM_CLOSE` (`236d`-`240d`): with `NoClose`, nothing. With Shift held,
/// the settings saved and nothing more. Else saved where `SaveSettings` is
/// on; and Program Manager not the shell destroyed, by `DefFrameProc`.
/// The shell asks whether to end Windows -- not yet, so nothing.
async fn close(pm: &Pm<'_>, hwnd: u16, message: u16, wparam: u16, lparam: u32) -> R<u32> {
    if pm.d16(D_NO_CLOSE) != 0 {
        return Ok(0);
    }

    if pm.user("GetKeyState", &[Arg::W(0x10)]).await? as u16 & 0x8000 != 0 {
        save(pm);
        return Ok(0);
    }

    if pm.d16(D_SAVE_SETTINGS) != 0 {
        save(pm);
    }

    pm.sd16(D_CLOSING, 1);

    if pm.d16(D_SHELL) == 0 {
        return default(pm, hwnd, message, wparam, lparam).await;
    }

    pm.sd16(D_CLOSING, 0);
    Ok(0)
}

/// Saving the settings (seg4 `2845`): `Window=`, the groups and their
/// files. Not yet: what it would write is `pmstart`'s and `pmbare`'s
/// records.
fn save(_pm: &Pm<'_>) {}

/// 464h (`2762`-`287f`), from a second instance: with no item starting,
/// restored if it is an icon, and it and its last popup brought to the
/// top. Hidden, it stays hidden.
async fn activated(pm: &Pm<'_>, hwnd: u16) -> R<()> {
    if pm.user("IsIconic", &[Arg::W(hwnd)]).await? as u16 != 0 {
        pm.user("ShowWindow", &[Arg::W(hwnd), Arg::W(1)]).await?;
    }

    pm.user("BringWindowToTop", &[Arg::W(hwnd)]).await?;

    let popup = pm.user("GetLastActivePopup", &[Arg::W(hwnd)]).await? as u16;

    pm.user("BringWindowToTop", &[Arg::W(popup)]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_takes_five_numbers() {
        assert_eq!(window_numbers(b"4 0 636 408 1"), Some([4, 0, 636, 408, 1]));
        assert_eq!(
            window_numbers(b"-4,x10 20 30 7junk"),
            Some([0xfffc, 10, 20, 30, 7])
        );
        assert_eq!(window_numbers(b"1 2 3 4"), None);
    }

    #[test]
    fn the_shell_line_holds_progman_anywhere() {
        assert!(holds_progman(b"progman.exe"));
        assert!(holds_progman(b"C:\\WINDOWS\\PROGMAN.EXE /x"));
        assert!(!holds_progman(b"PMSTART.EXE"));
        assert!(!holds_progman(b"PROGMAN"));
    }
}
