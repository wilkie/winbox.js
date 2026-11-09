//! Cursors made from bits, copied and destroyed. **Read out of `USER.EXE`**
//! (seg12) and **recorded** by `curmake`. A cursor made is a block laid out
//! as an icon's: the hotspot, the size, the mask's bytes a row, the planes
//! and bits a pixel, then the mask and the picture as given. As
//! `src/win16/user/cursor-make.ts`, which says more of each.

use winbox_machine::handle_for;

use crate::call::{Answer, Args, Implementation, Stop};
use crate::system::System;
use winbox_raster::{CursorImage, IconData};

const IDC_ARROW: u16 = 32512;

pub fn implementation(name: &str) -> Option<Implementation> {
    Some(Implementation::Sync(match name {
        "CreateCursor" => create_cursor,
        "CreateCursorIconIndirect" => create_cursor_icon_indirect,
        "CopyCursor" => copy_cursor,
        "DestroyCursor" => destroy_cursor,
        "GetIconID" => get_icon_id,
        _ => return None,
    }))
}

/// A far pointer `at` bytes on, within its segment.
fn on(far: u32, at: u16) -> u32 {
    far & 0xffff_0000 | u32::from((far as u16).wrapping_add(at))
}

impl System {
    /// An icon or cursor in a block of its own, from its header's twelve
    /// bytes and the two sets of bits (seg12 `0000`-`00bb`), each size
    /// in sixteen bits; its handle, nought where none could be made.
    fn cursor_block(&mut self, header: [u8; 12], and: u32, xor: u32) -> u16 {
        let word = |at: usize| u16::from_le_bytes([header[at], header[at + 1]]);
        let row = ((i32::from((u16::from(header[11]).wrapping_mul(word(4))) as i16) + 15) >> 3)
            as u16
            & 0xfffe;
        let picture = row
            .wrapping_mul(u16::from(header[10]))
            .wrapping_mul(word(6));
        let mask = (word(6) as i16).wrapping_mul(word(8) as i16) as u16;
        let size = mask.wrapping_add(picture).wrapping_add(12);
        let Some(index) = self.global.allocate(
            &mut self.cpu.bus,
            &mut self.descriptors,
            u32::from(size),
            0x42,
        ) else {
            return 0;
        };
        let handle = handle_for(index);
        let far = self.global_pointer(handle);
        let mut bytes = header.to_vec();

        bytes.extend((0..mask).map(|at| self.read_far(on(and, at), 1)[0]));
        bytes.extend((0..picture).map(|at| self.read_far(on(xor, at), 1)[0]));

        for (at, byte) in bytes.iter().enumerate() {
            self.write_far(on(far, at as u16), &[*byte]);
        }

        self.icon_blocks.insert(handle);
        handle
    }

    /// A cursor made of a block, as the display shows it; see
    /// `blockCursorImage`.
    pub(crate) fn block_cursor_image(&mut self, handle: u16) -> Option<CursorImage> {
        if !self.icon_blocks.contains(&handle) {
            return None;
        }

        let icon: IconData = self.icon_of(handle)?;
        let far = self.global_pointer(handle);
        let header = self.read_far(far, 12);
        let mono = header[10] == 1 && header[11] == 1;
        let all = if self.display.bits_per_pixel == 8 {
            0xff
        } else {
            (self.display.colors.max(2) - 1) as u8
        };
        let xor = if mono {
            icon.xor
                .iter()
                .map(|&bit| if bit != 0 { all } else { 0 })
                .collect()
        } else {
            icon.xor
        };

        Some(CursorImage {
            icon: IconData {
                width: icon.width,
                height: icon.height,
                xor,
                and: icon.and,
            },
            hotspot: (
                u16::from_le_bytes([header[0], header[1]]),
                u16::from_le_bytes([header[2], header[3]]),
            ),
        })
    }
}

/// `CreateCursorIconIndirect`: the header read from the pointer given.
pub fn create_cursor_icon_indirect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _instance = args.word(system);
    let info = args.dword(system);
    let and = args.dword(system);
    let xor = args.dword(system);
    let mut header = [0u8; 12];

    for (at, byte) in header.iter_mut().enumerate() {
        *byte = system.read_far(on(info, at as u16), 1)[0];
    }

    Ok(Answer::Word(system.cursor_block(header, and, xor)))
}

/// A cursor of a bit a pixel, its hotspot as given (seg12 `00be`-`010d`).
pub fn create_cursor(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _instance = args.word(system);
    let x = args.word(system);
    let y = args.word(system);
    let width = args.word(system);
    let height = args.word(system);
    let and = args.dword(system);
    let xor = args.dword(system);
    let row = ((width.wrapping_add(15) & 0xfff7) as i16 >> 3) as u16;
    let mut header = [0u8; 12];

    for (at, value) in [x, y, width, height, row].iter().enumerate() {
        header[at * 2..at * 2 + 2].copy_from_slice(&value.to_le_bytes());
    }

    header[10] = 1;
    header[11] = 1;
    Ok(Answer::Word(system.cursor_block(header, and, xor)))
}

/// A copy of a cursor or icon in a block of its own, its bytes as they are
/// (seg12 `0260`-`02c0`); for a cursor kept as data, a block made of it.
pub fn copy_cursor(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let _instance = args.word(system);
    let handle = args.word(system);

    Ok(Answer::Word(copy_of(system, handle)))
}

pub(crate) fn copy_of(system: &mut System, handle: u16) -> u16 {
    if system.icon_blocks.contains(&handle) {
        let far = system.global_pointer(handle);

        if far == 0 {
            return 0;
        }

        let bytes = system.read_far(far, 12);
        let mut header = [0u8; 12];

        header.copy_from_slice(&bytes);

        let word = |at: usize| i16::from_le_bytes([header[at], header[at + 1]]);
        let mask = word(6).wrapping_mul(word(8)) as u16;

        return system.cursor_block(header, on(far, 12), on(far, 12u16.wrapping_add(mask)));
    }

    let Some(image) = system.cursor_data_image(handle) else {
        return 0;
    };
    let hotspot = image.hotspot;
    let image = image.icon;
    let row = ((image.width + 15) >> 3) & !1;
    let height = image.height;
    let mut bytes = vec![0u8; 12 + row * height * 2];

    for (at, value) in [
        hotspot.0,
        hotspot.1,
        image.width as u16,
        image.height as u16,
        row as u16,
    ]
    .iter()
    .enumerate()
    {
        bytes[at * 2..at * 2 + 2].copy_from_slice(&value.to_le_bytes());
    }

    bytes[10] = 1;
    bytes[11] = 1;

    let width = image.width;

    for y in 0..height {
        for x in 0..width {
            let at = y * width + x;

            if image.and[at] != 0 {
                bytes[12 + y * row + (x >> 3)] |= 0x80 >> (x & 7);
            }

            if image.xor[at] != 0 {
                bytes[12 + row * height + y * row + (x >> 3)] |= 0x80 >> (x & 7);
            }
        }
    }

    let Some(index) = system.global.allocate(
        &mut system.cpu.bus,
        &mut system.descriptors,
        bytes.len() as u32,
        0x42,
    ) else {
        return 0;
    };
    let block = handle_for(index);
    let far = system.global_pointer(block);

    system.write_far(far, &bytes);
    system.icon_blocks.insert(block);
    block
}

/// A cursor done with (seg12 `018d`-`01b8`): the arrow made current first
/// where it is the cursor now; then let go as an icon is.
pub fn destroy_cursor(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);

    if handle != 0 && system.current_cursor() == handle {
        let arrow = crate::icons::standard_cursor_handle(system, IDC_ARROW);

        system.cursor = Some(arrow);
    }

    crate::icons::destroy_icon(system, &mut Args::repeat(handle))
}

const SM_CXICON: i16 = 11;
const SM_CYICON: i16 = 12;
const SM_CXCURSOR: i16 = 13;
const SM_CYCURSOR: i16 = 14;

/// The member of an icon or cursor group that fits the display: its
/// identifier (`USER.EXE` seg12 `052b`-`05b6`). **Recorded** by `iconid`.
fn get_icon_id(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let type_name = args.dword(system);

    icon_id(system, handle, type_name).map(Answer::Word)
}

/// `GetIconID`'s work, as `LoadIcon` and `LoadCursor` do it
/// (`icon_handlers.rs`): the member's identifier, nought for none.
pub(crate) fn icon_id(system: &mut System, handle: u16, type_name: u32) -> Result<u16, Stop> {
    let far = match crate::memory::global_lock(system, &mut Args::repeat(handle))? {
        Answer::Dword(far) => far,
        _ => 0,
    };

    if far == 0 {
        return Ok(0);
    }

    let read = |system: &System, at: u16| {
        let bytes = system.read_far(on(far, at), 2);

        u16::from_le_bytes([bytes[0], bytes[1]])
    };

    if read(system, 0) != 0 || !matches!(read(system, 2), 1 | 2) {
        return Ok(0);
    }

    let count = read(system, 4);
    let mut index = match type_name as u16 {
        1 => cursor_index(system, far, count),
        3 => icon_index(system, far, count),
        // The member at the index of the block's selector, as USER leaves
        // it (`0541`, `0591`).
        _ => (far >> 16) as u16,
    };

    if index == count {
        index = 0;
    }

    crate::memory::global_unlock(system, &mut Args::repeat(handle))?;
    Ok(read(
        system,
        6u16.wrapping_add(index.wrapping_mul(14)).wrapping_add(12),
    ))
}

/// The icon of a directory's `count` for the display (seg12 `040c`).
fn icon_index(system: &mut System, far: u32, count: u16) -> u16 {
    let shown = system.display.colors;
    let most = if shown >= 0x1_0000 { 0x7d00 } else { shown };
    let width = u32::from(crate::user::system_metric(system, SM_CXICON));
    let height = u32::from(crate::user::system_metric(system, SM_CYICON));
    let (mut fit, mut fit_at) = (0u32, 0u16);
    let (mut over, mut over_at) = (0u32, 0u16);
    let (mut any, mut any_at) = (0u32, 0u16);
    let size = |byte: u8| if byte == 0 { 0x100 } else { u32::from(byte) };

    for at in 0..count {
        let entry = system.read_far(on(far, 6u16.wrapping_add(at.wrapping_mul(14))), 3);
        let colours = u32::from(entry[2]);

        if colours <= most && any < colours {
            any = colours;
            any_at = at;
        }

        if size(entry[0]) != width || size(entry[1]) != height {
            continue;
        }

        if colours == most {
            return at;
        }

        if colours < most {
            if fit < colours {
                fit = colours;
                fit_at = at;
            }
        } else if fit == 0 && over > colours {
            // USER's own choice among those with more colours than the
            // display's starts from nought and never takes one (`04b6`).
            over = colours;
            over_at = at;
        }
    }

    if fit != 0 {
        fit_at
    } else if over != 0 {
        over_at
    } else if any != 0 {
        any_at
    } else {
        0
    }
}

/// The cursor of a directory's `count` for the display (seg12 `04f7`).
fn cursor_index(system: &mut System, far: u32, count: u16) -> u16 {
    let width = crate::user::system_metric(system, SM_CXCURSOR);
    let height = crate::user::system_metric(system, SM_CYCURSOR);

    (0..count)
        .find(|&at| {
            let entry = system.read_far(on(far, 6u16.wrapping_add(at.wrapping_mul(14))), 4);

            u16::from_le_bytes([entry[0], entry[1]]) == width
                && u16::from_le_bytes([entry[2], entry[3]]) >> 1 == height
        })
        .unwrap_or(0)
}
