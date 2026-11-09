//! The execute string's commands carried out, each as `PROGMAN.EXE`'s
//! handler (seg7, by the table at `0ade`) carries it out.

use super::items::{self, Adding};
use super::loaded;
use super::main::{self, Pm, R};
use super::parse::{self, Block, Command};
use crate::commdlg::api::{self, Arg};

/// `[2A6h]`: a `ReplaceItem` waiting for the next `AddItem`, and the place
/// it kept, `[81Eh]` and `[820h]` (`08ad`-`08b9`, `094a`-`0953`).
const D_REPLACING: u16 = 0x2a6;
const D_REPLACED_X: u16 = 0x81e;
const D_REPLACED_Y: u16 = 0x820;

/// One command (`035f`-`036c`, `0ad1`): whether it was done.
pub(crate) async fn run(pm: &Pm<'_>, block: &mut Block, command: &Command) -> R<bool> {
    let args = &command.args;

    match command.index {
        parse::CREATE_GROUP => create_group(pm, block, args).await,
        parse::ADD_ITEM => add_item(pm, block, args).await,
        parse::DELETE_GROUP => {
            // `075e`: one argument, a group of that title deleted (seg4
            // `23af`), whose answer is not looked at.
            if args.len() != 1 {
                return Ok(false);
            }

            let Some(hwnd) = titled(pm, &block.string(args[0]), 0x101).await? else {
                return Ok(false);
            };

            loaded::delete(pm, hwnd).await?;
            Ok(true)
        }
        parse::EXIT_PROGMAN => exit_progman(pm, block, args).await,
        parse::SHOW_GROUP => {
            // `0821`: two arguments, a group of that title; `ShowWindow` of
            // it with the number, whose answer is not looked at.
            if args.len() != 2 {
                return Ok(false);
            }

            let Some(hwnd) = titled(pm, &block.string(args[0]), 0x101).await? else {
                return Ok(false);
            };
            let show = parse::number(block, args[1]);

            pm.user("ShowWindow", &[Arg::W(hwnd), Arg::W(show)]).await?;
            Ok(true)
        }
        parse::DELETE_ITEM | parse::REPLACE_ITEM => {
            if command.index == parse::REPLACE_ITEM {
                pm.sd16(D_REPLACING, 1);
                pm.sd16(D_REPLACED_X, 0xffff);
                pm.sd16(D_REPLACED_Y, 0xffff);
            }

            delete_item(pm, block, args).await
        }
        parse::RELOAD => reload(pm, block, args).await,
        _ => Ok(false),
    }
}

/// The group a title names, as the handlers find it (`03e9`-`0442`): the
/// MDI client's children from the top, those with an owner -- icons'
/// titles -- passed over, each one's `GetWindowText` into a buffer of
/// `size` compared by `lstrcmpi`. Its window.
async fn titled(pm: &Pm<'_>, name: &[u8], size: u16) -> R<Option<u16>> {
    for hwnd in loaded::windows_top_down(pm).await? {
        let title = pm
            .call(
                "USER",
                "GetWindowText",
                &[Arg::W(hwnd), api::buffer(usize::from(size)), Arg::W(size)],
            )
            .await?
            .string(0);

        if pm
            .user("lstrcmpi", &[api::text(name), api::text(&title)])
            .await? as u16
            == 0
        {
            return Ok(Some(hwnd));
        }
    }

    Ok(None)
}

/// A string argument cut to `length` characters by a nought written into
/// the client's block (`03b4`-`03c1`, `0508`-`0515`).
fn cut(block: &mut Block, offset: usize, length: usize) {
    if block.string(offset).len() > length {
        block.set(offset + length, 0);
    }
}

/// `036f`: one or two arguments, the name cut to 30 characters; a group of
/// that title brought to the top; else the group made (seg4 `210e`), whose
/// answer is not looked at. Done either way.
async fn create_group(pm: &Pm<'_>, block: &mut Block, args: &[usize]) -> R<bool> {
    if args.len() != 1 && args.len() != 2 {
        return Ok(false);
    }

    cut(block, args[0], 30);

    let name = block.string(args[0]);

    if let Some(hwnd) = titled(pm, &name, 0x101).await? {
        pm.user("BringWindowToTop", &[Arg::W(hwnd)]).await?;
        return Ok(true);
    }

    let path = if args.len() == 2 {
        block.string(args[1])
    } else {
        Vec::new()
    };

    loaded::create(pm, &name, &path).await?;
    Ok(true)
}

/// `0479`: one to four arguments, or six to nine; the command not empty;
/// the name cut to 40 characters, else made from the command (seg5 `00ed`);
/// the icon path, its index, the place, the directory (else the command's,
/// seg6 `0398`), the hot key and minimized; a `ReplaceItem`'s place taken
/// where one waits; an index of 666 or more less 666 and the item put last,
/// else first (`05f8`); with no icon path `FindExecutable`'s. The item made
/// in the current group (seg4 `105d`), whose answer is the command's; then
/// the group's scroll bars fitted.
async fn add_item(pm: &Pm<'_>, block: &mut Block, args: &[usize]) -> R<bool> {
    if args.is_empty() || args.len() == 5 || args.len() > 9 || block.at(args[0]) == 0 {
        return Ok(false);
    }

    let command = block.string(args[0]);
    let mut name = Vec::new();

    if args.len() > 1 {
        cut(block, args[1], 40);
        name = block.string(args[1]);
    }

    let (name, command) = if name.is_empty() {
        items::name_of(pm, &command).await?
    } else {
        (name, command)
    };
    let icon_path = if args.len() > 2 {
        block.string(args[2])
    } else {
        Vec::new()
    };
    let mut icon_index = if args.len() > 3 {
        parse::number(block, args[3])
    } else {
        0
    };
    let mut place = (args.len() > 4).then(|| {
        (
            parse::number(block, args[4]) as i16,
            parse::number(block, args[5]) as i16,
        )
    });

    if pm.d16(D_REPLACING) != 0 {
        place = Some((pm.d16(D_REPLACED_X) as i16, pm.d16(D_REPLACED_Y) as i16));
        pm.sd16(D_REPLACING, 0);
    }

    let first = icon_index < 666;

    if !first {
        icon_index -= 666;
    }

    let directory = if args.len() > 6 {
        block.string(args[6])
    } else {
        Vec::new()
    };
    let mut adding = Adding {
        name,
        command,
        icon_path,
        directory,
        hot_key: 0,
        minimized: false,
        icon_index,
        place,
        first,
    };

    items::defaults(pm, &mut adding, args.len() > 6).await?;
    adding.hot_key = if args.len() > 7 {
        parse::number(block, args[7])
    } else {
        0
    };
    adding.minimized = args.len() > 8 && parse::number(block, args[8]) != 0;

    let current = loaded::with(pm, |groups| groups.current);
    let Some(hwnd) = loaded::group(pm, current).map(|group| group.hwnd) else {
        return Ok(false);
    };

    if !items::create(pm, hwnd, adding).await? {
        return Ok(false);
    }

    items::fitted(pm, current).await?;
    Ok(true)
}

/// `07cf`: refused as the shell; one argument; the settings saved where it
/// begins with `1` (seg4 `2845`); `WM_CLOSE` posted to the frame. Done.
async fn exit_progman(pm: &Pm<'_>, block: &Block, args: &[usize]) -> R<bool> {
    if pm.d16(main::D_SHELL) != 0 || args.len() != 1 {
        return Ok(false);
    }

    if block.at(args[0]) == b'1' {
        loaded::save(pm).await?;
    }

    pm.user(
        "PostMessage",
        &[
            Arg::W(pm.d16(main::D_FRAME)),
            Arg::W(main::WM_CLOSE),
            Arg::W(0),
            Arg::D(0),
        ],
    )
    .await?;
    Ok(true)
}

/// `08bc`: one argument; the current group's first item of that name, in
/// the group's order, compared by `lstrcmpi`; its place kept for a
/// `ReplaceItem`; the item deleted (seg4 `15a8`). None found, or no current
/// group, fails.
async fn delete_item(pm: &Pm<'_>, block: &Block, args: &[usize]) -> R<bool> {
    if args.len() != 1 {
        return Ok(false);
    }

    let current = loaded::with(pm, |groups| groups.current);

    if loaded::group(pm, current).is_none() {
        return Ok(false);
    }

    let Some(group_block) = loaded::lock(pm, current).await? else {
        return Ok(false);
    };
    let name = block.string(args[0]);
    let items = loaded::group(pm, current)
        .map(|group| group.items)
        .unwrap_or_default();

    for item in items {
        let def = group_block.def(item.slot);
        let at = u16::from_le_bytes([group_block.data[def + 0x12], group_block.data[def + 0x13]]);
        let theirs = crate::groups::c_string(&group_block.data, at.into());

        if pm
            .user("lstrcmpi", &[api::text(&name), api::text(&theirs)])
            .await? as u16
            == 0
        {
            pm.sd16(D_REPLACED_X, item.icon[0] as u16);
            pm.sd16(D_REPLACED_Y, item.icon[1] as u16);
            items::delete(pm, current, item.slot).await?;
            return Ok(true);
        }
    }

    Ok(false)
}

/// `0988`: no argument, every group unloaded and loaded again; one, the
/// group of that title -- its window's text into a buffer of 1Fh -- unloaded
/// and loaded again from its file as its number (seg4 `1f9a`, `1d4d`), whose
/// answer is not looked at; more, refused.
async fn reload(pm: &Pm<'_>, block: &Block, args: &[usize]) -> R<bool> {
    match args.len() {
        0 => {
            loaded::reload_all(pm).await?;
            Ok(true)
        }
        1 => {
            let Some(hwnd) = titled(pm, &block.string(args[0]), 0x1f).await? else {
                return Ok(false);
            };
            let key = loaded::key_of(pm, hwnd).await?;
            let Some(group) = loaded::group(pm, key) else {
                return Ok(true);
            };

            loaded::unload(pm, hwnd).await?;
            loaded::load(pm, &group.path, group.n).await?;
            Ok(true)
        }
        _ => Ok(false),
    }
}
