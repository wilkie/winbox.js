'use strict';

import { decodeDib, dibToDevice } from '../../raster/dib.js';
import { DevicePalette } from '../../raster/device-palette.js';
import { Loader } from '../loader.js';
import { resourcesOf, RT_BITMAP } from '../ne-resources.js';

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
  const loaded = system._modules.fromName('COMMDLG');
  const path = loaded instanceof Loader ? loaded.path : 'C:\\WINDOWS\\SYSTEM\\COMMDLG.DLL';
  const handle = await system.dos.files.open(path);

  if (!handle) {
    return null;
  }

  try {
    const file = system.dos.files.resolve(handle);
    const bytes = new Uint8Array(await file.read(0, file.size));
    const resource = resourcesOf(bytes).find(
      (each: any) => each.type === RT_BITMAP && each.id === PICTURES
    );

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
  } finally {
    system.dos.files.close(handle);
  }
}
