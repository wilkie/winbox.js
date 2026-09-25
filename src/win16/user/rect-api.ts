'use strict';

import { FALSE, TRUE } from '../consts.js';

/**
 * USER's rectangle arithmetic, on `RECT`s as `left`, `top`, `right` and
 * `bottom`, right and bottom exclusive.
 *
 * Measured at its edges by the `rectops` probe:
 *
 * * A rectangle is empty when its right is not past its left or its bottom
 *   not past its top: a flat one, or an inverted one.
 * * Two rectangles that only touch do not intersect; `IntersectRect` then
 *   answers 0 and leaves all zeros.
 * * `UnionRect` takes the other rectangle when one is empty -- the second when
 *   the first is, even if the second is empty too -- and answers whether what
 *   it left is not empty.
 * * `SubtractRect` cuts only a rectangle the other spans the whole width or
 *   height of; one with a hole in its middle is left as it was, and one wholly
 *   covered becomes zeros.
 * * `InflateRect` does not stop at nothing: shrunk past it, a rectangle turns
 *   inside out.
 * * `EqualRect` compares all four sides, so two empty rectangles that differ
 *   are not equal.
 */

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const empty = (rect: Rect) => rect.right <= rect.left || rect.bottom <= rect.top;

function assign(to: Rect, left: number, top: number, right: number, bottom: number) {
  to.left = left;
  to.top = top;
  to.right = right;
  to.bottom = bottom;
}

export function SetRectEmpty(lprc: Rect) {
  assign(lprc, 0, 0, 0, 0);
}

export function IsRectEmpty(lprc: Rect) {
  return empty(lprc) ? TRUE : FALSE;
}

export function OffsetRect(lprc: Rect, dx: number, dy: number) {
  assign(lprc, lprc.left + dx, lprc.top + dy, lprc.right + dx, lprc.bottom + dy);
}

export function InflateRect(lprc: Rect, dx: number, dy: number) {
  assign(lprc, lprc.left - dx, lprc.top - dy, lprc.right + dx, lprc.bottom + dy);
}

export function EqualRect(a: Rect, b: Rect) {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom
    ? TRUE
    : FALSE;
}

export function IntersectRect(lprcDst: Rect, a: Rect, b: Rect) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);

  if (right <= left || bottom <= top) {
    assign(lprcDst, 0, 0, 0, 0);
    return FALSE;
  }

  assign(lprcDst, left, top, right, bottom);
  return TRUE;
}

export function UnionRect(lprcDst: Rect, a: Rect, b: Rect) {
  if (empty(a)) {
    assign(lprcDst, b.left, b.top, b.right, b.bottom);
  } else if (empty(b)) {
    assign(lprcDst, a.left, a.top, a.right, a.bottom);
  } else {
    assign(
      lprcDst,
      Math.min(a.left, b.left),
      Math.min(a.top, b.top),
      Math.max(a.right, b.right),
      Math.max(a.bottom, b.bottom)
    );
  }

  return empty(lprcDst) ? FALSE : TRUE;
}

export function SubtractRect(lprcDst: Rect, a: Rect, b: Rect) {
  const cut: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  const result = { left: a.left, top: a.top, right: a.right, bottom: a.bottom };

  if (IntersectRect(cut, a, b)) {
    if (EqualRect(cut, a)) {
      assign(lprcDst, 0, 0, 0, 0);
      return FALSE;
    }

    if (cut.left === a.left && cut.right === a.right) {
      if (cut.top === a.top) {
        result.top = cut.bottom;
      } else if (cut.bottom === a.bottom) {
        result.bottom = cut.top;
      }
    } else if (cut.top === a.top && cut.bottom === a.bottom) {
      if (cut.left === a.left) {
        result.left = cut.right;
      } else if (cut.right === a.right) {
        result.right = cut.left;
      }
    }
  }

  assign(lprcDst, result.left, result.top, result.right, result.bottom);

  return empty(lprcDst) ? FALSE : TRUE;
}
