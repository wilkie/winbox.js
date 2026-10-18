//! DDEML's conversations: connecting (`DdeConnect`, `DdeConnectList`,
//! `DdeReconnect`, `6a68`, `INITENUM`, the frame's `6bf6` and the client's
//! acknowledgement `709c`), the conversations' windows (`CLIENTWNDPROC`,
//! `SERVERWNDPROC`, `SUBFRAMEWNDPROC`, `CONVLISTWNDPROC`), ending them
//! (`4f9e`, `50be`, `DdeDisconnect`, `DdeDisconnectList`), the posts kept
//! for a full queue (`5c58`, `5de4`), and the queries (`DdeQueryConvInfo`,
//! `DdeSetUserHandle`, `DdeQueryNextServer`), as `DDEML.DLL` seg1 has
//! them. As `src/win16/ddeml/conv.ts`.

use crate::commdlg::api::Arg;

use super::core::{Cmp, Dd, R, far, hi, lo, long, plus};
use super::instance::{
    self, DMLERR_INVALIDPARAMETER, DMLERR_MEMORY_ERROR, DMLERR_NO_CONV_ESTABLISHED,
    DMLERR_SYS_ERROR, conv_valid, each_child, error_each, instance_of,
};
use super::monitor::{add_count, conv_notice, conv_of, delete_atom, hsz_length, set_error};
use super::{
    D_CLASS_CLIENT, D_CLASS_HOLDING, D_CLASS_SERVER, D_CONTEXT, D_EMPTY, D_HINSTANCE, D_MONITORS,
    D_PROGMAN, D_SERIAL, D_XPARAMS,
};

/// A window's procedure, `GetWindowLong(hwnd, GWL_WNDPROC)`.
async fn procedure_of(d: &Dd<'_>, hwnd: u16) -> R<u32> {
    d.window_long(hwnd, 0xfffc).await
}

/// `DefWindowProc`.
async fn default(d: &Dd<'_>, hwnd: u16, message: u16, wparam: u16, lparam: u32) -> R<u32> {
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

/// `6a68`: a client conversation made, a `DMGClientClass` window child of
/// `parent`, and `WM_DDE_INITIATE` sent to `target`, or to each window at
/// the top through `INITENUM`: its window, nought where none answered.
pub(crate) async fn connect_one(
    d: &Dd<'_>,
    instance: u16,
    parent: u16,
    target: u16,
    service: u32,
    topic: u16,
    context: u32,
) -> R<u16> {
    let hwnd = d
        .create_window(D_CLASS_CLIENT, 0x4000_0000, parent, d.near(instance))
        .await?;

    if hwnd == 0 {
        return Ok(0);
    }

    let conv = d.window_long(hwnd, 0).await?;

    d.w16(plus(conv, 0xe), 3);
    d.w16(plus(conv, 0x10), 0);
    d.w32(plus(conv, 2), service);
    d.w16(plus(conv, 6), lo(service));
    d.w16(plus(conv, 8), topic);

    let context = if context != 0 {
        context
    } else {
        d.near(D_CONTEXT)
    };
    let bytes = d.read(context, 16);

    d.write(plus(conv, 0x24), &bytes);

    if target != 0 {
        d.w16(plus(conv, 0x38), target);
        d.send(target, 0x3e0, hwnd, long(lo(service), topic))
            .await?;
    } else {
        let mut state = Vec::with_capacity(8);

        state.extend_from_slice(&hwnd.to_le_bytes());
        state.extend_from_slice(&conv.to_le_bytes());
        state.extend_from_slice(&topic.to_le_bytes());

        let procedure = super::export_address(d, 38);

        d.user("EnumWindows", &[Arg::D(procedure), Arg::B(state)])
            .await?;
    }

    if d.r16(plus(conv, 0xe)) == 3 {
        d.destroy_window(hwnd).await?;
        return Ok(0);
    }

    d.w16(plus(conv, 0xe), 2);
    d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 1);
    Ok(hwnd)
}

/// `INITENUM` (`6b8a`): `WM_DDE_INITIATE` sent to one window at the top;
/// on to the next while making a list or none has answered.
pub(crate) async fn init_enum(d: &Dd<'_>, hwnd: u16, state: u32) -> R<u16> {
    let conv = d.r32(plus(state, 2));

    d.w16(plus(conv, 0x38), hwnd);
    d.send(
        hwnd,
        0x3e0,
        d.r16(state),
        long(d.r16(plus(conv, 2)), d.r16(plus(state, 6))),
    )
    .await?;

    let conv = d.r32(plus(state, 2));

    Ok(u16::from(
        d.r8(plus(conv, 0x20)) & 0x40 != 0 || d.r16(plus(conv, 0xe)) == 3,
    ))
}

/// `DdeConnect` (`0aac`).
pub(crate) async fn connect(d: &Dd<'_>, id: u32, service: u32, topic: u32, context: u32) -> R<u32> {
    let instance = instance_of(d, id);

    if instance == 0 {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if context != 0 && d.r16(context) != 0x10 {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let hwnd = connect_one(
        d,
        instance,
        d.i16(instance, 0x22),
        hi(service),
        u32::from(lo(service)),
        lo(topic),
        context,
    )
    .await?;

    if hwnd == 0 {
        set_error(d, instance, DMLERR_NO_CONV_ESTABLISHED).await?;
    }

    conv_of(d, hwnd).await
}

/// `6f74`: a server conversation made, a `DMGServerClass` window child of
/// the instance's `DMGHoldingClass` window, made the first time; the
/// client's context copied in.
async fn make_server_conv(d: &Dd<'_>, instance: u16, context: u32) -> R<u16> {
    if d.i16(instance, 0x14) == 0 {
        let holding = d
            .create_window(D_CLASS_HOLDING, 0x4000_0000, d.i16(instance, 0x22), 0)
            .await?;

        d.si16(instance, 0x14, holding);

        if holding == 0 {
            set_error(d, instance, DMLERR_SYS_ERROR).await?;
            return Ok(0);
        }
    }

    let hwnd = d
        .create_window(
            D_CLASS_SERVER,
            0x4000_0000,
            d.i16(instance, 0x14),
            d.near(instance),
        )
        .await?;

    if hwnd == 0 {
        set_error(d, instance, DMLERR_SYS_ERROR).await?;
        return Ok(0);
    }

    let conv = d.window_long(hwnd, 0).await?;
    let bytes = d.read(context, 16);

    d.write(plus(conv, 0x24), &bytes);
    Ok(hwnd)
}

/// `6bf6`: a server instance's frame handed `WM_DDE_INITIATE`.
#[allow(clippy::too_many_lines)]
pub(crate) async fn frame_initiate(
    d: &Dd<'_>,
    instance: u16,
    frame: u16,
    client: u16,
    app: u16,
    topic: u16,
) -> R<()> {
    let flags = d.i16(instance, 0x1a);
    let mut own = false;

    if flags & 0x2000 != 0 {
        return Ok(());
    }

    if flags & 0x20 != 0 && d.array_count(d.i32(instance, 8)) == 0 {
        return Ok(());
    }

    let ddeml = procedure_of(d, client).await? == super::export_address(d, 28);
    let mut client_conv = 0u32;

    if ddeml {
        client_conv = d.window_long(client, 0).await?;
        own = d.r16(client_conv) == instance;

        if flags & 0x1000 != 0 && own {
            return Ok(());
        }
    }

    if app != 0 && flags & 0x20 != 0 {
        let (key, saved) = d.key(&app.to_le_bytes());
        let found = d
            .array_find(d.i32(instance, 8), Some(Cmp::First), key, false)
            .await?;

        d.release(saved);

        if found == 0 {
            return Ok(());
        }
    }

    let wild = app == 0 || topic == 0;
    let context = if ddeml { plus(client_conv, 0x24) } else { 0 };
    let self_flag = u32::from(own);
    let answer = instance::callback(
        d,
        instance,
        0,
        u32::from(topic),
        u32::from(app),
        0,
        if wild { 0x20e2 } else { 0x1062 },
        0,
        context,
        self_flag,
    )
    .await?;

    if answer == 0 {
        return Ok(());
    }

    // The pairs: the answer's block, or the one pair on DDEML's stack.
    let (mut pairs, locked, saved) = if wild {
        (d.global_lock(hi(answer)).await?, true, None)
    } else {
        let (at, saved) = d.reserve(16);

        d.write(
            at,
            &[
                app as u8,
                (app >> 8) as u8,
                0,
                0,
                topic as u8,
                (topic >> 8) as u8,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
            ],
        );
        (at, false, Some(saved))
    };

    let finish = |d: &Dd<'_>| {
        if let Some(saved) = saved {
            d.release(saved);
        }
    };

    if hsz_length(d, d.r32(pairs)).await? != 0 {
        loop {
            if hsz_length(d, d.r32(plus(pairs, 4))).await? == 0 {
                break;
            }

            let context = if ddeml {
                plus(client_conv, 0x24)
            } else {
                d.near(D_CONTEXT)
            };
            let server = make_server_conv(d, instance, context).await?;

            if server == 0 {
                finish(d);
                return Ok(());
            }

            let conv = d.window_long(server, 0).await?;

            if ddeml {
                let partner = conv_of(d, client).await?;

                d.w32(plus(conv, 0xa), partner);
            } else {
                d.w16(plus(conv, 0xa), client);
                d.w16(plus(conv, 0xc), 0);
            }

            d.w16(plus(conv, 0x22), frame);
            d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 1);

            if own {
                d.w8(plus(conv, 0x21), d.r8(plus(conv, 0x21)) | 1);
                d.w8(plus(client_conv, 0x21), d.r8(plus(client_conv, 0x21)) | 1);
            }

            d.w16(plus(conv, 0xe), 2);
            d.w16(plus(conv, 2), app);
            d.w16(plus(conv, 4), 0);
            d.w16(plus(conv, 6), d.r16(pairs));
            d.w16(plus(conv, 8), d.r16(plus(pairs, 4)));

            if d.d16(D_MONITORS) != 0 {
                conv_notice(
                    d,
                    d.r16(conv),
                    d.r16(plus(conv, 6)),
                    d.r16(plus(conv, 8)),
                    client,
                    server,
                    1,
                )
                .await?;
            }

            add_count(d, app).await?;
            add_count(d, d.r16(pairs)).await?;
            add_count(d, d.r16(plus(pairs, 4))).await?;
            add_count(d, d.r16(pairs)).await?;
            add_count(d, d.r16(plus(pairs, 4))).await?;
            d.send(
                client,
                0x3e4,
                server,
                long(d.r16(pairs), d.r16(plus(pairs, 4))),
            )
            .await?;

            let hconv = conv_of(d, server).await?;

            instance::callback(
                d,
                instance,
                hconv,
                d.r32(plus(pairs, 4)),
                d.r32(pairs),
                0,
                0x8072,
                0,
                0,
                self_flag,
            )
            .await?;

            pairs = plus(pairs, 8);

            if hsz_length(d, d.r32(pairs)).await? == 0 {
                break;
            }
        }
    }

    finish(d);

    if locked {
        d.global_unlock(hi(answer)).await?;
        super::data::free_value(d, instance, answer, true).await?;
    }

    Ok(())
}

/// `699e`: a client conversation's 42h bytes made as its window is.
async fn client_create(d: &Dd<'_>, instance: u16, hwnd: u16) -> R<u32> {
    let conv = d.alloc(d.i16(instance, 0x20), 0x42).await?;

    if conv == 0 {
        set_error(d, instance, DMLERR_MEMORY_ERROR).await?;
        return Ok(1);
    }

    d.set_window_long(hwnd, 0, conv).await?;

    let serial = d.d16(D_SERIAL).wrapping_add(1);

    d.sd16(D_SERIAL, serial);
    d.set_window_word(hwnd, 4, serial).await?;
    d.w16(conv, instance);
    d.w16(plus(conv, 0xe), 0);
    d.w32(plus(conv, 0x16), d.near(D_XPARAMS));

    let disabled = d.i16(instance, 0x2c) & 1 != 0;

    d.w16(plus(conv, 0x20), if disabled { 8 } else { 0 } | 0x10);

    let parent = d.get_parent(hwnd).await?;

    if procedure_of(d, parent).await? == super::export_address(d, 32) {
        d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 0x40);
    }

    d.w32(plus(conv, 0x3a), 0);

    let links = d.list_new(d.i16(instance, 0x20), 0xe).await?;

    d.w32(plus(conv, 0x3e), links);
    Ok(links)
}

/// `7024`: a server conversation's 38h bytes made as its window is.
async fn server_create(d: &Dd<'_>, instance: u16, hwnd: u16) -> R<u32> {
    let conv = d.alloc(d.i16(instance, 0x20), 0x38).await?;

    if conv == 0 {
        set_error(d, instance, DMLERR_MEMORY_ERROR).await?;
        return Ok(1);
    }

    d.w16(conv, instance);
    d.w16(plus(conv, 0xe), 0);
    d.w16(
        plus(conv, 0x20),
        if d.i16(instance, 0x2c) & 1 != 0 { 8 } else { 0 },
    );
    d.set_window_long(hwnd, 0, conv).await?;

    let serial = d.d16(D_SERIAL).wrapping_add(1);

    d.sd16(D_SERIAL, serial);
    d.set_window_word(hwnd, 4, serial).await?;
    Ok(0)
}

/// `709c`: `WM_DDE_ACK` to a client conversation still connecting.
async fn client_ack(d: &Dd<'_>, hwnd: u16, conv: u32, server: u16, app: u16, topic: u16) -> R<()> {
    match d.r16(plus(conv, 0xe)) {
        3 => {
            d.w16(plus(conv, 0xe), 4);

            if d.d16(D_MONITORS) != 0 {
                conv_notice(d, d.r16(conv), app, topic, hwnd, server, 1).await?;
            }

            if procedure_of(d, server).await? == super::export_address(d, 29) {
                d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 4);

                let partner = conv_of(d, server).await?;

                d.w32(plus(conv, 0xa), partner);
            } else {
                d.w16(plus(conv, 0xa), server);
                d.w16(plus(conv, 0xc), 0);

                if d.d16(D_PROGMAN) == app {
                    add_count(d, app).await?;
                    add_count(d, topic).await?;
                }
            }

            d.w16(plus(conv, 6), app);
            d.w16(plus(conv, 8), topic);

            if d.r16(plus(conv, 0x22)) == 0 {
                d.w16(plus(conv, 0x22), d.r16(plus(conv, 0x38)));
            }

            add_count(d, d.r16(plus(conv, 2))).await?;
        }
        4 => {
            let instance = d.r16(conv);
            let terminate = d.r16(plus(conv, 0xa)) == server
                || d.get_parent(hwnd).await? == d.i16(instance, 0x22);

            if !terminate {
                if procedure_of(d, server).await? != super::export_address(d, 29) {
                    d.send(server, 0x3e1, hwnd, 0).await?;

                    let parent = d.get_parent(hwnd).await?;

                    connect_one(
                        d,
                        instance,
                        parent,
                        d.r16(plus(conv, 0x38)),
                        u32::from(app),
                        topic,
                        plus(conv, 0x24),
                    )
                    .await?;

                    if d.d16(D_PROGMAN) != app {
                        delete_atom(d, app).await?;
                        delete_atom(d, topic).await?;
                    }

                    return Ok(());
                }

                let parent = d.get_parent(hwnd).await?;
                let made = d
                    .user(
                        "CreateWindow",
                        &[
                            Arg::D(d.near(D_CLASS_CLIENT)),
                            Arg::D(d.near(D_EMPTY)),
                            Arg::D(0x4000_0000),
                            Arg::W(0),
                            Arg::W(0),
                            Arg::W(0),
                            Arg::W(0),
                            Arg::W(parent),
                            Arg::W(0),
                            Arg::W(d.d16(D_HINSTANCE)),
                            Arg::D(d.near(instance)),
                        ],
                    )
                    .await? as u16;

                if made != 0 {
                    let other = d.window_long(made, 0).await?;

                    d.w16(plus(other, 0xe), 2);
                    d.w16(plus(other, 0x10), 0);
                    d.w16(plus(other, 6), app);
                    d.w32(plus(other, 2), d.r32(plus(conv, 2)));
                    add_count(d, d.r16(plus(other, 2))).await?;
                    d.w16(plus(other, 8), topic);

                    let partner = conv_of(d, server).await?;

                    d.w32(plus(other, 0xa), partner);
                    d.w16(plus(other, 0x22), d.r16(plus(conv, 0x38)));
                    d.w8(plus(other, 0x20), d.r8(plus(other, 0x20)) | 5);

                    if d.d16(D_MONITORS) != 0 {
                        conv_notice(d, d.r16(other), app, topic, hwnd, server, 1).await?;
                    }

                    d.send(server, 0x46b, made, 0).await?;
                    return Ok(());
                }

                set_error(d, instance, DMLERR_SYS_ERROR).await?;
            }

            d.send(server, 0x3e1, hwnd, 0).await?;
            delete_atom(d, app).await?;
            delete_atom(d, topic).await?;
        }
        _ => {}
    }

    Ok(())
}

/// `CLIENTWNDPROC` (`4614`).
pub(crate) async fn client_proc(
    d: &Dd<'_>,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> R<u32> {
    let conv = d.window_long(hwnd, 0).await?;

    match message {
        1 => client_create(d, d.r16(lparam), hwnd).await,
        2 => {
            if d.r8(plus(conv, 0x20)) & 1 != 0 {
                d.w8(plus(conv, 0x21), d.r8(plus(conv, 0x21)) & !0x20);
                terminate(d, conv, 0, hwnd).await?;
            }

            if d.r8(plus(conv, 0x21)) & 0x40 != 0 {
                let owner = d.get_window(hwnd, 4).await?;

                if owner != 0 {
                    d.post(owner, 0x4ce, 0x1000, 0).await?;
                }
            }

            d.queue_free(d.r32(plus(conv, 0x3a))).await?;
            d.queue_free(d.r32(plus(conv, 0x34))).await?;
            d.kill_timer(hwnd, 4).await?;
            free_links(d, conv, hwnd).await?;
            d.list_free(d.r32(plus(conv, 0x3e))).await?;

            if d.r16(plus(conv, 0xe)) != 3 {
                delete_atom(d, d.r16(plus(conv, 2))).await?;
                delete_atom(d, d.r16(plus(conv, 6))).await?;
                delete_atom(d, d.r16(plus(conv, 8))).await?;
            }

            d.free(conv).await?;
            default(d, hwnd, message, wparam, lparam).await
        }
        0x113 => {
            if wparam == 4 {
                d.kill_timer(hwnd, 4).await?;
                repost(d, conv, hwnd).await?;
            } else if wparam == 1 {
                let instance = d.r16(conv);

                d.si16(instance, 0x3a, d.i16(instance, 0x3a) | 1);
            }

            Ok(0)
        }
        0x3e1 | 0x4d1 => {
            on_terminate(d, conv, wparam, hwnd).await?;
            Ok(0)
        }
        0x3e4 if matches!(d.r16(plus(conv, 0xe)), 3 | 4) => {
            client_ack(d, hwnd, conv, wparam, lo(lparam), hi(lparam)).await?;
            Ok(1)
        }
        0x3e4 | 0x3e5 => {
            super::xact::client_dde(d, conv, hwnd, message, wparam, hi(lparam), lo(lparam)).await?;
            Ok(0)
        }
        0x4cb => Ok(answer_kind(d, conv, wparam, lparam, true)),
        0x4ce => {
            terminate(d, conv, wparam, hwnd).await?;
            Ok(0)
        }
        0x4cf => {
            enable_command(d, conv, hwnd, wparam).await?;
            Ok(0)
        }
        _ => default(d, hwnd, message, wparam, lparam).await,
    }
}

/// 4CBh: whether a conversation is a client's -- 1 for a client, nought
/// for a server -- or, with 1, its instance as a far pointer; written to
/// `lParam` where there is one, answering 1 then.
fn answer_kind(d: &Dd<'_>, conv: u32, wparam: u16, lparam: u32, client: bool) -> u32 {
    let value = match wparam {
        0 => u32::from(client),
        1 => far(d.ds(), d.r16(conv)),
        _ => 0,
    };

    if lparam != 0 {
        d.w32(lparam, value);
        return 1;
    }

    value
}

/// 4CFh: `DdeEnableCallback`'s command kept in the status; enabled, the
/// posts kept are tried again.
async fn enable_command(d: &Dd<'_>, conv: u32, hwnd: u16, command: u16) -> R<()> {
    let status = d.r16(plus(conv, 0x20));

    d.w16(plus(conv, 0x20), (status & !0x88) | command);

    if command == 0 || command & 0x80 != 0 {
        repost(d, conv, hwnd).await?;
    }

    Ok(())
}

/// `SERVERWNDPROC` (`523a`).
pub(crate) async fn server_proc(
    d: &Dd<'_>,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> R<u32> {
    let conv = d.window_long(hwnd, 0).await?;

    match message {
        0x3e2..=0x3e4 | 0x3e6..=0x3e8 => {
            super::xact::server_dde(d, conv, message, hwnd, wparam, lo(lparam), hi(lparam)).await?;
            Ok(0)
        }
        1 => server_create(d, d.r16(lparam), hwnd).await,
        2 => {
            if d.r8(plus(conv, 0x20)) & 1 != 0 {
                d.w8(plus(conv, 0x21), d.r8(plus(conv, 0x21)) & !0x20);
                terminate(d, conv, 0, hwnd).await?;
            }

            if d.r8(plus(conv, 0x21)) & 0x40 != 0 {
                let instance = d.r16(conv);

                d.post(d.i16(instance, 0x14), 0x4ce, 0x1000, 0).await?;
            }

            free_links(d, conv, hwnd).await?;
            delete_atom(d, d.r16(plus(conv, 6))).await?;
            delete_atom(d, d.r16(plus(conv, 2))).await?;
            delete_atom(d, d.r16(plus(conv, 8))).await?;
            d.queue_free(d.r32(plus(conv, 0x34))).await?;
            d.kill_timer(hwnd, 4).await?;
            d.free(conv).await?;
            default(d, hwnd, message, wparam, lparam).await
        }
        0x113 => {
            if wparam == 4 {
                d.kill_timer(hwnd, 4).await?;
                repost(d, conv, hwnd).await?;
            } else if wparam == 1 {
                let instance = d.r16(conv);

                d.si16(instance, 0x3a, d.i16(instance, 0x3a) | 1);
            }

            Ok(0)
        }
        0x3e1 | 0x4d1 => {
            on_terminate(d, conv, wparam, hwnd).await?;
            Ok(0)
        }
        0x46b => {
            let partner = conv_of(d, wparam).await?;

            d.w32(plus(conv, 0xa), partner);
            Ok(0)
        }
        0x4cb => Ok(answer_kind(d, conv, wparam, lparam, false)),
        0x4ce => {
            terminate(d, conv, wparam, hwnd).await?;
            Ok(0)
        }
        0x4cf => {
            enable_command(d, conv, hwnd, wparam).await?;
            Ok(0)
        }
        _ => default(d, hwnd, message, wparam, lparam).await,
    }
}

/// `SUBFRAMEWNDPROC` (`5480`): the instance at word 0; `WM_DDE_INITIATE`
/// to `6bf6`.
pub(crate) async fn subframe_proc(
    d: &Dd<'_>,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> R<u32> {
    match message {
        1 => Ok(u32::from(d.set_window_word(hwnd, 0, d.r16(lparam)).await?)),
        0x3e0 => {
            let instance = d.window_word(hwnd, 0).await?;

            frame_initiate(d, instance, hwnd, wparam, lo(lparam), hi(lparam)).await?;
            Ok(0)
        }
        _ => default(d, hwnd, message, wparam, lparam).await,
    }
}

/// `CONVLISTWNDPROC` (`5758`): a list, and the holder of an instance's
/// server conversations. Word 6 is 2000h once it is to go when empty.
pub(crate) async fn convlist_proc(
    d: &Dd<'_>,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> R<u32> {
    match message {
        1 => {
            d.set_window_word(hwnd, 6, 0).await?;

            let serial = d.d16(D_SERIAL).wrapping_add(1);

            d.sd16(D_SERIAL, serial);
            d.set_window_word(hwnd, 4, serial).await?;

            Ok(u32::from(d.set_window_word(hwnd, 0, d.r16(lparam)).await?))
        }
        0x4ce => {
            if wparam == 0x2000 {
                d.set_window_word(hwnd, 6, 0x2000).await?;
                each_child(d, hwnd, 0x4ce, 0x6000, 0, false).await?;
            }

            if (wparam == 0x1000 || wparam == 0x2000)
                && d.window_word(hwnd, 6).await? == 0x2000
                && d.get_window(hwnd, 5).await? == 0
            {
                d.destroy_window(hwnd).await?;
            }

            Ok(0)
        }
        0x4cf => {
            each_child(d, hwnd, 0x4cf, wparam, lparam, false).await?;
            Ok(0)
        }
        _ => default(d, hwnd, message, wparam, lparam).await,
    }
}

/// The two windows of a conversation as a monitor is told them, the
/// client's first.
fn sides(d: &Dd<'_>, conv: u32, hwnd: u16) -> (u16, u16) {
    let partner = d.r16(plus(conv, 0xa));

    if d.r8(plus(conv, 0x20)) & 0x10 != 0 {
        (hwnd, partner)
    } else {
        (partner, hwnd)
    }
}

/// `4f9e`: a conversation ended from this side: the transactions of a
/// client abandoned, its links freed, `WM_DDE_TERMINATE` posted and
/// counted at the instance's word 2; destroyed once terminated with 2000h.
pub(crate) async fn terminate(d: &Dd<'_>, conv: u32, flags: u16, hwnd: u16) -> R<()> {
    let instance = d.r16(conv);

    if d.i16(instance, 0x28) == hwnd {
        d.si16(instance, 0x3a, d.i16(instance, 0x3a) | 2);
        d.post(hwnd, 0x4ce, flags, conv).await?;
        return Ok(());
    }

    if d.d16(D_MONITORS) != 0 {
        let (client, server) = sides(d, conv, hwnd);

        conv_notice(
            d,
            instance,
            d.r16(plus(conv, 6)),
            d.r16(plus(conv, 8)),
            client,
            server,
            0,
        )
        .await?;
    }

    d.w16(plus(conv, 0x20), d.r16(plus(conv, 0x20)) | flags);

    if d.r8(plus(conv, 0x20)) & 1 != 0 {
        if d.r8(plus(conv, 0x20)) & 0x10 != 0 {
            super::xact::abandon_one(d, hwnd, instance, 0).await?;
        }

        free_links(d, conv, hwnd).await?;

        if d.is_window(d.r16(plus(conv, 0xa))).await? {
            post_dde(d, conv, 0x3e1, hwnd, 0, 0).await?;
            d.si16(instance, 2, d.i16(instance, 2).wrapping_add(1));
            d.w16(plus(conv, 0x20), d.r16(plus(conv, 0x20)) ^ 0x8001);
        }

        d.w16(plus(conv, 0xe), 0);
    }

    if !d.is_window(d.r16(plus(conv, 0xa))).await? {
        d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) ^ 0x21);
    }

    if d.r16(plus(conv, 0x20)) & 0x2021 == 0x2020 {
        d.destroy_window(hwnd).await?;
    }

    Ok(())
}

/// `50be`: `WM_DDE_TERMINATE` from the partner: called back
/// `XTYP_DISCONNECT` and answered, or the answer to this side's own.
pub(crate) async fn on_terminate(d: &Dd<'_>, conv: u32, partner: u16, hwnd: u16) -> R<()> {
    if d.r16(plus(conv, 0xa)) != partner {
        return Ok(());
    }

    let instance = d.r16(conv);

    if d.i16(instance, 0x28) == hwnd {
        d.si16(instance, 0x3a, d.i16(instance, 0x3a) | 2);
        d.post(hwnd, 0x4d1, partner, 0).await?;
        return Ok(());
    }

    if d.r8(plus(conv, 0x20)) & 1 != 0 {
        if d.r8(plus(conv, 0x20)) & 0x10 != 0 {
            super::xact::abandon_one(d, hwnd, instance, 0).await?;
        }

        instance::run_queue(d, instance).await?;
        d.w16(plus(conv, 0x20), d.r16(plus(conv, 0x20)) ^ 0x2021);

        if d.d16(D_MONITORS) != 0 {
            let (client, server) = sides(d, conv, hwnd);

            conv_notice(
                d,
                instance,
                d.r16(plus(conv, 6)),
                d.r16(plus(conv, 8)),
                client,
                server,
                0,
            )
            .await?;
        }

        if d.is_window(d.r16(plus(conv, 0xa))).await? {
            post_dde(d, conv, 0x3e1, hwnd, 0, 0).await?;
        }

        let hconv = conv_of(d, hwnd).await?;
        let own = u32::from(d.r16(plus(conv, 0x20)) & 0x100 != 0);

        instance::callback(d, instance, hconv, 0, 0, 0, 0x80c2, 0, 0, own).await?;
        d.w16(plus(conv, 0xe), 0);
        free_links(d, conv, hwnd).await?;
    } else if d.r8(plus(conv, 0x21)) & 0x80 != 0 {
        d.w16(plus(conv, 0x20), d.r16(plus(conv, 0x20)) ^ 0x8020);
        d.si16(instance, 2, d.i16(instance, 2).wrapping_sub(1));
    }

    if d.r16(plus(conv, 0x20)) & 0x2020 == 0x2020 {
        d.destroy_window(hwnd).await?;
    }

    Ok(())
}

/// `5c58`: a DDE message posted to the partner: behind the posts kept,
/// or tried five times, with a `Yield` between for another task's
/// window, and kept to be posted again on timer 4 where all fail. A
/// termination drops what is kept. Nought where the partner is gone or
/// there is no memory.
pub(crate) async fn post_dde(
    d: &Dd<'_>,
    conv: u32,
    message: u16,
    wparam: u16,
    high: u16,
    low: u16,
) -> R<u16> {
    let partner = d.r16(plus(conv, 0xa));

    if !d.is_window(partner).await? {
        return Ok(0);
    }

    let lparam = long(low, high);
    let queue = d.r32(plus(conv, 0x34));

    if queue != 0 && d.r16(queue) != 0 {
        if message == 0x3e1 {
            d.queue_free(queue).await?;
            d.w32(plus(conv, 0x34), 0);
        } else {
            let item = d.queue_add(queue).await?;

            if item == 0 {
                set_error(d, d.r16(conv), DMLERR_MEMORY_ERROR).await?;
                return Ok(0);
            }

            d.w16(plus(item, 8), message);
            d.w32(plus(item, 0xc), lparam);
        }
    }

    let queue = d.r32(plus(conv, 0x34));

    if queue != 0 && d.r16(queue) != 0 {
        return repost(d, conv, wparam).await;
    }

    let mut tries = 0u16;
    let task = d.window_task(wparam).await?;

    loop {
        if d.post(d.r16(plus(conv, 0xa)), message, wparam, lparam)
            .await?
            != 0
        {
            return Ok(1);
        }

        if !d.is_window(d.r16(plus(conv, 0xa))).await? {
            return Ok(0);
        }

        if d.window_task(d.r16(plus(conv, 0xa))).await? != task {
            d.kernel("Yield", &[]).await?;
        }

        let attempt = tries;

        tries += 1;

        if attempt > 3 {
            break;
        }
    }

    if d.r32(plus(conv, 0x34)) == 0 {
        let queue = d.queue_new(0x10).await?;

        d.w32(plus(conv, 0x34), queue);
    }

    let queue = d.r32(plus(conv, 0x34));
    let item = if queue != 0 {
        d.queue_add(queue).await?
    } else {
        0
    };

    if item == 0 {
        set_error(d, d.r16(conv), DMLERR_MEMORY_ERROR).await?;
        return Ok(0);
    }

    d.w16(plus(item, 8), message);
    d.w32(plus(item, 0xc), lparam);
    Ok(1)
}

/// `5de4`: the posts kept tried again in order; where one fails, timer 4
/// of 200 ms, or everything dropped where the partner is gone.
pub(crate) async fn repost(d: &Dd<'_>, conv: u32, hwnd: u16) -> R<u16> {
    loop {
        let queue = d.r32(plus(conv, 0x34));

        if queue == 0 || d.r16(queue) == 0 {
            return Ok(1);
        }

        let item = d.queue_item(queue, 0);
        let posted = d
            .post(
                d.r16(plus(conv, 0xa)),
                d.r16(plus(item, 8)),
                hwnd,
                d.r32(plus(item, 0xc)),
            )
            .await?;

        if posted != 0 {
            d.queue_remove(queue, 0).await?;
            continue;
        }

        if !d.is_window(d.r16(plus(conv, 0xa))).await? {
            d.queue_free(queue).await?;
            d.w32(plus(conv, 0x34), 0);
            return Ok(0);
        }

        d.set_timer(hwnd, 4, 200).await?;
        return Ok(1);
    }
}

/// `277a`: a conversation's advise links of a window freed -- a client's
/// own list, or a server instance's -- each told to the monitors.
pub(crate) async fn free_links(d: &Dd<'_>, conv: u32, hwnd: u16) -> R<()> {
    let client = d.r8(plus(conv, 0x20)) & 0x10 != 0;
    let list = if client {
        d.r32(plus(conv, 0x3e))
    } else {
        d.i32(d.r16(conv), 0x32)
    };
    let mut link = d.r32(list);

    while link != 0 {
        let next = d.r32(link);

        if d.r16(plus(link, 0xc)) == hwnd {
            if d.d16(D_MONITORS) != 0 {
                let (conv_server, conv_client) = if client {
                    (d.r32(plus(conv, 0xa)), conv_of(d, hwnd).await?)
                } else {
                    (conv_of(d, hwnd).await?, d.r32(plus(conv, 0xa)))
                };

                super::monitor::link_notice(
                    d,
                    d.r16(conv),
                    0,
                    u16::from(d.r8(plus(link, 0xb))) << 8 & 0x4000,
                    u32::from(d.r16(plus(conv, 6))),
                    u32::from(d.r16(plus(conv, 8))),
                    u32::from(d.r16(plus(link, 4))),
                    d.r16(plus(link, 8)),
                    u16::from(!client),
                    conv_server,
                    conv_client,
                )
                .await?;
            }

            delete_atom(d, d.r16(plus(link, 4))).await?;
            d.list_remove(list, link).await?;
        }

        link = next;
    }

    Ok(())
}

/// `DdeDisconnect` (`0b4a`).
pub(crate) async fn disconnect(d: &Dd<'_>, hconv: u32) -> R<u16> {
    if !conv_valid(d, hconv).await? {
        error_each(d, DMLERR_NO_CONV_ESTABLISHED).await?;
        return Ok(0);
    }

    let conv = d.window_long(lo(hconv), 0).await?;
    let instance = d.r16(conv);

    if d.i16(instance, 0x2e) != 0 {
        if d.post(lo(hconv), 0x4ce, 0x2000, conv).await? == 0 {
            set_error(d, instance, DMLERR_SYS_ERROR).await?;
            return Ok(0);
        }

        return Ok(1);
    }

    terminate(d, conv, 0x2000, lo(hconv)).await?;
    Ok(1)
}

/// `DdeReconnect` (`0be0`).
pub(crate) async fn reconnect(d: &Dd<'_>, hconv: u32) -> R<u32> {
    if !conv_valid(d, hconv).await? {
        error_each(d, DMLERR_NO_CONV_ESTABLISHED).await?;
        return Ok(0);
    }

    let hwnd = lo(hconv);
    let conv = d.window_long(hwnd, 0).await?;
    let instance = d.r16(conv);

    d.si16(instance, 0x2a, 0);

    if d.r8(plus(conv, 0x20)) & 0x10 == 0 {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let made = connect_one(
        d,
        instance,
        d.i16(instance, 0x22),
        d.r16(plus(conv, 0x22)),
        u32::from(d.r16(plus(conv, 6))),
        d.r16(plus(conv, 8)),
        plus(conv, 0x24),
    )
    .await?;

    if made == 0 {
        set_error(d, instance, DMLERR_NO_CONV_ESTABLISHED).await?;
        return Ok(0);
    }

    if d.r8(plus(conv, 0x20)) & 0x40 != 0 {
        let parent = d.get_parent(hwnd).await?;

        d.set_parent(made, parent).await?;
    }

    if d.r8(plus(conv, 0x20)) & 2 != 0 {
        let mut link = d.r32(d.r32(plus(conv, 0x3e)));

        while link != 0 {
            let next = d.r32(link);

            if d.r16(plus(link, 0xc)) == hwnd {
                let (params, saved) = d.reserve(0x20);
                let result = plus(params, 0x1c);
                let partner = conv_of(d, made).await?;

                d.w32(params, result);
                d.w32(plus(params, 4), 0xffff_ffff);
                d.w16(
                    plus(params, 8),
                    u16::from(d.r8(plus(link, 0xa)) & 0xc) | 0x1030,
                );
                d.w16(plus(params, 0xa), d.r16(plus(link, 8)));
                d.w32(plus(params, 0xc), u32::from(d.r16(plus(link, 4))));
                d.w32(plus(params, 0x10), partner);
                d.w32(plus(params, 0x14), 0);
                d.w32(plus(params, 0x18), 0);

                let made_conv = d.window_long(made, 0).await?;

                super::xact::transact(d, made_conv, made, params).await?;
                d.release(saved);
            }

            link = next;
        }
    }

    conv_of(d, made).await
}

/// `DdeQueryConvInfo` (`0dac`).
pub(crate) async fn query_conv_info(d: &Dd<'_>, hconv: u32, transaction: u32, info: u32) -> R<u16> {
    let hwnd = lo(hconv);
    let conv = if conv_valid(d, hconv).await? {
        d.window_long(hwnd, 0).await?
    } else {
        0
    };

    if conv == 0 {
        error_each(d, DMLERR_NO_CONV_ESTABLISHED).await?;
        return Ok(0);
    }

    let instance = d.r16(conv);

    d.si16(instance, 0x2a, 0);

    let client = d.send(hwnd, 0x4cb, 0, 0).await? as u16;
    let state = if transaction != 0xffff_ffff && client != 0 {
        let queue = d.r32(plus(conv, 0x3a));
        let item = if queue != 0 {
            d.queue_item(queue, transaction)
        } else {
            0
        };

        if item == 0 {
            set_error(d, instance, 0x4011).await?;
            return Ok(0);
        }

        plus(item, 0xa)
    } else {
        plus(conv, 0xe)
    };

    let mut bytes = vec![0u8; 0x3a];
    let put16 = |bytes: &mut Vec<u8>, at: usize, value: u16| {
        bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
    };
    let put32 = |bytes: &mut Vec<u8>, at: usize, value: u32| {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    };

    put32(&mut bytes, 0, 0x3a);

    let partner = d.r16(plus(conv, 0xa));
    let connected = d.is_window(partner).await? && d.r8(plus(conv, 0x20)) & 5 == 5;

    put32(
        &mut bytes,
        8,
        if connected { d.r32(plus(conv, 0xa)) } else { 0 },
    );
    put32(
        &mut bytes,
        0xc,
        if client != 0 {
            u32::from(d.r16(plus(conv, 6)))
        } else {
            0
        },
    );
    put32(&mut bytes, 0x10, d.r32(plus(conv, 2)));
    put32(&mut bytes, 0x14, u32::from(d.r16(plus(conv, 8))));
    put16(&mut bytes, 0x20, d.r16(plus(conv, 0x20)));

    let context = d.read(plus(conv, 0x24), 16);

    bytes[0x2a..0x3a].copy_from_slice(&context);

    if client != 0 {
        let params = d.r32(plus(state, 8));

        put32(&mut bytes, 4, d.r32(plus(state, 4)));
        put32(&mut bytes, 0x18, d.r32(plus(params, 0xc)));
        put16(&mut bytes, 0x1c, d.r16(plus(params, 0xa)));
        put16(&mut bytes, 0x1e, d.r16(plus(params, 8)));
        put16(&mut bytes, 0x22, d.r16(state));
        put16(&mut bytes, 0x24, d.r16(plus(state, 2)));
    } else {
        put32(&mut bytes, 4, d.r32(plus(conv, 0x12)));
        put16(&mut bytes, 0x22, d.r16(plus(conv, 0xe)));
        put16(&mut bytes, 0x24, d.i16(instance, 0x2a));
    }

    let mut list = 0u32;

    if d.r8(plus(conv, 0x20)) & 0x40 != 0 {
        let parent = d.get_parent(hwnd).await?;

        if d.is_window(parent).await? {
            let parent = d.get_parent(hwnd).await?;
            let tag = d.window_word(parent, 4).await?;
            let parent = d.get_parent(hwnd).await?;

            list = long(parent, tag);
        }
    }

    put32(&mut bytes, 0x26, list);

    let size = d.r16(info).min(0x3a);

    d.write(info, &bytes[..usize::from(size)]);
    d.w32(info, u32::from(size));
    Ok(size)
}

/// `DdeSetUserHandle` (`1020`).
pub(crate) async fn set_user_handle(d: &Dd<'_>, hconv: u32, transaction: u32, user: u32) -> R<u16> {
    if !conv_valid(d, hconv).await? {
        error_each(d, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let hwnd = lo(hconv);
    let conv = d.window_long(hwnd, 0).await?;
    let instance = d.r16(conv);

    d.si16(instance, 0x2a, 0);

    if conv == 0 {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let mut state = plus(conv, 0xe);

    if transaction != 0xffff_ffff {
        if d.send(hwnd, 0x4cb, 0, 0).await? == 0 {
            set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
            return Ok(0);
        }

        let queue = d.r32(plus(conv, 0x3a));
        let item = if queue != 0 {
            d.queue_item(queue, transaction)
        } else {
            0
        };

        if item == 0 {
            set_error(d, instance, 0x4011).await?;
            return Ok(0);
        }

        state = plus(item, 0xa);
    }

    d.w32(plus(state, 4), user);
    Ok(1)
}

/// `DdeConnectList` (`068a`).
pub(crate) async fn connect_list(
    d: &Dd<'_>,
    id: u32,
    service: u32,
    topic: u32,
    old: u32,
    context: u32,
) -> R<u32> {
    let instance = instance_of(d, id);

    if instance == 0 {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if old != 0 && !conv_valid(d, old).await? {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let old_list = lo(old);

    if old_list != 0 {
        let mut child = d.get_window(old_list, 5).await?;

        while child != 0 {
            let next = d.get_window(child, 2).await?;
            let conv = d.window_long(child, 0).await?;

            if d.r8(plus(conv, 0x20)) & 1 == 0 {
                d.set_parent(child, d.i16(instance, 0x22)).await?;
                terminate(d, conv, 0x2000, child).await?;
            }

            child = next;
        }
    }

    let list = d
        .create_window(
            D_CLASS_HOLDING,
            0x4000_0000,
            d.i16(instance, 0x22),
            d.near(instance),
        )
        .await?;

    if list == 0 {
        set_error(d, instance, DMLERR_SYS_ERROR).await?;
        return Ok(0);
    }

    let made = connect_one(
        d,
        instance,
        list,
        hi(service),
        u32::from(lo(service)),
        lo(topic),
        context,
    )
    .await?;

    if made == 0 {
        if old_list != 0 && d.get_window(old_list, 5).await? == 0 {
            d.send(old_list, 0x4ce, 0x2000, 0).await?;
            set_error(d, instance, DMLERR_NO_CONV_ESTABLISHED).await?;
            return Ok(0);
        }

        return Ok(old);
    }

    if old_list != 0 {
        let mut child = d.get_window(old_list, 5).await?;

        while child != 0 {
            let conv = d.window_long(child, 0).await?;
            let partner_task = d.window_task(d.r16(plus(conv, 0xa))).await?;
            let mut fresh = d.get_window(list, 5).await?;
            let final_child = d.get_window(fresh, 1).await?;

            while fresh != 0 {
                let next = if fresh == final_child {
                    0
                } else {
                    d.get_window(fresh, 2).await?
                };
                let other = d.window_long(fresh, 0).await?;
                let fresh_task = d.window_task(d.r16(plus(other, 0xa))).await?;

                if d.r16(plus(conv, 6)) == d.r16(plus(other, 6))
                    && d.r16(plus(conv, 8)) == d.r16(plus(other, 8))
                    && partner_task == fresh_task
                {
                    d.set_parent(fresh, d.i16(instance, 0x22)).await?;

                    let other = d.window_long(fresh, 0).await?;

                    terminate(d, other, 0x2000, fresh).await?;
                }

                fresh = next;
            }

            let mut next = d.get_window(child, 2).await?;

            if next != 0 && d.get_parent(next).await? != old_list {
                next = 0;
            }

            d.set_parent(child, list).await?;
            child = next;
        }

        d.send(old_list, 0x4ce, 0x2000, 0).await?;
    }

    if d.get_window(list, 5).await? == 0 {
        d.send(list, 0x4ce, 0x2000, 0).await?;
        set_error(d, instance, DMLERR_NO_CONV_ESTABLISHED).await?;
        return Ok(0);
    }

    conv_of(d, list).await
}

/// `DdeQueryNextServer` (`0948`).
pub(crate) async fn query_next_server(d: &Dd<'_>, list: u32, previous: u32) -> R<u32> {
    if !conv_valid(d, list).await? {
        error_each(d, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let hwnd = lo(list);
    let instance = d.window_word(hwnd, 0).await?;

    d.si16(instance, 0x2a, 0);

    if previous == 0 {
        let first = d.get_window(hwnd, 5).await?;

        if !d.is_window(first).await? {
            return Ok(0);
        }

        let first = d.get_window(hwnd, 5).await?;
        let again = d.get_window(hwnd, 5).await?;
        let tag = d.window_word(again, 4).await?;

        return Ok(long(first, tag));
    }

    if !conv_valid(d, previous).await? {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let next = d.get_window(lo(previous), 2).await?;

    if next == 0 {
        return Ok(0);
    }

    let parent = d.get_parent(next).await?;

    if parent != hwnd || d.get_window(parent, 5).await? == next {
        return Ok(0);
    }

    conv_of(d, next).await
}

/// `DdeDisconnectList` (`0a46`).
pub(crate) async fn disconnect_list(d: &Dd<'_>, list: u32) -> R<u16> {
    if !conv_valid(d, list).await? {
        error_each(d, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    let instance = d.window_word(lo(list), 0).await?;

    d.si16(instance, 0x2a, 0);
    d.send(lo(list), 0x4ce, 0x2000, 0).await?;
    Ok(1)
}
