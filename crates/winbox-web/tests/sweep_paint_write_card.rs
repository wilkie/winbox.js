//! A second sweep through three of Windows 3.1's accessories, used as a
//! person at the page uses them: Paintbrush's dialogs and tools, Write's
//! formatting, finding and files, Cardfile's cards, views and merging. Each
//! session is held to what shows -- the windows' texts, the focus, the
//! cursor, the screen -- and to the files written. Where one once failed,
//! it says why.
//!
//! The host's time is the test's own, as in `moves.rs`.

use std::cell::Cell;
use std::path::{Path, PathBuf};

use winbox_machine::Change;
use winbox_web::session::{Made, Session, State, pointer_of};
use winbox_win16::key_input::Key;

thread_local! {
    /// The host's time, in milliseconds.
    static NOW: Cell<f64> = const { Cell::new(0.0) };
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

/// A fresh machine, Windows staying up, the installation on C:, and the
/// program named in `C:\WINDOWS` started; none where the oracle's build is
/// not here.
fn started(program: &str) -> Option<Session> {
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
        epoch_ms: 0,
    })
    .unwrap();

    session.stay_up();
    hold(&mut session, &windows, "");
    session.mark_planned();
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

        session.take_calls(false);
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
    match character {
        'a'..='z' => (
            format!("Key{}", character.to_ascii_uppercase()),
            character.to_string(),
            false,
        ),
        'A'..='Z' => (format!("Key{character}"), character.to_string(), true),
        '0'..='9' => (format!("Digit{character}"), character.to_string(), false),
        ' ' => ("Space".into(), " ".into(), false),
        '.' => ("Period".into(), ".".into(), false),
        '-' => ("Minus".into(), "-".into(), false),
        '\\' => ("Backslash".into(), "\\".into(), false),
        ':' => ("Semicolon".into(), ":".into(), true),
        '\n' => ("Enter".into(), "Enter".into(), false),
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

/// A letter pressed with a modifier held, or alone.
fn chord(session: &mut Session, held: Option<&str>, letter: char) {
    let (code, name, _) = key_of(letter);

    press(session, held, &code, &name);
}

/// A menu's item chosen by its keys: Alt and the menu's letter, then the
/// item's.
fn menu(session: &mut Session, bar: char, item: char) {
    chord(session, Some("Alt"), bar);
    chord(session, None, item);
}

/// A button pressed and let go at a point of the screen, twice for a double
/// click, as the page gives it -- the left, or the right (2) -- and the run
/// let take it.
fn click_with(session: &mut Session, x: i16, y: i16, button: u8, double: bool) {
    let held = if button == 2 { 2 } else { 1 };

    session.pointer(pointer_of(0, x, y, 0, 0, false));

    for time in 0..if double { 2 } else { 1 } {
        session.pointer(pointer_of(1, x, y, button, held, time == 1));
        session.pointer(pointer_of(2, x, y, button, 0, false));
    }

    frames(session, 60);
}

fn click(session: &mut Session, x: i16, y: i16) {
    click_with(session, x, y, 0, false);
}

/// The mouse moved to a point, no button held.
fn hover(session: &mut Session, x: i16, y: i16) {
    session.pointer(pointer_of(0, x, y, 0, 0, false));
    frames(session, 20);
}

/// The left button pressed at one point, the mouse moved with it held to
/// another in eight steps, and let go there.
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

/// Whether a window is shown whose text has `part` in it: a message box's
/// static, say.
fn says(session: &Session, part: &str) -> bool {
    let system = session.system();

    system.windows.iter().flatten().any(|window| {
        window.visible
            && (window.title.contains(part)
                || window
                    .control
                    .as_ref()
                    .is_some_and(|control| control.text.contains(part)))
    })
}

/// The text of the control with an identifier in the window shown with a
/// title: an edit control's, a static's or a button's.
fn text_of(session: &Session, title: &str, id: u16) -> String {
    let parent = shown(session, title).unwrap_or_else(|| panic!("no window {title}"));
    let system = session.system();
    let window = system
        .windows
        .iter()
        .flatten()
        .find(|window| window.parent == Some(parent) && window.control_id == id)
        .unwrap_or_else(|| panic!("no control {id:x} in {title}"));

    window
        .control
        .as_ref()
        .map_or_else(|| window.title.clone(), |control| control.text.clone())
}

/// The title of the active window.
fn active_title(session: &Session) -> String {
    let system = session.system();

    system
        .windows
        .iter()
        .flatten()
        .find(|window| window.active)
        .map(|window| window.title.clone())
        .unwrap_or_default()
}

/// The identifier of the control the focus is in -- for a combo box's
/// edit control, of the combo box.
fn focus_owner(session: &Session) -> u16 {
    let system = session.system();
    let Some(focus) = system
        .focus
        .and_then(|focus| system.windows[focus].as_ref())
    else {
        return 0;
    };

    match focus
        .parent
        .and_then(|parent| system.windows[parent].as_ref())
    {
        Some(parent) if parent.class.eq_ignore_ascii_case("combobox") => parent.control_id,
        _ => focus.control_id,
    }
}

/// Whether the cursor is the standard one with a number.
fn cursor_is(session: &Session, id: u16) -> bool {
    let mut system = session.system();
    let standard = winbox_win16::icons::standard_cursor_handle(&mut system, id);

    system.cursor == Some(standard)
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

/// The screen's colour at a point, a `0x00RRGGBB` word.
fn colour_at(session: &Session, x: usize, y: usize) -> u32 {
    let screen = session.shown();

    screen.colours[usize::from(screen.indices[y * 640 + x])]
}

/// The screen's colours inside a box.
fn colours(session: &Session, left: usize, top: usize, right: usize, bottom: usize) -> Vec<u32> {
    let screen = session.shown();

    (top..bottom)
        .flat_map(|y| (left..right).map(move |x| y * 640 + x))
        .map(|at| screen.colours[usize::from(screen.indices[at])])
        .collect()
}

/// The longest run of one colour along a row of the screen, between two
/// columns.
fn longest_run(session: &Session, y: usize, left: usize, right: usize, colour: u32) -> usize {
    let mut longest = 0;
    let mut run = 0;

    for x in left..right {
        if colour_at(session, x, y) == colour {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }

    longest
}

const RED: u32 = 0x00ff_0000;
const GREEN: u32 = 0x0000_ff00;
const BLUE: u32 = 0x0000_00ff;
const YELLOW: u32 = 0x00ff_ff00;
const WHITE: u32 = 0x00ff_ffff;

/// Paintbrush's palette, a colour's well on the screen: the upper row.
const PALETTE_RED: (i16, i16) = (220, 372);
const PALETTE_YELLOW: (i16, i16) = (253, 372);
const PALETTE_GREEN: (i16, i16) = (286, 372);
const PALETTE_BLUE: (i16, i16) = (352, 372);

/// Paintbrush's tools, each in its box of the toolbox.
const PICK: (i16, i16) = (49, 59);
const TEXT: (i16, i16) = (49, 90);
const COLOUR_ERASER: (i16, i16) = (19, 120);
const ERASER: (i16, i16) = (49, 120);
const LINE: (i16, i16) = (49, 183);
const FILLED_BOX: (i16, i16) = (49, 214);

/// A filled box drawn in Paintbrush in a colour of the palette.
fn filled_box(session: &mut Session, colour: (i16, i16), from: (i16, i16), to: (i16, i16)) {
    click(session, colour.0, colour.1);
    click(session, FILLED_BOX.0, FILLED_BOX.1);
    drag(session, from, to);
}

/// Saved as `path` through a common Save As box opened by its menu's keys.
fn save_as(session: &mut Session, path: &str) {
    menu(session, 'f', 'a');
    frames(session, 60);
    assert!(shown(session, "Save As").is_some(), "no Save As box");
    type_text(session, path);
    press(session, None, "Enter", "Enter");
    frames(session, 100);
}

/// Paintbrush's Font box takes Tab from its combo boxes' fields and reads
/// its size. Tab in a combo box's edit control went nowhere: the dialog
/// manager looked for the control after the edit control among the
/// dialog's own, where it is not; USER takes the window with the focus to
/// the dialog's control it is in first, the combo box (`USER.EXE` seg19
/// `0a02`, seg25 `0f8c`), and so Arial's size, typed after two Tabs, went
/// into the font's name. And the size, read with `GetDlgItemInt` from the
/// combo box, was the combo box's own text, empty: "Size must be a
/// number." `GetDlgItemInt` asks for the text with `WM_GETTEXT`, which a
/// combo box answers with its edit control's (seg25 `0233`).
#[test]
fn paintbrush_font_box_tabs_to_its_size_and_reads_it() {
    let Some(mut session) = started("PBRUSH.EXE") else {
        return;
    };

    menu(&mut session, 't', 'f');
    assert!(shown(&session, "Font").is_some(), "no Font box");
    assert_eq!(focus_owner(&session), 0x470);
    type_text(&mut session, "Arial");
    press(&mut session, None, "Tab", "Tab");
    assert_eq!(focus_owner(&session), 0x471, "Tab left the font's name");
    press(&mut session, None, "Tab", "Tab");
    assert_eq!(focus_owner(&session), 0x472);
    type_text(&mut session, "24");
    assert_eq!(text_of(&session, "Font", 0x470), "");
    press(&mut session, None, "Enter", "Enter");
    assert!(!says(&session, "Size must be a number"));
    assert!(shown(&session, "Font").is_none(), "the Font box stays");
}

/// Over a dialog's controls the cursor is USER's arrow, and an edit
/// control's I-beam: `DefWindowProc` shows the cursor of the control's
/// class, and USER registers its own classes with them (`USER.EXE` seg3
/// `162f`, `16f1`). They had none, and the hourglass Paintbrush shows as it
/// opens a dialog stayed over it.
#[test]
fn paintbrush_dialogs_show_the_arrow_and_the_i_beam() {
    let Some(mut session) = started("PBRUSH.EXE") else {
        return;
    };

    menu(&mut session, 'o', 'i');
    assert!(shown(&session, "Image Attributes").is_some());
    hover(&mut session, 426, 171);
    assert!(cursor_is(&session, 32512), "no arrow over OK");
    hover(&mut session, 250, 197);
    assert!(cursor_is(&session, 32513), "no I-beam over Width");
    press(&mut session, None, "Escape", "Escape");
}

/// Paintbrush grays Paste until its Edit menu is about to show, and enables
/// it then, where the clipboard has a picture. Control and V right after
/// Control and C pasted nothing: `TranslateAccelerator` tells the window of
/// a command its menu has as a menu about to be used is told --
/// `WM_INITMENU`, and `WM_INITMENUPOPUP` for the pop-up it is under -- and
/// only then looks whether the item is grayed (`USER.EXE` seg19 `06d2`;
/// `accinit`).
#[test]
fn paintbrush_pastes_with_control_v_after_copying() {
    let Some(mut session) = started("PBRUSH.EXE") else {
        return;
    };

    filled_box(&mut session, PALETTE_RED, (400, 250), (460, 300));
    click(&mut session, PICK.0, PICK.1);
    drag(&mut session, (395, 245), (465, 305));
    chord(&mut session, Some("Control"), 'c');
    assert!(
        colours(&session, 80, 60, 100, 80)
            .iter()
            .all(|&c| c == WHITE)
    );
    chord(&mut session, Some("Control"), 'v');

    // Pasted at the top left of the picture.
    let pasted = colours(&session, 80, 60, 100, 80);

    assert!(pasted.iter().all(|&c| c == RED), "{pasted:x?}");
}

/// A picture of 640 by 442 at 16 colours is 141,440 bytes, which
/// Paintbrush writes in pieces of 61,440 through one far pointer moved on,
/// the second running past its segment's first 64 KiB. `_lwrite` took the
/// bytes past offset `FFFFh` from the segment's start, and the middle of the
/// picture was saved as its bottom. DOS's write goes on through the block
/// (`KRNL386.EXE` seg1 `0c42`; `lwrhuge`).
#[test]
fn paintbrush_saves_its_whole_picture() {
    let Some(mut session) = started("PBRUSH.EXE") else {
        return;
    };

    filled_box(&mut session, PALETTE_RED, (300, 250), (400, 320));
    save_as(&mut session, "c:\\whole.bmp");

    let saved = written(&session, "WHOLE.BMP").expect("no WHOLE.BMP");
    let word = |at: usize| u32::from_le_bytes(saved[at..at + 4].try_into().unwrap());
    let (offset, width, height) = (word(10) as usize, word(18) as usize, word(22) as usize);

    assert_eq!((width, height, saved.len()), (640, 442, 141_558));

    // The box's middle, (350, 285) on the screen, is (283, 240) in the
    // picture, and its row is counted from the bottom.
    let (x, y) = (283, 240);
    let byte = saved[offset + (height - 1 - y) * 320 + x / 2];
    let index = usize::from(if x % 2 == 0 { byte >> 4 } else { byte & 15 });
    let colour = &saved[54 + index * 4..54 + index * 4 + 3];

    assert_eq!(colour, [0, 0, 255], "the box's middle is not red");
}

/// Text's underline is drawn in the text colour (`ulcolour`): Paintbrush
/// draws its text white on black in a monochrome bitmap, and the black
/// underline winbox.js drew there did not show.
#[test]
fn paintbrush_underlines_its_text() {
    let Some(mut session) = started("PBRUSH.EXE") else {
        return;
    };

    click(&mut session, PALETTE_BLUE.0, PALETTE_BLUE.1);
    click(&mut session, TEXT.0, TEXT.1);
    click(&mut session, 120, 80);
    menu(&mut session, 't', 'u');
    type_text(&mut session, "Hi there");

    let longest = (75..110)
        .map(|y| longest_run(&session, y, 110, 240, BLUE))
        .max()
        .unwrap_or(0);

    assert!(
        longest >= 40,
        "no underline: the longest blue run is {longest}"
    );
}

/// Paintbrush's other dialogs open and close, and its tools draw: the
/// eraser takes the background colour, the colour eraser the foreground's
/// pixels to the background's, the zoom shows a part large and comes back,
/// and Save As's Info tells the picture's size.
#[test]
fn paintbrush_dialogs_and_tools() {
    let Some(mut session) = started("PBRUSH.EXE") else {
        return;
    };

    for (bar, item, title) in [
        ('o', 'b', "Brush Shapes"),
        ('o', 'e', "Edit Colors"),
        ('f', 't', "Page Setup"),
        ('o', 'i', "Image Attributes"),
    ] {
        menu(&mut session, bar, item);
        assert!(shown(&session, title).is_some(), "no {title}");
        press(&mut session, None, "Escape", "Escape");
        assert!(shown(&session, title).is_none(), "{title} stays");
    }

    // The eraser, the background yellow.
    filled_box(&mut session, PALETTE_RED, (100, 70), (250, 200));
    click_with(&mut session, PALETTE_YELLOW.0, PALETTE_YELLOW.1, 2, false);
    click(&mut session, ERASER.0, ERASER.1);
    drag(&mut session, (120, 100), (230, 100));
    assert_eq!(colour_at(&session, 175, 100), YELLOW);

    // The colour eraser: red to the background, green.
    click(&mut session, PALETTE_RED.0, PALETTE_RED.1);
    click_with(&mut session, PALETTE_GREEN.0, PALETTE_GREEN.1, 2, false);
    click(&mut session, COLOUR_ERASER.0, COLOUR_ERASER.1);
    drag(&mut session, (120, 150), (230, 150));
    assert_eq!(colour_at(&session, 175, 150), GREEN);
    assert_eq!(colour_at(&session, 175, 180), RED);

    // A line, and the zoom on the box.
    click(&mut session, PALETTE_BLUE.0, PALETTE_BLUE.1);
    click(&mut session, LINE.0, LINE.1);
    drag(&mut session, (80, 220), (400, 220));
    assert_eq!(colour_at(&session, 300, 220), BLUE);
    menu(&mut session, 'v', 'i');
    click(&mut session, 175, 180);

    // The box's lower part, a cell a pixel with the grid between.
    let zoomed = colours(&session, 250, 60, 550, 170);
    let red = zoomed.iter().filter(|&&c| c == RED).count();

    assert!(red * 2 > zoomed.len(), "not zoomed into the box");
    menu(&mut session, 'v', 'o');
    assert_eq!(colour_at(&session, 175, 180), RED);
    assert_eq!(colour_at(&session, 300, 220), BLUE);

    // Save As's Info.
    menu(&mut session, 'f', 'a');
    chord(&mut session, Some("Alt"), 'i');
    assert!(shown(&session, "Picture Information").is_some());
    assert!(says(&session, "640"));
    press(&mut session, None, "Escape", "Escape");
    press(&mut session, None, "Escape", "Escape");
    assert_eq!(active_title(&session), "Paintbrush - (Untitled)");
}

/// Write's text selected by dragging across it: Write follows the mouse
/// while `GetKeyState` says the left button is down. USER moves a button's
/// state in the key-state table with its message as it is taken, as a
/// key's (`USER.EXE` seg1 `4ecc`); winbox.js moved only the keys', and the
/// drag selected nothing.
#[test]
fn write_selects_by_dragging() {
    let Some(mut session) = started("WRITE.EXE") else {
        return;
    };

    type_text(&mut session, "Hello world this is Write.\nSecond line.");
    drag(&mut session, (30, 56), (30, 72));
    type_text(&mut session, "X");
    save_as(&mut session, "c:\\drag.wri");

    let saved = written(&session, "DRAG.WRI").expect("no DRAG.WRI");

    assert!(saved.windows(7).any(|text| text == b"XSecond"));
    assert!(!saved.windows(5).any(|text| text == b"Hello"));
}

/// Write's menus' dialogs, its header, ruler, finding and replacing, and a
/// document saved and opened again.
#[test]
fn write_formats_finds_and_saves() {
    let Some(mut session) = started("WRITE.EXE") else {
        return;
    };

    type_text(
        &mut session,
        "Hello world this is Write.\nSecond paragraph here.\nThird one.",
    );
    press(&mut session, Some("Control"), "Home", "Home");
    press(&mut session, Some("Shift"), "End", "End");
    chord(&mut session, Some("Control"), 'b');
    menu(&mut session, 'p', 'c');

    menu(&mut session, 'p', 'i');
    assert!(shown(&session, "Indents").is_some());
    press(&mut session, None, "Escape", "Escape");

    menu(&mut session, 'c', 'f');
    assert!(shown(&session, "Font").is_some());
    press(&mut session, None, "Escape", "Escape");

    // The header, its own document beside its dialog.
    menu(&mut session, 'd', 'h');
    assert_eq!(active_title(&session), "HEADER");
    assert!(shown(&session, "Page Header").is_some());
    type_text(&mut session, "Top");
    click(&mut session, 444, 268);
    assert_eq!(active_title(&session), "Write - (Untitled)");

    menu(&mut session, 'd', 'r');
    for (item, title) in [('t', "Tabs"), ('p', "Page Layout")] {
        menu(&mut session, 'd', item);
        assert!(shown(&session, title).is_some(), "no {title}");
        press(&mut session, None, "Escape", "Escape");
    }

    menu(&mut session, 'n', 'f');
    assert!(shown(&session, "Find").is_some());
    type_text(&mut session, "paragraph\n");
    press(&mut session, None, "Escape", "Escape");

    // From the top, the selection Find left let go.
    press(&mut session, Some("Control"), "Home", "Home");
    menu(&mut session, 'n', 'e');
    assert!(shown(&session, "Replace").is_some());
    type_text(&mut session, "here");
    press(&mut session, None, "Tab", "Tab");
    type_text(&mut session, "there");
    chord(&mut session, Some("Alt"), 'a');
    frames(&mut session, 60);
    press(&mut session, None, "Escape", "Escape");
    press(&mut session, None, "Escape", "Escape");

    press(&mut session, None, "F4", "F4");
    assert!(shown(&session, "Go To").is_some());
    press(&mut session, None, "Escape", "Escape");

    menu(&mut session, 'f', 'e');
    assert!(shown(&session, "Repaginate Document").is_some());
    press(&mut session, None, "Enter", "Enter");
    frames(&mut session, 100);

    save_as(&mut session, "c:\\walk.wri");

    let saved = written(&session, "WALK.WRI").expect("no WALK.WRI");

    assert_eq!(&saved[..2], &[0x31, 0xbe]);
    assert_eq!(saved.len() % 128, 0);
    assert!(
        saved
            .windows(23)
            .any(|text| text == b"Second paragraph there.")
    );
    assert!(saved.windows(3).any(|text| text == b"Top"));

    menu(&mut session, 'f', 'n');
    frames(&mut session, 60);
    assert_eq!(active_title(&session), "Write - (Untitled)");
    menu(&mut session, 'f', 'o');
    type_text(&mut session, "c:\\walk.wri\n");
    frames(&mut session, 100);
    assert_eq!(active_title(&session), "Write - WALK.WRI");
}

/// Cards added with the Index box and F7, for Cardfile's sessions.
fn add_cards(session: &mut Session, cards: &[(&str, &str)]) {
    for (at, (index, body)) in cards.iter().enumerate() {
        press(session, None, if at == 0 { "F6" } else { "F7" }, "F");
        type_text(session, index);
        press(session, None, "Enter", "Enter");
        type_text(session, body);
    }
}

/// The count Cardfile shows under its menu.
fn count(session: &Session) -> String {
    let title = active_title(session);

    text_of(session, &title, 0xca)
}

/// Cardfile's File Merge took the file to merge as "Filename not valid":
/// Cardfile parses its name with `OpenFile`'s `OF_PARSE`, which fills the
/// structure and answers nought, opening nothing (`KRNL386.EXE` seg1
/// `53f1`); winbox.js opened the file and answered its handle.
#[test]
fn cardfile_merges_another_file() {
    let Some(mut session) = started("CARDFILE.EXE") else {
        return;
    };

    add_cards(
        &mut session,
        &[("Apple", "apple body"), ("Banana", "banana body")],
    );
    save_as(&mut session, "c:\\one.crd");
    menu(&mut session, 'f', 'n');
    frames(&mut session, 60);
    add_cards(&mut session, &[("Cherry", "cherry body")]);
    menu(&mut session, 'f', 'm');
    assert!(shown(&session, "File Merge").is_some());
    type_text(&mut session, "c:\\one.crd\n");
    frames(&mut session, 100);
    assert!(!says(&session, "Filename not valid"));
    assert_eq!(count(&session), "3  Cards");
    save_as(&mut session, "c:\\two.crd");

    let saved = written(&session, "TWO.CRD").expect("no TWO.CRD");

    assert_eq!(&saved[..3], b"MGC");
    assert_eq!(u16::from_le_bytes([saved[3], saved[4]]), 3);

    for text in [&b"Apple"[..], b"Banana", b"Cherry", b"banana body"] {
        assert!(saved.windows(text.len()).any(|at| at == text));
    }
}

/// Cardfile's cards duplicated, gone to, found, deleted, listed and
/// dialled; and a picture pasted onto a card from Paintbrush.
#[test]
fn cardfile_cards_views_and_a_picture() {
    let Some(mut session) = started("PBRUSH.EXE") else {
        return;
    };

    filled_box(&mut session, PALETTE_RED, (100, 70), (160, 120));
    click(&mut session, PICK.0, PICK.1);
    drag(&mut session, (95, 65), (170, 130));
    chord(&mut session, Some("Control"), 'c');

    start(&mut session, "CARDFILE.EXE");
    add_cards(
        &mut session,
        &[
            ("Apple", "apple body 555-1234"),
            ("Banana", "banana body"),
            ("Cherry", "cherry body"),
        ],
    );
    assert_eq!(count(&session), "3  Cards");
    menu(&mut session, 'c', 'p');
    assert_eq!(count(&session), "4  Cards");

    press(&mut session, None, "F4", "F4");
    assert!(shown(&session, "Go To").is_some());
    type_text(&mut session, "apple\n");
    press(&mut session, None, "F5", "F5");
    assert!(shown(&session, "Autodial").is_some());
    assert_eq!(text_of(&session, "Autodial", 0x132), "555-1234");
    press(&mut session, None, "Escape", "Escape");

    menu(&mut session, 's', 'f');
    assert!(shown(&session, "Find").is_some());
    type_text(&mut session, "banana\n");
    press(&mut session, None, "Escape", "Escape");
    menu(&mut session, 'c', 'd');
    assert!(says(&session, "Delete \"Banana\"?"));
    press(&mut session, None, "Enter", "Enter");
    assert_eq!(count(&session), "3  Cards");

    menu(&mut session, 'v', 'l');
    assert!(says(&session, "List View"));
    menu(&mut session, 'v', 'c');
    assert!(says(&session, "Card View"));

    // A card of its own for the picture.
    press(&mut session, None, "F7", "F7");
    type_text(&mut session, "Pic\n");
    menu(&mut session, 'e', 'e');
    menu(&mut session, 'e', 'p');
    frames(&mut session, 60);

    let title = active_title(&session);
    let card = shown(&session, &title).unwrap();
    let (left, top) = {
        let system = session.system();
        let window = system.windows[card].as_ref().unwrap();

        (window.left, window.top)
    };
    let picture = colours(
        &session,
        (left + 20) as usize,
        (top + 160) as usize,
        (left + 40) as usize,
        (top + 180) as usize,
    );

    assert!(picture.contains(&RED), "no picture on the card");
}

/// Cardfile's window at `CW_USEDEFAULT` with `CS_BYTEALIGNCLIENT`: at 4,
/// its client area at 8 (`USER.EXE` seg6 `022e`), and three pixels shorter
/// in its list view and after, as in Windows (`cardview`).
#[test]
fn cardfile_is_placed_and_keeps_its_views_heights() {
    let Some(mut session) = started("CARDFILE.EXE") else {
        return;
    };
    let place = |session: &Session| {
        let system = session.system();
        let window = system
            .windows
            .iter()
            .flatten()
            .find(|window| window.title.starts_with("Cardfile"))
            .expect("Cardfile's window");

        (window.left, window.top, window.width, window.height)
    };

    let card = place(&session);

    menu(&mut session, 'v', 'l');

    let list = place(&session);

    menu(&mut session, 'v', 'c');

    assert_eq!(
        [card, list, place(&session)],
        [(4, 0, 430, 323), (4, 0, 430, 320), (4, 0, 430, 320)]
    );
}
