//! MCI, MMSYSTEM's media control interface: `mciSendCommand` and the calls
//! about its devices.
//!
//! **Read out** of `MMSYSTEM.DLL` (seg5 `4af`-`2c16`) and **recorded** by
//! `mcidevs`, which opens each device `SYSTEM.INI`'s `[mci]` names by its
//! type, asks its capabilities and product, and closes it, as Media Player
//! does as it starts:
//!
//! * A device is opened by its type, the key naming its driver in `[mci]` --
//!   or the key with a digit after it, or its driver's file's name -- or by
//!   a file whose extension `WIN.INI`'s `[mci extensions]` names a type for.
//!   Its driver is opened as an installable driver, in the section `mci`,
//!   handed the new device's ID and the words after the driver's file's
//!   name, and sent `MCI_OPEN_DRIVER`. A type nothing names is 107h, a
//!   driver that cannot be opened 10Ah: `CDAudio`, whose `MCICDA.DRV` the
//!   installation lacks.
//! * Device IDs count from 1, the lowest free one taken.
//! * `MCI_CLOSE` sends `MCI_CLOSE_DRIVER` and closes the driver.
//!   `MCI_SYSINFO` and `MCI_BREAK` MMSYSTEM answers itself. Every other
//!   command goes to the device's driver as it is; one for an ID not open is
//!   101h, and one for `FFFFh` goes to every device the task opened.
//! * The answer is the low word of the driver's; with 10000h in it, the high
//!   word of the caller's `dwReturn` is cleared; an error of 200h and up has
//!   the device's ID in its high word.
//!
//! Not followed: `MCI_SOUND`, whose sound winbox.js does not play; opening
//! by element ID; the devices `mciSendString` opens itself; the command
//! tables, which only `mciSendString` reads.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use crate::call::{Answer, Args, Later, Stop};
use crate::drivers::lpcstr;
use crate::engine::Engine;
use crate::handles::Object;
use crate::profile::lower;
use crate::system::System;

use super::strings;

pub const MCI_ALL_DEVICE_ID: u16 = 0xffff;

const MCI_OPEN_DRIVER: u16 = 0x801;
const MCI_CLOSE_DRIVER: u16 = 0x802;
const MCI_OPEN: u16 = 0x803;
const MCI_CLOSE: u16 = 0x804;
const MCI_SYSINFO: u16 = 0x810;
const MCI_BREAK: u16 = 0x811;
const MCI_SOUND: u16 = 0x812;

const MCI_OPEN_ELEMENT: u32 = 0x200;
const MCI_OPEN_ALIAS: u32 = 0x400;
const MCI_OPEN_ELEMENT_ID: u32 = 0x800;
const MCI_OPEN_TYPE_ID: u32 = 0x1000;
const MCI_OPEN_TYPE: u32 = 0x2000;

const MCIERR_INVALID_DEVICE_ID: u32 = 0x101;
const MCIERR_HARDWARE: u32 = 0x106;
const MCIERR_INVALID_DEVICE_NAME: u32 = 0x107;
const MCIERR_DEVICE_OPEN: u32 = 0x109;
const MCIERR_CANNOT_LOAD_DRIVER: u32 = 0x10a;
const MCIERR_PARAM_OVERFLOW: u32 = 0x10c;
const MCIERR_MISSING_PARAMETER: u32 = 0x111;
const MCIERR_CANNOT_USE_ALL: u32 = 0x117;
const MCIERR_MULTIPLE: u32 = 0x118;
const MCIERR_EXTENSION_NOT_FOUND: u32 = 0x119;
const MCIERR_OUTOFRANGE: u32 = 0x11a;
const MCIERR_FLAGS_NOT_COMPATIBLE: u32 = 0x11c;
const MCIERR_DEVICE_TYPE_REQUIRED: u32 = 0x11f;
const MCIERR_DEVICE_LOCKED: u32 = 0x120;
const MCIERR_DUPLICATE_ALIAS: u32 = 0x121;
const MCIERR_NULL_PARAMETER_BLOCK: u32 = 0x129;
const MCIERR_NO_ELEMENT_ALLOWED: u32 = 0x131;
const MCIERR_DEVICE_NOT_INSTALLED: u32 = 0x132;
const MCIERR_DEVICE_LENGTH: u32 = 0x136;

pub const RESOURCE_RETURNED: u32 = 0x10000;

/// A device open.
#[derive(Debug, Clone)]
pub struct Device {
    /// Its alias.
    name: Vec<u8>,
    /// The key naming its driver in `[mci]`.
    kind: Vec<u8>,
    driver: u16,
    module: u16,
    w_type: u16,
    task: u16,
    closing: bool,
    data: u32,
    break_key: Option<u16>,
}

/// The devices open, by ID, and the ID past the last.
#[derive(Debug)]
pub struct Table {
    devices: Vec<Option<Device>>,
    count: u16,
}

impl Default for Table {
    fn default() -> Self {
        Self {
            devices: Vec::new(),
            count: 1,
        }
    }
}

impl Table {
    fn device(&self, id: u16) -> Option<&Device> {
        self.devices.get(usize::from(id))?.as_ref()
    }

    fn device_mut(&mut self, id: u16) -> Option<&mut Device> {
        self.devices.get_mut(usize::from(id))?.as_mut()
    }

    /// A new device's ID (seg5 `19b4`): the lowest free, or the next.
    fn allocate(&mut self) -> u16 {
        for id in 1..self.count {
            if self.device(id).is_none() {
                return id;
            }
        }

        self.count += 1;
        self.count - 1
    }

    fn set(&mut self, id: u16, device: Option<Device>) {
        let at = usize::from(id);

        if self.devices.len() <= at {
            self.devices.resize(at + 1, None);
        }

        self.devices[at] = device;
    }

    fn release(&mut self, id: u16) {
        self.set(id, None);

        if id == self.count - 1 {
            self.count -= 1;
        }
    }
}

/// Two strings the same without regard to case, as JavaScript lowers them.
pub(crate) fn same(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len() && left.iter().zip(right).all(|(&a, &b)| lower(a) == lower(b))
}

fn word_at(system: &System, far: u32) -> u16 {
    let bytes = system.read_far(far, 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

pub(crate) fn long_at(system: &System, far: u32) -> u32 {
    let bytes = system.read_far(far, 4);

    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

/// A far pointer `step` bytes on, its offset kept in its segment.
pub(crate) fn far_at(far: u32, step: u32) -> u32 {
    (far & 0xffff_0000) | (far.wrapping_add(step) & 0xffff)
}

/// A string a far pointer points at; `None` where its segment is nought.
fn string_at(system: &System, far: u32) -> Option<Vec<u8>> {
    (far >> 16 != 0).then(|| system.read_string(far))
}

/// The task running, as MCI keeps a device by the task that opened it.
fn task_of(system: &System) -> u16 {
    system.task_handle
}

/// The ID a name is open as for a task (seg5 `14f5`): `FFFFh` for "all",
/// nought for none.
pub fn find(system: &System, task: u16, name: &[u8]) -> u16 {
    if same(name, b"all") {
        return MCI_ALL_DEVICE_ID;
    }

    let table = &system.mmsystem.mci;

    (1..table.count)
        .find(|&id| {
            table
                .device(id)
                .is_some_and(|device| device.task == task && same(&device.name, name))
        })
        .unwrap_or(0)
}

/// The type a file's extension names in `[mci extensions]`, or `None` (seg5
/// `2249`).
fn type_of_file(system: &mut System, element: &[u8]) -> Option<Vec<u8>> {
    if element.contains(&b'!') || element.len() < 2 || element.ends_with(b".") {
        return None;
    }

    let extension = match element.iter().rposition(|&byte| byte == b'.') {
        Some(dot) => &element[dot + 1..],
        None => &[][..],
    };

    if extension.is_empty()
        || extension.len() > 3
        || extension.contains(&b'\\')
        || extension.contains(&b'/')
    {
        return None;
    }

    system
        .read_profile(b"WIN.INI")
        .get(b"mci extensions", extension, true)
        .filter(|value| !value.is_empty())
}

/// The driver a type names in `[mci]` (seg5 `1e77`, `1cb4`): the key used
/// and its value, or an error.
fn driver_of(system: &mut System, kind: &[u8]) -> Result<(Vec<u8>, Vec<u8>), u32> {
    let profile = system.read_profile(b"system.ini");
    let mut keys = vec![kind.to_vec()];

    for digit in 1..=9 {
        keys.push([kind, format!("{digit}").as_bytes()].concat());
    }

    for key in keys {
        if let Some(value) = profile
            .get(b"mci", &key, true)
            .filter(|value| !value.is_empty())
        {
            return Ok((key, value));
        }
    }

    let keys = profile.entries(b"mci");

    if keys.is_empty() {
        return Err(MCIERR_DEVICE_NOT_INSTALLED);
    }

    if kind.len() >= 0x50 {
        return Err(MCIERR_DEVICE_LENGTH);
    }

    for key in keys {
        let value = profile.get(b"mci", &key, true).unwrap_or_default();

        if value.is_empty() {
            return Err(MCIERR_CANNOT_LOAD_DRIVER);
        }

        let first = value.split(|&byte| byte == b' ').next().unwrap_or_default();
        let file = first
            .rsplit(|&byte| byte == b'\\' || byte == b'/' || byte == b':')
            .next()
            .unwrap_or_default();

        if file.starts_with(kind) && (file.len() == kind.len() || file[kind.len()] == b'.') {
            return if key.len() >= 0x50 {
                Err(MCIERR_DEVICE_LENGTH)
            } else {
                Ok((key, value))
            };
        }
    }

    Err(MCIERR_INVALID_DEVICE_NAME)
}

/// What an `MCI_OPEN_PARMS` names, as `open` reads it: nothing given, a
/// null string, or a string.
enum Named {
    Missing,
    Null,
    Text(Vec<u8>),
}

impl Engine {
    /// `MCI_OPEN` (seg5 `24e4`, `1e77`).
    #[allow(clippy::too_many_lines)]
    async fn mci_open(&self, mut flags: u32, parms: u32) -> Result<u32, Stop> {
        if parms == 0 {
            return Ok(MCIERR_NULL_PARAMETER_BLOCK);
        }

        let (mut kind, mut element, alias, task, type_far) = {
            let system = self.system();
            let type_far = long_at(&system, parms.wrapping_add(8));
            // Each pointer is read only when its flag says it is there: the
            // rest may be anything.
            let kind = if flags & MCI_OPEN_TYPE != 0 && flags & MCI_OPEN_TYPE_ID == 0 {
                string_at(&system, type_far)
            } else {
                None
            };
            let element = if flags & (MCI_OPEN_ELEMENT | MCI_OPEN_ELEMENT_ID) != 0 {
                string_at(&system, long_at(&system, parms.wrapping_add(0x0c)))
            } else {
                None
            };
            let alias = if flags & MCI_OPEN_ALIAS != 0 {
                string_at(&system, long_at(&system, parms.wrapping_add(0x10)))
            } else {
                None
            };

            (kind, element, alias, task_of(&system), type_far)
        };

        if flags & MCI_OPEN_TYPE_ID != 0 {
            let Some(named) = strings::string(type_far as u16) else {
                return Ok(MCIERR_EXTENSION_NOT_FOUND);
            };
            let mut named = named.to_vec();

            if type_far >> 16 != 0 {
                named.extend_from_slice((type_far >> 16).to_string().as_bytes());
            }

            kind = Some(named);
        }

        let name = if flags & MCI_OPEN_ELEMENT != 0 {
            element.clone().map_or(Named::Null, Named::Text)
        } else if flags & MCI_OPEN_TYPE != 0 {
            kind.clone().map_or(Named::Null, Named::Text)
        } else {
            Named::Missing
        };
        let name = match name {
            Named::Missing => return Ok(MCIERR_MISSING_PARAMETER),
            Named::Null => return Ok(MCIERR_INVALID_DEVICE_NAME),
            Named::Text(name) => name,
        };

        {
            let mut system = self.system();

            if flags & MCI_OPEN_ELEMENT_ID == 0 {
                let looked = if flags & MCI_OPEN_ALIAS != 0 {
                    alias.clone().unwrap_or_default()
                } else {
                    name.clone()
                };

                if find(&system, task, &looked) != 0 {
                    return Ok(if flags & MCI_OPEN_ALIAS != 0 {
                        MCIERR_DUPLICATE_ALIAS
                    } else {
                        MCIERR_DEVICE_OPEN
                    });
                }
            }

            if flags & MCI_OPEN_TYPE_ID == 0 {
                if flags & MCI_OPEN_ELEMENT != 0 && flags & MCI_OPEN_TYPE == 0 {
                    kind = type_of_file(&mut system, &element.clone().unwrap_or_default());

                    if kind.is_none() {
                        return Ok(MCIERR_EXTENSION_NOT_FOUND);
                    }

                    flags |= MCI_OPEN_TYPE;
                } else if flags & MCI_OPEN_TYPE != 0 && flags & MCI_OPEN_ELEMENT == 0 {
                    let named = type_of_file(&mut system, &kind.clone().unwrap_or_default());

                    if let Some(named) = named {
                        element = kind.take();
                        kind = Some(named);
                        flags |= MCI_OPEN_ELEMENT;
                    } else if let Some(text) = kind.clone().filter(|text| text.contains(&b'!')) {
                        let mut pieces = text.split(|&byte| byte == b'!');
                        let first = pieces.next().unwrap_or_default().to_vec();
                        let part = pieces.next().unwrap_or_default().to_vec();

                        if first.is_empty() {
                            return Ok(MCIERR_NO_ELEMENT_ALLOWED);
                        }

                        if !part.is_empty() {
                            if flags & MCI_OPEN_ALIAS == 0 && find(&system, task, &part) != 0 {
                                return Ok(MCIERR_DEVICE_OPEN);
                            }

                            element = Some(part);
                            flags |= MCI_OPEN_ELEMENT;
                        }

                        kind = Some(first);
                    }
                }
            }
        }

        // The alias, when none is given: the element, or the type.
        let mut device_name = if flags & MCI_OPEN_ALIAS != 0 {
            Some(alias.unwrap_or_default())
        } else {
            None
        };

        if flags & MCI_OPEN_ALIAS == 0 {
            device_name = if flags & MCI_OPEN_ELEMENT != 0 {
                if flags & MCI_OPEN_ELEMENT_ID != 0 {
                    None
                } else {
                    element.clone()
                }
            } else {
                kind.clone()
            };

            if device_name.is_some() {
                flags |= MCI_OPEN_ALIAS;
            }
        }

        let (id, file, block, words_block, open_parms) = {
            let mut system = self.system();
            let (key, value) = match driver_of(&mut system, &kind.clone().unwrap_or_default()) {
                Ok(found) => found,
                Err(error) => return Ok(error),
            };
            let (file, words) = match value.iter().position(|&byte| byte == b' ') {
                Some(space) => (value[..space].to_vec(), value[space + 1..].to_vec()),
                None => (value.clone(), Vec::new()),
            };
            let id = system.mmsystem.mci.allocate();

            system.mmsystem.mci.set(
                id,
                Some(Device {
                    name: device_name
                        .or_else(|| element.clone())
                        .or_else(|| kind.clone())
                        .unwrap_or_default(),
                    kind: key,
                    driver: 0,
                    module: 0,
                    w_type: 0,
                    task,
                    closing: false,
                    data: 0,
                    break_key: None,
                }),
            );

            // `MCI_OPEN_DRIVER_PARMS`: the ID, the words after the driver's
            // name, the command table and the type, the last two the
            // driver's to fill.
            let (words_block, words_far) = system.scratch_block(words.len() as u32 + 1);

            system.write_far(words_far, &words);

            let (block, open_parms) = system.scratch_block(10);
            let mut bytes = id.to_le_bytes().to_vec();

            bytes.extend_from_slice(&words_far.to_le_bytes());
            bytes.extend_from_slice(&[0xff, 0xff, 0, 0]);
            system.write_far(open_parms, &bytes);
            (id, file, block, words_block, open_parms)
        };
        let driver = self.open_driver(&file, Some(b"mci"), open_parms).await?;

        {
            let mut system = self.system();
            let w_type = word_at(&system, far_at(open_parms, 8));

            system.free_scratch(block);
            system.free_scratch(words_block);

            if driver == 0 {
                system.mmsystem.mci.release(id);
                return Ok(MCIERR_CANNOT_LOAD_DRIVER);
            }

            let mut bytes = id.to_le_bytes().to_vec();

            bytes.extend_from_slice(&[0, 0]);
            system.write_far(far_at(parms, 4), &bytes);

            let module = crate::drivers::driver_module(&system, driver);

            if let Some(device) = system.mmsystem.mci.device_mut(id) {
                device.driver = driver;
                device.module = module;
                device.w_type = w_type;
            }
        }

        let answer =
            Box::pin(self.mci_send_command(id, MCI_OPEN_DRIVER, flags, parms)).await? & 0xffff;

        if answer != 0 {
            Box::pin(self.mci_close(id, 0, 0, false)).await?;
            return Ok(answer);
        }

        if let Some(device) = self.system().mmsystem.mci.device_mut(id) {
            device.break_key = Some(3);
        }

        Ok(0)
    }

    /// `MCI_CLOSE` (seg5 `2926`): `MCI_CLOSE_DRIVER` if asked, then the
    /// driver closed and the ID let go.
    async fn mci_close(
        &self,
        id: u16,
        flags: u32,
        mut parms: u32,
        send_close: bool,
    ) -> Result<u32, Stop> {
        let driver = {
            let mut system = self.system();

            match system.mmsystem.mci.device_mut(id) {
                Some(device) if !device.closing => {
                    device.closing = true;
                    device.driver
                }
                _ => return Ok(0),
            }
        };
        let mut answer = 0;

        if send_close {
            let mut dummy = None;

            if parms == 0 {
                let (block, far) = self.system().scratch_block(10);

                dummy = Some(block);
                parms = far;
            }

            answer =
                Box::pin(self.mci_send_command(id, MCI_CLOSE_DRIVER, flags, parms)).await? & 0xffff;

            if let Some(block) = dummy {
                self.system().free_scratch(block);
            }
        }

        self.close_driver(driver, 0, 0).await?;
        self.system().mmsystem.mci.release(id);
        Ok(answer)
    }

    /// A command to one device (seg5 `18d`).
    async fn mci_route(&self, id: u16, message: u16, flags: u32, parms: u32) -> Result<u32, Stop> {
        match message {
            MCI_OPEN => Ok(self.mci_open(flags, parms).await? & 0xffff),
            MCI_CLOSE => self.mci_close(id, flags, parms, true).await,
            MCI_SYSINFO => mci_sysinfo(&mut self.system(), id, flags, parms),
            MCI_BREAK => Ok(mci_break(&mut self.system(), id, flags, parms)),
            // The sound `MCI_SOUND` plays, which winbox.js does not: it
            // answers FALSE.
            MCI_SOUND => Ok(MCIERR_HARDWARE),
            _ => {
                let driver = self
                    .system()
                    .mmsystem
                    .mci
                    .device(id)
                    .map_or(0, |device| device.driver);

                self.send_to_driver(driver, message, flags, parms).await
            }
        }
    }

    /// One device's command, as the dispatcher checks it (seg5 `2e2`).
    async fn mci_dispatch(
        &self,
        id: u16,
        message: u16,
        flags: u32,
        parms: u32,
    ) -> Result<u32, Stop> {
        if id == MCI_ALL_DEVICE_ID {
            if message == MCI_SYSINFO || message == MCI_SOUND {
                return self.mci_route(id, message, flags, parms).await;
            }

            if message == MCI_OPEN {
                return Ok(MCIERR_CANNOT_USE_ALL);
            }

            let task = task_of(&self.system());
            let mut total = 0;
            let mut each = 1;

            while each < self.system().mmsystem.mci.count {
                let device = self.system().mmsystem.mci.device(each).cloned();

                if let Some(device) = device.filter(|device| device.task == task) {
                    if device.closing && message != MCI_CLOSE_DRIVER {
                        return Ok(total);
                    }

                    let answer = Box::pin(self.mci_route(each, message, flags, parms)).await?;

                    if answer != 0 {
                        total = if total != 0 { MCIERR_MULTIPLE } else { answer };
                    }
                }

                each += 1;
            }

            return Ok(total);
        }

        if message != MCI_OPEN && message != MCI_SOUND && message != MCI_SYSINFO {
            let system = self.system();
            let table = &system.mmsystem.mci;
            let device = if id != 0 && id < table.count {
                table.device(id)
            } else {
                None
            };

            let Some(device) = device else {
                return Ok(MCIERR_INVALID_DEVICE_ID);
            };

            if device.closing && message != MCI_CLOSE_DRIVER {
                return Ok(MCIERR_DEVICE_LOCKED);
            }
        }

        self.mci_route(id, message, flags, parms).await
    }

    /// Sends a device a command: nought, or an error; a driver's own with
    /// the ID in its high word.
    pub async fn mci_send_command(
        &self,
        id: u16,
        message: u16,
        flags: u32,
        parms: u32,
    ) -> Result<u32, Stop> {
        Ok(self
            .mci_send_command_given(id, message, flags, parms)
            .await?
            .0)
    }

    /// `mci_send_command`, and what the driver says its answer is given
    /// back as where it succeeds: the high word of its return, as
    /// `MCI_COLONIZED4_RETURN`, which `mciSendString` reads.
    pub async fn mci_send_command_given(
        &self,
        id: u16,
        message: u16,
        flags: u32,
        parms: u32,
    ) -> Result<(u32, u32), Stop> {
        let answer = self.mci_dispatch(id, message, flags, parms).await?;

        if answer & RESOURCE_RETURNED != 0 && parms != 0 {
            self.system().write_far(far_at(parms, 6), &[0, 0]);
        }

        let low = answer & 0xffff;

        Ok(if low >= 0x200 {
            (low | u32::from(id) << 16, 0)
        } else if low == 0 {
            (low, answer & 0xffff_0000)
        } else {
            (low, 0)
        })
    }
}

/// `MCI_SYSINFO` (seg5 `16bb`): the devices installed, or open.
#[allow(clippy::too_many_lines)]
fn mci_sysinfo(system: &mut System, id: u16, flags: u32, parms: u32) -> Result<u32, Stop> {
    const QUANTITY: u32 = 0x100;
    const OPEN: u32 = 0x200;
    const NAME: u32 = 0x400;
    const INSTALLNAME: u32 = 0x800;

    // The size and the number are read as winbox.js reads them, as signed
    // longs: one with its top bit set is less than nought.
    let return_far = long_at(system, parms.wrapping_add(4));
    let size = i64::from(long_at(system, parms.wrapping_add(8)).cast_signed());
    let number = i64::from(long_at(system, parms.wrapping_add(0x0c)).cast_signed());
    let w_type = word_at(system, far_at(parms, 0x10));
    let write = |system: &mut System, text: &[u8]| {
        let mut bytes = text.to_vec();

        bytes.push(0);
        system.write_far(return_far, &bytes);
    };
    let write_long = |system: &mut System, value: u32| {
        system.write_far(return_far, &value.to_le_bytes());
    };

    if flags & NAME != 0 && number == 0 {
        return Ok(MCIERR_OUTOFRANGE);
    }

    if return_far == 0 || size == 0 {
        return Ok(MCIERR_PARAM_OVERFLOW);
    }

    if flags & NAME != 0 && flags & QUANTITY != 0 {
        return Ok(MCIERR_FLAGS_NOT_COMPATIBLE);
    }

    if flags & INSTALLNAME != 0 {
        if id == MCI_ALL_DEVICE_ID {
            return Ok(MCIERR_CANNOT_USE_ALL);
        }

        let Some(device) = system.mmsystem.mci.device(id).cloned() else {
            return Ok(MCIERR_INVALID_DEVICE_NAME);
        };

        if device.kind.len() as i64 >= size {
            return Ok(MCIERR_PARAM_OVERFLOW);
        }

        write(system, &device.kind);
        return Ok(0);
    }

    if flags & OPEN == 0 {
        if id != MCI_ALL_DEVICE_ID && w_type == 0 {
            return Ok(MCIERR_DEVICE_TYPE_REQUIRED);
        }

        if flags & (QUANTITY | NAME) == 0 {
            return Ok(MCIERR_MISSING_PARAMETER);
        }

        let keys = system.read_profile(b"system.ini").entries(b"mci");
        // The device type's name, `^name\d*$` without regard to case.
        let type_name = w_type
            .checked_sub(0x201)
            .filter(|&at| at < 11)
            .and_then(|at| strings::string(0x201 + at));
        let matching: Vec<Vec<u8>> = if id == MCI_ALL_DEVICE_ID {
            keys
        } else {
            keys.into_iter()
                .filter(|key| {
                    type_name.is_some_and(|name| {
                        key.len() >= name.len()
                            && same(&key[..name.len()], name)
                            && key[name.len()..].iter().all(u8::is_ascii_digit)
                    })
                })
                .collect()
        };

        if flags & QUANTITY != 0 {
            write_long(system, matching.len() as u32);
            return Ok(RESOURCE_RETURNED);
        }

        if number > matching.len() as i64 {
            return Ok(MCIERR_OUTOFRANGE);
        }

        // A number less than nought finds no name in winbox.js's list, and
        // what it writes is JavaScript's text for none.
        let name = usize::try_from(number - 1)
            .ok()
            .and_then(|at| matching.get(at))
            .map_or_else(|| b"undefined".to_vec(), Clone::clone);

        write(system, &name);
        return Ok(0);
    }

    let task = task_of(system);
    let open: Vec<Vec<u8>> = system
        .mmsystem
        .mci
        .devices
        .iter()
        .flatten()
        .filter(|device| {
            device.task == task && (id == MCI_ALL_DEVICE_ID || device.w_type == w_type)
        })
        .map(|device| device.name.clone())
        .collect();

    if flags & QUANTITY != 0 {
        if size >= 4 {
            write_long(system, open.len() as u32);
        }

        return Ok(RESOURCE_RETURNED);
    }

    if number > open.len() as i64 {
        system.write_far(far_at(parms, 4), &[0, 0, 0, 0]);
        return Ok(MCIERR_OUTOFRANGE);
    }

    // The TypeScript engine reads the open devices' list before its start
    // here, for a number of nought or less than nought, and fails.
    let Some(name) = usize::try_from(number - 1).ok().and_then(|at| open.get(at)) else {
        return Err(Stop::Unsupported(
            "MCI_SYSINFO_OPEN asked for device nought or less",
        ));
    };

    write(system, &name.clone());
    Ok(0)
}

/// `MCI_BREAK` (seg5 `bc`): the key that breaks a wait, or none.
fn mci_break(system: &mut System, id: u16, flags: u32, parms: u32) -> u32 {
    const KEY: u32 = 0x100;
    const OFF: u32 = 0x400;

    if flags & KEY != 0 && flags & OFF != 0 {
        return MCIERR_FLAGS_NOT_COMPATIBLE;
    }

    if flags & KEY != 0 {
        let key = word_at(system, far_at(parms, 4));
        let Some(device) = system.mmsystem.mci.device_mut(id) else {
            return 0x0b;
        };

        device.break_key = Some(key);
        return 0;
    }

    if flags & OFF != 0 {
        if let Some(device) = system.mmsystem.mci.device_mut(id) {
            device.break_key = None;
        }

        return 0;
    }

    MCIERR_MISSING_PARAMETER
}

/// Sends a device a command: the device, `FFFFh` for all the task's, or
/// nought to open one; the command; its flags; its parameter block.
pub fn mci_send_command_call(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, message, flags, parms) = {
            let system = engine.system();

            (
                args.word(&system),
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            engine.mci_send_command(id, message, flags, parms).await?,
        ))
    })
}

/// One string of a module's string table, read from its file; `None` where
/// there is none. A word read past what was read is nought, as the
/// TypeScript engine reads one.
fn module_string(system: &mut System, path: &str, id: u16) -> Option<Vec<u8>> {
    if path.is_empty() {
        return None;
    }

    // The file is left open, as winbox.js leaves it: its DOS handle stays
    // taken, and a file the program opens after has the next.
    let handle = system.files.open(path)?;
    let file = system.files.resolve(handle)?;
    let size = file.size() as usize;
    let bytes = file.read(size);

    string_in(&bytes, id)
}

/// One string of the string table of a module's file, as its bytes.
fn string_in(bytes: &[u8], id: u16) -> Option<Vec<u8>> {
    let read = |offset: usize, length: usize| -> &[u8] {
        let start = offset.min(bytes.len());

        &bytes[start..(start + length).min(bytes.len())]
    };
    let word = |slice: &[u8], at: usize| -> usize {
        usize::from(slice.get(at).copied().unwrap_or(0))
            | usize::from(slice.get(at + 1).copied().unwrap_or(0)) << 8
    };
    let mz = read(0, 0x40);
    let ne = word(mz, 0x3c) | word(mz, 0x3e) << 16;
    let header = read(ne, 0x40);
    let table = ne + word(header, 0x24);
    let resources = read(table, word(header, 0x26).checked_sub(word(header, 0x24))?);
    let shift = word(resources, 0);
    let block = usize::from(id >> 4) + 1;
    let mut at = 2;

    while word(resources, at) != 0 {
        let kind = word(resources, at);
        let count = word(resources, at + 2);

        at += 8;

        for _ in 0..count {
            if kind == 0x8006 && word(resources, at + 6) & 0x7fff == block {
                let data = read(
                    word(resources, at).checked_shl(shift as u32)?,
                    word(resources, at + 2).checked_shl(shift as u32)?,
                );
                // Read as JavaScript reads the block: a length past its end
                // makes the string empty, and a string running past it is cut
                // short there.
                let mut offset = Some(0usize);

                for _ in 0..(id & 15) {
                    offset = offset.and_then(|at| Some(at + 1 + usize::from(*data.get(at)?)));
                }

                let Some((offset, length)) =
                    offset.and_then(|at| Some((at, usize::from(*data.get(at)?))))
                else {
                    return Some(Vec::new());
                };
                let start = (offset + 1).min(data.len());

                return Some(data[start..(offset + 1 + length).min(data.len())].to_vec());
            }

            at += 12;
        }
    }

    None
}

/// The text of an MCI error (seg5 `136f`): MMSYSTEM's string of its
/// number, or, for a driver's own, with a device's ID, the driver's.
/// Whether there was a text.
pub fn mci_get_error_string(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let error = args.dword(system);
    let far = args.dword(system);
    let size = usize::from(args.word(system));

    if far == 0 {
        return Ok(Answer::Word(0));
    }

    let id = (error >> 16) as u16;
    let number = error as u16;
    let module = if id != 0 {
        system
            .mmsystem
            .mci
            .device(id)
            .map_or(0, |device| device.module)
    } else {
        0
    };
    let text = if id != 0 && module != 0 {
        // The module's file; none for a handle that is no module's now.
        let path = match system.handles.resolve(module) {
            Some(Object::Kept(kept)) => system.kept[kept].module.path.to_string(),
            Some(Object::Library(library)) => system.modules[library].path.clone(),
            _ => String::new(),
        };

        module_string(system, &path, number)
    } else {
        strings::string(if id != 0 { 0x116 } else { number }).map(<[u8]>::to_vec)
    };
    let Some(text) = text else {
        if size != 0 {
            system.write_far(far, &[0]);
        }

        return Ok(Answer::Word(0));
    };
    let count = text.len().min(size.saturating_sub(1));
    let mut bytes = text[..count].to_vec();

    bytes.push(0);
    system.write_far(far, &bytes);
    Ok(Answer::Word(1))
}

/// The ID a name is open as for the task: `FFFFh` for "all", nought for none.
pub fn mci_get_device_id(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let Some(name) = lpcstr(system, far) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(find(system, task_of(system), &name)))
}

/// The data a driver keeps with a device, nought for none.
pub fn mci_get_driver_data(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);

    Ok(Answer::Dword(
        system
            .mmsystem
            .mci
            .device(id)
            .map_or(0, |device| device.data),
    ))
}

/// Whether the device is open, its driver's data kept.
pub fn mci_set_driver_data(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let id = args.word(system);
    let data = args.dword(system);
    let Some(device) = system.mmsystem.mci.device_mut(id) else {
        return Ok(Answer::Word(0));
    };

    device.data = data;
    Ok(Answer::Word(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    use winbox_machine::segment_selector;

    /// A block of memory to work in, and its far pointer.
    fn block(system: &mut System) -> u32 {
        let index = system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, 0x1000, 0)
            .unwrap();

        u32::from(segment_selector(index)) << 16
    }

    /// An `MCI_SYSINFO_PARMS` at `parms`, its text at 100h on.
    fn sysinfo_parms(system: &mut System, parms: u32, size: u32, number: u32) {
        let mut bytes = vec![0; 4];

        bytes.extend_from_slice(&far_at(parms, 0x100).to_le_bytes());
        bytes.extend_from_slice(&size.to_le_bytes());
        bytes.extend_from_slice(&number.to_le_bytes());
        bytes.extend_from_slice(&[0, 0]);
        system.write_far(parms, &bytes);
    }

    /// A size with its top bit set is less than nought, as winbox.js reads
    /// it: too small for any name, and too small for a count.
    #[test]
    fn sysinfo_reads_its_size_signed() {
        let mut system = System::default();
        let parms = block(&mut system);

        system.mmsystem.mci.set(
            1,
            Some(Device {
                name: b"waveaudio".to_vec(),
                kind: b"waveaudio".to_vec(),
                driver: 1,
                module: 0,
                w_type: 0x20a,
                task: 0,
                closing: false,
                data: 0,
                break_key: Some(3),
            }),
        );
        system.mmsystem.mci.count = 2;

        sysinfo_parms(&mut system, parms, 0x8000_0000, 0);
        assert_eq!(
            mci_sysinfo(&mut system, 1, 0x800, parms),
            Ok(MCIERR_PARAM_OVERFLOW)
        );

        system.write_far(far_at(parms, 0x100), &[0xaa; 4]);
        assert_eq!(
            mci_sysinfo(&mut system, MCI_ALL_DEVICE_ID, 0x300, parms),
            Ok(RESOURCE_RETURNED)
        );
        assert_eq!(system.read_far(far_at(parms, 0x100), 4), vec![0xaa; 4]);
    }

    /// A number with its top bit set finds no name: the installed devices'
    /// list gives JavaScript's `undefined` as text, and the open devices'
    /// list fails, as winbox.js does.
    #[test]
    fn sysinfo_reads_its_number_signed() {
        let mut system = System::default();
        let parms = block(&mut system);

        sysinfo_parms(&mut system, parms, 128, 0xffff_ffff);
        assert_eq!(
            mci_sysinfo(&mut system, MCI_ALL_DEVICE_ID, 0x400, parms),
            Ok(0)
        );
        assert_eq!(system.read_string(far_at(parms, 0x100)), b"undefined");
        assert!(mci_sysinfo(&mut system, MCI_ALL_DEVICE_ID, 0x600, parms).is_err());
    }

    /// A string table of one block, strings 0 to 15: `NE` at 40h, the
    /// resource table at 80h, the block at 100h.
    fn module(block: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0; 0x100];

        bytes[0x3c] = 0x40;
        bytes[0x40 + 0x24] = 0x40;
        bytes[0x40 + 0x26] = 0x60;
        bytes[0x80..0x8a].copy_from_slice(&[0, 0, 0x06, 0x80, 1, 0, 0, 0, 0, 0]);
        bytes[0x8a..0x92].copy_from_slice(&[
            0,
            1,
            u8::try_from(block.len()).unwrap(),
            0,
            0,
            0,
            1,
            0x80,
        ]);
        bytes.extend_from_slice(block);
        bytes
    }

    /// A string past the block's end is empty, and one running past it is
    /// cut short, as JavaScript reads them; neither is no string at all.
    #[test]
    fn a_module_string_is_read_as_javascript_reads_it() {
        let file = module(&[2, b'h', b'i', 5, b'a', b'b']);

        assert_eq!(string_in(&file, 0), Some(b"hi".to_vec()));
        assert_eq!(string_in(&file, 1), Some(b"ab".to_vec()));
        assert_eq!(string_in(&file, 2), Some(Vec::new()));
        assert_eq!(string_in(&file, 9), Some(Vec::new()));
        assert_eq!(string_in(&file, 16), None);
    }
}
