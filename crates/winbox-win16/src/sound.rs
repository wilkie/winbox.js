//! The sound driver, `SOUND.DRV`, as winbox.js keeps it: what the
//! installation's driver, the speaker's, answers, as `sndplay` records it:
//! `OpenSound` a voice, every time; a note of 99 an invalid note, -5; and
//! every other call nought, `CountVoiceNotes` too, however many notes are
//! queued. Nothing is played. A note is taken to be one of 0, a rest, to
//! 84, as documented. The rest of its exports are stubs.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;

/// `S_SERDNT`: an invalid note.
const S_SERDNT: i16 = -5;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "OpenSound" => open_sound,
        "CloseSound" => close_sound,
        "SetVoiceNote" => set_voice_note,
        "SetVoiceQueueSize" | "SetVoiceAccent" | "SetVoiceEnvelope" | "SetSoundNoise"
        | "SetVoiceSound" | "StartSound" | "StopSound" | "WaitSoundState" | "SyncAllVoices"
        | "CountVoiceNotes" | "GetThresholdStatus" | "SetVoiceThreshold" => answered,
        _ => return None,
    }))
}

/// A voice: 1, every time.
fn open_sound(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(1))
}

fn close_sound(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Nothing)
}

/// Nought, whatever is asked.
fn answered(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(0))
}

/// A note queued, which is never played: nought, or -5 for a note that is
/// none of 0 to 84.
fn set_voice_note(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _voice = args.signed(system);
    let value = args.signed(system);

    Ok(Answer::Word(if (0..=84).contains(&value) {
        0
    } else {
        S_SERDNT as u16
    }))
}
