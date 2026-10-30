//! The two window procedures SHELL exports for its own windows: its DDE
//! windows' (`HERETHARBETYGARS`) and the one its About box's icon is
//! subclassed with (`WCI`). As `shell/internal-procs.ts`, which cites the
//! read-outs; **recorded** by `ugaps`.

use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Later, Stop};
use crate::commdlg::api::{Arg, api};
use crate::engine::Engine;
use crate::system::System;

const WM_DESTROY: u16 = 0x0002;
const WM_DDE_FIRST: u16 = 0x03e0;
const WM_DDE_TERMINATE: u16 = 0x03e1;
const WM_DDE_ACK: u16 = 0x03e4;
const WM_DDE_LAST: u16 = 0x03e8;
const PM_REMOVE: u16 = 0x0001;

/// The property a DDE window keeps its partner under: SHELL's string at
/// 0A0h of its data (`SHELL.DLL` seg13 `00a0`).
const CONVERSATION: &[u8] = b"ddeconv";
const CONVERSATION_AT: u16 = 0x00a0;

/// The partner's property while the window is ending (seg4 `060d`).
const ENDING: u16 = 1;

/// How long `WM_DESTROY` waits for the partner's answer (seg4 `04f7`).
const TERMINATE_WAIT: u32 = 10000;

/// A `MSG`'s bytes: the window, the message.
const MSG_SIZE: usize = 18;

/// The property's name, laid in SHELL's data where SHELL keeps it.
fn conversation_name(system: &mut System) -> u32 {
    let data = system
        .kept_named("SHELL")
        .map_or(0, |kept| segment_selector(system.kept[kept].data));
    let far = u32::from(data) << 16 | u32::from(CONVERSATION_AT);
    let mut bytes = CONVERSATION.to_vec();

    bytes.push(0);
    system.write_far(far, &bytes);
    far
}

async fn user(engine: &Engine, name: &'static str, args: &[Arg]) -> Result<u32, Stop> {
    Ok(api(engine, "USER", name, args).await?.value)
}

/// The window's partner, its property.
async fn partner(engine: &Engine, hwnd: u16, name: u32) -> Result<u16, Stop> {
    Ok(user(engine, "GetProp", &[Arg::W(hwnd), Arg::D(name)]).await? as u16)
}

/// The partner's `WM_DDE_TERMINATE` waited for (seg4 `04ec`-`054c`).
async fn await_terminate(engine: &Engine, hwnd: u16) -> Result<(), Stop> {
    let until = user(engine, "GetTickCount", &[])
        .await?
        .wrapping_add(TERMINATE_WAIT);

    loop {
        let called = api(
            engine,
            "USER",
            "PeekMessage",
            &[
                Arg::B(vec![0; MSG_SIZE]),
                Arg::W(0),
                Arg::W(WM_DDE_FIRST),
                Arg::W(WM_DDE_LAST),
                Arg::W(PM_REMOVE),
            ],
        )
        .await?;

        if called.value as u16 != 0 {
            let msg = called.buffers[0].clone();
            let window = u16::from_le_bytes([msg[0], msg[1]]);
            let message = u16::from_le_bytes([msg[2], msg[3]]);

            user(engine, "DispatchMessage", &[Arg::B(msg)]).await?;

            if window == hwnd && message == WM_DDE_TERMINATE {
                return Ok(());
            }

            continue;
        }

        if user(engine, "GetTickCount", &[]).await? >= until {
            return Ok(());
        }
    }
}

/// `HERETHARBETYGARS` (`SHELL.DLL` seg4 `0550`-`065e`): the procedure of
/// SHELL's DDE windows, which keep their partner as the property
/// `ddeconv` -- an acknowledgement makes the sender the partner, or frees
/// the block in lParam's high word, and destroys the window when it is the
/// partner's; a termination from the partner is answered and ends the
/// window; `WM_DESTROY` tells the partner and waits for its answer before
/// `DefWindowProc`.
pub fn heretharbetygars(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, wparam, lparam, name) = {
            let mut system = engine.system();
            let hwnd = args.word(&system);
            let message = args.word(&system);
            let wparam = args.word(&system);
            let lparam = args.dword(&system);

            (
                hwnd,
                message,
                wparam,
                lparam,
                conversation_name(&mut system),
            )
        };

        match message {
            WM_DDE_ACK => {
                let kept = partner(engine, hwnd, name).await?;

                if kept == 0 {
                    let set = user(
                        engine,
                        "SetProp",
                        &[Arg::W(hwnd), Arg::D(name), Arg::W(wparam)],
                    )
                    .await?;

                    return Ok(Answer::Dword(u32::from(set as u16)));
                }

                if kept == ENDING || kept == wparam {
                    api(
                        engine,
                        "KERNEL",
                        "GlobalFree",
                        &[Arg::W((lparam >> 16) as u16)],
                    )
                    .await?;
                }

                if kept != ENDING && kept == wparam {
                    user(engine, "DestroyWindow", &[Arg::W(hwnd)]).await?;
                }

                Ok(Answer::Dword(0))
            }
            WM_DDE_TERMINATE => {
                if partner(engine, hwnd, name).await? == wparam {
                    user(
                        engine,
                        "PostMessage",
                        &[
                            Arg::W(wparam),
                            Arg::W(WM_DDE_TERMINATE),
                            Arg::W(hwnd),
                            Arg::D(0),
                        ],
                    )
                    .await?;
                    user(engine, "RemoveProp", &[Arg::W(hwnd), Arg::D(name)]).await?;
                    user(engine, "DestroyWindow", &[Arg::W(hwnd)]).await?;
                }

                Ok(Answer::Dword(0))
            }
            _ => {
                if message == WM_DESTROY {
                    let kept = partner(engine, hwnd, name).await?;

                    if kept != 0 {
                        user(
                            engine,
                            "SetProp",
                            &[Arg::W(hwnd), Arg::D(name), Arg::W(ENDING)],
                        )
                        .await?;
                        user(
                            engine,
                            "PostMessage",
                            &[
                                Arg::W(kept),
                                Arg::W(WM_DDE_TERMINATE),
                                Arg::W(hwnd),
                                Arg::D(0),
                            ],
                        )
                        .await?;
                        await_terminate(engine, hwnd).await?;
                        user(engine, "RemoveProp", &[Arg::W(hwnd), Arg::D(name)]).await?;
                    }
                }

                let answer = user(
                    engine,
                    "DefWindowProc",
                    &[
                        Arg::W(hwnd),
                        Arg::W(message),
                        Arg::W(wparam),
                        Arg::D(lparam),
                    ],
                )
                .await?;

                Ok(Answer::Dword(answer))
            }
        }
    })
}

/// `WCI` (`SHELL.DLL` seg9 `0829`-`0dbd`): whatever the message,
/// `CallWindowProc` of the procedure SHELL kept as it subclassed its About
/// box's icon -- none in WinBox, whose About box subclasses nothing, which
/// USER's parameter check refuses: nought.
pub fn wci(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, message, wparam, lparam) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
            )
        };
        let answer = user(
            engine,
            "CallWindowProc",
            &[
                Arg::D(0),
                Arg::W(hwnd),
                Arg::W(message),
                Arg::W(wparam),
                Arg::D(lparam),
            ],
        )
        .await?;

        Ok(Answer::Dword(answer))
    })
}
