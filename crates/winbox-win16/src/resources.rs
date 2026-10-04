//! KERNEL's resources: found in a module's resource table, loaded into a
//! block of global memory, locked, freed, opened in its file and sized.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_machine::{handle_for, index_for};
use winbox_ne::{Resource, ResourceId};

use crate::call::{Answer, Args, Stop};
use crate::handles::Object;
use crate::memory;
use crate::system::System;

/// Where a module's resources' handles start.
const FIRST: u16 = 0x4000;

/// `HFILE_ERROR`, as the TypeScript engine answers it.
const HFILE_ERROR: u16 = 0xffff;

/// What a resource is asked for by: a number, or a name.
enum Wanted {
    Number(u16),
    Name(String),
}

fn wanted(system: &System, far: u32) -> Option<Wanted> {
    match (far >> 16, far & 0xffff) {
        (0, 0) => None,
        (0, number) => Some(Wanted::Number(number as u16)),
        _ => Some(Wanted::Name(
            system
                .read_string(far)
                .iter()
                .map(|&byte| char::from(byte))
                .collect(),
        )),
    }
}

/// An identity as text, as the TypeScript engine's `String` makes it.
fn text_of(id: &ResourceId) -> String {
    match id {
        ResourceId::Number(number) => number.to_string(),
        ResourceId::Name(name) => name.clone(),
    }
}

/// Whether a type or a resource is the one asked for: a number by its
/// number; a name, without regard to case, by its name or its identity.
fn matches(id: &ResourceId, name: Option<&String>, wanted: &Wanted) -> bool {
    match wanted {
        Wanted::Number(number) => *id == ResourceId::Number(*number),
        Wanted::Name(text) => {
            let shown = name.cloned().unwrap_or_else(|| text_of(id));

            shown.eq_ignore_ascii_case(text) || text_of(id).eq_ignore_ascii_case(text)
        }
    }
}

/// A loaded resource: its block's handle, and its uses.
#[derive(Debug, Clone, Copy)]
pub struct Loaded {
    pub handle: u16,
    pub uses: u32,
}

impl System {
    /// The module whose resources an instance names: the task's program or
    /// a library.
    fn resources_of(&self, instance: u16) -> Option<usize> {
        match self.handles.resolve(instance)? {
            Object::Task => self.task.as_ref().map(|task| task.program),
            Object::Library(module) => Some(module),
            _ => None,
        }
    }

    /// A resource's handle: each of a module's made at once, at its place in
    /// the resource table from a base where every one is free.
    fn resource_handle(&mut self, module: usize, kind: usize, entry: usize) -> u16 {
        if !self.resource_bases.contains_key(&module) {
            let mut places = Vec::new();
            let mut at = 2u16;

            for (type_index, kind) in self.modules[module].executable.resources.iter().enumerate() {
                at += 8;

                for entry_index in 0..kind.entries.len() {
                    places.push((type_index, entry_index, at));
                    at += 12;
                }
            }

            let mut base = FIRST;

            while places
                .iter()
                .any(|&(_, _, offset)| self.handles.resolve(base + offset).is_some())
            {
                base += 0x10;
            }

            for &(type_index, entry_index, offset) in &places {
                self.handles.alias_at(
                    base + offset,
                    Object::Resource(module, type_index, entry_index),
                );
            }

            self.resource_bases.insert(module, base);
        }

        self.resource_place(module, kind, entry)
    }

    fn resource_place(&self, module: usize, kind: usize, entry: usize) -> u16 {
        let mut at = 2u16;

        for (type_index, resource_type) in
            self.modules[module].executable.resources.iter().enumerate()
        {
            at += 8;

            for entry_index in 0..resource_type.entries.len() {
                if (type_index, entry_index) == (kind, entry) {
                    return self.resource_bases[&module] + at;
                }

                at += 12;
            }
        }

        0
    }

    /// The resource a handle names, and its module.
    fn resource(&self, handle: u16) -> Option<(usize, &Resource)> {
        let Object::Resource(module, kind, entry) = self.handles.resolve(handle)? else {
            return None;
        };

        Some((
            module,
            &self.modules[module].executable.resources[kind].entries[entry],
        ))
    }
}

/// A resource by its name or number and its type's: its handle, nought for
/// none.
pub fn find_resource(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let name = wanted(system, args.dword(system));
    let kind = wanted(system, args.dword(system));
    let (Some(module), Some(name), Some(kind)) = (system.resources_of(instance), name, kind) else {
        return Ok(Answer::Word(0));
    };
    let found = system.modules[module]
        .executable
        .resources
        .iter()
        .enumerate()
        .filter(|(_, resource_type)| matches(&resource_type.id, resource_type.name.as_ref(), &kind))
        .find_map(|(type_index, resource_type)| {
            resource_type
                .entries
                .iter()
                .position(|entry| matches(&entry.id, entry.name.as_ref(), &name))
                .map(|entry_index| (type_index, entry_index))
        });

    Ok(Answer::Word(found.map_or(0, |(kind, entry)| {
        system.resource_handle(module, kind, entry)
    })))
}

/// A resource loaded into a block of its own: its block's handle. Loaded
/// again, the same handle, its uses counted.
pub fn load_resource(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _instance = args.word(system);
    let handle = args.word(system);
    let Some((module, resource)) = system.resource(handle) else {
        return Ok(Answer::Word(0));
    };
    let bytes = system.modules[module]
        .executable
        .resource_bytes(resource)
        .to_vec();
    let loaded = system.loaded_resources.get(&handle).copied();

    if let Some(loaded) = loaded
        && loaded.uses > 0
    {
        system.loaded_resources.insert(
            handle,
            Loaded {
                uses: loaded.uses + 1,
                ..loaded
            },
        );
        return Ok(Answer::Word(loaded.handle));
    }

    let block = if let Some(loaded) = loaded {
        loaded.handle
    } else {
        let Some(index) = system.global.allocate(
            &mut system.cpu.bus,
            &mut system.descriptors,
            bytes.len() as u32,
            0,
        ) else {
            return Ok(Answer::Word(0));
        };

        handle_for(index)
    };

    system
        .cpu
        .bus
        .write((index_for(block) as u32) << 16, &bytes);
    system.loaded_resources.insert(
        handle,
        Loaded {
            handle: block,
            uses: 1,
        },
    );
    system.resource_blocks.insert(block, handle);
    Ok(Answer::Word(block))
}

/// A resource's block locked, as `GlobalLock` locks one.
pub fn lock_resource(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    memory::global_lock(system, args)
}

/// A resource's use counted down: nought when none are left, else its
/// handle. A block not a resource's is freed as `GlobalFree` frees one.
pub fn free_resource(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let block = args.word(system);

    if let Some(&resource) = system.resource_blocks.get(&block)
        && let Some(loaded) = system.loaded_resources.get_mut(&resource)
    {
        loaded.uses = loaded.uses.saturating_sub(1);
        return Ok(Answer::Word(if loaded.uses > 0 { block } else { 0 }));
    }

    let mut again = Args::repeat(block);
    let freed = memory::global_free(system, &mut again)?;

    // The TypeScript engine answers whether `GlobalFree` answered other
    // than nought.
    Ok(Answer::Word(u16::from(freed != Answer::Word(0))))
}

/// A resource's file opened at the resource: its handle, or `HFILE_ERROR`.
pub fn access_resource(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _instance = args.word(system);
    let handle = args.word(system);
    let Some((module, resource)) = system.resource(handle) else {
        return Ok(Answer::Word(HFILE_ERROR));
    };
    let offset = resource.offset;
    let path = system.modules[module].path.clone();
    let Some(file) = system.files.open(&path) else {
        return Ok(Answer::Word(HFILE_ERROR));
    };

    system
        .files
        .resolve(file)
        .expect("an open file")
        .seek(std::io::SeekFrom::Start(u64::from(offset)));
    Ok(Answer::Word(file as u16))
}

pub fn sizeof_resource(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _instance = args.word(system);
    let handle = args.word(system);

    Ok(Answer::Dword(
        system
            .resource(handle)
            .map_or(0, |(_, resource)| resource.length),
    ))
}

/// A resource of a type by a name as USER takes one, as `findResource`
/// finds it: a number; `#` and digits, a number; else a name, compared
/// without regard to case with the resource's name or its number as text.
/// Its bytes.
pub fn find_by<'a>(
    executable: &'a winbox_ne::Executable,
    kind: u16,
    name: &crate::menus::MenuName,
) -> Option<&'a [u8]> {
    use crate::menus::MenuName;

    let (id, text) = match name {
        MenuName::Number(number) => (Some(*number), None),
        MenuName::Text(text) => match text
            .strip_prefix('#')
            .and_then(|digits| digits.parse().ok())
        {
            Some(number) => (Some(number), None),
            None => (None, Some(text.to_ascii_uppercase())),
        },
    };
    let resource = executable
        .resources
        .iter()
        .filter(|resource_type| resource_type.id == ResourceId::Number(kind))
        .flat_map(|resource_type| &resource_type.entries)
        .find(|resource| {
            id.is_some_and(|id| resource.id == ResourceId::Number(id))
                || text.as_ref().is_some_and(|text| {
                    resource.name.as_deref().unwrap_or("").to_ascii_uppercase() == *text
                        || text_of(&resource.id).to_ascii_uppercase() == *text
                })
        })?;

    Some(executable.resource_bytes(resource))
}
