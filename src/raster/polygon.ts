'use strict';

/**
 * The rows GDI fills for a polygon, each `[y, left, right]` with `right`
 * outside it: the edge walk `Surface.fillPolygon` describes, read out of
 * `GDI.EXE` and recorded by `polyfill`. The rows come top to bottom, and a row
 * crossed by more than two edges gives a span for each pair.
 */
export function polygonSpans(points: number[][]): [number, number, number][] {
  const edges: any[] = [];
  const spans: [number, number, number][] = [];

  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];

    if (a[1] === b[1]) {
      continue;
    }

    const [upper, lower] = a[1] < b[1] ? [a, b] : [b, a];
    const dx = lower[0] - upper[0];
    const dy = lower[1] - upper[1];
    const yMajor = Math.abs(dx) <= dy;
    const major = yMajor ? dy : Math.abs(dx);
    const minor = yMajor ? Math.abs(dx) : dy;
    const bias = yMajor ? (dx >= 0 ? 1 : 0) : 1;

    edges.push({
      x: upper[0],
      top: upper[1],
      bottom: lower[1],
      step: Math.sign(dx),
      yMajor,
      error: 2 * minor - major + bias,
      up: 2 * minor,
      down: 2 * minor - 2 * major,
    });
  }

  if (!edges.length) {
    return spans;
  }

  const top = Math.min(...edges.map((edge) => edge.top));
  const bottom = Math.max(...edges.map((edge) => edge.bottom));

  for (let y = top; y < bottom; y++) {
    const xs = edges.filter((edge) => y >= edge.top && y < edge.bottom).map((edge) => edge.x);

    xs.sort((one, other) => one - other);

    for (let index = 0; index + 1 < xs.length; index += 2) {
      if (xs[index] < xs[index + 1]) {
        spans.push([y, xs[index], xs[index + 1]]);
      }
    }

    for (const edge of edges) {
      if (y < edge.top || y >= edge.bottom || edge.step === 0) {
        continue;
      }

      if (edge.yMajor) {
        if (edge.error > 0) {
          edge.x += edge.step;
          edge.error += edge.down;
        } else {
          edge.error += edge.up;
        }
      } else {
        edge.error += edge.down;
        edge.x += edge.step;

        while (edge.error <= 0) {
          edge.x += edge.step;
          edge.error += edge.up;
        }
      }
    }
  }

  return spans;
}
