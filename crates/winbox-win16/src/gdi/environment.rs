//! A printer's environment: the DEVMODE GDI keeps for a port, which a
//! driver's `Enable` and `ExtDeviceMode` keep there and read back. The twin
//! of `src/win16/gdi/environment.ts`.
//!
//! **Read out** of `GDI.EXE` (seg7 `0571`, `05ed`; seg4 `0438`): GDI keeps
//! twenty slots, each the atom of a port's name -- a colon at its end left
//! off, compared without case -- and a block of global memory. For the
//! null port, WIN.INI's `NullPort`, the slot is named by the environment's
//! own first field, the device's name, instead.

use winbox_machine::{handle_for, index_for};

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

use super::printer_driver::{null_port, port_key};

const SLOTS: usize = 20;

/// The slot's name for a port and an environment, or none where the port
/// is not named.
fn name_of(system: &mut System, port: u32, environment: u32) -> Option<Vec<u8>> {
    let port = if port == 0 {
        Vec::new()
    } else {
        system.read_string(port)
    };

    if port.is_empty() {
        return None;
    }

    if port_key(&port) == port_key(&null_port(system)) {
        let device = if environment == 0 {
            Vec::new()
        } else {
            system.read_string(environment)
        };

        return (!device.is_empty()).then(|| device.to_ascii_uppercase());
    }

    Some(port_key(&port))
}

/// The environment kept for a port, copied into `lpEnviron`, no more than
/// `nMaxCount` bytes: the count copied. With `lpEnviron` nought, the size
/// of the block kept, as `GlobalSize` answers it. Nought where none is
/// kept (seg7 `0571`).
pub fn get_environment(system: &mut System, port: u32, environment: u32, most: u16) -> u16 {
    let Some(name) = name_of(system, port, environment) else {
        return 0;
    };
    let Some(&(_, handle)) = system
        .printing
        .environments
        .iter()
        .find(|(other, _)| *other == name)
    else {
        return 0;
    };
    let size = system.global.size_of(index_for(handle));

    if environment == 0 {
        return size as u16;
    }

    let count = size.min(u32::from(most)) as usize;
    let from = system.global_pointer(handle);
    let bytes = system.read_far(from, count);

    system.write_far(environment, &bytes);
    count as u16
}

/// An environment kept for a port: the one there let go, and with a count
/// of nought nothing kept and -1 answered; else a block of `GlobalAlloc
/// (2002h)` the count's size, copied from `lpEnviron`, put in the first
/// free slot, and its handle answered; nought with no slot free (seg7
/// `05ed`).
pub fn set_environment(system: &mut System, port: u32, environment: u32, count: u16) -> u16 {
    let name = name_of(system, port, environment);

    if let Some(name) = &name
        && let Some(at) = system
            .printing
            .environments
            .iter()
            .position(|(other, _)| other == name)
    {
        let (_, handle) = system.printing.environments.remove(at);

        let _ = crate::memory::global_free(system, &mut Args::repeat(handle));
    }

    if count == 0 {
        return 0xffff;
    }

    let Some(name) = name else {
        return 0;
    };
    let Some(index) = system.global.allocate(
        &mut system.cpu.bus,
        &mut system.descriptors,
        u32::from(count),
        0x2002,
    ) else {
        return 0;
    };
    let handle = handle_for(index);

    if system.printing.environments.len() >= SLOTS {
        let _ = crate::memory::global_free(system, &mut Args::repeat(handle));
        return 0;
    }

    let bytes = system.read_far(environment, usize::from(count));
    let to = system.global_pointer(handle);

    system.write_far(to, &bytes);
    system.printing.environments.push((name, handle));
    handle
}

fn get_environment_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let port = args.dword(system);
    let environment = args.dword(system);
    let most = args.word(system);

    Ok(Answer::Word(get_environment(
        system,
        port,
        environment,
        most,
    )))
}

fn set_environment_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let port = args.dword(system);
    let environment = args.dword(system);
    let count = args.word(system);

    Ok(Answer::Word(set_environment(
        system,
        port,
        environment,
        count,
    )))
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "GetEnvironment" => get_environment_call,
        "SetEnvironment" => set_environment_call,
        _ => return None,
    }))
}
