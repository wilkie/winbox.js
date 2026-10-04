//! `aux*`: auxiliary devices -- a card's mixer inputs, a CD's audio out --
//! which are never opened, only asked by number.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg8 `492`-`5dc`): each call is
//! `auxOutMessage`'s message to the device by its number, numbered across
//! the drivers as the other kinds are, the mapper's number the
//! `auxmapper`'s. A number past them answers `MMSYSERR_BADDEVICEID` (2), a
//! place with no driver `MMSYSERR_NODRIVER` (6). Capabilities with a size
//! of nought answer nought; a buffer that cannot be written,
//! `MMSYSERR_INVALPARAM` (11).

// Each has the signature every function that answers a call has.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Later};
use crate::engine::Engine;

use super::checks;
use super::devices::{self, Kind, MMSYSERR_INVALPARAM, MMSYSERR_NOERROR};
use super::wave::count;

const AUXDM_GETDEVCAPS: u16 = 4;
const AUXDM_GETVOLUME: u16 = 5;
const AUXDM_SETVOLUME: u16 = 6;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Async(match name {
        "auxGetNumDevs" => |engine, _| count(engine, Kind::Aux),
        "auxGetDevCaps" => get_dev_caps,
        "auxGetVolume" => get_volume,
        "auxSetVolume" => set_volume,
        "auxOutMessage" => out_message,
        _ => return None,
    }))
}

fn get_dev_caps(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, far, size) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.word(&system))
        };

        if size == 0 {
            return Ok(Answer::Word(MMSYSERR_NOERROR));
        }

        if !checks::writable(&engine.system(), far, u32::from(size)) {
            return Ok(Answer::Word(MMSYSERR_INVALPARAM));
        }

        let answer = devices::send_by_id(
            engine,
            Kind::Aux,
            id,
            AUXDM_GETDEVCAPS,
            far,
            u32::from(size),
        )
        .await?;

        Ok(Answer::Word(answer as u16))
    })
}

fn get_volume(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, far) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system))
        };

        if !checks::writable(&engine.system(), far, 4) {
            return Ok(Answer::Word(MMSYSERR_INVALPARAM));
        }

        let answer = devices::send_by_id(engine, Kind::Aux, id, AUXDM_GETVOLUME, far, 0).await?;

        Ok(Answer::Word(answer as u16))
    })
}

fn set_volume(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, value) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system))
        };
        let answer = devices::send_by_id(engine, Kind::Aux, id, AUXDM_SETVOLUME, value, 0).await?;

        Ok(Answer::Word(answer as u16))
    })
}

/// Any message to a device by its number: a doubleword, its errors' high
/// word nought.
fn out_message(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, message, first, second) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            devices::send_by_id(engine, Kind::Aux, id, message, first, second).await?,
        ))
    })
}
