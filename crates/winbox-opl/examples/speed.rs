//! How fast the port generates samples, natively: a minute of music at
//! DOSBox's default 44100 Hz, asked for a millisecond's worth (44 or 45
//! samples) at a time as DOSBox's mixer asks, with nine melodic voices,
//! then with six voices and all five rhythm instruments.
//!
//! ```text
//! cargo run --release -p winbox-opl --example speed
//! ```

use std::time::Instant;
use winbox_opl::mixer::MixerTicks;
use winbox_opl::{Adlib, DEFAULT_RATE, Mode};

const MOD: [u8; 9] = [0, 1, 2, 8, 9, 10, 16, 17, 18];

fn reg(card: &mut Adlib, reg: u8, val: u8) {
    card.write(0x388, reg, 0.0);
    card.write(0x389, val, 0.0);
}

fn voices(card: &mut Adlib, count: usize) {
    reg(card, 0x01, 0x20);
    reg(card, 0xbd, 0xc0);
    for (ch, &slot) in MOD.iter().enumerate().take(count) {
        for (base, val) in [
            (0x20, 0xe1),
            (0x40, 0x12),
            (0x60, 0xf2),
            (0x80, 0x24),
            (0xe0, 1),
        ] {
            reg(card, base + slot, val);
            reg(card, base + slot + 3, if base == 0x40 { 0 } else { val });
        }
        reg(card, 0xc0 + ch as u8, 0x0c);
        reg(card, 0xa0 + ch as u8, 0x41 + ch as u8 * 16);
        reg(card, 0xb0 + ch as u8, 0x31);
    }
}

fn measure(name: &str, card: &mut Adlib) {
    let seconds = 60;
    let mut ticks = MixerTicks::new(DEFAULT_RATE);
    let mut out = Vec::with_capacity(1024);
    let mut checksum = 0i64;
    let mut samples = 0u32;
    let start = Instant::now();
    for tick in 0..seconds * 1000 {
        out.clear();
        let n = ticks.next_tick();
        card.mix(n, f64::from(tick), &mut out);
        checksum += out.iter().map(|&s| i64::from(s).abs()).sum::<i64>();
        samples += n as u32;
    }
    let elapsed = start.elapsed().as_secs_f64();
    println!(
        "{name}: {samples} samples in {elapsed:.3} s, {:.0} samples/s, {:.0} times real time (checksum {checksum})",
        f64::from(samples) / elapsed,
        f64::from(samples) / elapsed / f64::from(DEFAULT_RATE),
    );
}

fn main() {
    let mut card = Adlib::new(Mode::Opl2, DEFAULT_RATE);
    voices(&mut card, 9);
    measure("9 voices", &mut card);

    let mut card = Adlib::new(Mode::Opl2, DEFAULT_RATE);
    voices(&mut card, 6);
    for (slot, val) in [
        (0x10, 0x0b),
        (0x13, 0x00),
        (0x11, 0x00),
        (0x14, 0x00),
        (0x12, 0x00),
        (0x15, 0x03),
    ] {
        reg(&mut card, 0x40 + slot, val);
        reg(&mut card, 0x60 + slot, 0xf8);
        reg(&mut card, 0x80 + slot, 0x05);
    }
    reg(&mut card, 0xa7, 0x57);
    reg(&mut card, 0xb7, 0x09);
    reg(&mut card, 0xa8, 0xc8);
    reg(&mut card, 0xb8, 0x09);
    reg(&mut card, 0xbd, 0xff);
    measure("6 voices and rhythm", &mut card);
}
