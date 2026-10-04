//! GDI's bitmaps as objects holding pixels: made blank, from a program's
//! bits or from a device context's kind, their bits read and written in the
//! shape a program sees them (`ddb`), their dimension, what `GetObject`
//! tells of one, a bitmap selected into a memory device context, and USER's
//! `LoadBitmap`. Drawing into one comes with drawing.

use std::cell::RefCell;
use std::rc::Rc;

use winbox_raster::{
    DeviceBitmap, DevicePalette, DisplayKind, SharedPalette, decode_dib, dib_to_device,
    palette_for_display,
};

use crate::call::{Answer, Args, Stop};
use crate::handles::{Kind, Object};
use crate::menus::MenuName;
use crate::system::System;

use super::dc::{DcBitmap, dc_of};
use super::ddb::{Bitmap, bits_size, format_of, read_byte, row_bytes, write_byte};
use super::objects::GdiObject;
use super::{pack, put_dword};

const RT_BITMAP: u16 = 2;

/// The display as the raster layer takes it: its colours, and whether it is
/// the EGA.
pub(crate) fn display_kind(system: &System) -> DisplayKind {
    DisplayKind {
        colors: system.display.colors,
        ega: system.display.palette.as_deref() == Some("ega"),
    }
}

impl System {
    /// A bitmap given one of GDI's handles (`gdinum`); nought where there
    /// are none left.
    pub(crate) fn bitmap_handle(&mut self, pixels: DeviceBitmap) -> u16 {
        let index = self.gdi_object(GdiObject::Bitmap(Box::new(Bitmap::new(pixels))));

        self.handles
            .allocate(Kind::Gdi, Object::Gdi(index))
            .unwrap_or(0)
    }

    /// The bitmap a handle stands for, if it stands for one.
    pub fn bitmap_of(&self, handle: u16) -> Option<&Bitmap> {
        match self.gdi_object_of(handle)? {
            (_, GdiObject::Bitmap(bitmap)) => Some(bitmap),
            _ => None,
        }
    }

    fn bitmap_of_mut(&mut self, handle: u16) -> Option<&mut Bitmap> {
        let (index, _) = self.gdi_object_of(handle)?;

        match &mut self.gdi.objects[index] {
            GdiObject::Bitmap(bitmap) => Some(bitmap),
            _ => None,
        }
    }

    /// The bitmap a device context draws into, where it is one of GDI's
    /// objects: a memory context's.
    pub(crate) fn dc_bitmap(&self, dc: usize) -> Option<&Bitmap> {
        match self.gdi.dcs[dc].bitmap {
            DcBitmap::Bitmap(index) => match &self.gdi.objects[index] {
                GdiObject::Bitmap(bitmap) => Some(bitmap),
                _ => None,
            },
            DcBitmap::Screen | DcBitmap::Window(_) | DcBitmap::Whole(_) => None,
        }
    }

    /// The one-by-one monochrome bitmap Windows selects into every new
    /// memory device context, until the program selects its own: an object
    /// with no handle until it is first replaced.
    pub(crate) fn placeholder_bitmap(&mut self) -> usize {
        let mut pixels = DeviceBitmap::new(1, 1, 1, None, None);

        pixels.placeholder = true;
        self.gdi_object(GdiObject::Bitmap(Box::new(Bitmap::new(pixels))))
    }
}

/// The kind of bitmap a handle's device context draws into: a memory
/// context's selected bitmap's depth and palette, or, for anything else
/// the handle stands for, `None` -- the display's. `Err` where the handle
/// stands for nothing.
fn kind_of(system: &System, hdc: u16) -> Result<Option<(u8, SharedPalette)>, ()> {
    if hdc == 0 || system.handles.resolve(hdc).is_none() {
        return Err(());
    }

    Ok(dc_of(system, hdc)
        .and_then(|dc| system.dc_bitmap(dc))
        .map(|bitmap| {
            (
                bitmap.pixels.depth,
                Rc::clone(&bitmap.pixels.device_palette),
            )
        }))
}

/// A device-dependent bitmap, optionally from bits the caller gives, in
/// rows padded to 16-bit words: **recorded** by `bitbits` for monochrome
/// bitmaps at widths of 8 to 40 pixels. The pixels are kept as palette
/// indices; see `DeviceBitmap` and `ddb`.
///
/// The planes and the bits per pixel are read as bytes: SkiFree passes
/// `AB01h` for the bits per pixel and gets a monochrome bitmap. One plane of
/// one bit is monochrome, and the display's own shape is its colours: four
/// planes of one bit on a sixteen-colour display, one of eight bits taken
/// for a 256-colour one. Any other shape is made as it is asked for --
/// `GetObject` tells it so -- but no device context takes it; `patmono`
/// recorded one plane of four, eight and 24 bits and three planes of one on
/// four displays, and four planes of one on the Hercules.
pub fn create_bitmap(
    system: &mut System,
    width: i16,
    height: i16,
    planes: u16,
    bits: u16,
    far: u32,
) -> u16 {
    let (planes, bits) = (planes & 0xff, bits & 0xff);
    let display = display_kind(system);
    let own_depth = u16::from(display.depth());
    let own = if own_depth == 4 {
        planes == 4 && bits == 1
    } else {
        planes == 1 && bits == own_depth
    };
    let depth = if planes == 1 && bits == 1 {
        1
    } else {
        display.depth()
    };
    let (width, height) = (i32::from(width), i32::from(height));
    let mut pixels = DeviceBitmap::new(
        width,
        height,
        depth,
        None,
        Some(palette_for_display(display, Some(depth))),
    );

    if depth != 1 && !own {
        let size = row_bytes(i64::from(bits), i64::from(width.max(0)))
            * i64::from(planes)
            * i64::from(height.max(0));

        pixels.shape = Some(winbox_raster::device_bitmap::Shape {
            planes,
            bits,
            bytes: vec![0; usize::try_from(size).unwrap_or(0)],
        });
    }

    let mut bitmap = Bitmap::new(pixels);

    if far != 0 {
        let size = usize::try_from(bits_size(&bitmap.pixels)).unwrap_or(0);

        for (at, byte) in system.read_far(far, size).into_iter().enumerate() {
            write_byte(&mut bitmap, at as i64, byte);
        }
    }

    let index = system.gdi_object(GdiObject::Bitmap(Box::new(bitmap)));

    system
        .handles
        .allocate(Kind::Gdi, Object::Gdi(index))
        .unwrap_or(0)
}

pub(crate) fn create_bitmap_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let width = args.signed(system);
    let height = args.signed(system);
    let planes = args.word(system);
    let bits = args.word(system);
    let far = args.dword(system);

    Ok(Answer::Word(create_bitmap(
        system, width, height, planes, bits, far,
    )))
}

/// A bitmap from a `BITMAP`: its width, height, planes, bits a pixel and
/// bits, as `CreateBitmap` takes them (`queries`).
pub(crate) fn create_bitmap_indirect(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let bytes = system.read_far(far, 14);
    let word = |at: usize| u16::from_le_bytes([bytes[at], bytes[at + 1]]);
    let bits = u32::from(word(10)) | u32::from(word(12)) << 16;

    Ok(Answer::Word(create_bitmap(
        system,
        word(2) as i16,
        word(4) as i16,
        u16::from(bytes[8]),
        u16::from(bytes[9]),
        bits,
    )))
}

/// A bitmap of the same kind as a device context's: the display's depth for
/// a window or the screen, and for a memory device context the depth of the
/// bitmap selected into it -- which for a new one is its one-by-one
/// monochrome bitmap, so a bitmap made compatible with a fresh memory device
/// context is monochrome. The pixels start black. Nought for no device
/// context; any handle that stands for something is taken as the display's.
///
/// `CreateDiscardableBitmap` is the same.
pub fn create_compatible_bitmap(system: &mut System, hdc: u16, width: i16, height: i16) -> u16 {
    let Ok(like) = kind_of(system, hdc) else {
        return 0;
    };
    let display = display_kind(system);
    let (depth, palette) =
        like.unwrap_or_else(|| (display.depth(), palette_for_display(display, None)));

    system.bitmap_handle(DeviceBitmap::new(
        i32::from(width),
        i32::from(height),
        depth,
        None,
        Some(palette),
    ))
}

pub(crate) fn create_compatible_bitmap_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let hdc = args.word(system);
    let width = args.signed(system);
    let height = args.signed(system);

    Ok(Answer::Word(create_compatible_bitmap(
        system, hdc, width, height,
    )))
}

/// Copies a bitmap's bits into a buffer, in rows padded to 16-bit words.
///
/// **Recorded** by `bitbits`: the bits follow what was drawn into the
/// bitmap, not what it was created with; a row is padded to a word; and a
/// buffer smaller than the bitmap gets exactly as many bytes as it holds,
/// which is what the call answers. See `ddb`.
pub fn get_bitmap_bits(system: &mut System, handle: u16, size: i32, far: u32) -> u32 {
    let Some(bitmap) = system.bitmap_of(handle) else {
        return 0;
    };

    if far == 0 {
        return 0;
    }

    let size = bits_size(&bitmap.pixels).min(i64::from(size));
    let bytes: Vec<u8> = (0..size.max(0)).map(|at| read_byte(bitmap, at)).collect();

    system.write_far(far, &bytes);
    size as u32
}

pub(crate) fn get_bitmap_bits_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let size = args.dword(system) as i32;
    let far = args.dword(system);

    Ok(Answer::Dword(get_bitmap_bits(system, handle, size, far)))
}

/// A bitmap's bits set from a program's, in rows padded to words, as
/// `CreateBitmap` takes them -- the documented shape of a device-dependent
/// bitmap, which `bitbits` recorded for `CreateBitmap` and `GetBitmapBits`.
/// This call itself is not recorded, nor whether bits set here reach a
/// bitmap already selected into a device context; see `ddb`. How many
/// bytes were set.
pub fn set_bitmap_bits(system: &mut System, handle: u16, size: u32, far: u32) -> u32 {
    let Some(bitmap) = system.bitmap_of(handle) else {
        return 0;
    };
    let size = bits_size(&bitmap.pixels).min(i64::from(size));
    let bytes = system.read_far(far, usize::try_from(size).unwrap_or(0));
    let bitmap = system.bitmap_of_mut(handle).expect("the bitmap just found");

    for (at, byte) in bytes.into_iter().enumerate() {
        write_byte(bitmap, at as i64, byte);
    }

    size as u32
}

pub(crate) fn set_bitmap_bits_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let size = args.dword(system);
    let far = args.dword(system);

    Ok(Answer::Dword(set_bitmap_bits(system, handle, size, far)))
}

/// A bitmap's dimension in tenths of a millimetre, nought until set.
fn dimension_of(bitmap: &Bitmap) -> (i16, i16) {
    bitmap.dimension.unwrap_or((0, 0))
}

/// A bitmap's dimension, x in the low word; nought for no bitmap.
pub(crate) fn get_bitmap_dimension(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let dimension = system.bitmap_of(handle).map_or(0, |bitmap| {
        let (x, y) = dimension_of(bitmap);

        pack(i64::from(x), i64::from(y))
    });

    Ok(Answer::Dword(dimension))
}

/// A bitmap's dimension set, the one it had answered; nought for no
/// bitmap.
pub fn set_bitmap_dimension(
    system: &mut System,
    handle: u16,
    x: i16,
    y: i16,
) -> Option<(i16, i16)> {
    let bitmap = system.bitmap_of_mut(handle)?;
    let old = dimension_of(bitmap);

    bitmap.dimension = Some((x, y));
    Some(old)
}

pub(crate) fn set_bitmap_dimension_call(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let x = args.signed(system);
    let y = args.signed(system);
    let old = set_bitmap_dimension(system, handle, x, y);

    Ok(Answer::Dword(
        old.map_or(0, |(x, y)| pack(i64::from(x), i64::from(y))),
    ))
}

/// A bitmap's dimension put in a `SIZE`, where one is given: 1, or nought
/// for no bitmap.
pub(crate) fn get_bitmap_dimension_ex(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let far = args.dword(system);
    let Some(bitmap) = system.bitmap_of(handle) else {
        return Ok(Answer::Word(0));
    };
    let (x, y) = dimension_of(bitmap);

    put_dword(system, far, pack(i64::from(x), i64::from(y)));
    Ok(Answer::Word(1))
}

/// A bitmap's dimension set, the one it had put in a `SIZE` where one is
/// given: 1, or nought for no bitmap.
pub(crate) fn set_bitmap_dimension_ex(
    system: &mut System,
    args: &mut Args,
) -> Result<Answer, Stop> {
    let handle = args.word(system);
    let x = args.signed(system);
    let y = args.signed(system);
    let far = args.dword(system);
    let Some((old_x, old_y)) = set_bitmap_dimension(system, handle, x, y) else {
        return Ok(Answer::Word(0));
    };

    put_dword(system, far, pack(i64::from(old_x), i64::from(old_y)));
    Ok(Answer::Word(1))
}

/// What `GetObject` tells of a bitmap, a `BITMAP`: its type, nought; its
/// width and height; the bytes of a row of a plane, rounded to a word; the
/// planes and bits it was made with -- a sixteen-colour display's colour
/// bitmap is four planes of one bit (`patmono`) -- and no pointer to its
/// bits, which `GetBitmapBits` gives.
pub fn bitmap_struct(bitmap: &Bitmap) -> Vec<u8> {
    let pixels = &bitmap.pixels;
    let (planes, bits) = format_of(pixels);
    let width_bytes = row_bytes(i64::from(bits), i64::from(pixels.width()));
    let mut bytes = Vec::with_capacity(14);

    for word in [
        0,
        pixels.width() as u16,
        pixels.height() as u16,
        width_bytes as u16,
    ] {
        bytes.extend(word.to_le_bytes());
    }

    bytes.extend([planes as u8, bits as u8, 0, 0, 0, 0]);
    bytes
}

/// Whether selecting a handle into a device context would put a bitmap
/// into the screen's or a window's: the TypeScript engine lets it, and the
/// window's context then draws into the bitmap while keeping the window's
/// place; that is not modelled here. A bitmap of a shape no device context
/// takes is turned away first, answering nought, there as anywhere.
pub(crate) fn bitmap_into_screen(system: &System, hdc: u16, handle: u16) -> bool {
    let Some(dc) = dc_of(system, hdc) else {
        return false;
    };

    system
        .bitmap_of(handle)
        .is_some_and(|bitmap| bitmap.pixels.shape.is_none())
        && matches!(
            system.gdi.dcs[dc].bitmap,
            DcBitmap::Screen | DcBitmap::Window(_) | DcBitmap::Whole(_)
        )
}

/// A bitmap selected into a memory device context, in place of the one
/// there: the handle of the one replaced. A memory context's first bitmap,
/// given back, is a bitmap: one by one, as `GetObject` reads it, given a
/// handle as it is first replaced (`wingapi`); after that its handle. A
/// bitmap of a shape no device context takes is not selected, and answers
/// nought (`patmono`). Into the screen's or a window's context, nought and
/// nothing changed (see `bitmap_into_screen`).
pub(crate) fn select_bitmap(system: &mut System, dc: usize, object: usize) -> u16 {
    let GdiObject::Bitmap(bitmap) = &system.gdi.objects[object] else {
        return 0;
    };

    if bitmap.pixels.shape.is_some() {
        return 0;
    }

    let DcBitmap::Bitmap(current) = system.gdi.dcs[dc].bitmap else {
        return 0;
    };
    let placeholder = matches!(
        &system.gdi.objects[current],
        GdiObject::Bitmap(bitmap) if bitmap.pixels.placeholder
    );
    let before = match system.handles.lookup(Object::Gdi(current)) {
        Some(handle) => handle,
        None if placeholder => system
            .handles
            .allocate(Kind::Gdi, Object::Gdi(current))
            .unwrap_or(0),
        None => 1,
    };
    let display = display_kind(system);

    system.gdi.dcs[dc].bitmap = DcBitmap::Bitmap(object);

    if let GdiObject::Bitmap(bitmap) = &mut system.gdi.objects[object] {
        bitmap.pixels.selected = true;
        bitmap.pixels.context.display = Some(display);
    }

    before
}

/// A bitmap: with no module, one of the system's, `OBM_...`, which the
/// display driver keeps, each call a bitmap of its own to draw with or
/// delete; else a module's `RT_BITMAP`. Nought for none.
///
/// A module's is made a device-dependent bitmap at the display's depth,
/// each colour matched to the display's palette, as the bitmap will be
/// drawn with. A two-colour resource becomes a monochrome bitmap, which
/// keeps a mask a mask. Inferred, not recorded. See `DeviceBitmap`.
pub fn load_bitmap(system: &mut System, instance: u16, name: Option<&MenuName>) -> u16 {
    if instance == 0 {
        if !system.raster() {
            return 0;
        }

        // The name's low word, as the TypeScript engine takes it: a name
        // given as text, or none, is nought.
        let id = match name {
            Some(MenuName::Number(id)) => *id,
            _ => 0,
        };
        let Some(oem) = system
            .driver
            .as_ref()
            .and_then(|driver| driver.oem.get(&id))
        else {
            return 0;
        };
        let indices = Rc::new(RefCell::new(oem.indices.borrow().clone()));
        let copy = DeviceBitmap::new(
            oem.width(),
            oem.height(),
            oem.depth,
            Some(indices),
            Some(Rc::clone(&oem.device_palette)),
        );

        return system.bitmap_handle(copy);
    }

    // No name is looked for as the number nought, as the TypeScript
    // engine's `findResource` takes a null key.
    let name = name.cloned().unwrap_or(MenuName::Number(0));
    let Some(executable) = system.executable_of(instance) else {
        return 0;
    };
    let Some(data) = crate::resources::find_by(&executable, RT_BITMAP, &name) else {
        return 0;
    };
    let Ok(dib) = decode_dib(data) else {
        return 0;
    };
    let display = display_kind(system);
    let depth = if dib.bit_count == 1 {
        1
    } else {
        DevicePalette::depth_of(display.colors)
    };
    let pixels = dib_to_device(
        &dib,
        depth,
        Some(palette_for_display(display, Some(depth))),
        Some(display),
        None,
    );

    system.bitmap_handle(pixels)
}

pub(crate) fn load_bitmap_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let instance = args.word(system);
    let far = args.dword(system);
    let name = MenuName::read(system, far);

    Ok(Answer::Word(load_bitmap(system, instance, name.as_ref())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gdi::dc::{create_compatible_dc, select_object};
    use crate::gdi::objects::{delete_object, get_object, is_gdi_object};

    fn buffer(system: &mut System) -> u32 {
        system.string_block(&" ".repeat(128))
    }

    /// `bitbits`: bitmaps made from known bits -- 1, 2, 3 and on -- read
    /// straight back, into a buffer of 128 bytes of `AAh`.
    #[test]
    fn reads_back_the_bits_it_was_made_with() {
        let recorded = [
            (8, "6,010203040506"),
            (16, "6,010203040506"),
            (24, "12,0102030405060708090a0b0c"),
            (32, "12,0102030405060708090a0b0c"),
            (40, "18,0102030405060708090a0b0c0d0e0f101112"),
        ];

        for (width, result) in recorded {
            let mut system = System::new();
            let counting: Vec<u8> = (1..=64).collect();
            let given = buffer(&mut system);

            system.write_far(given, &counting);

            let bitmap = create_bitmap(&mut system, width, 3, 1, 1, given);
            let far = buffer(&mut system);

            system.write_far(far, &[0xaa; 128]);

            let count = get_bitmap_bits(&mut system, bitmap, 128, far);
            let bytes = system.read_far(far, 128);
            let hex = bytes[..count as usize]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<Vec<_>>()
                .concat();

            assert_eq!(format!("{count},{hex}"), result, "{width}");
            assert!(bytes[count as usize..].iter().all(|&byte| byte == 0xaa));
            // A buffer smaller than the bitmap gets as many as it holds.
            assert_eq!(get_bitmap_bits(&mut system, bitmap, 1, far), 1);
        }
    }

    #[test]
    fn tells_of_a_bitmap_as_it_was_made() {
        let mut system = System::new();
        let far = buffer(&mut system);
        // SkiFree's bits a pixel, `AB01h`, read as a byte: monochrome.
        let mono = create_bitmap(&mut system, 20, 3, 1, 0xab01, 0);
        let colour = create_bitmap(&mut system, 20, 3, 4, 1, 0);
        // `patmono`: one plane of eight bits is made as it was asked for.
        let shaped = create_bitmap(&mut system, 20, 3, 1, 8, 0);

        assert_eq!(get_object(&mut system, mono, 14, far), 14);
        assert_eq!(
            system.read_far(far, 14),
            [0, 0, 20, 0, 3, 0, 4, 0, 1, 1, 0, 0, 0, 0]
        );
        assert_eq!(get_object(&mut system, colour, 20, far), 14);
        assert_eq!(system.read_far(far, 10)[6..], [4, 0, 4, 1]);
        assert_eq!(get_object(&mut system, shaped, 14, far), 14);
        assert_eq!(system.read_far(far, 10)[6..], [20, 0, 1, 8]);
        assert_eq!(get_object(&mut system, mono, 13, far), 0);
        assert_eq!(is_gdi_object(&system, mono), 5);
        // No device context takes a shape of its own.
        let hdc = create_compatible_dc(&mut system, 0);

        assert_eq!(select_object(&mut system, hdc, shaped), 0);
        assert_eq!(set_bitmap_bits(&mut system, shaped, 2, far), 2);
        assert!(delete_object(&mut system, shaped));
    }

    #[test]
    fn gives_the_first_bitmap_a_handle_when_it_is_replaced() {
        let mut system = System::new();
        let hdc = create_compatible_dc(&mut system, 0);
        let far = buffer(&mut system);

        // Compatible with a new memory context: monochrome.
        let first = create_compatible_bitmap(&mut system, hdc, 16, 4);

        assert_eq!(get_object(&mut system, first, 14, far), 14);
        assert_eq!(system.read_far(far, 10)[8..], [1, 1]);

        let screen = crate::gdi::dc::create_dc(&mut system, b"DISPLAY").unwrap();
        let colour = create_compatible_bitmap(&mut system, screen, 16, 4);
        let placeholder = select_object(&mut system, hdc, colour);

        // `wingapi`: the first bitmap given back is one by one.
        assert_ne!(placeholder, 1);
        assert_eq!(get_object(&mut system, placeholder, 14, far), 14);
        assert_eq!(
            system.read_far(far, 14),
            [0, 0, 1, 0, 1, 0, 2, 0, 1, 1, 0, 0, 0, 0]
        );
        // A bitmap made compatible with the context now is its depth.
        let like = create_compatible_bitmap(&mut system, hdc, 2, 2);

        assert_eq!(system.bitmap_of(like).unwrap().pixels.depth, 4);
        assert_eq!(select_object(&mut system, hdc, first), colour);
        assert_eq!(select_object(&mut system, hdc, placeholder), first);
        assert_eq!(create_compatible_bitmap(&mut system, 0, 1, 1), 0);
        assert_eq!(create_compatible_bitmap(&mut system, 0x1234, 1, 1), 0);
    }

    #[test]
    fn gives_each_call_its_own_copy_of_a_system_bitmap() {
        let mut system = System::new();

        // No display driver read: no raster desktop, and none.
        assert_eq!(
            load_bitmap(&mut system, 0, Some(&MenuName::Number(32754))),
            0
        );

        let oem = DeviceBitmap::new(3, 2, 4, None, None);

        oem.put(1, 1, 9);
        system.driver = Some(crate::icons::DriverResources {
            oem: [(32754, oem)].into_iter().collect(),
            ..Default::default()
        });

        let first = load_bitmap(&mut system, 0, Some(&MenuName::Number(32754)));
        let second = load_bitmap(&mut system, 0, Some(&MenuName::Number(32754)));

        assert_ne!(first, second);
        system.bitmap_of(first).unwrap().pixels.put(0, 0, 5);

        let copy = &system.bitmap_of(second).unwrap().pixels;

        assert_eq!((copy.width(), copy.height(), copy.depth), (3, 2, 4));
        assert_eq!(*copy.indices.borrow(), [0, 0, 0, 0, 9, 0]);
        assert_eq!(load_bitmap(&mut system, 0, Some(&MenuName::Number(1))), 0);
        // Text is nought, and there is no system bitmap nought here.
        assert_eq!(
            load_bitmap(&mut system, 0, Some(&MenuName::Text("x".into()))),
            0
        );
    }

    /// `patmono`'s `depth` records on the VGA: a bitmap 16 by 2 of each
    /// shape, what `GetObject` says of it, and whether a memory context
    /// compatible with the screen takes it.
    #[test]
    fn tells_each_shape_as_windows_did() {
        let recorded = [
            (1, 1, "row=2,planes=1,bits=1,selected=1"),
            (4, 1, "row=2,planes=4,bits=1,selected=1"),
            (1, 4, "row=8,planes=1,bits=4,selected=0"),
            (1, 8, "row=16,planes=1,bits=8,selected=0"),
            (3, 1, "row=2,planes=3,bits=1,selected=0"),
            (1, 24, "row=48,planes=1,bits=24,selected=0"),
        ];
        let mut system = System::new();
        let screen = crate::gdi::dc::create_dc(&mut system, b"DISPLAY").unwrap();
        let far = buffer(&mut system);

        for (planes, bits, result) in recorded {
            let bitmap = create_bitmap(&mut system, 16, 2, planes, bits, 0);

            get_object(&mut system, bitmap, 14, far);

            let info = system.read_far(far, 14);
            let memory = create_compatible_dc(&mut system, screen);
            let old = select_object(&mut system, memory, bitmap);

            assert_eq!(
                format!(
                    "row={},planes={},bits={},selected={}",
                    u16::from_le_bytes([info[6], info[7]]),
                    info[8],
                    info[9],
                    u8::from(old != 0)
                ),
                result
            );
        }
    }

    /// `patmono`'s `compatible` records on the VGA: a bitmap 16 by 2
    /// compatible with the screen is four planes of a bit; bytes counting
    /// up, `17x + 3`, given by `SetBitmapBits` are each row's four planes
    /// in turn, as `GetPixel` read the pixels back, palette digits.
    #[test]
    fn sets_the_displays_planes_as_windows_did() {
        const PALETTE: [[u8; 3]; 16] = [
            [0, 0, 0],
            [128, 0, 0],
            [0, 128, 0],
            [128, 128, 0],
            [0, 0, 128],
            [128, 0, 128],
            [0, 128, 128],
            [192, 192, 192],
            [128, 128, 128],
            [255, 0, 0],
            [0, 255, 0],
            [255, 255, 0],
            [0, 0, 255],
            [255, 0, 255],
            [0, 255, 255],
            [255, 255, 255],
        ];
        let mut system = System::new();
        let screen = crate::gdi::dc::create_dc(&mut system, b"DISPLAY").unwrap();
        let bitmap = create_compatible_bitmap(&mut system, screen, 16, 2);
        let far = buffer(&mut system);

        get_object(&mut system, bitmap, 14, far);
        assert_eq!(system.read_far(far, 10)[6..], [2, 0, 4, 1]);

        let given: Vec<u8> = (0..64u8)
            .map(|x| x.wrapping_mul(17).wrapping_add(3))
            .collect();

        system.write_far(far, &given);
        assert_eq!(set_bitmap_bits(&mut system, bitmap, 16, far), 16);

        let pixels = &system.bitmap_of(bitmap).unwrap().pixels;
        let colours = pixels.device_palette.borrow().colours.clone();
        let row = |y: i32| -> String {
            (0..16)
                .map(|x| {
                    let colour = colours[usize::from(pixels.index_at(x, y).unwrap())];

                    char::from_digit(
                        PALETTE.iter().position(|&c| c == colour).unwrap() as u32,
                        16,
                    )
                    .unwrap()
                })
                .collect()
        };

        assert_eq!(row(0), "0ca0765f0cafc3a0");
        assert_eq!(row(1), "fca7865f846333a0");
    }

    /// A bitmap of a shape no device context takes is turned away by the
    /// screen's context as by any, answering nought, before the selecting
    /// of a bitmap into the screen's is stopped at.
    #[test]
    fn turns_away_a_shape_from_the_screen_too() {
        let mut system = System::new();
        let screen = crate::gdi::dc::create_dc(&mut system, b"DISPLAY").unwrap();
        let shaped = create_bitmap(&mut system, 4, 4, 1, 8, 0);
        let plain = create_bitmap(&mut system, 4, 4, 1, 1, 0);

        assert!(!bitmap_into_screen(&system, screen, shaped));
        assert!(bitmap_into_screen(&system, screen, plain));
        assert_eq!(select_object(&mut system, screen, shaped), 0);
    }

    /// With no module, a name given as text, or none, is the number nought,
    /// as the TypeScript engine takes the name's low word.
    #[test]
    fn takes_a_system_bitmaps_name_as_its_low_word() {
        let mut system = System::new();
        let zero = DeviceBitmap::new(2, 2, 1, None, None);

        system.driver = Some(crate::icons::DriverResources {
            oem: [(0, zero)].into_iter().collect(),
            ..Default::default()
        });

        assert_ne!(
            load_bitmap(&mut system, 0, Some(&MenuName::Text("#32754".into()))),
            0
        );
        assert_ne!(load_bitmap(&mut system, 0, None), 0);
        assert_eq!(
            load_bitmap(&mut system, 0, Some(&MenuName::Number(32754))),
            0
        );
    }

    #[test]
    fn keeps_a_dimension() {
        let mut system = System::new();
        let bitmap = create_bitmap(&mut system, 1, 1, 1, 1, 0);

        assert_eq!(
            set_bitmap_dimension(&mut system, bitmap, 30, -4),
            Some((0, 0))
        );
        assert_eq!(
            set_bitmap_dimension(&mut system, bitmap, 1, 2),
            Some((30, -4))
        );
        assert_eq!(set_bitmap_dimension(&mut system, 0x1234, 1, 2), None);
    }
}
