//! DDEML's instances: `DdeInitialize` and `DdeUninitialize`, the classes
//! and the first initialization's settings, `DdeNameService`,
//! `DdeEnableCallback`, `DdeGetLastError`, the string handles' calls, the
//! instance's window (`DMGWNDPROC`), the one place every callback is made
//! (`5832`), and the queue of callbacks waiting (`4e66`, `5b60`), as
//! `DDEML.DLL` seg1 has them. As `src/win16/ddeml/instance.ts`.

use crate::commdlg::api::Arg;

use super::core::{Cmp, Dd, R, hi, lo, long, off, plus};
use super::monitor::{self, add_count, delete_atom, set_error};
use super::{
    D_ARRAY_OWNED, D_ARRAY_SENT, D_CLASS_CLIENT, D_CLASS_DMG, D_CLASS_FRAME, D_CLASS_HOLDING,
    D_CLASS_MONITOR, D_CLASS_SERVER, D_HEAP, D_HINSTANCE, D_HOOK, D_INSTANCES, D_MADE_ME,
    D_MONITORS, D_PROGMAN, D_RETRY, D_SERIAL, D_SHUTDOWN, D_WHO,
};

pub(crate) const DMLERR_DLL_USAGE: u16 = 0x4004;
pub(crate) const DMLERR_INVALIDPARAMETER: u16 = 0x4006;
pub(crate) const DMLERR_MEMORY_ERROR: u16 = 0x4008;
pub(crate) const DMLERR_NO_CONV_ESTABLISHED: u16 = 0x400a;
pub(crate) const DMLERR_REENTRANCY: u16 = 0x400d;
pub(crate) const DMLERR_SYS_ERROR: u16 = 0x400f;

/// An instance identifier's record, where the check word matches: the
/// record's offset, nought for none.
pub(crate) fn instance_of(d: &Dd<'_>, id: u32) -> u16 {
    let instance = lo(id);

    if instance != 0 && d.i16(instance, 0x30) == hi(id) {
        instance
    } else {
        0
    }
}

/// `20a0`: the next instance after `from` -- the first for nought --
/// belonging to the current task.
pub(crate) async fn task_instance(d: &Dd<'_>, from: u16) -> R<u16> {
    if d.d16(D_INSTANCES) == 0 {
        return Ok(0);
    }

    let mut instance = if from != 0 {
        d.i16(from, 0)
    } else {
        d.d16(D_INSTANCES)
    };
    let task = d.current_task().await?;

    while instance != 0 {
        if d.i16(instance, 0x1e) == task {
            return Ok(instance);
        }

        instance = d.i16(instance, 0);
    }

    Ok(0)
}

/// The error of a bad handle set in each of the current task's instances,
/// as `DDEML.DLL` sets it where it has no instance of its own to set it in.
pub(crate) async fn error_each(d: &Dd<'_>, error: u16) -> R<()> {
    let mut instance = 0;

    loop {
        instance = task_instance(d, instance).await?;

        if instance == 0 {
            return Ok(());
        }

        set_error(d, instance, error).await?;
    }
}

/// `2dac`: whether a conversation handle is good: its window is one and
/// its word 4 the handle's high word.
pub(crate) async fn conv_valid(d: &Dd<'_>, conv: u32) -> R<bool> {
    Ok(d.is_window(lo(conv)).await? && d.window_word(lo(conv), 4).await? == hi(conv))
}

/// `2d84`: a window destroyed, if it is one.
pub(crate) async fn destroy(d: &Dd<'_>, hwnd: u16) -> R<u16> {
    if d.is_window(hwnd).await? {
        d.destroy_window(hwnd).await
    } else {
        Ok(1)
    }
}

/// `54e8`: a message sent, or posted, to each child of a window.
pub(crate) async fn each_child(
    d: &Dd<'_>,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
    post: bool,
) -> R<()> {
    if !d.is_window(hwnd).await? {
        return Ok(());
    }

    let mut child = d.get_window(hwnd, 5).await?;

    while child != 0 {
        let next = d.get_window(child, 2).await?;

        if post {
            d.post(child, message, wparam, lparam).await?;
        } else {
            d.send(child, message, wparam, lparam).await?;
        }

        child = next;
    }

    Ok(())
}

/// `5990`: DDEML's own strings, kept scrambled with 25h, made readable, and
/// `Who` and `Made me?` added as atoms in their places.
async fn signature(d: &Dd<'_>) -> R<()> {
    let mut at = D_WHO;

    while d.d16(at) & 0xff != 0 {
        let byte = d.r8(d.near(at));

        d.w8(d.near(at), byte ^ 0x25);
        at += 1;
    }

    let who = d.add_atom_at(d.near(D_WHO)).await?;

    d.sd16(D_WHO, who);

    let made = d.add_atom_at(d.near(D_MADE_ME)).await?;

    d.sd16(D_MADE_ME, made);
    Ok(())
}

/// `62e0`: DDEML's classes, style nought, no background, each window
/// procedure an export of its own, with DDEML's instance.
async fn register_classes(d: &Dd<'_>) -> R<()> {
    let instance = d.d16(D_HINSTANCE);

    for (class, ordinal, extra) in [
        (D_CLASS_CLIENT, 28, 6),
        (D_CLASS_SERVER, 29, 6),
        (D_CLASS_DMG, 31, 6),
        (D_CLASS_HOLDING, 32, 8),
        (D_CLASS_MONITOR, 33, 4),
        (D_CLASS_FRAME, 30, 4),
    ] {
        let procedure = super::export_address(d, ordinal);
        let mut bytes = Vec::with_capacity(26);

        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&procedure.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&(extra as u16).to_le_bytes());
        bytes.extend_from_slice(&instance.to_le_bytes());
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&d.near(class).to_le_bytes());
        d.user("RegisterClass", &[Arg::B(bytes)]).await?;
    }

    Ok(())
}

/// A time-out of `WIN.INI`'s `[DDEML]`, its default if nought (`00be`).
async fn profile_timeout(d: &Dd<'_>, key: u16, default_text: u16, default: u32) -> R<u32> {
    let called = d
        .call_b(
            "KERNEL",
            "GetProfileString",
            &[
                Arg::D(d.near(super::D_TEXT_DDEML)),
                Arg::D(d.near(key)),
                Arg::D(d.near(default_text)),
                Arg::D(d.near(super::D_PROFILE)),
                Arg::W(0x14),
            ],
        )
        .await?;
    let _ = called;
    let text = d.read(d.near(super::D_PROFILE), 0x14);
    let end = text.iter().position(|&b| b == 0).unwrap_or(text.len());
    let value = super::core::atol(&text[..end]);

    Ok(if value == 0 { default } else { value })
}

/// `DdeInitialize` (`0010`, `0048`).
#[allow(clippy::too_many_lines)]
pub(crate) async fn initialize(
    d: &Dd<'_>,
    pid: u32,
    callback: u32,
    flags: u32,
    reserved: u32,
) -> R<u16> {
    if reserved != 0 {
        return Ok(DMLERR_INVALIDPARAMETER);
    }

    let mut flags = flags;

    if flags & 1 != 0 {
        if d.d16(D_MONITORS) == 4 {
            return Ok(DMLERR_DLL_USAGE);
        }

        flags |= 0x0027_f000;
    }

    let existing = d.r16(pid);

    if existing != 0 {
        if d.r16(plus(pid, 2)) != d.i16(existing, 0x30) {
            return Ok(DMLERR_INVALIDPARAMETER);
        }

        let old = d.i32(existing, 0x1a);

        d.si32(existing, 0x1a, flags ^ ((old ^ flags) & 0x00c0_0fff));
        return Ok(0);
    }

    if d.d16(D_HEAP) == 0 {
        let shutdown = profile_timeout(d, super::D_TEXT_SHUTDOWN, super::D_TEXT_3000, 3000).await?;

        d.si32(0, D_SHUTDOWN, shutdown);

        let retry = profile_timeout(d, super::D_TEXT_RETRY, super::D_TEXT_30000, 30000).await?;

        d.si32(0, D_RETRY, retry);

        let progman = d.add_atom_at(d.near(super::D_TEXT_PROGMAN)).await?;

        d.sd16(D_PROGMAN, progman);
        d.sd16(D_HEAP, d.ds());
        signature(d).await?;
        register_classes(d).await?;
    }

    let mut instance = 0u16;
    let failed = 'made: {
        if d.i32(0, D_ARRAY_OWNED) == 0 {
            let array = d.array_new(d.d16(D_HEAP), 8, 8).await?;

            d.si32(0, D_ARRAY_OWNED, array);

            if array == 0 {
                break 'made true;
            }
        }

        if d.i32(0, D_ARRAY_SENT) == 0 {
            let array = d.array_new(d.d16(D_HEAP), 4, 8).await?;

            d.si32(0, D_ARRAY_SENT, array);

            if array == 0 {
                break 'made true;
            }
        }

        instance = off(d.alloc(d.d16(D_HEAP), 0x3c).await?);

        if instance == 0 {
            break 'made true;
        }

        let heap = d.heap_create(0x1000).await?;

        d.si16(instance, 0x20, heap);

        if heap == 0 {
            d.free(d.near(instance)).await?;
            instance = 0;
            break 'made true;
        }

        d.si16(instance, 0, d.d16(D_INSTANCES));
        d.si32(instance, 4, callback);

        let handles = d.array_new(heap, 4, 0x20).await?;

        d.si32(instance, 0xc, handles);

        let strings = d.array_new(heap, 2, 0x10).await?;

        d.si32(instance, 0x10, strings);

        let queue = d.list_new(heap, 0x2a).await?;

        d.si32(instance, 0x16, queue);
        d.si32(instance, 0x1a, flags | 0x20);

        let task = d.current_task().await?;

        d.si16(instance, 0x1e, task);

        let serial = d.d16(D_SERIAL).wrapping_add(1);

        d.sd16(D_SERIAL, serial);
        d.si16(instance, 0x30, serial);

        let links = d.list_new(heap, 0xe).await?;

        d.si32(instance, 0x32, links);

        let kept = d.alloc(heap, 0x100).await?;

        d.si32(instance, 0x36, kept);
        d.sd16(D_INSTANCES, instance);
        d.w16(pid, instance);
        d.w16(plus(pid, 2), d.i16(instance, 0x30));

        let window = d.create_window(D_CLASS_DMG, 0, 0, d.near(instance)).await?;

        d.si16(instance, 0x22, window);

        if window == 0 {
            break 'made true;
        }

        if d.i16(instance, 0x1a) & 1 != 0 {
            let flags = d.i32(instance, 0x1a) | 0x0027_f000;

            d.si32(instance, 0x1a, flags);

            let monitor = d
                .create_window(D_CLASS_MONITOR, 0, 0, d.near(instance))
                .await?;

            d.si16(instance, 0x26, monitor);

            if monitor == 0 {
                break 'made true;
            }

            let monitors = d.d16(D_MONITORS).wrapping_add(1);

            d.sd16(D_MONITORS, monitors);

            if monitors == 1 {
                let post = super::export_address(d, 35);
                let hook = d.user("SetWindowsHook", &[Arg::W(3), Arg::D(post)]).await?;

                d.si32(0, D_HOOK, hook);

                let send = super::export_address(d, 34);
                let hook = d.user("SetWindowsHook", &[Arg::W(4), Arg::D(send)]).await?;

                d.si32(0, D_HOOK, hook);
            }

            break 'made false;
        }

        if flags & 0x10 != 0 {
            break 'made false;
        }

        let frame = d
            .create_window(D_CLASS_FRAME, 0x8000_0000, 0, d.near(instance))
            .await?;

        d.si16(instance, 0x24, frame);

        frame == 0
    };

    if !failed {
        return Ok(0);
    }

    if instance != 0 {
        // As `DDEML.DLL` cleans up (`0358`): `DdeUninitialize` of the
        // record and DDEML's data segment for its check word, which
        // matches no instance's serial.
        let ds = d.ds();

        Box::pin(uninitialize(d, long(instance, ds))).await?;
    }

    Ok(DMLERR_SYS_ERROR)
}

/// `TERMDLGPROC` (`036a`): the dialog of `DdeUninitialize`'s wait for its
/// partners, ended with the button's number.
pub(crate) async fn term_dlg_proc(d: &Dd<'_>, hwnd: u16, message: u16, wparam: u16) -> R<u32> {
    match message {
        0x110 => Ok(1),
        0x111 if (3..=5).contains(&wparam) => {
            d.user("EndDialog", &[Arg::W(hwnd), Arg::W(wparam)]).await?;
            Ok(0)
        }
        _ => Ok(0),
    }
}

/// `DdeUninitialize` (`03ae`).
pub(crate) async fn uninitialize(d: &Dd<'_>, id: u32) -> R<u16> {
    let instance = instance_of(d, id);

    if instance == 0 {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if d.i32(instance, 8) != 0 {
        name_service(d, id, 0, 0, 2).await?;
    }

    each_child(d, d.i16(instance, 0x22), 0x4ce, 0x2000, 0, false).await?;

    if d.i16(instance, 2) != 0 {
        wait_for_partners(d, instance).await?;
    }

    if d.i16(instance, 0x28) != 0 {
        let looped = d.i16(instance, 0x3a) | 2;

        d.si16(instance, 0x3a, looped);
        d.post(d.i16(instance, 0x28), 0x113, 1, 0).await?;
    }

    if d.i16(instance, 0x26) != 0 {
        destroy(d, d.i16(instance, 0x26)).await?;

        let monitors = d.d16(D_MONITORS).wrapping_sub(1);

        d.sd16(D_MONITORS, monitors);

        if monitors == 0 {
            let post = super::export_address(d, 35);

            d.user("UnhookWindowsHook", &[Arg::W(3), Arg::D(post)])
                .await?;

            let send = super::export_address(d, 34);

            d.user("UnhookWindowsHook", &[Arg::W(4), Arg::D(send)])
                .await?;
        }
    }

    unlink(d, instance);
    destroy(d, d.i16(instance, 0x22)).await?;
    destroy(d, d.i16(instance, 0x24)).await?;

    let mut record = Vec::new();

    while d.array_pop(d.i32(instance, 0xc), &mut record).await? {
        let value = u32::from_le_bytes([record[0], record[1], record[2], record[3]]);

        super::data::free_value(d, instance, value, false).await?;
    }

    d.array_free(d.i32(instance, 0xc)).await?;

    while d.array_pop(d.i32(instance, 0x10), &mut record).await? {
        let atom = u16::from_le_bytes([record[0], record[1]]);

        if d.d16(D_MONITORS) != 0 {
            monitor::hsz_notice(d, atom, 4, d.i16(instance, 0x1e)).await?;
        }

        delete_atom(d, atom).await?;
    }

    d.array_free(d.i32(instance, 0x10)).await?;
    d.array_free(d.i32(instance, 8)).await?;
    d.list_free(d.i32(instance, 0x32)).await?;
    d.heap_free(d.i16(instance, 0x20)).await?;
    d.si16(instance, 0x30, d.i16(instance, 0x30).wrapping_sub(1));
    d.free(d.near(instance)).await?;

    if d.d16(D_INSTANCES) == 0 {
        d.array_free(d.i32(0, D_ARRAY_OWNED)).await?;
        d.array_free(d.i32(0, D_ARRAY_SENT)).await?;
        d.si32(0, D_ARRAY_OWNED, 0);
        d.si32(0, D_ARRAY_SENT, 0);
        d.delete_atom_raw(d.d16(D_PROGMAN)).await?;
    }

    Ok(1)
}

/// `DdeUninitialize`'s wait for the partners its terminations were posted
/// to (`0418`-`0519`): `ShutdownTimeout` on the instance's window's timer
/// 2, then `TermDialog`, whose Retry waits `ShutdownRetryTimeout` more,
/// Continue waits on, and Close gives up.
async fn wait_for_partners(d: &Dd<'_>, instance: u16) -> R<()> {
    let window = d.i16(instance, 0x22);
    let mut periods = d.d16(D_SHUTDOWN + 2);

    d.set_timer(window, 2, d.d16(D_SHUTDOWN)).await?;

    while d.i16(instance, 2) != 0 {
        d.kernel("Yield", &[]).await?;

        let called = d
            .call_b(
                "USER",
                "GetMessage",
                &[
                    crate::commdlg::api::buffer(18),
                    Arg::W(0),
                    Arg::W(0),
                    Arg::W(0xffff),
                ],
            )
            .await?;
        let msg = called.buffers[0].clone();
        let word = |at: usize| u16::from_le_bytes([msg[at], msg[at + 1]]);

        if word(2) == 0x113 && word(4) == 2 && word(0) == d.i16(instance, 0x22) {
            let left = periods;

            periods = periods.wrapping_sub(1);

            if left != 0 {
                d.set_timer(window, 2, 0xffff).await?;
            } else {
                d.kill_timer(window, 2).await?;

                if d.i16(instance, 2) == 0 {
                    break;
                }

                let answer = term_dialog(d).await?;

                if answer == 3 || answer == 0xffff {
                    d.si16(instance, 2, 0);
                    break;
                }

                if answer == 4 {
                    periods = d.d16(D_RETRY + 2);
                    d.set_timer(window, 2, d.d16(D_RETRY)).await?;
                }
            }
        }

        d.user("DispatchMessage", &[Arg::B(msg)]).await?;
    }

    Ok(())
}

/// `TermDialog` (`049c`-`04cb`), from DDEML's own template, `TERMDLGPROC`
/// its procedure: the button it was ended with.
async fn term_dialog(d: &Dd<'_>) -> R<u16> {
    let template = super::resources::TERM_DIALOG;
    let block = d.global_alloc(0x0042, template.len() as u32).await?;
    let at = d.global_lock(block).await?;

    d.write(at, template);
    d.global_unlock(block).await?;

    let procedure = super::export_address(d, 39);
    let answer = d
        .user(
            "DialogBoxIndirect",
            &[
                Arg::W(d.d16(D_HINSTANCE)),
                Arg::W(block),
                Arg::W(0),
                Arg::D(procedure),
            ],
        )
        .await? as u16;

    d.global_free(block).await?;
    Ok(answer)
}

/// `20f4`: an instance taken out of the list.
fn unlink(d: &Dd<'_>, instance: u16) {
    if d.d16(D_INSTANCES) == instance {
        d.sd16(D_INSTANCES, d.i16(instance, 0));
        return;
    }

    let mut at = d.d16(D_INSTANCES);

    while at != 0 && d.i16(at, 0) != instance {
        at = d.i16(at, 0);
    }

    if at != 0 {
        d.si16(at, 0, d.i16(instance, 0));
    }
}

/// `DdeNameService` (`1ed4`).
#[allow(clippy::verbose_bit_mask)]
pub(crate) async fn name_service(
    d: &Dd<'_>,
    id: u32,
    hsz: u32,
    _reserved: u32,
    command: u16,
) -> R<u32> {
    let instance = instance_of(d, id);

    if instance == 0 {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if command & 4 != 0 {
        d.si16(instance, 0x1a, d.i16(instance, 0x1a) | 0x20);
    }

    if command & 8 != 0 {
        d.si16(instance, 0x1a, d.i16(instance, 0x1a) & !0x20);
    }

    if command & 3 == 0 {
        return Ok(0);
    }

    if d.i16(instance, 0x1a) & 0x10 != 0 {
        set_error(d, instance, DMLERR_DLL_USAGE).await?;
        return Ok(0);
    }

    let mut names = d.i32(instance, 8);

    if hsz == 0 {
        if command & 1 != 0 {
            set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
            return Ok(0);
        }

        let mut record = Vec::new();

        while d.array_pop(names, &mut record).await? {
            let name = u32::from_le_bytes([record[0], record[1], record[2], record[3]]);
            let mut other = d.d16(D_INSTANCES);

            while other != 0 {
                if other != instance && d.i16(other, 0x1c) & 0x10 == 0 {
                    d.send(d.i16(other, 0x22), 0x4c9, d.i16(instance, 0x24), name)
                        .await?;
                }

                other = d.i16(other, 0);
            }

            delete_atom(d, lo(name)).await?;
            names = d.i32(instance, 8);
        }

        return Ok(1);
    }

    let register = command & 1 != 0;
    let (key, saved) = d.key(&hsz.to_le_bytes());

    if register {
        if names == 0 {
            names = d.array_new(d.i16(instance, 0x20), 4, 8).await?;
            d.si32(instance, 8, names);
        }

        add_count(d, lo(hsz)).await?;
        d.array_add(names, key, None).await?;
    } else {
        d.array_find(names, Some(Cmp::Dword), key, true).await?;
    }

    d.release(saved);

    let mask = if register { 0x0008 } else { 0x0010 };
    let mut other = d.d16(D_INSTANCES);

    while other != 0 {
        if d.i16(other, 0x1c) & mask == 0 {
            let message = if register { 0x4c8 } else { 0x4c9 };

            d.send(d.i16(other, 0x22), message, d.i16(instance, 0x24), hsz)
                .await?;
        }

        other = d.i16(other, 0);
    }

    if command & 2 != 0 {
        delete_atom(d, lo(hsz)).await?;
    }

    Ok(1)
}

/// `DdeEnableCallback` (`1d98`).
pub(crate) async fn enable_callback(d: &Dd<'_>, id: u32, conv: u32, command: u16) -> R<u16> {
    let instance = instance_of(d, id);

    if instance == 0 {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if (conv != 0 && !conv_valid(d, conv).await?) || command & 0xff75 != 0 {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    if command & 2 != 0 {
        let mut item = d.r32(d.i32(instance, 0x16));

        if conv == 0 {
            return Ok(u16::from(item != 0));
        }

        while item != 0 {
            if d.r32(plus(item, 4)) == conv {
                return Ok(1);
            }

            item = d.r32(item);
        }

        return Ok(0);
    }

    if conv == 0 {
        let disabled = d.i16(instance, 0x2c);

        d.si16(
            instance,
            0x2c,
            if command & 8 != 0 {
                disabled | 1
            } else {
                disabled & !1
            },
        );
        each_child(d, d.i16(instance, 0x22), 0x4cf, command, 0, false).await?;
    } else {
        d.send(lo(conv), 0x4cf, command, 0).await?;
    }

    if command & 8 != 0 {
        return Ok(1);
    }

    if d.i16(instance, 0x2e) != 0 {
        set_error(d, instance, DMLERR_REENTRANCY).await?;
        return Ok(0);
    }

    d.send(d.i16(instance, 0x22), 0x4cc, 0, d.near(instance))
        .await?;
    Ok(1)
}

/// `DdeGetLastError` (`14a8`).
pub(crate) fn get_last_error(d: &Dd<'_>, id: u32) -> u16 {
    let instance = lo(id);

    if instance == 0 {
        return 0x4003;
    }

    if d.i16(instance, 0x30) != hi(id) {
        return DMLERR_INVALIDPARAMETER;
    }

    let error = d.i16(instance, 0x2a);

    d.si16(instance, 0x2a, 0);
    error
}

/// Whether a code page is one DDEML takes: nought, `CP_WINANSI`, or the
/// keyboard's (`19d2`-`19e7`).
async fn code_page_good(d: &Dd<'_>, page: u16) -> R<bool> {
    if page == 0 || page == 0x3ec {
        return Ok(true);
    }

    Ok(d.call("KEYBOARD", "GetKbCodePage", &[]).await? as u16 == page)
}

/// `DdeCreateStringHandle` (`19a4`).
pub(crate) async fn create_string_handle(d: &Dd<'_>, id: u32, string: u32, page: u16) -> R<u32> {
    let instance = lo(id);

    if d.i16(instance, 0x30) != hi(id) {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if string == 0 || d.r8(string) == 0 {
        return Ok(0);
    }

    if !code_page_good(d, page).await? {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let atom = monitor::string_atom(d, string, true).await?;

    if d.d16(D_MONITORS) != 0 {
        monitor::hsz_notice(d, atom, 1, d.i16(instance, 0x1e)).await?;
    }

    let (key, saved) = d.key(&atom.to_le_bytes());

    d.array_add(d.i32(instance, 0x10), key, None).await?;
    d.release(saved);
    Ok(u32::from(atom))
}

/// `DdeFreeStringHandle` (`1a40`).
pub(crate) async fn free_string_handle(d: &Dd<'_>, id: u32, hsz: u32) -> R<u16> {
    let atom = lo(hsz);
    let instance = instance_of(d, id);

    if instance == 0 {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if d.d16(D_MONITORS) != 0 {
        monitor::hsz_notice(d, atom, 3, d.i16(instance, 0x1e)).await?;
    }

    let (key, saved) = d.key(&atom.to_le_bytes());

    d.array_find(d.i32(instance, 0x10), Some(Cmp::First), key, true)
        .await?;
    d.release(saved);
    delete_atom(d, atom).await
}

/// `DdeKeepStringHandle` (`1aac`).
pub(crate) async fn keep_string_handle(d: &Dd<'_>, id: u32, hsz: u32) -> R<u16> {
    let atom = lo(hsz);
    let instance = instance_of(d, id);

    if instance == 0 {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if d.d16(D_MONITORS) != 0 {
        monitor::hsz_notice(d, atom, 2, d.i16(instance, 0x1e)).await?;
    }

    let (key, saved) = d.key(&atom.to_le_bytes());

    d.array_add(d.i32(instance, 0x10), key, None).await?;
    d.release(saved);
    add_count(d, atom).await
}

/// `DdeQueryString` (`1b14`).
pub(crate) async fn query_string(
    d: &Dd<'_>,
    id: u32,
    hsz: u32,
    buffer: u32,
    size: u32,
    page: u16,
) -> R<u32> {
    let instance = instance_of(d, id);

    if instance == 0 {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if !code_page_good(d, page).await? {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    if buffer != 0 {
        if hsz != 0 {
            return Ok(u32::from(
                monitor::query_hsz(d, hsz, buffer, lo(size)).await?,
            ));
        }

        d.w8(buffer, 0);
        return Ok(0);
    }

    if hsz != 0 {
        return Ok(u32::from(monitor::hsz_length(d, hsz).await?));
    }

    Ok(0)
}

/// `DdeCmpStringHandles` (`1bb0`): the two compared as unsigned numbers.
pub(crate) fn cmp_string_handles(hsz1: u32, hsz2: u32) -> u16 {
    match hsz1.cmp(&hsz2) {
        std::cmp::Ordering::Less => 0xffff,
        std::cmp::Ordering::Greater => 1,
        std::cmp::Ordering::Equal => 0,
    }
}

/// `DMGWNDPROC` (`5558`).
pub(crate) async fn dmg_proc(
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
        0x4c8 | 0x4c9 => {
            let instance = d.window_word(hwnd, 0).await?;

            add_count(d, lo(lparam)).await?;

            let own = long(lo(lparam), wparam);
            let kind = if message == 0x4c8 { 0x80a2 } else { 0x80d2 };

            callback(d, instance, 0, lparam, own, 0, kind, 0, 0, 0).await?;
            delete_atom(d, lo(lparam)).await?;
            Ok(0)
        }
        0x4cc => {
            run_queue(d, lo(lparam)).await?;
            Ok(0)
        }
        0x4d0 => {
            let instance = lo(lparam);

            if d.i16(instance, 0x2e) != 0 {
                d.post(hwnd, 0x4d0, 0, lparam).await?;
                return Ok(0);
            }

            replace_advise_data(d, instance).await?;

            if d.i32(instance, 0x36) == 0 {
                let kept = d.alloc(d.i16(instance, 0x20), 0x100).await?;

                d.si32(instance, 0x36, kept);
            }

            run_queue(d, instance).await?;
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

/// `5600`-`5726`: of two `XTYP_ADVDATA` waiting for the same
/// conversation, item and format, the older answered busy and dropped.
async fn replace_advise_data(d: &Dd<'_>, instance: u16) -> R<()> {
    let queue = d.i32(instance, 0x16);
    let mut item = d.r32(queue);

    loop {
        while item != 0 && d.r16(plus(item, 0x12)) != 0x4010 {
            item = d.r32(item);
        }

        if item == 0 {
            return Ok(());
        }

        let mut later = d.r32(item);

        if later == 0 {
            return Ok(());
        }

        while later != 0 {
            if d.r16(plus(later, 0x12)) == 0x4010
                && d.r32(plus(later, 4)) == d.r32(plus(item, 4))
                && d.r32(plus(later, 0xc)) == d.r32(plus(item, 0xc))
                && d.r16(plus(later, 0x10)) == d.r16(plus(item, 0x10))
            {
                break;
            }

            later = d.r32(later);
        }

        if later != 0 {
            super::xact::reply(d, item, 0x4000).await?;

            let next = d.r32(item);

            d.list_remove(d.i32(instance, 0x16), item).await?;
            item = next;
        } else {
            item = d.r32(item);
        }
    }
}

/// `5832`: a callback, as every one is made: kept away by the instance's
/// `CBF_` flags; `Made me?` of `Who` answered by DDEML itself; a data
/// handle handed as a record on DDEML's stack, flagged 4000h; the count
/// of callbacks under way kept; the monitors told; and an answer of data
/// turned from the application's record into the handle's value.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn callback(
    d: &Dd<'_>,
    instance: u16,
    conv: u32,
    hsz1: u32,
    hsz2: u32,
    format: u16,
    kind: u16,
    data: u32,
    data1: u32,
    data2: u32,
) -> R<u32> {
    let mask = d.r32(d.near(0xa6 + ((kind & 0xf0) >> 2)));

    if mask & d.i32(instance, 0x1a) != 0 {
        return Ok(0);
    }

    if lo(hsz2) == d.d16(D_MADE_ME) && lo(hsz1) == d.d16(D_WHO) && format == 1 && kind == 0x20b0 {
        return super::data::make(
            d,
            instance,
            0,
            1,
            lo(hsz2),
            0,
            0x1e,
            d.near(super::D_TEXT_STAAB),
        )
        .await;
    }

    let mut handed = data;
    let mut saved = None;

    if data != 0 {
        let (record, sp) = d.reserve(6);

        d.w16(record, instance);
        d.w16(plus(record, 2), lo(data) | 0x4000);
        d.w16(plus(record, 4), hi(data));
        handed = record;
        saved = Some(sp);
    }

    d.si16(instance, 0x2e, d.i16(instance, 0x2e).wrapping_add(1));

    let procedure = d.i32(instance, 4);
    let answer = d
        .call_far(
            procedure,
            &monitor::callback_args(kind, format, conv, hsz1, hsz2, handed, data1, data2),
        )
        .await?;

    if d.d16(D_MONITORS) != 0 && kind != monitor::XTYP_MONITOR {
        monitor::callback_notice(
            d, instance, kind, format, conv, hsz1, hsz2, handed, data1, data2, answer,
        )
        .await?;
    }

    d.si16(instance, 0x2e, d.i16(instance, 0x2e).wrapping_sub(1));

    if let Some(sp) = saved {
        d.release(sp);
    }

    let mut answer = answer;

    if answer != 0 && kind & 0x2000 != 0 && answer != 0xffff_ffff {
        let value = d.r32(plus(answer, 2));

        if lo(value) & 1 == 0 {
            d.free(answer).await?;
        }

        answer = value;
    }

    Ok(answer)
}

/// `4e66`: the callbacks waiting made, oldest first, while no callback is
/// under way and the instance keeps its 256 bytes: one of a conversation
/// blocked waits; `CBR_BLOCK` blocks its conversation and keeps it first.
pub(crate) async fn run_queue(d: &Dd<'_>, instance: u16) -> R<()> {
    let queue = d.i32(instance, 0x16);
    let mut item = d.r32(queue);

    while d.i32(instance, 0x36) != 0 && item != 0 {
        let next = d.r32(item);

        if d.i16(instance, 0x2e) != 0 {
            return Ok(());
        }

        let mut keep = false;
        let window = d.r16(plus(item, 4));

        if d.is_window(window).await? {
            let conv = d.window_long(window, 0).await?;
            let status = plus(conv, 0x20);
            let flags = d.r8(status);

            if flags & 1 != 0 {
                if flags & 8 != 0 {
                    keep = true;
                } else {
                    if flags & 0x80 != 0 {
                        d.w8(status, (flags | 8) & 0x7f);
                    }

                    let answer = callback(
                        d,
                        instance,
                        d.r32(plus(item, 4)),
                        d.r32(plus(item, 8)),
                        d.r32(plus(item, 0xc)),
                        d.r16(plus(item, 0x10)),
                        d.r16(plus(item, 0x12)),
                        d.r32(plus(item, 0x14)),
                        d.r32(plus(item, 0x18)),
                        d.r32(plus(item, 0x1c)),
                    )
                    .await?;

                    if answer == 0xffff_ffff && d.r8(plus(item, 0x12)) & 2 == 0 {
                        d.w8(status, d.r8(status) | 8);
                        keep = true;
                    } else {
                        super::xact::reply(d, item, answer).await?;
                    }
                }
            }
        }

        if !keep {
            d.list_remove(d.i32(instance, 0x16), item).await?;
        }

        item = next;
    }

    Ok(())
}

/// `5b60`: a callback queued for a conversation's instance, and its
/// window posted 4CCh to make it, unless the conversation is blocked.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn queue_callback(
    d: &Dd<'_>,
    conv: u32,
    hconv: u32,
    hsz1: u32,
    hsz2: u32,
    format: u16,
    kind: u16,
    data: u32,
    data1: u32,
    data2: u32,
    message: u16,
    status: u16,
    partner: u16,
    handle: u16,
) -> R<u16> {
    let instance = d.r16(conv);
    let item = d.list_add(d.i32(instance, 0x16), 0).await?;

    if item == 0 {
        set_error(d, instance, DMLERR_MEMORY_ERROR).await?;
        return Ok(0);
    }

    d.w32(plus(item, 4), hconv);
    d.w32(plus(item, 8), hsz1);
    d.w32(plus(item, 0xc), hsz2);
    d.w16(plus(item, 0x10), format);
    d.w16(plus(item, 0x12), kind);
    d.w32(plus(item, 0x14), data);
    d.w32(plus(item, 0x18), data1);
    d.w32(plus(item, 0x1c), data2);
    d.w16(plus(item, 0x20), message);
    d.w16(plus(item, 0x22), status);
    d.w16(plus(item, 0x24), partner);
    d.w16(plus(item, 0x28), handle);
    d.w16(plus(item, 0x26), d.r16(conv));

    if d.r8(plus(conv, 0x20)) & 8 == 0 {
        let instance = d.r16(conv);
        let posted = d
            .post(d.i16(instance, 0x22), 0x4cc, 0, d.near(instance))
            .await?;

        if posted == 0 {
            set_error(d, instance, DMLERR_SYS_ERROR).await?;
        }
    }

    Ok(1)
}

/// `59cc`: a synchronous transaction waited for: `DMLERR_REENTRANCY` where
/// any of the task's instances waits already; timer 1 of the window, in
/// pieces of 65535 milliseconds; `GetMessage`, `CallMsgFilter` and
/// `DispatchMessage` until the instance's word 3Ah is set; then the
/// timer's messages taken out and the queue's 4CCh posted.
pub(crate) async fn modal_loop(d: &Dd<'_>, instance: u16, timeout: u32, hwnd: u16) -> R<u16> {
    let mut other = 0;

    loop {
        other = task_instance(d, other).await?;

        if other == 0 {
            break;
        }

        if d.i16(other, 0x28) != 0 {
            set_error(d, instance, DMLERR_REENTRANCY).await?;
            return Ok(0);
        }
    }

    d.si16(instance, 0x28, hwnd);

    let piece = if hi(timeout) != 0 {
        0xffff
    } else {
        lo(timeout)
    };

    if d.set_timer(hwnd, 1, piece).await? == 0 {
        set_error(d, instance, DMLERR_SYS_ERROR).await?;
        return Ok(0);
    }

    let mut left = timeout;

    if hi(left) < 0xffff {
        left = left.wrapping_add(0x1_0000);
    }

    loop {
        left = left.wrapping_sub(0x1_0000);

        if hi(left) == 0 {
            d.set_timer(hwnd, 1, lo(left)).await?;
        }

        d.si16(instance, 0x3a, 0);

        loop {
            let called = d
                .call_b(
                    "USER",
                    "GetMessage",
                    &[
                        crate::commdlg::api::buffer(18),
                        Arg::W(0),
                        Arg::W(0),
                        Arg::W(0),
                    ],
                )
                .await?;
            let msg = called.buffers[0].clone();
            let filtered = d
                .user("CallMsgFilter", &[Arg::B(msg.clone()), Arg::W(0x8001)])
                .await? as u16;

            if filtered == 0 {
                d.user("DispatchMessage", &[Arg::B(msg)]).await?;
            }

            if d.i16(instance, 0x3a) != 0 {
                break;
            }
        }

        if d.i16(instance, 0x3a) != 1 || hi(left) == 0 {
            break;
        }
    }

    d.kill_timer(hwnd, 1).await?;

    loop {
        let removed = d
            .user(
                "PeekMessage",
                &[
                    crate::commdlg::api::buffer(18),
                    Arg::W(hwnd),
                    Arg::W(0x113),
                    Arg::W(0x113),
                    Arg::W(3),
                ],
            )
            .await? as u16;

        if removed == 0 {
            break;
        }
    }

    d.si16(instance, 0x28, 0);

    if d.post(d.i16(instance, 0x22), 0x4cc, 0, d.near(instance))
        .await?
        == 0
    {
        set_error(d, instance, DMLERR_SYS_ERROR).await?;
    }

    Ok(1)
}
