//! TOOLHELP's walk of USER's classes (`TOOLHELP.DLL` seg1 `28b0`-`29c1`).
//! As `toolhelp/classes.ts`.

use super::structures::structure;
use crate::call::{Answer, Args, Stop};
use crate::handles::Object;
use crate::kernel_calls::tasks::exe_ptr;
use crate::system::System;

/// `CLASSENTRY`'s size, and `szClassName`'s room.
const CLASSENTRY: u16 = 0x108;
const NAME_LENGTH: usize = 255;

/// USER's own classes, as its list ends: the newest first (`thtask`).
pub const USER_CLASSES: [&str; 13] = [
    "#32772",
    "#32771",
    "#32769",
    "MDIClient",
    "ComboBox",
    "ComboLBox",
    "ScrollBar",
    "ListBox",
    "Edit",
    "#32770",
    "Static",
    "Button",
    "#32768",
];

/// The classes in USER's list, the newest first, each its module and
/// name; see `classList`.
fn class_list(system: &mut System) -> Vec<(u16, String)> {
    let mut registered: Vec<(u16, usize)> = system
        .handles
        .objects()
        .filter_map(|(handle, object)| match object {
            Object::Class(index) => Some((handle, index)),
            _ => None,
        })
        .filter(|&(_, index)| {
            let name = &system.classes[index].name;

            !USER_CLASSES
                .iter()
                .any(|own| own.eq_ignore_ascii_case(name))
        })
        .collect();

    registered.sort_by_key(|each| std::cmp::Reverse(each.0));

    let mut list: Vec<(u16, String)> = Vec::new();

    for (_, index) in registered {
        let instance = system.classes[index].instance;
        let module = exe_ptr(system, instance);

        // A class whose module has gone is gone from USER's list; one
        // winbox.js registers itself, with no instance -- MMSYSTEM's `#42`
        // -- is listed with none.
        if instance == 0 || module != 0 {
            list.push((module, system.classes[index].name.clone()));
        }
    }

    let user = crate::kernel::module_handle_named(system, "USER");

    list.extend(USER_CLASSES.iter().map(|name| (user, (*name).to_string())));
    list
}

/// A `CLASSENTRY` filled for the class at a place in the list, from 1
/// (seg1 `296a`-`29c1`).
fn fill(system: &mut System, far: u32, place: usize) -> bool {
    let Some(entry) = structure(system, far, CLASSENTRY) else {
        return false;
    };
    let list = class_list(system);
    let Some((module, name)) = place.checked_sub(1).and_then(|at| list.get(at)).cloned() else {
        return false;
    };

    entry.write16(system, 0x04, module);
    entry.write_string(system, 0x06, name.as_bytes(), NAME_LENGTH);
    entry.write16(
        system,
        0x106,
        if place < list.len() {
            place as u16 + 1
        } else {
            0
        },
    );
    true
}

/// The first class in USER's list (seg1 `28b0`).
pub fn class_first(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);

    Ok(Answer::Word(u16::from(fill(system, far, 1))))
}

/// The class after the one filled in (seg1 `2925`).
pub fn class_next(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let next = structure(system, far, CLASSENTRY).map_or(0, |entry| entry.read16(system, 0x106));

    Ok(Answer::Word(u16::from(
        next != 0 && fill(system, far, usize::from(next)),
    )))
}
