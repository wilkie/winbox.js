'use strict';

import { DeviceBitmap } from '../raster/device-bitmap.js';
import { DevicePalette } from '../raster/device-palette.js';
import { pdfOf } from '../raster/pdf.js';
import { Surface } from '../raster/surface.js';

/**
 * winbox.js's own printer: a driver of its own name, `WBPRINT`, that GDI
 * draws a page into as it would into any printer's, and that hands the
 * document on as a PDF -- into the file named as its port, or to the page
 * the emulator runs in. It is winbox.js's, not a Windows driver's; what it
 * is held to is what GDI does around any printer, which the `printing` probe
 * recorded with Windows' own PostScript driver.
 *
 * A page is US Letter at 300 dots an inch, in the sixteen colours.
 */

export const PRINTER = {
  module: 'WBPRINT',
  device: 'WinBox Printer',
  port: 'LPT1:',
};

/** What `GetDeviceCaps` answers of the printer, as a display mode says a display's. */
export const PRINTER_CAPS = {
  name: PRINTER.device,
  driverVersion: 0x30a,
  technology: 2, // DT_RASPRINTER
  widthMillimetres: 216,
  heightMillimetres: 279,
  width: 2550,
  height: 3300,
  bitsPerPixel: 4,
  planes: 1,
  colors: 16,
  numBrushes: -1,
  numPens: -1,
  numMarkers: 0,
  numFonts: 0,
  curveCaps: 0,
  lineCaps: 0,
  polygonalCaps: 0,
  textCaps: 0,
  clipCaps: 1,
  rasterCaps: 0x0001 | 0x0008 | 0x0080 | 0x0800, // bitblt, bitmap64, big font, stretchblt
  aspectX: 300,
  aspectY: 300,
  aspectXY: 424,
  logicalPixelsX: 300,
  logicalPixelsY: 300,
  sizePalette: 0,
  numReserved: 0,
  colorRes: 0,
  escapes: {},
};

/** Whether a driver named to `CreateDC` is this one. */
export function isPrinterDriver(name: unknown) {
  return (
    String(name ?? '')
      .replace(/\.DRV$/i, '')
      .toUpperCase() === PRINTER.module
  );
}

/**
 * What WIN.INI holds with the printer installed, as Setup writes a printer's
 * entries: the default in [windows]' `device`, and the printer under
 * [devices] and [PrinterPorts] (seen in the installation Setup made with the
 * PostScript driver). Takes the file's text and answers it changed.
 */
export function installPrinter(text: string) {
  const lines = text.split(/\r?\n/);
  const set = (section: string, key: string, value: string) => {
    let start = lines.findIndex(
      (line) => line.trim().toLowerCase() === `[${section.toLowerCase()}]`
    );

    if (start < 0) {
      lines.push('', `[${section}]`);
      start = lines.length - 1;
    }

    let end = start + 1;

    while (end < lines.length && !lines[end].trim().startsWith('[')) {
      end++;
    }

    const at = lines
      .slice(start + 1, end)
      .findIndex((line) => line.toLowerCase().startsWith(`${key.toLowerCase()}=`));

    if (at >= 0) {
      lines[start + 1 + at] = `${key}=${value}`;
    } else {
      let last = end;

      while (last > start + 1 && !lines[last - 1].trim()) {
        last--;
      }

      lines.splice(last, 0, `${key}=${value}`);
    }
  };

  set('windows', 'device', `${PRINTER.device},${PRINTER.module},${PRINTER.port}`);
  set('devices', PRINTER.device, `${PRINTER.module},${PRINTER.port}`);
  set('PrinterPorts', PRINTER.device, `${PRINTER.module},${PRINTER.port},15,90`);

  return lines.join('\r\n');
}

/** A document being printed, kept on the printer's device context. */
export interface PrintJob {
  name: string;
  port: string;
  started: boolean;
  pageOpen: boolean;
  pages: Uint8Array[];
}

/** A device context for the printer: a page to draw into, and its job. */
export function printerSurface(system: any, port: string) {
  const surface: any = Surface.memory();
  const palette = DevicePalette.forDisplay(system.display, 4);

  surface.bitmap = new DeviceBitmap(PRINTER_CAPS.width, PRINTER_CAPS.height, 4, undefined, palette);
  surface.bitmap.indices.fill(palette.index(255, 255, 255));
  surface.device = PRINTER_CAPS;
  surface.printer = {
    port: String(port ?? PRINTER.port),
    abortProc: 0,
    job: null as PrintJob | null,
  };

  return surface;
}

/** The page cleared to white, for the next one. */
export function clearPage(surface: any) {
  const bitmap = surface.bitmap as DeviceBitmap;

  bitmap.indices.fill(bitmap.devicePalette.index(255, 255, 255));
}

/** Whether a port names a file rather than a device such as `LPT1:`. */
function isFile(port: string) {
  return /[\\.]/.test(port) || /^[A-Za-z]:[^:]/.test(port);
}

/**
 * A finished document handed on: as a PDF, into the file its port names, or
 * to the emulator's host (`system.printed`) for a port that is a device.
 */
export async function deliver(system: any, surface: any, job: PrintJob) {
  const pdf = await pdfOf(
    job.pages,
    PRINTER_CAPS.width,
    PRINTER_CAPS.height,
    PRINTER_CAPS.logicalPixelsX,
    (surface.bitmap as DeviceBitmap).devicePalette.colours
  );

  if (!isFile(job.port)) {
    (system.printed ??= []).push({ name: job.name, pdf });
    system.onPrinted?.({ name: job.name, pdf });
    return;
  }

  const files = system.dos?.files;
  const handle = files ? await files.create(job.port) : null;
  const file = handle ? files.resolve(handle) : null;

  if (!file) {
    return;
  }

  try {
    await file.write(0, pdf);
  } finally {
    files.close(handle);
  }
}
