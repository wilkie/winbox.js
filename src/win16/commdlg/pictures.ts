'use strict';

import { decodeDib, dibToDevice } from '../../raster/dib.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { Loader } from '../loader.js';
import { resourcesOf, RT_BITMAP } from '../ne-resources.js';

import { B, D, W, api } from './api.js';

/**
 * The folders' and drives' pictures of COMMDLG's file boxes: bitmap 576 of
 * the installation's `COMMDLG.DLL`, read as data, as SHELL's logo is. None
 * without the file. As `pictures.rs`.
 */

const PICTURES = 576;

/** A colour as `COLORREF` holds it, as red, green and blue. */
const rgb = (color: number): [number, number, number] => [
  color & 0xff,
  (color >> 8) & 0xff,
  (color >> 16) & 0xff,
];

/**
 * The pictures, twice side by side: first with their blue made the window's
 * colour, then the highlight's (`COMMDLG.DLL` seg2 `0dfa`, `0ebf`;
 * `LoadAlterBitmap`, seg6 `0000`, which makes the colour table's first entry
 * of the colour given another).
 */
export async function pictures(system: any, window: number, highlight: number) {
  try {
    const resource = await bitmapResource(system, PICTURES);

    if (!resource) {
      return null;
    }

    const dib: any = decodeDib(resource.data);
    const replaced = (colours: [number, number, number][], color: number) => {
      const copy = colours.map((entry) => [...entry] as [number, number, number]);
      const at = copy.findIndex(([r, g, b]) => r === 0 && g === 0 && b === 0xff);

      if (at >= 0) {
        copy[at] = rgb(color);
      }

      return copy;
    };
    const count = dib.colours.length;
    const colours = [...replaced(dib.colours, window), ...replaced(dib.colours, highlight)];
    const width = dib.width;
    const height = dib.height;
    const pixels = new Uint8Array(width * 2 * height);

    for (let row = 0; row < height; row++) {
      for (let x = 0; x < width; x++) {
        const index = dib.pixels[row * width + x];

        pixels[row * width * 2 + x] = index;
        pixels[row * width * 2 + width + x] = index + count;
      }
    }

    const depth = DevicePalette.depthOf(system.display);

    return dibToDevice(
      { ...dib, width: width * 2, bitCount: 8, colours, pixels },
      depth,
      DevicePalette.forDisplay(system.display, depth)
    );
  } catch {
    return null;
  }
}

/** One of the installation's `COMMDLG.DLL`'s bitmaps, as data; none without the file. */
async function bitmapResource(system: any, id: number) {
  const loaded = system._modules.fromName('COMMDLG');
  const path = loaded instanceof Loader ? loaded.path : 'C:\\WINDOWS\\SYSTEM\\COMMDLG.DLL';
  const handle = await system.dos.files.open(path);

  if (!handle) {
    return null;
  }

  try {
    const file = system.dos.files.resolve(handle);
    const bytes = new Uint8Array(await file.read(0, file.size));

    return (
      resourcesOf(bytes).find((each: any) => each.type === RT_BITMAP && each.id === id) ?? null
    );
  } finally {
    system.dos.files.close(handle);
  }
}

/**
 * A bitmap of COMMDLG's own, by its number, made for the screen with the
 * first entry of its colour table that is `rgbReplace` made `rgbInstead`
 * (**read out of `COMMDLG.DLL`**, seg6 `0000`-`0135`): nought where there
 * is no such bitmap. The colours are compared as `RGBQUAD`s, blue first
 * (`0138`). USER's looks for the colour past the table, through the bits
 * and on, until it finds it; here a colour not in the bitmap's data changes
 * nothing. The bits are taken 28h bytes and the table past its start
 * (`00c2`-`00d6`), the table where the header's size says. Made by
 * `CreateDIBitmap` on the screen's device context, `CBM_INIT` and
 * `DIB_RGB_COLORS`. **Recorded** by `loadalt`.
 */
export async function LoadAlterBitmap(
  this: any,
  id: number,
  rgbReplace: number,
  rgbInstead: number
) {
  const resource = await bitmapResource(this, id & 0xffff);

  if (!resource) {
    return 0;
  }

  const dib = Array.from(resource.data as Uint8Array);
  const quad = (color: number) => [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, 0];
  const replace = quad(rgbReplace).join(',');

  for (let at = dib[0] | (dib[1] << 8); at + 4 <= dib.length; at += 4) {
    if (dib.slice(at, at + 4).join(',') === replace) {
      dib.splice(at, 4, ...quad(rgbInstead));
      break;
    }
  }

  const bitsAt = (1 << (dib[0x0e] + 2)) + 0x28;
  const info = dib.slice(0, bitsAt);
  const hdc = (await api(this, 'USER', 'GetDC', [W(0)])).value & 0xffff;

  if (!hdc) {
    return 0;
  }

  const bitmap = (
    await api(this, 'GDI', 'CreateDIBitmap', [
      W(hdc),
      B(info),
      D(4),
      B(dib.slice(bitsAt)),
      B(info),
      W(0),
    ])
  ).value;

  await api(this, 'USER', 'ReleaseDC', [W(0), W(hdc)]);

  return bitmap & 0xffff;
}
