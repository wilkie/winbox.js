//! Program Manager's DDE, as `PROGMAN.EXE` seg7 answers it: the frame's
//! messages 3E0h-3E8h (seg2 `228c`-`2296`) go to its dispatcher (`1416`,
//! table `155e`), which keeps no state for a conversation, and the frame
//! answers nought. As `src/win16/progman/dde.ts`
//! (`kb/topics/program-manager-dde.md`).

use super::commands;
use super::loaded::{self, Loaded};
use super::main::{Pm, R};
use super::parse::{self, Block};
use crate::commdlg::api::{self, Arg};

const WM_DDE_INITIATE: u16 = 0x3e0;
const WM_DDE_TERMINATE: u16 = 0x3e1;
const WM_DDE_ADVISE: u16 = 0x3e2;
const WM_DDE_UNADVISE: u16 = 0x3e3;
const WM_DDE_ACK: u16 = 0x3e4;
const WM_DDE_DATA: u16 = 0x3e5;
const WM_DDE_REQUEST: u16 = 0x3e6;
const WM_DDE_POKE: u16 = 0x3e7;
const WM_DDE_EXECUTE: u16 = 0x3e8;

const CF_TEXT: u16 = 1;

/// Its data's flags: `GMEM_DDESHARE | GMEM_MOVEABLE`, and with
/// `GMEM_ZEROINIT` for an `AppProperties` item's.
const DDE_MEMORY: u16 = 0x2002;

/// Whether a message is one of the dispatcher's.
pub(crate) fn is_dde(message: u16) -> bool {
    (WM_DDE_INITIATE..=WM_DDE_EXECUTE).contains(&message)
}

/// The dispatcher (`1416`-`156f`).
pub(crate) async fn message(
    pm: &Pm<'_>,
    hwnd: u16,
    message: u16,
    wparam: u16,
    lparam: u32,
) -> R<()> {
    let low = lparam as u16;
    let high = (lparam >> 16) as u16;

    match message {
        WM_DDE_INITIATE => initiate(pm, hwnd, wparam, low, high).await,
        // `145b`: a terminate sent back, the same `lParam`, whether or not
        // there was a conversation.
        WM_DDE_TERMINATE => {
            pm.send(wparam, WM_DDE_TERMINATE, hwnd, lparam).await?;
            Ok(())
        }
        WM_DDE_ADVISE | WM_DDE_UNADVISE | WM_DDE_DATA | WM_DDE_POKE => {
            refuse(pm, hwnd, wparam, high).await
        }
        WM_DDE_REQUEST => request(pm, hwnd, wparam, low, high).await,
        WM_DDE_EXECUTE => execute(pm, hwnd, wparam, high).await,
        _ => Ok(()),
    }
}

/// `0000`: a negative acknowledgement naming the item, posted; what came
/// with the message is not freed.
async fn refuse(pm: &Pm<'_>, hwnd: u16, client: u16, item: u16) -> R<()> {
    post(pm, client, WM_DDE_ACK, hwnd, u32::from(item) << 16).await
}

async fn post(pm: &Pm<'_>, to: u16, message: u16, wparam: u16, lparam: u32) -> R<()> {
    pm.user(
        "PostMessage",
        &[Arg::W(to), Arg::W(message), Arg::W(wparam), Arg::D(lparam)],
    )
    .await?;
    Ok(())
}

/// `1427`: the registered messages waiting dispatched first (`13e9`), then
/// the two pairs it answers: `Shell` and `AppProperties`, where a missing
/// application matches; and `Progman` and `Progman`.
async fn initiate(pm: &Pm<'_>, hwnd: u16, client: u16, app: u16, topic: u16) -> R<()> {
    loop {
        let called = pm
            .call(
                "USER",
                "PeekMessage",
                &[
                    api::buffer(18),
                    Arg::W(0),
                    Arg::W(0xc000),
                    Arg::W(0xffff),
                    Arg::W(1),
                ],
            )
            .await?;

        if called.word() == 0 {
            break;
        }

        pm.user("DispatchMessage", &[Arg::B(called.buffers[0].clone())])
            .await?;
    }

    offer(
        pm,
        hwnd,
        client,
        app,
        topic,
        b"Shell",
        b"AppProperties",
        true,
    )
    .await?;
    offer(pm, hwnd, client, app, topic, b"Progman", b"Progman", false).await
}

/// `0b24`: both names added as atoms; the initiator's matched against them
/// -- a missing application only where `missing` says, a missing topic
/// always; a match answered with `WM_DDE_ACK` sent, carrying the new atoms,
/// which are the receiver's to delete; otherwise both deleted.
#[allow(clippy::too_many_arguments)]
async fn offer(
    pm: &Pm<'_>,
    hwnd: u16,
    client: u16,
    app: u16,
    topic: u16,
    app_name: &[u8],
    topic_name: &[u8],
    missing: bool,
) -> R<()> {
    let ours_app = pm.user("GlobalAddAtom", &[api::text(app_name)]).await? as u16;
    let ours_topic = pm.user("GlobalAddAtom", &[api::text(topic_name)]).await? as u16;
    let app_matches = if app == 0 { missing } else { app == ours_app };
    let topic_matches = topic == 0 || topic == ours_topic;

    if app_matches && topic_matches {
        pm.send(
            client,
            WM_DDE_ACK,
            hwnd,
            u32::from(ours_topic) << 16 | u32::from(ours_app),
        )
        .await?;
    } else {
        pm.user("GlobalDeleteAtom", &[Arg::W(ours_app)]).await?;
        pm.user("GlobalDeleteAtom", &[Arg::W(ours_topic)]).await?;
    }

    Ok(())
}

/// `1472`: the commands carried out (`0313`), and the acknowledgement
/// posted after all of it -- 8000h, or 0 -- carrying the commands' block,
/// which is not freed.
async fn execute(pm: &Pm<'_>, hwnd: u16, client: u16, commands: u16) -> R<()> {
    let status: u32 = if carry_out(pm, commands).await? {
        0x8000
    } else {
        0
    };

    post(
        pm,
        client,
        WM_DDE_ACK,
        hwnd,
        u32::from(commands) << 16 | status,
    )
    .await
}

/// While commands are carried out, every box Program Manager would show is
/// not (seg1 `00fa`).
pub(crate) const D_QUIET: u16 = 0x22;

/// `0313`: the block locked; the string read whole (`01c8`), nothing done
/// where it is refused; each command in turn, the first that fails
/// stopping the rest (`0aee`-`0afa`); the block unlocked. Whether all were
/// done.
async fn carry_out(pm: &Pm<'_>, commands: u16) -> R<bool> {
    let at = pm.kernel("GlobalLock", &[Arg::W(commands)]).await?;

    if at >> 16 == 0 {
        return Ok(false);
    }

    pm.sd16(D_QUIET, 1);

    let size = pm.kernel("GlobalSize", &[Arg::W(commands)]).await?;
    let room = size.min(0x1_0000 - (at & 0xffff)) as usize;
    let mut block = Block {
        bytes: pm.e.system().read_far(at, room),
    };
    let parsed = parse::parse(pm, &mut block).await?;
    let mut done = false;

    if let Some((list, commands)) = parsed {
        done = true;

        for command in &commands {
            let ran = commands::run(pm, &mut block, command).await;

            pm.e.system().write_far(at, &block.bytes);

            if !ran? {
                done = false;
                break;
            }
        }

        pm.kernel("GlobalFree", &[Arg::W(list)]).await?;
    }

    pm.e.system().write_far(at, &block.bytes);
    pm.kernel("GlobalUnlock", &[Arg::W(commands)]).await?;
    pm.sd16(D_QUIET, 0);
    Ok(done)
}

/// `14a3`: `Progman` and `Groups` answer the list of groups; `GetIcon`,
/// `GetDescription` and `GetWorkingDir` answer as `AppProperties`; any
/// other item is a group's name. Atoms are found, not added.
async fn request(pm: &Pm<'_>, hwnd: u16, client: u16, format: u16, item: u16) -> R<()> {
    let find = |name: &'static [u8]| async move {
        Ok::<u16, crate::Stop>(pm.user("GlobalFindAtom", &[api::text(name)]).await? as u16)
    };

    if find(b"Progman").await? == item || find(b"Groups").await? == item {
        return group_list(pm, hwnd, client, item, format).await;
    }

    for (name, which) in [
        (&b"GetIcon"[..], Property::Icon),
        (b"GetDescription", Property::Description),
        (b"GetWorkingDir", Property::WorkingDir),
    ] {
        if pm.user("GlobalFindAtom", &[api::text(name)]).await? as u16 == item {
            return property(pm, hwnd, client, item, format, which).await;
        }
    }

    group_text(pm, hwnd, client, item, format).await
}

/// `0b90`: the groups' titles in the order loaded, each with a carriage
/// return and line feed, after the header 3000h and `CF_TEXT`; anything
/// but `CF_TEXT` refused. The block is grown for each by `GlobalReAlloc`,
/// and posted with the item's atom as it came.
async fn group_list(pm: &Pm<'_>, hwnd: u16, client: u16, item: u16, format: u16) -> R<()> {
    if format != CF_TEXT {
        return refuse(pm, hwnd, client, item).await;
    }

    let Some(data) = data_block(pm).await? else {
        return refuse(pm, hwnd, client, item).await;
    };
    let mut size = 6u32;

    for group in &loaded::groups(pm).list {
        let title = group.title();

        size += title.len() as u32 + 2;

        if pm
            .kernel("GlobalReAlloc", &[Arg::W(data), Arg::D(size), Arg::W(2)])
            .await? as u16
            == 0
        {
            pm.kernel("GlobalFree", &[Arg::W(data)]).await?;
            return refuse(pm, hwnd, client, item).await;
        }

        let at = pm.kernel("GlobalLock", &[Arg::W(data)]).await? + 4;
        let mut line = title.to_vec();

        line.extend_from_slice(b"\r\n\0");

        let end = {
            let system = pm.e.system();
            let text = system.read_far(at, size as usize - 4);

            text.iter().position(|&b| b == 0).unwrap_or(0) as u32
        };

        pm.e.system().write_far(at + end, &line);
        pm.kernel("GlobalUnlock", &[Arg::W(data)]).await?;
    }

    post(
        pm,
        client,
        WM_DDE_DATA,
        hwnd,
        u32::from(item) << 16 | u32::from(data),
    )
    .await
}

/// `GlobalAlloc(GMEM_DDESHARE | GMEM_MOVEABLE, 6)` with the header 3000h
/// -- `fResponse` and `fRelease` -- `CF_TEXT` and an empty string; none
/// where there is no memory.
async fn data_block(pm: &Pm<'_>) -> R<Option<u16>> {
    let data = pm
        .kernel("GlobalAlloc", &[Arg::W(DDE_MEMORY), Arg::D(6)])
        .await? as u16;

    if data == 0 {
        return Ok(None);
    }

    let at = pm.kernel("GlobalLock", &[Arg::W(data)]).await?;

    pm.e.system()
        .write_far(at, &[0x00, 0x30, 0x01, 0x00, 0x00, 0x00]);
    pm.kernel("GlobalUnlock", &[Arg::W(data)]).await?;
    Ok(Some(data))
}

/// A field of a group's text (`0f99`): a string, quoted where asked, or a
/// number by `%d`; then a comma, or a carriage return and line feed at the
/// end of a line. The block grown by `GlobalReAlloc` with
/// `GMEM_MOVEABLE | GMEM_ZEROINIT`, the field written over the nought
/// before its last byte; where it cannot grow, it is freed. Whether it
/// grew.
async fn field(
    pm: &Pm<'_>,
    data: u16,
    size: &mut u32,
    text: Field<'_>,
    end_of_line: bool,
) -> R<bool> {
    let (bytes, quoted) = match text {
        Field::Text(bytes, quoted) => (bytes.to_vec(), quoted),
        Field::Number(number) => (format!("{}", number as i16).into_bytes(), false),
    };
    let added = bytes.len() as u32 + if end_of_line { 2 } else { 1 } + if quoted { 2 } else { 0 };

    if pm
        .kernel(
            "GlobalReAlloc",
            &[Arg::W(data), Arg::D(*size + added), Arg::W(0x42)],
        )
        .await? as u16
        == 0
    {
        pm.kernel("GlobalFree", &[Arg::W(data)]).await?;
        return Ok(false);
    }

    let at = pm.kernel("GlobalLock", &[Arg::W(data)]).await? + *size - 2;
    let mut written = Vec::new();

    if quoted {
        written.push(b'"');
    }

    written.extend_from_slice(&bytes);

    if quoted {
        written.push(b'"');
    }

    written.extend_from_slice(if end_of_line { b"\r\n" } else { b"," });
    written.push(0);
    pm.e.system().write_far(at, &written);
    pm.kernel("GlobalUnlock", &[Arg::W(data)]).await?;
    *size += added;
    Ok(true)
}

/// What a field of a group's text is.
enum Field<'a> {
    Text(&'a [u8], bool),
    Number(u16),
}

/// The value of an item's tag as seg4 `0c5a` reads it: none, 0; a record
/// of six bytes, 1; of seven, its byte; of eight, its word.
fn tag_value(loaded: &Loaded, item: &crate::groups::Item, id: u16) -> u16 {
    let Some(tags) = &loaded.group.tags else {
        return 0;
    };
    let Some(tag) = tags
        .iter()
        .find(|tag| tag.id == id && tag.item == item.slot)
    else {
        return 0;
    };
    let data = match &tag.data {
        Some(data) => data.clone(),
        None => match id {
            crate::groups::TAG_HOTKEY => item.hot_key.to_le_bytes().to_vec(),
            crate::groups::TAG_MINIMIZED => Vec::new(),
            _ => item.program_directory.clone().unwrap_or_default(),
        },
    };

    match data.len() {
        0 => 1,
        1 => u16::from(data[0]),
        2 => u16::from_le_bytes([data[0], data[1]]),
        _ => 0,
    }
}

/// `10ad`: the group whose name is the item's atom (`GlobalFindAtom` of its
/// name), the MDI client's children walked from the top; its text, or a
/// negative acknowledgement where there is none or the format is not
/// `CF_TEXT`. The first line `"name",path,items,show`, show 3 maximized, 2
/// the current group an icon and 7 another, 1 the current group otherwise
/// and 4 another; then for each item in the group's order
/// `"name","command",directory,icon path,x,y,icon index,hot key,minimized`.
async fn group_text(pm: &Pm<'_>, hwnd: u16, client: u16, item: u16, format: u16) -> R<()> {
    if format != CF_TEXT {
        return refuse(pm, hwnd, client, item).await;
    }

    let groups = loaded::groups(pm);
    let mut found = None;

    for (index, group) in groups.top_down() {
        let atom = pm
            .user("GlobalFindAtom", &[api::text(&group.group.name)])
            .await? as u16;

        if atom == item {
            found = Some((index, group));
            break;
        }
    }

    let Some((index, group)) = found else {
        return refuse(pm, hwnd, client, item).await;
    };
    let Some(data) = data_block(pm).await? else {
        return refuse(pm, hwnd, client, item).await;
    };
    let current = groups.current == Some(index);
    let show = if group.zoomed() {
        3
    } else if group.iconic() {
        if current { 2 } else { 7 }
    } else if current {
        1
    } else {
        4
    };
    let mut size = 6;
    let mut fields = vec![
        (Field::Text(&group.group.name, true), false),
        (Field::Text(&group.path, false), false),
        (Field::Number(group.group.items.len() as u16), false),
        (Field::Number(show), true),
    ];

    for each in &group.group.items {
        fields.extend([
            (Field::Text(&each.name, true), false),
            (Field::Text(&each.command, true), false),
            (Field::Text(&each.directory, false), false),
            (Field::Text(&each.icon_path, false), false),
            (Field::Number(each.x as u16), false),
            (Field::Number(each.y as u16), false),
            (Field::Number(each.icon_index), false),
            (
                Field::Number(tag_value(group, each, crate::groups::TAG_HOTKEY)),
                false,
            ),
            (
                Field::Number(tag_value(group, each, crate::groups::TAG_MINIMIZED)),
                true,
            ),
        ]);
    }

    for (text, end) in fields {
        if !field(pm, data, &mut size, text, end).await? {
            return refuse(pm, hwnd, client, item).await;
        }
    }

    post(
        pm,
        client,
        WM_DDE_DATA,
        hwnd,
        u32::from(item) << 16 | u32::from(data),
    )
    .await
}

/// The `AppProperties` items.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Property {
    Icon,
    Description,
    WorkingDir,
}

/// `0c8b`: the item Program Manager is starting, or the item whose program
/// has the instance in `lParam`'s low word; its icon, its name or its
/// working directory; else a negative acknowledgement. WinBox's starts no
/// item yet, so no item has a program's instance: every item's is nought,
/// and only a request whose low word is nought finds one -- the first item
/// of the top group, as the file's walk would.
async fn property(
    pm: &Pm<'_>,
    hwnd: u16,
    client: u16,
    item: u16,
    instance: u16,
    which: Property,
) -> R<()> {
    let groups = loaded::groups(pm);
    let found = (instance == 0)
        .then(|| {
            groups
                .top_down()
                .find_map(|(_, group)| group.group.items.first())
        })
        .flatten();
    let Some(found) = found else {
        return refuse(pm, hwnd, client, item).await;
    };
    let value = match which {
        // Not yet: the icon's header and planes as `GetInternalIconHeader`
        // gives them (`0d64`, `0e1b`-`0f26`), which wants the item's icon.
        Property::Icon => return refuse(pm, hwnd, client, item).await,
        Property::Description => found.name.clone(),
        // `0d9d`-`0df4`: the working directory made OEM, its environment
        // variables put in, made ANSI again and upper case.
        Property::WorkingDir => {
            let mut directory = found.directory.clone();

            directory.resize(0x80, 0);

            let oem = pm
                .call(
                    "KEYBOARD",
                    "AnsiToOem",
                    &[Arg::B(directory.clone()), api::buffer(0x80)],
                )
                .await?
                .buffers[1]
                .clone();
            let substituted = pm
                .call("SHELL", "DoEnvironmentSubst", &[Arg::B(oem), Arg::W(0x80)])
                .await?
                .buffers[0]
                .clone();
            let ansi = pm
                .call(
                    "KEYBOARD",
                    "OemToAnsi",
                    &[Arg::B(substituted.clone()), api::buffer(0x80)],
                )
                .await?
                .buffers[1]
                .clone();
            let upper = pm.call("USER", "AnsiUpper", &[Arg::B(ansi)]).await?;

            upper.string(0)
        }
    };
    let data = pm
        .kernel(
            "GlobalAlloc",
            &[Arg::W(DDE_MEMORY | 0x40), Arg::D(value.len() as u32 + 5)],
        )
        .await? as u16;

    if data == 0 {
        // `0cd1` with the message already `WM_DDE_DATA`: data of nought.
        return post(pm, client, WM_DDE_DATA, hwnd, u32::from(item) << 16).await;
    }

    let at = pm.kernel("GlobalLock", &[Arg::W(data)]).await?;
    let mut bytes = vec![0x00, 0x30, 0x01, 0x00];

    bytes.extend_from_slice(&value);
    bytes.push(0);
    pm.e.system().write_far(at, &bytes);
    pm.kernel("GlobalUnlock", &[Arg::W(data)]).await?;
    post(
        pm,
        client,
        WM_DDE_DATA,
        hwnd,
        u32::from(item) << 16 | u32::from(data),
    )
    .await
}
