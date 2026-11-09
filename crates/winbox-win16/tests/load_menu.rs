//! A menu resource read into a menu (`LoadMenu`): after its header, each
//! item's flags, its identifier unless it is a pop-up, and its text; `MF_END`
//! closing the menu it ends.

use winbox_win16::System;

const MF_POPUP: u16 = 0x10;
const MF_END: u16 = 0x80;

/// A menu resource: the header, then each item's flags, identifier and text.
fn resource(items: &[(u16, Option<u16>, &str)]) -> Vec<u8> {
    let mut bytes = vec![0, 0, 0, 0];

    for &(flags, id, text) in items {
        bytes.extend(flags.to_le_bytes());

        if let Some(id) = id {
            bytes.extend(id.to_le_bytes());
        }

        bytes.extend(text.as_bytes());
        bytes.push(0);
    }

    bytes
}

#[test]
fn reads_a_menu_bar_of_pop_ups_and_their_items() {
    let mut system = System::new();
    let bar = system.parse_menu(&resource(&[
        (MF_POPUP, None, "&File"),
        (0, Some(1), "&Open"),
        (MF_END, Some(2), "E&xit"),
        (MF_POPUP | MF_END, None, "&Help"),
        (MF_END, Some(3), "&About"),
    ]));
    let items = |menu: usize| -> Vec<(u16, Option<String>)> {
        system.menus[menu]
            .items
            .iter()
            .map(|item| (item.id, item.text.clone()))
            .collect()
    };
    let labels: Vec<Option<String>> = items(bar).into_iter().map(|(_, text)| text).collect();

    assert_eq!(
        labels,
        [Some("&File".to_string()), Some("&Help".to_string())]
    );

    let popups: Vec<usize> = system.menus[bar]
        .items
        .iter()
        .map(|item| item.popup.unwrap())
        .collect();

    assert_eq!(
        items(popups[0]),
        [
            (1, Some("&Open".to_string())),
            (2, Some("E&xit".to_string()))
        ]
    );
    assert_eq!(items(popups[1]), [(3, Some("&About".to_string()))]);
}
