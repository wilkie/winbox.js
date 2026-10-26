//! What a program dropped files on is given: `WM_DROPFILES`'s handle, a
//! block of global memory File Manager fills, which these read as SHELL
//! reads it -- **read out of `SHELL.DLL`** (seg6) and **recorded** by
//! `dragq`: the offset of the names at 0, the point at 2, whether outside
//! the client area at 6, then the names, each ended by a nought, a nought
//! after them. As `src/win16/shell/drag.ts`.

use crate::call::{Answer, Args, Stop};
use crate::system::System;

/// The block locked, as SHELL locks it: where it is.
fn locked(system: &mut System, handle: u16) -> Result<u32, Stop> {
    Ok(
        match crate::memory::global_lock(system, &mut Args::repeat(handle))? {
            Answer::Dword(far) => far,
            _ => 0,
        },
    )
}

fn unlocked(system: &mut System, handle: u16) -> Result<(), Stop> {
    crate::memory::global_unlock(system, &mut Args::repeat(handle))?;
    Ok(())
}

fn word_at(system: &System, far: u32, at: u16) -> u16 {
    let bytes = system.read_far(
        far & 0xffff_0000 | u32::from((far as u16).wrapping_add(at)),
        2,
    );

    u16::from_le_bytes([bytes[0], bytes[1]])
}

/// Where the files were dropped, written to a `POINT`; 1 where the block's
/// flag is nought, in the client area (`SHELL.DLL` seg6 `0000`-`004f`).
pub fn drag_query_point(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let drop = args.word(system);
    let point = args.dword(system);
    let far = locked(system, drop)?;
    let x = word_at(system, far, 2);
    let y = word_at(system, far, 4);
    let outside = word_at(system, far, 6);
    let mut bytes = x.to_le_bytes().to_vec();

    bytes.extend_from_slice(&y.to_le_bytes());
    system.write_far(point, &bytes);
    unlocked(system, drop)?;
    Ok(Answer::Word(u16::from(outside == 0)))
}

/// A file's name, or for -1 how many there are (seg6 `0094`-`013e`): the
/// name's whole length, as much of it as fits copied where a buffer with
/// room is given; past the last name, nought.
pub fn drag_query_file(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let drop = args.word(system);
    let index = args.word(system);
    let buffer = args.dword(system);
    let size = args.word(system);
    let far = locked(system, drop)?;
    let selector = far & 0xffff_0000;
    let byte = |system: &System, at: u16| system.read_far(selector | u32::from(at), 1)[0];
    let mut at = (far as u16).wrapping_add(word_at(system, far, 0));
    let mut count = 0u16;

    while (index == 0xffff || count != index) && byte(system, at) != 0 {
        loop {
            let this = byte(system, at);

            at = at.wrapping_add(1);

            if this == 0 {
                break;
            }
        }

        count += 1;
    }

    let mut answer = count;

    if index != 0xffff {
        let mut length = 0u16;

        while byte(system, at.wrapping_add(length)) != 0 {
            length += 1;
        }

        answer = length;

        if length != 0 && size != 0 && buffer != 0 {
            let copied = length.min(size - 1);
            let mut bytes: Vec<u8> = (0..copied)
                .map(|i| byte(system, at.wrapping_add(i)))
                .collect();

            bytes.push(0);
            system.write_far(buffer, &bytes);
        }
    }

    unlocked(system, drop)?;
    Ok(Answer::Word(answer))
}

/// The block let go (seg6 `0142`), `GlobalFree`'s answer left in AX:
/// nought.
pub fn drag_finish(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let drop = args.word(system);

    crate::memory::global_free(system, &mut Args::repeat(drop))
}
