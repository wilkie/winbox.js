//! `mciExecute`: a command string run, and its error, if any, shown in a
//! box.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg5 `1293`, its token `22d5`);
//! **recorded** by `mmmisc`:
//!
//! * The command goes to `mciSendString` with no buffer for an answer and
//!   no window. Nought is TRUE.
//! * Else the error's text, `mciGetErrorString`'s into 80h bytes -- or,
//!   with none, MMSYSTEM's string 7D1h, "Unknown error returned from MCI
//!   command" -- is put in a box of `MB_ICONHAND`, with no owner, its title
//!   the word after the command: the spaces before the command skipped,
//!   then the command, then the spaces after it, then a word as MCI reads
//!   one (a quoted run kept whole, its quotes taken off, `""` within it one
//!   quote). With no word, the title is empty; with an unclosed quote, there
//!   is none and the box says "Error". The answer is FALSE.

use crate::call::{Answer, Args, Later, Stop, call_named};
use crate::drivers::lpcstr;
use crate::engine::{Engine, GuestArg};

use super::strings;

const MB_ICONHAND: u16 = 0x10;

/// A word as MMSYSTEM reads one (seg5 `22d5`), up to a space: the word, or
/// `None` for one it refuses.
pub fn token(text: &[u8], from: usize) -> Option<Vec<u8>> {
    let mut at = from;
    let mut quotes = true;
    let mut open_quote = false;
    let mut saw_quote = false;

    while let Some(&c) = text.get(at) {
        if c == b' ' && !open_quote {
            break;
        }

        if c == b'"' && quotes {
            if open_quote {
                if text.get(at + 1) == Some(&b'"') {
                    at += 1;
                } else {
                    open_quote = false;
                }
            } else {
                open_quote = true;
                saw_quote = true;
            }
        } else if !open_quote {
            if saw_quote {
                // MCIERR_NO_ELEMENT_ALLOWED: a quote closed, then more.
                return None;
            }

            quotes = false;
        }

        at += 1;
    }

    if open_quote {
        // MCIERR_NO_CLOSING_QUOTE.
        return None;
    }

    let mut word = Vec::new();
    let mut inside = false;
    let mut index = from;

    while index < at {
        let c = text[index];

        if c == b'"' && quotes {
            if inside {
                if text.get(index + 1) == Some(&b'"') {
                    word.push(b'"');
                    index += 1;
                } else {
                    inside = false;
                }
            } else {
                inside = true;
            }
        } else {
            word.push(c);
        }

        index += 1;
    }

    Some(word)
}

fn text(bytes: &[u8]) -> GuestArg {
    GuestArg::Struct([bytes, &[0]].concat())
}

/// `mciExecute`: whether the command succeeded.
pub fn mci_execute(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let command = {
            let system = engine.system();
            let far = args.dword(&system);

            lpcstr(&system, far)
        };
        let given = command.as_deref().map_or(GuestArg::Long(0), text);
        let sent = [
            given,
            GuestArg::Long(0),
            GuestArg::Word(0),
            GuestArg::Word(0),
        ];
        let answer = call(engine, "MMSYSTEM", "mciSendString", &sent).await?.0;

        if answer == 0 {
            return Ok(Answer::Word(1));
        }

        let asked = [
            GuestArg::Long(answer),
            GuestArg::Struct(vec![0; 0x80]),
            GuestArg::Word(0x80),
        ];
        let (found, structures) = call(engine, "MMSYSTEM", "mciGetErrorString", &asked).await?;
        let message = if found != 0 {
            let bytes = structures.into_iter().next().unwrap_or_default();
            let end = bytes
                .iter()
                .position(|&byte| byte == 0)
                .unwrap_or(bytes.len());

            bytes[..end].to_vec()
        } else {
            let text = strings::string(0x7d1).unwrap_or_default();

            text[..text.len().min(0x7f)].to_vec()
        };
        let title = command.as_deref().and_then(|command| {
            let mut at = 0;

            while command.get(at) == Some(&b' ') {
                at += 1;
            }

            while command.get(at).is_some_and(|&byte| byte != b' ') {
                at += 1;
            }

            while command.get(at) == Some(&b' ') {
                at += 1;
            }

            token(command, at)
        });
        let shown = [
            GuestArg::Word(0),
            text(&message),
            title.as_deref().map_or(GuestArg::Long(0), text),
            GuestArg::Word(MB_ICONHAND),
        ];

        call(engine, "USER", "MessageBox", &shown).await?;
        Ok(Answer::Word(0))
    })
}

async fn call(
    engine: &Engine,
    module: &'static str,
    name: &'static str,
    args: &[GuestArg],
) -> Result<(u32, Vec<Vec<u8>>), Stop> {
    let (answer, structures) = Box::pin(call_named(engine, module, name, args)).await?;

    Ok((answer.value().unwrap_or(0), structures))
}

#[cfg(test)]
mod tests {
    use super::token;

    /// A word, a quoted run with a doubled quote in it, and the refusals.
    #[test]
    fn words_are_read_as_mci_reads_them() {
        assert_eq!(
            token(b"play waveaudio from", 5),
            Some(b"waveaudio".to_vec())
        );
        assert_eq!(
            token(b"\"a \"\"b\"\" c\" d", 0),
            Some(b"a \"b\" c".to_vec())
        );
        assert_eq!(token(b"ab\"c d", 0), Some(b"ab\"c".to_vec()));
        assert_eq!(token(b"", 0), Some(Vec::new()));
        assert_eq!(token(b"\"open", 0), None);
        assert_eq!(token(b"\"a\"b", 0), None);
    }
}
