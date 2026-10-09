//! `sndPlaySound` held to its read-out and to `sndplay`'s records, the
//! sounds played on winbox.js's own sound card, the card's time passed on
//! the machine's clock.

use std::path::PathBuf;

use winbox_machine::{HostDrive, segment_selector};

use super::{SND_ASYNC, SND_LOOP, SND_MEMORY, SND_NODEFAULT, SND_NOSTOP};
use crate::engine::Engine;
use crate::mmsystem::device_tests::{Arg, block, invoke, machine, word};
use crate::mmsystem::devices;

/// 64 samples of silence at 11,025 a second, as `sndplay` writes it.
fn quiet() -> Vec<u8> {
    wave(64)
}

/// A waveform file of `samples` eight-bit samples at 11,025 a second.
fn wave(samples: u32) -> Vec<u8> {
    let mut bytes = b"RIFF".to_vec();

    bytes.extend_from_slice(&(36 + samples).to_le_bytes());
    bytes.extend_from_slice(
        b"WAVEfmt \x10\0\0\0\x01\0\x01\0\x11\x2b\0\0\x11\x2b\0\0\x01\0\x08\0data",
    );
    bytes.extend_from_slice(&samples.to_le_bytes());
    bytes.extend(std::iter::repeat_n(0x80, samples as usize));
    bytes
}

/// The machine with winbox.js's card installed, as MMSYSTEM installs it
/// from `SYSTEM.INI` -- the Sound Blaster's, as `sndplay` recorded it --
/// and drive C a folder of the test's own with `WINDOWS` in it, holding
/// `files`.
fn card(name: &str, files: &[(&str, &[u8])]) -> (Engine, PathBuf) {
    card_as(name, files, crate::wbsound::Profile::SoundBlaster)
}

/// The machine with the card installed as `profile`'s.
fn card_as(
    name: &str,
    files: &[(&str, &[u8])],
    profile: crate::wbsound::Profile,
) -> (Engine, PathBuf) {
    let engine = machine();
    let root = std::env::temp_dir().join(format!("winbox-snd-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);

    std::fs::create_dir_all(root.join("WINDOWS")).unwrap();

    for (path, bytes) in files {
        std::fs::write(root.join(path), bytes).unwrap();
    }

    let instance = {
        let mut system = engine.system();
        let kept = system.keep_on_load(&crate::wbsound::MODULE);

        system.files.mount('C', HostDrive::new(root.clone()));
        system.stubs(kept);
        crate::wbsound::driver_proc(&mut system, 1, 2);
        system.sound_card.profile = profile;
        system.kept[kept].instance()
    };

    for kind in [2u16, 1, 4, 3] {
        let place = engine
            .run_now(devices::install(&engine, instance, None, kind))
            .unwrap();

        assert_ne!(place, 0, "kind {kind}");
    }

    (engine, root)
}

/// A string in global memory: its far pointer.
fn text(engine: &Engine, text: &str) -> u32 {
    let far = block(engine);
    let mut bytes = text.as_bytes().to_vec();

    bytes.push(0);
    engine.system().write_far(far, &bytes);
    far
}

/// Bytes in a global block of their own: their far pointer.
fn bytes(engine: &Engine, bytes: &[u8]) -> u32 {
    let mut system = engine.system();
    let system = &mut *system;
    let index = system
        .global
        .allocate(
            &mut system.cpu.bus,
            &mut system.descriptors,
            bytes.len() as u32,
            0,
        )
        .unwrap();
    let far = u32::from(segment_selector(index)) << 16;

    system.write_far(far, bytes);
    far
}

fn play(engine: &Engine, name: u32, flags: u16) -> u16 {
    word(invoke(
        engine,
        "sndPlaySound",
        &[Arg::D(name), Arg::W(flags)],
    ))
}

/// What a program's `waveOutOpen` of the device answers: nought, or 4 while
/// MMSYSTEM has it. The device is closed again.
fn device_free(engine: &Engine) -> u16 {
    let memory = block(engine);
    let format = memory + 0x100;
    let handle = memory;

    engine.system().write_far(format, &quiet()[20..36]);

    let answer = word(invoke(
        engine,
        "waveOutOpen",
        &[
            Arg::D(handle),
            Arg::W(0),
            Arg::D(format),
            Arg::D(0),
            Arg::D(0),
            Arg::D(0),
        ],
    ));

    if answer == 0 {
        let device = crate::mmsystem::device_tests::read_word(engine, handle);

        assert_eq!(word(invoke(engine, "waveOutClose", &[Arg::W(device)])), 0);
    }

    answer
}

fn now(engine: &Engine) -> f64 {
    let system = engine.system();

    system.clock.now(system.instructions)
}

/// The clock moved on by `ms`, and the card's interrupts taken.
fn later(engine: &Engine, ms: f64) {
    let mut system = engine.system();
    let instructions = system.instructions;

    system.clock.advance(instructions, ms);
    system.poll_sound();
}

/// With no waveform device, nothing plays and the answer is nought,
/// whatever is asked (`sndplay`).
#[test]
fn with_no_device_nothing_plays() {
    let engine = machine();
    let sound = bytes(&engine, &quiet());

    assert_eq!(play(&engine, sound, SND_MEMORY), 0);
    assert_eq!(play(&engine, 0, 0), 0);
}

/// Without `SND_ASYNC` the call waits for the sound and closes the device:
/// the time has passed, and the device is free.
#[test]
fn a_sound_played_synchronously_is_waited_for() {
    let (engine, _) = card("sync", &[]);
    let sound = bytes(&engine, &wave(11025));
    let before = now(&engine);

    assert_eq!(play(&engine, sound, SND_MEMORY), 1);
    // A second at 11,025, played at 11,111, is done six halves on.
    assert!(now(&engine) - before >= 1000.0);
    assert_eq!(device_free(&engine), 0);
}

/// A second of sixteen-bit stereo at 44,100 a second, 176,400 bytes, as a
/// waveform file.
fn wide_wave() -> Vec<u8> {
    let length: u32 = 176_400;
    let mut bytes = b"RIFF".to_vec();

    bytes.extend_from_slice(&(36 + length).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt \x10\0\0\0\x01\0\x02\0");
    bytes.extend_from_slice(&44_100u32.to_le_bytes());
    bytes.extend_from_slice(&176_400u32.to_le_bytes());
    bytes.extend_from_slice(b"\x04\0\x10\0data");
    bytes.extend_from_slice(&length.to_le_bytes());
    bytes.extend((0..length).map(|at| (at % 251) as u8));
    bytes
}

/// A file of sixteen-bit stereo at 44,100 a second, past a segment, plays
/// on WinBox's own card, waited for its second; the Sound Blaster's card
/// takes no such format, and nothing plays.
#[test]
fn sixteen_bit_stereo_plays_on_winboxs_own_card() {
    let wave = wide_wave();
    let files: [(&str, &[u8]); 1] = [("WINDOWS/WIDE.WAV", &wave)];

    let (engine, _) = card_as("wide", &files, crate::wbsound::Profile::WinBox);
    let name = text(&engine, "C:\\WINDOWS\\WIDE.WAV");
    let before = now(&engine);

    assert_eq!(play(&engine, name, SND_NODEFAULT), 1);
    assert!(now(&engine) - before >= 1000.0);
    assert!(now(&engine) - before < 1100.0);
    assert_eq!(device_free(&engine), 0);

    let (engine, _) = card("narrow", &files);
    let name = text(&engine, "C:\\WINDOWS\\WIDE.WAV");
    let before = now(&engine);

    assert_eq!(play(&engine, name, SND_NODEFAULT), 0);
    assert!(now(&engine) - before < 1.0);
}

/// With `SND_ASYNC` the call answers at once and the device plays on;
/// MMSYSTEM's window closes it 300 milliseconds after the sound is done.
#[test]
fn a_sound_played_asynchronously_is_closed_after_it_is_done() {
    let (engine, _) = card("async", &[]);
    let sound = bytes(&engine, &quiet());
    let before = now(&engine);

    assert_eq!(play(&engine, sound, SND_MEMORY | SND_ASYNC), 1);
    assert!(now(&engine) - before < 1.0);
    assert_eq!(device_free(&engine), 4);

    // Its header done at an interrupt of the card's; 300 milliseconds on,
    // and not before, the device is let go.
    while engine.system().mmsystem.sound_done_at().is_none() {
        later(&engine, 10.0);
    }

    let done = engine.system().mmsystem.sound_done_at().unwrap();

    later(&engine, done + 299.0 - now(&engine));
    assert_eq!(device_free(&engine), 4);
    later(&engine, 1.0);
    assert_eq!(device_free(&engine), 0);
}

/// `SND_NOSTOP` while a sound plays answers nought; no name at all stops
/// it and answers 1.
#[test]
fn no_name_stops_the_sound_and_nostop_leaves_it() {
    let (engine, _) = card("stop", &[]);
    let sound = bytes(&engine, &wave(11025));

    assert_eq!(play(&engine, sound, SND_MEMORY | SND_ASYNC), 1);
    assert_eq!(play(&engine, sound, SND_MEMORY | SND_NOSTOP), 0);
    assert_eq!(device_free(&engine), 4);
    assert_eq!(play(&engine, 0, 0), 1);
    assert_eq!(device_free(&engine), 0);
    assert_eq!(engine.system().mmsystem.sound_kept(), 0);
}

/// A looping sound plays until it is stopped: its header never done.
#[test]
fn a_looping_sound_plays_until_stopped() {
    let (engine, _) = card("loop", &[]);
    let sound = bytes(&engine, &quiet());

    assert_eq!(play(&engine, sound, SND_MEMORY | SND_ASYNC | SND_LOOP), 1);
    later(&engine, 5000.0);
    assert_eq!(device_free(&engine), 4);
    assert_eq!(play(&engine, 0, 0), 1);
    assert_eq!(device_free(&engine), 0);
}

/// A flag past the five, or a loop that would be waited for, answers
/// nought; so does memory that is no waveform file.
#[test]
fn bad_flags_and_bad_sounds_answer_nought() {
    let (engine, _) = card("flags", &[]);
    let sound = bytes(&engine, &quiet());
    let mut riff = quiet();

    riff[8..12].copy_from_slice(b"AVI ");

    let bad = bytes(&engine, &riff);

    assert_eq!(play(&engine, sound, SND_MEMORY | SND_LOOP), 0);
    assert_eq!(play(&engine, sound, SND_MEMORY | 0x20), 0);
    assert_eq!(play(&engine, bad, SND_MEMORY), 0);
    assert_eq!(play(&engine, sound, SND_MEMORY), 1);
}

/// `sndplay`'s answers: a file played synchronously and asynchronously,
/// 1; a file not there, nought with and without `SND_NODEFAULT`, where
/// `[sounds]` names files that are not there; a name of no characters, 1.
#[test]
fn files_play_by_their_names() {
    let ini = b"[sounds]\r\nSystemDefault=ding.wav, Default Beep\r\nSystemStart=tada.wav, Windows Start\r\n";
    let (engine, _) = card(
        "files",
        &[("QUIET.WAV", &quiet()), ("WINDOWS/WIN.INI", ini)],
    );
    let quiet = text(&engine, "C:\\QUIET.WAV");
    let missing = text(&engine, "C:\\MISSING.WAV");
    let start = text(&engine, "SystemStart");
    let empty = text(&engine, "");

    assert_eq!(play(&engine, quiet, 0), 1);
    assert_eq!(play(&engine, quiet, SND_ASYNC), 1);
    assert_eq!(play(&engine, missing, 0), 0);
    assert_eq!(play(&engine, missing, SND_NODEFAULT), 0);
    assert_eq!(play(&engine, start, 0), 0);
    assert_eq!(play(&engine, empty, 0), 1);
    assert_eq!(play(&engine, 0, 0), 1);
}

/// A sound `[sounds]` names, and the default played in place of a file
/// that is not there.
#[test]
fn names_in_sounds_and_the_default_play() {
    let ini = b"[sounds]\r\nSystemDefault=ding.wav, Default Beep\r\nSystemAsterisk=chord.wav,Asterisk\r\n";
    let (engine, _) = card(
        "default",
        &[
            ("WINDOWS/DING.WAV", &quiet()),
            ("WINDOWS/CHORD.WAV", &quiet()),
            ("WINDOWS/WIN.INI", ini),
        ],
    );
    let missing = text(&engine, "C:\\MISSING.WAV");
    let asterisk = text(&engine, "SystemAsterisk");

    assert_eq!(play(&engine, missing, SND_NODEFAULT), 0);
    assert_eq!(play(&engine, missing, 0), 1);
    assert_eq!(play(&engine, asterisk, 0), 1);
}

/// The sound last loaded is kept, and a name it was loaded by plays it
/// again without another block; another sound takes its place.
#[test]
fn the_sound_last_loaded_is_kept() {
    let (engine, _) = card("kept", &[("ONE.WAV", &quiet()), ("TWO.WAV", &quiet())]);
    let one = text(&engine, "C:\\ONE.WAV");
    let again = text(&engine, "c:\\one.wav");
    let two = text(&engine, "C:\\TWO.WAV");

    assert_eq!(play(&engine, one, 0), 1);

    let kept = engine.system().mmsystem.sound_kept();

    assert_ne!(kept, 0);
    assert_eq!(play(&engine, again, 0), 1);
    assert_eq!(engine.system().mmsystem.sound_kept(), kept);

    // The name, kept past the header, is the path the file was found by.
    let selector = segment_selector(winbox_machine::index_for(kept));
    let name = engine
        .system()
        .read_string(u32::from(selector) << 16 | 0x20);

    assert_eq!(name, b"C:\\ONE.WAV");
    assert_eq!(play(&engine, two, 0), 1);
    assert_ne!(engine.system().mmsystem.sound_kept(), kept);
}

/// `MessageBeep` of a kind, as a program calls USER's.
fn beep(engine: &Engine, kind: u16) {
    let arguments = {
        let mut system = engine.system();
        let saved = system.cpu.regs[winbox_cpu::SP];
        let base = system.cpu.segments[winbox_cpu::SS].base;

        system
            .cpu
            .bus
            .write16(base + u32::from(saved.wrapping_sub(2)), kind);
        crate::call::Args::after_first(kind, base, u32::from(saved) - 2)
    };

    engine
        .run_now(super::message_beep(engine, arguments))
        .unwrap();
}

/// `MessageBeep` plays the sound `[sounds]` names for its icon, as the
/// sound driver's `DoBeep` asks `sndPlaySound` for it, while `Beep` is on.
#[test]
fn message_beep_plays_the_icons_sound() {
    let on = b"[windows]\r\nBeep=yes\r\n[sounds]\r\nSystemAsterisk=chord.wav,Asterisk\r\n";
    let (engine, _) = card(
        "beep",
        &[("WINDOWS/CHORD.WAV", &wave(11025)), ("WINDOWS/WIN.INI", on)],
    );

    // No sound for a question: the default's file is not there.
    beep(&engine, 0x20);
    assert_eq!(device_free(&engine), 0);
    beep(&engine, 0x40);
    assert_eq!(device_free(&engine), 4);

    let off = b"[windows]\r\nBeep=no\r\n[sounds]\r\nSystemAsterisk=chord.wav,Asterisk\r\n";
    let (engine, _) = card(
        "beep-off",
        &[
            ("WINDOWS/CHORD.WAV", &wave(11025)),
            ("WINDOWS/WIN.INI", off),
        ],
    );

    beep(&engine, 0x40);
    assert_eq!(device_free(&engine), 0);
}

/// A command string sent: what `mciSendString` answered, and the text it
/// gave back.
fn mci(engine: &Engine, command: &str) -> (u32, String) {
    let command = text(engine, command);
    let buffer = block(engine);
    let answer = match invoke(
        engine,
        "mciSendString",
        &[Arg::D(command), Arg::D(buffer), Arg::W(128), Arg::W(0)],
    ) {
        crate::call::Answer::Dword(answer) => answer,
        other => panic!("{other:?}"),
    };
    let text = engine.system().read_string(buffer);

    (answer, text.iter().map(|&byte| char::from(byte)).collect())
}

/// MCI's waveform device plays a file through the device and waits for
/// it (`sndplay`: `play quiet wait` answers nought); played, it is at its
/// end, and the device is free again. Seeking moves it; pausing with
/// nothing playing does not apply.
#[test]
fn mci_waveaudio_plays_and_waits() {
    let ini = b"[mci]\r\nWaveAudio=mciwave.drv\r\nSequencer=mciseq.drv\r\n";
    let (engine, _) = card(
        "mci",
        &[("QUIET.WAV", &wave(22050)), ("WINDOWS/SYSTEM.INI", ini)],
    );

    assert_eq!(
        mci(&engine, "open C:\\QUIET.WAV type waveaudio alias q"),
        (0, "1".to_string())
    );
    assert_eq!(mci(&engine, "status q length"), (0, "2000".to_string()));
    assert_eq!(mci(&engine, "status q position"), (0, "0".to_string()));

    let before = now(&engine);

    assert_eq!(mci(&engine, "play q wait"), (0, String::new()));
    // Two seconds at 11,025, played at 11,111.
    assert!(now(&engine) - before >= 1980.0);
    assert_eq!(device_free(&engine), 0);
    assert_eq!(mci(&engine, "status q position"), (0, "2000".to_string()));
    assert_eq!(mci(&engine, "status q mode"), (0, "stopped".to_string()));
    // At its end, it plays nothing.
    assert_eq!(mci(&engine, "play q wait"), (0, String::new()));
    assert_eq!(mci(&engine, "pause q"), (0x12e, String::new()));
    assert_eq!(mci(&engine, "seek q to start"), (0, String::new()));
    assert_eq!(mci(&engine, "status q position"), (0, "0".to_string()));
    assert_eq!(mci(&engine, "seek q to end"), (0, String::new()));
    assert_eq!(mci(&engine, "status q position"), (0, "2000".to_string()));
    assert_eq!(mci(&engine, "close q"), (0, String::new()));
}

/// The waveform's samples a host is handed, kept.
struct Listening(std::rc::Rc<std::cell::RefCell<Vec<crate::audio::Sound>>>);

impl crate::host::Host for Listening {
    fn frame(&mut self, _: &mut crate::system::System) -> bool {
        true
    }

    fn sound(&mut self, sound: &crate::audio::Sound) {
        if matches!(sound, crate::audio::Sound::Samples { .. }) {
            self.0.borrow_mut().push(sound.clone());
        }
    }
}

/// MCI's waveform device plays a second of sixteen-bit stereo at 44,100 a
/// second on WinBox's own card: its buffers of a second each, 176,400
/// bytes, filled past their first segment; the host handed the file's
/// bytes as they are, in that form; its position, asked of the device as
/// samples, made milliseconds.
#[test]
fn mci_waveaudio_plays_sixteen_bit_stereo_on_winboxs_own_card() {
    let ini = b"[mci]\r\nWaveAudio=mciwave.drv\r\n";
    let wave = wide_wave();
    let (engine, _) = card_as(
        "mci-wide",
        &[("WIDE.WAV", &wave), ("WINDOWS/SYSTEM.INI", ini)],
        crate::wbsound::Profile::WinBox,
    );
    let heard = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));

    engine.system().host = Some(crate::host::HostSlot::new(Box::new(Listening(
        std::rc::Rc::clone(&heard),
    ))));
    assert_eq!(
        mci(&engine, "open C:\\WIDE.WAV type waveaudio alias w"),
        (0, "1".to_string())
    );
    assert_eq!(mci(&engine, "status w length"), (0, "1000".to_string()));
    assert_eq!(mci(&engine, "play w to 250 wait"), (0, String::new()));
    assert_eq!(mci(&engine, "status w position"), (0, "250".to_string()));
    assert_eq!(mci(&engine, "seek w to start"), (0, String::new()));
    heard.borrow_mut().clear();

    let before = now(&engine);

    assert_eq!(mci(&engine, "play w wait"), (0, String::new()));
    assert!(now(&engine) - before >= 1000.0);
    assert_eq!(mci(&engine, "status w position"), (0, "1000".to_string()));
    assert_eq!(mci(&engine, "close w"), (0, String::new()));

    let mut bytes = Vec::new();

    for sound in heard.borrow().iter() {
        if let crate::audio::Sound::Samples {
            rate,
            channels,
            bits,
            samples,
            ..
        } = sound
        {
            assert_eq!((*rate, *channels, *bits), (44_100.0, 2, 16));
            bytes.extend_from_slice(samples);
        }
    }

    assert!(bytes.len() >= 176_400);
    assert!(
        bytes[..176_400] == wave[44..],
        "the file's bytes, as they are"
    );
}

/// The device in use -- a sound `sndPlaySound` plays -- MCI's waveform
/// device answers that its output is in use.
#[test]
fn mci_waveaudio_finds_the_device_in_use() {
    let ini = b"[mci]\r\nWaveAudio=mciwave.drv\r\n";
    let (engine, _) = card(
        "mci-busy",
        &[("QUIET.WAV", &quiet()), ("WINDOWS/SYSTEM.INI", ini)],
    );
    let sound = bytes(&engine, &wave(11025));

    assert_eq!(play(&engine, sound, SND_MEMORY | SND_ASYNC | SND_LOOP), 1);
    assert_eq!(
        mci(&engine, "open C:\\QUIET.WAV type waveaudio alias q").0,
        0
    );
    assert_eq!(mci(&engine, "play q wait"), (0x140, String::new()));
    assert_eq!(play(&engine, 0, 0), 1);
    assert_eq!(mci(&engine, "play q wait"), (0, String::new()));
}

/// The clock moved on, ten milliseconds at a time, until the device is
/// stopped, for no more than three seconds.
fn played_out(engine: &Engine) {
    for _ in 0..300 {
        if mci(engine, "status q mode").1 == "stopped" {
            return;
        }

        later(engine, 10.0);
    }

    panic!("still playing");
}

/// Without `MCI_WAIT` the play answers at once and goes on while the
/// program runs (`mciplay`): playing, the device in use and its position
/// moving; played out, stopped at its end, and the device free again.
#[test]
fn mci_waveaudio_plays_in_the_background() {
    let ini = b"[mci]\r\nWaveAudio=mciwave.drv\r\n";
    let (engine, _) = card(
        "mci-background",
        &[("TWO.WAV", &wave(22050)), ("WINDOWS/SYSTEM.INI", ini)],
    );

    assert_eq!(mci(&engine, "open C:\\TWO.WAV type waveaudio alias q").0, 0);

    let before = now(&engine);

    assert_eq!(mci(&engine, "play q"), (0, String::new()));
    assert!(now(&engine) - before < 1.0);
    assert_eq!(mci(&engine, "status q mode"), (0, "playing".to_string()));
    assert_eq!(device_free(&engine), 4);
    later(&engine, 300.0);
    assert_ne!(mci(&engine, "status q position"), (0, "0".to_string()));

    played_out(&engine);
    // Two seconds at 11,025, played at 11,111.
    assert!(now(&engine) - before >= 1980.0);
    assert_eq!(mci(&engine, "status q position"), (0, "2000".to_string()));
    assert_eq!(device_free(&engine), 0);
    assert_eq!(mci(&engine, "close q"), (0, String::new()));
}

/// A play under way paused holds still and resumed moves on; stopped, it
/// stays where it got to. A play from and to plays that much; a range past
/// the length, or ending before it begins, is out of range (`1220`).
#[test]
fn mci_waveaudio_pauses_resumes_and_stops() {
    let ini = b"[mci]\r\nWaveAudio=mciwave.drv\r\n";
    let (engine, _) = card(
        "mci-pause",
        &[("TWO.WAV", &wave(22050)), ("WINDOWS/SYSTEM.INI", ini)],
    );

    assert_eq!(mci(&engine, "open C:\\TWO.WAV type waveaudio alias q").0, 0);
    assert_eq!(mci(&engine, "play q"), (0, String::new()));
    later(&engine, 300.0);
    assert_eq!(mci(&engine, "pause q"), (0, String::new()));
    assert_eq!(mci(&engine, "status q mode"), (0, "paused".to_string()));

    let held = mci(&engine, "status q position");

    later(&engine, 200.0);
    assert_eq!(mci(&engine, "status q position"), held);
    assert_eq!(mci(&engine, "resume q"), (0, String::new()));
    assert_eq!(mci(&engine, "status q mode"), (0, "playing".to_string()));
    later(&engine, 400.0);
    assert_eq!(mci(&engine, "stop q"), (0, String::new()));
    assert_eq!(mci(&engine, "status q mode"), (0, "stopped".to_string()));

    let stopped = mci(&engine, "status q position");

    assert_ne!(stopped, held);
    assert_ne!(stopped, (0, "2000".to_string()));
    later(&engine, 200.0);
    assert_eq!(mci(&engine, "status q position"), stopped);
    assert_eq!(device_free(&engine), 0);
    assert_eq!(mci(&engine, "pause q"), (0x12e, String::new()));

    assert_eq!(mci(&engine, "play q from 500 to 1000"), (0, String::new()));
    played_out(&engine);
    assert_eq!(mci(&engine, "status q position"), (0, "1000".to_string()));
    assert_eq!(mci(&engine, "play q from 2001"), (0x11a, String::new()));
    assert_eq!(mci(&engine, "play q to 500"), (0x11a, String::new()));
    assert_eq!(mci(&engine, "seek q to 1500"), (0, String::new()));
    assert_eq!(mci(&engine, "status q position"), (0, "1500".to_string()));
    assert_eq!(mci(&engine, "seek q to 2001"), (0x11a, String::new()));
    assert_eq!(mci(&engine, "close q"), (0, String::new()));
}

/// A play in the background longer than the driver's buffers hold stops
/// the run: when Windows' task refills them was not recorded.
#[test]
fn mci_waveaudio_stops_at_a_background_play_its_buffers_do_not_hold() {
    let ini = b"[mci]\r\nWaveAudio=mciwave.drv\r\n";
    let (engine, _) = card(
        "mci-long",
        &[("LONG.WAV", &wave(11025 * 5)), ("WINDOWS/SYSTEM.INI", ini)],
    );

    assert_eq!(
        mci(&engine, "open C:\\LONG.WAV type waveaudio alias q").0,
        0
    );

    let command = text(&engine, "play q");
    let buffer = block(&engine);
    let answer = crate::mmsystem::device_tests::try_invoke(
        &engine,
        "mciSendString",
        &[Arg::D(command), Arg::D(buffer), Arg::W(128), Arg::W(0)],
    );

    assert!(
        matches!(answer, Err(crate::call::Stop::Unsupported(why)) if why.contains("buffers hold")),
        "{answer:?}"
    );
}

/// `Beep` with no value is off: USER's one character from
/// `GetProfileString` is no Y (`USER.EXE` seg3 `1243`). With no entry at
/// all, it is on.
#[test]
fn message_beep_is_off_where_beep_has_no_value() {
    let empty = b"[windows]\r\nBeep=\r\n[sounds]\r\nSystemAsterisk=chord.wav,Asterisk\r\n";
    let (engine, _) = card(
        "beep-empty",
        &[
            ("WINDOWS/CHORD.WAV", &wave(11025)),
            ("WINDOWS/WIN.INI", empty),
        ],
    );

    beep(&engine, 0x40);
    assert_eq!(device_free(&engine), 0);

    let none = b"[sounds]\r\nSystemAsterisk=chord.wav,Asterisk\r\n";
    let (engine, _) = card(
        "beep-none",
        &[
            ("WINDOWS/CHORD.WAV", &wave(11025)),
            ("WINDOWS/WIN.INI", none),
        ],
    );

    beep(&engine, 0x40);
    assert_eq!(device_free(&engine), 4);
}

/// A file shorter than its data chunk says: MCIWAVE lets go of buffers the
/// device still plays and leaves its device open (seg8 `0`, `29d`), which
/// winbox.js does not follow -- the run stops, where before it answered
/// as though the rest had been waited for.
#[test]
fn mci_waveaudio_stops_at_a_file_shorter_than_its_data() {
    let ini = b"[mci]\r\nWaveAudio=mciwave.drv\r\n";
    let mut short = wave(22050);

    short.truncate(short.len() - 100);

    let (engine, _) = card(
        "mci-short",
        &[("SHORT.WAV", &short), ("WINDOWS/SYSTEM.INI", ini)],
    );

    assert_eq!(
        mci(&engine, "open C:\\SHORT.WAV type waveaudio alias q").0,
        0
    );

    let command = text(&engine, "play q wait");
    let buffer = block(&engine);
    let answer = crate::mmsystem::device_tests::try_invoke(
        &engine,
        "mciSendString",
        &[Arg::D(command), Arg::D(buffer), Arg::W(128), Arg::W(0)],
    );

    assert!(
        matches!(answer, Err(crate::call::Stop::Unsupported(why)) if why.contains("shorter")),
        "{answer:?}"
    );
}
