//! USER's icons and cursors: the standard ones, the display driver's and
//! USER's own, read from the installation; a module's, read from its file;
//! and an icon as a block of global memory in the display's format, which a
//! program may read and write.

// Each has the signature every function that answers a call has, whether
// or not it can stop the program.
#![allow(clippy::unnecessary_wraps)]

use std::collections::{HashMap, HashSet};

use winbox_machine::handle_for;
use winbox_ne::{Executable, ResourceId};
use winbox_raster::{
    CursorImage, DevicePalette, IconData, decode_cursor, decode_icon, icon_entries, pick_icon,
    scale_icon,
};

use crate::call::{Answer, Args, Stop};
use crate::handles::{Kind, Object};
use crate::system::System;

const RT_CURSOR: u16 = 1;
const RT_ICON: u16 = 3;
const RT_GROUP_CURSOR: u16 = 12;
const RT_GROUP_ICON: u16 = 14;

/// The size icons are drawn at, `SM_CXICON`: a larger one scaled down.
const ICON_SIZE: usize = 32;

/// USER's own icon group of the Windows flag.
const OIC_WINLOGO: u16 = 32647;

/// The arrow, the cursor before any is set.
const IDC_ARROW: u16 = 32512;

/// What USER draws with that is the display driver's, or its own: the
/// standard icons and cursors, read from the installation.
#[derive(Debug, Clone, Default)]
pub struct DriverResources {
    pub icons: HashMap<u16, IconData>,
    /// The standard cursors there are, by id: the driver's and USER's.
    pub cursors: HashSet<u16>,
    /// Their pictures: the first cursor of each group.
    pub cursor_images: HashMap<u16, CursorImage>,
    /// USER's Windows flag, which a minimized window whose class's icon is
    /// `IDI_APPLICATION` shows in its place.
    pub application_icon: Option<IconData>,
}

/// A cursor handed out: its group's id, where its point is, and its
/// picture where it is a module's.
#[derive(Debug, Clone)]
pub struct CursorData {
    pub id: u16,
    pub hotspot: (u16, u16),
    pub image: Option<CursorImage>,
}

/// A module's resources of a type, numbered, as `resourcesOf` reads them.
fn typed(executable: &Executable, kind: u16) -> Vec<(Option<u16>, Option<String>, Vec<u8>)> {
    executable
        .resources
        .iter()
        .filter(|resource_type| resource_type.id == ResourceId::Number(kind))
        .flat_map(|resource_type| &resource_type.entries)
        .map(|resource| {
            // A numbered resource may have a name too, from a `NAMETABLE`.
            let (id, name) = match &resource.id {
                ResourceId::Number(number) => (Some(*number), resource.name.clone()),
                ResourceId::Name(name) => (None, Some(name.clone())),
            };

            (id, name, executable.resource_bytes(resource).to_vec())
        })
        .collect()
}

/// A group's icon for a display, at the size icons are drawn.
fn icon_of(
    executable: &Executable,
    group: &[u8],
    colours: u32,
    palette: &mut DevicePalette,
) -> Option<IconData> {
    let entry = pick_icon(&icon_entries(group), ICON_SIZE, colours)?;
    let (_, _, bytes) = typed(executable, RT_ICON)
        .into_iter()
        .find(|(id, _, _)| *id == Some(entry.id))?;

    Some(scale_icon(decode_icon(&bytes, palette), ICON_SIZE))
}

/// A cursor group's first cursor: an entry's last word is its id.
fn cursor_from_group(
    cursors: &[(Option<u16>, Option<String>, Vec<u8>)],
    group: &[u8],
    palette: &mut DevicePalette,
) -> Option<CursorImage> {
    if group.len() < 6 + 14 {
        return None;
    }

    let id = u16::from_le_bytes([group[6 + 12], group[6 + 13]]);
    let (_, _, bytes) = cursors.iter().find(|(found, _, _)| *found == Some(id))?;

    (bytes.len() > 4).then(|| decode_cursor(bytes, palette))
}

impl DriverResources {
    /// The display driver's icons and cursors, and USER's.
    pub fn read(
        driver: &Executable,
        user: Option<&Executable>,
        colours: u32,
        palette: &mut DevicePalette,
    ) -> Self {
        let mut resources = Self::default();

        for (id, _, group) in typed(driver, RT_GROUP_ICON) {
            if let Some(id) = id
                && let Some(icon) = icon_of(driver, &group, colours, palette)
            {
                resources.icons.insert(id, icon);
            }
        }

        resources.application_icon = user.and_then(|user| {
            let (_, _, group) = typed(user, RT_GROUP_ICON)
                .into_iter()
                .find(|(id, _, _)| *id == Some(OIC_WINLOGO))?;

            icon_of(user, &group, colours, palette)
        });

        for executable in std::iter::once(driver).chain(user) {
            let cursors = typed(executable, RT_CURSOR);

            for (id, _, group) in typed(executable, RT_GROUP_CURSOR) {
                let Some(id) = id else {
                    continue;
                };

                resources.cursors.insert(id);

                if !resources.cursor_images.contains_key(&id)
                    && let Some(image) = cursor_from_group(&cursors, &group, palette)
                {
                    resources.cursor_images.insert(id, image);
                }
            }
        }

        resources
    }
}

impl System {
    /// The display's palette.
    pub fn palette(&self) -> DevicePalette {
        DevicePalette::for_display(
            self.display.colors,
            self.display.palette.as_deref() == Some("ega"),
        )
    }

    /// The installation's display driver and USER read, where the drive has
    /// one: the driver `SYSTEM.INI` names, VGA.DRV for none.
    pub fn read_drivers(&mut self) {
        let Some((_, ini)) = self.files.read_from("C:\\WINDOWS", "SYSTEM.INI") else {
            return;
        };
        let text: String = ini.iter().map(|&byte| char::from(byte)).collect();
        let driver = text
            .lines()
            .find_map(|line| {
                let (key, value) = line.split_once('=')?;

                key.trim()
                    .eq_ignore_ascii_case("display.drv")
                    .then(|| value.split_whitespace().next().unwrap_or("").to_string())
            })
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "VGA.DRV".to_string());
        let read = |name: &str| {
            self.files
                .read_from("C:\\WINDOWS\\SYSTEM", &name.to_ascii_uppercase())
                .and_then(|(_, bytes)| Executable::parse(bytes).ok())
        };
        let (Some(driver), user) = (read(&driver), read("USER.EXE")) else {
            return;
        };
        let mut palette = self.palette();

        self.driver = Some(DriverResources::read(
            &driver,
            user.as_ref(),
            self.display.colors,
            &mut palette,
        ));
    }

    /// The format of an icon block: its planes and bits a pixel, as the
    /// display's bitmaps are.
    fn icon_format(&self) -> (u8, u8) {
        if self.display.bits_per_pixel == 8 {
            (1, 8)
        } else if self.display.colors <= 2 {
            (1, 1)
        } else {
            (4, 1)
        }
    }

    /// An icon as a block of global memory: its hotspot (the middle), width,
    /// height and mask's row, planes and bits, then the mask and the
    /// picture, rows of words. Its handle, or nought.
    pub fn icon_block(&mut self, icon: &IconData) -> u16 {
        let (planes, bits) = self.icon_format();
        let (width, height) = (icon.width, icon.height);
        let word_row = |bits: usize| ((bits + 15) >> 3) & !1;
        let mask_row = word_row(width);
        let picture_row = word_row(width * usize::from(bits));
        let size = 12 + height * mask_row + picture_row * usize::from(planes) * height;
        let Some(index) =
            self.global
                .allocate(&mut self.cpu.bus, &mut self.descriptors, size as u32, 0x42)
        else {
            return 0;
        };
        let mut bytes = vec![0u8; size];

        for (at, word) in [width >> 1, height >> 1, width, height, mask_row]
            .into_iter()
            .enumerate()
        {
            bytes[at * 2..at * 2 + 2].copy_from_slice(&(word as u16).to_le_bytes());
        }

        bytes[10] = planes;
        bytes[11] = bits;

        let picture_at = 12 + height * mask_row;

        for row in 0..height {
            for column in 0..width {
                let at = row * width + column;

                if icon.and[at] != 0 {
                    bytes[12 + row * mask_row + (column >> 3)] |= 0x80 >> (column & 7);
                }

                let index = icon.xor[at];

                for plane in 0..usize::from(planes) {
                    let value = (index >> (plane * usize::from(bits))) & ((1u16 << bits) - 1) as u8;
                    let bit = column * usize::from(bits);
                    let offset =
                        picture_at + (row * usize::from(planes) + plane) * picture_row + (bit >> 3);

                    bytes[offset] |= value << (8 - usize::from(bits) - (bit & 7));
                }
            }
        }

        let handle = handle_for(index);

        self.cpu.bus.write((index as u32) << 16, &bytes);
        self.icon_blocks.insert(handle);
        handle
    }

    /// A standard cursor's handle, made the first time it is asked for.
    fn standard_cursor(&mut self, id: u16) -> u16 {
        if let Some(&handle) = self.standard_cursors.get(&id) {
            return handle;
        }

        let handle = self.new_cursor(CursorData {
            id,
            hotspot: (0, 0),
            image: None,
        });

        self.standard_cursors.insert(id, handle);
        handle
    }

    fn new_cursor(&mut self, cursor: CursorData) -> u16 {
        let index = self.cursors.len();

        self.cursors.push(cursor);
        self.handles
            .allocate(Kind::Atom, Object::Cursor(index))
            .unwrap_or(0)
    }

    /// The cursor set: the arrow until one is.
    fn current_cursor(&mut self) -> u16 {
        if let Some(cursor) = self.cursor {
            return cursor;
        }

        let arrow = self.standard_cursor(IDC_ARROW);

        self.cursor = Some(arrow);
        arrow
    }
}

/// A standard cursor's handle, as `LoadCursor` with no instance answers
/// it: nought where the driver and USER have none.
pub fn standard_cursor_handle(system: &mut System, id: u16) -> u16 {
    let known = match &system.driver {
        Some(driver) => driver.cursors.contains(&id),
        None => (32512..=32650).contains(&id),
    };

    if known { system.standard_cursor(id) } else { 0 }
}

/// What a resource is asked for by: its number, or its name.
fn wanted(system: &System, far: u32) -> Result<u16, String> {
    if far >> 16 == 0 {
        Ok(far as u16)
    } else {
        Err(system
            .read_string(far)
            .iter()
            .map(|&byte| char::from(byte))
            .collect())
    }
}

/// The module whose resources an instance names.
fn module_of(system: &System, instance: u16) -> Option<usize> {
    match system.handles.resolve(instance)? {
        Object::Task => system.task.as_ref().map(|task| task.program),
        Object::Library(module) => Some(module),
        _ => None,
    }
}

/// An icon: a standard one, by number, made a block the first time; a
/// module's, each time a block of its own. Nought for none.
pub fn load_icon(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let name = args.dword(system);

    if instance == 0 {
        let id = match wanted(system, name) {
            Ok(id) => id,
            Err(text) => text.parse().unwrap_or(0),
        };
        let Some(icon) = system
            .driver
            .as_ref()
            .and_then(|driver| driver.icons.get(&id))
            .cloned()
        else {
            return Ok(Answer::Word(0));
        };

        if let Some(&handle) = system.standard_icons.get(&id) {
            return Ok(Answer::Word(handle));
        }

        let handle = system.icon_block(&icon);

        system.standard_icons.insert(id, handle);
        return Ok(Answer::Word(handle));
    }

    let Some(module) = module_of(system, instance) else {
        return Ok(Answer::Word(0));
    };
    let wanted = wanted(system, name);
    let executable = &system.modules[module].executable;
    let group = typed(executable, RT_GROUP_ICON)
        .into_iter()
        .find(|(id, given, _)| match &wanted {
            Ok(number) => *id == Some(*number),
            Err(text) => {
                let upper = text.to_ascii_uppercase();

                given.as_deref() == Some(upper.as_str())
                    || id.is_some_and(|id| id.to_string() == upper)
            }
        });
    let Some((_, _, group)) = group else {
        return Ok(Answer::Word(0));
    };
    let mut palette = system.palette();
    let colours = system.display.colors;
    let Some(icon) = icon_of(
        &system.modules[module].executable,
        &group,
        colours,
        &mut palette,
    ) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(system.icon_block(&icon)))
}

/// A cursor: a standard one, by number, where the driver or USER has it --
/// every one from 32512 to 32650 without the installation to ask -- or a
/// module's group's first cursor. Nought for none.
pub fn load_cursor(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let name = args.dword(system);

    if instance == 0 {
        let id = match wanted(system, name) {
            Ok(id) => id,
            Err(text) => text.parse().unwrap_or(0),
        };
        let known = match &system.driver {
            Some(driver) => driver.cursors.contains(&id),
            None => (32512..=32650).contains(&id),
        };

        return Ok(Answer::Word(if known {
            system.standard_cursor(id)
        } else {
            0
        }));
    }

    let Some(module) = module_of(system, instance) else {
        return Ok(Answer::Word(0));
    };
    let wanted = wanted(system, name);
    let executable = &system.modules[module].executable;
    let group =
        typed(executable, RT_GROUP_CURSOR)
            .into_iter()
            .find(|(id, given, _)| match &wanted {
                Ok(number) => *id == Some(*number),
                Err(text) => given
                    .as_deref()
                    .is_some_and(|given| given.eq_ignore_ascii_case(text)),
            });
    let Some((_, _, group)) = group.filter(|(_, _, group)| group.len() >= 6 + 14) else {
        return Ok(Answer::Word(0));
    };
    let id = u16::from_le_bytes([group[6 + 12], group[6 + 13]]);
    let cursors = typed(executable, RT_CURSOR);
    let mut palette = system.palette();
    let Some(image) = cursor_from_group(&cursors, &group, &mut palette) else {
        return Ok(Answer::Word(0));
    };
    let hotspot = image.hotspot;

    Ok(Answer::Word(system.new_cursor(CursorData {
        id,
        hotspot,
        image: Some(image),
    })))
}

/// The cursor set: the one before answered.
pub fn set_cursor(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let cursor = args.word(system);
    let previous = system.current_cursor();

    system.cursor = Some(cursor);
    Ok(Answer::Word(previous))
}

pub fn get_cursor(system: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(system.current_cursor()))
}

/// The cursor's display count, counted up or down: the count.
pub fn show_cursor(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let show = args.word(system);

    system.cursor_count += if show != 0 { 1 } else { -1 };
    Ok(Answer::Word(system.cursor_count as u16))
}
