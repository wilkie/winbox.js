//! Runs a command script against the port, giving the values
//! dosbox-harness/harness.cpp gives for the same script against DOSBox's
//! own dbopl.cpp and Adlib module. The commands are described there.

use winbox_opl::{Adlib, Handler, Mode};

fn hex(word: Option<&str>) -> u32 {
    u32::from_str_radix(word.expect("an argument"), 16).expect("a hex number")
}

fn dec(word: Option<&str>) -> u32 {
    word.expect("an argument").parse().expect("a number")
}

fn time(word: Option<&str>) -> f64 {
    word.expect("an argument").parse().expect("a time")
}

/// Every value the script produces, in order.
pub fn run(script: &str) -> Vec<i32> {
    let mut out = Vec::new();
    let mut handler: Option<Handler> = None;
    let mut card: Option<Adlib> = None;
    for line in script.lines() {
        let mut words = line.split_whitespace();
        let Some(command) = words.next() else {
            continue;
        };
        match command {
            c if c.starts_with('#') => {}
            "r" => handler = Some(Handler::new(dec(words.next()))),
            "w" => {
                let (reg, val) = (hex(words.next()), hex(words.next()));
                handler.as_mut().expect("r first").write_reg(reg, val as u8);
            }
            "a" => {
                let (port, val) = (hex(words.next()), hex(words.next()));
                out.push(
                    handler
                        .as_ref()
                        .expect("r first")
                        .write_addr(port, val as u8) as i32,
                );
            }
            "g" => {
                let n = dec(words.next()) as usize;
                handler.as_mut().expect("r first").generate(n, &mut out);
            }
            "t" => {
                let tables = handler.as_ref().expect("r first").chip.rate_tables();
                out.extend(tables.iter().map(|&v| v as i32));
            }
            "m" => {
                let mode = match dec(words.next()) {
                    0 => Mode::Opl2,
                    1 => Mode::DualOpl2,
                    _ => Mode::Opl3,
                };
                card = Some(Adlib::new(mode, dec(words.next())));
            }
            "p" => {
                let (port, val) = (hex(words.next()), hex(words.next()));
                let t = time(words.next());
                card.as_mut()
                    .expect("m first")
                    .write(port as u16, val as u8, t);
            }
            "q" => {
                let port = hex(words.next());
                let t = time(words.next());
                out.push(i32::from(
                    card.as_mut().expect("m first").read(port as u16, t),
                ));
            }
            "mg" => {
                let n = dec(words.next()) as usize;
                // The harness calls the handler once; the scripts keep
                // to 512 or fewer, which is one call here too.
                assert!(n <= winbox_opl::dbopl::MAX_GENERATE);
                out.extend(card.as_mut().expect("m first").generate(n));
            }
            other => panic!("unknown command {other}"),
        }
    }
    out
}

/// FNV-1a, 64 bits, over the values as little-endian bytes.
pub fn fnv1a(values: &[i32]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for value in values {
        for byte in value.to_le_bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
    }
    hash
}
