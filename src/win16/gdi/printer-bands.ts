'use strict';

import { DWORD, UINT } from '../types.js';
import { SelectClipRgn } from './clipping.js';
import { CloseMetaFile, CreateMetaFile, DeleteMetaFile, PlayMetaFile } from './metafile.js';
import { onStackBytes } from './printer-output.js';
import { RestoreDC, SaveDC } from './SaveDC.js';

/**
 * Bands: GDI's side of a driver whose `dpRaster` has `RC_BANDING` (2), as
 * `GDI.EXE` keeps it. The twin of `crates/winbox-win16/src/gdi/printer_bands.rs`.
 *
 * * `CreateDC` of a device newly enabled, not an IC, makes a metafile
 *   (seg1 `042d`, `GetTempFileName` and `CreateMetaFile`; here one in
 *   memory), keeps it on the context, saves the context (`025b`) and marks
 *   it as recording, type 4F50h (`0264`).
 * * While it records, each call that draws is kept in the metafile and not
 *   drawn; each that sets the context's state is kept and made too; `LineTo`
 *   is kept and moves the current position (`bandingCall`).
 * * `NEWFRAME` (seg7 `01b7`), as `EndPage` sends it: the context made the
 *   type that draws (4F4Fh), restored to its first level, the metafile
 *   closed; then for each band, the context saved, the driver's `Control`
 *   asked `NEXTBAND` (`0207`), the visible region narrowed to the band
 *   (`IntersectVisRect`), the clip region dropped, the metafile played and
 *   the context restored -- until the driver gives an empty band. Then the
 *   metafile deleted, a new one made, the context saved and recording again,
 *   and `NEWFRAME` given to the driver (`044e`). A band the driver refuses,
 *   or a metafile that does not play, ends it so and gives the driver
 *   `ABORTDOC` instead, answering the refusal (`028d`).
 * * `NEXTBAND` from the program (`0303`): the first of a page throws the
 *   metafile away, restores the context and saves it again, and the
 *   context draws; each gives the driver `NEXTBAND` and narrows the
 *   visible region to its band; an empty band makes a metafile again,
 *   restores and saves the context, and it records (`03a3`).
 * * `ABORTDOC` (`018c`) restores the context, and makes the metafile anew;
 *   `ENDDOC` (`0152`) widens the visible region back.
 * * `DeleteDC` closes and deletes the metafile (seg1 `089b`).
 *
 * Not followed: `RC_SCALING`'s shifts, the temporary file, and the escapes
 * GDI keeps in the metafile (25, 200h on, seg7 `0172`, `0469`).
 */

export interface Bands {
  /** The metafile's context, while there is one. */
  meta: number;
  /** Whether calls are kept in it (type 4F50h). */
  recording: boolean;
  /** The band the visible region is narrowed to, in device units. */
  rect: [number, number, number, number] | null;
}

/**
 * What a call does on a context that records (seg20 `2596` and the
 * `cmp byte [bx+2], 50h` after it): `both`, kept and made; `position`,
 * kept and the current position moved (seg21 `0b47`); `kept`, kept and not
 * made; null, made as on any context.
 */
const BOTH = new Set([
  'SetBkColor',
  'SetBkMode',
  'SetMapMode',
  'SetRop2',
  'SetPolyFillMode',
  'SetStretchBltMode',
  'SetTextAlign',
  'SetTextCharacterExtra',
  'SetTextColor',
  'SetTextJustification',
  'SetWindowOrg',
  'SetWindowExt',
  'SetViewportOrg',
  'SetViewportExt',
  'OffsetWindowOrg',
  'ScaleWindowExt',
  'OffsetViewportOrg',
  'ScaleViewportExt',
  'MoveTo',
  'ExcludeClipRect',
  'IntersectClipRect',
  'SelectObject',
  'SelectClipRgn',
  'SaveDC',
  'RestoreDC',
  'SetMapperFlags',
]);

const KEPT = new Set([
  'Arc',
  'Chord',
  'Ellipse',
  'Pie',
  'Rectangle',
  'RoundRect',
  'Polygon',
  'Polyline',
  'PolyPolygon',
  'TextOut',
  'ExtTextOut',
  'PatBlt',
  'BitBlt',
  'StretchBlt',
  'SetPixel',
  'FloodFill',
  'ExtFloodFill',
  'FillRgn',
  'FrameRgn',
  'InvertRgn',
  'PaintRgn',
  'OffsetClipRgn',
  'SetDIBitsToDevice',
  'StretchDIBits',
]);

export function bandingCall(name: string): 'both' | 'position' | 'kept' | null {
  if (BOTH.has(name)) {
    return 'both';
  }

  if (name === 'LineTo') {
    return 'position';
  }

  return KEPT.has(name) ? 'kept' : null;
}

const NEWFRAME = 1;
const ABORTDOC = 2;
const NEXTBAND = 3;
const ENDDOC = 11;
const CONTROL = 3;

/** A context of a driver that bands made ready to record (seg1 `042d`, `025b`). */
export async function startBands(system: any, hdc: number, surface: any) {
  const meta = await CreateMetaFile.call(system, 0);

  surface.band = { meta, recording: false, rect: null } as Bands;
  SaveDC.call(system, hdc);
  surface.band.recording = Boolean(meta);
}

/** The metafile a context recorded, closed and deleted. */
async function dropMetafile(system: any, band: Bands) {
  if (band.meta) {
    DeleteMetaFile.call(system, await CloseMetaFile.call(system, band.meta));
    band.meta = 0;
  }
}

/** A new metafile, the context saved, and recording again. */
async function recordAgain(system: any, hdc: number, band: Bands) {
  band.meta = await CreateMetaFile.call(system, 0);
  SaveDC.call(system, hdc);
  band.recording = Boolean(band.meta);
}

async function control(system: any, surface: any, escape: number, lpIn: number, lpOut: number) {
  const pdevice = surface.driverDevice;
  const procedure = pdevice.driver.procs[CONTROL - 1] ?? 0;

  if (!procedure) {
    return 0;
  }

  const answer = await system.scheduler.callProc(procedure, [
    [pdevice.lpPDevice, DWORD],
    [escape, UINT],
    [lpIn >>> 0, DWORD],
    [lpOut >>> 0, DWORD],
  ]);

  return ((Number(answer ?? 0) & 0xffff) << 16) >> 16;
}

function rectAt(system: any, far: number): [number, number, number, number] {
  const core = system.machine.cpu.core;
  const word = (at: number) =>
    (core.read16((far >>> 16) & 0xffff, ((far & 0xffff) + at) & 0xffff) << 16) >> 16;

  return [word(0), word(2), word(4), word(6)];
}

const empty = (rect: number[]) => !(rect[0] | rect[1] | rect[2] | rect[3]);

function narrowed(band: Bands, rect: [number, number, number, number]) {
  const within = band.rect;

  return within
    ? ([
        Math.max(within[0], rect[0]),
        Math.max(within[1], rect[1]),
        Math.min(within[2], rect[2]),
        Math.min(within[3], rect[3]),
      ] as [number, number, number, number])
    : rect;
}

/**
 * An escape GDI takes for a context that bands, or null for one it hands
 * to the driver as any other (seg7 `0137`-`0448`).
 */
export async function bandEscape(
  system: any,
  hdc: number,
  surface: any,
  escape: number,
  lpIn: number,
  lpOut: number
): Promise<number | null> {
  const band: Bands | undefined = surface.band;

  if (!band) {
    return null;
  }

  if (escape === NEWFRAME && band.recording) {
    return newFrame(system, hdc, surface, band, lpIn, lpOut);
  }

  if (escape === NEXTBAND) {
    return nextBand(system, hdc, surface, band, lpOut);
  }

  if (escape === ABORTDOC) {
    RestoreDC.call(system, hdc, 0);
    band.rect = null;

    if (!band.meta) {
      RestoreDC.call(system, hdc, 0);
    }

    await dropMetafile(system, band);
    band.recording = false;
    await recordAgain(system, hdc, band);

    return control(system, surface, ABORTDOC, lpIn, lpOut);
  }

  if (escape === ENDDOC) {
    band.rect = null;
  }

  return null;
}

/** The page GDI kept, played band by band (seg7 `01b7`-`0300`). */
async function newFrame(
  system: any,
  hdc: number,
  surface: any,
  band: Bands,
  lpIn: number,
  lpOut: number
) {
  band.recording = false;
  RestoreDC.call(system, hdc, 0);

  const hmf = await CloseMetaFile.call(system, band.meta);
  let refused: number | null = null;

  band.meta = 0;

  for (;;) {
    SaveDC.call(system, hdc);

    const [answer, rect] = await onStackBytes(system, new Uint8Array(12), async (far) => {
      const point = far;
      const out = ((far & 0xffff0000) | ((far + 4) & 0xffff)) >>> 0;
      const given = await control(system, surface, NEXTBAND, point, out);

      return [given, rectAt(system, out)] as const;
    });

    if (answer <= 0) {
      refused = answer;
      break;
    }

    if (empty(rect)) {
      break;
    }

    const saved = band.rect;

    band.rect = narrowed(band, rect);
    SelectClipRgn.call(system, hdc, 0);

    const played = await PlayMetaFile.call(system, hdc, hmf);

    if (!played) {
      band.rect = saved;
      refused = -1;
      break;
    }

    RestoreDC.call(system, hdc, 0);
    band.rect = saved;
  }

  RestoreDC.call(system, hdc, 0);
  DeleteMetaFile.call(system, hmf);
  await recordAgain(system, hdc, band);

  const answer = await control(
    system,
    surface,
    refused === null ? NEWFRAME : ABORTDOC,
    lpIn,
    lpOut
  );

  return refused === null ? answer : refused;
}

/** The program's own `NEXTBAND` (seg7 `0303`-`0448`). */
async function nextBand(system: any, hdc: number, surface: any, band: Bands, lpOut: number) {
  if (band.meta) {
    await dropMetafile(system, band);
    band.recording = false;
    RestoreDC.call(system, hdc, 0);
    SaveDC.call(system, hdc);
  }

  band.rect = null;

  const answer = await onStackBytes(system, new Uint8Array(4), (point) =>
    control(system, surface, NEXTBAND, point, lpOut)
  );
  const rect = lpOut ? rectAt(system, lpOut) : [0, 0, 0, 0];

  if (empty(rect)) {
    band.meta = await CreateMetaFile.call(system, 0);
    RestoreDC.call(system, hdc, 0);
    SaveDC.call(system, hdc);
    band.recording = Boolean(band.meta);

    return answer;
  }

  band.rect = rect as [number, number, number, number];

  return answer;
}

/** A context that bands deleted: its metafile closed and deleted (seg1 `089b`). */
export async function stopBands(system: any, surface: any) {
  if (surface.band) {
    await dropMetafile(system, surface.band);
    surface.band = null;
  }
}
