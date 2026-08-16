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
