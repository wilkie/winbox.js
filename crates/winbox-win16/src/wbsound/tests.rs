//! winbox.js's sound card driver held to what `wavedev` and `mididev`
//! recorded of the Sound Blaster 1.5 and Ad Lib drivers, through
//! MMSYSTEM's own calls, the card's time passed on the machine's clock.

use std::cell::RefCell;
use std::rc::Rc;

use winbox_machine::segment_selector;

use crate::audio::{MidiOutput, Sound};
use crate::call::Stop;
use crate::engine::Engine;
use crate::host::{Host, HostSlot};
use crate::mmsystem::device_tests::{
    Arg, CALLBACK_TASK, at, format, header, invoke, machine, posted, read_dword, read_word, word,
};
use crate::mmsystem::devices::{self, Kind, Message, OwnDriver};
use crate::system::System;

const WOM_OPEN: u16 = 0x3bb;
const WOM_CLOSE: u16 = 0x3bc;
const WOM_DONE: u16 = 0x3bd;
const MOM_DONE: u16 = 0x3c9;
const WIM_DATA: u16 = 0x3c0;

/// The task, called back by its handle: its queue holds what is posted.
fn task(engine: &Engine) -> u32 {
    u32::from(engine.system().task_handle)
}

/// The machine with the driver loaded, enabled and installed for each of
/// its kinds, as MMSYSTEM installs it from `SYSTEM.INI`.
fn card() -> Engine {
    let engine = machine();
    let instance = {
        let mut system = engine.system();
        let kept = system.keep_on_load(&super::MODULE);

        system.stubs(kept);
        super::driver_proc(&mut system, 1, 2);

        system.kept[kept].instance()
    };

    for kind in [2u16, 1, 4, 3] {
        let place = engine
            .run_now(devices::install(&engine, instance, None, kind))
            .unwrap();

        assert_ne!(place, 0, "kind {kind}");
    }

    engine
}

/// A block of global memory of `size` bytes, its bytes `fill`: its far
/// pointer.
fn memory(engine: &Engine, size: u32, fill: u8) -> u32 {
    let mut system = engine.system();
    let system = &mut *system;
    let index = system
        .global
        .allocate(&mut system.cpu.bus, &mut system.descriptors, size, 0)
        .unwrap();
    let far = u32::from(segment_selector(index)) << 16;

    system.write_far(far, &vec![fill; size as usize]);
    far
}

/// The clock moved on by `ms`, and the card's interrupts taken.
fn later(engine: &Engine, ms: f64) {
    let mut system = engine.system();
    let instructions = system.instructions;

    system.clock.advance(instructions, ms);
    system.poll_sound();
}

/// A format of `tag`, `rate`, `channels` and `bits` at `far`, as the
/// probe makes one.
fn pcm(engine: &Engine, far: u32, tag: u16, rate: u32, channels: u16, bits: u16) {
    let align = channels * (bits / 8);
    let mut bytes = Vec::new();

    bytes.extend_from_slice(&tag.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * u32::from(align)).to_le_bytes());
    bytes.extend_from_slice(&align.to_le_bytes());
    bytes.extend_from_slice(&bits.to_le_bytes());
    engine.system().write_far(far, &bytes);
}

fn open(engine: &Engine, handle: u32, format: u32, callback: u32, flags: u32) -> u16 {
    word(invoke(
        engine,
        "waveOutOpen",
        &[
            Arg::D(handle),
            Arg::W(0),
            Arg::D(format),
            Arg::D(callback),
            Arg::D(0),
            Arg::D(flags),
        ],
    ))
}

fn on_header(engine: &Engine, name: &str, device: u16, header: u32, size: u16) -> u16 {
    word(invoke(
        engine,
        name,
        &[Arg::W(device), Arg::D(header), Arg::W(size)],
    ))
}

/// **Recorded** by `wavedev`: the formats the device takes and refuses.
#[test]
fn the_device_takes_eight_bit_mono_up_to_23000() {
    let engine = card();
    let memory = memory(&engine, 0x100, 0);
    let mut answers = Vec::new();

    for (tag, rate, channels, bits) in [
        (1, 8000, 1, 8),
        (1, 8000, 1, 16),
        (1, 8000, 2, 8),
        (1, 11025, 1, 8),
        (1, 22050, 1, 8),
        (1, 44100, 1, 8),
        (1, 5000, 1, 8),
        (1, 48000, 1, 8),
        (2, 11025, 1, 4),
    ] {
        pcm(&engine, memory, tag, rate, channels, bits);
        answers.push(open(&engine, 0, memory, 0, 1));
    }

    assert_eq!(answers, [0, 32, 32, 0, 0, 32, 0, 32, 32]);
}

/// The capabilities as recorded, but for winbox.js's own name, numbers
/// and version.
#[test]
fn the_capabilities_are_the_sound_blasters_under_winbox_js_names() {
    let engine = card();
    let caps = memory(&engine, 0x100, 0);

    assert_eq!(
        word(invoke(
            &engine,
            "waveOutGetDevCaps",
            &[Arg::W(0), Arg::D(caps), Arg::W(0x30)]
        )),
        0
    );

    let bytes = engine.system().read_far(caps, 0x30);

    assert_eq!(&bytes[6..21], b"winbox.js Sound");
    assert_eq!(read_dword(&engine, at(caps, 0x26)), 0x11);
    assert_eq!(read_word(&engine, at(caps, 0x2a)), 1);
    assert_eq!(read_dword(&engine, at(caps, 0x2c)), 0);
    assert_eq!(word(invoke(&engine, "midiOutGetNumDevs", &[])), 2);
    assert_eq!(word(invoke(&engine, "midiInGetNumDevs", &[])), 1);
    assert_eq!(word(invoke(&engine, "waveInGetNumDevs", &[])), 1);

    // The synthesizer: an FM synthesizer of eleven voices.
    invoke(
        &engine,
        "midiOutGetDevCaps",
        &[Arg::W(1), Arg::D(caps), Arg::W(0x32)],
    );
    assert_eq!(read_word(&engine, at(caps, 0x26)), 4);
    assert_eq!(read_word(&engine, at(caps, 0x28)), 11);
    assert_eq!(read_word(&engine, at(caps, 0x2c)), 0xff);
}

/// **Recorded** by `wavedev`: a second at 11,025 a second done in 1.1
/// seconds -- six halves of the card's buffer at 11,111 a second, 1,106
/// milliseconds -- its flags through prepared, queued and done, and the
/// position its bytes after.
#[test]
fn a_second_is_done_six_halves_on() {
    let engine = card();
    let memory = memory(&engine, 0x100, 0);
    let samples = self::memory(&engine, 11025, 0x80);

    format(&engine, memory);
    assert_eq!(
        open(
            &engine,
            at(memory, 0x40),
            memory,
            task(&engine),
            CALLBACK_TASK
        ),
        0
    );

    let device = read_word(&engine, at(memory, 0x40));
    let hdr = at(memory, 0x60);

    header(&engine, hdr, samples, 11025, 0x20);
    assert_eq!(on_header(&engine, "waveOutWrite", device, hdr, 0x20), 34);
    assert_eq!(
        on_header(&engine, "waveOutPrepareHeader", device, hdr, 0x20),
        0
    );
    assert_eq!(on_header(&engine, "waveOutWrite", device, hdr, 0x20), 0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 0x12);
    assert_eq!(
        on_header(&engine, "waveOutUnprepareHeader", device, hdr, 0x20),
        33
    );
    assert_eq!(word(invoke(&engine, "waveOutClose", &[Arg::W(device)])), 33);

    later(&engine, 1100.0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)) & 1, 0, "done too soon");
    later(&engine, 10.0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 3);

    let messages: Vec<(u16, u32)> = posted(&engine)
        .iter()
        .map(|&(message, _, lparam)| (message, lparam))
        .collect();

    assert_eq!(messages, [(WOM_OPEN, 0), (WOM_DONE, hdr)]);

    // The position: bytes, and samples for every other kind.
    let time = at(memory, 0xa0);

    for (kind, answered) in [(4u16, 4u16), (2, 2), (1, 2), (8, 2), (16, 2)] {
        engine.system().write_far(time, &kind.to_le_bytes());
        invoke(
            &engine,
            "waveOutGetPosition",
            &[Arg::W(device), Arg::D(time), Arg::W(12)],
        );
        assert_eq!(read_word(&engine, time), answered);
        assert_eq!(read_dword(&engine, at(time, 2)), 11025);
    }

    assert_eq!(word(invoke(&engine, "waveOutClose", &[Arg::W(device)])), 0);
    assert_eq!(posted(&engine).last().map(|each| each.0), Some(WOM_CLOSE));
}

/// **Recorded** by `wavedev`: a reset calls the header done at once, and
/// puts the position back to nought; a write while paused plays nothing
/// until the restart, and is done 1.1 seconds after it.
#[test]
fn reset_and_pause() {
    let engine = card();
    let memory = memory(&engine, 0x100, 0);
    let samples = self::memory(&engine, 11025, 0x80);

    format(&engine, memory);
    open(
        &engine,
        at(memory, 0x40),
        memory,
        task(&engine),
        CALLBACK_TASK,
    );

    let device = read_word(&engine, at(memory, 0x40));
    let hdr = at(memory, 0x60);
    let time = at(memory, 0xa0);
    let position = |engine: &Engine| {
        engine.system().write_far(time, &4u16.to_le_bytes());
        invoke(
            engine,
            "waveOutGetPosition",
            &[Arg::W(device), Arg::D(time), Arg::W(12)],
        );
        read_dword(engine, at(time, 2))
    };

    header(&engine, hdr, samples, 11025, 0x20);
    on_header(&engine, "waveOutPrepareHeader", device, hdr, 0x20);
    on_header(&engine, "waveOutWrite", device, hdr, 0x20);
    later(&engine, 100.0);
    assert_eq!(word(invoke(&engine, "waveOutReset", &[Arg::W(device)])), 0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 3);
    assert_eq!(position(&engine), 0);

    assert_eq!(word(invoke(&engine, "waveOutPause", &[Arg::W(device)])), 0);
    assert_eq!(on_header(&engine, "waveOutWrite", device, hdr, 0x20), 0);
    later(&engine, 300.0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 0x12);
    assert_eq!(position(&engine), 0);
    assert_eq!(
        word(invoke(&engine, "waveOutRestart", &[Arg::W(device)])),
        0
    );
    // Played out by now, and marked by the driver as put aside: its own
    // bit, the flags' highest, until the next fill calls it done.
    later(&engine, 1100.0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 0x8000_0012);
    later(&engine, 10.0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 3);
}

/// **Recorded** by `mmdevs` on the card's installation: with output open,
/// input cannot be, nor output a second time.
#[test]
fn the_converter_is_one_devices_at_a_time() {
    let engine = card();
    let memory = memory(&engine, 0x100, 0);

    format(&engine, memory);
    assert_eq!(open(&engine, at(memory, 0x40), memory, 0, 0), 0);
    assert_eq!(open(&engine, at(memory, 0x42), memory, 0, 0), 4);
    assert_eq!(
        word(invoke(
            &engine,
            "waveInOpen",
            &[
                Arg::D(at(memory, 0x44)),
                Arg::W(0),
                Arg::D(memory),
                Arg::D(0),
                Arg::D(0),
                Arg::D(0),
            ],
        )),
        4
    );
}

/// What the card records with nothing connected to it: silence, a buffer
/// done as the half that fills it is taken.
#[test]
fn input_records_silence_at_the_cards_rate() {
    let engine = card();
    let memory = memory(&engine, 0x100, 0);
    let data = self::memory(&engine, 1000, 0x11);

    format(&engine, memory);
    assert_eq!(
        word(invoke(
            &engine,
            "waveInOpen",
            &[
                Arg::D(at(memory, 0x40)),
                Arg::W(0),
                Arg::D(memory),
                Arg::D(task(&engine)),
                Arg::D(0),
                Arg::D(CALLBACK_TASK),
            ],
        )),
        0
    );

    let device = read_word(&engine, at(memory, 0x40));
    let hdr = at(memory, 0x60);

    header(&engine, hdr, data, 1000, 0x20);
    on_header(&engine, "waveInPrepareHeader", device, hdr, 0x20);
    assert_eq!(on_header(&engine, "waveInAddBuffer", device, hdr, 0x20), 0);
    assert_eq!(word(invoke(&engine, "waveInStart", &[Arg::W(device)])), 0);
    later(&engine, 150.0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 0x12);
    later(&engine, 50.0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 3);
    assert_eq!(read_dword(&engine, at(hdr, 8)), 1000);
    assert!(
        engine
            .system()
            .read_far(data, 1000)
            .iter()
            .all(|&byte| byte == 0x80)
    );
    assert_eq!(posted(&engine).last().map(|each| each.0), Some(WIM_DATA));
}

/// What the host is handed.
#[derive(Default)]
struct Listening(Rc<RefCell<Vec<Sound>>>);

impl Host for Listening {
    fn frame(&mut self, _: &mut System) -> bool {
        true
    }

    fn sound(&mut self, sound: &Sound) {
        self.0.borrow_mut().push(sound.clone());
    }
}

/// The host hears each half of the buffer once the card has played it,
/// at the card's own rate; the MIDI port's messages as they are sent; a
/// long message is done at once.
#[test]
fn the_host_hears_what_the_card_plays() {
    let engine = card();
    let heard = Rc::new(RefCell::new(Vec::new()));

    engine.system().host = Some(HostSlot::new(Box::new(Listening(Rc::clone(&heard)))));

    let memory = memory(&engine, 0x100, 0);
    let samples = self::memory(&engine, 3000, 0x90);

    format(&engine, memory);
    open(&engine, at(memory, 0x40), memory, 0, 0);

    let device = read_word(&engine, at(memory, 0x40));
    let hdr = at(memory, 0x60);

    header(&engine, hdr, samples, 3000, 0x20);
    on_header(&engine, "waveOutPrepareHeader", device, hdr, 0x20);
    on_header(&engine, "waveOutWrite", device, hdr, 0x20);
    later(&engine, 200.0);
    assert_eq!(heard.borrow().len(), 1, "the first half, once played");
    later(&engine, 200.0);

    {
        let heard = heard.borrow();
        let halves: Vec<(f64, usize, u8)> = heard
            .iter()
            .filter_map(|sound| match sound {
                Sound::Samples { rate, samples, .. } => {
                    Some((*rate, samples.len(), samples[samples.len() - 1]))
                }
                _ => None,
            })
            .collect();

        assert_eq!(halves.len(), 2);
        assert!((halves[0].0 - 1_000_000.0 / 90.0).abs() < 1e-6);
        assert_eq!((halves[0].1, halves[0].2), (0x800, 0x90));
        // The second half: the rest of the 3,000 bytes, then silence.
        assert_eq!((halves[1].1, halves[1].2), (0x800, 0x80));
    }

    // The MIDI port: a note on, its running status, a long message.
    word(invoke(
        &engine,
        "midiOutOpen",
        &[
            Arg::D(at(memory, 0x44)),
            Arg::W(0),
            Arg::D(task(&engine)),
            Arg::D(0),
            Arg::D(CALLBACK_TASK),
        ],
    ));

    let midi = read_word(&engine, at(memory, 0x44));
    let long = at(memory, 0xc0);
    let sysex = at(memory, 0xe0);

    invoke(
        &engine,
        "midiOutShortMsg",
        &[Arg::W(midi), Arg::D(0x0040_3c90)],
    );
    invoke(
        &engine,
        "midiOutShortMsg",
        &[Arg::W(midi), Arg::D(0x0000_403e)],
    );
    engine
        .system()
        .write_far(sysex, &[0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7]);
    header(&engine, long, sysex, 6, 0x1c);
    on_header(&engine, "midiOutPrepareHeader", midi, long, 0x1c);
    assert_eq!(on_header(&engine, "midiOutLongMsg", midi, long, 0x1c), 0);
    assert_eq!(read_dword(&engine, at(long, 0x10)), 3);
    assert_eq!(posted(&engine).last().map(|each| each.0), Some(MOM_DONE));

    let sent: Vec<Vec<u8>> = heard
        .borrow()
        .iter()
        .filter_map(|sound| match sound {
            Sound::Midi {
                output: MidiOutput::Port,
                bytes,
                ..
            } => Some(bytes.clone()),
            _ => None,
        })
        .collect();

    assert_eq!(
        sent,
        [
            vec![0x90, 0x3c, 0x40],
            vec![0x3e, 0x40],
            vec![0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7]
        ]
    );
}

/// `SYSTEM.INI` with the driver named for waveform and MIDI devices.
#[test]
fn installing_names_the_driver_in_drivers() {
    let text = b"[boot]\r\nshell=progman.exe\r\n\r\n[drivers]\r\ntimer=timer.drv\r\nmidimapper=midimap.drv\r\n";
    let installed = String::from_utf8(super::install(text)).unwrap();

    assert!(installed.contains(
        "[drivers]\r\ntimer=timer.drv\r\nmidimapper=midimap.drv\r\nwave=WBSOUND.DRV\r\nmidi=WBSOUND.DRV"
    ));
}

/// The engine with a host listening, and what it hears.
fn listening() -> (Engine, Rc<RefCell<Vec<Sound>>>) {
    let engine = card();
    let heard = Rc::new(RefCell::new(Vec::new()));

    engine.system().host = Some(HostSlot::new(Box::new(Listening(Rc::clone(&heard)))));
    (engine, heard)
}

/// The samples the host has been handed, in turn.
fn samples_heard(heard: &RefCell<Vec<Sound>>) -> Vec<Vec<u8>> {
    heard
        .borrow()
        .iter()
        .filter_map(|sound| match sound {
            Sound::Samples { samples, .. } => Some(samples.clone()),
            Sound::Midi { .. } | Sound::Silence { .. } => None,
        })
        .collect()
}

/// The device opened at 11,025 a second with no callback, and headers of
/// `lengths` bytes, each its own byte, prepared: its handle and theirs.
fn opened_with(engine: &Engine, lengths: &[(u32, u8)]) -> (u16, Vec<u32>) {
    let memory = memory(engine, 0x200, 0);

    format(engine, memory);
    assert_eq!(open(engine, at(memory, 0x40), memory, 0, 0), 0);

    let device = read_word(engine, at(memory, 0x40));
    let headers = lengths
        .iter()
        .zip(0u32..)
        .map(|(&(length, byte), each)| {
            let data = self::memory(engine, length, byte);
            let hdr = at(memory, 0x60 + 0x20 * each);

            header(engine, hdr, data, length, 0x20);
            assert_eq!(
                on_header(engine, "waveOutPrepareHeader", device, hdr, 0x20),
                0
            );
            hdr
        })
        .collect();

    (device, headers)
}

/// **Read out** of `SNDBLST2.DRV`: a header written while the card plays a
/// short one goes into the silence after it, in the half the card is
/// playing (seg4 `8f3`), and `[61h]` is left naming that first half (seg4
/// `919`) as the card's DMA runs on into the second (seg4 `75c`). The host
/// hears the first half with both headers in it, then the second, silent
/// -- not the first half twice.
#[test]
fn the_host_hears_a_header_written_into_the_half_being_played() {
    let (engine, heard) = listening();
    let (device, headers) = opened_with(&engine, &[(1024, 0x11), (1024, 0x22)]);

    assert_eq!(
        on_header(&engine, "waveOutWrite", device, headers[0], 0x20),
        0
    );
    assert_eq!(
        on_header(&engine, "waveOutWrite", device, headers[1], 0x20),
        0
    );
    assert!(samples_heard(&heard).is_empty(), "nothing played yet");
    later(&engine, 400.0);

    let mut first = vec![0x11; 1024];

    first.extend([0x22; 1024]);
    assert_eq!(samples_heard(&heard), [first, vec![0x80; 2048]]);
    assert_eq!(read_dword(&engine, at(headers[1], 0x10)), 3);
}

/// Reset part way through a half, the host is handed as much of it as the
/// card played: a hundred milliseconds at 11,111 a second, 1,111 bytes.
#[test]
fn reset_hands_the_host_what_was_played_of_the_half() {
    let (engine, heard) = listening();
    let (device, headers) = opened_with(&engine, &[(3000, 0x90)]);

    on_header(&engine, "waveOutWrite", device, headers[0], 0x20);
    later(&engine, 100.0);
    assert!(samples_heard(&heard).is_empty());
    assert_eq!(word(invoke(&engine, "waveOutReset", &[Arg::W(device)])), 0);

    let played = samples_heard(&heard);

    assert_eq!(played.len(), 1);
    assert_eq!(played[0], vec![0x90; 1111]);
    later(&engine, 400.0);
    assert_eq!(samples_heard(&heard).len(), 1, "halted");
}

/// A message to the waveform output device, as MMSYSTEM sends it.
fn wod(engine: &Engine, message: u16, first: u32, second: u32) -> Result<u32, Stop> {
    engine.run_now(super::WbSound.message(
        engine,
        Kind::WaveOut,
        Message {
            device: 0,
            message,
            user: u32::from(super::wave_out::INSTANCE),
            first,
            second,
        },
    ))
}

/// **Read out** of `SNDBLST2.DRV`: the size a program gives for the
/// capabilities and for the position is the low word of the message's
/// second doubleword (seg4 `46a`, `483`), its high word unread.
#[test]
fn the_sizes_given_are_words() {
    let engine = card();
    let caps = memory(&engine, 0x100, 0xee);

    assert_eq!(wod(&engine, 4, caps, 0x1_0010), Ok(0));
    assert_eq!(engine.system().read_far(caps, 0x11)[0x10], 0xee);
    assert_eq!(read_word(&engine, caps), super::MANUFACTURER);
    assert_eq!(wod(&engine, 13, at(caps, 0x80), 0x1_0004), Ok(1));
    assert_eq!(wod(&engine, 13, at(caps, 0x80), 0x2_000c), Ok(0));
}

/// **Read out** of `SNDBLST2.DRV`: a loop's end with no beginning and a
/// header after it has the driver walk from a null pointer (seg1
/// `78c`-`797`), a fault: the run stops rather than go on as Windows
/// would not.
#[test]
fn a_loops_end_with_no_beginning_stops_the_run() {
    let engine = card();
    let (device, headers) = opened_with(&engine, &[(100, 0x90), (100, 0x90)]);
    let flags = read_dword(&engine, at(headers[0], 0x10));

    engine
        .system()
        .write_far(at(headers[0], 0x10), &(flags | 8).to_le_bytes());
    assert_eq!(word(invoke(&engine, "waveOutPause", &[Arg::W(device)])), 0);

    for &hdr in &headers {
        assert_eq!(on_header(&engine, "waveOutWrite", device, hdr, 0x20), 0);
    }

    assert!(matches!(wod(&engine, 11, 0, 0), Err(Stop::Unsupported(_))));
    assert!(matches!(wod(&engine, 3, 0, 0), Err(Stop::Unsupported(_))));
}

/// **Read out** of `SNDBLST2.DRV`: MIDI input's buffers returned by a
/// reset carry the time since it started as `timeGetTime` counts it,
/// whole milliseconds subtracted (seg5 `20`-`29`).
#[test]
fn midi_input_times_are_whole_milliseconds() {
    let engine = card();

    later(&engine, 0.6);

    let memory = memory(&engine, 0x100, 0);

    assert_eq!(
        word(invoke(
            &engine,
            "midiInOpen",
            &[Arg::D(memory), Arg::W(0), Arg::D(0), Arg::D(0), Arg::D(0)],
        )),
        0
    );

    let device = read_word(&engine, memory);
    let hdr = at(memory, 0x40);

    header(&engine, hdr, at(memory, 0x80), 0x20, 0x1c);
    on_header(&engine, "midiInPrepareHeader", device, hdr, 0x1c);
    assert_eq!(on_header(&engine, "midiInAddBuffer", device, hdr, 0x1c), 0);
    later(&engine, 9.8);

    let calls = {
        let mut system = engine.system();
        let mut card = std::mem::take(&mut system.sound_card);
        let mut calls = Vec::new();

        super::midi::reset_input(&mut card, &mut system, &mut calls);
        system.sound_card = card;
        calls
    };

    assert_eq!(calls.len(), 1);
    assert_eq!((calls[0].first, calls[0].second), (hdr, 10));
}
