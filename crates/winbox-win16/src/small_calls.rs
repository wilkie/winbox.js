//! USER's smaller exports: aliases of others, the cores others are made of,
//! and the helpers its controls paint with. **Read out of `USER.EXE`** and
//! **recorded** by `usermisc`. As `src/win16/user/small-calls.ts`, which
//! says more of each.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Later, Stop, call_named};
use crate::engine::{Engine, GuestArg};
use crate::system::System;

const GW_HWNDLAST: u16 = 1;
const GW_HWNDNEXT: u16 = 2;
const GW_HWNDPREV: u16 = 3;
const GW_CHILD: u16 = 5;
const PM_REMOVE: u16 = 1;
const CS_PARENTDC: u16 = 0x0080;
const NULLREGION: u16 = 1;
const WM_CTLCOLOR: u16 = 0x0019;
const WM_QUIT: u16 = 0x0012;
const WS_CHILD: u32 = 0x4000_0000;
const WS_VISIBLE: u32 = 0x1000_0000;
const WS_DISABLED: u32 = 0x0800_0000;
const GWL_STYLE: u16 = 0xfff0;
const GCW_STYLE: u16 = 0xffe6;
const GW_OWNER: u16 = 4;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "GetMessageExtraInfo" => Implementation::Sync(|_, _| Ok(Answer::Dword(0))),
        "UserYield" => Implementation::Async(user_yield),
        "IsUserIdle" => Implementation::Sync(is_user_idle),
        "GetMessage2" => Implementation::Async(get_message2),
        "ControlPanelInfo" => Implementation::Async(control_panel_info),
        "OldSetDeskPattern" => Implementation::Async(old_set_desk_pattern),
        "OldExitWindows" => Implementation::Sync(old_exit_windows),
        "RepaintScreen" => Implementation::Sync(repaint_screen),
        "GetPriorityClipboardFormat" => Implementation::Sync(get_priority_clipboard_format),
        "GetNextQueueWindow" => Implementation::Async(get_next_queue_window),
        "GetControlBrush" => Implementation::Async(get_control_brush),
        "PaintRect" => Implementation::Async(paint_rect),
        "FillWindow" => Implementation::Async(fill_window),
        "GetUserLocalObjType" => Implementation::Sync(get_user_local_obj_type),
        "GetSystemDebugState" => Implementation::Sync(get_system_debug_state),
        "Bear285" => Implementation::Sync(bear285),
        "Bear86" => Implementation::Sync(bear86),
        "Bear51" => Implementation::Sync(bear51),
        "GetMouseEventProc" => Implementation::Sync(get_mouse_event_proc),
        "SetEventHook" => Implementation::Sync(set_event_hook),
        "WinOldAppHackomatic" => Implementation::Sync(win_old_app_hackomatic),
        "DragDetect" => Implementation::Async(drag_detect),
        "EndMenu" => Implementation::Sync(end_menu),
        "ExitWindowsExec" => Implementation::Sync(|_, _| Ok(Answer::Word(0))),
        "SetSystemMenu" => Implementation::Sync(set_system_menu),
        "GetInternalIconHeader" => Implementation::Sync(get_internal_icon_header),
        "LookupMenuHandle" => Implementation::Sync(lookup_menu_handle),
        _ => return None,
    })
}

/// A call of another export, its answer as a number.
async fn api(
    engine: &Engine,
    module: &'static str,
    name: &'static str,
    args: &[GuestArg],
) -> Result<u32, Stop> {
    Ok(call_named(engine, module, name, args)
        .await?
        .0
        .value()
        .unwrap_or(0))
}

/// Messages other tasks sent answered, the processor given to the others
/// (`USER.EXE` seg1 `3df2`).
fn user_yield(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        engine.take_sent().await?;
        engine.yield_turn(None).await?;
        Ok(Answer::Nothing)
    })
}

/// Nought with a mouse button down; else the screen saver started where its
/// delay has passed, and 1 (`USER.EXE` seg1 `334e`-`33ff`).
fn is_user_idle(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let keys = &system.user_state.async_keys;

    if [1, 2, 4].iter().any(|&vk| keys[vk] & 0x80 != 0) {
        return Ok(Answer::Word(0));
    }

    system.screen_save_look();
    Ok(Answer::Word(1))
}

/// `GetMessage` and `PeekMessage` are this with fixed arguments
/// (`USER.EXE` seg1 `2440`, `2446`); their arguments are its first.
fn get_message2(engine: &Engine, args: Args) -> Later<'_> {
    Box::pin(async move {
        let (far, filter, flags, wait) = {
            let system = engine.system();
            let mut ahead = args;
            let far = ahead.dword(&system);
            let hwnd = ahead.word(&system);
            let first = ahead.word(&system);
            let last = ahead.word(&system);
            let flags = ahead.word(&system);
            let wait = ahead.word(&system);

            (far, crate::queue::Filter { hwnd, first, last }, flags, wait)
        };

        if wait as u8 == 0 {
            return crate::queue::peek_message(engine, args).await;
        }

        if flags & PM_REMOVE != 0 {
            return crate::queue::get_message(engine, args).await;
        }

        engine.system().raster();

        let message = engine
            .next_message(false, true, filter)
            .await?
            .ok_or(Stop::Unsupported("a message never come"))?;
        let mut system = engine.system();

        system.write_far(far, &message.bytes());
        system.note_taken(&message);
        Ok(Answer::Word(u16::from(message.message != WM_QUIT)))
    })
}

/// `SystemParametersInfo` without its checks, `WIN.INI` not written
/// (`USER.EXE` seg41 `1716`).
fn control_panel_info(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (action, param, far) = {
            let system = engine.system();

            (args.word(&system), args.word(&system), args.dword(&system))
        };

        crate::system_parameters::spi(engine, action, param, far, 0).await
    })
}

/// The desktop's pattern made again from `WIN.INI`'s: USER's own
/// `SetDeskPattern` with -1 (`USER.EXE` seg41 `0a51`, `0a61`-`0c03`), as
/// `SPI_SETDESKPATTERN` calls it (`141f`).
fn old_set_desk_pattern(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move { crate::system_parameters::spi(engine, 21, 0xffff, 0, 0).await })
}

/// Windows left at once, nothing asked (`USER.EXE` seg3 `0059`-`005e`):
/// WinBox ends as its `ExitWindows` ends.
fn old_exit_windows(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.ended = true;
    Ok(Answer::Nothing)
}

/// The whole screen painted again, the frames left (`USER.EXE` seg1
/// `77a7`: `RDW_INVALIDATE`, `RDW_ERASE` and `RDW_ALLCHILDREN` of the
/// desktop).
fn repaint_screen(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    system.repaint_all_frames(false);
    Ok(Answer::Nothing)
}

/// The first format of a list that is on the clipboard (`USER.EXE` seg39
/// `0080`-`00ea`).
fn get_priority_clipboard_format(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let list = args.dword(system);
    let count = args.signed(system);
    let formats = system.clipboard_formats();

    if formats.is_empty() {
        return Ok(Answer::Word(0));
    }

    for at in 0..count.max(0) as u16 {
        let bytes = system.read_far(
            list & 0xffff_0000 | u32::from((list as u16).wrapping_add(at * 2)),
            2,
        );
        let format = u16::from_le_bytes([bytes[0], bytes[1]]);

        if format != 0 && formats.contains(&format) {
            return Ok(Answer::Word(format));
        }
    }

    Ok(Answer::Word(0xffff))
}

async fn word_of(engine: &Engine, name: &'static str, args: &[GuestArg]) -> Result<u16, Stop> {
    Ok(api(engine, "USER", name, args).await? as u16)
}

async fn style_of(engine: &Engine, hwnd: u16) -> Result<u32, Stop> {
    api(
        engine,
        "USER",
        "GetWindowLong",
        &[GuestArg::Word(hwnd), GuestArg::Word(GWL_STYLE)],
    )
    .await
}

/// The next window as Alt and Escape takes it, or the one before
/// (`USER.EXE` seg23 `0c3f`-`0ce6`).
fn get_next_queue_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, previous) = {
            let system = engine.system();

            (args.word(&system), args.word(&system))
        };

        if api(engine, "USER", "IsWindow", &[GuestArg::Word(hwnd)]).await? == 0 {
            return Ok(Answer::Word(0));
        }

        let mut top = hwnd;

        while style_of(engine, top).await? & WS_CHILD != 0 {
            let parent = word_of(engine, "GetParent", &[GuestArg::Word(top)]).await?;

            if parent == 0 {
                break;
            }

            top = parent;
        }

        let start = top;
        let desktop = desktop(&engine.system());
        let mut at = start;

        for _ in 0..4096 {
            let way = if previous != 0 {
                GW_HWNDPREV
            } else {
                GW_HWNDNEXT
            };
            let mut next = word_of(
                engine,
                "GetWindow",
                &[GuestArg::Word(at), GuestArg::Word(way)],
            )
            .await?;

            if next == 0 {
                let first = word_of(
                    engine,
                    "GetWindow",
                    &[GuestArg::Word(desktop), GuestArg::Word(GW_CHILD)],
                )
                .await?;

                next = if previous != 0 {
                    word_of(
                        engine,
                        "GetWindow",
                        &[GuestArg::Word(first), GuestArg::Word(GW_HWNDLAST)],
                    )
                    .await?
                } else {
                    first
                };
            }

            at = next;

            if at == 0 || at == start {
                return Ok(Answer::Word(0));
            }

            if style_of(engine, at).await? & WS_VISIBLE == 0 {
                continue;
            }

            let last = word_of(engine, "GetLastActivePopup", &[GuestArg::Word(at)]).await?;

            if style_of(engine, last).await? & WS_DISABLED != 0 {
                continue;
            }

            let mut root = word_of(
                engine,
                "GetWindow",
                &[GuestArg::Word(at), GuestArg::Word(GW_OWNER)],
            )
            .await?;

            if root == 0 {
                if last == at {
                    return Ok(Answer::Word(at));
                }

                continue;
            }

            loop {
                let owner = word_of(
                    engine,
                    "GetWindow",
                    &[GuestArg::Word(root), GuestArg::Word(GW_OWNER)],
                )
                .await?;

                if owner == 0 {
                    break;
                }

                root = owner;
            }

            if word_of(engine, "GetLastActivePopup", &[GuestArg::Word(root)]).await? == at {
                return Ok(Answer::Word(at));
            }
        }

        Ok(Answer::Word(0))
    })
}

/// The window a control asks for its colours: a pop-up's owner, any
/// other's parent -- a top-level window's the desktop -- else itself.
async fn colour_parent(engine: &Engine, hwnd: u16) -> Result<u16, Stop> {
    let style = style_of(engine, hwnd).await?;
    let kind = (style >> 24) & 0xc0;
    let other = if kind == 0x80 || kind == 0xc0 {
        word_of(
            engine,
            "GetWindow",
            &[GuestArg::Word(hwnd), GuestArg::Word(GW_OWNER)],
        )
        .await?
    } else {
        let parent = word_of(engine, "GetParent", &[GuestArg::Word(hwnd)]).await?;

        if parent != 0 {
            parent
        } else if hwnd != 0 && api(engine, "USER", "IsWindow", &[GuestArg::Word(hwnd)]).await? != 0
        {
            desktop(&engine.system())
        } else {
            0
        }
    };

    Ok(if other == 0 { hwnd } else { other })
}

/// `WM_CTLCOLOR` sent, and `DefWindowProc`'s answer where it answers no
/// GDI object (`USER.EXE` seg6 `028c`).
async fn control_colour(
    engine: &Engine,
    parent: u16,
    hwnd: u16,
    hdc: u16,
    kind: u16,
) -> Result<u16, Stop> {
    let answer = api(
        engine,
        "USER",
        "SendMessage",
        &[
            GuestArg::Word(parent),
            GuestArg::Word(WM_CTLCOLOR),
            GuestArg::Word(hdc),
            GuestArg::Long(u32::from(kind) << 16 | u32::from(hwnd)),
        ],
    )
    .await? as u16;
    let mut system = engine.system();

    Ok(
        if crate::gdi::objects::is_gdi_object(&system, answer) != 0 {
            answer
        } else {
            system.default_control_colour(hdc, kind)
        },
    )
}

/// The brush a control of a kind paints with (`USER.EXE` seg6 `02d2`).
fn get_control_brush(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, hdc, kind) = {
            let system = engine.system();

            (args.word(&system), args.word(&system), args.word(&system))
        };
        let parent = colour_parent(engine, hwnd).await?;

        Ok(Answer::Word(
            control_colour(engine, parent, hwnd, hdc, kind).await?,
        ))
    })
}

/// A rectangle filled, the brush's pattern from the parent's client area's
/// corner (`USER.EXE` seg1 `76eb`-`7763`).
async fn paint(
    engine: &Engine,
    parent: u16,
    hwnd: u16,
    hdc: u16,
    brush: u16,
    rect: [i32; 4],
) -> Result<(), Stop> {
    let parent = if parent == 0 {
        desktop(&engine.system())
    } else {
        parent
    };
    let brush = if brush < 8 {
        control_colour(engine, parent, hwnd, hdc, brush).await?
    } else {
        brush
    };
    let was = api(engine, "GDI", "GetBrushOrg", &[GuestArg::Word(hdc)]).await?;
    let (_, origin) = call_named(
        engine,
        "USER",
        "ClientToScreen",
        &[GuestArg::Word(parent), GuestArg::Struct(vec![0; 4])],
    )
    .await?;
    let x = u16::from_le_bytes([origin[0][0], origin[0][1]]);
    let y = u16::from_le_bytes([origin[0][2], origin[0][3]]);
    let bytes: Vec<u8> = rect
        .iter()
        .flat_map(|&side| (side as i16).to_le_bytes())
        .collect();

    api(
        engine,
        "GDI",
        "SetBrushOrg",
        &[GuestArg::Word(hdc), GuestArg::Word(x), GuestArg::Word(y)],
    )
    .await?;
    api(engine, "GDI", "UnrealizeObject", &[GuestArg::Word(brush)]).await?;
    api(
        engine,
        "USER",
        "FillRect",
        &[
            GuestArg::Word(hdc),
            GuestArg::Struct(bytes),
            GuestArg::Word(brush),
        ],
    )
    .await?;
    api(
        engine,
        "GDI",
        "SetBrushOrg",
        &[
            GuestArg::Word(hdc),
            GuestArg::Word(was as u16),
            GuestArg::Word((was >> 16) as u16),
        ],
    )
    .await?;
    Ok(())
}

/// The desktop window's handle.
fn desktop(system: &System) -> u16 {
    system
        .handles
        .lookup(crate::handles::Object::Desktop)
        .unwrap_or(0)
}

fn rect_at(system: &System, far: u32) -> [i32; 4] {
    let bytes = system.read_far(far, 8);
    let word = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));

    [word(0), word(2), word(4), word(6)]
}

/// A rectangle filled with a brush, or for a number under 8 with the brush the
/// parent answers `WM_CTLCOLOR` of that type with; the brush's pattern set to
/// start at the parent's client area's corner, the desktop's where no parent is
/// given (`USER.EXE` seg1 `76eb`-`7763`).
fn paint_rect(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (parent, hwnd, hdc, brush, rect) = {
            let system = engine.system();
            let parent = args.word(&system);
            let hwnd = args.word(&system);
            let hdc = args.word(&system);
            let brush = args.word(&system);
            let far = args.dword(&system);

            (parent, hwnd, hdc, brush, rect_at(&system, far))
        };

        paint(engine, parent, hwnd, hdc, brush, rect).await?;
        Ok(Answer::Nothing)
    })
}

/// What a device context draws in of a window, filled as `PaintRect` fills
/// (`USER.EXE` seg1 `7766`, `78be`).
fn fill_window(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (parent, hwnd, hdc, brush) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.word(&system),
                args.word(&system),
            )
        };
        let (kind, structures) = call_named(
            engine,
            "GDI",
            "GetClipBox",
            &[GuestArg::Word(hdc), GuestArg::Struct(vec![0; 8])],
        )
        .await?;

        if kind.value().unwrap_or(0) as u16 == NULLREGION {
            return Ok(Answer::Nothing);
        }

        let words = |bytes: &[u8]| -> [i32; 4] {
            let word = |at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));

            [word(0), word(2), word(4), word(6)]
        };
        let mut rect = words(&structures[0]);
        let class_style = api(
            engine,
            "USER",
            "GetClassWord",
            &[GuestArg::Word(hwnd), GuestArg::Word(GCW_STYLE)],
        )
        .await? as u16;

        if hwnd != 0 && class_style & CS_PARENTDC != 0 {
            let (_, client) = call_named(
                engine,
                "USER",
                "GetClientRect",
                &[GuestArg::Word(hwnd), GuestArg::Struct(vec![0; 8])],
            )
            .await?;
            let client = words(&client[0]);

            rect = [
                rect[0].max(client[0]),
                rect[1].max(client[1]),
                rect[2].min(client[2]),
                rect[3].min(client[3]),
            ];

            if rect[0] >= rect[2] || rect[1] >= rect[3] {
                rect = [0; 4];
            }
        }

        paint(
            engine,
            if parent == 0 { hwnd } else { parent },
            hwnd,
            hdc,
            brush,
            rect,
        )
        .await?;
        Ok(Answer::Nothing)
    })
}

/// What kind of USER object a local handle is: nought, whatever it is
/// (`USER.EXE` seg1 `1d38`).
fn get_user_local_obj_type(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _ = args.word(system);

    Ok(Answer::Word(0))
}

/// Ordinal 285: USER's data segment's selector (`USER.EXE` seg41 `1736`).
fn bear285(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(system.user_data_selector()))
}

/// Ordinal 86: the icon's width and height, `SM_CXICON` and `SM_CYICON`
/// (`[68Ah]`, `[68Ch]`, seg3 `0e2c`-`0e68`; seg13 `0229`).
fn bear86(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let width = crate::user::system_metric(system, 11);
    let height = crate::user::system_metric(system, 12);

    Ok(Answer::Dword(u32::from(height) << 16 | u32::from(width)))
}

/// Ordinal 51: whether a byte leads a double-byte character, by the
/// ranges the keyboard driver's `Inquire` gave (`[98Eh]`, seg1 `1a6c`).
fn bear51(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let byte = args.word(system) as u8;
    let [low1, low2, high1, high2, ..] = crate::keyboard_tables::INQUIRE;

    Ok(Answer::Word(if byte < low1 || byte > high2 {
        0
    } else if byte <= low2 || byte >= high1 {
        0x100 | u16::from(byte)
    } else {
        0
    }))
}

/// `Mouse_Event`'s own address (`USER.EXE` seg1 `530a`).
fn get_mouse_event_proc(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let Some(kept) = system.kept_named("USER") else {
        return Ok(Answer::Dword(0));
    };
    let stubs = system.stubs(kept);

    Ok(Answer::Dword(
        u32::from(winbox_machine::segment_selector(stubs)) << 16
            | u32::from(crate::system::STEP * (299 + 1)),
    ))
}

/// A procedure for USER's keyboard events to go through, and the one it
/// replaces answered; a pointer that is no code's refused, nought answered
/// (`USER.EXE` seg1 `5028`, `aeca`). Not followed: calling it.
fn set_event_hook(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hook = args.dword(system);

    if hook != 0 && crate::pointers::bad_code(system, hook) {
        return Ok(Answer::Dword(0));
    }

    Ok(Answer::Dword(std::mem::replace(
        &mut system.user_state.event_hook,
        hook,
    )))
}

/// For WINOLDAP: with 0 and 1 a flag of USER's menus set; nought answered
/// (`USER.EXE` seg41 `0e6e`).
fn win_old_app_hackomatic(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let first = args.word(system);
    let second = args.word(system);

    if second == 1 && first == 0 {
        system.user_state.win_old_ap_hack = true;
    }

    Ok(Answer::Dword(0))
}

/// Whether the mouse, pressed at a point, is dragged (`USER.EXE` seg14
/// `035e`-`03ec`); see `DragDetect` in `small-calls.ts`.
fn drag_detect(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, x, y) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let point = args.dword(&system);

            (
                hwnd,
                i32::from(point as i16),
                i32::from((point >> 16) as i16),
            )
        };
        let (dx, dy) = {
            let mut system = engine.system();

            (
                i32::from(crate::user::system_metric(&mut system, 5) as i16) * 2,
                i32::from(crate::user::system_metric(&mut system, 6) as i16) * 2,
            )
        };

        api(engine, "USER", "SetCapture", &[GuestArg::Word(hwnd)]).await?;

        loop {
            let (got, message) = call_named(
                engine,
                "USER",
                "PeekMessage",
                &[
                    GuestArg::Struct(vec![0; 18]),
                    GuestArg::Word(0),
                    GuestArg::Word(WM_MOUSEMOVE),
                    GuestArg::Word(WM_MOUSELAST),
                    GuestArg::Word(PM_REMOVE),
                ],
            )
            .await?;

            if got.value().unwrap_or(0) == 0 {
                api(engine, "USER", "WaitMessage", &[]).await?;
                continue;
            }

            let bytes = &message[0];
            let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);

            match word(2) {
                WM_MOUSEMOVE => {
                    let px = i32::from(word(14) as i16);
                    let py = i32::from(word(16) as i16);

                    if !(px >= x - dx && px < x + dx && py >= y - dy && py < y + dy) {
                        api(engine, "USER", "ReleaseCapture", &[]).await?;
                        return Ok(Answer::Word(1));
                    }
                }
                WM_LBUTTONUP => {
                    api(engine, "USER", "ReleaseCapture", &[]).await?;
                    return Ok(Answer::Word(0));
                }
                _ => {}
            }
        }
    })
}

const WM_MOUSEMOVE: u16 = 0x0200;
const WM_LBUTTONUP: u16 = 0x0202;
const WM_MOUSELAST: u16 = 0x0209;

/// An icon's or cursor's twelve bytes of header copied to a buffer
/// (`USER.EXE` seg12 `1789`, `023f`).
fn get_internal_icon_header(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let icon = args.dword(system);
    let header = args.dword(system);
    let bytes: Vec<u8> = (0..12u16)
        .map(|at| {
            system.read_far(
                icon & 0xffff_0000 | u32::from((icon as u16).wrapping_add(at)),
                1,
            )[0]
        })
        .collect();

    for (at, byte) in bytes.iter().enumerate() {
        system.write_far(
            header & 0xffff_0000 | u32::from((header as u16).wrapping_add(at as u16)),
            &[*byte],
        );
    }

    Ok(Answer::Nothing)
}

/// The menu an item of a command is in, found as USER finds an item by its
/// command; nought for none (`USER.EXE` seg9 `0163`, seg10 `009c`).
fn lookup_menu_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let command = args.word(system);
    let Some(menu) = system.menu_of(handle) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(
        match system.find_menu_item(menu, command, 0)? {
            Some((inside, _)) => system.menu_handle_of(inside),
            None => 0,
        },
    ))
}

/// The menu open ended, whatever window's it is (`USER.EXE` seg9 `00fe`):
/// the capture let go where the menu's window has it, the menu's loop told
/// to end. Nothing with no menu open.
fn end_menu(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    if let Some(owner) = system.menu_loop.owner {
        if system.capture == Some(owner) {
            system.capture = None;
        }

        system.menu_loop.cancelled = true;
    }

    Ok(Answer::Nothing)
}

const WS_SYSMENU: u32 = 0x0008_0000;

/// A window's system menu given: the menu itself, its first item's pop-up
/// shown and answered by `GetSystemMenu` (`USER.EXE` seg9 `0041`-`007c`);
/// nought for a window without `WS_SYSMENU`. Not followed: the menu it had
/// destroyed.
fn set_system_menu(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let menu = args.word(system);
    let Some(index) = system.window_named(hwnd) else {
        return Ok(Answer::Word(0));
    };

    if system.windows[index]
        .as_ref()
        .map_or(0, |window| window.style)
        & WS_SYSMENU
        == 0
    {
        return Ok(Answer::Word(0));
    }

    let popup = system
        .menu_of(menu)
        .and_then(|inside| system.menus[inside].items.first())
        .and_then(|item| item.popup);

    match popup {
        Some(popup) => {
            system.user_calls.system_menus.insert(index, popup);
        }
        None => {
            system.user_calls.system_menus.remove(&index);
        }
    }

    system.user_calls.system_menu_bars.insert(index, menu);
    Ok(Answer::Word(1))
}

/// What the system is in the middle of, for a debugger, as bits
/// (`USER.EXE` seg1 `4afb`-`4b58`): `SDS_MENU` in a menu's loop,
/// `SDS_SYSMODAL` with a system-modal window, `SDS_DIALOG` while a dialog
/// is active, `SDS_TASKLOCKED` after `LockMyTask`; `SDS_NOTASKQUEUE` never,
/// a task here always having a queue. **Recorded** by `sysdbg`.
fn get_system_debug_state(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let mut state = 0u32;

    if system.menu_loop.owner.is_some() {
        state |= 0x01;
    }

    if system.sys_modal != 0 && system.window_named(system.sys_modal).is_some() {
        state |= 0x02;
    }

    if system.dialog_active {
        state |= 0x08;
    }

    if system.lock_my_task != 0 {
        state |= 0x10;
    }

    Ok(Answer::Dword(state))
}
