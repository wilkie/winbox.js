//! The desktop's windows as a screen reader is given them: the tree
//! `accessible_tree_json` makes of USER's windows. The page's half of the
//! test, the elements the mirror keeps (`test/raster/aria_mirror_test.ts`),
//! is given committed trees.
//!
//! A window with a menu bar and one of each control, as that test made it:
//! an overlapped window, `Notepad - (Untitled)`, with `&File` and `&Edit`,
//! and children of it in the order they were made.

use serde_json::Value;
use winbox_win16::accessible_tree::plain_label;
use winbox_win16::controls::ControlState;
use winbox_win16::system::System;
use winbox_win16::windows::{Placement, Window};

const OVERLAPPED: u32 = 0x00cf_0000;
const CHILD: u32 = 0x5000_0000;

/// The window, its children, and the index of its edit control.
fn notepadish() -> (System, usize) {
    let mut system = System::new();

    system.windows.push(Some(Window {
        title: "Notepad - (Untitled)".to_string(),
        style: OVERLAPPED,
        bar: Some(vec!["&File".to_string(), "&Edit".to_string()]),
        visible: true,
        active: true,
        ..Window::default()
    }));

    let controls: [(&str, u32, &str, u16, &[&str]); 7] = [
        ("EDIT", 0x4, "hello", 0, &[]),
        ("BUTTON", 0x0, "&OK", 0, &[]),
        ("BUTTON", 0x3, "&Wrap", 1, &[]),
        ("BUTTON", 0x9, "Up", 0, &[]),
        ("STATIC", 0x0, "Find what:", 0, &[]),
        ("LISTBOX", 0x0, "", 0, &["one", "two"]),
        ("SCROLLBAR", 0x1, "", 0, &[]),
    ];

    for (class, style, text, checked, items) in controls {
        system.windows.push(Some(Window {
            style: CHILD | style,
            title: text.to_string(),
            parent: Some(0),
            visible: true,
            control: Some(ControlState {
                checked,
                items: items.iter().map(ToString::to_string).collect(),
                ..ControlState::new(class, style, text)
            }),
            ..Window::default()
        }));
    }

    system.z_order = (0..system.windows.len()).collect();
    (system, 1)
}

fn tree(system: &System) -> Value {
    serde_json::from_str(&system.accessible_tree_json()).unwrap()
}

#[test]
fn names_a_window_by_its_caption_and_says_it_is_active() {
    let (system, _) = notepadish();
    let node = &tree(&system)["nodes"][0];

    assert_eq!(node["key"], "w1");
    assert_eq!(node["role"], "group");
    assert_eq!(node["roleDescription"], "window");
    assert_eq!(node["name"], "Notepad - (Untitled)");
    assert_eq!(node["description"], "active");
}

#[test]
fn gives_the_system_menu_the_menu_bar_and_each_control_a_role() {
    let (system, _) = notepadish();
    let node = &tree(&system)["nodes"][0];
    let children = node["children"].as_array().unwrap();
    let named: Vec<(String, String)> = children
        .iter()
        .map(|child| {
            let label = child
                .get("name")
                .or_else(|| child.get("value"))
                .and_then(Value::as_str)
                .unwrap_or("-");

            (
                child["role"].as_str().unwrap().to_string(),
                label.to_string(),
            )
        })
        .collect();
    let expected: Vec<(String, String)> = [
        ("button", "System menu"),
        ("menubar", "Notepad - (Untitled) menu"),
        ("textbox", "hello"),
        ("button", "OK"),
        ("checkbox", "Wrap"),
        ("radio", "Up"),
        ("text", "Find what:"),
        ("listbox", "-"),
        ("scrollbar", "-"),
    ]
    .iter()
    .map(|(role, name)| ((*role).to_string(), (*name).to_string()))
    .collect();

    assert_eq!(named, expected);

    let bar: Vec<(&str, &str)> = children[1]["children"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            (
                item["name"].as_str().unwrap(),
                item["shortcut"].as_str().unwrap(),
            )
        })
        .collect();

    assert_eq!(bar, [("File", "Alt+F"), ("Edit", "Alt+E")]);
    assert_eq!(children[2]["multiline"], true);
    assert_eq!(children[4]["checked"], true);
    assert_eq!(children[5]["checked"], false);

    let options: Vec<&str> = children[7]["children"]
        .as_array()
        .unwrap()
        .iter()
        .map(|option| option["name"].as_str().unwrap())
        .collect();

    assert_eq!(options, ["one", "two"]);
    assert_eq!(children[8]["orientation"], "vertical");
}

#[test]
fn shows_a_minimized_window_as_its_title_alone() {
    let (mut system, _) = notepadish();

    system.windows[0].as_mut().unwrap().placement = Placement::Minimized;

    let node = &tree(&system)["nodes"][0];

    assert_eq!(node["children"], Value::Array(Vec::new()));
    assert!(node["description"].as_str().unwrap().contains("minimized"));
}

#[test]
fn points_the_focus_at_the_focused_control() {
    let (mut system, edit) = notepadish();

    system.focus = Some(edit);
    assert_eq!(tree(&system)["focus"], "w2");
}

#[test]
fn drops_the_mnemonic_and_the_accelerator_from_a_label() {
    assert_eq!(plain_label("&Undo\tCtrl+Z"), "Undo");
    assert_eq!(plain_label("Fish && &Chips"), "Fish & Chips");
}
