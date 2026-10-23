//! The execute string's commands carried out, each as `PROGMAN.EXE`'s
//! handler (seg7, by the table at `0ade`) decides whether it is done. As
//! `src/win16/progman/commands.ts`.
//!
//! Each checks its arguments and finds what it works on as the file does,
//! and answers as the file answers. What each then changes -- a group's
//! window, its file, `PROGMAN.INI`, an item made or taken out -- is not done
//! yet (marked "Not yet"): where the file's answer does not hang on it, the
//! command still answers as the file does; where it does, the command
//! fails.

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
        parse::ADD_ITEM => Ok(add_item(pm, block, args)),
        parse::DELETE_GROUP => {
            // `075e`: one argument, a group of that title; then the group
            // deleted (seg4 `23af`), whose answer is not looked at.
            if args.len() != 1 {
                return Ok(false);
            }

            // Not yet: the group's window, file and key taken away.
            Ok(titled(pm, &block.string(args[0]), 0x101).await?.is_some())
        }
        parse::EXIT_PROGMAN => exit_progman(pm, block, args).await,
        parse::SHOW_GROUP => {
            // `0821`: two arguments, a group of that title; then
            // `ShowWindow` of it with the number.
            if args.len() != 2 {
                return Ok(false);
            }

            // Not yet: `ShowWindow(group, number)` -- WinBox's groups have
            // no windows yet.
            let _show = parse::number(block, args[1]);

            Ok(titled(pm, &block.string(args[0]), 0x101).await?.is_some())
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
/// `size` compared by `lstrcmpi`. Its index among the loaded groups.
async fn titled(pm: &Pm<'_>, name: &[u8], size: usize) -> R<Option<usize>> {
    let groups = loaded::groups(pm);

    for (index, group) in groups.top_down() {
        let mut title = group.title().to_vec();

        title.truncate(size - 1);

        if pm
            .user("lstrcmpi", &[api::text(name), api::text(&title)])
            .await? as u16
            == 0
        {
            return Ok(Some(index));
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

    // Not yet: `BringWindowToTop` of the group found; or the group made, its
    // file written, `PROGMAN.INI` rewritten and the group made current.
    titled(pm, &block.string(args[0]), 0x101).await?;
    Ok(true)
}

/// `0479`: one to four arguments, or six to nine; the command not empty;
/// the name cut to 40 characters; a `ReplaceItem` waiting taken. Then the
/// item made in the current group (seg4 `105d`), whose answer is the
/// command's.
fn add_item(pm: &Pm<'_>, block: &mut Block, args: &[usize]) -> bool {
    if args.is_empty() || args.len() == 5 || args.len() > 9 || block.at(args[0]) == 0 {
        return false;
    }

    if args.len() > 1 {
        cut(block, args[1], 40);
    }

    if pm.d16(D_REPLACING) != 0 {
        pm.sd16(D_REPLACING, 0);
    }

    // Not yet: the item made -- its defaults, its icon, its place and the
    // group's file written -- on whose answer the command hangs; so it
    // fails.
    false
}

/// `07cf`: refused as the shell; one argument; the settings saved where it
/// begins with `1` (seg4 `2845`); `WM_CLOSE` posted to the frame. Done.
async fn exit_progman(pm: &Pm<'_>, block: &Block, args: &[usize]) -> R<bool> {
    if pm.d16(main::D_SHELL) != 0 || args.len() != 1 {
        return Ok(false);
    }

    if block.at(args[0]) == b'1' {
        main::save(pm);
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
/// `ReplaceItem`; then the item taken out (seg4 `15a8`). None found, or no
/// current group, fails.
async fn delete_item(pm: &Pm<'_>, block: &Block, args: &[usize]) -> R<bool> {
    if args.len() != 1 {
        return Ok(false);
    }

    let groups = loaded::groups(pm);
    let Some(current) = groups.current.and_then(|index| groups.list.get(index)) else {
        return Ok(false);
    };
    let name = block.string(args[0]);

    for item in &current.group.items {
        if pm
            .user("lstrcmpi", &[api::text(&name), api::text(&item.name)])
            .await? as u16
            == 0
        {
            pm.sd16(D_REPLACED_X, item.x as u16);
            pm.sd16(D_REPLACED_Y, item.y as u16);

            // Not yet: the item taken out and the group's file written.
            return Ok(true);
        }
    }

    Ok(false)
}

/// `0988`: no argument, every group unloaded and loaded again (seg3
/// `0809`); one, the group of that title -- its window's text into a
/// buffer of 1Fh -- from its file (seg4 `1f9a`, `1d4d`), whose answer is
/// not looked at; more, refused.
async fn reload(pm: &Pm<'_>, block: &Block, args: &[usize]) -> R<bool> {
    match args.len() {
        // Not yet: the MDI client hidden, every group unloaded, all loaded
        // again and `display.drv=` written.
        0 => Ok(true),
        // Not yet: the group unloaded and loaded again.
        1 => Ok(titled(pm, &block.string(args[0]), 0x1f).await?.is_some()),
        _ => Ok(false),
    }
}
