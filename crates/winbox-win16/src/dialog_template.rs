//! A dialog box template, as a resource holds one or a program builds one
//! in memory for `DialogBoxIndirect`, as winbox.js's `dialog-template.ts`
//! reads it: the dialog, then each control.
//!
//! The dialog: its style (a long), how many controls, its place and size in
//! dialog units (four words), its menu, its window class and its caption --
//! each a string, where a menu or class of a single nought is none and one
//! of 0FFh is followed by a resource number -- and, with `DS_SETFONT` in the
//! style, the font's size in points and its face.
//!
//! Each control: its place and size, its identifier, its style (a long),
//! its class -- a byte with its top bit set for one of USER's own, or a
//! string -- its text -- a string, or 0FFh and a resource number, as an icon
//! names its image -- and a byte counting the bytes of creation data that
//! follow.

pub const DS_SETFONT: u32 = 0x40;

/// A menu or a name: a resource number, or a string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Named {
    Number(u16),
    Text(String),
}

/// A control of a template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DialogItem {
    pub x: i16,
    pub y: i16,
    pub cx: i16,
    pub cy: i16,
    pub id: u16,
    pub style: u32,
    pub class_name: String,
    /// Its text, or the number of the resource it names.
    pub text: Named,
    /// The creation data, handed to the control's `WM_CREATE`.
    pub data: Vec<u8>,
}

/// A dialog's template.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DialogTemplate {
    pub style: u32,
    pub x: i16,
    pub y: i16,
    pub cx: i16,
    pub cy: i16,
    pub menu: Option<Named>,
    pub class_name: Option<String>,
    pub caption: String,
    /// The font's size in points and its face.
    pub font: Option<(u16, String)>,
    pub items: Vec<DialogItem>,
}

/// USER's own classes, by the byte a template names them with.
fn class_of(kind: u8) -> &'static str {
    match kind {
        0x80 => "BUTTON",
        0x81 => "EDIT",
        0x83 => "LISTBOX",
        0x84 => "SCROLLBAR",
        0x85 => "COMBOBOX",
        _ => "STATIC",
    }
}

/// A template read through `byte`, which answers the byte at an offset from
/// its start.
pub fn parse_dialog_template(byte: impl Fn(u32) -> u8) -> DialogTemplate {
    let mut reader = Reader { byte: &byte, at: 0 };
    let style = reader.u32();
    let count = reader.u8();
    let x = reader.s16();
    let y = reader.s16();
    let cx = reader.s16();
    let cy = reader.s16();
    let menu = reader.name_or_number();
    let class_name = reader.name_or_number();
    let caption = reader.text();
    let font = (style & DS_SETFONT != 0).then(|| (reader.u16(), reader.text()));
    let mut items = Vec::with_capacity(usize::from(count));

    for _ in 0..count {
        let (x, y, cx, cy) = (reader.s16(), reader.s16(), reader.s16(), reader.s16());
        let id = reader.u16();
        let style = reader.u32();
        let kind = reader.peek();
        let class_name = if kind & 0x80 != 0 {
            reader.u8();
            class_of(kind).to_string()
        } else {
            reader.text()
        };
        let text = if reader.peek() == 0xff {
            reader.u8();
            Named::Number(reader.u16())
        } else {
            Named::Text(reader.text())
        };
        let size = reader.u8();
        let data = (0..size).map(|_| reader.u8()).collect();

        items.push(DialogItem {
            x,
            y,
            cx,
            cy,
            id,
            style,
            class_name,
            text,
            data,
        });
    }

    DialogTemplate {
        style,
        x,
        y,
        cx,
        cy,
        menu,
        class_name: match class_name {
            Some(Named::Text(text)) => Some(text),
            _ => None,
        },
        caption,
        font,
        items,
    }
}

struct Reader<'a, F: Fn(u32) -> u8> {
    byte: &'a F,
    at: u32,
}

impl<F: Fn(u32) -> u8> Reader<'_, F> {
    fn peek(&self) -> u8 {
        (self.byte)(self.at)
    }

    fn u8(&mut self) -> u8 {
        let value = (self.byte)(self.at);

        self.at += 1;
        value
    }

    fn u16(&mut self) -> u16 {
        u16::from(self.u8()) | u16::from(self.u8()) << 8
    }

    fn s16(&mut self) -> i16 {
        self.u16() as i16
    }

    fn u32(&mut self) -> u32 {
        u32::from(self.u16()) | u32::from(self.u16()) << 16
    }

    fn text(&mut self) -> String {
        let mut out = String::new();

        loop {
            let c = self.u8();

            if c == 0 {
                return out;
            }

            out.push(char::from(c));
        }
    }

    /// None, a resource number after 0FFh, or a string.
    fn name_or_number(&mut self) -> Option<Named> {
        match self.peek() {
            0 => {
                self.at += 1;
                None
            }
            0xff => {
                self.at += 1;
                Some(Named::Number(self.u16()))
            }
            _ => Some(Named::Text(self.text())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_dialog_and_its_controls() {
        let mut bytes = vec![];

        bytes.extend(0x80c8_0040u32.to_le_bytes()); // DS_SETFONT and more
        bytes.push(1);
        for value in [10i16, 20, 100, 50] {
            bytes.extend(value.to_le_bytes());
        }
        bytes.push(0); // no menu
        bytes.push(0); // no class
        bytes.extend(b"Title\0");
        bytes.extend(8u16.to_le_bytes());
        bytes.extend(b"Helv\0");
        for value in [5i16, 6, 40, 14] {
            bytes.extend(value.to_le_bytes());
        }
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(0x5001_0001u32.to_le_bytes());
        bytes.push(0x80); // BUTTON
        bytes.extend(b"OK\0");
        bytes.push(0);

        let template = parse_dialog_template(|at| bytes.get(at as usize).copied().unwrap_or(0));

        assert_eq!(template.caption, "Title");
        assert_eq!(template.font, Some((8, "Helv".to_string())));
        assert_eq!(template.items.len(), 1);
        assert_eq!(template.items[0].class_name, "BUTTON");
        assert_eq!(template.items[0].text, Named::Text("OK".to_string()));
        assert_eq!(template.items[0].id, 1);
    }
}
