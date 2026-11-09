//! `CBN_SELENDOK` (9) and `CBN_SELENDCANCEL` (a), told by a combo box made
//! with the instance of a module made for Windows 3.1 as its list is put
//! away, before `CBN_CLOSEUP` (8) (`USER.EXE` seg33 `0b47`-`0b6f`):
//! `CreateWindow` marks the window of a module whose expected version is
//! 3.10 or more (seg8 `0428`-`0432`). OK for a choice -- F4, Alt and Up or
//! Down, a row of the list (`026a`, `02c8`, `0a20`) -- and cancel for the
//! focus lost (`11e7`) or `CB_SHOWDROPDOWN` (`0700`). `combobox.rs` does it.
//!
//! Every probe is made for Windows 3.0, and its recording tells neither; the
//! same probe marked 3.10 in its header tells them, and nothing else of its
//! records moves.
//!
//! Skipped where the probes are not built.

mod support;

use std::collections::BTreeMap;

use support::{Base, Setup, box_hand, run_setup};

/// A probe run whole, its module marked as made for `version`: what it
/// wrote, each record by its function and arguments.
fn run(name: &str, version: u16) -> Option<BTreeMap<String, String>> {
    let mut setup = Setup::on(name, Base::Installed)?;
    let header = u32::from_le_bytes(setup.bytes[0x3c..0x40].try_into().unwrap()) as usize;

    // The NE header's expected Windows version, minor first, at 3Eh.
    setup.bytes[header + 0x3e..header + 0x40].copy_from_slice(&version.to_le_bytes());

    let (_, records, ()) = run_setup(
        name,
        setup,
        |system| system.box_hand = Some(box_hand(name)),
        |system| {
            (
                winbox_win16::Engine::new(system).run(2_000_000_000, 300.0),
                (),
            )
        },
    );

    Some(
        records
            .into_iter()
            .map(|[function, args, result]| (format!("{function}({args})"), result))
            .collect(),
    )
}

/// The records of the 3.10 run that differ from the 3.00 run's, in order.
fn moved(old: &BTreeMap<String, String>, made: &BTreeMap<String, String>) -> Vec<String> {
    made.iter()
        .filter(|&(key, value)| old.get(key) != Some(value))
        .map(|(key, value)| format!("{key} = {value}"))
        .collect()
}

/// `comboesc`'s dialog: F4 pressed with the list down puts it away as a
/// choice. Escape and Enter are the dialog's, and the list stays down: no
/// word of either. The Open box's drives are COMMDLG's, made with its
/// instance, a module made for 3.0: they tell neither.
#[test]
fn tells_selendok_before_closeup_for_f4_and_nothing_for_escape_that_leaves_it_down() {
    let Some(old) = run("comboesc", 0x300) else {
        return;
    };
    let made = run("comboesc", 0x30a).unwrap();

    assert_eq!(
        old["after(list,f4,f4)"],
        "log=65:8,dropped=0/0,sel=1,focus=65,code=81,up=1"
    );

    let mut wanted = vec![
        "after(list,f4,f4) = log=65:9 65:8,dropped=0/0,sel=1,focus=65,code=81,up=1",
        "after(list,altdown,f4) = log=65:9 65:8,dropped=0/0,sel=1,focus=65,code=81,up=1",
        "after(list,click,f4) = log=65:9 65:8,dropped=0/0,sel=1,focus=65,code=81,up=1",
        "after(drop,f4,f4) = log=66:9 66:8,dropped=0/0,sel=1,focus=e,code=89,up=1",
        "after(drop,altdown,f4) = log=66:9 66:8,dropped=0/0,sel=1,focus=e,code=89,up=1",
        "after(drop,click,f4) = log=66:9 66:8,dropped=0/0,sel=1,focus=e,code=89,up=1",
    ];

    // Compared as sets: the records are keyed, each once.
    wanted.sort_unstable();
    assert_eq!(moved(&old, &made), wanted);
    assert_eq!(
        made["after(list,f4,escape)"],
        "log=2:0,dropped=1/0,sel=1,focus=65,code=81,up=1"
    );
}

/// `comboact`: a row of the dropped list pressed and let go, its window
/// active or not. The list's `LBN_SELCHANGE` puts it away: told as its
/// second `WM_LBUTTONUP` comes, the one the combo box sends it.
#[test]
fn tells_selendok_before_closeup_for_a_row_pressed() {
    let Some(old) = run("comboact", 0x300) else {
        return;
    };
    let made = run("comboact", 0x30a).unwrap();

    assert_eq!(old["log(press)"], "L201 L202 L202 L18 L46:97 H111:8 H111:1");
    assert_eq!(
        moved(&old, &made),
        [
            "log(inactive) = L201 Q86 Q6 H46:3 H86 H6 Q8 H7 H8 H111:3 L202 H111:9 L202 L18 L46:97 H111:8 H111:1",
            "log(press) = L201 L202 H111:9 L202 L18 L46:97 H111:8 H111:1",
        ]
    );
}

/// The `combobox` probe's steps, its combo boxes made with an instance of a
/// 3.10 module: Down, and a character, on a drop-down list with its list put
/// away choose a row (OK, and no close-up, nothing being down); the focus
/// taken from it, its list down, to another combo box cancels before
/// `CBN_CLOSEUP`, as a click away does, and taken from one with its list put
/// away cancels alone; and `CB_SHOWDROPDOWN` with nought cancels before
/// `CBN_CLOSEUP`. The probe is run whole, as it was recorded.
#[test]
fn tells_selendcancel_before_closeup_for_the_focus_taken_away_and_cb_showdropdown() {
    let notes = |version| {
        run("combobox-vga", version).map(|records| {
            records
                .into_iter()
                .filter(|(key, _)| key.starts_with("notes("))
                .map(|(key, value)| {
                    let name = &key["notes(".len()..key.len() - 1];

                    format!("notes:{name} = {value}")
                })
                .collect::<Vec<_>>()
        })
    };
    let Some(old) = notes(0x300) else {
        return;
    };
    let made = notes(0x30a).unwrap();
    let only = |of: &[String], not: &[String]| -> Vec<String> {
        let mut only: Vec<String> = of
            .iter()
            .filter(|note| !not.contains(note))
            .cloned()
            .collect();

        only.sort_unstable();
        only
    };
    let sorted = |notes: &[&str]| {
        let mut notes: Vec<String> = notes.iter().map(|note| (*note).to_string()).collect();

        notes.sort_unstable();
        notes
    };

    assert_eq!(
        only(&old, &made),
        sorted(&[
            "notes:down = 100:1",
            "notes:char = 100:1",
            "notes:settext = 100:8,100:4,101:3",
            "notes:ddropped = 101:4,103:3,103:7",
            "notes:dclosed = 103:8",
        ])
    );
    assert_eq!(
        only(&made, &old),
        sorted(&[
            "notes:down = 100:9,100:1",
            "notes:char = 100:9,100:1",
            "notes:settext = 100:a,100:8,100:4,101:3",
            "notes:ddropped = 101:a,101:4,103:3,103:7",
            "notes:dclosed = 103:a,103:8",
        ])
    );
}
