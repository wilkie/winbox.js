//! A second sweep of Windows 3.1's own programs, used as a person at the
//! page uses them: Terminal's settings dialogs and its window, Control
//! Panel's applets, Recorder, Clipboard Viewer, PIF Editor, Character Map,
//! Sound Recorder, Calendar and Clock. Each session is held to what shows
//! -- the windows' texts, the accessible tree, the screen -- and to what
//! was written, the INI files among it. Where one once failed, it says why.
//!
//! The host's time is the test's own, as in `accessories.rs`.

use std::cell::Cell;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use winbox_machine::Change;
use winbox_web::session::{Made, Session, State, pointer_of};
use winbox_win16::key_input::Key;

thread_local! {
    /// The host's time, in milliseconds.
    static NOW: Cell<f64> = const { Cell::new(0.0) };
    /// When the machine's clock starts, in milliseconds from 1970.
    static EPOCH: Cell<i64> = const { Cell::new(0) };
    /// The calls the programs made, kept while a session asks for them.
    static CALLS: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

fn host_ms() -> f64 {
    NOW.with(|now| {
        now.set(now.get() + 0.01);
        now.get()
    })
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A host's folder put on drive C: at `dos`, in the order of the names.
fn hold(session: &mut Session, folder: &Path, dos: &str) {
    let mut entries: Vec<_> = std::fs::read_dir(folder).unwrap().flatten().collect();

    entries.sort_by_key(std::fs::DirEntry::file_name);

    for entry in entries {
        let path = entry.path();
        let named = format!("{dos}\\{}", entry.file_name().to_string_lossy());

        if path.is_dir() {
            assert!(session.add_folder('C', &named, 0));
            hold(session, &path, &named);
        } else {
            assert!(session.add_file('C', &named, std::fs::read(&path).unwrap(), 0));
        }
    }
}

/// A fresh machine, Windows staying up, the installation on C: (held in
/// memory, so nothing the run writes reaches the oracle's build), and the
/// program named in `C:\WINDOWS` started; none where the oracle's build is
/// not here.
fn started(program: &str) -> Option<Session> {
    started_as(program, false)
}

/// A fresh machine as `started` makes one, with the sound card installed
/// as the page installs it where `sound` (`Session::install_sound`).
fn started_as(program: &str, sound: bool) -> Option<Session> {
    let windows = root().join("oracle/build/drive-c");

    if !windows.join("WINDOWS").join(program).is_file() {
        eprintln!("skipped: the oracle's build is not here");
        return None;
    }

    NOW.with(|now| now.set(0.0));

    let mut session = Session::new(Made {
        display: "vga",
        coprocessor: true,
        host: host_ms,
        wall: || 0,
        epoch_ms: EPOCH.with(Cell::get),
    })
    .unwrap();

    session.stay_up();
    hold(&mut session, &windows, "");
    session.mark_planned();

    if sound {
        assert!(session.install_sound());
    }

    start(&mut session, program);
    Some(session)
}

/// Another program of `C:\WINDOWS` started beside those running.
fn start(session: &mut Session, program: &str) {
    session.start(&format!("C:\\WINDOWS\\{program}")).unwrap();
    frames(session, 150);
}

/// So many of the page's frames.
fn frames(session: &mut Session, count: usize) {
    for frame in 0..count {
        let slice = [4.0, 16.0, 12.0][frame % 3];
        let state = session.step(host_ms() + slice);

        NOW.with(|now| now.set(now.get() + slice));

        if state == State::Idle {
            let wake = session.wake_at();

            NOW.with(|now| now.set(now.get().max(wake)));
        }

        let calls = session.take_calls(false);

        CALLS.with(|kept| {
            if let Some(kept) = kept.borrow_mut().as_mut() {
                kept.push_str(&calls);
            }
        });
        assert_ne!(state, State::Stopped, "{:?}", session.stop());
    }
}

fn key(code: &str, name: &str, alt: bool) -> Key {
    Key {
        code: code.to_string(),
        key: name.to_string(),
        repeat: false,
        alt,
    }
}

/// The key a character is typed with, what it types, and whether Shift is
/// held for it.
fn key_of(character: char) -> (String, String, bool) {
    let plain = |code: &str| (code.to_string(), character.to_string(), false);
    let shifted = |code: &str| (code.to_string(), character.to_string(), true);

    match character {
        'a'..='z' => (
            format!("Key{}", character.to_ascii_uppercase()),
            character.to_string(),
            false,
        ),
        'A'..='Z' => (format!("Key{character}"), character.to_string(), true),
        '0'..='9' => (format!("Digit{character}"), character.to_string(), false),
        ' ' => plain("Space"),
        '.' => plain("Period"),
        ',' => plain("Comma"),
        '-' => plain("Minus"),
        '/' => plain("Slash"),
        ';' => plain("Semicolon"),
        '\\' => plain("Backslash"),
        '=' => plain("Equal"),
        ':' => shifted("Semicolon"),
        '*' => shifted("Digit8"),
        '+' => shifted("Equal"),
        '!' => shifted("Digit1"),
        '_' => shifted("Minus"),
        '^' => shifted("Digit6"),
        '?' => shifted("Slash"),
        '"' => shifted("Quote"),
        '(' => shifted("Digit9"),
        ')' => shifted("Digit0"),
        _ => panic!("no key for {character:?}"),
    }
}

/// Text typed, a key at a time.
fn type_text(session: &mut Session, text: &str) {
    for character in text.chars() {
        let (code, name, shift) = key_of(character);

        if shift {
            session.key(true, &key("ShiftLeft", "Shift", false));
        }

        session.key(true, &key(&code, &name, false));
        session.key(false, &key(&code, &name, false));

        if shift {
            session.key(false, &key("ShiftLeft", "Shift", false));
        }

        frames(session, 3);
    }

    frames(session, 20);
}

/// A key pressed and let go, with Control, Shift or Alt held where one is
/// named, and the run let take it.
fn press(session: &mut Session, held: Option<&str>, code: &str, name: &str) {
    let modifier = held.map(|held| match held {
        "Control" => ("ControlLeft", "Control"),
        "Shift" => ("ShiftLeft", "Shift"),
        _ => ("AltLeft", "Alt"),
    });
    let alt = held == Some("Alt");

    if let Some((code, name)) = modifier {
        session.key(true, &key(code, name, alt));
    }

    session.key(true, &key(code, name, alt));
    session.key(false, &key(code, name, alt));

    if let Some((code, name)) = modifier {
        session.key(false, &key(code, name, false));
    }

    frames(session, 40);
}

/// A letter pressed with a modifier held.
fn chord(session: &mut Session, held: &str, letter: char) {
    let (code, name, _) = key_of(letter);

    press(session, Some(held), &code, &name);
}

/// A menu's item chosen by the keys: Alt with the menu's letter, then the
/// item's.
fn menu(session: &mut Session, menu: char, item: char) {
    chord(session, "Alt", menu);

    let (code, name, _) = key_of(item);

    press(session, None, &code, &name);
    frames(session, 40);
}

/// The left button pressed and let go at a point of the screen, twice for
/// a double click, as the page gives it; and the run let take it.
fn click(session: &mut Session, x: i16, y: i16, double: bool) {
    session.pointer(pointer_of(0, x, y, 0, 0, false));

    for time in 0..if double { 2 } else { 1 } {
        session.pointer(pointer_of(1, x, y, 0, 1, time == 1));
        session.pointer(pointer_of(2, x, y, 0, 0, false));
    }

    frames(session, 60);
}

/// The left button pressed at one point, the mouse moved with it held to
/// another, and let go there.
fn drag(session: &mut Session, from: (i16, i16), to: (i16, i16)) {
    session.pointer(pointer_of(0, from.0, from.1, 0, 0, false));
    session.pointer(pointer_of(1, from.0, from.1, 0, 1, false));
    frames(session, 10);

    for step in 1..=8 {
        let x = from.0 + (to.0 - from.0) * step / 8;
        let y = from.1 + (to.1 - from.1) * step / 8;

        session.pointer(pointer_of(0, x, y, 0, 1, false));
        frames(session, 4);
    }

    session.pointer(pointer_of(2, to.0, to.1, 0, 0, false));
    frames(session, 40);
}

/// The first window shown with a title, or of a class.
fn shown(session: &Session, named: &str) -> Option<usize> {
    let system = session.system();

    system.windows.iter().position(|window| {
        window.as_ref().is_some_and(|window| {
            window.visible && (window.title == named || window.class == named)
        })
    })
}

/// The control with an identifier in the window shown with a title.
fn control(session: &Session, title: &str, id: u16) -> usize {
    let parent = shown(session, title).unwrap_or_else(|| panic!("no window {title}"));
    let system = session.system();

    system
        .windows
        .iter()
        .position(|window| {
            window
                .as_ref()
                .is_some_and(|window| window.parent == Some(parent) && window.control_id == id)
        })
        .unwrap_or_else(|| panic!("no control {id:x} in {title}"))
}

/// The text of the control with an identifier in the window shown with a
/// title: an edit control's, a static's or a button's.
fn text_of(session: &Session, title: &str, id: u16) -> String {
    let at = control(session, title, id);
    let system = session.system();
    let window = system.windows[at].as_ref().unwrap();

    window
        .control
        .as_ref()
        .map_or_else(|| window.title.clone(), |control| control.text.clone())
}

/// Whether the button with an identifier in the window shown with a title
/// is checked.
fn checked(session: &Session, title: &str, id: u16) -> bool {
    let at = control(session, title, id);
    let system = session.system();

    system.windows[at]
        .as_ref()
        .and_then(|window| window.control.as_ref())
        .is_some_and(|control| control.checked != 0)
}

/// The middle of the control with an identifier in the window shown with a
/// title, on the screen.
fn centre(session: &Session, title: &str, id: u16) -> (i16, i16) {
    let at = control(session, title, id);
    let system = session.system();
    let window = system.windows[at].as_ref().unwrap();

    (
        i16::try_from(window.left + window.width / 2).unwrap(),
        i16::try_from(window.top + window.height / 2).unwrap(),
    )
}

/// The control with an identifier in the window shown with a title
/// clicked in its middle.
fn click_control(session: &mut Session, title: &str, id: u16) {
    let (x, y) = centre(session, title, id);

    click(session, x, y, false);
}

/// A file's bytes as a program left it on C:, where it wrote one.
fn written(session: &Session, path: &str) -> Option<Vec<u8>> {
    session
        .changes('C')
        .into_iter()
        .find_map(|change| match change {
            Change::File { path: at, data, .. } if at.eq_ignore_ascii_case(path) => {
                Some(data.to_vec())
            }
            _ => None,
        })
}

/// A value of an INI file as the run left it, where it wrote the file.
fn ini_value(session: &Session, path: &str, section: &str, name: &str) -> Option<String> {
    let bytes = written(session, path)?;
    let text = String::from_utf8_lossy(&bytes);
    let mut inside = false;

    for line in text.lines() {
        let line = line.trim();

        if let Some(header) = line
            .strip_prefix('[')
            .and_then(|line| line.strip_suffix(']'))
        {
            inside = header.eq_ignore_ascii_case(section);
        } else if inside
            && let Some((key, value)) = line.split_once('=')
            && key.trim().eq_ignore_ascii_case(name)
        {
            return Some(value.trim().to_string());
        }
    }

    None
}

/// The screen as a PPM picture, for a session followed by eye.
fn picture(session: &mut Session) -> Vec<u8> {
    let (width, height) = session.size();
    let mut out = format!("P6 {width} {height} 255\n").into_bytes();

    for pixel in session.present().chunks(4) {
        out.extend_from_slice(&pixel[..3]);
    }

    out
}

/// The windows shown, a line each: index, parent, class, identifier, place
/// and text.
fn listing(session: &Session) -> String {
    let system = session.system();
    let mut out = String::new();

    for (index, window) in system.windows.iter().enumerate() {
        let Some(window) = window else { continue };

        if !window.visible {
            continue;
        }

        let text = window
            .control
            .as_ref()
            .map_or_else(|| window.title.clone(), |control| control.text.clone());
        let checked = window.control.as_ref().map_or(0, |control| control.checked);

        let _ = writeln!(
            out,
            "{index:3} p{:?} {} id={} ({},{} {}x{}) s={:x} chk={checked} {:?}",
            window.parent,
            window.class,
            window.control_id,
            window.left,
            window.top,
            window.width,
            window.height,
            window.style,
            text,
        );
    }

    out
}

/// The colour the screen shows at a point, a `0x00RRGGBB` word.
fn colour_at(session: &Session, x: usize, y: usize) -> u32 {
    let screen = session.shown();

    screen.colours[usize::from(screen.indices[y * 640 + x])]
}

/// Terminal started, as on a first run asking for its port: COM1 chosen
/// from its list and the box closed.
fn terminal() -> Option<Session> {
    let mut session = started("TERMINAL.EXE")?;

    assert!(shown(&session, "Default Serial Port").is_some());
    click(&mut session, 260, 210, false);
    click_control(&mut session, "Default Serial Port", 1);
    assert!(shown(&session, "Default Serial Port").is_none());
    assert!(shown(&session, "Terminal - (Untitled)").is_some());
    Some(session)
}

/// Terminal's settings saved as a `.TRM` file through COMMDLG's Save As,
/// and opened again. COMMDLG asks `OpenFile` with `OF_EXIST` about the name
/// typed, `.\TEST.TRM`, and takes the path of the file to be made from the
/// structure; KERNEL leaves there the name made whole even where nothing is
/// found (`KRNL386.EXE` seg1 `5490`, `5814`). It was left as given, and
/// Terminal saved `C:\WINDOWS\.TRM` and named its window `Terminal - .TRM`.
#[test]
fn terminal_saves_its_settings_and_opens_them_again() {
    let Some(mut session) = terminal() else {
        return;
    };

    menu(&mut session, 's', 'n');
    type_text(&mut session, "555-1234");
    press(&mut session, None, "Enter", "Enter");
    menu(&mut session, 'f', 'a');
    frames(&mut session, 60);
    assert!(shown(&session, "File Save As").is_some(), "no Save As box");
    type_text(&mut session, "TEST.TRM");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 60);
    assert!(shown(&session, "Terminal - TEST.TRM").is_some());
    assert!(written(&session, "WINDOWS\\TEST.TRM").is_some_and(|file| !file.is_empty()));
    assert!(written(&session, "WINDOWS\\.TRM").is_none());

    // A new session forgets the number; the file opened has it again.
    menu(&mut session, 'f', 'n');
    menu(&mut session, 's', 'n');
    assert_eq!(text_of(&session, "Phone Number", 11), "");
    press(&mut session, None, "Escape", "Escape");
    menu(&mut session, 'f', 'o');
    frames(&mut session, 60);
    type_text(&mut session, "TEST.TRM");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 60);
    assert!(shown(&session, "Terminal - TEST.TRM").is_some());
    menu(&mut session, 's', 'n');
    assert_eq!(text_of(&session, "Phone Number", 11), "555-1234");
}

/// Terminal's Communications box: a radio button of each group pressed, a
/// port chosen in its list, and the box opened again on them. Stop bits of
/// 1.5 go only with five data bits, which Terminal chooses for itself and
/// leaves the others grey.
#[test]
fn terminals_communications_box_keeps_what_was_chosen() {
    let Some(mut session) = terminal() else {
        return;
    };
    let title = "Communications";

    menu(&mut session, 's', 'c');
    assert!(checked(&session, title, 14) && checked(&session, title, 25));

    for id in [17, 43, 52, 32] {
        click_control(&mut session, title, id);
    }

    assert!(checked(&session, title, 22), "five data bits");
    press(&mut session, None, "Enter", "Enter");
    assert!(shown(&session, title).is_none());
    menu(&mut session, 's', 'c');

    for (id, on) in [
        (14, false),
        (17, true),
        (43, true),
        (52, true),
        (32, true),
        (22, true),
    ] {
        assert_eq!(checked(&session, title, id), on, "button {id}");
    }

    press(&mut session, None, "Escape", "Escape");
}

/// Terminal with local echo and outgoing carriage returns made line ends
/// shows what is typed, a line each; thirty lines scroll its window, and
/// its scroll bar takes it back to the first.
#[test]
fn terminal_echoes_what_is_typed_and_scrolls_back() {
    let Some(mut session) = terminal() else {
        return;
    };

    menu(&mut session, 's', 'p');
    click_control(&mut session, "Terminal Preferences", 12);
    click_control(&mut session, "Terminal Preferences", 22);
    press(&mut session, None, "Enter", "Enter");
    assert!(shown(&session, "Terminal Preferences").is_none());

    for line in 1..=30 {
        type_text(&mut session, &format!("line {line}"));
        press(&mut session, None, "Enter", "Enter");
    }

    // The window's top row, eight pixels a character: "line 10" there, its
    // seventh character inked, and with the scroll bar's thumb dragged to
    // its top, "line 1", whose seventh is not.
    let seventh =
        |session: &Session| (52..60).any(|x| (44..58).any(|y| colour_at(session, x, y) == 0));

    assert!(seventh(&session), "the last lines show");
    drag(&mut session, (623, 340), (623, 40));
    assert!(!seventh(&session), "the first line shows");
    assert!((44..52).any(|x| (44..58).any(|y| colour_at(&session, x, y) == 0)));
}

/// A program started beside Terminal, which polls its port with
/// `PeekMessage` and never waits, has its turn: `PeekMessage` finding
/// nothing lets the other tasks run. Notepad's window never showed until a
/// key was pressed.
#[test]
fn a_program_started_beside_terminal_runs() {
    let Some(mut session) = terminal() else {
        return;
    };

    start(&mut session, "NOTEPAD.EXE");
    assert!(shown(&session, "Notepad - (Untitled)").is_some());
}

/// Control Panel's Color draws its sample of the screen's elements, and,
/// opened out with Color Palette, its basic and custom colours' boxes,
/// over statics of `SS_USERITEM`, which draw nothing (`USER.EXE` seg25
/// `2149`); winbox.js filled them white over what Color drew. Made wider,
/// the box is due where its children are, as it paints over them; it was
/// due only beside them, and the boxes were never drawn.
#[test]
fn control_panels_color_shows_its_sample_and_its_colours() {
    let Some(mut session) = started("CONTROL.EXE") else {
        return;
    };

    click(&mut session, 33, 66, true);
    frames(&mut session, 60);
    assert!(shown(&session, "Color").is_some());
    // The sample's active caption and its highlighted item.
    assert_eq!(colour_at(&session, 45, 169), 0x00_0080);
    assert_eq!(colour_at(&session, 45, 223), 0x00_0080);

    click_control(&mut session, "Color", 714);
    frames(&mut session, 30);
    // The first red of the basic colours, and a custom colour's white box
    // in its black frame.
    assert_eq!(colour_at(&session, 290, 143), 0xff_0000);
    assert_eq!(colour_at(&session, 290, 287), 0xff_ffff);
}

/// Control Panel's Color takes clicks on its sample, choosing the element
/// clicked, and on its colours' boxes, which it draws over statics: a
/// static answers `WM_NCHITTEST` with `HTTRANSPARENT` (`USER.EXE` seg25
/// `24f2`), and winbox.js's took the clicks itself. It holds the mouse
/// while a press on its sample lasts and lets it go with `SetCapture(0)`,
/// which USER takes as `ReleaseCapture` (seg1 `a8d4`, `289e`); winbox.js
/// kept the mouse its dialog's, and Define Custom Colors took no click.
/// The title text made red, a custom colour added, and the box closed,
/// `WIN.INI` and `CONTROL.INI` have them.
#[test]
fn control_panels_color_takes_clicks_and_writes_its_colours() {
    let Some(mut session) = started("CONTROL.EXE") else {
        return;
    };

    click(&mut session, 33, 66, true);
    frames(&mut session, 60);
    click_control(&mut session, "Color", 714);
    frames(&mut session, 30);
    // The sample's active caption's text, then the basic colours' red.
    click(&mut session, 120, 169, false);
    click(&mut session, 290, 143, false);
    assert!(
        (110..160).any(|x| (163..176).any(|y| colour_at(&session, x, y) == 0xff_0000)),
        "the title's text red"
    );
    click_control(&mut session, "Color", 719);
    frames(&mut session, 100);
    assert!(shown(&session, "Custom Color Selector").is_some());
    // Add Color, then Close.
    click(&mut session, 43, 335, false);
    click(&mut session, 138, 336, false);
    assert!(shown(&session, "Custom Color Selector").is_none());
    click_control(&mut session, "Color", 1);
    frames(&mut session, 100);
    assert!(shown(&session, "Color").is_none());
    assert_eq!(
        ini_value(&session, "WINDOWS\\WIN.INI", "colors", "TitleText").as_deref(),
        Some("255 0 0")
    );
    assert_eq!(
        ini_value(&session, "WINDOWS\\CONTROL.INI", "Custom Colors", "ColorA").as_deref(),
        Some("FF")
    );
}

/// The identifier of the control with the focus.
fn focus_id(session: &Session) -> u16 {
    let system = session.system();

    system
        .focus
        .and_then(|focus| system.windows[focus].as_ref())
        .map_or(0, |window| window.control_id)
}

/// The items of the list box with an identifier in the window shown with a
/// title.
fn items_of(session: &Session, title: &str, id: u16) -> Vec<String> {
    let at = control(session, title, id);
    let system = session.system();

    system.windows[at]
        .as_ref()
        .and_then(|window| window.control.as_ref())
        .map(|control| control.items.clone())
        .unwrap_or_default()
}

/// Control Panel's Fonts, a font chosen in its list: it asks the list for
/// the items selected with `LB_GETSELITEMS` (`USER.EXE` seg35 `039b`,
/// `2008`), which answered nought and wrote nothing, so it showed its first
/// font's sample whatever was chosen. VER.DLL asks KERNEL's `IsRomModule`
/// of the font's file, which answers nought (`KRNL386.EXE` seg2 `1e9b`);
/// as a stub it left AX as it was, VER.DLL took that for a selector, and
/// Control Panel faulted. (What it then says of the font hangs on GDI's
/// `AddFontResource`, a stub in both engines: not held to here.)
#[test]
fn control_panels_fonts_shows_the_font_chosen() {
    let Some(mut session) = started("CONTROL.EXE") else {
        return;
    };

    click(&mut session, 91, 66, true);
    frames(&mut session, 100);
    assert!(shown(&session, "Fonts").is_some());
    // Courier 10,12,15 (VGA res), the fifth.
    click(&mut session, 100, 143, false);
    frames(&mut session, 60);
    assert!(shown(&session, "Fonts").is_some());
    assert_eq!(
        text_of(&session, "Fonts", 408),
        "The size of the font on the disk is:  23 KB."
    );
}

/// Control Panel's Fonts' Add Fonts, COMMDLG's Open box with a hook: the
/// list of fonts is filled while the box is idle, as Fonts is told so by
/// `WM_ENTERIDLE`, which a dialog's loop sends its owner when it finds
/// nothing to take (`USER.EXE` seg25 `085b`-`0892`); none was sent, and
/// the list stayed empty. A TrueType font is named from its file's `name`
/// table, made ANSI by GDI's `UnicodeToAnsi` (`GDI.EXE` seg1 `56a3`), a
/// stub, and none was offered.
#[test]
fn control_panels_add_fonts_lists_the_fonts_of_a_directory() {
    let Some(mut session) = started("CONTROL.EXE") else {
        return;
    };

    click(&mut session, 91, 66, true);
    frames(&mut session, 100);
    click_control(&mut session, "Fonts", 403);
    frames(&mut session, 150);
    assert!(shown(&session, "Add Fonts").is_some());
    // The directories' list: c:\, windows, system.
    click(&mut session, 150, 321, true);
    frames(&mut session, 400);

    let fonts = items_of(&session, "Add Fonts", 1280);

    for font in [
        "Arial (TrueType)",
        "Courier New (TrueType)",
        "Courier 10,12,15 (VGA res)",
    ] {
        assert!(fonts.iter().any(|item| item == font), "{font} in {fonts:?}");
    }
}

/// Control Panel's Ports' Settings, its fields gone through with Tab: its
/// first, the baud rate, is a drop-down combo box, whose edit control has
/// the focus. Tab moves on from the dialog's own control the focus is in,
/// the combo box (`USER.EXE` seg25 `0f8c`); from the edit control, which
/// is not the dialog's, it went back to the first control, and the focus
/// never left the baud rate. The settings chosen are `WIN.INI`'s.
#[test]
fn control_panels_ports_settings_take_tab_and_are_written() {
    let Some(mut session) = started("CONTROL.EXE") else {
        return;
    };

    click(&mut session, 149, 66, true);
    frames(&mut session, 100);
    click_control(&mut session, "Ports", 828);
    frames(&mut session, 60);
    assert!(shown(&session, "Settings for COM1:").is_some());
    type_text(&mut session, "2400");
    press(&mut session, None, "Tab", "Tab");
    assert_eq!(focus_id(&session), 801, "the data bits have the focus");
    press(&mut session, None, "ArrowUp", "ArrowUp");
    press(&mut session, None, "Tab", "Tab");
    press(&mut session, None, "ArrowDown", "ArrowDown");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 60);
    assert!(shown(&session, "Settings for COM1:").is_none());
    assert_eq!(
        ini_value(&session, "WINDOWS\\WIN.INI", "ports", "COM1:").as_deref(),
        Some("2400,m,7,1,x")
    );
}

/// Control Panel's Mouse: the hourglass Control Panel puts up as it opens
/// the applet goes as the mouse moves over the dialog, whose class's cursor
/// is the arrow, as `GetClassInfo` answers for USER's classes (`classinf`)
/// and `DefWindowProc`'s `WM_SETCURSOR` shows (`USER.EXE` seg1 `590a`);
/// USER's classes had no cursor, and the hourglass stayed. Its buttons
/// swapped and the double click made slower, `WIN.INI` has them.
#[test]
fn control_panels_mouse_shows_the_arrow_and_writes_its_settings() {
    let Some(mut session) = started("CONTROL.EXE") else {
        return;
    };

    click(&mut session, 207, 66, true);
    frames(&mut session, 100);
    assert!(shown(&session, "Mouse").is_some());
    click(&mut session, 250, 150, false);

    let arrow = winbox_win16::icons::standard_cursor_handle(&mut session.system(), 32512);

    assert_eq!(
        session.system().cursor,
        Some(arrow),
        "the arrow over the dialog"
    );
    click_control(&mut session, "Mouse", 500);
    assert!(checked(&session, "Mouse", 500));
    // The double click's scroll bar's left arrow, twice.
    click(&mut session, 39, 175, false);
    click(&mut session, 39, 175, false);
    click_control(&mut session, "Mouse", 1);
    frames(&mut session, 60);
    assert!(shown(&session, "Mouse").is_none());
    assert_eq!(
        ini_value(&session, "WINDOWS\\WIN.INI", "windows", "SwapMouseButtons").as_deref(),
        Some("yes")
    );
    assert!(
        ini_value(&session, "WINDOWS\\WIN.INI", "windows", "DoubleClickSpeed")
            .is_some_and(|speed| speed.parse::<u32>().is_ok_and(|speed| speed > 452))
    );
}

/// Control Panel's Desktop. Its wallpaper's drop-down combo box lies under
/// the Wallpaper group box, made before it; neither clips its siblings, so
/// the combo box's edit control draws there, clipped by its parent's
/// visible region alone, which takes in the group box over it (`groupbox`
/// for a dialog's own controls); it drew nothing. Its spin buttons find
/// where they were pressed with `GetMessagePos`, which the dialog's loop
/// notes as it takes each message with USER's own `PeekMessage` (`USER.EXE`
/// seg25 `07c7`, seg1 `a76c`); it answered the place of the last message a
/// program took, and the icons' spacing stayed as it was.
#[test]
fn control_panels_desktop_shows_its_wallpaper_and_spins_its_spacing() {
    let Some(mut session) = started("CONTROL.EXE") else {
        return;
    };

    click(&mut session, 265, 66, true);
    frames(&mut session, 100);
    assert!(shown(&session, "Desktop").is_some());
    // "(None)" in the wallpaper's field, its ink black.
    assert!(
        (80..120).any(|x| (262..278).any(|y| colour_at(&session, x, y) == 0)),
        "the wallpaper's field shows"
    );
    assert_eq!(text_of(&session, "Desktop", 116), "75");
    // The spacing's spin button's upper half.
    click(&mut session, 307, 263, false);
    assert_eq!(text_of(&session, "Desktop", 116), "76");
}

/// Clock double-clicked loses its title: it takes its menu away with
/// `SetWindowWord(GWW_ID, 0)`, for a window at the top keeps its menu in
/// the word a child keeps its identifier in (`USER.EXE` seg2 `0c31`, seg9
/// `000c`). winbox.js set an identifier no window had, and Clock kept its
/// menu bar. (Its caption, taken out of its style and its frame drawn
/// again with `SWP_DRAWFRAME`, is still drawn: not yet done.)
#[test]
fn clock_double_clicked_loses_its_menu() {
    let Some(mut session) = started("CLOCK.EXE") else {
        return;
    };
    let clock = shown(&session, "Clock").expect("Clock");

    assert!(
        session.system().windows[clock]
            .as_ref()
            .unwrap()
            .bar
            .is_some()
    );
    click(&mut session, 100, 120, true);
    frames(&mut session, 60);

    let system = session.system();
    let window = system.windows[clock].as_ref().unwrap();

    assert!(window.bar.is_none(), "Clock's menu bar is gone");
    assert_eq!(window.menu, 0);
}

/// Recorder, told to record, minimizes itself with `SW_MINIMIZE`, and what
/// is typed after goes to the window made active in its place: USER takes
/// the focus from a window it minimizes (`USER.EXE` seg6 `1bfa`) and, for
/// `SW_MINIMIZE`, activates the window active before (`1d96`; `minact`).
/// winbox.js left Recorder's icon active, and the keys went nowhere.
#[test]
fn recorder_recording_leaves_the_window_beneath_active() {
    let Some(mut session) = started("NOTEPAD.EXE") else {
        return;
    };

    start(&mut session, "RECORDER.EXE");
    menu(&mut session, 'm', 'c');
    frames(&mut session, 60);
    type_text(&mut session, "Typing");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 100);

    let recorder = shown(&session, "Recorder - (Untitled)").expect("Recorder");

    assert_eq!(
        session.system().windows[recorder]
            .as_ref()
            .unwrap()
            .placement,
        winbox_win16::windows::Placement::Minimized
    );
    type_text(&mut session, "abc");
    frames(&mut session, 50);
    assert_eq!(text_of(&session, "Notepad - (Untitled)", 15), "abc");
}

/// Recorder records what is typed into Notepad with its journal record
/// hook, and plays it back with its playback hook when its shortcut key is
/// pressed in Notepad: USER hands the record hook each key as it is taken
/// and asks the playback hook for each as Notepad looks for input
/// (`system-queue.md`; `jrnlrec`, `jrnlplay`). Recorder's keyboard hook
/// sees the shortcut (`inhook`). Before, the journal hooks were kept and
/// never called, and Recorder recorded nothing. Recorder plays a macro back
/// only to the program it was recorded in, which it finds by the path of
/// the active window's instance, asked from its own task.
#[test]
fn recorder_records_typing_and_plays_it_back() {
    let Some(mut session) = started("NOTEPAD.EXE") else {
        return;
    };

    start(&mut session, "RECORDER.EXE");
    menu(&mut session, 'm', 'c');
    frames(&mut session, 60);

    // The macro's name, and Control and Q its shortcut.
    type_text(&mut session, "Typing");
    press(&mut session, None, "Tab", "Tab");
    type_text(&mut session, "q");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 100);
    type_text(&mut session, "abc");
    frames(&mut session, 50);

    // Recorder's icon pressed: recording suspended, and the macro saved.
    let recorder = shown(&session, "Recorder - (Untitled)").expect("Recorder");
    let (x, y) = {
        let system = session.system();
        let window = system.windows[recorder].as_ref().unwrap();

        (window.left + 18, window.top + 18)
    };

    click(&mut session, x as i16, y as i16, false);
    frames(&mut session, 100);
    assert!(shown(&session, "Recorder").is_some(), "the suspended box");
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 100);
    assert_eq!(text_of(&session, "Notepad - (Untitled)", 15), "abc");

    chord(&mut session, "Control", 'q');
    frames(&mut session, 300);
    assert_eq!(text_of(&session, "Notepad - (Untitled)", 15), "abcabc");
}

/// A session told in a script, a command a line, for following a program
/// by eye: `SWEEP_SCRIPT` names the script, and the pictures and listings
/// go in `SWEEP_OUT`. Commands: `start P`, `click X Y`, `dbl X Y`,
/// `drag X Y X Y`, `type TEXT`, `key CODE [Control|Shift|Alt]`,
/// `chord Alt|Control C`, `menu M I`, `frames N`, `shot NAME`, `list`,
/// `tree`, `file PATH`.
#[test]
#[ignore = "a session followed by eye"]
// One command a branch, each a line or two.
#[allow(clippy::too_many_lines)]
fn explore() {
    let Ok(script) = std::env::var("SWEEP_SCRIPT") else {
        return;
    };
    let out = PathBuf::from(std::env::var("SWEEP_OUT").unwrap_or_else(|_| ".".into()));
    let script = std::fs::read_to_string(script).unwrap();
    let mut session: Option<Session> = None;

    for line in script.lines() {
        let line = line.trim();

        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let (command, rest) = line.split_once(' ').unwrap_or((line, ""));
        let numbers: Vec<i16> = rest
            .split_whitespace()
            .filter_map(|word| word.parse().ok())
            .collect();

        if command == "epoch" {
            EPOCH.with(|epoch| epoch.set(rest.trim().parse().unwrap()));
            continue;
        }

        if command == "sound" {
            session = started_as(rest, true);
            continue;
        }

        if command == "start" {
            match session.as_mut() {
                Some(session) => start(session, rest),
                None => session = started(rest),
            }
            continue;
        }

        let session = session.as_mut().unwrap();

        match command {
            "click" => click(session, numbers[0], numbers[1], false),
            "dbl" => click(session, numbers[0], numbers[1], true),
            "drag" => drag(session, (numbers[0], numbers[1]), (numbers[2], numbers[3])),
            "type" => type_text(session, rest),
            "key" => {
                let mut words = rest.split_whitespace();
                let code = words.next().unwrap();
                let held = words.next();

                press(session, held, code, code);
            }
            "chord" => {
                let mut words = rest.split_whitespace();
                let held = words.next().unwrap();
                let letter = words.next().unwrap().chars().next().unwrap();

                chord(session, held, letter);
            }
            "menu" => {
                let mut words = rest.chars().filter(|c| !c.is_whitespace());

                menu(session, words.next().unwrap(), words.next().unwrap());
            }
            "frames" => frames(session, usize::try_from(numbers[0]).unwrap()),
            "shot" => {
                let path = out.join(format!("{rest}.ppm"));

                std::fs::write(&path, picture(session)).unwrap();
                println!("shot {}", path.display());
            }
            "list" => println!("{}", listing(session)),
            "calls" => CALLS.with(|kept| *kept.borrow_mut() = Some(String::new())),
            "endcalls" => CALLS.with(|kept| {
                let calls = kept.borrow_mut().take().unwrap_or_default();
                let path = out.join(format!("{rest}.calls"));

                std::fs::write(&path, calls).unwrap();
                println!("calls {}", path.display());
            }),
            "changes" => {
                for change in session.changes('C') {
                    match change {
                        Change::File { path, data, .. } => println!("file {path} {}", data.len()),
                        Change::Folder { path, .. } => println!("folder {path}"),
                        Change::Removed { path } => println!("removed {path}"),
                    }
                }
            }
            "mem" => {
                let words: Vec<u32> = rest
                    .split_whitespace()
                    .map(|word| u32::from_str_radix(word, 16).unwrap())
                    .collect();
                let bytes = session
                    .system()
                    .read_far((words[0] << 16) | words[1], words[2] as usize);
                let path = out.join(format!("{:x}_{:x}.bin", words[0], words[1]));

                std::fs::write(&path, bytes).unwrap();
                println!("mem {}", path.display());
            }
            "burst" => {
                for code in rest.split_whitespace() {
                    session.key(true, &key(code, code, false));
                    session.key(false, &key(code, code, false));
                }

                frames(session, 60);
            }
            "dump" => {
                let system = session.system();
                let at: usize = rest.trim().parse().unwrap();

                if let Some(window) = system.windows[at].as_ref() {
                    println!(
                        "dump {at} clip={:?} client={:?} paint={} erase={} border={:?} edit={:?} combo={:?}",
                        window.clip_rect,
                        window.client,
                        window.needs_paint,
                        window.needs_erase,
                        window.control.as_ref().map(|control| control.border),
                        window
                            .control
                            .as_ref()
                            .and_then(|control| control.edit.as_ref()),
                        window
                            .control
                            .as_ref()
                            .and_then(|control| control.combo.as_ref()),
                    );
                }
            }
            "focus" => {
                let system = session.system();
                let focus = system.focus;
                let described = focus
                    .and_then(|at| system.windows[at].as_ref())
                    .map(|window| (window.class.clone(), window.control_id, window.parent));

                println!("focus {focus:?} {described:?}");
            }
            "segs" => {
                let system = session.system();

                for module in &system.modules {
                    let selectors: Vec<String> = module
                        .segments
                        .iter()
                        .enumerate()
                        .map(|(at, index)| format!("{}={:x}", at + 1, (index << 3) | 7))
                        .collect();

                    println!("{} {}", module.name, selectors.join(" "));
                }
            }
            "tree" => println!("{}", session.accessible_tree()),
            "file" => match written(session, rest) {
                Some(bytes) => println!("{rest}:\n{}", String::from_utf8_lossy(&bytes)),
                None => println!("{rest}: not written"),
            },
            _ => panic!("no command {command}"),
        }
    }
}
