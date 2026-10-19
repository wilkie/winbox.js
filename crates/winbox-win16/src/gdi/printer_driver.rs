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
//! `Disable` given its `PDEVICE` (`0906`); the driver's count taken down,
//! and at nought `FreeLibrary` (`0947`); then the device's `PDEVICE`
//! freed with what was realized for it (`09dd`-`09ef`).

use std::collections::HashMap;
use std::future::Future;

use winbox_cpu::{SP, SS};
use winbox_machine::handle_for;

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::engine::{Engine, GuestArg};
use crate::fonts::LogFont;
use crate::fonts::TextMetric;
use crate::gdi::DcBitmap;
use crate::gdi::objects::{Font, GdiObject};
use crate::handles::{Kind, Object};
use crate::system::System;

const CONTROL: u16 = 3;
const DISABLE: u16 = 4;
const ENABLE: u16 = 5;
const REALIZE_OBJECT: u16 = 10;
const OBJ_FONT: u16 = 3;
const ENUM_DFONTS: u16 = 6;
const DEVICE_DEFAULT_FONT: i16 = 14;

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
    /// Each pen and brush realized for the device, by its object, as GDI
    /// keeps its realized objects by the device's number (seg1 `26be`,
    /// `2335`): shared by the contexts on it, let go as it goes (`4460`).
    /// In the order each object was first realized.
    pub realized: Vec<(usize, Vec<super::printer_output::Realized>)>,
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
    /// The fonts the drivers realized, as GDI's table of them holds them
    /// (`[036Ah]`, 1Ch bytes each), by the device, the font object and the
    /// size: one let go takes the last one's place (seg6 `01fa`).
    pub fonts: Vec<(FontKey, DeviceFont)>,
    /// The context and the call -- 1 for `EnumFontFamilies`, nought for
    /// `EnumFonts` -- whose fonts GDI is walking (`[064Eh]`, `[041Ch]`).
    pub walking: Option<(u16, u16)>,
    /// The walks of a driver's fonts under way, by their numbers.
    pub walks: Vec<FontWalk>,
    /// The contexts `StartPage` has marked, and those `NEXTBAND` has
    /// marked banding (the DC's byte 0Bh, bits 5 and 1).
    pub pages: std::collections::HashSet<usize>,
    pub banding: std::collections::HashSet<usize>,
    /// What GDI keeps of each driver's context for drawing
    /// (`printer_output.rs`).
    pub drawing: HashMap<usize, super::printer_output::Drawing>,
    /// The context whose font the driver is realizing, for GDI's TrueType
    /// engine (`[064Eh]`, `engine_font.rs`).
    pub realizing: Option<usize>,
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

/// A driver's context's `GDIINFO`.
pub fn device_info(system: &System, dc: usize) -> Option<&[u8]> {
    device_of(system, dc).map(|pdevice| pdevice.info.as_slice())
}

/// A driver's context's driver's entry point by its ordinal, nought where
/// it has none, and its `PDEVICE`.
pub fn device_proc(system: &System, dc: usize, ordinal: u16) -> (u32, u32) {
    device_of(system, dc).map_or((0, 0), |pdevice| {
        (
            proc_of(system, &pdevice.driver, ordinal),
            pdevice.lp_pdevice,
        )
    })
}

/// The device a driver's context was made for, by its name.
pub fn device_name(system: &System, dc: usize) -> Option<Vec<u8>> {
    device_of(system, dc).map(|pdevice| pdevice.device.clone())
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
        realized: Vec::new(),
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
    let (hdc, index) = {
        let mut system = engine.system();

        if let Some(driver) = driver_named(&mut system, &name) {
            driver.uses += 1;
        }

        if let Some(pdevice) = system.printing.drivers.devices.get_mut(&id) {
            pdevice.count += 1;
        }

        // A printer's context starts with `DEVICE_DEFAULT_FONT`, the display's
        // with `SYSTEM_FONT` (seg1 `0217`-`0225`).
        let font = super::objects::stock_font_handle(&mut system, DEVICE_DEFAULT_FONT).and_then(
            |handle| match system.handles.resolve(handle) {
                Some(Object::Gdi(object)) => Some(object),
                _ => None,
            },
        );
        let placeholder = system.placeholder_bitmap();
        let index = system.new_dc(DcBitmap::Bitmap(placeholder), false);

        system.gdi.dcs[index].state.font = font;
        system.printing.drivers.contexts.insert(index, id);

        let hdc = system
            .handles
            .allocate(Kind::Gdi, Object::Dc(index))
            .unwrap_or(0);

        (hdc, index)
    };

    // Its colours, brush and pen, through the driver (seg1
    // `01cd`-`0210`).
    super::printer_output::start_drawing(engine, index).await?;
    Ok(hdc)
}

/// A DC of a driver from the drive deleted (`GDI.EXE` seg1 `082e`): the
/// device's count taken down, and at nought the driver's `Disable` given
/// the `PDEVICE` (`0906`); the driver's count taken down, and at nought
/// `FreeLibrary` (`0947`); then, the device gone, its `PDEVICE` freed
/// (`09dd`), and what was realized for it let go -- its pens and brushes
/// (`09ea`, `4460`), and its fonts (`09ef`, seg6 `0387`), not by the
/// driver. A device shared keeps them for the contexts left on it.
pub async fn delete_driver_dc(engine: &Engine, dc: usize) -> Result<(), Stop> {
    super::printer_output::stop_drawing(engine, dc).await?;

    let (id, name, gone, disable, lp_pdevice) = {
        let mut system = engine.system();
        system.printing.drivers.abort.remove(&dc);

        let Some(id) = system.printing.drivers.contexts.remove(&dc) else {
            return Ok(());
        };
        let Some(pdevice) = system.printing.drivers.devices.get_mut(&id) else {
            return Ok(());
        };

        pdevice.count = pdevice.count.saturating_sub(1);

        let (gone, name, lp_pdevice) = (
            pdevice.count == 0,
            pdevice.driver.clone(),
            pdevice.lp_pdevice,
        );
        let disable = proc_of(&system, &name, DISABLE);

        (id, name, gone, disable, lp_pdevice)
    };

    if gone {
        if disable != 0 {
            call_driver(engine, disable, &[GuestArg::Long(lp_pdevice)]).await?;
        }

        let mut system = engine.system();

        if let Some(driver) = driver_named(&mut system, &name) {
            driver.devices.retain(|&other| other != id);
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

    if gone {
        {
            let mut system = engine.system();

            if let Some(pdevice) = system.printing.drivers.devices.remove(&id) {
                let _ = crate::memory::global_free(&mut system, &mut Args::repeat(pdevice.pdevice));

                for (_, list) in &pdevice.realized {
                    for realized in list {
                        let _ = crate::memory::global_free(
                            &mut system,
                            &mut Args::repeat(realized.handle),
                        );
                    }
                }
            }
        }

        release_fonts(engine, Release::Device(id)).await?;
    }

    Ok(())
}

/// Which realized fonts to let go: a device's, or a font object's.
#[derive(Clone, Copy)]
enum Release {
    Device(u32),
    Font(usize),
}

/// The fonts realized for a device let go, or those of a font object, as
/// GDI walks its table of them (`GDI.EXE` seg6 `01fa`): from the first, an
/// entry let go taking the last one's place, which is looked at next. A
/// font object's are deleted by the driver first, its `RealizeObject` given
/// -`OBJ_FONT` and the `FONTINFO` as both objects (`04bd`); a device's are
/// not, the driver having gone (mode 3, `0272`). Each `FONTINFO` is then
/// freed.
async fn release_fonts(engine: &Engine, which: Release) -> Result<(), Stop> {
    let mut at = 0;

    loop {
        let (realize, lp_pdevice, font) = {
            let system = engine.system();
            let fonts = &system.printing.drivers.fonts;
            let Some(((id, object, ..), font)) = fonts.get(at) else {
                return Ok(());
            };
            let matches = match which {
                Release::Device(device) => *id == device,
                Release::Font(of) => *object == of,
            };

            if !matches {
                at += 1;
                continue;
            }

            let pdevice = system.printing.drivers.devices.get(id);
            let realize = match (which, pdevice) {
                (Release::Font(_), Some(pdevice)) => {
                    proc_of(&system, &pdevice.driver, REALIZE_OBJECT)
                }
                _ => 0,
            };

            (
                realize,
                pdevice.map_or(0, |pdevice| pdevice.lp_pdevice),
                font.clone(),
            )
        };

        if realize != 0 {
            call_driver(
                engine,
                realize,
                &[
                    GuestArg::Long(lp_pdevice),
                    GuestArg::Word(OBJ_FONT.wrapping_neg()),
                    GuestArg::Long(font.far),
                    GuestArg::Long(font.far),
                    GuestArg::Long(0),
                ],
            )
            .await?;
        }

        let mut system = engine.system();
        let _ = crate::memory::global_free(&mut system, &mut Args::repeat(font.handle));
        system.printing.drivers.fonts.swap_remove(at);
    }
}

/// Whether a driver realized a font object, for some device.
pub fn driver_realized(system: &System, object: usize) -> bool {
    system
        .printing
        .drivers
        .fonts
        .iter()
        .any(|((_, of, ..), _)| *of == object)
}

/// A font object deleted: what the drivers realized of it deleted by them
/// and freed (`GDI.EXE` seg6 `0362`, mode 2).
pub async fn delete_driver_fonts(engine: &Engine, object: usize) -> Result<(), Stop> {
    release_fonts(engine, Release::Font(object)).await
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

    // `NEXTBAND` marks the DC as banding, which `EndPage` reads (`0137`).
    if escape == 3 {
        engine.system().printing.drivers.banding.insert(dc);
    }

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

/// The driver's `Control` with an escape, its input and its output: its
/// answer, signed.
async fn control(
    engine: &Engine,
    dc: usize,
    escape: u16,
    input: u32,
    output: u32,
) -> Result<i16, Stop> {
    let (procedure, lp_pdevice) = {
        let system = engine.system();
        let Some(pdevice) = device_of(&system, dc) else {
            return Ok(0);
        };

        (
            proc_of(&system, &pdevice.driver, CONTROL),
            pdevice.lp_pdevice,
        )
    };

    if procedure == 0 {
        return Ok(0);
    }

    let (answer, _) = call_driver(
        engine,
        procedure,
        &[
            GuestArg::Long(lp_pdevice),
            GuestArg::Word(escape),
            GuestArg::Long(input),
            GuestArg::Long(output),
        ],
    )
    .await?;

    Ok(answer as i16)
}

/// `StartDoc` on a driver's DC (`GDI.EXE` seg31 `0196`): the driver's
/// `Control` given `SETABORTPROC` with the DC, by a word of GDI's stack,
/// then `STARTDOC` with the document's name, and the `DOCINFO` as its
/// output where the `GDIINFO` is newer than 300h. The answer is the
/// driver's.
pub async fn driver_start_doc(
    engine: &Engine,
    hdc: u16,
    dc: usize,
    info: u32,
) -> Result<i16, Stop> {
    let (name, version) = {
        let system = engine.system();
        let name = if info == 0 {
            0
        } else {
            let bytes = system.read_far((info & 0xffff_0000) | (info.wrapping_add(2) & 0xffff), 4);

            u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        };
        let version = device_of(&system, dc).map_or(0, |pdevice| {
            u16::from_le_bytes([pdevice.info[0], pdevice.info[1]])
        });

        (name, version)
    };

    on_stack(engine, &hdc.to_le_bytes(), |far| async move {
        control(engine, dc, 9, far, 0).await
    })
    .await?;
    control(engine, dc, 10, name, if version > 0x300 { info } else { 0 }).await
}

/// `StartPage` on a driver's DC (seg31 `02ae`): the DC marked, and 1.
pub fn driver_start_page(system: &mut System, dc: usize) -> i16 {
    system.printing.drivers.pages.insert(dc);
    1
}

/// `EndPage` on a driver's DC (seg31 `02e0`): -1 on a DC `StartPage` has
/// not marked; else the escape `NEWFRAME`'s answer, or 1 where `NEXTBAND`
/// has marked it banding; both marks cleared.
pub async fn driver_end_page(engine: &Engine, hdc: u16, dc: usize) -> Result<i16, Stop> {
    let (started, banding) = {
        let system = engine.system();

        (
            system.printing.drivers.pages.contains(&dc),
            system.printing.drivers.banding.contains(&dc),
        )
    };

    if !started {
        return Ok(-1);
    }

    let answer = if banding {
        1
    } else {
        driver_escape(engine, hdc, dc, 1, 0, 0).await?
    };
    let mut system = engine.system();

    system.printing.drivers.pages.remove(&dc);
    system.printing.drivers.banding.remove(&dc);
    Ok(answer)
}

/// `EndDoc` on a driver's DC (seg31 `0234`): the driver's `Control` with
/// `ENDDOC`.
pub async fn driver_end_doc(engine: &Engine, dc: usize) -> Result<i16, Stop> {
    control(engine, dc, 11, 0, 0).await
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
        "GetTextMetrics" => Implementation::Async(get_text_metrics_call),
        "GetTextFace" => Implementation::Async(get_text_face_call),
        "CreateDC" => Implementation::Async(create_dc_call),
        "CreateIC" => Implementation::Async(create_ic_call),
        "DeleteDC" => Implementation::Async(delete_dc_call),
        _ => return None,
    })
}

/// A realized font of a driver's, as GDI keeps it: the `FONTINFO` and the
/// `TEXTXFORM`.
#[derive(Debug, Clone)]
pub struct DeviceFont {
    pub handle: u16,
    pub far: u32,
    pub info: Vec<u8>,
    pub xform: Vec<u8>,
}

/// A font a driver realized for a device: the device's number, the font
/// object, and the height and width it was realized at.
pub type FontKey = (u32, usize, i16, i16);

/// A made font's height and width in the device's units, as GDI takes them
/// before the driver realizes it (`GDI.EXE` seg3 `0b35`-`0b9c`; a stock
/// font, 8000h in its type word, keeps its own): the window origin and the
/// origin moved by the width and the height mapped to the device
/// (`LPtoDP`, seg1 `52f5`); the width their distance across; the height
/// their distance down, negative for a negative height, and 1 where it
/// comes to nought from a height that was not.
fn mapped_size(system: &System, dc: usize, logfont: &LogFont) -> (i16, i16) {
    let mapping = super::mapping::mapping_of(system, dc);
    let (wox, woy) = (mapping.wox as i32, mapping.woy as i32);
    let (height, width) = (i32::from(logfont.height), i32::from(logfont.width));
    let (x1, y1) = super::draw::device_point(&mapping, wox, woy);
    let (x2, y2) = super::draw::device_point(&mapping, wox + width, woy + height);
    let across = (x2 - x1).abs();
    let down = match (y2 - y1).abs() {
        0 if height != 0 => 1,
        down if height < 0 => -down,
        down => down,
    };

    (down as i16, across as i16)
}

/// The `LOGFONT` a font object was made of, or a stock font's.
fn logfont_of(system: &mut System, object: usize) -> Option<LogFont> {
    match &system.gdi.objects[object] {
        GdiObject::Font(Font::Made { logfont, .. }) => return Some(logfont.clone()),
        GdiObject::Font(Font::Stock { .. }) => {}
        _ => return None,
    }

    let index = (10..=16).find(|&index| {
        matches!(
            system.handles.resolve(super::objects::stock_handle(index)),
            Some(Object::Gdi(other)) if other == object
        )
    })?;

    super::objects::stock_logfont(system, index)
}

/// The `LOGFONT` given to the driver: five words, eight bytes, and room for
/// a face of 3Fh bytes, as GDI copies it (`GDI.EXE` seg3 `0b01`).
fn logfont_given(logfont: &LogFont) -> Vec<u8> {
    let mut bytes = vec![0u8; 0x12 + 0x40];

    for (at, value) in [
        logfont.height,
        logfont.width,
        logfont.escapement,
        logfont.orientation,
        logfont.weight,
    ]
    .iter()
    .enumerate()
    {
        bytes[at * 2..at * 2 + 2].copy_from_slice(&value.to_le_bytes());
    }

    bytes[0x0a..0x12].copy_from_slice(&[
        logfont.italic,
        logfont.underline,
        logfont.strike_out,
        logfont.char_set,
        logfont.out_precision,
        logfont.clip_precision & 0x0f,
        logfont.quality,
        logfont.pitch_and_family,
    ]);

    for (at, byte) in logfont.face_name.bytes().take(0x3f).enumerate() {
        bytes[0x12 + at] = byte;
    }

    bytes
}

/// The logical font selected, realized by the driver (`GDI.EXE` seg3
/// `0a68`): its `LOGFONT` copied, `lfClipPrecision`'s high bits left off,
/// the driver's `RealizeObject` asked the size of its `FONTINFO` with
/// nought for it, a block of `GlobalAlloc(2042h)` 42h bytes larger made,
/// and the font realized into it with a `TEXTXFORM` of GDI's
/// (`0c08`-`0c66`); the `TEXTXFORM`'s italic, underline and strike-out made
/// nought or `FFh`. A made font's height and width are first taken to the
/// device's units (`mapped_size`), so it is realized again for each size
/// they come to. None where the driver realizes none, which GDI maps
/// itself: not followed.
pub async fn device_font(engine: &Engine, dc: usize) -> Result<Option<DeviceFont>, Stop> {
    let (realize, lp_pdevice, bytes, key) = {
        let mut system = engine.system();
        let Some(object) = system.gdi.dcs[dc].state.font else {
            return Ok(None);
        };
        let Some(mut logfont) = logfont_of(&mut system, object) else {
            return Ok(None);
        };

        if matches!(
            system.gdi.objects[object],
            GdiObject::Font(Font::Made { .. })
        ) {
            (logfont.height, logfont.width) = mapped_size(&system, dc, &logfont);
        }

        let Some(&id) = system.printing.drivers.contexts.get(&dc) else {
            return Ok(None);
        };
        // GDI's table of realized fonts, by the device, the font and the
        // size (seg1 `3e86`): a device's contexts share what was realized
        // for it.
        let key = (id, object, logfont.height, logfont.width);

        if let Some((_, kept)) = system
            .printing
            .drivers
            .fonts
            .iter()
            .find(|(held, _)| *held == key)
        {
            return Ok(Some(kept.clone()));
        }

        let Some(pdevice) = device_of(&system, dc) else {
            return Ok(None);
        };
        let (driver, lp_pdevice) = (pdevice.driver.clone(), pdevice.lp_pdevice);
        let realize = proc_of(&system, &driver, REALIZE_OBJECT);

        (realize, lp_pdevice, logfont_given(&logfont), key)
    };

    if realize == 0 {
        return Ok(None);
    }

    // The context whose font is being realized, for GDI's TrueType engine
    // (`[064Eh]`, `engine_font.rs`).
    let before = engine.system().printing.drivers.realizing.replace(dc);
    let realized = realize_device_font(engine, key, realize, lp_pdevice, &bytes).await;

    engine.system().printing.drivers.realizing = before;
    realized
}

async fn realize_device_font(
    engine: &Engine,
    key: FontKey,
    realize: u32,
    lp_pdevice: u32,
    bytes: &[u8],
) -> Result<Option<DeviceFont>, Stop> {
    let call = move |lf: u32, info: u32, xform: u32| {
        [
            GuestArg::Long(lp_pdevice),
            GuestArg::Word(OBJ_FONT),
            GuestArg::Long(lf),
            GuestArg::Long(info),
            GuestArg::Long(xform),
        ]
    };
    let ((size, _), _) = on_stack(engine, bytes, |lf| {
        let args = call(lf, 0, 0);

        async move { call_driver(engine, realize, &args).await }
    })
    .await?;
    let size = size as u16;

    if size == 0 {
        return Ok(None);
    }

    let (handle, far) = {
        let mut system = engine.system();
        let system = &mut *system;
        let Some(index) = system.global.allocate(
            &mut system.cpu.bus,
            &mut system.descriptors,
            u32::from(size) + 0x42,
            0x2042,
        ) else {
            return Ok(None);
        };
        let handle = handle_for(index);

        (handle, system.global_pointer(handle))
    };
    let ((_, mut xform), _) = on_stack(engine, bytes, |lf| async move {
        on_stack(engine, &[0; 0x14], |xform| {
            let args = call(lf, far, xform);

            async move { call_driver(engine, realize, &args).await }
        })
        .await
    })
    .await?;
    let mut system = engine.system();
    let info = system.read_far(far, usize::from(size));

    for byte in &mut xform[0x0a..=0x0c] {
        *byte = if *byte != 0 { 0xff } else { 0 };
    }

    xform.truncate(0x13);

    let realized = DeviceFont {
        handle,
        far,
        info,
        xform,
    };

    let fonts = &mut system.printing.drivers.fonts;

    match fonts.iter_mut().find(|(held, _)| *held == key) {
        Some((_, held)) => *held = realized.clone(),
        None => fonts.push((key, realized.clone())),
    }

    Ok(Some(realized))
}

/// `GetTextMetrics` of a font a driver realized (`GDI.EXE` seg3 `0222`):
/// the height the `TEXTXFORM`'s, the ascent, descent and leadings the
/// `FONTINFO`'s scaled to it; the average width the `TEXTXFORM`'s and the
/// widest the `FONTINFO`'s scaled to it, each a pixel more where the
/// `TEXTXFORM` asks for bold made by GDI (200h in its flags); the overhang,
/// weight, italic, underline and strike-out the `TEXTXFORM`'s; the
/// characters, the character set and the resolutions the `FONTINFO`'s; the
/// pitch and family the `FONTINFO`'s with `TMPF_DEVICE` and its type's two
/// low bits as `TMPF_VECTOR` and `TMPF_TRUETYPE`. Not followed: the other
/// widths of a font GDI emboldens (byte 0Bh, bit 3, `02de`), and the
/// metrics taken to logical units in a mapping mode other than `MM_TEXT`.
pub fn device_text_metrics(realized: &DeviceFont) -> TextMetric {
    let (info, xform) = (&realized.info, &realized.xform);
    let word = |bytes: &[u8], at: usize| i32::from(i16::from_le_bytes([bytes[at], bytes[at + 1]]));
    let height = word(xform, 0);
    let width = word(xform, 2);
    let pix_height = word(info, 0x16);
    let ascent = word(info, 8);
    let bold = i32::from(word(xform, 0x0f) & 0x200 != 0);
    let first = info[0x1d];
    let mul_div = super::calls::mul_div;

    TextMetric {
        height,
        ascent: mul_div(ascent, height, pix_height),
        descent: mul_div(pix_height - ascent, height, pix_height),
        internal_leading: mul_div(word(info, 0x0a), height, pix_height),
        external_leading: mul_div(word(info, 0x0c), height, pix_height),
        ave_char_width: bold + width,
        max_char_width: mul_div(word(info, 0x1b), width, word(info, 0x19)) + bold,
        weight: word(xform, 8) & 0xffff,
        italic: xform[0x0a],
        underlined: xform[0x0b],
        struck_out: xform[0x0c],
        first_char: first,
        last_char: info[0x1e],
        default_char: info[0x1f].wrapping_add(first),
        break_char: info[0x20].wrapping_add(first),
        pitch_and_family: (info[0x18] & 0xf1) | 8 | ((info[0] & 3) << 1),
        char_set: info[0x13],
        overhang: word(xform, 0x11),
        digitized_aspect_x: word(info, 4),
        digitized_aspect_y: word(info, 6),
    }
}

/// `GetTextFace` of a font a driver realized (`GDI.EXE` seg3 `0102`): the
/// face the `FONTINFO` names at its `dfFace`, or the logical font's own
/// spelling where the two are one atom.
fn device_face(system: &mut System, dc: usize, realized: &DeviceFont) -> Vec<u8> {
    let offset = u32::from(u16::from_le_bytes([
        realized.info[0x27],
        realized.info[0x28],
    ]));
    let far = (realized.far & 0xffff_0000) | (realized.far.wrapping_add(offset) & 0xffff);
    let face = system.read_string(far);
    let logical = system.gdi.dcs[dc]
        .state
        .font
        .and_then(|object| logfont_of(system, object))
        .map(|logfont| logfont.face_name.into_bytes())
        .unwrap_or_default();

    if !logical.is_empty() && logical.eq_ignore_ascii_case(&face) {
        logical
    } else {
        face
    }
}

fn get_text_metrics_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let mut original = args;
        let (driver, far) = {
            let system = engine.system();
            let hdc = args.word(&system);
            let far = args.dword(&system);

            (driver_dc_of(&system, hdc), far)
        };
        let Some(dc) = driver else {
            return super::text::get_text_metrics_call(&mut engine.system(), &mut original);
        };
        let Some(realized) = device_font(engine, dc).await? else {
            return Ok(Answer::Word(0));
        };

        engine
            .system()
            .write_far(far, &device_text_metrics(&realized).bytes());
        Ok(Answer::Word(1))
    })
}

fn get_text_face_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let mut original = args;
        let (driver, size, far) = {
            let system = engine.system();
            let hdc = args.word(&system);
            let size = args.signed(&system);
            let far = args.dword(&system);

            (driver_dc_of(&system, hdc), size, far)
        };
        let Some(dc) = driver else {
            return super::text::get_text_face_call(&mut engine.system(), &mut original);
        };

        if size <= 0 {
            return Ok(Answer::Word(0));
        }

        let Some(realized) = device_font(engine, dc).await? else {
            return Ok(Answer::Word(0));
        };
        let mut system = engine.system();
        let face = device_face(&mut system, dc, &realized);
        let copied = face.len().min(size as usize - 1);
        let mut bytes = face[..copied].to_vec();

        bytes.push(0);
        system.write_far(far, &bytes);
        Ok(Answer::Word(copied as u16))
    })
}

/// A walk of a driver's fonts, as GDI's frame for its procedure keeps it
/// (seg5 `01c5`).
#[derive(Debug, Clone)]
pub struct FontWalk {
    pub procedure: u32,
    pub data: u32,
    pub found: bool,
    pub face_given: bool,
}

/// GDI's procedure for a driver's fonts (`GDI.EXE` seg5 `048a`): with no
/// face asked for and `TTOnly` on, a font not TrueType passes by, and 1 is
/// answered. Otherwise the walk has found one; a font not TrueType is a device
/// font, `DEVICE_FONTTYPE` added and its `tmPitchAndFamily` given
/// `TMPF_DEVICE` and, but for a raster font, `TMPF_VECTOR`, in the driver's
/// own structure; its `TEXTMETRIC` copied with the five words of a
/// `NEWTEXTMETRIC` after it nought. The program's procedure is called with
/// the `LOGFONT`, the metrics, the type and its data, AX, DS and ES the
/// stack's, and its answer is the answer. Not followed: the compatibility
/// flags' changes to a TrueType font's type (`0542`-`0565`), and the sizes
/// taken to logical units in a mapping mode other than `MM_TEXT` (`04b5`).
pub async fn font_callback(
    engine: &Engine,
    logfont: u32,
    metrics: u32,
    kind: u16,
    id: u32,
) -> Result<u16, Stop> {
    let (walk, copy, kind) = {
        let mut system = engine.system();
        let Some(walk) = system.printing.drivers.walks.get(id as usize).cloned() else {
            return Ok(0);
        };

        if !walk.face_given && system.fonts().true_type_only && kind & 4 == 0 {
            return Ok(1);
        }

        system.printing.drivers.walks[id as usize].found = true;

        let mut kind = kind;

        if kind & 4 == 0 {
            kind |= 2;

            let at = (metrics & 0xffff_0000) | (metrics.wrapping_add(0x17) & 0xffff);
            let pitch = system.read_far(at, 1)[0];
            let vector = if kind & 1 == 0 { 2 } else { 0 };

            system.write_far(at, &[(pitch & 0xf1) | 8 | vector]);
        }

        let copy = if kind & 4 == 0 {
            let mut bytes = system.read_far(metrics, 31);

            bytes.extend([0; 10]);
            Some(bytes)
        } else {
            None
        };

        (walk, copy, kind)
    };
    let stack = engine.system().cpu.segments[SS].selector;
    let registers = [
        crate::engine::Register::Word(winbox_cpu::AX, stack),
        crate::engine::Register::Segment(winbox_cpu::DS, stack),
        crate::engine::Register::Segment(winbox_cpu::ES, stack),
    ];
    let call = |tm: u32| {
        [
            GuestArg::Long(logfont),
            GuestArg::Long(tm),
            GuestArg::Word(kind),
            GuestArg::Long(walk.data),
        ]
    };
    let answer = match copy {
        None => {
            engine
                .call_with(walk.procedure, &call(metrics), &registers)
                .await?
                .0
        }
        Some(bytes) => {
            on_stack(engine, &bytes, |far| {
                let args = call(far);

                async move { Ok(engine.call_with(walk.procedure, &args, &registers).await?.0) }
            })
            .await?
            .0
        }
    };

    Ok(answer as u16)
}

/// The driver's own fonts, before GDI's (`GDI.EXE` seg5 `01c5`-`021f`): its
/// `EnumDFonts` given the `PDEVICE`, the face asked for, GDI's procedure
/// and GDI's frame. Its answer, and whether any font came to GDI's
/// procedure.
pub async fn enumerate_device_fonts(
    engine: &Engine,
    dc: usize,
    face: u32,
    procedure: u32,
    data: u32,
) -> Result<(u16, bool), Stop> {
    let (enumerate, lp_pdevice, thunk, id) = {
        let mut system = engine.system();
        let Some(pdevice) = device_of(&system, dc) else {
            return Ok((1, false));
        };
        let (driver, lp_pdevice) = (pdevice.driver.clone(), pdevice.lp_pdevice);
        let enumerate = proc_of(&system, &driver, ENUM_DFONTS);

        if enumerate == 0 {
            return Ok((1, false));
        }

        let thunk = system.proc_token(&crate::classes::WndProc::Host(
            crate::classes::HostProc::FontWalk,
        ));

        system.printing.drivers.walks.push(FontWalk {
            procedure,
            data,
            found: false,
            face_given: face != 0,
        });

        let id = system.printing.drivers.walks.len() - 1;

        (enumerate, lp_pdevice, thunk, id)
    };
    let answer = call_driver(
        engine,
        enumerate,
        &[
            GuestArg::Long(lp_pdevice),
            GuestArg::Long(face),
            GuestArg::Long(thunk),
            GuestArg::Long(id as u32),
        ],
    )
    .await;
    let walk = engine.system().printing.drivers.walks.pop();
    let (answer, _) = answer?;

    Ok((answer as u16, walk.is_some_and(|walk| walk.found)))
}
