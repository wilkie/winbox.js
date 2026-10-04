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
    CursorImage, DeviceBitmap, DevicePalette, DisplayKind, IconData, decode_cursor, decode_dib,
    decode_icon, dib_to_device, icon_entries, palette_for_display, pick_icon, scale_icon,
};

use crate::call::{Answer, Args, Stop};
use crate::handles::{Kind, Object};
use crate::system::System;

const RT_CURSOR: u16 = 1;
const RT_BITMAP: u16 = 2;
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
    /// The driver's OEM bitmaps -- the boxes, arrows and check marks -- in
    /// the display's format, by id, and the grayed arrows USER makes where
    /// the driver has none.
    pub oem: HashMap<u16, DeviceBitmap>,
    pub icons: HashMap<u16, IconData>,
    /// The standard cursors there are, by id: the driver's and USER's.
    pub cursors: HashSet<u16>,
    /// Their pictures: the first cursor of each group.
    pub cursor_images: HashMap<u16, CursorImage>,
    /// USER's Windows flag, which a minimized window whose class's icon is
    /// `IDI_APPLICATION` shows in its place.
    pub application_icon: Option<IconData>,
    /// The driver's own bitmaps' sizes, by id: width and height.
    pub bitmap_sizes: HashMap<u16, (u16, u16)>,
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

/// The bitmaps USER lays side by side in its strip before the grayed arrows
/// (`USER.EXE` seg3 `0881`, `08f7`): 7FF2h, the four arrows, and the rest,
/// in the order it loads them.
const STRIP_BEFORE: [u16; 17] = [
    32754, 32753, 32752, 32751, 32750, 32749, 32748, 32747, 32739, 32738, 32746, 32745, 32744,
    32743, 32742, 32741, 32740,
];

/// The arrows, up, down, right and left, and their grayed ids.
const ARROWS: [(u16, u16); 4] = [
    (32753, 32737),
    (32752, 32736),
    (32751, 32735),
    (32750, 32734),
];

/// Grayed arrows for a driver without its own, as USER makes them (seg3
/// `1099`, `09f3`): each arrow copied after the others in the strip, then
/// combined by OR, a border in from its edges, with a brush of alternate black and
/// white pixels, black where the strip's x and y add to an even number
/// (seg3 `13fb`). A black pixel of the arrow is left only where the brush
/// is black. The Hercules driver has none of its own.
fn gray_arrows(oem: &mut HashMap<u16, DeviceBitmap>, palette: &mut DevicePalette) {
    if oem.contains_key(&32737) {
        return;
    }

    let white = palette.index(255, 255, 255) as u8;
    let mut x: i32 = STRIP_BEFORE
        .iter()
        .map(|id| oem.get(id).map_or(0, DeviceBitmap::width))
        .sum();

    for (normal, grayed) in ARROWS {
        let Some(source) = oem.get(&normal) else {
            continue;
        };
        let (width, height) = (source.width(), source.height());
        let copy = DeviceBitmap::new(
            width,
            height,
            source.depth,
            None,
            Some(source.device_palette.clone()),
        );

        for row in 0..height {
            for column in 0..width {
                let inside = row >= 1 && row < height - 1 && column >= 1 && column < width - 1;
                let brush_white = (x + column + row) & 1 == 1;

                copy.put(
                    column,
                    row,
                    if inside && brush_white {
                        white
                    } else {
                        source.index_at(column, row).unwrap_or(0)
                    },
                );
            }
        }

        oem.insert(grayed, copy);
        x += width;
    }
}

/// A bitmap's width and height from its header, as `decodeDib` reads them:
/// a core header's words, or an info header's double words, the height
/// whichever way its rows run. One that `decodeDib` turns away -- a header
/// of another size, compression, or a depth not 1, 4 or 8 bits -- has none.
fn bitmap_size(bytes: &[u8]) -> Option<(u16, u16)> {
    let word = |at: usize| Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?));
    let dword = |at: usize| Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?));
    let size = dword(0)?;

    if size == 12 {
        let (width, height, bits) = (word(4)?, word(6)? as i16, word(10)?);

        return matches!(bits, 1 | 4 | 8).then_some((width, height.unsigned_abs()));
    }

    let (width, height, bits, compression) = (dword(4)?, dword(8)? as i32, word(14)?, dword(16)?);
    let rle = (compression == 1 && bits == 8) || (compression == 2 && bits == 4);

    (size >= 40 && (compression == 0 || rle) && matches!(bits, 1 | 4 | 8))
        .then_some((width as u16, height.unsigned_abs() as u16))
}

impl DriverResources {
    /// The display driver's OEM bitmaps, in the display's format: each
    /// `RT_BITMAP` decoded and matched to the display's palette by the
    /// nearest colour, then the grayed arrows where the driver has none. A
    /// bitmap that cannot be read stops the reading, as it stops the
    /// TypeScript engine's.
    pub fn read_oem(
        driver: &Executable,
        display: DisplayKind,
    ) -> Result<HashMap<u16, DeviceBitmap>, String> {
        let depth = display.depth();
        let palette = palette_for_display(display, None);
        let mut oem = HashMap::new();

        for (id, _, bytes) in typed(driver, RT_BITMAP) {
            if let Some(id) = id {
                let dib = decode_dib(&bytes)?;

                oem.insert(
                    id,
                    dib_to_device(&dib, depth, Some(palette.clone()), None, None),
                );
            }
        }

        gray_arrows(&mut oem, &mut palette.borrow_mut());

        Ok(oem)
    }

    /// The display driver's icons and cursors, and USER's.
    pub fn read(
        driver: &Executable,
        user: Option<&Executable>,
        colours: u32,
        palette: &mut DevicePalette,
    ) -> Self {
        let mut resources = Self::default();

        for (id, _, bitmap) in typed(driver, RT_BITMAP) {
            if let Some(id) = id
                && let Some(size) = bitmap_size(&bitmap)
            {
                resources.bitmap_sizes.insert(id, size);
            }
        }

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
        let display = DisplayKind {
            colors: self.display.colors,
            ega: self.display.palette.as_deref() == Some("ega"),
        };
        let Ok(oem) = DriverResources::read_oem(&driver, display) else {
            return;
        };
        let mut palette = self.palette();

        self.driver = Some(DriverResources {
            oem,
            ..DriverResources::read(&driver, user.as_ref(), self.display.colors, &mut palette)
        });
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

    /// An icon as it is now: a standard icon's own picture, or read out
    /// of its block; `None` for anything else, or a block that does not
    /// hold one.
    pub fn icon_of(&mut self, hicon: u16) -> Option<IconData> {
        if let Some((&id, _)) = self
            .standard_icons
            .iter()
            .find(|&(_, &handle)| handle == hicon)
        {
            return self.driver.as_ref()?.icons.get(&id).cloned();
        }

        if !self.icon_blocks.contains(&hicon) {
            return None;
        }

        let far = match crate::memory::global_lock(self, &mut Args::repeat(hicon)) {
            Ok(Answer::Dword(far)) if far != 0 => far,
            _ => return None,
        };
        let byte = |at: u32| {
            let offset = (far as u16).wrapping_add(at as u16);

            self.cpu
                .bus
                .read8(self.linear(far & 0xffff_0000 | u32::from(offset)))
        };
        let word = |at: u32| usize::from(byte(at)) | usize::from(byte(at + 1)) << 8;
        let (width, height, mask_row) = (word(4), word(6), word(8));
        let planes = usize::from(byte(10).max(1));
        let bits = usize::from(byte(11).max(1));
        let picture_row = ((width * bits + 15) >> 3) & !1;
        let picture_at = 12 + height * mask_row;

        if width == 0 || height == 0 || width > 256 || height > 256 {
            return None;
        }

        let mut xor = vec![0; width * height];
        let mut and = vec![0; width * height];

        for row in 0..height {
            for column in 0..width {
                let at = row * width + column;

                and[at] =
                    (byte((12 + row * mask_row + (column >> 3)) as u32) >> (7 - (column & 7))) & 1;

                for plane in 0..planes {
                    let bit = column * bits;
                    let value = byte(
                        (picture_at + (row * planes + plane) * picture_row + (bit >> 3)) as u32,
                    );
                    let part = (value >> (8 - bits - (bit & 7))) & ((1u16 << bits) - 1) as u8;

                    xor[at] |= part << (plane * bits);
                }
            }
        }

        Some(IconData {
            width,
            height,
            xor,
            and,
        })
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
    pub(crate) fn current_cursor(&mut self) -> u16 {
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
        Object::Task(program) => Some(program),
        Object::Library(module) => Some(module),
        _ => None,
    }
}

/// An icon: a standard one, by number, made a block the first time; a
/// module's, each time a block of its own. Nought for none.
pub fn load_icon(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let name = args.dword(system);
    let wanted = wanted(system, name);

    Ok(Answer::Word(load_icon_named(system, instance, wanted)))
}

/// An icon by its number or its name, as `LoadIcon` loads it.
pub fn load_icon_named(system: &mut System, instance: u16, wanted: Result<u16, String>) -> u16 {
    if instance == 0 {
        system.raster();

        let id = match wanted {
            Ok(id) => id,
            Err(text) => text.parse().unwrap_or(0),
        };
        let Some(icon) = system
            .driver
            .as_ref()
            .and_then(|driver| driver.icons.get(&id))
            .cloned()
        else {
            return 0;
        };

        if let Some(&handle) = system.standard_icons.get(&id) {
            return handle;
        }

        let handle = system.icon_block(&icon);

        system.standard_icons.insert(id, handle);
        return handle;
    }

    let Some(module) = module_of(system, instance) else {
        return 0;
    };
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
        return 0;
    };
    let mut palette = system.palette();
    let colours = system.display.colors;
    let Some(icon) = icon_of(
        &system.modules[module].executable,
        &group,
        colours,
        &mut palette,
    ) else {
        return 0;
    };

    system.icon_block(&icon)
}

/// An icon done with: its block freed (seg12 `0170`). Whether it was one
/// of the icons made: nought for any other handle, and for a block that
/// would not be freed.
pub fn destroy_icon(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let hicon = args.word(system);

    if !system.icon_blocks.remove(&hicon) {
        return Ok(Answer::Word(0));
    }

    let kept = crate::memory::global_free(system, &mut Args::repeat(hicon))?;

    Ok(Answer::Word(u16::from(kept == Answer::Word(0))))
}

/// A cursor: a standard one, by number, where the driver or USER has it --
/// every one from 32512 to 32650 without the installation to ask -- or a
/// module's group's first cursor. Nought for none.
pub fn load_cursor(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let name = args.dword(system);

    if instance == 0 {
        system.raster();

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

/// An icon made of bits the program gives: its mask and its picture, in a
/// block laid out as `icon_block` lays one out -- the hotspot, width,
/// height and mask's row, planes and bits, then the mask, rows of words,
/// and the picture as given. Nought for no size or no bits.
pub fn create_icon(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _instance = args.word(system);
    let width = usize::from(args.word(system));
    let height = usize::from(args.word(system));
    let planes = args.word(system) as u8;
    let bits = args.word(system) as u8;
    let and = args.dword(system);
    let xor = args.dword(system);

    if width == 0 || height == 0 || and == 0 || xor == 0 {
        return Ok(Answer::Word(0));
    }

    let word_row = |bits: usize| ((bits + 15) >> 3) & !1;
    let mask_bytes = height * word_row(width);
    let size = 12 + mask_bytes + word_row(width * usize::from(bits)) * usize::from(planes) * height;
    // A block past what a size can say cannot be made.
    let Some(index) = u32::try_from(size).ok().and_then(|size| {
        system
            .global
            .allocate(&mut system.cpu.bus, &mut system.descriptors, size, 0x42)
    }) else {
        return Ok(Answer::Word(0));
    };
    let read = |system: &System, far: u32, count: usize| -> Vec<u8> {
        (0..count)
            .map(|at| {
                let far = (far & 0xffff_0000) | (far.wrapping_add(at as u32) & 0xffff);

                system.read_far(far, 1)[0]
            })
            .collect()
    };
    let mut bytes = Vec::with_capacity(size);

    for word in [width >> 1, height >> 1, width, height, word_row(width)] {
        bytes.extend_from_slice(&(word as u16).to_le_bytes());
    }

    bytes.push(planes);
    bytes.push(bits);
    bytes.extend(read(system, and, mask_bytes));
    bytes.extend(read(system, xor, size - 12 - mask_bytes));

    let handle = handle_for(index);

    system.cpu.bus.write((index as u32) << 16, &bytes);
    system.icon_blocks.insert(handle);
    Ok(Answer::Word(handle))
}

/// An icon copied into a block of its own, as it is now; nought for a
/// handle that is no icon's.
pub fn copy_icon(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _instance = args.word(system);
    let hicon = args.word(system);
    let Some(icon) = system.icon_of(hicon) else {
        return Ok(Answer::Word(0));
    };

    Ok(Answer::Word(system.icon_block(&icon)))
}

#[cfg(test)]
mod tests {
    #[test]
    fn an_icon_too_large_to_say_is_not_made() {
        let mut system = System::new();

        // 65535 square, 255 planes of 255 bits: past four gigabytes.
        assert_eq!(
            create_icon(&mut system, &mut Args::repeat(0xffff)),
            Ok(Answer::Word(0))
        );
    }

    use super::*;

    #[test]
    fn grays_the_arrows_where_the_driver_has_none() {
        let mut oem = HashMap::new();
        let mut palette = DevicePalette::sixteen();

        for id in [32753, 32752, 32751, 32750] {
            oem.insert(id, DeviceBitmap::new(3, 3, 4, None, None));
        }

        gray_arrows(&mut oem, &mut palette);

        // The strip starts 12 in, past the four arrows: the up arrow's middle
        // is at 13, 1, black in the brush; the down arrow's at 16, 1, white.
        assert_eq!(oem[&32737].index_at(1, 1), Some(0));
        assert_eq!(oem[&32736].index_at(1, 1), Some(15));
        assert_eq!(oem[&32736].index_at(0, 1), Some(0));
        assert_eq!(oem[&32734].index_at(1, 1), Some(15));
    }

    #[test]
    fn measures_a_bitmap_as_decode_dib_does() {
        let mut core = vec![12, 0, 0, 0, 14, 0, 0xf2, 0xff, 1, 0, 1, 0];

        // A core header: words, the height whichever way the rows run.
        assert_eq!(bitmap_size(&core), Some((14, 14)));
        core[10] = 24;
        assert_eq!(bitmap_size(&core), None);

        let mut info = vec![0; 40];

        info[0] = 40;
        info[4..8].copy_from_slice(&16i32.to_le_bytes());
        info[8..12].copy_from_slice(&15i32.to_le_bytes());
        info[14] = 4;
        assert_eq!(bitmap_size(&info), Some((16, 15)));
        // Run-length encoded at its own depth, or not at all.
        info[16] = 2;
        assert_eq!(bitmap_size(&info), Some((16, 15)));
        info[16] = 1;
        assert_eq!(bitmap_size(&info), None);
        assert_eq!(bitmap_size(&info[..20]), None);
    }
}
