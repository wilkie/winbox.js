//! The MIDI Mapper's long messages (`MODM_LONGDATA`, `MIDIMAP.DRV` seg2
//! `169`), **read out**: the bytes parsed one at a time into a buffer of
//! the mapper's own (seg2 `4ab`-`719`), each message, once it is whole,
//! sent on from the buffer as a long message (`1c7`-`248`).
//!
//! * The parse keeps, from one long message to the next, the last status
//!   it took (`[1DDh]`), the bytes still to come of the message under way
//!   (`[1DCh]`) and the running status (`[286h]`), which the short messages
//!   share (seg2 `3d9`-`3fd`); opening the mapper clears all three (seg3
//!   `13cb`-`13d3`).
//! * A system-exclusive message, from `F0h`, is taken byte by byte until a
//!   status byte comes. `F7h`, `F0h` and a real-time byte (`F8h` on) are
//!   taken into it, a real-time byte leaving it under way (seg2
//!   `4da`-`517`); any other status ends it untaken, and is taken again as
//!   the start of the next message (`4f3`). It is sent when it ends, and
//!   whenever its buffer is full, 200h bytes, the rest following on in the
//!   next (`65f`-`66c`).
//! * Any other system message takes as many data bytes as its status
//!   gives (seg2 `723`: 1, 2, 3, 2, 1, 1, 1, 1 for `F0h` to `F7h`, the
//!   status counted) and clears the running status (`5c3`). A status byte
//!   that comes before a message is whole sends what there is of it first
//!   (`51a`-`56b`). A real-time byte between messages is sent alone at once
//!   (`5a0`-`5ad`); a data byte with no message under way and no running
//!   status is sent alone as well.
//! * What is sent with no running status goes to every device the mapper
//!   opened, in turn, each waited for until it has played it (`1c7`-`210`,
//!   `1b5`).
//!
//! Not followed, and stopped at: channel messages in a long message, which
//! the mapper sends through its channel maps to the channel's device
//! (`24b`, `1c7` `212`-`244`).

use crate::call::Stop;

/// The bytes of each system message, the status counted (seg2 `723`:
/// `F0h` to `F7h`).
const SYSTEM_LENGTHS: [u8; 8] = [1, 2, 3, 2, 1, 1, 1, 1];

/// The mapper's buffer (seg3 `12dd`).
pub const BUFFER: usize = 0x200;

const EXCLUSIVE: u8 = 0xf0;
const END: u8 = 0xf7;
const REAL_TIME: u8 = 0xf8;

/// What the parse keeps between long messages.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Parse {
    /// The last status taken (`[1DDh]`): `F0h` while a system-exclusive
    /// message is under way.
    pub status: u8,
    /// The bytes still to come of the message under way (`[1DCh]`).
    pub pending: u8,
    /// The running status (`[286h]`), nought for none.
    pub running: u8,
}

const CHANNELS: &str = "the MIDI Mapper's channel messages in a long message";

impl Parse {
    /// A long message's bytes parsed: what is to be sent to every device,
    /// in order, each from the buffer's start.
    pub fn bytes(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, Stop> {
        let mut sent = Vec::new();
        let mut buffer = Vec::with_capacity(BUFFER);
        let mut at = 0;

        while at < bytes.len() {
            let byte = bytes[at];

            if byte & 0x80 == 0 {
                // A data byte (`600`).
                buffer.push(byte);
                at += 1;

                if self.pending != 0 {
                    self.pending -= 1;
                } else if self.running != 0 {
                    return Err(Stop::Unsupported(CHANNELS));
                }
            } else if self.status == EXCLUSIVE {
                // A status in a system-exclusive message (`4e1`-`517`).
                self.status = byte;

                if byte == END || byte == EXCLUSIVE || byte >= REAL_TIME {
                    buffer.push(byte);
                    at += 1;

                    if byte >= REAL_TIME {
                        self.status = EXCLUSIVE;
                    }
                }
            } else {
                // A message cut short by a status sent as far as it goes
                // (`51a`-`57e`).
                if self.pending != 0 {
                    if self.running != 0 {
                        return Err(Stop::Unsupported(CHANNELS));
                    }

                    sent.push(std::mem::take(&mut buffer));
                }

                at += 1;

                // A real-time byte alone, at once (`5a0`-`5ad`).
                if byte >= REAL_TIME {
                    sent.push(vec![byte]);
                    continue;
                }

                buffer.push(byte);
                self.status = byte;

                if byte < EXCLUSIVE {
                    return Err(Stop::Unsupported(CHANNELS));
                }

                // A system message (`5c3`-`5d8`).
                self.running = 0;
                self.pending = SYSTEM_LENGTHS[usize::from(byte & 7)] - 1;
            }

            // The message under way not yet whole (`655`-`66c`).
            if self.pending != 0 || (self.status == EXCLUSIVE && buffer.len() != BUFFER) {
                continue;
            }

            sent.push(std::mem::take(&mut buffer));
        }

        // What is left at the end sent too (`6bb`-`713`).
        if !buffer.is_empty() {
            if self.running != 0 {
                return Err(Stop::Unsupported(CHANNELS));
            }

            sent.push(buffer);
        }

        Ok(sent)
    }

    /// A short message's status taken as the short messages take it (seg2
    /// `3c7`-`3e7`): a real-time byte leaves the parse as it was; any other
    /// ends the message under way, and a status is the last taken.
    pub fn short(&mut self, status: u8) {
        if status >= REAL_TIME {
            return;
        }

        self.pending = 0;

        if status & 0x80 != 0 {
            self.status = status;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RESET: [u8; 11] = [
        0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7,
    ];

    /// A GS reset whole is one message; split over two long messages, one
    /// in two parts, the first sent as it ends (`maplong`).
    #[test]
    fn a_system_exclusive_message_is_sent_whole_or_as_it_comes() {
        let mut parse = Parse::default();

        assert_eq!(parse.bytes(&RESET).unwrap(), vec![RESET.to_vec()]);
        assert_eq!(parse.status, 0xf7);

        assert_eq!(parse.bytes(&RESET[..3]).unwrap(), vec![RESET[..3].to_vec()]);
        assert_eq!(parse.status, 0xf0);
        assert_eq!(parse.bytes(&RESET[3..]).unwrap(), vec![RESET[3..].to_vec()]);
    }

    /// A real-time byte between messages, and an end of exclusive alone.
    #[test]
    fn a_real_time_byte_and_an_end_alone() {
        let mut parse = Parse::default();

        assert_eq!(parse.bytes(&[0xf8]).unwrap(), vec![vec![0xf8]]);
        assert_eq!(parse.bytes(&[0xf7]).unwrap(), vec![vec![0xf7]]);
        // A clock in a system-exclusive message is taken into it.
        assert_eq!(
            parse.bytes(&[0xf0, 0x7e, 0xf8, 0x7f, 0xf7]).unwrap(),
            vec![vec![0xf0, 0x7e, 0xf8, 0x7f, 0xf7]]
        );
    }

    /// A system-exclusive message ended by another status, untaken, and a
    /// long one sent a buffer at a time.
    #[test]
    fn a_message_ended_by_another_status_or_its_buffer() {
        let mut parse = Parse::default();

        assert_eq!(
            parse.bytes(&[0xf0, 0x41, 0xf2, 0x01, 0x02]).unwrap(),
            vec![vec![0xf0, 0x41], vec![0xf2, 0x01, 0x02]]
        );

        let mut long = vec![0xf0];

        long.extend(std::iter::repeat_n(0x11, 0x200));
        long.push(0xf7);

        let sent = Parse::default().bytes(&long).unwrap();

        assert_eq!(sent.len(), 2);
        assert_eq!(sent[0].len(), 0x200);
        assert_eq!(sent[1].len(), 2);
    }

    /// A channel message in a long message is not followed.
    #[test]
    fn a_channel_message_stops() {
        assert!(Parse::default().bytes(&[0x90, 0x3c, 0x40]).is_err());
    }
}
