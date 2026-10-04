//! The device layer pinned with a driver of the tests' own: the numbering
//! across drivers, the handles, what MMSYSTEM checks before a driver hears
//! of a call, the messages it sends and in what order, and the callbacks.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use winbox_cpu::{SP, SS};
use winbox_machine::segment_selector;
use winbox_ne::Executable;

use super::callback::driver_callback;
use super::devices::{Answering, Kind, MAPPER, Message, OwnDriver};
use crate::call::{Answer, Args, Implementation, Stop};
use crate::engine::Engine;
use crate::system::{STEP, System};

const WOM_OPEN: u16 = 0x3bb;
const WOM_CLOSE: u16 = 0x3bc;
const WOM_DONE: u16 = 0x3bd;
const MOM_OPEN: u16 = 0x3c7;
const MOM_DONE: u16 = 0x3c9;

const CALLBACK_WINDOW: u32 = 0x1_0000;
const CALLBACK_TASK: u32 = 0x2_0000;
const CALLBACK_FUNCTION: u32 = 0x3_0000;

/// A program of two segments, as `first_call.rs` makes one: code, fixed,
/// that far-calls `InitTask` and halts, with room past it for a callback;
/// and 16 bytes of data.
fn program() -> Vec<u8> {
    let mut file = vec![0u8; 0x1a0];
    let ne = 0x80;
    let put = |file: &mut Vec<u8>, at: usize, value: u16| {
        file[at..at + 2].copy_from_slice(&value.to_le_bytes());
    };

    file[0..2].copy_from_slice(b"MZ");
    file[60] = ne as u8;
    file[ne..ne + 2].copy_from_slice(b"NE");
    put(&mut file, ne + 0x04, 0x60);
    put(&mut file, ne + 0x0c, 0x0002);
    put(&mut file, ne + 0x0e, 2);
    put(&mut file, ne + 0x10, 0x100);
    put(&mut file, ne + 0x12, 0x400);
    put(&mut file, ne + 0x16, 1);
    put(&mut file, ne + 0x1a, 2);
    put(&mut file, ne + 0x1c, 2);
    put(&mut file, ne + 0x1e, 1);
    put(&mut file, ne + 0x22, 0x40);
    put(&mut file, ne + 0x24, 0x50);
    put(&mut file, ne + 0x26, 0x50);
    put(&mut file, ne + 0x28, 0x52);
    put(&mut file, ne + 0x2a, 0x54);
    put(&mut file, ne + 0x32, 4);
    // Code at 100h, 60h bytes, with relocations; data at 180h, 16 bytes.
    for (at, value) in [(0x40, 0x10), (0x42, 0x60), (0x44, 0x100), (0x46, 0x60)] {
        put(&mut file, ne + at, value);
    }
    for (at, value) in [(0x48, 0x18), (0x4a, 16), (0x4c, 0x0001), (0x4e, 16)] {
        put(&mut file, ne + at, value);
    }
    put(&mut file, ne + 0x52, 1);
    file[ne + 0x55] = 6;
    file[ne + 0x56..ne + 0x5c].copy_from_slice(b"KERNEL");
    file[0x100..0x106].copy_from_slice(&[0x9a, 0xff, 0xff, 0x00, 0x00, 0xf4]);
    // At 10h, a callback that copies its sixteen bytes of arguments to
    // the data segment's first sixteen and returns.
    let mut callback = vec![0x55, 0x8b, 0xec, 0x1e, 0x16, 0x1f];

    for word in 0..8u8 {
        callback.extend_from_slice(&[0x8b, 0x46, 6 + 2 * word, 0xa3, 2 * word, 0x00]);
    }

    callback.extend_from_slice(&[0x1f, 0x5d, 0xca, 0x10, 0x00]);
    file[0x110..0x110 + callback.len()].copy_from_slice(&callback);
    put(&mut file, 0x160, 1);
    file[0x162..0x16a].copy_from_slice(&[3, 1, 1, 0, 1, 0, 91, 0]);
    file
}

/// Where the callback is.
fn function() -> u32 {
    u32::from(segment_selector(1)) << 16 | 0x10
}

/// A device's open, as the driver was given it.
#[derive(Debug, Clone, Copy)]
struct Opened {
    handle: u16,
    callback: u32,
    instance: u32,
    flags: u32,
}

/// A driver of the tests' own: so many devices of each kind, every
/// message logged, the devices in `refuse` refusing to open.
#[derive(Default)]
struct TestDriver {
    devices: RefCell<Vec<(Kind, u32)>>,
    log: RefCell<Vec<(Kind, Message)>>,
    refuse: RefCell<Vec<u16>>,
    /// What preparing a header answers.
    prepare: Cell<u32>,
    opened: RefCell<Vec<(u32, Opened)>>,
    queued: RefCell<Vec<(u32, u32)>>,
}

impl TestDriver {
    fn with(devices: &[(Kind, u32)]) -> Rc<Self> {
        let driver = Self::default();

        *driver.devices.borrow_mut() = devices.to_vec();
        driver.prepare.set(8);
        Rc::new(driver)
    }

    fn messages(&self) -> Vec<u16> {
        self.log
            .borrow()
            .iter()
            .map(|(_, message)| message.message)
            .collect()
    }

    fn opened(&self, user: u32) -> Opened {
        self.opened
            .borrow()
            .iter()
            .find(|(each, _)| *each == user)
            .map(|(_, opened)| *opened)
            .expect("opened")
    }

    /// Each queued header played: marked done, and its program told.
    async fn finish(&self, engine: &Engine) -> Result<(), Stop> {
        let queued: Vec<_> = self.queued.borrow_mut().drain(..).collect();

        for (user, header) in queued {
            {
                let mut system = engine.system();
                let flags = super::checks::header_flags(&system, header);

                super::checks::set_header_flags(&mut system, header, (flags & !0x10) | 1);
            }

            let opened = self.opened(user);

            driver_callback(
                engine,
                opened.callback,
                (opened.flags >> 16) as u16,
                opened.handle,
                WOM_DONE,
                opened.instance,
                header,
                0,
            )
            .await?;
        }

        Ok(())
    }
}

// A message for each of the kinds' messages it answers.
#[allow(clippy::too_many_lines)]
impl OwnDriver for TestDriver {
    fn message<'a>(&'a self, engine: &'a Engine, kind: Kind, message: Message) -> Answering<'a> {
        Box::pin(async move {
            self.log.borrow_mut().push((kind, message));

            let midi = matches!(kind, Kind::MidiOut | Kind::MidiIn);

            match message.message {
                super::devices::DRVM_INIT => Ok(0),
                number if number == kind.get_num_devs() => Ok(self
                    .devices
                    .borrow()
                    .iter()
                    .find(|(each, _)| *each == kind)
                    .map_or(0, |(_, count)| *count)),
                // WODM_OPEN, MODM_OPEN.
                number if number == if midi { 3 } else { 5 } => {
                    let (user, opened) = {
                        let mut system = engine.system();
                        let description = system.read_far(message.first, 14);
                        let at = |from: usize| {
                            u32::from_le_bytes([
                                description[from],
                                description[from + 1],
                                description[from + 2],
                                description[from + 3],
                            ])
                        };
                        let skip = if midi { 2 } else { 6 };
                        let opened = Opened {
                            handle: u16::from_le_bytes([description[0], description[1]]),
                            callback: at(skip),
                            instance: at(skip + 4),
                            flags: message.second,
                        };
                        let user = 0xc0de_0000 | u32::from(message.device);

                        if self.refuse.borrow().contains(&message.device) {
                            return Ok(4);
                        }

                        system.write_far(message.user, &user.to_le_bytes());
                        (user, opened)
                    };

                    self.opened.borrow_mut().push((user, opened));
                    driver_callback(
                        engine,
                        opened.callback,
                        (opened.flags >> 16) as u16,
                        opened.handle,
                        if midi { MOM_OPEN } else { WOM_OPEN },
                        opened.instance,
                        0,
                        0,
                    )
                    .await?;
                    Ok(0)
                }
                // WODM_CLOSE, MODM_CLOSE.
                number if number == if midi { 4 } else { 6 } => {
                    if !self.queued.borrow().is_empty() {
                        return Ok(33);
                    }

                    let opened = self.opened(message.user);

                    driver_callback(
                        engine,
                        opened.callback,
                        (opened.flags >> 16) as u16,
                        opened.handle,
                        if midi { WOM_CLOSE + 12 } else { WOM_CLOSE },
                        opened.instance,
                        0,
                        0,
                    )
                    .await?;
                    Ok(0)
                }
                // WODM_PREPARE; MODM_PREPARE.
                7 if !midi => Ok(self.prepare.get()),
                5 if midi => Ok(self.prepare.get()),
                // WODM_WRITE.
                9 if !midi => {
                    let mut system = engine.system();
                    let flags = super::checks::header_flags(&system, message.first);

                    super::checks::set_header_flags(&mut system, message.first, flags | 0x10);
                    self.queued.borrow_mut().push((message.user, message.first));
                    Ok(0)
                }
                // MODM_LONGDATA: sent at once.
                8 if midi => {
                    {
                        let mut system = engine.system();
                        let flags = super::checks::header_flags(&system, message.first);

                        super::checks::set_header_flags(&mut system, message.first, flags | 1);
                    }

                    let opened = self.opened(message.user);

                    driver_callback(
                        engine,
                        opened.callback,
                        (opened.flags >> 16) as u16,
                        opened.handle,
                        MOM_DONE,
                        opened.instance,
                        message.first,
                        0,
                    )
                    .await?;
                    Ok(0)
                }
                // WODM_GETDEVCAPS, MODM_GETDEVCAPS.
                number if number == if midi { 2 } else { 4 } => {
                    engine.system().write_far(message.first, b"caps");
                    Ok(0)
                }
                _ => Ok(8),
            }
        })
    }
}

/// The program started, its task made, and run no further.
fn machine() -> Engine {
    let mut system = System::new();
    let (index, libraries) = system.load(Executable::parse(program()).unwrap(), "C:\\T.EXE");

    system.link(index);
    system.start(index, libraries, "").unwrap();
    Engine::new(system)
}

/// A driver installed as a kept module's: its entry point in the kept
/// module's stubs, the driver registered in that module's place. The
/// driver's place and one.
fn install(engine: &Engine, driver: &Rc<TestDriver>, module: &'static str, flags: u16) -> u16 {
    let address = {
        let mut system = engine.system();
        let kept = system.kept_named(module).unwrap();
        let stubs = system.stubs(kept);

        system
            .mmsystem
            .devices
            .register_own(module, Rc::clone(driver) as Rc<dyn OwnDriver>);
        u32::from(segment_selector(stubs)) << 16 | u32::from(STEP)
    };

    engine
        .run_now(super::devices::install(engine, 0, Some(address), flags))
        .unwrap()
}

/// An argument as a program pushes it.
#[derive(Debug, Clone, Copy)]
enum Arg {
    W(u16),
    D(u32),
}

/// An export of MMSYSTEM's called, its arguments on the stack as a
/// program puts them.
fn invoke(engine: &Engine, name: &str, args: &[Arg]) -> Answer {
    let words: Vec<u16> = args
        .iter()
        .flat_map(|arg| match *arg {
            Arg::W(word) => vec![word],
            Arg::D(long) => vec![(long >> 16) as u16, long as u16],
        })
        .collect();
    let (arguments, saved) = {
        let mut system = engine.system();
        let saved = system.cpu.regs[SP];
        let base = system.cpu.segments[SS].base;
        let mut at = saved;

        for word in &words {
            at = at.wrapping_sub(2);
            system.cpu.bus.write16(base + u32::from(at), *word);
        }

        // Below them, a return address.
        system.cpu.regs[SP] = at.wrapping_sub(4);

        (
            Args::after_first(
                words.first().copied().unwrap_or(0),
                base,
                u32::from(saved) - 2,
            ),
            saved,
        )
    };
    let answer = match super::implementation(name).expect(name) {
        Implementation::Sync(answer) => answer(&mut engine.system(), &mut { arguments }),
        Implementation::Async(answer) => engine.run_now(answer(engine, arguments)),
    };

    engine.system().cpu.regs[SP] = saved;
    answer.unwrap()
}

fn word(answer: Answer) -> u16 {
    match answer {
        Answer::Word(word) => word,
        Answer::Dword(dword) => dword as u16,
        Answer::Nothing => panic!("no answer"),
    }
}

/// A block of global memory, 4 KiB: its far pointer.
fn block(engine: &Engine) -> u32 {
    let mut system = engine.system();
    let system = &mut *system;
    let index = system
        .global
        .allocate(&mut system.cpu.bus, &mut system.descriptors, 0x1000, 0)
        .unwrap();

    u32::from(segment_selector(index)) << 16
}

/// A far pointer some bytes on.
fn at(far: u32, bytes: u32) -> u32 {
    far + bytes
}

fn read_word(engine: &Engine, far: u32) -> u16 {
    let bytes = engine.system().read_far(far, 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn read_dword(engine: &Engine, far: u32) -> u32 {
    super::checks::dword_at(&engine.system(), far)
}

/// The standard format, 11025 samples a second of eight bits, at `far`.
fn format(engine: &Engine, far: u32) {
    let mut bytes = vec![1, 0, 1, 0];

    bytes.extend_from_slice(&11025u32.to_le_bytes());
    bytes.extend_from_slice(&11025u32.to_le_bytes());
    bytes.extend_from_slice(&[1, 0, 8, 0]);
    engine.system().write_far(far, &bytes);
}

/// A header of `size` bytes at `far`, its data at `data`.
fn header(engine: &Engine, far: u32, data: u32, length: u32, size: usize) {
    let mut bytes = vec![0; size];

    bytes[..4].copy_from_slice(&data.to_le_bytes());
    bytes[4..8].copy_from_slice(&length.to_le_bytes());
    engine.system().write_far(far, &bytes);
}

fn posted(engine: &Engine) -> Vec<(u16, u16, u32)> {
    engine
        .system()
        .task
        .as_ref()
        .map(|task| {
            task.queue
                .messages
                .iter()
                .map(|message| (message.message, message.wparam, message.lparam))
                .collect()
        })
        .unwrap_or_default()
}

/// The plain installation's answers: no device, the mapper no driver.
#[test]
fn with_no_driver_there_is_no_device() {
    let engine = machine();
    let memory = block(&engine);

    format(&engine, memory);
    engine.system().write_far(at(memory, 0x100), &[0x34, 0x12]);

    for name in [
        "waveOutGetNumDevs",
        "waveInGetNumDevs",
        "midiOutGetNumDevs",
        "midiInGetNumDevs",
        "auxGetNumDevs",
    ] {
        assert_eq!(word(invoke(&engine, name, &[])), 0, "{name}");
    }

    let open = |id: u16, handle: u32, flags: u32| {
        word(invoke(
            &engine,
            "waveOutOpen",
            &[
                Arg::D(handle),
                Arg::W(id),
                Arg::D(memory),
                Arg::D(0),
                Arg::D(0),
                Arg::D(flags),
            ],
        ))
    };

    // Asking only leaves the handle as it was; opening writes it nought.
    assert_eq!(open(MAPPER, at(memory, 0x100), 1), 2);
    assert_eq!(read_word(&engine, at(memory, 0x100)), 0x1234);
    assert_eq!(open(0, at(memory, 0x100), 0), 2);
    assert_eq!(read_word(&engine, at(memory, 0x100)), 0);
    // A flag past the two answers before any device is looked for.
    assert_eq!(open(0, at(memory, 0x100), 4), 10);
    // A format that cannot be read, likewise.
    assert_eq!(
        word(invoke(
            &engine,
            "waveOutOpen",
            &[
                Arg::D(0),
                Arg::W(0),
                Arg::D(0),
                Arg::D(0),
                Arg::D(0),
                Arg::D(1)
            ],
        )),
        11
    );

    let caps = |name, id| {
        word(invoke(
            &engine,
            name,
            &[Arg::W(id), Arg::D(at(memory, 0x200)), Arg::W(0x34)],
        ))
    };

    assert_eq!(caps("waveOutGetDevCaps", 0), 2);
    assert_eq!(caps("waveInGetDevCaps", 0), 2);
    assert_eq!(caps("midiOutGetDevCaps", 0), 2);
    assert_eq!(caps("auxGetDevCaps", 0), 2);
    // The mapper's number is the mapper's place, which no driver has.
    assert_eq!(caps("waveOutGetDevCaps", MAPPER), 6);
    assert_eq!(caps("midiOutGetDevCaps", MAPPER), 6);

    let midi = |id: u16| {
        word(invoke(
            &engine,
            "midiOutOpen",
            &[
                Arg::D(at(memory, 0x100)),
                Arg::W(id),
                Arg::D(0),
                Arg::D(0),
                Arg::D(0),
            ],
        ))
    };

    assert_eq!(midi(0), 2);
    assert_eq!(midi(MAPPER), 6);

    // A handle that is none.
    assert_eq!(word(invoke(&engine, "waveOutClose", &[Arg::W(0x1006)])), 5);
    assert_eq!(word(invoke(&engine, "midiOutReset", &[Arg::W(0)])), 5);
}

/// Devices numbered across the drivers in their places; each driver sent
/// `DRVM_INIT` and then asked how many it has; one installed twice, or
/// with 64 K devices, refused.
#[test]
fn devices_are_numbered_across_drivers() {
    let engine = machine();
    let first = TestDriver::with(&[(Kind::WaveOut, 2)]);
    let second = TestDriver::with(&[(Kind::WaveOut, 1)]);
    let many = TestDriver::with(&[(Kind::WaveOut, 0x1_0000)]);

    assert_eq!(install(&engine, &first, "WING", Kind::WaveOut as u16), 1);
    assert_eq!(first.messages(), vec![0x64, 3]);
    assert_eq!(install(&engine, &second, "SHELL", Kind::WaveOut as u16), 2);
    assert_eq!(install(&engine, &second, "SHELL", Kind::WaveOut as u16), 0);
    assert_eq!(install(&engine, &many, "TOOLHELP", Kind::WaveOut as u16), 0);
    assert_eq!(word(invoke(&engine, "waveOutGetNumDevs", &[])), 3);

    let memory = block(&engine);
    let caps = |id| {
        word(invoke(
            &engine,
            "waveOutGetDevCaps",
            &[Arg::W(id), Arg::D(memory), Arg::W(0x34)],
        ))
    };

    assert_eq!(caps(2), 0);
    assert_eq!(engine.system().read_far(memory, 4), b"caps");
    assert_eq!(
        second.log.borrow().last().unwrap().1,
        Message {
            device: 0,
            message: 4,
            user: 0,
            first: memory,
            second: 0x34,
        }
    );
    assert_eq!(caps(1), 0);
    assert_eq!(first.log.borrow().last().unwrap().1.device, 1);
    assert_eq!(caps(3), 2);
    // A size of nought asks no driver.
    let before = first.log.borrow().len();

    assert_eq!(
        word(invoke(
            &engine,
            "waveOutGetDevCaps",
            &[Arg::W(0), Arg::D(memory), Arg::W(0)]
        )),
        0
    );
    assert_eq!(first.log.borrow().len(), before);
}

/// A waveform device through its life: the open and what the driver is
/// given, the header's checks and flags, the messages in their order, and
/// the program's task told of each.
#[test]
// One device's life, told in order.
#[allow(clippy::too_many_lines)]
fn a_waveform_device_is_opened_played_and_closed() {
    let engine = machine();
    let driver = TestDriver::with(&[(Kind::WaveOut, 1)]);

    install(&engine, &driver, "WING", Kind::WaveOut as u16);

    let memory = block(&engine);
    let task = engine.system().task_handle;

    format(&engine, memory);

    let handle_at = at(memory, 0x100);
    let open = |callback: u32, flags: u32| {
        word(invoke(
            &engine,
            "waveOutOpen",
            &[
                Arg::D(handle_at),
                Arg::W(0),
                Arg::D(memory),
                Arg::D(callback),
                Arg::D(0x1111_2222),
                Arg::D(flags),
            ],
        ))
    };

    // A window that is none, refused before the driver hears of it.
    assert_eq!(open(0x4321, CALLBACK_WINDOW), 11);
    assert_eq!(driver.messages(), vec![0x64, 3]);
    assert_eq!(open(u32::from(task), CALLBACK_TASK), 0);

    let handle = read_word(&engine, handle_at);
    let (_, opened) = driver.log.borrow().last().copied().unwrap();

    assert_ne!(handle, 0);
    assert_eq!((opened.message, opened.device), (5, 0));
    assert_eq!(opened.second, CALLBACK_TASK);
    // The driver's own doubleword and the description, in MMSYSTEM's frame
    // on the program's stack.
    assert_eq!(
        opened.user >> 16,
        u32::from(engine.system().cpu.segments[SS].selector)
    );
    assert_eq!(driver.opened(0xc0de_0000).handle, handle);
    assert_eq!(driver.opened(0xc0de_0000).callback, u32::from(task));
    assert_eq!(driver.opened(0xc0de_0000).instance, 0x1111_2222);
    assert_eq!(posted(&engine), vec![(WOM_OPEN, handle, 0)]);

    // The number it was opened by.
    assert_eq!(
        word(invoke(
            &engine,
            "waveOutGetID",
            &[Arg::W(handle), Arg::D(at(memory, 0x110))]
        )),
        0
    );

    let hdr = at(memory, 0x200);
    let data = at(memory, 0x400);
    let call = |name: &str| {
        word(invoke(
            &engine,
            name,
            &[Arg::W(handle), Arg::D(hdr), Arg::W(0x20)],
        ))
    };

    header(&engine, hdr, data, 0x100, 0x20);

    let sent = driver.log.borrow().len();

    // Unprepared: MMSYSTEM's answer, the driver not asked.
    assert_eq!(call("waveOutWrite"), 34);
    assert_eq!(driver.log.borrow().len(), sent);
    // A header of the wrong size.
    assert_eq!(
        word(invoke(
            &engine,
            "waveOutPrepareHeader",
            &[Arg::W(handle), Arg::D(hdr), Arg::W(0x1c)]
        )),
        11
    );
    // The driver does not prepare it, and MMSYSTEM does.
    assert_eq!(call("waveOutPrepareHeader"), 0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 2);
    assert_eq!(driver.messages().last(), Some(&7));
    // Prepared already: nought, and the driver not asked.
    let sent = driver.log.borrow().len();

    assert_eq!(call("waveOutPrepareHeader"), 0);
    assert_eq!(driver.log.borrow().len(), sent);

    // A done flag left from before is cleared as it is written.
    engine.system().write_far(at(hdr, 0x10), &[3, 0, 0, 0]);
    assert_eq!(call("waveOutWrite"), 0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 0x12);
    assert_eq!(
        driver.log.borrow().last().unwrap().1,
        Message {
            device: 0,
            message: 9,
            user: 0xc0de_0000,
            first: hdr,
            second: 0x20,
        }
    );
    assert_eq!(call("waveOutUnprepareHeader"), 33);
    assert_eq!(call("waveOutWrite"), 33);
    // Closing while it plays is the driver's refusal, and the handle stays.
    assert_eq!(word(invoke(&engine, "waveOutClose", &[Arg::W(handle)])), 33);

    engine.run_now(driver.finish(&engine)).unwrap();
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 3);
    assert_eq!(posted(&engine)[1], (WOM_DONE, handle, hdr));

    // Not supported by the driver, so MMSYSTEM unprepares it.
    assert_eq!(call("waveOutUnprepareHeader"), 0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 1);
    assert_eq!(call("waveOutUnprepareHeader"), 0);
    // The driver's answers passed on: not supported.
    assert_eq!(word(invoke(&engine, "waveOutPause", &[Arg::W(handle)])), 8);
    assert_eq!(driver.messages().last(), Some(&10));
    assert_eq!(
        word(invoke(
            &engine,
            "waveOutSetVolume",
            &[Arg::W(0), Arg::D(0x8000_8000)]
        )),
        8
    );
    assert_eq!(
        driver.log.borrow().last().unwrap().1,
        Message {
            device: 0,
            message: 17,
            user: 0,
            first: 0x8000_8000,
            second: 0,
        }
    );

    assert_eq!(word(invoke(&engine, "waveOutClose", &[Arg::W(handle)])), 0);
    assert_eq!(posted(&engine)[2], (WOM_CLOSE, handle, 0));
    assert_eq!(call("waveOutWrite"), 5);
    assert_eq!(word(invoke(&engine, "waveOutClose", &[Arg::W(handle)])), 5);
    assert_eq!(
        invoke(
            &engine,
            "waveOutMessage",
            &[Arg::W(handle), Arg::W(9), Arg::D(0), Arg::D(0)]
        ),
        Answer::Dword(0)
    );
    // Its block is taken again by the next open.
    assert_eq!(open(0, 0), 0);
    assert_eq!(read_word(&engine, handle_at), handle);
}

/// The mapper's number with no mapper: each device tried in turn, the
/// last answer given; the device opened answers its own number, as it was
/// opened by it.
#[test]
fn the_mapper_with_no_mapper_tries_each_device() {
    let engine = machine();
    let driver = TestDriver::with(&[(Kind::WaveOut, 3)]);

    install(&engine, &driver, "WING", Kind::WaveOut as u16);
    driver.refuse.borrow_mut().extend([0, 1, 2]);

    let memory = block(&engine);

    format(&engine, memory);

    let open = || {
        word(invoke(
            &engine,
            "waveOutOpen",
            &[
                Arg::D(at(memory, 0x100)),
                Arg::W(MAPPER),
                Arg::D(memory),
                Arg::D(0),
                Arg::D(0),
                Arg::D(0),
            ],
        ))
    };

    assert_eq!(open(), 4);

    let devices: Vec<u16> = driver
        .log
        .borrow()
        .iter()
        .filter(|(_, message)| message.message == 5)
        .map(|(_, message)| message.device)
        .collect();

    assert_eq!(devices, vec![0, 1, 2]);
    driver.refuse.borrow_mut().retain(|&device| device != 1);
    assert_eq!(open(), 0);

    let handle = read_word(&engine, at(memory, 0x100));

    assert_eq!(
        word(invoke(
            &engine,
            "waveOutGetID",
            &[Arg::W(handle), Arg::D(at(memory, 0x110))]
        )),
        0
    );
    assert_eq!(read_word(&engine, at(memory, 0x110)), 1);
}

/// A MIDI device: its doubleword kept in MMSYSTEM's data, at the handle and
/// 4; a header the driver prepares itself left as the driver leaves it; a
/// long message unprepared refused; and a function called back.
#[test]
fn a_midi_device_calls_a_function_back() {
    let engine = machine();
    let driver = TestDriver::with(&[(Kind::MidiOut, 1)]);

    install(&engine, &driver, "WING", Kind::MidiOut as u16);
    driver.prepare.set(0);

    let memory = block(&engine);
    let open = |flags: u32| {
        word(invoke(
            &engine,
            "midiOutOpen",
            &[
                Arg::D(at(memory, 0x100)),
                Arg::W(0),
                Arg::D(function()),
                Arg::D(0x5555_6666),
                Arg::D(flags),
            ],
        ))
    };

    // A flag in the low word.
    assert_eq!(open(CALLBACK_FUNCTION | 1), 10);
    assert_eq!(open(CALLBACK_FUNCTION), 0);

    let handle = read_word(&engine, at(memory, 0x100));
    let (_, opened) = driver.log.borrow().last().copied().unwrap();
    let data = {
        let system = engine.system();
        let kept = system.kept_named("MMSYSTEM").unwrap();

        u32::from(segment_selector(system.kept[kept].data)) << 16
    };

    assert_eq!(opened.message, 3);
    assert_eq!(opened.user, data | u32::from(handle + 4));
    assert_eq!(read_dword(&engine, opened.user), 0xc0de_0000);
    // The callback was called with the handle, MM_MOM_OPEN, the program's
    // doubleword and the parameters, last pushed first.
    let program_data = u32::from(segment_selector(2)) << 16;
    let called = engine.system().read_far(program_data, 16);
    let word_at = |at: usize| u16::from_le_bytes([called[at], called[at + 1]]);

    assert_eq!(word_at(14), handle);
    assert_eq!(word_at(12), MOM_OPEN);
    assert_eq!((word_at(10), word_at(8)), (0x5555, 0x6666));

    let hdr = at(memory, 0x200);
    let call = |name: &str| {
        word(invoke(
            &engine,
            name,
            &[Arg::W(handle), Arg::D(hdr), Arg::W(0x1c)],
        ))
    };

    header(&engine, hdr, at(memory, 0x400), 6, 0x1c);
    assert_eq!(call("midiOutLongMsg"), 64);
    // The driver answers nought and does not mark it: neither does MMSYSTEM.
    assert_eq!(call("midiOutPrepareHeader"), 0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 0);
    assert_eq!(driver.messages().last(), Some(&5));
    engine.system().write_far(at(hdr, 0x10), &[2, 0, 0, 0]);
    assert_eq!(call("midiOutLongMsg"), 0);
    assert_eq!(read_dword(&engine, at(hdr, 0x10)), 3);
    assert_eq!(word_at_now(&engine, program_data, 12), MOM_DONE);
    assert_eq!(
        word(invoke(
            &engine,
            "midiOutShortMsg",
            &[Arg::W(handle), Arg::D(0x0040_3c90)]
        )),
        8
    );
    assert_eq!(
        driver.log.borrow().last().unwrap().1,
        Message {
            device: 0,
            message: 7,
            user: 0xc0de_0000,
            first: 0x0040_3c90,
            second: 0,
        }
    );
    // A waveform handle's number is no MIDI handle.
    assert_eq!(word(invoke(&engine, "waveOutClose", &[Arg::W(handle)])), 5);
    assert_eq!(word(invoke(&engine, "midiOutClose", &[Arg::W(handle)])), 0);
    assert_eq!(
        word(invoke(
            &engine,
            "midiOutShortMsg",
            &[Arg::W(handle), Arg::D(0)]
        )),
        5
    );
}

fn word_at_now(engine: &Engine, far: u32, at: u32) -> u16 {
    read_word(engine, far + at)
}

/// `DriverCallback` by kind: nothing for no callback or no kind; a window
/// or a task posted the message with the handle and the first parameter;
/// a function not in code not called.
#[test]
fn driver_callback_answers_by_kind() {
    let engine = machine();
    let task = engine.system().task_handle;
    let callback = |callback: u32, flags: u16| {
        engine
            .run_now(driver_callback(
                &engine, callback, flags, 0x1006, 0x3bd, 1, 2, 3,
            ))
            .unwrap()
    };

    assert_eq!(callback(0, 1), 0);
    assert_eq!(callback(u32::from(task), 0), 0);
    assert_eq!(callback(u32::from(task), 4), 0);
    assert_eq!(callback(u32::from(task), 2), 1);
    assert_eq!(callback(0x4321, 2), 0);
    assert_eq!(posted(&engine), vec![(0x3bd, 0x1006, 2)]);
    // Its data segment is no code.
    assert_eq!(callback(u32::from(segment_selector(2)) << 16, 3), 0);
    assert_eq!(callback(function(), 3 | 8), 1);
}

/// A driver refused as the installer refuses one closes it; one removed
/// takes its devices with it, unless one is open.
#[test]
fn a_driver_is_removed_unless_a_device_is_open() {
    let engine = machine();
    let driver = TestDriver::with(&[(Kind::MidiOut, 2)]);

    assert_eq!(install(&engine, &driver, "WING", Kind::MidiOut as u16), 1);
    assert_eq!(word(invoke(&engine, "midiOutGetNumDevs", &[])), 2);

    let memory = block(&engine);

    assert_eq!(
        word(invoke(
            &engine,
            "midiOutOpen",
            &[Arg::D(memory), Arg::W(1), Arg::D(0), Arg::D(0), Arg::D(0)],
        )),
        0
    );

    let handle = read_word(&engine, memory);
    let remove = Kind::MidiOut as u16 | super::devices::MMDRVI_REMOVE;

    assert_eq!(install(&engine, &driver, "WING", remove), 0);
    assert_eq!(word(invoke(&engine, "midiOutClose", &[Arg::W(handle)])), 0);
    assert_eq!(install(&engine, &driver, "WING", remove), 1);
    assert_eq!(word(invoke(&engine, "midiOutGetNumDevs", &[])), 0);
}
