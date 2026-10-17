//! A printer's driver from the drive -- the PostScript driver, or any other
//! Windows printer driver -- run as Windows' GDI runs it. The twin of
//! `src/win16/gdi/printer-driver.ts`.
//!
//! **Read out** of `GDI.EXE`, `CreateDC` and `CreateIC` (seg1 `480a`,
//! `47d8`, both into seg1 `0078` with a flag, 0 for a DC and 80h for an
//! IC):
//!
//! * The port is named by an atom of its name, a colon at its end left off
//!   (seg4 `0449`); the device and the driver by atoms of theirs, so all
//!   three are compared without case. A DC on WIN.INI's `[windows]`
//!   `NullPort`, `None` by default, read as GDI starts (seg2 `025c`), is
//!   refused (seg1 `00bb`); an IC is not.
//! * **The driver** is found in GDI's list of those loaded, by its name; or
//!   loaded, `LoadLibrary` of the name with `.drv` after it, refused below
//!   32 (seg1 `0284`-`02e1`). Its ordinals 1 to 30 are found with
//!   `GetProcAddress` (`02ef`), the driver's entry points: 1 `BitBlt`, 2
//!   `ColorInfo`, 3 `Control`, 4 `Disable`, 5 `Enable`, 6 `EnumDFonts`, 7
//!   `EnumObj`, 8 `Output`, 9 `Pixel`, 10 `RealizeObject`, 11 `StrBlt`, 12
//!   `ScanLR`, 13 `DeviceMode`, 14 `ExtTextOut`, 15 `GetCharWidth` and on.
//!   A count of the DCs made on it is kept (`0111`).
//! * **The device**, a `PDEVICE` and its `GDIINFO`, is kept per driver by
//!   the device's and the port's names, and shared by every DC and IC made
//!   on the two (seg1 `0333`), as the `GDIINFO`'s `dpDCManage` (5Ch) lets:
//!   with bit 0 every DC has one of its own; with bit 2 the first is shared
//!   whatever the names; with bit 1 a second DC is refused.
//! * A new one: `Enable` with GDI's 7Eh bytes for the `GDIINFO`, a style
//!   of 1, 8001h for an IC, and the program's device, port and DEVMODE
//!   (`03af`, `04ca`). Its answer must be at least 6Eh where the version is
//!   300h or more, else exactly 68h. Words 60h to 66h all nought are made
//!   B505h, 0, B505h, 0 (`0592`). Then the `PDEVICE`, `GlobalAlloc(2002h,
//!   dpDEVICEsize)` (`03f5`), given to `Enable` with a style of nought,
//!   8000h for an IC (`046f`); nought from it refuses the DC.
//! * A driver whose `dpRaster` has `RC_BANDING` (2) has its DC's drawing
//!   kept in a metafile for its bands (`042d`): not followed here.
//!
//! `DeleteDC` (seg1 `082e`): the device's count taken down, and at nought
//! `Disable` given its `PDEVICE` (`0906`), which is freed with its
//! `GDIINFO`; the driver's count taken down, and at nought `FreeLibrary`
//! (`0947`).

use std::collections::HashMap;
use std::future::Future;

use winbox_cpu::{SP, SS};
use winbox_machine::handle_for;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::gdi::DcBitmap;
use crate::handles::{Kind, Object};
use crate::system::System;

const CONTROL: u16 = 3;
const DISABLE: u16 = 4;
const ENABLE: u16 = 5;

const GDIINFO_SIZE: u16 = 0x6e;
const DC_SPDEVICE: u8 = 1;
const DC_1PDEVICE: u8 = 2;
const DC_IGNOREDFNP: u8 = 4;

/// A driver GDI has loaded.
#[derive(Debug, Clone)]
pub struct Driver {
    pub name: Vec<u8>,
    pub instance: u16,
    /// Ordinals 1 to 30, at index 0 to 29.
    pub procs: Vec<u32>,
    /// The DCs and ICs made on it.
    pub uses: u32,
    /// Its devices, by their numbers, the newest first.
    pub devices: Vec<u32>,
}

/// A device a driver has enabled: its `GDIINFO` and its `PDEVICE`.
#[derive(Debug, Clone)]
pub struct PDevice {
    pub driver: Vec<u8>,
    pub device: Vec<u8>,
    pub port: Vec<u8>,
    pub info: Vec<u8>,
    pub pdevice: u16,
    pub lp_pdevice: u32,
    /// The DCs and ICs made on it.
    pub count: u32,
}

/// What GDI keeps of the drivers it has loaded from the drive.
#[derive(Debug, Clone, Default)]
pub struct Drivers {
    /// The newest first.
    pub drivers: Vec<Driver>,
    pub devices: HashMap<u32, PDevice>,
    pub next: u32,
    /// Each driver's device context, by its context's index: its device.
    pub contexts: HashMap<usize, u32>,
    /// WIN.INI's `NullPort`, once read.
    pub null_port: Option<Vec<u8>>,
    /// Each driver's device context's abort procedure, as `SETABORTPROC`
    /// gave it.
    pub abort: HashMap<usize, u32>,
}

/// A name as GDI's atom keeps it: compared without case.
fn key(name: &[u8]) -> Vec<u8> {
    name.to_ascii_uppercase()
}

/// A port as GDI names it: a colon at its end left off (seg4 `0449`).
pub(crate) fn port_key(name: &[u8]) -> Vec<u8> {
    key(name.strip_suffix(b":").unwrap_or(name))
}

fn string_at(system: &System, far: u32) -> Vec<u8> {
    if far == 0 {
        Vec::new()
    } else {
        system.read_string(far)
    }
}

/// WIN.INI's `[windows]` `NullPort`, `none` where it is not there.
pub(crate) fn null_port(system: &mut System) -> Vec<u8> {
    if let Some(port) = &system.printing.drivers.null_port {
        return port.clone();
    }

    let port = system
        .read_profile(b"WIN.INI")
        .get(b"windows", b"nullport", true)
        .unwrap_or_else(|| b"none".to_vec());

    system.printing.drivers.null_port = Some(port.clone());
    port
}

/// The device context of a driver from the drive, by its handle.
pub fn driver_dc_of(system: &System, hdc: u16) -> Option<usize> {
    match system.handles.resolve(hdc)? {
        Object::Dc(index) if system.printing.drivers.contexts.contains_key(&index) => Some(index),
        _ => None,
    }
}

fn device_of(system: &System, dc: usize) -> Option<&PDevice> {
    let id = system.printing.drivers.contexts.get(&dc)?;

    system.printing.drivers.devices.get(id)
}

fn driver_named<'a>(system: &'a mut System, name: &[u8]) -> Option<&'a mut Driver> {
    system
        .printing
        .drivers
        .drivers
        .iter_mut()
        .find(|driver| driver.name == name)
}

fn proc_of(system: &System, driver: &[u8], ordinal: u16) -> u32 {
    system
        .printing
        .drivers
        .drivers
        .iter()
        .find(|other| other.name == driver)
        .and_then(|other| other.procs.get(usize::from(ordinal) - 1).copied())
        .unwrap_or(0)
}

/// Bytes laid below the stack for a call, given to `body` as a far
/// pointer, the stack kept below them while it runs: its answer, and the
/// bytes as they were left.
async fn on_stack<T, F: Future<Output = Result<T, Stop>>>(
    engine: &Engine,
    bytes: &[u8],
    body: impl FnOnce(u32) -> F,
) -> Result<(T, Vec<u8>), Stop> {
    let (saved, far) = {
        let mut system = engine.system();
        let saved = system.cpu.regs[SP];
        let sp = saved.wrapping_sub(((bytes.len() + 1) & !1) as u16);
        let far = u32::from(system.cpu.segments[SS].selector) << 16 | u32::from(sp);

        system.write_far(far, bytes);
        system.cpu.regs[SP] = sp.wrapping_sub(4);
        (saved, far)
    };
    let answer = body(far).await;
    let mut system = engine.system();
    let left = system.read_far(far, bytes.len());

    system.cpu.regs[SP] = saved;
    Ok((answer?, left))
}

async fn call_driver(
    engine: &Engine,
    procedure: u32,
    args: &[GuestArg],
) -> Result<(u32, Vec<Vec<u8>>), Stop> {
    engine.call_with(procedure, args, &[]).await
}

/// The driver, found or loaded: and whether this call loaded it.
async fn find_driver(engine: &Engine, name: &[u8]) -> Result<Option<(Vec<u8>, bool)>, Stop> {
    let name_key = key(name);

    if driver_named(&mut engine.system(), &name_key).is_some() {
        return Ok(Some((name_key, false)));
    }

    let file: String = name.iter().map(|&byte| char::from(byte)).collect();
    let instance =
        crate::modules_kernel::load_library_named(engine, &format!("{file}.drv")).await?;

    if instance < 32 {
        return Ok(None);
    }

    let mut system = engine.system();
    let procs = (1..=30)
        .map(|ordinal| crate::modules_kernel::proc_numbered(&mut system, instance, ordinal))
        .collect();

    system.printing.drivers.drivers.insert(
        0,
        Driver {
            name: name_key.clone(),
            instance,
            procs,
            uses: 0,
            devices: Vec::new(),
        },
    );
    Ok(Some((name_key, true)))
}

async fn drop_driver(engine: &Engine, name: &[u8]) -> Result<(), Stop> {
    let instance = {
        let mut system = engine.system();
        let drivers = &mut system.printing.drivers.drivers;
        let Some(at) = drivers.iter().position(|driver| driver.name == name) else {
            return Ok(());
        };

        drivers.remove(at).instance
    };

    crate::modules_kernel::free_library_handle(engine, instance).await
}

/// A shared device, as `dpDCManage` lets one be shared: `Err` where the DC
/// is refused.
fn shared_device(
    system: &System,
    name: &[u8],
    device: &[u8],
    port: &[u8],
) -> Result<Option<u32>, ()> {
    let drivers = &system.printing.drivers;
    let Some(driver) = drivers.drivers.iter().find(|driver| driver.name == name) else {
        return Ok(None);
    };
    let Some(&first) = driver.devices.first() else {
        return Ok(None);
    };
    let manage = drivers.devices[&first].info[0x5c];

    if manage & DC_SPDEVICE != 0 {
        return Ok(None);
    }

    if manage & DC_IGNOREDFNP != 0 {
        return if manage & DC_1PDEVICE != 0 {
            Err(())
        } else {
            Ok(Some(first))
        };
    }

    for id in &driver.devices {
        let other = &drivers.devices[id];

        if key(&other.device) == key(device) && port_key(&other.port) == port_key(port) {
            return if other.info[0x5c] & DC_1PDEVICE != 0 {
                Err(())
            } else {
                Ok(Some(*id))
            };
        }
    }

    Ok(None)
}

struct EnableArgs {
    device: u32,
    output: u32,
    data: u32,
    ic: bool,
}

async fn enable_device(
    engine: &Engine,
    name: &[u8],
    args: &EnableArgs,
    device: &[u8],
    port: &[u8],
) -> Result<Option<PDevice>, Stop> {
    let enable = proc_of(&engine.system(), name, ENABLE);
    let style: u16 = if args.ic { 0x8000 } else { 0 };

    if enable == 0 {
        return Ok(None);
    }

    let call_args = |first: GuestArg, mode: u16| {
        [
            first,
            GuestArg::Word(mode),
            GuestArg::Long(args.device),
            GuestArg::Long(args.output),
            GuestArg::Long(args.data),
        ]
    };
    // GDI's 7Eh bytes for the `GDIINFO` are in its own heap; here they are
    // below the stack for the call.
    let ((size, _), mut info) = on_stack(engine, &[0; 0x7e], |far| {
        let args = call_args(GuestArg::Long(far), style | 1);

        async move { call_driver(engine, enable, &args).await }
    })
    .await?;
    let size = size as u16;

    // Words 60h to 66h, all nought, made B505h, 0, B505h, 0 (seg1 `0592`).
    if info[0x60..0x68].iter().all(|&byte| byte == 0) {
        info[0x60..0x68].copy_from_slice(&[0x05, 0xb5, 0, 0, 0x05, 0xb5, 0, 0]);
    }

    let version = u16::from_le_bytes([info[0], info[1]]);
    let fits = if version >= 0x300 {
        size >= GDIINFO_SIZE
    } else {
        size == 0x68
    };
    let device_size = u16::from_le_bytes([info[0x1a], info[0x1b]]);
    let (pdevice, lp_pdevice) = {
        let mut system = engine.system();
        let system = &mut *system;
        let index = if fits {
            system.global.allocate(
                &mut system.cpu.bus,
                &mut system.descriptors,
                u32::from(device_size),
                0x2002,
            )
        } else {
            None
        };
        let Some(index) = index else {
            return Ok(None);
        };
        let pdevice = handle_for(index);

        (pdevice, system.global_pointer(pdevice))
    };
    let (enabled, _) = call_driver(
        engine,
        enable,
        &call_args(GuestArg::Long(lp_pdevice), style),
    )
    .await?;

    if enabled as u16 == 0 {
        let _ = crate::memory::global_free(&mut engine.system(), &mut Args::repeat(pdevice));
        return Ok(None);
    }

    Ok(Some(PDevice {
        driver: name.to_vec(),
        device: device.to_vec(),
        port: port.to_vec(),
        info,
        pdevice,
        lp_pdevice,
        count: 0,
    }))
}

/// `CreateDC` or `CreateIC` of a driver from the drive: the DC, or nought.
pub async fn create_driver_dc(engine: &Engine, pointers: [u32; 4], ic: bool) -> Result<u16, Stop> {
    let [driver, device_far, output, data] = pointers;
    let (name, device, port, null) = {
        let mut system = engine.system();
        let null = null_port(&mut system);

        (
            string_at(&system, driver),
            string_at(&system, device_far),
            string_at(&system, output),
            null,
        )
    };

    if name.is_empty() {
        return Ok(0);
    }

    // A DC on the null port is refused; an IC is not (seg1 `00bb`).
    if !ic && output != 0 && port_key(&port) == port_key(&null) {
        return Ok(0);
    }

    let Some((name, loaded)) = find_driver(engine, &name).await? else {
        return Ok(0);
    };
    let shared = shared_device(&engine.system(), &name, &device, &port);
    let id = match shared {
        Err(()) => {
            if loaded {
                drop_driver(engine, &name).await?;
            }

            return Ok(0);
        }
        Ok(Some(id)) => id,
        Ok(None) => {
            let args = EnableArgs {
                device: device_far,
                output,
                data,
                ic,
            };
            let Some(pdevice) = enable_device(engine, &name, &args, &device, &port).await? else {
                let unused = driver_named(&mut engine.system(), &name)
                    .is_some_and(|driver| driver.uses == 0);

                if loaded && unused {
                    drop_driver(engine, &name).await?;
                }

                return Ok(0);
            };
            let mut system = engine.system();
            let drivers = &mut system.printing.drivers;
            let id = drivers.next;

            drivers.next += 1;
            drivers.devices.insert(id, pdevice);

            if let Some(driver) = drivers
                .drivers
                .iter_mut()
                .find(|driver| driver.name == name)
            {
                driver.devices.insert(0, id);
            }

            id
        }
    };
    let mut system = engine.system();

    if let Some(driver) = driver_named(&mut system, &name) {
        driver.uses += 1;
    }

    if let Some(pdevice) = system.printing.drivers.devices.get_mut(&id) {
        pdevice.count += 1;
    }

    let font = system.system_font();
    let placeholder = system.placeholder_bitmap();
    let index = system.new_dc(DcBitmap::Bitmap(placeholder), false);

    system.gdi.dcs[index].state.font = font;
    system.printing.drivers.contexts.insert(index, id);
    Ok(system
        .handles
        .allocate(Kind::Gdi, Object::Dc(index))
        .unwrap_or(0))
}

/// A DC of a driver from the drive deleted: `Disable` and `FreeLibrary` as
/// the last goes.
pub async fn delete_driver_dc(engine: &Engine, dc: usize) -> Result<(), Stop> {
    let (id, name, last, disable, lp_pdevice) = {
        let mut system = engine.system();
        system.printing.drivers.abort.remove(&dc);

        let Some(id) = system.printing.drivers.contexts.remove(&dc) else {
            return Ok(());
        };
        let Some(pdevice) = system.printing.drivers.devices.get_mut(&id) else {
            return Ok(());
        };

        pdevice.count = pdevice.count.saturating_sub(1);

        let (last, name, lp_pdevice) = (
            pdevice.count == 0,
            pdevice.driver.clone(),
            pdevice.lp_pdevice,
        );
        let disable = proc_of(&system, &name, DISABLE);

        (id, name, last, disable, lp_pdevice)
    };

    if last {
        if disable != 0 {
            call_driver(engine, disable, &[GuestArg::Long(lp_pdevice)]).await?;
        }

        let mut system = engine.system();
        let pdevice = system.printing.drivers.devices.remove(&id);

        if let Some(driver) = driver_named(&mut system, &name) {
            driver.devices.retain(|&other| other != id);
        }

        if let Some(pdevice) = pdevice {
            let _ = crate::memory::global_free(&mut system, &mut Args::repeat(pdevice.pdevice));
        }
    }

    let unused = {
        let mut system = engine.system();

        driver_named(&mut system, &name).is_some_and(|driver| {
            driver.uses = driver.uses.saturating_sub(1);
            driver.uses == 0
        })
    };

    if unused {
        drop_driver(engine, &name).await?;
    }

    Ok(())
}

/// `GetDeviceCaps` of a driver's DC: the word at the index's offset in its
/// `GDIINFO`, nought past 6Ch, or past 66h for a `GDIINFO` older than 300h
/// (seg1 `44a6`).
pub fn driver_caps(system: &System, dc: usize, index: i16) -> u16 {
    let Some(pdevice) = device_of(system, dc) else {
        return 0;
    };
    let info = &pdevice.info;
    let version = u16::from_le_bytes([info[0], info[1]]);

    if !(0..=0x6c).contains(&index) || (version < 0x300 && index > 0x66) {
        return 0;
    }

    let at = index as usize;

    u16::from_le_bytes([info[at], info[at + 1]])
}

/// `Escape` on a driver's DC (seg7 `0042`-`0526`): `SETABORTPROC` kept by
/// GDI, answering the procedure's segment (`00fb`); `STARTDOC` given to
/// the driver after a `SETABORTPROC` of its own whose input is the DC
/// (`00c1`); 0Fh answered nought (`008f`); 100h to `BFFh` GDI's own,
/// answered nought here; every other the driver's `Control`, with the
/// `PDEVICE`, the escape, the input and the output -- not the count
/// (`04f0`).
pub async fn driver_escape(
    engine: &Engine,
    hdc: u16,
    dc: usize,
    escape: i16,
    input: u32,
    output: u32,
) -> Result<i16, Stop> {
    let (control, lp_pdevice) = {
        let system = engine.system();
        let Some(pdevice) = device_of(&system, dc) else {
            return Ok(0);
        };

        (
            proc_of(&system, &pdevice.driver, CONTROL),
            pdevice.lp_pdevice,
        )
    };

    if escape == 0x0f {
        return Ok(0);
    }

    if escape == 9 {
        engine.system().printing.drivers.abort.insert(dc, input);
        return Ok((input >> 16) as i16);
    }

    if (0x100..=0xbff).contains(&escape) || control == 0 {
        return Ok(0);
    }

    let call = |number: u16, first: GuestArg| {
        [
            GuestArg::Long(lp_pdevice),
            GuestArg::Word(number),
            first,
            GuestArg::Long(output),
        ]
    };

    if escape == 10 {
        // The driver given the DC, by a word of GDI's stack.
        on_stack(engine, &hdc.to_le_bytes(), |far| {
            let args = call(9, GuestArg::Long(far));

            async move { call_driver(engine, control, &args).await }
        })
        .await?;
    }

    let (answer, _) =
        call_driver(engine, control, &call(escape as u16, GuestArg::Long(input))).await?;

    Ok(answer as i16)
}

fn create_call(engine: &Engine, mut args: Args, ic: bool) -> Later<'_> {
    Box::pin(async move {
        let mut original = args;
        let (pointers, kept) = {
            let system = engine.system();
            let driver = args.dword(&system);
            let device = args.dword(&system);
            let output = args.dword(&system);
            let data = args.dword(&system);
            let name = string_at(&system, driver);
            let kept = name.is_empty()
                || crate::printer::is_printer_driver(&name)
                || name.eq_ignore_ascii_case(b"DISPLAY");

            ([driver, device, output, data], kept)
        };

        if kept {
            let mut system = engine.system();

            return super::dc::create_dc_call(&mut system, &mut original);
        }

        Ok(Answer::Word(create_driver_dc(engine, pointers, ic).await?))
    })
}

fn create_dc_call(engine: &Engine, args: Args) -> Later<'_> {
    create_call(engine, args, false)
}

fn create_ic_call(engine: &Engine, args: Args) -> Later<'_> {
    create_call(engine, args, true)
}

fn delete_dc_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (hdc, driver) = {
            let system = engine.system();
            let hdc = args.word(&system);

            (hdc, driver_dc_of(&system, hdc))
        };
        let deleted = super::dc::delete_dc(&mut engine.system(), hdc);

        if let Some(dc) = driver {
            delete_driver_dc(engine, dc).await?;
        }

        Ok(Answer::Word(u16::from(deleted)))
    })
}

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "CreateDC" => Implementation::Async(create_dc_call),
        "CreateIC" => Implementation::Async(create_ic_call),
        "DeleteDC" => Implementation::Async(delete_dc_call),
        _ => return None,
    })
}
