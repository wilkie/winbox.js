'use strict';

/** What a device context keeps that `SaveDC` saves. */
const KEPT = [
  'backMode',
  'textAlign',
  'textColor',
  'charExtra',
  'backcolor',
  'forecolor',
  'brush',
  'pen',
  'font',
  'rop2',
  'polyFillMode',
  'stretchMode',
  'brushOrg',
  'clipRegion',
  'mapping',
  'justification',
  'pageStarted',
  'banding',
  /* `SetRelAbs`' mode (`dcinner`). */
  'relAbs',
  /* The origin `SetDCOrg` set: the state GDI copies is the context's first
   * A0h bytes, the origin and the clip region -- not the visible region
   * (`GDI.EXE` seg1 `0a46`; `visible-region.ts`). */
  'dcOrigin',
];

/** A device context's state as `SaveDC` saves it, and `GetDCState` copies it. */
export function stateOf(surface: any) {
  const state: any = { x: surface.data?.x, y: surface.data?.y };

  /* A printer driver's context keeps its realized pen and brush and its
   * physical colours with the rest (`printer-output.ts`). */
  if (surface.driverDrawing) {
    const { pen, penWidth, penHeight, brush, bkColor, textColor } = surface.driverDrawing;

    state.driverDrawing = { pen, penWidth, penHeight, brush, bkColor, textColor };
  }

  for (const name of KEPT) {
    state[name] = surface[name];
  }

  return state;
}

/** A state `stateOf` took put back, as `RestoreDC` and `SetDCState` put it. */
export function putState(surface: any, state: any) {
  for (const name of KEPT) {
    if (surface[name] !== state[name]) {
      surface[name] = state[name];
    }
  }

  if (surface.data) {
    surface.data.x = state.x;
    surface.data.y = state.y;
  }

  if (surface.driverDrawing && state.driverDrawing) {
    Object.assign(surface.driverDrawing, state.driverDrawing);
  }
}

/**
 * Saves a device context's state, to be put back by `RestoreDC`.
 *
 * **Recorded** by `clipdc`: it answers the new level, 1 for the first, and
 * after `RestoreDC` counts on from the level restored. The text and
 * background colours, the stretch mode and the clip region are put back.
 *
 * Also saved, and not recorded: the background mode, text alignment,
 * character spacing, brush, pen, font, drawing mode, brush origin, mapping and the
 * current position. Not saved: the bitmap.
 *
 * @param {Types.HDC} hdc - The device context.
 *
 * @returns {Types.INT} The level saved, or nought for no device context.
 */
export function SaveDC(hdc) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  surface.saved.push(stateOf(surface));

  return surface.saved.length;
}

/**
 * Puts back the state `SaveDC` saved at a level, and drops that level and
 * those after.
 *
 * **Recorded** by `clipdc`: a negative level counts back from the last, -1
 * the last; nought is taken as level 1. It answers the level restored, or
 * nought for a level there is not, which changes nothing.
 *
 * @param {Types.HDC} hdc - The device context.
 * @param {Types.INT} nSavedDC - The level.
 *
 * @returns {Types.BOOL} The level restored, or nought.
 */
export function RestoreDC(hdc, nSavedDC) {
  const surface = this.handles.resolve(hdc);

  if (!surface) {
    return 0;
  }

  const asked = (nSavedDC << 16) >> 16;
  const count = surface.saved.length;
  const level = asked < 0 ? count + asked + 1 : asked === 0 ? 1 : asked;

  if (level < 1 || level > count) {
    return 0;
  }

  const state = surface.saved[level - 1];

  surface.saved.length = level - 1;
  putState(surface, state);

  return level;
}
