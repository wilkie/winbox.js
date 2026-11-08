//! The launcher's list without its window: the rows, the keys and clicks
//! as the page's menu takes them, why an item cannot run, Program
//! Manager's question for a working directory that is not there, what an
//! item is started with, and an icon in the display's colours.

use super::*;
use crate::library::tests::{Scratch, installation, keep_pmitem, vga_icon};
use crate::programs::Base;

/// A library of `pmitem`'s group and a second install's group of the same
/// name, read as the launcher reads it.
fn model(scratch: &Scratch) -> (Model, Vec<String>, Vec<PathBuf>) {
    let store = Store::new(scratch.0.join("library"));
    let base = Base::of_folder(&installation(&scratch.0), "vga").unwrap();

    library::remember_base(&store, base.name(), &Source::Windows(base.folder.clone())).unwrap();
    keep_pmitem(&store, &base, "Pmitem", "PMItem");
    keep_pmitem(&store, &base, "Second", "Other");

    read(&store, scratch.0.join("cache"), None, false)
}

#[test]
fn the_rows_and_the_keys_as_the_pages_menu_takes_them() {
    let scratch = Scratch::new("launcher-keys");
    let (mut model, kept_modes, folders) = model(&scratch);

    assert_eq!(kept_modes, ["standard", "standard"]);
    assert_eq!(folders.len(), 2);
    assert_eq!(model.rows(), [Row::Group(0), Row::Group(1)]);
    assert_eq!(model.label(Row::Group(0)), "PMItem");
    assert_eq!(model.status(), None);

    // Down, Up, End and Home move among the groups.
    model.key(Key::Down);
    assert_eq!(model.row(), Some(Row::Group(1)));
    model.key(Key::Up);
    model.key(Key::Up);
    assert_eq!(model.row(), Some(Row::Group(0)));
    model.key(Key::End);
    assert_eq!(model.row(), Some(Row::Group(1)));
    model.key(Key::Home);

    // Right opens a group, its first item selected; Left goes back to the
    // group, open; Left again closes it.
    assert_eq!(model.key(Key::Right), Action::None);
    assert_eq!(model.row(), Some(Row::Item(0, 0)));
    assert_eq!(model.rows().len(), 2 + 9);
    model.key(Key::Left);
    assert_eq!(model.row(), Some(Row::Group(0)));
    assert!(model.open.contains(&0));
    model.key(Key::Left);
    assert_eq!(model.rows().len(), 2);

    // Enter opens it too; a letter moves to the next row beginning with it.
    model.key(Key::Enter);
    assert_eq!(model.row(), Some(Row::Item(0, 0)));
    model.key(Key::Letter('m'));
    assert_eq!(model.label(model.row().unwrap()), "Min");
    model.key(Key::Letter('M'));
    assert_eq!(model.label(model.row().unwrap()), "Missing");

    // A disabled item is reached and its reason told, but not run.
    assert_eq!(
        model.status().as_deref(),
        Some("Cannot run: needs NOSUCH.EXE, which is not in this Windows.")
    );
    assert!(!model.enabled(model.row().unwrap()));
    assert_eq!(model.key(Key::Enter), Action::None);

    // An item that can run is run, by Enter, Space or a click.
    model.key(Key::Home);
    model.key(Key::Down);
    assert_eq!(model.label(model.row().unwrap()), "Args");
    assert_eq!(
        model.key(Key::Enter),
        Action::Launch {
            group: 0,
            item: 0,
            anyway: false
        }
    );
    assert_eq!(
        model.key(Key::Space),
        Action::Launch {
            group: 0,
            item: 0,
            anyway: false
        }
    );
    assert_eq!(
        model.choose(Row::Item(0, 1)),
        Action::Launch {
            group: 0,
            item: 1,
            anyway: false
        }
    );

    // Escape on an item goes back to its group, closed; on a group it
    // closes the window.
    assert_eq!(model.key(Key::Escape), Action::None);
    assert_eq!(model.row(), Some(Row::Group(0)));
    assert_eq!(model.rows().len(), 2);
    assert_eq!(model.key(Key::Escape), Action::Close);

    // A click on a group opens it, and again closes it.
    model.choose(Row::Group(1));
    assert_eq!(model.rows().len(), 2 + 9);
    model.choose(Row::Group(1));
    assert_eq!(model.rows().len(), 2);
}

#[test]
fn a_working_directory_not_there_is_asked_about_cancel_first() {
    let scratch = Scratch::new("launcher-confirm");
    let (mut model, ..) = model(&scratch);

    model.open.insert(0);

    let bad = Row::Item(0, 7);

    assert_eq!(model.label(bad), "Bad");
    assert!(model.enabled(bad));
    assert_eq!(model.choose(bad), Action::None);
    assert_eq!(
        model.confirm,
        Some(Confirm {
            group: 0,
            item: 7,
            ok: false
        })
    );

    // Cancel, the default, starts nothing.
    assert_eq!(model.key(Key::Enter), Action::None);
    assert_eq!(model.confirm, None);

    // OK starts it, in the Windows directory.
    model.choose(bad);
    model.key(Key::Right);
    assert_eq!(
        model.key(Key::Enter),
        Action::Launch {
            group: 0,
            item: 7,
            anyway: true
        }
    );

    // Escape is Cancel.
    model.choose(bad);
    assert_eq!(model.key(Key::Escape), Action::None);
    assert_eq!(model.confirm, None);
}

#[test]
fn an_item_is_started_as_a_process_of_its_own() {
    let scratch = Scratch::new("launcher-arguments");
    let (model, ..) = model(&scratch);
    let settings = Settings {
        library: PathBuf::from("/library"),
        source: Some(Source::Assets(PathBuf::from("/assets.zip"))),
        seamless: true,
        sound: false,
    };
    let group = &model.groups[0];

    assert_eq!(
        launch_arguments(group, &group.items[7], "standard", true, &settings),
        [
            "--launch",
            "Pmitem",
            "Bad",
            "--group",
            "PMItem",
            "--library",
            "/library",
            "--assets",
            "/assets.zip",
            "--seamless",
            "--directory-anyway"
        ]
    );
    assert_eq!(
        launch_arguments(
            group,
            &group.items[0],
            "enhanced",
            false,
            &Settings {
                source: None,
                seamless: false,
                ..settings
            }
        ),
        [
            "--launch",
            "Pmitem",
            "Args",
            "--group",
            "PMItem",
            "--library",
            "/library",
            "--mode",
            "enhanced"
        ]
    );
}

#[test]
fn nothing_kept_says_how_to_keep_a_program() {
    let scratch = Scratch::new("launcher-empty");
    let store = Store::new(scratch.0.join("library"));
    let (mut model, kept_modes, folders) = read(&store, scratch.0.join("cache"), None, false);

    assert!(kept_modes.is_empty() && folders.is_empty());
    assert_eq!(model.rows(), []);
    assert_eq!(model.status().as_deref(), Some(library::EMPTY));
    assert_eq!(model.key(Key::Down), Action::None);
    assert_eq!(model.key(Key::Escape), Action::Close);
}

#[test]
fn an_icon_is_drawn_in_its_displays_colours_over_the_window() {
    let icon_of = |index: u8, opaque: bool| {
        let (header, and, xor) = vga_icon(index, opaque);

        Icon {
            hot_x: 0,
            hot_y: 0,
            cx: 32,
            cy: 32,
            width_bytes: u16::from(header[8]),
            planes: header[10],
            bits_pixel: header[11],
            and,
            xor,
            header: None,
        }
    };

    // The VGA's colour 1, dark red, where the mask lets the picture be.
    let (width, height, pixels) = icon_pixels(&icon_of(1, true), "vga").unwrap();

    assert_eq!((width, height), (32, 32));
    assert!(pixels.iter().all(|&pixel| pixel == 0x0080_0000));

    // The window's colour, white, where it keeps the screen and the
    // picture is nought.
    let (_, _, pixels) = icon_pixels(&icon_of(0, false), "vga").unwrap();

    assert!(pixels.iter().all(|&pixel| pixel == 0x00ff_ffff));

    // Bits fewer than the header says: none.
    let mut short = icon_of(1, true);

    short.xor.truncate(10);
    assert_eq!(icon_pixels(&short, "vga"), None);
}

#[test]
fn the_launcher_draws_in_its_windows_system_font() {
    let scratch = Scratch::new("launcher-font");

    assert!(
        system_font(&[installation(&scratch.0)]).is_none(),
        "no font file"
    );

    let drive = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../oracle/build/drive-c");

    if !drive.join("WINDOWS").join("SYSTEM.INI").is_file() {
        eprintln!("skipped: the oracle's drive is not made");
        return;
    }

    let font = system_font(&[scratch.0.clone(), drive]).expect("VGASYS.FON");

    assert_eq!(font.header.pix_height, 16);
    assert!(font.character(u32::from(b'W')).width > 0);
}
