//! Calls to Windows answered without leaving this core: the ones a program
//! polls with, which cost it far more to make than to answer when each is a
//! trip to the host and back.
//!
//! A program calls Windows by a far call to a thunk, `INT 80h` and `RETF`,
//! which the host answers. Of the thunks the host lists in [`Quick`], this
//! core answers the `INT` itself, as the host's own implementation does:
//! the arguments read from the stack, the answer in AX and DX, the clock
//! charged what the host would charge, and the call kept in a log for the
//! host to tell whoever watches. The `RETF` then runs as any instruction.
//!
//! A call the host would answer differently from here -- one whose
//! structures are memory only the host can reach, or one after which a
//! timer of the host's comes due -- is the host's, untouched.

use crate::{AX, Bus, Cpu, DX, Exit, SP, SS};

/// The functions answered here, as the host names them by number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum Function {
    GetTickCount = 0,
    SetRect = 1,
    SetRectEmpty = 2,
    CopyRect = 3,
    IsRectEmpty = 4,
    PtInRect = 5,
    OffsetRect = 6,
    InflateRect = 7,
    IntersectRect = 8,
    UnionRect = 9,
    EqualRect = 10,
    /// `GetTickCount` by its other name, which the host tells apart.
    GetCurrentTime = 11,
    /// `PeekMessage` finding nothing, where the host has said nothing is
    /// waiting ([`Quick::peek`]).
    PeekMessage = 12,
}

impl Function {
    /// The words of arguments a call takes off the stack, as its `RETF`.
    fn words(self) -> usize {
        match self {
            Self::GetTickCount | Self::GetCurrentTime => 0,
            Self::SetRectEmpty | Self::IsRectEmpty => 2,
            Self::CopyRect
            | Self::PtInRect
            | Self::OffsetRect
            | Self::InflateRect
            | Self::EqualRect => 4,
            Self::SetRect | Self::IntersectRect | Self::UnionRect | Self::PeekMessage => 6,
        }
    }

    fn from(code: u32) -> Option<Self> {
        Some(match code {
            0 => Self::GetTickCount,
            1 => Self::SetRect,
            2 => Self::SetRectEmpty,
            3 => Self::CopyRect,
            4 => Self::IsRectEmpty,
            5 => Self::PtInRect,
            6 => Self::OffsetRect,
            7 => Self::InflateRect,
            8 => Self::IntersectRect,
            9 => Self::UnionRect,
            10 => Self::EqualRect,
            11 => Self::GetCurrentTime,
            12 => Self::PeekMessage,
            _ => return None,
        })
    }
}

/// A thunk answered here: where its `INT` is, which function, and the
/// instructions the host's clock charges a call of it -- `charge_alt` for
/// `PeekMessage` with `PM_NOYIELD`, which is charged apart.
#[derive(Debug, Clone, Copy, Default)]
pub struct Thunk {
    pub linear: u32,
    pub function: u32,
    pub charge: f64,
    pub charge_alt: f64,
}

/// A call answered here, for the host to tell whoever watches: the
/// function, the caller's CS and IP as the thunk saw them, the stack's
/// words of arguments as they were, and the answer.
#[derive(Debug, Clone, Copy, Default)]
pub struct Logged {
    pub function: u32,
    pub caller: u32,
    pub args: [u16; 8],
    pub result: u32,
}

/// How many thunks are answered here at most.
pub const THUNKS: usize = 16;

/// How many calls a run answers before it stops for the host to take the
/// log ([`crate::Exit::Logged`]); the host takes it after every run.
pub const LOGGED: usize = 32;

/// The host's thunks and clock, as it gives them for a run, and what the
/// run did with them.
#[derive(Debug, Clone, Copy)]
pub struct Quick {
    /// Whether calls are answered here this run.
    pub enabled: bool,
    /// Whether the host has said that, this run, a task looking for a
    /// message finds none: nothing posted, sent or due to paint, no timer,
    /// no other task waiting for its turn. `PeekMessage` then answers
    /// FALSE, and is otherwise the host's.
    pub peek: bool,
    pub thunks: [Thunk; THUNKS],
    pub thunk_count: usize,
    /// The host's virtual clock: its rate, the instructions counted before
    /// the run, what calls have been charged, the milliseconds skipped,
    /// and when the next thing waiting on it is due; `None` for a clock of
    /// the host's own time, which `GetTickCount` is left to.
    pub clock: Option<QuickClock>,
    pub log: [Logged; LOGGED],
    pub logged: usize,
}

/// A virtual clock, as [`Quick`] carries it.
#[derive(Debug, Clone, Copy)]
pub struct QuickClock {
    pub rate: f64,
    pub instructions: f64,
    pub charged: f64,
    pub skipped: f64,
    pub next_due: f64,
}

impl Default for Quick {
    fn default() -> Self {
        Self {
            enabled: false,
            peek: false,
            thunks: [Thunk::default(); THUNKS],
            thunk_count: 0,
            clock: None,
            log: [Logged::default(); LOGGED],
            logged: 0,
        }
    }
}

/// The milliseconds of a timer tick, as `GetTickCount` steps.
const TICK: f64 = 65536.0 * 1000.0 / 1_193_180.0;

/// A `RECT`: left, top, right and bottom, signed words.
type Rect = [i16; 4];

const EMPTY: Rect = [0, 0, 0, 0];

fn empty(rect: Rect) -> bool {
    rect[2] <= rect[0] || rect[3] <= rect[1]
}

impl<B: Bus> Cpu<B> {
    /// `INT 80h` at a thunk answered here: the call made, IP past the
    /// `INT`; or the host's, nothing changed.
    pub(crate) fn quick_call(&mut self, start: u32, retired: u64) -> Result<(), Exit> {
        let host = Err(Exit::Unimplemented(0xcd));

        if !self.quick.enabled || self.quick.logged >= LOGGED {
            return host;
        }

        let linear = self.segments[crate::CS].base.wrapping_add(start);
        let thunks = &self.quick.thunks[..self.quick.thunk_count];
        let Some(thunk) = thunks.iter().find(|thunk| thunk.linear == linear).copied() else {
            return host;
        };
        let Some(function) = Function::from(thunk.function) else {
            return host;
        };

        if function == Function::PeekMessage && !self.quick.peek {
            return host;
        }

        let sp = self.regs[SP];
        let mut args = [0u16; 8];

        for (at, word) in args.iter_mut().enumerate().take(function.words()) {
            *word = self.read16(SS, u32::from(sp.wrapping_add(4 + 2 * at as u16)))?;
        }

        /* `PeekMessage` with `PM_NOYIELD`, its flags the last argument,
         * nearest the stack's top, is charged apart. */
        let charge = if function == Function::PeekMessage && args[0] & 0x0002 != 0 {
            thunk.charge_alt
        } else {
            thunk.charge
        };

        /* The time after the call, the INT counted, as the host reads it
         * once the call is charged; a call that brings a timer due is the
         * host's, which calls the timer as the call ends. */
        let now = match self.quick.clock {
            Some(clock) => {
                // A run's count is under 2^32, which a double holds exactly.
                #[allow(clippy::cast_precision_loss)]
                let instructions = clock.instructions + (retired + 1) as f64;
                let charged = clock.charged + charge;
                let now = ((instructions + charged) / clock.rate).floor() + clock.skipped;

                if now >= clock.next_due {
                    return host;
                }

                Some(now)
            }
            None if matches!(function, Function::GetTickCount | Function::GetCurrentTime) => {
                return host;
            }
            None => None,
        };

        let caller =
            (u32::from(args_word(self, sp, 2)?) << 16) | u32::from(args_word(self, sp, 0)?);
        let result = self.quick_function(function, &args, now)?;

        if let Some(clock) = &mut self.quick.clock {
            clock.charged += charge;
        }

        self.quick.log[self.quick.logged] = Logged {
            function: thunk.function,
            caller,
            args,
            result: result.unwrap_or(0),
        };
        self.quick.logged += 1;

        Ok(())
    }

    /// A function's work: its answer, as AX and DX take it, or `None` for
    /// none; or the host's, where a structure cannot be reached, with
    /// nothing written.
    #[allow(clippy::too_many_lines)]
    fn quick_function(
        &mut self,
        function: Function,
        args: &[u16; 8],
        now: Option<f64>,
    ) -> Result<Option<u32>, Exit> {
        let host = Err(Exit::Unimplemented(0xcd));
        let pointer = |at: usize| (u32::from(args[at + 1]) << 16) | u32::from(args[at]);

        let answer = match function {
            Function::GetTickCount | Function::GetCurrentTime => {
                let Some(ms) = now else {
                    return host;
                };
                let ticks = ((ms / TICK).floor() * TICK).floor() as u64 as u32;

                self.regs[AX] = ticks as u16;
                self.regs[DX] = (ticks >> 16) as u16;
                return Ok(Some(ticks));
            }
            Function::SetRect => {
                let to = pointer(4);

                self.put_rect(
                    to,
                    [
                        args[3] as i16,
                        args[2] as i16,
                        args[1] as i16,
                        args[0] as i16,
                    ],
                )?;
                None
            }
            Function::SetRectEmpty => {
                self.put_rect(pointer(0), EMPTY)?;
                None
            }
            Function::CopyRect => {
                let from = self.get_rect(pointer(0))?;

                self.put_rect(pointer(2), from)?;
                None
            }
            Function::IsRectEmpty => Some(u32::from(empty(self.get_rect(pointer(0))?))),
            Function::PtInRect => {
                let at = pointer(2);

                if at == 0 {
                    Some(0)
                } else {
                    let rect = self.get_rect(at)?;
                    let x = args[0] as i16;
                    let y = args[1] as i16;

                    Some(u32::from(
                        x >= rect[0] && x < rect[2] && y >= rect[1] && y < rect[3],
                    ))
                }
            }
            Function::OffsetRect | Function::InflateRect => {
                let at = pointer(2);
                let rect = self.get_rect(at)?;
                let (dx, dy) = (args[1] as i16, args[0] as i16);
                let moved = if function == Function::OffsetRect {
                    [
                        rect[0].wrapping_add(dx),
                        rect[1].wrapping_add(dy),
                        rect[2].wrapping_add(dx),
                        rect[3].wrapping_add(dy),
                    ]
                } else {
                    [
                        rect[0].wrapping_sub(dx),
                        rect[1].wrapping_sub(dy),
                        rect[2].wrapping_add(dx),
                        rect[3].wrapping_add(dy),
                    ]
                };

                self.put_rect(at, moved)?;
                None
            }
            Function::IntersectRect | Function::UnionRect => {
                let b = self.get_rect(pointer(0))?;
                let a = self.get_rect(pointer(2))?;
                let to = pointer(4);
                let rect = if function == Function::IntersectRect {
                    let cut = [
                        a[0].max(b[0]),
                        a[1].max(b[1]),
                        a[2].min(b[2]),
                        a[3].min(b[3]),
                    ];

                    if empty(cut) { EMPTY } else { cut }
                } else if empty(a) {
                    b
                } else if empty(b) {
                    a
                } else {
                    [
                        a[0].min(b[0]),
                        a[1].min(b[1]),
                        a[2].max(b[2]),
                        a[3].max(b[3]),
                    ]
                };

                self.put_rect(to, rect)?;
                Some(u32::from(!empty(rect)))
            }
            Function::EqualRect => {
                let b = self.get_rect(pointer(0))?;
                let a = self.get_rect(pointer(2))?;

                Some(u32::from(a == b))
            }
            // Nothing waiting, as the host has said: FALSE, the message
            // structure untouched.
            Function::PeekMessage => Some(0),
        };

        if let Some(value) = answer {
            self.regs[AX] = value as u16;
        }

        Ok(answer)
    }

    /// Where the host reads a structure an argument points to: the
    /// selector's index times 64 KiB, and the offset -- not through the
    /// descriptor. A null pointer, or memory only the host can reach, is
    /// the host's.
    fn rect_at(far: u32) -> Option<u32> {
        if far == 0 {
            return None;
        }

        Some(((far >> 19) << 16).wrapping_add(far & 0xffff))
    }

    fn get_rect(&self, far: u32) -> Result<Rect, Exit> {
        let host = Exit::Unimplemented(0xcd);
        let at = Self::rect_at(far).ok_or(host)?;
        let mut rect = EMPTY;

        for (field, value) in rect.iter_mut().enumerate() {
            *value = self
                .bus
                .read16(at.wrapping_add(2 * field as u32))
                .ok_or(host)? as i16;
        }

        Ok(rect)
    }

    /// A rectangle written, every byte of it checked first, so that one the
    /// host must take is written not at all.
    fn put_rect(&mut self, far: u32, rect: Rect) -> Result<(), Exit> {
        let host = Exit::Unimplemented(0xcd);
        let at = Self::rect_at(far).ok_or(host)?;

        for byte in 0..8 {
            self.bus.read8(at.wrapping_add(byte)).ok_or(host)?;
        }

        for (field, value) in rect.iter().enumerate() {
            self.bus
                .write16(at.wrapping_add(2 * field as u32), *value as u16)
                .ok_or(host)?;
        }

        Ok(())
    }
}

/// A word of the caller's return address at `SP + at`.
fn args_word<B: Bus>(cpu: &Cpu<B>, sp: u16, at: u16) -> Result<u16, Exit> {
    cpu.read16(SS, u32::from(sp.wrapping_add(at)))
}
