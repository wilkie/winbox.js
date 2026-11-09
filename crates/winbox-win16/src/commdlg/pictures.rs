//! The folders' and drives' pictures of COMMDLG's file boxes: bitmap 576 of
//! the installation's `COMMDLG.DLL`, read as data, as SHELL's logo is.
//! None without the file.

use winbox_raster::{decode_dib, dib_to_device, palette_for_display};

use super::guest_calls::{A, Call, api, call};
use crate::call::{Answer, Args, Later};
use crate::engine::Engine;
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
    let data = bitmap_resource(system, PICTURES)?;
    let mut dib = decode_dib(&data).ok()?;
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

/// One of the installation's `COMMDLG.DLL`'s bitmaps, as data; none
/// without the file.
fn bitmap_resource(system: &mut System, id: u16) -> Option<Vec<u8>> {
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

    resources
        .iter()
        .find(|each| each.kind == RT_BITMAP && each.id == Some(id))
        .map(|resource| resource.data.to_vec())
}

/// A bitmap of COMMDLG's own, by its number, made for the screen with the first
/// entry of its colour table that is one colour made another (**read out of
/// `COMMDLG.DLL`**, seg6 `0000`-`0135`). **Recorded** by `loadalt`.
pub(super) fn load_alter_bitmap(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (id, replace, instead) = {
            let system = engine.system();

            (args.word(&system), args.dword(&system), args.dword(&system))
        };
        let Some(mut dib) = bitmap_resource(&mut engine.system(), id) else {
            return Ok(Answer::Word(0));
        };
        let quad = |color: u32| [(color >> 16) as u8, (color >> 8) as u8, color as u8, 0];
        let wanted = quad(replace);
        let mut at = usize::from(u16::from_le_bytes([dib[0], dib[1]]));

        while at + 4 <= dib.len() {
            if dib[at..at + 4] == wanted {
                dib[at..at + 4].copy_from_slice(&quad(instead));
                break;
            }

            at += 4;
        }

        let bits_at = (1usize << (dib[0x0e] + 2)) + 0x28;
        let info = dib[..bits_at].to_vec();
        let bits = dib[bits_at..].to_vec();
        let hdc = api(engine, "USER", "GetDC", &[A::W(0)]).await? as u16;

        if hdc == 0 {
            return Ok(Answer::Word(0));
        }

        let (bitmap, _) = call(
            engine,
            Call {
                module: "GDI",
                name: "CreateDIBitmap",
                args: &[A::W(hdc), A::S(0), A::D(4), A::S(1), A::S(0), A::W(0)],
                structs: vec![info, bits],
            },
        )
        .await?;

        api(engine, "USER", "ReleaseDC", &[A::W(0), A::W(hdc)]).await?;
        Ok(Answer::Word(bitmap as u16))
    })
}
