'use strict';

import { GetBrushOrg } from './CreatePatternBrush.js';
import { GetCurrentPosition } from './MoveTo.js';
import {
  GetViewportExt,
  GetViewportOrg,
  GetWindowExt,
  GetWindowOrg,
  OffsetViewportOrg,
  OffsetWindowOrg,
  ScaleViewportExt,
  ScaleWindowExt,
  SetViewportExt,
  SetViewportOrg,
  SetWindowExt,
  SetWindowOrg,
} from './mapping.js';

/**
 * The Ex forms: each its plain form, the point or size that answers put in
 * a `POINT` or `SIZE` instead, and a `BOOL` answered.
 *
 * **Recorded** by `exfuncs`:
 *
 * * A form that asks answers 1, and puts what its plain form answers --
 *   nought, with no device context.
 * * A form that sets answers 1 and puts the value as it was, or with no
 *   device context answers nought and puts nothing.
 * * With no structure, nothing is put, and the answer is the same.
 */
function put(system: any, lpPoint: number, value: number) {
  if (!lpPoint) {
    return;
  }

  const core = system.machine.cpu.core;
  const segment = (lpPoint >>> 16) & 0xffff;
  const offset = lpPoint & 0xffff;

  core.write16(segment, offset, value & 0xffff);
  core.write16(segment, (offset + 2) & 0xffff, (value >>> 16) & 0xffff);
}

/** A form that asks, from its plain form. */
function asks(plain: (this: any, hdc: number) => number) {
  return function (this: any, hdc: number, lpPoint: number) {
    put(this, lpPoint, plain.call(this, hdc) >>> 0);

    return 1;
  };
}

/** A form that sets, from its plain form. */
function sets(plain: (this: any, hdc: number, ...values: number[]) => number) {
  return function (this: any, hdc: number, ...rest: number[]) {
    const lpPoint = rest.pop()!;

    if (!this.handles.resolve(hdc)) {
      return 0;
    }

    put(this, lpPoint, plain.call(this, hdc, ...rest) >>> 0);

    return 1;
  };
}

export const GetCurrentPositionEx = asks(GetCurrentPosition);
export const GetBrushOrgEx = asks(GetBrushOrg);
export const GetViewportExtEx = asks(GetViewportExt);
export const GetViewportOrgEx = asks(GetViewportOrg);
export const GetWindowExtEx = asks(GetWindowExt);
export const GetWindowOrgEx = asks(GetWindowOrg);
export const OffsetViewportOrgEx = sets(OffsetViewportOrg);
export const OffsetWindowOrgEx = sets(OffsetWindowOrg);
export const SetViewportExtEx = sets(SetViewportExt);
export const SetViewportOrgEx = sets(SetViewportOrg);
export const SetWindowExtEx = sets(SetWindowExt);
export const SetWindowOrgEx = sets(SetWindowOrg);
export const ScaleViewportExtEx = sets(ScaleViewportExt);
export const ScaleWindowExtEx = sets(ScaleWindowExt);
