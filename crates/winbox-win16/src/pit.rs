//! The 8253 timer's counter 2, the speaker's, as a program reads and
//! programs it through ports 42h and 43h and gates it through port 61h's
//! bit 0. Windsock's benchmark times a run of `IDIV`s on it: mode 4 from
//! 0000h, gated on, two `IN`s of 42h after (`WINDSOCK.EXE` file offset
//! `22900`-`2294d`).
//!
//! **Read out** (DOSBox 0.74-3, `hardware/timer.cpp`), the counter as the
//! oracle's machine keeps it, on the machine's clock in milliseconds
//! (`PIC_FullIndex`) and the 8253's 1,193,182 Hz (`include/timer.h` 25):
//! counter 2 starts in mode 3, 1,320 its count and its latch, both bytes
//! read and written in turn, its gate off (`TIMER::TIMER`, 402-448). A
//! control word to 43h for it sets its mode, BCD and byte order, or with
//! neither byte chosen latches its count (`write_p43`, 291-345); the
//! read-back command latches its count or its status (346-359). A write to
//! 42h takes a byte, and the count once its last byte is in, starting it
//! again (`write_latch`, 192-248); a read gives the status latched, else
//! the count latched, latching it afresh as each read of a whole count
//! begins (`read_latch`, 250-289). The count is worked out from the time
//! since it started (`counter_latch`, 135-189); the gate, port 61h's bit
//! 0, stops and starts it by mode (`TIMER_SetGate2`, 363-395, from
//! `keyboard.cpp` 182-188). **Recorded** by `ioports`: counter 2 in mode 4
//! from 0000h counts down between two reads, and its status latched reads
//! B8h, in both modes.

/// The 8253's input clock, in Hz (`PIT_TICK_RATE`).
const TICK_RATE: f64 = 1_193_182.0;

/// Counter 2, as DOSBox's `PIT_Block` and the status latch it shares.
#[derive(Debug, Clone)]
pub struct Counter2 {
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
    gate: bool,
    status: u8,
    status_locked: bool,
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

impl Default for Counter2 {
    fn default() -> Self {
        Self {
            count: 1320,
            delay: delay_of(1320),
            start: 0.0,
            read_latch: 1320,
            write_latch: 0,
            mode: 3,
            read_state: 3,
            write_state: 3,
            bcd: false,
            go_read_latch: true,
            new_mode: false,
            status_set: false,
            counting: false,
            gate: false,
            status: 0,
            status_locked: false,
        }
    }
}

impl Counter2 {
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

    /// Its status latched, where none is latched already (109-134).
    fn latch_status(&mut self, now: f64) {
        if self.status_locked {
            return;
        }

        let mut status = u8::from(self.bcd) | (self.mode & 7) << 1;

        status |= match self.read_state {
            1 => 0x10,
            2 => 0x20,
            _ => 0x30,
        };

        if self.output(now) {
            status |= 0x80;
        }

        if self.new_mode {
            status |= 0x40;
        }

        self.status = status;
        self.status_set = true;
        self.status_locked = true;
    }

    /// Its count latched (135-189): not while its gate is off, but in mode
    /// 1.
    fn latch_count(&mut self, now: f64) {
        self.go_read_latch = false;

        if !self.gate && self.mode != 1 {
            return;
        }

        let mut index = now - self.start;
        let delay = f64::from(self.delay);
        let count = f64::from(self.count);
        let per_ms = TICK_RATE / 1000.0;

        match self.mode {
            0 | 4 => {
                // It counts on past its terminal count.
                if index > delay {
                    index -= delay;

                    if self.bcd {
                        index %= (1000.0 / TICK_RATE) * 10000.0;
                        self.read_latch = truncated(9999.0 - index * per_ms);
                    } else {
                        index %= (1000.0 / TICK_RATE) * 65536.0;
                        self.read_latch = truncated(65535.0 - index * per_ms);
                    }
                } else {
                    self.read_latch = truncated(count - index * per_ms);
                }
            }
            1 => {
                if self.counting {
                    self.read_latch = if index > delay {
                        0xffff
                    } else {
                        truncated(count - index * per_ms)
                    };
                }
            }
            2 => {
                index %= delay;
                self.read_latch = truncated(count - (index / delay) * count);
            }
            3 => {
                index %= delay;
                index *= 2.0;

                if index > delay {
                    index -= delay;
                }

                // Never an odd count (`Corncob 3D`).
                self.read_latch = truncated(count - (index / delay) * count) & 0xfffe;
            }
            _ => self.read_latch = 0xffff,
        }
    }

    /// Port 42h written (192-248).
    pub fn write(&mut self, value: u8, now: f64) {
        if self.bcd {
            self.write_latch = to_bcd(self.write_latch);
        }

        match self.write_state {
            0 => {
                self.write_latch |= u16::from(value) << 8;
                self.write_state = 3;
            }
            3 => {
                self.write_latch = u16::from(value);
                self.write_state = 0;
            }
            1 => self.write_latch = u16::from(value),
            _ => self.write_latch = u16::from(value) << 8,
        }

        if self.bcd {
            self.write_latch = from_bcd(self.write_latch);
        }

        if self.write_state != 0 {
            self.count = match (self.write_latch, self.bcd) {
                (0, false) => 0x10000,
                (0, true) => 9999,
                (latch, _) => u32::from(latch),
            };
            self.start = now;
            self.delay = delay_of(self.count);
            self.new_mode = false;
        }
    }

    /// Port 42h read (250-289).
    pub fn read(&mut self, now: f64) -> u8 {
        if self.status_set {
            self.status_set = false;
            self.status_locked = false;
            return self.status;
        }

        if self.go_read_latch {
            self.latch_count(now);
        }

        let latch = if self.bcd {
            to_bcd(self.read_latch)
        } else {
            self.read_latch
        };
        let [low, high] = latch.to_le_bytes();

        match self.read_state {
            0 => {
                self.read_state = 3;
                self.go_read_latch = true;
                high
            }
            3 => {
                self.read_state = 0;
                low
            }
            1 => {
                self.go_read_latch = true;
                low
            }
            _ => {
                self.go_read_latch = true;
                high
            }
        }
    }

    /// A control word for counter 2 at port 43h, its top bits 10b
    /// (291-345).
    pub fn control(&mut self, value: u8, now: f64) {
        if value & 0x30 == 0 {
            self.latch_count(now);
            return;
        }

        self.bcd = value & 1 != 0;

        if self.bcd && self.count >= 9999 {
            self.count = 9999;
        }

        if self.status_set {
            self.status_set = false;
            self.status_locked = false;
        }

        self.counting = false;
        self.read_state = (value >> 4) & 3;
        self.write_state = (value >> 4) & 3;

        let mode = match (value >> 1) & 7 {
            mode @ 6..=7 => mode - 4,
            mode => mode,
        };

        self.new_mode = true;
        self.mode = mode;
    }

    /// The read-back command at port 43h, its top bits 11b, for counter 2
    /// alone (346-359): its count latched where bit 5 is clear, its status
    /// where bit 4 is.
    pub fn read_back(&mut self, value: u8, now: f64) {
        if value & 0x20 == 0 {
            self.latch_count(now);
        }

        if value & 0x10 == 0 {
            self.latch_status(now);
        }
    }

    /// The gate, port 61h's bit 0, changed (363-395).
    pub fn set_gate(&mut self, on: bool, now: f64) {
        if self.gate == on {
            return;
        }

        match self.mode {
            0 => {
                if on {
                    self.start = now;
                } else {
                    self.latch_count(now);
                    self.count = u32::from(self.read_latch);
                }
            }
            1 => {
                if on {
                    self.counting = true;
                    self.start = now;
                }
            }
            2 | 3 => {
                if on {
                    self.start = now;
                } else {
                    self.latch_count(now);
                }
            }
            _ => {}
        }

        self.gate = on;
    }
}

#[cfg(test)]
mod tests {
    use super::Counter2;

    /// Windsock's benchmark: mode 4 from 0000h, gated on, read a little
    /// after.
    #[test]
    fn counts_down_in_mode_4_from_nought() {
        let mut counter = Counter2::default();

        counter.control(0xb8, 0.0);
        counter.set_gate(true, 0.0);
        counter.write(0, 1.0);
        counter.write(0, 1.0);

        // 10 us on: 11.9 of the 8253's ticks gone from 65,536.
        let low = counter.read(1.01);
        let high = counter.read(1.02);

        assert_eq!(u16::from_le_bytes([low, high]), 0xffff - 11);

        // Its status: mode 4, both bytes, its output high, counting.
        counter.read_back(0xe8, 1.03);
        assert_eq!(counter.read(1.03), 0xb8);
    }

    #[test]
    fn its_gate_off_holds_the_latch() {
        let mut counter = Counter2::default();

        // Gate off: the count is not latched afresh.
        counter.control(0x80, 5.0);
        assert_eq!(counter.read(5.0), 1320u16.to_le_bytes()[0]);
        assert_eq!(counter.read(5.0), 1320u16.to_le_bytes()[1]);
    }
}
