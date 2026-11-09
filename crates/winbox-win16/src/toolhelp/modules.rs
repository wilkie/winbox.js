//! TOOLHELP's walk of the modules (`TOOLHELP.DLL` seg1 `0a90`-`0ca7`).

use super::structures::structure;
use crate::call::{Answer, Args, Stop};
use crate::handles::Object;
use crate::kernel::module_handle_named;
use crate::modules_kernel::module_usage;
use crate::system::System;

/// `MODULEENTRY`'s size.
const MODULEENTRY: u16 = 0x114;

/// `szModule`'s room, and `szExePath`'s, a nought after each.
const NAME_LENGTH: usize = 9;
const PATH_LENGTH: usize = 255;

/// A module in the chain: its handle, name and file.
#[derive(Debug, Clone)]
pub(crate) struct ChainModule {
    pub handle: u16,
    pub name: String,
    pub path: String,
}

/// The modules, in the order KERNEL chains their databases from its first,
/// `hExeHead` -- KERNEL's own first (**recorded** by `thtask`): winbox.js's
/// own in the order it keeps them, then those loaded from their files, in
/// the order they were first loaded; each as `GetModuleHandle` finds it by
/// its name, once. One `GetModuleHandle` does not find is not loaded.
pub(crate) fn module_chain(system: &System) -> Vec<ChainModule> {
    let names = system
        .kept
        .iter()
        .map(|kept| kept.module.name.to_string())
        .chain(system.modules.iter().map(|module| module.name.clone()));
    let mut chain: Vec<ChainModule> = Vec::new();

    for name in names {
        let handle = module_handle_named(system, &name.to_ascii_uppercase());

        if handle == 0 || chain.iter().any(|module| module.handle == handle) {
            continue;
        }

        let (name, path) = match system.handles.resolve_module(handle) {
            Some(Object::Kept(kept)) => (
                system.kept[kept].module.name.to_ascii_uppercase(),
                system.kept[kept].module.path.to_string(),
            ),
            Some(Object::Library(module) | Object::Task(module)) => (
                super::tasks::module_name(system, module),
                system.modules[module].path.clone(),
            ),
            _ => (name.to_ascii_uppercase(), system.path_of(handle)),
        };

        chain.push(ChainModule { handle, name, path });
    }

    chain
}

/// A `MODULEENTRY` filled for a module (seg1 `0bd7`-`0ca7`): its name, its
/// handle, its count, its file's path and the next module. False for a
/// handle that is no module's.
fn fill(system: &mut System, far: u32, handle: u16) -> bool {
    let Some(entry) = structure(system, far, MODULEENTRY) else {
        return false;
    };
    let chain = module_chain(system);
    let Some(at) = chain.iter().position(|module| module.handle == handle) else {
        return false;
    };
    let module = &chain[at];
    let usage = module_usage(system, module.handle);

    entry.write_string(system, 0x04, module.name.as_bytes(), NAME_LENGTH);
    entry.write16(system, 0x0e, module.handle);
    entry.write16(system, 0x10, usage);
    entry.write_string(system, 0x12, module.path.as_bytes(), PATH_LENGTH);
    entry.write16(
        system,
        0x112,
        chain.get(at + 1).map_or(0, |module| module.handle),
    );
    true
}

/// KERNEL's module, the chain's first (seg1 `0a90`).
pub fn module_first(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let first = module_chain(system)
        .first()
        .map_or(0, |module| module.handle);

    Ok(Answer::Word(u16::from(fill(system, far, first))))
}

/// The module after the one filled in (seg1 `0ad9`).
pub fn module_next(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let next = structure(system, far, MODULEENTRY).map_or(0, |entry| entry.read16(system, 0x112));

    Ok(Answer::Word(u16::from(
        next != 0 && fill(system, far, next),
    )))
}

/// The module of a name, its case counting, and its handle (seg1 `0b15`-
/// `0b87`). **Recorded** by `thtask`.
pub fn module_find_name(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let name = args.dword(system);

    if structure(system, far, MODULEENTRY).is_none() || name == 0 {
        return Ok(Answer::Word(0));
    }

    let wanted = system.read_string(name);
    let found = module_chain(system)
        .into_iter()
        .find(|module| module.name.as_bytes() == wanted.as_slice())
        .map_or(0, |module| module.handle);

    Ok(Answer::Word(if found != 0 && fill(system, far, found) {
        found
    } else {
        0
    }))
}

/// A module's entry by its handle, and the handle (seg1 `0b8c`).
pub fn module_find_handle(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let handle = args.word(system);

    Ok(Answer::Word(if handle != 0 && fill(system, far, handle) {
        handle
    } else {
        0
    }))
}
