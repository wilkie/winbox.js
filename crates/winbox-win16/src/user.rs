//! USER's functions, as far as the Rust engine answers them.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_ne::ResourceId;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::system::System;
use crate::{classes, icons, menus};
use crate::{create, cursor_pos, destroy, get_dc, queue, window_queries};

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "InitApp" => Implementation::Async(init_app),
        "CreateWindow" => Implementation::Async(create::create_window),
        "CreateWindowEx" => Implementation::Async(create::create_window_ex),
        "_WSPRINTF" => Implementation::Sync(wsprintf),
        "ExitWindows" => Implementation::Sync(exit_windows),
        "lstrcmp" => Implementation::Sync(lstrcmp),
        "lstrcmpi" => Implementation::Sync(lstrcmpi),
        "GetSystemMetrics" => Implementation::Sync(get_system_metrics),
        "GetSysColor" => Implementation::Sync(get_sys_color),
        "GetTickCount" | "GetCurrentTime" => Implementation::Sync(get_tick_count),
        "LoadString" => Implementation::Sync(load_string),
        "RegisterWindowMessage" | "RegisterClipboardFormat" => {
            Implementation::Sync(register_window_message)
        }
        "GetClipboardFormatName" => Implementation::Sync(get_clipboard_format_name),
        "SetMessageQueue" => Implementation::Sync(set_message_queue),
        "LoadIcon" => Implementation::Sync(icons::load_icon),
        "GetDesktopWindow" => Implementation::Sync(get_desktop_window),
        "GetWindowRect" => Implementation::Sync(window_queries::get_window_rect),
        "GetClientRect" => Implementation::Sync(window_queries::get_client_rect),
        "ClientToScreen" => Implementation::Sync(window_queries::client_to_screen),
        "ScreenToClient" => Implementation::Sync(window_queries::screen_to_client),
        "FindWindow" => Implementation::Sync(window_queries::find_window),
        "GetWindow" => Implementation::Sync(window_queries::get_window),
        "GetNextWindow" => Implementation::Sync(window_queries::get_next_window),
        "GetTopWindow" => Implementation::Sync(window_queries::get_top_window),
        "GetClassName" => Implementation::Sync(window_queries::get_class_name),
        "IsWindow" => Implementation::Sync(window_queries::is_window),
        "IsWindowVisible" => Implementation::Sync(window_queries::is_window_visible),
        "IsWindowEnabled" => Implementation::Sync(window_queries::is_window_enabled),
        "EnableWindow" => Implementation::Async(window_queries::enable_window),
        "GetParent" => Implementation::Sync(window_queries::get_parent),
        "IsChild" => Implementation::Sync(window_queries::is_child),
        "GetWindowTask" => Implementation::Sync(window_queries::get_window_task),
        "GetWindowText" => Implementation::Async(window_queries::get_window_text),
        "GetWindowTextLength" => Implementation::Async(window_queries::get_window_text_length),
        "SetWindowText" => Implementation::Async(window_queries::set_window_text),
        "GetWindowWord" => Implementation::Sync(window_queries::get_window_word),
        "SetWindowWord" => Implementation::Sync(window_queries::set_window_word),
        "GetWindowLong" => Implementation::Sync(window_queries::get_window_long),
        "SetWindowLong" => Implementation::Sync(window_queries::set_window_long),
        "GetClassWord" => Implementation::Sync(window_queries::get_class_word),
        "SetClassWord" => Implementation::Sync(window_queries::set_class_word),
        "GetClassLong" => Implementation::Sync(window_queries::get_class_long),
        "SetClassLong" => Implementation::Sync(window_queries::set_class_long),
        "CallWindowProc" => Implementation::Async(window_queries::call_window_proc),
        "DefWindowProc" => Implementation::Async(window_queries::def_window_proc),
        "RegisterClass" => Implementation::Sync(classes::register_class),
        "UnregisterClass" => Implementation::Sync(classes::unregister_class),
        "GetClassInfo" => Implementation::Sync(classes::get_class_info),
        "LoadMenu" => Implementation::Sync(menus::load_menu),
        "LoadCursor" => Implementation::Sync(icons::load_cursor),
        "SetCursor" => Implementation::Sync(icons::set_cursor),
        "GetCursor" => Implementation::Sync(icons::get_cursor),
        "ShowCursor" => Implementation::Sync(icons::show_cursor),
        "GetMessage" => Implementation::Async(queue::get_message),
        "PeekMessage" => Implementation::Async(queue::peek_message),
        "PostMessage" => Implementation::Sync(queue::post_message),
        "PostQuitMessage" => Implementation::Sync(queue::post_quit_message),
        "SendMessage" => Implementation::Async(queue::send_message),
        "DispatchMessage" => Implementation::Async(queue::dispatch_message),
        "TranslateMessage" => Implementation::Sync(queue::translate_message),
        "SetTimer" => Implementation::Sync(queue::set_timer),
        "KillTimer" => Implementation::Sync(queue::kill_timer),
        "GetMessageTime" => Implementation::Sync(queue::get_message_time),
        "GetMessagePos" => Implementation::Sync(queue::get_message_pos),
        "SetCursorPos" => Implementation::Sync(cursor_pos::set_cursor_pos),
        "GetCursorPos" => Implementation::Sync(cursor_pos::get_cursor_pos),
        "ClipCursor" => Implementation::Sync(cursor_pos::clip_cursor),
        "GetClipCursor" => Implementation::Sync(cursor_pos::get_clip_cursor),
        "DestroyWindow" => Implementation::Async(destroy::destroy_window),
        "GetDC" => Implementation::Sync(get_dc::get_dc),
        "ReleaseDC" => Implementation::Sync(get_dc::release_dc),
        _ => {
            return crate::user_misc::implementation(name)
                .or_else(|| crate::menu_api::implementation(name));
        }
    })
}

/// A program's start in USER: USER's own hidden windows made, the first
/// time. The TypeScript engine loads the installable drivers here too;
/// not yet, nor the raster desktop's fonts.
fn init_app(engine: &Engine, _: Args) -> Later<'_> {
    Box::pin(async move {
        engine.make_user_windows().await?;
        Ok(Answer::Word(1))
    })
}

/// A system metric, as the display has it: the screen's size, and the
/// full screen less a caption; the mouse's buttons swapped where
/// `SwapMouseButton` was given; everything else the `chrome` probe
/// recorded; else the driver's own metrics; else nought.
fn get_system_metrics(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = args.signed(system);
    let display = &system.display;
    let metrics = &display.metrics;
    let value = match index {
        0 | 16 => display.width,
        1 => display.height,
        17 => display.height - metrics.caption_height,
        23 if system.swap_buttons.is_some() => system.swap_buttons.unwrap_or(0) as i16,
        _ => match display.metrics_by_index.get(&index.to_string()) {
            Some(&recorded) => recorded,
            None => match index {
                4 => metrics.caption_height,
                15 => metrics.menu_height,
                5 => metrics.border_width,
                6 => metrics.border_height,
                32 => metrics.frame_width,
                33 => metrics.frame_height,
                11 => metrics.icon_width,
                12 => metrics.icon_height,
                _ => 0,
            },
        },
    };

    Ok(Answer::Word(value as u16))
}

/// A system colour: as `SetSysColors` set it, else the display's.
fn get_sys_color(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let index = args.signed(system);
    let colour = usize::try_from(index).ok().and_then(|index| {
        system
            .sys_colors
            .get(index)
            .copied()
            .flatten()
            .or_else(|| system.display.sys_colors.get(index).copied())
    });

    Ok(Answer::Dword(colour.unwrap_or(0)))
}

/// The length of a tick of the timer chip: 65,536 of its cycles at
/// 1,193,180 a second, in milliseconds.
const TICK: f64 = 65_536_000.0 / 1_193_180.0;

/// The milliseconds since Windows started, in whole ticks (`tickstep`).
fn get_tick_count(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let ms = system.clock.now(system.instructions);

    Ok(Answer::Dword(
        ((ms / TICK).floor() * TICK).floor() as u64 as u32
    ))
}

/// A string of a module's string tables, sixteen to a table: as much as
/// fits with its nought; how much fitted.
fn load_string(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let id = args.word(system);
    let buffer = args.dword(system);
    let size = args.signed(system);
    let Some(executable) = system.executable_of(instance) else {
        return Ok(Answer::Word(0));
    };
    let table = id / 16 + 1;
    let index = usize::from(id % 16);
    let mut answer = 0;
    let mut write = None;

    for resource_type in &executable.resources {
        if resource_type.id != ResourceId::Number(6) {
            continue;
        }

        for resource in &resource_type.entries {
            if resource.id != ResourceId::Number(table) {
                continue;
            }

            let data = executable.resource_bytes(resource);
            let mut offset = 0;

            for _ in 0..index {
                offset += 1 + usize::from(data.get(offset).copied().unwrap_or(0));
            }

            if size <= 0 {
                return Ok(Answer::Word(0));
            }

            let length = usize::from(data.get(offset).copied().unwrap_or(0)).min(size as usize - 1);
            let mut bytes = data
                .get(offset + 1..offset + 1 + length)
                .unwrap_or_default()
                .to_vec();

            bytes.push(0);
            answer = length as u16;
            write = Some(bytes);
        }
    }

    if let Some(bytes) = write {
        system.write_far(buffer, &bytes);
    }

    Ok(Answer::Word(answer))
}

/// A message's number by its name, without regard to case: the same for
/// the same name, else the next from C000h.
fn register_window_message(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let name = args.dword(system);

    if name == 0 {
        return Ok(Answer::Word(0));
    }

    let text: String = if name >> 16 == 0 {
        (name & 0xffff).to_string()
    } else {
        system
            .read_string(name)
            .iter()
            .map(|&byte| char::from(byte))
            .collect()
    };
    let key = text.to_ascii_uppercase();

    if let Some(&(message, _)) = system.registered_messages.get(&key) {
        return Ok(Answer::Word(message));
    }

    let message = 0xc000 + system.registered_messages.len();

    if message > 0xffff {
        return Ok(Answer::Word(0));
    }

    system
        .registered_messages
        .insert(key, (message as u16, text));
    Ok(Answer::Word(message as u16))
}

/// A registered message's or format's name, as much as fits.
fn get_clipboard_format_name(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let format = args.word(system);
    let buffer = args.dword(system);
    let size = args.signed(system);
    let name = system
        .registered_messages
        .values()
        .find(|(message, _)| *message == format)
        .map(|(_, name)| name.clone());
    let Some(name) = name else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(if size > 0 {
        system.copy_text(name.as_bytes(), buffer, size as usize) as u16
    } else {
        0
    }))
}

/// The message queue's size: always answered.
fn set_message_queue(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.word(system);
    Ok(Answer::Word(1))
}

/// The desktop window's handle.
fn get_desktop_window(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(
        system
            .handles
            .lookup(crate::handles::Object::Desktop)
            .unwrap_or(0),
    ))
}

/// The session ended: the task with it.
fn exit_windows(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    args.dword(system);
    args.word(system);
    system.ended = true;
    Ok(Answer::Word(1))
}

/// A byte in lower case, as the TypeScript engine lowers a string's
/// characters: A to Z, and Latin-1's capitals.
fn lower(byte: u8) -> u8 {
    match byte {
        b'A'..=b'Z' | 0xc0..=0xd6 | 0xd8..=0xde => byte + 0x20,
        _ => byte,
    }
}

/// Two strings compared a byte at a time, the shorter's end as nought: the
/// first difference.
fn compare(left: &[u8], right: &[u8]) -> i16 {
    (0..left.len().max(right.len()))
        .map(|at| {
            i16::from(left.get(at).copied().unwrap_or(0))
                - i16::from(right.get(at).copied().unwrap_or(0))
        })
        .find(|&difference| difference != 0)
        .unwrap_or(0)
}

fn strings(system: &System, args: &mut Args) -> (Vec<u8>, Vec<u8>) {
    let left = args.dword(system);
    let right = args.dword(system);

    (system.read_string(left), system.read_string(right))
}

/// Not `strcmp`: without regard to case first, and by case only between
/// strings otherwise the same.
fn lstrcmp(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let (left, right) = strings(system, args);
    let lowered = |bytes: &[u8]| bytes.iter().map(|&byte| lower(byte)).collect::<Vec<_>>();
    let collated = compare(&lowered(&left), &lowered(&right));
    let result = if collated == 0 {
        compare(&left, &right)
    } else {
        collated
    };

    Ok(Answer::Word(result as u16))
}

fn lstrcmpi(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let (left, right) = strings(system, args);
    let lowered = |bytes: &[u8]| bytes.iter().map(|&byte| lower(byte)).collect::<Vec<_>>();

    Ok(Answer::Word(
        compare(&lowered(&left), &lowered(&right)) as u16
    ))
}

/// `wsprintf`, a C function: the output and the format above the return
/// address, then the values. Its count of characters written, its nought
/// not counted.
fn wsprintf(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let output = args.above(system, 0);
    let format = system.read_string(args.above(system, 4));
    let values = args.address_above(system, 8);
    let text = format_values(system, &format, values);
    let mut bytes = text.clone();

    bytes.push(0);
    system.write_far(output, &bytes);
    Ok(Answer::Word(text.len() as u16))
}

/// A format spelled out with the values at a far pointer, as `wsprintf`
/// and `wvsprintf` do: `%` then `-`, `#` and `0` flags, a width, a
/// precision after `.`, `l` for a long, and `%`, `s`, `c`, `d`, `i`, `u`,
/// `x` or `X`. A character it does not know is passed over, and the scan
/// goes on for one it does.
pub fn format_values(system: &System, format: &[u8], values: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let mut next = values;
    let mut word = |system: &System| {
        let bytes = system.read_far(next, 2);

        next = (next & 0xffff_0000) | (next.wrapping_add(2) & 0xffff);
        u16::from_le_bytes([bytes[0], bytes[1]])
    };
    let mut at = 0;

    while at < format.len() {
        let byte = format[at];

        at += 1;

        if byte != b'%' {
            out.push(byte);
            continue;
        }

        let mut width = 0usize;
        let mut precision = 0usize;
        let mut in_precision = false;
        let mut left = false;
        let mut zeros = false;
        let mut prefix = false;
        let mut long = false;

        while at < format.len() {
            let code = format[at];

            at += 1;

            match code {
                b'%' => {
                    out.push(b'%');
                    break;
                }
                b'-' => left = true,
                b'#' => prefix = true,
                // A nought first is the flag; after, a digit of the width.
                b'0' if width == 0 && !in_precision => zeros = true,
                b'.' => in_precision = true,
                b'l' => long = true,
                b'0'..=b'9' => {
                    let digit = usize::from(code - b'0');

                    if in_precision {
                        precision = precision * 10 + digit;
                    } else {
                        width = width * 10 + digit;
                    }
                }
                b's' => {
                    let offset = word(system);
                    let segment = word(system);
                    let string = system.read_string(u32::from(segment) << 16 | u32::from(offset));
                    let count = if precision > 0 {
                        string.len().min(precision)
                    } else {
                        string.len()
                    };

                    out.extend_from_slice(&string[..count]);
                    break;
                }
                b'c' => {
                    let value = word(system) as u8;

                    if value != 0 {
                        out.push(value);
                    }

                    break;
                }
                b'd' | b'i' | b'u' | b'x' | b'X' => {
                    let low = word(system);
                    let value = if long {
                        u32::from(word(system)) << 16 | u32::from(low)
                    } else if matches!(code, b'd' | b'i') {
                        // A short is signed only for %d and %i; %u and %x
                        // take its sixteen bits as they are (`comms`).
                        i32::from(low as i16) as u32
                    } else {
                        u32::from(low)
                    };
                    let mut digits = match code {
                        b'd' | b'i' => (value as i32).to_string(),
                        b'u' => value.to_string(),
                        b'x' => format!("{value:x}"),
                        _ => format!("{value:X}"),
                    };

                    if prefix && matches!(code, b'x' | b'X') {
                        digits.insert_str(0, if code == b'x' { "0x" } else { "0X" });
                    }

                    if digits.len() < precision {
                        digits.insert_str(0, &"0".repeat(precision - digits.len()));
                    }

                    if digits.len() < width {
                        let fill = if zeros { "0" } else { " " }.repeat(width - digits.len());

                        if left {
                            digits.push_str(&fill);
                        } else {
                            digits.insert_str(0, &fill);
                        }
                    }

                    out.extend_from_slice(digits.as_bytes());
                    break;
                }
                _ => {}
            }
        }
    }

    out
}
