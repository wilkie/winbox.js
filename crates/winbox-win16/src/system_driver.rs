//! The system driver, `SYSTEM.DRV`, as WinBox keeps it: found by its
//! name, `SYSTEM`, and by its file's. KERNEL asks it what a drive is and
//! USER's `GetTickCount` is its millisecond count; here those are KERNEL's
//! and USER's own, and the driver answers as they do. Its timers are kept
//! in its data segment as the driver keeps them, so that what a program
//! sees of them -- their handles, which are where each is kept -- is as it
//! is on Windows. **Read out** of `SYSTEM.DRV` seg1 and **recorded** by
//! `sysdrv`. As `src/win16/system-driver.ts`.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::{TimerId, segment_selector};

use crate::call::{Answer, Args, Implementation, Stop};
use crate::interrupts::Interrupt;
use crate::system::System;

/// The timer's tick, in milliseconds: 65,536 of the 8253's 1,193,180 Hz.
const TICK: f64 = 65536.0 * 1000.0 / 1_193_180.0;

/// Where the timers are kept in the driver's data, eight bytes each.
const FIRST_TIMER: u16 = 0x18;

/// The eight timers' end: two words of `FFFFh`.
const LAST_TIMER: u16 = 0x58;

/// Whether the timer's interrupt is hooked: `EnableSystemTimers` (`[5Ch]`).
const HOOKED: u16 = 0x5c;

/// What a timer's calls waiting are known by, above MMSYSTEM's serials.
const KEY: u64 = 0x5359_5354_0000;

/// The timers Windows' own modules hold as a program starts, which
/// WinBox's stand in for and does not call: COMM.DRV's every tick of 100
/// ms (its `CreateSystemTimer` at seg1 `0126`), DISPLAY's cursor check
/// every tick (USER seg3 `02fa`-`0302`), KERNEL's every nine and USER's
/// own, here with the rate `sysdrv`'s diagnosis found, 182 ticks (USER
/// seg1 `738f`). Each is its rate and its count. **Recorded**: the first
/// handle a program is given is 38h, and four can be made.
const HELD: [(u16, u16); 4] = [(1, 1), (0, 0), (9, 8), (0xb6, 0xb5)];

/// What the driver keeps besides its data: the tick last looked at, and
/// the clock's timer for the next.
#[derive(Debug, Default)]
pub struct State {
    tick: Option<i64>,
    wake: Option<TimerId>,
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "InquireSystem" => inquire_system,
        "CreateSystemTimer" => create_system_timer,
        "KillSystemTimer" => kill_system_timer,
        "EnableSystemTimers" => enable_system_timers,
        "DisableSystemTimers" => disable_system_timers,
        "GetSystemMSecCount" => get_system_msec_count,
        "Get80x87SaveSize" => get_80x87_save_size,
        "Save80x87State" => save_80x87_state,
        "Restore80x87State" => restore_80x87_state,
        "WEP" => |system, args| {
            let _ = args.word(system);
            Ok(Answer::Word(1))
        },
        "A20_Proc" => |system, args| {
            let _ = args.word(system);
            Ok(Answer::Word(2))
        },
        _ => return None,
    }))
}

impl System {
    /// The driver's data segment's selector.
    fn system_data(&self) -> u16 {
        self.kept_named("SYSTEM")
            .map_or(0, |kept| segment_selector(self.kept[kept].data))
    }

    fn system_word(&self, at: u16) -> u16 {
        let base = self.base_of(self.system_data());

        self.cpu.bus.read16(base + u32::from(at))
    }

    fn set_system_word(&mut self, at: u16, value: u16) {
        let base = self.base_of(self.system_data());

        self.cpu.bus.write16(base + u32::from(at), value);
    }

    fn system_byte(&self, at: u16) -> u8 {
        let base = self.base_of(self.system_data());

        self.cpu.bus.read8(base + u32::from(at))
    }

    fn set_system_byte(&mut self, at: u16, value: u8) {
        let base = self.base_of(self.system_data());

        self.cpu.bus.write8(base + u32::from(at), value);
    }

    /// The driver's state as it is once started: its timers laid out,
    /// hooked. Whether it has data at all.
    fn system_started(&mut self) -> bool {
        if self.system_data() == 0 {
            return false;
        }

        if self.system_byte(0) != 0 {
            return true;
        }

        self.set_system_byte(0, 1);

        for (n, at) in (FIRST_TIMER..LAST_TIMER).step_by(8).enumerate() {
            let (rate, count) = HELD.get(n).copied().unwrap_or((0xffff, 0));

            self.set_system_word(at, rate);
            self.set_system_word(at + 2, count);
            self.set_system_word(at + 4, 0);
            self.set_system_word(at + 6, 0);
        }

        self.set_system_word(LAST_TIMER, 0xffff);
        self.set_system_word(LAST_TIMER + 2, 0xffff);
        self.set_system_byte(HOOKED, 1);
        true
    }

    /// The timer's interrupt, each tick that has passed since it was last
    /// looked at, as the driver's handler runs it (seg1 `0298`-`02c5`):
    /// each timer whose rate is not `FFFFh`, a program's, is counted down and
    /// called as its count comes to nought, its count set to its rate
    /// again; a rate of nought is called every tick. It is called with AX
    /// its handle and DS the driver's data (`registers_of`). The timers
    /// WinBox holds for Windows' own modules have no procedure and are only
    /// counted. A run that lagged a long way is called for no more than 64
    /// ticks at once. As `pollSystemTimers`.
    pub(crate) fn poll_system_timers(&mut self) {
        if self.system_data() == 0 || self.system_byte(0) == 0 || self.system_byte(HOOKED) == 0 {
            return;
        }

        let tick = (self.clock.now(self.instructions) / TICK).floor() as i64;
        let last = self.system_driver.tick.unwrap_or(tick);

        self.system_driver.tick = Some(tick);

        for _ in (last + 1).max(tick - 63)..=tick {
            for at in (FIRST_TIMER..LAST_TIMER).step_by(8) {
                let rate = self.system_word(at);

                if rate == 0xffff {
                    continue;
                }

                if rate != 0 {
                    let count = self.system_word(at + 2).wrapping_sub(1);

                    if count != 0 {
                        self.set_system_word(at + 2, count);
                        continue;
                    }

                    self.set_system_word(at + 2, rate);
                }

                let proc =
                    u32::from(self.system_word(at + 6)) << 16 | u32::from(self.system_word(at + 4));

                if proc != 0 {
                    let wake = Some(self.task_handle).filter(|&task| task != 0);

                    self.at_interrupt(
                        Interrupt {
                            proc,
                            args: vec![],
                            key: Some(KEY | u64::from(at)),
                        },
                        wake,
                    );
                }
            }
        }

        self.arm_system_timers();
    }

    /// The registers a timer's procedure is called with, for the call
    /// waiting with this key: AX its handle, DS the driver's data.
    pub(crate) fn system_timer_registers(&self, key: Option<u64>) -> Option<(u16, u16)> {
        let key = key?;

        (key & !0xffff == KEY).then(|| (key as u16, self.system_data()))
    }

    /// The clock's timer for the next tick, while a program's timer is kept
    /// and the interrupt hooked, so that a task waiting for a message is
    /// woken to it.
    fn arm_system_timers(&mut self) {
        if let Some(timer) = self.system_driver.wake.take() {
            self.clock.cancel(timer);
        }

        if self.system_data() == 0 || self.system_byte(HOOKED) == 0 {
            return;
        }

        let any = (FIRST_TIMER..LAST_TIMER)
            .step_by(8)
            .any(|at| self.system_word(at) != 0xffff && self.system_word(at + 6) != 0);

        if !any {
            return;
        }

        let now = self.clock.now(self.instructions);

        if self.system_driver.tick.is_none() {
            self.system_driver.tick = Some((now / TICK).floor() as i64);
        }

        let next = ((now / TICK).floor() + 1.0) * TICK;

        self.system_driver.wake = Some(self.clock.after(self.instructions, next - now));
    }
}

/// What the system is: code 0 the timer's resolution in microseconds,
/// 54,925 (seg1 `0020`); code 1 what a drive is
/// (`modules_kernel::drive_inquiry`); any other nought. Code 2, which
/// saves DOS's byte at 0:504h before DOS 3.20, does nothing after it (seg1
/// `0110`-`015e`).
fn inquire_system(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let info = args.word(system);
    let drive = args.signed(system);

    system.system_started();

    Ok(Answer::Dword(match info {
        0 => 0xd68d,
        1 => {
            let (kind, alias) = crate::modules_kernel::drive_inquiry(system, i32::from(drive));

            u32::from(alias) << 16 | u32::from(kind)
        }
        _ => 0,
    }))
}

/// A timer that calls a procedure every `rate` milliseconds, as ticks: the
/// rate times 1,000 divided by 54,925, nought every tick (seg1 `033c`-
/// `034b`). Kept in the first free place -- one whose rate is `FFFFh` -- and
/// that place's offset in the driver's data is the handle; nought where
/// the eight are taken (`034e`-`0371`).
fn create_system_timer(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let rate = args.word(system);
    let proc = args.dword(system);

    if !system.system_started() {
        return Ok(Answer::Word(0));
    }

    let ticks = if rate == 0 {
        0
    } else {
        (u32::from(rate) * 1000 / 0xd68d) as u16
    };
    let mut at = FIRST_TIMER;

    loop {
        if system.system_word(at) == 0xffff {
            if system.system_word(at + 2) == 0xffff {
                return Ok(Answer::Word(0));
            }

            system.set_system_word(at + 4, proc as u16);
            system.set_system_word(at + 6, (proc >> 16) as u16);
            system.set_system_word(at + 2, ticks);
            system.set_system_word(at, ticks);
            system.arm_system_timers();

            return Ok(Answer::Word(at));
        }

        at += 8;
    }
}

/// The timer kept at a handle freed: nought, or the handle itself where no
/// timer is kept there (seg1 `0391`-`03bb`).
fn kill_system_timer(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    if !system.system_started() {
        return Ok(Answer::Word(handle));
    }

    let mut at = FIRST_TIMER;

    loop {
        let rate = system.system_word(at);

        if rate == 0xffff && system.system_word(at + 2) == 0xffff {
            return Ok(Answer::Word(handle));
        }

        if rate != 0xffff && at == handle {
            system.set_system_word(at, 0xffff);
            system.set_system_word(at + 2, 0);
            system.set_system_word(at + 4, 0);
            system.set_system_word(at + 6, 0);
            system.cancel_interrupts(KEY | u64::from(at));

            return Ok(Answer::Word(0));
        }

        at += 8;
    }
}

/// The timer's interrupt hooked: the timers run (seg1 `02e2`).
fn enable_system_timers(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    if system.system_started() {
        system.set_system_byte(HOOKED, 1);
        system.arm_system_timers();
    }

    Ok(Answer::Nothing)
}

/// The timer's interrupt let go: no timer runs until it is hooked again
/// (`030d`).
fn disable_system_timers(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    if system.system_started() {
        system.set_system_byte(HOOKED, 0);
    }

    Ok(Answer::Nothing)
}

/// The milliseconds since Windows started, as USER's `GetTickCount`
/// answers them: USER's is this, a jump to it (`USER.EXE` seg1 `729f`).
fn get_system_msec_count(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Dword(crate::user::tick_count(system)))
}

/// The bytes `Save80x87State` writes: `FSAVE`'s 94 where the BIOS's
/// equipment word says there is a coprocessor, nought where it does not
/// (seg1 `016c`, from `01fe`-`021e`).
fn get_80x87_save_size(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(if system.coprocessor { 0x5e } else { 0 }))
}

/// The unit's state, as `FSAVE` writes it, which leaves it as `FNINIT`
/// does (`0177`).
fn save_80x87_state(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    crate::win87em::save_unit(system, far)?;
    Ok(Answer::Nothing)
}

/// The unit's state put back from what `Save80x87State` wrote (`0183`).
fn restore_80x87_state(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    crate::win87em::restore_unit(system, far)?;
    Ok(Answer::Nothing)
}
