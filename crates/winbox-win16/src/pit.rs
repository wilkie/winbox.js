//! The 8253 timer, as a program reads and programs it through ports 40h to
//! 43h and gates its counter 2 through port 61h's bit 0. Windsock times a
//! run of `IDIV`s on counter 2, mode 4 from 0000h, gated on, two `IN`s of
//! 42h after (`WINDSOCK.EXE` file offset `22900`-`2294d`); and sets counter
//! 0 to mode 2 from 0000h (`9e86`-`9e95`) and latches and reads it at 40h
//! for a finer time than a tick (`9e96`-`9edd`).
//!
//! **Read out** (DOSBox 0.74-3, `hardware/timer.cpp`), the counters as the
//! oracle's machine keeps them, on the machine's clock in milliseconds with
//! their fraction (`PIC_FullIndex`) and the 8253's 1,193,182 Hz
//! (`include/timer.h` 25). At the start counter 0 is in mode 3 from
//! 0000h, counter 1 in mode 2 from 18, counter 2 in mode 3 from 1,320, its
//! gate off (`TIMER::TIMER`, 402-448). A control word to 43h sets a
//! counter's mode, BCD and byte order, or with neither byte chosen latches
//! its count (`write_p43`, 291-345); the read-back command latches counts
//! and a status (346-359), one status latched at a time for all three
//! (63-66). A write to 40h or 42h takes a byte, and the count once its last
//! byte is in, starting it again (`write_latch`, 192-248); 41h is not
//! written (404). A read gives the status latched, else the count latched,
//! latching it afresh as each read of a whole count begins (`read_latch`,
//! 250-289). The count is worked out from the time since it started
//! (`counter_latch`, 135-189); counter 0 starts again at each of its
//! interrupts, a new count in mode 2 taking effect there (`PIT0_Event`,
//! 68-79); counter 2's gate stops and starts it by mode (`TIMER_SetGate2`,
//! 363-395, from `keyboard.cpp` 182-188). **Recorded** by `ioports`:
//! counter 2 in mode 4 from 0000h counts down between two reads, its status
//! B8h; counter 0 in mode 2 from 0000h moves between two latched reads, its
//! status B4h; alike in both modes.

/// The 8253's input clock, in Hz (`PIT_TICK_RATE`).
const TICK_RATE: f64 = 1_193_182.0;

/// One counter, as DOSBox's `PIT_Block`.
#[derive(Debug, Clone)]
struct Counter {
    count: u32,
    delay: f32,
    start: f64,
    read_latch: u16,
    write_latch: u16,
    mode: u8,
    read_state: u8,
    write_state: u8,
    bcd: bool,
    go_read_latch: bool,
    new_mode: bool,
    status_set: bool,
    counting: bool,
    update_count: bool,
}

impl Counter {
    fn new(count: u32, mode: u8, read_latch: u16) -> Self {
        Self {
            count,
            delay: delay_of(count),
            start: 0.0,
            read_latch,
            write_latch: 0,
            mode,
            read_state: 3,
            write_state: 3,
            bcd: false,
            go_read_latch: true,
            new_mode: false,
            status_set: false,
            counting: false,
            update_count: false,
        }
    }

    /// Its output, as `counter_output` (82-108) answers it.
    fn output(&self, now: f64) -> bool {
        let index = now - self.start;
        let delay = f64::from(self.delay);

        match self.mode {
            0 => !self.new_mode && index > delay,
            2 => self.new_mode || index % delay > 0.0,
            3 => self.new_mode || (index % delay) * 2.0 < delay,
            _ => true,
        }
    }
}

/// The milliseconds a count of `count` takes, in single precision as
/// DOSBox works it out.
fn delay_of(count: u32) -> f32 {
    1000.0f32 / (TICK_RATE as f32 / count as f32)
}

/// A count worked out in double precision, made 16 bits as C converts it.
fn truncated(value: f64) -> u16 {
    value as i64 as u16
}

fn to_bcd(value: u16) -> u16 {
    value % 10 + ((value / 10) % 10 << 4) + ((value / 100) % 10 << 8) + ((value / 1000) % 10 << 12)
}

fn from_bcd(value: u16) -> u16 {
    (value & 0x0f)
        + ((value >> 4) & 0x0f) * 10
        + ((value >> 8) & 0x0f) * 100
        + ((value >> 12) & 0x0f) * 1000
}

/// The three counters, the status latched for them, counter 2's gate, and
/// when counter 0's next interrupt is, where one is to come.
#[derive(Debug, Clone)]
pub struct Pit {
    counters: [Counter; 3],
    status: u8,
    status_locked: bool,
    gate2: bool,
    next_event: Option<f64>,
}

impl Default for Pit {
    fn default() -> Self {
        let counters = [
            Counter::new(0x10000, 3, 0),
            Counter::new(18, 2, 0),
            Counter::new(1320, 3, 1320),
        ];
        // Counter 0's first interrupt a count after the start.
        let first = f64::from(counters[0].delay);

        Self {
            counters,
            status: 0,
            status_locked: false,
            gate2: false,
            next_event: Some(first),
        }
    }
}

impl Pit {
    /// Counter 0's interrupts up to `now`, each starting it again a count
    /// on and taking a new count written in mode 2 (`PIT0_Event`, 68-79);
    /// none after one in mode 0.
    fn settle(&mut self, now: f64) {
        while let Some(at) = self.next_event {
            if at > now {
                break;
            }

            let counter = &mut self.counters[0];

            if counter.mode == 0 {
                self.next_event = None;
                break;
            }

            if counter.update_count {
                counter.start += f64::from(counter.delay);
                counter.delay = delay_of(counter.count);
                counter.update_count = false;
                self.next_event = Some(at + f64::from(counter.delay));
            } else {
                // The interrupts between, a count each, at once.
                let delay = f64::from(counter.delay);
                let periods = ((now - at) / delay).floor() + 1.0;

                counter.start += periods * delay;
                self.next_event = Some(at + periods * delay);
            }
        }
    }

    /// A counter's status latched, where none is latched already
    /// (109-134).
    fn latch_status(&mut self, index: usize, now: f64) {
        if self.status_locked {
            return;
        }

        let counter = &mut self.counters[index];
        let mut status = u8::from(counter.bcd) | (counter.mode & 7) << 1;

        status |= match counter.read_state {
            1 => 0x10,
            2 => 0x20,
            _ => 0x30,
        };

        if counter.output(now) {
            status |= 0x80;
        }

        if counter.new_mode {
            status |= 0x40;
        }

        counter.status_set = true;
        self.status = status;
        self.status_locked = true;
    }

    /// A counter's count latched (135-189): counter 2's not while its gate
    /// is off, but in mode 1.
    fn latch_count(&mut self, index: usize, now: f64) {
        let gate_off = index == 2 && !self.gate2;
        let counter = &mut self.counters[index];

        counter.go_read_latch = false;

        if gate_off && counter.mode != 1 {
            return;
        }

        let mut elapsed = now - counter.start;
        let delay = f64::from(counter.delay);
        let count = f64::from(counter.count);
        let per_ms = TICK_RATE / 1000.0;

        counter.read_latch = match counter.mode {
            0 | 4 => {
                // It counts on past its terminal count.
                if elapsed > delay {
                    elapsed -= delay;

                    if counter.bcd {
                        elapsed %= (1000.0 / TICK_RATE) * 10000.0;
                        truncated(9999.0 - elapsed * per_ms)
                    } else {
                        elapsed %= (1000.0 / TICK_RATE) * 65536.0;
                        truncated(65535.0 - elapsed * per_ms)
                    }
                } else {
                    truncated(count - elapsed * per_ms)
                }
            }
            1 if !counter.counting => counter.read_latch,
            1 if elapsed > delay => 0xffff,
            1 => truncated(count - elapsed * per_ms),
            2 => {
                elapsed %= delay;
                truncated(count - (elapsed / delay) * count)
            }
            3 => {
                elapsed %= delay;
                elapsed *= 2.0;

                if elapsed > delay {
                    elapsed -= delay;
                }

                // Never an odd count (`Corncob 3D`).
                truncated(count - (elapsed / delay) * count) & 0xfffe
            }
            _ => 0xffff,
        };
    }

    /// Port 40h or 42h written, `index` the counter (192-248).
    pub fn write(&mut self, index: usize, value: u8, now: f64) {
        self.settle(now);

        let counter = &mut self.counters[index];

        if counter.bcd {
            counter.write_latch = to_bcd(counter.write_latch);
        }

        match counter.write_state {
            0 => {
                counter.write_latch |= u16::from(value) << 8;
                counter.write_state = 3;
            }
            3 => {
                counter.write_latch = u16::from(value);
                counter.write_state = 0;
            }
            1 => counter.write_latch = u16::from(value),
            _ => counter.write_latch = u16::from(value) << 8,
        }

        if counter.bcd {
            counter.write_latch = from_bcd(counter.write_latch);
        }

        if counter.write_state == 0 {
            return;
        }

        counter.count = match (counter.write_latch, counter.bcd) {
            (0, false) => 0x10000,
            (0, true) => 9999,
            (latch, _) => u32::from(latch),
        };

        // Counter 0 in mode 2 takes a new count at its next interrupt.
        if index == 0 && !counter.new_mode && counter.mode == 2 {
            counter.update_count = true;
            return;
        }

        counter.start = now;
        counter.delay = delay_of(counter.count);

        // Counter 0's interrupt a count on, from a new mode or in mode 0.
        if index == 0 && (counter.new_mode || counter.mode == 0) {
            self.next_event = Some(now + f64::from(counter.delay));
        }

        counter.new_mode = false;
    }

    /// Port 40h, 41h or 42h read, `index` the counter (250-289).
    pub fn read(&mut self, index: usize, now: f64) -> u8 {
        self.settle(now);

        if self.counters[index].status_set {
            self.counters[index].status_set = false;
            self.status_locked = false;
            return self.status;
        }

        if self.counters[index].go_read_latch {
            self.latch_count(index, now);
        }

        let counter = &mut self.counters[index];
        let latch = if counter.bcd {
            to_bcd(counter.read_latch)
        } else {
            counter.read_latch
        };
        let [low, high] = latch.to_le_bytes();

        match counter.read_state {
            0 => {
                counter.read_state = 3;
                counter.go_read_latch = true;
                high
            }
            3 => {
                counter.read_state = 0;
                low
            }
            1 => {
                counter.go_read_latch = true;
                low
            }
            _ => {
                counter.go_read_latch = true;
                high
            }
        }
    }

    /// Port 43h written (291-361).
    pub fn control(&mut self, value: u8, now: f64) {
        self.settle(now);

        let index = usize::from(value >> 6);
        let named = [(0x02, 0), (0x04, 1), (0x08, 2)];

        if index == 3 {
            // The read-back command: the counts named latched where bit 5
            // is clear; the first status named where bit 4 is.
            if value & 0x20 == 0 {
                for (bit, counter) in named {
                    if value & bit != 0 {
                        self.latch_count(counter, now);
                    }
                }
            }

            if value & 0x10 == 0 {
                if let Some((_, counter)) = named.into_iter().find(|&(bit, _)| value & bit != 0) {
                    self.latch_status(counter, now);
                }
            }

            return;
        }

        if value & 0x30 == 0 {
            self.latch_count(index, now);
            return;
        }

        let counter = &mut self.counters[index];

        counter.bcd = value & 1 != 0;

        if counter.bcd && counter.count >= 9999 {
            counter.count = 9999;
        }

        if counter.status_set {
            counter.status_set = false;
            self.status_locked = false;
        }

        counter.update_count = false;
        counter.counting = false;
        counter.read_state = (value >> 4) & 3;
        counter.write_state = (value >> 4) & 3;
        counter.new_mode = true;
        counter.mode = match (value >> 1) & 7 {
            mode @ 6..=7 => mode - 4,
            mode => mode,
        };

        // Counter 0's interrupts stop until its count is written.
        if index == 0 {
            self.next_event = None;
        }
    }

    /// Counter 2's gate, port 61h's bit 0, changed (363-395).
    pub fn set_gate2(&mut self, on: bool, now: f64) {
        if self.gate2 == on {
            return;
        }

        match self.counters[2].mode {
            0 if on => self.counters[2].start = now,
            0 => {
                self.latch_count(2, now);
                self.counters[2].count = u32::from(self.counters[2].read_latch);
            }
            1 if on => {
                self.counters[2].counting = true;
                self.counters[2].start = now;
            }
            2 | 3 if on => self.counters[2].start = now,
            2 | 3 => self.latch_count(2, now),
            _ => {}
        }

        self.gate2 = on;
    }
}

#[cfg(test)]
mod tests {
    use super::Pit;

    /// Windsock's benchmark: counter 2 in mode 4 from 0000h, gated on, read
    /// a little after.
    #[test]
    fn counter_2_counts_down_in_mode_4_from_nought() {
        let mut pit = Pit::default();

        pit.control(0xb8, 0.0);
        pit.set_gate2(true, 0.0);
        pit.write(2, 0, 1.0);
        pit.write(2, 0, 1.0);

        // 10 us on: 11.9 of the 8253's ticks gone from 65,536.
        let low = pit.read(2, 1.01);
        let high = pit.read(2, 1.02);

        assert_eq!(u16::from_le_bytes([low, high]), 0xffff - 11);

        // Its status: mode 4, both bytes, its output high, counting.
        pit.control(0xe8, 1.03);
        assert_eq!(pit.read(2, 1.03), 0xb8);
    }

    #[test]
    fn counter_2s_gate_off_holds_its_latch() {
        let mut pit = Pit::default();

        pit.control(0x80, 5.0);
        assert_eq!(pit.read(2, 5.0), 1320u16.to_le_bytes()[0]);
        assert_eq!(pit.read(2, 5.0), 1320u16.to_le_bytes()[1]);
    }

    /// Windsock's fine time: counter 0 in mode 2 from 0000h, latched and
    /// read; ten counts' periods on it reads the same again.
    #[test]
    fn counter_0_runs_in_mode_2_from_its_interrupts() {
        let latched = |pit: &mut Pit, now: f64| {
            pit.control(0x00, now);
            u16::from_le_bytes([pit.read(0, now), pit.read(0, now)])
        };
        let mut pit = Pit::default();

        pit.control(0x34, 2.0);
        pit.write(0, 0, 2.0);
        pit.write(0, 0, 2.0);

        // A millisecond in: 1,193.182 of the 8253's ticks gone.
        let first = latched(&mut pit, 3.0);

        assert!(first.abs_diff(0xffff - 1193) <= 1);
        assert!(latched(&mut pit, 4.0) < first);

        let period = f64::from(super::delay_of(0x10000));

        assert!(latched(&mut pit, 3.0 + 10.0 * period).abs_diff(first) <= 1);

        // Its status: mode 2, both bytes, its output high.
        let later = 4.0 + 10.0 * period;

        pit.control(0xe2, later);
        assert_eq!(pit.read(0, later), 0xb4);
    }
}
