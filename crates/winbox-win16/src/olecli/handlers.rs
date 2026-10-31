//! Object handlers: a library a class names in the registration database
//! (`class\protocol\StdFileEditing\handler`), which `OLECLI` loads and
//! calls in place of its own defaults to make the class's objects, as the
//! OLE 1.0 programmer's reference describes them -- its `DllCreate`,
//! `DllCreateFromClip`, `DllCreateLinkFromClip`, `DllCreateFromTemplate`,
//! `DllCreateFromFile`, `DllCreateLinkFromFile`, `DllCreateInvisible` and
//! `DllLoadFromStream`, given what the client gave its `Ole` function, each
//! free to call `OLECLI`'s default of the same name, the `Def` exports
//! (110-117), and to change what it makes. As
//! `src/win16/olecli/handlers.ts`, where what was measured and read out is
//! told.
//!
//! `OLECLI`'s own handler of the class `PBrush`, Paintbrush's, is the `Pb`
//! exports (800-812), with the same arguments: each calls its default
//! asking for no picture where a picture was wanted -- a link for its
//! `Native` -- and gives the object Paintbrush's table where it has no
//! picture (`linked.rs`' `pb_table`).

use crate::commdlg::api::{Arg, text};
use crate::engine::GuestArg;

use super::core::{
    Handler, OLE_ERROR_MEMORY, OLE_ERROR_STREAM, OLERENDER_DRAW, OLERENDER_FORMAT, OLERENDER_NONE,
    Ole, R, SCRATCH,
};
use super::linked;
use super::start::FORMATS;

/// The ways an object is made, each a `Dll` export's, in the order
/// `OLECLI` asks a handler for them (seg2 `03fc`-`0503`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Way {
    Load,
    Clip,
    LinkClip,
    Template,
    Create,
    File,
    LinkFile,
    Invisible,
}

const WAYS: [Way; 8] = [
    Way::Load,
    Way::Clip,
    Way::LinkClip,
    Way::Template,
    Way::Create,
    Way::File,
    Way::LinkFile,
    Way::Invisible,
];

impl Way {
    const fn index(self) -> usize {
        self as usize
    }

    /// The handler's export.
    const fn export(self) -> &'static [u8] {
        match self {
            Self::Load => b"DllLoadFromStream",
            Self::Clip => b"DllCreateFromClip",
            Self::LinkClip => b"DllCreateLinkFromClip",
            Self::Template => b"DllCreateFromTemplate",
            Self::Create => b"DllCreate",
            Self::File => b"DllCreateFromFile",
            Self::LinkFile => b"DllCreateLinkFromFile",
            Self::Invisible => b"DllCreateInvisible",
        }
    }

    /// Its arguments' shape, words (`w`) and doublewords (`d`).
    pub(crate) const fn shape(self) -> &'static [u8] {
        match self {
            Self::Load | Self::File => b"dddddddww",
            Self::Clip => b"dddddwwd",
            Self::LinkClip => b"dddddww",
            Self::Template | Self::Create => b"ddddddww",
            Self::LinkFile => b"ddddddddww",
            Self::Invisible => b"ddddddwww",
        }
    }

    /// Where its out pointer is among its arguments.
    const fn out_at(self) -> usize {
        match self {
            Self::Load | Self::Template | Self::Create | Self::Invisible => 5,
            Self::Clip | Self::LinkClip => 4,
            Self::File => 6,
            Self::LinkFile => 7,
        }
    }

    /// Where its rendering is among its arguments; none for a stream's.
    const fn render_at(self) -> Option<usize> {
        match self {
            Self::Load => None,
            Self::Clip | Self::LinkClip => Some(5),
            Self::Template | Self::Create | Self::Invisible => Some(6),
            Self::File => Some(7),
            Self::LinkFile => Some(8),
        }
    }
}

const HKEY_CLASSES_ROOT: u32 = 1;
/// A handler's path as the registration database gives it, at most this
/// long, in `OLECLI`'s data.
const PATH_SIZE: u32 = 0x100;
const PATH_AT: u16 = SCRATCH + 0x400;
const PATH_SIZE_AT: u16 = SCRATCH + 0x500;
/// `OLE_ERROR_CLIPBOARD` (ole.h): the default of a clip that is neither
/// embedded nor linked (seg5 `0172`).
const OLE_ERROR_CLIPBOARD: u16 = 11;
/// `OLE_ERROR_CLASS` (ole.h).
const OLE_ERROR_CLASS: u16 = 20;
const OT_LINK: u32 = 1;
const OT_EMBEDDED: u32 = 2;

/// A format OLE's protocol registers, by its name.
fn cf(ole: &Ole<'_>, name: &str) -> u16 {
    let at = FORMATS.iter().position(|each| *each == name);

    at.and_then(|at| ole.state().formats.get(at).copied())
        .unwrap_or(0)
}

/// A class's handler: its index, `Found::Paintbrush` for Paintbrush's,
/// none for none.
enum Found {
    None,
    Paintbrush,
    Index(usize),
}

async fn handler_for(ole: &Ole<'_>, class: &[u8]) -> R<Found> {
    if class.eq_ignore_ascii_case(b"PBrush") {
        return Ok(Found::Paintbrush);
    }

    let size = ole.near(PATH_SIZE_AT);
    let path = ole.near(PATH_AT);
    let mut key = class.to_vec();

    key.extend_from_slice(b"\\protocol\\StdFileEditing\\handler");
    ole.w32(size, PATH_SIZE);

    let found = ole
        .call(
            "SHELL",
            "RegQueryValue",
            &[
                Arg::D(HKEY_CLASSES_ROOT),
                text(&key),
                Arg::D(path),
                Arg::D(size),
            ],
        )
        .await?;

    if found != 0 || ole.r8(path) == 0 {
        return Ok(Found::None);
    }

    let lower = class.to_ascii_lowercase();
    let existing = ole
        .state()
        .handlers
        .iter()
        .position(|each| each.as_ref().is_some_and(|each| each.class == lower));

    if let Some(index) = existing.filter(|index| *index > 0) {
        let mut state = ole.state();

        if let Some(handler) = state.handlers[index].as_mut() {
            handler.count += 1;
        }

        if state.pending == index {
            state.pending = 0;
        }

        return Ok(Found::Index(index));
    }

    let library = ole.kernel("LoadLibrary", &[Arg::D(path)]).await? as u16;

    if library < 32 {
        return Ok(Found::None);
    }

    let mut procs = [0u32; 8];

    for way in WAYS {
        procs[way.index()] = ole
            .kernel("GetProcAddress", &[Arg::W(library), text(way.export())])
            .await?;
    }

    // Every one but `DllCreateInvisible` is wanted.
    if procs[..7].contains(&0) {
        ole.kernel("FreeLibrary", &[Arg::W(library)]).await?;
        return Ok(Found::None);
    }

    let atom = ole.add_atom_text(class).await?;
    let mut state = ole.state();
    let free = state
        .handlers
        .iter()
        .enumerate()
        .position(|(index, each)| index > 0 && each.is_none())
        .unwrap_or_else(|| state.handlers.len().max(1));

    if state.handlers.len() <= free {
        state.handlers.resize(free + 1, None);
    }

    state.handlers[free] = Some(Handler {
        class: lower,
        atom,
        library,
        count: 1,
        procs,
    });
    Ok(Found::Index(free))
}

/// The library none of whose objects is left let go.
pub(crate) async fn free_pending(ole: &Ole<'_>) -> R<()> {
    let handler = {
        let mut state = ole.state();
        let pending = std::mem::take(&mut state.pending);

        if pending == 0 {
            None
        } else {
            state.handlers.get_mut(pending).and_then(Option::take)
        }
    };

    if let Some(handler) = handler {
        ole.delete_atom(handler.atom).await?;
        ole.kernel("FreeLibrary", &[Arg::W(handler.library)])
            .await?;
    }

    Ok(())
}

/// An object made through a handler let go: the handler counted down, and
/// left to be let go where none of its objects is left.
pub(crate) async fn released(ole: &Ole<'_>, object: u32) -> R<()> {
    let index = ole.state().handler_of.remove(&object);
    let Some(index) = index else {
        return Ok(());
    };
    let empty = {
        let mut state = ole.state();

        state
            .handlers
            .get_mut(index)
            .and_then(Option::as_mut)
            .is_some_and(|handler| {
                handler.count -= 1;
                handler.count <= 0
            })
    };

    if empty {
        free_pending(ole).await?;
        ole.state().pending = index;
    }

    Ok(())
}

/// An object made as its class's handler makes it: by the handler's
/// export, by Paintbrush's, or by the default. `values` are the `Dll`
/// export's arguments, as the client gave them to its `Ole` function.
pub(crate) async fn make(ole: &Ole<'_>, way: Way, class: &[u8], values: &[u32]) -> R<u16> {
    let index = match handler_for(ole, class).await? {
        Found::Paintbrush => return paintbrush(ole, way, values).await,
        Found::None => return default(ole, way, values).await,
        Found::Index(index) => index,
    };
    let (count, procs) = {
        let state = ole.state();
        let handler = state.handlers[index]
            .as_ref()
            .map(|each| (each.count, each.procs));

        handler.unwrap_or((0, [0; 8]))
    };
    let mut proc = procs[way.index()];
    let mut shape = way.shape();
    let mut values = values;

    if way == Way::Invisible && proc == 0 {
        ole.state().invisible = Some(values[8] as u16 != 0);
        proc = procs[Way::Create.index()];
        shape = Way::Create.shape();
        values = &values[..8];
    }

    let args: Vec<GuestArg> = shape
        .iter()
        .zip(values)
        .map(|(kind, value)| match kind {
            b'w' => GuestArg::Word(*value as u16),
            _ => GuestArg::Long(*value),
        })
        .collect();
    let answer = ole.call_far(proc, &args).await? as u16;

    ole.state().invisible = None;

    if answer > 1 {
        if let Some(handler) = ole.state().handlers[index].as_mut() {
            handler.count = count - 1;
        }

        return Ok(answer);
    }

    let object = ole.r32(values[way.out_at()]);

    if object != 0 {
        ole.state().handler_of.insert(object, index);
    }

    Ok(answer)
}

/// An atom's name's bytes.
async fn atom_bytes(ole: &Ole<'_>, atom: u16) -> R<Vec<u8>> {
    let at = ole.near(PATH_AT);

    if atom == 0 || ole.atom_name(atom, at, PATH_SIZE as u16).await? == 0 {
        return Ok(Vec::new());
    }

    Ok(ole.string(at))
}

/// A template's class: the registration database's for its extension,
/// `.hnd` the class `OleHnd` (**measured** by `olehnd`); none, none.
pub(crate) async fn class_of_file(ole: &Ole<'_>, file: u32) -> R<Option<Vec<u8>>> {
    let name = ole.string(file);
    let dot = name.iter().rposition(|byte| *byte == b'.');
    let slash = name
        .iter()
        .rposition(|byte| *byte == b'\\' || *byte == b':');
    let Some(dot) = dot.filter(|dot| slash.is_none_or(|slash| *dot > slash)) else {
        return Ok(None);
    };
    let size = ole.near(PATH_SIZE_AT);
    let at = ole.near(PATH_AT);

    ole.w32(size, PATH_SIZE);

    let found = ole
        .call(
            "SHELL",
            "RegQueryValue",
            &[
                Arg::D(HKEY_CLASSES_ROOT),
                text(&name[dot..]),
                Arg::D(at),
                Arg::D(size),
            ],
        )
        .await?;

    Ok((found == 0 && ole.r8(at) != 0).then(|| ole.string(at)))
}

/// Each default (110-117): what the `Ole` function does once it has
/// checked its arguments. They do not look at the protocol (**measured**
/// by `olehnd`); the clipboard's two answer `OLE_ERROR_MEMORY` but inside
/// `OleCreateFromClip` or `OleCreateLinkFromClip`, whose clipboard they
/// read (**measured**; **read out**, seg3 `30c2`).
#[allow(clippy::too_many_lines)]
pub(crate) async fn default(ole: &Ole<'_>, way: Way, a: &[u32]) -> R<u16> {
    let arg = |at: usize| a.get(at).copied().unwrap_or(0);

    match way {
        Way::Load => {
            let class = atom_bytes(ole, arg(7) as u16).await?;

            if class.is_empty() {
                return Ok(OLE_ERROR_STREAM);
            }

            linked::load(
                ole,
                arg(0),
                arg(6),
                arg(2),
                arg(3),
                arg(4),
                arg(5),
                class,
                arg(7) as u16,
            )
            .await
        }
        Way::Clip | Way::LinkClip => {
            if !ole.state().clipping {
                return Ok(OLE_ERROR_MEMORY);
            }

            let linked = way == Way::LinkClip || arg(7) == OT_LINK;

            if way == Way::Clip && arg(7) != OT_EMBEDDED && arg(7) != OT_LINK {
                return Ok(OLE_ERROR_CLIPBOARD);
            }

            linked::from_clip(
                ole,
                arg(1),
                arg(2),
                arg(3),
                arg(4),
                linked,
                arg(5) as u16,
                arg(6) as u16,
            )
            .await
        }
        Way::Template => {
            let Some(class) = class_of_file(ole, arg(2)).await? else {
                return Ok(OLE_ERROR_CLASS);
            };

            linked::create(
                ole,
                arg(1),
                class,
                arg(3),
                arg(4),
                arg(5),
                true,
                arg(6) as u16,
                Some(ole.string(arg(2))),
            )
            .await
        }
        Way::Create => {
            let hidden = ole.state().invisible;

            linked::create(
                ole,
                arg(1),
                ole.string(arg(2)),
                arg(3),
                arg(4),
                arg(5),
                hidden.unwrap_or(true),
                arg(6) as u16,
                None,
            )
            .await
        }
        Way::File => {
            linked::create_from_file(
                ole,
                arg(1),
                arg(2),
                arg(3),
                0,
                arg(4),
                arg(5),
                arg(6),
                false,
                arg(7) as u16,
            )
            .await
        }
        Way::LinkFile => {
            linked::create_from_file(
                ole,
                arg(1),
                arg(2),
                arg(3),
                arg(4),
                arg(5),
                arg(6),
                arg(7),
                true,
                arg(8) as u16,
            )
            .await
        }
        Way::Invisible => {
            linked::create(
                ole,
                arg(1),
                ole.string(arg(2)),
                arg(3),
                arg(4),
                arg(5),
                arg(8) as u16 != 0,
                arg(6) as u16,
                None,
            )
            .await
        }
    }
}

/// `LECREATEINVISIBLE` (230): `DefCreateInvisible`'s default without its
/// protocol (**read out**: seg5 `02e0` passes all but the protocol to entry
/// 230).
pub(crate) async fn le_create_invisible(ole: &Ole<'_>, a: &[u32]) -> R<u16> {
    let mut values = vec![0];

    values.extend_from_slice(a);
    default(ole, Way::Invisible, &values).await
}

/// Paintbrush's handler of a way: no picture asked for where one was --
/// `olerender_draw` made `olerender_none`, or for a link
/// `olerender_format` of `Native` -- then the default, then Paintbrush's
/// table where the object has no picture (**read out**, seg7
/// `0000`-`0527`; **measured** by `olehnd`'s `pb` records).
pub(crate) async fn paintbrush(ole: &Ole<'_>, way: Way, a: &[u32]) -> R<u16> {
    let mut values = a.to_vec();
    let native = cf(ole, "Native");
    let linked = way == Way::LinkClip
        || way == Way::LinkFile
        || (way == Way::Clip && values.get(7) == Some(&OT_LINK));

    if way == Way::Load && values.get(6) == Some(&OT_LINK) {
        values[8] = u32::from(native);
    }

    if let Some(at) = way.render_at()
        && values[at] as u16 == OLERENDER_DRAW
    {
        let clipped = way == Way::Clip || way == Way::LinkClip;

        if !clipped
            || ole
                .user("IsClipboardFormatAvailable", &[Arg::W(native)])
                .await?
                != 0
        {
            values[at] = u32::from(if linked {
                OLERENDER_FORMAT
            } else {
                OLERENDER_NONE
            });
            values[at + 1] = if linked { u32::from(native) } else { 0 };
        }
    }

    let answer = Box::pin(default(ole, way, &values)).await?;

    if answer <= 1 {
        let object = ole.r32(values[way.out_at()]);

        if object != 0 {
            linked::pb_table(ole, object).await?;
        }
    }

    Ok(answer)
}

/// The `Def` and `Pb` exports by ordinal: each a way's, and whether
/// Paintbrush's.
pub(crate) const fn export_way(ordinal: u16) -> Option<(Way, bool)> {
    Some(match ordinal {
        110 => (Way::Load, false),
        111 => (Way::Clip, false),
        112 => (Way::LinkClip, false),
        113 => (Way::Template, false),
        114 => (Way::Create, false),
        115 => (Way::File, false),
        116 => (Way::LinkFile, false),
        117 => (Way::Invisible, false),
        800 => (Way::Load, true),
        801 => (Way::Clip, true),
        802 => (Way::LinkClip, true),
        803 => (Way::Template, true),
        804 => (Way::Create, true),
        808 => (Way::File, true),
        809 => (Way::LinkFile, true),
        812 => (Way::Invisible, true),
        _ => return None,
    })
}
