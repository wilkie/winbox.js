//! Initialisation files, read and written as Windows 3.1 does, as
//! winbox.js's `Profile` has it from the `profile` probe: the file kept in
//! memory as bytes, edited in place and written back whole.
//!
//! A line ends at a carriage return, the byte after it taken as the line
//! feed unseen. Loaded, each line loses its leading whitespace, and an
//! entry's line the whitespace about its `=`; a value's trailing whitespace
//! has a return written over its first byte, the rest left as a short line
//! of its own. A lookup is without regard to case; a value in matching
//! quotes loses them.

/// One line: its bytes, and the bytes that end it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Line {
    text: Vec<u8>,
    end: Vec<u8>,
}

/// A byte in lower case, as JavaScript lowers a Latin-1 character.
pub(crate) fn lower(byte: u8) -> u8 {
    match byte {
        b'A'..=b'Z' | 0xc0..=0xd6 | 0xd8..=0xde => byte + 0x20,
        _ => byte,
    }
}

fn same(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len() && left.iter().zip(right).all(|(&a, &b)| lower(a) == lower(b))
}

/// Whether a byte is whitespace as JavaScript's `trim` and `\s` take it.
pub(crate) fn js_space(byte: u8) -> bool {
    matches!(byte, 0x09..=0x0d | 0x20 | 0xa0)
}

fn trim(bytes: &[u8]) -> &[u8] {
    let start = bytes
        .iter()
        .position(|&byte| !js_space(byte))
        .unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|&byte| !js_space(byte))
        .map_or(start, |at| at + 1);

    &bytes[start..end.max(start)]
}

fn blank(byte: u8) -> bool {
    byte == b' ' || byte == b'\t'
}

fn trim_start_blanks(bytes: &[u8]) -> &[u8] {
    &bytes[bytes
        .iter()
        .position(|&byte| !blank(byte))
        .unwrap_or(bytes.len())..]
}

fn trim_end_blanks(bytes: &[u8]) -> &[u8] {
    &bytes[..bytes
        .iter()
        .rposition(|&byte| !blank(byte))
        .map_or(0, |at| at + 1)]
}

/// An entry's line taken apart.
struct Found<'a> {
    entry: &'a [u8],
    value: &'a [u8],
    raw: &'a [u8],
}

/// An initialisation file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    lines: Vec<Line>,
}

impl Profile {
    /// A file's contents, as on the disk.
    pub fn new(text: &[u8]) -> Self {
        Self {
            lines: Self::split(&Self::normalise(text)),
        }
    }

    /// The bytes as they would be written back.
    pub fn text(&self) -> Vec<u8> {
        self.lines
            .iter()
            .flat_map(|line| line.text.iter().chain(&line.end).copied())
            .collect()
    }

    /// A buffer cut into lines at each carriage return, the byte after the
    /// return part of the line's ending.
    fn split(text: &[u8]) -> Vec<Line> {
        let mut lines = Vec::new();
        let mut at = 0;

        while at < text.len() {
            let Some(cr) = text[at..]
                .iter()
                .position(|&byte| byte == b'\r')
                .map(|cr| at + cr)
            else {
                lines.push(Line {
                    text: text[at..].to_vec(),
                    end: Vec::new(),
                });
                break;
            };

            lines.push(Line {
                text: text[at..cr].to_vec(),
                end: text[cr..(cr + 2).min(text.len())].to_vec(),
            });
            at = cr + 2;
        }

        lines
    }

    /// What loading a file does to it.
    fn normalise(text: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();

        for Line { text: raw, end } in Self::split(text) {
            let mut line = trim_start_blanks(&raw).to_vec();

            if !line.starts_with(b"[")
                && !line.starts_with(b";")
                && let Some(at) = line.iter().position(|&byte| byte == b'=')
            {
                let name = trim_end_blanks(&line[..at]).to_vec();
                let rest = trim_start_blanks(&line[at + 1..]).to_vec();
                let kept = trim_end_blanks(&rest).to_vec();
                let mut compact = name;

                compact.push(b'=');
                compact.extend_from_slice(&kept);

                if kept.len() < rest.len() {
                    compact.push(b'\r');
                    compact.extend_from_slice(&rest[kept.len() + 1..]);
                }

                line = compact;
            }

            out.extend_from_slice(&line);
            out.extend_from_slice(&end);
        }

        out
    }

    /// The section a line opens, if it opens one: what sits between the
    /// brackets, whatever follows the closing one.
    fn section_of(line: &[u8]) -> Option<&[u8]> {
        let rest = line.strip_prefix(b"[")?;
        let close = rest.iter().position(|&byte| byte == b']')?;

        Some(trim(&rest[..close]))
    }

    /// A line's entry and value: the first `=` divides them; a line that
    /// begins with `;` is a comment.
    fn entry_of(line: &[u8]) -> Option<Found<'_>> {
        if line.starts_with(b";") || line.starts_with(b"[") {
            return None;
        }

        let at = line.iter().position(|&byte| byte == b'=')?;
        let raw = &line[at + 1..];

        Some(Found {
            entry: &line[..at],
            value: Self::unquote(raw),
            raw,
        })
    }

    /// One pair of matching quotes, single or double, removed.
    fn unquote(value: &[u8]) -> &[u8] {
        match value {
            [first, .., last] if (*first == b'"' || *first == b'\'') && last == first => {
                &value[1..value.len() - 1]
            }
            _ => value,
        }
    }

    /// An entry's value, the first found, quotes removed where `unquoted`;
    /// `None` where the file has none.
    pub fn get(&self, section: &[u8], entry: &[u8], unquoted: bool) -> Option<Vec<u8>> {
        let mut within = false;

        for line in &self.lines {
            if let Some(opened) = Self::section_of(&line.text) {
                within = same(opened, section);
                continue;
            }

            if !within {
                continue;
            }

            if let Some(found) = Self::entry_of(&line.text)
                && same(found.entry, entry)
            {
                return Some(if unquoted { found.value } else { found.raw }.to_vec());
            }
        }

        None
    }

    /// Every entry's name in a section, in the file's order.
    pub fn entries(&self, section: &[u8]) -> Vec<Vec<u8>> {
        let mut names = Vec::new();
        let mut within = false;

        for line in &self.lines {
            if let Some(opened) = Self::section_of(&line.text) {
                within = same(opened, section);
                continue;
            }

            if within && let Some(found) = Self::entry_of(&line.text) {
                names.push(found.entry.to_vec());
            }
        }

        names
    }

    /// An entry set, the section or the entry added where the file lacks
    /// it; `None` removes the entry, never its section. A replaced entry
    /// keeps its name as the file spells it; a new one goes after its
    /// section's last entry; a new section after the file's last complete
    /// line, after a blank one.
    pub fn set(&mut self, section: &[u8], entry: &[u8], value: Option<&[u8]>) {
        let lines = &mut self.lines;
        let mut within = false;
        let mut seen = false;
        let mut end_of_section = None;

        for at in 0..lines.len() {
            if let Some(opened) = Self::section_of(&lines[at].text) {
                if within {
                    end_of_section = Some(at);
                }

                within = same(opened, section);
                seen = seen || within;
                continue;
            }

            let found = if within {
                Self::entry_of(&lines[at].text).map(|found| found.entry.to_vec())
            } else {
                None
            };

            if let Some(name) = found
                && same(&name, entry)
            {
                match value {
                    None => {
                        lines.remove(at);
                    }
                    Some(value) => {
                        let mut text = name;

                        text.push(b'=');
                        text.extend_from_slice(value);
                        lines[at] = Line {
                            text,
                            end: b"\r\n".to_vec(),
                        };
                    }
                }

                return;
            }
        }

        let Some(value) = value else {
            return;
        };

        if within {
            end_of_section = Some(lines.len());
        }

        let mut entry_line = entry.to_vec();

        entry_line.push(b'=');
        entry_line.extend_from_slice(value);

        let line = |text: Vec<u8>| Line {
            text,
            end: b"\r\n".to_vec(),
        };

        if seen {
            let mut at = end_of_section.unwrap_or(lines.len());

            while at > 0 && trim(&lines[at - 1].text).is_empty() {
                at -= 1;
            }

            lines.insert(at, line(entry_line));
        } else {
            let mut at = lines.len();

            if at > 0 && !lines[at - 1].end.starts_with(b"\r") {
                at -= 1;
            }

            let mut heading = vec![b'['];

            heading.extend_from_slice(section);
            heading.push(b']');

            let mut added = vec![line(heading), line(entry_line)];

            if at > 0 {
                added.insert(0, line(Vec::new()));
            }

            lines.splice(at..at, added);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_as_windows_loads_a_file() {
        let profile = Profile::new(b"  [S]\r\n ends  =  both ends  \r\n");

        assert_eq!(profile.text(), b"[S]\r\nends=both ends\r \r\n");
        assert_eq!(
            profile.get(b"s", b"ENDS", true),
            Some(b"both ends".to_vec())
        );
    }

    #[test]
    fn sets_entries_and_sections_where_windows_puts_them() {
        let mut profile = Profile::new(b"[A]\r\nx=1\r\n\r\n[B]\r\ny=2\r\n");

        profile.set(b"A", b"z", Some(b"3"));
        profile.set(b"C", b"w", Some(b"\"4\""));
        assert_eq!(
            profile.text(),
            b"[A]\r\nx=1\r\nz=3\r\n\r\n[B]\r\ny=2\r\n\r\n[C]\r\nw=\"4\"\r\n"
        );
        assert_eq!(profile.get(b"C", b"w", true), Some(b"4".to_vec()));
        assert_eq!(profile.get(b"C", b"w", false), Some(b"\"4\"".to_vec()));
        profile.set(b"B", b"y", None);
        assert_eq!(profile.entries(b"b"), Vec::<Vec<u8>>::new());
    }
}
