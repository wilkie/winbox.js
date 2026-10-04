//! A window's properties: handles kept under names, which a program -- or a
//! library such as `COMMDLG.DLL`, which keeps each of its dialogs' data this
//! way -- sets, reads and takes away again: `SetProp`, `GetProp`,
//! `RemoveProp` and `EnumProps`.
//!
//! A name is a string, compared without regard to case, or an atom, given
//! with nought in the pointer's upper word. Not measured: whether a string
//! and the atom Windows makes of it find the same property, which they do on
//! Windows by the documentation and do not here, as in the TypeScript
//! engine.
//!
//! Kept, as the TypeScript engine keeps them, on whatever object the handle
//! stands for -- a window, or anything else a handle names -- in the order
//! each name was first set.

use winbox_cpu::{AX, DS, ES, SS};
use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::{Engine, GuestArg, Register};
use crate::handles::Object;
use crate::system::System;

/// A property's name as it is looked up: a string upper case, or an atom.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PropKey {
    Name(String),
    Atom(u16),
}

/// A property: its key, the name it was first set by -- a string's bytes,
/// or none for an atom -- and the handle it keeps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prop {
    pub key: PropKey,
    pub name: Option<Vec<u8>>,
    pub data: u16,
}

/// The key a far pointer names: a string, read to its nought, or an atom
/// where the segment is nought.
fn key_of(system: &System, far: u32) -> (PropKey, Option<Vec<u8>>) {
    if far >> 16 == 0 {
        return (PropKey::Atom(far as u16), None);
    }

    let bytes = system.read_string(far);
    let text: String = bytes.iter().map(|&byte| char::from(byte)).collect();

    (PropKey::Name(text.to_uppercase()), Some(bytes))
}

/// What a handle stands for, the object its properties are kept on.
fn holder(system: &System, hwnd: u16) -> Option<Object> {
    system.handles.resolve(hwnd)
}

/// A handle kept under a name; whether it was kept.
pub(super) fn set_prop(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let data = args.word(system);
    let Some(object) = holder(system, hwnd) else {
        return Ok(Answer::Word(0));
    };
    let (key, name) = key_of(system, far);
    let props = system.user_calls.props.entry(object).or_default();

    match props.iter_mut().find(|prop| prop.key == key) {
        Some(prop) => prop.data = data,
        None => props.push(Prop { key, name, data }),
    }

    Ok(Answer::Word(1))
}

/// The handle kept under a name, or nought.
pub(super) fn get_prop(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let Some(object) = holder(system, hwnd) else {
        return Ok(Answer::Word(0));
    };
    let (key, _) = key_of(system, far);
    let data = system
        .user_calls
        .props
        .get(&object)
        .and_then(|props| props.iter().find(|prop| prop.key == key))
        .map_or(0, |prop| prop.data);

    Ok(Answer::Word(data))
}

/// A property taken away, answering the handle it kept; nought for none.
pub(super) fn remove_prop(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hwnd = args.word(system);
    let far = args.dword(system);
    let Some(object) = holder(system, hwnd) else {
        return Ok(Answer::Word(0));
    };
    let (key, _) = key_of(system, far);
    let Some(props) = system.user_calls.props.get_mut(&object) else {
        return Ok(Answer::Word(0));
    };
    let Some(at) = props.iter().position(|prop| prop.key == key) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(props.remove(at).data))
}

/// A property's name written for a procedure to read, in a block of USER's
/// own of 256 bytes, made the first time: at most 255 of its characters
/// and then its nought -- a longer name's 256th character in the nought's
/// place, as the TypeScript engine writes it.
fn name_block(system: &mut System, name: &[u8]) -> u32 {
    let far = if let Some(far) = system.user_calls.prop_name {
        far
    } else {
        let far = system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, 256, 0x42)
            .map_or(0, |index| u32::from(segment_selector(index)) << 16);

        system.user_calls.prop_name = Some(far);
        far
    };
    let bytes: Vec<u8> = (0..=name.len().min(255))
        .map(|at| name.get(at).copied().unwrap_or(0))
        .collect();

    system.write_far(far, &bytes);
    far
}

/// Each of a window's properties, in the order they were first set, to a
/// procedure given the window, the name -- a string, or nought and the atom
/// -- and the handle kept. **Read out** (seg13 `114a`): it answers -1 for no
/// properties, and otherwise nought, or 1 once the procedure answers
/// nought, which stops it. A property taken away meanwhile is passed over.
pub(super) fn enum_props(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hwnd, procedure, object, told) = {
            let system = engine.system();
            let hwnd = args.word(&system);
            let procedure = args.dword(&system);
            let object = holder(&system, hwnd);
            let told: Vec<(PropKey, Option<Vec<u8>>)> = object
                .and_then(|object| system.user_calls.props.get(&object))
                .map(|props| {
                    props
                        .iter()
                        .map(|prop| (prop.key.clone(), prop.name.clone()))
                        .collect()
                })
                .unwrap_or_default();

            (hwnd, procedure, object, told)
        };
        let mut answer: i16 = -1;

        for (key, name) in told {
            let (args, registers) = {
                let mut system = engine.system();
                let data = object
                    .and_then(|object| system.user_calls.props.get(&object))
                    .and_then(|props| props.iter().find(|prop| prop.key == key))
                    .map(|prop| prop.data);
                let Some(data) = data else {
                    continue;
                };
                let name = match (&key, name) {
                    (PropKey::Atom(atom), _) => u32::from(*atom),
                    (PropKey::Name(_), name) => name_block(&mut system, &name.unwrap_or_default()),
                };
                let stack = system.cpu.segments[SS].selector;

                (
                    [
                        GuestArg::Word(hwnd),
                        GuestArg::Long(name),
                        GuestArg::Word(data),
                    ],
                    [
                        Register::Word(AX, stack),
                        Register::Segment(DS, stack),
                        Register::Segment(ES, stack),
                    ],
                )
            };

            answer = 0;

            let (result, _) = engine.call_with(procedure, &args, &registers).await?;

            if result as u16 == 0 {
                answer = 1;
                break;
            }
        }

        Ok(Answer::Word(answer as u16))
    })
}
