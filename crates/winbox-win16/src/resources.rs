//! KERNEL's resources: found in a module's resource table, loaded into a
//! block of global memory, locked, freed, opened in its file and sized.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use std::rc::Rc;
use winbox_machine::{handle_for, index_for};

use winbox_ne::{Executable, Resource, ResourceId};

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::handles::{Object, Owner};
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
        _ => Some(named(
            system
                .read_string(far)
                .iter()
                .map(|&byte| char::from(byte))
                .collect(),
        )),
    }
}

/// A name asked for, as KERNEL reads one: `#` and digits is the number
/// they make, to the first that is not a digit, in a word (`KRNL386.EXE`
/// seg3 `0ac0`-`0af6`); one that makes nought, or any other, a name.
/// Lode Runner's setup asks `SETUPL.DLL`'s bitmap `#164` so.
fn named(text: String) -> Wanted {
    let number = text.strip_prefix('#').map_or(0, |digits| {
        digits
            .bytes()
            .take_while(u8::is_ascii_digit)
            .fold(0u16, |number, digit| {
                number
                    .wrapping_mul(10)
                    .wrapping_add(u16::from(digit - b'0'))
            })
    });

    if number == 0 {
        Wanted::Name(text)
    } else {
        Wanted::Number(number)
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

/// A loaded resource: its block's handle, and its uses; whether a handler
/// a program set has been called for it (its resource table entry's flag
/// 4, `KRNL386.EXE` seg1 `8a03`, `87f1`), and the module it was loaded for.
#[derive(Debug, Clone, Copy)]
pub struct Loaded {
    pub handle: u16,
    pub uses: u32,
    pub called: bool,
    pub module: u16,
}

impl System {
    /// Whose resources an instance names: the task's program, a library,
    /// or a module winbox.js keeps, whose resources are its file's on the
    /// installation -- the display driver's, which Control Panel's Color
    /// finds its "Windows Default" scheme in (`MAIN.CPL` seg6 `2922`).
    fn resources_of(&mut self, instance: u16) -> Option<Owner> {
        match self.handles.resolve_module(instance)? {
            // WinBox's Program Manager, made in memory with no resources:
            // `PROGMAN.EXE`'s, as the asset bundle's store has them, where
            // it keeps its module (`progman`; `kb/topics/asset-bundle.md`).
            Object::Task(program) if let Some(kept) = self.progman_kept(program) => {
                self.kept_file(kept).map(|_| Owner::Kept(kept))
            }
            Object::Task(program) => Some(Owner::Module(program)),
            Object::Library(module) => Some(Owner::Module(module)),
            Object::Kept(kept) => self.kept_file(kept).map(|_| Owner::Kept(kept)),
            _ => None,
        }
    }

    /// WinBox's Program Manager's kept module, where a program's module is
    /// the one made in memory for it: given the kept module's handle as its
    /// instance runs (`progman::start_progman`).
    pub(crate) fn progman_kept(&self, program: usize) -> Option<usize> {
        let kept = self.kept_named(crate::progman::NAME)?;
        let handle = self.kept[kept].handle();

        (handle != 0 && self.modules.get(program)?.handle == handle).then_some(kept)
    }

    /// The file an owner's resources are in.
    fn resource_file(&mut self, owner: Owner) -> Option<Rc<Executable>> {
        match owner {
            Owner::Module(module) => Some(self.modules[module].executable.clone()),
            Owner::Kept(kept) => self.kept_file(kept),
        }
    }

    /// A resource's handle: each of a module's made at once, at its place in
    /// the resource table from a base where every one is free.
    fn resource_handle(&mut self, owner: Owner, kind: usize, entry: usize) -> u16 {
        let Some(executable) = self.resource_file(owner) else {
            return 0;
        };
        let mut places = Vec::new();
        let mut at = 2u16;

        for (type_index, resource_type) in executable.resources.iter().enumerate() {
            at += 8;

            for entry_index in 0..resource_type.entries.len() {
                places.push((type_index, entry_index, at));
                at += 12;
            }
        }

        if !self.resource_bases.contains_key(&owner) {
            let mut base = FIRST;

            while places
                .iter()
                .any(|&(_, _, offset)| self.handles.resolve(base.wrapping_add(offset)).is_some())
            {
                base = base.wrapping_add(0x10);
            }

            for &(type_index, entry_index, offset) in &places {
                self.handles.alias_at(
                    base.wrapping_add(offset),
                    Object::Resource(owner, type_index, entry_index),
                );
            }

            self.resource_bases.insert(owner, base);
        }

        places
            .iter()
            .find(|&&(type_index, entry_index, _)| (type_index, entry_index) == (kind, entry))
            .map_or(0, |&(_, _, offset)| {
                self.resource_bases[&owner].wrapping_add(offset)
            })
    }

    /// A resource's size in bytes, as its table gives it.
    pub(crate) fn resource_size(&mut self, handle: u16) -> u32 {
        self.resource(handle)
            .map_or(0, |(_, _, resource)| resource.length)
    }

    /// The Windows version of the file an instance's resources are in.
    pub(crate) fn resource_version(&mut self, instance: u16) -> Option<u16> {
        let owner = self.resources_of(instance)?;

        Some(self.resource_file(owner)?.header.expected_windows_version)
    }

    /// The resource a handle names: its owner, its file, and it.
    fn resource(&mut self, handle: u16) -> Option<(Owner, Rc<Executable>, Resource)> {
        let Object::Resource(owner, kind, entry) = self.handles.resolve(handle)? else {
            return None;
        };
        let executable = self.resource_file(owner)?;
        let resource = executable.resources[kind].entries[entry].clone();

        Some((owner, executable, resource))
    }
}

/// A resource by its name or number and its type's: its handle, nought for
/// none.
pub fn find_resource(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let name = wanted(system, args.dword(system));
    let kind = wanted(system, args.dword(system));
    let (Some(name), Some(kind)) = (name, kind) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(find_in(system, instance, &name, &kind)))
}

/// A resource of an instance's module by a name and a type: its handle,
/// nought for none, as `FindResource` answers it.
fn find_in(system: &mut System, instance: u16, name: &Wanted, kind: &Wanted) -> u16 {
    let Some(owner) = system.resources_of(instance) else {
        return 0;
    };
    let Some(executable) = system.resource_file(owner) else {
        return 0;
    };
    let found = executable
        .resources
        .iter()
        .enumerate()
        .filter(|(_, resource_type)| matches(&resource_type.id, resource_type.name.as_ref(), kind))
        .find_map(|(type_index, resource_type)| {
            resource_type
                .entries
                .iter()
                .position(|entry| matches(&entry.id, entry.name.as_ref(), name))
                .map(|entry_index| (type_index, entry_index))
        });

    found.map_or(0, |(kind, entry)| {
        system.resource_handle(owner, kind, entry)
    })
}

/// A resource of an instance's module by its number or its name, of a
/// numbered type: its handle, as `FindResource` answers it (`USER.EXE`'s
/// `LoadIcon` and `LoadCursor`; `icon_handlers.rs`).
pub(crate) fn find_typed(
    system: &mut System,
    instance: u16,
    name: &Result<u16, String>,
    kind: u16,
) -> u16 {
    let name = match name {
        Ok(number) => Wanted::Number(*number),
        Err(text) => named(text.clone()),
    };

    find_in(system, instance, &name, &Wanted::Number(kind))
}

/// A resource loaded into a block of its own: its block's handle. Loaded
/// again, the same handle, its uses counted. Through a handler a program
/// set for its type, as `resource-handlers.ts`'s `loadThroughHandler`.
pub fn load_resource(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (instance, handle) = {
            let system = engine.system();

            (args.word(&system), args.word(&system))
        };

        Ok(Answer::Word(load(engine, instance, handle).await?))
    })
}

/// `LoadResource`'s work: the resource's block, or nought.
pub(crate) async fn load(engine: &Engine, instance: u16, handle: u16) -> Result<u16, Stop> {
    if let Some(answer) = load_through_handler(engine, instance, handle).await? {
        return Ok(answer);
    }

    match load_resource_here(&mut engine.system(), handle)? {
        Answer::Word(block) => Ok(block),
        _ => Ok(0),
    }
}

fn load_resource_here(system: &mut System, handle: u16) -> Result<Answer, Stop> {
    let Some((_, executable, resource)) = system.resource(handle) else {
        return Ok(Answer::Word(0));
    };
    let bytes = executable.resource_bytes(&resource).to_vec();
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
            called: false,
            module: 0,
        },
    );
    system.resource_blocks.insert(block, handle);
    Ok(Answer::Word(block))
}

/// A resource's block locked, as `GlobalLock` locks one: KERNEL's own
/// counts it as a program's lock is (`KRNL386.EXE` seg1 `8768`); a
/// discarded resource's block loaded by its type's handler, as
/// `resource-handlers.ts`'s `lockThroughHandler`.
pub fn lock_resource(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let block = args.word(&engine.system());

        Ok(Answer::Dword(lock_block(engine, block).await?))
    })
}

/// `LockResource`'s work: the block's address, its handler called for a
/// discarded resource's; nought for none.
pub(crate) async fn lock_block(engine: &Engine, block: u16) -> Result<u32, Stop> {
    let far = lock(&mut engine.system(), block);

    if far != 0 {
        return Ok(far);
    }

    let (handler, loaded, resource) = {
        let mut system = engine.system();
        let Some(&resource) = system.resource_blocks.get(&block) else {
            return Ok(0);
        };
        let Some(handler) = system.program_handler(resource) else {
            return Ok(0);
        };
        let Some(&loaded) = system.loaded_resources.get(&resource) else {
            return Ok(0);
        };

        (handler, loaded, resource)
    };
    let answer = call_handler(engine, handler, block, loaded.module, resource).await?;

    if answer == 0 {
        return Ok(0);
    }

    let mut system = engine.system();

    if let Some(loaded) = system.loaded_resources.get_mut(&resource) {
        loaded.called = true;
    }

    Ok(lock(&mut system, answer))
}

/// `GlobalLock`'s answer for a block.
fn lock(system: &mut System, block: u16) -> u32 {
    match memory::global_lock(system, &mut Args::repeat(block)) {
        Ok(Answer::Dword(far)) => far,
        _ => 0,
    }
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
    let Some((owner, _, resource)) = system.resource(handle) else {
        return Ok(Answer::Word(HFILE_ERROR));
    };
    let offset = resource.offset;
    let path = match owner {
        Owner::Module(module) => system.modules[module].path.clone(),
        Owner::Kept(kept) => system.kept_path(kept),
    };
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

/// The size of a resource, as its module's resource table gives it.
pub fn sizeof_resource(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _instance = args.word(system);
    let handle = args.word(system);

    Ok(Answer::Dword(
        system
            .resource(handle)
            .map_or(0, |(_, _, resource)| resource.length),
    ))
}

/// A resource of a type by a name as USER takes one, as `findResource`
/// finds it: a number; `#` and digits, a number; else a name, compared
/// without regard to case with the resource's name or its number as text.
/// Its bytes.
pub fn find_by<'a>(
    executable: &'a Executable,
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

/// KERNEL's own handler's ordinal: its stub is at 8 times one more, 88C8h,
/// where KERNEL's own is in its code (seg2 `27de`-`27e4`).
pub const DEFAULT_ORDINAL: u16 = 0x88c8 / 8 - 1;

const GMEM_MOVEABLE: u16 = 0x0002;
const GMEM_DISCARDABLE: u16 = 0x0100;
const GMEM_SHARE: u16 = 0x2000;

/// A resource's flag: discardable.
const DISCARDABLE: u16 = 0x1000;

impl System {
    /// KERNEL's own handler's far address: its stub.
    fn default_handler(&mut self) -> u32 {
        let Some(kept) = self.kept_named("KERNEL") else {
            return 0;
        };
        let stubs = self.stubs(kept);

        u32::from(winbox_machine::segment_selector(stubs)) << 16
            | u32::from(crate::system::STEP * (DEFAULT_ORDINAL + 1))
    }

    /// The handler a program -- or USER -- set for a resource's type, or
    /// `None` for KERNEL's own.
    fn program_handler(&mut self, resource: u16) -> Option<u32> {
        let Some(Object::Resource(owner, kind, _)) = self.handles.resolve(resource) else {
            return None;
        };

        self.seed_user_handlers(owner);
        self.kernel_calls
            .resource_handlers
            .get(&(owner, kind))
            .copied()
            .filter(|&handler| handler != self.kernel_calls.default_resource_handler)
    }

    /// A module's handlers for its icons and cursors: USER's from the
    /// first, as `SignalProc` sets them as KERNEL loads the module
    /// (`USER.EXE` seg1 `0a00`; `icon_handlers.rs`), by the version its
    /// header gives, set the first time its handlers are asked for.
    /// **Recorded** by `userproc` and `iconhand`.
    fn seed_user_handlers(&mut self, owner: Owner) {
        if !self.kernel_calls.user_handlers_set.insert(owner) {
            return;
        }

        let Some(executable) = self.resource_file(owner) else {
            return;
        };
        let version = executable.header.expected_windows_version;

        for (id, address) in crate::icon_handlers::user_handlers(self, version) {
            let index = executable
                .resources
                .iter()
                .position(|resource_type| resource_type.id == ResourceId::Number(id));

            if let Some(index) = index
                && address != 0
            {
                self.kernel_calls
                    .resource_handlers
                    .insert((owner, index), address);
            }
        }
    }

    /// The handler a type of a resource's module has: USER's, a
    /// program's, or KERNEL's own.
    pub(crate) fn type_handler(&mut self, resource: u16) -> u32 {
        match self.program_handler(resource) {
            Some(handler) => handler,
            None => self.default_handler(),
        }
    }

    /// The resource table's alignment shift: its first word.
    fn resource_shift(executable: &Executable) -> u32 {
        let at = executable.header_offset as usize
            + usize::from(executable.header.resource_table_offset);
        let bytes = executable.bytes();

        bytes
            .get(at..at + 2)
            .map_or(0, |word| u32::from(u16::from_le_bytes([word[0], word[1]])))
    }

    /// A block for a resource: moveable, discardable as it is, the size given
    /// or its own, in its table's units.
    fn alloc_for(&mut self, executable: &Executable, resource: &Resource, size: u32) -> u16 {
        let unit = 1u32 << Self::resource_shift(executable);
        let units = if size == 0 {
            resource.length.div_ceil(unit)
        } else {
            size.div_ceil(unit)
        };
        let flags = GMEM_MOVEABLE
            | GMEM_SHARE
            | if resource.flags & DISCARDABLE != 0 {
                GMEM_DISCARDABLE
            } else {
                0
            };

        self.allocate_owned(units * unit, flags)
    }

    /// A block of the running task's, its flags as given.
    fn allocate_owned(&mut self, size: u32, flags: u16) -> u16 {
        let Some(index) =
            self.global
                .allocate(&mut self.cpu.bus, &mut self.descriptors, size, flags)
        else {
            return 0;
        };
        let task = self.current_task().unwrap_or(0);

        self.block_owners.insert(index, task);
        handle_for(index)
    }
}

/// A handler called as KERNEL calls one (seg1 `89dc`-`89fb`, `87c5`-`87e0`).
async fn call_handler(
    engine: &Engine,
    handler: u32,
    block: u16,
    module: u16,
    resource: u16,
) -> Result<u16, Stop> {
    // USER's own are WinBox's code, called directly (`icon_handlers.rs`).
    if let Some(answer) = crate::icon_handlers::call_user_handler(
        &mut engine.system(),
        handler,
        block,
        module,
        resource,
    ) {
        return Ok(answer);
    }

    let ss = engine.system().cpu.segments[winbox_cpu::SS].selector;
    let (answer, _) = engine
        .call_with(
            handler,
            &[
                GuestArg::Word(block),
                GuestArg::Word(module),
                GuestArg::Word(resource),
            ],
            &[
                Register::Word(winbox_cpu::AX, ss),
                Register::Segment(winbox_cpu::DS, ss),
                Register::Segment(winbox_cpu::ES, ss),
            ],
        )
        .await?;

    Ok(answer as u16)
}

/// `LoadResource` through a handler a program set (seg1 `8957`-`8a07`), as
/// `resource-handlers.ts`'s: `None` where none is set for its type.
async fn load_through_handler(
    engine: &Engine,
    instance: u16,
    resource: u16,
) -> Result<Option<u16>, Stop> {
    let (handler, loaded, module, discardable) = {
        let mut system = engine.system();
        let Some(handler) = system.program_handler(resource) else {
            return Ok(None);
        };
        let Some((_, _, entry)) = system.resource(resource) else {
            return Ok(None);
        };
        let loaded = system.loaded_resources.get(&resource).copied();

        if let Some(loaded) = loaded
            && loaded.uses > 0
        {
            return Ok(None);
        }

        let module = crate::kernel_calls::tasks::exe_ptr(&mut system, instance);

        (handler, loaded, module, entry.flags & DISCARDABLE != 0)
    };

    if let Some(loaded) = loaded {
        let mut system = engine.system();

        if loaded.called && !system.global.is_discarded(index_for(loaded.handle)) {
            system.loaded_resources.insert(
                resource,
                Loaded {
                    uses: loaded.uses + 1,
                    ..loaded
                },
            );
            return Ok(Some(loaded.handle));
        }
    } else if discardable {
        let mut system = engine.system();
        let handle = system.allocate_owned(0, GMEM_MOVEABLE | GMEM_SHARE | GMEM_DISCARDABLE);

        if handle == 0 {
            return Ok(Some(0));
        }

        system.global.discard(index_for(handle));
        system.loaded_resources.insert(
            resource,
            Loaded {
                handle,
                uses: 1,
                called: false,
                module,
            },
        );
        system.resource_blocks.insert(handle, resource);
        return Ok(Some(handle));
    }

    let block = loaded.map_or(0, |loaded| loaded.handle);
    let answer = call_handler(engine, handler, block, module, resource).await?;

    if answer == 0 {
        return Ok(Some(0));
    }

    let mut system = engine.system();

    system.loaded_resources.insert(
        resource,
        Loaded {
            handle: answer,
            uses: loaded.map_or(0, |loaded| loaded.uses) + 1,
            called: true,
            module,
        },
    );
    system.resource_blocks.insert(answer, resource);
    Ok(Some(answer))
}

/// A type's handler changed (`KRNL386.EXE` seg3 `0b3d`-`0bb0`): the one it
/// had answered, nought where the module has no such type. **Recorded** by
/// `reshand`.
pub fn set_resource_handler(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let kind = wanted(system, args.dword(system));
    let handler = args.dword(system);
    let Some(kind) = kind else {
        return Ok(Answer::Dword(0));
    };

    Ok(Answer::Dword(set_handler(system, instance, &kind, handler)))
}

/// A numbered type's handler changed, as `SetResourceHandler` changes it:
/// USER's `SignalProc` sets its own so (`icon_handlers.rs`).
pub(crate) fn set_typed_handler(
    system: &mut System,
    instance: u16,
    kind: u16,
    handler: u32,
) -> u32 {
    set_handler(system, instance, &Wanted::Number(kind), handler)
}

fn set_handler(system: &mut System, instance: u16, kind: &Wanted, handler: u32) -> u32 {
    let Some(owner) = system.resources_of(instance) else {
        return 0;
    };
    let Some(executable) = system.resource_file(owner) else {
        return 0;
    };
    let Some(index) = executable
        .resources
        .iter()
        .position(|resource_type| matches(&resource_type.id, resource_type.name.as_ref(), kind))
    else {
        return 0;
    };
    let default = system.default_handler();

    system.seed_user_handlers(owner);
    system.kernel_calls.default_resource_handler = default;

    system
        .kernel_calls
        .resource_handlers
        .insert((owner, index), handler)
        .unwrap_or(default)
}

/// KERNEL's own handler (seg1 `88c8`-`8921`): a block given that is there
/// answered as it is; else the resource read into it, or into a block of
/// its own, and that answered.
pub fn resource_handler(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let block = args.word(system);
    let _module = args.word(system);
    let resource = args.word(system);

    Ok(Answer::Word(kernel_handler(system, block, resource)))
}

/// KERNEL's own handler's work, as USER's handlers call it through
/// `[7A2h]`: the block, or nought.
pub(crate) fn kernel_handler(system: &mut System, block: u16, resource: u16) -> u16 {
    let Some((_, executable, entry)) = system.resource(resource) else {
        return 0;
    };
    let index = index_for(block);

    if block != 0 && system.global.size_of(index) != 0 && !system.global.is_discarded(index) {
        return block;
    }

    let bytes = executable.resource_bytes(&entry).to_vec();
    let handle = if block != 0 && system.global.block(index).is_some() {
        system.global.resize(
            &mut system.cpu.bus,
            &mut system.descriptors,
            index,
            bytes.len() as u32,
        );
        block
    } else {
        system.alloc_for(&executable, &entry, 0)
    };

    if handle == 0 {
        return 0;
    }

    system
        .cpu
        .bus
        .write((index_for(handle) as u32) << 16, &bytes);
    handle
}

/// A block for a resource (`KRNL386.EXE` seg1 `851e`-`85c3`). **Recorded**
/// by `reshand`.
pub fn alloc_resource(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let resource = args.word(system);
    let size = args.dword(system);

    if crate::kernel_calls::tasks::exe_ptr(system, instance) == 0 {
        return Ok(Answer::Word(0));
    }

    let Some((_, executable, entry)) = system.resource(resource) else {
        return Ok(Answer::Word(0));
    };
    let held = system
        .loaded_resources
        .get(&resource)
        .map(|loaded| loaded.handle)
        .filter(|&handle| system.global.block(index_for(handle)).is_some());

    if let Some(held) = held {
        let unit = 1u32 << System::resource_shift(&executable);
        let units = if size == 0 {
            entry.length.div_ceil(unit)
        } else {
            size.div_ceil(unit)
        };

        system.global.resize(
            &mut system.cpu.bus,
            &mut system.descriptors,
            index_for(held),
            units * unit,
        );
        return Ok(Answer::Word(held));
    }

    Ok(Answer::Word(system.alloc_for(&executable, &entry, size)))
}

/// A block for a resource of the module's, of the size and the resource
/// flags given (`KRNL386.EXE` seg1 `84b8`-`84e8`). **Recorded** by
/// `reshand`.
pub fn direct_res_alloc(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let flags = args.word(system);
    let size = args.word(system);

    if crate::kernel_calls::tasks::exe_ptr(system, instance) == 0 {
        return Ok(Answer::Word(0));
    }

    let flags = GMEM_MOVEABLE
        | GMEM_SHARE
        | if flags & DISCARDABLE != 0 {
            GMEM_DISCARDABLE
        } else {
            0
        };

    Ok(Answer::Word(system.allocate_owned(u32::from(size), flags)))
}

#[cfg(test)]
mod tests {
    use super::{Wanted, named};

    fn number_of(text: &str) -> Option<u16> {
        match named(text.to_string()) {
            Wanted::Number(number) => Some(number),
            Wanted::Name(_) => None,
        }
    }

    /// `#` and digits is their number, to the first that is not a digit,
    /// in a word (`KRNL386.EXE` seg3 `0ac0`-`0af6`); nought, a name.
    #[test]
    fn a_name_of_hash_and_digits_is_a_number() {
        assert_eq!(number_of("#164"), Some(164));
        assert_eq!(number_of("#12x"), Some(12));
        assert_eq!(number_of("#65537"), Some(1));
        assert_eq!(number_of("#0"), None);
        assert_eq!(number_of("#"), None);
        assert_eq!(number_of("SIERRAD"), None);
    }

    /// The resource of that number matches, and a name as a name, without
    /// regard to case. As `test/win16/find_resource_named_test.ts`.
    #[test]
    fn a_number_matches_its_resource_and_a_name_its_name() {
        use super::matches;
        use winbox_ne::ResourceId;

        let sierrad = "SIERRAD".to_string();

        assert!(matches(
            &ResourceId::Number(164),
            None,
            &named("#164".to_string())
        ));
        assert!(!matches(
            &ResourceId::Number(165),
            None,
            &named("#164".to_string())
        ));
        assert!(matches(
            &ResourceId::Name(sierrad.clone()),
            Some(&sierrad),
            &named("sierrad".to_string())
        ));
    }
}
