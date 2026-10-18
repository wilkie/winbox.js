//! DDEML's string handles as atoms, its last error, and what it tells the
//! monitors: the notices of `MF_HSZ_INFO`, `MF_ERRORS`, `MF_CALLBACKS`,
//! `MF_LINKS` and `MF_CONV` each a `GMEM_DDESHARE` block sent to every
//! monitor's window, the two hooks of `MF_SENDMSGS` and `MF_POSTMSGS`, and
//! the monitor's window procedure (`DDEML.DLL` seg1 `2ddc`-`3672`,
//! `61a8`). As `src/win16/ddeml/monitor.ts`.

use crate::commdlg::api::Arg;
use crate::engine::GuestArg;

use super::core::{Dd, R, hi, lo, long, plus};
use super::{D_HOOK, D_INSTANCES, D_MONITORS};

/// `MF_*`, as the high word of an instance's flags holds them.
pub(crate) const MF_HSZ_INFO: u16 = 0x0100;
pub(crate) const MF_SENDMSGS: u16 = 0x0200;
pub(crate) const MF_POSTMSGS: u16 = 0x0400;
pub(crate) const MF_CALLBACKS: u16 = 0x0800;
pub(crate) const MF_ERRORS: u16 = 0x1000;
pub(crate) const MF_LINKS: u16 = 0x2000;
pub(crate) const MF_CONV: u16 = 0x4000;

/// `XTYP_MONITOR`.
pub(crate) const XTYP_MONITOR: u16 = 0x80f2;

/// `358a`: a block of `size` bytes for a notice, where any monitor takes
/// it: `MAKELONG(100h, block)`, nought where none does.
pub(crate) async fn notice_block(d: &Dd<'_>, size: u16, flag: u16) -> R<u32> {
    let monitors = d.d16(D_MONITORS);

    if monitors == 0 {
        return Ok(0);
    }

    let mut seen = 0u16;
    let mut instance = d.d16(D_INSTANCES);

    while instance != 0 && seen < d.d16(D_MONITORS) {
        if d.i16(instance, 0x1c) & flag != 0 {
            let block = d.share(u32::from(size), 0, 0).await?;

            return Ok(long(0x100, block));
        }

        if d.i16(instance, 0x1a) & 1 != 0 {
            seen += 1;
        }

        instance = d.i16(instance, 0);
    }

    Ok(0)
}

/// `3524`: a notice sent to each monitor whose flags take it, then freed.
pub(crate) async fn send_notice(d: &Dd<'_>, block: u32, flag: u16) -> R<()> {
    let mut seen = 0u16;
    let mut instance = d.d16(D_INSTANCES);

    while instance != 0 && seen < d.d16(D_MONITORS) {
        let window = d.i16(instance, 0x26);

        if window != 0 {
            if d.i16(instance, 0x1c) & flag != 0 {
                d.send(window, 0x4ca, flag, block).await?;
            }

            seen += 1;
        }

        instance = d.i16(instance, 0);
    }

    d.global_unlock(hi(block)).await?;
    d.global_free(hi(block)).await?;
    Ok(())
}

/// A notice's block locked: its far address.
async fn lock(d: &Dd<'_>, block: u32) -> R<u32> {
    d.global_lock(hi(block)).await
}

/// `326e`: `MF_HSZ_INFO`, a `MONHSZSTRUCT`: an atom's action and name.
pub(crate) async fn hsz_notice(d: &Dd<'_>, atom: u16, action: u16, task: u16) -> R<()> {
    let hsz = u32::from(atom);
    let length = hsz_length(d, hsz).await?;
    let block = notice_block(d, length.wrapping_add(0x11), MF_HSZ_INFO).await?;

    if block == 0 {
        return Ok(());
    }

    let at = lock(d, block).await?;

    d.w16(at, length.wrapping_add(0x12));

    let time = d.current_time().await?;

    d.w32(plus(at, 4), time);
    d.w16(plus(at, 0xc), task);
    d.w16(plus(at, 2), action);
    d.w32(plus(at, 8), hsz);
    query_hsz(d, hsz, plus(at, 0x10), length.wrapping_add(1)).await?;
    send_notice(d, block, MF_HSZ_INFO).await
}

/// `3304`: an instance's last error set, told to the monitors first
/// (`MF_ERRORS`, a `MONERRSTRUCT`) where it is not nought.
pub(crate) async fn set_error(d: &Dd<'_>, instance: u16, error: u16) -> R<()> {
    if error != 0 {
        let block = notice_block(d, 10, MF_ERRORS).await?;

        if block != 0 {
            let at = lock(d, block).await?;

            d.w16(at, 10);

            let time = d.current_time().await?;

            d.w32(plus(at, 4), time);
            d.w16(plus(at, 8), d.i16(instance, 0x1e));
            d.w16(plus(at, 2), error);
            send_notice(d, block, MF_ERRORS).await?;
        }
    }

    d.si16(instance, 0x2a, error);
    Ok(())
}

/// `3196`: `MF_CALLBACKS`, a `MONCBSTRUCT`: a callback and its answer.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn callback_notice(
    d: &Dd<'_>,
    instance: u16,
    kind: u16,
    format: u16,
    conv: u32,
    hsz1: u32,
    hsz2: u32,
    data: u32,
    data1: u32,
    data2: u32,
    answer: u32,
) -> R<()> {
    if instance == 0 {
        return Ok(());
    }

    let block = notice_block(d, 0x2a, MF_CALLBACKS).await?;

    if block == 0 {
        return Ok(());
    }

    let at = lock(d, block).await?;

    d.w16(at, 0x2a);

    let time = d.current_time().await?;

    d.w32(plus(at, 4), time);
    d.w16(plus(at, 8), d.i16(instance, 0x1e));
    d.w32(plus(at, 0xa), answer);
    d.w16(plus(at, 0xe), kind);
    d.w16(plus(at, 0x10), format);
    d.w32(plus(at, 0x12), conv);
    d.w32(plus(at, 0x16), hsz1);
    d.w32(plus(at, 0x1a), hsz2);
    d.w32(plus(at, 0x1e), data);
    d.w32(plus(at, 0x22), data1);
    d.w32(plus(at, 0x26), data2);
    send_notice(d, block, MF_CALLBACKS).await
}

/// `3376`: `MF_LINKS`, a `MONLINKSTRUCT`: an advise link made or ended.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn link_notice(
    d: &Dd<'_>,
    instance: u16,
    established: u16,
    no_data: u16,
    service: u32,
    topic: u32,
    item: u32,
    format: u16,
    server: u16,
    conv_server: u32,
    conv_client: u32,
) -> R<()> {
    let block = notice_block(d, 0x24, MF_LINKS).await?;

    if block == 0 {
        return Ok(());
    }

    let at = lock(d, block).await?;

    d.w16(at, 0x24);

    let time = d.current_time().await?;

    d.w32(plus(at, 2), time);
    d.w16(plus(at, 6), d.i16(instance, 0x1e));
    d.w16(plus(at, 8), established);
    d.w16(plus(at, 0xa), no_data);
    d.w32(plus(at, 0xc), service);
    d.w32(plus(at, 0x10), topic);
    d.w32(plus(at, 0x14), item);
    d.w16(plus(at, 0x18), format);
    d.w16(plus(at, 0x1a), server);
    d.w32(plus(at, 0x1c), conv_server);
    d.w32(plus(at, 0x20), conv_client);
    send_notice(d, block, MF_LINKS).await
}

/// A conversation's handle from its window, as DDEML makes one each
/// time: `MAKELONG(window, its word 4)`, nought for no window.
pub(crate) async fn conv_of(d: &Dd<'_>, hwnd: u16) -> R<u32> {
    if d.is_window(hwnd).await? {
        let tag = d.window_word(hwnd, 4).await?;

        Ok(long(hwnd, tag))
    } else {
        Ok(0)
    }
}

/// `3438`: `MF_CONV`, a `MONCONVSTRUCT`: a conversation made or ended.
pub(crate) async fn conv_notice(
    d: &Dd<'_>,
    instance: u16,
    service: u16,
    topic: u16,
    client: u16,
    server: u16,
    connect: u16,
) -> R<()> {
    let block = notice_block(d, 0x1a, MF_CONV).await?;

    if block == 0 {
        return Ok(());
    }

    let at = lock(d, block).await?;

    d.w16(at, 0x1a);

    let time = d.current_time().await?;

    d.w32(plus(at, 4), time);
    d.w16(plus(at, 8), d.i16(instance, 0x1e));
    d.w16(plus(at, 0xa), service);
    d.w16(plus(at, 0xc), 0);
    d.w16(plus(at, 0xe), topic);
    d.w16(plus(at, 0x10), 0);

    let client = conv_of(d, client).await?;

    d.w32(plus(at, 0x12), client);

    let server = conv_of(d, server).await?;

    d.w32(plus(at, 0x16), server);
    d.w16(plus(at, 2), connect);
    send_notice(d, block, MF_CONV).await
}

// The atoms.

/// `2ddc`: an atom deleted, told to the monitors first (action 7): 1
/// where `GlobalDeleteAtom` answered nought.
pub(crate) async fn delete_atom(d: &Dd<'_>, atom: u16) -> R<u16> {
    if atom == 0 {
        return Ok(1);
    }

    if d.d16(D_MONITORS) != 0 {
        let task = d.current_task().await?;

        hsz_notice(d, atom, 7, task).await?;
    }

    Ok(u16::from(d.delete_atom_raw(atom).await? == 0))
}

/// `2e18`: a count added to an atom by adding its name again, told to the
/// monitors first (action 6): the atom, nought where it has no name, 1
/// for nought.
pub(crate) async fn add_count(d: &Dd<'_>, atom: u16) -> R<u16> {
    if atom == 0 {
        return Ok(1);
    }

    if d.d16(D_MONITORS) != 0 {
        let task = d.current_task().await?;

        hsz_notice(d, atom, 6, task).await?;
    }

    let (length, name) = d.atom_name(atom, 0xff).await?;

    if length == 0 {
        return Ok(0);
    }

    d.add_atom_text(&name).await
}

/// `2e72`: the length of a string handle's name, seven more where it has
/// a window in its high word.
pub(crate) async fn hsz_length(d: &Dd<'_>, hsz: u32) -> R<u16> {
    if lo(hsz) == 0 {
        return Ok(0);
    }

    let (length, _) = d.atom_name(lo(hsz), 0xff).await?;

    if length == 0 {
        return Ok(0);
    }

    Ok(if hi(hsz) != 0 { length + 7 } else { length })
}

/// `2eb6`: a string handle's name written to a buffer, `:(hhhh)` after it
/// for its window where there is room (`wsprintf` of DS `0136`).
pub(crate) async fn query_hsz(d: &Dd<'_>, hsz: u32, buffer: u32, size: u16) -> R<u16> {
    if lo(hsz) == 0 {
        if size != 0 {
            d.w8(buffer, 0);
        }

        return Ok(0);
    }

    let mut length = d.atom_name_at(lo(hsz), buffer, size).await?;

    if length != 0 && hi(hsz) != 0 && size.wrapping_sub(7) > length {
        let text = format!(":({:04x})", hi(hsz));
        let mut bytes = text.into_bytes();

        bytes.push(0);
        d.write(plus(buffer, length), &bytes);
        length += 7;
    }

    Ok(length)
}

/// `2f26`, `2f50`: the atom of a string -- added, told to the monitors
/// after (action 5), or only found -- nought for none or an empty string.
pub(crate) async fn string_atom(d: &Dd<'_>, string: u32, add: bool) -> R<u16> {
    if string == 0 || d.r8(string) == 0 {
        return Ok(0);
    }

    let atom = if add {
        d.add_atom_at(string).await?
    } else {
        d.find_atom_at(string).await?
    };

    if add && d.d16(D_MONITORS) != 0 {
        let task = d.current_task().await?;

        hsz_notice(d, atom, 5, task).await?;
    }

    Ok(atom)
}

// The hooks.

/// The message a hook was told of, as a `MONMSGSTRUCT`: sent to the
/// monitors where it is a DDE message.
async fn message_notice(
    d: &Dd<'_>,
    flag: u16,
    hwnd: u16,
    time: Option<u32>,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> R<()> {
    if !(0x3e0..=0x3e8).contains(&message) {
        return Ok(());
    }

    let block = notice_block(d, 0x12, flag).await?;

    if block == 0 {
        return Ok(());
    }

    let at = lock(d, block).await?;

    d.w16(at, 0x12);

    let time = match time {
        Some(time) => time,
        None => d.current_time().await?,
    };

    d.w32(plus(at, 4), time);
    d.w16(plus(at, 2), hwnd);

    let task = d.window_task(hwnd).await?;

    d.w16(plus(at, 8), task);
    d.w16(plus(at, 0xa), message);
    d.w16(plus(at, 0xc), wparam);
    d.w32(plus(at, 0xe), lparam);
    send_notice(d, block, flag).await
}

/// The hook after: `DefHookProc` with DDEML's word of the hook before
/// (`[3Ah]`).
async fn pass_on(d: &Dd<'_>, code: u16, wparam: u16, lparam: u32) -> R<u32> {
    let next = d.near(D_HOOK);

    d.user(
        "DefHookProc",
        &[Arg::W(code), Arg::W(wparam), Arg::D(lparam), Arg::D(next)],
    )
    .await
}

/// `DDESENDHOOKPROC` (`2fb0`), `WH_CALLWNDPROC`: each DDE message sent,
/// `MF_SENDMSGS`, the window it is sent to and the time now.
pub(crate) async fn send_hook(d: &Dd<'_>, code: u16, wparam: u16, lparam: u32) -> R<u32> {
    if d.d16(D_MONITORS) != 0 && lparam != 0 {
        let message = d.r16(plus(lparam, 6));

        if (0x3e0..=0x3e8).contains(&message) {
            let hwnd = d.r16(plus(lparam, 8));
            let wp = d.r16(plus(lparam, 4));
            let lp = d.r32(lparam);

            message_notice(d, MF_SENDMSGS, hwnd, None, message, wp, lp).await?;
        }
    }

    pass_on(d, code, wparam, lparam).await
}

/// `DDEPOSTHOOKPROC` (`309e`), `WH_GETMESSAGE`: each DDE message taken
/// from a queue, `MF_POSTMSGS`, with the message's own time.
pub(crate) async fn post_hook(d: &Dd<'_>, code: u16, wparam: u16, lparam: u32) -> R<u32> {
    if d.d16(D_MONITORS) != 0 && lparam != 0 {
        let message = d.r16(plus(lparam, 2));

        if (0x3e0..=0x3e8).contains(&message) {
            let hwnd = d.r16(lparam);
            let time = d.r32(plus(lparam, 0xa));
            let wp = d.r16(plus(lparam, 4));
            let lp = d.r32(plus(lparam, 6));

            message_notice(d, MF_POSTMSGS, hwnd, Some(time), message, wp, lp).await?;
        }
    }

    pass_on(d, code, wparam, lparam).await
}

/// `MONITORWNDPROC` (`35f2`): `WM_CREATE` keeps the instance at word 0;
/// a notice, `WM_USER + CAh`, is handed to the monitor's callback as
/// `XTYP_MONITOR`, the block as its data and the `MF_` flag in `dwData2`.
pub(crate) async fn monitor_proc(
    d: &Dd<'_>,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> R<u32> {
    match message {
        1 => {
            let instance = d.r16(lparam);

            Ok(u32::from(d.set_window_word(hwnd, 0, instance).await?))
        }
        0x4ca => {
            let instance = d.window_word(hwnd, 0).await?;

            super::instance::callback(
                d,
                instance,
                0,
                0,
                0,
                0,
                XTYP_MONITOR,
                lparam,
                0,
                long(0, wparam),
            )
            .await?;
            Ok(0)
        }
        _ => {
            d.user(
                "DefWindowProc",
                &[
                    Arg::W(hwnd),
                    Arg::W(message),
                    Arg::W(wparam),
                    Arg::D(lparam),
                ],
            )
            .await
        }
    }
}

/// `61a8`: an instance's heap full: the 256 bytes it keeps against that
/// let go, `DMLERR_LOW_MEMORY`, `XTYP_ERROR` called back, and its window
/// posted `WM_USER + D0h` to keep them again. 1 to try again, nought
/// where the heap is no instance's or nothing was kept.
pub(crate) async fn heap_full(d: &Dd<'_>, heap: u16) -> R<u16> {
    let mut instance = d.d16(D_INSTANCES);

    while instance != 0 && d.i16(instance, 0x20) != heap {
        instance = d.i16(instance, 0);
    }

    if instance == 0 || d.i32(instance, 0x36) == 0 {
        return Ok(0);
    }

    let kept = d.i32(instance, 0x36);

    d.free(kept).await?;
    d.si32(instance, 0x36, 0);
    set_error(d, instance, 0x4007).await?;
    super::instance::callback(d, instance, 0, 0, 0, 0, 0x8002, 0, 0x4007, 0).await?;

    let posted = d
        .post(d.i16(instance, 0x22), 0x4d0, 0, d.near(instance))
        .await?;

    if posted == 0 {
        set_error(d, instance, 0x400f).await?;
        return Ok(0);
    }

    Ok(1)
}

/// The arguments of a callback, as `DDEML.DLL` pushes them (`58c5`).
#[allow(clippy::too_many_arguments)]
pub(crate) fn callback_args(
    kind: u16,
    format: u16,
    conv: u32,
    hsz1: u32,
    hsz2: u32,
    data: u32,
    data1: u32,
    data2: u32,
) -> Vec<GuestArg> {
    vec![
        GuestArg::Word(kind),
        GuestArg::Word(format),
        GuestArg::Long(conv),
        GuestArg::Long(hsz1),
        GuestArg::Long(hsz2),
        GuestArg::Long(data),
        GuestArg::Long(data1),
        GuestArg::Long(data2),
    ]
}
