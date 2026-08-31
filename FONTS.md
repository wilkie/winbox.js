# Windows 3.1 fonts, as measured

This is a specification of what Windows 3.1 does, not of what WinBox.js does.
Everything in it was established by running real Windows under DOSBox, asking
it, and writing down the answer -- the pipeline that does so is described in
[oracle/README.md](oracle/README.md), and the answers live in
`oracle/fixtures/`.

It exists because almost none of this is written down anywhere. The parts that
_are_ documented are mostly the parts that turned out to be wrong or
incomplete, and the parts that decide what a program actually looks like on
screen are the ones no manual mentions.

**How to read a claim.** Every statement here carries its provenance, because
the difference matters:

- **Recorded** -- a fixture holds Windows' own answer for exactly this.
- **Measured** -- established by sweeping a parameter against recorded output
  and taking the peak. Sharp peaks are noted as such.
- **Derived** -- follows from the file format, and confirmed against a fixture.
- **Open** -- known to be wrong or unknown, with what is known about it.

Where a rule was got wrong first and corrected, the wrong version is usually
kept alongside it. A plausible wrong rule is worth more written down than
discarded, because the next person to reason about it will reach for the same
one.

---

## 1. There are three kinds of font

They behave differently enough that almost nothing below applies to all three.

| Kind             | File                     | Sizes                                    | Installed as                                                                          |
| ---------------- | ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Bitmap strike    | `.FON`                   | A fixed set, one per size                | `MS Sans Serif`, `Courier`, `MS Serif`, `Symbol`, `Small Fonts`, and the system fonts |
| Plotter (vector) | `.FON`                   | One design, drawn at any size            | `Roman`, `Modern`, `Script`                                                           |
| TrueType         | `.TTF` via a `.FOT` stub | One outline per style, drawn at any size | `Arial`, `Times New Roman`, `Courier New`, `WingDings`, `Symbol`                      |

The plotter fonts live in the same container as the bitmap strikes and are a
different thing inside it: strokes rather than pixels, one design rather than a
set. **Derived**, and the low bit of `dfType` says which.

---

## 2. Choosing a face

`CreateFont` and `CreateFontIndirect` describe a font; GDI answers with the
nearest thing installed. The order below is the order that matters.

**The character set outranks the name, but only `OEM_CHARSET` disqualifies.**
Asking for `Terminal` in `ANSI_CHARSET` gives MS Sans Serif, because Terminal is
an OEM face and for this purpose that is the same as not being installed.
Asking for `Symbol` in `ANSI_CHARSET` gives Symbol, whose character set does not
match either. **Recorded.** Probing only Terminal produces the rule "the
character sets must match", which is wrong; it takes both cases to see it.

A TrueType symbol face is rejected the same way: `WingDings` asked for in ANSI
comes back as MS Sans Serif. **Recorded.**

**An unknown name and an absent name get different answers.** `Nonesuch` and
`MSSansSerif` -- the right name with its spaces removed -- both land on Times
New Roman. An empty face name lands on MS Sans Serif, by way of the pitch and
family. **Recorded.**

**Names match without regard to case and with every regard to spacing.** `ms
sans serif` finds MS Sans Serif; `MSSansSerif` finds nothing. **Recorded.**

**With no name, the pitch and family decide.** **Recorded**, all five:

| `lfPitchAndFamily`           | Answer        |
| ---------------------------- | ------------- |
| `FIXED_PITCH`                | Courier       |
| `VARIABLE_PITCH`             | MS Sans Serif |
| `VARIABLE_PITCH \| FF_ROMAN` | MS Serif      |
| `VARIABLE_PITCH \| FF_SWISS` | MS Sans Serif |
| `FIXED_PITCH \| FF_MODERN`   | Courier       |

**A strike at exactly the height asked for can beat a TrueType outline, but
only at small sizes.** Sweeping every cell height from one to fourteen shows
where, and the answer is not a threshold:

| height requested | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  | 11  | 12  | 13  | 14  |
| ---------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Arial`          | TT  | TT  | SF  | TT  | SF  | SF  | TT  | SF  | TT  | MSS | MSS | TT  | TT  | TT  |

`TT` is Arial itself, `SF` is Small Fonts, `MSS` is MS Serif. `Times New Roman`
gives the identical pattern; `Courier New` never falls back at any height.
**Recorded.**

The heights that fall back -- 3, 5, 6, 8, 10, 11 -- are exactly the strikes
Small Fonts is installed in, and nothing else. So the mapper prefers a strike
that is _exactly_ the height asked for over scaling an outline to it, which is
why the pattern is scattered rather than a cut-off.

The pitch has to match as well. `Courier New` never falls back at any height,
and no fixed-pitch strike is installed below thirteen pixels for it to fall back
to -- Small Fonts has a 3, 5, 6, 8, 10 and 11 and every one of them is variable
pitch. **Measured**: requiring the pitch to agree is what stops Courier New
answering with Small Fonts, and it costs nothing elsewhere. Terminal's 6 and 8
are excluded separately, by being OEM.

That is not the whole rule. MS Serif is installed at 10, 11, 13, 16, 19, 21, 27
and 35; it wins the tie at 10 and 11, where both it and Small Fonts have a
strike, and loses at 13, where it has one and Small Fonts does not -- Arial wins
that height outright. Several other families have a 13 too, MS Sans Serif among
them, which is the same FF_SWISS family Arial is in and ought to be the strongest
raster candidate there is. So an exact strike stops being preferred somewhere
between 11 and 13, and what changes there is **open**. Courier New never falling
back is consistent with pitch being weighed too: no fixed-pitch strike is
installed below 13.

**A character set outranks the name outright, for two of them.** Asked with
`OEM_CHARSET`, `Arial`, `Courier` and `System` all come back as `Roman` -- a
vector face in a different family from any of them -- reporting `tmCharSet` 255.
Asked with `SYMBOL_CHARSET`, `MS Sans Serif`, `Arial` and `Symbol` all come back
as `Symbol`, reporting `tmCharSet` 2. Asked with `SHIFTJIS_CHARSET` (128) or
`UNICODE_CHARSET` (1), the name wins and `tmCharSet` comes back 0. **Recorded.**
So the two character sets that name a different repertoire of glyphs override
the request, and the ones with no installed face are ignored rather than
honoured.

**A request for italic reaches for a face that has one.** In upright, `Terminal`
in ANSI gives MS Sans Serif, `WingDings` gives MS Sans Serif and an empty name
gives MS Sans Serif. Ask the same three for italic and all three give **Arial**,
with an overhang of zero -- a real italic file, not a synthesised slant.
`Nonesuch` italic gives Times New Roman the same way. **Recorded.** A style the
mapper cannot find is not simply synthesised onto whatever it would have picked
anyway; it changes what gets picked.

**`GetTextFace` echoes the request only when `WIN.INI` redirected it.** A
program asking for `Helv` is told `Helv`, though MS Sans Serif is what gets
drawn, because `[FontSubstitutes]` redirected the name and the redirect
succeeded. A program that asks for `ms sans serif` is told `MS Sans Serif` --
the installed spelling, not its own. A program that asks for `Terminal` in ANSI
is told `MS Sans Serif`. **Recorded.** Substituting is not the same as falling
back, and only substitution preserves the request.

**A TrueType family is four files and they are four different fonts.** All four
name themselves the same thing in the `name` table, and a request for italic
opens the italic one rather than slanting the plain one. The recorded metrics
say so outright: a slanted outline reports an overhang of **zero**, and Arial's
italic is _narrower_ than its regular at twenty-four pixels -- 101 against 106
-- which no amount of shearing produces. **Recorded.** The files are told apart
by `OS/2.fsSelection`. **Derived.**

---

## 3. Bitmap strikes

### Choosing a size

**The largest obtainable size that does not exceed the request**, not the
nearest. Courier is installed at cells of 13, 16 and 20; asked for 24 it answers
20, not the 26 it could make by doubling the 13, though 26 is closer. Asked for
29 it does double the 13, because 26 fits underneath and beats 20. **Recorded.**

**A strike may be drawn a whole number of times over, up to five.** MS Serif
asked for a hundred pixels answers ninety-five -- its nineteen pixel strike five
times -- and not the exact hundred its ten pixel strike would give at ten times.
**Recorded**, and the cap of five is the smallest consistent with every
observation; nothing proves it is not six with another constraint doing the work.

**A height is three different questions depending on its sign.** Positive is the
cell including its leading; negative is the characters within it; zero is the
mapper's own default of twelve points. A request smaller than anything installed
is clamped rather than stretched down. **Recorded.**

### Synthesised styles

**Bold widens every character by one pixel** and `tmOverhang` becomes 1, at
every size and on every face. The string grows by its own length plus one.
**Recorded.**

**A face that is already bold is not emboldened again.** The System font is
drawn bold, so a request for bold has nothing to synthesise: no character
widens, nothing overhangs, and the metrics are the plain ones with a weight of 700. **Recorded.**

**A strike shorter than eleven pixels is not emboldened at all, and the request
is discarded rather than merely having no effect.** `tmWeight` comes back 400,
the overhang 0, and every width the plain face's -- as though nothing had been
asked for.

**Recorded**, and the boundary rests on a single pair. Ask MS Serif for bold at
ten pixels and every metric matches the plain face exactly; ask at eleven and
the average width goes 5 to 6, the overhang to 1 and the weight to 700. Small
Fonts is left alone the same way at three, five, six and eight -- asked for by
name, so this is not a rule about having fallen back from an outline face.
Nothing in the recording sits at nine or twelve, so ten and eleven are the whole
of the evidence for where the line is.

A stroke font is exempt: `Modern`, `Roman` and `Script` all report 700 for a
bold request at eight pixels, where the smear rounds to nothing and no character
widens. The request is honoured and happens to do nothing, which is a different
answer from the request being thrown away.

**Italic leans from the bottom of the cell, not the baseline.** Every row shifts
right by `floor((rows below it) / 2)`, nothing ever moves left, and the top row
moves by `floor((cell - 1) / 2)` -- which is exactly the overhang Windows
reports, at every size on every face. **Recorded** for the overhang, **measured**
for the anchor.

Anchoring at the baseline is the natural guess and is wrong: descenders swing
out to the left and no angle recovers. A sweep over angles cannot tell you it is
sweeping the wrong parameter -- it just keeps asking for a steeper lean.

**Weights collapse to two.** Any request of 700 or more reports exactly 700;
anything less reports what the file says, which is not always 400. **Recorded.**

**`tmItalic` is 1 and `tmUnderlined` and `tmStruckOut` are 255.** A program
comparing all three against 1 is right about one of them. **Recorded.**

**Which of 1 and 255 a synthesised slant reports is decided by the family the
request settled on, not by the strike the slant was drawn onto.** Eight pixel
Arial in italic is Small Fonts with a slant sheared into it, and answers 255.
Small Fonts itself at eight pixels in italic is the same strike with the same
slant, and answers 1. Nothing about what gets drawn separates them; only the
request does. **Recorded**, both ways round, and the same holds for every name
that reaches an outline family by some other route -- `WingDings`, `Terminal`
and an empty name all land on Arial in italic and all answer 255.

---

## 4. Plotter fonts

Reachable only through `OEM_CHARSET`, which also selects `Roman` when a request
names no face. **Recorded.**

**Every vertical measure is the design's, scaled and rounded on its own.** The
height is exactly what was asked for; the ascent, descent and both leadings are
`round(design * height / designHeight)`, each rounded separately -- so the
ascent and descent need not add up to the height. A sixteen pixel Roman reports
thirteen and four. **Recorded** across three faces at nine sizes each, including
Script, whose design is 37 pixels rather than 32.

**A request naming no height gives eighteen pixels**, not the twelve points a
bitmap face gets. **Recorded.**

**`tmPitchAndFamily` gains `TMPF_VECTOR`**, which the file does not carry: Roman
says 17 and the metrics report 19. **Recorded.**

**The widths are settled by a rounding that happens first.** They do not follow
the height, and for a while they appear to follow nothing -- the implied scale
runs from 0.53 to 0.66 of the vertical scale across nine sizes, and not
monotonically. What happens is that GDI picks a whole number for the average
character width before it scales anything:

```
average = floor(dfAvgWidth * height * dfVertRes / (dfPixHeight * dfHorizRes))
width   = round(designWidth * average / dfAvgWidth)
```

The design's own aspect -- three horizontal to two vertical for all three faces
-- is in the first line, and the `floor` around it is what makes the resulting
ratio jump about. A request naming `lfWidth` states the same quantity from the
other end. **Recorded**, thirty-nine of thirty-nine sizes.

**Emboldening thickens the pen with the font.** A strike is drawn again exactly
one pixel across at every size; strokes are drawn again a _scaled_ pixel across,
the offset being the width scale rounded to a whole number. It follows the
width scale, not the height, which is why Roman and Script part company at the
same requested height -- their designs are different sizes. **Recorded**,
forty-eight of forty-eight.

The reported overhang is that offset and so is zero at small sizes, while the
string still reaches one pixel further than a plain one -- because drawing
something again zero pixels across would not embolden it. Both are true at once,
which only shows up if the returned metrics and the measured extent are recorded
side by side. **Recorded.**

**A slant leans one pixel further than a strike does** at the same cell:
`floor(h / 2)` against `floor((h - 1) / 2)`. **Recorded.**

---

## 5. TrueType metrics

**The metrics are in the font, not in the rasteriser.** They are grid-fitted --
for twenty-four of forty-nine recorded sizes, no single scale factor can produce
both the reported ascent and the reported descent by rounding, because the
intervals do not overlap. That looks like it means running the hinting bytecode
to obtain them. It does not: the font carries the answers.

`VDMX` tabulates the hinted extent of the whole face at every pixel size.
`hdmx` tabulates every glyph's hinted advance at a couple of dozen of them. Both
are computed when the font is built, precisely so a system can answer
`GetTextMetrics` without rasterising anything. **Derived**, and confirmed
exactly:

```
ascent   = VDMX(ppem).yMax        descent  = -VDMX(ppem).yMin
height   = ascent + descent       internal = height - ppem
external = round(lineGap * ppem / unitsPerEm)
advance  = hdmx(ppem, glyph)
```

Arial asked for a sixteen pixel cell settles at thirteen pixels per em, where
`VDMX` says 13 and -3: ascent 13, descent 3, height 16, internal 3. Every number
Windows reports, from a table lookup. **Recorded.**

**Below the smallest size the table covers, the extent is computed instead.**
Arial's `VDMX` starts at eight pixels per em, and Windows still answers for
everything below it: a one pixel cell of Arial comes back two pixels tall, a
four pixel cell comes back four, a nine pixel cell comes back seven. Scaling the
`OS/2` ascender and descender and rounding reproduces all of them -- 2 and 0 at
two pixels per em, 3 and 1 at three, 6 and 1 at seven. **Measured**, across
heights one to fourteen for three families.

That is not evidence Windows scales them. It is evidence that at three pixels to
the em the hinting moves nothing far enough to show, which is why the cache
starts where it does.

**Asked for a cell nothing fits in, an outline overflows rather than refusing.**
One pixel of Arial is two pixels tall and is still called Arial; one pixel of
Courier New is three. Something floors the size at two pixels per em. Whether
the floor is on the size or on the cell it produces cannot be separated here,
because at this size the two coincide. **Recorded**, the behaviour; **open**,
which of the two it is.

**`VDMX` is one table per aspect ratio, and reading the wrong one is nearly
right.** Arial Italic carries four: 4:3, 5:3, 2:1, and a catch-all with
`xRatio` zero. A VGA at 96 dots per inch each way has square pixels, so none of
the first three apply and the catch-all is the one Windows reads. **Measured**,
against every recorded size.

This is worth stating because of how it failed rather than because of what it
says. Reading the first group instead of the right one agrees at three sizes in
four, and where it disagrees the error is one pixel of internal leading -- which
reads exactly like a rounding bug, and was filed here as one. What settled it
was checking whether the recorded numbers appeared in the table _at all_: Arial
Italic at ninety-six pixels reports an extent of 76 and 19, which is in no entry
of the first group and is at 85 pixels per em in the fourth. A value that is not
in the table you are reading is not a rounding error.

**The pixel size is the largest whose fitted height does not overflow the cell
asked for. Of a tie, Windows takes the smallest when the cell fits the height
exactly and the largest when it falls short.**

Two sizes often fit the same cell, because the fitting quantises: Arial is
sixteen pixels tall at both thirteen and fourteen pixels per em. Which is taken
changes nothing about the ascent, the descent or the height -- that is what makes
them tied -- and moves the internal leading by one, so it is visible.

**Measured**, across forty-eight ties in three families and all three styles of
each, with no exception:

| Request            | Tie        | Cell | Windows |                |
| ------------------ | ---------- | ---- | ------- | -------------- |
| Arial 16           | 13, 14     | 16   | **13**  | exact, lowest  |
| Arial 48           | 41, 42     | 47   | **42**  | short, highest |
| Arial Italic 100   | 89, 90     | 100  | **89**  | exact, lowest  |
| Times New Roman 30 | 25, 26     | 29   | **26**  | short, highest |
| Courier New 16     | 12, 13, 14 | 16   | **12**  | exact, lowest  |

Stated as a rule that sounds arbitrary; stated as a loop it is the obvious thing
to write. Walk the sizes upward keeping the best fit so far, let a later size of
equal cell replace an earlier one, and stop as soon as something fits exactly --
there is nothing better to find. The scan that stops early keeps the first of the
tie; the scan that runs to the end keeps the last. One loop, both behaviours.

The ppem each row implies is confirmed independently by the widths, which are
scaled from it by a different constant, so this does not rest on the leading
alone.

**A size below the table never ends the search, however exactly it fits.** The
sizes `VDMX` does not cover are computed rather than looked up -- the section
below says how -- and the stop-on-exact rule turns out to be a rule about the
table alone. Courier New asked for an eight pixel cell fits it at seven pixels
per em computed and at eight tabulated, and Windows answers eight; asked for
three it fits at two and at three, both computed, and Windows answers three.
Both take the larger of the tie where every tie inside the table takes the
smaller.

| Request       | Tie                  | Cell | Windows |               |
| ------------- | -------------------- | ---- | ------- | ------------- |
| Courier New 3 | 2, 3 (both below)    | 3    | **3**   | exact, larger |
| Courier New 8 | 7 below, 8 in `VDMX` | 8    | **8**   | exact, larger |

**Measured**, over all sixteen ties the recording contains: the six that take the
first of the tie are tabulated on both sides, the nine that fall short take the
last as the rule already said, and these two are the whole of the exception.

It is worth being clear about why this was hidden. Every earlier tie came from
Arial or Times New Roman, and those two are answered by a strike below twelve
pixels -- so the only face that ever reaches the computed range through a real
request is Courier New, and the only sizes at which it ties there are three and
eight. Two records out of 2,655, and they carry a rule.

**A height of zero asks for a size, not a cell.** It means the mapper's own
default of twelve points, which at ninety-six dots to the inch is sixteen
pixels -- and those sixteen pixels are the em, the way a negative height names
one, rather than the cell around it. All three outline faces answer a height of
zero at exactly sixteen pixels per em and at three different cell heights: Arial
and Courier New at eighteen, Times New Roman at nineteen. **Recorded**, and the
varying cell is what says which of the two is being asked for.

Reading it as a cell of eighteen gets two of the three right by arithmetic,
because eighteen is what sixteen pixels of Arial comes out at. Times New Roman
is the one that tells them apart: nineteen does not fit in eighteen, so a cell
of eighteen takes the size below it and reports a pixel less of everything.

**A requested `lfWidth` gives the glyphs a horizontal pixel size of their own.**
It asks for the average character to come out that wide, and Windows answers by
scaling the outline to a second size rather than by stretching what the height
chose:

```
xPpem = floor(lfWidth * unitsPerEm / OS/2.xAvgCharWidth)
```

Every horizontal metric then follows from `xPpem` and every vertical one from
`ppem`. **Measured**, on all six recorded requests across three families: Arial
asked for eight comes out at eighteen pixels per em and asked for twenty at
forty-five, and both the average and the maximum follow. Rounding instead of
flooring is right for Arial and wrong for Times New Roman, which is the sort of
thing one font on its own cannot settle.

**`tmMaxCharWidth` is the font's bounding box scaled to the size.** Not the
widest advance, and not the grid-fitted widths in `hdmx`:

```
tmMaxCharWidth = round((head.xMax - head.xMin) * ppem / unitsPerEm)
```

**Measured**, against every size the probe asks for across three families and
all three styles of each. Arial at thirty-two pixels per em: 2142 × 32 / 2048 =
33.5, and Windows says 33. At a hundred and forty-three: 149.6, and Windows says 150. Times at a hundred and forty-one: 153, and Windows says 153. Courier New at
eight: 5.25, and Windows says 5.

The box counts ink that hangs outside the advance carrying it, so it is always
the wider number -- and for an italic face it is wider again, because those
glyphs lean out of their cells at both ends. Arial's box is 2142 units against a
widest advance of 2079; Arial Italic's is 2422 against the same 2079. That is
what gives the rule away: measured against the advance, the error on an italic
face _grows with the size_ rather than sitting at a pixel or two, and a gap that
scales is a gap in the multiplicand.

This was previously recorded here as "`hdmx` where the table covers the size,
one pixel wider where it does not". That description fit the sizes it was drawn
from and was wrong about the mechanism: Courier New has no `hdmx` at all and
still follows the box exactly.

**`tmItalic` is 255 for an outline and 1 for a strike.** Both are "non-zero",
which is all the documentation promises, and the two kinds of font disagree
about which non-zero. Every raster and vector face -- MS Sans Serif, Courier, MS
Serif, System, Fixedsys, Roman, Modern, Script, Small Fonts, Symbol -- answers

1. Every request the mapper settles on a TrueType family for answers 255.
   **Recorded.**

It is not about whether the slant was synthesised, which is the obvious guess
and is measurably false. `Small Fonts` asked for by name at eight pixels
synthesises one -- three pixels of overhang, so nothing italic was opened -- and
answers 1. `Arial` at eight pixels lands on that same strike, synthesises the
same three pixels, and answers 255. Same file, same shearing, different byte. So
the flag follows the family the mapper chose and not the strike it drew.

`tmUnderlined` and `tmStruckOut` have no such split: both are 255 whenever set,
on every face. **Recorded.**

---

### Above `LTSH`, the advance is scaled and not hinted

**A glyph's advance comes from three places, asked in this order:**

1. `hdmx`, where it tabulates the size -- two dozen sizes per font.
2. `LTSH`, where the size is at or above the glyph's linear threshold. The
   answer there is the **scaled** advance, `round(units * ppem / unitsPerEm)`.
3. The hinting program.

The middle one is not an optimisation and cannot be skipped: it is a different
number. Arial's `W` at eighty-nine pixels per em hints to 89 and scales to 84,
and Windows reports 84.

`LTSH` is one byte per glyph -- the smallest size at or above which that glyph's
advance is the scaled one, to within a couple of per cent -- and its name is the
whole of its documentation as far as any manual goes. **Recorded.** Twelve
measured strings disagreed, every one of them at a size `hdmx` does not
tabulate, and eleven of the twelve come right on this rule alone. That took
`CreateFont` from 2,643 of 2,655 to **2,654**.

That it went unnoticed for so long is a consequence of `hdmx` being such a good
oracle. Every size `hdmx` covers is a size where rule 1 answers first and rule 2
never runs, so 22,056 agreeing advances say nothing at all about it -- and the
sizes where it does run are exactly the ones with no table to check against.
**A check that cannot fail where the rule applies is not evidence about the
rule.**

Courier New carries neither table, which is why every one of its advances runs
the program. It is also why it is the only face that can be checked against
`hdmx` nowhere and the only one that reaches the interpreter everywhere.

---

### `hdmx` is an oracle for the interpreter

`hdmx` tabulates what each glyph advances by, in whole pixels, at the two dozen
sizes it covers. Those numbers are the output of running the font's own hinting
programs, worked out offline by whoever built the font. So a font file carries,
inside itself, a large and independent check on any interpreter claiming to run
it -- and one that needs no recording, no emulator and no Windows.

Run against it, this interpreter agrees on:

| Font                 | Advances checked | Agreeing         |
| -------------------- | ---------------- | ---------------- |
| Arial                | 3,864            | **3,864 (100%)** |
| Arial Bold           | 3,600            | **3,600 (100%)** |
| Arial Italic         | 3,624            | 3,620            |
| Times New Roman      | 3,816            | 3,815            |
| Times New Roman Bold | 3,648            | **3,648 (100%)** |
| Times New Roman Ital | 3,768            | **3,768 (100%)** |

**22,051 of 22,056**, across all six files that carry the table. Four of the six
reproduce every advance they tabulate, and a fifth is one short.

Every glyph that carries a program, at all twenty-four tabulated sizes. For
comparison, `glyphs.json` holds ninety records in total.

Two things follow. The first is that the interpreter is substantially correct:
the stack machine, the graphics state, the rounding and the control values all
produce the right answer several thousand times running, which is not something
a broken machine does by accident. The second is where the remaining glyph gap
must be -- because if the advances are right and the pixels are not, what is
wrong is not the arithmetic.

### Where the interpreter is wrong, exactly

Run over all six files that carry an `hdmx`, the disagreements come to
forty-six, each pinned to one glyph at one size:

| Font                 | Differing   | Glyphs involved                   |
| -------------------- | ----------- | --------------------------------- |
| Arial                | 0 of 3,720  | --                                |
| Arial Bold           | 3 of 3,600  | `j`                               |
| Arial Italic         | 4 of 3,624  | `M`                               |
| Times New Roman      | 18 of 3,696 | `I`, `k`, `o`, `w`, `y`, `»`, `þ` |
| Times New Roman Bold | 5 of 3,648  | `k`, `m`                          |
| Times New Roman Ital | 16 of 3,768 | `)`, `‰`                          |

**The minimum distance takes its sign from the outline, not from the rounded
distance.** `MDRP` and `MIRP` both carry a flag asking that the distance they
apply never fall below `minimumDistance`, so a feature cannot collapse at small
sizes. The obvious reading -- if the magnitude is under the minimum, push it out
keeping the sign it has -- is right whenever the distance is non-zero and wrong
when the rounding lands on exactly zero. Zero is not negative, so a point
belonging to the _left_ of its reference gets pushed a whole pixel to its
_right_, and the feature is not merely the wrong size, it is inside out:

```
if (opcode & MIN_DISTANCE) {
  if (original >= 0) distance = max(distance, minimumDistance);
  else               distance = min(distance, -minimumDistance);
}
```

Times New Roman's guillemet at eleven pixels per em is what exposed it: a `MIRP`
whose control value rounds to zero moved the origin phantom two pixels, and the
glyph came out two pixels narrow at every size from 11 to 19. **Measured**
against `hdmx`: 46 wrong advances down to 28, and the recorded glyphs from 73 of
90 to 78.

**`DIV` truncates where `MUL` rounds.** They are not the same operation in two
directions. The format has `MUL` round its result to the nearest sixty-fourth
and `DIV` throw the remainder away, and making both round -- the obvious thing
to write -- is wrong by one sixty-fourth wherever a division lands mid-way.

That sounds too small to matter and is not, because a font that divides to get a
proportion and multiplies it back up carries the error into a whole pixel. Arial
Bold's `j` is the case. Its advance is hinted from a control value that `prep`
computes like this, at 32 pixels per em:

```
DIV(82, 220)   ->  23.85, truncated to 23   (we rounded to 24)
MUL(256, 23)   ->  92                       (we had 96)
ROUND(92)      ->  64  = one pixel          (we had 128 = two)
```

One sixty-fourth in the division becomes a whole pixel after the rounding, and
that pixel is a control value the glyph's own program then reads. **Measured**:
28 wrong advances down to **12**, and the recorded glyphs from 78 of 90 to 83.
Arial and Arial Bold now reproduce every advance they tabulate.

### What is left

Five advances still differ, in two glyphs:

| Font            | Glyph | Sizes          |
| --------------- | ----- | -------------- |
| Arial Italic    | `M`   | 32, 67, 75, 92 |
| Times New Roman | `o`   | 75             |

The `M` has been through the same harness. Reading point 10 -- the one its
advance is measured from -- after 121, 216, 328, 344, 359, 366, 380, 394, 412
and 504 bytes of its program brackets the fault in **fifteen bytes**, between
344 and 359:

```
    344  CALL          (agrees to here)
    345  ROFF
    346  MIRP[srp0,grey]
    347  SVTCA[x]
    348  RTG
    349  MDAP[rnd]
    350  CALL
    351  ROFF
    352  MIRP[black]
    353  SVTCA[x]
    354  RTG
    355  MDAP[rnd]
    356  CALL
    357  SRP0
    358  MIRP[srp0,white]  (six more sizes disagree from here)
```

Point 10 is not moved by any of those directly -- every move it gets comes from
inside a called function. But reading the points it is placed _from_ does not
need to go inside `fpgm` at all, because every byte in the bracket is its own
instruction and so its own cut. Reading point 11, then point 5, walks the chain
back:

| Point read | Cut     | Sizes disagreeing |
| ---------- | ------- | ----------------- |
| 5          | 240     | 0 of 60           |
| 5          | 300     | 0 of 60           |
| 5          | 328     | 1 of 60           |
| 5          | **340** | **1 of 60**       |
| 5          | **341** | **43 of 60**      |
| 5          | 344     | 8 of 60           |
| 11         | 347     | 8 of 60           |
| 10         | 353     | 13 of 60          |

**Byte 340 is an `IP`, and it is where the `M` comes apart.** Point 5 agrees at
every size up to it and at forty-three of sixty after it. The eight at cut 344
are not a recovery: the `MDAP[rnd]` at 341 snaps the point to a whole pixel and
hides most of the difference, which is exactly how a fault this size stays
invisible until something downstream reads it back.

**And our `IP` moves nothing there.** Its two reference points have not been
touched, so the original distance and the current one are the same number and
the interpolation is the identity. Windows moves the point anyway. So this is
not a rounding difference in an instruction that ran -- it is an instruction
doing nothing where Windows does something.

Three readings of `IP` have been tried against the harness and all three are
worse or identical:

- **Extrapolating rather than clamping** points outside the reference range, as
  the reference implementation does: identical, at 43 of 60 and 5 wrong
  advances. Point 5 is between the references, so the branch never fires.
- **Projecting differences rather than differencing projections**, which is one
  rounding rather than two: identical again.
- **Measuring the original distances in font units** and letting the ratio carry
  the scaling, which is what the reference does and what would make the
  instruction move something here: **60 of 60**, and `hdmx` from 5 wrong to 49.
  Decisively not it.

#### Asking `IP` directly, and being wrong about the answer

An observation of a real letter says where its program put a point and leaves
the reason to inference. A glyph whose _whole program is the instruction under
test_ says what the instruction does, because everything going into it was
chosen. `experiment()` in `fabricate.mjs` builds those.

The experiment is the `M`'s situation stripped bare: four points at known
coordinates, `rp1` and `rp2` set to the outer two, the second interpolated
between them with neither reference touched.

```
    SVTCA[x]
    PUSHB 0   SRP1
    PUSHB 3   SRP2
    PUSHB 1   IP
    ... report point 1 ...
```

Windows disagreed with this at 54 of 61 sizes, and it was recorded here as `IP`
moving a point that ours leaves alone. **That was wrong, and the control is what
caught it.** Running the same program with the `IP` removed gives byte-identical
disagreement -- so whatever differed was not `IP` at all but the reading itself.

The fault was in the instrument. `setGlyph` wrote a zero-based bounding box and
then placed the points wherever it was told, leaving `xMin` disagreeing with the
outline. `xMin` is what the origin phantom is computed from, so every coordinate
came back shifted by a fraction of a pixel: invisible at whole-pixel resolution,
and plainly visible once magnified eight times. With the box computed from the
points, **all three experiments agree with Windows at 59 of 59 readable sizes.**

So `IP` does in Windows exactly what it does here, in the case the `M` exercises.

Two things are worth keeping from that. The first is the correction itself: a
fabricated font is a program, and a program can be wrong in ways that look
exactly like a discovery. The readings were smooth, monotonic, and reproduced
across two independent experiments -- everything a real measurement looks like --
and the slope decoded to 67 sixty-fourths per pixel per em, which is exactly the
`m`'s left side bearing, which is exactly what a mismatched `xMin` would
contribute. A wrong instrument does not produce noise. It produces a clean
answer to a question nobody asked.

#### The advance phantom is rounded, and `hdmx` is a different rasteriser

Chasing the phantoms answered a question and raised a better one.

The `IP` at byte 340 interpolates between `rp1` = 26 and `rp2` = 25, and the `M`
has twenty-five points, so those are phantom 1 and phantom 0. Reading both
directly: phantom 0 agrees at 59 of 60 sizes at every cut. **Phantom 1 disagrees
at 53 of 60, from cut zero -- before a single instruction has run.**

And Windows' values are whole pixels. Reading phantom 1 with nothing else in the
program at all:

| ppem | scaled advance | ours | Windows          |
| ---- | -------------- | ---- | ---------------- |
| 10   | 533 (8.33 px)  | 533  | **512 = 8 px**   |
| 20   | 1066 (16.66)   | 1066 | **1088 = 17 px** |
| 22   | 1173 (18.33)   | 1173 | **1152 = 18 px** |
| 45   | 2399 (37.48)   | 2399 | **2368 = 37 px** |

`8 × round(scaled advance to whole pixels)` reproduces Windows exactly at every
size the readout is visible at. **The advance phantom is rounded to the grid
before the glyph program runs.** **Recorded**, directly, with no inference in
between.

**It is the advance that is rounded, and the origin added afterwards.** Written
as `round(origin + advance)` rather than `origin + round(advance)` it is the
same thing whenever the origin is a whole number of pixels, which it nearly
always is -- the origin is `xMin - lsb` scaled, and that difference is zero for
most glyphs. Times New Roman Italic's `j` is one where it is not: four design
units, a sixteenth of a pixel at thirty-four pixels per em, and exactly enough
to carry an advance of 9.4531 across the halfway mark and round it to ten.
Windows rounds 9.4531 to nine and adds the sixteenth after.

That one distinction was the last disagreeing record of `CreateFont` and the
only disagreeing record of the 927 the `hinting` sweep now holds. **Recorded**,
and by the bluntest use of the readout there is: the `j`'s program cut back to
nothing, so that what came back was the phantom's starting position with no
instruction having run.

**And implementing it costs 5 wrong `hdmx` advances and gains 321.** Both of
those are true and they are not in conflict, because they are measurements of
two different rasterisers:

- `hdmx` is a table **baked into the font file by whoever built it**. It records
  what the builder's rasteriser produced. Our interpreter reproduces it 22,051
  times out of 22,056, so it matches that rasteriser very closely -- and that
  rasteriser does not round the phantom.
- `GetTextExtent` at a size `hdmx` does not cover is **Windows 3.1 running the
  program itself**, and it does.

This has been the ground under several rounds of work and was not stated. Using
`hdmx` as an oracle for Windows is right about everything that decides where the
ink goes -- the phantoms carry the advance and nothing else, which is why the
recorded glyph bitmaps agree at 83 of 90 while the advance does not -- and wrong
about the advance itself. Times New Roman's `o`, one of the five still failing,
is fixed by the rounding: 17 of 18 tabulated sizes to 18, and 57 of 66 measured
advances to 65.

**The recorded pixels settle it.** They are the one oracle that is not an
advance, and the only one that says where Windows actually put the ink:

|                             | glyphs       | pixels missing | pixels invented |
| --------------------------- | ------------ | -------------- | --------------- |
| phantom left as scaled      | 83 of 90     | 9              | 2               |
| **advance phantom rounded** | **85 of 90** | **8**          | **0**           |

Two more glyphs exact, and the two pixels this drew that Windows does not are
gone. The single-character advances agree at 402 of 412 rather than 391. So the
rounding is what Windows does, and it is implemented.

`hdmx` is kept as a check with the rounding turned off, because it is still
worth reproducing: twenty-two thousand answers to the same instruction set from
an implementation nobody here wrote, and everything it disagrees about now is a
difference in this interpreter rather than in the phantom.

The second thing the real glyph still says. The bisection that pointed at byte
340 used a **real** outline with only its program rewritten, so the bounding box
fault never touched it, and it stands: point 5 agrees at every size before that
`IP` and at seventeen of sixty after. What the trace adds is that the `IP` there
interpolates between `rp1` = 26 and `rp2` = 25 -- and the `M` has twenty-five
points, so those are **phantom 1 and phantom 0**. The instruction is
interpolating a contour point between the two phantoms, and it is the phantoms,
not `IP`, that the two implementations must disagree about. **Open**, and
pointed somewhere new.

### Reading an intermediate value out of a running Windows

Everything else in this document was established from what a program can ask
for. The interpreter's interior is not askable: a glyph program moves several
dozen points and hands back one number, and no API asks it where any of the
others went.

The way in is to make the one number that does come back say something else.
Take the real font, rewrite the end of one glyph's program so that it moves the
advance phantom onto a point of interest and multiplies, and `GetTextExtent` of
that letter now reports that point's position, magnified, at every size in a
single recording. `scripts/oracle/fabricate.mjs` builds them; the recordings
live in `oracle/fixtures/fabricated/` and `test/raster/fabricated_test.ts`
replays them.

**Four things have to be right for a reading to mean anything**, and each was
learned by getting it wrong first:

- **The cut has to be at a statically balanced point.** The readout needs room,
  so the tail of the program comes off -- and the first attempt cut inside a
  conditional, which put the readout in a branch half the sizes never entered.
  Those sizes reported the letter's ordinary width, which looks like a reading
  and is not one.
- **Sizes `hdmx` tabulates say nothing.** The fabrication rewrites a program and
  not a table, so at those sizes Windows answers from the table and never runs
  the readout. That the dead sizes are _exactly_ the tabulated ones is a
  confirmation of the order the two are consulted in, arrived at sideways.
- **Sizes below a twelve pixel cell say nothing**, because the mapper answers
  with a strike rather than with this face.
- **The readout itself overflows.** The coordinate is multiplied by the
  magnification and by sixty-four, and `GetTextExtent` returns a sixteen bit
  word. Past about eight thousand sixty-fourths it wraps, and Windows reports
  the wrap as a negative number.

And there has to be a control. `ariali-m-constant` reports a fixed 16 instead of
a point: every readable size must come back 16, and if the channel were not
working it would come back with the letter's own width instead. Four of the
fifty recordings fail exactly that way -- `cour-one-p17`, `p18`, `p22` and `p27`
are byte-identical to the unfabricated recording at every size, so the font
never reached the rasteriser. They are kept, and the test names them, because a
recording that failed is worth knowing about and the failure is not visible in
the file.

**What it bought.** Arial Italic's `M` had its advance a pixel out at seven of
ninety-nine sizes, and sweeping every arithmetic convention in the interpreter
moved none of them. Reading its interior points bisected the divergence to two
bytes of its program -- point 5 is right after byte 340 and wrong after byte
341 -- and byte 340 is an `IP`. Reading that instruction's inputs said the
instruction was fine and its arguments were not.

That took `hinting` from 611 of 618 to **all 618**, and `glyphs` from 691 to 701. Sixteen recordings of five points at fifty readable sizes each now agree
without exception.

### The pattern worth naming

Five times now a fault has presented as "this instruction is wrong" and turned
out to be "this instruction is fed the wrong number":

| Looked like                                   | Actually was                            |
| --------------------------------------------- | --------------------------------------- |
| `MIAP` rounding the cap height wrongly        | never settled; still open               |
| `MIRP` moving a phantom point it should not   | `MDRP`/`MIRP` minimum-distance sign     |
| One pixel of internal leading, a rounding bug | reading the wrong `VDMX` ratio group    |
| `ROUND` producing 128 where Windows has 64    | `DIV` rounding where it should truncate |
| `IP` interpolating to the wrong place         | `IP` fed coordinates already quantised  |

The last of those is the sharpest case of the pattern there is. `IP`'s own
arithmetic was swept over five rounding conventions and not one of them moved
the answer by a single pixel, because the arithmetic was never wrong -- the two
numbers going into the ratio had been rounded to sixty-fourths before it saw
them.

Each was localised by tracing one instruction and each was solved one or two
levels upstream of it. A wrong answer from a correct instruction looks exactly
like a wrong instruction; the only way to tell them apart is to verify every
input rather than to reason about the operation.

Of the recorded glyphs that still differ, Times New Roman's `W` at sixteen
pixels was wrong in one pixel on one row, in the middle of a thin diagonal --
the outline in the right place and a stroke a fraction of a pixel wide failing
to ink a cell. That was dropout control, and section 6 now measures and
implements it.

Five differ now, by eight pixels between them and none invented:

| Font            | Glyph | Size | Missing                       |
| --------------- | ----- | ---- | ----------------------------- |
| Arial           | `1`   | 24   | 2, on the flag's leading edge |
| Arial Italic    | `A`   | 16   | 1, at the end of the crossbar |
| Times New Roman | `W`   | 16   | 1, in a thin diagonal         |
| Times New Roman | `g`   | 24   | 2, the ear and the bowl's end |
| Courier New     | `1`   | 16   | 2, the whole flag             |

Every one is the end of a thin stroke, which is what a dropout rule is for, and
section 6 records why it is not one. **Open**, and now known to be in the
hinting rather than the rasteriser.

Courier New's `1` is the clearest of them, and its outline says what shape the
problem is. The flag is points 17 to 27, and fitted at thirteen pixels per em it
runs from x 1.45 to x 4.00 at a height of y 7.00 to 7.38 -- a stroke **four
tenths of a pixel tall**, lying wholly between two row centres. Nothing samples
it, which is why nothing is drawn. Windows draws three pixels there, so its flag
is either thicker or sits somewhere else.

**But `GetTextExtent` on a fixed-pitch face returns the face's width and not the
glyph's**, so Courier New cannot host a readout. Four different points of that
`1`, fabricated to report four different coordinates, come back identical at all
eighty-three sizes -- and the value is the face's fixed advance scaled and
rounded, which explains 83 of 83 readings with a number that has nothing to do
with the glyph. **Recorded.** The face looked like the ideal host because it
carries no `hdmx` and so runs the program at every size; the one property that
made it attractive turns out to be beside the point.

Of the four failures in proportional faces, three are at sizes `hdmx` covers,
where `GetTextExtent` stops running the program. Times New Roman's `W` at
fourteen pixels per em is the only one of the five the instrument can reach, and
reading it settles which half of the pipeline is at fault.

**The outline is right.** Five points of the `W`'s two inner diagonals -- 9, 10,
26, 27 and 28, which bracket the missing pixel -- were read out of Windows at
every size. All five agree at every size the readout is visible at, ppem 14
among them; the sizes they differ at are exactly the sizes `hdmx` covers, where
nothing is being read. So Windows puts those points where this does, and still
inks a pixel this does not.

**It is the stub rule.** At the row in question the scanline crosses the outline
at 3.337, 4.275, 7.840, 8.297, 8.448, 9.338, 12.250 and 13.220. The span from
7.840 to 8.297 covers no pixel centre -- it is 0.457 of a pixel wide and falls
between 7.5 and 8.5 -- so it is a dropout, and the half-pixel stub threshold
refuses it by four hundredths of a pixel.

Lowering the threshold rescues it and costs a pixel elsewhere:

| stub    | glyphs   | missing | invented |
| ------- | -------- | ------- | -------- |
| 0.3     | 85 of 90 | 7       | 2        |
| 0.4     | 85       | 7       | 1        |
| 0.45    | 85       | 7       | 1        |
| **0.5** | **85**   | **8**   | **0**    |
| 0.6     | 84       | 10      | 0        |

Eight wrong pixels either way, and the glyph count never moves. **So "excluding
stubs" is not a width test.** No threshold separates the stroke that should be
rescued from the one that should not, which means the real rule distinguishes
them some other way -- by whether the contour turns back on itself within the
scanline, most likely, which is what the specification's word _stub_ actually
describes and what a width happens to correlate with.

**The turn-back rule does not crack it either.** The specification's word is
_stub_, which describes a contour turning back on itself rather than crossing --
so the test ought to be about the shape and not the width. Along a real stroke
the two crossings bounding a span come from opposite sides and are far apart on
the contour; at a tapering tip they are a few vertices either side of the turn.
That is measurable: tag each edge with its position in its contour and ask how
far apart the two are.

| rule                               | glyphs   | missing | invented | wrong |
| ---------------------------------- | -------- | ------- | -------- | ----- |
| narrower than half a pixel         | 85 of 90 | 8       | 0        | **8** |
| turns back within 1 vertex         | 84       | 7       | 2        | **9** |
| narrow **and** turns back within 3 | 85       | 7       | 1        | **8** |
| narrow and turns back within 40    | 85       | 7       | 1        | **8** |

Every variant lands on eight wrong pixels. Widths from 0.3 to 0.6, turn
distances from 0 to 40, and the conjunction of the two: the total never moves,
and all any of them does is trade a pixel Windows inks for one it does not.

**The curves are intersected exactly, not flattened.** A quadratic meets a
scanline at the roots of

```
(y0 - 2y1 + y2) t^2 + 2(y1 - y0) t + (y0 - Y) = 0
```

which is the Bezier written out and set equal to the line. Each root inside the
piece gives an `x` and a direction, and the direction is the sign of the tangent
there rather than of the piece as a whole -- a curve that turns over between its
ends crosses the same line twice in opposite senses.

It was flattened into eight line segments before, and that turned out to be
propping up the score. Sweeping the number of segments:

| segments | 2   | 4   | 6   | 8   | 12  | 16  | 32  | 64  | exact |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | ----- |
| wrong    | 8   | 7   | 7   | 8   | 9   | 9   | 9   | 9   | **9** |

Monotonic in the direction that matters: **as the approximation converges on the
true curve the disagreement settles at nine, and the exact intersection agrees
with a 64-segment and a 256-segment flattening pixel for pixel.** Eight was what
eight segments happened to give -- approximation error cancelling part of a real
difference rather than reducing it.

So this costs a glyph, 85 of 90 down to 84, and is kept anyway. The number it
gives up was never real: two segments scores best of all at 86, and two segments
is a visibly wrong quadratic. What it buys is that the nine pixels left are all
of them genuine, and that the next person to look at them is not measuring
against a curve that is not there.

That is a floor, and a floor means the rule is not the thing. **Whatever these
eight pixels are, no refinement of "which thin spans get rescued" reaches them**
-- the sampling itself must differ, or Windows is inking them for a reason that
is not dropout control at all.

Half a pixel is kept because it is the only value with a reason behind it, and
because among rules that are all equally wrong it errs toward losing ink rather
than inventing it. The conjunction is arguably the better description of what a
stub is and is not kept, because it measures the same and adds a concept. **Open**, and now
known to be a rasterisation rule rather than a hinting one -- which is the
opposite of what the column sweep implied, and was settled by reading the
points rather than by reasoning about the pixels.

**A string is measured with these advances where `hdmx` has no entry for the
size.** Arial's table covers 11, 12, 13, 15, 16, 17, 19, 21, 24, 27, 29, 32, 33,
37, 42, 46, 50, 54, 58, 67, 75, 83, 92 and 100 pixels per em, and nothing else --
Times New Roman asked for a sixteen pixel cell settles at fourteen, which is not
among them. Windows still answers, so it is running the programs. **Derived**,
and worth 30 records when implemented.

---

## 6. Rasterisation

**Non-zero winding, sampled at the exact centre of each pixel.** Established by
sweeping the sample position against recorded glyph bitmaps: sixteen
combinations of where in the pixel to test, then twenty-five more at a hundredth
of a pixel around the best. The centre wins outright, the peak is sharp, and
every other offset is worse in both directions. **Measured.**

Re-measured since, against a signal ten times cleaner -- eight wrong pixels
rather than a hundred -- and the peak is sharper still:

| sample at | 0.40 | 0.45 | **0.50** | 0.55 | 0.60 |
| --------- | ---- | ---- | -------- | ---- | ---- |
| across    | 98   | 47   | **8**    | 43   | 95   |
| down      | 42   | 25   | **8**    | 17   | 35   |

**Which end of a span is closed makes no difference.** All four conventions --
`[from, to)`, `(from, to]`, and both closed or both open -- give the same eight
wrong pixels, and the same on 846 glyphs: 687 against 686. No span boundary in
the recorded glyphs lands exactly on a pixel centre, so the question does not
arise, and the half-open form is kept because it is the one that cannot
double-ink a shared edge.

**Which end of an _edge_ is closed makes a great deal of difference, and it is a
different question.** A span is bounded by two crossings; an edge is one piece of
the outline, and where two pieces share a vertex exactly on the scanline, the
half-open rule decides which of them the crossing belongs to. **It has to be
decided by the coordinate and not by the direction of travel.**

Directing it by travel is the obvious way to write it -- keep the crossing at
parameter zero, give up the one at parameter one -- and it is wrong exactly
where it matters. Take a vertex that is a local maximum lying exactly on the
scanline. The arc arriving reaches the line at its far end and gives the
crossing up; the arc leaving starts at the line and keeps it. **One crossing
where there should be nought**, and the winding is inverted for the whole rest
of the scanline: every pixel from that vertex to the right edge of the glyph
comes out the wrong colour.

Grid-fitting puts vertices exactly on scanlines rather often, because that is
what grid-fitting is for. Arial's `w` at seventeen pixels per em has the peak
between its middle strokes hinted to exactly `5.50, 7.50`, and the sample line
for that row is exactly 7.50; its `N` at eleven has the same thing. Deciding by
coordinate instead -- the piece whose _higher_ end sits on the line gives the
crossing up, the piece whose lower end does keeps it -- makes a local maximum
contribute nothing and a local minimum contribute a cancelling pair, which is
what they should contribute. **Worth four glyphs of 846, and both error terms
fall rather than trading.**

The same rule has to be applied per _monotonic arc_ rather than per piece, since
a quadratic that turns over in the sweep direction has two of them and two
chances to share a vertex.

**The intersection itself is not quantised.** Windows computed these in fixed
point, and a stroke whose edge lands within a sixty-fourth of a pixel centre is
exactly where that would show: Arial's `7` at eighteen pixels per em has its
diagonal cross one row at 5.497, and Windows evidently has it a shade past 5.5,
which is a hundredth of a pixel. Rounding the intersection to sixty-fourths
costs 26 glyphs of 846, flooring 35, ceiling 10. Exact wins outright.
**Measured**, and it says the hundredth of a pixel is in the outline rather than
in the arithmetic that reads it.

There is no sub-pixel bias to correct, which is worth knowing because a
one-pixel disagreement in a glyph looks exactly like a fill rule problem and
usually is not.

**The bitmap strikes render pixel-identically.** Every character of the System,
ANSI variable and ANSI fixed fonts, and of MS Sans Serif and Courier asked for
by name. **Recorded.** This is the control that says the comparison is sound
rather than accidentally lenient, and it had to be established before any
outline number meant anything.

### Dropout control

A stroke thinner than the gap between two pixel centres can pass between them
and leave nothing behind. The letter then comes apart -- the crossbar of an `A`
loses its end, a thin diagonal breaks in half -- and the scan converter turns on
one pixel anyway to prevent it.

**The fonts ask for this outright, and each asks for something different.**
Read out of `prep` by an interpreter that records the instruction instead of
discarding it:

| Font            | `SCANCTRL` | Means                            | `SCANTYPE` |
| --------------- | ---------- | -------------------------------- | ---------- |
| Arial           | `0x111`    | on at 17 pixels per em and below | 1          |
| Times New Roman | `0x17c`    | on at 124 and below              | 1          |
| Courier New     | `0x12c`    | on at 44 and below               | 1          |

**Recorded.** The low byte is the size, bit 8 says "switch on at or below it".
Type 1 is simple dropout control **excluding stubs**.

**The stub rule is the whole of the difficulty.** Implemented without it,
dropout control fixes six of the fourteen pixels Windows inks and we did not,
and invents four Windows does not ink -- a wash, and a worse kind of wrong,
since inventing ink is more visible than losing it. The four are all at
_tapering tips_: the point of a `1`'s flag, the top of a `W`'s diagonal. Those
are the stubs, and they are what type 1 excludes.

Refusing spans narrower than **half a pixel** separates them. **Measured**, but
honestly: the peak is broad, and 0.3 through 0.5 all agree on the same 79 of 90
recorded glyphs. The recording pins the rule and not the number; half a pixel is
chosen because it is the sampling interval and so the only value with a reason
behind it rather than a fit. Below 0.3 the stubs return; above 0.5 real dropouts
start being refused.

**Columns are swept as well as rows, and both keep the same pixel -- once the
rule is stated about pixel centres rather than about pixels.** A stroke can be too shallow to cover a row centre as easily as too
narrow to cover a column one, and a sweep along rows provably cannot see the
first kind -- every scanline either crosses such a stroke properly or misses it
whole. The flag of a Courier New `1` at thirteen pixels per em is exactly that:
two pixels Windows draws that nothing along a row can find.

This was tried twice before and rejected twice, both times on the evidence. It
rescued nothing because it was inking the wrong pixel, and it was inking the
wrong pixel because the row sweep's rule had been copied across without being
examined. Sweeping the choice:

| column sweep keeps           | glyphs   | missing | invented |
| ---------------------------- | -------- | ------- | -------- |
| the pixel the span starts in | 84 of 90 | 9       | 2        |
| **the pixel it ends in**     | **85**   | **7**   | **0**    |
| the nearest pixel            | 85       | 8       | 1        |

Taking the far end sounds arbitrary until the axes are put back the way the
glyph has them. Device rows count downward and glyph coordinates count up, so
the last row of a span is the first in the outline.

That was the rule for a while, fitted on ninety glyphs, and it needed two
sentences to say. On 846 it is one sentence and a better fit: **the pixel turned
on is the last one whose _centre_ lies at or below the span's upper end, in the
outline's own coordinates.** In device coordinates that reads `floor(to - 0.5)`
along a row and `ceil(from - 0.5)` down a column -- the same sentence along
opposite axes -- and it scores **681 glyphs exact against 674**, with 437 wrong
pixels against 462.

Two things make it worth more than the seven glyphs. Writing the column rule the
other way round, as the mirror of the row rule rather than as the pixel the span
ends in, changes not one record of the 846 -- so the symmetry is real and not a
coincidence of this fixture. And it is the rule the format's own scan converter
is described as using, which is agreement with something outside the recording.

The half-pixel stub is the same on both. No second constant.

The exact curve intersection is what made this findable at all. On the flattened
outline the same experiment moved nothing, because the spans it needed to see
were smaller than the flattening error.

### Both rules re-measured on nine times the evidence

Everything above was fitted against ninety recorded glyphs. The fixture now
holds 846, and the size that turns dropout control from one contributor into the
whole story -- Courier New at eight pixels per em, where the font asks for no
grid-fitting and every stroke is a third of a pixel wide -- was not in the
narrow one at all.

**One survives and one improves.** The stub threshold's peak is still broad and
still has no corner in it -- swept once on the wider fixture and again after the
crossing rule was corrected, with the same shape both times. The pixel choice
turned out to be stateable as a single rule about pixel centres rather than two
about pixels, which section 6 gives. The sweep below is the second one.

| threshold | glyphs exact | missing | invented | wrong   |
| --------- | ------------ | ------- | -------- | ------- |
| 0.2       | 662          | 89      | 319      | 408     |
| 0.325     | 692          | 109     | 250      | **359** |
| 0.4       | 699          | 248     | 136      | 384     |
| 0.45      | **700**      | 277     | 122      | 399     |
| **0.5**   | 691          | 312     | 106      | 418     |
| 0.7       | 661          | 393     | 80       | 473     |

A smooth trade of invented pixels for missing ones, with the most glyphs exact
and the fewest wrong pixels in different places. That is what a number standing
in for a rule looks like, and half a pixel is kept because it is the sampling
interval -- the values either side of it are a fit to 846 records and nothing
more.

**The rule it stands in for is about shape, and two ways of implementing it do
not help.** A stub is where the outline turns back, so the real question is
whether the two edges bounding an empty span are two sides of one tip or two
sides of a stroke.

_By topology._ The pieces of each contour grouped into runs that never turn back
-- so a tip four curve segments wide is still one turn -- linked around the
contour, and a span refused when its two runs meet each other at this very
scanline. **661 glyphs exact against 674.** Requiring both tests, or either, is
no better than the threshold alone.

_By direction._ The two bounding edges' tangents point opposite ways through a
stroke and converge at a tip, so their normalised dot product is near -1 for one
and above it for the other. This one is clearly measuring something real: at its
best it takes the missing pixels from 316 to **99**, which says it does find the
strokes Windows rescues and the threshold does not. It invents as many as it
saves -- 121 to 262 -- and the glyph agreement is **679 against 681**.

Both **measured**, and recorded so the next attempt starts further along. What
neither has is the other half of the rule: the test that stops a rescue Windows
does not make. The direction test says the first half is findable.

### Asking with shapes instead of letters

Every attempt at the stub rule above is an inference from letters, and a letter
is the wrong instrument: each scanline crosses several strokes of different
widths at different angles next to tips of their own, and no sweep can separate
them. A shape chosen for the purpose can.

`setGlyph` replaces a glyph with points of our choosing, and the glyph probe
draws thirty-six characters of one face at seven cells. So **thirty-six
rectangles of known width at known offset, with no program at all** -- nothing
grid-fitted, one contour, no tips anywhere, every span a genuine stroke -- is one
recording and 258 records. Half stand upright, for the sweep along rows; half lie
on their side, for the sweep down columns.

**A rewritten outline needs its bearing rewritten too.** The first recording
came back with all six offsets at the same place, because Windows draws a glyph
at `pen + lsb + (x - xMin)` and `hmtx` still held the letter's old bearing. The
box and the bearing are two statements of the same thing; real fonts always
agree, so nothing had ever noticed. `setBearing` writes the second one.

**Three things fall straight out of the recording.**

**There is no threshold.** Windows rescues a span 0.16 of a pixel wide exactly as
often as one 0.78 wide -- 47 per cent either way, at every size.

**There is no column sweep.** The 47 per cent is not a proportion of widths at
all; it is the proportion of the bars that stand upright. **390 of 390 spans
along rows are rescued, and 0 of 424 down columns.** A bar 0.156 of a pixel wide
standing up is drawn as a full column of pixels; bars of 0.156, 0.234 and 0.313
lying down are drawn as nothing whatever. Delete our column sweep and all 126
records of the bars on their side agree exactly.

**And the pixel is the next centre, not the previous one.** For a span from
4.637 to 4.813 Windows inks the pixel whose centre is 5.5, not the one whose
centre is 4.5. With those three together -- no column sweep, no threshold, the
next centre at or above the span's start -- **the bar font is reproduced exactly:
258 records, not one pixel wrong.**

### What the wedges say, and what is still open

A rectangle has no tips, so the bars cannot say when Windows _refuses_. Thirty-six
triangles can: a wedge is nothing but a tip, and its apex is the local extremum
every description of the stub rule is describing.

Reading them gives the sharpest statement of the stub rule there is:

| Empty spans in                  | Inked by Windows |
| ------------------------------- | ---------------- |
| the topmost row of a wedge      | **1 of 177**     |
| every row of a wedge below that | **121 of 121**   |
| the topmost row of a bar        | **50 of 50**     |
| every row of a bar below that   | **340 of 340**   |

**A tip's own row is refused and everything else is rescued** -- and width has
nothing to do with either side of it. A tip is refused at three quarters of a
pixel wide; a stroke is rescued at nothing at all.

The bar's topmost row is what stops "the row nearest a turn" from being the
whole rule, and it is worth the sentence. A bar has a turn at the top too, so
that alone would refuse it -- and Windows rescues all fifty. What separates them
is that a bar's two sides are joined by a _top edge_ and run straight past each
other, where a wedge's meet at a _point_. So the test is a turn within a row
**and** the two edges converging rather than running opposite ways, which is
what the direction test was reaching for and could not resolve on letters.

**That rule reproduces the bar font exactly** -- 258 records, not one pixel
wrong, at any convergence threshold. What it does not reproduce is which pixel a
rescued span takes when the edges bounding it are _slanted_, and that is now the
whole of what is open.

**For a bar the pixel is the first centre at or above the span's start**, and
nothing else is close: 390 of 390 rows, topmost included. A bar's edges are
vertical, so its span is the same wherever in the row it is measured and the
rule cannot be told apart from any other reading of it.

**For a wedge nothing in that family works.** The span at the scanline gives 15
of 122; the span at the bottom of the row gives 46; the widest span anywhere in
the row gives 46; the last centre at or below the span's end gives 90 -- and
that one gives 5 of 390 on the bars, so it is no unification either. Row by row
Windows lands sometimes on the pixel below the span's start and sometimes on the
one above, and the two cases differ by hundredths of a pixel.

**Measured**, and the negative is the useful part: _the pixel a slanted span
rescues is not a function of that span_. Four ways of getting at it have now
been tried and none separates the two fonts.

**The edge walk.** A scan converter of the period does not solve each scanline;
it splits the outline into runs that only go one way in y and carries each run's
x down the rows with a Bresenham accumulator, so the sixty-fourths it lands on
are not the ones an exact solve gives. That was built and measured, and it gives
the same split: bars 390 of 390 on the first centre at or above the start,
wedges 115 of 128 on the last centre at or below the end. **The accumulator is
not what Windows is rounding.**

**The winding.** The first wedge font was wound counterclockwise, which TrueType
does not allow of an outer contour -- and nothing complains, because a non-zero
fill draws a reversed contour solid and every rescue decision still looks
sensible. Rebuilt clockwise and re-recorded, it gives numbers identical to the
last digit. **Windows does not branch on it**, and the hazard is worth naming:
a fabricated font can be malformed in a way that changes nothing visible and
everything about what you conclude.

**A fill in disguise.** If Windows' span were a few sixty-fourths wider than
ours these would be ordinary fills and there would be no pick to explain.
Allowing up to four sixty-fourths at each end accounts for 28 of 122 wedge rows
and 75 of 390 bar rows, so they are rescues.

**And no expression can do it.** For the bar span 5.809 to 6.063 Windows inks 6,
and for the wedge span 3.547 to 4.359 it inks 3. No `ceil` or `floor` of any
weighted average of the two endpoints yields both: the bar needs the answer
above its whole span and the wedge needs it below the middle of its own.

So the deciding information is somewhere other than the span, and the candidate
left standing was state carried between scanlines -- a rescue placed to continue
the pixel the row above turned on. The wedges cannot test that, each having only
one rescued row. A slanted bar has a column of them, so two more fonts were
built: thirty-six leaning right and thirty-six leaning left, each a
parallelogram whose horizontal cut is the same width at every row and walks
sideways by a fixed amount.

**They say the split is not about carried state and not about which way the
stroke leans. It is about whether the edges are vertical at all**, and it is
absolute:

| Slant                | pixel to the right | pixel to the left |
| -------------------- | ------------------ | ----------------- |
| upright              | **105 of 105**     | 0 of 105          |
| any lean, either way | 30 of 726          | **704 of 726**    |

Under the rescue rule the shapes settled -- no column sweep, no threshold --
that is the whole of the disagreement, and it is large:

| Font               | next centre    | last centre |
| ------------------ | -------------- | ----------- |
| bars (upright)     | **258 of 258** | 209         |
| bars leaning right | 99             | **190**     |
| bars leaning left  | 95             | **180**     |
| wedges             | 79             | 79          |

A stroke standing exactly upright takes the pixel to the right of the gap; a
stroke leaning by any amount at all, in either direction, takes the one to the
left. Nothing in between was found, because the fonts contain nothing in
between -- the smallest lean tried is a fifth of a pixel per row.

**It is not a test for an upright stroke.** That was the obvious reading -- a
rasteriser has every reason to give a vertical edge its own path, since a stem
is the commonest thing in a font and needs no walk at all, and a separate path
is an easy place for a rounding to differ. It predicts something sharp: a stroke
leaning by any amount at all, however small, goes with the slanted ones.

A third font settles it. Thirty-six bars leaning by two, five, twelve, thirty
and eighty design units over fourteen hundred -- from a five-hundredth of a
pixel per row upward:

| Lean, in pixels per row | rows | pixel to the right | pixel to the left |
| ----------------------- | ---- | ------------------ | ----------------- |
| 0 (upright)             | 162  | **162**            | 5                 |
| 0.0014                  | 156  | **156**            | 0                 |
| 0.0036                  | 138  | **138**            | 0                 |
| 0.0086                  | 149  | 125                | 24                |
| 0.021                   | 134  | 106                | 28                |
| 0.057                   | 106  | 62                 | 44                |
| 0.14                    | 132  | 14                 | **118**           |
| 0.5                     | 114  | 1                  | **114**           |

**A stroke leaning by a five-hundredth of a pixel per row behaves exactly like
an upright one, and the change is gradual.** A test on the edge cannot produce
that; a `dx == 0` branch would put the 0.0014 column with the leaning ones and
there would be no ramp. So there is one path, and what varies is not whether the
edge is vertical but something that accumulates as it leans -- and the
raggedness in the middle, where the same slant takes one pixel on some rows and
the other on others, says the answer depends on where in the pixel each row
falls as well as on the slope. That is the signature of a fixed-point quantity
carried down the scanlines.

### The branch, as measured

The recordings are enough to map the branch itself rather than guess at it. Take
`u` to be how far the span's start sits past the pixel centre below it, so the
two candidates are the pixel that centre belongs to and the one above; the
question is which of them Windows inks. Over 2,452 rows where it inked exactly
one:

| Lean, px/row | rows | took the left pixel | best threshold on `u` |
| ------------ | ---- | ------------------- | --------------------- |
| 0 (upright)  | 370  | 0                   | never                 |
| 0.0014       | 156  | 0                   | `u < 0.137` (100%)    |
| 0.0036       | 138  | 0                   | `u < 0.139` (100%)    |
| 0.0086       | 149  | 24                  | `u < 0.141` (100%)    |
| 0.021        | 134  | 28                  | `u < 0.147` (93%)     |
| 0.057        | 106  | 44                  | `u < 0.165` (91%)     |
| 0.14         | 245  | 194                 | `u < 0.611` (85%)     |
| 0.29         | 239  | 232                 | `u < 0.774` (97%)     |
| 0.50         | 286  | 280                 | `u < 0.721` (96%)     |
| 1.00         | 359  | 353                 | `u < 0.641` (94%)     |

**The `0.14` in that table is not a threshold, and saying so was a mistake worth
keeping.** At the two smallest leans there are no left answers at all, so every
threshold below the smallest `u` present scores 100% and the search returns the
smallest value it was given. The number is the sampling floor of the fonts -- no
row in them happens to start closer than 0.137 of a pixel past a centre -- and
not an edge in the data. Reading a hundred per cent as agreement when one of the
two classes is empty is the same error as reading `hdmx` agreement as evidence
about `LTSH`, and this work has now made it twice.

What the table does say, once that is stripped out:

- **Upright is always the right pixel**, over 370 rows with `u` ranging from
  0.111 to 0.844. That much is real, and it is not a threshold on `u` at all.
- **One lean has a genuine gap.** At 0.0086 pixels per row, 24 of 149 rows take
  the left pixel, every one of them with `u` below 0.061, against every right
  answer above 0.141. A threshold between those two numbers separates them
  exactly, and it is the only clean separation in the set.
- **Every larger lean overlaps.** The same `u` gives both answers, so `u` alone
  does not decide it there, and rows that disagree at the same `u` differ in
  width -- so at least three quantities are in play.

`u / |lean| < 4.3` is the best single expression over all of it at **95.1%**,
and it puts the upright case on the right side for free, since a vertical edge
never passes a centre and the ratio is infinite. But the per-lean thresholds are
not constant, so it is a fit and not the mechanism.

### Filling the hole, and what it rules out

The fonts above vary the width across their thirty-six glyphs and keep the
starting offset fixed, so `u` is very nearly a function of the size alone and
each font samples about seven values of it. That is what left the smallest leans
with no left answers to separate. A font that varies the _offset_ instead --
six leans against six starting positions a sixth of a pixel apart, one fixed
width -- sweeps `u` across its whole range at every lean.

**With the hole filled, `u` does not decide the branch at any lean.**

| Lean, px/row | rows | left | `u` present  | separable by `u`? |
| ------------ | ---- | ---- | ------------ | ----------------- |
| 0.0014       | 146  | 0    | 0.012..0.682 | no left answers   |
| 0.0036       | 135  | 0    | 0.014..0.685 | no left answers   |
| 0.0086       | 149  | 10   | 0.001..0.557 | overlaps          |
| 0.015        | 142  | 22   | 0.001..0.593 | overlaps          |
| 0.021        | 150  | 38   | 0.006..0.628 | overlaps          |
| 0.032        | 135  | 51   | 0.001..0.656 | overlaps          |

A stroke leaning by a seven-hundredth of a pixel per row takes the right pixel
even when its span starts a hundredth of a pixel past a centre. And the one
clean separation the earlier fonts showed, at a lean of 0.0086, **overlaps once
the missing rows are recorded** -- it was sparse sampling as well. So the whole
family of thresholds on `u` is out, and with it the 95% fit, which still scores
95% here and is therefore describing something that correlates with the answer
rather than deciding it.

**What the new font shows instead is that the size matters.** With the width
held fixed in design units, left answers are absent at the two smallest cells at
every lean, and universal at the largest:

| Lean   | cell 10 | 12   | 14   | 16   | 18    | 20    | 24        |
| ------ | ------- | ---- | ---- | ---- | ----- | ----- | --------- |
| 0.0086 | 0/20    | 0/24 | 2/18 | 0/36 | 0/22  | 0/21  | **8/8**   |
| 0.015  | 0/20    | 0/24 | 4/20 | 0/24 | 0/22  | 4/18  | **14/14** |
| 0.021  | 0/20    | 0/23 | 6/20 | 1/31 | 6/22  | 9/18  | **16/16** |
| 0.032  | 0/19    | 2/23 | 9/21 | 3/19 | 10/20 | 14/20 | **13/13** |

The lean is a ratio and does not change with the size, so something absolute
does: the stroke is a third of a pixel wide and five rows tall at the smallest
cell and four fifths of a pixel wide and fourteen rows tall at the largest, and
that font cannot separate the two because both grow together.

### Which turns out to be a property of the stroke, not of the row

A sixth font varies them against each other -- six design widths against six
heights at one lean, so that the same width appears at several heights -- and
the first thing it says is not about either of them.

**Every row of a stroke takes the same side.** Of 414 strokes with two or more
rescued rows across four fonts, **402 are uniform**. Whatever decides the pixel
is decided once for the stroke, which is why nothing measured per row has ever
separated it: `u` varies down a leaning stroke and the answer does not.

That also disposes of the accumulator. Within strokes ten rows and longer the
left answers are spread evenly from the first row to the last -- 25%, 50%, 50%,
50% and so on down -- where anything carried from row to row would drift.

**What does decide it is how far the stroke moves sideways over its whole
height.** Of the stroke-level quantities, that one separates 90.7% of 398
leaning strokes; the width in pixels manages 59% and the height in rows 56.5%.
It is the lean multiplied by the height, which is just the slant expressed in
pixels:

| Total sideways shift | strokes | took the left pixel |
| -------------------- | ------- | ------------------- |
| under 1/8 pixel      | 123     | 2%                  |
| 1/8 to 1/4           | 64      | 27%                 |
| 1/4 to 3/8           | 30      | 57%                 |
| 3/8 to 1/2           | 9       | 100%                |
| over 1/2             | 172     | 99%                 |

A stroke that leans by less than an eighth of a pixel over its entire length is
drawn as though it were upright; one that leans by more than three eighths never
is.

### What the ramp is

It is a ramp and not a step, and the reason turns out to be that the shift is
not what is being tested -- it only predicts what is.

Inside the transition band, one thing separates the two answers almost
completely: **the phase at the stroke's first rescued row.** Of the 110 strokes
whose shift falls between a tenth and a half of a pixel, those starting less
than a quarter of a pixel past a centre go left 44 times in 49, and those
starting further past it go left **0 times in 61**.

Put with the shift, that has a plain reading. Going down a leaning stroke the
span's start moves steadily towards the centre below it, and it reaches it after
`firstU / lean` rows. The stroke is `shift / lean` rows long. So `firstU <
shift` is exactly **"the edge passes a pixel centre somewhere within the
stroke's own length"** -- and a stroke that passes one takes the left pixel.

That explains the ramp rather than replacing it. A stroke that shifts by a
quarter of a pixel crosses a centre for about a quarter of the phases it might
have; one that shifts by more than a pixel crosses for all of them. **The ramp
is the marginal distribution over phase of a condition that is itself a step**,
and the observed left fractions rise over the same range as the crossing chance
does:

| Shift | strokes | left, observed | crossing chance |
| ----- | ------- | -------------- | --------------- |
| 0     | 311     | 13%            | 4%              |
| 1/8   | 72      | 24%            | 16%             |
| 1/4   | 30      | 60%            | 29%             |
| 3/8   | 11      | 73%            | 43%             |
| 5/8   | 9       | 89%            | 71%             |
| 1     | 20      | 85%            | 100%            |
| 2+    | 100+    | ~100%          | 100%            |

**The coefficient was the instrument, not the rule.** Measuring where the stroke
begins and ends from the rows Windows made a decision on leaves out every row it
filled, so both the starting phase and the distance travelled are taken over the
wrong interval -- and the predicate then needs a coefficient to make up for it,
1.46 over six fonts and 0.8 over the three it was first fitted to. Measured over
the rows the outline actually spans, filled ones included, **the coefficient
goes away**:

| Extent measured over           | best coefficient | agreement |
| ------------------------------ | ---------------- | --------- |
| rows Windows decided           | 1.46             | 95.5%     |
| rows with an empty span        | 1.40             | 96.2%     |
| **every row the stroke spans** | **0.97**         | **96.8%** |

So the rule is `firstU < shift` with nothing in front of it: **a stroke whose
edge passes a pixel centre somewhere within its own length takes the left pixel,
and one whose edge never reaches a centre takes the right.** It reduces to the
upright case for free -- a vertical edge travels no distance and reaches nothing.

**And it is exact, except in a mirror.** Of the six shape fonts it accounts for
every stroke in five of them:

| Font                   | strokes | agreement |
| ---------------------- | ------- | --------- |
| bars (upright)         | 50      | **100%**  |
| offsets                | 132     | **100%**  |
| hairslants             | 118     | **100%**  |
| shapes                 | 62      | **100%**  |
| slants (leaning right) | 164     | 99.4%     |
| **backslants (left)**  | **161** | **87%**   |

Twenty-one of the twenty-two exceptions are strokes leaning left.

Measuring the distance in the direction the edge actually travels -- to the
centre above when it is moving right, the one below when moving left -- is the
obvious repair, and it is a real improvement: **97.5% over all 687 strokes**,
and it is the best form found. It takes the left-leaning font from 87% to 90%
and stops there.

Everything else that can be varied about the statement has been, and none of it
touches the remaining sixteen:

| Variant                                        | all       | leaning right | leaning left |
| ---------------------------------------------- | --------- | ------------- | ------------ |
| the span's left edge, toward the centre below  | 96.8%     | 99%           | 87%          |
| **the left edge, in the direction it travels** | **97.5%** | **99%**       | **90%**      |
| the span's right edge instead                  | 83.1%     | --            | 87%          |
| either edge                                    | 89.7%     | --            | 87%          |
| measured from the bottom of the stroke         | 97.5%     | 99%           | 90%          |
| either end                                     | 89.8%     | 99%           | 87%          |

Measuring from the bottom gives exactly the same answer as from the top, which
it must -- the travel is the same either way -- so the rule does not care which
end the rasteriser starts at. The right edge is worse than the left everywhere,
so it is the left edge that is being tested.

### Three more fonts, and the asymmetry survives them

Comparing the two slant fonts is arguable, because they differ in more than
their direction. So: **matched pairs.** The same width, height, lean magnitude
and starting offset in both directions, so every stroke has a twin differing in
nothing else.

**At large travel the direction makes no difference at all** -- 83 of 85 pairs
agree. But every stroke in that font travels two pixels or more, which is where
the rule was never in doubt, so it tested the question in the one place it was
not being asked. Two further fonts fix that: one filling the half-to-two band
with left-leaning strokes, and the matched pairs rebuilt inside the band.

**Inside the band the pairs differ 15 times in 124** -- and in every one of the
fifteen, the left-leaning twin is the one that has further to travel before its
edge meets a centre. That is a flaw in the mirror as a control: reflecting a
stroke moves its head to the other corner, so the pairs vary the direction and
the starting phase together, exactly the confound the font was built to avoid.

Splitting on that distance instead controls for it, and the asymmetry is still
there:

| Distance to a centre | leaning right | leaning left | upright |
| -------------------- | ------------- | ------------ | ------- |
| under half a pixel   | 98%           | 98%          | 100%    |
| over half a pixel    | **98%**       | **81%**      | 100%    |

So it is not the phase, and it is not the direction on its own either -- both
directions agree when the edge has little way to go. **The rule is exact except
for strokes leaning left whose edge must travel more than half a pixel to reach
a centre**, and there it is wrong one time in five.

Fitting the reach separately for each direction -- `toGo x c < shift` with `c`
free -- gives 0.84 leaning right at 99.5% and 1.24 leaning left at 93.1%, which
is 96.8% together against 95.8% for a single constant. Two constants buy one
point, so that is not the shape of it either.

### The distance on its own

A ninth font puts that distance on the axis instead of leaving it a side effect:
one lean, one width, one height, and eighteen starting positions a fourteenth of
a pixel apart, in each direction. Nothing else moves.

**Leaning right, the rule holds at every distance.** Leaning left it holds up to
four tenths of a pixel and then falls away:

| Distance to a centre | leaning right | leaning left |
| -------------------- | ------------- | ------------ |
| 0.0 -- 0.4           | 73 -- 100%    | **100%**     |
| 0.5                  | 100%          | 77%          |
| 0.6                  | 91%           | 62%          |
| 0.7                  | 100%          | 45%          |
| 0.8                  | 86%           | 36%          |

And what brings it back is more travel. At a distance of six tenths the answer
is the right pixel while the stroke travels 0.73, 0.91 or 1.28 pixels, and the
left pixel once it travels 1.46 or more -- so the condition is still "the edge
reaches a centre", but a left-leaning edge has to reach further to count.

**How much further will not settle.** Fitting the reach separately:

|                            | needed travel         | agreement |
| -------------------------- | --------------------- | --------- |
| leaning right, all fonts   | `shift > 0.88 x toGo` | **98.4%** |
| leaning right, phase sweep | `shift > 0.90 x toGo` | 93.8%     |
| leaning left, all fonts    | `shift > 1.40 x toGo` | 92.6%     |
| leaning left, phase sweep  | `shift > 1.80 x toGo` | 88.2%     |

Leaning right the coefficient is one, within measurement, on both sets -- which
is to say there is no coefficient and the rule is what it looks like. Leaning
left it is 1.4 on one set and 1.8 on another, and neither reaches 93%. A
constant that moves when the sample moves is not a constant.

### The shape of the fit says the variable is wrong

Chasing the coefficient further is what shows there is not one. Sweeping it and
watching how sharply it peaks separates a variable that governs an answer from
one that merely correlates with it:

| Coefficient   | 0.8   | 0.9       | 1.0       | 1.2   | 1.4       | 1.6       | 2.0   | 2.5   |
| ------------- | ----- | --------- | --------- | ----- | --------- | --------- | ----- | ----- |
| leaning right | 97.7% | **98.4%** | **98.3%** | 93.0% | --        | --        | 86.0% | --    |
| leaning left  | --    | --        | 89.5%     | 91.3% | **92.6%** | **92.6%** | 91.4% | 85.3% |

**Leaning right the peak is sharp and sits at one**, falling five points by 1.2
and twelve by 2.0 -- which is what a governing variable looks like, and it says
the coefficient is not a coefficient at all but the absence of one. Leaning left
the curve is a plateau two-tenths wide that never reaches 93, and the best value
moves with the sample: 2.0 on the backslants, 1.0 on the band font, 2.0 on the
mirrored band, 1.4 over all of them together. Two free parameters instead of one
buy four points and stop at 94%.

A variable that governed the answer would not do that. So the reading is not
that a left-leaning edge is credited with the wrong amount of reach -- it is
that **for a left-leaning stroke the reach is not what is being tested**, and the
travel and the distance to a centre are standing in for something they only
partly track.

Two things were ruled out along the way, both worth having: measuring to a pixel
boundary instead of a centre is worse in both directions (87% and 82%), and so
is testing the span's right edge instead of its left (86% and 88%). It is the
left edge and it is centres.

**Open**, with nine shape fonts and some 1,300 strokes of chosen geometry behind
it, every other cell of the table exact, and the next move a variable nobody has
thought of rather than a constant nobody has fitted. **Open**, and now open with
a measured surface rather than a hunch.

One negative worth keeping with it: **removing the column sweep improves every
one of the four shape fonts and hurts none**, which is a second confirmation
from three fonts the horizontal bars never saw.

**What is shipped is knowingly not this.** The measured rule -- no column sweep,
no threshold, the next centre, and the turn-and-convergence test -- reproduces
both fabricated fonts far better than what is in the code and scores **564 of
the 846 recorded letters against 701**. A rule that is right about shapes we
chose and worse about letters is a rule with a piece missing, and the apex-row
pick is the visible piece. So the code keeps a column sweep Windows does not
have and a threshold Windows does not apply, and both are now marked in place as
compensating fictions with the evidence against them. That is a worse thing to
leave behind than a wrong number and a better thing than a wrong number nobody
has noticed.

### Where the error actually is

Sweeping shape fonts for a coefficient was the wrong instrument, and counting
the gap says so. The 145 disagreeing letters are 399 wrong pixels, and they are
not spread:

| face / size          | letters | wrong px |
| -------------------- | ------- | -------- |
| **Courier New h=10** | 34 / 36 | **217**  |
| Times New Roman h=16 | 10      | 17       |
| Arial h=24           | 11      | 15       |
| ...sixteen more      | 90      | 150      |

One cell is 54% of everything left, and the tail is a real tail -- 69 of the 145
letters are wrong by exactly one pixel.

That cell is `lfHeight` 10 asking for Courier New, which the mapper answers with
**the outline at eight pixels per em** -- below the nine where the face's own
`INSTCTRL` turns grid-fitting off. So the fill is handed a raw scaled outline
with sub-pixel stems, and **183 of its 300 spans cover no pixel centre at all**.
At that size dropout control is not a correction applied to a rendered glyph; it
_is_ the renderer. Windows lays down 355 pixels of ink across the 36 letters and
this lays down 158.

Three things follow, and they are separable.

**The pixel choice is already exact.** Taking the rows where a glyph has one
dropout span and Windows inked one pixel, the shipped `floor(to - 0.5)` is 23 of
23 -- against 2 of 23 for `ceil(from - 0.5)` and 6 of 23 for `floor(to)`. The
rule for _which_ pixel is not in question at this size or any other.

**The width threshold is the single most expensive fiction in the file.** 174 of
the 183 dropout spans are narrower than `STUB`, so the code refuses to rescue
them -- and Windows has ink at 138 of those. The width bands run the wrong way
for a stub rule outright:

| span width   | 0 -- 0.25 | 0.25 -- 0.5 | 0.5 -- 0.75 | 0.75 -- 1 |
| ------------ | --------- | ----------- | ----------- | --------- |
| Windows inks | 100%      | 76%         | 50%         | 100%      |

**And the metric was hiding it.** Scoring the four combinations by wrong pixels
rather than by whole letters reverses the answer:

| threshold | column sweep | letters     | wrong px | Courier New h=10 |
| --------- | ------------ | ----------- | -------- | ---------------- |
| 0.5       | on (shipped) | **701**/846 | 399      | 2/36, 217 px     |
| 0.5       | off          | 645/846     | 479      | 2/36, 222 px     |
| none      | on           | 656/846     | 409      | 0/36, 165 px     |
| none      | off          | 654/846     | **369**  | **8/36, 109 px** |

The measured rule -- the one the shape fonts proved -- has the lowest true error
of the four and halves the worst cell. Counting whole letters rewards a rule
that is right about easy letters and gives up on hard ones, which is exactly
what the fictions do. The 564-against-701 that kept this unshipped was measured
with the wrong yardstick.

What stops it being shipped outright is that the win is one cell and the losses
are eighteen: every other cell gets between one and eleven pixels worse. Reading
the errors by direction says why, and says it is two effects rather than one --
dropping the threshold adds ink that Windows does not have (98 extra pixels
become 154) and dropping the column sweep removes ink that Windows does have
(and the missing count outside the worst cell rises with it). The column sweep
is compensating for **near-horizontal thin strokes that a sweep along rows
provably cannot see**, and since thirty-six fabricated bars say Windows has no
column sweep, Windows' sweep along rows must be seeing them by some means this
does not have. That -- not a coefficient -- is the remaining unknown, and it is
now a question about what a scanline is allowed to notice rather than about
where a stroke's edge reaches.

### The threshold was real, but only in one direction

Splitting the constant in two is what the two instruments had been saying
separately all along. The bar font's finding was never "there is no threshold" --
it was two findings, and only one of them was about width:

- every one of the **390 upright spans** is rescued, whatever its width, which
  says the sweep **along rows** has no threshold;
- not one of the **424 spans on their side** is rescued, which says nothing
  about a threshold at all -- it says there is no sweep down columns.

Applying one number to both sweeps forced those two into one, and the number
that resulted was a compromise that refused real rescues along rows in order to
suppress invented ones down columns. Scoring the two thresholds independently
separates them:

| along rows | down columns | letters | wrong px | Courier New at 8 ppem |
| ---------- | ------------ | ------- | -------- | --------------------- |
| 0.5        | 0.5 (before) | 701/846 | 399      | 2/36, 217 px          |
| 0.5        | none         | 671/846 | 485      | 0/36, 249 px          |
| none       | none         | 654/846 | 369      | 8/36, 109 px          |
| **none**   | **0.5**      | 692/846 | **307**  | 7/36, 111 px          |

**Shipped.** Dropping the threshold along rows is supported by both instruments
at once -- the bars say it outright, and the letters say it where it costs most.
Total error falls by a quarter, 399 wrong pixels to 307, and the worst cell by
half. The nine letters given up are the price of no longer suppressing 174
rescues to avoid 22 wrong ones.

Sweeping the column threshold on its own is flat from 0.4 to 0.5 -- 303 wrong
pixels against 307 -- so half a pixel is kept for being the sampling interval
rather than for winning a sweep.

### What the column sweep is actually compensating for

It is not a scan-conversion rule Windows has and this lacks. Tracing which
sweep sets each pixel, the sweep down columns supplies **124 pixels the sweep
along rows cannot reach, and Windows wants 102 of them**. Measuring how far each
of those strokes lies from the nearest scanline settles what they are:

| gap to a scanline | 0 -- 0.02 | 0.02 -- 0.05 | 0.05 -- 0.1 | 0.1 -- 0.2 | over 0.2 |
| ----------------- | --------- | ------------ | ----------- | ---------- | -------- |
| Windows wants it  | 26        | 15           | 19          | 40         | 2        |
| Windows does not  | 6         | 2            | 9           | 4          | 1        |

**Every one of them misses a scanline by less than a quarter of a pixel**, median
0.08, and none by more than 0.21. A stroke that Windows inks and a sweep along
rows cannot see is not a stroke lying somewhere a row sweep is blind to -- it is
a stroke this puts a tenth of a pixel away from where Windows puts it. The
column sweep is compensating for **sub-pixel error in the outline**, not for a
missing mechanism, and it happens to work because a stroke displaced by a tenth
of a pixel is still within the band a perpendicular sweep will find.

Which relocates the question. Ninety-four of the 102 are at sizes where the
glyph programs run, so the first place to look is the interpreter rather than
the rasteriser -- a tenth of a pixel is six units of F26Dot6, far more than
arithmetic drift and about what one wrong rounding in one instruction costs.
The gap does not separate the wanted from the unwanted, so it is not itself the
rule; it is a measurement of how wrong the outline is, and the number to drive
to zero.

### The column sweep invents nothing

Tracing which sweep sets each pixel again, now that the sweep along rows has no
threshold, says something the earlier reading of the bar font could not: of the
**104 pixels the sweep down columns supplies and the sweep along rows cannot
reach, 83 are exactly where Windows has ink and the other 21 are one column
away. None is anywhere else.**

| where Windows has the ink | count |
| ------------------------- | ----- |
| exactly there             | 83    |
| one column to the left    | 16    |
| one column to the right   | 5     |
| nowhere near              | **0** |

A mechanism that fires 104 times and is never wrong about _whether_ -- only
sometimes about _which_ -- is not a fiction inventing ink. It is finding a real
feature by the wrong route. So the sweep down columns stops being a thing to
delete and becomes a thing to explain: Windows has no such sweep, and its sweep
along rows finds these same 104 places.

What the feature is, is now pinned. Every one of them is a stroke lying strictly
between two scanlines, half to one pixel tall, missing the nearer scanline by a
median of 0.08 of a pixel and never by more than 0.21. And the letters they
occur in are almost all round -- `S a b d e g m n s 6 9 3` -- so these are the
apexes of bowls, where a curve turns over, rather than the flat tops of stems.
The bounding edges sit a third of a pixel off the grid, which is what an
`IUP`-interpolated point looks like: the program hints the stems and the
extremes and lets interpolation carry the curve between them.

**It is not the interpolation's rounding.** Sweeping `IUP`'s divide over all
four modes, scored on wrong pixels rather than whole letters, is flat:

| mode     | trunc | round | floor | ceil |
| -------- | ----- | ----- | ----- | ---- |
| wrong px | 307   | 307   | 308   | 306  |
| letters  | 692   | 688   | 692   | 684  |

Four modes inside two pixels of each other is no signal at all, and it retires
an earlier reading: truncation was recorded as worth six of the 846 letters, and
on the pixel metric that six is worth one. It was the whole-letter yardstick
again, not a fact about the instruction.

**Nor is it a uniform displacement.** Eight transforms of the stroke's geometry
were tried -- rounding both edges to the grid, to the half, growing the stroke
by an eighth or a quarter, forcing its height to a whole pixel -- and every one
that brings all 102 wanted strokes onto a scanline brings all 22 unwanted ones
too. Nothing about where these strokes sit separates the ones Windows inks from
the ones it does not, so "the outline is a tenth of a pixel out" is too simple:
the two populations are geometrically the same.

One thing did fall out for free, from the other direction entirely. Counting how
much of each hinted outline lands exactly on the pixel grid:

| face, size                 | points on the grid, x / y |
| -------------------------- | ------------------------- |
| Courier New at 11 ppem     | 61% / 57%                 |
| Arial at 11 ppem           | 45% / 51%                 |
| Times New Roman at 14 ppem | 40% / 47%                 |
| **Courier New at 8 ppem**  | **2% / 7%**               |

Half a healthy hinted outline sits on the grid. At eight pixels per em Courier
New's sits nowhere near it -- which is `INSTCTRL` doing exactly what section 5
says it does, measured here from a direction that knows nothing about advances
or about the fabricated font that first found it.

### Three thousand cells that were never read

Sixteen of the fabricated recordings were made with the glyph probe rather than
the hinting one, so each holds 846 monochrome cells drawn by Windows from a font
we built -- twelve shape fonts and four alterations of Times New Roman's `cvt`.
They had been read once each by hand and then left. Replaying all of them is now
a test of its own, and it is a better instrument than the 846 recorded letters
for one reason: **nothing in a shape font is hinted.** It carries no glyph
program, so the outline the rasteriser is handed is exactly the outline that was
drawn, to the design unit. A disagreement here cannot be blamed on the
interpreter, which is the one thing a disagreement about a letter can always be
blamed on.

That is what decides the sweep down columns, and it decides it against itself:

|                       | recorded letters | fabricated cells                    |
| --------------------- | ---------------- | ----------------------------------- |
| with the column sweep | **307** wrong px | 7,171 wrong px, 1,776 exact         |
| without it            | 369 wrong px     | **6,892** wrong px, **1,816** exact |

Deleting it helps by 279 pixels and 40 cells on geometry we chose and hurts by
62 pixels on the letters. The two only look contradictory until the difference
between them is named: **the letters are hinted and the shapes are not.** A rule
that helps where the outline came through an interpreter and hurts where it did
not is not a rule about scan conversion at all. It is compensation for the
interpreter, and the bar font was right the first time.

The same split shows inside the fabricated set. `cour-no-instctrl` is not a
shape font -- it is real Courier New with grid-fitting switched back on at eight
pixels per em, so its glyphs _are_ hinted -- and it is the one recording of the
sixteen that the column sweep improves, 105 wrong pixels against 129. Twelve
shape fonts say delete it and the one hinted font in the same set says keep it.

So the remaining glyph error is a hinting error wearing a rasteriser's clothes,
and the instrument for it already exists: `cour-no-instctrl` is Courier New
hinted at the smallest size in the fixture, with 258 cells of ground truth and
105 wrong pixels to account for.

### What the near-horizontal strokes are not

Three formulations were built and measured before the split above made them
unnecessary, and all three fail in a way worth keeping.

**Consecutive-scanline gap.** Where a stroke passes between two scanlines, the
spans above and below it are disjoint in x, and the pixel should go in the gap.
It is true of the geometry -- 99 of the 104 cases have such a gap -- and useless
as a rule. Firing on every disjoint pair invents 568 pixels. Requiring the two
spans to be bounded by the same contour piece fires almost never and recovers
none of the wanted pixels. Requiring them to be bounded by _adjacent_ pieces
invents 934. There is no setting between "never" and "far too often".

**Turning points.** A bowl's apex has a local extremum in y and a bar lying on
its side has not, which is exactly the difference between the letters and the
bar font. Inking the pixel at every curve's turn-over adds 45 wrong pixels and
recovers none of the wanted ones.

The tell is the same in all three: the missing-pixel count stays at exactly 215
whatever the rule. **Not one of the 83 pixels the column sweep gets right is
reachable by any rule that reads only the spans along rows** -- which is the
strongest possible statement that the feature is not in the rows, and, with the
fabricated cells above, that it is not in Windows either.

One correction while the numbers are in front of us. It was recorded here that
the column sweep "invents nothing", on the grounds that all 104 of its pixels
are within one column of ink Windows has. That was too generous: 83 are exactly
right and the other 21 sit beside ink that the ordinary fill puts there anyway,
so those 21 are invented after all. The claim should have been that it is right
four times in five, which is a different and much less interesting thing.

### Four things the smallest cell is not

With the fabricated cells saying the remaining error is the interpreter's, the
obvious place to look was Courier New at eight pixels per em -- except that it is
the one size where the interpreter does nothing, because `INSTCTRL` turns
grid-fitting off. **That makes it the cleanest instrument in the fixture rather
than the dirtiest**: the outline handed to the rasteriser is the design outline
scaled, so every one of its 111 wrong pixels is scan conversion and nothing else.
Four candidates were measured against it and all four are out.

**Not the fixed point.** Windows works in F26Dot6 and this works in doubles, so
scaled coordinates that fall between sixty-fourths are rounded there and not
here. Quantising every placed point to 1/64 moves the fixture from 307 wrong
pixels to 307, and the cell from 111 to 109. Coarser grains are worse -- 345 at
1/32, 420 at 1/16 -- which is what says the measurement is live and the answer
is genuinely nothing.

**Not the pixel the rescue picks.** `floor(to - 0.5)` had only ever been fitted
on whole-letter counts, which the last few sections have shown to be the wrong
yardstick. Re-swept on wrong pixels it wins by more than it ever did on letters:

| rule     | floor(to−0.5) | floor(from) | round(mid−0.5) | ceil(from−0.5) |
| -------- | ------------- | ----------- | -------------- | -------------- |
| wrong px | **307**       | 382         | 496            | 741            |

**Not grid-fitting after all.** The strokes it gets wrong look exactly like
strokes that should have been snapped -- a `M` whose left stem lands at
[2.594, 2.922] where Windows inks pixel 3, which is what a stem rounded to a
whole pixel would do. Forcing the interpreter to grid-fit regardless of
`INSTCTRL` settles it the other way: the cell goes from 111 wrong pixels to
**305** and the fixture from 307 to 501. So Windows really is drawing this size
unhinted, and the `INSTCTRL` reading now rests on three independent
measurements -- the fabricated font that changed exactly the 36 records at this
cell, the census showing 2% of its points on the grid against 40--60% at every
hinted size, and this.

**Not a directional bias in the rescue, on the evidence.** Of the 183 rescues in
this cell, 151 land exactly where Windows has ink, 27 land one column left of it
and only one lands right -- which looks like a systematic pull. It is mostly not:
the count comes from asking which pixel within two columns Windows inked, and on
rows carrying several strokes that finds a neighbour belonging to a different
one. Restricted to rows with a single span and a single inked pixel the rule is
exact. The apparent asymmetry is an artefact of the attribution, and is recorded
here because it took a second look to see that.

What is left after all four is 111 wrong pixels in a cell where the outline is
known exactly, the pick rule is known to be right, and the arithmetic is known
not to matter -- which is a smaller and much better-posed question than the one
this section started with.

### The sweep down columns is gone

Thirty-six fabricated bars had said Windows has no such sweep, and that reading
had twice been set aside because deleting it cost recorded letters. Reading the
bars properly settles it. Taking only the sideways bars that **miss every
scanline** -- the ones a vertical rescue would exist to save -- and asking
whether Windows drew anything at all:

| bar height   | 0.2--0.3 | 0.3--0.4 | 0.4--0.5 | 0.5--0.6 | 0.6--0.8 |
| ------------ | -------- | -------- | -------- | -------- | -------- |
| Windows inks | 0 of 5   | 0 of 8   | 0 of 5   | 0 of 3   | 0 of 6   |

Twenty-seven of twenty-seven, at every height up to a full pixel and every
phase, and in the same recordings where all 390 upright bars **are** rescued.
That is a controlled comparison inside one font at one size: dropout control is
demonstrably running, and it never once fires down a column.

So it is deleted, knowing what that costs:

|        | recorded letters          | fabricated cells                    |
| ------ | ------------------------- | ----------------------------------- |
| before | 307 wrong px, 692/846     | 7,171 wrong px, 1,776/3,144         |
| after  | **369** wrong px, 654/846 | **6,892** wrong px, **1,816**/3,144 |

Worse on the letters by 62 pixels, better on chosen geometry by 279, and better
by two at Courier New at eight pixels per em -- the one cell of letters where
nothing is hinted, and so the one cell where a fair comparison is possible. The
letters lose because the sweep was compensating for something else, and leaving
a mechanism in that Windows provably lacks keeps whatever that is invisible.

### What is left, and where it is not

Decomposing the 111 wrong pixels of the unhinted cell by where each came from
gives the shape of what remains:

|                                                        | count  |
| ------------------------------------------------------ | ------ |
| Windows inks it, a span was there, we inked nothing    | **73** |
| we inked it from a rescue, Windows has nothing         | 32     |
| we inked it from the column sweep, Windows has nothing | 3      |
| we inked it from an ordinary fill, Windows has nothing | 2      |
| Windows inks it and there is no span anywhere near     | 1      |

The dominant failure is a pixel Windows draws where the outline passes close by
and this draws nothing. Of those, 56 have a span down the column overlapping
them, every one between 0.32 and 0.42 of a pixel tall -- the bottom bar of a
`B`, the arm of a `K`, the crossbar of an `a`. It is tempting, and wrong, to
read that as the vertical threshold refusing them: sweeping the column
threshold and its row pick together over twelve combinations makes every one
worse than what was already there, and the bars above say the mechanism does not
exist at all. What those 56 have in common is that they are _near_ a thin
horizontal stroke, not that the stroke is what Windows drew there -- in a letter
the same pixel is usually reachable from a stem as well, and that ambiguity is
what has made every attribution in this section harder than it looks.

### The pixel the rescue picks is not one rule

The shape fonts have the property the letters lack: one stroke per glyph, so
which stroke Windows meant is never in doubt. Reading all seven of them row by
row, keeping only rows with a single span that is a genuine dropout and a single
inked pixel, gives five thousand cases where the answer is unambiguous -- and
they do not agree with each other.

| font                 | clean dropouts | `floor(to − 0.5)` | `ceil(from − 0.5)` |
| -------------------- | -------------- | ----------------- | ------------------ |
| cour-bars            | 372            | 1%                | **100%**           |
| cour-hairslants      | 805            | 13%               | **88%**            |
| cour-offsets         | 803            | 15%               | **85%**            |
| cour-slants          | 748            | **86%**           | 14%                |
| cour-backslants      | 785            | **84%**           | 17%                |
| cour-phases          | 750            | **90%**           | 10%                |
| cour-leftband        | 753            | **77%**           | 23%                |
| the recorded letters | 66             | **95%**           | 6%                 |

The three that want the other rule are the three whose strokes are upright or
nearly so. Pooling all 5,016 and banding them by how far the stroke moves
sideways per scanline says it outright:

| lean, pixels per row          | < 0.02  | 0.02--0.1 | 0.1--0.25 | > 0.25 |
| ----------------------------- | ------- | --------- | --------- | ------ |
| Windows takes the right pixel | **97%** | 58%       | 16%       | **2%** |

An upright stroke takes `ceil(from − 0.5)` -- which is the pixel the ordinary
fill loop would have started at, and so the single most natural thing a scan
converter can do when that loop turns out to be empty. A leaning stroke takes
the pixel to the left of it.

Two ways of making that one rule were tried and neither works. **Sampling the
edges at a different height in the row** would move a leaning stroke and leave an
upright one alone, which is exactly the right shape -- but no offset does it, the
best being 65% at a quarter-row above centre against 97% and 98% for the
conditional in its two halves. **Carrying the choice down the stroke**, so that
only the first scanline decides, reaches 69.8% against 44.9% and 55.4% for the
two fixed rules -- better than either and far short of both.

**And the conditional itself is a fit, not a rule.** Implemented with the edge's
own slope and swept, it is spectacular on the fonts it was read from and wrong
where it counts:

| threshold on the lean | fabricated cells   | recorded letters | Courier New at 8 ppem |
| --------------------- | ------------------ | ---------------- | --------------------- |
| off (shipped)         | 6,892 wrong px     | 369 wrong px     | **109** wrong px      |
| 0.05                  | **2,787** wrong px | 470 wrong px     | 198 wrong px          |

Cutting the fabricated error by sixty per cent is the most any single change has
been worth all section, and it is still not shipped, because the cell it has to
answer to is Courier New at eight pixels per em -- **the one cell of real letters
whose outline is exact, where a fair comparison with the shape fonts is
possible** -- and there it nearly doubles the error. A rule that is right about
fabricated bars and wrong about real glyphs at the same size, with neither one
hinted, is measuring something about the bars.

What the bars have that the letters do not is that their edges are straight
lines running the whole height of the glyph, and perfectly upright in a third of
the cases. The letters' dropouts are curves. That is the next variable, and it
is one the existing recordings can answer without another font.

### The two instruments contradict each other

The lean was a proxy, and following it to the end produces a contradiction worth
stating exactly, because it bounds the problem better than any of the rules
tried so far.

Widening the letters from 66 clean cases to 100 -- taking any dropout whose two
candidate pixels are more than three columns from every other span in the row --
and splitting them the same way as the shape fonts:

| letters, by edge       | cases | took the right pixel | took the left |
| ---------------------- | ----- | -------------------- | ------------- |
| straight line          | 41    | 1                    | 40            |
| curve                  | 59    | 6                    | 53            |
| **upright, straight, ` | lean  | < 0.02`**            | **11**        | **0** | **11** |

That last row is the same configuration as `cour-bars`, which is 372 for the
right pixel and 5 for the left. Both are Courier New. Both are at eight pixels
per em, where nothing is grid-fitted. Both are a single upright span bounded by
two straight lines, alone in its row. They give opposite answers.

Everything local was checked and none of it accounts for the difference:

- **Not the lean.** The letters' upright cases behave exactly like their leaning
  ones.
- **Not curvature.** Lines and curves in letters are 1 of 41 and 6 of 59 for the
  right pixel -- both overwhelmingly left.
- **Not the contour direction.** All seven shape fonts write their points in the
  same order, bottom-left to top-left to top-right to bottom-right.
- **Not how many strokes share the row.** The letters' single-span rows are 3
  right and 63 left, the same as the whole set, and ten of the eleven upright
  cases are single-span rows.
- **Not the placement.** Every row of every shape font that fills normally
  agrees with Windows pixel for pixel -- 867 of 867 for the bars, near enough all
  of some 9,600 across the seven. And the check is sharp: shifting the outline by
  an eighth of a pixel drops that to 73%, and the +0.6875 shift that would
  reconcile the bars' dropouts drops it to **7.4%**. There is no offset.
- **Not the fabricated glyph's bounding box**, which `setGlyph` writes from the
  points themselves, and which carries a comment recording that this precise bug
  was found and fixed once already.

So the thing that decides is not a property of the span, of its edges, of its
row, or of where the glyph sits. Which means one of the two instruments is not
measuring what it appears to, and the honest reading is that a font of thirty-six
identical bars is a stranger object than it looks -- every glyph the same shape,
every one a lone rectangle spanning the full height of the em, nothing else in
the outline at all. The letters are the target and the bars are the model, and
where they disagree the letters are what has to be matched.

What is shipped therefore stays as it is -- `floor(to − 0.5)`, which the letters
say by 93 to 7 -- and the bars are recorded as a measurement that does not
transfer rather than as a rule that was not implemented.

### No rule that reads the span can fit both

Before hunting further, the recordings themselves were checked: every one of the
sixteen fabricated glyph files differs from the stock recording on 257 of the 258
records naming the face it replaces, and no two are byte-identical. The fonts
reached Windows, and none is a stale copy of another.

Then the family was searched exhaustively rather than guessed at. Over the pooled
372 bar dropouts and 100 letter dropouts, every rule of the form
`floor(a·from + b·to + c)` on a quarter-step grid:

| rule                                | bars        | letters    |
| ----------------------------------- | ----------- | ---------- |
| best fit found, `a=1, b=0, c=0.375` | **372/372** | 48/100     |
| `floor(to − 0.5)` (shipped)         | 5/372       | **93/100** |
| `ceil(from − 0.5)`                  | **372/372** | 7/100      |

The best single rule the family contains is exactly `ceil(from − 0.5)` in
disguise, and it fails half the letters. **No function of the span's two edges
fits both**, which retires the whole family rather than any one member of it.

Two structural candidates went the same way. An **exactly vertical edge** is the
sort of thing a scan converter special-cases, and the shape fonts are 504 of 504
for the right pixel when both edges are exactly vertical -- but they are also 411
of 411 when the lean is merely under a two-hundredth, so there is no
discontinuity at zero, only the same smooth threshold as before. And the
**direction of the crossing** is −1 in every case measured, in the letters and in
the shape fonts alike, so the contour orientation cannot be what separates them.

That leaves exactly one difference, and it is not about the span at all. **Every
shape font is a single contour of three or four points** -- `setGlyph` writes one
contour and the fabrications hand it a triangle or a parallelogram -- while every
real letter is several contours of dozens of points. Nothing recorded so far
varies that, because all twelve shape fonts were built the same way.

So the experiment that would settle it is now specified rather than guessed: a
font whose glyphs carry **the same bar at the same place, drawn with more
outline around it** -- a second contour far off in the corner where no scanline
of interest can reach it, or the bar's own edges subdivided into a dozen
collinear segments. The span the rasteriser measures would be identical to the
bar font's to the last bit, and only the outline's complexity would differ. If
the pixel moves, the rule is not about geometry at all; if it does not, the bars
are sound and something in the letters is still misattributed.

### The origin is not rounded, and neither is the bearing

The two code paths that reach the rasteriser are not the same: a glyph with
instructions goes through the interpreter and comes back in sixty-fourths of a
pixel, and a glyph without any -- which is every glyph of every shape font -- is
scaled here in floating point. That is a real asymmetry between the two
instruments, and if the interpreter moved a glyph even when it moves no point,
the letters would see it and the bars never would.

It does not, and the first half of that is settled by reading rather than
measuring. The origin phantom is `xMin − lsb`, which is zero for any
conventionally built glyph and is zero by construction for the shape fonts,
since `setBearing` writes the bearing from the points themselves. There is
nothing there to round.

The second half is the live version: Windows places a glyph at
`pen + lsb + (x − xMin)`, and rounding that bearing to the grid before placing
is a thing a rasteriser of the period might well do. Measured at three grains:

| bearing rounded to | letters          | fabricated cells   | the bars         |
| ------------------ | ---------------- | ------------------ | ---------------- |
| nothing (shipped)  | **369** wrong px | **6,892** wrong px | **770** wrong px |
| a whole pixel      | 3,462            | 14,521             | 1,002            |
| half a pixel       | 1,909            | 11,988             | 936              |
| a sixty-fourth     | 399              | 6,874              | 770              |

Whole-pixel rounding is a catastrophe -- nine times the error on the letters --
and half a pixel is barely better. A sixty-fourth changes nothing either way,
which is the same answer quantising the placed points gave earlier and says the
same thing: the arithmetic is fine and the placement is unrounded.

So the asymmetry between the two code paths is real but empty. Both place the
glyph at the same unrounded position, Windows agrees with both, and the
contradiction between the bars and the letters survives it.

### A second contour changes what is drawn

The font the last section specified is built, recorded and read. `cour-crowd`
draws the same bar three ways at twelve widths and phases: **plain**, four
points and one contour; **subdivided**, the identical rectangle with four extra
collinear points up each side, twelve points describing exactly the same region;
and **crowded**, the plain bar plus a second contour down in the descender, well
below the baseline and well to the left, sharing no scanline and no column with
it. Our own renderer draws all three byte-identically, as it must -- the
crossings are the same numbers.

Windows does not.

| comparison, over 84 size-and-phase pairs | agree  | differ |
| ---------------------------------------- | ------ | ------ |
| plain against subdivided                 | **84** | 0      |
| plain against crowded                    | 55     | **29** |

**Three times as many points on the same outline changes nothing. One extra
contour, disjoint and distant, changes the drawing.** And it changes it the same
way every time:

| effect on the bar             | count    |
| ----------------------------- | -------- |
| moved exactly one column left | 29 of 29 |
| first inked row one lower     | 29 of 29 |
| last inked row one higher     | 25 of 29 |

So the bar loses a row at each end and steps one column to the left. Written out
at eight pixels per em, for the bar at `[4.676, 4.832]` -- which is the very case
section 6 could not reconcile, the one where `cour-bars` says pixel 5 and a real
letter's stem in the same position says pixel 4:

```
        plain            crowded
   1    . . # . .        . . . . .
   2    . . # . .        . # . . .
   3    . . # . .        . # . . .
   4    . . # . .        . # . . .
   5    . . # . .        . . . . .
```

**The crowded bar takes pixel 4 -- the letters' answer.** The contradiction that
has stood through nine fonts is not between fabricated bars and real letters at
all. It is between glyphs with one contour and glyphs with more than one, and
every real letter has more than one.

That does not yet give the rule, and it is worth being exact about what it does
give. It says the rasteriser's behaviour depends on something outside the span
being measured, which no rule of the form tried so far can express -- and it says
the shape fonts have been answering a question about lone rectangles, which is
why nine of them agreed with each other and none of them agreed with a letter.
The bar font's 372-of-372 for `ceil(from − 0.5)` is a fact about single-contour
glyphs and nothing more.

What it does not say is why. A second contour that shares no row with the bar
cannot change the bar's crossings, so whatever is different is happening before
the crossings are computed or after they are resolved -- in how the glyph is set
up, or in how its ink is transferred. Losing a row at each end is stub exclusion
appearing where it was absent, and stepping a column is the other pixel of the
pair; both switch on together, which suggests one decision rather than two.

### It is the width of the glyph

Three more fonts answer why. Each draws the same bar at the same place and moves
one extra contour around it, always keeping it out of the bar's own rows so the
crossings the rasteriser computes are identical every time.

| the extra contour                             | x extent moves | column shifts | rows lost |
| --------------------------------------------- | -------------- | ------------- | --------- |
| none (`plain`)                                | --             | --            | --        |
| directly below the bar, its own x             | no             | no            | **no**    |
| directly above the bar, its own x             | no             | no            | **no**    |
| to the left, near or far                      | `xMin`         | **−1**        | **2**     |
| to the left but above the ascender            | `xMin`         | **−1**        | **2**     |
| to the right, near or far                     | `xMax`         | no            | **2**     |
| one on each side                              | both           | **−1**        | **2**     |
| **none, but the header claims `xMin` is 100** | no             | **no**        | **no**    |

Two readings fall out and a third follows.

**It is not the number of contours.** A second contour directly under or over
the bar leaves all 42 comparisons untouched. Distance does not matter either:
near and far are identical to the last pixel.

**It is not the header.** `cour-lies` writes a false `xMin` of 100 into the
glyph and a matching bearing, so the bar lands in the same place and only the
header differs -- and it draws identically to the truthful control in **all 84**
comparisons. Windows takes the glyph's extent from the points, not from what the
glyph claims.

**It is the width.** Widening the outline in x -- either side, by any amount --
costs the bar its first and last inked row, and widening it leftward moves the
bar a column as well. Widening it in y alone does nothing.

That closes the contradiction that has stood since the bar font was built. The
same bar, at the same size and phase, with the glyph narrow and then widened by
a contour nowhere near it:

| the glyph                  | cases | `ceil(from − 0.5)` | `floor(to − 0.5)` |
| -------------------------- | ----- | ------------------ | ----------------- |
| narrow -- the bar alone    | 16    | **16**             | 0                 |
| widened -- a box elsewhere | 16    | 0                  | **16**            |

**Sixteen of sixteen each way.** The rule was never in dispute between fabricated
bars and real letters; it was between narrow glyphs and wide ones, and every real
letter is a wide one. `floor(to − 0.5)` -- what is shipped, and what the recorded
letters said by 93 to 7 -- is right, and nine shape fonts disagreed with it only
because a lone rectangle is a narrower glyph than any letter.

Why a rasteriser should care how wide the glyph is remains open, and it is now a
question with a shape: something sized or positioned from the outline's extent,
computed before any scanline is drawn, that a single narrow contour and a wide
one land differently inside. The row loss at both ends of the stroke is the part
that most resembles a real mechanism -- it is stub exclusion appearing where it
was absent, and it appears whenever the glyph gets wider, on either side.

### The rows the wide glyph loses are stubs, not a band

A band -- a strip of the output rasterised at a time because the whole will not
fit in memory -- would explain a change in x costing rows in y, and it is worth
ruling out rather than assuming. It does not fit, on two counts.

The display driver says it does not band: `RASTERCAPS` for VGA reads 18,137,
which is `0x46D9`, and `RC_BANDING` is bit 1 -- clear. Banding in GDI is a
printing mechanism, driven by the `NEXTBAND` escape, and nothing in this
project's recordings touches a printer.

And the rows lost are the wrong rows. Reading which ones actually disappear when
the glyph is widened:

| size | the stroke's rows | left after widening | lost  |
| ---- | ----------------- | ------------------- | ----- |
| 10   | 1 2 3 4 5         | 2 3 4               | 1, 5  |
| 12   | 3 4 5 6 7 8       | 4 5 6 7             | 3, 8  |
| 14   | 3 … 10            | 4 … 9               | 3, 10 |
| 18   | 3 … 13            | 4 … 12              | 3, 13 |
| 20   | 3 … 14            | 4 … 13              | 3, 14 |

**Always the first row and the last row, never an interior one.** A band boundary
falls at a fixed device row and would cut a tall stroke somewhere in the middle;
at twenty pixels the stroke is twelve rows long and loses only its two tips.

That is not a buffer running out. It is **stub exclusion** -- `SCANTYPE` 1 is
"simple dropout control excluding stubs", all three families ask for it, and the
tip of a stroke is what a stub is. The letters said the same thing much earlier
and it was never explained: 176 of 177 tip rows carry no ink, against 121 of 121
and 390 of 390 for everything else.

So the width of the glyph does not move ink around. **It switches stub exclusion
on.** A narrow glyph gets none and inks its stroke end to end; a wide one gets it
and drops both tips -- and the same switch changes which of the two candidate
pixels the rescue takes. One decision with two visible consequences, which is
what the pair moving together always suggested.

Every real letter is wide enough to be on the far side of that switch, which is
why the letters have always shown both halves of the behaviour and why the shape
fonts showed neither.

### What turns stub exclusion on

A glyph too narrow to touch a single sample column.

`cour-widths` puts the same bar in the same place in all thirty-six glyphs and
sweeps only the glyph's total width, by moving a small box below the baseline
further and further to the right. The box is on the right so `xMin` never moves
and the bar's placement is identical everywhere; seven recorded sizes turn
thirty-six widths in design units into a fine sweep in pixels. The bar keeps its
full height up to a point and then loses its first and last row:

| pixels per em | the bar          | switches between glyph widths |
| ------------- | ---------------- | ----------------------------- |
| 8             | 5 rows, then 3   | 0.81 and 0.89 px              |
| 9             | 6 rows, then 4   | 0.45 and 0.54 px              |
| 11            | 8 rows, then 6   | 0.77 and 0.89 px              |
| 17            | 12 rows, then 10 | 0.67 and 0.85 px              |
| 13, 16, 22    | no switch at all | --                            |

The three that never switch are the three where this bar happens to cover a
pixel centre and is filled ordinarily, so there is no rescued pixel for a stub
rule to take away. That is the first confirmation.

The four thresholds are different numbers, so it is not a width in pixels, and
they are different numbers of design units too. What they are is the same event:
**the glyph's outline reaching the next pixel centre.** At eight pixels per em
the bar begins at 4.676 and the switch falls between a right edge of 5.485 and
one of 5.567 -- across 5.5. At nine, between 5.458 and 5.550 -- across 5.5. At
eleven, between 6.452 and 6.565 -- across 6.5. At seventeen, between 8.358 and
8.533 -- across 8.5.

Stated as a rule and tested against the whole sweep: **stub exclusion applies
when the glyph's outline spans at least one pixel centre, and does not when the
whole glyph falls between two.** That is 144 of 144 on `cour-widths` and 94 of 96
on `cour-sides`, which was built for a different question.

It also settles every earlier case at once. The lone bar of `cour-bars` runs from
4.676 to 4.832 and covers no centre -- no exclusion, and the other candidate
pixel. A box directly above or below it does not widen the glyph past a centre --
no change. A box to the left or the right does -- exclusion, and leftward also
moves `xMin` and the column with it. A false `xMin` in the header does not move
any point -- no change.

And it is a sensible thing for a rasteriser to do. A glyph lying entirely between
two sample columns would otherwise disappear completely; drawing it anyway, and
declining to apply a stub rule that would erase what little is left, is what
keeping a sub-pixel glyph visible looks like. **Every real letter spans many
centres, so every real letter is on the far side of this switch** -- which is why
the letters showed both halves of the behaviour from the start and why no font
of lone bars could ever show either.

### Both halves, implemented

The rule is in `fill` now, and it is two things that switch together on whether
the glyph touches a sample column at all.

**The narrow case costs nothing and pays a great deal.** A glyph lying entirely
between two pixel centres takes `ceil(from − 0.5)`, the pixel the ordinary fill
loop would have started at, instead of `floor(to − 0.5)`. No real letter is ever
that narrow, so the recorded letters do not move by a single pixel -- and the
fabricated cells fall from 12,916 wrong pixels to **5,424**.

**Stub exclusion is the other half**, and it needed one thing measured before it
worked. A rescued pixel is refused when its span has no neighbour in the row
above or none in the row below -- when it is at the end of its stroke. Chaining
by strict overlap in x is wrong: a diagonal steps sideways faster than it is
wide, so every one of its scanlines looks like a tip and the rule eats the whole
stroke. Two spans a row apart are the same stroke when they come within **a
pixel**, which is the sampling interval, and the sweep is flat from 0.9 to 1.25:

| within               | 0     | 0.5   | 0.75  | **1.0**   | 1.25  | 2.0   |
| -------------------- | ----- | ----- | ----- | --------- | ----- | ----- |
| letters, wrong px    | 464   | 406   | 391   | **388**   | 388   | 392   |
| fabricated, wrong px | 5,149 | 4,200 | 3,932 | **3,895** | 3,895 | 3,898 |

Refusing a tip at either end is right, and it is not close: taking only the top
or only the bottom leaves the fabricated cells at 3,172 and 2,957 against 3,463,
and refusing only pixels that are isolated at both ends is worse still.

Where that leaves the two instruments:

|        | letters                   | fabricated cells                    |
| ------ | ------------------------- | ----------------------------------- |
| before | 654/846, 369 wrong px     | 2,489/4,434, 12,916 wrong px        |
| after  | **655**/846, 388 wrong px | **3,463**/4,434, **3,895** wrong px |

A thousand more cells exact and nine thousand fewer wrong pixels on geometry we
chose, for nineteen pixels on the letters. The letters' cell count goes up as
well, which it had not done for any change in this section.

The nineteen are worth naming rather than absorbing: stub exclusion is now on for
every real letter, and where this refuses a pixel Windows keeps, the reason will
be in what counts as one stroke. A pixel of slack is the sampling interval and
therefore defensible, but it is a threshold standing in a place where the real
rule is about which edges belong to which contour, and that is the next thing to
measure rather than the last word.

### What counts as one stroke is geometry, not topology

The pixel of slack was shipped as a threshold standing where a rule about edges
ought to be. Measured against the rules about edges, it is the rule.

Every criterion below decides the same question -- whether a span on one row and
a span on the next belong to the same stroke, and so whether a rescued pixel is
at a tip and should be refused. The outline's own structure is available to all
of them: each crossing knows which piece of which contour produced it.

| what makes two spans one stroke         | letters         | fabricated cells    |
| --------------------------------------- | --------------- | ------------------- |
| **their x ranges come within a pixel**  | **655**, 388 px | **3,463**, 3,895 px |
| the same two edges bound both           | 607, 509 px     | 3,439, 3,933 px     |
| the same edge on either side            | 636, 428 px     | 3,448, 3,916 px     |
| both edges from the same contour        | 640, 423 px     | 3,449, 3,918 px     |
| edges within one place in contour order | 621, 469 px     | 3,442, 3,921 px     |
| ...within eight places                  | 630, 435 px     | 3,447, 3,914 px     |
| the pixels they ink are adjacent        | 642, 404 px     | 3,453, 3,906 px     |
| within a pixel **and** the same contour | 656, 386 px     | 3,456, 3,905 px     |

**Every appeal to the outline's structure is worse than the plain geometric
test**, and the gap is not small: requiring the same two edges costs 48 letters
and 121 wrong pixels. Loosening it towards geometry -- one edge instead of two,
then the same contour, then adjacency in contour order out to eight segments --
climbs steadily back towards the geometric answer without reaching it. That
shape is what a proxy converging on the real variable looks like, read
backwards.

The one criterion that ties is proximity **with** contour identity added, and it
is a wash: a letter and two wrong pixels better on one instrument, seven cells
and ten pixels worse on the other. Contour identity buys nothing on top of being
close.

So the slack is not standing in for anything. **Two spans a row apart are one
stroke when they come within a pixel of each other, whatever they are made of**,
and a rasteriser deciding that from coordinates rather than from which contour an
edge came from is both what the recordings say and the simpler thing to have
written. The threshold is the sampling interval, and it stays.

### What the remaining letter errors are

388 wrong pixels across 191 letters, sorted by what put them there or failed to:

|                                                             | count   |
| ----------------------------------------------------------- | ------- |
| Windows inks it and **nothing here produced a span at all** | **215** |
| a rescue this makes and Windows does not                    | 59      |
| Windows inks it and **the stub rule refused it**            | 58      |
| an ordinary fill this makes and Windows does not            | 56      |

And by cell, the stub rule's mistakes are not spread at all:

| cell                 | none | stub   | rescue | fill | total   |
| -------------------- | ---- | ------ | ------ | ---- | ------- |
| **Courier New h=10** | 75   | **53** | 13     | 2    | **143** |
| Times New Roman h=16 | 10   | 0      | 4      | 7    | 21      |
| Courier New h=14     | 15   | 1      | 4      | 0    | 20      |
| ...sixteen more      | 115  | 4      | 38     | 47   | 204     |

**Fifty-three of the fifty-eight are one cell**, and every other cell has none or
one. That cell is the unhinted one, where a stroke is sub-pixel and almost every
row of it is a rescue rather than a fill.

Looking at what it refuses there says why, and says the rule is too broad. In an
`n` at eight pixels per em the stem spans three rows: the middle fills
ordinarily and the top and bottom are rescued. This refuses both, because
neither has a span beyond it -- and Windows keeps both, because they are where
the letter ends rather than where a stroke tapers away.

Two ways of narrowing it were built and measured and neither is right:

|                                             | letters | Courier New h=10 | fabricated cells    |
| ------------------------------------------- | ------- | ---------------- | ------------------- |
| refuse every tip (shipped)                  | 388 px  | 143 px           | **3,463**, 3,895 px |
| only in strokes of six rows or more         | 367 px  | **109** px       | 3,226, 4,504 px     |
| only in strokes that are rescued end to end | 374 px  | 116 px           | 3,121, 4,629 px     |
| only in strokes with a filled row in them   | 383 px  | 136 px           | 3,283, 4,690 px     |

Each buys the letters something and costs the fabricated cells more than it
buys, which is the signature of a fit rather than a rule -- and the first of them
is a bare length threshold with nothing behind it.

So the shipped rule stays as it is, and the map of what is left is worth more
than another sweep: **the largest single category is not the stub rule at all**.
215 of the 388 are pixels Windows inks where nothing here produces a span --
which is the near-horizontal features the sweep down columns used to cover
before it was deleted for not existing. That is the same open question as
section 6, now stated in pixels rather than in mechanisms, and it is more than
half of everything left.

### A curve gets ink where a bar does not

`cour-arches` asks the one thing the bar font could not. Half the letters'
remaining error is a stroke lying between two scanlines that Windows inks and
this does not, and those occur almost entirely in round letters -- so the thing
to vary is whether the near-horizontal stroke is a **curve turning over** or a
**flat bar**. The font draws a wide shallow arch, thin enough that its apex falls
between two scanlines, at three thicknesses and six heights, and the same
eighteen again as flat bars at the same place. Both are wide glyphs, so both sit
on the far side of the switch `cour-widths` found. It needed off-curve points,
which `setGlyph` now writes.

| the stroke at its apex, when it misses every scanline | Windows inks it |
| ----------------------------------------------------- | --------------- |
| a curve turning over                                  | **51 of 51**    |
| a flat bar of the same thickness at the same height   | **0 of 30**     |

Total, both ways. That is the mechanism behind the missing pixels, and it also
retires a worry: the twenty-seven sideways bars that got no ink were not saying
"Windows never rescues a horizontal stroke", they were saying "not a flat one".

**But this already draws the apexes**, and where it does not the reason is not
what was first written here. That paragraph claimed Windows inks a column beyond
the outline at each end of a shallow flank; it was arithmetic done by hand rather
than a reading of the renderer, and the renderer disagrees with it. Asked for its
own spans on that arch at twenty-two pixels per em, rows 8, 9 and 11 match
Windows **exactly**, column for column. Only row 10 differs, and by a span edge
at 17.52 against a pixel centre at 17.50 -- two hundredths of a pixel, the same
class of near-miss the crossing rule has always had.

What the arch errors actually are is visible at the apex. At twenty pixels per em
Windows draws the top of one arch as a solid run of ten pixels and this draws the
two flanks with a hole between them. The scanline there passes _above_ the inner
curve's apex for Windows and _below_ it here, so Windows crosses one curve and
sees one span where this crosses two and sees two. **Near a turning point the
curve is flat, so a sixty-fourth of a pixel in where the apex sits moves the
crossing by whole pixels** -- which is why 402 of the 420 missing pixels in this
font are on arches and only 18 on the flat bars.

It is not the arithmetic's grain: quantising every placed point to sixty-fourths,
as fixed point would, takes the arches from 443 wrong pixels to 440.

One measurement worth keeping against the obvious explanation. If Windows worked
from a coarsely flattened curve rather than the curve, its spans would differ --
and flattening every quadratic into a fixed number of chords does help a little,
uniformly:

| chords per quadratic | exact | 2     | 3     | 5     | **8**     | 12    | 24    |
| -------------------- | ----- | ----- | ----- | ----- | --------- | ----- | ----- |
| letters, wrong px    | 388   | 404   | 366   | 364   | 380       | 381   | 385   |
| fabricated, wrong px | 4,338 | 4,559 | 4,357 | 4,327 | **4,306** | 4,312 | 4,335 |
| arches, wrong px     | 443   | 649   | 469   | 435   | **412**   | 418   | 440   |

It converges back to the exact answer by twenty-four chords, which says the
solver is right; the best count differs by instrument, three to five for the
letters and eight to twelve for the arches, which says the improvement is a fit
and not the mechanism. **Subdividing by flatness instead** -- the principled
version, splitting until the curve strays less than a tolerance from its chord --
is worse at every tolerance tried, 431 wrong pixels at an eighth of a pixel and
1,215 at a whole one. Nothing is shipped from this.

### A pixel with a diameter

Worth asking, because "the ink reaches further than the outline" is exactly what
a pixel with extent would produce, and because nothing here has ever had one: the
sweep samples a dimensionless point at the row's centre, and the fill asks
whether a centre lies inside a span. A pixel that is a disc rather than a point
-- the circle circumscribing the square, diameter root two -- would light whenever
the outline passed within 0.7071 of its centre.

Measured, in the general form and the restricted one, and it is not that:

|                                                       | letters          | fabricated cells | arches  |
| ----------------------------------------------------- | ---------------- | ---------------- | ------- |
| a point at the centre (shipped)                       | **388** wrong px | **4,338**        | **443** |
| a disc of radius 0.7071 anywhere on the outline       | 28,322           | 69,215           | 4,336   |
| ...radius 0.5                                         | 22,544           | 45,709           | 2,895   |
| ...radius 0.25                                        | 4,643            | 18,552           | 1,517   |
| a disc used only where the fill found nothing, 0.7071 | 632              | 11,508           | 443     |
| ...0.25                                               | 585              | 11,531           | 443     |

The general form paints a halo round every glyph, which is what a disc must do to
a straight vertical edge -- and straight vertical edges are the part this already
gets exactly right, so there is no radius small enough to help the shallow case
without ruining the upright one. The restricted form leaves the arches at 443
unchanged, which is its own result: **the arch errors are not in rescued rows at
all**, they are in rows the ordinary fill drew.

One number in it is worth keeping. The missing pixels sit a median of 0.694 of a
pixel from the nearest span edge in their own row, close enough to 0.7071 to be
worth the experiment and, having run it, a coincidence. What that distance
measures is how far a scanline near a curve's apex is from where the curve turns
over.

### What a description of the scaler's interface settles, and what it does not

`FONT_SCALER.md` describes the engine's data structures and client interface. It
is a description rather than a recording, so nothing in it is taken on its word
here; what follows is what it explains about measurements already made, and what
it makes newly worth measuring.

**It explains the width switch.** The interface sizes a monochrome bitmap from
the outline and reports its bounds -- the client asks "how much memory does this
outline need" before scan-converting. A glyph whose whole outline falls between
two pixel centres has a bitmap **zero pixels wide**, which is a case any
implementation must handle specially. The predicate this now ships,
`ceil(leftmost − 0.5) < rightmost − 0.5`, is the fill's own coverage test applied
to the entire outline rather than to one span; it was arrived at by sweeping a
font, and it turns out to be asking exactly whether that bitmap exists.

It also accounts for an asymmetry that had no explanation. A glyph covering no
_row_ gets no ink at all -- 27 of 27 sideways bars -- while a glyph covering no
_column_ gets ink anyway. A bitmap zero pixels tall has no scanlines to sweep, so
the loop never runs; one zero pixels wide still has rows, and each row's span
still has to put its ink somewhere.

**It says banding is real, and that dropout control is entangled with it.** There
are `lowerClip` and `upperClip` scanline boundaries, two banding strategies, and
the explicit note that the faster one "can preserve dropout-control behavior" --
which says the other does not. Banding was ruled out here as the cause of the
rows a widened glyph loses, and that stands: those are always the stroke's first
and last row at every size, never an interior one, where a band boundary falls at
a fixed device row and would cut a tall stroke in the middle. But dropout control
being something a band boundary can lose is a mechanism this had no idea existed,
and it predicts something testable -- at a size tall enough to need more than one
band, rescued pixels should fail on a fixed device row. Every size recorded here
is between eight and twenty-two pixels per em, which is almost certainly one
band, so the fixture cannot see it.

**It names a pixel diameter.** `pixelDiameter`, "effective pixel diameter used to
compensate for non-ideal pixel geometry", is an input to establishing a
transformation, alongside point size and resolution. So the engine does have the
concept -- but as a parameter of _scaling_, set once per transformation, not as a
sampling rule inside the scan converter. That is consistent with the measurement:
a disc of any radius applied at scan-conversion time paints a halo round every
glyph, 28,322 wrong pixels against 388, because straight vertical edges are
already exact. What is not known is what GDI passes for it, and a probe could
find out only indirectly, since it would show up as a change in scale rather than
in shape -- and the scale is already right, 927 of 927 swept advances and every
`hdmx` entry of two faces.

Nothing here contradicts anything shipped. The two things it adds to the list are
a parameter this does not model and a mechanism this cannot currently see.

### A band boundary does not break a rescued stroke

The scaler's interface says a glyph is rasterised over a scanline range and that
only the costlier of two banding strategies "can preserve dropout-control
behaviour". If GDI bands and loses that, a stroke rescued on every scanline
should fail on **one fixed device row** -- the same row for every glyph at that
size. Nothing else measured here does that: every rule found so far breaks a
stroke at its own ends, which move with the stroke.

The glyph probe cannot ask. It draws at eight to twenty-two pixels per em into a
thirty-two pixel cell, which is one band by any reckoning. So there is a second
probe, `bands`, which draws the same fabricated hairlines two hundred pixels
tall and records a **column profile** rather than a bitmap -- for each row, the
leftmost inked column, or `ff` for a row with none. A hairline standing upright
gives the same column on every row it occupies, so a break is an `ff` between two
identical values and needs no interpreting; and a profile fits the record format,
which a two hundred row bitmap does not.

It took two fonts to ask properly. `cour-hairs` could not answer: Courier New's
`prep` switches dropout control off above forty-four pixels per em, so at the
sizes a band needs there is no rescue left to break, and 79 of its 144 hairlines
are simply not drawn. **That is a confirmation of the `SCANCTRL` reading from a
direction nothing else has taken** -- the threshold was read out of the font's
program, and here it is visible as ink disappearing. `times-hairs` is the same
hairlines in the one installed face whose control lasts, to a hundred and
twenty-four.

|                 | strokes drawn covering no pixel centre | tallest  | with a hole |
| --------------- | -------------------------------------- | -------- | ----------- |
| Courier New     | 9                                      | 114 rows | **0**       |
| Times New Roman | 29                                     | 108 rows | **0**       |

Thirty-eight strokes that exist only because dropout control rescued them, up to
a hundred and fourteen scanlines tall, and **not one of them breaks**. So either
GDI does not band a glyph, or it uses the strategy that preserves dropout
control, or a band is at least a hundred and fourteen scanlines -- and for a
display that never draws a glyph taller than that, the three are the same answer.
The prediction the scaler's description made is testable, was tested, and did not
happen.

The `bands` fixtures are recorded and kept, but nothing replays them yet: the
implementation has no size limit and no banding, so it would agree by
construction, and a test that cannot fail is worth less than the recording it is
made from.

### The remaining letter error is a dilation

Measuring where each of the 388 wrong pixels sits relative to the outline -- the
distance from its centre to the nearest point of the glyph's own boundary, and
which side of it -- separates them completely:

|                                | pixels | inside the shape | outside | median distance |
| ------------------------------ | ------ | ---------------- | ------- | --------------- |
| Windows inks it, this does not | 273    | **2**            | **271** | 0.131 px        |
| this inks it, Windows does not | 115    | 51               | 64      | 0.037 px        |

**Two hundred and seventy-one of two hundred and seventy-three fall outside.**
Where this over-inks it is boundary noise -- half in, half out, sitting within
four hundredths of a pixel of the edge, which is what disagreement about a
rounding looks like. Where it under-inks it is not noise at all: Windows is
putting ink on pixels whose centres are outside the glyph, by a median of an
eighth of a pixel and 79% of them within a quarter.

So the residual is a **dilation**, and that is a different kind of thing from
everything chased in this section. A sampling rule decides whether a centre is
covered; no such rule can light a centre that is not.

Three things it is not.

**Not the scanline's height.** Sampling at `row + 0.5 + d` and sweeping `d` gives
a sharp optimum at zero -- a sixty-fourth either way costs seventy wrong pixels,
a sixteenth costs three hundred. Vertical placement is exact, which is worth
knowing on its own after so many fits with broad plateaus.

**Not a pixel with a diameter.** Already measured: any radius applied at
scan-conversion time paints a halo, because a straight vertical edge dilates as
readily as a shallow one and vertical edges are already right.

**Not a property of the boundary's slope.** Splitting the 271 by the gradient of
the nearest edge spreads them everywhere -- 34 where the edge is within a quarter
of vertical, 64 up to forty-five degrees, 116 on moderate diagonals, 34 nearly
flat. If the dilation only happened where a boundary was shallow it would be
implementable; it does not.

What is left is a well-posed question that did not exist before: **what makes
Windows ink a pixel an eighth of a pixel outside the shape, when the same rule
must not ink one on a straight edge?** Every earlier framing of the residual --
missing near-horizontal features, a rescue that picks the wrong pixel, a stub
rule that fires too often -- was a description of symptoms. This is a
description of the error.

### The sweep down columns was deleted on a degenerate glyph

It is back, and the reason it was ever removed is worth stating plainly, because
it is the same mistake this section has made twice before.

Chasing the dilation to one pixel settled it. Courier New's `E` at eight pixels
per em: the bottom bar runs from 5.672 to 6.000 in device coordinates -- **a
third of a pixel tall, lying wholly between the scanlines at 5.5 and 6.5** -- so
nothing swept along rows can see it, and Windows draws it. The bar font had said
Windows never inks a horizontal stroke that misses every scanline, 0 of 27, and
that answer is why the column sweep was deleted.

Those bars were the whole glyph. A lone sideways bar thinner than the gap
between two scanlines is a glyph covering no row centre at all -- the degenerate
case `cour-widths` found in the other direction -- and in the vertical direction
degenerate means **there are no scanlines to sweep**, so nothing could have been
drawn whatever the rule. The bars were answering a different question.

`cour-shelves` asks it properly: a tall post to give the glyph its rows, and
beside it a thin shelf whose height sweeps a whole pixel and whose thickness runs
from an eighth of a pixel to three quarters.

| shelves covering no scanline | Windows inks |
| ---------------------------- | ------------ |
| **134**                      | **134**      |

All of them, at every thickness -- 0.12 px through 0.75, six of six and ten of
ten in every band. There is no width threshold and never was; the one the old
code carried was suppressing the degenerate case, not measuring a rule.

Restoring it took one thing beyond the code that was deleted. Which row gets the
ink matters enormously and the two candidates are not close:

| the row a column rescue takes | letters                 | fabricated cells |
| ----------------------------- | ----------------------- | ---------------- |
| `ceil(from − 0.5)`            | **685**/846, **344** px | **3,824**/4,950  |
| `floor(to − 0.5)`             | 631/846, 511 px         | 3,610/4,950      |
| no column sweep at all        | 655/846, 388 px         | 3,724/4,950      |

`ceil(from − 0.5)` is the same sentence as `floor(to − 0.5)` along a row, read
down the other axis, because device rows count downward where glyph coordinates
count up -- which is what the deleted code's own comment said. The stub rule
mirrors too: a column rescue with no neighbouring column's span beyond it either
way is a tip, and applying it is worth 685 letters against 666.

**Shipped.** The recorded letters go from 655 exact and 388 wrong pixels to
**685 and 344**, the best either number has been, and the fabricated cells from
3,724 to 3,824. The fabricated pixel count rises, 4,692 to 5,049, which is the
one thing this change makes worse and is worth naming rather than burying.

The lesson is the one from `cour-crowd` and `cour-widths` again: a shape font
tests the shape it was given, and a shape that is _only_ the feature under test
is often a glyph the rasteriser handles specially. Three separate conclusions in
this section have now come from fonts too degenerate to answer the question they
were built for.

### What 344 wrong pixels are made of

With the sweep down columns restored, the remaining letter error sorts into six
kinds by tracing which line of the rasteriser put each pixel there, or would
have:

|                                                         | count  |
| ------------------------------------------------------- | ------ |
| **extra**: a rescue down a column Windows does not make | **82** |
| missing: nothing here produced it at all                | 69     |
| extra: a rescue along a row Windows does not make       | 59     |
| extra: an ordinary fill Windows does not make           | 56     |
| missing: the stub rule refused a row rescue             | 54     |
| missing: the stub rule refused a column rescue          | 24     |

Courier New at eight pixels per em is 137 of the 344 and still the worst cell by
four times.

The largest kind is the new sweep firing where it should not, and it has a very
sharp property. Asking, for each of the 82, whether Windows has ink in an
adjacent pixel instead:

| Windows' ink is   | count  |
| ----------------- | ------ |
| **one row above** | **78** |
| one row below     | 3      |
| one column left   | 1      |
| nowhere adjacent  | 0      |

**Seventy-eight of eighty-two are a single row too low.** That looks exactly like
a wrong pick, and it is not: moving every column rescue up a row costs far more
than it gains, because the 122 that are already right go wrong --

| the row a column rescue takes     | letters                 | fabricated cells |
| --------------------------------- | ----------------------- | ---------------- |
| `ceil(from − 0.5)` (shipped)      | **685**/846, **344** px | **3,824**/4,950  |
| one row above that                | 630/846, 526 px         | 3,610/4,950      |
| the row nearest the span's middle | 649/846, 419 px         | 3,685/4,950      |

-- so 200 column rescues split 122 to 78 between two adjacent rows, and no
function of the span's own ends separates them. Neither does the span's height:
the spurious ones run 0.00 to 0.97 of a pixel and the correct ones 0.00 to 0.98,
medians 0.33 against 0.59. Nor does how far the feature runs sideways: both are
runs of one column in 95% of cases.

The other half of the error is the mirror image -- 78 pixels the stub rule
refuses that Windows draws, 54 along rows and 24 down columns. So of 344 wrong
pixels, **238 are one rule deciding a rescue one way where Windows decides it the
other**, and the question is the same question on both axes: which of two
adjacent pixels a rescue belongs in, and whether it belongs at all.

### A rescue does not fire when the other candidate is already lit

Two hundred and thirty-eight of the 344 wrong pixels were one rule deciding a
rescue one way where Windows decided it the other, on both axes. The rule turns
out to be one sentence, and it comes out of a control rather than a sweep.

Of the 104 column rescues Windows does not make, **100 have Windows' ink one row
above instead.** That looked like a wrong pick, and the pick was already swept:
moving every column rescue up a row is worth 630 letters against 685, because
the 194 that are right go wrong. Two adjacent rows, 194 to 104, and no function
of the span's ends separates them -- eleven were tried and none beats simply
always taking the lower.

The control is what breaks it. Among the column rescues that are **right**,
Windows also inks the row above only 9% of the time; among the wrong ones, 96%.
So "one row up" is not the background rate of ink in a letter, it is a real
signal. And asking what _this_ draws rather than what Windows draws finds the
mechanism:

|                               | we already ink the row above | the row below |
| ----------------------------- | ---------------------------- | ------------- |
| column rescues that are right | 13%                          | 19%           |
| column rescues that are wrong | **75%**                      | 30%           |

**We are inking two pixels where Windows inks one.** The feature was already on
the grid, put there by an ordinary fill or an earlier rescue, and the rescue adds
a second below it.

So: **a rescue does not fire when the other candidate is already lit.** A rescue
always chooses between two adjacent pixels, because the span lies between their
centres; if the one it did not choose already has ink, whatever it was going to
save is drawn and a second pixel only thickens it. That is what dropout control
is _for_, which makes declining the rule rather than an exception to it.

It applies on both axes, and which neighbour is "the other candidate" follows
from the pick:

|               | the pick takes                    | so the guard is            | letters                             |
| ------------- | --------------------------------- | -------------------------- | ----------------------------------- |
| along a row   | `floor(to − 0.5)`, the left pixel | the pixel to the **right** | **731**, against 699 guarding left  |
| down a column | `ceil(from − 0.5)`, the lower row | the row **above**          | **713**, against 688 guarding below |

Guarding on the neighbour the rescue actually chose is worth much less, which is
the check that it is the _other_ candidate that matters and not merely having a
neighbour at all.

**Shipped, and it is the largest single gain in this section.**

|        | letters                       | fabricated cells                    |
| ------ | ----------------------------- | ----------------------------------- |
| before | 685/846, 344 wrong px         | 3,824/4,950, 5,049 wrong px         |
| after  | **731**/846, **264** wrong px | **3,865**/4,950, **4,666** wrong px |

Both instruments, both counts. The recorded letters are six sevenths exact, from
two thirds when this section began.

### The outline arrives in sixty-fourths

Decomposing what the guard left, one kind stands out for being almost never
wrong. Of **18,662 ordinary fills** -- pixels lit because their centre lies
inside a span, the commonest thing the rasteriser does -- only **56** disagree
with Windows. And those 56 are not scattered:

| distance from the pixel's centre to the nearer edge of its span |                                                  |
| --------------------------------------------------------------- | ------------------------------------------------ |
| the 56 that are wrong                                           | min 0.000, q1 0.005, **median 0.016**, max 1.004 |
| the 18,606 that are right                                       | min 0.000, q1 0.401, **median 0.500**            |

They sit a sixty-fourth of a pixel inside the span, where a correct one sits half
a pixel in. So Windows' edge is a hair the other side of the centre from ours,
and the hair is about the size of a fixed-point unit.

**It is not the crossing's arithmetic.** Rounding the computed intersection to
sixty-fourths costs 36 letters, flooring 51, ceiling 10 -- exact wins outright,
which is the third time that has been measured and the first time on this
rasteriser.

**It is the coordinates.** The scaler's interface hands the scan converter
outline points "in fixed-point representation", and F26Dot6 is what a scaled
TrueType outline is carried in. Placing every point on that grid before
intersecting anything:

|                   | letters                 | fabricated cells              |
| ----------------- | ----------------------- | ----------------------------- |
| exact             | **731**/846, **264** px | 3,865/4,950, 4,666 px         |
| rounded to 1/64   | 727/846, 266 px         | **3,904**/4,950, **4,505** px |
| truncated to 1/64 | 729/846, 268 px         | 3,818/4,950, 4,800 px         |
| ceiled to 1/64    | 727/846, 266 px         | 3,838/4,950, 4,661 px         |

Rounding beats truncating by 86 cells and ceiling by 66, so it is rounding
specifically and not merely quantising -- which is what the interpreter's own
`mulDiv` does everywhere else.

**Shipped**, at a cost of four recorded letters and two wrong pixels. That is the
one change in this section made against the letters rather than for them, and the
reason is that it models the machine: a hinted glyph already arrives on the
sixty-fourth grid, so this changes nothing for most of the fixture and everything
for the two places where the outline is scaled here instead -- the shape fonts,
and Courier New at the size where `INSTCTRL` turns grid-fitting off.

### Everything left is a decision, not a gap

With the guard shipped and the outline on the sixty-fourth grid, the 266 wrong
pixels were re-decomposed and every knob re-swept. Nothing moved, and the reason
is worth recording as clearly as a change would be.

**The geometry is complete.** For each pixel Windows inks and this does not,
asking whether either sweep found a span near it:

|                                         | count |
| --------------------------------------- | ----- |
| a row span **and** a column span nearby | 133   |
| a row span only                         | 10    |
| a column span only                      | 7     |
| **neither**                             | **2** |

Two pixels in the whole fixture are out of reach of both sweeps. Everything else
was found and then declined. So there is no missing mechanism left to look for in
this part of the rasteriser -- what remains is entirely which of the found spans
gets ink.

**Both stub rules earn their place**, and the tension is the familiar one:

|                           | letters         | fabricated cells    |
| ------------------------- | --------------- | ------------------- |
| both (shipped)            | 727, 266 px     | **3,904**, 4,505 px |
| no stub rule along rows   | **728, 244 px** | 3,372, 6,019 px     |
| no stub rule down columns | 706, 323 px     | 3,651, 5,376 px     |
| neither                   | 696, 293 px     | 2,920, 6,934 px     |

Dropping the row rule buys 22 wrong pixels on the letters and costs 532
fabricated cells. The fabricated set is the one with exact outlines, so it is the
better witness about a rule; the letters are the target. Kept.

**Refusing a tip at either end is still right on both axes.** Refusing only when
a rescue is isolated at both ends is worth 730 letters and 241 pixels -- better
than shipped -- and 3,405 fabricated cells against 3,904. Every other mode is
worse on both.

**Rows before columns.** The two sweeps are not commutative now that a rescue
declines when the other candidate is already lit, so which runs first is a real
choice: rows first is 727 letters and 266 wrong pixels, columns first 721 and
306, with the fabricated cells 3,904 against 3,889. Rows first, which is also the
order the sweep is written in.

Two earlier attempts at that last measurement returned 211,871 wrong pixels,
which is not a result -- reordering the blocks left `touching` used before it was
declared, so every glyph threw and drew nothing. Recorded because a number that
absurd is easy to catch and a number merely wrong is not.

### The bottom bar of an `E`

Half of what is left is one cell -- 135 of 266 wrong pixels at Courier New,
eight pixels per em -- and looking at its worst letters shows one shape over and
over. The bottom bars of `E`, `B` and `d`:

```
        windows    ours
   4    ..#.....   ..#.....
   5    ..####..   ........
   6    ........   ...##...
```

Windows draws the bar at row 5 across four columns. This draws two pixels at
row 6. The geometry is not in doubt: the bar gives a column span of `[5.672,
6.000]` at columns 2, 3, 4 and 5, and Windows inks exactly those four columns.

Two things are wrong and they are different things. The **row** is one too low:
`ceil(from − 0.5)` is 6 where `floor(to − 0.5)` is 5, and Windows takes 5. And
**two of the four columns are suppressed**, by the guard or the tip rule.

Neither has a fix that survives contact with the rest of the fixture.

**The row.** Re-sweeping the column pick now that the guard exists -- the two
interact, so the earlier sweep does not settle it -- leaves `ceil(from − 0.5)`
ahead by a distance: 727 letters and 266 wrong pixels against 644 and 470 for
`floor(to − 0.5)`, and 682 and 351 for the midpoint. The `E` is a minority of its
own kind.

**Nearest is not it either.** For this bar the centre at 5.5 is 0.172 away and
the one at 6.5 is 0.5 away, so "take the pixel whose centre is closest to the
stroke" gets it right. Implemented on both axes it is worse everywhere: 677
letters when applied down columns, 677 when applied along rows, 629 when applied
to both, against 727.

So the cell that carries half the error carries it in a shape this can see, name
and reproduce, and cannot fix without losing more elsewhere. That is a different
position from not knowing what is wrong, and it is where this stops for now:
every knob at its measured optimum, the geometry complete, and one recurring
figure -- a horizontal bar lying between two scanlines at the bottom of a letter
-- that the rules get a row low.

### A stroke joins what it is attached to

The bottom bar of an `E` is a horizontal stroke between two scanlines with a stem
standing on it. `cour-shelves` had established that such a stroke gets ink, but
its shelf stood in open space beside a post; it never put one _underneath_
something already drawn. `cour-feet` does -- one contour shaped like a post on a
foot, six thicknesses by six heights -- and it reproduces the letter exactly:
Windows draws the foot on the post's last row and across all four of its columns,
where this draws two pixels a row below.

The two fonts settle the question between them, and they disagree completely:

| the row a column rescue takes | cour-shelves | cour-feet   |
| ----------------------------- | ------------ | ----------- |
| `ceil(from − 0.5)`, the lower | **258/258**  | 142/258     |
| `floor(to − 0.5)`, the upper  | 122/258      | **258/258** |

Each font is perfect under one and poor under the other, which is what two
populations look like when a font has been built for each. What separates them is
not the span: it is whether the stroke is **attached to something already drawn**.
A shelf in open space starts its own row; a foot joins the row the stem ends on.

So the rule is continuity, and it can only be asked once the sweep along rows has
run: **take the other of the two candidate rows when a column beside this one
already has ink there and none in the row this would otherwise take.** The second
half matters -- joining whenever a neighbour has ink above, without requiring it
to have none below, drags every rescue toward any ink at all and is worth 647
letters against 722.

**Shipped**, and it is the first change here that improves the wrong-pixel count
on both instruments at once while costing exact cells on one:

|        | letters             | fabricated cells              |
| ------ | ------------------- | ----------------------------- |
| before | 727/846, 266 px     | 4,046/5,208, 5,155 px         |
| after  | 722/846, **249** px | **4,084**/5,208, **5,082** px |

`cour-feet` goes from 142 exact to 214 and `cour-shelves` stays at 258 of 258 --
the rule fires where it was derived and not where it would do harm. The five
letters lost are the price of a mechanism that two fonts agree on.

### What the pseudocode confirms, and what it does not

`FONT_PSEUDOCODE.md` describes the rendering routines rather than the interface.
It is still a description and not a recording, so what follows is what it says
about decisions already measured here, and it is worth reading in that order:
four of them were arrived at from the recordings and are confirmed, which is a
better result than being told them would have been.

**Scanlines are at pixel centres.** `CalcHorizLineSubpix` computes its crossing
at `yScan << SUBSHFT + SUBHALF` -- the row plus half a pixel, in sixty-fourths.
Sweeping the sampling height found a sharp optimum at exactly that and nowhere
else.

**The sweep down columns exists, and only when dropout control does.** `CalcLine`
has two branches. Without dropout control it walks each edge adding _horizontal_
scan entries only; with it, the same walk adds a **vertical** entry whenever the
DDA steps in x and a horizontal one whenever it steps in y. So Windows does not
run a second pass down columns -- it emits both lists from one edge walk -- but
the crossings that pass produces are the crossings a column sweep produces, and
they exist exactly when `SCANCTRL` says they do. Deleting that sweep on the
strength of a degenerate bar font was wrong, and `cour-shelves` had already said
so.

**A rescue looks at pixels that are already set.** `ProcessContour`, whose stated
purpose is "process a contour for dropout control", checks "if there are pixels
above or below the current point to determine if dropout is needed". That is the
guard, which was derived here from 200 column rescues and a control, and shipped
two commits ago.

**The outline is in fixed point**, which was shipped last commit on the strength
of the interface description and 56 misplaced fills.

**A stub is a question about topology.** `CheckHorizTopology` branches entirely
on the relative order of the three points around a vertex -- whether `x1` lies
between `x0` and `x2` or turns back -- which is the "outline turns back" reading
that was tried here and lost to a geometric test. The geometric test wins on the
recordings by a distance, so this stays as it is; but it says the shape of the
real rule is topological and the tip test is standing in for it.

One thing in it was testable and is measured. `AddVertOn` computes its scanline
as `(fxY1 + SUBHALF - 1) >> SUBSHFT` where `AddVertOff` uses `(fxY1 + SUBHALF)`,
and the horizontal pair are identical to each other -- a one-subpixel asymmetry
that exists only down columns and only for a vertex landing exactly on a
scanline. Flipping the half-open test in `crossesDown` to match is worth **one
wrong pixel**, 248 against 249, with the fabricated cells unmoved. Exact ties are
too rare in this fixture to say more, so nothing is shipped from it.

What it offers that has not been tried: `ProcessContour` decides "if the contour
is near the edges by counting vertical and horizontal crossings", and adjusts its
chosen position "based on the scan kind (smart or simple)". Neither crossing
counts nor a smart/simple branch exists here -- `SCANTYPE` is read from the
font's `prep` and then used only as a yes or no.

### The crossing counts, tried three ways

`ProcessContour` verifies "if the contour is near the edges by counting vertical
and horizontal crossings" before it sets a dropout pixel, and `CountHorizCrossings`
and `CountVertCrossings` are described but not written out -- the document gives
their purpose and parameters and stops. So this is three readings of an English
sentence, measured against the recordings.

**That the pixel must have contour in it.** The most literal reading: the cell a
rescue lights has to be one the span actually passes through. Preferring the
candidate whose cell holds the span is worth 714 letters against 722; requiring
it, 713. Both are worse on the fabricated cells too, 4,045 and 4,025 against
4,084.

**That the counts are a parity test**, which is what crossing counts classically
compute -- walk the crossings recorded for a scanline, count how many lie beyond
a given x, and an odd answer means inside. Preferring the candidate the parity
favours changes **nothing at all**: 722 letters and 4,084 cells, identical to the
last digit, because the parity is the same on both candidate rows in every case
this fixture contains. Requiring it is much worse, 663 letters and 366 wrong
pixels.

So the mechanism named in the pseudocode does not, in any reading this could
find, improve on what the recordings already produced. That is worth recording
for the same reason the negatives about FreeType-shaped ideas were: a description
of the real routine is a strong hypothesis and still only a hypothesis, and three
attempts to turn one sentence of it into a rule all lost to a rule measured from
the pixels.

What would settle it is the body of those two functions rather than their
purpose. Until then the sentence is a lead that has been followed as far as it
goes.

### The stub test is a crossing count

`FONT_PIXEL_CANDIDATES.md` gives the scan converter in full -- the DDA that walks
each edge, the lists it fills, the dropout pass and both placement modes. It is
itself a reconstruction "as determined by test fixtures and observation", so it
is a hypothesis; but it is a detailed one, and it can be checked against six
things already measured here.

**Five of them agree, and two are provable rather than merely consistent.**

`ScanAbove(p) = ((p + 32) & -64) + 32` is, in pixels, `ceil(p − 0.5)` -- the pick
this ships. And the dropout condition is not "no centre inside the span" but a
**zero-length run**, `onList[i] == offList[i]`: the two edges of a span rounding
into the same pixel. Those are the same test. Writing `a = ceil(from − 0.5)`, a
span covers a centre exactly when `a < to − 0.5`, and since `ceil(to − 0.5) ≥ a`
always, failing that is exactly `ceil(to − 0.5) == a`. Two descriptions of one
line of arithmetic.

The scanline sits at `(y << 6) + 32`, a row plus half a pixel. Simple placement
is `xDrop--`, one pixel left of the on pixel, which is `floor(to − 0.5)`. And the
guard is two calls: `GetBit(xDrop − 1)` and `GetBit(xDrop)` -- the candidate
itself and its neighbour. In simple mode the first is vacuous, because the
candidate _is_ `xDrop − 1` and setting an already-set pixel changes nothing. **So
the one-sided guard shipped here is what the two-sided one reduces to**, which is
why it measured as well as it did.

**All four installed faces ask for `SCANTYPE` 1** -- simple dropout control
excluding stubs -- so the smart branch, which averages the two edges' subpixel
intersections and places the ink at their midpoint, never runs. That retires the
midpoint rules swept earlier: they were not close, and now they are not
applicable.

**The sixth is new, and it is worth 55 wrong pixels.** Stub exclusion is a
crossing count:

```
cross  = CountHorizCrossings(xDrop, yDrop + 1)
cross += CountVertCrossings(xDrop - 1, yDrop + 1)
cross += CountVertCrossings(xDrop, yDrop + 1)
if cross < 2: return          # does not continue above
```

-- and the same below. Two crossings between three neighbouring cells, or the
stroke does not continue that way and gets no pixel. Implemented with the
crossing lists kept as pixel indices, and taken about the **on** pixel rather
than the pixel being lit:

|                               | letters                 | fabricated cells              |
| ----------------------------- | ----------------------- | ----------------------------- |
| proximity, both axes (before) | 722/846, 249 px         | 4,084/5,208, 5,082 px         |
| counts along rows             | **733**/846, **194** px | **4,346**/5,208, **4,660** px |
| counts down columns as well   | 701/846, 249 px         | 4,317/5,208, 4,659 px         |
| counts down columns only      | 691/846, 295 px         | 3,998/5,208, 5,063 px         |

**Shipped along rows**, where it improves every count at once -- eleven letters,
55 wrong pixels, 262 fabricated cells and 422 fabricated pixels. Not down
columns, where it is worse: the vertical lists here are built by a second sweep,
where Windows fills both from the one edge walk, so the counts down a column are
not the same numbers.

The y sense had to be measured rather than read: the pseudocode counts upward and
this counts down, and taking `yDrop + 1` as the device row below rather than above
is worth 631 letters against 733.

### The fill bound, confirmed

`Blit` fills `range(xStart, xStop)` where `xStart` and `xStop` are a run's on and
off pixels -- the pseudocode's `xStop - 1` was a transcription slip. Since the on
pixel is `ceil(from − 0.5)` and the off pixel `ceil(to − 0.5)`, that fills
`ceil(from − 0.5)` up to `ceil(to − 0.5) − 1` inclusive.

This fills `column < to − 0.5` from the same start, and the two are the same set:
for any `to`, `column < to − 0.5` holds exactly when `column ≤ ceil(to − 0.5) − 1`,
including when `to − 0.5` is an integer and the bound is a tie. Checked over four
hundred thousand random spans and every half-integer pair in range -- **identical
in every case**. So the ordinary fill, which is 18,606 of 18,662 pixels right,
needs no change, and the one part of the rasteriser that was never in question is
now confirmed from the other direction.

### On and off round a tie in opposite directions

`BeginElement` is in the file after all -- it was missed by reading around it,
not absent -- and it settles the on/off question in four lines: a crossing goes
in the **on** list when its edge travels up (quadrant 1 or 2) and the **off**
list when it travels down, and correspondingly left or right for the vertical
lists. That is the winding sign this already computes, so the two implementations
agree, and it also shows the crossing counts sum **both** lists, which is why the
count test shipped without needing the split.

What it did carry was an asymmetry visible in the four endpoint adders:

|               | rounds an edge at                                | ties     |
| ------------- | ------------------------------------------------ | -------- |
| `AddHorizOn`  | `(x + SUBHALF − 1) >> SUBSHFT` = `ceil(p − 0.5)` | **down** |
| `AddHorizOff` | `(x + SUBHALF) >> SUBSHFT` = `floor(p + 0.5)`    | **up**   |

The two agree at every position except one exactly on a pixel centre, where the
edge that opens a run rounds down and the edge that closes one rounds up. So a
run that ends exactly on a centre is a pixel **longer** than this was drawing it.
`Blit`'s range is `xStart` to `xStop` -- the `xStop - 1` in the pseudocode was a
transcription slip, confirmed -- so the fill bound is the off pixel, and the off
pixel is `floor(to + 0.5)`.

Both halves measured, and both improve every count:

|                                    | letters                 | fabricated cells              |
| ---------------------------------- | ----------------------- | ----------------------------- |
| before                             | 733/846, 194 px         | 4,346/5,208, 4,660 px         |
| the off pixel in the fill bound    | 744/846, 180 px         | 4,365/5,208, 4,614 px         |
| the same tie in the crossing lists | 733/846, 194 px         | 4,348/5,208, 4,656 px         |
| **both**                           | **744**/846, **180** px | **4,367**/5,208, **4,610** px |

**Shipped.** The fill bound is worth eleven letters and fourteen wrong pixels on
its own; the crossing lists add two fabricated cells. Neither is a fit -- both are
one line of the scan converter's own arithmetic, and they only ever act on an
edge landing exactly on a centre, which is rare enough that the gain is entirely
in cases nothing else could have reached.

The recorded letters are 744 of 846 at 180 wrong pixels, from 654 and 369 when
this section began.

### The architectural difference, measured and mostly retracted

It was claimed here that Windows filling both crossing lists from one DDA walk,
where this runs a second analytic sweep down columns, was the likely reason the
crossing counts help along rows and hurt down them. That claim was asserted, not
measured. Measured, it is wrong.

`CalcLine` was implemented exactly as the pseudocode gives it -- `ScanAbove`,
`ScanBelow`, the quadrant reflection, the cross-product DDA -- and its emitted
crossings compared with this rasteriser's analytic ones over two hundred thousand
random segments in sixty-fourths:

|                    | identical | differing |
| ------------------ | --------- | --------- |
| horizontal entries | 196,649   | 3,351     |
| vertical entries   | 196,670   | 3,330     |

**98.3% identical**, and the differences are not spread. Of 6,593 segments where
the two disagree, **6,522 have an endpoint lying exactly on a scanline centre** --
where the DDA deliberately emits nothing and the topology functions take over --
and the remaining 71 are a crossing landing exactly on a pixel centre in the
other axis, the same tie the on/off pair rounds in opposite directions. There is
no general disagreement between a DDA and an exact sweep to explain anything.

**What the topology functions do differ on is real, and rarer than it looks.**
For a vertex lying exactly on a scanline, comparing the half-open test against
`CheckHorizTopology`:

| the outline at that vertex    | this emits | Windows emits |
| ----------------------------- | ---------- | ------------- |
| passes through, rising        | 1          | 1             |
| passes through, falling       | 1          | 1             |
| turns back, local minimum     | 2          | 2             |
| **turns back, local maximum** | **0**      | **2**         |

Two entries at one place is a run of zero length, which is a dropout: Windows
draws a pixel at a local maximum sitting on a scanline and a half-open sweep
draws nothing there. It cannot be reproduced by any adjustment of `keeps`.

Counting how often that arises: 661 of the fixture's 22,106 vertices sit exactly
on a scanline, but only **four** of them are local maxima. Implemented -- the
turning vertices collected per contour and an `on`/`off` pair pushed at each --
it changes **not one pixel**: 744 letters and 180 wrong pixels either way, 4,367
fabricated cells either way. So the code is not kept.

That also corrects a figure quoted a moment earlier. Sixty-one per cent of glyphs
have a vertex exactly on a scanline, which sounded like a common case; almost all
of them are pass-throughs, where the half-open test already emits the one
crossing Windows emits. The interesting case is four vertices in eight hundred
and forty-six glyphs.

So the two implementations are not architecturally apart in the way that was
claimed. Why the crossing counts help along rows and hurt down columns is
**unexplained**, and the explanation offered before was a guess that did not
survive being checked.

### Why the column counts hurt: they were written symmetric

The answer was in the pseudocode all along, and the reason it was missed is that
the two stub tests **are not mirror images of each other**. Set side by side:

```
PerformHorizDropout, at (xDrop, yDrop)
  above:  CountHoriz(xDrop, yDrop+1) + CountVert(xDrop-1, yDrop+1) + CountVert(xDrop, yDrop+1)
  below:  CountHoriz(xDrop, yDrop-1) + CountVert(xDrop-1, yDrop)   + CountVert(xDrop, yDrop)

PerformVertDropout, at (xDrop, yDrop)
  left:   CountVert(xDrop-1, yDrop)  + CountHoriz(xDrop, yDrop)    + CountHoriz(xDrop, yDrop-1)
  right:  CountVert(xDrop+1, yDrop)  + CountHoriz(xDrop+1, yDrop)  + CountHoriz(xDrop+1, yDrop-1)
```

The horizontal pair reads its vertical counts from columns `xDrop − 1` **and**
`xDrop` in both directions. The vertical pair does not do the matching thing: its
left test reads horizontal counts from column **`xDrop`** and its right test from
column **`xDrop + 1`**. Neither test reads `xDrop − 1`.

The implementation here had been written the symmetric way -- far column for both
sides, `x − 1` on the left and `x + 1` on the right -- because that is what a rule
about "does the stroke continue that way" looks like when you write it yourself.
It is off by one column on one side only. Corrected:

| the vertical stub test                 | letters             | fabricated cells          |
| -------------------------------------- | ------------------- | ------------------------- |
| proximity, as before                   | 744/846, 180 px     | 4,367/5,208, 4,610 px     |
| counts, written symmetric              | 691/846, 295 px     | 3,998/5,208, 5,063 px     |
| **counts, as the pseudocode has them** | **747**/846, 184 px | **4,375**/5,208, 4,657 px |

Fifty-six letters between the symmetric version and the faithful one, on one
column of difference.

The asymmetry has a reason: a vertical crossing recorded at column `c` lies
between columns `c − 1` and `c`, so the horizontal crossings bounding it on the
left are the ones at `c` and on the right the ones at `c + 1`. The horizontal
test's own `xDrop − 1` and `xDrop` pair is the same fact seen from the other
side.

**Shipped**, with the cost named: three more letters exact and eight more
fabricated cells, against four and forty-seven more wrong pixels. It goes in
because it replaces a proximity heuristic invented here with the mechanism the
scan converter actually states, and because the count of glyphs drawn exactly --
which is what the fixture reports -- improves on both instruments at once. The
same reasoning shipped fixed-point placement against a four-letter cost.

The tie sense on the horizontal crossing list was corrected with it. A crossing
belongs to the `on` list when its edge travels **up the glyph**, which is
_decreasing_ device y, so the winding recorded here -- positive where device y
increases -- marks the `off` crossings, not the on ones. It had been the wrong way
round, worth three fabricated pixels, and is now right for the reason rather than
by measurement.

The recorded letters are **747 of 846** at 184 wrong pixels.

### Two corrections the comparison found, worth no pixels

Reading the two implementations side by side turns up places where this is
knowingly doing something the scan converter does not, whether or not the fixture
can see it.

**Dropout control was hardcoded on.** `Surface.outlineText` passed `dropout:
true` to every fill, while the interpreter has been computing the real answer
from `SCANCTRL` all along and handing it back as `fitted.dropout`. It is not
always yes: **Arial turns dropout control off above sixteen pixels per em**, so
`lfHeight` 24 -- twenty-one pixels per em, forty-two of the recorded glyphs -- was
being drawn as though the font had asked for rescues it explicitly declined.

**The sweep down columns ran unconditionally.** `Setup` allocates the vertical
lists only `if !(scanKind & NoDropout)`, `CalcLine`'s no-dropout branch emits no
vertical entries at all, and `Blit` calls `FindDropouts` only when dropout
control is on. A glyph drawn without it has no column sweep to make.

Both are now right, and **neither changes a single pixel**: 747 letters and 184
wrong pixels before and after, 4,375 fabricated cells and 4,657 either way, and
Arial at `lfHeight` 24 is 31 of 42 with 15 wrong pixels in both. At twenty-one
pixels per em nothing in that face is thin enough to need rescuing, so the
mechanism that was wrongly enabled never fired.

They are kept anyway, which is a different judgement from the one made about the
turning-vertex pairs a moment ago. That was twenty lines of new machinery
supported by no measurement; these are two lines removing a known incorrectness,
and a font asking for no dropout control at a size where strokes _are_ thin would
show the difference immediately. The fixture has no such font, which is a fact
about the fixture.

### An invented rule removed, and the fixture improves

Comparing further turned up an ordering effect that should not have existed.
Applying the column rescues in reverse -- last column first, and bottom to top
within each -- was worth 748 letters against 747 and 4,384 fabricated cells
against 4,375. Nothing in `PerformVertDropout` depends on the order columns are
swept in: it reads `GetBit` twice, both times in its **own** column.

The order-dependence was entirely from a rule invented here. Section 6 records a
continuity rule -- a rescued stroke taking the other of its two candidate rows
when a column beside it had already been decided into that row -- derived from
`cour-feet` and shipped for five letters. It reads its _neighbours'_ pixels, so
which neighbour has been decided first changes the answer. The scan converter has
no such rule.

Removing it:

|                          | letters             | fabricated cells              |
| ------------------------ | ------------------- | ----------------------------- |
| with the continuity rule | 747/846, 184 px     | 4,375/5,208, 4,657 px         |
| **without it**           | **760**/846, 199 px | **4,443**/5,208, **4,597** px |

Thirteen more letters exact, sixty-eight more fabricated cells, sixty fewer
fabricated wrong pixels -- three of the four counts better, and the fourth
fifteen pixels worse. And with it gone the sweep order stops mattering: 199
pixels natural against 195 reversed, where before it was 184 against 175. The
order the pseudocode gives -- columns ascending, and within a column the list
walked back to front, which works out as top of the glyph downward, exactly what
this does naturally -- is now what is shipped, because there is no longer a
reason to prefer anything else.

That the rule was worth five letters when it was fitted and costs thirteen once
the rest of the rasteriser is right is the ordinary fate of a compensating
fiction. It was measured on two fabricated fonts and it was real; what it was
compensating for was the stub test being a proximity heuristic, and the crossing
counts have since replaced that.

**760 of 846 recorded letters exact** -- nine tenths -- at 199 wrong pixels.

### What still does not map, stated as questions

Everything invented here that the scan converter contradicts has now been
removed. What is left that has no counterpart in `FONT_PIXEL_CANDIDATES.md` is
three things, and none of them can be resolved by reading it again -- so they are
recorded as questions rather than guessed at.

**1. The narrow-glyph rule has no counterpart, and is not the bounding-box clamp.**
A glyph whose whole outline falls between two pixel centres takes
`ceil(from − 0.5)` here where every other glyph takes `floor(to − 0.5)`. It was
measured on `cour-widths` -- 144 of 144, the switch landing on the pixel centre at
four different sizes -- and removing it costs **451 fabricated cells and 6,494
wrong pixels**, while leaving the recorded letters untouched at 760 and 199,
because no letter is ever that narrow.

`PerformHorizDropout` has no such branch: simple placement is `xDrop--`, always.
The one mechanism in it that could produce the same effect is the clamp,

```
if xDrop < boxLeft:   xDrop = boxLeft
if xDrop >= boxRight: xDrop = boxRight - 1
```

but the pseudocode never says how `boxLeft` and `boxRight` are computed, and no
definition tried reproduces the behaviour. Taking `boxLeft = ceil(xMin − 0.5)`
makes the narrow case right and breaks wide glyphs whose ink starts near the left
edge -- 19,867 of 132,208 dropout spans placed differently. Taking
`boxLeft = floor(xMin)` leaves wide glyphs alone and makes the narrow bar land on
pixel 4 where Windows draws pixel 5. **The open question is what the glyph's box
is measured from.**

**2. The frame mapping for the sweep down columns is unverified.** The row pick
is `floor(to − 0.5)`, which is provably `xDrop--`. The column pick is
`ceil(from − 0.5)`, which beats the other candidate 685 to 631 -- but whether it
_is_ `yDrop--` depends on how the pseudocode's y-up row index maps onto a device
row counting down, and every attempt to derive that from the text has had to be
settled by measurement instead. The stub counts down columns needed the same
treatment: `yDrop + 1` had to be read as the device row _below_ rather than
above, worth 733 letters against 631. **The open question is the sign convention
between `CONTEXT`'s rows and the bitmap's.**

**3. A vertex exactly on a scanline where the outline turns back.**
`CheckHorizTopology` emits an `on` and an `off` there -- a zero-length run, so a
dropout pixel -- and a half-open sweep emits nothing. It is implementable and was
implemented; it fires four times in 846 glyphs and changes no pixel, so it is not
carried. **No question outstanding, only a note that the fixture cannot exercise
it.**

Two things were confirmed still to be earning their place while checking the
above. The `GetBit` guard is worth 34 letters and 61 wrong pixels -- without it
760 and 199 become 726 and 260 -- and it is in the pseudocode, so it stays. And
the narrow-glyph rule's effect is confined entirely to the fabricated fonts,
which is what one would expect of a rule about glyphs narrower than a pixel.

### The narrow-glyph rule was the bounding-box clamp after all

`Setup` takes the bounding box as a **parameter** -- it is the caller's, not
computed in the scan converter -- and that is what makes it findable: everything
else indexes from it. `Blit` fills at `onList[i] - boxLeft`, `GetBit` reads
`BITMAP[hiBitBand - 1 - y][x - boxLeft]`, and `PerformHorizDropout` clamps its
chosen pixel into it. So the box is the extent of the bitmap the runs are written
into, and it can be measured the same way the runs are.

Two readings were tried. **From the runs** -- the leftmost pixel any run starts at
-- fails for exactly the case in question: a glyph narrower than the gap between
two pixel centres has no runs at all, every span being a dropout, so there is
nothing to measure. It scores 3,700 fabricated cells against 4,443. **From the
outline**, rounded as the on and off pixels are:

```
boxLeft  = ceil(xMin - 0.5)
boxRight = max(boxLeft + 1, floor(xMax + 0.5))
```

That is it.

|                                  | letters                 | fabricated cells          | bars and widths       |
| -------------------------------- | ----------------------- | ------------------------- | --------------------- |
| the invented narrow-glyph branch | 760/846, 199 px         | 4,443/5,208, 4,597 px     | 324/516, 1,832 px     |
| **the box clamp**                | **761**/846, **178** px | 4,442/5,208, **3,087** px | 324/516, **1,090** px |
| neither                          | 760/846, 199 px         | 3,992/5,208, 11,091 px    | 275/516, 2,730 px     |

**A third off the fabricated wrong pixels**, 4,597 to 3,087, and forty per cent
off the two fonts built to test glyph width. The invented branch is gone; what
replaces it is one line of the pseudocode.

Why it works is worth stating, because it is not obvious from the clamp: a glyph
narrower than a pixel has every span a dropout, so its ink is placed at
`floor(to − 0.5)`, one pixel left of the only column it occupies -- and the clamp
puts it back. `boxRight` is at least one past `boxLeft` because a bitmap cannot be
zero pixels wide, which is the whole of the special-casing.

One thing did **not** come from the pseudocode and is kept as a divergence. The
stub test is gated here on the glyph being wide enough to cover a sample column,
where `PerformHorizDropout` applies it whenever stub control is on. Removing the
gate costs 451 fabricated cells and 3,761 wrong pixels. Every one of those is a
narrow glyph -- the letters do not move at all, 761 and 178 either way -- so the
question is what the crossing counts do for a glyph one column wide, where a
stroke has no neighbouring column to continue into. **Recorded as the remaining
divergence.**

### What the banding machinery is for

The scan converter renders a glyph in as many passes as the caller asks for, and
`saveRow` is not the reason for that -- it is the reason multiple passes give the
same answer as one.

**Where the two are told apart.** `AddHoriz` dispatches on
`hiScanBand == boxTop && loScanBand == boxBottom`: when the scan band covers the
whole box it appends through `AddHorizSimpleScan`, and otherwise through
`AddHorizSimpleBand`, which range-checks `y < loScanBand || y >= hiScanBand` and
**discards** anything outside. The two variants also normalise differently --
`y -= boxBottom` against `y -= loScanBand` -- which is what makes the band's lists
band-sized. That is the small-memory strategy: scan the whole outline again for
each band and keep only the rows that band covers.

**What breaks when you do that, and what `saveRow` fixes.** Dropout control reads
pixels that are already drawn. `PerformHorizDropout` reads `GetBit` twice in its
own row, which is always inside the current band. `PerformVertDropout` reads
`GetBit(xDrop, yDrop − 1)` -- **the row below** -- which at the bottom edge of a
band belongs to the previous pass and has already been emitted. Without something
kept back, a vertical dropout on a band boundary would decide differently from
the way it decides in a single pass, and a stroke would gain or lose a pixel at a
seam invisible to the font.

So the band is rendered one row taller than it emits. `Blit`'s tail, taken only
when `originalLoBand != loScanBand` -- that is, only when banding -- pulls back
twice, "to the overscan row" and then "to the low row", copies the saved row into
place, and records `lastRowIndex = loBitBand + 1` for the next pass. `GetBit`'s
second branch is the other half: a read at exactly `lastRowIndex` is answered from
the kept row rather than refused as out of range. `Setup` starts it at infinity so
that the first band, which has nothing below it, falls through to the `return 0`
and reads clear.

That is what the interface description means by one strategy costing "additional
persistent workspace" and being the one that "can preserve dropout-control
behaviour": the persistent workspace is the kept row.

**A note on the estimate.** `GetBit`'s cached branch reads
`BITMAP[hiBitBand − 1 − y][x]`, but it is reached only when `y` is _outside_
`[loBitBand, hiBitBand)` -- the first branch would have caught it otherwise -- so
that index is out of the bitmap by construction. The kept row is `pulLastRow`,
which `Setup` allocates and nothing else in the transcription reads, so the branch
is presumably `pulLastRow[x]`. It makes no difference here: **nothing in this
project bands.** Every glyph recorded is drawn in one pass, `hiScanBand` and
`loScanBand` equal the box, `lastRowIndex` stays at its sentinel, and both
branches are unreachable.

### The banding is ignorable; the box is not

Banding can be left out, and the evidence for that is not just that memory is
cheap now. The display driver declares `RC_BANDING` clear. The `bands` probe drew
fabricated hairlines two hundred pixels tall and found **no seam in 38 rescued
strokes up to 114 scanlines**, which is what a band boundary losing dropout
control would have shown. And every glyph recorded here is drawn in one pass, so
`hiScanBand` equals `boxTop`, `loScanBand` equals `boxBottom`, `lastRowIndex`
never leaves its sentinel, and both of `GetBit`'s band branches are unreachable.

But when the band collapses into the box, **the box does not collapse with it**.
It is a separate parameter and it is load-bearing in four places -- `Blit` offsets
by `boxLeft`, `GetBit` and `SetBit` index from it, and both dropout routines cap
their chosen pixel into it. The horizontal cap turned out to be the whole of the
narrow-glyph behaviour. The vertical one is its exact mirror and had not been
implemented:

```
if yDrop < boxBottom: yDrop = boxBottom
if yDrop >= boxTop:   yDrop = boxTop - 1
```

This had been discarding a column rescue that fell outside the bitmap instead of
capping it into the glyph's box. Measured, with the box taken from the outline's
y extent the way the horizontal one is taken from its x extent -- and the ends
swapped, because device rows count down where the scan converter's count up:

|             | letters                 | fabricated cells          |
| ----------- | ----------------------- | ------------------------- |
| discarding  | 761/846, 178 px         | 4,442/5,208, 3,087 px     |
| **capping** | **763**/846, **144** px | 4,442/5,208, **2,755** px |

Two more letters and **thirty-four fewer wrong pixels**, with 332 off the
fabricated count. Nothing traded.

So the reading is: ignore the banding, keep the box. The two are easy to conflate
because `Setup` takes them together and they are equal in every case this
project renders -- which is exactly why the box's own role stayed invisible until
it was looked for.

**763 of 846 recorded letters exact at 144 wrong pixels.**

### The last of the fill error is on curves

Decomposing what is left -- 144 wrong pixels -- puts the largest single kind back
where it was before the box clamps: **58 ordinary fills Windows does not make**,
against 37 pixels nothing produced, 31 the stub rules refused and 14 rescues too
many. The cell distribution has flattened as well: Courier New at eight pixels
per em is 38 of the 144, where before the clamps it was 135 of 266.

Those 58 have a sharp home. Sorting every filled pixel by whether it sits at the
end of its run and what kind of edge bounds that end:

| the run's end                 | wrong | of    | rate      |
| ----------------------------- | ----- | ----- | --------- |
| **bounded by a curve, left**  | 33    | 4,037 | **0.82%** |
| **bounded by a curve, right** | 20    | 1,800 | **1.11%** |
| bounded by a line, left       | 3     | 7,083 | 0.04%     |
| bounded by a line, right      | 1     | 2,092 | 0.05%     |
| in the middle of a run        | 1     | 3,680 | 0.03%     |

**A curve-bounded run end is twenty times likelier to be wrong than a
line-bounded one**, and 53 of the 58 are curves. The lines are essentially
solved; the curves are not.

It is not the arithmetic of the crossing. `FixedMulDiv` is a fixed-point multiply
and divide, so the offset from an edge's own start lands on the sixty-fourth
grid; implemented that way it is worse at every rounding -- 722 letters
truncating, 728 rounding, 734 flooring, against 763 exact. Nor is it a coarser
grid: `CalcSpline` shifts its coordinates down by `zShift` before walking, and
quantising curve crossings uniformly is monotonically worse -- 757 letters at a
sixty-fourth, 747 at a thirty-second, 718 at a sixteenth.

So it is the **walk**. `CalcSpline` steps a conic forward difference -- `Q = Rx² +
Sxy + Ty² + Ux + Vy`, with second-derivative terms and a per-curve precision
shift chosen from `PowerOf2(alpha)` and the extent -- and emits whichever column
it is standing in. This computes the crossing and rounds it. For a straight edge
the two agree to 98.3% and disagree only at ties; for a curve the walk accumulates
its own error, and the pixels it lands on are what Windows draws.

That is an implementation gap rather than a gap in what is known: the walk is
given in full. What is not settled in the transcription is the integer arithmetic
underneath it -- whether `FixedMulDiv` truncates, rounds, or rounds away from
zero, and how `>>` behaves on the negative intermediates the conic form produces
-- and those decide exactly the ties this is losing.

### `FixedDiv` rounds unlike anything here, and it is still not the answer

The real divide turns out to round in a way none of the three guesses did.
`FixedDiv` strips the sign, divides the magnitudes, and then increments the
quotient when the remainder reaches `divisor >> 1` -- so it rounds **away from
zero**, and because `divisor >> 1` is the _floor_ of half, an odd divisor rounds
up from below a half as well:

|                | 7/2   | −7/2   | 7/5   | 2/5   | −3/5   | 10/4  |
| -------------- | ----- | ------ | ----- | ----- | ------ | ----- |
| `Math.trunc`   | 3     | −3     | 1     | 0     | 0      | 2     |
| `Math.round`   | 4     | −3     | 1     | 0     | −1     | 3     |
| `Math.floor`   | 3     | −4     | 1     | 0     | −1     | 2     |
| **`FixedDiv`** | **4** | **−4** | **2** | **1** | **−1** | **3** |

Two fifths comes out as one. That is a real bias and it is nothing any of the
earlier readings captured.

Implemented exactly -- `FixedMulDiv(a, b, c)` as `FixedDiv(a · b, c)`, applied to
the crossing of every straight edge -- it is **still worse**: 729 letters and 201
wrong pixels against 763 and 144, and 4,259 fabricated cells against 4,442.

That is not a contradiction; it is the confirmation. **In simple dropout control,
no subpixel crossing is ever computed.** `CalcHorizLineSubpix` and its three
relatives are reached from exactly two places, both inside
`if scanKind & ScanKind.Smart`, and all four installed faces ask for `SCANTYPE`

1. The fill's boundaries are pixel indices the DDA emitted while walking; nothing
   in the simple path divides anything. So applying the scan converter's divide to
   this rasteriser's analytic crossings produces a hybrid that matches neither --
   Windows' arithmetic on a quantity Windows never computes.

Four separate roundings have now been tried on the crossings and exact beats all
four. The remaining 53 curve-bounded errors are not in the arithmetic; they are in
the walk, which for a spline is a conic forward difference with a per-curve
precision shift, and which this project does not have.

### The edge walk, implemented and not yet shipped

`CalcLine`, `CalcSpline` and the endpoint topology are implemented in
`src/raster/scan-walk.ts`, and `fillWalked` fills a glyph from the four lists
they produce -- the scan converter's own method, where this project computes
where the outline crosses each scanline and rounds. It is behind a flag because
it is not yet as good: **436 of the 846 recorded letters against 763**.

It is worth keeping and worth saying exactly where it stands, because four things
were learnt building it and three of them are settled.

**Straight edges are exact.** Arial's `A` at twenty-four pixels per em -- fifteen
line segments, no curves -- comes out with **not one pixel wrong** under the walk.
Everything still failing involves a spline.

**The endpoint topology is not optional, and an earlier measurement here badly
understated it.** Section 6 records the topology functions firing "four times in
846 glyphs" and changing no pixel. That counted _local maxima only_. What matters
far more is the ordinary case: a walk starts at `ScanAbove(y1)`, which for a
vertex already on a scanline is the _next_ one, so two edges meeting there record
nothing between them and the row cannot be paired into runs at all. Arial's `o`
has exactly that at `(5.000, 13.500)` and loses its middle. With the topology
implemented, **98.2% of rows balance**; without it the walk is unusable.

**`CalcEndPoint` must not re-consume the first vertex.** A closed contour's last
piece ends where the first began, so by the time the walk finishes the running
vertex already _is_ the first one. Calling the endpoint check again with the
first point makes `x1 == x2 && y1 == y2` and the topology is skipped -- which is
the bug that made the `o` fail even after the machinery existed.

**The no-dropout branch is a different walk, not the same walk with the vertical
list switched off.** It tests `dQy > tZ` where the dropout branch tests
`dQx > rZ`, it emits `AddHoriz(x, y)` where the other emits `AddHoriz(x + xOffset,
y)`, and it advances `x` and `xStop` by `xOffset` before starting. Arial above
sixteen pixels per em runs it, and using the wrong one puts the top of an `o` two
pixels wide.

What remains is unmeasured: 1.8% of rows still do not balance, and most of the
shortfall is rows that balance and come out wrong, so there are further
differences in the spline walk that have not been found. Each one fixed so far
has been worth ten to twenty letters -- 328, then 416, then 421, then 436 -- which
is the shape of a thing with several small faults left rather than one large one.

**And the two things named here as worth asking about are not gaps.** `CalcLine`
was said to have no-dropout tail loops that might be missing; it has no tail
loops at all -- neither branch has anything after its `for i in range(0, xSteps +
ySteps)`. The tails belong to `CalcSpline`, which has one in its no-dropout
branch and two in its dropout branch, and both are implemented. That request
conflated the two functions.

`AddHorizScan` and `AddVertScan` are a real inconsistency of spelling and resolve
to nothing. They appear three times, all inside `CalcSpline` -- the near-horizontal
early-out and the two no-dropout loops -- where everything else says `AddHoriz`
and `AddVert`. But `AddHoriz` dispatches to `AddHorizSimpleScan` whenever the
scan band covers the whole box, which is every render here, and `AddVert` has no
band variant at all. In a single pass they are the same function.

So what is left is debugging rather than description: the algorithm is fully
given, and where the walk still disagrees the fault is in this implementation of
it.

### The walk's branch condition, as transcribed, does not run

Debugging the walk one spline at a time -- each curve compared against an exact
solve of the same quadratic, with the curves whose endpoints lie on a sample line
set aside because those belong to the topology -- localises the largest fault to
a single line.

`CalcSpline`'s loop decides at each step whether to move sideways or down. The
pseudocode gives that decision **two different ways**:

| branch              | condition             |
| ------------------- | --------------------- |
| dropout control on  | `q < 0 \|\| dQx > rZ` |
| dropout control off | `q < 0 \|\| dQy > tZ` |

They cannot both be the same decision, and neither runs. The derivative term is
already several times its comparand before the first step: for one curve of
Arial's `R` at twelve pixels per em -- `(7.078, 12.203)` via `(7.500, 12.406)` to
`(7.750, 12.906)` -- `dQx` starts at 5,417,728 against an `rZ` of 1,478,656, and
grows by `2·rZ` every sideways step. So the guard fires immediately and forever,
the walk takes all of its sideways steps before any of its downward ones, and the
crossing lands a column late: 8 where the curve actually crosses at 7.475 and the
run should end at 7.

Testing the sign of the conic form on its own -- which is what a forward
difference walk tests, the guard being presumably a degenerate-case escape that
has come across garbled:

| the step decision     | curves agreeing with an exact solve | recorded letters |
| --------------------- | ----------------------------------- | ---------------- |
| `q < 0 \|\| dQx > rZ` | 5,744 of 6,303 (91.1%)              | 436/846          |
| `q < 0 \|\| dQy > tZ` | 5,727 of 6,303 (90.9%)              | 436/846          |
| **`q < 0`**           | **6,269 of 6,303 (99.5%)**          | **572/846**      |

An eight-point-eight per cent per-curve error compounds to a fifty per cent
per-glyph error, because a letter has a dozen curves and one wrong column spoils
it. With the plain condition the walk goes from 436 recorded letters to 572 and
its wrong pixels from 1,386 to 648.

Two other things were settled in the same pass. Excluding the curves whose
endpoints sit on a sample line -- 1,151 of 7,454, all of them the topology's
business rather than the walk's -- takes the comparison from 81.6% to 91.1%, so
most of what looked like missing crossings was the harness, not the walk. And a
vertical dropout pass was added to `fillWalked`, matching `FindDropouts`; it is
worth nothing at all, 569 letters against 572, which is its own open question.

**And the guard was not wrong, only the pairing of it.** The correction is that
the two branches guard on _different_ derivatives -- curving up compares `dQy`
against `tZ`, curving down `dQx` against `rZ` -- where the transcription had both
dropout branches comparing `dQx` to `rZ`. Applied that way round each half earns
its keep:

|                              | recorded letters | wrong pixels |
| ---------------------------- | ---------------- | ------------ |
| neither guard, `q < 0` alone | 569/846          | 648          |
| the curving-up guard only    | 576/846          | 607          |
| **both, correctly paired**   | **586**/846      | **580**      |

So the earlier conclusion here -- that the guard "does not run" and should be
dropped -- was half right and half wrong. It does not run when both branches use
`dQx > rZ`, which is what made all of the sideways steps happen first; paired
properly it runs and helps. What was measured as evidence against the guard was
evidence against the pairing.

**The `int32` question settles empirically.** `q`, the derivative terms and `r`,
`s2`, `t`, `u2`, `v2` are all `int32`, so a shift that leaves the word should
wrap. Over every curve in the fixture none does: the largest `rZ` is 1.5 x 10^8
against a limit of 2.1 x 10^9, and computing the conic terms with thirty-two bit
shifts throughout gives the **identical** result, 586 letters and 580 wrong
pixels either way. At these sizes the width does not bite.

Still behind the shipped path at 586 against 763, and still behind the flag.

### The vertical pass was reading a row too low

The sweep down columns in `fillWalked` fired but was worth nothing -- 569 letters
against 572 without it -- which is not what a mechanism that finds real features
looks like. Tracing every stage said the detection was sound and the outcome was
not: of 407 zero-length runs found down columns, **344 had ink at or beside the
row chosen**, so the walk was locating real strokes. But of the 281 refused by
the stub test, **70 were pixels Windows wanted**, and of the 96 it did set, 41
were in the wrong place.

Validating the vertical emissions the way the horizontal ones were validated --
each piece against a solve of where it crosses each column centre -- found it in
one number:

| the row a vertical entry converts to         | pieces agreeing with a solve |
| -------------------------------------------- | ---------------------------- |
| `-value - 1`, as the horizontal rows convert | 5,118 of 11,760 (43.5%)      |
| **`-value`**                                 | **11,746 of 11,760 (99.9%)** |

A horizontal entry's row is the walk's scan index and converts as `-key - 1`. A
vertical entry's row is `y + yOffset` -- the walk adds the direction's offset when
it records one -- so it has already taken the step the conversion was adding
again. Every vertical crossing was landing one row below where it belonged, which
put the stub counts on the wrong cells and the ink on the wrong row.

Correcting that, and taking the box from the outline rather than from the runs as
`fill` already does:

|                                  | recorded letters | wrong pixels | fabricated cells |
| -------------------------------- | ---------------- | ------------ | ---------------- |
| before                           | 586/846          | 580          | 2,955/5,208      |
| the conversion fixed             | 719/846          | 287          | 4,208/5,208      |
| **and the box from the outline** | **722**/846      | **255**      | **4,465**/5,208  |

The walk now draws **more fabricated cells exactly than the shipped path does** --
4,465 against 4,442 -- which is the first count on which it leads. On the recorded
letters it is still behind, 722 against 763, so it stays behind the flag.

### The two fills, pixel by pixel

Rendering every recorded glyph both ways and comparing the results against
Windows rather than against each other:

|                                             | pixels  |
| ------------------------------------------- | ------- |
| the two fills agree                         | 865,917 |
| they differ, and the analytic fill is right | 149     |
| they differ, and **the walk** is right      | 38      |
| they differ and **both are wrong**          | **0**   |

**Not one pixel in the fixture is wrong in both.** Where the two disagree, one of
them has the answer -- so the 41-letter gap between them is not a gap in what
either method can reach, and something that chose correctly between them would
draw 187 pixels better than either does alone.

The walk's losses are concentrated: 55 pixels at Courier New, eight pixels per
em -- the unhinted cell, where nearly every span is a dropout -- and 28 at Times
New Roman at twenty. Its wins are spread thinly across the larger sizes.

Two shapes of failure show up when the disagreements are drawn out. In Times New
Roman's `E` at twenty-four the walk fills a single run from the stem to the
serif where there should be two, which is a **pairing** failure: a row whose four
crossings became two. In Courier New's `e` at eight the two disagree about the
bowl entirely, which is the dropout rules acting on different spans rather than
either drawing the wrong run.

That leaves the walk's remaining faults as _localised_ rather than systemic --
the emissions are 99.5% right for horizontal crossings and 99.9% for vertical,
measured against exact solves, and what is left is rows where the pairing goes
wrong and a cell where the dropout rules are working from a different set of
spans.

### The walk ships

Instrumenting `fillWalked` directly found the pairing failure in one line of
output. Times New Roman's `E` at twenty-four, device row 16:

```
on [4, 4, 12]   off [6, 14]      unbalanced
```

Three `on` crossings against two `off`. Paired by index that gives runs `(4,6)`
and `(4,14)`, so the second one spans from the stem to the serif -- the single
long run the pixel comparison had shown.

Tracing every emission into that row named the duplicate. The walk contributed an
`on` at column 4 from the curve `(3.875, 16.656) → (4.000, 16.000)`, and the
endpoint topology contributed a second at the same column, from a vertex at
`(4, 16.5)`. That vertex is the curve's **control point**, which the topology had
been fed along with the on-curve points. A control point is not on the outline,
so a scanline passing through its height crosses nothing there. Feeding only the
on-curve points:

|                          | recorded letters | wrong pixels |
| ------------------------ | ---------------- | ------------ |
| control points included  | 722/846          | 255          |
| **on-curve points only** | **775**/846      | **111**      |

That put the walk ahead of the analytic fill on the letters for the first time,
and left one font behind: `cour-arches` at 5,133 wrong pixels against 432. Its
arches are quadratics whose control sits twice as high as their ends, so they
rise and come back -- and the walk takes its extent from the two endpoints, sees
a curve spanning no scanline at all, and takes its "almost horizontal" shortcut,
drawing the whole arch as one row. A well-built font puts an on-curve point at
every extreme and never presents the case; a font fabricated to test shallow
curves presents nothing else. `EvaluateSpline` subdividing splines before they
are walked is what handles it, and cutting each quadratic at its turning points
is that:

|                                 | letters     | wrong px | fabricated cells | wrong px  |
| ------------------------------- | ----------- | -------- | ---------------- | --------- |
| the analytic fill (was shipped) | 763/846     | 144      | 4,442/5,208      | 2,755     |
| the walk, controls excluded     | 775/846     | 111      | 4,472/5,208      | 6,616     |
| **the walk, split at turns**    | **778**/846 | **107**  | **4,551**/5,208  | **1,900** |

**Better on all four counts, so it is now what draws.** The recorded letters are
**778 of 846, ninety-two per cent**, at 107 wrong pixels -- from 654 and 369 when
this section began.

The analytic fill is kept behind `WB_ANALYTIC`, because it is what every rule in
this section was measured against and because the two still disagree on 187
pixels where one of them is always right.

### The rasteriser is done; what is left is the outline

Decomposing the 107 pixels the walk still misses says the dropout machinery is
finished. Of the four rules that decide a rescue -- the two stub tests and the
two guards -- **eighteen pixels in the whole fixture** now turn on them. What
remains is 58 pixels the fill draws that Windows does not, 57 of them at a run's
first or last column, and 31 that nothing produced.

That looked like more of the same until the two fills were compared again:

|                                            | pixels  |
| ------------------------------------------ | ------- |
| the walk is wrong, the analytic fill right | **1**   |
| the analytic fill is wrong, the walk right | 38      |
| they differ and both are wrong             | 0       |
| **they agree, and both are wrong**         | **106** |

Before the walk shipped, 149 pixels were reachable by one method and not the
other. Now **106 of the 107 are wrong in both, identically** -- an exact solve of
the outline and an integer walk over it arriving at the same wrong answer. Two
methods that disagree about arithmetic and agree about the result are not
disagreeing about arithmetic. **They are being given the same geometry, and it is
the geometry that is wrong.**

The clearest confirmation is the cell that used to be the worst. Courier New at
eight pixels per em is the one place a recorded letter's outline is exact --
`INSTCTRL` turns grid-fitting off, so nothing has passed through the interpreter
-- and it is now **33 of 36 letters and three wrong pixels**, from 135 when this
section began. Where the outline is known to be right, the rasteriser is right.

Everything still failing is hinted, and the error is spread thinly across those
cells rather than concentrated: fifteen pixels at Arial twenty-four, twelve at
Courier New twenty-four, eleven at Arial twenty, then single figures down to
nothing. Six of the twenty-two cells are perfect.

So the scan converter is no longer the open question. **The remaining hundred
pixels are the interpreter's**, and the next work is on `glyph-hinting.ts` rather
than here -- a point moved by one sixty-fourth puts a run's end in the next
column, and both fill methods will follow it there together.

### What no rule in this family can reach

Courier New at eight pixels per em is 36 glyphs in which every inked pixel is a
dropout decision, which makes it the sharpest instrument for this there is.
Sweeping the whole family at once over those 36 -- three stub rules against six
pixel choices for each sweep, 108 combinations -- the best is 152 wrong pixels
and 2 glyphs exact. Not 0 wrong: **152**.

So the dropout rule is not what is wrong there. The outline it is being applied
to must differ from Windows', and the `E` says where: between its arms the
scaled outline puts a stroke at device x 3.000 to 3.328, and Windows inks the
pixel from 2 to 3 -- a whole pixel to the left of anything the outline covers.
No choice of end and no threshold reaches a pixel the span does not touch.

What that means is **open**. Honouring `INSTCTRL` was clearly right in kind --
it took the same 36 glyphs from 301 wrong pixels to 217, made the `1` exact and
put the top half of the `E` and `M` on the recorded pixels -- so "run no glyph
program" is right and "use the plainly scaled outline" is not the whole of it.
Something else about that size is still being done differently.

Two things are known about it, and they are the sharpest statement of the
question there is. Both are pixels Windows inks that no span touches, and in
both the pixel is the one _below_ the span in the outline's own coordinates:

- The `E`'s stem between its arms is at outline x 1.000 to 1.328, and Windows
  inks the pixel from 0 to 1.
- The `o`'s top bar is at outline y 3.169 to 3.498, and Windows inks the pixel
  from 2 to 3.

But "the pixel below the span" is not the rule either, because the `o`'s left
stroke at its bottom row is at outline x 1.012 to 1.498 and Windows inks the
pixel from 1 to 2 -- the one the span is _in_. Three spans, three different
answers from the same family of rules, which is why the fit bottoms out at 152.

One plausible explanation was tested and is wrong. `cvt[25]` is a control value
`prep` sets to exactly one pixel at every size, and the glyph programs place
their leftmost point at it; if it were zero at eight pixels per em, the `E`'s
stem would land where Windows draws it. It is the **left side bearing**, and
zeroing it moves the whole glyph a pixel left rather than the stem alone: 320
wrong pixels against 301. **Measured**, and the hypothesis is dead.

---

## 7. The hinting interpreter

A stack machine with a graphics state, run once per font (`fpgm`), once per size
(`prep`), and once per glyph. These fonts use 130 distinct instructions between
them, which is the whole set -- there is no useful subset, because a program
that meets one missing opcode stops.

### The graphics state has two lifetimes

Some of it belongs to the size and outlives the program that set it: the round
state, the minimum distance, the control value cut-in, the single width, auto
flip, the delta base and shift. Some is only about where a program had got to:
the zone pointers, the reference points, the loop counter and the vectors.
**Derived**, and the second kind resets before each glyph.

Getting this wrong is silent and total. `prep` builds its scratch points in the
twilight zone and leaves `zp0`, `zp1` and `zp2` pointing there, because it has
finished. A glyph program that inherits them addresses the glyph's points by
number and writes every one of them into scratch space instead. Nothing is out
of place, nothing errors, and the outline comes out exactly as it went in.

### A glyph is carried onto its side bearing before anything runs

`hmtx` says where a glyph's ink begins relative to the pen, and `glyf` says
where it begins relative to the outline's own zero. For most glyphs of most
faces those are the same number, so which of the two the outline is laid out
against never comes up. Of the sixteen faces Windows 3.1 installs, only three
have any glyph where they differ: `SYMBOL.TTF`, where every glyph is 153 units
apart, and the two italic Times, where a handful of letters are three or four
units apart -- `f`, `j`, `k`, `t` and `y` in the roman italic, `e`, `j`, `m`,
`n`, `s`, `t` and `y` in the bold.

**The outline is moved so its left edge lands on the side bearing, in font
units, before the scaling, and the origin phantom is left at nothing.**

**Recorded.** Three glyphs of a fabricated Times were given the same four points
on the baseline -- at 0, 256, 512 and 768 design units -- and three different
side bearings, inherited from the `W`, the `o` and the `w` they were written
over: 27, 69 and 13 units against an `xMin` of nothing. Each ends with a program
that reads point one back out magnified eightfold. One of them runs no
instruction at all, so what comes back is the bare scaling and nothing else:

| pixels per em             |   9 |  10 |  14 |  18 |  20 |  25 |  30 |  34 |  38 |
| :------------------------ | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| where the outline puts it |   9 |  10 |  14 |  18 |  20 |  25 |  30 |  34 |  38 |
| what Windows reports      |  10 |  11 |  16 |  20 |  22 |  28 |  33 |  38 |  42 |

Windows is out by the whole of the `W`'s 27 units at every size, and the glyph
carrying the `w`'s 13 units is out by half as much at every size, which is the
ratio the two bearings are in. Reading the shift back out of the table gives 27
units to within the sixty-fourth the readout can carry, at all sixteen sizes and
for both glyphs.

**The shift cannot be left until after the program has run.** That is the other
way to arrange it -- keep the outline where the font drew it, stand the origin
phantom at `xMin - lsb`, and translate everything by the origin at the end --
and it is what this implementation did until the recording above. It gives the
same picture and a different advance, because the outline and the origin move
together and the two differences cancel: the sweep above comes back at 9 where
Windows says 10. So the outline is carried first and the phantom starts at zero,
not the other way round.

What this does not do is move any recorded letter. The letters in the glyph
fixture are drawn in faces where the two numbers agree everywhere, so the shift
is zero for every one of them and the score is unchanged at 778 of 846. It moves
the fabricated shape fonts, whose glyphs were written over letters whose bearings
they did not inherit -- 4,551 cells exact to 4,560, and 1,900 wrong pixels to
1,874 -- and it is right for a reason that does not depend on either.

### The side bearing is split between the outline and the bitmap

The whole-pixel part of the bearing does not live in the outline. A bitmap's
left edge is a whole pixel, because bitmaps are pixel aligned; an outline's is a
sixty-fourth, because outlines are 26.6. So the shift is divided between the
two: the whole pixels are carried outside the outline, in the integer the bitmap
is placed at, and only the remainder -- which is all a sixty-fourth can hold --
stays in it. The origin phantom stands behind the outline by exactly the part
that came out, so the distance between the phantoms, which is the advance, comes
out as though neither had moved.

**Recorded.** The readout multiplies the coordinate it reads before reporting
it, which magnifies whatever is inside the outline and leaves whatever is
outside alone -- so reading the same point at three magnifications tells the two
apart. Across three fabrications, three bearings and magnifications of eight,
four and two, all 549 readings come back at `magnify * (point - whole) + whole`
and none at `magnify * point`. At eightfold the deficit is seven pixels for
every whole pixel of bearing, at fourfold three, at twofold one, which is
`magnify - 1` each time.

The rounding that decides `whole` is toward zero, and it is not the one
`mulDiv` does. One reading proves they differ: the `w`'s bearing of 13 units
scales to exactly 32 sixty-fourths at eighty pixels per em and to 32.9 at
eighty-one, and Windows carries a whole pixel out at eighty-one and none at
eighty. `mulDiv` rounds both to 33 and cannot tell them apart. Rounding it that
way everywhere instead is measurably wrong, so this is its own rounding.

This is why a fabricated readout stops tracking its point at a size that depends
on which glyph it was written over -- 39 pixels per em for a bearing of 27
units, 15 for one of 69, 79 for one of 13. Nothing goes wrong at those sizes:
the scaled bearing reaches half a pixel and a whole pixel of it steps outside
the outline. For a real glyph the two numbers agree and the split is of nothing.

### The coordinate and the bearing are scaled separately

Not summed in font units and scaled once. Each is converted to its own
sixty-fourth and the two are added afterwards, and the two conversions do not
round the same way: the coordinate's halves go away from zero and the bearing's
go toward it.

**Recorded, exactly.** A magnification of sixty-four makes the reported advance
in whole pixels equal the stored coordinate in whole sixty-fourths, because the
coordinate is a whole number of them -- so the stored value is read rather than
inferred. Three glyphs were given points that put the sum of coordinate and
bearing at 144, 80 and 16 font units, each of which is sixteen more than a
multiple of thirty-two and therefore lands that sum exactly on a half at every
odd size. That is fifty-odd halves a glyph instead of the two or three a sweep
stumbles onto.

What came back was not one rule but no rule. The direction varied with the size,
and at the same size it varied between the three glyphs. No error in a single
scale factor can do that: a factor multiplies every coordinate, so it pushes
them all the same way. Of 165 exact readings, scaling the two parts separately
accounts for 165 and scaling the sum once accounts for 126.

So they were never halves, and the twelve readings that had looked like a
contradiction were two different things. The six that wanted the half to go
toward zero all had a bearing in them, and were sums that Windows never formed.
The six that wanted it to go away -- Arial Italic's `M` at two sizes and four
`hdmx` advances -- are in faces where the bearing and `xMin` agree, so there was
no second part, and the coordinate's own rounding is what they measure. Both are
now reproduced.

### `MDRP` rounds the way it is supposed to

It was suspected of not doing, on a fabrication where the glyph carrying it
disagreed at every size above eighteen pixels per em by as much as seven eighths
of a pixel. Moving the same three experiments onto different glyphs settled it:
the disagreement stayed with the glyph and not with the instruction. It was the
side bearing above, and the glyph that had looked wrong had the largest bearing
of the three.

With that accounted for, `MDRP` with the round flag agrees at every size on both
glyphs it has been asked on, including the sizes where the distance falls exactly
on a half pixel and the round-to-grid has to break the tie upward: 2.5 pixels at
twenty per em becomes 3, and Windows puts the point where that says.

### The twilight zone

Zone 0: a small array of points, sized by `maxp`, that are not part of any
glyph. They start at the origin, are not on any contour, are never filled, and
vanish when the program ends.

They exist so a program can _construct_ a position and then measure against it.
The idiom is to point a zone pointer at zone 0, place a twilight point at an
exact rounded control value with `MIAP`, make it `rp0`, and hint real points
relative to it -- a reference no actual point in the glyph could have given,
because every real point is wherever the designer drew it.

**`MIAP` and `MIRP` on a twilight point place it rather than move it**, setting
both where it is and where it is remembered as having started. The second half
matters: an untouched twilight point has always been at the origin, so a
distance measured from one is otherwise whatever the reference happens to be.
**Derived.**

### Instruction semantics worth stating

**`MIRP` flips the control value to the sign of the distance it replaces**
(auto flip). A control value is a size, not a direction; a stem is a stem
whichever side of the reference it lies on, and the table states its width once.
Leaving this out barely shows vertically, where nearly every distance is
positive, and wrecks the horizontal direction, where half of them are negative.
**Derived.**

**The control value cut-in applies only within one zone.** Comparing a distance
in the glyph against one in the twilight zone compares two different things.
**Derived.**

**`IP` shifts a point that lies outside its two references** rather than
extrapolating: it keeps its distance from the nearer one and travels with it.
**Derived.**

**`IP` takes its proportion from the design coordinates, not from the scaled
ones.** The scaled originals have already been quantised to sixty-fourths of a
pixel, and a ratio computed from two quantised numbers has lost exactly the
precision the ratio needed. There are 2,048 design units to the em and no
quantisation at all, so the proportion comes out right and only the result is
rounded.

**Recorded**, and this is the one thing in the whole document that no amount of
reasoning about outputs could have reached -- it took reading an intermediate
value out of a running Windows. The next section is how.

The phantom points need design coordinates of their own for this, which is not
obvious until it bites: a program is free to interpolate between them, and
Arial Italic's `M` does. Their design positions are `xMin - lsb` and that plus
the unscaled advance. A twilight point has no design coordinates at all, so its
scaled position stands in -- `IP` only ever divides one by another, and the
units cancel as long as they agree.

**`IUP` moves only untouched points.** Interpolating over a point the program
moved deliberately drags it back, undoing most of the fitting. **Derived.**

**`IUP`'s interpolation truncates rather than rounding.** Worth six of the 846
recorded glyphs, and visible in them as a shape rather than as a count: almost
every one of the six is a diagonal edge drawn one column across from where
Windows draws it, a missing pixel and an invented one side by side in the same
row. That is exactly what this instruction places -- a program hints the stems
and the ends and lets `IUP` carry the slope between them -- so half a
sixty-fourth of bias is enough to move which column a pixel centre falls in.

**Measured**, and free against everything else: `hdmx`, the metrics and the
swept advances are all unmoved, which is unsurprising when an advance is a
phantom point and phantom points are touched. Truncating toward zero and
truncating downward score identically on every fixture, so the recording does
not say which; toward zero is what the interpreter's own division does.

**It is this instruction and not the arithmetic generally**, which is the part
worth keeping. The same sweep over `IP` -- a point interpolated between two
references, the same shape of calculation -- says rounding, 687 glyphs against 679. Over `movePoint`, which distributes a distance along the freedom vector, it
says rounding again, 687 against 676. Both of those were fitted on the ninety
glyph fixture and both survive the wide one unchanged. So the interpreter rounds
everywhere it divides except in `IUP`, and a sweep that had been run over all
three at once would have found nothing.

**Arithmetic rounds half away from zero.** The format takes the sign off a
value, works on the magnitude and puts it back. `Math.round` rounds a half
upwards: the two agree for positive values and disagree for every negative one.
Every distance measured backwards from a reference goes through this.
**Derived.**

**The scaling is exact for these fonts and needs no fixed point to be so.** They
have 2048 units to the em, a power of two, so `ppem * 64 / unitsPerEm` is exact
in binary at every size -- not one of the 2,337 control values across the three
fonts differs between a floating point and a fixed point path. Worth measuring
before rewriting anything on the strength of it. **Measured.**

**The engine compensation is zero.** Every distance carries a colour in the low
bits of the instruction that measures it, and the original rasteriser was
described as nudging black and white ones before rounding. These fonts lean on
it -- Times New Roman measures 53 black distances and 8 white ones across the
recorded glyphs and rounds nearly all of them -- so a compensation of even a
sixteenth of a pixel would move a great deal. Sweeping both peaks at nothing,
sharply, falling away monotonically in both directions. **Measured.**

Re-measured since against `hdmx`, which is a far better instrument than the
ninety recorded glyphs: 22,056 advances across six fonts, swept over both
compensations together from -24 to +40 sixty-fourths.

| black \ white | -8  | -4  | **0**  | +4  | +8  |
| ------------- | --- | --- | ------ | --- | --- |
| -8            | 838 | 657 | 439    | 643 | --  |
| -4            | 666 | 468 | 232    | 460 | --  |
| **0**         | 485 | 272 | **28** | 279 | 506 |
| +4            | 641 | 461 | 244    | 483 | --  |
| +8            | --  | --  | 474    | --  | 879 |

Zero and zero, and nothing else is close. The same conclusion as before, now
resting on three orders of magnitude more evidence.

**A font can switch hinting off for a size, and one does.** `INSTCTRL` (0x8E) is
a masked assignment into a control byte: the selector picks a bit and the value
says what to set it to. Bit 0 means "do not grid-fit at this size", bit 1 means
"ignore what `prep` did to the control values". A font may only execute it from
`prep`, where it knows the size.

**Courier New sets bit 0 below nine pixels per em**, guarded by `MPPEM < 9`, and
it is the only path in any installed font that reaches the instruction at all.
The font's reasoning is legible from the numbers: at eight pixels per em its
stems are a third of a pixel wide and its serifs a sixth, and grid-fitting them
means rounding every one up to a whole pixel -- a letter built entirely of
features three times too heavy. It would rather be blurred than shouted.

Discarding the instruction, which is what we did, cost 8 records of `CreateFont`
and 36 recorded glyphs, and the glyphs failed in a way that looked like a
rasteriser fault rather than a missing instruction: **0 of 36 exact, and the
shapes plainly wrong rather than a pixel out.** Honouring it makes the shapes
right immediately -- Courier New's `1` at that size goes from wrong to exact, and
the top half of the `E` and `M` land on the recorded pixels -- and leaves only
strokes too thin to cover a pixel centre.

The wider point is about coverage rather than about this instruction. Eight
pixels per em is a size only Courier New is ever asked to draw, because Arial and
Times are answered by a strike below twelve; and Courier New is the only font
that executes `INSTCTRL` at all. One face at one size was the entire evidence,
and the six-character fixture did not have it.

### The instruction set is complete for this installation

Every glyph of every TrueType face installed by Windows 3.1 -- eleven files,
including Symbol and Wingdings -- runs to the end of its program at eight, eleven,
sixteen, twenty-four and forty pixels per em. **9,020 runs, none refused.**

This is a cheap check and it should have been written far earlier. The
interpreter refuses an instruction it does not implement rather than guessing,
and a glyph that refuses falls back to an unhinted outline -- which reads as a
rasteriser being slightly wrong rather than an interpreter being absent. `ISECT`
hid there for a long time on exactly that: `X` and `4` use it in all three text
faces and nothing else does, so the only evidence of the missing instruction was
a few letters coming out badly, and the `hdmx` check that would have caught it
skips any glyph whose program cannot run -- the absence was removing its own
evidence.

The check says nothing about whether the answers are right; `hdmx` says that. It
says only that no question is going unasked.

---

## 8. What is not known

**Times New Roman's `W` and `g` are one pixel of cap height out**, which is
three recorded glyphs. `MIAP[round]` places the top point at 10 pixels above
the baseline where Windows places it at 9, and everything else follows from
that.

It is _not_ the control value. That was the conclusion for a while, traced
carefully and written up here: `cvt[2]` is built by interpolation in `prep`,
comes out at 9.5313, rounds to 10 where Windows would need 9.4844 or less, and
the whole gap is three sixty-fourths of a pixel. Every step of that is right
except the conclusion.

Asking Windows directly -- with a fabricated font whose glyphs report a value
instead of drawing a letter -- says both control values are exactly what ours
are:

| Control value | Ours after `prep` | Windows           |
| ------------- | ----------------- | ----------------- |
| `cvt[0]`      | 640 (10.00000 px) | 640 (10.00000 px) |
| `cvt[2]`      | 640 (10.00000 px) | 640 (10.00000 px) |

Two independent readouts agreed on each, and the readouts whose range excluded
the value correctly showed nothing. So `prep` produces the same numbers in both
implementations, the interpolation that worried us lands somewhere harmless,
and the difference is downstream of the control value table entirely.

What that leaves is the `MIAP` itself. It rounds the control value -- 640,
already a whole pixel -- and moves the point there, unless the control value
cut-in decides the outline's own position is too far from it to trust, in which
case the outline wins and 9.2656 rounds to 9. Ours does not take that branch:
the distance is 0.734 of a pixel and the cut-in `prep` leaves is 255
sixty-fourths, about four pixels.

Sweeping the cut-in says two useful things at once. Forcing it below 47
sixty-fourths makes the branch fire and **moves the whole letter onto the rows
Windows draws it on** -- so the vertical placement really is decided there. But
it fixes no glyph exactly, and it costs Arial three: 18 of 24 down to 15. So
Windows is not simply using a smaller cut-in, and whatever it does at this
instruction is not a constant this one has wrong.

**The `W` is two faults, not one.** With the cap on the right row, the serifs
are still wrong in the other direction:

```
    windows             ours
    ..###..###..###     ....#....#..#.#
    ...#....#....#      ...#....#....#
```

Windows draws each serif as a three pixel bar, wider than the stem beneath it;
ours draws a single pixel, the stem width. That is a horizontal failure with
nothing to do with cap height, and it was hidden underneath the vertical one --
which is why the vertical one looked like the whole story for as long as it
did. **Open**, both.

This is the second time this particular gap has had a confident and wrong
explanation, and the third time it has turned out to be smaller or different
than it looked. Each was arrived at by reasoning carefully from correct
observations; each was settled in one run by measuring instead. The pattern is
worth more than the fonts: a careful chain of inference from true premises is
exactly what a wrong answer looks like from the inside.

**Arial's `A` differs by two pixels** on one row where a diagonal edge crosses
near a pixel centre.

**The pixel size tie-break** for outline faces, where two sizes give the same
fitted height.

---

### What the last hundred wrong pixels are made of

Sixty-six of 828 recorded cells disagree, by 105 pixels between them, and they
are not spread evenly. Measured, and measured again after every fix since, with
the shape barely moving:

- **Seventy-three of the 105 are ink drawn here and not by Windows**, and
  thirty-two the other way. Fifty-six of the seventy-three sit at the end of a
  run, split about evenly between its left end and its right, so the runs are
  too long rather than displaced. What is missed is more often a pixel standing
  alone -- twelve of the thirty-two.
- **Curves cost two and a half times what straight lines do**, and digits are
  half the total while being a quarter of the cells: `8` alone accounts for
  seventeen. The characters never wrong at any size in any face are `4`, `A`,
  `E`, `M`, `N`, `W`, `f`, `k` and `w`.
- **It grows faster than the glyph does, and that is opportunity rather than
  decay.** Per cell drawn: 0.028 wrong pixels at ten pixels of cell height,
  0.065 at twelve, 0.148 at fourteen, 0.175 at twenty, 0.300 at twenty-four --
  a tenfold rise for a size not quite two and a half times. It looked like
  something whose error grows with the coordinates, which would have pointed at
  the forward difference terms, since those scale with the square of a spline's
  extent.

  It is not. Measuring how far each disputed pixel's centre lies from the
  nearest crossing gives a median of 2.57 sixty-fourths at ten pixels of cell
  height, 3.70 at fourteen, 1.14 at eighteen and 1.75 at twenty-four: noisy
  between one and four, with no trend. What does grow is the number of chances.
  Crossings per cell go from 6.0 at ten to 47.5 at twenty-four, which is
  superlinear because it counts a perimeter against every row it spans, and the
  rate of disagreement per crossing is flat -- between 2.8 and 6.3 per thousand
  at every size. Bigger glyphs are not drawn worse; they simply offer the knife
  edge more often.

- **On a steep diagonal the ink sits a pixel further out.** Times New Roman's
  `8` at sixteen pixels per em is the worst cell in the fixture at seven pixels,
  and all seven are at the waist where the two bowls cross: `....#.#` against
  `...Xo.oX` on one row, `.....#` against `....X#X` on the next. Both strokes
  are outward of where Windows puts them. Arial's `7` at eighteen and at twenty
  is the same thing on a single diagonal, the stroke stepping across a row
  earlier than it should.

**Compared against Windows directly, rather than against a solve.** A row of
Windows' bitmap gives its runs, and its runs give the crossings it must have
had, so the two can be set side by side without an exact solve in the middle. Of
the ninety failing rows, eighty-one have the same number of runs in both, and
they differ like this: 28 where this run starts a column early, 24 where it ends
a column late, 17 where it is a column short at one end or the other, 11 where
it is shifted bodily by one, and two others. Twenty-three of the ninety hold a
rescue, so about a quarter involve dropout at all.

So the dominant mode is a run one column too wide, split evenly between its
ends, which is what the pixel counts already said.

**And it is not the interpreter.** That was worth asking directly rather than
inferring, so Times New Roman was fabricated with every glyph program filled
with an opcode that moves nothing -- the same points, the same tables, the same
phantom rounding, and a program that does nothing. Both sides then scan-convert
the same outline.

They agree _less_. Over the same 264 cells, the real font disagrees on 35 pixels
and the stripped one on 62, which is 0.133 a cell against 0.235. If the outline
the interpreter produced were what was wrong, taking the interpreter away would
have settled it; instead it nearly doubles the disagreement. Hinting is
_hiding_ some of this, which makes sense of it -- a hinted stem is snapped onto
whole pixels, so its edges land where both implementations agree, and an
unhinted one lands anywhere.

That corrects a reading made here from the crossing distances: that a disputed
crossing sitting one to four sixty-fourths from its sample, with a walk known to
be exact, meant Windows had walked a different outline. The walk is exact in the
sense measured -- it names the column an exact solve of its own input names --
which does not pin a crossing to a sixty-fourth, and the distance from a pixel
centre to a crossing bounds nothing about how two implementations differ. Handed
the same outline, they still disagree. It is the scan conversion.

Steep diagonals and the waists of digits are where a letter offers the most
chances for it, which is why they dominate the list.

### With the interpreter gone, the residue has one shape

`times-bare` is the same 264 cells with every glyph program made inert, so both
sides scan-convert an outline that is known exactly. Forty-six of them disagree,
by 62 pixels, and measured against Windows row by row:

- **The runs always line up.** Not one failing row has a different number of
  runs on the two sides, so the crossings pair the same way and the topology
  that produces them agrees. What differs is one end of one run, by one column.
- **It is symmetric.** Twenty-nine pixels are drawn here and not by Windows and
  thirty-three the other way. The run differences balance too: eighteen a column
  short at the right end against fourteen a column long, eleven short at the left
  against eleven long. There is no bias to hold on to.
- **It is ordinary fill, not rescue.** Eleven of the fifty-six failing rows hold
  a rescue of any kind.
- **It is a knife edge.** The disputed pixel's centre sits a median of 0.96
  sixty-fourths from the nearest crossing, with quartiles at 0.44 and 1.91.

**And the geometry sides with this implementation.** Solving the same outline
exactly and asking a non-zero winding fill which way each disputed centre falls:
it agrees with what is drawn here 59 times and with Windows 3. So on the pixels
that disagree, the true curve says Windows is the one drawing them wrongly, by
under a sixty-fourth, in either direction with no pattern.

That reframes what is left. This is not a rasteriser that is wrong; it is one
that is _too exact_. The scan converter Windows ships resolves a crossing that
falls within a sixty-fourth of a sample by arithmetic that does not quite track
the curve, and `CalcSpline` and `CalcLine` as written down do track it -- this
implementation is a faithful transcription of them, proved against a second
reading over 10,234 splines. Closing the last hundred pixels means reproducing
an inaccuracy the documentation does not describe.

### There is no threshold, because the decision is not local

If everything left is a curve passing within a sixty-fourth of a sample, the
next question is where the line falls, so a third fabrication moves a crossing
across one in the smallest steps a font unit allows. The lever is the curve's
own parameter: a control point moves a quadratic by `2t(1-t)` of the way it is
displaced, a half at the middle and much less near either end, so a row near the
top of a tall curve moves a fraction of however far the control moves. Thirty-six
rectangles two thousand units tall with one curved side, the control a unit
further out each time, put the resolution at about a twelfth of a sixty-fourth.

There is no threshold. Sorting every reading by how far the outline reaches past
the column's sample and asking who lights it gives, between a sixth of a
sixty-fourth and one and a tenth, an alternation: Windows lights it at 0.483,
not at 0.514, lights it at 0.542, not at 0.557, lights it at 0.768, not at
0.783. The same reach is decided both ways.

So it is not a threshold, a tie rule or a rounding, and no local rule of any
kind will produce it -- which is why every one tried here has failed. It is what
a walk looks like: a forward difference carries state from one row to the next,
and what it does at a row depends on the path that reached it and not only on
where the curve is. This implementation's walk agrees with an exact solve of its
own input at all 20,110 entries measured; if Windows' does not, then reproducing
it means reproducing its arithmetic step for step rather than its answers.

**And step for step it already is.** `CalcSpline` was transcribed a second time,
from the document rather than from the implementation, and the two run against
each other: over every spline the recorded letters walk, 10,234 of them, they
emit the same entries in the same order, and over twenty thousand generated
shapes they fill the same lists. `ScanAbove`, `ScanBelow` and `OnScanline` match
the document exactly, the initial conditions and stop values match, the
precision reduction matches, both branches of the forward difference match, and
the tails match. `test/raster/spline_walk_test.ts` keeps the two in step, and
what it catches was checked rather than assumed -- displacing an emitted
coordinate by one fails it, adding one to `rZ` does not.

So the walk is not where the last hundred pixels are, and neither is anything
else that has been written down. Every stage of the scan converter given in
`FONT_PIXEL_CANDIDATES.md` is now implemented as given and verified against it:
the subdivision, the walk, the topology, the endpoint handling, the pairing.
What remains is either in a stage not written down -- `Setup`, whatever hands
the outline over -- or in a difference between the document and the code it
describes.

**`BeginElement` is not it, and the list it keeps is dead code here.** It does
maintain a list of an element's control points, and `PerformHorizDropout` and
`PerformVertDropout` do use that list to work out where between two pixels a
rescued stroke belongs. But every one of those is inside `if scanKind &
ScanKind.Smart`: the tag is only composed under it, `AddHorizSmartScan` is the
only adder that records one, and both dropout routines read it only in their
smart branch, where the simple one just steps the pixel one to the left or one
down. All four installed faces ask for `SCANTYPE` 1, simple dropout excluding
stubs, so none of that runs, and ignoring the points `BeginElement` is handed is
right rather than an omission.

Reading those two routines properly settles the rest of the dropout pass as
well. The stub tests match term for term, including the asymmetry that makes the
upward test count vertical crossings a row further on than the downward one. Two
things that looked like gaps are not: this places its vertical rescue without a
decrement where `PerformVertDropout` has `yDrop--`, and tests one neighbour
where it tests two. Both were tried. Adding the decrement costs ninety-seven
letters, and testing both neighbours before the clamp costs thirty, because the
decrement is already folded into the conversion from the walk's vertical entries
-- they record `y + yOffset`, which has taken the step -- and the second
neighbour is the pixel about to be written. The current form is that code with
the arithmetic gathered elsewhere.

The step decision is not the place. The guard the pseudocode gives -- the
derivative against its comparand, alongside the sign of the conic form -- was
suspected here of being either wrong or inert. Counted: over the recorded
letters the walk takes 750 steps, the sign decides 535, and the guard is true on
twelve and decides seven of them. It is neither. A note here that had it firing
on every step was describing a shift out of place in `rZ` and `tZ`, fixed since.

### The two sweeps and the letters are one problem

The thirty-seven cells the fabricated sweeps still disagree on hold fifty
disputed pixels between them, and every one of the fifty is within three
sixty-fourths of where the outline crosses that row's sample line -- thirty-nine
of them within one. The smallest is a single pixel: a rectangle whose left side
curves out to 222 sixty-fourths, drawn at sixteen pixels of cell height, where
row 9's crossing solves to 223.52 and the sample sits at 224. Half a
sixty-fourth inside, and this lights it where Windows does not.

That is the same thing the 107 wrong pixels of the recorded letters turned out
to be, so the two are one problem and not two. What the sweeps add is that they
have no interpreter in them: the outline is written into the font, nothing is
hinted, and the scaling is one multiply that other measurements have already
confirmed. Whatever resolves a sample the outline passes within a sixty-fourth
of, it is in the rasteriser.

They add one thing more. In the letters the disagreements fall on both sides of
the sample with no bias -- mean 0.29 sixty-fourths, median 0.07. In the sweeps
forty-eight of the fifty fall on one side: the crossing is past the pixel centre
by a fraction of a sixty-fourth, this implementation counts the centre as
covered, and Windows does not. An exact solve agrees with this implementation
every time. So on this geometry Windows is reliably the less generous of the
two, by less than a sixty-fourth, and it is not a tie rule, a rounding or an
overflow -- all three have been tried and measured.

### Four things the subdivision hypothesis was, and was not

The last hundred pixels being curves and never lines pointed at the one path a
curve takes and a line does not, and the reasoning ran: `EvaluateSpline`
recurses, every recursion rounds three new coordinates onto the grid, rounding
accumulates with depth, and imposing the shared split coordinate afterwards
flattens a convex arc inward -- which would give sub-sixty-fourth errors, path
dependent, on curves only, with Windows the less generous. It fits every
measurement. It is wrong, and four counts say so.

- **There is no depth to accumulate through.** Across the recorded letters the
  subdivision produces 1.026 pieces per curve, and 1.05 on the sweeps, with the
  deepest cut in a cell averaging half a level. Nineteen curves in twenty are
  never cut at all.
- **And no correlation with it.** Cells that disagree are cut 1.018 pieces a
  curve against 1.026 for cells that agree on the letters, and 1.046 against
  1.055 on the turning-point sweep -- very slightly _less_, not more. Only the
  fine sweep leans the other way, 1.078 against 1.050.
- **The implied midpoint is not it either.** The point between two off-curve
  ones is their average, which lands between two sixty-fourths whenever the
  coordinates differ by an odd number, and this is the other thing that touches
  only curves. Rounding it down instead of up is worth one letter and costs two
  pixels: 781 and 107 against 780 and 105. A wash.
- **The precision reduction never fires.** Forcing `zShift` to nothing gives a
  score identical to consulting the table, so at these sizes the table is always
  nothing. Forcing it to one, two or three makes matters monotonically worse --
  778, 758, 729 letters -- so Windows is not quantising more than this does,
  which was the whole shape of the hypothesis.

**And the premise was weaker than it looked.** "Curves and never lines" came
from the fabricated sweeps, whose straight variants are rectangles: their edges
are vertical, and a vertical edge crosses every row at the same place, so it can
only graze a sample column if the whole edge does. It was geometry and not code
path. The recorded letters have plenty of straight diagonals and they disagree
too -- Arial's `7` is wrong by four pixels at eighteen pixels per em and four
more at twenty, on the diagonal, and `1`, `K`, `X` and `y` are all in the list.

So the phenomenon is not curve-specific at all. It is any edge passing within a
fraction of a sixty-fourth of a sample point, `CalcLine` included, which puts it
back in the general scan conversion rather than in the spline path.

Three more places have been looked at since and none of them is it either.
`Setup` records the band and the box it is handed and allocates the lists, and
the one thing it says that this did not already do is that those lists are fixed
arrays -- horizontal indexed by `y - boxBottom`, vertical by `x - boxLeft` -- so
a crossing outside the box has nowhere to go, where the maps here would hold it.
Dropping them changes nothing: nothing lands outside. The scaling the rasteriser
does for a glyph that was never hinted is its own, in floating point, and had
never been checked against the interpreter's; the two part company only on a
negative coordinate landing exactly between two sixty-fourths, and no such
coordinate occurs in any fixture, so making them agree changes nothing either.
It is done anyway, since two roundings that are meant to be the same thing
should be.

**`FillGlyph` and `Blit` supply the caller, and four details with it.** Three
were already right and two were not.

- **The implied midpoint is `(a + b + 1) >> 1` on the scaled coordinates**,
  which is a half rounded up and is what this does. The earlier test that
  rounded it down was measuring the wrong direction.
- **`EvaluateEndPoint` comes before `CalcLine` for a line and is absent before a
  spline**, since `EvaluateSpline` makes the call itself once per monotonic
  piece. That is the arrangement here.
- **`CalcEndPoint` closes each contour**, which is `end()`.
- **`Blit` fills a run either way round.** `xStart < xStop` fills forwards and
  `xStart > xStop` fills backwards, where this filled only forwards and left a
  reversed pair undrawn -- not caught as a dropout either, since that is the
  case where the two are equal. No reversed pair occurs in any fixture, so it
  changes nothing measured, but it was a hole.
- **`FindDropouts` goes down the rows from the top of the band.** Sorting the
  rescues that way changes nothing; the order they came out in was already
  equivalent.
- **It also reads each column's vertical entries backwards, and the oracle can
  be asked which end that is.** The direction only shows when two rescues in one
  column land a row apart, since each declines where a neighbour is already lit:
  read one way the first blocks the second and one pixel is drawn, read the
  other and both are. So a fabrication asks. Thirty-six glyphs, each two
  horizontal hairlines -- a stroke too thin to cover a sample down a column is a
  vertical dropout -- with the gap between them swept from four fifths of a
  pixel to two and a quarter, so that some of them land with their two rescues
  on neighbouring rows whatever the rounding does.

  **Windows draws both rows.** Every time, at every size where the case arises:
  `[8:5 9:3]` where this drew `[8:5]`. Reading these lists forward agrees with it
  on 199 of 216 cells and reading them backward on 176, and the recorded letters
  are 780 of 846 and 105 wrong pixels with it against 778 and 109 without.

  The frame reasoning does not come out where the measurement does, and that is
  worth stating rather than smoothing over. In the scan converter `y` points
  up, so `boxTop` is the larger number, a list sorted ascending holds the
  topmost entry last, and reading it in reverse is reading from the top down --
  which is what its comment says. By the same token `yDrop - 1` is one row
  _down_ the screen, so the neighbour it tests is the one below.

  Both halves of that read worse. Taken as a pair -- top to bottom, testing the
  neighbour below -- it agrees on 177 of 216 twin-bar cells and 749 of 846
  letters, against 199 and 780 for reading these lists forward and testing the
  neighbour above. Every one of the four combinations was tried:

  | direction     | neighbour |        letters |  twin bars |
  | :------------ | :-------- | -------------: | ---------: |
  | forward here  | above     | 780, 105 wrong | 199 of 216 |
  | forward here  | below     | 750, 150 wrong | 154 of 216 |
  | reversed here | above     | 778, 109 wrong | 176 of 216 |
  | reversed here | below     | 749, 150 wrong | 177 of 216 |

  **The frame is not where the reflection is, and that was checked rather than
  assumed.** The pseudocode's `y` grows upward: `ScanAbove` returns the larger
  value, `y3 > y1` is "moving up", and `Blit` walks its list from the high index
  down and calls that top to bottom. This walk is in the same orientation, being
  handed the device `y` negated. So a list sorted ascending does hold the topmost
  entry last in both, and reading it in reverse is reading downward in both.

  Every degree of freedom around it has now been swept -- the row conversion, the
  direction, the neighbour tested, and which of the two lists a quadrant feeds --
  and the arrangement Windows draws is not the one that reasoning predicts:

  | row      | direction | neighbour |               letters |  twin bars |
  | :------- | :-------- | :-------- | --------------------: | ---------: |
  | `-v`     | forward   | above     |        780, 105 wrong | 199 of 216 |
  | `-v`     | forward   | below     |        750, 150 wrong | 154 of 216 |
  | `-v`     | reversed  | above     |        778, 109 wrong | 176 of 216 |
  | `-v`     | reversed  | below     |        749, 150 wrong | 177 of 216 |
  | `-v - 1` | any       | any       | 677 to 680, 310 wrong | 104 of 216 |

  Swapping which list a quadrant feeds costs three letters and eight pixels and
  leaves the twin bars where they are, so that is right as well.

  **The encoding, read off a column.** Dumping one of the twin-bar glyphs gives
  `on [-10,-8] off [-10,-9]`. Paired by index the first is a zero-length run and
  the second a real one, and converting the real one with `-v - 1` gives device
  rows `[7, 8)`, which is the single row it covers. So the vertical pair is
  half-open exactly as the horizontal pair is, and `PerformVertDropout` placing
  at `yDrop - 1` converts to `-on` -- which is what this already used. The
  conversion was derived rather than fitted after all, and changing it in both of
  its uses together costs a hundred and sixty letters, which settles it.

  **And the reflection was a guard.** The rescue in that column lands on device
  row 9 only because the clamp pulls it there from 10: its row is outside the
  box. `PerformVertDropout` guards each of its two `GetBit` calls on the row
  being clear of the corresponding edge -- `yDrop > boxBottom` for one and
  `yDrop < boxTop` for the other -- so a rescue that had to be clamped is placed
  without asking about anything. This asked anyway, and a stroke lying along the
  bottom of the box blocked the row above it.

  With the guard the twin-bar recording is drawn exactly, all 264 cells and no
  wrong pixels against 199 of 216 before, and the fabricated recordings go from
  5,496 cells and 2,086 wrong pixels to 5,513 and 2,013. The recorded letters
  hold at 780 and 105.

  It also dissolves the argument about which end of a column is read first: with
  nothing left to block, the two directions agree on that fixture. The letters
  keep their two-letter preference for the order these lists are already in, and
  that is now the only thing resting on it. So the reflection was never in the
  coordinates -- it was a guard this did not have, in the one place where a
  rescue sits outside the box it is drawn into.

What is left after all of it is a difference of under a sixty-fourth, on every
kind of edge, that no stage of the documented algorithm accounts for.

## 9. Where the numbers stand

| Fixture                                                      | Agreement |
| ------------------------------------------------------------ | --------- |
| `strings`, `memory`, `handles`, `profile`, `text`, `devcaps` | 100%      |
| `font` (2,655 records)                                       | **100%**  |
| `glyphs` (846 records)                                       | 82.9%     |
| `hinting` (927 records)                                      | **100%**  |

Of the glyph records, every bitmap and plotter one is pixel-identical -- all
forty-two of them, across four faces and two stock handles. That is the control,
and it still holds.

The outline faces are three quarters right and were reported as ninety-four per
cent until the probe was widened. The old figure was six characters -- `A`, `W`,
`g`, `j`, `1` and `.` -- at a handful of sizes, chosen early to exercise
particular features. Thirty-six characters at seven sizes across the three
outline faces says something different:

| Face            | Glyphs exact | Pixels missing | Pixels invented |
| --------------- | ------------ | -------------- | --------------- |
| Arial           | 248 of 276   | 11             | 34              |
| Times New Roman | 217 of 264   | 41             | 28              |
| Courier New     | 188 of 258   | 249            | 36              |

Split by size instead, the error is not spread across them at all. **Courier New
at a ten pixel cell is 0 of 36 and 301 wrong pixels -- more than half of every
wrong pixel in the fixture, at one face and one size.** Arial and Times at that
same cell are 36 of 36, because below twelve pixels they are answered by a
strike and only Courier New stays on its outline. So the largest single piece of
the rasterisation gap was one face at eight pixels per em -- and the reason is in
section 7: **the font asks for no hinting at that size and we were hinting
anyway.** Honouring `INSTCTRL` takes it to 2 of 36 and 217 wrong pixels, and
turns the error inside out: 301 wrong pixels of which none were missing becomes
217 of which none are invented. What is left there is entirely dropout control,
because at eight pixels per em an unhinted Courier New stem is a third of a pixel
wide and covers no pixel centre at all. Every stroke Windows draws at that size,
it draws by rescue.

**`ISECT` was missing, and the wide net is what found it.** Opcode 0x0F puts a
point where two lines cross, and `X` and `4` use it in all three outline faces --
letters made of crossing strokes, and neither of them in the six the fixture
used to hold. Every one of those glyphs was throwing on an unimplemented
instruction and falling back to an unhinted outline, at every size. Implementing
it took 643 glyphs to **672**.

It hid from the `hdmx` check too, and instructively: a glyph whose program
cannot run is not counted there at all, so the missing instruction was removing
its own evidence. The Arial total went from 3,720 advances to 3,864 when it was
added, and all 144 of the new ones agree.

Worth stating plainly: **the number went down because the measurement got
better.** Six letters agreeing to seven pixels was not evidence that the
rasteriser was within seven pixels of Windows; it was evidence that those six
letters were. Every rule in section 6 that was fitted against ninety records --
the stub threshold above all -- now has eight hundred to answer to, and the
error is no longer one-sided: 301 pixels missing against 98 invented, where the
narrow sample had none invented at all.

`CreateFont face` agrees on every one of the 2,655 records: whatever Windows
picks for a request, this picks too. That is the section 2 rules above, all of
them measured in one recording.

The route there is worth keeping. Against the 2,225 records this document was
first written from, agreement went 85.5% to 90.4% on the bounding-box rule
alone. Then the probe grew by 430 records asking where a TrueType request stops
being answered by the outline, almost every one of them a face the mapper got
wrong, and the rate _fell_ to 83.3% on the larger set. The gap was always there;
until the probe asked, it was not being counted. Answering it took the figure to
93.3%.

Nothing is left. **All 2,655 records agree**, and so do all 927 of the `hinting`
sweep -- every face the mapper picks, every height, width, style byte and
string extent, and every hinted advance of six letters at ninety-nine sizes
each.

What that leaves is the one probe that records pixels.

### What Courier New at eight pixels per em turned out to be

More than half of every wrong pixel in the glyph fixture is one face at one
size, and the fabrications settle what it is not.

**`INSTCTRL` works, and the recording proves it by exclusion.** Courier New's
`prep` executes it twice, both times as `PUSHB[2] 1, 1` -- selector 1, value 1,
setting the bit that means "do not grid-fit at this size" -- and the first is
guarded by `MPPEM < 9`. Zeroing the _value_ byte of each push turns the
instruction from setting the bit into clearing it: one byte each, no lengths
changed. Recording the glyph probe against that font changes **exactly the 36
records at a ten pixel cell and not one of the other 222.** That is the size the
guard selects, so the instruction does what it says and Windows honours it.

**And our grid-fitting at that size is right.** The fabricated recording is
Courier New _hinted_ at eight pixels per em, which nothing else can produce --
the stock font refuses to hint there and no other size is eight pixels per em.
Rendering against it gives **25 of 36 exact and 32 wrong pixels**, sixteen of
them one glyph where Windows draws nothing at all. Against the stock recording
the same renderer gets 2 of 36 and 217.

So the interpreter is not what is wrong there, and neither is the scan
converter, since it is the same one in both cases. Putting the two recordings
and both renderings side by side says the rest: **where we draw anything at all
the shape agrees with Windows, and we are simply missing ink.** The `M`'s top
two rows are identical and its bottom three are nearly empty; those three rows
are the two stems, a third of a pixel wide, which at that size exist only if
dropout control rescues them.

At eight pixels per em with no grid-fitting, _every_ stroke of this face is a
dropout candidate, and Windows rescues a particular subset of them. Rescuing all
of them takes the missing pixels from 207 to 34 and invents 131. **So the ink is
all reachable and the rule that selects it is the whole of what is left** -- and
it is the same stub rule section 6 has now failed to fit three ways.
