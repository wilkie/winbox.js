//! Where a menu bar's items go, as winbox.js's `menu-bar.ts` lays them out.
//! **Recorded** by `menuhelp`, a bar of File, Game and a Help whose text
//! starts with a backspace, in windows 300 down to 100 wide:
//!
//! * Each item is its text's width with 8 pixels either side, one after
//!   another from the bar's left.
//! * An item starts a row of its own under the last when, after it, fewer
//!   than 9 pixels of the bar would be left; the bar is a row taller for
//!   each, and its line is under the last.
//! * An item whose text starts with a backspace, and every item after it,
//!   stands at the right of its row instead, the backspace not shown, its
//!   text ending 4 pixels short of the bar's right.

use crate::menus::MenuData;
use crate::system::System;

pub const MENU_GAP: i32 = 8;

/// How far past the bar's right the last of the right-hand items' space
/// reaches: its text ends 4 pixels in, where there are 8 after the others'.
const RIGHT_MARGIN: i32 = 4;

/// A backspace at the start of an item's text: it, and those after it, at
/// the right.
const RIGHT: char = '\u{8}';

/// An item flagged `MF_HELP`, as `labels` marks it: at the right too, but
/// ending at the bar's right, 4 pixels short of where a backspace's would
/// (`menuflag`).
pub const HELP_MARK: char = '\u{7f}';

const MF_HELP: u16 = 0x4000;

/// One item of a bar: the text shown, the mark taken off, where it runs,
/// and its row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BarItem {
    pub text: String,
    pub left: i32,
    pub right: i32,
    pub row: i32,
}

impl MenuData {
    /// Its items' texts as a bar shows them: an `MF_HELP` item's marked,
    /// unless its text already starts with a backspace.
    pub fn labels(&self) -> Vec<String> {
        self.items
            .iter()
            .map(|item| {
                let text = item.text.clone().unwrap_or_default();

                if item.flags & MF_HELP != 0 && !text.starts_with(RIGHT) {
                    format!("{HELP_MARK}{text}")
                } else {
                    text
                }
            })
            .collect()
    }
}

/// The text of an item, its mark for the right taken off.
pub fn unmarked(label: &str) -> &str {
    label
        .strip_prefix(RIGHT)
        .or_else(|| label.strip_prefix(HELP_MARK))
        .unwrap_or(label)
}

/// A bar's items between `left` and `right`, measured by `measure`, and how
/// many rows it takes.
pub fn bar_layout(
    labels: &[String],
    measure: impl Fn(&str) -> i32,
    left: i32,
    right: i32,
) -> (Vec<BarItem>, i32) {
    let mut items = Vec::with_capacity(labels.len());
    let flush = labels
        .iter()
        .position(|label| label.starts_with(RIGHT) || label.starts_with(HELP_MARK));
    let margin = match flush {
        Some(at) if labels[at].starts_with(HELP_MARK) => 0,
        _ => RIGHT_MARGIN,
    };
    let mut x = left;
    let mut row = 0;

    for label in labels {
        let text = unmarked(label);
        // The first `&` only, as a string's `replace` takes it.
        let width = measure(&text.replacen('&', "", 1)) + 2 * MENU_GAP;

        if x > left && x + width + MENU_GAP >= right {
            row += 1;
            x = left;
        }

        items.push(BarItem {
            text: text.to_string(),
            left: x,
            right: x + width,
            row,
        });
        x += width;
    }

    // The items from the backspace on, to the right of their rows.
    if let Some(flush) = flush {
        for r in 0..=row {
            let moved: Vec<usize> = (flush..items.len())
                .filter(|&index| items[index].row == r)
                .collect();

            if let Some(&last) = moved.last() {
                let by = right + margin - items[last].right;

                for index in moved {
                    items[index].left += by;
                    items[index].right += by;
                }
            }
        }
    }

    (items, row + 1)
}

impl System {
    /// A line's width in the System font, as the raster desktop measures
    /// it; `None` before the desktop has its font.
    pub fn system_text_width(&self, line: &str) -> Option<i32> {
        let font = self.desktop_font.as_ref()?;
        let bytes: Vec<u8> = line.chars().map(|c| c as u8).collect();

        Some(font.measure(&bytes, winbox_raster::Measure::default()).0 as i32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Eight pixels a character, as near the System font as a test needs.
    fn measure(text: &str) -> i32 {
        8 * text.len() as i32
    }

    fn labels(texts: &[&str]) -> Vec<String> {
        texts.iter().map(|text| (*text).to_string()).collect()
    }

    #[test]
    fn wraps_an_item_that_leaves_less_than_nine_pixels() {
        // File 48, Game 48: Game ends at 96 from 0.
        let bar = labels(&["&File", "&Game"]);

        assert_eq!(bar_layout(&bar, measure, 0, 105).1, 1);
        assert_eq!(bar_layout(&bar, measure, 0, 104).1, 2);
    }

    #[test]
    fn puts_a_backspaced_item_at_the_right() {
        let bar = labels(&["&File", "\u{8}&Help"]);
        let (items, rows) = bar_layout(&bar, measure, 0, 300);

        assert_eq!(rows, 1);
        assert_eq!(items[1].text, "&Help");
        assert_eq!(items[1].right, 304);
        assert_eq!(items[1].left, 304 - 48);
    }
}
