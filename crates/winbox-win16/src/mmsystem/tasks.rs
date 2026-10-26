//! MMSYSTEM's tasks: the calls its drivers make to run a task of their own
//! and to wait on it.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg1 `264`, seg4 `598`-`5f9`);
//! **recorded** by `mmmisc`:
//!
//! * `mmGetCurrentTask` is KERNEL's `GetCurrentTask`, jumped to.
//! * `mmTaskSignal` posts the task `WM_USER` (400h), its `wParam` and
//!   `lParam` nought: `PostAppMessage`'s answer.
//! * `mmTaskYield` looks for a message without taking it, and yields if
//!   there is one.
//! * `mmTaskBlock` takes the task's messages until one for no window from
//!   3A0h up: what it answers. A message for a window is translated and
//!   dispatched; one for no window below 3A0h is dropped. The task it is
//!   given is not looked at, nor is `WM_QUIT`.

use crate::call::{Answer, Args, Later, Stop, call_named};
use crate::engine::{Engine, GuestArg};

const WM_USER: u16 = 0x400;
const PM_NOREMOVE: u16 = 0;

/// A `MSG`'s bytes.
const MSG_SIZE: usize = 0x12;

fn word(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

/// One of USER's or KERNEL's calls made as MMSYSTEM makes it: its answer,
/// and the structure it was given as the call left it.
async fn call(
    engine: &Engine,
    module: &'static str,
    name: &'static str,
    args: &[GuestArg],
) -> Result<(Answer, Vec<Vec<u8>>), Stop> {
    Box::pin(call_named(engine, module, name, args)).await
}

/// The answer's value, nought for none.
pub(crate) fn value(answer: Answer) -> u32 {
    answer.value().unwrap_or(0)
}

/// `mmGetCurrentTask`: `GetCurrentTask`'s answer.
pub fn mm_get_current_task(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move { Ok(call(engine, "KERNEL", "GetCurrentTask", &[]).await?.0) })
}

/// `mmTaskSignal`: `WM_USER` posted to the task.
pub fn mm_task_signal(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let task = args.word(&engine.system());
        let args = [
            GuestArg::Word(task),
            GuestArg::Word(WM_USER),
            GuestArg::Word(0),
            GuestArg::Long(0),
        ];

        Ok(call(engine, "USER", "PostAppMessage", &args).await?.0)
    })
}

/// `mmTaskYield`: a yield, if the task has a message waiting.
pub fn mm_task_yield(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        let args = [
            GuestArg::Struct(vec![0; MSG_SIZE]),
            GuestArg::Word(0),
            GuestArg::Word(0),
            GuestArg::Word(0),
            GuestArg::Word(PM_NOREMOVE),
        ];

        if value(call(engine, "USER", "PeekMessage", &args).await?.0) != 0 {
            call(engine, "KERNEL", "Yield", &[]).await?;
        }

        Ok(Answer::Nothing)
    })
}

/// `mmTaskBlock`: the first message for no window from 3A0h up.
pub fn mm_task_block(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        loop {
            let args = [
                GuestArg::Struct(vec![0; MSG_SIZE]),
                GuestArg::Word(0),
                GuestArg::Word(0),
                GuestArg::Word(0),
            ];
            let (_, structures) = call(engine, "USER", "GetMessage", &args).await?;
            let msg = structures
                .into_iter()
                .next()
                .unwrap_or_else(|| vec![0; MSG_SIZE]);

            if word(&msg, 0) != 0 {
                call(
                    engine,
                    "USER",
                    "TranslateMessage",
                    &[GuestArg::Struct(msg.clone())],
                )
                .await?;
                call(engine, "USER", "DispatchMessage", &[GuestArg::Struct(msg)]).await?;
                continue;
            }

            let message = word(&msg, 2);

            if message >= 0x3a0 {
                return Ok(Answer::Word(message));
            }
        }
    })
}
