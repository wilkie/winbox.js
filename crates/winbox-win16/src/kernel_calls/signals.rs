//! A task's signal handler and its action, as KERNEL keeps them in the
//! task's database (TDB 24h and 26h), set with `SetSigHandler` and called
//! by `DoSignal` on Ctrl+Break. As `kernel/signals.ts`, which cites the
//! read-outs; **recorded** by `kgaps`.

use winbox_cpu::{AX, BX, DI, DS, DX, SI};
use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::handles::Object;
use crate::system::{STEP, System};

/// The only signal `SetSigHandler` takes: Ctrl+Break.
const SIGNAL_BREAK: u16 = 1;

/// The action whose handler `DoSignal` calls.
const ACTION_CALL: u16 = 2;

/// The action that sets KERNEL's own two words, not the task's.
const ACTION_KERNEL: u16 = 4;

/// KERNEL's own handler, a bare `RETF` (seg1 `6125`): WinBox's is KERNEL's
/// `ValidateFreeSpaces`, a bare return in Windows as here (`kintrnl`).
const DEFAULT_HANDLER_ORDINAL: u16 = 200;

fn default_handler(system: &mut System) -> u32 {
    let Some(kernel) = system.kept_named("KERNEL") else {
        return 0;
    };
    let stubs = system.stubs(kernel);

    u32::from(segment_selector(stubs)) << 16 | u32::from(STEP * (DEFAULT_HANDLER_ORDINAL + 1))
}

/// A task's action and handler: nought and KERNEL's own until set.
fn task_signal(system: &mut System, task: u16) -> Option<(u16, u32)> {
    let default = default_handler(system);
    let record = system.task_record(task)?;

    Some(*record.signal_handler.get_or_insert((0, default)))
}

fn set_task_signal(system: &mut System, task: u16, signal: (u16, u32)) {
    if let Some(record) = system.task_record(task) {
        record.signal_handler = Some(signal);
    }
}

/// `SetSigHandler` (seg3 `068c`-`06f0`): for signal 1, the action and
/// handler exchanged with the task's -- or, for action 4, the handler with
/// KERNEL's own -- the old ones written through their pointers; AX nought,
/// DX the old handler's selector. With no pointer for the old handler, DI
/// is KERNEL's data, SI the caller's DI and DS the caller's SI.
pub fn set_sig_handler(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handler = args.dword(system);
    let old_handler_at = args.dword(system);
    let old_action_at = args.dword(system);
    let action = args.word(system);
    let signal = args.word(system);

    system.cpu.regs[AX] = 0;

    if signal != SIGNAL_BREAK {
        return Ok(Answer::Nothing);
    }

    let handler = if action == 0 {
        default_handler(system)
    } else {
        handler
    };

    if action == ACTION_KERNEL {
        let old = std::mem::replace(&mut system.kernel_calls.kernel_sig_handler, handler);

        system.cpu.regs[DX] = (old >> 16) as u16;
        return Ok(Answer::Nothing);
    }

    let task = system.task_handle;
    let (old_action, old_handler) = task_signal(system, task).unwrap_or((0, 0));

    set_task_signal(system, task, (action, handler));

    if old_action_at != 0 {
        system.write_far(old_action_at, &old_action.to_le_bytes());
    }

    system.cpu.regs[DX] = (old_handler >> 16) as u16;

    if old_handler_at != 0 {
        system.write_far(old_handler_at, &old_handler.to_le_bytes());
        return Ok(Answer::Nothing);
    }

    let di = system.cpu.regs[DI];
    let si = system.cpu.regs[SI];
    let kernel = system
        .kept_named("KERNEL")
        .map_or(0, |kept| segment_selector(system.kept[kept].data));

    system.cpu.regs[DI] = kernel;
    system.cpu.regs[SI] = di;
    system.cpu.load_segment(DS, si).map_err(Stop::Processor)?;

    Ok(Answer::Nothing)
}

/// `DoSignal` (seg1 `612c`-`6173`): the focus window's task's handler,
/// where its action is 2, called with nought and then 1 pushed, AX 1 and
/// BX nought; every register kept. WinBox's task handles are not
/// selectors, so DS is left the caller's (`kgaps:dosignalds`).
pub fn do_signal(engine: &Engine, _args: Args) -> Later<'_> {
    Box::pin(async move {
        let handler = {
            let mut system = engine.system();

            system.raster();

            let focus = system
                .focus
                .and_then(|focus| system.windows[focus].as_ref())
                .map_or(0, |window| window.hwnd);
            let task = match system.handles.resolve(focus) {
                Some(Object::Window(index)) if focus != 0 => system.windows[index]
                    .as_ref()
                    .map_or(0, |window| window.task),
                _ => return Ok(Answer::Nothing),
            };

            match task_signal(&mut system, task) {
                Some((ACTION_CALL, handler)) => handler,
                _ => return Ok(Answer::Nothing),
            }
        };

        engine
            .call_with(
                handler,
                &[GuestArg::Word(0), GuestArg::Word(1)],
                &[Register::Word(AX, 1), Register::Word(BX, 0)],
            )
            .await?;

        Ok(Answer::Nothing)
    })
}
