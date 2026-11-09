//! Initialisation files, read and written as Windows 3.1 does, as
//! winbox.js's `Profile` has it from the `profile` and `profnul` probes: the
//! file kept in memory as bytes, edited in place and written back whole.
//!
//! A line runs to a line feed, as KERNEL steps through the buffer; its text
//! is what comes before its first carriage return. Loaded, each line loses
//! its leading whitespace, and an entry's line the whitespace about its
//! `=`; a value's trailing blanks stay, until a read of it writes the byte
//! that ended it over the first of them. A lookup is without regard to
//! case; a value in matching quotes loses them.

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

    /// A buffer cut into lines, each running to and taking in a line feed,
    /// as KERNEL steps from line to line; the text of each is what comes
    /// before its first carriage return, the rest its ending.
    fn split(text: &[u8]) -> Vec<Line> {
        let mut lines = Vec::new();
        let mut at = 0;

        while at < text.len() {
            let next = text[at..]
                .iter()
                .position(|&byte| byte == b'\n')
                .map_or(text.len(), |lf| at + lf + 1);
            let whole = &text[at..next];

            // Its text to its first return, or to its line feed.
            let cut = whole
                .iter()
                .position(|&byte| byte == b'\r')
                .unwrap_or(whole.len() - usize::from(whole.last() == Some(&b'\n')));

            lines.push(Line {
                text: whole[..cut].to_vec(),
                end: whole[cut..].to_vec(),
            });

            at = next;
        }

        lines
    }

    /// KERNEL's measure of a string it is given or holds (`KRNL386.EXE`
    /// seg1 `6864`): to the first byte at or below `0Dh`, back over the
    /// spaces before it; where there are any, the byte that ended it written
    /// over the first. The string so measured, and the string as that left
    /// it.
    pub fn measure(text: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let stop = text
            .iter()
            .position(|&byte| byte <= 0x0d)
            .unwrap_or(text.len());
        let mut cut = stop;

        while cut > 0 && text[cut - 1] == b' ' {
            cut -= 1;
        }

        let mut after = text.to_vec();

        if cut < stop {
            after[cut] = text.get(stop).copied().unwrap_or(0);
        }

        (text[..cut].to_vec(), after)
    }

    /// What loading a file does to it (`KRNL386.EXE` seg1 `6b77`-`6c89`):
    /// the whitespace at the start of every line dropped, and on a line
    /// with an `=` the blanks before and after it; the rest copied as it
    /// was, a value's trailing blanks with it (`profnul`) -- a comment's and
    /// a section's line compacted too, under Windows in protected mode
    /// (`WF_PMODE` at `6b92`).
    fn normalise(text: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();

        for Line { text: raw, end } in Self::split(text) {
            let mut line = trim_start_blanks(&raw).to_vec();

            if let Some(at) = line.iter().position(|&byte| byte == b'=') {
                let mut compact = trim_end_blanks(&line[..at]).to_vec();

                compact.push(b'=');
                compact.extend_from_slice(trim_start_blanks(&line[at + 1..]));
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

    /// A line's entry and value: the first `=` divides them, the value
    /// measured as KERNEL reads it (`measure`); a line that begins with `;`
    /// is a comment.
    fn entry_of(line: &[u8]) -> Option<Found<'_>> {
        if line.starts_with(b";") || line.starts_with(b"[") {
            return None;
        }

        let at = line.iter().position(|&byte| byte == b'=')?;
        let rest = &line[at + 1..];
        let raw = &rest[..Self::measure(rest).0.len()];

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

    /// Where a line starts in the buffer.
    fn offset_of(&self, index: usize) -> usize {
        self.lines[..index]
            .iter()
            .map(|line| line.text.len() + line.end.len())
            .sum()
    }

    /// The buffer as KERNEL holds it, the file and the return, line feed and
    /// nought it adds as it loads one (`KRNL386.EXE` seg1 `6ca8`-`6cdf`),
    /// edited; the file is what is left less those three, as KERNEL writes
    /// `[0Ah]` less three (`70ef`-`710a`).
    fn edit(&mut self, edit: impl FnOnce(Vec<u8>) -> Vec<u8>) {
        let mut buffer = self.text();

        buffer.extend_from_slice(b"\r\n\0");

        let buffer = edit(buffer);

        self.lines = Self::split(&buffer[..buffer.len().saturating_sub(3)]);
    }

    /// An entry's line taken out (`KRNL386.EXE` seg1 `722c`): from its start
    /// to after the next line feed, KERNEL's own after a last line with
    /// none (`profnul`'s `open entry`).
    fn remove_line(&mut self, index: usize) {
        let start = self.offset_of(index);

        self.edit(|mut buffer| {
            let lf = buffer[start..]
                .iter()
                .position(|&byte| byte == b'\n')
                .map_or(buffer.len(), |lf| start + lf + 1);

            buffer.drain(start..lf);
            buffer
        });
    }

    fn heading(&self, section: &[u8]) -> Option<usize> {
        self.lines.iter().position(|line| {
            Self::section_of(&line.text).is_some_and(|opened| same(opened, section))
        })
    }

    /// Whether the file has a section, as `WritePrivateProfileString` looks
    /// for one (`KRNL386.EXE` seg1 `66ac`).
    pub fn has_section(&self, section: &[u8]) -> bool {
        self.heading(section).is_some()
    }

    /// The first section of the name removed, as `WritePrivateProfileString`
    /// with no entry removes it (`KRNL386.EXE` seg1 `703f`, `71cb`-`7229`):
    /// from the heading's last `[` every line to the next that starts with
    /// `[`, or to the file's end, but a line that starts with `;` kept,
    /// moved up to where the heading was.
    pub fn remove_section(&mut self, section: &[u8]) {
        let Some(index) = self.heading(section) else {
            return;
        };
        let line = &self.lines[index];
        let after = self.offset_of(index) + line.text.len() + line.end.len();

        self.edit(|buffer| {
            let to = buffer[..after]
                .iter()
                .rposition(|&byte| byte == b'[')
                .unwrap_or(0);
            let line_end = |from: usize| {
                buffer[from..]
                    .iter()
                    .position(|&byte| byte == b'\n')
                    .map_or(buffer.len(), |lf| from + lf + 1)
            };
            let mut read = to + 1;
            let mut kept = Vec::new();

            loop {
                match buffer.get(read).copied() {
                    Some(b';') => {
                        let end = line_end(read);

                        kept.extend_from_slice(&buffer[read..end]);
                        read = end;
                    }
                    Some(b'[') => break,
                    Some(0) | None => {
                        // At the nought, back before KERNEL's return and line
                        // feed (`71f7`).
                        read = read.saturating_sub(2);
                        break;
                    }
                    Some(_) => read = line_end(read),
                }
            }

            let mut out = buffer[..to].to_vec();

            out.extend_from_slice(&kept);
            out.extend_from_slice(&buffer[read..]);
            out
        });
    }

    /// Whether an entry's value is the caller's string, as KERNEL compares
    /// them before it writes (`KRNL386.EXE` seg1 `7150`): byte for byte,
    /// from after the `=` to the buffer's first return.
    pub fn holds(&self, section: &[u8], entry: &[u8], given: &[u8]) -> bool {
        let mut within = false;

        for line in &self.lines {
            if let Some(opened) = Self::section_of(&line.text) {
                within = same(opened, section);
                continue;
            }

            if within
                && let Some(found) = Self::entry_of(&line.text)
                && same(found.entry, entry)
            {
                if !line.end.starts_with(b"\r") && !line.end.is_empty() {
                    return false;
                }

                return line.text[found.entry.len() + 1..] == *given;
            }
        }

        false
    }

    /// A value read as `GetPrivateProfileString` reads it, which cuts its
    /// trailing spaces in the buffer (`KRNL386.EXE` seg1 `6569`-`656c`,
    /// `6864`): the byte that ended it written over the first of them.
    pub fn read(&mut self, section: &[u8], entry: &[u8]) -> Option<Vec<u8>> {
        let mut within = false;

        for index in 0..self.lines.len() {
            let line = &self.lines[index];

            if let Some(opened) = Self::section_of(&line.text) {
                within = same(opened, section);
                continue;
            }

            let Some(found) = (if within {
                Self::entry_of(&line.text)
            } else {
                None
            }) else {
                continue;
            };

            if !same(found.entry, entry) {
                continue;
            }

            let value = found.value.to_vec();
            let start = found.entry.len() + 1;
            let ends = line.end.contains(&b'\n');
            let mut whole = [&line.text[..], &line.end[..]].concat();

            if !ends {
                whole.push(b'\r');
            }

            let (_, after) = Self::measure(&whole[start..]);
            let mut changed = whole[..start].to_vec();

            changed.extend_from_slice(&after);

            if changed != whole {
                if !ends {
                    changed.pop();
                }

                self.lines.splice(index..=index, Self::split(&changed));
            }

            return Some(value);
        }

        None
    }

    /// An entry set, the section or the entry added where the file lacks
    /// it; `None` removes the entry's line (`remove_line`), never its
    /// section. A replaced entry
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
                    None => self.remove_line(at),
                    Some(value) => {
                        // The value from after the `=`, a return and a line
                        // feed over the old ending's first two bytes
                        // (`KRNL386.EXE` seg1 `6e06`-`6e1a`, `72b5`).
                        let end = &lines[at].end;
                        let ending = if end.len() >= 2 {
                            [b"\r\n", &end[2..]].concat()
                        } else if end.is_empty() {
                            Vec::new()
                        } else {
                            b"\r\n".to_vec()
                        };
                        let mut text = name;

                        text.push(b'=');
                        text.extend_from_slice(value);
                        text.extend_from_slice(&ending);
                        lines.splice(at..=at, Self::split(&text));
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
            // From the buffer's end, back over every return and line feed
            // to the last other byte; three on from it the section goes,
            // `\r\n` before its heading unless that is the buffer's start
            // (`KRNL386.EXE` seg1 `6e49`-`6e7b`, `726a`).
            let text = self.text();
            let at = text
                .iter()
                .rposition(|&byte| byte != b'\r' && byte != b'\n')
                .map_or(0, |last| (last + 3).min(text.len()));
            let mut added = Vec::new();

            if at > 0 {
                added.extend_from_slice(b"\r\n");
            }

            added.push(b'[');
            added.extend_from_slice(section);
            added.extend_from_slice(b"]\r\n");
            added.extend_from_slice(&entry_line);
            added.extend_from_slice(b"\r\n");

            let mut whole = text[..at].to_vec();

            whole.extend_from_slice(&added);
            whole.extend_from_slice(&text[at..]);
            self.lines = Self::split(&whole);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_as_windows_loads_a_file() {
        let mut profile = Profile::new(b"  [S]\r\n ends  =  both ends  \r\none=x \r\n");

        assert_eq!(profile.text(), b"[S]\r\nends=both ends  \r\none=x \r\n");
        assert_eq!(
            profile.get(b"s", b"ENDS", true),
            Some(b"both ends".to_vec())
        );
        assert_eq!(profile.read(b"s", b"ENDS"), Some(b"both ends".to_vec()));
        assert_eq!(profile.read(b"s", b"one"), Some(b"x".to_vec()));
        assert_eq!(profile.text(), b"[S]\r\nends=both ends\r \r\none=x\r\r\n");
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

    #[test]
    fn removes_sections_and_entries_as_kernel_does() {
        let base: &[u8] =
            b"[First]\r\na=1\r\n\r\n[Gone]\r\nx=1\r\n; kept comment\r\ny=  two  \r\n\r\n[Last]\r\nz=3\r\n";
        let mut profile = Profile::new(base);

        profile.remove_section(b"gONE");
        assert_eq!(
            profile.text(),
            b"[First]\r\na=1\r\n\r\n; kept comment\r\n[Last]\r\nz=3\r\n"
        );

        let mut profile = Profile::new(base);

        profile.remove_section(b"Last");
        assert_eq!(
            profile.text(),
            b"[First]\r\na=1\r\n\r\n[Gone]\r\nx=1\r\n; kept comment\r\ny=two  \r\n\r\n"
        );

        let mut profile = Profile::new(b"[A]\r\na=1\r\n[B]\r\nb=2");

        profile.set(b"B", b"b", None);
        assert_eq!(profile.text(), b"[A]\r\na=1\r\n[B]");
    }
}
