//! MCI's string interface: a command as words, run as the command it names,
//! and the answer given back as text. **Recorded** by `sndplay`, in an
//! installation with no sound driver, as Flak of the corpus opens its
//! music:
//!
//! * `open`, with `type` and `alias` or without, answers the new device's
//!   ID, `1`; a name the task has open already, as an alias, answers 121h;
//!   a file that is not there 113h.
//! * `status` answers a number -- the length, the position -- or a word: the
//!   mode, `stopped`; the time format, `song pointer` or `milliseconds`;
//!   whether the device is ready, `false`. An item there is none of answers
//!   122h.
//! * `set ... time format` changes the format the length is in; `seek ... to
//!   start` and `stop` answer nought; `play` the driver's error; `info ...
//!   product` the driver's name; `sysinfo all quantity` and `name` the
//!   devices `[mci]` names.
//! * `close all` closes every device the task has open.
//! * A device the task has not open answers 107h; a command with no device,
//!   124h; nothing at all, 10Bh.
//! * The text is nothing where the answer is an error or has no text.
//!
//! Not recorded, and answered as MCI's documentation has them: a command
//! there is none of (105h, as MMSYSTEM's own error for it), `notify`'s
//! window, and a return buffer too small (10Ch).

use crate::call::{Answer, Args, Later, Stop};
use crate::drivers::lpcstr;
use crate::engine::Engine;
use crate::profile::{js_space, lower};

use super::mci::{MCI_ALL_DEVICE_ID, find, long_at};
use super::strings;

const MCI_OPEN: u16 = 0x803;
const MCI_CLOSE: u16 = 0x804;
const MCI_PLAY: u16 = 0x806;
const MCI_SEEK: u16 = 0x807;
const MCI_STOP: u16 = 0x808;
const MCI_PAUSE: u16 = 0x809;
const MCI_INFO: u16 = 0x80a;
const MCI_SET: u16 = 0x80d;
const MCI_SYSINFO: u16 = 0x810;
const MCI_STATUS: u16 = 0x814;
const MCI_RESUME: u16 = 0x855;

const MCI_NOTIFY: u32 = 0x1;
const MCI_WAIT: u32 = 0x2;
const MCI_FROM: u32 = 0x4;
const MCI_TO: u32 = 0x8;
const MCI_OPEN_SHAREABLE: u32 = 0x100;
const MCI_OPEN_ELEMENT: u32 = 0x200;
const MCI_OPEN_ALIAS: u32 = 0x400;
const MCI_OPEN_TYPE: u32 = 0x2000;
const MCI_SEEK_TO_START: u32 = 0x100;
const MCI_SEEK_TO_END: u32 = 0x200;
const MCI_STATUS_ITEM: u32 = 0x100;
const MCI_SET_TIME_FORMAT: u32 = 0x400;
const MCI_INFO_PRODUCT: u32 = 0x100;
const MCI_INFO_FILE: u32 = 0x200;
const MCI_SYSINFO_QUANTITY: u32 = 0x100;
const MCI_SYSINFO_OPEN: u32 = 0x200;
const MCI_SYSINFO_NAME: u32 = 0x400;

const MCIERR_UNRECOGNIZED_COMMAND: u32 = 0x105;
const MCIERR_INVALID_DEVICE_NAME: u32 = 0x107;
const MCIERR_MISSING_COMMAND_STRING: u32 = 0x10b;
const MCIERR_PARAM_OVERFLOW: u32 = 0x10c;
const MCIERR_UNRECOGNIZED_KEYWORD: u32 = 0x122;
const MCIERR_MISSING_DEVICE_NAME: u32 = 0x124;
const MCIERR_BAD_TIME_FORMAT: u32 = 0x125;

/// How a status item answers: a number, a word of MMSYSTEM's by value, a
/// time format's name, or true or false.
#[derive(Clone, Copy)]
enum Shown {
    Number,
    Mode,
    Format,
    Boolean,
}

/// The status items, and how each answers.
const ITEMS: &[(&[u8], u32, Shown)] = &[
    (b"length", 1, Shown::Number),
    (b"position", 2, Shown::Number),
    (b"number of tracks", 3, Shown::Number),
    (b"mode", 4, Shown::Mode),
    (b"media present", 5, Shown::Boolean),
    (b"time format", 6, Shown::Format),
    (b"ready", 7, Shown::Boolean),
    (b"current track", 8, Shown::Number),
];

/// The time formats by name, as `set` takes them and `status` gives them.
const FORMATS: &[(&[u8], u32)] = &[
    (b"milliseconds", 0),
    (b"ms", 0),
    (b"hms", 1),
    (b"msf", 2),
    (b"frames", 3),
    (b"smpte 24", 4),
    (b"smpte 25", 5),
    (b"smpte 30", 6),
    (b"smpte 30 drop", 7),
    (b"bytes", 8),
    (b"samples", 9),
    (b"tmsf", 10),
    (b"song pointer", 0x4001),
];

/// Bytes in lower case, as JavaScript lowers Latin-1.
fn lowered(bytes: &[u8]) -> Vec<u8> {
    bytes.iter().map(|&byte| lower(byte)).collect()
}

/// The words of a command: split at spaces, a double-quoted run kept whole
/// (`/"([^"]*)"|(\S+)/g`).
fn words_of(command: &[u8]) -> Vec<Vec<u8>> {
    let mut words = Vec::new();
    let mut at = 0;

    while at < command.len() {
        if js_space(command[at]) {
            at += 1;
            continue;
        }

        if command[at] == b'"'
            && let Some(close) = command[at + 1..].iter().position(|&byte| byte == b'"')
        {
            words.push(command[at + 1..at + 1 + close].to_vec());
            at += close + 2;
            continue;
        }

        let end = command[at..]
            .iter()
            .position(|&byte| js_space(byte))
            .map_or(command.len(), |length| at + length);

        words.push(command[at..end].to_vec());
        at = end;
    }

    words
}

/// A run of words, taken from the front where it is there.
fn takes(words: &mut Vec<Vec<u8>>, wanted: &[&[u8]]) -> bool {
    if wanted
        .iter()
        .enumerate()
        .all(|(at, word)| words.get(at).is_some_and(|each| lowered(each) == *word))
    {
        words.drain(..wanted.len());
        return true;
    }

    false
}

/// The notify and wait flags, taken from wherever they are in the words;
/// the window for notify.
fn waits(words: &mut Vec<Vec<u8>>, hwnd: u16) -> (u32, u32) {
    let mut flags = 0;
    let mut at = words.len();

    while at > 0 {
        at -= 1;

        let word = lowered(&words[at]);

        if word == b"wait" || word == b"notify" {
            flags |= if word == b"wait" {
                MCI_WAIT
            } else {
                MCI_NOTIFY
            };
            words.remove(at);
        }
    }

    (
        flags,
        if flags & MCI_NOTIFY != 0 {
            u32::from(hwnd)
        } else {
            0
        },
    )
}

/// A number as JavaScript's `Number` reads a word, made an unsigned long
/// (`>>> 0`): nought for one that is no number.
fn number(word: &[u8]) -> u32 {
    let text: String = word.iter().map(|&byte| char::from(byte)).collect();
    let text = text.trim_matches(|c: char| u8::try_from(c).is_ok_and(js_space));
    let value = if text.is_empty() {
        0.0
    } else if let Some((radix, digits)) = [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ]
    .iter()
    .find_map(|&(prefix, radix)| text.strip_prefix(prefix).map(|digits| (radix, digits)))
    {
        radix_number(digits, radix)
    } else if text
        .chars()
        .all(|c| c.is_ascii_digit() || "+-.eE".contains(c))
    {
        text.parse::<f64>().unwrap_or(f64::NAN)
    } else if matches!(text, "Infinity" | "+Infinity" | "-Infinity") {
        f64::INFINITY
    } else {
        f64::NAN
    };

    super::uint32(value)
}

/// The digits after `0x`, `0o` or `0b` as JavaScript's `Number` reads them:
/// no sign, at least one digit, every one of the radix, and the value
/// however large, rounded to the nearest a double holds.
fn radix_number(digits: &str, radix: u32) -> f64 {
    if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
        return f64::NAN;
    }

    let mut exact: Option<u128> = Some(0);
    let mut rough = 0.0f64;

    for c in digits.chars() {
        let digit = c.to_digit(radix).unwrap_or(0);

        exact = exact
            .and_then(|value| value.checked_mul(u128::from(radix)))
            .and_then(|value| value.checked_add(u128::from(digit)));
        rough = rough * f64::from(radix) + f64::from(digit);
    }

    #[allow(clippy::cast_precision_loss)]
    exact.map_or(rough, |value| value as f64)
}

/// The program's memory, a block at a time, freed after the command.
struct Scratch {
    blocks: Vec<u16>,
}

impl Engine {
    fn take(&self, scratch: &mut Scratch, size: u32) -> u32 {
        let (block, far) = self.system().scratch_block(size);

        scratch.blocks.push(block);
        far
    }

    /// A string in a block of its own.
    fn text(&self, scratch: &mut Scratch, value: &[u8]) -> u32 {
        let far = self.take(scratch, value.len() as u32 + 1);

        self.system().write_far(far, value);
        far
    }

    fn write32(&self, far: u32, at: u32, value: u32) {
        self.system()
            .write_far(super::mci::far_at(far, at), &value.to_le_bytes());
    }

    fn read32(&self, far: u32, at: u32) -> u32 {
        long_at(&self.system(), super::mci::far_at(far, at))
    }

    /// Runs a command string: its answer, and its text.
    #[allow(clippy::too_many_lines)]
    async fn run_string(
        &self,
        scratch: &mut Scratch,
        command: &[u8],
        hwnd: u16,
    ) -> Result<(u32, Vec<u8>), Stop> {
        let mut words = words_of(command);

        if words.is_empty() {
            return Ok((MCIERR_MISSING_COMMAND_STRING, Vec::new()));
        }

        let verb = lowered(&words.remove(0));

        if words.is_empty() {
            return Ok((MCIERR_MISSING_DEVICE_NAME, Vec::new()));
        }

        let name = words.remove(0);
        let (waiting, callback) = waits(&mut words, hwnd);
        let task = self.system().task_handle;
        let refused = |answer| Ok((answer, Vec::new()));

        if verb == b"open" {
            let parms = self.take(scratch, 0x18);
            let mut flags = 0;

            self.write32(parms, 0, callback);

            while !words.is_empty() {
                if takes(&mut words, &[b"type"]) && !words.is_empty() {
                    flags |= MCI_OPEN_TYPE;

                    let far = self.text(scratch, &words.remove(0));

                    self.write32(parms, 8, far);
                } else if takes(&mut words, &[b"alias"]) && !words.is_empty() {
                    flags |= MCI_OPEN_ALIAS;

                    let far = self.text(scratch, &words.remove(0));

                    self.write32(parms, 0x10, far);
                } else if takes(&mut words, &[b"shareable"]) {
                    flags |= MCI_OPEN_SHAREABLE;
                } else {
                    return refused(MCIERR_UNRECOGNIZED_KEYWORD);
                }
            }

            // A name with a type is its element; alone, a file where it
            // looks like one, and otherwise a device's type.
            if flags & MCI_OPEN_TYPE != 0 || name.iter().any(|&byte| b".\\:".contains(&byte)) {
                flags |= MCI_OPEN_ELEMENT;

                let far = self.text(scratch, &name);

                self.write32(parms, 0x0c, far);
            } else {
                flags |= MCI_OPEN_TYPE;

                let far = self.text(scratch, &name);

                self.write32(parms, 8, far);
            }

            let answer = self
                .mci_send_command(0, MCI_OPEN, flags | waiting, parms)
                .await?;

            return Ok(if answer != 0 {
                (answer, Vec::new())
            } else {
                (0, (self.read32(parms, 4) & 0xffff).to_string().into_bytes())
            });
        }

        if verb == b"sysinfo" {
            let parms = self.take(scratch, 0x14);
            let text = self.take(scratch, 128);
            let mut flags = 0;

            self.write32(parms, 0, callback);
            self.write32(parms, 4, text);
            self.write32(parms, 8, 128);

            if takes(&mut words, &[b"quantity"]) {
                flags |= MCI_SYSINFO_QUANTITY;
            } else if takes(&mut words, &[b"name"]) && !words.is_empty() {
                flags |= MCI_SYSINFO_NAME;
                self.write32(parms, 0x0c, number(&words.remove(0)));
            } else {
                return refused(MCIERR_UNRECOGNIZED_KEYWORD);
            }

            if takes(&mut words, &[b"open"]) {
                flags |= MCI_SYSINFO_OPEN;
            }

            if !words.is_empty() {
                return refused(MCIERR_UNRECOGNIZED_KEYWORD);
            }

            let id = if lowered(&name) == b"all" {
                MCI_ALL_DEVICE_ID
            } else {
                0
            };
            let answer = self
                .mci_send_command(id, MCI_SYSINFO, flags | waiting, parms)
                .await?;

            if answer != 0 {
                return refused(answer);
            }

            return Ok((
                0,
                if flags & MCI_SYSINFO_QUANTITY != 0 {
                    self.read32(text, 0).to_string().into_bytes()
                } else {
                    self.system().read_string(text)
                },
            ));
        }

        let id = find(&self.system(), task, &name);

        if id == 0 {
            return refused(MCIERR_INVALID_DEVICE_NAME);
        }

        match verb.as_slice() {
            b"close" | b"stop" | b"pause" | b"resume" => {
                if !words.is_empty() {
                    return refused(MCIERR_UNRECOGNIZED_KEYWORD);
                }

                let parms = self.take(scratch, 4);
                let message = match verb.as_slice() {
                    b"close" => MCI_CLOSE,
                    b"stop" => MCI_STOP,
                    b"pause" => MCI_PAUSE,
                    _ => MCI_RESUME,
                };

                self.write32(parms, 0, callback);
                Ok((
                    self.mci_send_command(id, message, waiting, parms).await?,
                    Vec::new(),
                ))
            }
            b"play" => {
                let parms = self.take(scratch, 12);
                let mut flags = 0;

                self.write32(parms, 0, callback);

                while !words.is_empty() {
                    if takes(&mut words, &[b"from"]) && !words.is_empty() {
                        flags |= MCI_FROM;
                        self.write32(parms, 4, number(&words.remove(0)));
                    } else if takes(&mut words, &[b"to"]) && !words.is_empty() {
                        flags |= MCI_TO;
                        self.write32(parms, 8, number(&words.remove(0)));
                    } else {
                        return refused(MCIERR_UNRECOGNIZED_KEYWORD);
                    }
                }

                Ok((
                    self.mci_send_command(id, MCI_PLAY, flags | waiting, parms)
                        .await?,
                    Vec::new(),
                ))
            }
            b"seek" => {
                let parms = self.take(scratch, 8);
                let mut flags = 0;

                self.write32(parms, 0, callback);

                if takes(&mut words, &[b"to", b"start"]) {
                    flags = MCI_SEEK_TO_START;
                } else if takes(&mut words, &[b"to", b"end"]) {
                    flags = MCI_SEEK_TO_END;
                } else if takes(&mut words, &[b"to"]) && !words.is_empty() {
                    flags = MCI_TO;
                    self.write32(parms, 4, number(&words.remove(0)));
                }

                if flags == 0 || !words.is_empty() {
                    return refused(MCIERR_UNRECOGNIZED_KEYWORD);
                }

                Ok((
                    self.mci_send_command(id, MCI_SEEK, flags | waiting, parms)
                        .await?,
                    Vec::new(),
                ))
            }
            b"status" => {
                let asked = lowered(&words.join(&b' '));
                // winbox.js looks the item up in an object, where the two
                // names of its prototype that are all lower case are found
                // as well: an item that is no number, sent as nought, and
                // its answer given as a number.
                let found = ITEMS
                    .iter()
                    .find(|(word, ..)| *word == asked)
                    .map(|&(_, item, shown)| (item, shown))
                    .or_else(|| {
                        matches!(asked.as_slice(), b"constructor" | b"__proto__")
                            .then_some((0, Shown::Number))
                    });
                let Some((item, shown)) = found else {
                    return refused(MCIERR_UNRECOGNIZED_KEYWORD);
                };
                let parms = self.take(scratch, 0x10);

                self.write32(parms, 0, callback);
                self.write32(parms, 8, item);

                let answer = self
                    .mci_send_command(id, MCI_STATUS, MCI_STATUS_ITEM | waiting, parms)
                    .await?;

                if answer != 0 {
                    return refused(answer);
                }

                let value = self.read32(parms, 4);
                let digits = || value.to_string().into_bytes();

                Ok((
                    0,
                    match shown {
                        Shown::Mode => {
                            strings::string(value as u16).map_or_else(digits, <[u8]>::to_vec)
                        }
                        Shown::Boolean => {
                            if value != 0 {
                                b"true".to_vec()
                            } else {
                                b"false".to_vec()
                            }
                        }
                        Shown::Format => FORMATS
                            .iter()
                            .find(|&&(word, format)| format == value && word != b"ms")
                            .map_or_else(digits, |(word, _)| word.to_vec()),
                        Shown::Number => digits(),
                    },
                ))
            }
            b"set" => {
                let parms = self.take(scratch, 0x0c);

                self.write32(parms, 0, callback);

                if !takes(&mut words, &[b"time", b"format"]) {
                    return refused(MCIERR_UNRECOGNIZED_KEYWORD);
                }

                let asked = lowered(&words.join(&b' '));
                let Some(&(_, format)) = FORMATS.iter().find(|(word, _)| *word == asked) else {
                    return refused(MCIERR_BAD_TIME_FORMAT);
                };

                self.write32(parms, 4, format);
                Ok((
                    self.mci_send_command(id, MCI_SET, MCI_SET_TIME_FORMAT | waiting, parms)
                        .await?,
                    Vec::new(),
                ))
            }
            b"info" => {
                let flags = if takes(&mut words, &[b"product"]) {
                    MCI_INFO_PRODUCT
                } else if takes(&mut words, &[b"file"]) {
                    MCI_INFO_FILE
                } else {
                    0
                };

                if flags == 0 || !words.is_empty() {
                    return refused(MCIERR_UNRECOGNIZED_KEYWORD);
                }

                let parms = self.take(scratch, 0x0c);
                let text = self.take(scratch, 128);

                self.write32(parms, 0, callback);
                self.write32(parms, 4, text);
                self.write32(parms, 8, 128);

                let answer = self
                    .mci_send_command(id, MCI_INFO, flags | waiting, parms)
                    .await?;

                Ok(if answer != 0 {
                    (answer, Vec::new())
                } else {
                    (0, self.system().read_string(text))
                })
            }
            _ => refused(MCIERR_UNRECOGNIZED_COMMAND),
        }
    }
}

/// Runs an MCI command given as a string, and gives its answer back as
/// text: the command; where the text goes, or nought; the room there; the
/// window `notify` tells. Nought, or an error.
pub fn mci_send_string(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (command, far, size, hwnd) = {
            let system = engine.system();
            let command = args.dword(&system);
            let far = args.dword(&system);
            let size = args.word(&system);
            let hwnd = args.word(&system);

            (lpcstr(&system, command), far, size, hwnd)
        };
        // A null command reads as nothing at all.
        let command = command.unwrap_or_default();
        let mut scratch = Scratch { blocks: Vec::new() };
        let ran = engine.run_string(&mut scratch, &command, hwnd).await;

        {
            let mut system = engine.system();

            for block in scratch.blocks {
                system.free_scratch(block);
            }
        }

        let (mut answer, mut text) = ran?;

        if far != 0 && size != 0 {
            if text.len() + 1 > usize::from(size) {
                if answer == 0 {
                    answer = MCIERR_PARAM_OVERFLOW;
                }

                text.clear();
            }

            text.push(0);
            engine.system().write_far(far, &text);
        }

        Ok(Answer::Dword(answer))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_are_split_at_spaces_and_quotes_kept_whole() {
        assert_eq!(
            words_of(b"open \"C:\\A B.WAV\" alias  x"),
            vec![
                b"open".to_vec(),
                b"C:\\A B.WAV".to_vec(),
                b"alias".to_vec(),
                b"x".to_vec()
            ]
        );
        // A quote with none to close it is part of its word.
        assert_eq!(
            words_of(b"a \"b c"),
            vec![b"a".to_vec(), b"\"b".to_vec(), b"c".to_vec()]
        );
    }

    #[test]
    fn numbers_are_read_as_javascript_reads_them() {
        assert_eq!(number(b"500"), 500);
        assert_eq!(number(b"0x10"), 16);
        assert_eq!(number(b"-1"), 0xffff_ffff);
        assert_eq!(number(b"1.7"), 1);
        assert_eq!(number(b"start"), 0);
        assert_eq!(number(b""), 0);
        // No sign after the radix's prefix, and a value past 32 bits taken
        // modulo 2^32 as `>>> 0` takes it.
        assert_eq!(number(b"0x+5"), 0);
        assert_eq!(number(b"0x1ffffffff"), 0xffff_ffff);
        assert_eq!(number(b"0x100000005"), 5);
        assert_eq!(number(b"0b101"), 5);
        assert_eq!(number(b"0o"), 0);
        assert_eq!(number(b" 12 "), 12);
        assert_eq!(number(b"4294967301"), 5);
    }

    #[test]
    fn notify_and_wait_are_taken_from_anywhere() {
        let mut words = vec![b"wait".to_vec(), b"from".to_vec(), b"NOTIFY".to_vec()];

        assert_eq!(waits(&mut words, 0x1234), (MCI_WAIT | MCI_NOTIFY, 0x1234));
        assert_eq!(words, vec![b"from".to_vec()]);
    }
}
