//! MCI's command tables: `mciLoadCommandResource` and
//! `mciFreeCommandResource`, and the tables MMSYSTEM loads itself.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg5 `2c30`-`307e`, `2f4c`,
//! `20dd`-`210b`, `2926`-`29cd`, `3095`); **recorded** by `mmcmd`:
//!
//! * A table is an `RCDATA` resource: commands, each a head (type 0), its
//!   keywords, and an end (3), the list ended by type 6; each entry a
//!   string, a doubleword and a word. Loading one counts its heads: with
//!   none, or no such resource, the answer is `FFFFh`.
//! * The resource is looked for first in a library named for it -- its
//!   name's first eight characters and `.mci`, if `OpenFile` finds such a
//!   file -- and then in the module given.
//! * Tables are numbered in a list of twenty: the first free place below
//!   the end, else the end. The first table ever loaded is MMSYSTEM's own
//!   `core`, loaded first whatever was asked for: it is table nought.
//! * Freeing nought, or a number at or past the end, answers nought; so does
//!   freeing a table an open device uses. Else the resource is let go -- the
//!   place is free whether it was used or not, so a table freed twice
//!   answers 1 twice -- and the end drawn in by one if it was the last.
//! * A device opened gets its type's table: the first with the device's
//!   type among them, else MMSYSTEM's resource named as its type is
//!   (`waveaudio` for 20Ah). Closing it frees that table before its driver
//!   is closed. `MCIWAVE` loads its own as it is loaded and frees it as it
//!   is freed; it is the device's custom table.
//!
//! WinBox's own modules have no resources: MMSYSTEM's tables and MCIWAVE's
//! are known by their names, as their files have them -- `CORE`,
//! `VIDEODISC`, `WAVEAUDIO`, `CDAUDIO`, `SEQUENCER`, `ANIMATION` and
//! `OVERLAY`; `MCIWAVE` -- each with commands. Their contents are not kept:
//! `mciSendString` reads no table here. Not followed: the core table
//! `mciSendString` loads as it first looks a command up, if no table was
//! ever loaded (seg5 `3095`).

use std::future::Future;
use std::pin::Pin;

use crate::call::{Answer, Args, Later, Stop, call_named};
use crate::drivers::lpcstr;
use crate::engine::{Engine, GuestArg};
use crate::handles::Object;
use crate::system::System;

use super::strings;

const TABLES_MOST: usize = 20;
const RT_RCDATA: u32 = 10;
const OF_EXIST: u16 = 0x4000;

/// The tables WinBox's own modules have, by module.
const OWN_TABLES: &[(&str, &[&str])] = &[
    (
        "MMSYSTEM",
        &[
            "CORE",
            "VIDEODISC",
            "WAVEAUDIO",
            "CDAUDIO",
            "SEQUENCER",
            "ANIMATION",
            "OVERLAY",
        ],
    ),
    ("MCIWAVE", &["MCIWAVE"]),
];

/// One place of the list.
#[derive(Debug, Clone, Copy, Default)]
struct Table {
    /// The resource's memory, nought for a free place; 1 for a table of
    /// WinBox's own.
    resource: u16,
    /// A table's library, `.mci`, kept even once freed, as MMSYSTEM keeps
    /// it.
    library: u16,
    /// The device type it is for, or nought.
    kind: u16,
}

/// MCI's command tables.
#[derive(Debug, Default)]
pub struct Tables {
    tables: Vec<Table>,
    core: bool,
}

/// Where a table comes from.
#[derive(Debug, Clone, Copy)]
pub enum Source {
    /// One of WinBox's own modules, by name.
    Own(&'static str),
    /// A module's handle.
    Handle(u16),
}

/// A table's name: a string, or a resource's number.
#[derive(Debug, Clone)]
pub enum Name {
    Text(Vec<u8>),
    Number(u16),
}

/// A module's handle as a source: one of WinBox's own named, if it is.
pub fn source_of(system: &System, handle: u16) -> Source {
    match system.handles.resolve_module(handle) {
        Some(Object::Kept(kept)) => Source::Own(system.kept[kept].module.name),
        _ => Source::Handle(handle),
    }
}

/// The heads in a table's bytes: its commands.
fn commands(read: impl Fn(u32) -> u8) -> u32 {
    let mut count = 0;
    let mut at = 0u32;

    loop {
        while read(at) != 0 {
            at += 1;
        }

        let kind = u16::from(read(at + 5)) | u16::from(read(at + 6)) << 8;

        at += 7;

        match kind {
            0 => count += 1,
            6 => return count,
            _ => {}
        }
    }
}

fn name_arg(name: &Name) -> GuestArg {
    match name {
        Name::Text(text) => GuestArg::Struct([&text[..], &[0]].concat()),
        Name::Number(number) => GuestArg::Long(u32::from(*number)),
    }
}

async fn kernel(engine: &Engine, name: &'static str, args: &[GuestArg]) -> Result<u32, Stop> {
    let (answer, _) = Box::pin(call_named(engine, "KERNEL", name, args)).await?;

    Ok(answer.value().unwrap_or(0))
}

/// What a table was found as: one of WinBox's own, or a module's resource.
enum Found {
    Own,
    Resource { module: u16, found: u16 },
}

/// A table found in a module.
async fn find(engine: &Engine, source: Source, name: &Name) -> Result<Option<Found>, Stop> {
    match source {
        Source::Own(module) => {
            let Name::Text(text) = name else {
                return Ok(None);
            };
            let names = OWN_TABLES
                .iter()
                .find(|(own, _)| own.eq_ignore_ascii_case(module))
                .map_or(&[][..], |(_, names)| *names);

            Ok(names
                .iter()
                .any(|each| each.as_bytes().eq_ignore_ascii_case(text))
                .then_some(Found::Own))
        }
        Source::Handle(module) => {
            let args = [
                GuestArg::Word(module),
                name_arg(name),
                GuestArg::Long(RT_RCDATA),
            ];
            let found = kernel(engine, "FindResource", &args).await? as u16;

            Ok((found != 0).then_some(Found::Resource { module, found }))
        }
    }
}

/// A table loaded and numbered (seg5 `2d4c`): its number, or `FFFFh`.
pub fn load_table<'a>(
    engine: &'a Engine,
    source: Source,
    name: Name,
    kind: u16,
) -> Pin<Box<dyn Future<Output = Result<u16, Stop>> + 'a>> {
    Box::pin(async move {
        let first = !std::mem::replace(&mut engine.system().mmsystem.mci_tables.core, true);

        if first && !matches!(&name, Name::Text(text) if text.eq_ignore_ascii_case(b"core")) {
            load_table(
                engine,
                Source::Own("MMSYSTEM"),
                Name::Text(b"core".to_vec()),
                0,
            )
            .await?;
        }

        let mut library = 0;
        let mut found = None;

        if let Name::Text(text) = &name {
            let mut file = text[..text.len().min(8)].to_vec();

            file.extend_from_slice(b".mci");

            let args = [
                GuestArg::Struct([&file[..], &[0]].concat()),
                GuestArg::Struct(vec![0; 0x88]),
                GuestArg::Word(OF_EXIST),
            ];

            if kernel(engine, "OpenFile", &args).await? as u16 != 0xffff {
                let args = [GuestArg::Struct([&file[..], &[0]].concat())];

                library = kernel(engine, "LoadLibrary", &args).await? as u16;

                if library < 0x20 {
                    library = 0;
                }

                if library != 0 {
                    found = find(engine, Source::Handle(library), &name).await?;
                }
            }
        }

        if found.is_none() {
            found = find(engine, source, &name).await?;
        }

        let Some(found) = found else {
            return Ok(0xffff);
        };
        let resource = match found {
            Found::Own => 1,
            Found::Resource { module, found } => {
                let args = [GuestArg::Word(module), GuestArg::Word(found)];
                let resource = kernel(engine, "LoadResource", &args).await? as u16;

                if resource == 0 {
                    return Ok(0xffff);
                }

                let far = kernel(engine, "LockResource", &[GuestArg::Word(resource)]).await?;

                if far == 0 {
                    kernel(engine, "FreeResource", &[GuestArg::Word(resource)]).await?;
                    return Ok(0xffff);
                }

                let count = {
                    let system = engine.system();

                    commands(|at| {
                        system.read_far((far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff), 1)[0]
                    })
                };

                kernel(engine, "GlobalUnlock", &[GuestArg::Word(resource)]).await?;

                if count == 0 {
                    kernel(engine, "FreeResource", &[GuestArg::Word(resource)]).await?;
                    return Ok(0xffff);
                }

                resource
            }
        };

        Ok(register(
            &mut engine.system().mmsystem.mci_tables,
            Table {
                resource,
                library,
                kind,
            },
        ))
    })
}

/// A table put in the first free place below the end, else at the end
/// (seg5 `2cee`).
fn register(state: &mut Tables, table: Table) -> u16 {
    if let Some(free) = state.tables.iter().position(|one| one.resource == 0) {
        state.tables[free] = table;
        return free as u16;
    }

    if state.tables.len() == TABLES_MOST {
        return 0xffff;
    }

    state.tables.push(table);
    (state.tables.len() - 1) as u16
}

/// A table let go (seg5 `2fb9`): nought for nought, one past the end, or
/// one a device uses.
pub async fn free_table(engine: &Engine, number: u16) -> Result<u16, Stop> {
    let freed = {
        let mut system = engine.system();
        let used = super::mci::table_in_use(&system, number);
        let state = &mut system.mmsystem.mci_tables;

        if number == 0 || usize::from(number) >= state.tables.len() || used {
            return Ok(0);
        }

        let table = state.tables[usize::from(number)];

        state.tables[usize::from(number)] = Table {
            resource: 0,
            library: table.library,
            kind: 0,
        };

        if usize::from(number) == state.tables.len() - 1 {
            state.tables.pop();
        }

        table
    };

    if freed.resource > 1 {
        kernel(engine, "FreeResource", &[GuestArg::Word(freed.resource)]).await?;
    }

    if freed.library != 0 {
        kernel(engine, "FreeLibrary", &[GuestArg::Word(freed.library)]).await?;
    }

    Ok(1)
}

/// A device type's table (seg5 `2f4c`): the first table with the type,
/// else MMSYSTEM's resource named as its type is, for the types MMSYSTEM
/// names; else `FFFFh`.
pub async fn type_table(engine: &Engine, kind: u16) -> Result<u16, Stop> {
    let found = engine
        .system()
        .mmsystem
        .mci_tables
        .tables
        .iter()
        .position(|table| table.kind == kind);

    if let Some(found) = found {
        return Ok(found as u16);
    }

    if !(0x201..=0x20b).contains(&kind) {
        return Ok(0xffff);
    }

    let name = strings::string(kind).unwrap_or_default();
    let name = name[..name.len().min(0x4f)].to_vec();

    if name.is_empty() {
        return Ok(0xffff);
    }

    load_table(engine, Source::Own("MMSYSTEM"), Name::Text(name), kind).await
}

/// `mciLoadCommandResource`: a table loaded from a module, its number.
pub fn mci_load_command_resource(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (source, name, kind) = {
            let system = engine.system();
            let instance = args.word(&system);
            let far = args.dword(&system);
            let kind = args.word(&system);
            let name = if far >> 16 == 0 {
                Name::Number(far as u16)
            } else {
                Name::Text(lpcstr(&system, far).unwrap_or_default())
            };

            (source_of(&system, instance), name, kind)
        };

        Ok(Answer::Word(load_table(engine, source, name, kind).await?))
    })
}

/// `mciFreeCommandResource`: whether the table was let go.
pub fn mci_free_command_resource(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let number = args.word(&engine.system());

        Ok(Answer::Word(free_table(engine, number).await?))
    })
}
