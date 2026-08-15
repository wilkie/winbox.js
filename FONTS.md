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

### `hdmx` is an oracle for the interpreter

`hdmx` tabulates what each glyph advances by, in whole pixels, at the two dozen
sizes it covers. Those numbers are the output of running the font's own hinting
programs, worked out offline by whoever built the font. So a font file carries,
inside itself, a large and independent check on any interpreter claiming to run
it -- and one that needs no recording, no emulator and no Windows.

Run against it, this interpreter agrees on:

| Font                 | Advances checked | Agreeing         |
| -------------------- | ---------------- | ---------------- |
| Arial                | 3,720            | **3,720 (100%)** |
| Arial Bold           | 3,600            | **3,600 (100%)** |
| Arial Italic         | 3,624            | 3,620            |
| Times New Roman      | 3,696            | 3,695            |
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

### The pattern worth naming

Four times in this session a fault has presented as "this instruction is wrong"
and turned out to be "this instruction is fed the wrong number":

| Looked like                                   | Actually was                            |
| --------------------------------------------- | --------------------------------------- |
| `MIAP` rounding the cap height wrongly        | never settled; still open               |
| `MIRP` moving a phantom point it should not   | `MDRP`/`MIRP` minimum-distance sign     |
| One pixel of internal leading, a rounding bug | reading the wrong `VDMX` ratio group    |
| `ROUND` producing 128 where Windows has 64    | `DIV` rounding where it should truncate |

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
wrong pixels. No span boundary in the recorded glyphs lands exactly on a pixel
centre, so the question does not arise, and the half-open form is kept because
it is the one that cannot double-ink a shared edge.

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

**Sweeping rows is enough, and sweeping columns is not the other half.** A
stroke can be too shallow to cover a row centre as easily as too narrow to cover
a column one, and a row sweep provably cannot see the first kind -- every
scanline either crosses such a stroke properly or misses it entirely. So a
column sweep ought to be needed. It is not: added with the same stub rule it
rescues nothing and inks one pixel Windows leaves blank. **Measured**, and
against expectation, which is why it is written down rather than kept.

Tested again after the phantom rounding, when the remaining differences were
eight missing pixels and none invented -- exactly the shape a missing dropout
rule leaves -- and at four stub thresholds:

| column sweep      | glyphs   | missing | invented |
| ----------------- | -------- | ------- | -------- |
| off               | 85 of 90 | 8       | 0        |
| stub half a pixel | 85       | 8       | 1        |
| stub a quarter    | 81       | 8       | 7        |
| stub a tenth      | 81       | 8       | 9        |
| no stub at all    | 81       | 8       | 9        |

The missing count never moves. Not once, at any threshold. A column sweep that
finds nothing to rescue means there is no thin span at those columns to rescue --
the outline does not reach them at all -- so what is left is a difference in
where the hinting put the outline, and not in how it was sampled.

What it would have rescued -- the flag of a Courier New `1` at thirteen pixels
per em, two pixels Windows draws and this does not -- stays **open**. Windows
gets those pixels by some route this does not have, and a column sweep is not
it.

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

**`IUP` moves only untouched points.** Interpolating over a point the program
moved deliberately drags it back, undoing most of the fitting. **Derived.**

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
| `font` (2,655 records)                                       | 98.0%     |
| `glyphs` (90 records)                                        | 93.3%     |
| `hinting` (618 records)                                      | 98.2%     |

Of the glyph records, every bitmap and plotter one is pixel-identical. The six
that differ are all outline faces, and between them they miss nine pixels
Windows inks and invent none.

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

What is left is fifty-one records, and most of them are no longer a font-mapping
or metric question at all. Thirty are the extent of a measured string, which is a
sum of per-glyph advances -- and those advances now come from running the hinting
programs, so what remains of the extent gap is the same twenty-eight advances
section 5 records against `hdmx`, reached by a different route. Fixing the
interpreter fixes both.
