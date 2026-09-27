'use strict';

/** A rectangle, the right and bottom edges outside it. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One band of rows, and the runs of columns in it. */
interface Band {
  top: number;
  bottom: number;
  spans: [number, number][];
}

/**
 * A region of pixels as GDI keeps one: bands of rows, each a set of runs of
 * columns, with bands that are alike joined. It has one rectangle, and is
 * `SIMPLEREGION`, only when that is all it is, however it was made.
 *
 * Immutable: every operation makes a new one.
 */
export class ClipRegion {
  readonly bands: Band[];

  private constructor(bands: Band[]) {
    this.bands = bands;
  }

  static readonly EMPTY = new ClipRegion([]);

  /** A rectangle's region; empty unless `left < right` and `top < bottom`. */
  static rect(left: number, top: number, right: number, bottom: number) {
    return left < right && top < bottom
      ? new ClipRegion([{ top, bottom, spans: [[left, right]] }])
      : ClipRegion.EMPTY;
  }

  /**
   * A region of rows of pixels, each `[y, left, right)`: a shape's, as its
   * fill walks it. Runs on a row that meet or overlap are one run.
   */
  static fromSpans(spans: [number, number, number][]) {
    const rows = new Map<number, [number, number][]>();

    for (const [y, left, right] of spans) {
      if (left < right) {
        (rows.get(y) ?? rows.set(y, []).get(y)!).push([left, right]);
      }
    }

    const bands: Band[] = [];

    for (const y of [...rows.keys()].sort((p, q) => p - q)) {
      const runs = rows.get(y)!.sort((p, q) => p[0] - q[0]);
      const merged: [number, number][] = [];

      for (const [left, right] of runs) {
        const last = merged[merged.length - 1];

        if (last && left <= last[1]) {
          last[1] = Math.max(last[1], right);
        } else {
          merged.push([left, right]);
        }
      }

      const previous = bands[bands.length - 1];

      if (
        previous &&
        previous.bottom === y &&
        previous.spans.length === merged.length &&
        previous.spans.every(([l, r], k) => l === merged[k][0] && r === merged[k][1])
      ) {
        previous.bottom = y + 1;
      } else {
        bands.push({ top: y, bottom: y + 1, spans: merged });
      }
    }

    return new ClipRegion(bands);
  }

  /** The pixels of two regions `keep` says to keep, as a region. */
  static combine(
    a: ClipRegion,
    b: ClipRegion,
    keep: (inA: boolean, inB: boolean) => boolean
  ): ClipRegion {
    const rows = new Set<number>();
    const columns = new Set<number>();

    for (const band of [...a.bands, ...b.bands]) {
      rows.add(band.top).add(band.bottom);

      for (const [left, right] of band.spans) {
        columns.add(left).add(right);
      }
    }

    const ys = [...rows].sort((p, q) => p - q);
    const xs = [...columns].sort((p, q) => p - q);
    const bands: Band[] = [];

    for (let i = 0; i + 1 < ys.length; i++) {
      const top = ys[i];
      const spans: [number, number][] = [];

      for (let j = 0; j + 1 < xs.length; j++) {
        if (!keep(a.contains(xs[j], top), b.contains(xs[j], top))) {
          continue;
        }

        const last = spans[spans.length - 1];

        if (last && last[1] === xs[j]) {
          last[1] = xs[j + 1];
        } else {
          spans.push([xs[j], xs[j + 1]]);
        }
      }

      if (!spans.length) {
        continue;
      }

      const previous = bands[bands.length - 1];

      if (
        previous &&
        previous.bottom === top &&
        previous.spans.length === spans.length &&
        previous.spans.every(([l, r], k) => l === spans[k][0] && r === spans[k][1])
      ) {
        previous.bottom = ys[i + 1];
      } else {
        bands.push({ top, bottom: ys[i + 1], spans });
      }
    }

    return new ClipRegion(bands);
  }

  intersect(other: ClipRegion) {
    return ClipRegion.combine(this, other, (a, b) => a && b);
  }

  subtract(other: ClipRegion) {
    return ClipRegion.combine(this, other, (a, b) => a && !b);
  }

  offset(dx: number, dy: number) {
    return new ClipRegion(
      this.bands.map(({ top, bottom, spans }) => ({
        top: top + dy,
        bottom: bottom + dy,
        spans: spans.map(([l, r]) => [l + dx, r + dx] as [number, number]),
      }))
    );
  }

  contains(x: number, y: number) {
    for (const band of this.bands) {
      if (y < band.top) {
        return false;
      }

      if (y < band.bottom) {
        return band.spans.some(([left, right]) => x >= left && x < right);
      }
    }

    return false;
  }

  /** `NULLREGION` (1), `SIMPLEREGION` (2) or `COMPLEXREGION` (3). */
  get kind() {
    if (!this.bands.length) {
      return 1;
    }

    return this.bands.length === 1 && this.bands[0].spans.length === 1 ? 2 : 3;
  }

  /** The smallest rectangle around it; all nought when it is empty. */
  get box(): Box {
    if (!this.bands.length) {
      return { left: 0, top: 0, right: 0, bottom: 0 };
    }

    return {
      left: Math.min(...this.bands.map((band) => band.spans[0][0])),
      top: this.bands[0].top,
      right: Math.max(...this.bands.map((band) => band.spans[band.spans.length - 1][1])),
      bottom: this.bands[this.bands.length - 1].bottom,
    };
  }
}
