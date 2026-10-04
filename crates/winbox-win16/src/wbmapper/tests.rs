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
/// Opened, its channels are the setup's, 13 to 16.
#[test]
fn the_mappers_capabilities() {
    let engine = mapper(true);
    let memory = block(&engine);

    assert_eq!(
        caps(&engine, memory),
        (
            crate::wbsound::MANUFACTURER,
            5,
            b"winbox.js MIDI Mapper".to_vec(),
            0,
            0x100,
            4,
        )
    );

    assert_eq!(open(&engine, at(memory, 0x100), 0), 0);
    assert_eq!(caps(&engine, memory).3, 0xf000);
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

/// **Read out** (seg2 `3c2`, `24b`): channel 1 goes nowhere; channels 13
/// to 16 go to the synthesizer, as the setup sends them; a data byte runs
/// on the mapper's running status, which a system message clears.
#[test]
fn channels_go_where_the_setup_sends_them() {
    let engine = mapper(true);
    let heard = Rc::new(RefCell::new(Vec::new()));

    engine.system().host = Some(HostSlot::new(Box::new(Listening(Rc::clone(&heard)))));

    let memory = block(&engine);

    assert_eq!(open(&engine, memory, 0), 0);

    let device = read_word(&engine, memory);

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
    let engine = mapper(true);
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
