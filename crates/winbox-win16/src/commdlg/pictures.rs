//! The folders' and drives' pictures of COMMDLG's file boxes: bitmap 576 of
//! the installation's `COMMDLG.DLL`, read as data, as SHELL's logo is.
//! None without the file. As `pictures.ts`.

use winbox_raster::{decode_dib, dib_to_device, palette_for_display};

use crate::shell::programs::resources_of;
use crate::system::System;

const RT_BITMAP: i32 = 2;
const PICTURES: u16 = 576;

/// A colour as `COLORREF` holds it, as red, green and blue.
fn rgb(color: u32) -> [u8; 3] {
    [color as u8, (color >> 8) as u8, (color >> 16) as u8]
}

/// The pictures, twice side by side: first with their blue made the
/// window's colour, then the highlight's (`COMMDLG.DLL` seg2 `0dfa`,
/// `0ebf`; `LoadAlterBitmap`, seg6 `0000`, which makes the colour
/// table's first entry of the colour given another).
pub(super) fn pictures(
    system: &mut System,
    window: u32,
    highlight: u32,
) -> Option<crate::gdi::ddb::Bitmap> {
    let path = system.module_named(super::NAME).map_or_else(
        || "C:\\WINDOWS\\SYSTEM\\COMMDLG.DLL".to_string(),
        |library| system.modules[library].path.clone(),
    );
    let handle = system.files.open(&path)?;
    let bytes = {
        let file = system.files.resolve(handle).expect("an open file");
        let size = file.size() as usize;

        file.seek(std::io::SeekFrom::Start(0));
        file.read(size)
    };

    system.files.close(handle);

    let resources = resources_of(&bytes)?;
    let resource = resources
        .iter()
        .find(|each| each.kind == RT_BITMAP && each.id == Some(PICTURES))?;
    let mut dib = decode_dib(resource.data).ok()?;
    let blue = [0, 0, 0xff];
    let replaced = |colours: &[[u8; 3]], with: u32| {
        let mut colours = colours.to_vec();

        if let Some(entry) = colours.iter_mut().find(|entry| **entry == blue) {
            *entry = rgb(with);
        }

        colours
    };
    let count = dib.colours.len();
    let mut colours = replaced(&dib.colours, window);

    colours.extend(replaced(&dib.colours, highlight));

    let width = dib.width as usize;
    let height = dib.height as usize;
    let mut pixels = Vec::with_capacity(width * 2 * height);

    for row in 0..height {
        let line = &dib.pixels[row * width..(row + 1) * width];

        pixels.extend_from_slice(line);
        pixels.extend(line.iter().map(|&index| index + count as u8));
    }

    dib.width *= 2;
    dib.bit_count = 8;
    dib.colours = colours;
    dib.pixels = pixels;

    let display = system.display_kind();

    Some(crate::gdi::ddb::Bitmap {
        pixels: dib_to_device(
            &dib,
            display.depth(),
            Some(palette_for_display(display, None)),
            None,
            None,
        ),
        padding: None,
        dimension: None,
    })
}
