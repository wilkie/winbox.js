//! USER's `DragObject`, ordinal 464: File Manager's and Program Manager's
//! drag of an object over windows that may take it. **Read out** of
//! `USER.EXE` (seg14 `0fbe`, its loop `00f2`-`035b`, its hit test
//! `0000`-`00ef`) and **recorded** by `dragobj`. As
//! `src/win16/user/drag-object.ts`, which says more of each step.

use crate::call::{Answer, Args, Later, Stop};
use crate::commdlg::api::{Arg, api, buffer, word};
use crate::engine::Engine;

const GMEM_DDESHARE_ZEROINIT: u16 = 0x2040;
const DRAGINFO_SIZE: u32 = 0x24;
/// The copy made before each step, at 12h of the block.
const PREVIOUS: u16 = 0x12;
const SOURCE: u16 = 0;
const SCOPE: u16 = 2;
const FORMAT: u16 = 4;
const DATA: u16 = 6;
const POINT: u16 = 0x0a;

const WM_DROPOBJECT: u16 = 0x022a;
const WM_QUERYDROPOBJECT: u16 = 0x022b;
const WM_DRAGLOOP: u16 = 0x022d;
const WM_DRAGSELECT: u16 = 0x022e;
const WM_DRAGMOVE: u16 = 0x022f;
const WM_QUEUESYNC: u16 = 0x0023;
const WM_KEYFIRST: u16 = 0x0100;
const WM_KEYLAST: u16 = 0x0108;
const WM_MOUSEFIRST: u16 = 0x0200;
const WM_MOUSELAST: u16 = 0x0209;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_NCLBUTTONUP: u16 = 0x00a2;
const PM_REMOVE: u16 = 1;

const GWL_STYLE: u16 = 0xfff0;
const GW_HWNDNEXT: u16 = 2;
const GW_CHILD: u16 = 5;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_DISABLED: u32 = 0x0800_0000;
const WS_MINIMIZE: u32 = 0x2000_0000;

#[derive(Clone, Copy)]
struct Rect {
    left: i16,
    top: i16,
    right: i16,
    bottom: i16,
}

impl Rect {
    fn inside(self, x: i16, y: i16) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
}

fn at(bytes: &[u8], index: usize) -> i16 {
    i16::from_le_bytes([
        bytes.get(index).copied().unwrap_or(0),
        bytes.get(index + 1).copied().unwrap_or(0),
    ])
}

async fn window_rect(engine: &Engine, hwnd: u16) -> Result<Rect, Stop> {
    let called = api(engine, "USER", "GetWindowRect", &[Arg::W(hwnd), buffer(8)]).await?;
    let bytes = &called.buffers[0];

    Ok(Rect {
        left: at(bytes, 0),
        top: at(bytes, 2),
        right: at(bytes, 4),
        bottom: at(bytes, 6),
    })
}

/// The client area on the screen.
async fn client_rect(engine: &Engine, hwnd: u16) -> Result<Rect, Stop> {
    let called = api(engine, "USER", "GetClientRect", &[Arg::W(hwnd), buffer(8)]).await?;
    let origin = api(engine, "USER", "ClientToScreen", &[Arg::W(hwnd), buffer(4)]).await?;
    let bytes = &called.buffers[0];
    let x = at(&origin.buffers[0], 0);
    let y = at(&origin.buffers[0], 2);

    Ok(Rect {
        left: at(bytes, 0).wrapping_add(x),
        top: at(bytes, 2).wrapping_add(y),
        right: at(bytes, 4).wrapping_add(x),
        bottom: at(bytes, 6).wrapping_add(y),
    })
}

async fn style_of(engine: &Engine, hwnd: u16) -> Result<u32, Stop> {
    Ok(api(
        engine,
        "USER",
        "GetWindowLong",
        &[Arg::W(hwnd), Arg::W(GWL_STYLE)],
    )
    .await?
    .value)
}

fn read(engine: &Engine, far: u32, offset: u16) -> u16 {
    let address = (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(offset));
    let bytes = engine.system().read_far(address, 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn write(engine: &Engine, far: u32, offset: u16, value: u16) {
    let address = (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(offset));

    engine.system().write_far(address, &value.to_le_bytes());
}

/// The window under the point that takes the object (seg14 `0000`-`00ef`).
async fn hit_test(engine: &Engine, hwnd: u16, far: u32) -> Result<u16, Stop> {
    let x = read(engine, far, POINT) as i16;
    let y = read(engine, far, POINT + 2) as i16;
    let style = style_of(engine, hwnd).await?;

    if !window_rect(engine, hwnd).await?.inside(x, y) || style & WS_DISABLED != 0 {
        return Ok(0);
    }

    let mut non_client = 1;

    if style & WS_MINIMIZE == 0 && client_rect(engine, hwnd).await?.inside(x, y) {
        non_client = 0;

        let mut child = word(
            engine,
            "USER",
            "GetWindow",
            &[Arg::W(hwnd), Arg::W(GW_CHILD)],
        )
        .await?;

        while child != 0 {
            let child_style = style_of(engine, child).await?;

            if child_style & WS_VISIBLE != 0 && window_rect(engine, child).await?.inside(x, y) {
                if child_style & WS_DISABLED == 0 {
                    let answer = Box::pin(hit_test(engine, child, far)).await?;

                    if answer != 0 {
                        return Ok(answer);
                    }
                }

                break;
            }

            child = word(
                engine,
                "USER",
                "GetWindow",
                &[Arg::W(child), Arg::W(GW_HWNDNEXT)],
            )
            .await?;
        }
    }

    let mut point = Vec::with_capacity(4);

    point.extend(x.to_le_bytes());
    point.extend(y.to_le_bytes());

    let client = api(
        engine,
        "USER",
        "ScreenToClient",
        &[Arg::W(hwnd), Arg::B(point)],
    )
    .await?;

    write(engine, far, POINT, at(&client.buffers[0], 0) as u16);
    write(engine, far, POINT + 2, at(&client.buffers[0], 2) as u16);
    write(engine, far, SCOPE, hwnd);

    let answer = api(
        engine,
        "USER",
        "SendMessage",
        &[
            Arg::W(hwnd),
            Arg::W(WM_QUERYDROPOBJECT),
            Arg::W(non_client),
            Arg::D(far),
        ],
    )
    .await?
    .value as u16;

    if answer == 0 {
        write(engine, far, POINT, x as u16);
        write(engine, far, POINT + 2, y as u16);
    }

    Ok(answer)
}

/// The next message for the drag (`01bf`-`0208`): the mouse's, else a queue
/// sync, else a key's; else wait.
async fn next_message(engine: &Engine) -> Result<Vec<u8>, Stop> {
    loop {
        for (first, last) in [
            (WM_MOUSEFIRST, WM_MOUSELAST),
            (WM_QUEUESYNC, WM_QUEUESYNC),
            (WM_KEYFIRST, WM_KEYLAST),
        ] {
            let called = api(
                engine,
                "USER",
                "PeekMessage",
                &[
                    buffer(18),
                    Arg::W(0),
                    Arg::W(first),
                    Arg::W(last),
                    Arg::W(PM_REMOVE),
                ],
            )
            .await?;

            if called.value as u16 != 0 {
                return Ok(called.buffers[0].clone());
            }
        }

        api(engine, "USER", "WaitMessage", &[]).await?;
    }
}

async fn send(
    engine: &Engine,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> Result<u32, Stop> {
    Ok(api(
        engine,
        "USER",
        "SendMessage",
        &[
            Arg::W(hwnd),
            Arg::W(message),
            Arg::W(wparam),
            Arg::D(lparam),
        ],
    )
    .await?
    .value)
}

/// `DragObject` (`USER.EXE` seg14 `00f2`-`035b`): what the window it was
/// dropped on answered, or nought. **Recorded** by `dragobj`.
#[allow(clippy::too_many_lines)]
pub fn drag_object(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (parent, from, format, data, cursor_given) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.word(&system),
            )
        };
        let block = word(
            engine,
            "KERNEL",
            "GlobalAlloc",
            &[Arg::W(GMEM_DDESHARE_ZEROINIT), Arg::D(DRAGINFO_SIZE)],
        )
        .await?;

        if block == 0 {
            return Ok(Answer::Dword(0));
        }

        let far = api(engine, "KERNEL", "GlobalLock", &[Arg::W(block)])
            .await?
            .value;
        let no_drop = engine.system().no_drop_cursor();

        write(engine, far, SOURCE, from);
        write(engine, far, FORMAT, format);
        write(engine, far, DATA, data as u16);
        write(engine, far, DATA + 2, (data >> 16) as u16);

        let before = if cursor_given != 0 {
            word(engine, "USER", "SetCursor", &[Arg::W(cursor_given)]).await?
        } else {
            0
        };

        word(engine, "USER", "SetCapture", &[Arg::W(from)]).await?;
        word(engine, "USER", "ShowCursor", &[Arg::W(1)]).await?;

        let mut last = 0;
        let mut shown;

        loop {
            let message = next_message(engine).await?;
            let kind = u16::from_le_bytes([message[2], message[3]]);

            for offset in (0..PREVIOUS).step_by(2) {
                let value = read(engine, far, offset);

                write(engine, far, PREVIOUS + offset, value);
            }

            write(
                engine,
                far,
                POINT,
                u16::from_le_bytes([message[14], message[15]]),
            );
            write(
                engine,
                far,
                POINT + 2,
                u16::from_le_bytes([message[16], message[17]]),
            );

            let taken = hit_test(engine, parent, far).await?;
            let cursor = match taken {
                0 => {
                    write(engine, far, SCOPE, 0);
                    no_drop
                }
                1 => cursor_given,
                handle => handle,
            };

            if cursor != 0 {
                word(engine, "USER", "SetCursor", &[Arg::W(cursor)]).await?;
            }

            send(engine, from, WM_DRAGLOOP, u16::from(cursor != no_drop), far).await?;

            let scope = read(engine, far, SCOPE);

            shown = cursor;

            if scope == last {
                if last != 0 {
                    send(engine, last, WM_DRAGMOVE, 0, far).await?;
                }
            } else {
                if last != 0 {
                    send(
                        engine,
                        last,
                        WM_DRAGSELECT,
                        0,
                        far.wrapping_add(u32::from(PREVIOUS)),
                    )
                    .await?;
                }

                last = scope;

                if last != 0 {
                    send(engine, last, WM_DRAGSELECT, 1, far).await?;
                }
            }

            if kind == WM_LBUTTONUP || kind == WM_NCLBUTTONUP {
                break;
            }
        }

        api(engine, "USER", "ReleaseCapture", &[]).await?;
        word(engine, "USER", "ShowCursor", &[Arg::W(0)]).await?;

        if cursor_given != 0 {
            word(engine, "USER", "SetCursor", &[Arg::W(before)]).await?;
        }

        let answer = if shown == no_drop {
            0
        } else {
            let scope = read(engine, far, SCOPE);

            send(engine, scope, WM_DROPOBJECT, from, far).await?
        };

        engine.system().handles.free(no_drop);
        api(engine, "KERNEL", "GlobalUnlock", &[Arg::W(block)]).await?;
        word(engine, "KERNEL", "GlobalFree", &[Arg::W(block)]).await?;

        Ok(Answer::Dword(answer))
    })
}
