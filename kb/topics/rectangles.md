---
kind: topic
name: Rectangle arithmetic
summary: How USER's rectangle functions treat the edge cases — empty and inverted rectangles, rectangles that only touch, and cuts that leave a hole — as the rectops probe recorded them.
probes: [rectops, minis2]
---

A `RECT` is `left`, `top`, `right` and `bottom`, with the right and bottom edges outside it. USER's functions for combining rectangles look trivial, and where they differ from the obvious arithmetic is at the edges. [[measured]] [[probe:rectops]] calls each function on the cases below and records its answer and the rectangle it leaves. All 19 records agree with winbox.js.

- [[measured]] A rectangle is **empty** when its right edge is not past its left or its bottom is not past its top. [[fn:USER.IsRectEmpty]] says a flat rectangle, `5:5:5:9`, is empty, and so is an inverted one, `9:9:5:5`.
- [[measured]] [[fn:USER.IntersectRect]] of `0:0:10:10` and `5:5:15:15` is `5:5:10:10`, answering 1. Rectangles that only **touch**, `0:0:10:10` and `10:0:20:10`, do not intersect. The answer is then 0 and the result is all zeros, not what was in it before. The same goes for rectangles that are apart, or where one is empty.
- [[measured]] [[fn:USER.UnionRect]] leaves out an empty rectangle. If the first is empty, the result is a copy of the second, even when the second is empty too. So the union of a flat rectangle and an inverted one is the inverted one, answering 0. If only the second is empty, the result is the first. The answer is 1 when the result is not empty.
- [[measured]] [[fn:USER.SubtractRect]] cuts only when the second rectangle covers the whole width or the whole height of the first. `0:0:10:10` less `-5:4:15:20` is `0:0:10:4`. Less a rectangle in its middle, it is still `0:0:10:10`, answering 1; there is no rectangle with a hole. Less one covering all of it, the result is zeros, answering 0.
- [[measured]] [[fn:USER.InflateRect]] does not stop at nothing. `0:0:10:10` inflated by -7 each way is `7:7:3:3`, turned inside out. [[fn:USER.OffsetRect]] is plain addition.
- [[measured]] [[fn:USER.EqualRect]] compares all four sides. Two empty rectangles that differ, `1:1:1:1` and `2:2:2:2`, are not equal.
- [[measured]] [[fn:USER.PtInRect]] counts a point on the left or top edge as inside, and one on the right or bottom edge as outside. [[probe:minis2]] asks about `10:20:30:40`: `(10,20)` is in, `(29,39)` is in, `(30,25)` and `(15,40)` are out, and so are `(9,25)` and `(-5,-5)`. All 7 records agree with winbox.js.
- [[documented]] `PtInRect` takes its `POINT` by value, as a double word with x in the low word and y in the high. winbox.js once read it as a pointer, and Paintbrush faulted when its menus were opened.

## In winbox.js

`src/win16/user/rect-api.ts` has these functions, and `src/win16/user/PtInRect.ts` has `PtInRect`. File Manager needed `IntersectRect` to open its window.
