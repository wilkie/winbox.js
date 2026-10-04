//! winbox.js's own printer: a driver of its own name, `WBPRINT`, that GDI
//! draws a page into as it would into any printer's, and that hands the
//! document on as a PDF -- into the file named as its port, or to the
//! host for a port that is a device. It is winbox.js's, not a Windows
//! driver's; what it is held to is what GDI does around any printer, which
//! the `printing` probe recorded with Windows' own PostScript driver (see
//! `gdi/printing.rs`).
//!
//! A page is US Letter at 300 dots an inch, in the sixteen colours.
//!
//! Not here, as the TypeScript engine has it: the host told of a document
//! as it is printed (`onPrinted`). A document printed to a device is kept
//! in `Printing::printed` for the host to take.

use std::collections::HashMap;

use winbox_raster::{DeviceBitmap, palette_for_display};

use crate::gdi::objects::{SYSTEM_FONT, stock_font_handle};
use crate::gdi::{DcBitmap, GdiObject};
use crate::handles::{Kind, Object};
use crate::profile::{js_space, lower};
use crate::system::System;

/// The driver's module, the device it names and the port it prints to by
/// default.
pub const MODULE: &str = "WBPRINT";
pub const DEVICE: &str = "WinBox Printer";
pub const PORT: &str = "LPT1:";

/// A page's size in dots, and the dots an inch.
pub const WIDTH: usize = 2550;
pub const HEIGHT: usize = 3300;
pub const DPI: usize = 300;

/// What `GetDeviceCaps` answers of the printer, by the capability's index,
/// as a display mode says a display's.
pub fn device_caps(capability: i16) -> i32 {
    match capability {
        0 => 0x30a,                              // DRIVERVERSION
        2 => 2,                                  // TECHNOLOGY: DT_RASPRINTER
        4 => 216,                                // HORZSIZE
        6 => 279,                                // VERTSIZE
        8 => WIDTH as i32,                       // HORZRES
        10 => HEIGHT as i32,                     // VERTRES
        12 => 4,                                 // BITSPIXEL
        14 | 36 => 1,                            // PLANES, CLIPCAPS
        16 | 18 => -1,                           // NUMBRUSHES, NUMPENS
        24 => 16,                                // NUMCOLORS
        38 => 0x0001 | 0x0008 | 0x0080 | 0x0800, // RASTERCAPS: bitblt, bitmap64, big font, stretchblt
        40 | 42 | 88 | 90 => DPI as i32,         // ASPECTX, ASPECTY, LOGPIXELSX, LOGPIXELSY
        44 => 424,                               // ASPECTXY
        // NUMMARKERS, NUMFONTS, the curve, line, polygon and text
        // capabilities, SIZEPALETTE, NUMRESERVED, COLORRES, and any other.
        _ => 0,
    }
}

/// Whether a driver named to `CreateDC` is this one: its module's name,
/// with or without `.DRV`, in any case.
pub fn is_printer_driver(name: &[u8]) -> bool {
    let name = name.to_ascii_uppercase();
    let name = name.strip_suffix(b".DRV").unwrap_or(&name);

    name == MODULE.as_bytes()
}

/// What `WIN.INI` holds with the printer installed, as Setup writes a
/// printer's entries: the default in `[windows]`' `device`, and the
/// printer under `[devices]` and `[PrinterPorts]` (seen in the installation
/// Setup made with the PostScript driver). Takes the file's bytes and
/// answers them changed, every line ended by a carriage return and a line
/// feed.
pub fn install_printer(text: &[u8]) -> Vec<u8> {
    let device = format!("{DEVICE},{MODULE},{PORT}");
    let entry = format!("{MODULE},{PORT}");
    let port = format!("{MODULE},{PORT},15,90");

    with_entries(
        text,
        &[
            ("windows", "device", &device),
            ("devices", DEVICE, &entry),
            ("PrinterPorts", DEVICE, &port),
        ],
    )
}

/// An initialization file's bytes with entries set, each in its section,
/// as Setup and Control Panel write them: an entry there replaced where it
/// is, a new one after the section's last line that is not blank, a new
/// section at the end. Every line ended by a carriage return and a line
/// feed.
pub fn with_entries(text: &[u8], entries: &[(&str, &str, &str)]) -> Vec<u8> {
    fn trim(line: &[u8]) -> &[u8] {
        let start = line
            .iter()
            .position(|&b| !js_space(b))
            .unwrap_or(line.len());
        let end = line
            .iter()
            .rposition(|&b| !js_space(b))
            .map_or(start, |at| at + 1);

        &line[start..end.max(start)]
    }

    fn lowered(bytes: &[u8]) -> Vec<u8> {
        bytes.iter().map(|&b| lower(b)).collect()
    }

    fn set(lines: &mut Vec<Vec<u8>>, section: &str, key: &str, value: &str) {
        let heading = lowered(format!("[{section}]").as_bytes());
        let start =
            if let Some(start) = lines.iter().position(|line| lowered(trim(line)) == heading) {
                start
            } else {
                lines.push(Vec::new());
                lines.push(format!("[{section}]").into_bytes());
                lines.len() - 1
            };
        let mut end = start + 1;

        while end < lines.len() && !trim(&lines[end]).starts_with(b"[") {
            end += 1;
        }

        let entry = format!("{key}={value}").into_bytes();
        let prefix = lowered(format!("{key}=").as_bytes());

        if let Some(at) = lines[start + 1..end]
            .iter()
            .position(|line| lowered(line).starts_with(&prefix))
        {
            lines[start + 1 + at] = entry;
        } else {
            let mut last = end;

            while last > start + 1 && trim(&lines[last - 1]).is_empty() {
                last -= 1;
            }

            lines.insert(last, entry);
        }
    }

    // Split at each line feed, a return before it dropped -- only a return
    // before a line feed: one ending the file with none after it stays on
    // the last line, as the TypeScript engine's `/\r?\n/` leaves it.
    let pieces: Vec<&[u8]> = text.split(|&b| b == b'\n').collect();
    let last = pieces.len() - 1;
    let mut lines: Vec<Vec<u8>> = pieces
        .iter()
        .enumerate()
        .map(|(at, line)| {
            if at < last {
                line.strip_suffix(b"\r").unwrap_or(line).to_vec()
            } else {
                line.to_vec()
            }
        })
        .collect();

    for (section, key, value) in entries {
        set(&mut lines, section, key, value);
    }

    lines.join(&b"\r\n"[..])
}

/// A document being printed, kept with the printer's device context.
#[derive(Debug, Clone)]
pub struct PrintJob {
    /// Which document this is, the first 1: what a page's end comes back
    /// to after the abort procedure is called.
    pub serial: u32,
    pub name: Vec<u8>,
    pub port: String,
    /// Whether a page is drawn and not yet ended.
    pub page_open: bool,
    /// Each page ended, as its palette indices.
    pub pages: Vec<Vec<u8>>,
}

/// A printer's device context: where it prints, its abort procedure, and
/// the document under way.
#[derive(Debug, Clone, Default)]
pub struct Printer {
    pub port: String,
    pub abort_proc: u32,
    pub job: Option<PrintJob>,
}

/// A document handed on to the host: its name, and the PDF.
#[derive(Debug, Clone)]
pub struct Printed {
    pub name: Vec<u8>,
    pub pdf: Vec<u8>,
}

/// What GDI keeps of printing: the printers' device contexts, by their
/// index among GDI's device contexts; Print Manager's spooler
/// (`gdi/spool_job.rs`); and the documents handed to the host.
#[derive(Debug, Clone, Default)]
pub struct Printing {
    pub printers: HashMap<usize, Printer>,
    pub spooler: crate::gdi::spool_job::Spooler,
    pub printed: Vec<Printed>,
    /// The documents started, for the next one's serial.
    pub started: u32,
}

/// The printer's device context a handle stands for, by its index.
pub fn printer_of(system: &System, hdc: u16) -> Option<usize> {
    match system.handles.resolve(hdc)? {
        Object::Dc(index) if system.printing.printers.contains_key(&index) => Some(index),
        _ => None,
    }
}

/// A device context for the printer, printing to `port`: a page to draw
/// into, white, in the sixteen colours as the display's driver has them,
/// and the System font selected. Its handle is GDI's, as a memory device
/// context's is; its driver is the printer's, not GDI's own for bitmaps.
pub fn create_printer_dc(system: &mut System, port: String) -> u16 {
    let palette = palette_for_display(system.display_kind(), Some(4));
    let pixels = DeviceBitmap::new(WIDTH as i32, HEIGHT as i32, 4, None, Some(palette));
    let page = system.gdi_object(GdiObject::Bitmap(Box::new(crate::gdi::ddb::Bitmap::new(
        pixels,
    ))));
    let index = system.new_dc(DcBitmap::Bitmap(page), false);

    clear_page(system, index);

    if let Some(font) = stock_font_handle(system, SYSTEM_FONT)
        && let Some(Object::Gdi(font)) = system.handles.resolve(font)
    {
        system.gdi.dcs[index].state.font = Some(font);
    }

    system.printing.printers.insert(
        index,
        Printer {
            port,
            abort_proc: 0,
            job: None,
        },
    );
    system
        .handles
        .allocate(Kind::Gdi, Object::Dc(index))
        .unwrap_or(0)
}

/// The page the device context draws into, the bitmap selected.
fn page_of(system: &System, dc: usize) -> Option<&DeviceBitmap> {
    match system.gdi.dcs[dc].bitmap {
        DcBitmap::Bitmap(object) => match &system.gdi.objects[object] {
            GdiObject::Bitmap(bitmap) => Some(&bitmap.pixels),
            _ => None,
        },
        _ => None,
    }
}

/// The page cleared to white, for the next one.
pub fn clear_page(system: &System, dc: usize) {
    if let Some(page) = page_of(system, dc) {
        let white = page.device_palette.borrow_mut().index(255, 255, 255) as u8;

        page.indices.borrow_mut().fill(white);
    }
}

/// The page as drawn, its palette indices.
pub fn page_copy(system: &System, dc: usize) -> Vec<u8> {
    page_of(system, dc).map_or_else(Vec::new, |page| page.indices.borrow().clone())
}

/// Whether a port names a file rather than a device such as `LPT1:`: it
/// has a backslash or a full stop, or is a drive's letter and a colon with
/// more after it.
fn is_file(port: &str) -> bool {
    let bytes = port.as_bytes();

    port.contains(['\\', '.'])
        || (bytes.len() > 2
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] != b':')
}

/// A finished document handed on: as a PDF, into the file its port names,
/// or to the host (`Printing::printed`) for a port that is a device. A file
/// that cannot be made is let be.
pub fn deliver(system: &mut System, dc: usize, job: PrintJob) {
    let colours = page_of(system, dc)
        .map(|page| page.device_palette.borrow().colours.clone())
        .unwrap_or_default();
    let pdf = winbox_raster::pdf::pdf_of(&job.pages, WIDTH, HEIGHT, DPI, &colours);

    if !is_file(&job.port) {
        system.printing.printed.push(Printed {
            name: job.name,
            pdf,
        });
        return;
    }

    let Ok(handle) = system.make_file(&job.port, false) else {
        return;
    };

    if let Some(file) = system.files.resolve(handle) {
        file.write(&pdf);
    }

    system.files.close(handle);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_its_driver_by_name() {
        assert!(is_printer_driver(b"WBPRINT"));
        assert!(is_printer_driver(b"wbprint.drv"));
        assert!(!is_printer_driver(b"pscript"));
        assert!(!is_printer_driver(b""));
    }

    #[test]
    fn tells_a_file_from_a_device() {
        assert!(is_file("C:\\ORACLE\\PRINTED.PRN"));
        assert!(is_file("OUT.PRN"));
        assert!(is_file("C:OUT"));
        assert!(!is_file("LPT1:"));
        assert!(!is_file("FILE:"));
    }

    #[test]
    fn installs_itself_as_setup_installs_a_printer() {
        let text = b"[windows]\r\nspooler=yes\r\ndevice=\r\n\r\n[Desktop]\r\nWallpaper=(None)\r\n";
        let installed = String::from_utf8(install_printer(text)).unwrap();

        assert_eq!(
            installed,
            "[windows]\r\nspooler=yes\r\ndevice=WinBox Printer,WBPRINT,LPT1:\r\n\r\n\
             [Desktop]\r\nWallpaper=(None)\r\n\r\n\r\n\
             [devices]\r\nWinBox Printer=WBPRINT,LPT1:\r\n\r\n\
             [PrinterPorts]\r\nWinBox Printer=WBPRINT,LPT1:,15,90"
        );
    }

    #[test]
    fn replaces_a_printer_already_there_and_keeps_a_last_return() {
        // The key found in any case and replaced; a new entry put before
        // the section's blank lines; a return that ends the file with no
        // line feed after it left on its line.
        let text = b"[Windows]\r\nDevice=PostScript Printer,PSCRIPT,LPT1:\r\n\r\n\
                     [devices]\r\nPostScript Printer=PSCRIPT,LPT1:\r\n\r\n\r";
        let installed = String::from_utf8(install_printer(text)).unwrap();

        assert_eq!(
            installed,
            "[Windows]\r\ndevice=WinBox Printer,WBPRINT,LPT1:\r\n\r\n\
             [devices]\r\nPostScript Printer=PSCRIPT,LPT1:\r\nWinBox Printer=WBPRINT,LPT1:\r\n\
             \r\n\r\r\n\r\n\
             [PrinterPorts]\r\nWinBox Printer=WBPRINT,LPT1:,15,90"
        );
    }
}
