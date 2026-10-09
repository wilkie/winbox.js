//! winbox.js's MIDI Mapper held to what `mididev` recorded of Windows' and
//! to `MIDIMAP.DRV`'s read-out, through MMSYSTEM's own calls, with
//! winbox.js's sound card's devices installed as `SYSTEM.INI` names them.

use std::cell::RefCell;
use std::rc::Rc;

use crate::audio::{MidiOutput, Sound};
use crate::call::Answer;
use crate::engine::Engine;
use crate::host::{Host, HostSlot};
use crate::mmsystem::device_tests::{
    Arg, CALLBACK_TASK, at, block, invoke, machine, posted, read_word, word,
};
use crate::mmsystem::devices;
use crate::system::System;

const MIDI_MAPPER: u16 = 0xffff;
const MM_MOM_OPEN: u16 = 0x3c7;
const MM_MOM_CLOSE: u16 = 0x3c8;
const MMDRVI_MAPPER: u16 = 0x8000;

/// The machine with the mapper installed as MMSYSTEM installs
/// `midimapper`, and winbox.js's sound card's driver before it where
/// `card`.
fn mapper(card: bool) -> Engine {
    let engine = machine();

    if card {
        let instance = {
            let mut system = engine.system();
            let kept = system.keep_on_load(&crate::wbsound::MODULE);

            system.stubs(kept);
            crate::wbsound::driver_proc(&mut system, 1, 2);
            system.kept[kept].instance()
        };

        for kind in [2u16, 1, 4, 3] {
            engine
                .run_now(devices::install(&engine, instance, None, kind))
                .unwrap();
        }
    }

    let instance = {
        let mut system = engine.system();
        let kept = system.keep_on_load(&super::MODULE);

        system.stubs(kept);
        system.kept[kept].instance()
    };
    let out = engine
        .run_now(devices::install(&engine, instance, None, MMDRVI_MAPPER | 4))
        .unwrap();
    let into = engine
        .run_now(devices::install(&engine, instance, None, MMDRVI_MAPPER | 3))
        .unwrap();

    assert_eq!((out, into), (11, 0), "for output only");
    engine
}

/// The installation's `MIDIMAP.CFG`, where the oracle's build is here.
fn installations_setups() -> Option<Vec<u8>> {
    std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../oracle/build/drive-c-vgasound/WINDOWS/SYSTEM/MIDIMAP.CFG"),
    )
    .ok()
}

/// The machine of `mapper(true)` with a drive C: holding `MIDIMAP.CFG`
/// where it is given.
fn mapper_on(setups: Option<Vec<u8>>) -> Engine {
    let engine = mapper(true);
    let mut drive = winbox_machine::MemoryDrive::new();

    assert!(drive.add_folder("\\WINDOWS", 0));
    assert!(drive.add_folder("\\WINDOWS\\SYSTEM", 0));

    if let Some(bytes) = setups {
        assert!(drive.add_file("\\WINDOWS\\SYSTEM\\MIDIMAP.CFG", bytes, 0));
    }

    engine.system().files.mount('C', drive);
    engine
}

/// The installation's `MIDIMAP.CFG` as the sound card installs it, `setup`
/// current (`setups::install`), where the oracle's build is here.
fn installed_with(setup: &str) -> Option<Vec<u8>> {
    installations_setups().map(|bytes| super::setups::install(&bytes, setup).unwrap())
}

/// The mapper opened on `engine`, the host listening: its handle, and what
/// the host hears.
fn opened(engine: &Engine) -> (u16, Rc<RefCell<Vec<Sound>>>) {
    let heard = Rc::new(RefCell::new(Vec::new()));

    engine.system().host = Some(HostSlot::new(Box::new(Listening(Rc::clone(&heard)))));

    let memory = block(engine);

    assert_eq!(open(engine, memory, 0), 0);
    (read_word(engine, memory), heard)
}

struct Listening(Rc<RefCell<Vec<Sound>>>);

impl Host for Listening {
    fn frame(&mut self, _: &mut System) -> bool {
        true
    }

    fn sound(&mut self, sound: &Sound) {
        self.0.borrow_mut().push(sound.clone());
    }
}

/// The MIDI bytes the host heard, and where they went.
fn heard_midi(heard: &RefCell<Vec<Sound>>) -> Vec<(MidiOutput, Vec<u8>)> {
    heard
        .borrow()
        .iter()
        .filter_map(|sound| match sound {
            Sound::Midi { output, bytes, .. } => Some((*output, bytes.clone())),
            _ => None,
        })
        .collect()
}

fn caps(engine: &Engine, far: u32) -> (u16, u16, Vec<u8>, u16, u16, u32) {
    let answer = word(invoke(
        engine,
        "midiOutGetDevCaps",
        &[Arg::W(MIDI_MAPPER), Arg::D(far), Arg::W(0x32)],
    ));

    assert_eq!(answer, 0);

    let bytes = engine.system().read_far(far, 0x32);
    let word_at = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let name = bytes[6..38]
        .iter()
        .copied()
        .take_while(|&byte| byte != 0)
        .collect();

    (
        word_at(0),
        word_at(38),
        name,
        word_at(44),
        word_at(4),
        u32::from_le_bytes([bytes[46], bytes[47], bytes[48], bytes[49]]),
    )
}

fn open(engine: &Engine, handle: u32, flags: u32) -> u16 {
    let task = u32::from(engine.system().task_handle);

    word(invoke(
        engine,
        "midiOutOpen",
        &[
            Arg::D(handle),
            Arg::W(MIDI_MAPPER),
            Arg::D(if flags == 0 { 0 } else { task }),
            Arg::D(0),
            Arg::D(flags),
        ],
    ))
}

fn short(engine: &Engine, device: u16, message: u32) -> u16 {
    word(invoke(
        engine,
        "midiOutShortMsg",
        &[Arg::W(device), Arg::D(message)],
    ))
}

/// **Recorded** by `mididev`: a mapper of no voices or notes that caches
/// patches, its channels none before it is opened; its name winbox.js's.
/// Opened, its channels are the setup's: with none named and no
/// `MIDIMAP.CFG`, "Ad Lib general"'s, all sixteen (**recorded** by
/// `adlibgm`); with "Ad Lib" current, 13 to 16 (seg3 `1254`, `f32`).
#[test]
fn the_mappers_capabilities() {
    the_mappers_capabilities_are(&mapper(true), 0xffff);

    if let Some(bytes) = installed_with("Ad Lib") {
        the_mappers_capabilities_are(&mapper_on(Some(bytes)), 0xf000);
    }
}

fn the_mappers_capabilities_are(engine: &Engine, mask: u16) {
    let memory = block(engine);

    assert_eq!(
        caps(engine, memory),
        (
            crate::wbsound::MANUFACTURER,
            5,
            b"WinBox MIDI Mapper".to_vec(),
            0,
            0x100,
            4,
        )
    );

    assert_eq!(open(engine, at(memory, 0x100), 0), 0);
    assert_eq!(caps(engine, memory).3, mask);
}

/// **Recorded** by `mididev`: opened with a window or a task, it is called
/// back as it opens and closes; the notes, the running status and the
/// controller of channel 1 answer nought; resetting and closing too. A
/// second open is `MMSYSERR_ALLOCATED`.
#[test]
fn the_mapper_opens_plays_and_closes_as_recorded() {
    let engine = mapper(true);
    let memory = block(&engine);

    assert_eq!(open(&engine, memory, CALLBACK_TASK), 0);

    let device = read_word(&engine, memory);

    assert_ne!(device, 0);
    assert_eq!(open(&engine, at(memory, 2), 0), 4);

    for message in [0x0040_3c90, 0x0000_403e, 0x0000_7bb0, 0x0040_3c80] {
        assert_eq!(short(&engine, device, message), 0);
    }

    assert_eq!(word(invoke(&engine, "midiOutReset", &[Arg::W(device)])), 0);
    assert_eq!(word(invoke(&engine, "midiOutClose", &[Arg::W(device)])), 0);

    let messages: Vec<(u16, u16, u32)> = posted(&engine);

    assert_eq!(
        messages,
        [(MM_MOM_OPEN, device, 0), (MM_MOM_CLOSE, device, 0)]
    );
}

/// **Read out** (seg2 `3c2`, `24b`): under "Ad Lib", channel 1 goes
/// nowhere; channels 13 to 16 go to the synthesizer, as the setup sends
/// them; a data byte runs on the mapper's running status, which a system
/// message clears.
#[test]
fn channels_go_where_the_setup_sends_them() {
    let Some(bytes) = installed_with("Ad Lib") else {
        return;
    };
    let engine = mapper_on(Some(bytes));
    let (device, heard) = opened(&engine);

    short(&engine, device, 0x0040_3c90);
    short(&engine, device, 0x0040_3c9c);
    short(&engine, device, 0x0000_403e);
    short(&engine, device, 0x0000_00f6);
    short(&engine, device, 0x0000_4040);

    assert_eq!(
        heard_midi(&heard),
        [
            (MidiOutput::Synthesizer, vec![0x9c, 0x3c, 0x40]),
            (MidiOutput::Synthesizer, vec![0x3e, 0x40]),
        ]
    );
}

/// **Read out** (seg3 `1bd7`-`1c8c`, `db8`): with no device the setup
/// names, opening it is `MIDIERR_NODEVICE`.
#[test]
fn a_device_of_the_setup_missing_is_no_device() {
    let engine = mapper(false);
    let memory = block(&engine);

    assert_eq!(open(&engine, memory, 0), 68);
}

/// **Read out** (seg3 `10a7`): each device asked to cache the patches of
/// the channels it plays; the synthesizer cannot, and the program is given
/// back the channels the setup sends.
#[test]
fn patches_are_cached_on_each_device() {
    let Some(bytes) = installed_with("Ad Lib") else {
        return;
    };
    let engine = mapper_on(Some(bytes));
    let memory = block(&engine);

    assert_eq!(open(&engine, memory, 0), 0);

    let device = read_word(&engine, memory);
    let patches = at(memory, 0x100);
    let mut bytes = vec![0u8; 0x100];

    bytes[0..2].copy_from_slice(&0xffffu16.to_le_bytes());
    engine.system().write_far(patches, &bytes);

    let answer = invoke(
        &engine,
        "midiOutCachePatches",
        &[Arg::W(device), Arg::W(0), Arg::D(patches), Arg::W(2)],
    );

    assert!(matches!(answer, Answer::Word(8)));
    assert_eq!(read_word(&engine, patches), 0xf000);
}

/// **Read out** (seg2 `d6`-`111`): a message the mapper passes on to its
/// devices answers what the last of them answered, kept in its frame;
/// asked by its number while it is closed, as `midiOutGetVolume` asks it,
/// it has opened none and its answer is whatever the frame held, which
/// stops the run rather than be made up.
#[test]
fn the_mapper_asked_for_its_volume_while_closed_stops() {
    let engine = mapper(true);
    let driver = engine
        .system()
        .mmsystem
        .devices
        .own_driver(super::NAME)
        .unwrap();
    let message = devices::Message {
        device: 0,
        message: 10,
        user: 0,
        first: block(&engine),
        second: 0,
    };

    assert!(matches!(
        engine.run_now(driver.message(&engine, devices::Kind::MidiOut, message)),
        Err(crate::call::Stop::Unsupported(_))
    ));
}

/// **Read out** (seg2 `d6`): opened, the same message goes to the
/// synthesizer, the one device the setup opens, and its answer is the
/// mapper's.
#[test]
fn the_mapper_passes_the_volume_to_its_device() {
    let engine = mapper(true);
    let memory = block(&engine);

    assert_eq!(open(&engine, memory, 0), 0);

    let driver = engine
        .system()
        .mmsystem
        .devices
        .own_driver(super::NAME)
        .unwrap();
    let message = devices::Message {
        device: 0,
        message: 10,
        user: 0,
        first: at(memory, 0x100),
        second: 0,
    };
    let mapped = engine.run_now(driver.message(&engine, devices::Kind::MidiOut, message));
    let synthesizer = engine.run_now(devices::send_by_id(
        &engine,
        devices::Kind::MidiOut,
        1,
        10,
        at(memory, 0x200),
        0,
    ));

    assert_eq!(mapped, synthesizer);
}

/// **Read out** (seg2 `24b`) and **recorded** by `adlibgm`: under "Ad Lib
/// general" every channel goes to the synthesizer, each to the same channel
/// but 10 and 16, which are swapped, so that General MIDI's drums play on
/// the synthesizer's percussion channel; by running status, the data bytes
/// alone, on the synthesizer's own running status.
#[test]
fn general_midi_goes_to_the_synthesizer() {
    general_midi_on(&mapper(true));

    if let Some(bytes) = installed_with("ad lib GENERAL") {
        general_midi_on(&mapper_on(Some(bytes)));
    }
}

/// `general_midi_goes_to_the_synthesizer` on a machine.
fn general_midi_on(engine: &Engine) {
    let (device, heard) = opened(engine);

    short(engine, device, 0x0040_3c90);
    short(engine, device, 0x0064_2399);
    short(engine, device, 0x0000_6426);
    short(engine, device, 0x0040_489f);
    short(engine, device, 0x0000_21c4);

    assert_eq!(
        heard_midi(&heard),
        [
            (MidiOutput::Synthesizer, vec![0x90, 0x3c, 0x40]),
            (MidiOutput::Synthesizer, vec![0x9f, 0x23, 0x64]),
            (MidiOutput::Synthesizer, vec![0x26, 0x64]),
            (MidiOutput::Synthesizer, vec![0x99, 0x48, 0x40]),
            (MidiOutput::Synthesizer, vec![0xc4, 0x21]),
        ]
    );
}

/// **Read out** (seg3 `3d41`, `db8`): a current setup that is not in the
/// file is `MIDIERR_INVALIDSETUP`; nor is one installed that is not there.
#[test]
fn a_setup_not_there_is_an_invalid_setup() {
    let Some(mut bytes) = installations_setups() else {
        return;
    };

    assert_eq!(super::setups::install(&bytes, "No Such Setup"), None);
    bytes[6..8].copy_from_slice(&101u16.to_le_bytes());

    let engine = mapper_on(Some(bytes));

    assert_eq!(open(&engine, block(&engine), 0), 69);
}

/// **Read out**: the installation's `MIDIMAP.CFG` read as the mapper
/// opens, its setups naming Windows' devices. Its current setup is "Ad
/// Lib", channels 13 to 16, the Ad Lib found as WinBox's synthesizer.
/// Installed: "LAPC1" names the "Roland MPU-401", which WinBox has not,
/// and is `MIDIERR_NODEVICE`; "General MIDI" sends every channel to
/// WinBox's card's MIDI port, which it names in place of the Sound
/// Blaster's.
#[test]
fn the_installations_setups_are_read_from_its_file() {
    let Some(bytes) = installations_setups() else {
        return;
    };
    let engine = mapper_on(Some(bytes.clone()));
    let memory = block(&engine);

    assert_eq!(open(&engine, at(memory, 0x100), 0), 0);
    assert_eq!(caps(&engine, memory).3, 0xf000);

    let engine = mapper_on(installed_with("LAPC1"));

    assert_eq!(open(&engine, block(&engine), 0), 68);

    let engine = mapper_on(installed_with("General MIDI"));
    let (device, heard) = opened(&engine);

    short(&engine, device, 0x0040_3c90);
    short(&engine, device, 0x0040_3c99);

    assert_eq!(
        heard_midi(&heard),
        [
            (MidiOutput::Port, vec![0x90, 0x3c, 0x40]),
            (MidiOutput::Port, vec![0x99, 0x3c, 0x40]),
        ]
    );
}

/// **Read out** (seg2 `24b`-`3bd`): "Proteus general" sends channel 1 to
/// the Sound Blaster's MIDI port through the "Prot/1" patch map: a program
/// change's program as the map has it, a note's key through the key map
/// of the program asked for -- program 16's, "+1 octave" -- and the
/// volume, controller 7, multiplied by the program's volume (100 in each
/// of the installation's maps) and divided by the map's divisor (100), and
/// no other controller; the program asked for kept past a close.
#[test]
fn a_patch_map_maps_what_goes_through_it() {
    let Some(bytes) = installations_setups() else {
        return;
    };
    let setup =
        super::setups::from_file(&bytes, super::setups::Wanted::Named(b"Proteus general")).unwrap();
    let map = setup.channels[0].patches.clone().unwrap();
    let engine = mapper_on(installed_with("Proteus general"));
    let (device, heard) = opened(&engine);

    short(&engine, device, 0x0000_10c0);
    short(&engine, device, 0x0064_3c90);
    short(&engine, device, 0x0050_07b0);
    short(&engine, device, 0x0050_0ab0);
    assert_eq!(word(invoke(&engine, "midiOutClose", &[Arg::W(device)])), 0);

    let (device, again) = opened(&engine);

    short(&engine, device, 0x0000_3c80);

    assert_eq!(
        heard_midi(&heard)[..4],
        [
            (MidiOutput::Port, vec![0xc0, map.patches[16].program]),
            (MidiOutput::Port, vec![0x90, 72, 0x64]),
            (MidiOutput::Port, vec![0xb0, 7, 0x50]),
            (MidiOutput::Port, vec![0xb0, 10, 0x50]),
        ]
    );
    assert_eq!(heard_midi(&again), [(MidiOutput::Port, vec![0x80, 72, 0])]);
}
