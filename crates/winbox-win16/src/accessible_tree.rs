//! USER's windows as an accessibility tree, as winbox.js's
//! `accessible-tree.ts` makes it: what a screen reader is given in place of
//! the pixels the raster desktop draws. Windows 3.1 had no accessibility
//! interface, so nothing here is measured; it is a mapping, and that file
//! says why each window is the role it is.
//!
//! The tree is serialised as the TypeScript engine's `JSON.stringify` writes
//! its own, so a page's mirror (`aria-mirror.ts`) takes either alike: the
//! same keys, in camel case and in the same order, and a field with nothing
//! to say left out. A window's key is its place on the desktop, as the
//! TypeScript engine's `DesktopWindow.id` is: its index here and one more,
//! as a pixel's owner is (`desktop.rs`), so a window keeps its key from one
//! frame to the next.

use serde::Serialize;

use crate::menu_bar::unmarked;
use crate::system::System;
use crate::windows::{Placement, Window};

const WS_SYSMENU: u32 = 0x0008_0000;
const ES_MULTILINE: u32 = 0x0004;
const SBS_VERT: u32 = 0x1;

const BS_CHECKBOX: u32 = 0x2;
const BS_AUTOCHECKBOX: u32 = 0x3;
const BS_RADIOBUTTON: u32 = 0x4;
const BS_3STATE: u32 = 0x5;
const BS_AUTO3STATE: u32 = 0x6;
const BS_GROUPBOX: u32 = 0x7;
const BS_AUTORADIOBUTTON: u32 = 0x9;

const MF_GRAYED: u16 = 0x0001;
const MF_DISABLED: u16 = 0x0002;
const MF_CHECKED: u16 = 0x0008;
const MF_POPUP: u16 = 0x0010;

/// A check box's state: checked or not, or neither (`aria-checked="mixed"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Checked {
    State(bool),
    Mixed,
}

impl Serialize for Checked {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::State(state) => serializer.serialize_bool(*state),
            Self::Mixed => serializer.serialize_str("mixed"),
        }
    }
}

/// A node of the tree. Its fields are in the order the TypeScript engine's
/// object literals give theirs, which no node's order contradicts, so each
/// node is written as `JSON.stringify` writes it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessibleNode {
    /// Stable across updates, so a renderer can keep what a reader has
    /// found.
    pub key: String,
    pub role: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role_description: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// For a text box, what it holds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multiline: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orientation: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<Checked>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_popup: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expanded: Option<bool>,
    pub children: Vec<AccessibleNode>,
}

impl AccessibleNode {
    fn new(key: String, role: &'static str) -> Self {
        Self {
            key,
            role,
            ..Self::default()
        }
    }
}

/// The tree: the windows at the top, the topmost first, and what keys go
/// to -- the item selected in the open menu if one is open, or the window
/// with the focus.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct AccessibleTree {
    pub nodes: Vec<AccessibleNode>,
    pub focus: Option<String>,
}

/// Whether JavaScript's `\s` takes a character.
fn js_space(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// Whether JavaScript's `.` takes a character: any but a line's end.
fn js_dot(character: char) -> bool {
    !matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// Whether a character is a word's for JavaScript's `\b`.
fn js_word(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_'
}

/// A text's part before its first tab, as `split('\t')[0]` gives it.
fn before_tab(text: &str) -> &str {
    text.split('\t').next().unwrap_or("")
}

/// A label as a reader should hear it: no `&` for the mnemonic, no
/// accelerator after a tab.
pub fn plain_label(text: &str) -> String {
    let mut plain = String::new();
    let mut characters = before_tab(unmarked(text)).chars().peekable();

    while let Some(character) = characters.next() {
        match characters.peek() {
            Some(&next) if character == '&' && js_dot(next) => {
                plain.push(next);
                characters.next();
            }
            _ => plain.push(character),
        }
    }

    plain
}

/// The key a label's `&` marks, as ARIA writes a shortcut with Alt.
fn mnemonic(text: &str) -> Option<String> {
    let characters: Vec<char> = before_tab(text).chars().collect();

    characters
        .windows(2)
        .find(|pair| pair[0] == '&' && pair[1] != '&')
        .map(|pair| format!("Alt+{}", pair[1].to_uppercase()))
}

/// An accelerator written after a tab, as ARIA writes it: `Ctrl+Z` is
/// `Control+Z`.
fn accelerator(text: &str) -> Option<String> {
    let after = text.split('\t').nth(1).filter(|after| !after.is_empty())?;
    let characters: Vec<char> = after.chars().collect();
    let mut written = String::new();
    let mut at = 0;

    while at < characters.len() {
        let word = characters.get(at..at + 4) == Some(&['C', 't', 'r', 'l'][..]);
        let starts = at == 0 || !js_word(characters[at - 1]);
        let ends = characters.get(at + 4).is_none_or(|&next| !js_word(next));

        if word && starts && ends {
            written.push_str("Control");
            at += 4;
        } else {
            if !js_space(characters[at]) {
                written.push(characters[at]);
            }

            at += 1;
        }
    }

    Some(written)
}

/// A window's key, as the TypeScript engine's is from its `id`.
fn key_of(index: usize) -> String {
    format!("w{}", index + 1)
}

/// What the tree is made from, and the item it says keys go to.
struct Builder<'a> {
    system: &'a System,
    /// The open pop-ups, oldest first.
    popups: Vec<usize>,
    focus: Option<String>,
}

impl Builder<'_> {
    fn window(&self, index: usize) -> &Window {
        self.system.windows[index]
            .as_ref()
            .expect("a window not destroyed")
    }

    /// The open pop-ups from `level` on as nodes, each nested in the item
    /// that opened it.
    fn menu_node(&mut self, level: usize) -> Option<AccessibleNode> {
        let index = *self.popups.get(level)?;
        let popup = self.window(index).popup.as_ref()?;
        let (menu, selected) = (popup.menu, popup.selected);
        let next = self
            .popups
            .get(level + 1)
            .and_then(|&next| self.window(next).popup.as_ref())
            .map(|popup| popup.menu);
        let id = index + 1;

        if selected >= 0 {
            self.focus = Some(format!("p{id}-{selected}"));
        }

        let system = self.system;
        let children = system.menus[menu]
            .items
            .iter()
            .enumerate()
            .map(|(at, item)| {
                let key = format!("p{id}-{at}");
                let text = item.text.as_deref().unwrap_or("");

                if text.is_empty() && item.flags & MF_POPUP == 0 {
                    return AccessibleNode::new(key, "separator");
                }

                let opens = item.popup.is_some() && item.popup == next;
                let child = if opens {
                    self.menu_node(level + 1)
                } else {
                    None
                };
                let checked = item.flags & MF_CHECKED != 0;

                AccessibleNode {
                    name: Some(plain_label(text)),
                    shortcut: accelerator(text),
                    checked: checked.then_some(Checked::State(true)),
                    disabled: (item.flags & (MF_GRAYED | MF_DISABLED) != 0).then_some(true),
                    has_popup: item.popup.is_some().then_some(true),
                    expanded: item.popup.is_some().then_some(opens),
                    children: child.into_iter().collect(),
                    ..AccessibleNode::new(
                        key,
                        if checked {
                            "menuitemcheckbox"
                        } else {
                            "menuitem"
                        },
                    )
                }
            })
            .collect();

        Some(AccessibleNode {
            children,
            ..AccessibleNode::new(format!("p{id}"), "menu")
        })
    }

    /// A standard control's node; none for a class with no role here.
    fn control(&mut self, index: usize) -> Option<AccessibleNode> {
        let system = self.system;
        let state = system.windows[index].as_ref()?.control.as_ref()?;
        let key = key_of(index);
        let name = Some(plain_label(&state.text));
        let kind = state.style & 0xf;
        let style = state.style;

        Some(match state.class_name.to_ascii_uppercase().as_str() {
            "BUTTON" => match kind {
                BS_CHECKBOX | BS_AUTOCHECKBOX | BS_3STATE | BS_AUTO3STATE => AccessibleNode {
                    name,
                    checked: Some(if state.checked == 2 {
                        Checked::Mixed
                    } else {
                        Checked::State(state.checked == 1)
                    }),
                    ..AccessibleNode::new(key, "checkbox")
                },
                BS_RADIOBUTTON | BS_AUTORADIOBUTTON => AccessibleNode {
                    name,
                    checked: Some(Checked::State(state.checked == 1)),
                    ..AccessibleNode::new(key, "radio")
                },
                BS_GROUPBOX => AccessibleNode {
                    name,
                    children: self.children(index),
                    ..AccessibleNode::new(key, "group")
                },
                _ => AccessibleNode {
                    name,
                    ..AccessibleNode::new(key, "button")
                },
            },
            "STATIC" => AccessibleNode {
                name,
                ..AccessibleNode::new(key, "text")
            },
            "EDIT" => AccessibleNode {
                value: Some(state.text.clone()),
                multiline: Some(style & ES_MULTILINE != 0),
                ..AccessibleNode::new(key, "textbox")
            },
            "LISTBOX" => AccessibleNode {
                children: state
                    .items
                    .iter()
                    .enumerate()
                    .map(|(at, item)| AccessibleNode {
                        name: Some(item.clone()),
                        ..AccessibleNode::new(format!("{key}-{at}"), "option")
                    })
                    .collect(),
                ..AccessibleNode::new(key, "listbox")
            },
            "SCROLLBAR" => AccessibleNode {
                orientation: Some(if style & SBS_VERT != 0 {
                    "vertical"
                } else {
                    "horizontal"
                }),
                ..AccessibleNode::new(key, "scrollbar")
            },
            _ => return None,
        })
    }

    /// A window's children that show, in the desktop's order.
    fn children(&mut self, parent: usize) -> Vec<AccessibleNode> {
        let children: Vec<usize> = self
            .system
            .z_order
            .iter()
            .copied()
            .filter(|&index| {
                let window = self.window(index);

                window.parent == Some(parent) && window.visible
            })
            .collect();

        children
            .into_iter()
            .filter_map(|index| {
                if self.window(index).control.is_some() {
                    self.control(index)
                } else {
                    Some(self.window_node(index))
                }
            })
            .collect()
    }

    /// A window's node: its system menu, its menu bar and its children,
    /// unless it is minimized.
    fn window_node(&mut self, index: usize) -> AccessibleNode {
        let system = self.system;
        let window = system.windows[index]
            .as_ref()
            .expect("a window not destroyed");
        let key = key_of(index);
        let mut nodes = Vec::new();
        let open = system.menu_loop.owner == Some(index);

        if window.placement != Placement::Minimized {
            if window.style & WS_SYSMENU != 0 && window.parent.is_none() {
                let menu = if open && window.system_menu_open {
                    self.menu_node(0)
                } else {
                    None
                };

                if open && window.system_menu_open && self.focus.is_none() {
                    self.focus = Some(format!("{key}-sys"));
                }

                nodes.push(AccessibleNode {
                    name: Some("System menu".to_string()),
                    has_popup: Some(true),
                    expanded: Some(menu.is_some()),
                    children: menu.into_iter().collect(),
                    ..AccessibleNode::new(format!("{key}-sys"), "button")
                });
            }

            if let Some(bar) = window.bar.as_ref().filter(|bar| !bar.is_empty()) {
                let items = bar
                    .iter()
                    .enumerate()
                    .map(|(at, label)| {
                        let selected = open && window.menu_selected == Some(at);
                        let menu = if selected { self.menu_node(0) } else { None };

                        if selected && self.focus.is_none() {
                            self.focus = Some(format!("{key}-bar-{at}"));
                        }

                        AccessibleNode {
                            name: Some(plain_label(label)),
                            shortcut: mnemonic(label),
                            has_popup: Some(true),
                            expanded: Some(menu.is_some()),
                            children: menu.into_iter().collect(),
                            ..AccessibleNode::new(format!("{key}-bar-{at}"), "menuitem")
                        }
                    })
                    .collect();

                nodes.push(AccessibleNode {
                    name: (!window.title.is_empty()).then(|| format!("{} menu", window.title)),
                    children: items,
                    ..AccessibleNode::new(format!("{key}-bar"), "menubar")
                });
            }

            nodes.extend(self.children(index));
        }

        let states: Vec<&str> = [
            window.active.then_some("active"),
            (window.placement == Placement::Minimized).then_some("minimized"),
            (window.placement == Placement::Maximized).then_some("maximized"),
        ]
        .into_iter()
        .flatten()
        .collect();

        AccessibleNode {
            role_description: Some("window"),
            name: (!window.title.is_empty()).then(|| window.title.clone()),
            description: (!states.is_empty()).then(|| states.join(", ")),
            children: nodes,
            ..AccessibleNode::new(key, "group")
        }
    }
}

impl System {
    /// The desktop's windows as an accessibility tree, as the TypeScript
    /// engine's `accessibleTree` makes it: hidden windows left out, and a
    /// minimized window's content; the windows at the top in the desktop's
    /// order, the topmost first, and children in theirs.
    pub fn accessible_tree(&self) -> AccessibleTree {
        let shown = |index: &usize| self.windows[*index].as_ref();
        let mut popups: Vec<usize> = self
            .z_order
            .iter()
            .filter(|index| {
                shown(index).is_some_and(|window| window.popup.is_some() && window.visible)
            })
            .copied()
            .collect();

        popups.reverse();

        let mut builder = Builder {
            system: self,
            popups,
            focus: None,
        };
        let tops: Vec<usize> = self
            .z_order
            .iter()
            .filter(|index| {
                shown(index).is_some_and(|window| {
                    window.visible
                        && window.parent.is_none()
                        && window.popup.is_none()
                        && window.title_of.is_none()
                })
            })
            .copied()
            .collect();
        let nodes = tops
            .into_iter()
            .map(|index| builder.window_node(index))
            .collect();
        let mut focus = builder.focus;

        if focus.is_none()
            && self.menu_loop.owner.is_none()
            && let Some(window) = self.focus
        {
            focus = Some(key_of(window));
        }

        AccessibleTree { nodes, focus }
    }

    /// The accessibility tree as JSON, as `JSON.stringify` writes the
    /// TypeScript engine's.
    pub fn accessible_tree_json(&self) -> String {
        serde_json::to_string(&self.accessible_tree()).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::controls::ControlState;

    #[test]
    fn a_label_is_read_without_its_marks() {
        assert_eq!(plain_label("&File"), "File");
        assert_eq!(plain_label("Save &As...\tCtrl+S"), "Save As...");
        assert_eq!(plain_label("\u{8}&Help"), "Help");
        assert_eq!(plain_label("A && B"), "A & B");
        assert_eq!(plain_label("End&"), "End&");
    }

    #[test]
    fn a_mnemonic_and_an_accelerator_are_written_as_aria_writes_them() {
        assert_eq!(mnemonic("&File").as_deref(), Some("Alt+F"));
        assert_eq!(mnemonic("A &&b &c").as_deref(), Some("Alt+B"));
        assert_eq!(mnemonic("None"), None);
        assert_eq!(accelerator("&Undo\tCtrl+Z").as_deref(), Some("Control+Z"));
        assert_eq!(
            accelerator("Paste\tShift + Ins").as_deref(),
            Some("Shift+Ins")
        );
        assert_eq!(accelerator("X\tCtrlZ").as_deref(), Some("CtrlZ"));
        assert_eq!(accelerator("Plain"), None);
        assert_eq!(accelerator("Empty\t"), None);
    }

    #[test]
    fn a_window_and_its_controls_are_written_as_the_typescript_engine_writes_them() {
        let mut system = System::new();

        system.windows.push(Some(Window {
            title: "Box".to_string(),
            style: WS_SYSMENU,
            visible: true,
            active: true,
            ..Window::default()
        }));
        system.windows.push(Some(Window {
            parent: Some(0),
            visible: true,
            control: Some(ControlState {
                checked: 2,
                ..ControlState::new("button", BS_AUTO3STATE, "&Check")
            }),
            ..Window::default()
        }));
        system.windows.push(Some(Window {
            parent: Some(0),
            visible: true,
            control: Some(ControlState::new("edit", ES_MULTILINE, "text")),
            ..Window::default()
        }));
        system.z_order = vec![0, 1, 2];
        system.focus = Some(2);

        assert_eq!(
            system.accessible_tree_json(),
            concat!(
                r#"{"nodes":[{"key":"w1","role":"group","roleDescription":"window","#,
                r#""name":"Box","description":"active","children":["#,
                r#"{"key":"w1-sys","role":"button","name":"System menu","hasPopup":true,"#,
                r#""expanded":false,"children":[]},"#,
                r#"{"key":"w2","role":"checkbox","name":"Check","checked":"mixed","children":[]},"#,
                r#"{"key":"w3","role":"textbox","value":"text","multiline":true,"children":[]}"#,
                r#"]}],"focus":"w3"}"#
            )
        );
    }
}
