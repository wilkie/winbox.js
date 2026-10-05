//! The oracle's probes run on the Rust engine, their records held to what
//! Windows 3.1 recorded (`oracle/fixtures`). The probes are built into
//! `oracle/build/probes`, which a checkout does not have until they are
//! built; without them these pass with nothing to check.

mod support;

use std::collections::VecDeque;

use winbox_win16::host::{Host, HostSlot};
use winbox_win16::key_input::Key;
use winbox_win16::{Stop, System};

use support::{AGREEING, Step, VK_RETURN, VK_TAB, hand, recorded, root, run, run_with};

#[test]
fn probes_agree_with_windows() {
    for name in AGREEING {
        let Some((stop, records)) = run(name) else {
            continue;
        };

        assert_eq!(stop, Stop::Ended, "{name}");
        assert_eq!(Some(records), recorded(name), "{name}");
    }
}

/// How many records of each probe the TypeScript engine agrees with
/// Windows on, from the knowledge base's conformance data.
fn typescript_agreed() -> std::collections::HashMap<String, u64> {
    let text = std::fs::read_to_string(root().join("kb/data/conformance.json")).unwrap_or_default();
    let data: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let mut agreed = std::collections::HashMap::new();

    if let Some(probes) = data.as_object() {
        for (name, probe) in probes {
            let count = probe["functions"].as_object().map_or(0, |functions| {
                functions
                    .values()
                    .filter_map(|f| f["agreed"].as_u64())
                    .sum()
            });

            agreed.insert(name.clone(), count);
        }
    }

    agreed
}

/// Every probe built, run, and how far each got, against the TypeScript
/// engine's agreement with Windows: `cargo test -p winbox-win16 --test
/// probes -- --ignored --nocapture`.
#[test]
#[ignore = "a survey, not a check"]
fn survey() {
    let typescript = typescript_agreed();
    let mut level = Vec::new();
    let mut behind = Vec::new();
    let mut ahead = Vec::new();
    let mut stops = std::collections::BTreeMap::<String, Vec<String>>::new();

    for entry in std::fs::read_dir(root().join("oracle/fixtures"))
        .unwrap()
        .flatten()
    {
        let file = entry.file_name().to_string_lossy().into_owned();
        let Some(name) = file.strip_suffix(".json") else {
            continue;
        };
        let Some(recorded) = recorded(name) else {
            continue;
        };
        let Some((stop, records)) = run(name) else {
            continue;
        };
        // As a whole run is replayed: each record's result found by its
        // function and arguments -- the record's own occurrence of them,
        // where a probe writes the same call more than once, else the last
        // written (`replay.ts`).
        let mut written: std::collections::HashMap<(&str, &str), Vec<&str>> =
            std::collections::HashMap::new();

        for [function, args, result] in &records {
            written
                .entry((function.as_str(), args.as_str()))
                .or_default()
                .push(result.as_str());
        }

        let mut seen: std::collections::HashMap<(&str, &str), usize> =
            std::collections::HashMap::new();
        let agreed = recorded
            .iter()
            .filter(|[function, args, result]| {
                let key = (function.as_str(), args.as_str());
                let occurrence = seen.entry(key).or_default();
                let at = *occurrence;

                *occurrence += 1;
                written
                    .get(&key)
                    .and_then(|results| results.get(at).or(results.last()))
                    == Some(&result.as_str())
            })
            .count() as u64;
        let theirs = typescript.get(name).copied().unwrap_or(0);

        if stop != Stop::Ended {
            stops
                .entry(format!("{stop:?}"))
                .or_default()
                .push(name.to_string());
        }

        match agreed.cmp(&theirs) {
            std::cmp::Ordering::Less if stop == Stop::Ended => {
                behind.push(format!("{name} {agreed}/{theirs}"));
            }
            std::cmp::Ordering::Less => {}
            std::cmp::Ordering::Equal => level.push(name.to_string()),
            std::cmp::Ordering::Greater => ahead.push(format!("{name} {agreed}/{theirs}")),
        }
    }

    let mut ranked: Vec<_> = stops.into_iter().collect();

    ranked.sort_by_key(|(_, names)| std::cmp::Reverse(names.len()));

    for (stop, names) in ranked {
        println!("{:4} {stop}: {}", names.len(), names.join(" "));
    }

    println!("ended behind the TypeScript engine: {}", behind.join(", "));
    println!("ahead of it: {}", ahead.join(", "));
    println!("level with it: {} -- {}", level.len(), level.join(" "));
}

/// The records of the probes named in `WINBOX_PROBES`, comma-separated,
/// that differ from Windows', each with what the run wrote and why it
/// stopped: `WINBOX_PROBES=wavedev,mididev cargo test -p winbox-win16
/// --test probes -- --ignored --nocapture differing`.
#[test]
#[ignore = "a survey, not a check"]
fn differing() {
    let names = std::env::var("WINBOX_PROBES").unwrap_or_default();

    for name in names.split(',').filter(|name| !name.is_empty()) {
        let (Some(recorded), Some((stop, records))) = (recorded(name), run(name)) else {
            println!("{name}: not built");
            continue;
        };
        let written: std::collections::HashMap<(&str, &str), &str> = records
            .iter()
            .map(|[function, args, result]| ((function.as_str(), args.as_str()), result.as_str()))
            .collect();
        let differing: Vec<_> = recorded
            .iter()
            .filter(|[function, args, result]| {
                written.get(&(function.as_str(), args.as_str())) != Some(&result.as_str())
            })
            .collect();

        println!(
            "{name}: {stop:?}, {} of {} alike",
            recorded.len() - differing.len(),
            recorded.len()
        );

        for [function, args, result] in differing {
            let got = written
                .get(&(function.as_str(), args.as_str()))
                .unwrap_or(&"(none)");

            println!("  {function} {args}: Windows {result:?}, winbox.js {got:?}");
        }
    }
}

/// The sixteen colours, and the letter each is written as
/// (`screen-rows.mjs`).
const COLOURS: [(char, [u8; 3]); 16] = [
    ('#', [0, 0, 0]),
    ('m', [170, 0, 0]),
    ('d', [0, 170, 0]),
    ('y', [170, 170, 0]),
    ('n', [0, 0, 170]),
    ('p', [170, 0, 170]),
    ('t', [0, 170, 170]),
    ('s', [192, 192, 192]),
    ('g', [128, 128, 128]),
    ('r', [255, 0, 0]),
    ('l', [0, 255, 0]),
    ('Y', [255, 255, 0]),
    ('b', [0, 0, 255]),
    ('P', [255, 0, 255]),
    ('c', [0, 255, 255]),
    ('.', [255, 255, 255]),
];

fn letter_of(colour: [u8; 3]) -> char {
    let distance = |other: [u8; 3]| -> i32 {
        (0..3)
            .map(|at| (i32::from(other[at]) - i32::from(colour[at])).pow(2))
            .sum()
    };

    COLOURS
        .iter()
        .min_by_key(|&&(_, each)| distance(each))
        .map_or('#', |&(letter, _)| letter)
}

/// Windows' rows, run-length encoded, spelled out.
fn expand(row: &str) -> String {
    let mut out = String::new();
    let mut chars = row.chars().peekable();

    while let Some(letter) = chars.next() {
        let mut count = String::new();

        while let Some(digit) = chars.next_if(char::is_ascii_digit) {
            count.push(digit);
        }

        let times = if count.is_empty() {
            1
        } else {
            count.parse().unwrap()
        };

        out.extend(std::iter::repeat_n(letter, times));
    }

    out
}

/// Whether a point is in a rectangle, where there is one.
fn within(area: Option<[i32; 4]>, x: i32, y: i32) -> bool {
    area.is_some_and(|[l, t, r, b]| x >= l && x < r && y >= t && y < b)
}

fn rect_of(value: &serde_json::Value) -> Option<[i32; 4]> {
    let at = |index: usize| value.get(index)?.as_i64().map(|n| n as i32);

    Some([at(0)?, at(1)?, at(2)?, at(3)?])
}

/// A box's screen taken under DOSBox (`oracle/fixtures/screens/fault.json`),
/// as rows of letters, its mask blanked.
fn recorded_shot(screens: &serde_json::Value, name: &str) -> Vec<String> {
    let shot = &screens["shots"][name];
    let [left, top, _, _] = rect_of(&screens["box"]).unwrap();
    let mask = rect_of(&shot["mask"]);

    shot["rows"]
        .as_array()
        .unwrap()
        .iter()
        .zip(top..)
        .map(|(row, y)| {
            expand(row.as_str().unwrap())
                .chars()
                .zip(left..)
                .map(|(letter, x)| if within(mask, x, y) { '?' } else { letter })
                .collect()
        })
        .collect()
}

/// The box's rectangle of the screen as it is now, as rows of letters.
fn shot_of(system: &System, area: [i32; 4]) -> Vec<String> {
    let screen = system.screen.as_ref().expect("a screen");
    let palette = screen.device_palette.borrow();

    (area[1]..area[3])
        .map(|y| {
            (area[0]..area[2])
                .map(|x| {
                    let index = screen.index_at(x, y).unwrap_or(0);

                    letter_of(palette.colours[usize::from(index)])
                })
                .collect()
        })
        .collect()
}

/// A shot taken here, with a mask blanked as the recording's is.
fn masked(rows: &[String], area: [i32; 4], mask: Option<[i32; 4]>) -> Vec<String> {
    rows.iter()
        .zip(area[1]..)
        .map(|(row, y)| {
            row.chars()
                .zip(area[0]..)
                .map(|(letter, x)| if within(mask, x, y) { '?' } else { letter })
                .collect()
        })
        .collect()
}

/// A program that faults, run whole: the `fault` probe starts one that
/// loads a selector that does not exist, and KERNEL's boxes come up. They
/// were recorded as the screen itself, taken under DOSBox, and answered
/// with the keys a person would press; here the same keys are pressed, the
/// screen is taken at the same moments, and the box is compared pixel for
/// pixel, each as the nearest of the sixteen colours.
#[test]
fn a_program_that_faults() {
    let Ok(text) = std::fs::read_to_string(root().join("oracle/fixtures/screens/fault.json"))
    else {
        return;
    };
    let screens: serde_json::Value = serde_json::from_str(&text).unwrap();
    let area = rect_of(&screens["box"]).unwrap();
    let first_mask = rect_of(&screens["shots"]["first"]["mask"]);

    // Enter, Enter: the first box closed, then Application Error.
    let (made, shots) = hand(
        vec![vec![Step::Key(VK_RETURN)], vec![Step::Key(VK_RETURN)]],
        move |system| shot_of(system, area),
    );
    let Some((stop, records)) = run_with("fault", |system| system.box_hand = Some(made)) else {
        return;
    };

    {
        let shots = shots.borrow();

        assert_eq!(stop, Stop::Ended);
        assert_eq!(shots.len(), 2);
        assert_eq!(
            masked(&shots[0], area, first_mask),
            recorded_shot(&screens, "first")
        );
        assert_eq!(shots[1], recorded_shot(&screens, "second"));
        assert_eq!(Some(records), recorded("fault"));
    }

    // Tab, Enter: Ignore, and the program goes on.
    let (made, shots) = hand(
        vec![vec![Step::Key(VK_TAB), Step::Shoot, Step::Key(VK_RETURN)]],
        move |system| shot_of(system, area),
    );
    let (_, records) = run_with("fault", |system| system.box_hand = Some(made)).unwrap();
    let shots = shots.borrow();
    let field = |record: &serde_json::Value, key: &str| record[key].as_str().unwrap().to_string();
    let wanted: Vec<[String; 3]> = screens["runs"]["Tab, Enter"]
        .as_array()
        .unwrap()
        .iter()
        .map(|record| {
            [
                field(record, "function"),
                field(record, "args"),
                field(record, "result"),
            ]
        })
        .collect();

    assert_eq!(shots.len(), 2);
    assert_eq!(shots[1], recorded_shot(&screens, "first, after Tab"));
    assert_eq!(records, wanted);
}

/// A host whose keyboard presses Enter at each of USER's system error
/// boxes, once it is up, as a person at the screen would.
struct EnterAtTheBox {
    presses: usize,
}

impl Host for EnterAtTheBox {
    fn frame(&mut self, system: &mut System) -> bool {
        if self.presses > 0 && system.modal_input.as_ref().is_some_and(VecDeque::is_empty) {
            let enter = Key {
                code: "Enter".to_string(),
                key: "Enter".to_string(),
                repeat: false,
                alt: false,
            };

            self.presses -= 1;
            system.key_event(true, &enter);
            system.key_event(false, &enter);
        }

        true
    }
}

/// The boxes a program that faults brings up, answered by the host's own
/// keyboard rather than a hand: Enter, Enter, the first box closed and then
/// Application Error, and the program ended as with the hand. The host's
/// own clock, as the native front end runs on, which gives the host its
/// frames while the box waits.
#[test]
fn a_program_that_faults_answered_at_the_hosts_keyboard() {
    let Some((stop, records)) = run_with("fault", |system| {
        system.clock = winbox_machine::Clock::real();
        system.host = Some(HostSlot::new(Box::new(EnterAtTheBox { presses: 2 })));
    }) else {
        return;
    };

    assert_eq!(stop, Stop::Ended);
    assert_eq!(Some(records), recorded("fault"));
}
