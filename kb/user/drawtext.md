---
kind: function
module: USER
name: DrawText
ordinal: 85
summary: Draws text inside a rectangle, broken into lines, aligned, its prefix character underlined and its tabs expanded, or works out the rectangle it needs.
versions:
  '3.1': exact
probes: [drawtext]
topics: [accessories]
---

## Observed behaviour

- [[measured]] [[probe:drawtext]] draws 32 cases on four displays, all in the System font, and every answer, rectangle and pixel matches. The cases cover alignment, line ends, word breaks, the prefix character, tabs, `DT_CALCRECT` and clipping.
- [[measured]] **The answer** is how far below the rectangle's top the last line ends:
  - one line is 16 on the VGA;
  - `DT_SINGLELINE | DT_VCENTER` in a rectangle 50 high answers 33, and `DT_BOTTOM` answers 50;
  - two lines answer 32.
- [[measured]] **Line ends:** CR, LF, CR LF and LF CR each end one line. With `DT_SINGLELINE` they are characters.
- [[measured]] **`DT_WORDBREAK`** breaks only between words. "Unbreakableword" in a rectangle 40 wide stays whole and overflows.
- [[measured]] **The prefix:** `&` is dropped and the next character underlined, one row below the ascent, and `&&` is one `&`. "&File" draws "File" with an 8-pixel line under the F at row 18, when the text's top is at 4.
- [[measured]] **Tabs:** "a\tb" with `DT_EXPANDTABS` puts b's cell 64 pixels along: eight of USER's own System-font average width, which is 8, not `tmAveCharWidth`'s 7.
- [[measured]] **`DT_CALCRECT`** draws nothing. "The quick brown fox", word-broken in a rectangle 80 wide, comes back 66 wide and 32 high. An empty string comes back with no width and one line's height.

## Inside Windows

- [[read out]] **The layout** is USER's own (seg6 `0571`). The text is taken a word, a space or a tab at a time (seg6 `0311`). A line ends before the piece that would take it past the width, or at a line end.
  - Left-aligned, a space that would have gone past is dropped. After a line end, one leading space is dropped too.
  - Lines stop once one would start below the rectangle, unless `DT_NOCLIP` or `DT_CALCRECT` is set.
- [[read out]] **Across,** each line is drawn with `TextOut` from the rectangle's left. A centred line is moved half of what is left over, rounded down; a right-aligned line all of it.
- [[read out]] **The underline** is an opaque `ExtTextOut` of nothing, in the text colour, a pixel high (seg1 `1168`). It is as wide as the character less half the overhang.
- [[read out]] **A tab** goes to the next stop past half an average character on (seg6 `0521`). There is a stop every eight averages, or every count `DT_TABSTOP` gives in the high byte. That count takes the place of the flags there, so `DT_TABSTOP` loses `DT_NOCLIP`, `DT_CALCRECT` and `DT_NOPREFIX`.
- [[read out]] **The average width:** for the System font in `MM_TEXT`, USER uses its own cached figures. That is the one that measures 8.
- [[read out]] **Clipping** is to the rectangle, through `IntersectClipRect`, unless `DT_NOCLIP`.
- [[read out]] **`DT_CALCRECT`** sets the right to the left plus the widest line, and the bottom to the last line's. When a line was wider than the rectangle, it lays the text out again at that width.
- [[read out]] A rectangle with no width, or a count of nought, draws nothing and answers the top, negated. `DT_CALCRECT` then takes the widest line of the last `DrawText` called.

## Implementation

`src/win16/user/DrawText.ts` follows the read-out: the pieces, the lines, the prefix and the tabs, through `TextOut`, `GetTextExtent` and `GetTextMetrics`. The rectangle is logical, as the text is, and what the text is clipped to is the rectangle mapped to the device. Delphi draws each label of a form with the viewport's origin moved to the label and a rectangle at (0,0). Clipped to that rectangle unmapped, every label of Championship Slots' Program Usage box was lost, where Windows' own screen shows them. Not recorded: a mapping that scales, which winbox.js maps as it maps any rectangle.
