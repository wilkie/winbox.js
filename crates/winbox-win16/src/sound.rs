//! The sound driver, `SOUND.DRV`, as winbox.js keeps it: what the
//! installation's driver, the speaker's, answers, as `sndplay` and
//! `snddrv` record it: `OpenSound` a voice for the task that asks, as long
//! as no task has it; a note of 99 an invalid note, -5; and every other
//! call nought, `CountVoiceNotes` too, however many notes are queued.
//! Nothing is played. A note is taken to be one of 0, a rest, to 84, as
//! documented. The task that has it open is kept in the driver's data
//! where the driver keeps it (`[90h]`). As `src/win16/sound.ts`.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use winbox_cpu::DX;
use winbox_machine::segment_selector;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::Engine;
use crate::system::System;

/// `S_SERDNT`: an invalid note.
const S_SERDNT: i16 = -5;

/// `S_SERDVNA`: the device is another task's.
const S_SERDVNA: u16 = 0xffff;

/// Where the driver keeps the task that has it open.
const OWNER: u16 = 0x90;

/// The word of threshold flags `GetThresholdEvent` points at.
const THRESHOLD: u16 = 0x84;

/// The sounds' names, as the driver keeps them in its data from 10h.
const NAMES: [&[u8]; 5] = [
    b"SystemDefault",
    b"SystemHand",
    b"SystemQuestion",
    b"SystemExclamation",
    b"SystemAsterisk",
];

const NAMES_AT: u16 = 0x10;

/// `sndPlaySound`'s flag to play and go on.
const SND_ASYNC: u16 = 1;

pub fn implementation(name: &str) -> Option<Implementation> {
    if name == "DoBeep" {
        return Some(Implementation::Async(do_beep_call));
    }

    Some(Implementation::Sync(match name {
        "OpenSound" => open_sound,
        "CloseSound" => close_sound,
        "GetThresholdEvent" => get_threshold_event,
        "WEP" => |system, args| {
            let _ = args.word(system);
            Ok(Answer::Word(1))
        },
        "SetVoiceNote" => set_voice_note,
        "SetVoiceQueueSize" | "SetVoiceAccent" | "SetVoiceEnvelope" | "SetSoundNoise"
        | "SetVoiceSound" | "StartSound" | "StopSound" | "WaitSoundState" | "SyncAllVoices"
        | "CountVoiceNotes" | "GetThresholdStatus" | "SetVoiceThreshold" => answered,
        _ => return None,
    }))
}

impl System {
    /// The driver's data segment's selector.
    fn sound_data(&self) -> u16 {
        self.kept_named("SOUND")
            .map_or(0, |kept| segment_selector(self.kept[kept].data))
    }

    /// The task that has the driver open, nought for none.
    fn sound_owner(&self) -> u16 {
        let data = self.sound_data();

        if data == 0 {
            return 0;
        }

        self.cpu.bus.read16(self.base_of(data) + u32::from(OWNER))
    }

    fn set_sound_owner(&mut self, task: u16) {
        let base = self.base_of(self.sound_data());

        self.cpu.bus.write16(base + u32::from(OWNER), task);
    }
}

/// The driver for the task that asks, as long as no other has it: 1, a
/// voice, or -1, `S_SERDVNA`, where it is open already, the asker's or
/// another's (`SOUND.DRV` seg1 `03f8`-`0409`, `046c`). **Recorded** by
/// `snddrv`: a second `OpenSound` -1, and 1 again once closed.
fn open_sound(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let task = system.task_handle;

    if system.sound_data() == 0 || system.sound_owner() != 0 || task == 0 {
        return Ok(Answer::Word(S_SERDVNA));
    }

    system.set_sound_owner(task);
    Ok(Answer::Word(1))
}

/// The driver let go, where the task that has it asks (seg1 `04af`-`04bb`).
fn close_sound(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let task = system.task_handle;

    if system.sound_data() != 0 && task != 0 && system.sound_owner() == task {
        system.set_sound_owner(0);
    }

    Ok(Answer::Nothing)
}

/// A pointer to the word of threshold flags `GetThresholdStatus` answers
/// and clears, in the driver's data, for the task that has it open; for any
/// other AX nought, and DX as the caller left it (seg1 `06e5`-`06fb`).
/// **Recorded** by `snddrv`: offset 84h, and the word nought.
fn get_threshold_event(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    let task = system.task_handle;
    let data = system.sound_data();

    Ok(Answer::Dword(
        if data != 0 && task != 0 && system.sound_owner() == task {
            u32::from(data) << 16 | u32::from(THRESHOLD)
        } else {
            u32::from(system.cpu.regs[DX]) << 16
        },
    ))
}

fn do_beep_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let kind = args.word(&engine.system());

        do_beep(engine, kind).await?;
        Ok(Answer::Nothing)
    })
}

/// The beep `MessageBeep` asks the driver for (`USER.EXE` seg1 `1bc9`),
/// read out of `SOUND.DRV` (seg1 `000a`-`0052`): -1, the speaker's; any
/// other names a sound by its icon, the second hexadecimal digit -- nought
/// `SystemDefault`, then `SystemHand`, `SystemQuestion`,
/// `SystemExclamation` and `SystemAsterisk`, more `SystemDefault` --
/// played with MMSYSTEM's `sndPlaySound` and `SND_ASYNC`, the names where
/// the driver keeps them in its data; where that answers nought, the
/// speaker. What it leaves in AX is no answer. Not followed: the speaker,
/// which WinBox does not sound. As `sound.ts`'s `DoBeep`.
pub(crate) async fn do_beep(engine: &Engine, kind: u16) -> Result<(), Stop> {
    let data = engine.system().sound_data();

    if kind == 0xffff || data == 0 {
        return Ok(());
    }

    {
        let mut system = engine.system();
        let mut at = NAMES_AT;

        for name in NAMES {
            let far = u32::from(data) << 16 | u32::from(at);

            system.write_far(far, name);
            system.write_far(far + name.len() as u32, &[0]);
            at += name.len() as u16 + 1;
        }
    }

    let index = usize::from((kind & 0xf0) >> 4);
    let name = NAMES.get(index).copied().unwrap_or(NAMES[0]);

    crate::mmsystem::sound::play_named(engine, name, SND_ASYNC).await?;
    Ok(())
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
