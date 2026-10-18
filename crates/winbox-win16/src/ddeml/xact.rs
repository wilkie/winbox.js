//! DDEML's transactions: `DdeClientTransaction` and what it sends and
//! waits for (`3672`, `3886`, `4356`), the client's window's answers
//! (`4866`, `4b8e`, `4c6a`), the server's window turning messages into
//! callbacks (`3a68`) and their answers into replies (`3fa0`), advise
//! links and `DdePostAdvise` (`3e64`), and abandoning (`1bf0`, `1cb6`), as
//! `DDEML.DLL` seg1 has them. As `src/win16/ddeml/xact.ts`.

use super::conv::{on_terminate, post_dde};
use super::core::{Cmp, Dd, R, hi, lo, long, plus};
use super::data;
use super::instance::{
    self, DMLERR_INVALIDPARAMETER, DMLERR_MEMORY_ERROR, DMLERR_NO_CONV_ESTABLISHED, conv_valid,
    error_each, instance_of, queue_callback,
};
use super::monitor::{add_count, conv_of, delete_atom, link_notice, set_error};
use super::{D_ARRAY_SENT, D_MONITORS};

const DMLERR_NOTPROCESSED: u16 = 0x4009;
const DMLERR_POSTMSG_FAILED: u16 = 0x400c;
const DMLERR_SERVER_DIED: u16 = 0x400e;
const DMLERR_UNFOUND_QUEUE_ID: u16 = 0x4011;

/// The `CBF_` flags that keep a type away, from DDEML's table (`0A6h`).
fn filter(d: &Dd<'_>, kind: u16) -> u32 {
    d.r32(d.near(0xa6 + ((kind & 0xf0) >> 2)))
}

/// `DdeClientTransaction` (`1204`). Its arguments are the transaction's
/// parameters as `DDEML.DLL` keeps them -- its own frame, `pdwResult` to
/// `pData` -- laid out below the stack here.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn client_transaction(
    d: &Dd<'_>,
    data: u32,
    size: u32,
    hconv: u32,
    item: u32,
    format: u16,
    kind: u16,
    timeout: u32,
    result: u32,
) -> R<u32> {
    let (params, saved) = d.reserve(0x1c);

    d.w32(params, result);
    d.w32(plus(params, 4), timeout);
    d.w16(plus(params, 8), kind);
    d.w16(plus(params, 0xa), format);
    d.w32(plus(params, 0xc), item);
    d.w32(plus(params, 0x10), hconv);
    d.w32(plus(params, 0x14), size);
    d.w32(plus(params, 0x18), data);

    let answer = transaction_body(d, params).await;

    d.release(saved);
    answer
}

#[allow(clippy::too_many_lines)]
async fn transaction_body(d: &Dd<'_>, params: u32) -> R<u32> {
    let hconv = d.r32(plus(params, 0x10));
    let kind = d.r16(plus(params, 8));
    let hwnd = lo(hconv);
    let mut proceed = false;
    let mut conv = 0u32;

    if conv_valid(d, hconv).await? {
        conv = d.window_long(hwnd, 0).await?;

        let instance = d.r16(conv);
        d.si16(instance, 0x2a, 0);

        if d.r8(plus(conv, 0x20)) & 1 == 0 {
            set_error(d, instance, DMLERR_NO_CONV_ESTABLISHED).await?;
        } else if d.r8(plus(conv, 0x20)) & 4 == 0 {
            proceed = true;
        } else {
            let server = d.window_long(d.r16(plus(conv, 0xa)), 0).await?;

            if server == 0 {
                on_terminate(d, conv, d.r16(plus(conv, 0xa)), hwnd).await?;
                set_error(d, instance, DMLERR_NO_CONV_ESTABLISHED).await?;
            } else if filter(d, kind) & d.i32(d.r16(server), 0x1a) != 0 {
                set_error(d, instance, DMLERR_NOTPROCESSED).await?;
            } else {
                proceed = true;
            }
        }
    } else {
        error_each(d, DMLERR_INVALIDPARAMETER).await?;
    }

    if !proceed {
        let data = d.r32(plus(params, 0x18));

        if (kind == 0x4090 || kind == 0x4050)
            && d.r32(plus(params, 0x14)) == 0xffff_ffff
            && lo(data) & 1 == 0
        {
            d.free(data).await?;
        }

        return Ok(0);
    }

    let instance = d.r16(conv);
    let item = d.r32(plus(params, 0xc));
    let format = d.r16(plus(params, 0xa));
    let invalid = 'check: {
        match kind {
            0x103c => {}
            0x1030 | 0x1034 | 0x1038 | 0x20b0 | 0x4050 | 0x4090 => {
                if kind == 0x4050 || kind == 0x4090 {
                    let data = d.r32(plus(params, 0x18));
                    let value = if d.r32(plus(params, 0x14)) == 0xffff_ffff {
                        let value = d.r32(plus(data, 2));

                        if lo(value) & 1 == 0 {
                            d.free(data).await?;
                        }

                        let value = data::prepare(d, conv, value).await?;

                        if value == 0 {
                            return Ok(0);
                        }

                        value
                    } else {
                        let value = data::make(
                            d,
                            instance,
                            0,
                            format,
                            lo(item),
                            0,
                            d.r32(plus(params, 0x14)),
                            data,
                        )
                        .await?;

                        if value == 0 {
                            set_error(d, instance, DMLERR_MEMORY_ERROR).await?;
                            return Ok(0);
                        }

                        value
                    };

                    d.w32(plus(params, 0x18), value);
                }

                if kind != 0x4050 && item == 0 {
                    break 'check true;
                }
            }
            0x8040 => break 'check false,
            _ => break 'check true,
        }

        kind != 0x4050 && format == 0
    };

    if invalid {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if d.r32(plus(params, 4)) == 0xffff_ffff {
        return transact(d, conv, hwnd, params).await;
    }

    let answer = transact(d, conv, hwnd, params).await?;

    if kind & 0x2000 != 0 && answer != 0 {
        let (key, saved) = d.key(&answer.to_le_bytes());
        let added = d
            .array_add(d.i32(instance, 0xc), key, Some(Cmp::Second))
            .await?;

        d.release(saved);

        if added == 0 {
            set_error(d, instance, DMLERR_MEMORY_ERROR).await?;
            return Ok(0);
        }

        let record = d.alloc(d.i16(instance, 0x20), 6).await?;

        if record != 0 {
            d.w16(record, instance);
            d.w32(plus(record, 2), answer);
        } else {
            set_error(d, instance, DMLERR_MEMORY_ERROR).await?;
        }

        return Ok(record);
    }

    Ok(u32::from(answer != 0))
}

/// `3672`: a transaction sent: asynchronously, a record of the
/// conversation's queue its own and its identifier in `pdwResult`; or
/// synchronously, waited for in the modal loop and finished.
pub(crate) async fn transact(d: &Dd<'_>, conv: u32, hwnd: u16, params: u32) -> R<u32> {
    let instance = d.r16(conv);

    if d.r16(plus(conv, 0xe)) != 2 {
        set_error(d, instance, DMLERR_SERVER_DIED).await?;
        return Ok(0);
    }

    if d.r32(plus(params, 4)) == 0xffff_ffff {
        if d.r32(plus(conv, 0x3a)) == 0 {
            let queue = d.queue_new(0x38).await?;

            d.w32(plus(conv, 0x3a), queue);
        }

        let queue = d.r32(plus(conv, 0x3a));
        let record = if queue != 0 {
            d.queue_add(queue).await?
        } else {
            0
        };

        if record == 0 {
            set_error(d, instance, DMLERR_MEMORY_ERROR).await?;
            return Ok(0);
        }

        add_count(d, d.r16(plus(params, 0xc))).await?;

        let copy = plus(record, 0x1c);
        let bytes = d.read(params, 0x1c);

        d.write(copy, &bytes);
        d.w16(plus(record, 0xa), 2);
        d.w32(plus(record, 0x16), 0);
        d.w16(plus(record, 0xc), 0);
        d.w32(plus(record, 0x12), copy);
        d.w16(plus(record, 0x1a), 0);
        d.w32(copy, plus(record, 0x1a));

        let error = send(
            d,
            d.r16(conv),
            plus(record, 0xa),
            d.r16(plus(conv, 0xa)),
            hwnd,
        )
        .await?;

        d.w16(plus(record, 0xc), error);

        if error == DMLERR_SERVER_DIED {
            d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) & 0xfe);
            delete_atom(d, d.r16(plus(record, 0x28))).await?;
            d.queue_remove(d.r32(plus(conv, 0x3a)), d.queue_id(record))
                .await?;
            set_error(d, d.r16(conv), DMLERR_SERVER_DIED).await?;
            return Ok(0);
        }

        let result = d.r32(params);

        if result != 0 {
            d.w32(result, long(lo(record), d.r16(plus(record, 8))));
        }

        return Ok(1);
    }

    d.w32(plus(conv, 0x16), params);

    let error = send(
        d,
        d.r16(conv),
        plus(conv, 0xe),
        d.r16(plus(conv, 0xa)),
        hwnd,
    )
    .await?;

    set_error(d, d.r16(conv), error).await?;

    if error == DMLERR_SERVER_DIED {
        return Ok(0);
    }

    instance::modal_loop(d, d.r16(conv), d.r32(plus(params, 4)), hwnd).await?;

    let answer = finish(
        d,
        hwnd,
        plus(conv, 0xe),
        d.near(d.r16(conv).wrapping_add(0x2a)),
    )
    .await?;

    if d.r16(plus(conv, 0xe)) == 1 {
        let kind = d.r16(plus(params, 8));
        let key = if kind == 0x4050 {
            d.r16(plus(params, 0x1a))
        } else {
            d.r16(plus(params, 0xc))
        };
        let mut bytes = key.to_le_bytes().to_vec();

        bytes.extend_from_slice(&kind.to_le_bytes());

        let (record, saved) = d.key(&bytes);

        d.array_add(d.i32(0, D_ARRAY_SENT), record, None).await?;
        d.release(saved);
        d.w16(plus(conv, 0xe), 2);
    }

    Ok(answer)
}

/// `3886`: a transaction's message posted, its state set: the error, or
/// nought.
async fn send(d: &Dd<'_>, instance: u16, state: u32, partner: u16, hwnd: u16) -> R<u16> {
    let params = d.r32(plus(state, 8));
    let mut high = d.r16(plus(params, 0xc));
    let low;
    let mut free = 0u16;
    let format = d.r16(plus(params, 0xa));
    let message;

    match d.r16(plus(params, 8)) {
        kind @ (0x103c | 0x1030 | 0x1034 | 0x1038) => {
            message = 0x3e2;

            let options = ((((kind & 0xfe) | 2) << 4) & 0xff) << 8;
            let block = d.share(4, options, format).await?;

            if block == 0 {
                d.w16(state, 2);
                return Ok(DMLERR_MEMORY_ERROR);
            }

            free = block;
            low = block;
            d.w16(plus(params, 0x18), 0);
            d.w16(plus(params, 0x1a), block);
            d.w16(state, 0xb);
        }
        0x20b0 => {
            message = 0x3e6;
            add_count(d, high).await?;
            low = format;
            d.w16(state, 5);
        }
        0x4050 => {
            message = 0x3e8;

            let value = d.r32(plus(params, 0x18));

            high = hi(value);

            if lo(value) & 1 == 0 {
                free = hi(value);
            }

            low = 0;
            d.w16(state, 9);
        }
        0x4090 => {
            message = 0x3e7;

            let value = d.r32(plus(params, 0x18));

            low = hi(value);

            if lo(value) & 1 == 0 {
                free = hi(value);
            }

            d.w16(state, 7);
            data::give_away(d, instance, value).await?;
        }
        0x8040 => {
            message = 0x3e3;
            low = format;
            d.w16(state, 0xc);
        }
        _ => return Ok(DMLERR_INVALIDPARAMETER),
    }

    if d.is_window(partner).await? {
        let conv = d.window_long(hwnd, 0).await?;

        if post_dde(d, conv, message, hwnd, high, low).await? == 0 {
            d.w16(state, 2);

            if free != 0 {
                let params = d.r32(plus(state, 8));

                data::free_block(d, free, d.r16(plus(params, 0xa))).await?;
            }

            return Ok(DMLERR_POSTMSG_FAILED);
        }

        return Ok(0);
    }

    d.w16(state, 0);

    if free != 0 {
        let params = d.r32(plus(state, 8));

        data::free_block(d, free, d.r16(plus(params, 0xa))).await?;
    }

    Ok(DMLERR_SERVER_DIED)
}

/// `4356`: what a transaction came to, by its state: a request's data, 1
/// for the others, or nought with its time-out's error where none is set
/// and the state 1. An advise start's link made, an advise stop's ended.
#[allow(clippy::too_many_lines)]
pub(crate) async fn finish(d: &Dd<'_>, hwnd: u16, state: u32, error: u32) -> R<u32> {
    if d.r16(state) == 1 {
        return Ok(0);
    }

    let conv = d.window_long(hwnd, 0).await?;
    let params = d.r32(plus(state, 8));
    let kind = d.r16(plus(params, 8));
    let timeout_error = |code: u16| -> u16 { code };
    let fail = |d: &Dd<'_>, code: u16| {
        if d.r16(error) == 0 {
            d.w16(error, timeout_error(code));
        }

        d.w16(state, 1);
    };
    let done = |d: &Dd<'_>| {
        d.w16(state, 2);
        d.w32(plus(state, 0xc), 1);
    };

    match kind {
        0x103c | 0x1030 | 0x1034 | 0x1038 => {
            if d.r16(state) != 0xd {
                fail(d, 0x4000);
                return Ok(0);
            }

            let options = (u16::from(d.r8(plus(params, 8))) & 0xfc) << 4 << 8 & 0xff00;
            let made = add_link(
                d,
                d.r32(plus(conv, 0x3e)),
                hwnd,
                0,
                d.r16(plus(params, 0xc)),
                options,
                d.r16(plus(params, 0xa)),
            )
            .await?;

            if made == 0 {
                d.w16(state, 1);
                set_error(d, d.r16(conv), DMLERR_MEMORY_ERROR).await?;
                return Ok(0);
            }

            d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 2);

            if d.d16(D_MONITORS) != 0 {
                let client = conv_of(d, hwnd).await?;

                link_notice(
                    d,
                    d.r16(conv),
                    1,
                    u16::from(d.r8(plus(params, 8))) & 4,
                    u32::from(d.r16(plus(conv, 6))),
                    u32::from(d.r16(plus(conv, 8))),
                    d.r32(plus(params, 0xc)),
                    d.r16(plus(params, 0xa)),
                    0,
                    d.r32(plus(conv, 0xa)),
                    client,
                )
                .await?;
            }

            done(d);
            Ok(1)
        }
        0x20b0 => {
            if d.r16(state) != 6 {
                fail(d, 0x4002);
                return Ok(0);
            }

            d.w16(state, 2);
            Ok(d.r32(plus(state, 0xc)))
        }
        0x4050 => {
            if d.r16(state) == 0xa {
                done(d);
                return Ok(1);
            }

            fail(d, 0x4005);
            Ok(0)
        }
        0x4090 => {
            if d.r16(state) == 8 {
                done(d);
                return Ok(1);
            }

            fail(d, 0x400b);
            Ok(0)
        }
        0x8040 => {
            if d.r16(state) != 0xe {
                fail(d, 0x4010);
                return Ok(0);
            }

            let left = remove_links(
                d,
                d.r32(plus(conv, 0x3e)),
                0,
                0,
                d.r16(plus(params, 0xc)),
                d.r16(plus(params, 0xa)),
            )
            .await?;

            if left == 0 {
                d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) & 0xfd);
            }

            if d.d16(D_MONITORS) != 0 {
                let client = conv_of(d, hwnd).await?;

                link_notice(
                    d,
                    d.r16(conv),
                    0,
                    u16::from(d.r8(plus(params, 8))) & 4,
                    u32::from(d.r16(plus(conv, 6))),
                    u32::from(d.r16(plus(conv, 8))),
                    d.r32(plus(params, 0xc)),
                    d.r16(plus(params, 0xa)),
                    0,
                    d.r32(plus(conv, 0xa)),
                    client,
                )
                .await?;
            }

            done(d);
            Ok(1)
        }
        _ => {
            d.w16(state, 1);
            Ok(0)
        }
    }
}

// Advise links: in a client's list or a server instance's, each the item
// (4), topic (6), format (8), options (0Ah) and window (0Ch).

/// `26ea`: the first link matching, nought matching anything.
pub(crate) fn find_link(
    d: &Dd<'_>,
    list: u32,
    hwnd: u16,
    topic: u16,
    item: u16,
    format: u16,
) -> u32 {
    let (key, saved) = d.key(&[
        item as u8,
        (item >> 8) as u8,
        topic as u8,
        (topic >> 8) as u8,
        format as u8,
        (format >> 8) as u8,
        0,
        0,
        hwnd as u8,
        (hwnd >> 8) as u8,
    ]);
    let found = d.list_find(list, Cmp::Link, key);

    d.release(saved);
    found
}

/// `261a`: a link made, or the one there for its window, topic, item and
/// format given these options: nought where no memory; 1 for no item.
pub(crate) async fn add_link(
    d: &Dd<'_>,
    list: u32,
    hwnd: u16,
    topic: u16,
    item: u16,
    options: u16,
    format: u16,
) -> R<u16> {
    if item == 0 {
        return Ok(1);
    }

    let mut link = find_link(d, list, hwnd, topic, item, format);

    if link == 0 {
        add_count(d, item).await?;
        link = d.list_add(list, 1).await?;
    }

    if link != 0 {
        d.w16(plus(link, 4), item);
        d.w16(plus(link, 6), topic);
        d.w16(plus(link, 8), format);
        d.w16(plus(link, 0xa), options);
        d.w16(plus(link, 0xc), hwnd);
    }

    Ok(lo(link))
}

/// `269e`: every link matching ended, its item's atom deleted: whether
/// any link is left in the list.
pub(crate) async fn remove_links(
    d: &Dd<'_>,
    list: u32,
    hwnd: u16,
    topic: u16,
    item: u16,
    format: u16,
) -> R<u16> {
    loop {
        let link = find_link(d, list, hwnd, topic, item, format);

        if link == 0 {
            break;
        }

        delete_atom(d, d.r16(plus(link, 4))).await?;
        d.list_remove(list, link).await?;
    }

    Ok(d.r16(list))
}

/// `2720`: the next link after `link` with this window, topic and item,
/// nought for any.
fn next_link(d: &Dd<'_>, link: u32, hwnd: u16, topic: u16, item: u16) -> u32 {
    let mut link = link;

    loop {
        link = d.r32(link);

        if link == 0
            || ((hwnd == 0 || d.r16(plus(link, 0xc)) == hwnd)
                && (topic == 0 || d.r16(plus(link, 6)) == topic)
                && (item == 0 || d.r16(plus(link, 4)) == item))
        {
            return link;
        }
    }
}

/// `25ae`: how many later links have the same window, topic, item and
/// format as this one.
fn later_links(d: &Dd<'_>, link: u32) -> u16 {
    let mut count = 0;
    let key = plus(link, 4);
    let mut at = d.r32(link);

    while at != 0 {
        let matched = [6u16, 0xc, 4, 8].iter().all(|&field| {
            let wanted = d.r16(plus(link, field));

            wanted == 0 || d.r16(plus(at, field)) == wanted
        });

        if matched {
            count += 1;
        }

        at = d.r32(at);
    }

    let _ = key;
    count
}

/// `DdePostAdvise` (`1118`).
pub(crate) async fn post_advise(d: &Dd<'_>, id: u32, topic: u32, item: u32) -> R<u16> {
    let instance = instance_of(d, id);

    if instance == 0 {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if d.i16(instance, 0x1a) & 0x10 != 0 {
        set_error(d, instance, 0x4004).await?;
        return Ok(0);
    }

    let mut link = find_link(d, d.i32(instance, 0x32), 0, lo(topic), lo(item), 0);

    while link != 0 {
        let hwnd = d.r16(plus(link, 0xc));
        let conv = d.window_long(hwnd, 0).await?;

        if d.r8(plus(link, 0xa)) & 0x80 != 0 {
            d.w8(plus(link, 0xa), d.r8(plus(link, 0xa)) | 0x40);
        } else if d.r8(plus(link, 0xb)) & 0x40 != 0 {
            add_count(d, d.r16(plus(link, 4))).await?;
            post_dde(d, conv, 0x3e5, hwnd, d.r16(plus(link, 4)), 0).await?;
        } else {
            let count = later_links(d, link);

            advise_request(d, hwnd, conv, link, count).await?;
        }

        link = next_link(d, link, 0, lo(topic), lo(item));
    }

    Ok(1)
}

/// `3e64`: a hot link's data asked of the server, `XTYP_ADVREQ`, and
/// posted as `WM_DDE_DATA`; with `fAckReq` where the link asked for it.
pub(crate) async fn advise_request(
    d: &Dd<'_>,
    hwnd: u16,
    conv: u32,
    link: u32,
    count: u16,
) -> R<()> {
    let hconv = conv_of(d, hwnd).await?;
    let answer = instance::callback(
        d,
        d.r16(conv),
        hconv,
        u32::from(d.r16(plus(conv, 8))),
        u32::from(d.r16(plus(link, 4))),
        d.r16(plus(link, 8)),
        0x2022,
        0,
        u32::from(count),
        0,
    )
    .await?;

    if answer == 0 {
        return Ok(());
    }

    let mut value = data::prepare(d, conv, answer).await?;

    d.w8(plus(link, 0xa), d.r8(plus(link, 0xa)) & 0xbf);

    if d.r8(plus(link, 0xb)) & 0x80 != 0 {
        d.w8(plus(link, 0xa), d.r8(plus(link, 0xa)) | 0x80);

        let mut at = d.global_lock(hi(value)).await?;

        if d.r8(plus(at, 1)) & 0x80 == 0 {
            if lo(value) & 1 != 0 {
                let old = hi(value);

                value = data::copy_value(d, d.r16(conv), old, lo(value)).await?;
                d.global_unlock(old).await?;
                at = d.global_lock(hi(value)).await?;
            }

            d.w8(plus(at, 1), d.r8(plus(at, 1)) | 0x80);
        }

        d.global_unlock(hi(value)).await?;
    }

    let instance = d.r16(conv);
    let (key, saved) = d.key(&value.to_le_bytes());

    d.array_find(d.i32(instance, 0xc), Some(Cmp::Second), key, true)
        .await?;
    d.release(saved);
    add_count(d, d.r16(plus(link, 4))).await?;
    post_dde(d, conv, 0x3e5, hwnd, d.r16(plus(link, 4)), hi(value)).await?;
    Ok(())
}

/// `3fa0`: a callback's answer as the reply its message wants.
#[allow(clippy::too_many_lines)]
pub(crate) async fn reply(d: &Dd<'_>, item: u32, answer: u32) -> R<()> {
    let kind = d.r16(plus(item, 0x12));

    if kind & 0xfc00 == 0x8000 && kind != 0x8040 && kind != 0x8080 {
        return Ok(());
    }

    let window = d.r16(plus(item, 4));
    let mut answer = answer;

    if !d.is_window(window).await? {
        if d.r8(plus(item, 0x13)) & 0x20 != 0 && answer != 0 && answer != 0xffff_ffff {
            data::free_value(d, d.r16(plus(item, 0x26)), answer, true).await?;
        }

        return Ok(());
    }

    let conv = d.window_long(window, 0).await?;
    let instance = d.r16(conv);

    match d.r16(plus(item, 0x20)) {
        0 if kind == 0x8080 => {
            delete_atom(d, d.r16(plus(item, 0xc))).await?;
            data::free_value(d, instance, d.r32(plus(item, 0x14)), true).await?;
            d.queue_remove(d.r32(plus(conv, 0x3a)), d.r32(plus(item, 0x18)))
                .await?;
        }
        0x3e2 => {
            let status = if lo(answer) == 0 {
                0
            } else {
                let made = add_link(
                    d,
                    d.i32(instance, 0x32),
                    window,
                    d.r16(plus(conv, 8)),
                    d.r16(plus(item, 0xc)),
                    u16::from(d.r8(plus(item, 0x23)) & 0xc0) << 8,
                    d.r16(plus(item, 0x10)),
                )
                .await?;
                let status = if made == 0 {
                    set_error(d, instance, DMLERR_MEMORY_ERROR).await?;
                    0
                } else {
                    if d.d16(D_MONITORS) != 0 {
                        link_notice(
                            d,
                            instance,
                            1,
                            u16::from(d.r8(plus(item, 0x23)) & 0x40) << 8,
                            u32::from(d.r16(plus(conv, 6))),
                            u32::from(d.r16(plus(conv, 8))),
                            d.r32(plus(item, 0xc)),
                            d.r16(plus(item, 0x10)),
                            1,
                            d.r32(plus(item, 4)),
                            d.r32(plus(conv, 0xa)),
                        )
                        .await?;
                    }

                    d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) | 2);
                    0x8000
                };
                let options = d.r16(plus(item, 0x28));

                d.global_unlock(options).await?;
                d.global_free(options).await?;
                status
            };

            post_dde(d, conv, 0x3e4, window, d.r16(plus(item, 0xc)), status).await?;
        }
        0x3e3 if d.r16(plus(item, 0x24)) != 0 => {
            post_dde(d, conv, 0x3e4, window, d.r16(plus(item, 0x1c)), 0x8000).await?;
        }
        0x3e5 => {
            let mut status = lo(answer) & 0xc00f;

            if status & 0x4000 != 0 {
                status &= 0x7fff;
            }

            let flags = d.r8(plus(item, 0x23));

            if d.r16(plus(item, 0x16)) != 0
                && flags & 0x20 != 0
                && (status & 0x8000 == 0 || flags & 0x80 == 0)
            {
                data::free_value(d, instance, d.r32(plus(item, 0x14)), true).await?;
            }

            if d.r8(plus(item, 0x23)) & 0x80 != 0 {
                post_dde(d, conv, 0x3e4, window, d.r16(plus(item, 0xc)), status).await?;
            } else if d.r16(plus(item, 0xc)) != 0 {
                d.delete_atom_raw(d.r16(plus(item, 0xc))).await?;
            }
        }
        0x3e6 => {
            let (message, low) = if hi(answer) != 0 {
                answer = data::prepare(d, conv, answer).await?;

                let at = d.global_lock(hi(answer)).await?;
                let status = (u16::from(d.r8(plus(item, 0x23))) << 8 & 0x9000) | 0x1000;

                d.w16(at, d.r16(at) | status);
                d.global_unlock(hi(answer)).await?;
                data::give_away(d, instance, answer).await?;
                (0x3e5, hi(answer))
            } else {
                (0x3e4, lo(answer) & 0x4000)
            };

            let posted = post_dde(d, conv, message, window, d.r16(plus(item, 0xc)), low).await?;

            if posted == 0 && message == 0x3e5 {
                data::free_value(d, instance, answer, true).await?;
            }
        }
        0x3e7 => {
            if lo(answer) & 0x8000 != 0 {
                data::free_value(d, instance, d.r32(plus(item, 0x14)), true).await?;
            } else {
                d.array_find(
                    d.i32(instance, 0xc),
                    Some(Cmp::Second),
                    plus(item, 0x14),
                    true,
                )
                .await?;
            }

            let posted = post_dde(
                d,
                conv,
                0x3e4,
                window,
                d.r16(plus(item, 0xc)),
                lo(answer) & 0xc00f,
            )
            .await?;

            if posted == 0 && lo(answer) & 0x8000 == 0 {
                data::free_block(d, hi(answer), d.r16(plus(item, 0x10))).await?;
            }
        }
        0x3e8 => {
            post_dde(
                d,
                conv,
                0x3e4,
                window,
                d.r16(plus(item, 0x16)),
                lo(answer) & 0xc00f,
            )
            .await?;
        }
        _ => {}
    }

    Ok(())
}

/// `3a68`: a DDE message to a server conversation, from its partner, made
/// a queued callback.
#[allow(clippy::too_many_lines)]
pub(crate) async fn server_dde(
    d: &Dd<'_>,
    conv: u32,
    message: u16,
    hwnd: u16,
    client: u16,
    low: u16,
    high: u16,
) -> R<()> {
    if d.r16(plus(conv, 0xa)) != client || d.r8(plus(conv, 0x20)) & 1 == 0 {
        return Ok(());
    }

    let instance = d.r16(conv);
    let mut data = 0u32;
    let mut format = 0u16;
    let mut status = 0u16;
    let mut handle = 0u16;
    let kind;

    match message {
        0x3e2 => {
            kind = 0x1030;

            let at = d.global_lock(low).await?;

            format = d.r16(plus(at, 2));
            status = d.r16(at);
            handle = low;
        }
        0x3e3 => {
            let links = d.i32(instance, 0x32);
            let mut link = find_link(d, links, hwnd, 0, high, low);

            if link == 0 {
                post_dde(d, conv, 0x3e4, hwnd, high, 0).await?;
                return Ok(());
            }

            let first_format = d.r16(plus(link, 8));
            let first_item = d.r16(plus(link, 4));

            if d.d16(D_MONITORS) != 0 {
                let server = conv_of(d, hwnd).await?;

                link_notice(
                    d,
                    instance,
                    0,
                    0,
                    u32::from(d.r16(plus(conv, 6))),
                    u32::from(d.r16(plus(conv, 8))),
                    u32::from(first_item),
                    first_format,
                    1,
                    server,
                    d.r32(plus(conv, 0xa)),
                )
                .await?;
            }

            let mut left = remove_links(d, links, hwnd, 0, first_item, first_format).await?;

            loop {
                if left == 0 {
                    d.w8(plus(conv, 0x20), d.r8(plus(conv, 0x20)) & 0xfd);
                    break;
                }

                link = find_link(d, links, hwnd, 0, high, low);

                if link == 0 {
                    break;
                }

                if d.d16(D_MONITORS) != 0 {
                    let server = conv_of(d, hwnd).await?;

                    link_notice(
                        d,
                        instance,
                        0,
                        0,
                        u32::from(d.r16(plus(conv, 6))),
                        u32::from(d.r16(plus(conv, 8))),
                        u32::from(d.r16(plus(link, 4))),
                        d.r16(plus(link, 8)),
                        1,
                        server,
                        d.r32(plus(conv, 0xa)),
                    )
                    .await?;
                }

                let hconv = conv_of(d, hwnd).await?;

                queue_callback(
                    d,
                    conv,
                    hconv,
                    u32::from(d.r16(plus(conv, 8))),
                    u32::from(d.r16(plus(link, 4))),
                    d.r16(plus(link, 8)),
                    0x8040,
                    0,
                    0,
                    0,
                    message,
                    0,
                    0,
                    0,
                )
                .await?;

                let item = d.r16(plus(link, 4));
                let item_format = d.r16(plus(link, 8));

                left = remove_links(d, links, hwnd, 0, item, item_format).await?;
            }

            let hconv = conv_of(d, hwnd).await?;

            queue_callback(
                d,
                conv,
                hconv,
                u32::from(d.r16(plus(conv, 8))),
                u32::from(first_item),
                first_format,
                0x8040,
                0,
                0,
                u32::from(high),
                message,
                0,
                d.r16(plus(conv, 0xa)),
                0,
            )
            .await?;
            return Ok(());
        }
        0x3e4 => {
            let link = find_link(d, d.i32(instance, 0x32), hwnd, 0, high, 0);

            if link != 0 && d.r8(plus(link, 0xb)) & 0x80 != 0 {
                d.w8(plus(link, 0xa), d.r8(plus(link, 0xa)) & 0x7f);

                if d.r8(plus(link, 0xa)) & 0x40 != 0 {
                    advise_request(d, hwnd, conv, link, 0xffff).await?;
                    return Ok(());
                }
            }

            if high != 0 {
                d.delete_atom_raw(high).await?;
            }

            return Ok(());
        }
        0x3e6 => {
            kind = 0x20b0;
            format = low;
        }
        0x3e7 => {
            kind = 0x4090;

            let at = d.global_lock(low).await?;

            format = d.r16(plus(at, 2));
            status = d.r16(at);
            data = data::wrap(d, instance, low, 0x4000).await?;
        }
        0x3e8 => {
            kind = 0x4050;
            data = long(0xc100, high);
        }
        _ => return Ok(()),
    }

    let hconv = conv_of(d, hwnd).await?;
    let item = if kind == 0x4050 { 0 } else { u32::from(high) };

    queue_callback(
        d,
        conv,
        hconv,
        u32::from(d.r16(plus(conv, 8))),
        item,
        format,
        kind,
        data,
        0,
        0,
        message,
        status,
        d.r16(plus(conv, 0xa)),
        handle,
    )
    .await?;
    Ok(())
}

/// `4b8e`: whether a message answers the transaction in this state.
fn answers(d: &Dd<'_>, state: u32, high: u16, low: u16, message: u16, locked: Option<u32>) -> bool {
    let params = d.r32(plus(state, 8));

    if message == 0x3e5 {
        return match locked {
            Some(at) if at != 0 => {
                d.r8(plus(at, 1)) & 0x10 != 0
                    && d.r16(plus(at, 2)) == d.r16(plus(params, 0xa))
                    && high == d.r16(plus(params, 0xc))
            }
            _ => false,
        };
    }

    let _ = low;

    match d.r16(state) {
        5 | 7 | 0xb | 0xc => message == 0x3e4 && high == d.r16(plus(params, 0xc)),
        9 => message == 0x3e4 && high == d.r16(plus(params, 0x1a)),
        _ => false,
    }
}

/// `4b8e` with its locking of a data message's block.
async fn matches(d: &Dd<'_>, state: u32, high: u16, low: u16, message: u16) -> R<bool> {
    if message == 0x3e5 {
        if d.r16(state) != 5 {
            return Ok(false);
        }

        let at = d.global_lock(low).await?;

        if at == 0 {
            return Ok(false);
        }

        let matched = answers(d, state, high, low, message, Some(at));

        d.global_unlock(low).await?;
        return Ok(matched);
    }

    Ok(answers(d, state, high, low, message, None))
}

/// `4866`: `WM_DDE_ACK` or `WM_DDE_DATA` to a client conversation: the
/// synchronous transaction's answer, an asynchronous one's -- completed
/// with `XTYP_XACT_COMPLETE` -- or advise data, `XTYP_ADVDATA`.
#[allow(clippy::too_many_lines)]
pub(crate) async fn client_dde(
    d: &Dd<'_>,
    conv: u32,
    hwnd: u16,
    message: u16,
    server: u16,
    high: u16,
    low: u16,
) -> R<u16> {
    let instance = d.r16(conv);
    let state = plus(conv, 0xe);

    if matches(d, state, high, low, message).await? {
        let error = d.near(instance.wrapping_add(0x2a));

        if answer(d, error, message, high, low, state, conv, hwnd).await? != 0
            && d.i16(instance, 0x28) != 0
        {
            d.si16(instance, 0x3a, d.i16(instance, 0x3a) | 0x80);
        }

        return Ok(1);
    }

    let queue = d.r32(plus(conv, 0x3a));

    if queue != 0 && d.r32(plus(queue, 8)) != 0 {
        let mut record = d.r32(plus(queue, 8));
        let mut count = d.r16(queue);

        while count != 0 {
            record = d.r32(record);

            if matches(d, plus(record, 0xa), high, low, message).await? {
                let state = plus(record, 0xa);

                if answer(d, plus(record, 0xc), message, high, low, state, conv, hwnd).await? == 0 {
                    return Ok(0);
                }

                let data = finish(d, hwnd, state, plus(record, 0xc)).await?;
                let _ = data;

                d.si16(instance, 0x2a, d.r16(plus(record, 0xc)));

                let hconv = conv_of(d, hwnd).await?;
                let params = d.r32(plus(record, 0x12));

                queue_callback(
                    d,
                    conv,
                    hconv,
                    u32::from(d.r16(plus(conv, 8))),
                    d.r32(plus(params, 0xc)),
                    d.r16(plus(params, 0xa)),
                    0x8080,
                    d.r32(plus(record, 0x16)),
                    long(lo(record), d.r16(plus(record, 8))),
                    u32::from(d.r16(plus(record, 0x1a))),
                    0,
                    0,
                    server,
                    0,
                )
                .await?;
                return Ok(1);
            }

            count -= 1;
        }
    }

    if message != 0x3e5 {
        let (key, saved) = d.key(&high.to_le_bytes());
        let sent = d
            .array_find(d.i32(0, D_ARRAY_SENT), Some(Cmp::First), key, true)
            .await?;

        d.release(saved);

        if sent != 0 && d.r16(plus(sent, 2)) == 0x4050 {
            d.global_free(high).await?;
        } else if high != 0 {
            d.delete_atom_raw(high).await?;
        }

        return Ok(0);
    }

    let item = high;
    let (format, status, locked) = if low != 0 {
        let at = d.global_lock(low).await?;
        let format = d.r16(plus(at, 2));
        let status = d.r16(at);

        d.global_unlock(low).await?;
        (format, status, at != 0)
    } else {
        let link = find_link(d, d.r32(plus(conv, 0x3e)), 0, 0, item, 0);

        (
            if link != 0 { d.r16(plus(link, 8)) } else { 0 },
            0x8000,
            false,
        )
    };

    if status & 0x1000 != 0 {
        if status & 0x8000 != 0 {
            post_dde(d, conv, 0x3e4, hwnd, item, 0x8000).await?;
        }

        data::free_block(d, low, format).await?;

        if item != 0 {
            d.delete_atom_raw(item).await?;
        }

        return Ok(0);
    }

    let hconv = conv_of(d, hwnd).await?;
    let given = if locked { status } else { 0 };
    let value = data::wrap(d, instance, low, 0x4000).await?;

    queue_callback(
        d,
        conv,
        hconv,
        u32::from(d.r16(plus(conv, 8))),
        u32::from(item),
        format,
        0x4010,
        value,
        0,
        0,
        message,
        given,
        d.r16(plus(conv, 0xa)),
        0,
    )
    .await?;
    Ok(1)
}

/// `4c6a`: an answer that matched a transaction taken: the state moved
/// on, the status into `pdwResult`'s low word, the error of a negative
/// acknowledgement, a request's data kept. Whether it is an answer.
#[allow(clippy::too_many_arguments)]
async fn answer(
    d: &Dd<'_>,
    error: u32,
    message: u16,
    high: u16,
    low: u16,
    state: u32,
    conv: u32,
    hwnd: u16,
) -> R<u16> {
    let params = d.r32(plus(state, 8));

    d.w16(plus(state, 0x10), 0);

    match message {
        0x3e4 => {
            if d.r16(state) == 9 || low & 0x8000 == 0 {
                data::free_value(d, d.r16(conv), d.r32(plus(params, 0x18)), true).await?;
            }

            let result = d.r32(params);

            if result != 0 {
                d.w16(result, low);
            }

            let current = d.r16(state);

            if !matches!(current, 5 | 7 | 9 | 0xb | 0xc) {
                return Ok(1);
            }

            if low & 0x8000 != 0 {
                let next = match current {
                    5 => return Ok(0),
                    7 => 8,
                    9 => 0xa,
                    0xb => 0xd,
                    _ => 0xe,
                };

                d.w16(state, next);
                return Ok(1);
            }

            let block = d.r16(plus(params, 0x1a));

            d.w16(error, DMLERR_NOTPROCESSED);

            if low & 0x4000 != 0 {
                d.w16(error, 0x4001);
            }

            match current {
                7 => {
                    let at = d.global_lock(block).await?;

                    if at != 0 && d.r8(plus(at, 1)) & 0x20 != 0 {
                        data::free_block(d, block, d.r16(plus(at, 2))).await?;
                    }
                }
                0xb => {
                    d.global_free(block).await?;
                }
                _ => {}
            }

            d.w16(state, 1);
            Ok(1)
        }
        0x3e5 => {
            if !matches!(d.r16(state), 5 | 0xb) {
                return Ok(0);
            }

            d.w16(state, 6);

            let at = d.global_lock(low).await?;

            if at == 0 {
                return Ok(1);
            }

            let value = if d.r8(plus(at, 1)) & 0x20 == 0 {
                data::copy_value(d, d.r16(conv), low, 0).await?
            } else {
                data::wrap(d, d.r16(conv), low, 0).await?
            };

            d.w32(plus(state, 0xc), value);

            if d.r8(plus(at, 1)) & 0x80 != 0 {
                post_dde(d, conv, 0x3e4, hwnd, high, 0x8000).await?;
            } else if high != 0 {
                d.delete_atom_raw(high).await?;
            }

            Ok(1)
        }
        _ => Ok(0),
    }
}

/// `DdeAbandonTransaction` (`1bf0`).
pub(crate) async fn abandon(d: &Dd<'_>, id: u32, hconv: u32, transaction: u32) -> R<u16> {
    let instance = instance_of(d, id);

    if instance == 0 {
        return Ok(0);
    }

    d.si16(instance, 0x2a, 0);

    if (hconv != 0 && !conv_valid(d, hconv).await?) || transaction == 0xffff_ffff {
        set_error(d, instance, DMLERR_INVALIDPARAMETER).await?;
        return Ok(0);
    }

    if hconv != 0 {
        return abandon_one(d, lo(hconv), instance, transaction).await;
    }

    let mut child = d.get_window(d.i16(instance, 0x22), 5).await?;

    if child == 0 {
        return Ok(1);
    }

    let last = d.get_window(child, 1).await?;

    loop {
        abandon_one(d, child, instance, transaction).await?;

        if child == last {
            return Ok(1);
        }

        child = d.get_window(child, 2).await?;
    }
}

/// `1cb6`: one transaction of a conversation abandoned -- every one, for
/// nought -- its data freed where no handle has it and its item's atom
/// deleted.
pub(crate) async fn abandon_one(d: &Dd<'_>, hwnd: u16, instance: u16, transaction: u32) -> R<u16> {
    let conv = d.window_long(hwnd, 0).await?;

    loop {
        let queue = d.r32(plus(conv, 0x3a));
        let record = d.queue_item(queue, transaction);

        if record == 0 {
            if transaction != 0 {
                set_error(d, instance, DMLERR_UNFOUND_QUEUE_ID).await?;
                return Ok(0);
            }

            return Ok(1);
        }

        if d.r32(plus(record, 0x16)) != 0 {
            let found = d
                .array_find(
                    d.i32(instance, 0xc),
                    Some(Cmp::Second),
                    plus(record, 0x16),
                    false,
                )
                .await?;

            if found == 0 {
                let params = d.r32(plus(record, 0x12));

                data::free_block(d, d.r16(plus(record, 0x16)), d.r16(plus(params, 0xa))).await?;
            }
        }

        delete_atom(d, d.r16(plus(record, 0x28))).await?;
        d.queue_remove(d.r32(plus(conv, 0x3a)), d.queue_id(record))
            .await?;

        if transaction != 0 {
            return Ok(1);
        }
    }
}
