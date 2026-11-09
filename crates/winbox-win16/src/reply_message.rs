//! A message another task sent, answered early, and asked about. **Read
//! out of `USER.EXE`** and **recorded** by `replym`.

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::messages::Param;
use crate::scheduler::Answering;
use crate::system::System;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "ReplyMessage" => Implementation::Async(reply_message),
        "QuerySendMessage" => Implementation::Sync(query_send_message),
        _ => return None,
    })
}

/// The message another task sent that the task is answering now, if it is.
fn answering(system: &mut System) -> Option<Answering> {
    let slot = system.current_slot()?;
    let each = &system.scheduler.slots[slot];

    if each.in_sent == 0 {
        return None;
    }

    each.answering.last().cloned()
}

/// The sender given its answer now, and the processor (`USER.EXE` seg1
/// `3c37`-`3c96`); nothing outside a message another task sent, or once
/// answered.
fn reply_message(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (value, item) = {
            let mut system = engine.system();
            let value = args.dword(&system);

            (value, answering(&mut system))
        };
        let Some(item) = item.filter(|item| !item.replied.get()) else {
            return Ok(Answer::Nothing);
        };

        item.replied.set(true);
        *item.answer.borrow_mut() = Some((value, Param::Value(item.lparam)));
        engine.system().signal_slot(item.from);
        engine.hand_back(item.from).await;
        Ok(Answer::Nothing)
    })
}

/// The message another task sent that the task is answering, written, and
/// 1; nought outside one, or with a handle given (`USER.EXE` seg1
/// `490e`-`4980`).
#[allow(clippy::unnecessary_wraps)]
fn query_send_message(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let first = args.word(system);
    let second = args.word(system);
    let third = args.word(system);
    let far = args.dword(system);

    if first != 0 || second != 0 || third != 0 {
        return Ok(Answer::Word(0));
    }

    let Some(item) = answering(system).filter(|item| !item.replied.get()) else {
        return Ok(Answer::Word(0));
    };
    let mut bytes = Vec::with_capacity(10);

    bytes.extend_from_slice(&item.hwnd.to_le_bytes());
    bytes.extend_from_slice(&item.message.to_le_bytes());
    bytes.extend_from_slice(&item.wparam.to_le_bytes());
    bytes.extend_from_slice(&item.lparam.to_le_bytes());
    system.write_far(far, &bytes);
    Ok(Answer::Word(1))
}
