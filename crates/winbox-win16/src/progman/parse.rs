//! An execute string read as `PROGMAN.EXE` reads it (seg7 `001c`-`030b`),
//! before any command in it is carried out. As
//! `src/win16/progman/parse.ts`.
//!
//! The string is the client's block, and is read in place: a `]`-less name
//! is ended with a nought written over what follows it and put back, and
//! each argument is ended by a nought written into the block, over the
//! comma, the bracket, the closing quote or the first trailing whitespace
//! after it. The client sees those noughts in its block after the
//! acknowledgement. An argument is its offset in the block.
//!
//! Letters are USER's (`IsCharAlpha`) and names are compared by USER's
//! `lstrcmpi`, each called as the file calls it.

use super::main::{Pm, R};
use crate::commdlg::api::{self, Arg};

/// The commands' names, in the table at DS `02A8`; a command is its index
/// here (the handlers' table at seg7 `0ade`).
pub(crate) const NAMES: [&[u8]; 8] = [
    b"CreateGroup",
    b"AddItem",
    b"DeleteGroup",
    b"ExitProgman",
    b"ShowGroup",
    b"DeleteItem",
    b"ReplaceItem",
    b"Reload",
];

pub(crate) const CREATE_GROUP: u16 = 0;
pub(crate) const ADD_ITEM: u16 = 1;
pub(crate) const DELETE_GROUP: u16 = 2;
pub(crate) const EXIT_PROGMAN: u16 = 3;
pub(crate) const SHOW_GROUP: u16 = 4;
pub(crate) const DELETE_ITEM: u16 = 5;
pub(crate) const REPLACE_ITEM: u16 = 6;
pub(crate) const RELOAD: u16 = 7;

/// A command read: its index in `NAMES` and its arguments' offsets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Command {
    pub index: u16,
    pub args: Vec<usize>,
}

/// The client's block, as the file reads and writes it.
pub(crate) struct Block {
    pub bytes: Vec<u8>,
}

impl Block {
    /// The byte at an offset; past the block, nought. (The file would read
    /// on past its end, to the selector's limit.)
    pub(crate) fn at(&self, offset: usize) -> u8 {
        self.bytes.get(offset).copied().unwrap_or(0)
    }

    pub(crate) fn set(&mut self, offset: usize, byte: u8) {
        if let Some(place) = self.bytes.get_mut(offset) {
            *place = byte;
        }
    }

    /// The string at an offset, to its nought.
    pub(crate) fn string(&self, offset: usize) -> Vec<u8> {
        let rest = self.bytes.get(offset..).unwrap_or(&[]);
        let end = rest.iter().position(|&b| b == 0).unwrap_or(rest.len());

        rest[..end].to_vec()
    }
}

/// Whitespace as seg7 `0021` has it: a byte up to 20h compared signed, so
/// 80h-FFh too.
pub(crate) fn white(byte: u8) -> bool {
    (byte as i8) <= 0x20
}

/// `001c`: past whitespace, to the next other byte or the nought.
fn skip(block: &Block, mut p: usize) -> usize {
    while block.at(p) != 0 && white(block.at(p)) {
        p += 1;
    }

    p
}

/// `003d`: past whitespace, a run of `IsCharAlpha` letters, looked up in
/// `NAMES` by `lstrcmpi` with a nought put after it and taken away again.
/// Where it ends, and its index; none for a name not there.
async fn name(pm: &Pm<'_>, block: &mut Block, p: usize) -> R<(usize, Option<u16>)> {
    let start = skip(block, p);
    let mut end = start;

    while pm
        .user("IsCharAlpha", &[Arg::W(u16::from(block.at(end)))])
        .await? as u16
        != 0
    {
        end += 1;
    }

    let word = block.bytes.get(start..end).unwrap_or(&[]).to_vec();
    let mut index = None;

    for (at, entry) in NAMES.iter().enumerate() {
        let compared = pm
            .user("lstrcmpi", &[api::text(entry), api::text(&word)])
            .await?;

        if compared as u16 == 0 {
            index = Some(at as u16);
            break;
        }
    }

    Ok((end, index))
}

/// `00cd`: an argument at `p`, never at whitespace. Its offset and where
/// reading goes on; none where the string is refused.
///
/// - `"`: to the next `"`, which becomes a nought -- none where there is
///   none; then whitespace and one comma passed.
/// - `,`: an empty argument, the comma a nought.
/// - `]`, `(` or `[`: refused.
/// - `)`: nothing taken; its slot keeps its nought, offset 0.
/// - anything else: to the next `,` or `)`, refused at `]`, `[` or `(`; a
///   comma passed; a nought after its last byte above 20h (signed), so its
///   trailing whitespace goes.
fn argument(block: &mut Block, mut p: usize) -> Option<(usize, usize)> {
    let c = block.at(p);

    match c {
        b']' | b'(' | b'[' => None,
        b')' => Some((0, p)),
        b',' => {
            block.set(p, 0);
            Some((p, p + 1))
        }
        b'"' => {
            p += 1;

            let slot = p;

            while block.at(p) != 0 && block.at(p) != b'"' {
                p += 1;
            }

            if block.at(p) == 0 {
                return None;
            }

            block.set(p, 0);
            p = skip(block, p + 1);

            if block.at(p) == b',' {
                p += 1;
            }

            Some((slot, p))
        }
        _ => {
            let slot = p;
            let mut last = p;

            while block.at(p) != 0 {
                match block.at(p) {
                    b',' | b')' => break,
                    b']' | b'[' | b'(' => return None,
                    byte if !white(byte) => last = p,
                    _ => {}
                }

                p += 1;
            }

            if block.at(p) == b',' {
                p += 1;
            }

            block.set(last + 1, 0);
            Some((slot, p))
        }
    }
}

/// `01c8`: the whole string read into commands, or none where anything in
/// it is refused. The file keeps them in a block of its own,
/// `GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 100h)`, locked as it reads
/// and freed where it refuses; so does this, the commands kept here.
///
/// An empty string is no commands; whitespace alone is refused (`0211`).
/// Each command is `[`, a name, and `]`, with an optional `(` and
/// arguments `)` between; whitespace before each part.
///
/// Not followed: the file's block has room for 128 words -- a command's
/// index, its count and its arguments' offsets, and the last -1 -- and
/// writes past it where a string has more.
pub(crate) async fn parse(pm: &Pm<'_>, block: &mut Block) -> R<Option<(u16, Vec<Command>)>> {
    let list = pm
        .kernel("GlobalAlloc", &[Arg::W(0x42), Arg::D(0x100)])
        .await? as u16;

    if list == 0 {
        return Ok(None);
    }

    pm.kernel("GlobalLock", &[Arg::W(list)]).await?;

    let commands = read(pm, block).await?;

    pm.kernel("GlobalUnlock", &[Arg::W(list)]).await?;

    // Freed once the commands are done (`0aff`).
    if let Some(commands) = commands {
        return Ok(Some((list, commands)));
    }

    pm.kernel("GlobalFree", &[Arg::W(list)]).await?;
    Ok(None)
}

/// `01ff`-`02fb`: the reading itself.
async fn read(pm: &Pm<'_>, block: &mut Block) -> R<Option<Vec<Command>>> {
    let mut commands = Vec::new();
    let mut p = 0;

    while block.at(p) != 0 {
        p = skip(block, p);

        if block.at(p) == 0 {
            return Ok((!commands.is_empty()).then_some(commands));
        }

        if block.at(p) != b'[' {
            return Ok(None);
        }

        let (end, index) = name(pm, block, p + 1).await?;
        let Some(index) = index else {
            return Ok(None);
        };
        let mut args = Vec::new();

        p = skip(block, end);

        if block.at(p) == b'(' {
            p += 1;

            loop {
                p = skip(block, p);

                if block.at(p) == b')' {
                    break;
                }

                if block.at(p) == 0 {
                    return Ok(None);
                }

                let Some((slot, next)) = argument(block, p) else {
                    return Ok(None);
                };

                args.push(slot);
                p = next;

                if block.at(p) == 0 {
                    break;
                }
            }

            p = skip(block, p + 1);
        }

        commands.push(Command { index, args });

        if block.at(p) != b']' {
            return Ok(None);
        }

        p += 1;
    }

    Ok(Some(commands))
}

/// A number as seg3 `0285` reads one, from an argument.
pub(crate) fn number(block: &Block, offset: usize) -> u16 {
    super::main::read_number(&block.string(offset))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(text: &[u8]) -> Block {
        let mut bytes = text.to_vec();

        bytes.push(0);
        Block { bytes }
    }

    #[test]
    fn whitespace_is_signed() {
        assert!(white(b' '));
        assert!(white(b'\t'));
        assert!(white(0xe9));
        assert!(!white(b'!'));
        assert!(!white(0x7f));
    }

    #[test]
    fn unquoted_arguments_lose_trailing_whitespace() {
        let mut b = block(b"Spaced name  )]");

        assert_eq!(argument(&mut b, 0), Some((0, 13)));
        assert_eq!(b.string(0), b"Spaced name");
    }

    #[test]
    fn high_bytes_at_the_end_go() {
        let mut b = block(b"Caf\xe9)");

        assert_eq!(argument(&mut b, 0), Some((0, 4)));
        assert_eq!(b.string(0), b"Caf");
    }

    #[test]
    fn quoted_arguments_pass_whitespace_and_one_comma() {
        let mut b = block(b"\"Quoted\" , \"Icon\")");
        let (slot, next) = argument(&mut b, 0).unwrap();

        assert_eq!(b.string(slot), b"Quoted");
        // Past the comma; the whitespace after it is the next argument's
        // reader's to pass.
        assert_eq!(next, 10);
        assert_eq!(b.at(skip(&b, next)), b'"');

        let mut c = block(b"\"Ca\"\"lc\")");
        let (first, next) = argument(&mut c, 0).unwrap();
        let (second, _) = argument(&mut c, next).unwrap();

        assert_eq!(c.string(first), b"Ca");
        assert_eq!(c.string(second), b"lc");
    }

    #[test]
    fn refusals() {
        assert_eq!(argument(&mut block(b"\"Unclosed)]"), 0), None);
        assert_eq!(argument(&mut block(b"Bracket[)]"), 0), None);
        assert_eq!(argument(&mut block(b"Paren\\(x)]"), 0), None);
        assert_eq!(argument(&mut block(b"]"), 0), None);
    }

    #[test]
    fn an_empty_argument_is_its_comma() {
        let mut b = block(b",,)");

        assert_eq!(argument(&mut b, 0), Some((0, 1)));
        assert_eq!(b.at(0), 0);
    }
}
