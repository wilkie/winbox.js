//! `sndPlaySound`: a waveform sound played through the waveform output
//! device, by its file, by its name in `WIN.INI`'s `[sounds]`, or from the
//! program's memory.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg4 `0`, seg3 `0`-`70d`):
//!
//! * With no waveform output device nothing plays, whatever is asked, and
//!   the answer is nought (seg4 `0`, **recorded** by `sndplay`). With one,
//!   the call goes on in seg3 `90`.
//! * A flag past the five there are (`SND_ASYNC` 1, `SND_NODEFAULT` 2,
//!   `SND_MEMORY` 4, `SND_LOOP` 8, `SND_NOSTOP` 10h), or `SND_LOOP` without
//!   `SND_ASYNC`, is a bad flag, logged with `LogParamError`, and answers
//!   nought; so does a name that `IsBadStringPtr` finds bad for 128 bytes.
//!   With `SND_NOSTOP`, a sound still playing answers nought.
//! * A name of no characters answers 1, and nothing is stopped. Else the
//!   name is looked up as `GetProfileString` looks up `[sounds]` in
//!   `WIN.INI`, the name itself the default, as much as fits 128 bytes; cut
//!   at its first space, tab or comma -- an entry is a file and then its
//!   description, "`ding.wav, Default Beep`" -- and, where `OpenFile` finds
//!   the file (`OF_EXIST`), made the path it found, through `OemToAnsi`.
//! * No name at all stops the sound playing, lets the sound kept go, and
//!   answers 1.
//! * The sound last loaded is kept, in a global block of its own: a
//!   `WAVEHDR`, the name it was loaded by at 20h, and the file after the
//!   name. A name the kept sound was loaded by, without regard to case,
//!   plays it again from memory; another is loaded from its file -- the
//!   whole file read in -- and, loaded, takes the kept sound's place, the
//!   sound playing stopped. A file that is not there or is not a waveform
//!   file is no sound, and the playing one plays on; then, without
//!   `SND_NODEFAULT`, `[sounds]`' `SystemDefault` is tried the same way, and
//!   where that is no sound either the answer is nought.
//! * With `SND_MEMORY` the name is the sound itself, in the program's
//!   memory: the kept sound goes, and a block of the header alone, with no
//!   name, is kept, its data the program's.
//! * A waveform file is `RIFF`, `WAVE`, then chunks; the `fmt ` chunk
//!   found, then the `data` chunk after it, each passing over the chunks
//!   before it. One whose `RIFF` chunk is longer than the file, or whose
//!   chunks passed over reach the `RIFF` chunk's length, is not one. The
//!   header is the data chunk's bytes and size, the format chunk's place in
//!   its user's doubleword, done and not looping.
//! * Playing stops the sound playing first, then opens the waveform
//!   mapper's number -- each device in turn where no mapper is installed --
//!   with the sound's format, prepares the header and writes it, looping
//!   for ever with `SND_ASYNC` and `SND_LOOP`. A device that will not open
//!   answers nought. Without `SND_ASYNC` the call waits for the header to
//!   be done, stops, and answers 1; with it, it answers 1 at once.
//! * Stopping a sound resets the device if the header is not done,
//!   unprepares it and closes the device.
//! * A sound played with `SND_ASYNC` is stopped by MMSYSTEM's own window:
//!   the device calls it back with `MM_WOM_DONE`, which sets a timer of
//!   300 milliseconds, at which the sound, done, is stopped (seg4 `235`).
//!
//! **Recorded** by `sndplay` on the installation with a sound card, whose
//! `WIN.INI` names sounds whose files are not there: a file played
//! synchronously and asynchronously answers 1, a file that is not there
//! nought with and without `SND_NODEFAULT`, `SystemStart` nought, and no
//! name 1.
//!
//! Not as Windows does it: MMSYSTEM's window, which winbox.js does not
//! make. Windows sends it the call when a sound is playing or one is asked
//! for with `SND_ASYNC`, and it plays the sound in the window's task;
//! winbox.js plays it in the caller's, which answers as the window does --
//! save where a task has locked itself (`IsTaskLocked`) and the window is
//! another task's, where Windows answers nought. The device is opened with
//! no callback, not the window's: winbox.js closes it itself 300
//! milliseconds after the header is done, when it is next asked for -- by
//! `sndPlaySound`, by `waveOutOpen` or by MCI's waveform device -- rather
//! than at the window's timer, as soon as the window's task has the time.
//! Waiting for a sound, the call passes the time to the card's next
//! interrupt, as the processor's spinning would.

use winbox_machine::{handle_for, index_for, segment_selector};

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::system::System;

use super::checks::{self, DONE};
use super::devices::{self, Kind, MMSYSERR_NOERROR};
use super::wave::out;

pub const SND_ASYNC: u16 = 1;
pub const SND_NODEFAULT: u16 = 2;
pub const SND_MEMORY: u16 = 4;
pub const SND_LOOP: u16 = 8;
pub const SND_NOSTOP: u16 = 0x10;

/// The flags there are.
const SND_ALL: u16 = 0x1f;

/// How long a name may be, and its room: 128 bytes.
const NAME_ROOM: usize = 0x80;

/// The global blocks' flags: a file's sound moveable, discardable and
/// shared (2102h); a sound in memory moveable and shared (2002h).
const GMEM_FILE: u16 = 0x2102;
const GMEM_MEMORY: u16 = 0x2002;

/// Where a kept sound's name is, past its header.
const NAME_AT: u16 = 0x20;

/// The size of a `WAVEHDR`.
const HEADER_SIZE: u16 = 0x20;

/// A `WAVEHDR`'s flags and loops, and its loop flags.
const FLAGS_AT: u16 = 0x10;
const LOOPS_AT: u16 = 0x14;
const WHDR_BEGINLOOP_ENDLOOP: u32 = 0x0c;

/// `waveOutOpen`'s flags as MMSYSTEM opens for a sound: `WAVE_ALLOWSYNC`.
/// Windows' adds `CALLBACK_WINDOW`, for its window.
const WAVE_ALLOWSYNC: u32 = 2;

/// How long after a sound is done MMSYSTEM's window stops it.
const STOP_AFTER: f64 = 300.0;

/// What MMSYSTEM keeps of the sound.
#[derive(Debug, Default)]
pub struct Sound {
    /// The global block of the sound kept (`[6Eh]`), nought for none.
    kept: u16,
    /// The waveform device it plays on (`[70h]`).
    device: u16,
    /// Its header, playing (`[1F6h]`), a far pointer.
    header: u32,
    /// When the header was done, on the clock, for the window's timer.
    done_at: Option<f64>,
}

/// The sound asked for.
enum Asked {
    None,
    Memory(u32),
    Name(Vec<u8>),
}

/// `sndPlaySound`.
pub fn snd_play_sound(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (name, flags) = {
            let system = engine.system();

            (args.dword(&system), args.word(&system))
        };

        Ok(Answer::Word(play_sound(engine, name, flags).await?))
    })
}

/// `sndPlaySound` called by MMSYSTEM's own callers, as `MessageBeep`'s
/// sound driver calls it, with a name in its own data.
pub async fn play_named(engine: &Engine, name: &[u8], flags: u16) -> Result<u16, Stop> {
    if engine.system().mmsystem.devices.count(Kind::WaveOut) == 0 {
        return Ok(0);
    }

    settle(engine).await?;

    if flags & SND_NOSTOP != 0 && engine.system().mmsystem.sound.header != 0 {
        return Ok(0);
    }

    if name.is_empty() {
        return Ok(1);
    }

    let found = find_file(&mut engine.system(), name);

    play(engine, Asked::Name(found), flags).await
}

/// USER's `MessageBeep` (`USER.EXE` seg1 `1bab`), through the sound
/// driver's `DoBeep` (`MMSOUND.DRV` seg1 `a`), as both are **read out**:
///
/// * USER passes the beep on only while its `Beep` setting is on -- read
///   from `WIN.INI`'s `[windows]` as Windows starts, on where its first
///   letter is a Y, of either case, as it is where there is none (seg3
///   `1243`) -- and passes -1, the speaker's beep, while its system error
///   box is up (`[E0h]`, seg1 `9a9a`).
/// * `DoBeep` gives -1 to the speaker. Any other kind names a sound by its
///   icon, the second hexadecimal digit: nought `SystemDefault`, 1
///   `SystemHand`, 2 `SystemQuestion`, 3 `SystemExclamation`, 4
///   `SystemAsterisk`, more `SystemDefault`; played with `sndPlaySound`
///   and `SND_ASYNC`. Where that answers nought the speaker beeps.
///
/// Not followed: the speaker, which winbox.js does not sound; the setting
/// is read at each beep rather than as Windows starts, and
/// `SystemParametersInfo`'s `SPI_SETBEEP` does not change it. No program
/// runs while USER's system error box is up, so a program's beep never
/// finds it.
pub fn message_beep(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let kind = args.word(&engine.system());
        let on = {
            let mut system = engine.system();
            let profile = system.read_profile(b"WIN.INI");
            let first = profile
                .get(b"windows", b"Beep", true)
                .and_then(|value| value.first().copied())
                .unwrap_or(b'Y');

            first.eq_ignore_ascii_case(&b'Y')
        };

        if on && kind != 0xffff {
            let name: &[u8] = match (kind & 0xf0) >> 4 {
                1 => b"SystemHand",
                2 => b"SystemQuestion",
                3 => b"SystemExclamation",
                4 => b"SystemAsterisk",
                _ => b"SystemDefault",
            };

            play_named(engine, name, SND_ASYNC).await?;
        }

        Ok(Answer::Nothing)
    })
}

async fn play_sound(engine: &Engine, name: u32, flags: u16) -> Result<u16, Stop> {
    // seg4 `0`: no device, no sound.
    if engine.system().mmsystem.devices.count(Kind::WaveOut) == 0 {
        return Ok(0);
    }

    // seg3 `96`-`e0`: the flags, and the name.
    if flags & !SND_ALL != 0 || (flags & SND_LOOP != 0 && flags & SND_ASYNC == 0) {
        return Ok(0);
    }

    if flags & SND_MEMORY == 0
        && name != 0
        && crate::pointers::bad_string(&engine.system(), name, NAME_ROOM as u16)
    {
        return Ok(0);
    }

    settle(engine).await?;

    if flags & SND_NOSTOP != 0 && engine.system().mmsystem.sound.header != 0 {
        return Ok(0);
    }

    let asked = if name == 0 {
        Asked::None
    } else if flags & SND_MEMORY != 0 {
        Asked::Memory(name)
    } else {
        let mut system = engine.system();
        let text = system.read_string(name);

        if text.is_empty() {
            return Ok(1);
        }

        Asked::Name(find_file(&mut system, &text))
    };

    play(engine, asked, flags).await
}

/// A name made the file it names (seg3 `0`): its `[sounds]` entry's file,
/// or itself, as the path `OpenFile` finds.
fn find_file(system: &mut System, name: &[u8]) -> Vec<u8> {
    let profile = system.read_profile(b"WIN.INI");
    let mut found = profile
        .get(b"sounds", name, true)
        .unwrap_or_else(|| name.to_vec());

    found.truncate(NAME_ROOM - 1);

    if let Some(end) = found
        .iter()
        .position(|&byte| matches!(byte, b' ' | b'\t' | b','))
    {
        found.truncate(end);
    }

    let text: String = found.iter().map(|&byte| char::from(byte)).collect();

    if let Some(handle) = system.files.open(&text) {
        let path = system
            .files
            .resolve(handle)
            .map(|file| file.dos_path.clone());

        system.files.close(handle);

        if let Some(path) = path {
            let mut bytes: Vec<u8> = path.chars().map(|ch| ch as u8).collect();

            bytes.truncate(127);
            found = crate::keyboard::translate_bytes(false, &bytes);
        }
    }

    found
}

/// The sound asked for played, or stopped (seg3 `229`).
async fn play(engine: &Engine, asked: Asked, flags: u16) -> Result<u16, Stop> {
    match asked {
        Asked::None => {
            let_kept_go(engine).await?;
            return Ok(1);
        }
        Asked::Memory(far) => {
            let_kept_go(engine).await?;

            let kept = load_memory(&mut engine.system(), far);

            engine.system().mmsystem.sound.kept = kept;
        }
        Asked::Name(name) => {
            if !find(engine, &name).await? {
                if flags & SND_NODEFAULT != 0 {
                    return Ok(0);
                }

                let default = find_file(&mut engine.system(), b"SystemDefault");

                if !find(engine, &default).await? {
                    return Ok(0);
                }
            }
        }
    }

    start(engine, flags).await
}

/// The kept sound stopped and let go (seg3 `442`).
async fn let_kept_go(engine: &Engine) -> Result<(), Stop> {
    let kept = engine.system().mmsystem.sound.kept;

    if kept != 0 {
        stop(engine).await?;
        free(&mut engine.system(), kept);
    }

    engine.system().mmsystem.sound.kept = 0;
    Ok(())
}

/// The sound a name names made the kept sound: it already, or loaded from
/// its file (seg3 `1ba`). Whether there is one.
async fn find(engine: &Engine, name: &[u8]) -> Result<bool, Stop> {
    {
        let system = engine.system();
        let kept = system.mmsystem.sound.kept;

        if kept != 0
            && let Some(selector) = lock(&system, kept)
        {
            let far = u32::from(selector) << 16 | u32::from(NAME_AT);

            if same_name(&system.read_string(far), name) {
                return Ok(true);
            }
        }
    }

    let loaded = load_file(&mut engine.system(), name);

    if loaded == 0 {
        return Ok(false);
    }

    let_kept_go(engine).await?;
    engine.system().mmsystem.sound.kept = loaded;
    Ok(true)
}

/// Two names alike without regard to case, as `lstrcmpi` finds them.
fn same_name(left: &[u8], right: &[u8]) -> bool {
    let lower = crate::user_misc::ansi_lower_byte;

    left.len() == right.len() && left.iter().zip(right).all(|(&a, &b)| lower(a) == lower(b))
}

/// A waveform file loaded into a block of its own, past a header and its
/// name (seg3 `45a`): the block's handle, or nought.
fn load_file(system: &mut System, name: &[u8]) -> u16 {
    let text: String = name.iter().map(|&byte| char::from(byte)).collect();
    let Some(file) = system.files.open(&text) else {
        return 0;
    };
    let bytes = system.files.resolve(file).map_or_else(Vec::new, |opened| {
        let size = opened.size() as usize;

        opened.read(size)
    });
    let name_size = name.len() as u16 + 1;
    let start = name_size.wrapping_add(NAME_AT);
    let size = u32::from(start).wrapping_add(bytes.len() as u32);
    let handle = alloc(system, GMEM_FILE, size);

    if handle == 0 {
        system.files.close(file);
        return 0;
    }

    let selector = lock(system, handle).unwrap_or(0);
    let block = u32::from(selector) << 16;
    let data = block | u32::from(start);
    let at = system.linear(data);

    system.cpu.bus.write(at, &bytes);

    if !parse(system, bytes.len() as u32, data, block) {
        free(system, handle);
        system.files.close(file);
        return 0;
    }

    system.files.close(file);

    let mut named = name.to_vec();

    named.push(0);
    system.write_far(block | u32::from(NAME_AT), &named);
    handle
}

/// A sound in the program's memory kept as a header of its own, with no
/// name (seg3 `553`): the block's handle, or nought.
fn load_memory(system: &mut System, far: u32) -> u16 {
    let handle = alloc(system, GMEM_MEMORY, u32::from(NAME_AT) + 1);

    if handle == 0 {
        return 0;
    }

    let block = u32::from(lock(system, handle).unwrap_or(0)) << 16;

    if !parse(system, u32::MAX, far, block) {
        free(system, handle);
        return 0;
    }

    system.write_far(block | u32::from(NAME_AT), &[0]);
    handle
}

/// A waveform file's chunks read, at `data` for `size` bytes, into the
/// header at `header` (seg3 `5b1`): whether it is one. The chunks are
/// walked as MMSYSTEM walks them, by the low word of each size within the
/// data's segment, and their running total against the `RIFF` chunk's
/// length -- the format chunk's own not counted.
fn parse(system: &mut System, size: u32, data: u32, header: u32) -> bool {
    let selector = data & 0xffff_0000;
    let at = |offset: u16| selector | u32::from(offset);
    let tag = |system: &System, offset: u16| system.read_far(at(offset), 4);

    if size < 12 {
        return false;
    }

    let start = data as u16;

    if tag(system, start) != b"RIFF" || tag(system, start.wrapping_add(8)) != b"WAVE" {
        return false;
    }

    let length = checks::dword_at(system, at(start.wrapping_add(4)));

    if length > size {
        return false;
    }

    let mut walked = 12u32;
    let mut chunk = start.wrapping_add(12);

    while tag(system, chunk) != b"fmt " {
        walked = walked
            .wrapping_add(checks::dword_at(system, at(chunk.wrapping_add(4))))
            .wrapping_add(8);

        if walked >= length {
            return false;
        }

        chunk = chunk.wrapping_add(low_size(system, at(chunk)).wrapping_add(8));
    }

    let format = chunk.wrapping_add(8);

    chunk = chunk.wrapping_add(low_size(system, at(chunk)).wrapping_add(8));

    while tag(system, chunk) != b"data" {
        walked = walked
            .wrapping_add(checks::dword_at(system, at(chunk.wrapping_add(4))))
            .wrapping_add(8);

        if walked >= length {
            return false;
        }

        chunk = chunk.wrapping_add(low_size(system, at(chunk)).wrapping_add(8));
    }

    let bytes = checks::dword_at(system, at(chunk.wrapping_add(4)));
    let mut fields = Vec::with_capacity(0x18);

    fields.extend_from_slice(&at(chunk.wrapping_add(8)).to_le_bytes());
    fields.extend_from_slice(&bytes.to_le_bytes());
    fields.extend_from_slice(&checks::dword_at(system, header | 8).to_le_bytes());
    fields.extend_from_slice(&at(format).to_le_bytes());
    fields.extend_from_slice(&DONE.to_le_bytes());
    fields.extend_from_slice(&0u32.to_le_bytes());
    system.write_far(header, &fields);
    true
}

/// The low word of a chunk's size, as MMSYSTEM moves on by it.
fn low_size(system: &System, chunk: u32) -> u16 {
    let bytes = system.read_far(field(chunk, 4), 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

/// The kept sound played (seg3 `2c2`): whatever plays stopped, the kept
/// one begun, and, without `SND_ASYNC`, waited for and stopped.
async fn start(engine: &Engine, flags: u16) -> Result<u16, Stop> {
    stop(engine).await?;

    if !begin(engine, flags).await? {
        return Ok(0);
    }

    if flags & SND_ASYNC == 0 {
        wait_done(engine)?;
        stop(engine).await?;
    }

    Ok(1)
}

/// The device opened for the kept sound, and its header written (seg3
/// `2eb`): whether it plays.
async fn begin(engine: &Engine, flags: u16) -> Result<bool, Stop> {
    let (header, format) = {
        let mut system = engine.system();
        let sound = &system.mmsystem.sound;

        if sound.kept == 0 || sound.device != 0 {
            return Ok(false);
        }

        let Some(selector) = lock(&system, sound.kept) else {
            return Ok(false);
        };
        let header = u32::from(selector) << 16;

        system.mmsystem.sound.header = header;
        system.mmsystem.sound.done_at = None;
        (header, checks::dword_at(&system, header | 0x0c))
    };
    let frame = devices::below_stack(&mut engine.system(), &[&[0, 0]]);
    let opened = out::open(
        engine,
        frame.pointers[0],
        devices::MAPPER,
        format,
        0,
        0,
        WAVE_ALLOWSYNC,
    )
    .await;
    let device = {
        let mut system = engine.system();
        let bytes = system.read_far(frame.pointers[0], 2);

        frame.release(&mut system);
        u16::from_le_bytes([bytes[0], bytes[1]])
    };

    if opened? != MMSYSERR_NOERROR {
        let mut system = engine.system();

        system.mmsystem.sound.header = 0;
        system.mmsystem.sound.device = 0;
        return Ok(false);
    }

    engine.system().mmsystem.sound.device = device;

    if out::prepare(engine, device, header, HEADER_SIZE).await? != MMSYSERR_NOERROR {
        stop(engine).await?;
        return Ok(false);
    }

    {
        let mut system = engine.system();
        let mut header_flags = checks::dword_at(&system, field(header, FLAGS_AT));
        let loops = if flags & SND_ASYNC != 0 && flags & SND_LOOP != 0 {
            header_flags |= WHDR_BEGINLOOP_ENDLOOP;
            u32::MAX
        } else {
            header_flags &= !WHDR_BEGINLOOP_ENDLOOP;
            0
        };

        system.write_far(field(header, LOOPS_AT), &loops.to_le_bytes());
        system.write_far(
            field(header, FLAGS_AT),
            &(header_flags & !DONE).to_le_bytes(),
        );
    }

    if out::write(engine, device, header, HEADER_SIZE).await? != MMSYSERR_NOERROR {
        stop(engine).await?;
        return Ok(false);
    }

    Ok(true)
}

/// The sound playing stopped (seg3 `3d0`): reset where its header is not
/// done, unprepared, its device closed.
async fn stop(engine: &Engine) -> Result<(), Stop> {
    let (device, header) = {
        let system = engine.system();
        let sound = &system.mmsystem.sound;

        (sound.device, sound.header)
    };

    if device == 0 || header == 0 {
        return Ok(());
    }

    if checks::header_flags(&engine.system(), header) & DONE == 0 {
        out::reset(engine, device).await?;
    }

    out::unprepare(engine, device, header, HEADER_SIZE).await?;
    out::close(engine, device).await?;

    let mut system = engine.system();

    system.mmsystem.sound.device = 0;
    system.mmsystem.sound.header = 0;
    system.mmsystem.sound.done_at = None;
    Ok(())
}

/// MMSYSTEM's window's timer (seg4 `2af`, seg3 `2aa`): a sound played
/// with `SND_ASYNC` whose header has been done 300 milliseconds stopped,
/// as its window stops it. Called before anything that would find the
/// device still open.
pub async fn settle(engine: &Engine) -> Result<(), Stop> {
    let due = {
        let system = engine.system();
        let sound = &system.mmsystem.sound;

        sound.device != 0
            && sound.header != 0
            && sound
                .done_at
                .is_some_and(|done| system.clock.now(system.instructions) >= done + STOP_AFTER)
            && checks::header_flags(&system, sound.header) & DONE != 0
    };

    if due {
        stop(engine).await?;
    }

    Ok(())
}

impl System {
    /// The card's interrupt at `at` come and gone: the sound's header,
    /// done by it, sets MMSYSTEM's window's timer.
    pub(crate) fn note_sound_done(&mut self, at: f64) {
        let sound = &self.mmsystem.sound;

        if sound.header != 0
            && sound.done_at.is_none()
            && checks::header_flags(self, sound.header) & DONE != 0
        {
            self.mmsystem.sound.done_at = Some(at);
        }
    }
}

/// Waits for the sound's header to be done (seg3 `42b`), the time passed
/// to each of the card's interrupts in turn.
fn wait_done(engine: &Engine) -> Result<(), Stop> {
    wait_for(engine, |system| {
        let header = system.mmsystem.sound.header;

        header == 0 || checks::header_flags(system, header) & DONE != 0
    })
}

/// Waits, as a driver's caller spins, until `done`: the machine's time
/// passed to each of the card's interrupts in turn. Where the card is
/// still and will not come to it, the run stops: Windows would spin for
/// ever.
pub(crate) fn wait_for(engine: &Engine, done: impl Fn(&System) -> bool) -> Result<(), Stop> {
    loop {
        let wait = {
            let mut system = engine.system();

            if done(&system) {
                return Ok(());
            }

            let now = system.clock.now(system.instructions);
            let Some(due) = system.sound_card.dma.due else {
                return Err(Stop::Unsupported(
                    "a sound waited for that the card does not play",
                ));
            };
            let wait = (due - now).max(0.0);

            if system.clock.is_virtual() {
                let instructions = system.instructions;

                system.clock.advance(instructions, wait);
                system.poll_sound();
                0.0
            } else {
                wait
            }
        };

        if wait > 0.0 {
            std::thread::sleep(std::time::Duration::from_secs_f64(wait / 1000.0));
            engine.system().poll_sound();
        }
    }
}

/// A global block allocated, as `GlobalAlloc` allocates it: its handle,
/// or nought.
pub(crate) fn alloc(system: &mut System, flags: u16, size: u32) -> u16 {
    system
        .global
        .allocate(&mut system.cpu.bus, &mut system.descriptors, size, flags)
        .map_or(0, handle_for)
}

/// A global block's selector, as `GlobalLock` gives it: none for a block
/// discarded.
pub(crate) fn lock(system: &System, handle: u16) -> Option<u16> {
    let index = index_for(handle);

    (index != 0 && system.global.block(index).is_some() && !system.global.is_discarded(index))
        .then(|| segment_selector(index))
}

/// A global block let go, as `GlobalFree` lets it go.
pub(crate) fn free(system: &mut System, handle: u16) {
    let index = index_for(handle);

    system
        .global
        .free(&mut system.cpu.bus, &mut system.descriptors, index);
}

/// A far pointer and some bytes more, within its segment.
fn field(far: u32, at: u16) -> u32 {
    (far & 0xffff_0000) | u32::from((far as u16).wrapping_add(at))
}

#[cfg(test)]
impl super::State {
    /// The global block of the sound kept.
    pub(crate) fn sound_kept(&self) -> u16 {
        self.sound.kept
    }

    /// When the sound playing was done.
    pub(crate) fn sound_done_at(&self) -> Option<f64> {
        self.sound.done_at
    }
}

#[cfg(test)]
#[path = "sound_tests.rs"]
mod tests;
