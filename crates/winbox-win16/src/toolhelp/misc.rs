//! TOOLHELP's `WEP`, `TimerCount`, `MemManInfo` and `TerminateApp`. As
//! `toolhelp/misc.ts`, which cites the read-outs.

use super::structures::structure;
use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::sys_error_box::{SEB_CLOSE, SEB_DEFBUTTON};
use crate::system::System;

/// `TIMERINFO`'s size.
const TIMERINFO: u16 = 0x0c;

/// The timer chip's counts a millisecond, as TOOLHELP divides by them, and
/// its rate a second.
const COUNTS_PER_MS: u32 = 0x4a9;
const PIT_HZ: f64 = 1_193_180.0;

/// `TerminateApp`'s flag that has it return to its caller.
const NO_UAE_BOX: u16 = 0x0001;

/// The library's exit procedure: TRUE (seg1 `018a`-`01d3`).
pub fn wep(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(1))
}

/// The milliseconds since Windows started, both counts the same (seg1
/// `2dae`-`2eb8`): `GetTickCount` and the milliseconds since its last
/// tick. **Recorded** by `thtask`.
pub fn timer_count(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let Some(entry) = structure(system, far, TIMERINFO) else {
        return Ok(Answer::Word(0));
    };
    let now = system.clock.now(system.instructions);
    let ticks = crate::user::tick_count(system);
    let counts = ((now - f64::from(ticks)) * (PIT_HZ / 1000.0))
        .floor()
        .clamp(0.0, 65535.0) as u32;
    let mut count = ticks.wrapping_add(counts / COUNTS_PER_MS);

    if count < system.timer_count {
        count = count.max(crate::user::tick_count(system));
    }

    system.timer_count = count;
    entry.write32(system, 4, count);
    entry.write32(system, 8, count);
    Ok(Answer::Word(1))
}

/// The memory manager's figures, each `FFFFFFFFh`, not known, and a page of
/// 1000h, with no check of `dwSize` (seg1 `13f4`-`14a7`). **Recorded** by
/// `thtask`.
pub fn mem_man_info(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    if far == 0 {
        return Ok(Answer::Word(0));
    }

    let entry = super::structures::Far(far);

    for at in 4..0x28 {
        entry.write8(system, at, 0xff);
    }

    entry.write16(system, 0x28, 0x1000);
    Ok(Answer::Word(1))
}

/// A task ended (seg1 `26ea`-`27a0`): `FatalAppExit(0, NULL)`'s box
/// shown unless `NO_UAE_BOX`, then the task ended with code `FFh`, as DOS's
/// function 4Ch ends one. As `misc.ts`. **Recorded** by `thtask`.
pub fn terminate_app(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (task, flags) = {
            let system = engine.system();
            let task = args.word(&system);
            let flags = args.word(&system);
            let task = if task == 0 {
                system.current_task().unwrap_or(0)
            } else {
                task
            };

            (task, flags)
        };

        if !engine.system().live_task(task) {
            return Ok(Answer::Nothing);
        }

        if flags & NO_UAE_BOX == 0 {
            engine
                .sys_error_box(
                    b"Closing current application.",
                    b"Application Error",
                    [0, SEB_CLOSE | SEB_DEFBUTTON, 0],
                )
                .await?;
        }

        end_task(&mut engine.system(), task)
    })
}

/// The task ended as DOS's function 4Ch ends one.
fn end_task(system: &mut System, task: u16) -> Result<Answer, Stop> {
    if !system.live_task(task) {
        return Ok(Answer::Nothing);
    }

    // The running task ends as DOS's function 4Ch ends it (`dos.rs`).
    if system.current_task() == Some(task) {
        system.exit_code = Some(0xff);

        if system.task_count() > 1 || system.stays_up {
            system.exit_task(0xff);
        } else {
            system.ended = true;
        }

        return Err(Stop::Ended);
    }

    system.end_task_of(task, 0xff);
    Ok(Answer::Nothing)
}
