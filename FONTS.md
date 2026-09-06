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

**Each strike answers for itself how many times over it may be drawn**, and the
answer is `floor((height + cell / 4) / cell)`, never more than eight. A quarter
of the strike's own cell is added before the division, so the step to the next
multiple happens a little before the multiple is reached -- which is why a
request can come back _taller_ than it asked for. Twenty-eight pixels of System
is answered with thirty-two.

**Recorded** on the two faces that hold exactly one strike each, so that nothing
about choosing between strikes can be confounded with it, at every height from
one to a hundred and twenty. Fixedsys is fifteen rows and steps at 27, 42, 57,
72, 87, 102 and 117 -- `15m - 3` every time. System is sixteen and steps at 28,
44, 60, 76, 92 and 108 -- `16m - 4`. Three and four are a quarter of fifteen and
of sixteen. Fixedsys reaching exactly `15 x 8` at a hundred and twenty and going
no further is what pins the cap at eight.

**Sideways the strike is drawn at most five times over**, however many times it
is drawn upward. The two multiples are the same until the fifth and then part.
Courier asked for ninety-six answers a cell of 96 -- sixteen rows six times --
with an average width of 45, which is its own nine _five_ times. Small Fonts
asked for eighty-seven answers a cell of 88, eleven rows eight times, with an
average of 25: five fives. **Recorded.**

**Which strike is stretched, when a face has several,** was open for three
sittings and is now read out of GDI rather than fitted. The section below has
it; what follows here is what fitting from outside could not reach, kept because
it is the reason the reading was worth doing.

It is not "the largest that does not overshoot": Courier asked for 38 answers
39, its thirteen row strike three times over, when 32 was available and fits. It
is not "the nearest": the same face asked for 25 answers 20 and not the 26 that
is a pixel away. It is not a two-sided linear penalty on the difference, with or
without a term for the stretch itself -- swept over every ratio up to 6:15 and
every stretch weight up to 24, the best fit still missed 23 of 302 heights.

### The mapper, read out of GDI

`GDI.EXE` segment 3 holds the font code -- `CreateFont`, `GetTextMetrics`,
`EngineRealizeFont` are all in it. At `17b4` is a routine that takes a logical
font, one candidate, a table of weights and a running limit, and returns a
32-bit penalty; at `2841` is the loop that walks the font directory 46 bytes at
a time, calls it for each entry, and keeps the lowest. The loop passes its best
score so far as the limit and the routine returns the moment the running total
passes it, which is why the terms are summed in the order they are. It stops
outright on a penalty of nought.

**The weights are twenty-eight words in GDI's data segment at `0x39c`, each
multiplied by 1024 as the table is built.** A device may supply its own -- the
builder at `511` reads `[dc+0x9a]` and falls back to the static table when that
is null -- so these are defaults rather than the only possible values. In order
from `0x39c`: 65000, 19000, 15000, 10000, 500, 9000, 8000, 50, 600, 350, 150,
150, 50, 50, 4, 20, 30, 4, 1, 3, 3, 3, 1, 1, 2, 1, 2, 1, and then two more that
are not scaled: 1 and 10.

**The face name is matched by atom.** `EngineRealizeFont` copies the first
eighteen bytes of the `LOGFONT` into a request structure, then stores at `+0x52`
an atom for the name it is asking for and at `+0x58` a second one. The penalty
routine adds `AddAtom` on the candidate's own name, compares, and deletes it
again: nought if it equals the first, 500 if it equals the second, and **10,000
if it equals neither**. That term dwarfs everything else, which is why a request
that names a face gets that face.

**The height term is a distance, and it is asymmetric.** The routine works out
what cell this candidate would have to be realised at -- `MulDiv(cell, wanted
em, own em)`, using `MulDiv` at `seg1:41b0`, which rounds -- and then charges
the difference from the candidate's own cell: **2 per pixel when the candidate
is taller than wanted, 1 per pixel when it is shorter**. So the mapper prefers a
strike that is too small over one that is too big, by exactly two to one.

Two other terms are worth having. Asking for fixed pitch and getting a variable
pitch font costs 15,000; the other way round costs 350; a request that named no
pitch at all and got a fixed one costs 1. And italic, underline and strikeout
mismatches cost 4, 3 and 3, which is to say almost nothing next to the name.

**There are no stretched candidates.** The question was wrongly put, and that is
why looking for the routine that enumerates them kept finding nothing. Each
strike is scored once, and how many times over it would be drawn is part of its
score. The whole of it, from `seg3:1bcb`:

```
wanted = lfHeight; candidate = dfPixHeight
if lfHeight < 0:  wanted = -lfHeight; candidate -= dfInternalLeading

if stretching and candidate < wanted:
    times = (wanted + candidate/4) / candidate      # sar cx,2 then idiv
    if times > 8:            times = 8
    if times + 2 >= candidate: refuse this strike outright
    penalty += 20 * times
    penalty |= (times - 1) << 3                     # a tie-break in the low bits
else:
    times = 1

realised = times * candidate
penalty += realised > wanted ? 150 * (realised - wanted) + 600
                             : 150 * (wanted - realised)
```

Everything in it was read rather than fitted, and three things fall out that had
been open for three sittings.

The quarter of a cell added before the division is `sar cx,2`, and it is what
the dense sweep had measured from outside: Fixedsys stepping at `15m - 3` and
System at `16m - 4`. The cap of eight is `cmp ax,8`. And **a strike is refused
outright when the multiple plus two is not less than its own height**, which is
why Small Fonts' three row strike is never stretched at all and its five row
strike only ever doubled -- the thing that had made that face fit no rule.

The weights are 20 a multiple, 150 a pixel of height error either way, and 600
more flat for erring on the tall side. So overshooting by a pixel costs what
undershooting by five does, and the stretch itself is cheap next to both.

**Then the aspect**, at `1d34`, for a request that names no width. The shape the
strike would come out at is compared with the shape of a device pixel, both in
hundredths:

```
shape   = MulDiv(100, dfHorizRes, dfVertRes)        # 100 for every VGA strike
device  = MulDiv(100, aspectX, aspectY)             # 100, a VGA pixel is square
perTime = MulDiv(shape, 1, times)

if stretching and perTime * 1.5 < device:
    across = MulDiv(device, 1, perTime)
    if across > 5: across = 5                       # the width cap, at 1d8c
    penalty += 20 * across
    penalty |= across - 1

penalty += 30 * abs(device - MulDiv(shape, across, times))
```

That is where the width cap of five lives -- measured from outside as a bare
fact, and here it is as `cmp ax,5`. It is also why the cap costs anything:
stretching six times up and five across leaves the letter seventeen hundredths
off square, and off square is what the term charges for.

**And last, the two multiples against each other**, at `1e66`: not how far off
square the letter comes out but how far the one stretch is from the other, the
larger over the smaller, at 4 a hundredth.

```
if times != across:
    penalty += 4 * (times > across ? MulDiv(100, times, across)
                                   : MulDiv(100, across, times))
```

Six up against five across is 120, so 480 -- more than a two pixel height error
costs outright, and enough to send Small Fonts asked for 60 to its eleven row
strike five times rather than its ten row strike six, which would have been an
exact 60.

With all of it the height rule is **exact**: all 302 heights of six faces, at
every size from one pixel to a hundred and twenty. A request that _does_ name a
width takes the other branch at `1c9e`, where the multiple is a plain division
with no quarter added, capped at five the same way, and the error costs 50 a
pixel rather than 30 a hundredth.

**At proof quality no strike is ever stretched.** The routine tests `lfQuality`
against `PROOF_QUALITY` before adding a single term and answers `0x7fffffff`,
refusing the candidate. Asking Windows what class of candidate that refuses
settles it: every answer, across six faces and twelve heights each, is a height
the face has a strike installed at. Fixedsys, whose only strike is fifteen rows,
answers fifteen for every request from eight to fifty, where the default quality
answers 30 and 45; Courier answers 13, 16 or 20 and never 26, 32, 40 or 48; MS
Serif answers 19 for a request of 20 where the default answers 20, its ten row
strike doubled. **Recorded.**

That is also the cleanest evidence that the stretched sizes are _candidates_ --
they can be refused one at a time, so they are being scored one at a time.

The four exceptions are all a hundred pixels, where refusing every stretch
leaves the nearest strike so far off that a scalable face wins the comparison
instead. Windows answers a hundred; we still answer with the strike, because we
resolve the face name before scoring anything and so never put an outline up
against it. **Open**, and the same penalty comparison decides it.

### Symbol, the face installed twice

Symbol is the only name carried by both a `.FON` and a `.TTF`, and it had been
read as the strike winning outright -- "a strike of the same name wins". It does
not. It wins at **thirteen and sixteen pixels**, the two sizes `SYMBOLE.FON`
holds below the size where outlines take over, and nowhere else. Asked for eight
it answers seven, for twelve twelve, for twenty twenty -- none of them a size
that file holds -- and `tmPitchAndFamily` says TrueType at every one. What had
made the old reading look right is that the only size ever asked for was
sixteen, where the strike and the outline agree in every field.

So it is the ordinary rule about strikes and outlines, with two corrections.

**The size at which outlines take over is about falling back to some _other_
face's strike.** A strike of the face's own name is not a fallback and is not
subject to it, which is how Symbol reaches its sixteen row strike where Arial at
sixteen reaches its outline.

**A symbol face is answered by its own strikes or by none.** Symbol at eight
pixels does not become Small Fonts the way Arial does; it stays Symbol and comes
back seven pixels tall, drawn from the outline. An ANSI strike is no answer to a
request for symbols.

Two things Symbol reports were wrong for want of ever being asked. `OS/2` class
12, the symbol classes, answered `FF_DONTCARE` on no evidence -- the only two
fonts carrying it are Symbol and WingDings, and neither had been asked for at a
size that reaches an outline. Symbol answers `FF_ROMAN`. And an outline reported
character set 0 always; Symbol answers 2. **The pitch and family of an outline
face are not derived from the `.TTF` at all**: they are the `dfPitchAndFamily`
byte of the `FONTDIR` entry in the `.FOT` the installer wrote beside it, which
is `0x17` for Symbol and `0x07`, `FF_DONTCARE`, for Wingdings (section 8a).

**A bold synthesised onto an outline widens every character by one**, the same
way it does on a strike, and the string by its own length. Only Symbol reaches
that too, the other three families shipping a bold file.

Together these take the metrics to **5,047 of 5,057** and Symbol's glyph cells
from none to 120 of 216.

**A slant synthesised onto an outline leans by about 0.28**, a quarter of the
height rather than the half a strike leans by. Only Symbol ever asks for one --
the other three outline families ship an italic file -- so until Symbol was
probed at the sizes where it answers with its outline, the corpus contained not
a single instance of this and the tenth that had been in the code was swept
against nothing.

Swept against 72 cells at six sizes, the wrong-pixel count makes a clear trough:
1,552 at a tenth, 1,042 at 0.24, **1,024 at 0.28**, 1,030 at 0.30, 1,128 at 0.34.
Windows' own ink agrees from the other side: fitting a slope to how far each row
of a slanted cell sits from the upright one gives about a third at twenty and
twenty-four pixels.

**Open**, and the shape of what is left says the angle was not the only thing
wrong: at the best angle four of the 72 come out exactly right, against none at
a tenth.

**An instrument settles it, and says the slant was never the problem.**
`symbol-slant` replaces every Symbol letter with the same upright bar and no
program at all: no hinting, no curve, corners stated in font units. Whatever the
italic cell then differs from the upright one by _is_ the slant, row by row, and
the bar reaches below the baseline so the answer covers the descender too.

It lands at **three tenths**, pivoting about the baseline -- the lean is
negative below it, which is where an outline differs from a strike and from a
stroke design, both of which lean from the bottom of the cell and never leftward.
At three tenths the bar's lean matches Windows' row for row at twenty-four
pixels and half the fabricated cells come out exactly right; a third matches at
twelve instead and fewer overall.

And it says the residual on the real letters is something else entirely. A plain
bar is wrong by about one and a half pixels a cell; a real Symbol letter is
wrong by fourteen. The 0.28 that had been here was fitted to the letters and was
compensating for that other error -- which is what a fitted constant does, and
why the fit and the instrument disagree.

**A face with no italic of its own is not hinted when it is slanted.** That is
the other error, and a second instrument found it. `symbol-shapes` puts three
things in place of Symbol's letters: a plain bar, an ellipse in the same box,
and the bar again with a program that rounds its edges to the grid. Upright all
three are exact. Slanted, the two without a program are wrong by about a pixel a
cell and the hinted one by three -- and turning hinting off for the slant brings
the hinted group to exactly the same count as the other two. The program is the
difference, not the shape, and the curve is not the difference at all.

A real letter says it more legibly. Symbol's alpha at twenty-four pixels has its
crossbar on row 14 upright, which is where Windows puts it and where the hint
puts it. Slanted, Windows moves it to row 15 -- which is where the _unhinted_
outline falls. With hinting off every row of that letter but two agrees.

Shearing before hinting, which is the other way a hinted feature could move, is
much worse than either: 1,795 wrong pixels against 681 for not hinting and 1,030
for hinting and then shearing.

**What is left is not the extremes**, which is what one letter suggested and
counting says it is not. Splitting the 681 by where in the cell it falls gives
118 on the topmost inked row, 149 on the bottom two, and **414 in between** --
and hinting is worse than not hinting in all three, 167, 185 and 678. There is no
hybrid to find: the alpha's feet looked like a case for hinting and are one
letter's worth of coincidence.

The residual looked like a _sampling tie on a sheared edge_, and the instrument
shows it in isolation. `symbol-shapes`' slanted bar disagrees on exactly one row
of a fourteen row cell, where our sheared edge covers three columns and Windows'
two. Read at the time as the edge passing through a sample point with the two
sides answering differently; it is a bar one pixel wide, and the paragraphs
below are what that turned out to mean.

That is the same _kind_ of question `lines` settled for `LineTo`, and it wants
the same kind of answer: a probe that walks an edge across a sample point rather
than a font that happens to contain one.

**A probe was built for exactly that, and it says the scan converter is not the
difference.** `slope-sweep` is `edge-sweep` leaning: every character a
parallelogram rather than a rectangle, both sides at the same lean, the right
side three font units further out than the last, and no program anywhere. A
leaning edge crosses a different phase of the sample grid on every row, so one
glyph is already a sweep and eighteen of them are eighteen runs at it. Half lean
by a third, which is what a synthesised italic leans by, and half by two thirds.

**All 264 agree.** So an oblique edge written into an outline is walked exactly
right, the sampling tie above is not a tie the scan converter breaks differently,
and whatever is left of the slant is in the shear rather than in the walk.

**And the constant is exactly three tenths, on every cell that measures it.**

It took a wrong turn to see that. Fitting a slope to the leftmost inked column
of `symbol-slant`'s bar gives, per size, ranges that do not intersect --
twenty-four pixels admits 0.289 to 0.304 and fifteen admits 0.339 to 0.389 --
which reads as the lean not being a constant slope at all. It is not. **A bar
one pixel wide is not drawn by its edges.** It is drawn by dropout control,
which places its pixel a column to the left of the run rather than at the edge,
so the column being fitted was never the edge. The instrument was measuring the
dropout rule and the fit was measuring nothing.

Sorting the slanted cells by how wide their widest inked run is says so
outright. Of the 264 slanted Symbol cells in the two instruments, the 24 whose
widest run is four pixels or more are **exact, every one**; every wrong pixel in
either instrument is in a cell three pixels across or narrower:

| widest run   | cells | cells wrong | pixels wrong |
| ------------ | ----- | ----------- | ------------ |
| 1 px         | 44    | 20          | 24           |
| 2 px         | 76    | 52          | 140          |
| 3 px         | 48    | 20          | 56           |
| 4 px or more | 24    | **0**       | **0**        |

`slope-sweep` says the same thing a second way: its parallelograms are wide
enough that no row of them needs dropout control, and all 264 agree.

Swept over the wide cells alone the minimum is sharp and single -- 0.29 costs
sixteen pixels, **0.30 costs none**, 0.31 costs sixteen again -- so three tenths
is not an average of something that varies. It is the number.

**And the mechanism has a name now.** It is the stub check, and the gate on it
is ours rather than Windows'.

`DoHorizDropout` refuses to rescue a zero-length run that has no continuation on
one side of it, which is what keeps the scan converter from drawing the tip of a
stroke as a stub. `cour-stubs` says that check is needed wherever an arm gives it
something to find and must not run on a bare post, and the gate standing in for
that here is the bounding box: a glyph too narrow to span a sample column is not
asked. **Shearing widens the box without widening the feature.** A bar one column
wide becomes a parallelogram four columns wide whose every row is still one
column, so the slant switches the check on and the glyph loses its tip row.
Symbol's twelve pixel bar inks rows 3 to 10 upright and rows 4 to 10 slanted;
Windows inks 3 to 10 both times, and its top row comes back two pixels wide.

Two things it is not:

- **Not the scan kind.** Run through the interpreter, every installed family
  answers `SCANTYPE` 1 at every size recorded -- Arial, Courier New, Times New
  Roman, Symbol and Wingdings, upright, bold and italic alike. A gate on the scan
  kind, which is what the shipped code gates on at segment 42 0x0a69, would apply
  the check everywhere or nowhere, and the recorded cells need both. That retires
  the conjecture the code comment was carrying.
- **Not "every run is zero-length" either**, which is what "nothing but the run"
  would mean if the box were only standing in for it. It rescues the sheared bar
  and costs more elsewhere than it saves: 78,567 fabricated cells against 78,734
  and 5,831 wrong pixels against 5,422.

So the box stays. And the chase for the real gate ended somewhere more
interesting than a third guess: **the pseudocode and the recording contradict
each other, and the contradiction is sharp enough to state.**

The counts are the source's and they are right. `HorizCrossings` walks the on
list and the off list together and counts a hit in either, so a zero-length run
on the next row is worth two by itself and the edge of a wide run is worth one.
Instrumented on `cour-stubs` that is exactly what comes out -- an interior row of
the post reads 2 above and 2 below, the row where the arm joins reads 1 from the
arm's own edge plus 1 from a vertical crossing, a tip row reads 0. The vertical
terms sit a row off the horizontal one in both branches and the offset cancels,
so the encoding shift is consistent rather than an error.

The check is real, too. Forced off, the armed post grows a foot at row 14 that
Windows does not draw. So `SK_STUBS` is set for Courier New -- and the source's
own arithmetic then refuses the **bare** post's two tips as well, 36 pixels that
Windows does draw. `DoVertDropout` carries the same check word for word, so no
second pass is rescuing them either.

One font, one scan kind, one stroke a column wide: Windows draws the tips of a
bare post and refuses the free tip of an armed one, and nothing in
`DoHorizDropout` tells the two apart. That is not a gap in our file to be closed
by a cleverer predicate -- three have now been tried and all three are worse:

| gate                         | cells  | wrong pixels |
| ---------------------------- | ------ | ------------ |
| the box (kept)               | 78,734 | 5,422        |
| every run zero-length        | 78,567 | 5,831        |
| no vertical crossings at all | 78,622 | 5,758        |

The last is the source's own quantity: with no vertical crossings the two
`VertCrossings` terms can only ever be nought, the check reduces to the
horizontal term, and no tip of such a glyph could ever be drawn. It is still
worse than the box.

**And the stub check is not most of the slant.** Forced off, it is worth 28 of
the instrument's 220 wrong pixels.

### The rest of it is not a missing pair of crossings

That was the guess the paragraph above used to end on, and chasing it down says
otherwise.

First the model, which the chase confirmed exactly. A row is sampled at device
`y = row + 0.5`, a crossing is `round(x)` there, and a run `[on, off)` inks
columns `on` to `off - 1`. Worked against the sheared bar at twelve pixels --
whose geometry is known to the third decimal, a parallelogram 0.703 px wide whose
left edge is `4.725 - 0.3(y - 2.848)` -- that predicts all eight of our rows and
every crossing on them. The endpoint topology is faithful too: it fires only for
a vertex lying exactly on a scanline, and the bar's horizontal top edge sits at
`y = 2.848`, between two, so it contributes no horizontal pair. That is what
`EvaluateEndPoint` does.

So on that row there are exactly two crossings and both are accounted for.
**There is no missing pair.**

With the stub check forced off, the 156 differing rows across both instruments
sort like this:

| where  | shape                      | rows |
| ------ | -------------------------- | ---- |
| middle | Windows has one pixel more | 40   |
| middle | we have one pixel more     | 36   |
| bottom | Windows has one pixel more | 28   |
| top    | one each, different column | 24   |
| top    | Windows has one pixel more | 12   |
| middle | one each, different column | 12   |
| top    | we have one pixel more     | 4    |

108 of the 156 are a rescue landing on a different row or a different column --
placement, not crossings. Only the 12 are the two-pixels-for-one case, and they
are one configuration seen twelve times, since every character of `symbol-slant`
is the same bar at a given size.

### The placement is not a slope error either

The 108 are worth one more pass, because there is an obvious suspect and it can
be cleared.

A one-pixel bar's ink ladder is a staircase: the run steps left one column every
`1/s` rows, so where the steps fall is a sensitive read on the slope. At twenty
pixels Windows' left edge steps every three rows exactly, at rows 7, 10, 13 and
16, and ours steps at 6, 10, 13, 16 -- one row early, once. Its right edge steps
at 7, 11, 14, 17 against our 7, 10, 14, 17 -- again one row early, once. Two
rows out of fourteen, both a single row of phase.

**Sweeping the slope on that one cell reproduces Windows exactly at 0.310 and at
0.315**, all fourteen rows, and at no other value tried between 0.285 and 0.345.
Which looks like an answer until the rest of the sweep comes in. With the stub
check off, over the slanted cells of each instrument:

| slant | `symbol-slant` | `symbol-shapes` | wide cells wrong |
| ----- | -------------- | --------------- | ---------------- |
| 0.290 | 168 px         | 156 px          | 8                |
| 0.295 | 156 px         | 136 px          | 8                |
| 0.300 | 96 px          | 96 px           | **0**            |
| 0.305 | 120 px         | 104 px          | 8                |
| 0.310 | **84 px**      | **84 px**       | 8                |
| 0.315 | 96 px          | 96 px           | 8                |
| 0.320 | 96 px          | 116 px          | 8                |
| 0.330 | 96 px          | 160 px          | 8                |

0.310 is the best value on wrong pixels and it breaks eight of the cells that
measure the slope with nothing left to dropout control, where 0.300 breaks none.
A slope that fits the hairlines better by fitting the unambiguous shapes worse is
not a slope correction; it is a slope compensating for something else. **So the
placement residual is not the shear.**

Nor is it one thing. At fifteen pixels no slope reproduces the bar at all: its
top row wants 0.320 or more, its rescue row wants 0.310 or more, and its bottom
row is `{2,3}` where ours is `{3}` at every slope in the sweep. Three sizes, three
different stories.

**And the leftovers sit on a corner.** Windows inks columns 4 and 5 on the top row
at twelve pixels. Column 5 cannot come from the run: reaching the
sample line at 5.5 needs the bar's right edge 0.268 px further out on that row,
a slope of 0.349, and 0.31 already costs sixteen pixels on the cells that measure
the slope. It cannot come from the vertical pass either -- the line at 5.5 is
never covered, the bar's rightmost point being 5.428, so that column holds no
crossings to rescue. And the horizontal rescue places one pixel, at 4. No shear
value and neither pass in the source puts ink there.

What column 5 _is_, at that row, is the pixel holding the parallelogram's
top-right corner: `(5.428, 2.848)` rounds to column 5, row 3. The same holds for
the fifteen pixel bar's stray bottom pixel -- the bottom-left corner
`(2.469, 14.344)` rounds to column 2, and clamped into the glyph's rows that is
row 13, which is exactly where the extra `2` appears. It is not a general rule --
the twenty pixel bar's top-right corner at column 8 is not inked -- so it wanted
an instrument, and got one.

### `corner-phase`, and what the corner turns out to be

`corner-phase` is `symbol-slant`'s bar with its top corner walked through a
pixel: twelve steps of the side bearing across, three of the bar's height down,
every pair, one to a letter. Upright, every cell of it is exact, which is what
says the sweep is a sweep of phase and nothing else. (The probe also asks for
`.`, which the fabrication does not replace; that cell is Symbol's own period,
and its one wrong pixel at eight pixels was there before this font existed.)

Of the 66 slanted cells it writes, with the stub check off, 23 disagree on their
top row -- and the disagreements are not scattered. **Windows' top row is ours
with one column added on the right, or ours moved one column right.** Every one
of the 23 is one of those two.

What sits in that column is the horizontal top edge of the bar. Reading the rule
as "the top edge inks the pixel centres it covers" -- centres at whole numbers,
between the corner's `x` and the top-right corner's `x` -- accounts for 18 of the
23:

|                                                      | cells  |
| ---------------------------------------------------- | ------ |
| differ, the edge's centres alone are Windows' row    | 9      |
| differ, ours plus the edge's centres is Windows' row | 9      |
| differ, the edge covers no centre at all             | 5      |
| agree, the edge covers no centre                     | 13     |
| agree, ours already is ours plus the edge            | 10     |
| **agree, but adding the edge would break it**        | **20** |

**So it is not the rule.** Eighteen explained is worth less than twenty broken,
and the five it cannot touch are all at eight pixels, where the bar is 0.469 px
wide and covers no pixel centre at any phase -- yet Windows still puts ink in the
corner's column there.

What the instrument does settle is that the stray is always one column to the
right, always on the row the top edge lies in, and there whether or not that edge
covers a sample point. That looked like something the horizontal edge itself
contributes -- the scan converter has a branch for a horizontal line, and it
emits no horizontal crossings at all.

### `corner-cap`: it is not the horizontal branch

So tilt the edge. `corner-cap` is the same bar with four caps -- top edge level,
tilted up four font units to the right, down four, and up forty. Four units is a
fiftieth of a pixel at these sizes, far too little to move any crossing, and
quite enough to take the edge out of the horizontal branch.

**The stray survives every tilt, at the same rate.**

| cap    | cells | top row wrong |
| ------ | ----- | ------------- |
| level  | 40    | 8             |
| up 4   | 24    | 6             |
| down 4 | 16    | 4             |
| up 40  | 8     | 2             |

A fifth of those is a fifth whichever way the edge leans, so the horizontal
branch is not it and that reading is withdrawn.

**What the tilt did settle is the shape of the thing, and it is symmetric.**
Across the recording every stray on the glyph's first inked row is to the
**right** of our ink and every stray on its last is to the **left** -- twenty and
eight of them, without exception. The bar leans right going up, so at both ends
the stray lies toward whichever side the shape reaches past that scanline.

That is a much better description than "a corner". It says the first and last
scanline of a slanted shape are inked wider than the scanline itself would
warrant, in the direction the shape carries on past it -- which is a statement
about the extreme rows of a walk, not about any one edge. Counting the pixels the
shape _touches_ over the whole row band gets the twelve pixel bar exactly right
and over-predicts at fifteen, so that is not yet the rule either.

### And it is not the dropout placement

Two things about the extreme rows are now settled, both by counting rather than
by argument, over the 43 rows where the two instruments disagree.

**It is not a dropout at all, on half of them.** Twenty-one of the 43 have a
_non-empty_ run on that row -- a real span of ink, with no zero-length run and so
no rescue anywhere near it -- and they disagree just the same. Whatever moves the
ink moves crossings, not rescues.

**And it is not smart placement.** `DoHorizDropout` has two ways of choosing its
pixel: simple, which steps one to the left, and smart, which averages the two
crossings. Every case this implementation gets right is one where a clamp into
the box hides the difference between them, so smart was worth ruling out
directly. Computed against Windows on the same 43 rows, the smart pixel is the
whole answer on 8, somewhere in the answer on 23, and outside it on 12. It is not
the rule, and `SCANTYPE` 1 is not secretly smart.

What the 43 _are_ is almost entirely one shape:

|                                          | rows |
| ---------------------------------------- | ---- |
| Windows is ours moved one column outward | 17   |
| Windows is ours plus one column outward  | 23   |
| neither                                  | 3    |

Forty of forty-three. So on the first and last inked row of a slanted shape,
Windows' ink is ours shifted or widened by exactly one column, always away from
the middle of the glyph.

### Windows does not shear the outline at all

That question has an answer, and it is that the premise was wrong.

Take the twelve pixel bar's top row, where Windows inks columns 4 and 5. **No
run can ink column 5.** A run inks a column when the shape covers that column's
sample point, at `x = k + 0.5`; column 5's is at 5.5, and the sheared bar's
rightmost point anywhere in the glyph is 5.428. **No dropout can place it
either**: the horizontal rescue steps one column _left_ of a zero-length run, and
the vertical pass has no crossings in a column its scan line never enters.
Sweeping the shear from 0.300 to 0.340 changes that cell not at all -- the ink is
identical at every value, because reaching 5.5 would take a slope of 0.349.

So the ink is in a pixel that no shear of the outline can reach. Which says the
outline is not what is being sheared.

**It is the bitmap.** Comparing each slanted cell against its own upright cell,
row by row, across all four instruments -- 384 cells:

|                                                       | cells |
| ----------------------------------------------------- | ----- |
| every row is the upright row shifted by whole columns | 199   |
| every row is that, or two adjacent shifts together    | 139   |
| neither                                               | 46    |

338 of 384. And the shift is not arbitrary. Reading it off the bar:

    h= 8   0  0  0  1  1
    h=10   1  0  0  0  1  1
    h=12   1  1  1  0  0  0 -1 -1
    h=15   3  2  2  2  1  1  1  0  0  0
    h=20   3  3  2  2  2  1  1  1  0  0  0 -1 -1 -1

**It steps every three rows.** A shear of one third, applied to the rendered
bitmap a row at a time -- which is exactly what the `.FON` faces do at one half,
and `bitmap-font.ts` has done all along. At twelve pixels the whole sequence is
`floor((baseline - 1 - row) / 3)`.

The proof of it is in the two sizes that break the pattern. At thirteen and
sixteen pixels the sequence steps every _two_ rows instead:

    h=13  -5 -5 -4 -4 -3 -3 -2 -2 -1
    h=16  -6 -5 -5 -4 -4 -3 -3 -2 -2 -1

Those are precisely the sizes at which Symbol resolves to its own strike rather
than to its outline -- and a strike leans by one half. The same recording shows
both rules side by side, each on the face it belongs to.

That also explains, at a stroke, three things that had no explanation: why the
slanted glyph inks exactly the rows the upright one does (96 of 96, measured long
before this); why ink appears in pixels whose sample points the shape never
covers; and why fitting a slope to it gives ranges that do not intersect. There
is no slope. There is a table of whole-column shifts.

What is left over is the 46, and the extreme rows within the 338 -- the top row
at twelve pixels is the upright row shifted by _both_ one and two columns, and
the bottom row at fifteen by both zero and minus one. So the ends smear across
two columns where the middle does not.

### Built, measured, and not shipped

Drawing the glyph upright and shifting the rows of the result by
`floor((baseline + c - row) / 3)`, swept over every origin `c` from -4 to 3, is
worse than shearing the outline at every one of them:

| origin | cells exact | wrong pixels |
| ------ | ----------- | ------------ |
| -3     | 96 / 384    | 4,981        |
| -2     | 133 / 384   | 3,323        |
| -1     | 110 / 384   | 2,001        |
| 0      | 109 / 384   | **1,665**    |
| 1      | 104 / 384   | 2,457        |
| 2      | 103 / 384   | 3,995        |

Against about 460 wrong pixels for the outline shear on the same cells. So it is
reverted, and the reason it fails is worth more than the model was.

Fit the shift table per glyph rather than per size. On `symbol-slant`, where
every glyph is the same bar, one table fits every glyph of a size and only one:
`K` = 2, 3, 6, 11 and 13 at 8, 10, 12, 15 and 20 pixels, using
`lean = ceil((K - row) / 3)`. The strike sizes, 13 and 16, fit no table of thirds
at all -- which is the one-half rule showing through, exactly as it should.

**But no single table fits all twelve of `corner-phase`'s bars at any size.**
Those twelve differ in side bearing and in height: the same shape, moved across
the pixel. A shear that shifts whole rows cannot care where a glyph sits
horizontally, and this one does.

So the ink is consistent with a row shift for any one glyph without being a row
shift. (The phase depending on the bearing is exactly what a shear of the outline
_does_ predict -- two roundings differ by the phase between them -- so it tells
against the bitmap and not against the shear.)

### `slant-baked`: the synthesis is not a shear of the outline, and that is now proved

Everything so far has been inference from pixels. This is a construction.

`slant-baked` is `symbol-slant`'s bar with the lean written into the outline:
each glyph is the same parallelogram `Surface.slant` builds, to the font unit,
sheared about the baseline by three tenths, and the probe asks for it **upright**
so that Windows synthesises nothing. Its device coordinates are ours exactly --
the bar at twelve pixels is `(2.352, 10.758) (4.725, 2.848) (5.428, 2.848)
(3.055, 10.758)` either way, because the side bearing is set to the sheared
shape's own leftmost point and the pen does not move.

**Windows draws it exactly as we do: 88 cells, no wrong pixels.**

So the fill is not the problem, and neither is the placement, and neither is the
scan conversion of an oblique hairline. Two more sweeps say the same from the
other side: sliding the sheared outline sideways in eighths of a pixel has a
sharp single minimum at nought (462 wrong pixels, against 658 an eighth right and
1,073 an eighth left), and hinting the glyph before shearing it is worse than not
(502 against 462).

And then the same shape, the same place, drawn the other way:

|                                   | ink                                             |
| --------------------------------- | ----------------------------------------------- |
| baked into the outline, upright   | `4:5 5:5 6:5 7:4 8:4 9:4 10:4 11:3 12:3 13:3`   |
| the plain bar, slanted by Windows | `4:6 5:5 6:5 7:5 8:4 9:4 10:4 11:3 12:3 13:2,3` |

The first is Windows and is also, to the pixel, what we draw for the second.

**Windows does not agree with itself.** Handed a parallelogram it draws one
thing; asked to lean the rectangle that parallelogram came from, it draws
another. Since we match it on the first, whatever it does for the second is not
"shear the outline and scan-convert" -- at three tenths or at any other slope,
since none in 0.285 to 0.345 reproduces the cell.

That is a proof rather than a fit -- of the three tenths shear, at least. To
close it for _every_ shear takes one more recording.

### `slant-angle`: not a shear at any angle

`slant-angle` bakes the same bar at twelve leans -- 0.20, 0.25, 0.28, 0.30,
0.3125, 1/3, 0.35, 0.364 (which is tan 20 degrees, the usual italic angle),
0.375, 0.40, 0.42, 0.45 -- and asks for each upright, three characters to a lean.

**All 88 cells are exact.** So the recording is a direct readout of what Windows
draws for a hairline at any of those leans, with none of our pipeline in the way.
Set those readouts beside `symbol-slant`'s slanted cells at the same sizes:

    size   0.200 0.250 0.280 0.300 0.312 0.333 0.350 0.364 0.375 0.400 0.420 0.450
    h= 8       .     .     .     .     .     .     . MATCH MATCH     .     .     .
    h=10       .     .     . MATCH MATCH MATCH     .     .     .     .     .     .
    h=12       .     .     .     .     .     .     .     .     .     .     .     .
    h=15       .     .     .     .     .     .     .     .     .     .     .     .
    h=20       .     .     .     . MATCH     .     .     .     .     .     .     .
    h=24       .     .     . MATCH     .     .     .     .     .     .     .     .

No lean matches at every size, and **at twelve and fifteen pixels no lean matches
at all**. The synthesised cell is not in the image of "bake a shear and
rasterise" for any angle from a fifth to nine twentieths.

The twelve pixel cell says why in one line. Its top row is two pixels wide,
`{4, 5}`, and the bar is 0.703 px across: no parallelogram that narrow covers two
sample points on any row, at any lean. Windows' synthesised glyph is _wider_ than
the bar it came from, and a shear does not widen anything.

**So the synthesis is not a shear of the outline. Not at three tenths, not at any
angle.** That closes off the whole family of models this section has worked
through -- shear, row shift, slope, placement, order of hinting -- and it does it
by construction rather than by fitting.

### `slant-width`: not a parallelogram at all

The widening is the one positive clue, so measure it. First, is it a property of
the row or of the phase? At twenty pixels, `corner-phase`'s twelve bars differ
only in where they sit across the pixel, and the rows that come back two pixels
wide differ with them:

    bearing 200   rows 10, 13, 16
    bearing 219   rows  7, 10, 17
    bearing 257   rows  5,  8, 11, 14
    bearing 276   rows  5, 12, 15, 18

**Phase, not row.** Which is the last nail in any model that shifts whole rows of
a bitmap: a row shift cannot know where the glyph sits horizontally.

Then how much wider? `slant-width` bakes the leaning bar at twelve widths from
160 font units to 380 and asks for each upright; all 88 cells are exact, so the
recording reads off what Windows draws for a parallelogram of that width. Against
`symbol-slant`'s slanted cells:

    size    160  180  200  220  240  260  280  300  320  340  360  380
    h= 8      .    .    .    .  YES  YES    .    .    .    .    .    .
    h=10    YES  YES    .    .    .    .    .    .    .    .    .    .
    h=12      .    .    .    .    .    .    .    .    .    .    .    .
    h=15      .    .    .    .    .    .    .    .    .    .    .    .
    h=20      .    .    .    .    .    .    .    .    .    .    .    .
    h=24    YES    .    .    .    .    .    .    .    .    .    .    .

No width works either, and the widths that do match somewhere disagree with each
other.

**So the synthesised glyph is not a parallelogram.** Twelve pixels settles it
inside a single cell. Its rows are `{4,5}`, `{4}`, `{4}`, `{3}`, `{3}`, `{3}`,
`{2}`, `{2}`: the middle rows are one pixel, so the shape is under a pixel wide;
the top row is two, so it is over a pixel wide. No parallelogram is both. The
lean is right -- a step every three rows -- and the shape is not.

That is as far as the shape can be pushed. What is left is that the extra pixel
is one column outward on an extreme row, which is what dropout control does, on a
glyph whose lean is otherwise a plain three tenths.

### And the extreme rows are stub control, which a slanted glyph does not get

The baked recordings answer this one outright, because they hold the same shape
twice. Compare the rows a cell inks, three ways:

| size | baked into the outline | slanted by Windows | plain upright |
| ---- | ---------------------- | ------------------ | ------------- |
| 8    | 3 to 6                 | **2 to 6**         | 2 to 6        |
| 12   | 4 to 10                | **3 to 10**        | 3 to 10       |
| 15   | 4 to 13                | 4 to 13            | 4 to 13       |
| 20   | 5 to 18                | 5 to 18            | 5 to 18       |

**A slanted cell inks exactly the rows its own upright cell inks, 88 times out of 88.** The same shape written into the outline does not: it loses its tip row in
18 of the 88, and we lose it in exactly the same 18, because that is stub control
refusing to rescue a run with nothing above or below it.

So the check that costs a bare stroke its ends is not applied to a glyph Windows
is slanting. That is one line, and it is worth 40 fabricated cells and 63 wrong
pixels -- and three records of the real corpus, which goes from 5,846 to 5,849 of
5,982. `Surface.outlineText` now passes `stubs: !italic` to the fill.

Which leaves, of the whole synthesised slant, 404 wrong pixels over the four
instruments' 384 slanted cells, of which 224 are now exact. Sorted by where they
fall, they are no longer only at the ends:

|                              | rows |
| ---------------------------- | ---- |
| middle, we lack a pixel      | 56   |
| middle, we have one too many | 52   |
| first row, neither of those  | 51   |
| middle, neither              | 48   |
| last row, we lack one        | 40   |
| first row, we lack one       | 35   |
| the rest                     | 15   |

And the one that started this is still there and still unexplained: the twelve
pixel bar's top row is `{4, 5}` where a rescue can only place `{4}`. Column 5's
sample point is at 5.5 and the sheared bar's rightmost point anywhere is 5.428,
so no run reaches it; a horizontal rescue would need a zero-length run at 6,
which needs a crossing at 5.5; a vertical rescue would need the scan line at 5.5
crossed, and it is not. Every mechanism in the source that can put ink in a pixel
has been checked against it and none can.

Two more possibilities closed on the way past. `Blit` fills a _negative_ run --
one whose `on` lies right of its `off` -- from the off to the on, and this does
too, so that is not the missing ink. And hinting the glyph before shearing it,
re-measured now that stub control has changed the ground, is still worse than
not: 440 wrong pixels against 404.

So the slant is closed down to about a pixel a cell on features narrower than a
pixel, everything wider is exact, and what remains is a pixel this file cannot
yet account for from the pseudocode.

### The scaler's dispatch table, and why it is not the way in

The obvious next move is to read the shipped rasteriser rather than the
pseudocode, and the obvious obstacle is that segment 36's four public entries all
funnel through a stack switcher at `0xe1`:

    00e5  mov ax,0xbc          ; the scaler's own data segment
    00e8  mov es,ax
    ...
    0111  mov ss,ax            ; switch to its private stack
    0116  rep movsw            ; copy cx words of arguments over
    011c  shl bx,1
    011e  call far [bx+0x1e]   ; and dispatch

**That `0xbc` is not a relocation.** Segment 36 has seventeen relocations and
none of them is at `0xe6`, so the selector is not patched by the loader; the
module fills it in itself at initialisation, and the table at `0xbc:0x1e` exists
only in a running system.

It is also not worth reaching for. What the table holds is the addresses of the
scaler's own functions -- `fsc_SetupScan`, `fsc_CalcSpline` and the rest -- and
those are the functions this project already has the source of. Reading it would
name them, not explain them.

The code that would explain them is in segments 42 and 43, which are in the image
and need no running system. The horizontal dropout is where earlier work left its
markers, and it matches the pseudocode where it can be checked: `0x0a61` is
`*psHorizOn == *psHorizOff`, the zero-length run test; `0x0a69` is the gate the
stub check hangs off; `0x0a71` and `0x0aa0` are its two crossing counts, both
calling `0x0e28`, whose guards at `0x0e60` and `0x0e8a` are the box tests inside
`VertCrossings`. Past that the routine clamps and writes a bit through one of two
helpers at `0x0c8a` and `0x0d42`.

### The comparison, done by function

Segment 42 has 37 prologues; twelve of them are reached by a direct call, and the
call graph is enough to name the ones that matter. Against `scanlist.c`:

| shipped  | calls                                                     | what it is                                            |
| -------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `0x0042` | `0x11e8` ×4, `0x0978`, nine more                          | the scan driver                                       |
| `0x11e8` | none                                                      | `CalcLine`, and the four calls are the four it gets   |
| `0x0978` | `0x0e28` ×2, `0x0eaa` ×2, `0x0d42` ×2, `0x0c8a`, `0x0cf3` | `LookForDropouts`, with both dropout routines inlined |
| `0x0e28` | `0x0db4` ×3                                               | one continuation test                                 |
| `0x0eaa` | `0x0db4` ×3                                               | the other                                             |
| `0x0db4` | none                                                      | the crossings counter                                 |
| `0x0d42` | none                                                      | `SetBitAbs`                                           |
| `0x0c8a` | none                                                      | the horizontal dropout's guard and write, fused       |
| `0x0cf3` | none                                                      | the vertical dropout's                                |

**The three-and-three is the pseudocode, line for line.** `DoHorizDropout` sums
exactly three counts per side --
`HorizCrossings + VertCrossings + VertCrossings` -- and each of `0x0e28` and
`0x0eaa` makes exactly three calls to the counter. Each is called twice from
`0x0978`, once from the horizontal dropout and once from the vertical, which is
the two routines' two tests each. The counter being one function rather than two
is the only structural liberty, and `HorizCrossings` and `VertCrossings` differ
only in which pair of arrays they walk.

`0x0c8a` is worth spelling out, because it is where an extra write would hide. It
takes `x`, forms `x + 1`, tests that bit, and **returns without writing if it is
set**; otherwise it ORs one mask into the bitmap, stepping back a long word when
`x + 1` is word aligned. That is `DoHorizDropout`'s `if (lXDrop < lBoxRight) { if
(GetBitAbs(lXDrop, lYDrop)) return; }` and its `lXDrop--; SetBitAbs(...)` folded
into one routine. One test, one write. `0x0cf3` is the same shape down a column.

**So the shipped dropout makes exactly the calls the pseudocode makes, and writes
exactly one pixel where the pseudocode writes one.** The missing pixel is not an
extra write in dropout control. It has to come from the lists the dropout reads
-- the crossings themselves -- or from somewhere outside this routine.

What could not be read this way: the bit masks are fetched from `DS`, which is
the scaler's private data segment, so only the arithmetic around them is visible
in the image. The inference above rests on the arithmetic and not on the tables.

### `CalcLine` at `0x11e8`, and what it confirms

Two thousand bytes, four callers, and **one call in the whole of it** -- an
indirect `call [bx+0x4a4]` at `0x1692`, reached by falling through and skipped by
five jumps to `0x1696`. The index is `(quadrant & 0xe) + [0x1ce]`, which is
`BeginElement` choosing the add function from the quadrant and the scan kind,
folded into a jump table. So every intersection the walk emits leaves through one
door.

Three things it confirms, all of them assumptions this implementation has been
resting on:

- **The sample grid.** At `0x1216` and `0x1227` the test is `p & 0x3f == 0x20`:
  a coordinate lies on a sample line when it is 32 modulo 64. That is
  `onScanline` in `scan-walk.ts`, to the constant -- sample lines through pixel
  centres at sixty-fourths, not through pixel edges. It had been derived from the
  recordings; it is now read off the shipped code.
- **A step that goes nowhere emits nothing.** The early-out at `0x120b` compares
  the incoming point against the running one and, when they are equal and the
  point is on a sample line, returns without emitting. `Endpoints.check` returns
  in the same case, for the reason written beside it.
- **The cross product.** The emission at `0x166a` computes
  `(a - b + p) * dy - (c - d + q) * dx` in thirty-two bits and hands it over,
  which is the sign test the walk turns on.

One thing it raises. At `0x1522` and `0x1553` there are two loops that write a
single value into a _range_ of scanline lists at once -- walking an array of list
pointers, incrementing each list's count and storing -- rather than one entry per
step. They are entered when `[0x1bc] == [0x1c0]`, an edge that spans one row or
one column. The backward loop runs `while (si >= di)` and the forward one
`while (si < di)`: one inclusive, one exclusive. This implementation writes those
entries one at a time and its two directions are `above` and `below`, which carry
the same asymmetry. Whether the two asymmetries agree at the ends is exactly the
question the last pixel asks, and it is the next thing to check.

#### The setup, and what the globals are

`CalcLine` opens by reading two points out of two parallel coordinate arrays --
`si` walks one, `di` the other -- and putting them in four slots: `[bp-0x2]` and
`[bp-0x6]` from one array, `[bp-0x4]` and `[bp-0x8]` from the other. Then it
rounds all four the same way and stores the results in consecutive globals:

    cx = coord ; cx += 0x1f ; cx &= -0x40 ; cx >>= 6

| global  | what it holds                                       |
| ------- | --------------------------------------------------- |
| `0x1ba` | the sample-line index of `x1`                       |
| `0x1bc` | the same for `y1`                                   |
| `0x1be` | the same for `x2`                                   |
| `0x1c0` | the same for `y2`                                   |
| `0x1c2` | `&column[index(x1)]`, the running pointer           |
| `0x1c4` | `&row[index(y1)]`                                   |
| `0x1c6` | the base of the column list array                   |
| `0x1c8` | the base of the row list array                      |
| `0x1ca` | the base the forward store indexes back from        |
| `0x1ce` | the scan kind, as an offset into the dispatch table |

The identification is anchored by `0x150f`, where the batch path is entered on
`[0x1bc] == [0x1c0]` -- the two endpoints on the same _row_ index, an edge that
crosses no scanline -- and then walks the **column** array from `index(x1)` to
`index(x2)` storing the row index into each. That is the `y1 === y2` branch of
`calcLine` in `scan-walk.ts`, which emits one vertical entry per column crossed,
and the two agree on which array and which value.

**And the rounding is `(v + 31) & -64`, which is the first sample line at or
above `v`, taking `v` itself when `v` is exactly on one.** `above` in
`scan-walk.ts` is `((p + 32) & -64) + 32`, which steps past `v` in that case: for
`v = 32` the shipped index is 0 and ours is 1. They agree for every coordinate
that is not exactly on a sample line, which is every coordinate an unhinted
outline produces and a great many that a hinted one does not.

The difference is covered, in the one branch where it has been checked. Where the
shipped code adds one to the stored index under a direction bit -- `test dx,0x100`
and `test dx,0x1` at `0x1553` -- this picks between `above(y1 - 1)` and
`above(y1)` on the same direction, and the two come out the same. Whether that
holds in the branches not yet read is the open question, and it is now a narrow
one: it can only bite a coordinate lying exactly on a sample line.

#### The three branches, and the frame confirmed

`CalcLine` splits three ways on the two index comparisons, and all three are in
`scan-walk.ts`:

- `0x150f`, on `index(y1) == index(y2)`: the edge crosses no scanline, so it
  batches the row index into every **column** list from `index(x1)` to
  `index(x2)`. That is the `y1 === y2` branch.
- `0x1591`, on `index(x1) == index(x2)`: the mirror, batching the column index
  into every **row** list. That is the `x1 === x2` branch.
- `0x1609`: the oblique walk.

The two batch branches are mirrors down to their asymmetries. Each has a forward
path that steps `si` on before a `while (si < di)` loop and a backward path that
steps it back before a `while (si >= di)` loop, and each adds one to the stored
index under a pair of direction bits -- but the addition sits on the _forward_
path in one and the _backward_ path in the other, on different bits
(`0x100`/`0x1` against `0x80`/`0x8`). That is the two axes' conventions mirrored,
and it is the same asymmetry `above` and `below` carry here.

The oblique walk is ours line for line. It saves the edge's `dx` and `dy` scaled
by 64, advances one axis by one sample step under the quadrant bits, and forms
`ydist * dx - xdist * dy` in thirty-two bits -- which is
`terminalX * initialYStep - terminalY * initialXStep`, the same product with the
same sign.

**And the one apparent difference is not one.** The shipped distances are
measured from the coordinate to `(v + 31) & -64`, a multiple of 64, where `above`
measures to `64k + 32`; the two differ by exactly half a pixel, which would shift
the initial error term by `32 * (dx - dy)` and change every tie. Taking that 32
off both distances and re-recording says otherwise, and not by a little: 9,140 of
18,792 cells against 18,532, and **106,192 wrong pixels against 492**. So the
frames agree, the rounded value is an index scaled rather than a position in this
frame, and the sample grid is confirmed a second time -- by experiment, after
being confirmed by the `& 0x3f == 0x20` test.

No divergence found. Three branches of `CalcLine` now correspond to three
branches here, and the one place the reading suggested they might part is closed
by measurement.

#### The endpoint topology, and why `above` is strict

The block from `0x1342` is entered on one test, and the test names two bits:

    131b  cx = y1 & 0x3f ; if (cx == 0x20) dx |= 0x100
    132a  cx = x1 & 0x3f ; if (cx == 0x20) dx |= 0x80
    1339  test dx,0x180 ; jnz 0x1342          ; either on a sample line
    133f  jmp 0x150f                          ; neither: the ordinary branches

**`0x100` means `y1` lies exactly on a sample line and `0x80` means `x1` does**,
and the endpoint topology runs only when one of them is set. The same pair of
tests is applied to the far point at `0x12ec` and `0x12fd`, incrementing that
point's indices instead.

That explains the increments the batch branches carry, and closes the question
the last section left open. The shipped rounding takes the sample line a
coordinate sits on; then, when the coordinate sits exactly on one, these bits
make the walk step past it -- `inc [0x1bc]` with `si += 2` and the distance
bumped by 64 in the oblique branch at `0x1645`, `inc ax` in the batch branches.
**Inclusive rounding plus a step past an exact hit is a strict `above`**, which is
what `scan-walk.ts` computes in one go, and the line the walk skips is the one
the endpoint topology emits for instead. The two are the same rule factored
differently, and the 106,192 wrong pixels that the half-pixel experiment cost are
the measurement of a mis-factoring rather than of a different rule.

What the topology block then does is take the turn. It forms the cross product of
the direction into the vertex with the direction out of it --
`(x1 - x0) * dy - (y1 - y0) * dx`, in thirty-two bits at `0x1349` to `0x135f` --
and records its sign in bit `0x10`. `horizTopology` and `vertTopology` decide the
same thing from the same three points, by comparing them rather than multiplying
them, and it is that sign which says whether a vertex contributes an `on`, an
`off`, both, or nothing.

#### The driver, and why the reading stops here

`0x0042` is the contour driver. It calls `0x0d6a` twice to set up, walks the
elements calling `CalcLine` at four sites and `0x19a4` -- the spline subdivision
-- at two, and finishes with `0x059b`, which fills the runs, and then `0x0978`,
which is the dropouts (section 8a reads both). The last
two `CalcLine` sites are adjacent and are the close: one for the final segment,
then one from the last point back to the contour's first, which the driver keeps
in a buffer at `+0x202` and `+0x204`. That is `Endpoints.begin` saving the first
vertex and `end` using it.

**And this is where reading segment 42 stops being able to help, for a reason the
instruments already settled.** `slant-baked` hands Windows the sheared
parallelogram as an outline, and Windows draws it exactly as this does -- 88
cells, no wrong pixels. That drawing goes through this driver, this `CalcLine`,
this endpoint topology and this dropout. So for the very geometry the slant
residual is about, segment 42 is _demonstrably_ in agreement with this
implementation, and no closer reading of it can turn up the disagreement.

The residual is also not in the spline code: every glyph in every slant
instrument is a straight-edged parallelogram, and `0x19a4` never runs on them.

Which leaves one place for it. Windows, asked to lean a rectangle, draws
something no parallelogram reproduces at any lean or any width; handed that same
parallelogram as an outline it agrees with us to the pixel. So it does not hand
the rasteriser the sheared outline. Whatever it hands it is made on the GDI side
of the call.

#### The realization path, which is not it either

`EngineRealizeFont` at segment 3 `0x2b2d` does three things with the request.

It copies the `LOGFONT`'s first eighteen bytes -- everything before
`lfFaceName` -- into a local at `[bp-0x60]`, which puts `lfItalic` in the low
byte of `[bp-0x56]`. **It never reads it.** The only two references to that
buffer are the copy itself and the `lea bx,[bp-0x60]` at `0x2be7` that hands it
on.

It calls `0x511` to build the weights into `[bp-0xd8]` -- the 28 words at DGROUP
`0x39c`, each multiplied by 1024 -- and then calls the candidate loop at `0x2841`
with the request, a result slot, `0x7fff` for the best cost so far and `-1`.

And when the mapper answers `0x53a` it writes a 3 into the output structure at
`0x2c15`. Three is the outline realization: the routine at `0x2b0a` that calls
the scaler thunk `36:0x00ae` guards on exactly `cmp byte [es:bx],0x3`.

One detail out of the mapper is worth keeping. Its first act on the style bytes,
at `0x28cf`, is to canonicalise three of them:

    mov cx,3
    al = [ss:di+0xa] ; neg al ; sbb al,al ; [ss:di+0xa] = al ; inc di ; loop

`neg` then `sbb al,al` leaves 0 for zero and `0xFF` for anything else, applied to
`lfItalic`, `lfUnderline` and `lfStrikeOut` in turn. So a request for italic 2 and
a request for italic 1 are the same request by the time anything compares them.
`FontManager` reads `!!request.italic`, which agrees.

**So the realization path records the choice and does not apply it.** Nothing
between the `LOGFONT` arriving and the font being realized touches the lean.

### `dot-sweep`, and the second pass

Reading further would have been the wrong move. The smallest question that can be
asked of the slant had not been asked: **what does it do to a single pixel?**

`dot-sweep` puts a square a hundred font units on a side in each glyph -- under a
pixel at every size recorded, so upright it comes back as exactly one inked pixel
-- at six heights above the baseline and six side bearings. The italic cell then
says where the lean puts that one pixel.

- **The row never changes.** Not in one cell of the thirty-six, at any size.
- The column moves right by a step that grows with the height at about a third:
  at twenty-four pixels, 0 or 1 at a pixel and a half up, 2 at five and a third,
  3 at nine and a quarter.
- **And sometimes one pixel comes back as two, side by side.** That is the thing
  no shear of an outline and no shift of a bitmap can do, and it is what the
  fabricated instruments had been showing all along as a stray at the ends of a
  bar.

Scored against this implementation the instrument was exact everywhere except ten
cells, and seven of those were the same shape: **Windows two pixels, us one.**
Dumping the lists for one of them says it in a line. At twenty-four pixels the
dot's italic cell has `hOn 18:[4] hOff 18:[5]` -- a run inking column 4 -- and
`vOn 5:[-18] vOff 5:[-18]`, **a zero-length vertical run in column 5**. Windows
draws both pixels. This drew one, because the vertical pass refused its rescue on
a stub check.

The horizontal pass had been spared that check for a slanted glyph several
sections above; the vertical one had not. `DoVertDropout` carries stub control
word for word as `DoHorizDropout` does, so a glyph being slanted is spared it in
both passes or neither. Sparing it in one was worth nothing on a bar, where the
vertical pass rarely finds anything, and everything on a dot.

Worth 12 records of the real corpus -- glyphs goes from 5,849 to **5,861** of
5,982, 98.0% -- and the instrument from ten differing cells to four.

#### The four that are left

They are two things, not one.

**Two are crossings, with no dropout in them at all.** At eight pixels the dot's
row reads `hOn 4:[3] hOff 4:[4]` -- an ordinary run, one pixel wide, inking
column 3 -- and Windows inks column 4. At twenty pixels another reads
`hOn 10:[5] hOff 10:[6]` and inks 5 where Windows inks 6. Both runs are
non-empty, so nothing here is rescued: the two sides simply put the sheared dot's
crossing one column apart. That is the scan conversion of a sub-pixel dot at a
particular phase, and it is the same _kind_ of difference the slant instruments
started with.

**Two are the two passes disagreeing about how many pixels a dot is worth.**

At twenty pixels one dot has a zero-length horizontal run at column 6 and
zero-length _vertical_ runs in two columns, 5 and 6. This rescues both -- column
6 at row 13, and column 5 at row 14, whose row is then clamped to 13 because the
box ends there -- and paints two pixels. Windows paints one, the column 6 one.
The clamp is the source's own: `DoVertDropout` returns early only when the row is
outside the band, and 14 is not outside a band that ends at 14, so it clamps to
13 and writes. We do what it says and Windows does not.

The other has a zero-length horizontal run at column 7 and a zero-length vertical
run in column 6. Windows paints 6 **and** 7; this paints only 6. Its horizontal
rescue never reached the placement at all, so the pixel at 7 -- which is the
run's own column, not a rescue -- comes from somewhere this does not look.

So the residual is no longer one thing that might have one cause. Two cells are a
crossing landing a column apart on a sub-pixel dot; two are the two dropout
passes, once too eager and once not eager enough, in the one configuration where
both of them fire on the same dot.

**And the two crossings are not the slant, which is worth checking because a dot
is the most sensitive thing there is to measure a shear with.** Both of them ink
one column left of Windows, which a slightly steeper lean would fix. Swept on the
dot instrument alone, a steeper lean does look better -- 88 cells of 96 and 19
wrong pixels at 0.320 against 87 and 21 at three tenths. But that margin is two
pixels across ninety-six cells, and the cells that can settle it say something
else entirely:

| slant     | `symbol-shapes` wide cells wrong | `dot-sweep`  |
| --------- | -------------------------------- | ------------ |
| 0.290     | 8                                | 87/96, 22 px |
| 0.295     | 8                                | 87/96, 22 px |
| **0.300** | **0**                            | 87/96, 21 px |
| 0.305     | 8                                | 85/96, 23 px |
| 0.310     | 8                                | 86/96, 22 px |
| 0.320     | 8                                | 88/96, 19 px |
| 0.330     | 8                                | 86/96, 19 px |

A wide cell is one whose narrowest feature is four pixels across, where nothing
is left to dropout control and the ink is the shape. **Nought at three tenths and
eight everywhere else** -- the same sharp, single answer those cells gave before
either dropout fix, and unmoved by them. Two pixels of preference on the dots
does not outweigh eight cells that admit no ambiguity.

So three tenths stands, and the two crossing cells stay open as what they are: a
sub-pixel dot whose sheared crossing this puts one column left of where Windows
puts it, at two phases out of thirty-six.

**And the two dropout cells are not the band edge.** The over-eager one paints
its extra pixel from a vertical rescue whose row is the box's bottom edge, 14,
and which the clamp brings in to 13. That looked like a half-open band: read the
guard as `row >= boxBottom` rather than `row > boxBottom` and the rescue is
dropped instead of clamped, which is exactly the pixel Windows does not paint.

`DoVertDropout` says `>`, and measuring says `>` too: half-open costs 25,156
cells of 25,620 against 25,327, and 748 wrong pixels against 467. So the guard is
right as it stands, and the pixel comes from somewhere else.

#### `dot-phase`: the smear is a threshold, and ours is a step out

Four scattered cells are too few to see a rule in, so the dot was walked through
a whole pixel of each phase. That turned up a fact about the harness first:
**the glyph probe only asks Symbol for eleven letters** -- `ABKMWagjmy1` and the
full stop. An instrument written across thirty-six of them, as `dot-sweep` was,
has eleven usable slots and twenty-five that are never recorded, which is why its
six by six grid came back mostly empty.

`dot-phase` spends the eleven on one axis: the dot at a fixed height, its side
bearing stepping nine font units a letter, a pixel across the eleven at twenty
per em. The other phase comes free from the eight sizes, whose shear at that
height is a different fraction of a pixel in each. Pixels drawn by Windows, with
`!` where the count differs here and `~` where the count agrees and the column
does not:

    h= 8   1   1   1   1   1   1   1   1   1   1   1
    h=10   0   0   0   0   0   0   0   0   0   0   0
    h=12   1   1   1   1   1   1   1   1   1   1   1
    h=15   1   1   1   1   1   1   1~  1~  1   1   1
    h=20   1   1   1   1   1   1   1   1   1   2!  1
    h=24   1!  1   1   1   1   1   1   1   1   2   2

**The smear is a threshold in phase, not a scatter.** At twenty-four pixels
Windows draws one pixel for the first nine phases and two for the last two; at
twenty it draws two at the ninth alone. And ours turns on about one step out: at
twenty-four it smears at the phase before Windows starts, and at twenty it fails
to smear where Windows does. One step is nine font units, a twelfth of a pixel
there.

So the two dropout cells are one phenomenon after all -- a boundary in the same
place to within a twelfth of a pixel, and off by that much -- rather than one
pass being too eager and another not eager enough.

**And a twelfth of a pixel is a useful size, because it brackets what can be
wrong.** Two candidates, one either side of it:

- **The box, a column wider.** The vertical pass only scans columns inside
  `[boxLeft, boxRight)`, so a box a column short would miss the smear
  systematically -- which is what happens at twenty pixels, where Windows smears
  at one phase and this smears at none. Widening `boxRight` by one costs 25,188
  cells of 25,620 against 25,358, and 721 wrong pixels against 376.
- **The shear, quantised to sixty-fourths.** The scaler works in F26Dot6, so a
  lean landing between two sixty-fourths of a device pixel is a place the two
  sides could part. Rounding the shear onto that grid changes one pixel in
  twenty-five thousand cells -- 377 against 376 -- and flooring it costs 404.

A sixty-fourth is 0.016 of a pixel and a column is a whole one; the boundary is
out by 0.07 to 0.18. **So it is too big to be a rounding and too small to be the
box**, and whatever sets it is neither of the two quantities that bound it.

A placement offset is that size, so the sheared glyph was slid sideways in
thirty-seconds of a pixel and both instruments scored at each step:

| shift      | `dot-phase`      | `symbol-shapes`  |
| ---------- | ---------------- | ---------------- |
| -0.063     | 85/96, 25 px     | 40/96, 156 px    |
| **0.000**  | 87/96, 21 px     | **56/96, 72 px** |
| +0.031     | 87/96, 20 px     | 52/96, 68 px     |
| +0.063     | 89/96, 16 px     | 52/96, 96 px     |
| **+0.094** | **89/96, 13 px** | 36/96, 120 px    |
| +0.125     | 86/96, 16 px     | 36/96, 132 px    |

**The dots want the glyph about a tenth of a pixel further right and the shapes
want it where it is**, and the trade is the same one the slope sweep found.
Which is not a coincidence: every dot in `dot-phase` sits at one height, so for
those cells a sideways shift and a steeper lean are the same change, and a shift
of 0.09 px at five and a third pixels up is a lean of 0.317.

So the two parameterisations agree, and they agree on a _negative_. **No affine
change to the shear satisfies both** -- not the slope, not the origin, not the
placement -- because each buys the dots at the cost of the cells where the ink is
the shape and nothing is left to judgement.

That is the closing statement of this chase. The remaining difference is not a
constant set wrongly. It is conditional: something that happens at some phases
and not at others, which is what a threshold is, and the condition is not any of
the quantities measured here.

#### The smear needs the slant, and the boundary is two sixty-fourths out

Two more questions, both smaller than the last.

**Does a sub-pixel dot need the slant to smear?** The recordings already held the
answer: across `dot-sweep` and `dot-phase`, an upright dot comes back as one
pixel or none, **102 cells and not one of them two**, while a slanted dot comes
back as two in ten of ninety-two. So the second pixel is a consequence of the
shear and not of sub-pixel dots in general -- which makes sense of it, since the
shear moves the dot across the column grid while leaving its row alone, and can
part the column the horizontal pass rescues into from the column the vertical
pass finds.

**And where exactly is the boundary?** `dot-phase` steps nine font units, a
twelfth of a pixel, which is too coarse to say. `dot-edge` and `dot-brink` step
three across the two crossings it straddles:

    bearing        200 203 206 209 212 ...            281 284
    h=24 Windows     2   2   2   1   1                  1   2
    h=24 here        2   2   2   2   1                  1   2

**At the upper crossing the two turn on in the same three units.** At the lower
one Windows stops smearing between 206 and 209 and this stops between 209 and
212 -- three font units late, 0.029 of a pixel, **about two sixty-fourths**. So
the displacement is not a twelfth of a pixel as the coarser instrument suggested,
it is not uniform across crossings, and at one crossing there is none.

Two sixty-fourths is the size of a placement offset, and one was tried:
`originX + 1/64` for a slanted glyph is better or equal on all four instruments
and breaks no wide cell -- `dot-brink` 91 cells of 96 against 90, `symbol-shapes`
64 wrong pixels against 72, `symbol-slant` unchanged. **The real corpus refuses
it**: glyphs falls from 5,861 to 5,860. So it is fitted to the fabricated dots
and it is not taken.

#### The column threshold, and how far out it is at each size

Printing the columns rather than the counts turns the second phenomenon into a
number as well. Windows' column at each bearing, with ours after a slash where
they differ:

    dot-edge, bearing 254 + 3n
      h= 8     3      3      3      3      3      3      3      3      3     3     3
      h=12     4      4      4      4      4      4      4      4      4     4     4
      h=15     4      4    5/4    5/4    5/4    5/4    5/4    5/4      5     5     5
      h=20     5      5      5      5      5      5      5      5      5     5     5
      h=24     6      6      6      6      6      6      6      6      6     6   6,7

**At fifteen pixels Windows steps from column 4 to column 5 at a bearing of 260
and this steps at 278.** Eighteen font units, which at twelve per em is 0.105 of
a pixel. At twenty-four the same kind of threshold is out by no more than six
units, 0.06 of a pixel, and at eight, twelve and twenty it is not out at all
across these windows.

So the displacement is neither a constant number of pixels nor a constant number
of font units: 0.105 px at twelve per em, under 0.06 at twenty, nothing at the
rest. It is small, it is size-dependent, and it is mostly zero -- which is the
signature of a positional difference of a fraction of a sixty-fourth, visible
only where the exact value happens to sit within that fraction of a rounding
boundary, rather than of a term that is simply missing.

#### Where the shear is rounded, which turns out not to matter

A fraction of a sixty-fourth has one obvious source. The scaler works in F26Dot6,
so Windows shears coordinates that have already been scaled and rounded onto the
sixty-fourth grid; this shears the design coordinates and rounds once at the end.
The two differ by at most about two thirds of a sixty-fourth -- which is the size
the measurements ask for.

So it was tried, three ways, over every slant instrument at once -- 47,856 cells:

| shear                                       | cells  | wrong pixels |
| ------------------------------------------- | ------ | ------------ |
| in design units, rounded once               | 47,329 | 810          |
| on the sixty-fourth grid, rounding the lean | 47,330 | 814          |
| the same, flooring it                       | 47,305 | 845          |
| the same, ceiling it                        | 47,331 | 809          |

**Two cells in forty-eight thousand.** The six at fifteen pixels are untouched by
all three -- had they moved, the aggregate would have shown at least six. So the
order in which the shear and the scaling are rounded is not where the difference
is: the two orderings are, in effect, the same. (Ceiling is a hair ahead of what
is here and is not taken; a rounding rule chosen on a two cell margin is a fitted
constant by another name.)

#### And the six at fifteen pixels are not in the crossings at all

The scale factor can be eliminated with arithmetic rather than a recording.
Symbol's em is 2048 units, a power of two, so `ppem / 2048` is exact in binary
and `v * scale * 64` is `v * ppem / 32` -- exactly representable for any integer
coordinate. No fixed-point form of the scale can differ from the float one, and
the same goes for any fixed-point value of three tenths: the closest candidates,
19/64 and 77/256, move a coordinate by less than a sixty-fourth at these sizes,
where the measurements want a tenth of a pixel.

So the lists were dumped instead, at four bearings across the run at fifteen
pixels:

    bearing 257   win col 4   us col 4   hOn 8:[5] hOff 8:[5] | vOn 4:[-9] vOff 4:[-9]
    bearing 260   win col 5   us col 4   hOn 8:[5] hOff 8:[5] | vOn 4:[-9] vOff 4:[-9]
    bearing 275   win col 5   us col 4   hOn 8:[5] hOff 8:[5] | vOn 4:[-9] vOff 4:[-9]
    bearing 284   win col 5   us col 5   hOn 8:[5] hOff 8:[5] | vOn      vOff

**Our crossing lists are identical at all four**, and identical where the two
sides agree as well as where they part. So the walk is not the difference: the
same lists produce column 4 here and column 5 in Windows over a run of six
bearings.

What changes at 284, where the two agree again, is the _box_: the vertical lists
empty, the box collapses to the single column 5, and the horizontal rescue --
`on - 1`, which is 4 -- is clamped back up to 5 by `boxLeft`. Windows reaches
that answer 18 font units earlier, which is to say **its box collapses earlier
than ours**.

The obvious rule for that was tried: `boxLeft = ceil(leftmost)` rather than
`ceil(leftmost - 0.5)`, which would put the left edge a column further right at
exactly this phase. It costs 36,952 cells of 37,584 against 37,219, and 1,735
wrong pixels against 517. So it is not that either, and the box rule stands as
measured.

But the narrowing is real, and it is the first one in a while: **the six cells at
fifteen pixels are not a crossing landing a column apart.** They are the same
crossings placed differently, and the placement is decided by the box.

#### Where the box turns over, to the sixty-fourth

Dumping the box's own inputs across the run gives the transition exactly. The
left edge advances a sixty-fourth a step:

    bearing   leftmost   box       narrow   Windows   here
    254       4.3750     [4,5)     false    4         4
    257       4.3906     [4,5)     false    4         4
    260       4.4063     [4,5)     false    5         4
    275       4.4844     [4,5)     false    5         4
    278       4.5156     [5,6)     true     5         5
    281       4.5313     [5,6)     true     5         5

**This collapses the box when `leftmost` crosses 4.5** -- `ceil(leftmost - 0.5)`
steps from 4 to 5 there -- and once collapsed the horizontal rescue at `on - 1`,
which is 4, is clamped back up to `boxLeft`, 5. **Windows reaches that answer at
4.406**, six sixty-fourths earlier, and holds it for the six bearings between.

So the difference is one number: where the box gives up its first column. And it
is not an offset. Biasing the box's edges by a constant and leaving the ink alone
is monotonically worse -- 602 wrong pixels at two sixty-fourths, 624 at four, 676
at six, 704 at eight, against 517 at none.

Which is the same shape of answer as every other parameter this section has
swept, and by now the pattern is the finding: **each constant that would fix the
narrow cells is refused by the wide ones, because the difference is conditional
and a constant is not.**

#### The condition, bracketed to a sixty-fourth and still not named

The transition above pins Windows' threshold between `leftmost` 4.3906 and
4.4063 -- one sixty-fourth of uncertainty -- against 4.5 here. That is tight
enough to test a candidate by arithmetic rather than by recording, and one
candidate fits it well: **half the shear across the glyph's own height.** The dot
is 0.586 px tall at twelve per em, the lean carries its top 0.176 px right of its
foot, and half of that is 0.088 -- inside the bracket.

It is wrong. At twenty per em the dot is 0.977 px tall, so half its shear is
0.147 px, and the threshold there is displaced by at most 0.059. Worse, the
candidate has the displacement _growing_ with the size where the measurements
have it shrinking: 0.094 to 0.109 of a pixel at twelve per em, no more than 0.059
at twenty, and nothing at all at six, nine or sixteen.

So three candidates are refused for this one number -- a constant bias,
`ceil(leftmost)`, and half the shear -- and two measurements, one of them a
bound, are not enough to fit a law to. A third was wanted, and where to find it
is calculable: the left edge is
`pen + x0 * ppem / 2048 + 0.3 * y0 * ppem / 2048` and the box gives up its first
column as that crosses a half, so bearings 292 to 312 straddle the turnover at
sixteen per em and at twenty, which the first two instruments miss.

`dot-third` records them, and the answer is not a third point on a curve.

At sixteen per em the two sides part by three sixty-fourths -- Windows settles on
column 6 at a left edge of 5.4688 and this settles at 5.5156 -- and the smear
moves with it, Windows' at 5.4531 against ours at 5.4844. One difference,
shifting both.

**At twenty per em there is no difference at all.** Both settle on column 7
between 6.5000 and 6.5156, in the same step of a sixty-fourth. And `dot-edge`
found the same at twenty per em, at a different crossing.

That is the finding, and it is a negative about the shape of the question rather
than another candidate refused. The displacement is 7 sixty-fourths at twelve per
em, 3 at sixteen, and **nought at twenty at two crossings out of three** -- so it
varies not only with the size but _between crossings at the same size_. A
positional difference cannot do that: an offset of any size displaces every
crossing at a size equally, and this one displaces one and not its neighbour.

So the framing the last several sections have worked under -- a small error in
where the sheared glyph sits -- is wrong. Whatever differs is decided afresh at
each crossing, which is what a comparison does and not what a coordinate does.

#### The comparison, named

There is one, and instrumenting which pass inks the pixel finds it. Across the
run at twelve per em:

    bearing 254   win col 4   us col 4   V col=4 row=9 -> row 8
    bearing 257   win col 4   us col 4   V col=4 row=9 -> row 8
    bearing 260   win col 5   us col 4   V col=4 row=9 -> row 8
    bearing 275   win col 5   us col 4   V col=4 row=9 -> row 8
    bearing 284   win col 5   us col 5   (no rescue at all)

Below the turnover the pixel is placed by the **vertical** rescue, into column 4.
Above it no rescue runs: the box has collapsed, `narrow` is true, and the
column sweep -- the path for a glyph narrower than a sample column -- draws
column 5 instead. Windows switches between exactly those two behaviours, and it
switches earlier.

**So the comparison is `narrow`**, which is
`floor(rightmost + 0.5) <= ceil(leftmost - 0.5)`: the glyph covers no sample
column. And naming it explains the thing that refuted the positional framing.
`narrow` compares two _separately rounded_ quantities, so where it flips depends
on the rounded width as well as the position -- and the rounded width changes on
its own. Across those same bearings the left edge steps a sixty-fourth at a time
while the right edge steps 328, 329, 331 sixty-fourths, so the width the
comparison sees is 48 sixty-fourths at one bearing and 49 at the next.

That is a predicate whose threshold moves with the size, with the phase, and with
which side of a sixty-fourth each edge happens to land on -- which is exactly the
per-crossing behaviour the third bracket found, and not something any offset
could imitate.

#### What Windows' form of it is not

The obvious other form is the one the column sweep actually wants: not "the box
collapsed" but **"the glyph crosses no vertical scan line"**, which is what makes
the sweep the right thing to do. Swapping the box test for `lists.vertOn.size
=== 0` over every instrument and the letter fabrications -- 43,566 cells --
gives 43,149 cells and 586 wrong pixels **either way, to the cell**.

They are the same predicate. The box's columns are exactly the vertical scan
lines the glyph spans, so collapsing the box and crossing no scan line are one
condition written twice. That is worth knowing -- two framings this section has
alternated between are not alternatives -- but it is not a new candidate.

And it closes the pincer. The predicate is the right one; the geometry it is
applied to is the same on both sides, since `slant-baked` shows Windows
rasterising this very outline identically; and yet the answer differs at three
crossings of the eight bracketed. Every way of moving the geometry has been
refused by the wide cells, and the one alternative form of the predicate is not
an alternative.

Here is the whole of the crossing at twelve per em, in sixty-fourths, for anyone
resuming:

    bearing   left   right   width   Windows   here
    254       280     328      48    wide      wide
    257       281     329      48    wide      wide
    260       282     331      49    NARROW    wide
    263       283     332      49    NARROW    wide
    266       284     333      49    NARROW    wide
    269       285     334      49    NARROW    wide
    272       286     335      49    NARROW    wide
    275       287     336      49    NARROW    wide
    278       289     337      48    NARROW    NARROW
    281       290     338      48    NARROW    NARROW
    284       291     340      49    NARROW    NARROW

Windows turns over as the width the comparison sees goes from 48 sixty-fourths to
49; this turns over as the left edge passes 288, which is four and a half pixels.
Whether that is the rule or a coincidence of one crossing cannot be told from one
crossing, and the two others bracketed do not repeat it.

#### What the shipped code rounds a box edge with

Rather than guess further, the disassembler was pointed at the rounding itself.
Searching the scaler's segments for a bias added to a sixty-fourth value before a
shift of six -- the shape any box edge must have -- turns up four in a row, in
segment 36 at `0x0ca7`:

    ax = [bx+0x7c] ; scale ; add ax,0x1f ; shift right 6
    ax = [bx+0x76] ; scale ; add ax,0x1f ; shift right 6
    ax = [bx+0x7a] ; scale ; add ax,0x1f ; shift right 6
    ...            ; then differences of the results

**`(v + 31) >> 6`**, four times, on four fields of the glyph's block, and then
subtracted from one another to give extents. For a value in sixty-fourths that is
`ceil((v - 32) / 64)`, which is exactly what `boxLeft` computes here and exactly
what `CalcLine` uses for a sample index. The right edge here uses 32 rather than
31, so a coordinate landing precisely on a half pixel falls the other way.

So it was taken -- and the recordings refused it. Rounding this implementation's
right edge with 31 costs 23,508 fabricated cells of 24,042 against 23,526, and
5,115 wrong pixels against 5,082.

**Which settles what those four fields are not.** They round the way a scan box
must, but the scan box's right edge does not round that way, so they are some
other extent of the glyph -- its metrics, most likely, which the caller needs and
the scan converter does not. The search for where the box is built continues past
them.

#### The block the box arrives in, and the chain it comes down

`0x0042`'s prologue reads its bounds out of a block passed in `dx`, and what it
does with them names them. It calls the allocator at `0x0d6a` twice: once with a
count of `[dx+0x10] - [dx+0x0c]`, storing the result at `[state+8]`, and once
with `[dx+0x0e] - [dx+0x0a]`, storing that at `[state+6]` and then into `[0x1c6]`
-- which the walk uses as **the base of the column list array**. So:

| field            | what it is                            |
| ---------------- | ------------------------------------- |
| `+0x0a`, `+0x0e` | the box's left and right, in columns  |
| `+0x0c`, `+0x10` | the scan band's low and high, in rows |
| `+0x02`, `+0x06` | the column arrays' handles            |
| `+0x04`, `+0x08` | the row arrays'                       |

The block is not filled in segment 42. Segment 40 at `0x07c5` fills it, by reading
words sequentially out of a caller's structure and scattering them into exactly
those offsets -- `[es:di+0x0a]`, `[es:di+0x06]`, `[es:di+0x1c]`, `[es:di+0x1a]`,
`[es:di+0x0c]` -- with ten more copied wholesale. It is a marshalling layer, not
a computation: **the box arrives already made.**

And the chain it arrives down is short. Segment 40 is entered from three places
only -- `1:0x7c14`, `47:0x002c` and `36:0x18dc` -- so the box is computed on
GDI's side of that marshalling, in segment 1 or in whatever reaches it, and
handed through segment 40 to the thunk in segment 36 and thence to the walk in
segment 42.

That is where the next dive starts.

#### Following it up, and a correction

**Two of those three "callers" are not calls.** A relocation records a fixed-up
word, and a far pointer stored in a _table_ is fixed up exactly as a `call far`
is. `1:0x7c14` is one of five entries eight bytes apart at `1:0x7bf4` --
`36:0x190d`, `42:0x0001`, `44:0x0001`, `45:0x0001`, `40:0x0001` -- and four of
them name offset 1, which is no entry point. It is a table of the scaler's
segments, for loading and locking. `47:0x002c` is data too. Only `36:0x18dc` is
an instruction.

It leads somewhere, but not to the box. `36:0x18d9` calls `40:0x0606` with a
pointer to a local block, which the loader fills; the caller then walks that block
four bytes at a time and hands each non-null pair to `0x1400`, which is a free.
The block holds allocation handles. And segment 40 contains **no shift of six
anywhere in it** -- no conversion from sixty-fourths to pixels at all -- so the
box is not computed there either.

Where that form does appear again is segment 43, at `0x0e36` and `0x0e50`:

    cx = [bp-0x12] ; add cx,0x1f ; and cl,0xc0 ; shift right 6   -> [0x890]
    ax = [bp-0x22] ; add ax,0x1f ; and al,0xc0 ; shift right 6   -> [0x892]

`((v + 31) & ~63) >> 6` is `CalcLine`'s own rounding, written out, and the results
are shifted left two and added to a base -- indices into an array of far pointers,
which is what a sample index is used for. Two edges, both biased with 31.

Read closely, segment 43 has the whole shape of it. Four edges in a row, each
`((v + 31) & ~63) >> 6`, into four consecutive globals `0x88c` to `0x892`; then
at `0x1121` the two ends of one axis are compared and the routine gives up if
they are equal; then at `0x112d`:

    ax = [0x88c] ; cmp [0x890],ax ; jz 0x1139     ; else jmp 0x122b

**Both ends of the other axis rounded the same way, compared for equality, and a
separate path when they match.** That is `narrow`, written out: this
implementation computes the same predicate as
`floor(rightmost + 0.5) <= boxLeft`, which is the same comparison with 32 on the
right end instead of 31.

So the test was changed to the read form -- and it loses: 23,508 fabricated cells
of 24,042 against 23,526, and 5,115 wrong pixels against 5,082. Exactly the same
loss as rounding the edge itself, which locates it: the loss is entirely in the
predicate.

**And then the relocations say why.** Segment 36 references segments 1, 37, 39,
40, 41, 42, 47 and 48. Segment 42 references 36, 44, 45, 47 and 48. **Neither of
them references 43.** Segment 43 is reached only from segments 8 and 48 and
refers only to segment 1: it is not part of the scaler at all, and the box read
out of it belongs to some other subsystem that happens to round its edges the
same way. Applying another subsystem's predicate to this one loses, which is what
it should do.

That is worth more than the false lead cost. The scaler's segments are now known
by their references -- 36, 37, 39, 40, 41, 42, 44, 45, 47, 48 -- and 43 is out,
along with the note higher up this file that once counted it in.

#### Every conversion from sixty-fourths, in every segment of the scaler

A box edge has to turn sixty-fourths into pixels, so the ten segments were
searched for every shift of six there is. There are four places, and that is all:

| where       | what it is                                                         |
| ----------- | ------------------------------------------------------------------ |
| `36:0x0388` | the 26.6 multiply: `imul`, `add ax,0x20`, `shr ax,6`               |
| `36:0x0ca7` | the four metric edges, `(v + 31) >> 6`, measured above and refused |
| `36:0x2143` | the memory sizing, with its "if it came out nought, make it one"   |
| `41:0x003f` | a coordinate transform, origin subtracted then split 26.6          |
| `42:0x1189` | `CalcLine`'s own, which this file matches                          |

Segments 37, 39, 40, 44, 45, 47 and 48 contain **no shift of six at all**.

Two things fall out. The multiply at `0x0388` rounds with **32** -- `(a * b + 32)

> > 6`, round to nearest -- which is what `sixtyFourth`does here, so the scaling
is confirmed from the source rather than inferred. And the index conversions
round with **31**, which is what`above` does, so that is confirmed too.

But **the scan box is not computed anywhere in the scaler.** The only candidate
of the right form is the metrics at `0x0ca7`, and the recordings refuse it.

#### Nor anywhere in GDI

The same search over GDI's own thirty-five segments finds **nothing at all**: no
shift of six, in any register, anywhere. The single `mov cl,6` in segment 1 is a
`rep stosw` count, not a shift.

So neither side converts sixty-fourths to pixels for a box, and the only thing of
that shape in the whole image is the four metric edges. **The box a glyph is
scanned in must be its metrics** -- which is to say, the _upright_ glyph's, since
a synthesised lean is applied after the metrics are taken and the box never hears
about it.

That predicts the crossing at fifteen pixels exactly. Quantising the unsheared
dot the way the scaler does, at a bearing of 254 its edges are 3.484 and 4.078,
so `boxLeft` is 3 and `wanted` is 4 and the box keeps two columns; at 257, 3.500
and 4.094, still 3 and 4; at 260, **3.531 and 4.109, which are 4 and 4** -- the
box gives up its first column exactly where Windows changes its answer, and stays
given up for every bearing after. The sheared box does not do that until 278.

**Putting it into the code needs one more piece, and then it works -- locally.**

The first attempt swapped the `narrow` test for the upright one and left every
dot cell unchanged, which read as the predicate not flipping. **It flipped.**
Printing both boxes side by side on the same cells says so plainly:

    bearing 254  sheared [4,5) wide    | upright [3,4) wide
    bearing 257  sheared [4,5) wide    | upright [3,4) wide
    bearing 260  sheared [4,5) wide    | upright [4,4) NARROW
    bearing 275  sheared [4,5) wide    | upright [4,4) NARROW

What did not change is the answer, because `narrow` only chooses the _path_: the
column sweep it selects then draws out of `boxLeft`, and `boxLeft` was still the
sheared one, still 4. The predicate turned over and the drawing did not follow.

Follow it and the four bearings come out exactly right. Take the upright box,
move it across by the lean **rounded to a whole pixel** -- 0.875 of a pixel here,
so one -- and every one of them agrees with Windows:

    bearing 254   displacement 0.891 -> 1   box [4,5)   wide     Windows wide
    bearing 257   displacement 0.891 -> 1   box [4,5)   wide     Windows wide
    bearing 260   displacement 0.875 -> 1   box [5,5)   NARROW   Windows NARROW
    bearing 275   displacement 0.875 -> 1   box [5,5)   NARROW   Windows NARROW

And measured, it does fix them: `dot-edge` falls from 76 wrong pixels to 70,
which is the six.

**It costs more than it fixes.** The same rule takes `symbol-slant` from 118
wrong pixels to 250, `corner-phase` from 161 to 240, and `slant-baked` -- exact
until now -- from nought to 183; the total goes from 5,082 to 5,486. Keeping the
sheared right edge and moving only the left recovers some of it, 5,233, and is
still a loss.

The reason is visible in the shapes. A dot is half a pixel tall, so the lean
displaces its foot and its top by nearly the same amount and a single rounded
displacement describes it. A bar is seven pixels tall, its top leans two pixels
further than its foot, and no single displacement describes it at all: the box
comes out far too narrow and the ink is clamped into it.

So the box is not the upright box moved across. It is something that _coincides_
with the upright box moved across when the glyph is smaller than a pixel, and
the six cells at fifteen pixels are the only place recorded where the two part.

#### What the two regimes have in common, and what refuses it

There is a rule that is both at once: **put every point where the lean would put
it if the lean moved whole pixels, and take the extremes of that.** For a dot half
a pixel tall the foot leans 0.879 and the top 1.055, both of which round to one,
so the box is the upright box moved across by one -- the rule that gets all four
bearings right. For a bar seven pixels tall the foot and the top round to
different numbers, so the box stretches with the glyph and stays wide enough to
hold it.

Measured, it does what it promises at both ends and still loses overall: 5,233
wrong pixels against 5,082. Per instrument:

| instrument     | before | after  |
| -------------- | ------ | ------ |
| `dot-edge`     | 76     | **70** |
| `dot-phase`    | 70     | **69** |
| `dot-sweep`    | 70     | 77     |
| `symbol-slant` | 118    | 178    |
| `corner-phase` | 161    | 198    |
| `slant-baked`  | **0**  | 149    |

The six cells go, as promised. And `slant-baked` -- exact today, every cell of it
-- loses 149 pixels, which is the sharpest constraint this chase has produced on
what the box can be. Rounding the lean to whole pixels moves each edge by up to
half a pixel, and on a glyph tall enough for its two edges to round differently
that is enough to shift a column.

So the sheared extent is right for everything that is not sub-pixel, the
whole-pixel lean is right for the dot, and nothing yet is right for both.
**`slant-baked` at nought is the guard rail**: any rule proposed for this box has
to leave it there.

The obvious repair does not repair it. Rounding the lean per _outline point_ is
crude for a tall glyph, whose points sit at arbitrary heights; rounding it per
_row_ is what a bitmap displacement would actually do, so the box becomes the
upright box with its bottom row's lean on the left and its top row's on the
right. That is more principled and measures no better: 5,277 wrong pixels against
5,082, with the same shape of loss.

The reason is now plain enough to state as a bound. **Any rounding of the box's
edges moves them by up to half a pixel relative to the ink**, and `slant-baked`
is exact today with the edges unrounded, so any rule that rounds them loses
there. But the dot at fifteen pixels needs them rounded, because that is the only
way its box gives up its first column where Windows' does. The two requirements
are contradictory for every form tried, and no form has been found that is
conditional on anything but the answer.

Which is where this stops being a search and starts being a guess, so it stops.
What would settle it is the code that builds the box, and the search for that has
narrowed to a contradiction of its own: it is not in the scaler's ten segments and
not in GDI's thirty-five, because **neither contains an instruction that turns
sixty-fourths into pixels** apart from the five already accounted for. Either the
box is carried in design units and scaled by the metrics path, or it is built
somewhere the shift is hidden in a helper.

The helpers were checked. The scaler shifts through two of them, `0x1aba` and
`0x1ae6`, taking the count in `cl`, so a search for `mov cl,6` cannot see a
variable shift. `0x1ae6` has ten callers: four are the metric edges already
known, and the other six shift by one, by ten, by fourteen, by eight after a bias
of 128, and one biases by 512. **Not one of them turns a sixty-fourth into a
pixel.**

So the count is closed. In the whole image the only conversions of the box-edge
form are the four metric edges at `36:0x0ca7`, and rounding this implementation's
right edge their way loses eighteen cells. Either those four **are** the box and
something else here is off by an offsetting amount -- the box rule in this file
was fitted rather than read, and a fitted constant can hide another error -- or
the box is carried in design units and never converted at all.

That is a real fork, and the first branch of it can be tested. If a fitted
constant is hiding another error, then correcting it should let the other one be
found: fix the right edge at the read value and search the box's remaining
freedom for something that pays it back.

Both edges were parametrised in sixty-fourths -- `boxLeft` as
`floor((left * 64 + p) / 64)` and `wanted` as `floor((right * 64 + q) / 64)`,
which reproduces this file's own numbers exactly at `p = 31, q = 32` -- and swept
over a subset holding the dot instrument, a bar instrument, `slant-baked` and an
upright letter fabrication:

    q=31  q=32  q=33
    343   343   343   p=30
    334   334   337   p=31
    360   360   363   p=32

**The minimum is at `p = 31`**, which is the value read out of the shipped code,
and it is a clear minimum: thirty and thirty-two both cost. So the left edge is
confirmed twice over, by reading and by measurement.

And `q` is flat. Thirty-one and thirty-two tie here, and over the whole
fabricated set thirty-one costs 33 wrong pixels. **There is no compensating pair.**
The box's own two constants have one optimum, this file already sits on it in
`p`, and the read value of `q` is a third of a hundred pixels away from the
measured one with nothing in the box to make up the difference.

So the first branch of the fork closes: if a compensating error exists it is not
in the box.

#### Which cells the two values of `q` actually decide

Thirty-three pixels is small enough to look at one at a time. Over every
fabricated recording there are, between `q = 31` and `q = 32`, **eighteen cells
that differ at all** -- and every one of the eighteen is `italic=0`:

    cour-gaps        h=10  K M N R S W X Z a
    cour-hairslants  h=14 k, h=16 '0', h=20 S
    cour-offsets     h=10 N '8', h=12 '0', h=14 '1', h=16 w
    cour-shapes      h=12 o

Upright Courier New, every one, and `q = 32` is right on all eighteen.

**So the two constants do not touch the slant at all.** The right edge's bias is
decided entirely by upright glyphs whose right edge lands exactly on a half
pixel, it is 32, and the italic cells cannot see the difference. That closes the
question in a better way than the sweep did: the metrics' 31 and the scan box's
32 are not a discrepancy to be reconciled but two different quantities, and the
recordings say which is which.

It also says the slant residual has nothing to gain here. Eleven cells in the
bracketing instruments remain, the box is exactly right for every upright glyph
recorded, and the second branch of the fork -- a box carried in design units --
is the only thing left that the pixels cannot answer.

#### Where the reading has been, and where it stops

A box in design units would be read out of the font and scaled, so the loader was
searched for it: a big-endian field arrives byte-swapped, and segment 40 -- the
whole glyph loader -- contains exactly **six** byte swaps. Two read a table's
count and its offset. One negates a value and writes it back, which is a mirror.
One divides by 360, which is an angle. None of them is a bounding box.

That exhausts what this file can search. Set out plainly, so that nobody repeats
it:

- Every conversion of sixty-fourths to pixels in the ten scaler segments: five,
  all identified, only four of the box's shape, and those four are the metrics.
- The same in GDI's thirty-five segments: none.
- Every caller of the two shift helpers the scaler uses, which is where a
  variable shift could hide: ten, six of them shifting by other amounts.
- Every byte swap in the glyph loader: six, none a bounding box.
- Both of the box's own constants, swept: one optimum, already sat on.

**The box is handed to `fsc_SetupScan` by a caller this file has not found, and
the reading cannot get further from the image alone.** What would get further is
watching the running system -- the marshalling in segment 40 fills the block from
a caller's structure, and a probe that could read that structure would answer it
in one recording. That is a different kind of instrument from any built here.

So the slant rests at eleven cells of 198 in instruments built to be as sensitive
to it as anything can be: everything a pixel wide or more exact, every upright
cell exact, `glyphs` at 98.0% and `font` at 99.8% of the real corpus.

(That 98.0% stood until the slant itself was read out of GDI's memory; it is
98.5% now. See "The lean is a whole number of pixels" at the end of this
section.)

#### Reading the box out of GDI's memory

The instrument the last section asked for turned out not to need ToolHelp, or a
way into GDI's data segment, or anything else that sounds hard. It needed one
observation about how Win16 works.

**A DLL has no stack of its own.** It runs on the stack of whoever called it,
and GDI is a DLL. So every frame the font scaler pushes -- the parameter block
`fsc_SetupScan` reads its bounds out of, included -- is built on the _calling
program's_ stack, in the memory immediately below its call to `TextOut`. When
`TextOut` returns, none of that is cleared. It is abandoned, and it is still
there.

`oracle/probes/stack.c` is that observation and nothing else. It draws one
character, copies the memory below the call into a buffer on the global heap
before anything can touch it, and writes the bytes down. Two details are
load-bearing and both are about not disturbing the evidence: the copy has to
happen before any record is written, because `probe()` builds its record in a
2400 byte local and writing one obliterates most of what is worth reading; and
the copy loop contains no call, because a call would push a frame into the
middle of it. Reading below the stack pointer is safe here rather than reckless
-- in the large model the stack sits at the top of the program's own data
segment, so an address below it is still an address inside a segment this
program owns, and the probe checks the offset rather than trusting it.

The first recording, four kilobytes deep, showed the drawing reaching 2446 bytes
below the call and not one byte further; everything deeper was still zero. The
scaler is entirely inside a window this probe can hold.

#### What the dump says

Two words at a fixed depth carry the box, and three separate copies of the left
one agree in every cell recorded. They are found not by guessing but by asking
which words in the dump hold the numbers our own scan converter computes: the
upright box left, which we know is right because every upright cell in every
instrument is exact.

For `dot-edge` at fifteen pixels -- eleven copies of one square, each three font
units further right, a fiftieth of a pixel a step:

|                  | A   | B   | K   | M   | W   | a   | g   | j   | m   | y   | 1   |
| ---------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GDI upright left | 3   | 3   | 4   | 4   | 4   | 4   | 4   | 4   | 4   | 4   | 4   |
| GDI slanted left | 4   | 4   | 5   | 5   | 5   | 5   | 5   | 5   | 5   | 5   | 5   |
| ours, slanted    | 4   | 4   | 4   | 4   | 4   | 4   | 4   | 4   | 5   | 5   | 5   |

The slanted box is the upright box moved over by one whole column, in all
eleven. It is **not** the box of the sheared outline. Ours is, and ours steps
one column late -- at `m`, where the sheared left edge crosses a pixel centre,
rather than at `K`, where the upright one does.

And the six cells where the two rows disagree are exactly the six cells whose
pixels disagree. `A` and `B` agree, `K` `M` `W` `a` `g` `j` do not, `m` `y` and
`1` agree again. **The box read out of GDI's memory predicts the disagreement
with no exceptions**, which is the strongest evidence in this file that the box
is where the fault is and not somewhere downstream of it.

So the rounding happens before the shear, not after it. That is a statement
about _order_, and it is the first thing about the synthesised slant that was
read rather than fitted.

#### Weighing the slant against y

One column, in eleven cells that differ only in x, also says the translation
does not depend on x. What it can depend on is how far above the baseline the
ink is, because that is what a shear multiplies -- so `dot-rise` holds x still
at the bearing where `dot-edge` agrees at every size, and moves the same square
up instead, eleven heights from 200 to 2000 font units.

| y0               | 200 | 380 | 560 | 740 | 920 | 1100 | 1280 | 1460 | 1640 | 1820 | 2000 |
| ---------------- | --- | --- | --- | --- | --- | ---- | ---- | ---- | ---- | ---- | ---- |
| GDI slanted left | 4   | 4   | 5   | 5   | 5   | 6    | 6    | 6    | 7    | 7    | 7    |
| ours             | 4   | 4   | 4   | 5   | 5   | 5    | 6    | 6    | 6    | 7    | 7    |

Ours is the same staircase one step late, again. The three cells where they
differ are `K`, `a`, and `m`; the pixels disagree at `K` and `a`, and at `m`
Windows draws nothing at all, so there is no pixel that could show it. Again no
exceptions.

The ink column and the box's left column are the same number in every one of
these cells, which is what a feature narrower than a pixel does: the dropout
rescue puts its one pixel at the box's left edge. That makes the fixture an
independent check on the dump, and the two agree.

#### What is still not read

Put the two instruments together and they bracket the slope the _box_ is sheared
by, if it is sheared at the ink's lower edge with the same `(x + 31) >> 6` the
upright box uses. `dot-edge` needs it in `[0.336, 0.347)`; `dot-rise` needs it in
`[0.315, 0.344)`; both together give **`[0.336, 0.344)`**, which contains
`22/64 = 0.34375` and does not contain the `0.3` the outline is sheared by.

Two different slopes is not a thing to believe on eleven cells, and the outline's
`0.3` is not in doubt -- it was measured on features four pixels and wider, where
a slope of `0.34` would be plainly visible and is not. So the bracket is a
measurement of _something_, and the something is not yet named. The honest
statement is the one above it: the box is rounded before the shear rather than
after, and the quantity the shear is applied to has been bracketed and not
identified.

#### Sixty-three boxes, and what they rule out

`dot-riser` is that sweep, built where the arithmetic stops rounding. At twenty
pixels Symbol answers with sixteen per em, and sixteen per em is the size where
2048 design units go to sixteen pixels -- one unit to exactly half a
sixty-fourth. Even coordinates are then exact, and a height in multiples of
twenty makes the shear exact as well, so the whole staircase can be predicted in
integers and compared against integers. Eleven heights twenty units apart move
it three sixty-fourths a step.

With `dot-third` recorded too, sixty-three boxes have now been read out of GDI's
memory, across four instruments and six sizes. What they say:

- **The upright box is `(x + 31) >> 6` on the outline's own extent, in all
  sixty-three.** That is not news, but it is the control: a model that breaks it
  is not considered.
- **The outline's own three tenths fits the slanted box nowhere.** Sweeping the
  slope, the height the shear is taken at, and the rounding constant together,
  no combination containing `0.3` fits. This is the strongest statement in this
  section and the one to build on: the box is not the sheared outline, rounded.
- **One slope and one constant fit sixty-two of the sixty-three**, at
  `s ≈ 0.342` with `(x + 30) >> 6`, or `22/64` with the same constant on the
  thirty-nine cells recorded before `dot-third`.

And the outline's slope is not in doubt either, because the obvious escape was
tried: setting `Surface.SLANT` to `22/64` so that one number does both costs 745
wrong pixels across the fabricated set and 53 cells. Three tenths draws the
ink; something near `0.342` places the box; they are different numbers.

#### The box clips, and that is why the box alone was not enough

Making our box agree with GDI's is not the same as making the pixels agree, and
finding that out was worth as much as the box was.

With the measured rule in place our box matched GDI's in all thirty-three cells
of the first three instruments -- and the pixels still disagreed. The comparison
says why. At fifteen pixels Windows draws `dot-edge`'s `K` as **one** pixel at
column 5. We drew **two**, at 4 and at 5: column 5 from the dropout, and column
4 from the ordinary fill, because the sheared outline really does cross the
sample column at 4.5. Windows does not draw it, and the reason is that there is
nowhere to put it -- the bitmap `Blit` fills _is_ the box, its column zero is
`boxLeft`, and a run reaching left of that is not clipped so much as absent.

For an upright glyph this can never happen: the box is the outline's own extent
rounded outwards, so it contains every run by construction, which is why the
clip was never needed and never noticed. For a synthesised italic the box leans
further than the outline, stands a column to the right of the ink, and takes the
leftmost column away. **Windows draws the column the box has, not the column the
outline crosses.**

Two writes need it -- the horizontal fill and the vertical dropout, which places
its column without clamping it -- and with both clipped, `dot-edge`'s six cells
at fifteen pixels come right.

#### Why it is not shipped

It is not shipped because it costs more than it earns: `dot-edge` gains six
cells and `dot-third`, `dot-sweep` and `dot-brink` lose ten between them, for a
net of nine cells against the ratchet. The box is right where it has been
measured and wrong where it has not, and a rule that is wrong in places does
more harm once the fill is clipped to it than it did when the fill ignored it.

The one cell that resists every model says where to look. It is `dot-third` at
twenty pixels and a bearing of 292, and it is the **only cell of the sixty-three
whose box is two columns wide** -- `5,7` where every other slanted box in the
set is one column. It is also the only one where Windows draws two pixels rather
than one. Every model that fits the other sixty-two puts its left edge at 6;
GDI's memory says 5.

So the rule holds for a box that has collapsed onto a single column and breaks
for one that has not, which is a sharp enough statement to build the next
instrument from: a sweep that walks a feature from narrower than a pixel to
wider than one, at a fixed bearing and height, reading the box at every step.
Where the box stops collapsing is where the two rules part, and that boundary is
what is missing.

#### The collapse is not it, and neither is the height

The instrument that boundary called for is `dot-widen`: one bearing, one lower
edge, one height, and eleven **widths**, from forty font units to three hundred
and forty. At sixteen per em that walks the ink from a third of a pixel to two
and two thirds, which takes the box from one column through two to three, so
the collapse boundary is crossed twice inside one recording. Nothing else about
the eleven glyphs differs at all.

The answer is flat:

| width, units  | 40  | 70  | 100 | 130 | 160 | 190 | 220 | 250 | 280 | 310 | 340 |
| ------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| slanted left  | 5   | 5   | 5   | 5   | 5   | 5   | 5   | 5   | 5   | 5   | 5   |
| slanted right | 6   | 6   | 6   | 6   | 7   | 7   | 7   | 7   | 8   | 8   | 8   |

**The left edge does not move.** The right edge does, exactly as a right edge
should. So the collapse is not what displaced the odd cell, and the hypothesis
that prompted this instrument is dead -- which is what the instrument was for.

`dot-taller` asks the only other question of the same shape: one bearing, one
lower edge, one width, eleven **heights** from forty units to six hundred and
forty. The left edge does not move there either, and the right edge grows with
the height, which is a second independent reading of the same slope in the same
recording.

Between them that is a construction rather than a fit. **The box's left edge is
a function of the ink's lower-left corner and nothing else** -- not its width,
not its height, not whether the box collapsed. Which is precisely the shape
"shear the bottom-left corner" predicts, and it is now measured instead of
assumed.

#### Two slopes reconcile into one

With `dot-taller` and `dot-widen` recorded, and the bearing sweeps repeated at
nine and twenty per em as well as twelve and sixteen, **172 boxes have been read
out of GDI's memory**. One model fits 170 of them:

> the ink's lower-left corner, sheared; displaced left by a constant number of
> **font units**; and rounded with a constant near 50 rather than the 31 the
> upright box uses.

And the slope that model wants is **0.303 to 0.305** -- the outline's own three
tenths, to the resolution the data has. The `22/64` of the previous section was
never a second slope. It was this constant displacement, which is a fraction of
the em and therefore grows with the size, being absorbed into a slope by a model
that had nowhere else to put it. Fit a slope alone across sizes and it comes out
too steep by exactly the amount the displacement contributes; admit the
displacement and the slope falls back onto the outline's.

That resolves the uncomfortable claim this file made a section ago. **There is
one slant, not two.** GDI shears the box's corner by the same three tenths the
scaler shears the outline by, and then moves it.

What is not settled is the displacement itself. Slope, displacement and rounding
constant are correlated -- a font-unit displacement and a sixty-fourths constant
trade against each other along a line, and four sizes from nine per em to twenty
do not separate them. The region within two misses spans slopes 0.303 to 0.325,
displacements of 20 to 48 font units, and constants from 41 to 54. A
displacement of 32 units -- one sixty-fourth of an em -- sits inside it and is
the only round number there, but it is inside a region, not pinned by it.

Two cells of the 172 resist every combination: `dot-third` at twenty-four pixels
and the largest bearing, and `dot-edge` at ten pixels, which is the smallest
size recorded and the one where the sweep is coarsest against the pixel grid.
Neither is the two-column cell that prompted `dot-widen`; that one now fits.

#### The small end, and what it pins

`dot-small` is that sweep. At six per em a whole pixel is three hundred and
forty font units, so `dot-edge`'s thirty-unit span cannot contain a step; rather
than widen the sweep and lose resolution, it is **placed**. Every combination
still standing after 172 boxes put the step between a bearing of 285 and one of
321, so the eleven walk from 280 to 330 in fives -- under a sixty-fourth a step
at that size, finer against the pixel grid than any sweep built before it.

The step is not there. At six per em the box reads 3 at every one of the eleven
bearings, and reads 3 **upright as well**: at that size the synthesised slant
does not move the box at all. The prediction was wrong, which is a result --
the step is above 330, and "above 330" is a constraint the fit did not have.

Sixteen and twenty per em do step inside the sweep, so the recording is not a
loss even where it was aimed wrongly. **223 boxes** are now read.

#### What 223 boxes pin, and what they do not

The upright control first, because everything rests on it. Across all 223, the
upright box is `(x + 31) >> 6` on the outline's extent with the scaling rounded
to nearest -- **exactly, with no exceptions, and uniquely**: every other pairing
of scaling and constant misses at least one. So the scaling this file has
assumed throughout is confirmed at a scale it had not been before, and any
residual in the slanted box is the slant's and not the scaling's.

For the slanted box, the model is now sharp where it was a region:

|                   | before `dot-small` | after                    |
| ----------------- | ------------------ | ------------------------ |
| rounding constant | 41 to 54           | **41**, and nothing else |
| shift, font units | −48 to −20         | **−22 to −20**           |
| slope             | 0.303 to 0.325     | 0.311 to 0.315           |

Three cells of the 223 resist every combination. Sweeping the slope at
fixed-point resolution rather than thousandths does not help, and neither does
the order of the arithmetic: shearing in font units and scaling once, scaling
and shearing separately, and shearing coordinates already rounded to
sixty-fourths all bottom out at the same three.

And the diagnosis is sharper than the failure. **Fitted one size at a time,
every size fits perfectly** -- six, nine, twelve, sixteen and twenty per em each
admit a slope, a shift and a constant that reproduce every box at that size with
nothing left over. The form of the model is right. What is missing is a term
that varies with the size, and it is small: two of the three failures are one
column, at twelve per em, in a window six font units wide.

Which is worth stating plainly, because it is the shape of the remaining work.
This is no longer a question about what the box _is_ -- it is the ink's
lower-left corner, sheared, displaced, rounded, and every one of those four
words is now measured rather than supposed. It is a question about one
size-dependent term of a couple of sixty-fourths, in a model that is otherwise
exact on 220 of 223 boxes and on 223 of 223 upright.

The two cells that carry it are `dot-edge` at fifteen pixels and bearings 260
and 263 -- which are, by an accident worth noticing, two of the original six
that started this section.

#### Measuring the term instead of fitting it

`dot-far` finishes what `dot-small` started. With 223 boxes read, the step at
six per em could be predicted rather than guessed at: eleven bearings from 335
to 385 in fives, spaced so that **the bearing the box first steps at is the
answer read straight off a table**. It steps between 345 and 350, and the ink
columns in the glyph recording step in the same place, so the reading has two
independent witnesses.

That, plus seven per em added to the probe, makes **309 boxes**. And the upright
control still holds on every one of them: `(x + 31) >> 6` on the coordinate
rounded to nearest, exact and unique, now at 309.

Which is what lets the term be _measured_ rather than fitted. Take the upright
rule as given -- it is exact -- and ask what displacement `D`, in sixty-fourths,
put through that same rule reproduces the slanted box. Every cell gives an
interval; a size's cells intersect to give the size's answer:

| per em | cells | D, sixty-fourths | implied slope |
| ------ | ----- | ---------------- | ------------- |
| 6      | 33    | **31**           | 0.331         |
| 7      | 22    | 24 to 34         | —             |
| 9      | 44    | 26 to 52         | —             |
| 12     | 56    | **64**           | 0.338         |
| 16     | 56    | **78**           | 0.312         |
| 20     | 44    | **94**           | 0.301         |

Four of the six are pinned to a single sixty-fourth. And the intersection being
non-empty at all is itself a result: `D` is **constant across the bearings**
within a size -- fifty-six cells at sixteen per em agree on one value to a
sixty-fourth -- which is a strong check that the displacement depends on the
size and the height and not on where the glyph sits.

#### What the numbers say, and what they refuse

The implied slope **falls with the size** -- 0.331, 0.338, 0.312, 0.301 -- and
lands on the outline's own three tenths at the largest size measured. A shear at
three tenths accounts for 28, 56, 75 and 94 sixty-fourths of those four
displacements, so the excess is:

    3, 8, 3, 0    at 6, 12, 16 and 20 per em

Small, and not proportional to anything: not to the size, not to the height, not
to the em. Eight sixty-fourths at twelve per em is an eighth of a pixel, and it
is more than twice the excess on either side of it.

So the term is real, it is bounded, and it is not a shear. Searching every
ordering of the arithmetic -- three roundings for the horizontal scale, three
for the vertical, three for the shear, twenty-seven in all, against a slope swept
at fixed-point resolution, a displacement in font units and a rounding constant
-- the best fit over all 309 misses **seven**. It missed three of 223 before the
small sizes were added, which is the more honest way to read the earlier number:
the model was never right, it was under-tested.

That is the state. The box is the ink's lower-left corner, sheared, displaced
and rounded; the rounding is `(x + 31) >> 6` and confirmed on 309; the
displacement is measured at four sizes to the sixty-fourth; and the rule that
generates those four numbers from the size is not known. What it is not, now, is
vague -- a candidate has four integers to reproduce and 309 boxes to be checked
against.

#### Ten sizes instead of four

Four points are not a curve, and the reason there were only four was the
instrument rather than the question. The probe was writing eighty-one records a
cell to carry two words. It now writes **five**: the capture is still taken
whole -- a shallow capture is the one mistake that cannot be undone afterwards
-- and only the 128 bytes that can contain the box are written out. Sixteen
times cheaper, and what that buys is the eleven bearings at _eighteen_ sizes
across all four bearing sweeps, in four recordings.

Two of the eighteen are not outlines at all. Symbol has bitmap strikes, and at
nineteen and twenty-one pixels the box words hold 149 and 0 -- values the
upright rule cannot produce -- and do not vary with the fabricated bearing.
A strike ignores the outline we wrote, so it ignores the bearing we wrote, and
it says so. They exclude themselves.

The mapper also quantises, which is worth writing down on its own: **twenty-four
and twenty-six pixels produce identical staircases**, stepping at the same two
bearings, so they are the same em size and not two.

That leaves ten distinct sizes with the displacement pinned:

| per em   | 6   | 11  | 12  | 14  | 16  | 18  | 20  | 23  | 26  | 33  |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D, 64ths | 31  | 47  | 64  | 64  | 78  | 93  | 94  | 110 | 126 | 173 |

#### And what ten sizes rule out

At a fixed design height, a shear is proportional to the em size. This is not.

Divide each displacement by the height it is applied to and the implied slope
does not settle: 0.268 to 0.279 at eleven per em, 0.336 to 0.347 at twelve.
Those two intervals are **disjoint**, and they are adjacent sizes. Between them
the displacement moves seventeen sixty-fourths where a shear of that height
would move five; between twelve and fourteen per em it does not move at all.

So the displacement is not the shear of the ink's height, and no rounding of one
will make it so. That does not undo what `dot-widen` and `dot-taller` settled --
the left edge still comes from the ink's lower-left corner and from nothing else
about the glyph, and it still moves with the height at a fixed size. What it
undoes is the assumption that the amount is `slope × height`, which every model
in this section has taken for granted and which ten sizes now refuse.

The four integers turned into ten, and the ten are worse news than the four
were. That is the right kind of worse: a model that fitted four points and fails
ten was fitting the points.

#### The lean is a whole number of pixels

Ten sizes refused `slope x height` because the question had been asked the wrong
way round. Every fit so far held the _height_ fixed at five hundred units and
watched the size; the one thing never done was the opposite -- hold the size and
watch the height. The instruments for it already existed. `dot-rise` and
`dot-riser` walk a square up the cell at one bearing, and with the probe now
costing five records a cell instead of eighty-one they could be recorded at all
eighteen sizes for the price of one earlier recording.

Two hundred (size, height) pairs later, the answer falls out at once. Fit
`D(y) = round(slope x y) + K` at each size **separately**, and:

- it fits at every size, with **K = 0** at every size. There is no constant
  term. It was a shear all along.
- the slope it wants is different at every size -- and at every size it is a
  **whole number over the size**:

| per em | 9   | 11   | 12   | 14   | 16   | 18   | 20   | 23   | 26   | 33    |
| ------ | --- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ----- |
| slope  | 3/9 | 3/11 | 4/12 | 4/14 | 5/16 | 6/18 | 6/20 | 7/23 | 8/26 | 11/33 |

Ten sizes, ten integers, each uniquely determined by its size's cells. And every
one of them is `floor(ppem / 3)`.

**The synthesised italic leans by a whole number of pixels over one em, and the
number is a third of the size, truncated.** Nominally one in three; in practice
one in three rounded down onto the pixel grid, so the slope is `4/12` at twelve
per em, `5/16` at sixteen, `6/20` at twenty, and exactly a third only where
three divides the size.

The arithmetic is `(x + 31) >> 6` on `round(x * ppem / 32) + round(m * y / 32)`
with `m = floor(ppem / 3)` -- the scaled coordinate and the shear rounded
**separately**, which matters: folded into one rounding it is 945 of 948 rather
than all of them.

Against every box read so far -- 948 of them, eight instruments, sixteen sizes,
upright and slanted:

    upright   (x + 31) >> 6                          948 of 948
    slanted   + round(floor(ppem/3) * y / 32)        948 of 948

#### What it was worth

`Surface.SLANT`, the three tenths this file has carried since section 3, is
gone. It was never careless -- it was swept over the twenty-four cells wide
enough to measure a slope and the minimum was sharp and single. It was a sharp
minimum in the wrong family of curves: those twenty-four cells all sit at sizes
whose true slope is near three tenths, and a sweep over constants cannot ask for
a slope that changes with the size.

With the rule in its place, on the fabricated set:

| instrument      | before                     | after                          |
| --------------- | -------------------------- | ------------------------------ |
| `symbol-slant`  | 252/288, 72 wrong          | **288/288, 0 wrong**           |
| `symbol-shapes` | 248/288, 72 wrong          | **288/288, 0 wrong**           |
| `slant-width`   | 243/288, 93 wrong          | 276/288, 27 wrong              |
| `slant-baked`   | 249/288, 94 wrong          | 273/288, 30 wrong              |
| `slant-angle`   | 240/288, 114 wrong         | 269/288, 41 wrong              |
| whole set       | 25,188/25,770, 5,228 wrong | **25,444/25,770, 4,679 wrong** |

The two instruments built for no other purpose than to measure this are now
exact. And on the real corpus -- recorded Windows, not fabrications -- `glyphs`
goes from 5,861 of 5,982 to **5,890 of 5,982, 98.5%**.

The eleven cells that this whole section was written to explain are **two**.

#### The box's own arithmetic, and what the corpus refused

The box rule is now known exactly, and both edges of it check out against every
box read:

    left    round(x_min * ppem / 32) + round(m * y_min / 32), then (v + 31) >> 6
    right   round(x_max * ppem / 32) + round(m * y_max / 32), then (v + 32) >> 6,
            floored at left + 1 as the upright box already is

    948 of 948, both edges, eight instruments and sixteen sizes.

Two things about it are worth separating, because only one of them survived
contact with the recorded corpus.

**The two roundings stay apart.** The scaled coordinate is rounded to a
sixty-fourth, the shear is rounded to a sixty-fourth, and then they are added.
Folded into one rounding it is 945 of 948; kept apart it is 948. That is
measured, it is implemented, and -- honestly -- it moves no pixel in anything
recorded so far. It is three boxes in a thousand and none of them decides a
crossing.

**The corners were an assumption, and a wrong one.** Every instrument in this
section is a rectangle, where the leftmost point _is_ the lowest point, so none
of them can tell "the sheared corners of the glyph's bounding box" from "the
minimum over the sheared points". Building the box from `(x_min, y_min)` and
`(x_max, y_max)` -- which is what a bounding box means, and what GDI most likely
holds -- costs **five records of the real corpus**, where a glyph's leftmost
point and its lowest point are different points. So the minimum over points
stands, and the corner reading is written down here as refused rather than left
looking plausible.

#### Bold does not widen the box

The same probe answers the other synthesis in one recording. Symbol ships no
bold file either, so a request for one is emboldened; and whatever emboldening
does, it must do to the box first if it is the scan converter's business.

It is not. **The box GDI hands the scan converter for a bold glyph is byte for
byte the box it hands it for a plain one** -- identical left and right, at all
sixteen sizes and all eleven bearings of `dot-edge`, with not one cell
differing. Emboldening is a smear of the finished bitmap and nothing to do with
the outline or the box.

Which makes the twenty bold records the corpus still disagrees on a puzzle
rather than a box question, and one specific reading of them is now closed off.
Symbol's `K` at ten pixels is bold exactly where the plain glyph is one column
narrower than its widest row, and _not_ bold on the two rows that reach that
width -- which looks precisely like the smear being clipped at the box's right
edge, the way a run is. It is not that: clipping the smear to the box costs 786
cells of the fabricated set and 37 records of the corpus, because a feature
narrower than a pixel is bold in Windows and its box is one column wide. Both
readings were tried; both are worse; the unclipped smear stands.

That leaves the corpus at `glyphs` 5,890 of 5,982 and `font` 5,047 of 5,057,
with the remainder in four groups: 23 synthesised italic, 20 synthesised bold,
32 in the plotter faces, and 8 in Symbol upright at eight pixels.

#### The probe pointed at the real face

Every recording of the stack probe so far has been against a fabricated Symbol,
because a fabrication is what makes a box predictable. Pointed at the **real**
face it answers a different question: not what the rule is, but where our
implementation of it still parts company with GDI.

132 cells comparable, and the split is clean:

- **117 agree**, upright and slanted.
- **15 differ, and every one of them is an italic cell whose pixels also
  disagree.** In all fifteen GDI's left edge is _further right_ than ours --
  never once further left.

So what is left of the synthesised slant is not a slant question at all. It is
one box edge, in named glyphs: Symbol's mu, alpha, phi, Omega and its digit one,
at the sizes where those disagree and nowhere else. The recording is kept as
`oracle/fixtures/stack.json` so the next attempt has the fifteen to check
against rather than the pixels to infer them from.

One reading is already closed. A shear taken from the bottom of the cell rather
than from the baseline -- which is exactly what the bitmap faces do, and the
obvious candidate for a whole-glyph displacement -- adds a constant to every
point. It cannot be that: at sixteen per em `g` needs that constant below 0.33
pixels to keep the box it has, and `1` needs it above 1.31 to reach the box GDI
gives it. No constant satisfies both, so the displacement is not a translation.

(And one bug went with it. The box's left edge was being taken as the minimum
over _both_ roundings -- the folded one and the separated one -- so the
separated rounding, which is the measured arithmetic, could never actually
bite. Fixing it is worth two pixels and a good deal of confidence in the next
measurement taken with it.)

#### The bearing, carried twice over and once not at all

Sixteen of the twenty-three italic disagreements were the same thing: our whole
glyph one column left of Windows' -- including the period, at every size from
ten pixels to twenty-four, a glyph sitting on the baseline that a shear barely
touches. So something translates, and it is not the slant.

The metrics say what. Every glyph in Symbol stores its outline from `xMin = 0`
and holds its left side bearing apart in `hmtx`, and the glyphs that shift are
exactly the ones with a large bearing: the digit one at 240 units, the period at
145, mu at 124, alpha at 84, phi at 69. The capitals at 20 to 37 do not shift,
and gamma at -1 does not. No fabrication before this could have shown it,
because every one of them set the bearing equal to the edge.

`dot-bearing` sets them apart: one square, one edge, one height, and eleven
bearings from sixty units left of the edge to two hundred right of it. Read out
of GDI's memory at nine sizes:

- **upright, the box moves with the bearing to the sixty-fourth**;
- **slanted, it moves with the bearing rounded to a whole pixel**.

Two things were wrong on our side, and they were different things. The slanted
glyph is drawn from the raw outline, which had never been carried across its
bearing at all -- carrying it by the bearing rounded to a pixel, as a 26.6
quantity is rounded (which is what takes the period's 145 units at seven per em,
31.7 sixty-fourths, across the half), is worth **fifteen records of the
corpus**, which were the fifteen boxes. And an _upright_ glyph with no program
of its own comes back from the hinter exactly as stored, uncarried too; GDI
carries it to the sixty-fourth, and doing likewise takes the instrument from 234
of 288 cells to 284.

    glyphs   5,890 -> 5,905 of 5,982    98.5% -> 98.7%
    slant-width  276 -> 281,  slant-baked  273 -> 278,  slant-angle  269 -> 274

Why a whole pixel for the slanted glyph and a sixty-fourth for the upright one
is not read; it is measured. The likeliest reason is that the transformed glyph
is placed by the integer metrics GDI keeps for it rather than by the phantom
point the hinted path carries -- but that is a guess, and it is marked as one.

#### Bold stops at a byte

With the boxes readable, the twenty bold records could be asked a precise
question: where does the bold ink stop, relative to the box the scan converter
was given? Across 132 cells of the real face and the wide squares, read against
their own boxes:

- in **102**, the bold ink reaches the column just _past_ the box's last --
  emboldening is not bounded by the box, which is why clipping it there cost
  786 cells when it was tried;
- in every cell where it does **not** reach that column, the box's right edge
  is **8 or 16** -- a multiple of eight in device columns -- and in no cell
  where the edge is anything else does it fail.

The exceptions that looked like counter-examples were not: at ten pixels Symbol
answers with its bitmap strike (the fabricated square is blank there), which
is emboldened by a different mechanism entirely; and the rows where bold grew by
a column without reaching the box were rows where the plain ink had not filled
the box either.

So the overhang column is drawn when it falls inside a byte the glyph already
touched, and dropped when it would need one more -- which is what a smear ORed
into the destination a byte at a time does. Implemented as exactly that test,
it is worth **eight records of the corpus and sixteen cells**:

    glyphs   5,905 -> 5,913 of 5,982    98.7% -> 98.8%

One cell resists: Symbol's mu at twenty-four pixels, whose lone pixel in row 18
does not smear though its edge is 14. Left unexplained.

#### Eight pixels, and the stub contradiction in a fourth form

Of what is left, the largest single group that is not the plotter faces is
Symbol upright at eight pixels: eight records, and seven bold records that are
the same cells emboldened. Their boxes agree with GDI's -- the real-face
recording had no upright differences -- so the disagreement is inside the box.
Three things were checked, and each closes a door:

- **It is not hinting.** The interpreter runs Symbol's programs at six per em
  (`hinted` is true for every glyph, with `SCANTYPE 1` and `SCANCTRL 0x1ff`),
  and drawing the same cells from the _unhinted_ outline gives pixel-for-pixel
  the same result: 4 of 12 agree either way, the same four.
- **It is not the scan kind.** `SCANTYPE 1` is dropout control excluding stubs,
  and turning the stub check off for every outline glyph -- which is what an
  "including stubs" kind would mean -- costs **411 records** of the corpus and
  takes `cour-stubs` from 258 of 258 to 176. The check is real, and on.
- **It is the stub check refusing something Windows draws.** The period at
  eight pixels is a single zero-length run on row 5, rescued to column 2 and
  then refused because nothing continues above or below it; Windows draws
  exactly that pixel. The reference's `DoHorizDropout` and `DoVertDropout`,
  with their crossing counters read line by line, refuse it too -- the period's
  two crossings round to the same column and so count as two, but only on one
  side, and the other side is empty whichever pass is asked.

So this is the contradiction section 3 already records from `cour-stubs` --
Windows draws the tips of a bare post and refuses the free tip of an armed one
-- in a fourth form, with a fourth shape. The `narrow` stand-in that carries the
bare post does not carry the period, whose box has not collapsed. Whatever the
shipped continuation test really is, it is not the reference's, and the eight
records wait on reading it rather than on any measurement this file can make.

#### The plotter faces' periods

The plotter group -- Roman, Modern and Script, drawn as polylines -- had one
shape in common across half its records: Windows draws **nothing** for Roman's
period at eight and twelve pixels, and nothing for the dot on Script's and
Modern's `j` at any size up to thirty-two, where we drew a pixel.

The period is a five-point closed diamond two design units across, and at text
sizes every one of its points rounds to the same pixel: four segments of no
length. `LineTo` draws every pixel of a line but its endpoint, and a line with
no length has no other pixels -- so a polyline of coincident points is nothing.
The polyline routine here drew the pixel for a zero-length segment that was not
the last, on the reasoning that the next segment would draw it anyway; when the
next segment is also nothing, that reasoning fails. Made to draw nothing:

    glyphs   5,913 -> 5,927 of 5,982    98.8% -> 99.1%
    lines    248 of 248, unchanged

Fourteen records, and the plotter group falls from thirty-two to eighteen.

And the other half of the group was the same rule from the other side. Every
remaining plotter difference was one extra pixel of ours at the _start_ of a
run's final segment -- the hook of a `j`, the tail of a `y`, the foot of an `a`
-- and the device points say why: that final segment is short, and behind it
sit several segments of no length. The polyline routine drew `steps + 1` pixels
for every segment but the last, on the reasoning that the next segment starts
at the endpoint and draws it anyway. When the next segment goes nowhere it
draws nothing, and `LineTo` never drew that endpoint in the first place: every
segment draws from its start up to but not including its end, and the shared
point belongs to whichever segment leaves it.

Made so -- `stop = steps` for every segment, with a caller that wants the very
last point getting it from the last segment alone:

    glyphs   5,927 -> 5,954 of 5,982    99.1% -> 99.5%
    lines    248 of 248, unchanged;  text  55 of 55, unchanged

Twenty-seven records. The plotter group, which stood at forty-one when this
file first counted it, is **empty**: every one of the twenty-eight records the
corpus still disagrees on is Symbol.

#### What the last twenty-eight are, and three readings refused

All twenty-eight are Symbol, in four groups, and this round tried the obvious
reading of each and wrote down what it cost:

- **Fifteen at eight pixels** -- eight upright and the same seven emboldened --
  are the stub contradiction above. Nothing new to try there short of the
  shipped continuation test.
- **Four bold at ten pixels** (`A`, `B`, `K`, `j`) are exceptions to the byte
  rule: their boxes end at columns 6 and 7, which the rule lets the smear reach
  and Windows does not. They join mu at twenty-four as the rule's five
  exceptions in 132. Clipping the smear to the box was already refused (786
  cells); clipping the _strike_ faces' smear to their stored width, which the
  same four cells would suggest if they were strikes, costs **349 records**
  across every bitmap face -- the smear into the extra column is the rule for
  strikes, not the exception.
- **Seven italic**, scattered. Three (`W` and `1` at twenty-four, `y` at
  twenty) lack their rightmost pixel; building the italic box's right edge from
  the sheared upper corner of the bounding box, rather than from the outline's
  points, changes nothing at all -- not one record, not one cell -- so it is
  not that. Alpha at fifteen is a whole column left of Windows with a bearing of
  exactly 31.5 sixty-fourths, and rounding that bearing the other way (plain
  round to a pixel with no 26.6 step) leaves the record disagreeing and costs 35
  fabricated cells, so it is not that either.
- **Two more bold**, mu at twenty-four (above) and one at ten.

  glyphs 5,954 of 5,982 99.5%
  font 5,047 of 5,057 99.8%

#### Reading the shipped `LookForDropouts`

With nothing left to measure, the eight-pixel group came down to reading the
continuation test out of segment 42, which this round did, from `0x0978` down
through both continuation sums and the crossings counter. What it found is
mostly a confirmation, and one thing that is not.

**The shipped code is the reference, branch for branch.** The horizontal pass
gates the stub check on a flag, then requires both sums to reach two: above,
`HorizCrossings(x, y+1) + VertCrossings(x-1, y+1) + VertCrossings(x, y+1)`;
below, the same one row down. The vertical pass reuses the _same two functions_
with the list bases swapped and the roles of row and column exchanged, and the
terms that come out are the reference's vertical test exactly -- right side
`VertCrossings(x+1, y) + HorizCrossings(x+1, y-1) + HorizCrossings(x+1, y)`,
left side likewise at `x-1` and `x`. The box and band bounds the reference keeps
inside the counters are hoisted into the callers as guards, and each sum stops
early once it reaches two. The one difference is the counter itself, at
`0x0db4`: it returns whether an `on` entry matches plus whether an `off` entry
matches -- 0, 1 or 2 -- where the reference counts every match. For a test of
"at least two" that can only matter when one list holds two matches and the
other none, which no shape here produces.

**So the period is not saved by the continuation test.** Whatever draws it, it
is not a difference in how the check is written.

**The flag is the scan kind's high word.** `LookForDropouts` takes the kind in
`DX:AX` from the driver's own stack arguments `[bp+8]:[bp+6]`, keeps `DX & 1` as
the stub flag and discards `AX`; and the driver switches dropout control off
entirely when the whole long is zero. The reference's `itrp_QueryScanInfo`
splits `scanControl` the same way -- `SCANTYPE` in the high word, `SCANCTRL` in
the low -- so the flag is bit 0 of `SCANTYPE`, which every installed face sets
to 1. That says the stub check is _on_ for Symbol, and the period refused, and
Windows draws it anyway. The contradiction is now confined to a value rather
than to code: either the long GDI passes is not `scanControl`, or something
before `LookForDropouts` puts the period's pixel down.

**The word beside the box is not the kind.** The constant 2 that sits between
the two box words in every dump is 2 for Courier New as well -- recorded through
the probe for the first time here, at the sizes `cour-stubs` was measured at --
so it cannot be what tells the two faces apart, and nothing in the deep residue
does: no word small enough to be a flag differs between Symbol and Courier
anywhere in it. The flag's own frame does not survive to be read; it is
overwritten between `LookForDropouts` returning and the probe's capture, and
only the `STATE` copies of the box live long enough.

That is where the eight records rest: the test is the reference's, the flag is
unread, and the next instrument would have to catch the value _during_ the call.

#### The eight records, found: an inhibited glyph carries its bearing in whole pixels

They were not about the stub test at all. Two experiments settled where they
were, and both are worth keeping because the obvious reading of each is wrong:

- **Windows honours `INSTCTRL`.** Symbol's prep says `MPPEM LT 7 INSTCTRL` and
  Courier New's says the same at nine, the identical idiom. Forcing the glyph
  programs to run at six per em fixes the period and breaks the four letters
  that agreed; forcing them everywhere costs seven glyph records, four `font`
  records and two of `hinting`. So the shipped scaler does what the reference
  does: below the threshold no program runs.
- **But the period comes out grid-fitted anyway.** With no program to move its
  points, the only thing that can differ is where the outline is _put_, and
  `dot-bearing` had already measured that and been read past: at every size
  from nine to thirty-three per em the box moves with the bearing to the
  sixty-fourth, and at six per em -- alone -- it moves in **whole pixels**. Six
  per em is the inhibited size.

So when instructions are off the scaled side bearing is rounded to a pixel
before the outline is placed. For the period at eight pixels that is 0.42 of a
pixel rounded to nothing: the dot moves from 2.42..3.08 to 2.00..2.66, and its
one scanline, which crossed it at 2.56 and 2.94 -- a run of no length, a
dropout, a stub refused -- now crosses at 2.14 and 2.52: a run of one pixel, no
rescue needed, and the pixel Windows draws. Every other letter Symbol had wrong
at eight pixels was the same tenth of a pixel deciding a different crossing.

Put where it belongs, in the hinter's own carry for a glyph whose program has
been inhibited:

    glyphs    5,954 -> 5,969 of 5,982    99.5% -> 99.8%
    hinting   1,442 of 1,442, unchanged
    Symbol at eight pixels: every cell agrees, upright and bold

Fifteen records, and the stub contradiction this section has carried since
`cour-stubs` loses its fourth form -- which was never a form of it. The other
two readings were tried and refused first: rounding the bearing on the raw
outline path, which an inhibited glyph never takes, changes nothing here and
costs eighteen cells elsewhere; and the whole-pixel carry for the _slanted_
glyph, found earlier, is now seen to be the same rule from the other side -- an
italic is drawn from the raw outline with no program run, and its bearing is
rounded for the same reason.

(A first pass at this measured no difference at all, because the flag it was
switched with reached only one of the two call sites. The number above is from
changing the code outright and re-running the ratchet.)

And it is worth being plain about the size of what is left. Seven cells differ
across the two bracketing instruments, of the 132 outside the strike sizes: one
is the smear boundary at twenty-four pixels, and six are that run at fifteen. The
rest of the slant -- every shape a pixel wide or more, every upright cell, three
of the five sizes in both bracketing windows -- is exact.

Where none of this goes is into the scaler. Segment 36's public entries are four
thunks that load a dispatch index into `bx` and a word count into `cx` and jump
to a stack switcher at `0xe1`, which copies the arguments onto the scaler's own
stack at segment `0xbc` and does `call far [bx*2+0x1e]` -- a table of far
pointers built at initialisation, not present in the image. `EngineRealizeFont`'s
neighbour at segment 3 `0x2b23` calls one of those thunks, `36:0x00ae`. Static
descent stops at the table, so the next step is either to read that table as the
running system fills it, or to keep asking the oracle.

**In sum, what is left is dropout control on a narrow sheared feature, and
nothing else.** Windows fires it where we do not: a bar whose upright cell inks rows 3
to 10 inks exactly those rows slanted too, and its top row comes back two pixels
wide where every other row is one, while ours loses that row entirely. Across
both instruments 120 of the 220 wrong pixels are on the first or last inked row
of the glyph, which two rows out of ten or eighteen have no business holding.
Slanting never costs Windows a row and sometimes gains it one.

The first cut of the instrument had a fault worth recording, because it is the
one `setBearing` was written for and its own documentation warns of: the bar's
outline was rewritten and the side bearing left alone, so Windows drew the
upright bar two columns from where we did and the _upright_ cells disagreed
before any slant was applied. A instrument that is wrong about the thing it is
controlling for reads as a discovery about the thing it is measuring.

Two other readings of what else is wrong have been tried and both are worse than
what is there.

_Leaning from the bottom of the cell rather than the baseline_, which is where
the strikes and the stroke designs both lean from, and which would stop a
descender leaning the wrong way. It costs: the wrong pixels go from 1,024 to
1,290 at the best angle, and the trough moves below every angle swept, which
says the constant it adds does not belong.

_Shearing the outline before it is fitted rather than the pixels afterwards_ --
the reading the stroke designs suggested, since they are coordinates too and
shearing their coordinates was right. It costs about as much: 1,779 wrong pixels
against 1,024, at every angle from a fifth to a half.

So an outline's synthesised slant is its own third thing: three tenths about the
baseline, where a strike leans by its overhang about the bottom of the cell and
a stroke design by half its cell about the same place.

**Symbol upright at eight pixels** is a different thing again and probably not a
rule at all: the cell is seven rows, the letters are three or four, and four of
the twelve differ by a pixel on one row. That is grid fitting at a size where a
stem is a third of a pixel wide.

**A bold synthesised onto an outline is not a shifted copy of the drawn
pixels.** Symbol's beta at ten pixels is where it shows. Plain, one row inks
columns 2 and 5 and the row above inks 1 to 4. Emboldened, Windows answers 2, 3
and 5 for the first -- the left stroke smeared and the right one not -- and 1 to
5 for the second, which _is_ one wider than the plain row. So the smear stops
somewhere, and not at the same place in both rows.

Two clippings were tried against the whole corpus and both are worse than none:
clipping the smear to the character's own advance costs 19 cells, and clipping
it to the rightmost column the glyph itself inks costs 38. The second reproduces
the beta exactly and breaks other letters, which is the tell -- the rule is not
about a column at all. The likeliest reading left is that Windows emboldens the
_outline_ and rasterises it, where this smears the pixels afterwards, and a
stroke that lands between two sample points does not survive the difference.

Also open: Symbol upright at eight pixels, and four requests for a hundred
pixels at proof quality where refusing every stretch leaves a scalable face the
winner.

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

**Whether a short strike is emboldened depends on how the request reached it.**
A strike asked for by its own name is always emboldened, however short. A strike
reached by falling back from an outline face too small to draw is emboldened
only if it is at least eleven rows tall; below that the request is discarded --
`tmWeight` comes back 400, the overhang 0, and every width the plain face's, as
though nothing had been asked for.

**Recorded**, on the same eight row cell both ways round: Arial bold at eight
pixels is Small Fonts and answers weight 400; Small Fonts bold at eight pixels
is the same strike and answers weight 700 with every width one greater. Arial at
eleven, still Small Fonts, is emboldened; at six it is not. MS Serif bold at
eight and at ten is emboldened when asked for by name. It is the same
distinction `tmItalic` already makes, where the byte answers for the family the
request settled on rather than for the strike that satisfied it.

This corrects the _scope_ of an earlier claim rather than the number in it, and
the correction is worth keeping visible. That claim made the floor a property of
the strike alone, and was marked **Recorded** naming the pair that pinned it --
MS Serif at ten pixels against eleven. No such record existed, at either size,
in that fixture or any other: the height sweep for those faces started at
thirteen. Every case it had been written from was a fallback, where the two
rules give the same answer, so nothing that existed could contradict it. What
found it was widening the sweep to the sizes the glyph probe draws at.

A stroke font is exempt: `Modern`, `Roman` and `Script` all report 700 for a
bold request at eight pixels, where the smear rounds to nothing and no character
widens. The request is honoured and happens to do nothing, which is a different
answer from the request being thrown away.

**Italic leans from the top of the cell.** The top row shifts right by
`floor((cell - 1) / 2)` -- exactly the overhang Windows reports -- and the rows
are then taken in pairs downward, each pair leaning one pixel less than the one
above, to nothing at the bottom. So the lean of row `j`, counted down from the
top, is `overhang - (j >> 1)`. Nothing ever moves left. **Recorded**: 2,016
cells over eight sizes of seven faces.

Anchoring at the baseline is the natural guess and is wrong: descenders swing
out to the left and no angle recovers. A sweep over angles cannot tell you it is
sweeping the wrong parameter -- it just keeps asking for a steeper lean.

Pairing the rows from the _bottom_ instead -- `floor((rows below it) / 2)`,
which is what this said before -- is right exactly half the time. The two
readings agree whenever the cell has an even number of rows and differ on every
other row when it has an odd number, because that is where the leftover row
falls at a different end. Fixedsys, whose only strike is fifteen rows, was wrong
at every size and every letter; MS Sans Serif and Courier were wrong at exactly
the sizes their thirteen row strike answers and right everywhere else. A rule
that is right for half the faces looks like a rule with an exception, and it was
not: it was the wrong rule.

**A strike is drawn its whole number of times over when it is drawn, not only
when it is measured.** Both the row count and the column count multiply. MS
Serif asked for twenty has no twenty row strike and doubles its ten row one;
drawing that strike once into a cell measured for twice is a half-size letter in
a full-size cell, which is what it was.

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

**What they look like is now recorded and none of it is drawn right.** The glyph
probe had never been pointed at them: their widths and heights were known to the
pixel and their ink not at all, which is a shape of gap worth naming, because
measuring the right numbers about a thing is not the same as drawing it. 420
cells, three faces, seven sizes from eight pixels to forty, and nought of them
agree.

Two defects are already visible. The replay was not passing `OEM_CHARSET`
through at all, so a request for `Roman` was being answered by whatever an ANSI
request for that name gives -- fixed, and it is what made the first reading look
like a filled serif letter rather than a stroked one. And the stroke decoding is
wrong: Roman's `A` comes back as a pair of verticals and a bowl, which is a `B`,
so either the character table is being indexed a place out or the pen-up pairs
are absolute where they should be relative. Windows draws a thin single pixel
`A` with a serif at each foot.

Four things were wrong with the drawing and all four are now read off the data.

**The offset in a character's table entry is where its strokes end, not where
they begin.** That is the one thing about these files that is not like the
bitmap ones, and reading it the other way drew every character with the next
one's strokes -- Roman's `A` came out a `B`. The table says so plainly once it
is looked at: the first entry, the space, has offset nought, and a space has no
strokes; the second, the exclamation mark, has 27, and 27 bytes is a stroke and
a dot.

**The pair after a pen-up is a displacement, not a position.** Read that way
Roman's `A` is a lift to (10,4), a draw to (3,25), a lift back and a draw to
(17,25), then an inner stroke, a crossbar and a serif at each foot. Read as
positions the same thirty bytes give a scatter that is not a letter.

**A stroke design measures downward from the top of its cell.** Roman's `A` has
its apex at 4 and its feet at 25, in a design 32 tall whose ascent is 25. Drawing
it upward from the baseline turns every letter over.

**A line does not draw the pixel it stops on.** This is GDI's rule for `LineTo`
and `Polyline` generally, and the plotter fonts are the only thing in the corpus
that has ever recorded it: Roman's serifs come back three pixels where a
Bresenham that inks both ends draws four. Worth 81 cells on its own.

With those, and with the two synthesised styles drawn the way the strikes draw
them, 153 of the 420 agree.

**A slant is applied to each row as it is plotted, not to the ends of each
stroke.** The two describe the same line and not the same pixels: a lean worked
out at the two ends and interpolated between them wanders from one worked out
per row wherever the interpolation rounds the other way.

**And the lean is `floor((cell - row) / 2)`,** which is not the strikes' rule.
A strike leans by its overhang, `floor((cell - 1) / 2)`, and pairs its rows from
the top -- rows 0 and 1 together, then 2 and 3. A stroke design leans by
`floor(cell / 2)` at the top row and pairs from row 1, so the two part company
on every other row. The metrics had said as much all along and it had not been
carried across: a slanted plotter font is recorded as overhanging by half its
cell where a slanted strike overhangs by half its cell less one. Roman slanted
goes from none of 84 to 10, and from 1,925 wrong pixels to 679.

What was left after that was line rasterisation rather than anything about
fonts, and asking through a font was asking badly: the endpoints come out of a
design scaled by a ratio, so a disagreement could be the scaling as easily as
the line. So a probe was written for lines themselves -- a pen a pixel wide, two
endpoints in whole pixels, and the ink -- and 248 of them recorded, a fan of
four rings around the middle of a cell.

**Every tie rounds the minor coordinate down, except on a steep line whose x and
y run in opposite directions, where it rounds up.** A tie is a line whose span
is even, where the exact position falls halfway between two pixels. Six of the
eight quadrant-and-orientation cases say down and two say up, each settled by
about thirty lines. It is the difference between `(16,16)-(17,24)`, which holds
x at 16 through the halfway row, and `(16,16)-(17,8)`, which does not; the
exception is odd and is left as measured.

That is `lines`, a new fixture, at 248 of 248 -- and it takes the plotter fonts
from 153 of 420 to 263 without touching anything about fonts at all.

**A stroke design's slant moves its coordinates, not its rows.** A strike is a
picture and can only shift whole rows; a stroke design is coordinates, and the
line is drawn through the moved ones, so a stroke that crosses a row stays
joined where shifting rows would break it. It also leans one more than a strike
does -- `floor(cell / 2)` at the top row against a strike's `floor((cell - 1) /
2)` -- which is exactly the overhang the metrics report for these faces and had
been sitting there unused.

**Measured**: fitting a slope to how far each row of a slanted cell sits from
the upright one gives a half at every size from eight pixels to forty, and the
lean at the top row runs 4, 6, 8, 10, 12, 16, 20 for cells of 8, 12, 16, 20, 24,
32 and 40. The tell that it is now right is that the slanted cells agree exactly
as often as the upright ones, letter for letter and size for size -- 314 of 420.

**A design coordinate below the cell is pulled back to its last row rather than
falling off it.** That was the descenders, and it is the last rule these faces
had to give up. Every descender reaches the design's full height -- Modern's
`g`, `j` and `y` all end at 32 in a design 32 tall -- so the bottom of the design
scales to the row _after_ the last one the cell has. Windows draws the tail flat
along that last row. Letting it descend one further, and clipping it away, both
leave a letter Windows does not draw.

**Measured**, by trying each: clamping takes the three faces from 314 of 420 to
379 and the wrong pixels from 291 to 46. Scaling by `(cell - 1) / (design - 1)`
instead gives 140, and by `(cell - 1) / design` gives 2, so it is not a different
ratio -- the ratio is right and the bottom row is a special case.

What is left is 41 cells of 420, and every one of them is **ink we draw that
Windows does not** -- not one is ink we miss. Almost all sit on the cell's last
row, which is the row the clamp puts things on, so the clamp is a little too
generous: Windows draws a shorter tail than a clamped endpoint gives.

Roman's `y` at sixteen pixels is the case. Its tail runs through five design
points that all clamp to the last row, at columns 3, 3, 3, 3 and 4, so the run
inks columns 3 to 5; Windows inks 4 and 5. Three narrower rules were tried
against the whole corpus and all three are worse than clamping everything:
dropping a run that leaves the cell gives 296 of 420, truncating the run at the
first point that leaves it gives 318, and truncating it one point earlier gives
307, against 379 for the clamp.

So the clamp stands, and what is left is a pixel at the end of a tail with no
rule behind it that has been found. It is not the rounding of the scaled
coordinate -- that was swept -- and it is not the geometry of the clip.

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
chose. The size is the vertical one times a ratio, and the ratio is `lfWidth`
over the average character width the face has _at that vertical size_, as a
16.16 fixed number rounded to the nearest:

```
average = round(OS/2.xAvgCharWidth * ppem / unitsPerEm)
ratio   = round(lfWidth * 65536 / average)          -- 16.16
xPpem   = ppem * ratio / 65536                      -- fractional
```

Every horizontal metric follows from the fractional `xPpem`; the glyphs are
hinted at its whole part (section 8a). **Measured** three times over. The
`widths` fixture reads the average Windows reports back as `lfWidth` itself, 60
of 60, which only the fractional size does. The `font` fixture has Arial at
twenty-seven pixels asked for eight and twenty come out at eighteen and
forty-five, which is `27 * 8 / 12` and `27 * 20 / 12` exactly -- and Arial at
twenty-one asked for twelve comes out at **twenty-seven, not the twenty-eight
that `21 * 12 / 9` is**: all thirty-six glyphs are drawn a column narrower than
twenty-eight gives, and every one agrees at twenty-seven. Four thirds is not
representable in 16.16 and rounds down, to 87381, and twenty-one times that is
27.99975; two thirds rounds up, to 43691, and twenty-seven times that is
18.0001. Truncating the ratio instead gets the first right and the second wrong -- two
extents of the `font` fixture -- one division with no fixed ratio gets the
second right and the first wrong -- twenty-one glyphs -- and
the design-space form this once carried -- `floor(lfWidth * unitsPerEm /
xAvgCharWidth)`, independent of the vertical size -- was refused when the
`widths` sweep was recorded. The precision beyond "fixed, rounded" is not pinned:
no other request in the corpus has a whole product from an unrepresentable ratio.

**`tmMaxCharWidth` is the font's bounding box scaled to the size.** Not the
widest advance, and not the grid-fitted widths in `hdmx`:

```
tmMaxCharWidth = round((round(head.xMax * xPpem * 64 / unitsPerEm)
                      - round(head.xMin * xPpem * 64 / unitsPerEm)) / 64)
```

Each end to a sixty-fourth at the horizontal size, then the difference to a
pixel. At a square size that is the width scaled and rounded once, at every one
of the 927 maxima recorded; under a width the two part where the difference
lands on a half (section 8a).

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

#### The slant's last sixty-fourth, and the tie in the bearing

With the eight-pixel group gone, twelve records remained and seven of them were
synthesised italic: single pixels, each a crossing sitting on a half. The box
had already been read to keep its two roundings apart -- the scaled coordinate
to a sixty-fourth, the shear to a sixty-fourth, then the sum -- and the outline
was still being sheared in font units and rounded once. To within a
sixty-fourth that is the same thing, and a sixty-fourth is what a crossing on a
half decides by. Shearing each point the way the box is sheared:

    glyphs          5,970 -> 5,977 of 5,982    99.8% -> 99.9%
    fabricated     25,858 -> 25,882 of 26,058
    slant-angle, slant-baked, slant-width: 288 of 288, no wrong pixels

Every slant instrument is now exact. Rounding the shear term down rather than to
nearest costs four records, and is refused.

One more record fell to a tie. Alpha at twelve per em has a bearing of exactly
31.5 sixty-fourths and Windows carries it as nothing; the period at seven per em
has 31.72 and is carried a whole pixel. A half rounded up gives alpha a pixel it
does not have; truncation takes the period's away; only a half rounded down fits
both, and it is the one tie the corpus has.

And the bold exceptions were given one more chance and refused it. The five
cells where the smear stops short of the column past the box -- four at ten
pixels, mu at twenty-four -- do not sit on a byte boundary; tabulated against
the glyph's hinted advance, `R - cell` is zero for escaping and blocked cells
alike, so the character cell's edge is not the rule either. They stay as the
byte rule's five exceptions in 132, and Symbol has no ten-pixel strike for them
to be coming from: its bitmap face holds 13, 16, 19, 21, 27 and 35.

    glyphs   5,977 of 5,982    99.9%
    font     5,047 of 5,057    99.8%

#### The last five, and the whole corpus

The five bold cells that stopped one column short were never going to yield to
the box, the byte or the pen, because what bounds them is a word that had been
sitting beside the box in every dump and never asked: at `-0x230`, one wider for
bold than for plain in every cell, and readable for all sixty-six plain cells of
the real face. It is **`boxLeft + advance`** -- the cell GDI lays the glyph out
in, measured from the box's left edge rather than from the pen -- and it fits the
sixty-six without a miss.

With it the smear's rule is complete: the overhang column is drawn when it lies
inside the bold cell, `boxRight <= boxLeft + advance`, and does not begin a new
byte of the destination row. The four at ten pixels and mu at twenty-four are
the cells whose box ends a column past `boxLeft + advance`; the ten on byte
boundaries were already known; the 102 that escape satisfy both. **132 of 132,
no exception left.** The cell measured from the pen, tried and refused earlier at
a cost of twenty-eight records, differs from this one by whatever the hinted
outline reaches left of its origin -- at ten pixels Symbol's capitals start a
column before the pen, which is exactly where the two readings part.

    glyphs   5,982 of 5,982    100.0%
    font     5,047 of 5,057     99.8%

Every glyph Windows was recorded drawing, this draws.

#### The font corpus: what a synthesised slant reports

Ten `font` records were left, all of them about faces Windows has to make
something up for, and they came apart into three rules.

**Three were the slant's advances.** Symbol has no italic file, so an italic
request gets the upright slanted by GDI -- drawn, as section 8 found, from the
raw outline with no program run. It is measured the same way: the string extents
Windows reports for it follow neither `hdmx` nor the interpreter, both of which
belong to the hinted upright, but the scaled outline's own advance. Switching the
slant's `measure` to that closed three of the five extents.

**Two were its heights.** Symbol slanted at a twelve pixel cell is nine pixels
per em, the size `VDMX` picks for the upright -- and it stays nine even though
ten per em would fill the cell exactly, so the size is not reconsidered for the
slant. What changes is what is reported: ascent 9 and descent 2 for a cell of 11,
where the table's fitted values are 9 and 3. Those are the design values scaled
and rounded -- 2059 and 450 font units at nine per em are 9.05 and 1.98 -- and
they are unhinted for the same reason the glyphs are. `realiseOutline` now
reports the scaled values for a slant it synthesises and keeps the table's size.

**Four were a strike losing to the wrong name.** Fixedsys, System, Small Fonts
and Courier at a hundred pixels, at proof quality, all come back as **Arial** --
a hundred pixel cell, ascent 80, average width 39 -- where at default quality the
same requests answer with their own strikes stretched. The mapper's penalty
table, read in section 3, says exactly why. A strike of the face asked for pays
nothing for its name and 150 a pixel of height it is short; an outline of some
other face pays 10,000 flat for the name and nothing for height, because it can
be realised at any. Fixedsys's tallest strike is fifteen rows, eighty-five short
of a hundred: 12,750, and Arial's 10,000 wins. Stretched six times over at
default quality the same strike costs under two thousand and keeps winning. The corpus
has the threshold bracketed from the other side too, without having asked for
it: MS Serif and MS Sans Serif at the same hundred pixels **keep** their strikes,
thirty-five and thirty-seven rows tall -- sixty-five and sixty-three short, 9,750
and 9,450, both under 10,000.

Every outline that is not the face pays the same 10,000, and the candidate loop
replaces its best only on a strictly lower score, so the tie goes to whichever
outline the font directory lists first. GDI's directory is not the `SYSTEM`
directory: it is the three boot fonts from `SYSTEM.INI`, then every line of
`WIN.INI` `[fonts]` in the order written, each `.FOT` a stub naming its `.TTF`.
The installer wrote `[fonts]` alphabetically with the TrueType faces first, so
Arial heads it; the replay had been walking the directory, which happens to list
`TIMESI.TTF` before anything else, and it now installs in the order Windows
does. The first attempt at that lost the three boot fonts to a `[boot]` header
with trailing spaces after the bracket -- a detail of one installer's `SYSTEM.INI`
worth writing down, since anything parsing it will meet the same line.

    glyphs   5,982 of 5,982    100.0%
    font     5,056 of 5,057     99.9%

#### The last pixel of the font corpus is the phantom's rounding

The one record left was Symbol slanted at fifty pixels, where the specimen string
`Wg jpq 128` measures 201 and its rounded advances add up to 200. Forty-one
pixels per em puts the three digits at exactly 20.5 -- but those round up either
way, and the sum was still one short. Across the ten sizes the extent records
cover, the scaled advances agreed with Windows at nine, so whatever this was
lived in a single glyph at a single size, and a string cannot say which. The
advance probe can: it already measures one character's `GetTextExtent` at every
cell height from 8 to 110, and it gained a pass over every letter and digit of
Symbol slanted -- **6,014 advances**.

Rounding the design advance misses 51 of them, every one a pixel short, every
one with the scaled advance between .488 and .4995 of a pixel -- just under the
half. But the outcome is not a function of that fraction. At sixty-three per em
`A` and `C` (advance 1479, 45.497 pixels) stay at 45 while `H`, `K`, `N` and `O`
(the same 1479) go to 46; at eighty-one per em `A`, `C`, `H` and `K` go up and
`N` and `O` stay down. **Same advance, same size, different answer: the term is
in the glyph.** Not its hinting -- in the `A` cases the interpreter's advance
equals the scaled one. Not its bearing carried whole, which is far too large a
move and misses fifteen hundred. What fits is smaller than either.

The scaler places the origin phantom at `xMin - lsb`: the outline keeps its own
coordinates and the origin moves to where the bearing says it should be. The
advance phantom sits that far along plus the advance. Both are scaled to 26.6
and **each rounded to a sixty-fourth**, and the device advance is their
difference, rounded to a pixel. Where the bearing shift is nought the two
phantoms round together and the result is the rounded advance. Where it is not,
the origin's own rounding error -- up to half a sixty-fourth -- lands on the
advance, and that is enough to decide a glyph a hair under the half. `A` at
sixty-three: origin at -0.615 pixels rounds to -39 sixty-fourths, advance
phantom at 44.882 rounds to 2872, the difference 2911 is 45. `H`, no shift: 2912, 46. Windows makes them 45 and 46.

**6,014 of 6,014.** The sign and the rounding are both measured: the origin at
`lsb - xMin` misses 28 and flooring the sixty-fourths misses 29, so this is the
placement the reference scaler describes and not a fit to the misses.
`TrueTypeFont.unhintedAdvance` is the rule; the slant's `measure` uses it; the
fifty pixel string comes to 201, because `W` at 31.49 pixels has a shift of its
own and rounds up.

    glyphs    5,982 of 5,982    100.0%
    font      5,057 of 5,057    100.0%
    hinting   7,828 of 7,828    100.0%

Every record in every fixture the oracle has recorded of fonts -- mapping,
metrics, extents, advances and pixels -- this reproduces.

#### What a string does that a character cannot

Closing the corpus exposed a hole in it. `LogicalFont.measure` now steps a
synthesised slant by the scaler's unhinted advance, and `Surface` still stepped
its pen by the upright's hinted one -- two numbers for one thing, with a comment
over each saying they must agree. **Nothing could see it.** Every cell of the
glyph corpus draws a single character, and a single character never steps.

The stack probe was asked first, since it already reads the box the scan
converter is given, and it could not answer. Its residue carries the box of a
glyph that went through the scan converter, and a two character `TextOut` leaves
something else at those offsets: the two words come back as 0 and 2 at every
size, with the word beside them tracking the string's width capped at the
bitmap's -- a clip of the cell rather than a box. So a string is built by a path
a single character does not take, and the residue reads the wrong frame. That is
a negative result about the instrument and not about the pen.

Pixels then, on the probe that already records them. `glyphs` gained sixteen
pairs of Symbol slanted -- the same character twice, so that two boxes of the
same shape differ by the step and nothing else -- at the sixteen sizes where the
unhinted advance and the upright's hinted one differ by a whole pixel or more,
with each size's character chosen for the widest disagreement, and with the
upright recorded beside it as the control.

**Sixteen of sixteen wrong, and the control clean.** Stepping by the upright's
advance put the second glyph in the wrong column at every slanted size; the
sixteen upright pairs, where the two candidates are the same number, agreed
before the change and after it. Stepping by the unhinted advance puts all
sixteen right.

    glyphs   6,044 of 6,046   100.0%

The two left are one glyph counted twice. Symbol slanted at a thirty-two pixel
cell, twenty-six per em: the `t`'s stem inks two columns for two of its rows
where Windows inks one, in the single character and again in the pair. The pair
puts the second `t` in exactly Windows's column, so the step is right and the
shape is not -- and a shape a column too wide at one size is the fabricated
corpus's open question, not this one. It is in `KNOWN_GAPS` under that
description, and it was found by recording a character that had never been
recorded at that size rather than by anything changing.

### The fabricated corpus: a program that names a point it does not have

With the recorded fixtures whole, the remaining error was the fabricated corpus,
and it was not spread across it. Of 26,058 cells and 4,320 wrong pixels, **4,316
of those pixels were in one instrument**, `slope-sweep`, and every wrong cell in
it was an accented letter: 29 characters, six sizes, upright plain, 174 cells.

Which is not what that instrument is about. It cuts thirty-six base letters down
to a four point parallelogram to walk a leaning edge across the sample grid, and
those thirty-six all agree. What it does _not_ touch is the accented composites
built on them -- `À` is the base `A` plus a grave, by index -- so cutting `A`
from a hundred-odd points to four leaves `À`'s own program naming points that are
no longer there. **The fabrication asked a question by accident, and it is a good
one: what does the interpreter do when a glyph program names a point the glyph
does not have?**

The reference answers plainly. Every one of its point checks --
`CHECK_POINT`, `CHECK_CONTOUR`, `CHECK_ELEMENT` -- is inside `#ifdef
FSCFG_DEBUG` and compiled out of anything shipped. So nothing stops the
instruction. It writes past the end of the element's point array, into the rest
of a buffer the scaler allocated from `maxp` for the largest glyph in the font,
and nothing ever reads that back as part of an outline.

**Arrays that grow are not the same thing as memory that overflows**, and the
difference is the whole of the first bug. Ours grew: the phantom points are read
as `length - 3` and `length - 4`, so one write past the last point moved the end
and the glyph's own origin came out of a hole. `undefined` in an arithmetic
instruction is `NaN`, `NaN` reaches the phantoms, and every letter built on a cut
base came out as a bar in column nought. Fixing the length alone changes nothing
-- the holes are still holes. What fixes it is modelling the buffer: the point
count is sealed when the glyph's points are all in, and the arrays are padded
with nought out to `maxp`'s largest glyph plus its four phantoms, so a point past
the end reads as memory rather than as absence.

    slope-sweep   990 -> 1,073 of 1,164 cells,  4,316 -> 2,208 wrong pixels

### Where a composite is placed, and where a simple glyph is

The 91 cells left were two shapes, and both were a translation: `â` at
thirty-one pixels drawn eight columns right of Windows, `Å` at twelve drawn four
columns left, every pixel of the shape otherwise identical. A whole-pixel shift
of a whole glyph is the origin, and the origin is the phantom point these
programs are now naming by accident.

The outline is carried back onto the pen when the program is done, and it is
carried onto **where the origin phantom finished** -- which is recorded, from
Times New Roman's right guillemet, whose program shifts the origin a whole pixel
at some sizes and whose letter is that far out if the move is ignored. Carrying
every glyph onto where its origin _started_ instead does better on the fabricated
corpus, 1,754 wrong pixels against 2,212 -- and breaks eight recorded cells. So
it is not a rule about glyphs.

It is a rule about composites. A composite's components are placed in device
space as they are assembled, each carrying its own bearing and having the
composite's put back; by the time the composite's own program runs the outline is
already where it goes, and its origin phantom is a reference the program may move
rather than the position the glyph is placed at. A simple glyph has no such
earlier placement and is carried onto wherever its program leaves the origin.

The reference's own placement is not in the three files here -- they are the
interpreter, the scan list and the spline, and the placement is in the scaler
around them -- so this is measured rather than read. What can be said is what
each reading costs:

| the outline is carried onto                | fabricated cells | wrong pixels | recorded cells |
| ------------------------------------------ | ---------------- | ------------ | -------------- |
| where the origin finished                  | 25,965           | 2,212        | all            |
| where the origin started                   | 25,987           | 1,754        | **eight lost** |
| started for composites, finished otherwise | **26,029**       | **118**      | all            |

    fabricated   25,882 -> 26,029 of 26,058 cells,  4,320 -> 118 wrong pixels

### The buffer is one buffer

The twenty-seven left were still the same question, asked more finely. `å` at
thirty-one pixels came back with a mark two columns wide beside its stem that we
did not draw at all; `ñ`'s tilde was drawn by Windows and missing here entirely.
Both are contours the program has moved somewhere out of what it read past the
outline -- and reading nought there is a choice, not a measurement.

The reference does not clear it. It allocates the point buffer per size and fits
every glyph of that size in it in turn, so what lies past the outline is the tail
of whatever was fitted before. Carrying the previous glyph's tail forward instead
of clearing it:

    fabricated   26,029 -> 26,055 of 26,058 cells,  118 -> 9 wrong pixels

with every recorded cell unchanged. **26 more cells and 109 fewer wrong pixels
for keeping memory rather than zeroing it**, which is about as direct a
confirmation of the model as the corpus can give. It also means the glyph drawn
before this one can change what this one looks like -- true of the reference and
of anything faithful to it, and reachable only by a program that reads past its
own outline, which is to say only by a font somebody has cut down.

Three cells are what is left, and they are two questions.

### The dot at the bearing is a box, and the box is recorded

The two `dot-bearing` cells are one dot: `'1'` at an eight pixel cell, plain and
emboldened, which is the plain cell and its smear. Windows draws it in column 4
and this draws it in column 3.

It is not a dropout. Traced, the run is an ordinary one -- `row=4 on=3 off=4`,
one column wide -- so nothing here is being rescued, and both pictures are simply
the box each side computed. **And the box is recorded.** The stack probe was run
against these fabrications, so GDI's own left and right for this exact cell are
on disk: `4,5`, where this makes `3,4`.

Which turns the question into a clean one, because the recording has 528 upright
boxes across the nine dot instruments to test a rule against. Scored against all
of them, with each coordinate rounded to a sixty-fourth as the scaler rounds it:

| the bearing is carried as  | boxes wrong of 528 |
| -------------------------- | ------------------ |
| sixty-fourths, a half down | **1**              |
| sixty-fourths, a half up   | 2                  |
| whole pixels               | 38                 |

So the rule in `Surface` is right, and right by a wide margin -- the whole pixel
reading, which is what the slant uses and what this one cell would want, is
refused thirty-eight times. The half is not the discriminator either: **39 of the
528 are exact halves and 38 of them agree**, so the one that does not is not
being decided by its tie.

Nor can any rule of this shape reach it. The dot's own numbers at six pixels per
em are a bearing of 37.5 sixty-fourths and an `xMin` of 47.625, so the left edge
is 128 + 37 + 48 = 213 sixty-fourths; GDI's box says its left edge was at least 225. **Twelve sixty-fourths is a fifth of a pixel, and there is no quantity in
the glyph that size** -- not the tie, worth one; not the coordinate rounding,
worth one; only a whole pixel is bigger, and a whole pixel is what the other 527
refuse.

So it stands as recorded and unexplained: one box in 528 that GDI puts a column
right of where its own rule puts every other. It is written here rather than
fitted, because a rule that reached it would have to be a rule about one cell.

#### Four more ways it is not, and the recording holds

The first scoring of those carry rules was done from unrounded coordinates and
its numbers were wrong; redone the way `place` actually rounds, against all 528:

| the bearing is carried as         | boxes wrong of 528 |
| --------------------------------- | ------------------ |
| sixty-fourths, a half down        | **1**              |
| sixty-fourths, a half up          | 2                  |
| `MulDiv`, a half away from nought | 2                  |
| scaled by the **cell height**     | 36                 |

The cell height was worth re-testing because it is the one quantity that would
reach this cell -- at eight pixels it carries 200 units to 50 sixty-fourths
instead of 37, which is enough -- and it costs 36 boxes elsewhere.

**And it is not the size either.** At seven pixels per em the box for this cell
comes out `4,5` exactly, and all eleven of the eight-pixel boxes come out right,
because ten of them cannot tell six per em from seven. But Windows says what size
it used: `CreateFont` at a cell of eight reports `height=7, internal=1` for
Symbol, which is six. So the agreement at seven is a coincidence of a sub-pixel
square, not a size this was drawn at.

**Nor is it the bearing's value.** `dot-bearing`'s `j` at a fifteen pixel cell
has a bearing of exactly the same 37.5 sixty-fourths, and there the rule's box is
the recorded one. The same scaled bearing behaves at one size and not at the
other.

**Nor is the recording wrong.** The residue was re-read word by word around the
box for `y`, `m` and `1` at that size: the stack pointer is the same, the frame
is the same, every word within fifty of the box is the same, and only the two box
words and the one beside them move -- 3, 4 for the first two and 4, 5 for the
last. And the whole instrument was fabricated and recorded again from scratch:
**594 cells in common with the first recording, 583 identical, and the eleven
that differ are all at a fifteen-per-em cell height of twenty-one, which is a
size Symbol answers with a strike**, where the residue is not a box at all. The
cell in question came back `4,5` both times.

#### The instrument cannot see what the box was made of

There was one thing left to try on it: widen the residue window and look for the
number the box came from. The probe captures 128 bytes around the box because
that is all it needs once the box is found; the frame is 2,446 bytes deep, and
the scaled coordinates that feed a box have to be somewhere.

They are not. Recorded at that one cell height with the window opened to the
whole frame -- 2,240 bytes -- and diffed between `y`, whose box is the rule's,
and `1`, whose box is not, **twelve bytes differ in the entire frame**:

- the box, in four copies, at `-0x24a`, `-0x24e`, `-0x246` and `-0x263`
- a word at `-0x268` that steps by seven on every cell of the sweep whatever the
  bearing, so it is a counter and not geometry
- the character being drawn, at `-0x20d`, and the one drawn before it at `-0x946`
- three shallow bytes -- `-0x194`, `-0x108`, `-0xda` -- which move with the
  column the ink lands in, so they are downstream of the box

**No sixty-fourth of a coordinate differs anywhere.** The bearing is 160 units
for one and 200 for the other, which is 30 and 37.5 sixty-fourths, and neither
number nor any difference of them appears in the frame. So the box is not
computed here: it arrives already made, out of the scaler's own buffers, which
are on the heap and which this probe cannot see. The residue reads the deepest
thing it can reach and the answer is upstream of it.

And the arithmetic says no rounding gets there anyway. Scaling with a 16.16
factor -- `round(6 * 64 * 65536 / 2048)` is 12,288 exactly -- puts `xMin` at 47
truncated or 48 rounded and the bearing at 37 or 38, so the left edge is between
212 and 214 sixty-fourths whichever way each is taken. The box says at least 225.
**Twelve sixty-fourths is not reachable from `pen + bearing + xMin` by any
rounding of either term**, so whatever GDI did for this one cell, it did not do
by that sum.

That is where the _stack_ stops. The box is recorded, it is reproducible, it is a
column right of where the rule that fits the other 527 puts it, and the residue
cannot see far enough to say why -- because what it is looking for is not on the
stack.

### `heap`: reading the scaler's own memory

If the numbers are on the heap, then read the heap. `TOOLHELP` ships with
Windows 3.1 and has exactly the three things that takes: `GlobalFirst` and
`GlobalNext` walk every block in the system and say who owns each,
`GlobalHandleToSel` turns a handle into a selector, and **`MemoryRead` reads
through that selector without the program ever holding a pointer it might not be
allowed to hold.** Nothing in the probe writes.

The method is the stack probe's, one storey down. A block whose contents are the
same after drawing one character as after drawing another holds nothing about the
glyph. So: draw one, hash every block; draw the other, hash again; and write out
in full the blocks whose hash moved. What does not move is left out, which is
most of the heap.

**The census has to be of everything.** The first one filtered to blocks GDI
owns and found only the bitmap being drawn into -- because a buffer allocated for
a call and freed at the end of it belongs to nobody afterwards while still
holding what it held. Walking all 225 blocks settles that: the buffer is not a
freed block either.

What it finds, between the two cells of the anomaly:

| block          | size       | what it is                                               | bytes differing |
| -------------- | ---------- | -------------------------------------------------------- | --------------- |
| `0b4f`         | 192        | the destination bitmap                                   | **1**           |
| `0857`         | 16,384     | GDI's, and the only thing here that could be the outline | **229**         |
| `085f`         | 12,672     | GDI's `DGROUP`                                           | 3               |
| `0b97`, `0baf` | 160, 3,552 | GDI's, and unmoved between these two cells               | 0               |

The bitmap is the answer being checked rather than the question: one byte at
`+0x30`, `ef` where the ten cells whose box is `3,4` put their pixel in column 3
and `f7` where this one puts it in column 4. The `DGROUP`'s three bytes each
count down by one and are counters. **The 16K block is what the stack could not
reach**, and inside it, where most of the differences are, sit three words that
move by **-8** where the bearing between the two cells moves by 7.5
sixty-fourths.

#### Every draw in the sweep has to be the first of its character

The first sweep with it came back with eleven identical dumps, which was the
instrument teaching its user something. **GDI keeps drawn glyphs**, and a second
request for one is a blit that never enters the scaler at all -- so a block read
after a cached draw holds whatever the last _uncached_ glyph left in it, wearing
this character's name. Read on first draws instead, the whole-block difference
between the two cells falls from 229 bytes to **50**: the rest was cache churn.

Most of those fifty are the cache itself. The block holds x86 code, a record per
cached glyph carrying the character code -- `0x79` against `0x31` at `+0x1583`
and `+0x15ff` -- and a set of far pointers into itself, `0857:0BBF` against
`0857:0BC7`, one entry further along. None of that is geometry.

#### The point array, and two roundings read rather than fitted

The geometry is at `+0x227c`, and it is unmistakable once seen:

    +227c   48   48   66   66   -30 …      (the y cell)
    +227c   48   48   66   66   -37 …      (the 1 cell)

The dot is a square from 254 to 354 font units. At six pixels per em that is
47.625 and 66.375 sixty-fourths, which round to **48 and 66** -- the four x
coordinates of its four points, in the order the outline gives them. The `y`
array is at `+0x2352`: `94 113 113 94`, from 500 and 600 units, or 93.75 and
112.5.

And then the word after the points, at `+0x2284`, swept across all eleven
bearings:

    GDI          11    6    0   -4   -7  -11  -15  -19  -24  -30  -37
    the rule     11    6    0   -4   -7  -11  -15  -19  -24  -30  -37

**Eleven of eleven.** That is `-ceil(shift * ppem * 64 / upem - 0.5)`, the carry
`Surface` applies, negated because the outline keeps its own coordinates and the
origin moves instead. Two of the eleven are exact halves -- `W` at 7.5 and `1` at
37.5 -- and **both go down**, which is the one tie the corpus had to decide and
decided the same way. The coordinates round the other way: 112.5 becomes 113.
Half up for a coordinate, half down for the bearing, both now read out of the
scaler's memory rather than fitted to pixels.

#### And the box is not made of them

Which settles what the anomaly is not. GDI's own numbers for that cell are the
ones this computes: points at 48 and 66, origin at -37, so the left edge sits at
`48 - (-37)` = 85 sixty-fourths from the origin and 213 with the pen at two
pixels -- 3.328, exactly ours. Put through the box rule the recording itself
established, `(213 + 31) >> 6`, that is **3**. GDI's box says 4.

So the inputs are not where the two part. The scaled outline is the same outline,
the origin is the same origin, and the box GDI made from them is still a column
to the right of what its own rule makes of them. Whatever that cell does, it does
between the point array and the box, and both ends are now visible.

#### What is between them is code, and nothing else

The obvious next question is where the box is kept while it is being made, and
the answer is that it is not kept anywhere. Searched across the whole sixteen
kilobyte block, **no word holds 3 and 4 for one cell and 4 and 5 for the other**
-- the only pair anywhere that steps by one is a flag at `+0x1492` going from
nought to one. The box exists on the stack, in the parameter block the scan
driver is entered with, and nowhere else. So the step from the point array to the
box is code with no intermediate that outlives it.

Three things the block does hold, now that its fields have names:

- **the scaler's own code**, which the far pointers point into
- **a glyph cache**: a record per drawn glyph carrying the character code at
  `+0x1583` and the glyph index at `+0x1396` -- 92 for `y` and 20 for `1`, which
  are the indices `Symbol` gives them
- **an allocation cursor**. The words near `+0x139a` that first looked like
  geometry, because they moved by eight between the two cells, are 0x0BB7 and
  0x0BBF; read in the order the characters were _drawn_ rather than the order
  they are listed they go 2999, 3007, 3015, 3023, 3023, 3031 … , stepping eight
  bytes for each new glyph put in the cache and standing still for one already
  there. It is the cache's free pointer and it has nothing to do with the box.

And the arithmetic is not written the way the recording states it. `(x + 31) >> 6`
is what the 528 boxes say the rule _is_; the instruction `add bx, +0x1f` occurs
**exactly once in the whole of `GDI.EXE`**, at `0x14e5d`, and disassembling it
shows `and bx, -0x20` and `shr bx, 3` after it -- rounding a bitmap's row up to a
multiple of thirty-two bits and dividing to bytes. That is DIB stride, not a box.
So the box's rounding is either written some other way or lives in the scaler's
own segment rather than GDI's.

Where that leaves it: the two ends are known and named, the middle is code, and
the places it is _not_ are three fewer than they were.

#### The frame carries no pointer to the points

The obvious way in was the stack again: the frame that carries the box ought to
carry a pointer to the element it was made from, and that pointer would name the
routine. It does not, and settling that took reading both at once.

**Both have to come from one run.** A selector is whatever the heap handed out
that time, so a pointer found in a frame recorded once means nothing against a
census taken another time. So the heap probe gained the stack capture: draw, copy
the frame out before anything else can touch it, and write down the census's
selectors beside it.

The frame is the right frame -- the box is in it, at `-0x24c` and `-0x250`, two
bytes off where `stack.c` finds it because this probe's own frame is two bytes
different. Around it sit two more copies of each edge, at `-0x248` and `-0x265`
and `-0x26b`, and a byte that is `7 - boxLeft`. And:

- **the scaler block's selector appears nowhere in the 2,560 byte frame.** The
  only selector of GDI's the frame carries in quantity is `DGROUP` itself, 14
  times, which is what saving `DS` across calls looks like.
- **the element's offsets appear nowhere either**, near or far -- not `0x227c`
  where the `x` array is, nor `0x2352` where the `y` array is, nor either of
  their second copies at `0x17e4` and `0x19e6`.
- **`DGROUP` holds no pointer to it.** Dumped whole, all 12,672 bytes, it has one
  word pair whose high half is that selector, and that pair's offset is past the
  end of the block -- two adjacent numbers, not a pointer.
- the one far pointer the parameter block does carry is `0B97:0004`, into a 160
  byte block of GDI's, not the outline.

So the link from the point array to the box is not a stored pointer at all.

### The scaler runs on a stack of its own

The reason nothing was ever found is worth the whole chase. Descending the
scaler's entry, which section 3 had already located at segment 36 offset `0xae`:

    00ae  mov bx,0x12         ; which entry of the table
    00b4  call 0xe1
    00e5  mov ax,0xbc         ; relocated -- a segment, not a number
    00e8  mov es,ax
    00ea  mov dx,ss
    00ec  mov [es:0x10],bp    ; save the caller's registers into it
    00fb  mov [es:0x18],dx    ;   ... including ss
    0104  mov [es:0x16],si    ;   ... and sp
    010c  mov di,[es:0x1a]    ; the stack it keeps for itself
    0111  mov ss,ax
    0113  mov sp,di           ; and switch
    0116  rep movsw           ; copy the arguments across
    011e  call far [bx+0x1e]

**It switches stacks.** Every frame the scan converter builds is on a stack of
its own, and the residue probe -- which reads the memory below the _caller's_
stack pointer -- has been reading the wrong one from the beginning. That is why
no coordinate is ever in it, why no pointer to the outline is in it, and why
`DGROUP` has none either. Nothing that computes a box happens where we were
looking.

Which segment it is falls out of the relocations rather than the constant: the
`0xbc` at `0xe6` is patched at load time, and the chain for **segment 47** in
segment 36's fixup table contains `0xe6`. Its selector at run time is found
without the loader's help at all -- the thunk writes the caller's `ss` and `sp`
into the segment at `0x18` and `0x16`, so the block whose head holds _this
program's own stack pointer_ is the one, and that signature cannot be carried by
accident. The probe reads the head of all 226 blocks and exactly one matches.

**It is block `0857`** -- the same block the point array was found in, holding
`ss=050f`, `sp=3844` from the caller and `0x14a8` for itself. So the earlier
reading of that block needs correcting: it is not a glyph cache. It is the
scaler's stack segment, with the stack proper running down from `0x14a8` and the
element's arrays sitting in the static data above it. The character codes and the
counter that steps eight bytes a glyph are stack residue of the scaler's own
frames, not cache entries, and the differences at `+0x12d6` to `+0x14b1` -- just
below its stack pointer -- are the frames the box was made in.

So the instrument was pointed at the wrong stack for as long as there has been an
instrument, and both stacks are now readable.

#### What is on the scaler's stack, and what is not

Read below its stack pointer, the scaler's frames hold **one piece of geometry**:
`48` and `94` at `+0x142e` and `+0x1430`, which are the square's scaled `xMin`
and `yMin` -- and they are **the same for both cells**. The bearing is not in
them. Nor is the box: searched byte by byte over all sixteen kilobytes, nothing
holds 3 for the `y` cell and 4 for the `1` cell, and nothing holds 4 and 5. The
only pair that steps by one anywhere in the segment is a flag at `+0x1492`.

So the scaler computes the glyph's own bounding box, in the glyph's own
coordinates, and the bearing is applied outside it. Which agrees with what its
static area holds -- the point array at `+0x227c` and the origin phantom at
`+0x2284`, the second of which is the bearing and the first of which has no
bearing in it.

**And the box is on the caller's stack, in the parameter block the thunk copies
across.** That is why it is there at all: the switch happens after the arguments
are built, so a box marshalled before the switch is on the old stack and a box
computed after it would be on the new one. It is on the old one.

Yet the caller's stack holds none of the inputs either. Searched for the scaled
`xMin` of 48, for the origin of -37, for their sum of 85 and for that plus the
pen at 213 -- **not one of them is in the 2,560 byte frame**. So the caller does
not add the bearing to the outline's edge on its own stack; whatever it turns
into a box, it is not those two numbers put together there.

#### Why nothing in data ever points at that segment

One loose end from the last sitting closes here. The scaler's segment is named by
a **relocated immediate in the instruction stream** -- `mov ax,0xbc` at segment
36 offset `0xe5`, where the `0xbc` is a fixup slot -- so GDI reaches it without
any pointer in memory at all. That is why the frame has none, why `DGROUP` has
none, and why looking for one was never going to work.

The same fixup chain names every other place that loads it: segment 36 offsets
`0x31`, `0xbc`, `0xe6`, `0x1c3`, `0x2898`, `0x295c` and `0x2964`. Disassembled,
the later ones are `mov ax,SEG / mov ds,ax` in front of code that reads words
through `les bx,[bp-0x1a]` and swaps their halves -- big-endian reads, which is
font file parsing. So segment 36 is the font driver and it borrows the scaler's
segment as data.

#### The box rule, read out of the instruction stream

Following it is a matter of knowing where to start, and the recordings say where.
The thunk calls `far [bx+0x1e]` with `bx` doubled from 0x12, which is `47:[0x42]`
-- a dispatch table in the scaler's own segment, whose selector halves are the
fixup slots that become segment 36. Read out of the file, the entry is `36:1910`,
and descending it finds big-endian word reads and table tags: segment 36 is the
font _file_ driver, not the scan converter.

The scan converter is segment 42, and it can be found by what it must contain.
`sar ax,6` occurs once in the whole image, at file `0x1d509`, which is segment 42
offset `0x1189`. Around it:

    1159  mov dx,[bp-0x38]
    115c  mov ax,[bp-0x30]
    115f  add word [bp-0x30],byte +0x20   ; a maximum, +32
    1165  mov [bx+0x16],ax                ; the unrounded value, kept
    1168  mov ax,[bp-0x26]
    116b  add word [bp-0x26],byte +0x1f   ; a minimum, +31
    116f  mov [bx+0x12],ax
    1172  mov ax,[bp-0x2e]
    1175  add word [bp-0x2e],byte +0x20   ; the other maximum, +32
    1179  mov [bx+0x18],ax
    117c  mov ax,[bp-0x24]
    117f  add word [bp-0x24],byte +0x1f   ; the other minimum, +31
    1183  mov [bx+0x14],ax
    1186  mov ax,[bp-0x30]
    1189  sar ax,byte 0x6                 ; >> 6, arithmetic
    118c  mov [bx+0xe],ax
    118f  mov cx,[bp-0x26]
    1192  sar cx,byte 0x6
    1195  mov [bx+0xa],cx
    1198  mov si,[bp-0x2e]
    119b  sar si,byte 0x6
    119e  mov [bx+0x10],si
    11a1  mov di,[bp-0x24]
    11a4  sar di,byte 0x6
    11a7  mov [bx+0xc],di
    11aa  sub si,di                       ; a height
    11af  sub ax,cx                       ; a width
    11b1  add ax,0x1f
    11b4  and al,0xe0                     ; rounded to a multiple of 32 bits
    11b6  mov [bx+0x20],ax                ; the row stride

**`(min + 31) >> 6` and `(max + 32) >> 6`, on both axes.** That is the rule
section 3 derived from 528 recorded boxes, and here it is as instructions. The
shift is arithmetic, so a negative edge rounds toward minus infinity, which is
what `Math.ceil(x - 0.5)` does and what the corpus needed. The structure keeps
the unrounded sixty-fourths beside the rounded columns, at `+0x12` and `+0x16`,
and ends with a bitmap row stride -- so this is a glyph bitmap's header, which is
what the box always was.

**And the four edges are a running minimum and maximum over the points.** The
loop that feeds them, at `0x10e4`, takes each coordinate in turn and does a
compare-and-keep against two locals apiece -- so the box is accumulated point by
point as the outline is walked, and not taken from a stored bounding box. That is
the other thing section 3 had to settle by counting records: building it from the
corners cost five of the real corpus, and the minimum over points stood. It
stands here for a better reason.

#### What the routine walks, and why the transform cannot be read this way

The routine takes one pointer, at `[bp-0x3a]`, and everything else comes out of
it:

    0f54  mov bx,[bx+0x10]     ; one contour index array
    0f62  mov bx,[bx+0xe]      ; the other
    0f73  add cx,[bx]          ; the first coordinate array
    0f78  add si,[bx+0x2]      ; the second
    0feb  mov ax,[si]          ; and the walk reads them word by word
    0ff7  mov ax,[si]

That is the element the reference describes -- two coordinate arrays and the
contour ends beside them -- and the box is accumulated from the words the walk
reads out of it, with no arithmetic on them in this routine at all. **So the
transform is upstream of the scan converter**, and what it hands over is already
in device sixty-fourths.

And those are the numbers that cannot be recovered afterwards. Searched over the
whole segment, no word holds 206 for the `y` cell and 213 for the `1` cell, and
none differs anywhere near them. What survives the call is the _glyph_ space
copy, twice -- `48 48 66 66` at `+0x17e4` and again at `+0x227c`, with the origin
phantom beside the second -- which is the element's own arrays, bearing not
applied. The device arrays are transient: written into a buffer, walked, and gone
by the time anything can read them.

Which sets the boundary of this instrument honestly. A probe reads memory after a
call; a value that exists only during one is out of its reach, and the transform's
output is such a value. Seeing it wants a different mechanism -- something that
stops the machine mid-call rather than sifting what it left -- and that is not a
probe.

What the disassembly did settle is worth the trip: the box's rounding and the
fact that it is a minimum over points rather than corners were both _fitted_ from
recordings, and both are now read from instructions.

### `dot-fine`, and the boundary was in the wrong place

A breakpoint samples one point; a sweep finds a boundary. Before building the
first, the second was cheap: `dot-fine` is `dot-bearing`'s square again with the
bearing stepped **four font units at a time from 414 to 454**, which is the gap
the coarse sweep left either side of the cell that disagrees. Four units is a
fortieth of a pixel at six per em, finer than the sixty-fourth the box rounds on,
so no two of them can round alike.

    shift   scaled   carried   GDI's box
      160   30.000        30   3,4
      164   30.750        31   3,4
      168   31.500        31   3,4
      172   32.250        32   **4,5**
      176   33.000        33   4,5
      ...
      200   37.500        37   4,5

**The box steps when the carried bearing reaches 32 sixty-fourths, which is half
a pixel.** It does not wait for the sum to cross a column, which at this size
would take 49. The rule in `Surface` predicts `3,4` for all eleven of these; GDI
gives `4,5` for eight.

So the anomaly was never one cell. Scored against all 736 recorded upright boxes
-- the 528 plus this sweep -- the implemented rule is wrong about 25, of which
nine are the unrewritten `.` that this predictor has no business being right
about, and **the other sixteen are all at an eight pixel cell**: the one already
known and eight of the nine new ones either side of it. Every other size still
fits.

    the bearing carried in       boxes wrong of 736
    sixty-fourths (implemented)  25
    whole pixels, a half down    83
    whole pixels, a half up      88

Which is not a licence to take the whole-pixel reading -- it is three times
worse. What the sweep has done is turn one unexplained cell into a **bracketed
boundary**: at six pixels per em GDI's box moves when the carry crosses 32, and
between 31 and 32 there is now a recorded cell on each side. The rule that
explains that, and still fits the other 711, is the thing to find, and it is a
much better-posed question than the one this section started with.

That is also why the debugger was not built. A mechanism that stops the machine
mid-call would have read one set of coordinates for one cell; the sweep bracketed
the rule's failure to a single sixty-fourth at one size, for the cost of a
fabrication and one recording.

#### And the sweep is enough to solve for what GDI walked

Eleven cells four units apart, with the rule that turns a minimum into a column
already read out of the instruction stream, is enough to invert. If the box's
left is `(min + 31) >> 6` and its right is `(max + 32) >> 6`, then each recorded
column brackets its edge to sixty-four sixty-fourths, and eleven overlapping
brackets leave one value:

    GDI's minimum = 193 + carry
    GDI's maximum = 256 + carry

Both exactly, no range left. Checked against the coarse sweep as well -- the same
size, eleven more bearings from -60 to 200 -- **the two lines fit all 22 recorded
boxes at that cell height.**

And they are not what this computes, which is `176 + carry` and `194 + carry`.
The difference is not a rounding:

- the minimum is **17 sixty-fourths further right** than the outline's own left
  edge put through the pen
- and the span between them is **63**, where the glyph is a square 100 font units
  across, which at six pixels per em is 18.75 sixty-fourths -- so GDI is walking
  something a whole pixel wide where the outline is under a third of one

Sixty-three is one less than a pixel. So whatever the scan converter was handed
at this size, it was **not the four points of the square**: it was something one
pixel wide, placed a quarter of a pixel right of where the square's left edge
falls, and moving with the bearing exactly as the square would.

#### And the answer is a threshold at seven pixels per em

Reading `dot-fine` at every size, not just the one it was cut for, ends it. Our
rule predicts each step exactly -- at seven per em, at eight, nine, eleven,
twelve, fourteen, sixteen, twenty and twenty-six -- and fails only at **six**.

Which says where to look, because the two readings of the carry are almost the
same thing and only part company at the bottom:

| size   | the box steps at a shift of | sixty-fourths say | whole pixels say |
| ------ | --------------------------- | ----------------- | ---------------- |
| 6 / em | 172                         | 259               | **171**          |
| 7 / em | 188                         | **186**           | 147              |
| 8 / em | --                          | 131               | 129              |

At eight per em they are two font units apart and no sweep can separate them; at
twelve, less. **Six and seven answer opposite ways, and they are the only sizes
that can.**

So the carry is in whole pixels below seven pixels per em and in sixty-fourths at
seven and above. Scored against every upright box the stack probe has read off a
rewritten glyph -- **704 of them**, ten dot instruments and eighteen cell heights:

| the bearing is carried in                   | boxes wrong of 704 |
| ------------------------------------------- | ------------------ |
| sixty-fourths everywhere (as it was)        | 9                  |
| **whole pixels below 7 per em, else 64ths** | **0**              |
| whole pixels below 8                        | 16                 |
| whole pixels below 9                        | 17                 |

None. And the boundary is measured rather than picked: moving it to eight costs
sixteen boxes and to nine seventeen.

    dot-bearing   286 -> 288 of 288 cells
    fabricated    26,055 -> 26,057 of 26,058,  9 -> 5 wrong pixels

Every recorded fixture is unchanged at a hundred per cent. **The box that GDI put
a column right of its own rule for eight sittings was its own rule all along, at
a size where the rule is a different one.**

What is left of the fabricated corpus is the single `slope-sweep` cell whose
program reads scratch-buffer residue, and nothing else.

### The last cell, and what the heap probe says about it

The `heap` probe was pointed at it -- the face, the cell height and the two
characters it compares are now three defines at the top of the source, so it can
be aimed at whatever a fabrication rewrote. Two things came back.

**The scaler's segment cannot be found by its size.** It was 16 kilobytes for
Symbol and is not for Times New Roman, so the probe now finds it the way it was
identified in the first place: the block whose head holds _this program's own
stack pointer_, which the thunk writes there before it switches. That signature
is unique and size-independent, and the census reads the head of every block to
match it.

**And for a glyph this size the dumps are mostly pictures.** Between `ä` and `å`
at a thirty-one pixel cell, 650 bytes differ over 250 runs, and the long ones are
rows of a rendered bitmap rather than coordinates: the fitted contours this draws
-- `0 253 450 197` for the cut base, and the ring's two twelve-point loops -- are
nowhere in the twelve kilobytes read back. So the arrays that were readable for a
four point square at six per em are not readable for a composite at
twenty-seven, and the instrument does not reach this one.

What is certain is the shape of the problem, and it has not changed: the cell is
inside the residue regime. Clearing the buffer tail instead of carrying it costs
this instrument 26 cells and 109 wrong pixels -- 1,163 of 1,164 against 1,137 --
so the model is doing nearly all of the work and the five pixels left are a
detail of _which_ residue, not of whether there is any.

    fabricated   26,057 of 26,058 cells,  5 wrong pixels

That is one cell of a corpus of twenty-six thousand, in the one place where being
right means reproducing the contents of a scratch buffer byte for byte.

#### What the last five pixels actually are

Reading the cell against its own geometry says it more exactly than "residue"
does. The fitted outline has three loops: the cut base, a parallelogram running
from the baseline to 11.86 pixels up; and two more at 13 to 19 and at 28 to 32,
which are the ring component's outer and inner rings -- except that an annulus's
two rings overlap, and these do not. **One of them has been moved**, and moved by
the composite's own program reading past the four points the base now has.

Ours moved it _upward_, to 28 to 32 pixels, which at a twenty-four row ascent is
off the top of the cell and draws nothing. Calibrated against a row both agree on
-- row 22, where the pen shows itself as a plain `+2` -- every row this draws is
exactly what its own contours give:

    row 13   the parallelogram spans 5.50 to 8.58   ours 5,6,7,8   Windows 5,6,9
    row 14                           5.17 to 8.25   ours 5,6,7     Windows 5,6,8,9
    row 22                           2.50 to 5.58   ours 2,3,4,5   Windows 2,3,4,5

**And Windows's rows are not consistent with the parallelogram at all.** It is a
convex quadrilateral: at any row it is one run. Windows draws two, with a gap at
column 7 and ink out at 8 and 9. So GDI has a loop there that this does not --
its moved ring landed in the middle of the letter where ours landed above it.

#### The buffer's shape, confirmed from its own layout

One thing did fall out of looking again, and it is the model itself. In the
scaler's segment the dot's `x` array sits at `+0x227c` and its `y` array at
`+0x2352` -- **214 bytes apart, which is 107 words.** The fabricated Symbol's
`maxp` says `maxPoints` is 103.

    107 = 103 + 4

So the arrays are **fixed at `maxPoints` plus the four phantoms and laid end to
end**, which is exactly the capacity `Zone.seal` pads to and exactly the reason
a program that names a point past the outline reads the last glyph's value at
that index rather than nonsense. The model was measured into place by counting
cells; here it is in GDI's own layout, to the word.

That is also why the sequence matters and why it lines up: each composite record
fits its ring component and then the composite -- 28 points and then 32 -- so the
tail beyond 32 is whatever the record before it left, in both.

#### The move itself, and what it is worth knowing

Traced through the interpreter, the assembly is a clean annulus before the
program runs: the ring's outer loop from 832 to 1216 sixty-fourths and its inner
from 896 to 1152, which is rows 5 to 11 of the cell, and the cut base below it.
Drawn unmoved, that is Windows's picture apart from the marks in dispute.

Then the program touches indices 16 to 31 -- the inner loop and the phantoms --
and **lifts the inner loop by exactly 896 sixty-fourths**, fourteen pixels, which
puts it off the top of the cell where it draws nothing. Windows's copy of the
same loop is at rows 13 to 16, a few pixels _below_ where it started. So the two
are not one moved and one left alone: **both are moved, by the same instructions,
in opposite directions**.

Three more readings of the buffer were tried against that and none of them moves
a pixel: one buffer shared by every font rather than one per font and size;
replaying every record of the recording in the probe's own order rather than only
the face's, so the history matches; and both together. The capacity is not in
question either, since GDI's own layout gives it to the word.

#### The operand, named

The program is twenty-three bytes and reads plainly:

    40 0c  02 03 02 3e 1e 00 48 27 02 03 02 44   NPUSHB 12
    b9     02ad 0029                             PUSHW  685, 41
    00 2b                                        SVTCA[y]; CALL 41
    01 2b                                        SVTCA[x]; CALL

Traced through, that comes to 32 instructions, and the ones that move anything
are four **`SHC`** -- shift contour -- with an `MIAP` against control value 685
in front of them. The `cvt` has 855 entries, so that one is in range and not the
problem.

The `SHC`s are. A shift contour moves a whole loop by **the movement of the
reference point**, and the trace gives the reference each time:

    instruction 7    SHC   rp1 = 68
    instruction 8    SHC   rp1 = 68
    instruction 30   SHC   rp1 = 62
    instruction 31   SHC   rp1 = 62

**The glyph has 32 points.** Sixty-two and sixty-eight are not in it. They are in
the padding, and what `SHC` wants of them is not a coordinate but a _movement_ --
the difference between where the point is now and where it started -- so the
shift is the difference between two words of somebody else's leftovers. Here that
difference comes to 896 sixty-fourths, and fourteen pixels is what lifts the ring
off the top of the cell.

So the operand is named: **points 62 and 68 of a thirty-two point glyph**. That is
also why every reading of the buffer's scope came back neutral -- one per size,
one per font, one for everything, and the records replayed in the probe's own
order all leave the same values at those two indices, because the chain from the
component's zone to them is the same in all of them. What would differ is the
history GDI had before the recording began, and that is not in the recording.

#### And the reference says what `SHC` reads

The instruction is worth quoting, because it settles that this is the mechanism
and not a guess about one. `itrp_SH_Common`, which both `SHP` and `SHC` get their
displacement from:

    if (BIT0 (lOpCode)) { pt = LocalGS.Pt1; element = LocalGS.CE0; }
    else                { pt = LocalGS.Pt2; element = LocalGS.CE1; }
    proj = Project (element->x[pt] - element->ox[pt],
                    element->y[pt] - element->oy[pt]);

**The displacement is `x[pt] - ox[pt]`** -- where the point is now, less where it
started -- and `CHECK_POINT` beside it is the compiled-out kind. `referenceShift`
here is the same three lines: `zp0`'s zone and `rp1` for the odd opcode, `zp1`
and `rp2` for the even one, projected the same way. So the transcription is right
and the reading of the trace is right.

Which makes the last cell exactly this: **`x[62] - ox[62]` of a glyph with
thirty-two points**, in the glyph zone -- the trace gives `zp0 = zp1 = zp2 = 1`,
and the twilight zone has only sixteen points, so there is no other reading. Both
sides compute the same difference of the same two words. The words are what the
last glyph to have a sixty-third point left there.

#### And the residue is right, which corrects everything above it

Every reading of the last cell up to this point said the two sides read different
numbers out of the buffer, and **that is wrong.** It was wrong because the
geometry was taken from a diagnostic that hinted the one glyph in isolation, where
the buffer is empty and the shift comes to +896. Measured inside the corpus
replay, with the history the recording actually builds, the movements at the two
indices are:

    62:  dx = 0     dy = 0
    68:  dx = -448  dy = -448

Overridden and swept, neither can do better. Index 62 is worse at every value
either side of nought; index 68 is worse at every value either side of -448, and
-448 is exactly what the history gives it:

    68 ->  -576  -512  **-448**  -384  -320  -256
    wrong    13     8      **5**     8    14    20

**So the buffer model reproduces GDI's shift exactly.** Contour 2 lands at `y`
448 to 704, which is rows 13 to 17 -- the very rows Windows's marks are in -- and
the residue account of this cell was an artefact of testing it without its
history.

#### What the five pixels really are

With the shift right, the disputed rows are an _overlap_. Contour 2 is the ring's
inner loop, wound against the base, so where the two cover the same ground the
winding cancels and where only one does it inks. At row 13 the base spans 5.50 to
8.58 and Windows draws `5,6` and then `9`: a hole at 7 and 8, and ink beyond the
base at 9.

    row   the base spans     Windows       ours
     13   5.50 to 8.58       5,6,9         5,6,7,9
     14   5.17 to 8.24       5,6,8,9       5,6,8,9,10
     15   4.83 to 7.91       5,6,8,9       5,6,8,9,10
     16   4.50 to 7.58       4,5,6,8,9     4,5,6,7,8,9
     17   4.17 to 7.24       4,5,6,7       4,5,6

The base is identical on both sides and so is the shift. What differs is where
the inner loop's own edge falls: **ours sits about a column to the right of
Windows's**, so it opens its hole one column late and closes it one column late.
That is a curve crossing a sample near its extremum, which is the same question
the `t` at thirty-two pixels turned out to be -- and it is a question about the
walk, not about memory.

So the last cell is not what this section spent four sittings calling it. Nothing
here depends on scratch memory that a recording cannot carry: the memory is
reproduced, and what is left is five pixels of an inner contour's edge.

#### Which edge, and by how much

The loop is a circle -- four on-curve points at the compass and pairs of controls
between them, so every arc carries an implied midpoint. Worked out exactly and
put through the winding rule, **this implementation's ink is its own geometry to
the pixel**:

    row   the base       the loop        this predicts    Windows      ours
     13   5.50 - 8.58    7.66 - 10.34    5,6,7,9          5,6,9        5,6,7,9
     14   5.17 - 8.24    7.06 - 10.94    5,6,8,9,10       5,6,8,9      5,6,8,9,10
     16   4.50 - 7.58    7.68 - 10.32    4,5,6,7,8,9      4,5,6,8,9    4,5,6,7,8,9
     17   4.17 - 7.24    --              4,5,6            4,5,6,7      4,5,6

So the disagreement is one number. At rows 14 and 15 the loop opens its hole at
7.06, which is left of the sample at 7.5, and column 7 goes dark on both sides.
At rows 13 and 16 it opens at 7.66 and 7.68, which is right of the sample, so
column 7 stays lit here -- and Windows puts it out. **Windows's loop reaches the
sample at 7.5 where this one reaches 7.66**, a difference of about ten
sixty-fourths, at the two rows nearest the top and bottom of the circle and at no
others.

Flattening does not explain it. The arc's second differences are 17 and -37, so
`size` is 91 and the walk gives it two chords; the chord crossing at row 13 is
7.69 against the curve's own 7.66, which is the wrong way and far too small.

And row 17 is the same edge from the other side: the loop's bottom sits at `y`
448, between that row's sample and the one above, and Windows inks a column there
that the base alone does not reach.

#### The value that closes it, by inversion

The loop is shifted twice: once in `y`, by the movement at index 68, and once in
`x`, by the movement at index 62. The first is right -- the history gives it -448
and no other value does better. The second this reads as **nought**, and the
winding says Windows's loop sits about four tenths of a pixel to its left.

So invert it. Overriding the `x` movement at index 62 and sweeping:

    62 ->   0    -8   -16   -24   **-28**  **-32**   -40   -48   -56   -64
    wrong   5     5     2     2     **0**     **0**     2     2     5     5

**Nought wrong pixels**, and the value that does it is **-32 sixty-fourths --
exactly half a pixel.** The whole cell turns on one number, and the number is a
round one.

Where it should come from is visible in the history. Logging both indices through
the records before it:

    #de   count 62   62: x=576 ox=576     the glyph's own first phantom
    #df   count 63   62: x=0   ox=0       its last phantom, a real point here
    #e0   count 12   62: x=0   ox=0       padding from here on, carried forward
    #e3   count 34   68: x=0   ox=448     a program moves 68, giving the -448
    #e5   count 32   62: x=0   ox=0   68: x=0 ox=448

Index 68 traces cleanly and matches. Index 62 is the fourth phantom of `#df` --
the vertical advance origin, which this sets to `(0, 0)` and never moves -- and
after that nothing touches it. In GDI something leaves it half a pixel from where
it started, and that half pixel is the whole of the last cell.

That is where it stands: not memory in the sense of unreproducible scratch, but
one determined value, at a named index, of a named glyph's phantom, worth exactly
half a pixel. It is not written into the implementation, because a value fitted
by sweeping one cell is a value fitted by sweeping one cell.

#### And the phantoms are four, not two

The obvious guess from there is the phantom count. `CHECK_POINT` in the reference
bounds a point index at `elem->ep[elem->nc-1] + 2`, which reads like two phantoms
appended rather than four -- and TrueType did start with two, the third and
fourth arriving with vertical metrics. Two would shift every index a program
reads past the outline by two, which is exactly the kind of thing that puts a
half pixel in the wrong place.

**The corpus refuses it.** Built with two phantoms instead of four, the recorded
glyphs are unmoved -- 6,046 either way, since nothing recorded reads past its own
outline -- and the fabricated corpus falls from **26,057 cells and 5 wrong pixels
to 26,042 and 67**. So four is right, and that bound is not a statement about how
many phantoms an element has.

The other reading of the same evidence is that the room is made and not filled: a
scaler of this vintage has no vertical metrics to put in the third and fourth
points, so it might leave them holding whatever the last glyph left at those
indices, the way every index past the outline does. **That is refused too**, and
by the same margin -- 26,042 cells and 67 wrong pixels, the same figure two
phantoms gives, which is what one would expect since the two changes amount to
much the same thing.

So the slots are made and written -- but "written as nought" was only what
this implementation did, and the corpus had refused _leftovers_, not nought
against anything else. What they hold was then read rather than guessed, below.

#### Read out of the element: the fourth phantom is `xMin`

The heap probe had failed on the composite because the arrays it looked for were
the moved ones. Pointed at the `ß` instead -- a plain fifty-nine point glyph this
draws identically -- it failed again, in every one of 192 owned blocks and 27
free ones, a megabyte, literal and by differences, sixteen and thirty-two bit.
Two things were wrong with the search and neither was the memory.

**The block grows during the draw.** The scaler's block is the same one whichever
face is current -- selector `0857`, owner `06cf` -- but the census that sizes the
dump runs before the draw, and the block is twelve kilobytes then and twenty
after. Read through its selector until the read fails, it is `0x5000` long, and
the last eight kilobytes had never been looked at.

**And the arrays sit at an odd byte.** Every search had turned the block into
words from offset nought. The dot's arrays happened to be even; these are at
`+0x253b`, and a word-aligned search cannot see them at any tolerance. Searched
as bytes, six arrays fall out at once, each **`0x104` = 260 bytes = 130 words**
apart, which is this font's `maxPoints` of 126 plus four -- the buffer model, a
second time, in a second font's layout:

    +0x253b   design x    59 of 59 match          slots 59..62:  0  1024  0  35
    +0x263f   design y    59 of 59
    +0x2743   scaled x    62 of 63                                0   864  0  30
    +0x2847   scaled y
    +0x294b   fitted x    62 of 63                                0   896  0  30
    +0x2a4f   fitted y    63 of 63

**This implementation's fitted `ß` is GDI's, to the sixty-fourth, in every
outline point.** The one word that differs in `x` is index 62, and it differs in
all three arrays the same way: GDI has 35, 30 and 30 where this had nought. Thirty
is 35 at twenty-seven per em, and 35 is the glyph's `xMin` -- which is also its
bearing, so the `ß` alone cannot say which. The dot can. Its four slots at
`+0x227c` read `-30 233 -30 48` for one character and `-37 155 -37 48` for the
other: the origin, the advance, the origin again, and 48 for both, where the
square starts at 254 and 254 at six per em is 47.6. The bearings of those two
characters are a hundred and sixty units and more away. **The third slot is the
origin again and the fourth is `xMin`, scaled**, and both are nought in `y`.

That is the half pixel. A program in one of the composites between the `ß` and
the `å` rounds point 62, and finds a scaled `xMin` of 30 there where this had
nought; 30 rounds to nought and the movement is -30, inside the window the
inversion had bracketed at -28 to -32. With the slots written as read:

    fabricated   26,057 -> 26,058 of 26,058 cells,   5 -> 0 wrong pixels
    recorded     font 5,057   glyphs 6,046   hinting 7,828   unchanged

Nothing else moves. The rule is in `glyph-hinting.ts` where the phantoms are
built, and the probe now reads the scaler's block past the size the census gave
it, on both draws, so the arrays are in the recording.

**And one thing read at the same time that is not understood.** The second draw
in that recording is the composite `à`, and its arrays sit at the same bases.
Its eight outline points equal this implementation's exactly -- `0 253 450 197`
for the cut base, `192 320 384 364` for the accent -- but every value carries a
constant that a simple glyph's do not: 1823 in fitted `x`, 2903 in fitted `y`,
257 in design `y`. The pen is at `(2, 0)`, so it is not a device translation, and
the `ß` has no translated copy. With the constant removed the four slots read
`0 768 0 62`: origin, advance, origin again, and 62 for the composite's own
header `xMin` of 73 at this size. This holds `-64 704 -64 -2` there -- the same
four quantities a pixel to the left, because the composite is placed with its
bearing carried. No program in the corpus reads a composite's slots, so nothing
turns on it yet. It is recorded because it will.

### And the last of `slope-sweep`

The one `slope-sweep` cell is `å` at thirty-one pixels, where a contour its
program moved lands across the base of the letter. Read at the time as a matter
of what the point buffer held; **it is not** -- see the correction below, which
measures the movement inside the corpus and finds it exactly right. What is left
is where an inner contour's edge crosses a sample.

    fabricated   26,055 of 26,058 cells,  9 wrong pixels

### And the last two recorded cells are a sixty-fourth of an edge

The two `glyph` records in `KNOWN_GAPS` are one glyph counted twice -- Symbol
slanted at a thirty-two pixel cell, twenty-six per em, drawn alone and again as
the second of a pair. Rows 22 and 23 of the `t`'s stem ink two columns here and
one in Windows.

Traced, they are not rescues. The runs are ordinary ones, so the question is
where the sheared edge crosses the sample line, and dumping the chords the walk
actually hands the line stepper puts a number on it:

| row | the stem's span | the right edge, past the 9.5 sample |
| --- | --------------- | ----------------------------------- |
| 21  | 8.373 -- 9.781  | +18.0 sixty-fourths, both ink it    |
| 22  | 8.052 -- 9.522  | **+1.40**, Windows does not         |
| 23  | 7.799 -- 9.504  | **+0.28**, Windows does not         |

So the edge passes the sample by a sixty-fourth and a bit, and where this counts
the column covered Windows leaves it clear. Every row that clears the sample by
any margin worth the name agrees.

Three things it is not, each swept against the 6,046 recorded glyph cells:

| what was varied              | best                            | the alternatives                                                  |
| ---------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| the shear's rounding         | 6,044 (round)                   | 6,043 half-down, 6,021 floor, 6,021 ceil, 6,020 truncate          |
| the lean                     | 6,044 (`floor(ppem/3)/ppem`)    | 6,020 `round(ppem/3)/ppem`, 5,989 ceil, 5,980 a flat three tenths |
| the spline subdivision depth | 6,044 (as read from the binary) | 5,754 one deeper, 5,681 two, 5,667 three                          |

The last of those is worth keeping. **Refining the curve makes it worse by 290
records**, which says the coarse chords are not an approximation this happens to
share with Windows -- they are what Windows draws, and our reading of the depth
is right.

#### One spline, and it is a chord and not a sixty-fourth

Dumping the pieces the walk is handed, rather than the chords it makes of them,
names the thing exactly. Both disputed rows are crossed by a single spline --
`(616,-1406) (592,-1484) (611,-1520)`, the inner corner of the stem, less than
two pixels of it -- and the chords it is flattened into do not follow it:

| row | the chord crosses at | the spline crosses at | the sample is at |
| --- | -------------------- | --------------------- | ---------------- |
| 21  | 626.00               | 625.78                | 608              |
| 22  | 609.40               | **607.16**            | 608              |
| 23  | 608.28               | **605.14**            | 608              |

**The spline reproduces Windows on all three rows and the chords do not.** So
this is not a sixty-fourth of anything: it is two and three sixty-fourths of
chord error at a tight corner, on the one piece of this glyph where it matters.

The depth that corner gets is one, which is two chords. Its second differences
are 43 and 42, so `2 * larger + smaller` comes to **exactly 128**, and
`while (size > 0x80)` does not fire. That makes the arithmetic decisive rather
than suggestive: **with the formula as read, the only threshold that can change
this spline is one below 128**, which is the same thing as making the test
inclusive. And that was tried:

    size > 0x80    6,044 -- loses Symbol slanted `t` at thirty-two, twice
    size >= 0x80   6,043 -- wins those two, loses Times New Roman's (C) and (R)
                            at twenty-three and Symbol slanted `j` at fifteen

The three it loses have splines of size exactly 128 as well, and their second
differences -- (10, 59) and (52, 24) against this one's (43, 42) -- are the same
size by any measure one might reach for. Their magnitudes are 59.8, 57.3 and
60.1. **So `size` does not separate the spline that wants two chords from the two
that want one**, and no threshold on it will.

Which leaves the weights, and those were swept rather than reasoned about:
halving the weight on the larger term costs between forty and three hundred and
thirty records at every threshold from 64 to 512, the best of them 6,006. And the
turning point splits, which `EvaluateSpline` really does have and which would cut
this corner into two monotone halves that chords could follow, cost 227:

| what was varied                     | best             | the alternatives                       |
| ----------------------------------- | ---------------- | -------------------------------------- |
| the subdivision threshold           | 6,044 (`> 0x80`) | 6,043 inclusive                        |
| the weight on the larger difference | 6,044 (two)      | 6,006 -- 5,714 at one, every threshold |
| the turning point splits            | 6,044 (none)     | 5,817 with them                        |

So the shape of what is missing is known and its size is known -- a corner two
pixels long, flattened one level too coarsely for these two rows, by a rule that
is right about every other spline in six thousand cells. What is not known is
what tells that corner apart from the two that want the coarse reading, and
nothing in the second differences does.

#### The corner sits on the threshold because the shear put it there

The corner's `size` is 128 because the shear made it so. Unsheared, its second
differences are about 30 and 42, which is a size of 114 and a comfortable depth
of one; leaning it adds roughly `lean` times the `y` difference to the `x` one,
which carries 30 to 43 and 114 to **exactly the threshold**. So the glyph does
not sit near the boundary for any reason of its own. The slant puts it there.

Which makes the shear's own rounding the thing to ask about, and there is a real
question in it. `Surface.slant` applies the lean to the coordinate **already on
the sixty-fourth grid** -- `round(lean * round(y * k))` -- while the box in
`glyph-raster` applies it to the **exact** scaled coordinate, `round(lean * y *
k)`. The two differ by a sixty-fourth, and a sixty-fourth is what this corner
turns on. Applying the lean to the exact coordinate moves the corner's first
point from 616 to 617, its `size` from 128 to 130, and **the two `t` records come
right**.

They come right and something else goes wrong. `z` at thirty-six pixels loses a
pixel of its smear -- a rescue and not a spline; it has no piece anywhere near
the threshold -- so the recorded corpus is 6,044 either way, one glyph for
another. The recorded boxes cannot choose between them either: both readings put
197 of the 198 slanted boxes exactly where GDI's memory says. **The fabricated
corpus decides it**, and it decides against the change:

| the lean is applied to            | recorded glyphs   | fabricated cells | wrong pixels |
| --------------------------------- | ----------------- | ---------------- | ------------ |
| the gridded coordinate (as it is) | 6,044 (`t` wrong) | **26,055**       | **9**        |
| the exact coordinate              | 6,044 (`z` wrong) | 26,046           | 19           |

So the outline keeps the gridded reading. What is left standing is the oddity
that put the question: **the box shears one way and the outline the other, and
each is the better of the two where it is measured** -- the box 948 of 948 on the
stack recordings, the outline nine cells and ten pixels better on the
fabrications. They are different code in GDI as well, and this is the first thing
found that tells them apart.

Two more readings were tried and refused. Making the subdivision test inclusive
alongside the exact shear is worse than either alone, 6,041. And the bitmap row
shift -- the model section 3 built out of the row-by-row comparison and did not
ship -- cannot even be asked here: Windows's slanted `t` inks **one** column at
row 18 where its own upright inks two, so that row is no shift of that row.

#### It was the point between two controls, and which coordinates it halves

Everything above chased the corner: its curvature, its depth, its shear, its
threshold. The corner was never the thing. **What was wrong was one of its
endpoints**, and it is a rule that had never been asked about at all.

A pair of consecutive off-curve points implies an on-curve point between them,
which a font is written expecting; TrueType says it is their midpoint. What it
does not say -- because for a font it makes no difference -- is _which_
coordinates it is the midpoint of. This halved the design coordinates and scaled
the result. The scaler is working in sixty-fourths and halves those, the way it
halves everything else: `(a + b + 1) >> 1`, the same form `EvaluateSpline` uses
for the control it makes when it subdivides.

Half a sixty-fourth on one point, and it reaches the picture because that point
is an _end_ of the piece the corner belongs to. Move it and the piece's second
difference moves; move that and `size` comes off 128; come off 128 and the walk
flattens it into four chords instead of two, which is exactly what the crossings
wanted all along.

| the implied point halves        | recorded glyphs |
| ------------------------------- | --------------- |
| the design coordinates, exactly | 6,044           |
| the scaled ones, truncated      | 5,925           |
| the scaled ones, rounded up     | **6,046**       |

Truncating costs 121 records, so the `+ 1` is measured here and not just
inherited from the subdivision. The fabricated corpus does not move: 26,055 cells
and 9 wrong pixels either way.

    font      5,057 of 5,057   100%
    glyphs    6,046 of 6,046   100%
    hinting   7,828 of 7,828   100%
    lines       248 of   248   100%

**`KNOWN_GAPS` is empty.** Every record of every fixture the oracle has recorded
of fonts -- mapping, metrics, extents, advances and pixels -- this reproduces.

It is worth saying what the six rounds of refusals bought, since none of them was
the answer. They are what made the last step readable: because the shear, the
lean, the depth, the threshold, the splits and the row shift had each been swept
and each refused by hundreds of records, the only thing left that could move a
crossing by half a sixty-fourth was a coordinate nobody had questioned. The
corner was never near the boundary for a reason of its own -- section above --
and once that was known, the question stopped being "how finely is this curve
walked" and became "where does this piece actually begin".

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

| Looked like                                      | Actually was                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| `MIAP` rounding the cap height wrongly           | closed by the standings; the cvt account was withdrawn, no instruction named |
| `MIRP` moving a phantom point it should not      | `MDRP`/`MIRP` minimum-distance sign                                          |
| One pixel of internal leading, a rounding bug    | reading the wrong `VDMX` ratio group                                         |
| `ROUND` producing 128 where Windows has 64       | `DIV` rounding where it should truncate                                      |
| `IP` interpolating to the wrong place            | `IP` fed coordinates already quantised                                       |
| A `CALL` answering differently from the same arm | `DELTAP` four instructions earlier moving by the wrong rule                  |

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

**None differ now.** All 3,546 recorded cells agree, across three faces in four
styles each. Five used to -- Arial's `1` at 24, Arial Italic's `A` at 16, Times
New Roman's `W` at 16 and `g` at 24, and Courier New's `1` at 16, eight pixels
between them and every one the end of a thin stroke. The account below of that
last stage is kept because the reasoning is what found the rest.

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

### A delta moves along the freedom vector

`DELTAP` names a point and a nudge, and the nudge is a distance **along the
projection vector**. The point travels along the _freedom_ vector far enough
that its projection moves by what was asked, which where the two are at an angle
means travelling further, and can mean travelling the other way. Adding the
nudge to the coordinate is right only where the two vectors are the same axis.

In the reference this is not a special case at all: `itrp_DeltaEngine` is handed
`LocalGS.MovePoint` and calls it, and `LocalGS.MovePoint` is the general mover
that divides by `pfProj` unless a vector instruction has swapped in an
axis-aligned one. Every other move already went through ours; the delta did not.

It is invisible almost everywhere, because almost every delta runs with both
vectors on an axis. The exception found it: Courier New Bold's `K` sets its
projection along its own arm with `SDPVTL`, leaves freedom on the y axis, and
then applies a delta, so the nudge arrives divided by the cosine between them.
That one instruction is the whole of the last sixteen recorded cells -- six of
them the `K` itself, the rest other diagonal letters in the bold and italic
files -- and routing the delta through `movePoint` closed all sixteen at once.

**The delta base is 9.** A font may set it with `SDB` and none of the installed
ones does, so it is the scaler's own constant, and nothing measured had pinned
it: `delta-ascending` covers every nibble with sixteen exceptions that all move
the same distance, so whatever the base is one of them fires and the reading is
identical. `delta-base-sweep` gives each nibble a different distance and reads
which one fired. At every size that reports, the exception that fires is exactly
the one `ppem - 9` names.

### A readout with a blank answer is not a readout

Three readings taken while chasing that `K` said the arm and everything computed
from it agreed with Windows, and pointed at a function called three instructions
later. All three were worthless.

Each moved one point of the letter **upward** by the value being read. A
character cell is as tall as the letter and the letter fills it, so a mark that
lands inside the silhouette draws nothing and a mark that clears the silhouette
leaves the cell. All three landed in one or the other on both sides, and three
recordings agreed because neither side drew a mark at all.

Reading **sideways** works: the cell is thirty-two columns and Courier at these
sizes is seven, so a mark placed to the right of the letter is the only ink in
twenty-odd columns and cannot hide. That is what `cutAndCall` does.

The lesson is narrower than "check the instrument". A readout whose two outcomes
are _ink here_ and _ink there_ fails safely. One whose outcomes are _ink here_
and _nothing_ does not, because _nothing_ is also what a readout that never ran
produces -- and two of those look identical from the fixture.

The bisection that did settle it needed no readout at all. Cutting the `K`'s
program after N instructions and recording what Windows draws, for N around
where it was suspected, put the divergence between 88 and 89 -- and the one
instruction between those two is the `DELTAP1`. Windows drew cuts 86 through 91
identically; we drew 89 differently from 88. **A cut that changes our picture
and not Windows' names the instruction directly**, and it costs one recording
per cut and no arithmetic.

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

Every recorded fixture agrees and the fabricated corpus is whole, so this section
is no longer a list of defects. What follows its head is the chase for the
recorded corpus as it happened, sitting by sitting, and **the figures inside it
are the figures at the time** -- it opens on a `W` a pixel of cap height out that
has not been wrong for a long while. What is actually still not known is shorter,
and it is here.

### What is still not known, now

Everything below draws the right pixels. What is missing in each is the _reason_,
read out of GDI rather than measured into place.

- **How the installer chose Wingdings' family.** The pitch and family GDI
  reports for an outline face are the `FONTDIR` entry of the `.FOT` the
  installer wrote, read now (section 8a), and Wingdings' says `FF_DONTCARE`
  where Symbol's says `FF_ROMAN`. What `CreateScalableFontResource` read that
  from is not known: swapping the `OS/2` class and the PANOSE between the two
  `.TTF`s changes nothing Windows reports, as it would not if the answer is in
  the `.FOT`, and no probe has yet made a `.FOT` from a fabricated face.
- **Storage and control values across glyphs.** A glyph program may write
  both, and this keeps them from one glyph to the next at a size; whether
  Windows restores them as it restores `SCANCTRL` is untested.
- **Two narrow-glyph rules are measured, not read.** A glyph whose box collapses
  in `x` skips the stub check, and a glyph narrower than a sample gap is drawn as
  one run per column. Both are exact on their instruments -- 258 of 258 and the
  phase sweep -- and neither has been found in segments 42 or 43.
- **The box shears the exact coordinate and the outline the gridded one.** Each
  is the better reading where it is measured, so they are kept apart; why GDI
  does it that way is open.
- **The bearing is carried in whole pixels below seven per em** and in
  sixty-fourths from seven. Read from a fine sweep against the box rule, 704 of
  704, and the threshold is not yet found in the code that applies it.
- **The `lines` tie exception.** A steep line in the opposite direction rounds
  its tie upward where every other case rounds down. 248 of 248, recorded as
  measured.
- **A composite's four slots differ from GDI's by a pixel.** After `à`, GDI's
  element holds `0 768 0 62` where this holds `-64 704 -64 -2`, with all eight
  outline points equal; and GDI's arrays for a composite carry a constant per
  array -- 1823 in fitted `x`, 2903 in `y`, 257 in design `y` -- that a simple
  glyph's do not and that is not the pen. No program in 26,058 cells reads a
  composite's slots, so it costs nothing; it is not understood.
- **A projection rounds its halves toward positive infinity.** The scaler's
  `ShortFracMul` adds a half and shifts, which floors; `mulDiv` here takes the
  sign out and rounds away from zero, and the two differ on an exact negative
  half. Read off a readout of Arial's `X` under a width and Arial Italic's
  `f`, and applied to the two projections with the reference's operand order
  (section 8a). The same rule in the point move, in `IP`'s scaling and in the
  freedom-projection dot product is refused or indifferent by count, so those
  keep the symmetric rounding, and which the scaler's `LongMulDiv` and
  `MulDiv26Dot6` actually do is not known.
- **`IUP` with two anchors at one original coordinate.** Windows shifts the
  run by the first anchor's move; the pseudocode sends an equal pair to the
  second (section 8a). Three cells measure it and nothing contradicts it; the
  line in the scaler that decides it is not known.
- **The whole pixels an outline is carried back by.** A program that moves its
  origin phantom off a whole pixel -- Arial Bold Italic's `M`, to -66 -- has
  its outline carried by the phantom's whole pixels only (section 8a); whether
  those are the nearest or the ones toward zero, no recording separates.
- **Four things about a width request are measured where the pseudocode is
  silent.** The reference scales the control values once, at a size it is
  handed, and reads them through 16.16 stretch factors; that the size is the
  _larger_ of the two is read off Arial asked for less than its average (section
  8a), not out of any code. The horizontal size is the vertical one times a
  fixed-point ratio rounded to the nearest, and 16.16 is assumed for its
  precision because it is the scaler's own; no request in the corpus separates
  the precisions. `FixMul` takes a half toward positive infinity, which is what
  an arithmetic shift does and is measured on three descenders. And the
  stretched design coordinates `IP` and `MDRP` measure from keep a fraction of
  a unit, measured on an `S`; what the glue actually stores is not known.
  One stretched cell of 1,944 is still wrong, an unhinted `o` at a horizontal
  size of four.
- **Outside the fixtures**: what GDI passes for `pixelDiameter` (the scale is
  927 of 927 without it); `ISECT` on near-parallel lines, matched at ten of
  fifty-nine readouts and declared irreducible; and `s45round`'s half case, two
  of fifty-nine, a square root's rounding.

### Closed by the standings without a named mechanism

These were open here for a long time and are not wrong now, and nothing in this
file names the step that fixed them. They closed as side effects of things read
for other reasons, which is a weaker kind of closure and should be called that.

- **Times New Roman's `W` and `g`, a pixel of cap height**, and the `W`'s
  three-pixel serifs. The control-value account written below was withdrawn when
  `IP` was found to extrapolate -- "whatever the `W` was, it was not this" -- and
  the `W` has been in the never-wrong list since.
- **Arial's `A`, two pixels on one row** where a diagonal crosses a sample.
- **The thirty-seven fabricated sweep cells** within three sixty-fourths of a
  crossing, which this section's last words below still describe as
  unaccounted for. The heading that introduces them says they are one problem
  with the letters, and the letters closed on a polyline walk rounded to
  sixty-fourths and a device half that rounds upward; the sweeps went with them,
  unattributed.
- **`times-cvt0-fine`'s bar clipped below the baseline** and **`cour-no-instctrl`'s
  `w`** at a size where instructions are off, parked as out of scope and later
  found drawn.

### As it happened

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

### And the inaccuracy is in the spline walk alone

Attributing each disputed crossing to the piece that made it puts the whole of
it in one place:

| crossings on offer                | count | disputed | rate |
| :-------------------------------- | ----: | -------: | ---: |
| straight lines                    | 3,673 |    **0** | none |
| splines, the exact branch         | 2,785 |       43 | 1.5% |
| splines, the approximating branch | 1,042 |       19 | 1.8% |

`CalcLine` never disagrees. Half the crossings in the fixture come from it and
not one of them is ever drawn differently, which is a strong statement about
everything the two share -- the reflection into a quadrant, `ScanAbove` and
`ScanBelow`, the entry lists, the pairing, the fill. All of that is right, and
what is left is the conic stepping that only splines use.

Two things inside it are cleared. It is not the approximation: the branch that
takes a `2z` out because `Q` will not fit disagrees on 1.8 per cent of its
crossings against 1.5 for the branch that does not, which is the same rate
either way. And it is not the derivative guard's threshold. That guard is the
one part of the walk which is a heuristic rather than an exact test -- the sign
of the conic form is exact arithmetic, the guard is a comparison of a derivative
against a comparand -- and it fires on about 1.6 per cent of steps, a rate that
matches the disputes suspiciously well. But its threshold is a clear optimum:
doubling the comparand gives 76 wrong pixels and quadrupling 83, halving gives
74 and quartering 87, removing it altogether 85, against 62 as written.

Two more shapes it does not have. The starting value of the conic form carries a
parity from the quadrant reflection -- nought or one, added before the walk
begins, which is a tie-break for a form that starts at zero. It never matters
here: forcing the parity either way, inverting it, or adding and subtracting one
outright leaves all 62 pixels exactly where they were, because `q` runs to a
hundred million and its low bits are never near the decision. And the disputes
do not gather where an error in the start would put them. Sorted by how far
along its own spline each crossing falls, the rate over fifths is 0.97, 2.71,
1.93, 2.34 and 0.37 per cent -- lowest at both ends and highest in the middle,
which is neither an initialisation going wrong nor an accumulation building up.

So lines are exact, splines are wrong on one crossing in sixty, neither the
approximation nor the guard nor the starting value explains it, the error
neither starts at the beginning nor grows toward the end, and an exact solve of
the same outline sides with this implementation on 59 of the 62.

**And `CalcSpline` is not where it is.** `spline.c` is the routine itself rather
than a description of it, and this implementation is the same code: the
reflection into a quadrant, the two early exits, `PowerOf2` and the shift table,
both branches of the forward difference with their groupings intact, the four
stepping loops and the two tails after them. Line for line, including
`lQuadrant = (lQuadrant == 1) ? 2 : 3` where the reading here adds `yIncrement`
and gets the same two answers. The only parts of that file this does not have
are `CalcHorizSpSubpix` and `CalcVertSpSubpix`, which serve smart dropout and
never run for a face asking `SCANTYPE` 1.

Nor is it the subdivision. Across `times-bare`, six crossings in 3,827 come from
a piece that was cut at all, and every one of the 62 disputes is on a piece that
was not. The curves handed to the walk are the outline's own.

So the position is this: the outline is right, since half the crossings come
from straight edges and not one of those is ever drawn differently; the pieces
are right, since nothing is subdivided; and the walk is right, since it is the
same code. One crossing in sixty still comes out differently, and the geometry
says this implementation has it correct. Every part of the scan converter that
can be read has now been read, and the difference is not in any of them.

`scanlist.c` closes the last routine in the path. `fsc_BeginElement` chooses the
`on` lists for quadrants one and two and the `off` lists otherwise, takes the
vertical pair only when dropout control is on, and stores control points only
under `SK_SMART`, which is the model here exactly. `AddHorizSimpleScan` is an
insertion sort that leaves equal values in the order they arrived, which a
stable sort matches. And `fsc_FillBitMap` pairs the two lists by index and draws
`BLTHoriz(start, stop - 1)` for a positive run and `BLTHoriz(stop, start - 1)`
for a negative one, which is the half-open span in both directions that this now
draws.

So every part of the scan converter that can be read has been read against what
it produces, and the difference is in none of them.

**A mutation search says the same from the other side.** Rather than reason
about which constant might be wrong, the walk was mutated programmatically and
each variant scored against `times-bare`: the two step comparisons made
inclusive, the branch test on `alpha` made inclusive, the sample rounding in
`above` and `below` moved a sixty-fourth each way, the second derivative terms
halved, the reflection offsets dropped from the entries. Five of those change
nothing at all -- those comparisons never sit on their own boundary -- and every
one of the rest is worse, from 79 wrong pixels for a halved `ddQx` to 2,113 for
dropping `xOffset`. Nothing in that space beats what is there.

The search is worth keeping as a method even though this pass found nothing, and
it needs one guard: a mutation to a stop value makes the walk run forever, and a
harness that only scores will hang rather than report.

**The one shape that still fits is the control point.** Of everything measured,
the dispute rate along a spline's own parameter is the most suggestive: 0.97,
2.71, 1.93, 2.34 and 0.37 per cent over fifths, which is the shape of `2t(1-t)`
-- the weight a quadratic gives its control point, zero at both ends and largest
in the middle. A control point is also the one input a spline has and a line
does not, which would explain why lines never disagree.

There is a place the two implementations could differ over one. `FillGlyph`
takes the point implied between two off-curve points as `(a + b + 1) >> 1` on
coordinates that are already scaled, where this averages in font units and
scales afterwards; the two part company by half a sixty-fourth when the sum is
odd, and a midpoint exists only where two control points meet, so it can never
touch a straight edge.

Measured, it is worth one pixel of the 62: `times-bare` goes to 61 and the
recorded letters go the other way, 780 letters and 105 wrong pixels becoming 779
and 107. Times New Roman simply has few places where two off-curve points meet.
So the mechanism is real and too rare to be the one at work, and the `2t(1-t)`

### The error is in the stepping loop and nowhere before it

The shape asked for a fabrication of its own, so: thirty-six rectangles with one
curved side, the endpoints of the curve fixed and the control point walked
outward twenty font units at a time -- from sitting exactly on the chord, where
the three points are collinear and `EvaluateSpline` hands the piece to
`CalcLine`, to some five pixels clear of it.

The answer is not the one the shape suggested. The error does not grow with the
control's distance; it switches on:

| control, in font units | cells wrong                 | pieces short-cut | pieces stepped |
| ---------------------: | :-------------------------- | ---------------: | -------------: |
|                      0 | none                        |                0 |              0 |
|               20 to 80 | none                        |               12 |              0 |
|                    100 | 3 of 6                      |                6 |              6 |
|             140 to 700 | one or two of six, steadily |       4 or fewer |      8 or more |

`CalcSpline` has two exits before its forward difference begins: one when the
piece spans no scan column, which draws it as a single column, and one when it
spans no scanline. Below a hundred font units every piece leaves by one of those
doors, and every one of them is drawn exactly. At a hundred the stepping loop
starts running for half of them, and that is where the disagreements start. Past
that the rate is flat -- more stepping, not worse stepping.

So everything before the loop is right, and demonstrably: the reflection into a
quadrant, `ScanAbove` and `ScanBelow`, the stop values, the entry lists and the
fill are all exercised by the short-cut pieces, which never disagree. What is
left is the execution of the forward difference itself, and nothing else in the

**The same sweep in Courier New says the same thing.** Its outlines are built
differently and its cell heights map to different pixel sizes, so the threshold
falls elsewhere -- the stepping loop first runs at a control of twenty font
units rather than a hundred -- but the rule is identical either side of it.
Every piece that leaves by an early exit is drawn exactly, in both faces, and
the disagreements begin with the first piece that steps and then hold at a
steady rate: 52 wrong pixels over 216 cells in Times, 44 in Courier.

So it is not a property of one face's outlines. Wherever the forward difference
runs, about one crossing in sixty comes out differently; wherever it does not,
nothing ever does.

### The shipped binary does not carry the table the source declares

`spline.c` is a development build -- it has `Assert` calls and a commented-out
`printf` -- so whether it is the revision that shipped is a fair question. Its
one distinctive datum is `lZShiftTable`: thirty zeros followed by 1, 1, 1, 2, 2,
2, 3, 3.

That ramp does not appear anywhere in the installed system. Searched as bytes,
as sixteen-bit words and as the `int32` the source declares, across every file
on the drive, there are no matches at all. `GDI.EXE` is where it would be, being
the module that carries the TrueType strings, `GetGlyphOutline` and
`ConvertOutlineFontFile`, and it is a plain `NE` image with zero runs of up to
four hundred and fifty bytes, so a literal table of mostly zeros would be
findable. Every zero run of forty bytes or more was examined and none is
followed by the ramp.

What that does and does not say is worth keeping straight. It does not prove the
scaler is absent from `GDI.EXE`, or that the table is wrong: a mostly-zero
`static const` may be placed differently by the compiler, packed, or built at
initialisation. It does mean that the one datum which could tie the source we
have verified against to the binary that produced these fixtures is not there to
tie it. So `spline.c` is evidence about the algorithm and not proof about the
machine, and a source vintage differing from the shipped one would account for
every measurement in this section without any of them being wrong.

Scanning for the shape rather than the values says the same. `GDI.EXE` is the
only module on the drive with font entry points -- eleven of them, against none
anywhere else -- so the scaler is in it. Looking through it for anything
table-shaped, meaning a run of small non-decreasing values with repeats at a
stride of one, two or four bytes, finds nothing at all. Relaxing to any run of
twenty-four or more small non-decreasing values that are at least half zeroes
finds seven, and every one of them is a long stretch of zeroes ending in a
single byte rather than a ramp.

One caution against reading too much into that. The table's values do not matter
to the disagreement in any case: `zShift` measures nought at every size in every
fixture here, so the precision reduction never runs. The search was a question
about which revision shipped, not about the mechanism. And a compiler has an
easy time turning that particular table into arithmetic, since nought below
thirty and then 1, 1, 1, 2, 2, 2, 3, 3 is a formula rather than data. Its
absence is consistent with a different vintage and equally consistent with an
optimiser, and nothing here distinguishes the two.

### Reading GDI.EXE properly, and a wrong address withdrawn

The address in the previous section was wrong, and the way it was wrong is worth
keeping. `ScanAbove` is `((p + 32) & -64) + 32`, and the search for it looked for
a mask with -64 and took the first plausible hit: segment 36 at 0x4895, `add si,
+0x20` then `and si, -0x40`. But nothing adds 32 back afterwards, so it is a
plain round to the nearest whole pixel and not `ScanAbove` at all. Across all
forty-six code segments there are thirteen masks with -64 and not one of them is
followed by an addition of 32. Segment 36 is the scaler: the function at 0x4765
rounds point coordinates to the pixel grid, calls a signed `MulDiv`, and shifts
the result right by ten.

Two assumptions had to go before anything found the right place. The first is
that `ScanAbove` survives compilation at all -- the source writes
`SCANABOVE(fxY1) >> SUBSHFT`, and the mask does not survive that shift, since
`(((p + 32) & -64) + 32) >> 6` is just `(p + 32) >> 6`. The second is that the
arithmetic is 32-bit in the 386 sense. It is not. This code carries `F26Dot6` in
`dx:ax` pairs with `adc` and `sbb`, and hands 32-bit shifts and divisions to far
helper calls, so every search shaped like `sar r32, 6` was structurally incapable
of matching. The marker that does work is `mov cl, 6` followed within a few bytes
by a call.

### A loader and a recursive descent

Finding the rest needed real tooling, in `scripts/oracle/ne.mjs` and
`scripts/oracle/descend.mjs`. The loader reads the segment table, the entry
table, and each segment's relocation records, walking the chained fixups so that
the bytes a relocation writes over are known to be operands rather than the start
of an instruction. The descent decodes only from places control actually
reaches, which is what a linear sweep cannot do: a compiler leaves jump tables
and constants between functions, `ndisasm` resynchronises after them at whatever
offset happens to work, and every address after the first patch of data is a
guess.

Seeding it took one more turn. Segment 36 has no exported entries at all and the
ten relocations naming it are segment fixups pointing at offset zero, so the
entry table gives nothing. Near calls are the answer, precisely because the
linker never relocates them: scan for `E8`, take the target, and keep it only if
it opens with `push bp; mov bp, sp` or an `enter`. That yields 69 function
entries in segment 36, 12 in segment 42 and 7 in segment 43, and the descent runs
from those.

### The scan converter is segments 42 and 43

Segment 43 is `scanlist.c`. The function at 0xd24 computes four values as
`(v + 31) & -64` shifted right by six -- `ceil` onto the pixel grid, four times
over, which is the bounding box -- then scales one of them by four and adds it to
a base pointer to get a list pointer it afterwards steps by four in both
directions. That is `fsc_SetupScan` and its scan lists.

Segment 42 is the walker, and it is where `ONSCANLINE` lives. The function at
0x11e8 walks consecutive point pairs, returns early when a step has zero length,
and computes a scanline index for each of four coordinates as `(v + 31) & -64`
shifted right by six. That expression rounds halves _down_, which is not what
either `ScanAbove` or `ScanBelow` does, and the code repairs the difference
explicitly: it tests `(p & 63) == 32` and increments the index when it holds.
Both identities check out over every coordinate from -4096 to 4096:

    (SCANABOVE(p) >> 6)  ==  ((p + 31) & -64) >> 6  +  (p & 63) == 32
    (SCANBELOW(p) >> 6)  ==  ((p + 31) & -64) >> 6  -  1

So this is our `ScanAbove` and `ScanBelow`, compiled differently, and the
on-scanline tie is ruled out as a candidate for the remaining pixels rather than
left open. The same function carries the quadrant as a bitmask in `dx`, shifted
left once per arm of the up/down and right/left decision, with the reflection
offsets held as a `si` and `di` that start at 32 and are negated; it records two
further flags at 0x80 and 0x100 for a start coordinate sitting on a scanline, and
then takes a cross product of the two steps with `imul`. That is the direction
test the pseudocode describes, and it is the next thing to read line by line.

### The endpoint topology, read out of the binary

The block from 0x1342 to 0x150e in segment 42 is the endpoint topology, and it
is reached only when the point being evaluated sits exactly on a scanline in x or
in y -- a flag word carries those two facts at 0x80 and 0x100, and when neither
is set the code jumps straight past to the element walk at 0x150f. That is the
same guard the pseudocode puts on `CheckHorizTopology` and `CheckVertTopology`,
and the horizontal half is 0x1390 through 0x1445.

Three things confirm the reading before any of it is interpreted. The three
comparisons in the block are `y0` against `y1`, `y1` against `y2`, and `x0`
against `x1` -- exactly the three the pseudocode makes. The block ends in three
tails, one adding to a list, one adding to a second list that grows the other
way, and one falling from the first into the second, which are `AddHorizOn`,
`AddHorizOff`, and the two together. And the values they store settle the
rounding: `on` stores `((x + 31) & -64) >> 6` and `off` stores the same plus one
when x is on a scanline, which are `(x + 31) >> 6` and `(x + 32) >> 6` -- our
`addHorizOn` and `addHorizOff` unchanged.

What the block does not do is decide from those three comparisons. It decides
from a quadrant, held one-hot in the low four bits and derived from the sign of
the step; a cross product of the incoming edge against the outgoing one,
`(x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1)`, whose sign is bit 0x10; and two
degeneracy bits for a step that is flat in x or in y with the previous point flat
alongside it. The pseudocode mentions none of these. Transcribed and compared
over every arrangement of six coordinates, the two trees differ on 3,954 of
15,625.

### Why that difference cannot be the residue

The disagreements all have one shape. Every one of the 3,954 is an `on` and an
`off` together against neither -- there is no case where one tree says `on` and
the other `off`, and none where either says `on` alone against nothing. The two
tails write to `(x + 31) >> 6` and `(x + 32) >> 6`, which name the same column
unless x is itself on a scanline, so a coincident pair spans no pixel at all.
Adding it and adding nothing are the same bitmap.

So the two readings can only diverge at a point that is a pixel centre in **both**
axes at once. On the fixtures that is not a rarity so much as an absence:
`horizTopology` runs 716 times across the whole set and `vertTopology` 572, the
two trees part company on 9 of those 716, and in none of the 9 is x on a
scanline as well. Swapping the binary's tree into `scan-walk.ts` and rerunning
leaves the totals at 6,165 of 7,050 cells and 2,180 wrong pixels, unchanged to
the pixel.

The implementation therefore keeps the pseudocode's form, which is what the
standing rule asks for: there is a difference here, but no measurement that can
choose between the two, and a tree transcribed by hand from a partly understood
disassembly is the worse thing to trust when nothing distinguishes them. Both
trees and the reason they agree are recorded in
`test/raster/endpoint_topology_test.ts` so that a later change to one can be told
from a change to both. What this does settle is that the endpoint topology is not
where the remaining pixels come from.

### The element walk, and where the trail stops

Past the endpoint topology, 0x150f begins the walk itself, and the first thing it
does is take two shortcuts. If the scanline index of the start equals that of the
end in y, the element crosses no horizontal scanline at all, and a loop walks the
column range adding the one row index to each vertical list; if the two agree in
x instead, the mirrored loop walks the row range. Only when the element crosses
in both does control reach the general case at 0x1609.

That case sets up four things and then leaves. It widens both steps to 32 bits by
sixty-four, `dx << 6` and `dy << 6`, by the usual trick of a `cwd`, a byte move
and a shift. It adjusts the two half-pixel offsets: if the start sits exactly on
a scanline and the step travels the positive way along that axis, the scan index
is incremented, the list pointer advanced by one entry, and the offset moved a
whole sixty-four -- the scanline you are standing on is the one you skip. It
takes a determinant of the distance to the first crossing in each axis against
the opposite step, which is what decides whether a horizontal or a vertical
scanline is met first. And then:

    168b  and bx,byte +0xe
    168e  add bx,[0x1ce]
    1692  call [bx+0x4a4]

The walk proper is behind a function table, indexed by the quadrant with its low
bit masked off and by the scan kind. Two things follow from that. The scan kind
is not a bitfield but a byte offset into this table, which is why the code tests
it with `cmp word [0x1ce], byte +0xa` rather than a bit test -- a detail that had
looked odd. And the table is addressed through `ds`, so it lives in the data
segment, and reading it means resolving DGROUP and its relocations. A static
sweep of the code segments cannot follow this call, and that is where the trail
stops for now.

### One walk, no second setup, and a theory that fails

Two things came out of looking for the conic walk that are worth keeping even
though neither settles it.

The first is a count. `SCANABOVE` and `SCANBELOW` have to mask to a multiple of
sixty-four, and across the whole file, in every encoding a sixteen bit compiler
can emit for that mask -- register and accumulator forms, byte forms, the 386
form -- there are twenty-four such masks. Thirteen are in the scaler in segment
36, four are the bounding box in `fsc_SetupScan`, three are unrelated, and the
remaining four are the ones in `CalcLine` at 0x126c, 0x1289, 0x12a6 and 0x12b6.
There is no second scanline-index setup anywhere. Whatever draws a curve does not
begin the way `CalcSpline` begins. (An earlier narrower pattern found the same
four and missed several other masks entirely, so the count here is the one to
trust.)

The obvious theory from that is that the shipped code has no conic walk at all
and flattens curves into chords. It does not survive contact. Subdividing every
spline to straight segments and handing those to `calcLine`, at thresholds of
128, 64, 32, 16 and 8 sixty-fourths, gives 2,347, 2,332, 2,794, 3,463 and 4,274
wrong pixels against the 2,180 of the conic walk. Not one is an improvement, and
the trend away from the threshold is monotone. Windows is not drawing chords, and
our forward-difference walk is closer to it than any flattening of it.

So the count and the measurement point opposite ways, and the honest position is
that both stand: there is no second `SCANABOVE` setup in the binary, and curves
are nonetheless not being flattened. Resolving it means reading the table at
`ds:0x4a4`, which needs the data segment.

### The table at ds:0x4a4, and the stepper behind it

The table resolves once you stop assuming `ds` means DGROUP. GDI's automatic
data segment is 48, and 0x4a4 there holds values far too large to be offsets
into a segment of 6,587 bytes. The font scaler carries its **own** data segment,
47, and at 0x4a4 in that one:

    0x4a4  186c 18b8 1904 1954 1954
    0x4ae  16d3 173a 179c 1802 1802
    0x4b8  0000

Two groups of five words, ten bytes apart, which is the stride the scan kind's
value of ten implies. Within a group the index is the quadrant with its low bit
masked off, so the entries used are at +0, +2, +4 and +8, and the +6 slot is
filled with a copy of its neighbour to keep the arithmetic simple. Every value
lands inside segment 42, past 0x16d0 -- which is exactly where the descent had
stopped, because nothing near-calls these: they are reached only through the
table.

Seeded with those eight addresses the descent covers 0x16d3 to 0x19a3 with no
gap larger than six bytes and exactly eight `ret`s, which accounts for the whole
tail of the segment. Eight routines, four quadrants by two scan kinds. The first:

    16d9  or dx,dx           ; the determinant
    16db  jl 0x1710          ; negative: cross a horizontal scanline
    16dd  jg 0x16e3          ; positive: cross a vertical one
    16df  or ax,ax           ; zero in the high word, so test the low
    16e1  jz 0x1710          ; a determinant of nought steps horizontally
    ...
    16e3  cmp cx,[0x1be]     ; xScan against xStop, and return when they meet
    ...
    1700  inc word [0x1ba]   ; xScan++
    1704  sub ax,[0x1b6]     ; determinant -= dy * 64
    1708  sbb dx,[0x1b8]
    ...
    1729  inc bp             ; yScan++
    172a  add ax,[0x1b2]     ; determinant += dx * 64
    172e  adc dx,[0x1b4]

That is our `calcLine` line for line. A determinant is carried, a positive one
steps a column and takes away `dy << 6`, a negative one steps a row and adds
`dx << 6`, and the walk ends when the moving index meets its stop. The tie
matters and agrees: at nought the shipped code takes the horizontal branch, and
ours reads `if (q > 0)` step the column `else` step the row, so nought goes the
same way. The two also set the determinant up alike, from the distance to the
first crossing in each axis against the opposite step; where we carry a `q` of
nought or one out of the quadrant decision, the binary instead moves the
half-pixel offset by a whole sixty-four, which is the same tie-break spelled
differently.

### What is behind the table, and what is not

Eight steppers, and all eight are this. There is no conic among them.

That is worth stating carefully, because it is weaker evidence than it looks.
`spline.c` includes `scanlist.h` with the comment _for direct horizscan add
call_, so `CalcSpline` was written to add its crossings straight to the lists
rather than to be dispatched through a table -- its absence from the table says
nothing about whether it exists. The evidence for absence remains the mask count
of the previous section, and against it remains the measurement: flattening
curves to chords is worse at every threshold tried.

So the question is sharper than before rather than answered. The scan converter
walks lines with a determinant, exactly as we do. Whatever draws a curve either
adds its crossings directly, without the four-way `SCANABOVE` setup the source
shows, or does not exist and the flattening happens further upstream in the
scaler -- and if it is the latter, it is not the chord flattening tried here.

### There is no conic walk, and here is what draws a curve

The four calls to `CalcLine` all come from one function low in segment 42, and
what it does before each of them is call 0x19a4. That is a thunk: it sets `es`
from `ds`, clears the direction flag, and far-jumps to offset 0x42 of segment 44
or segment 45 depending on a global -- a 286 build and a 386 build of the same
routine, chosen at load. Segment 44 is the 386 one, and it is full of `0x66`
prefixes, which is the first real 32-bit arithmetic in any of this.

It opens by sign-extending six coordinates and taking, for each axis, a first
difference and then a second: `p1 - 2*p2 + p3`. It measures those two with an
octagonal norm -- twice the larger plus the smaller -- and then counts how many
times that has to be divided by four to fall under 0x80, which is how many times
the curve has to be halved, since halving a quadratic quarters its second
difference. The count starts at one and is clamped at eight. Past a depth of
five it halves the curve outright and recurses; at five or less it steps.

The step is a forward difference in an accumulator scaled by the square of the
step count, and it writes its points into two arrays:

    021b  add edx,[bp-0x24]     ; the point advances by the first difference
    0222  add eax,ebx           ; ebx is half of the scale
    0225  sar eax,cl            ; and back down, rounded
    0228  mov [di],ax           ; a coordinate, in sixty-fourths
    022d  add [bp-0x24],eax     ; the first difference grows by the second

So a curve is a **polyline**. Windows picks a power of two from the curve's
curvature, evaluates the quadratic at that many equal steps of its parameter,
rounds every point to a sixty-fourth, and hands the chords to the line walker one
at a time. That is why the scan converter has only line steppers, why there is no
second `SCANABOVE` setup, and why every disputed pixel we ever traced was on a
curve and never on a line: we were drawing the true conic, and Windows was
drawing a rounded polygon through it.

### What it was worth

Implementing it moved the fabricated set from 6,165 of 7,050 cells exact and
2,180 wrong pixels to **6,441 exact and 1,818 wrong** -- 276 more cells right and
362 fewer pixels wrong. The outline glyphs in the recorded set went from
ninety-two per cent agreeing to **ninety-six**, and the letters still in dispute
from sixty-eight to thirty-three.

Three details each carried part of that, and none of them is in the document. The
halving rounds -- the new control is `(p1 + p2 + 1) >> 1` and the new end
`(p1 + 2*p2 + p3 + 2) >> 2`, where the document writes a truncating midpoint and
`CalcHorizSplineSubpix` writes `+ 1` rather than `+ 2`. Every stepped point is
rounded half up rather than truncated. And each chord is a whole element, so its
endpoint goes through the endpoint topology like any other vertex: feeding those
through `ends.check` was worth 215 cells on its own, and until it was done the
flattening looked like a wash.

The turning-point splits went too. They exist in `EvaluateSpline` so that a conic
walk can run over a monotone piece, and with no conic walk to feed they only cost
accuracy: taking them out was worth a further 61 cells and 75 pixels. `calcSpline`
stays in the file, exported and still checked against an independent
transcription by `spline_walk_test.ts`, because it remains our reading of what
the document says -- but nothing draws with it.

An earlier attempt at this in the previous section failed and it is worth saying
why, because the failure looked conclusive. It flattened adaptively on chord
length and recursed on a distance threshold, which is a reasonable thing to do and
is not what the binary does: the depth comes from curvature, the steps are equal
in the parameter rather than adaptive, and the rounding is specified. Getting any
of those wrong makes flattening worse than the conic walk, which is exactly what
was measured. A negative result about a hand-chosen approximation said nothing
about the real one.

### The thirty-three that are left

Named rather than counted, because a rate cannot say whether a change fixed four
letters and broke three. `test/oracle/disputed_glyphs_test.ts` lists them and
holds both counts as ceilings.

Thirty-three records, fifty-eight pixels. Eleven in Arial, thirteen in Times New
Roman, nine in Courier New; twenty-four of the thirty-three are wrong by one or
two pixels. What is left is thinly spread rather than concentrated, and it is not
one shape: `a m B S 7 0 3 9 2 5` in Arial, `X y 3 8 R 2 9` in Times, `g t S 5 Z 2`
in Courier. Digits are still over-represented -- fifteen of the thirty-three --
which was true before the flattening as well.

The one outlier is Times New Roman's `8` at sixteen pixels, wrong by nine, and it
is worth recording what it looks like because it is the only place left with
enough wrong pixels to have a shape. It is the waist, where the two bowls cross:

    rows 6-9      Windows            ours
    row 6         columns 4, 6       columns 3, 7
    row 7         column  5          columns 4, 5, 6
    row 8         columns 4, 6       columns 5, 6
    row 9         columns 3, 7       columns 3, 4, 7

Windows draws a clean symmetric X closing to a single pixel at row 7. Ours is
wider at row 6, three pixels across at row 7 where Windows has one, and -- the
telling part -- not symmetric at row 8, where a stroke that should mirror row 6
sits a column to the right. So the two strokes are crossing at a different place
rather than being drawn a pixel thick in the wrong direction.

One thing that is ruled out. The order in which a chord's endpoint is registered
against the chord being drawn makes no difference at all: registering after
rather than before leaves the fabricated set at 6,441 cells and 1,818 pixels,
unchanged. Whatever the waist is, it is not the endpoint bookkeeping around the
flattening.

### The fill and the dropout, read against the source

Four things checked against `scanlist.c` rather than guessed at, of which one
was wrong.

`fsc_FillBitMap` pairs the two lists **by index**, walking them in lockstep, and
draws `sXStart..sXStop - 1` when the run is positive and `sXStop..sXStart - 1`
when it is negative. That is our bidirectional fill from the minimum to the
maximum less one, unchanged, and it confirms the pairing is positional rather
than sorted-and-matched.

`LookForDropouts` fires on a **zero-length run** -- `*psHorizOn == *psHorizOff`
-- not on a gap between runs, and it walks the vertical lists from the end
backwards, top of the glyph downward. Ours reads them forward. The source is
explicit, so this was worth remeasuring after the flattening changed the
geometry: reversing costs two cells and two pixels, 6,439 and 1,820 against
6,441 and 1,818. Our lists are keyed by the negated row, so forward in our frame
is the source's backward, and the two orders agree to within a rounding either
way. It stays as it is.

`DoVertDropout` matches ours, including the part that had looked missing. It
makes two `GetBit` calls where ours makes one, but the one we do not make reads
the pixel the rescue is about to write, so skipping it only saves a write. The
early return on the band, the `lYDrop--` placement below, and the clamp into the
box all line up.

`DoHorizDropout` did not match, and this is the one worth having. Its two
`GetBit` calls read the **undecremented** coordinate and are each guarded on the
run being clear of the corresponding edge, `lXDrop > lBoxLeft` and `lXDrop <
lBoxRight`. Ours asked after moving the run a column left and after clamping it
into the box, and asked unguarded. Two separate mistakes: asking after the clamp
reads a different pixel whenever the rescue was clamped, and asking unguarded
lets a stroke along the right edge of the box block the column beside it -- the
same shape as the guard that took `twin-bars` to 264 of 264 on the vertical
side. Fixing it is worth a cell and a pixel, 6,442 and 1,817, and the guard
itself measures as a no-op on the fixtures while the ordering carries the whole
gain. It is written the source's way regardless, because being right for the
recorded reason is worth more than a cell.

None of this touches the `8`'s waist, which is still open.

### The waist is in the crossings, not in what reads them

Dumping the scan lists for Times New Roman's `8` at sixteen pixels puts the
question past argument. Ten rows carry crossings, and seven of them are right:

    row   on        off       ink       Windows
      3   [4]       [7]       4-6       agrees
      4   [3,7]     [4,8]     3, 7      agrees
      5   [3,7]     [4,8]     3, 7      agrees
      6   [4,7]     [4,8]     3, 7      4, 6
      7   [4,6]     [6,7]     4, 5, 6   5
      8   [5]       [7]       5, 6      4, 6
      9   [3,7]     [4,8]     3, 7      agrees
     10   [3,7]     [4,8]     3, 7      agrees
     11   [3,7]     [4,8]     3, 7      agrees
     12   [4]       [7]       4-6       agrees

Every row we get right and every row we get wrong is read by the same code, and
the fill turns each list into exactly the ink the previous section says it
should: row 6 pairs `4` with `4`, which is a zero-length run, so the dropout
places a pixel a column to its left at 3, and pairs `7` with `8` to fill 7. Row 7
pairs `4` with `6` and `6` with `7`, filling 4, 5 and 6. Row 8 has one pair and
fills 5 and 6. All three are the right answer to the wrong question.

Windows has different crossings on those rows, not a different reading of the
same ones. Its rows 5 to 9 are `3,7` then `4,6` then `5` then `4,6` then `3,7` --
a clean diamond closing to one pixel and reopening, symmetric about column 5.
Ours reaches its crossing a row later and never recovers the symmetry: at row 8 a
stroke that should mirror row 6 sits a column right.

So the fill, the pairing and both dropout routines are confirmed against
`scanlist.c` and confirmed innocent here. What is left is upstream of the lists:
either the chords the flattening produces for this curve, or the hinted outline
they are produced from. Those are worth telling apart before anything else is
tried, and the way to do it is the way `times-bare` did it once before -- a
fabrication of this shape with the hinting taken out, so that only one of the two
can be moving.

### The fabrication already existed, and it says hinting

The thing to build was `times-bare`, and it was built two threads ago: every
glyph program in Times New Roman overwritten with `SVTCA[x]`, so the outline is
scaled and nothing moves it. It was 218 of 264 cells and 62 wrong pixels when it
was recorded, which is what said at the time that the residue was the rasteriser
rather than the interpreter.

After the flattening it is **264 of 264 cells and no wrong pixels at all**. So
are `control-sweep`, `cour-control-sweep`, `edge-sweep`, `fine-sweep`,
`slope-sweep`, `turn-sweep` and `twin-bars`. Every fabrication that takes the
hinting out is now exact.

That includes the glyph in question. `times-bare` holds exactly 264 Times
records and one of them is `'8'` at sixteen pixels -- the same character, the
same size, the same face as the nine-pixel waist. Unhinted it is right to the
pixel; hinted it is wrong by nine. **The waist is a hinting difference.**

And it generalises. Of the 1,817 wrong pixels left in the fabricated set, every
one is in a `cour-*` hinting fabrication or in `times-cvt0-fine`, which is a
control-value test:

    cour-bars        426      cour-boxes       150      cour-sides        32
    cour-arches      376      cour-lies        120      cour-backslants   28
    cour-offsets     168      cour-crowd       120      cour-slants       26
    cour-hairslants  154      cour-widths       74      cour-leftband     24
    cour-shapes       80      cour-no-instctrl  32      cour-mirrorband    4
                                                        times-cvt0-fine    3

Not one wrong pixel remains in a fixture that does not run a glyph program. As
far as anything recorded here can tell, the scan converter is finished: the walk,
the flattening, the endpoint topology, the fill, the pairing and both dropout
routines all agree with Windows exactly wherever the interpreter is held still.

The thirty-three letters and the 1,817 pixels are one problem now, and it is the
interpreter. `cour-bars` and `cour-arches` are eight hundred of those pixels
between them and are the place to start.

### A correction: `cour-bars` runs no program at all

The previous section said every wrong pixel left was in a hinting fabrication.
That was inferred from the names and it is wrong. `cour-bars` builds its glyphs
with `program: []` -- four points, no instructions -- so the interpreter moves
nothing, exactly as in `times-bare`. It is the largest single block of wrong
pixels in the set, 426 of the 1,817, and it is not a hinting test. The claim
should have been checked before it was made; what follows is the checking.

### What `cour-bars` actually measures

The bars are rectangles a sixth to half a pixel across at eight pixels per em,
in six widths and three phases, eighteen standing upright and eighteen lying
down. Ninety-seven of 258 cells disagree, and they fall into two populations
that do not overlap at all:

- **Forty-eight lying bars.** Windows draws **nothing whatsoever** and we draw
  the whole bar. Every one of the forty-eight is Windows-blank; there is not a
  single lying failure of any other kind.
- **Forty-nine upright bars.** We draw _less_ than Windows, never more.

The error scales inversely with the bar's thickness -- 125 pixels wrong at forty
design units against 22 at a hundred and forty -- which is to say this is a
question about dropout control and nothing else. For the lying bars the shape of
it is sharp: every bar 0.94 pixels tall or more is drawn by Windows without
exception, and below that whether it is drawn depends on the phase as well as
the height.

Disabling our vertical rescue entirely takes `cour-bars` from 161 cells and 426
wrong pixels to 209 and 98, fixing all forty-eight lying failures and no others.
It costs 1,648 pixels elsewhere. So Windows is not declining to rescue in
general; it is applying a condition here that we do not.

### Three things that condition is not

**`SCANCTRL`.** Courier New's `prep` leaves it at 300, which is bit 8 set with a
size of 44: dropout control on for every size measured here. Read at each ppem
from the fabricated font, it is 300 throughout and `scanType` is 1 throughout.

**The interpreter never running.** A glyph with no instructions returns from
`hintedOutline` before the hinter is built, so `SCANCTRL` was never being read
for these at all and the rasteriser was falling back on its own default of
always rescuing. That is a real gap and it was worth closing -- `fpgm` and `prep`
run once per size, not once per glyph -- but closing it changes nothing here,
because what `prep` says is what the default already assumed.

**The box's minimum height.** Our box forces itself at least one row tall and one
column wide, `Math.max(boxTop + 1, ...)`, where `fsc_SetupScan` rounds each edge
independently and lets the two land on the same index. A bar whose rounded extent
collapses would then have nowhere to put a rescue, which fits the symptom
exactly. It is still wrong: dropping the floor takes the set to 7,185 wrong
pixels and rounding both edges the same way to 7,323, against 1,817. The
minimum stays until something explains it, and it is now the oldest unexplained
thing in this file.

### The box is allowed to collapse, and a rescue outside it is not placed

Dumping the lists for the lying bar that Windows leaves blank -- Courier New's
`k` at twenty pixels, a bar 0.39 pixels tall -- shows what the argument was
missing:

    box   left 4  right 17  top 10  bottom 11
    horizontal rows with crossings: none
    columns 4 to 16, every one:  on [-10]  off [-10]

Thirteen columns of zero-length run and not one horizontal crossing, which is
what a bar lying between two sample rows looks like. The rescue lands on row 10,
and row 10 exists only because our box forces itself a row tall.

Two things in `scanlist.c` say it should not. `fsc_SetupScan` rounds each edge of
the box onto the pixel grid independently and lets both land on the same index,
which gives `lHeight = lHiBitBand - lLoBitBand` of nought -- a band with no rows
in it. And `DoVertDropout` ends on `lYDrop >= lLoBitBand && lYDrop < lHiBitBand`,
so with an empty band there is nowhere to put the rescue and nothing is drawn.
That is the whole of what Windows does with these bars.

Neither half works alone, which is why removing the minimum looked so bad the
first time it was tried. Without the band test a collapsed box does not discard
the rescue, it clamps it to `boxBottom - 1` and paints a row _outside_ the glyph:
7,185 wrong pixels. Without the collapse the band test never fires, since the box
is never empty. Together they are worth **99 cells and 704 pixels**: 6,442 to
6,541 of 7,050, and 1,817 wrong to 1,113. `cour-bars` goes from 161 cells and 426
wrong pixels to 209 and 98, which is every one of its forty-eight lying failures.

The asymmetry is the source's rather than a convenience. `DoHorizDropout` has no
closing band test at all -- it clamps into the box and writes -- so the box keeps
its minimum width while losing its minimum height. Letting x collapse as well
costs 5,368 pixels.

The recorded letters do not move: still thirty-three records and fifty-eight
pixels. A real letter's bounding box does not collapse, so this was always going
to be a fabrication's finding, which is what the fabrications are for.

### The upright bars, and a stub check that is right everywhere else

The forty-nine that remain are the upright half, and dumping one says exactly
what they are. Courier New's `A` at sixteen pixels, a bar a third of a pixel
wide:

    box  left 6  right 7  top 3  bottom 12
    r 3  windows #   ours .   on [6] off [6]  rescue queued
    r 4  windows #   ours #   on [6] off [6]  rescue queued
    ...
    r10  windows #   ours #   on [6] off [6]  rescue queued
    r11  windows #   ours .   on [6] off [6]  rescue queued

Nine rows of zero-length run, nine rescues queued, seven placed. **We lose the
first row and the last one.** Windows draws all nine.

The reason is that the vertical lists are completely empty for this glyph. A bar
a third of a pixel wide has horizontal edges that span less than a column, so
they cross no vertical sample line and contribute nothing, and `countVert` is
nought everywhere. That collapses the stub check to its remaining term, "does the
neighbouring row have crossings" -- which is true in the middle of a run and
false at both of its ends, for any isolated run whatever.

Three things measured about it, none of which resolves it.

Removing the horizontal stub check makes `cour-bars` perfect, 258 of 258 cells
and no wrong pixels, every upright failure with it. It costs 1,111 pixels
elsewhere: `cour-phases` goes from nothing wrong to 199, `cour-mirrorband` from 4
to 184, `cour-sides` from 32 to 178, `cour-leftband` from 24 to 170, `cour-mirror`
from nothing to 92. The check is doing real work on fixtures built for other
questions, so it is not simply absent from Windows.

Our rows run downward and the source's y runs up, and the two branches of the
check are not symmetric -- the one reads `HorizCrossings` at `y - 1` but
`VertCrossings` at `y`, the other reads all three at `y + 1` -- so a mismapping
was worth ruling out. Sweeping which row the vertical terms are read at: the
present `(0, +1)` gives 1,113 wrong pixels and the four alternatives give 2,648,
3,190, 3,790 and 4,670. None of them changes `cour-bars` at all.

The same sweep on the vertical rescue, from the previous section, has every
non-zero offset behaving exactly like having no vertical rescue at all. Between
them the two sweeps say the checks are where they belong.

So the position is precise and unresolved. `DoHorizDropout` guards its stub check
on `usScanKind & SK_STUBS`, and `SCANTYPE 1` is simple dropout excluding stubs,
which sets it -- so the source says Windows should decline at the ends of these
bars exactly as we do, and Windows draws them. Either the flag is not set the way
the `SCANTYPE` reading assumes, or Windows' lists are not empty here and its
horizontal edges contribute a crossing ours do not. Both are checkable and
neither has been checked.

### The stub check is gated, and we apply it unconditionally

The previous section left two checkable things. The first is answered: the
shipped dropout pass does carry a stub check, and it does not always run it.

It is one fused routine rather than the source's `LookForDropouts` calling
`DoHorizDropout`. Segment 42 at 0x978 walks the two lists in step -- 0xa47 to
0xa5f scans the off list forward until it reaches the on value, 0xa61 tests them
for equality, and a zero-length run falls through to the work. The horizontal
pass is 0xa2f to 0xafd and the vertical one mirrors it at 0xb7a to 0xc83.

The stub check sits between them, and it is guarded:

    0a69  mov ax,[bp-0x36]
    0a6c  or  ax,[bp-0x38]
    0a6f  jz  0xac5          ; straight to the placement, no stub check
    0a71  ...two crossing counts, each compared with 2...

Those two words are the routine's register parameters spilled by the `push dx` /
`push ax` at its head, and the head then does `mov word [bp-0x38],0` and `and
word [bp-0x36],byte +0x1`. So the gate is bit 0 of the **high** word of a
thirty-two bit scan kind, and the caller at 0x580 refuses to call the routine at
all when that same thirty-two bit value is nought:

    0580  mov ax,[bp+0x8]
    0583  or  ax,[bp+0x6]
    0586  jz  0x593          ; no dropout pass whatever
    0590  call 0x978

So there are two independent switches, one turning dropout control off entirely
and one turning the stub check off while leaving the rescues on. **We model the
first and not the second: our stub check always runs.** That is exactly the shape
the upright bars need -- with the check skipped, `cour-bars` is 258 of 258 cells
and no wrong pixels.

The counter at 0xe28 is faithful otherwise. It sums the same three terms, guards
each with a bound comparison the way `HorizCrossings` and `VertCrossings` return
nought outside the band and the box, and gives up early once the total reaches
two.

What is still missing is the flag's value. The scan kind reaching this routine is
thirty-two bits and is not the byte offset in `[0x1ce]` that `CalcLine` dispatches
through; it is built further up, where GDI turns a `SCANTYPE` into whatever the
scaler wants. Until that is traced the honest position is that we apply a check
the shipped code applies conditionally, that turning it off fixes every upright
bar, and that turning it off also costs 1,111 pixels on fixtures built for other
questions -- which means either those fixtures are wrong for reasons this check
has been masking, or the flag is set for them and not for the bars. Nothing here
distinguishes those, so nothing is changed.

### Tracing the flag, which turns out to be set

The gate found in the previous section is bit 0 of the high word of a thirty-two
bit scan kind. Tracing where that word comes from closes the question against the
hypothesis it was raised to support.

The chain is short. Segment 42's public entry at 0x42 takes the value as its
first two stack arguments and hands them down to the fill at 0x978. Segment 36
pushes them at 0x22f9 from a pair of its own locals, which it filled at 0x227d
from a call to segment 36's 0x2374. And 0x2374 opens with

    2378  mov ax,[bx+0x104]
    237c  mov dx,[bx+0x106]

-- one thirty-two bit field where the **low word is `SCANCTRL` and the high word
is `SCANTYPE`**. What follows is that field evaluated: bit 11 turning dropout off
above the size in the low byte, bits 12 and 13 asking about rotation and stretch,
bit 8 turning it on at or below the size, a special case for a size of 255, and
bits 9 and 10 for the same two conditions the other way about. Every path either
returns the field unchanged or, at 0x2403, `sub ax,ax; cwd` -- nought.

So the scan kind is `SCANCTRL | (SCANTYPE << 16)` when dropout is on and nought
when it is off, which is why the caller can test the whole thirty-two bits for
zero to skip the pass. And the stub gate, being bit 0 of the high word, is
**`SCANTYPE & 1`**. Courier New reports `SCANTYPE` 1 at every size measured. The
bit is set. Windows runs the stub check on these bars exactly as we do.

That kills the explanation. The upright bars are not a stub check we apply and
Windows skips; both apply it. What is left is the other half of the pair, which
has not been touched: Windows' lists are not empty where ours are, and its
crossing counts at the first and last row of an isolated run reach two where ours
reach nought. Where those extra crossings come from is the open question, and it
is now the only one.

Two smaller things the trace settles in passing. Our `dropout` getter has bits 8
and 11 and the size comparison right, checked against 0x239d to 0x23d0 line for
line. It is missing the `SCANCTRL` low byte of 255 meaning always-on, and bits 9
and 10; neither fires for any font here, where the value is 300 throughout, but
both are real and cheap to add when something needs them.

### The upright bars, with everything else ruled out

Following the counter at 0xe28 through for the bar that fails puts numbers on the
last hypothesis and does not confirm it either.

Courier New's `A` at sixteen pixels sits in a box of `left 6, right 7`, and its
crossings are `on [6] off [6]` on rows 3 to 11. The counter's three terms for the
row above the top of the run are the horizontal list at that row, the vertical
list at column 5, and the vertical list at column 6. The first is empty because
the run has ended. The second is skipped by the counter's own bound test, since
column 5 is left of `lBoxLeft` -- the guard at 0x0e60 is exactly `VertCrossings`
returning nought outside the box. The third is read and is empty. Nought, and the
check declines, in the shipped code as much as in ours.

So Windows draws those two rows for a reason that is not in the counter. Either
its horizontal list carries an entry a row beyond where ours ends, or its
vertical list at column 6 carries one where ours is empty -- and the second would
have to come from the bar's top and bottom edges, which span a third of a pixel
and cross no vertical sample line at all.

One more thing ruled out on the way. `cour-bars` glyphs have no instructions, so
they leave `hintedOutline` before the interpreter is built and are scaled by the
rasteriser's own path rather than the interpreter's -- which is not what Windows
does, since `fpgm` and `prep` run once per size regardless, and it would have
explained the difference neatly if the two paths disagreed. Running the
interpreter for them changes nothing: 6,541 cells and 1,113 wrong pixels either
way, to the pixel. The two scaling paths agree, and `times-bare` being exact
while `cour-bars` is not has some other cause.

That leaves the forty-nine upright bars as the only thing in the fabricated set
with a mechanism identified and no explanation: a stub check that both
implementations run, on lists that agree everywhere the two draw the same thing,
declining at the two ends of an isolated run in ours and not in Windows.

### The fixtures put the line at isolation, not at thinness

Two fabrications already draw the boundary the upright bars fall the wrong side
of, and both are exact. `cour-shelves` is a tall post with a thin horizontal
shelf between scanlines; `cour-feet` is a post standing on a foot thinner than a
scanline gap. Both are 258 of 258 cells with no wrong pixels. `cour-phases`, 258
of 258 as well, sweeps a bar across a pixel centre -- but its bars lean, so their
edges cross vertical sample lines and the vertical lists are not empty.

So a thin axis-aligned run **attached to something** is rescued correctly, and a
thin axis-aligned run leaning even slightly is rescued correctly. Only the fully
isolated, exactly axis-aligned bar fails, which is precisely the case where the
stub check has nothing to find. The fixtures and the mechanism agree, and neither
explains why Windows rescues it.

### What the fill loop does instead of pairing

Reading the dropout scan again more carefully turns up a real difference from
both the source and from us, which then does not help.

    0a2f  mov bx,[bp-0xc]        ; the next 'on' entry
    0a38  mov ax,[bp-0x10]       ; the off count, reloaded
    0a3e  mov ax,[bp-0x12]       ; the off pointer, reloaded
    0a47  ...scan forward while the off value is less than the on value...
    0a61  cmp [bp-0x28],di       ; equal? then it is a dropout

The count and the pointer are **reloaded for every `on` entry**, so this is not
`*psHorizOn == *psHorizOff` with the two walking in step, as `LookForDropouts`
has it and as we have it. It is a search: a dropout fires for an `on` value when
_any_ `off` value in the row equals it. The two lists also share one buffer, one
growing from the front and one from the back, which is what the two list pointers
in the walker were doing.

For a row with a single run the two readings agree. For the waist of an `8`, or
anything else with several runs on one row, they need not, so it was worth
trying. It measures worse: 6,355 cells and 1,565 wrong pixels against 6,541 and
1,113. Our lists are each sorted, so `includes` is a fair test of the same
question, which means either the order the back-growing list is read in makes the
search behave like pairing after all, or something about the buffer layout is
still misread. It is not adopted.

This turn found no improvement. Four explanations for the upright bars have now
been closed by evidence -- the stub gate, the scan kind, the frame mapping, the
scaling path -- and a fifth measured worse. What has not been tried is asking
Windows the question directly, with a fabrication built for it: an isolated bar
with a deliberate protrusion at one end only, so that the two ends of the same
run differ in exactly the thing the stub check looks at.

### Asking Windows directly, and a comparison that was confounded

`cour-stubs` puts the question that inference kept failing at. The same sub-pixel
post four times over, with an arm at the top, at the bottom, at both, and at
neither; the arm wide and thick enough that no size in the sweep can lose it.
Recorded against Windows:

    neither    65 cells, 36 disagree, 72 wrong pixels
    top arm    65 cells,  0 disagree
    foot arm   63 cells,  0 disagree
    both       64 cells,  0 disagree

An arm anywhere makes the cell exact. The first reading of that was that an arm
at the top must therefore rescue the bare bottom row nine rows away, and that the
rule could not be local. **That reading was wrong**, and it was wrong because the
two glyphs compared -- `A` and `g` -- differ in phase as well as in the arm. The
variants are laid out as `thin = THIN[i % 3]`, `phase = PHASE[(i / 3) % 3]`,
`which = (i / 9) % 4`, so a matched pair differs by exactly nine: `A` bare
against `X` armed, both a third of a pixel wide on the same phase.

The matched pair says the opposite. At sixteen pixels:

    A  (bare)      windows rows 3 to 11      ours rows 4 to 10
    X  (top arm)   windows rows 3 to 10      ours rows 3 to 10

`X`'s arm is row 3 and its post runs 4 to 11, and **row 11 is drawn by neither**.
Windows declines the bare bottom end exactly as we do. The arm does not reach it;
the rule is local after all, and every local reading of it still holds.

What is left is stranger and much more specific. With continuation at one end,
Windows declines the other end just as we do. With **no** continuation anywhere,
Windows draws both ends and we draw neither. The lists say the same thing from
the other side: `X`'s post rows are `on [6] off [6]`, a zero-length run rescued
under the stub check, and ours match Windows row for row. `A`'s post rows are
`on [6] off [6]` in ours as well -- but Windows fills nine rows, which a
zero-length run cannot do.

So for the wholly isolated post, our crossings and Windows' must differ, and for
the armed post they agree. The one structural difference between the two is the
box: `A` is `left 6, right 7`, a single column, and `X` is `left 6, right 10`.
That is the same shape of question as the collapsed box in y, which turned out to
matter, and it is where to look next.

### A glyph narrower than a sample gap is not asked about continuation

`cour-stubs` turns out to be exhaustive, and the four answers settle it. With the
stub check applied and with it skipped:

    stub check   neither   top arm   foot arm   both
    applied       36 bad     0 bad     0 bad    0 bad
    skipped        0 bad    35 bad    35 bad    0 bad

Neither setting is right for all four, and no reading of the check's terms can be,
because the two middle columns want it and the first wants it gone. `both` is
insensitive, as it should be: continuation at each end means the check passes
either way.

The bare post and the armed ones differ in the box and in nothing else. The bare
post is `left 6, right 7` and the armed ones `left 6, right 10` -- and the bare
post's box is a column only because the minimum makes it one. Rounded honestly it
collapses, exactly as the box in y collapses for a bar lying between two
scanlines, which was worth 704 pixels a few sections ago.

Skipping the stub check when the box would have collapsed in x is worth a great
deal more. `cour-bars` goes from 209 cells and 426 wrong pixels to **258 of 258
and none**; `cour-stubs` from 222 and 72 to **258 and none**; the fabricated set
from 6,763 of 7,308 cells and 1,185 wrong pixels to **7,250 and 85**. Four
fabrications still carry an error at all: `cour-no-instctrl` 32 pixels,
`cour-boxes` 30, `cour-widths` 20, `times-cvt0-fine` 3.

The reasoning behind it is that the stub check exists to suppress a short
protrusion off a main stroke, and it does that by demanding a crossing either
side of the row being rescued. A glyph that is nothing but the run has no main
stroke for anything to be a stub of, and the question is not meaningful; at the
first and last row of such a run there is nothing on one side and the check
declines, which is right for a stub and wrong for a whole glyph.

**This one is measured rather than read, and that should be said plainly.** The
gate in the shipped code at segment 42 0x0a69 is the scan kind, not the box, and
the counter's own guards at 0x0e60 and 0x0e8a make the vertical terms nought
outside the box rather than skipping the decision. So there is a rule here that
is right about every recorded cell in two fabrications built to isolate it and
wrong about nothing, and its mechanism has not been found in the binary. It is
the only rule in the rasteriser in that position, and it is the first place to
look if any of it stops holding.

The recorded letters do not move: thirty-three records and fifty-eight pixels,
96.1 per cent. Nothing in a real face is narrower than a sample column.

### Looking for the mechanism, and a second walk found instead

The rule of the previous section is measured and its mechanism is not located.
This is what was looked at and did not contain it.

The fill routine's bounds come straight off a structure -- `[bx+0xa]` and
`[bx+0xe]` for the box in x, `[bx+0xc]` and `[bx+0x10]` for the box in y, kept as
`boxLeft` and `boxRight - 1` -- with no test of one against the other anywhere in
the setup at 0x989 to 0x9f7. The horizontal pass runs rows from `boxBottom` to
`boxTop - 1` and the vertical pass columns from `boxLeft` to `boxRight - 1`, so a
box that has collapsed runs its pass zero times, but that governs which rows and
columns are visited and not whether the stub check is asked. Every use of the two
x bounds in the whole routine is a push into the crossing counter, the two
placement comparisons at 0x0ac5 and 0x0adb, or the loop bound at 0x0c7e. None of
them is a width test.

What the search did turn up is a correction. Segment 43's function at 0xd24 was
recorded here as `fsc_SetupScan`, on the strength of four values computed as
`ceil` onto the pixel grid and taken for a bounding box. They are not a box. At
0x1121 the code compares `[0x892]` with `[0x88e]` and branches away when they
differ, and at 0x112d it does the same for `[0x88c]` and `[0x890]` -- which is
exactly segment 42's `cmp ax,[0x1c0]` at 0x1512, a scan index against its stop.
So those four values are `xScan`, `yScan`, `xStop`, `yStop`, and **segment 43
carries a second element walk of its own**, with its own copy of the four-way
`SCANABOVE` and `SCANBELOW` setup.

That also withdraws the count in an earlier section, which said there was no
second scanline-index setup anywhere in the file. There is one, in segment 43; it
was missed because the pattern searched for required `add r16, +0x1f` and segment
43 writes `add ax, 0x1f`, and it was then written off as a box. The conclusion
that survived it -- that a curve is drawn as a polyline -- does not depend on the
count, having been settled by the flattener in segment 44 and by measurement.

Segment 42 remains the walk on our path: the scaler in segment 36 calls 42 at
0x42 and 0xf2a, and the only caller of segment 43 is segment 8, which is not on
this route. So the routines read here are the ones that run. Whether segment 43
answers the question the box asks is untested, and is the obvious next place.

### Segment 43 is the smart path, and it is dead here

The second walk does not answer the box question, and what it is worth is the
identification.

It carries no stub check. The whole segment has one comparison against two, at
0x0246, and it guards a far call through a table with a halved count -- a
banding or sorting decision, not a dropout. Nothing in it counts crossings on
either side of a row.

Nor is it on our path. Every far reference into either segment, taken from the
relocation chains, is this:

    seg  8 -> seg 43   call 43:0x292
    seg 36 -> seg 42   call 42:0x42
    seg 36 -> seg 42   call 42:0xf2a
    seg 48 -> seg 43   five data references at 0x8a8 to 0x8b8

The scaler in segment 36 calls only segment 42. Segment 43 is reached from
segment 8 and from five words in DGROUP four bytes apart, which are far pointers
whose offsets survive in the fixup chain as 0x14ca, 0x1548, 0x15c6, 0x1672 and
0x1672 -- five entries with the last two identical, the same shape of table as
the dispatch in segment 47 where the unused slot repeats its neighbour.

Five callbacks into a segment with its own element walk is `fsc_SetupCallBacks`
and the `pfnHCallBack` and `pfnVCallBack` arrays, which exist so that **smart**
dropout control can ask a spline where it really crosses a scanline. That is why
the segment needs an element walk of its own: the smart path records an element
tag beside each crossing, which the simple path does not. All four installed
faces report `SCANTYPE` 1, simple dropout, so none of it runs.

So the lead is closed rather than followed. The mechanism behind the narrow-box
rule is not in segment 43, because segment 43 is not executed for any glyph
measured here.

### The thirty-three letters are one glyph program at a time

Everything the rasteriser gained this session -- the flattening, the collapsed box
in y, the narrow-box rule -- moved none of them. Thirty-three records and
fifty-eight pixels before and after, which is what `times-bare` said to expect:
these are the interpreter.

They come from twenty-three distinct glyph programs, and the distribution is
lopsided. Times New Roman's `8` fails at five of the seven sizes recorded, 18 of
the 58 pixels in one glyph; Courier New's `t` at three; Arial's `7`, Times' `2`
and `3` and Courier's `g` at two each. The remaining seventeen fail at exactly
one size, which is the signature of a rounding that lands the wrong side of a
boundary rather than of a rule being wrong.

Two things checked and cleared. **No opcode is exclusive to the failures.** Every
instruction used by a failing glyph's program is also used by a passing one, over
all three faces, so this is not an unimplemented instruction or one that is
wholly wrong -- it is an instruction that is right most of the time. And the
hinting is plainly working: Times' `8` at sixteen pixels comes out of the
interpreter with its stems at exactly 1, 2, 6 and 7 and its baseline at exactly 0. What is not on the grid is the waist, which is where the wrong pixels are.

That is as far as inference goes. The letters cannot be pushed further from this
side, because nothing here says where Windows put its points -- only where the
ink ended up, which is two roundings downstream. The project already has the
instrument for that: the readout channel, where a glyph program moves the advance
phantom onto a point of interest and `GetTextExtent` reports it, at magnify 64
reading the stored coordinate in sixty-fourths directly. That is what settled the
side bearing split and the separate scaling of coordinate and bearing, and it is
what the waist of an `8` wants now -- a fabrication that reports the waist points
of Times' `8` after hinting, at the five sizes where it fails.

### Two ways of asking which instruction, and neither answers

Times New Roman's `8` is wrong by eighteen pixels across the five sizes it fails
at, and both cheap ways of localising that were tried before building anything.

**Truncating the program.** Our interpreter runs the glyph's own bytecode, so it
can be stopped early and the result compared against the recording. Cut anywhere
before byte 250 the score is 84 wrong pixels, which is what the unhinted outline
gives. From 260 it improves -- 77, 68, 58, then 23 by byte 290 -- and the last
seventy bytes take it to 18. Swept two bytes at a time across the tail, **no cut
beats the full program**. So we execute the right instructions and stop in the
right place; the difference is inside one of them rather than in which of them
run. That is worth knowing: it rules out a missing terminator, an unbalanced
conditional, and an instruction we should be skipping.

**Nudging the points.** If one point were in the wrong place, moving it should
find the right one. Displacing each of the four points that bound the waist --
0 and 12 on the outer contour, 26 at the foot of the upper counter, 39 at the
head of the lower one -- by up to half a pixel in y, in eighths of a
sixty-fourth, gives a best of 16 against the baseline of 18, from point 0 moved
between a sixteenth and an eighth of a pixel up. Every other displacement is 17
or worse. **No single point fixes it.**

Together those two say the shape of the thing: several points of the waist are
each slightly wrong, by less than the eighth of a pixel that would show up as a
single culprit, and they are wrong because an instruction that is right
everywhere else rounds differently here. That is a graphics-state or an
interpolation difference rather than a missing feature, which fits the earlier
finding that no opcode is exclusive to the failures.

It also means the readout channel is still the instrument, and using it on `8`
costs more than it did on the letters it has been used on before: the `hinting`
probe sweeps `w`, `o` and `W` for Times New Roman regular, so reaching `8`
through it needs either the `cmap` pointed at glyph 27 or `8`'s three contours
copied into one of those slots, and `setGlyph` writes a single contour. That is
the next piece of work and it is a real one.

### A fourth sweep, and why the readout will not fit on an eight

The `hinting` probe now asks about Times New Roman regular's `8` as well as its
`w`, `o` and `W` -- one more pass of the same loop over cell heights 8 to 110,
103 records. Recorded, it brings the probe to 1,030 records, and **all 1,030
agree**, the new ones included.

That is worth having on its own. Our `8` reports the same advance as Windows at
every one of the 103 sizes, which says the phantom points, the advance
arithmetic and everything the width depends on are right for this glyph. The
eighteen wrong pixels are entirely in the interior.

The sweep exists so a fabrication can make the `8` report one of its own points,
and that is where this stops. `reporter` makes room for the readout by cutting
the tail off the glyph's program, and the cut has to be somewhere the program is
statically balanced and to leave the point being read where the full program
would have left it. For Times' `8` the first condition is easy -- every offset
from 339 to 361 is at depth nought -- and the second cannot be met. Measured
across thirty-four sizes, against the full program:

    cut 345   141 disturbed readings    cut 355    72
    cut 349    80                       cut 357    28
    cut 351    72                       cut 359    19
    cut 353    72                       cut 361     0

Only cutting the last byte disturbs nothing, and a readout is eleven bytes at the
resolution the question needs -- seven if the magnification is dropped, which
would report the waist in whole pixels and answer nothing. Points 26 and 39, the
two that bound the waist, are disturbed at every cut with room for it.

So the glyph has to grow rather than be trimmed, which means moving its entry to
the end of `glyf` and rewriting `loca` -- `setGlyph` writes multiple contours
happily but only into the room the glyph already has. That is a bounded addition
to `fabricate.mjs` and it is the next piece of work.

### Growing a glyph, and the first sight of Windows' waist

`growGlyphProgram` is the piece that was missing. `setGlyphProgram` writes into
the room `loca` already gives a glyph, which is exactly what the glyph's own
program fills, so it can shorten a program or trade its tail for a readout but
not add one. This rebuilds the font instead: `glyf` grows, `loca` is rewritten
from that glyph onwards, every table after `glyf` moves, and the directory is
laid out again with each table on a four byte boundary. It returns a new buffer
rather than editing in place, so the driver now writes whatever an edit hands
back.

On top of it, `heightReporter` keeps a letter's outline and its **whole**
program and appends a readout of one point's height. Reading a height and
reporting it needs the vectors twice: `GC` measures along the projection vector,
so they go up y to read the point, and the advance is a distance in x, so they
go back along x before `SCFS` moves the phantom. Checked in our own interpreter
first, at five sizes, the outline is untouched and the advance comes back as
exactly the point's y in sixty-fourths.

Recorded, the answers divide in two. Times New Roman carries an `hdmx`, so a
size the table covers is answered from cache without the program running, and
those records come back as the ordinary advance -- five or six or eight pixels
rather than four hundred. What is left is the sizes the table does not cover,
and there Windows finally says where it put the point:

    point 26, the foot of the upper counter     point 39, the head of the lower
    ppem  9   windows 235  ours 223  +12/64     ppem  9   windows 190  ours 182   +8/64
    ppem 10   windows 245  ours 247   -2/64     ppem 10   windows 200  ours 202   -2/64
    ppem 14   windows 357  ours 346  +11/64     ppem 14   windows 290  ours 282   +8/64
    ppem 18   windows 433  ours 444  -11/64     ppem 18   windows 355  ours 363   -8/64
    ppem 20   windows 457  ours 462   -5/64     ppem 20   windows 432  ours 435   -3/64
                                                ppem 22   windows 445  ours 443   +2/64
                                                ppem 23   windows 455  ours 463   -8/64

Every readable size differs, by between two and twelve sixty-fourths, and the
sign changes with the size. The two points move together -- where one is high
the other is high -- which is why the earlier nudge search found no single point
to blame.

One thing that is already ruled out by this. At fourteen pixels our two points
are 346 and 282, exactly 64 apart: a waist of exactly one pixel. Windows' are
357 and 290, which is 67 -- so **Windows is not snapping the waist to a whole
pixel and we are**. Whatever the difference is, it is not that we round too
little.

### What moves the two points together is `IP`, and it extrapolates

The readout said the two waist points move together; instrumenting the
interpreter says why. Both are **touched** before `IUP` runs -- the program moves
eight points in y directly, 0, 6, 12, 19, 26, 32, 39 and 45 -- so neither is
interpolated by `IUP` at all, and both are moved by the same instruction:
opcode 0x39, `IP`, with the same `rp1` of 23 and `rp2` of 16.

And our `IP` moved them by nothing. At fourteen pixels the two references are 13
design units apart and 6 sixty-fourths apart, and point 26 sits 481 design units
past the first, which puts it far outside them. Our code held its distance from
the nearer reference and carried it along rigidly, giving 346. On the line
through the two references it would be

    135 + 481 * 6 / 13  =  357

which is what Windows reports, to the sixty-fourth. Point 39, 336 units past the
first, gives `135 + 336 * 6 / 13` = 290, and Windows reports 290.

So `IP` extrapolates. The refusal to was deliberate and is now withdrawn: it was
put in because `cvt[2]` in Times New Roman came out a thirty-second of a pixel
high when extrapolated, which was enough to round a `W`'s cap height the wrong
way. That reading was of the ink, two roundings downstream of the decision, and
it blamed the wrong step. The `font` probe still agrees on all 2,655 records with
the extrapolation restored, so whatever the `W` was, it was not this.

    waist readings differing      12 of 12   ->   0 of 12
    recorded letters              33 records, 58 px  ->  25 records, 35 px
    outline glyphs agreeing       96.1%      ->   97.0%
    fabricated cells              7,250 / 85 wrong  ->  7,254 / 79 wrong

Every readable reading of both waist points now matches Windows exactly, where
before not one of them did. The degenerate case still shifts rather than scales:
two references at the same original position give no ratio to scale by.

### `IUP` was truncating to pay for `IP`, and stops

With `IP` fixed, the first thing worth re-asking is what else was fitted while it
was wrong. `IUP` interpolates an untouched point between the two touched ones
that bracket it, and ours truncated the result. The case recorded for that was
that rounding cost six of the 846 recorded glyphs, visible as diagonal edges
drawn a column across from where Windows draws them.

That measurement was taken while `IP` was carrying points outside its references
rigidly instead of extrapolating them, so a bias in one interpolation was being
paid for by a bias in the other. Asked again:

    truncate   25 records, 35 px   7,254 cells, 79 wrong   97.0%
    round      20 records, 28 px   7,255 cells, 76 wrong   97.6%
    floor      identical to truncate on every fixture

Rounding now wins on both, and `font`, `hinting` and `text` stay at 100 per cent
either way. So the truncation is gone, and with it the last rule in the
interpreter that existed only because a count came out lower with it.

    recorded letters      33 records, 58 px  ->  20 records, 28 px
    outline glyphs        96.1%  ->  97.6%
    fabricated cells      7,250 / 85 wrong   ->  7,255 / 76 wrong

Two things fell out of the `8` between them: `IP` extrapolating, and `IUP`
rounding. Times New Roman's `8` is gone from the list at all five sizes, and so
is Courier New's `t` at all three.

What is left is twenty records over twenty distinct glyphs, none failing at more
than two sizes and fourteen of them by a single pixel. There is no glyph left to
attack the way the `8` was attacked -- the concentration that made it worth
building a readout for is gone, and what remains is the thin spread that a
sixty-fourth either way produces at one size and not the next.

The general lesson is worth keeping, since it has now cost twice: **a rule fitted
to ink is fitted to every mistake upstream of the ink as well**, and it holds
only until one of them is found. Both of these were justified by a count, both
counts were real, and both were measuring something else.

### Re-asking the rest, which hold

Two rules in the interpreter turned out to be fitted to an error upstream of
them. The rest were asked again on the same footing, and none moved.

**The scaling of a control value.** `scaleToPixels` rounds a half upward and
floors, on a measurement of 12 wrong advances against `hdmx` out of 22,056.
Swept four ways -- as it stands, half away from zero, truncating, and
`Math.round` -- it gives 826 recorded glyphs of 846 as it stands, 822 rounding
half away from zero, and 752 truncating; `Math.round` is identical to the
present rule on every fixture, since the two differ only on negatives and no
fixture has one that lands on a half. The rule stands, and now stands on a wider
measurement than the one it was written for.

**`DIV` truncating where `MUL` rounds.** This is not a fitted rule at all. The
format specifies it: `MUL` rounds its result to the nearest sixty-fourth and
`DIV` throws the remainder away. It was left alone.

**Every rounding in the movement path.** Eleven sites -- the advance, the round
period, both axes of `SHP`, both of `SHPIX`, both of `MSIRP`, the unit vector,
`DELTA`, and `IUP` -- each flipped to truncate and to floor, twenty-two variants
in all. Twenty are neutral to the pixel and two are worse: flooring the unit
vector costs a record, and either flip of `IUP` costs five records and seven
pixels, which is the change of the previous section being undone. That most of
them are neutral is itself worth knowing: those sites never see a fraction,
because what reaches them is already on the grid.

So the sweep is clean and the two that were wrong are the two that were found.
Twenty records over twenty glyphs remain, none at more than two sizes and
fourteen of them a single pixel, and nothing in the interpreter's arithmetic is
now carrying a rule chosen for a reason that no longer holds.

### Arial's seven, read directly, and a fix that is not the obvious one

The seven is the largest single contributor left -- four pixels over two cell
heights -- and the failure is one shape: at 18 and at 20 the diagonal steps from
one column to the next **one row early**, ink at column 5 of row 11 where Windows
has column 6. Every other row of both agrees.

Its diagonal control points, 5 on the right and 11 on the left, are untouched in
both axes and placed by `IUP`. So the probe gained a fifth sweep, Arial regular's
`7`, and two more fabrications read those points' **x** -- the reporter now takes
an axis, since a diagonal's error is a width and not a height.

Two things had to be got out of the way first. `hdmx` answers a covered size
without running the program, and where Times New Roman's table leaves gaps
Arial's covers every size in the sweep, so the first recording read nothing at
all. `LTSH` does the same from the other side: above the threshold it names, the
advance is taken to be linear and the program is not run either. `dropTable`
renames a tag so the loader does not find it, which keeps every offset in the
directory valid, and with both gone the seven reads at 35 sizes.

The reading is exact about where the fault is. **Point 11's x is one
sixty-fourth high at ppem 16, 17 and 18** -- and cell heights 18 and 20 are ppem
16 and 17, which are precisely the two that fail. Point 5 agrees at both. So four
wrong pixels come down to one sixty-fourth on one control point.

The arithmetic is visible too. At ppem 16, `IUP` places point 11 from a scaled
original of 218 between anchors at 151 and 408, into a span from 192 to 448:
`192 + 67 * 256 / 257` is 258.739, and we round it to 259 where Windows says 258.
At ppem 19 the same calculation gives 274.885 and Windows says 275, which is the
rounding we do. Neither truncating nor rounding fits both.

In **design** units it fits both, and every other size: the anchors are 302 and
815 and the point is 435, so the ratio is 133/513 and the answer is 258.37 at one
size and 274.96 at the other -- 258 and 275, which is Windows twice. That is the
same correction `IP` needed, for the same reason: a ratio taken between two
numbers already quantised to sixty-fourths has lost the precision the ratio
needed, and 815 design units scale to 407.5 and are kept as 408.

**And it cannot simply be applied.** Switching `IUP` to design units takes the
recorded glyphs from 826 of 846 down to 742. It is right about this glyph and
wrong about eighty-four others, so the rule is not "interpolate in design units"
-- something narrower is going on, and what has been measured here does not say
what. The four readouts are kept as a test with their current disagreement counts
as ceilings, so whatever explains it will show up as those numbers falling.

### Two rules that reproduce the reading and ruin the corpus

The seven's point 11 is one sixty-fourth high at three sizes, and two different
changes each put it exactly where Windows puts it at every readable size. Both
make everything else worse.

**Interpolating in design units.** Anchors 302 and 815, point 435, ratio 133/513:
258.37 and 274.96, which round to Windows' 258 and 275. Recorded glyphs go from
826 of 846 to **742**, and the glyphs that break do not break subtly -- Times New
Roman's `W` at eight sizes of eight, Courier New's `g` at eight, and a dozen more
at six of seven. That is not a rounding tipping over; it is the wrong
calculation.

**Truncating the outline as it is scaled.** If the scaled originals came out by
truncation rather than rounding, point 13 would be 407 rather than 408 and point
11 would be 217 rather than 218, and the ratio 66/256 gives exactly 258 at one
size and 83/304 exactly 275 at the other -- both Windows, from the quantised
frame the format actually interpolates in. Recorded glyphs go from 826 to **807**.

Neither is a subtlety of `unscaledX` being wrong, which was checked: the array is
filled with design units for every glyph point, and the two places that overwrite
it with scaled values are both guarded to the twilight zone, where a point has no
design coordinates to lose.

So a rule that reproduces Windows exactly at a measured point makes the corpus
worse, which is the same shape as `IP` and `IUP` had before either was fixed:
**a compensating error somewhere else**. The difference is that with `IP` the pair
was found and here it is not. What that argues for is more readings rather than
more reasoning -- the glyphs that break under design units are named above and
are the ones to read next, since whatever they say about their own points will
say what the other half of the pair is.

### `IUP` interpolates in the scaled frame, and the seven's anchor is right

Two more readouts, and between them they close a hypothesis and narrow what is
left to one step.

**Times New Roman's `W`, point 23.** The two rules disagree about it by a third
of a pixel rather than a sixty-fourth -- 170 against 148 at sixteen pixels --
which makes it a discriminator rather than a coin toss. Read at 29 sizes,
**the scaled originals are right at 29 and design units at 1**. So `IUP`
interpolates in the quantised frame, our implementation has it right, and the
design-unit idea is finished: it fitted one point of one glyph and is simply the
wrong calculation.

**Arial's `7`, point 13.** If the seven's diagonal inherited its error from the
anchor it interpolates towards, that would explain everything without any rule
changing. It does not: point 13 reads 448 at sixteen, seventeen and eighteen
pixels and **agrees at all ten readable sizes**. The anchor is exact, and so is
point 5 on the other diagonal.

So the seven's point 11 is wrong with correct inputs, in the frame now known to
be correct. At sixteen pixels `IUP` places it from an original of 218 between
151 and 408, into a span of 192 to 448: 258.739, and Windows says 258. At
nineteen the same arithmetic gives 274.885 and Windows says 275, which is what
we already give. One wants the fraction discarded and the other wants it carried,
from the same rule, with every input verified against Windows.

The remaining explanation is that Windows' _scaled originals_ are not ours: if
point 13's were 407 rather than 408 and point 11's 217 rather than 218 -- both
being exact halves that we round up and truncation would round down -- the ratio
is 66/256, the answer is 258, and nineteen pixels still gives 275. Truncating the
outline as it is scaled was tried and costs nineteen recorded glyphs, but that
change moves the current positions as well as the originals, and the current
positions are measured right. Splitting the two is the next thing to try, and it
is the first hypothesis in a while that has not already been refuted.

### `IUP` works in two frames at once

The interpreter's own C settles it, and the answer is one neither measurement
could have reached, because it is not a choice between the two frames -- it is
both, in different places.

The reference keeps three arrays per axis: `x`, the hinted position; `ox`, the
scaled original; and `oox`, the original original, which is the glyph's design
coordinate. `IUP` binds `alOrig` to `oox` for a simple glyph and to `ox` only
for a composite, and then:

- **which anchor is the low one** is decided in `alOrig`, and the scaled bounds
  follow that choice rather than being sorted again;
- **whether a point lies between the anchors** is decided in `ox`, the scaled
  frame, not in `alOrig`;
- **a point between them** is placed by a ratio taken entirely in `alOrig` --
  `SHORTMUL(orig - origMin, hintedDelta) + origDelta/2, all over origDelta`, so
  the division rounds by adding half the divisor and truncating;
- **a point outside them** keeps its scaled position and moves by however far
  the nearer anchor moved. It is not extrapolated. That is `IP`'s rule and not
  this one, and the two instructions genuinely differ;
- **two anchors at the same design position** shift the run by the low anchor's
  movement, added to the hinted position rather than the scaled one.

Ours used the scaled frame for all of it. That is why design units fitted Arial's
seven and ruined Times New Roman's `W`: the seven wanted the ratio changed and
the `W` wanted the between-test left alone, and no single frame does both.

Checked by hand before it was written: at sixteen pixels the seven's point 11 has
design 435 between anchors at 302 and 815, hinted 192 to 448, so
`(133 * 256 + 256) / 513` is 66 and the answer is 258, which is Windows. At
nineteen the same gives 83 and 275, which is Windows again.

    recorded outline glyphs   826 of 846  ->  844 of 846      99.8%
    recorded letters          20 records, 28 px  ->  2 records, 2 px
    fabricated cells          7,255 / 76 wrong   ->  7,260 / 70 wrong
    readouts differing        17 of 6 readouts   ->  none, all six exact

`font`, `hinting` and `text` stay at 100 per cent. All six readouts -- both waist
points of the `8`, both diagonal controls and the anchor of the `7`, and the
interpolated point of the `W` -- now match Windows at every readable size.

What is left of the letters is two pixels: Times New Roman's `y` at twelve and
Courier New's `g` at ten, one each.

### The last two pixels are the outline, not the walk

Two records of 846 disagree, by a pixel each, and they are the same shape twice:

    Times New Roman `y` at twelve, row 11    windows  .##     ours  .###
    Courier New `g` at ten, row 7            windows  ....#   ours  ...##

The bottom row of a descender's tail, one pixel wider in ours than in Windows.
Neither is a dropout: the lists give `on [1] off [4]` for the `y` and
`on [3] off [5]` for the `g`, both ordinary runs that the fill draws. Our run is
a column too wide, at the right end of one and the left end of the other.

The walk is not what does it. `WB_ANALYTIC` draws the same glyph by solving
where the outline crosses each scanline rather than by walking it, and the two
methods **disagree with Windows in exactly the same pixels**. Two independent
fillers given the same outline both differ from Windows the same way, which says
the outline is what differs.

Both glyphs are hinted -- `hinted=true` on each -- though Courier New's `g` at
eight pixels per em comes out of the interpreter with its tail exactly where
plain scaling would have put it, since that is the size at which `INSTCTRL`
turns grid-fitting off. So one of the two is a scaled outline and the other a
fitted one, and both are a sixty-fourth from where Windows has them: a crossing
at 224 rather than 225 in the `g` puts the run's start at column 3 rather than 4,
which is the whole of the difference.

Reaching further needs a readout, and neither character is one the `hinting`
probe sweeps. Courier New is the better host -- it carries no `hdmx` at all, so
every size runs the program -- and a sweep of its `g` plus one fabrication would
say where the tail's points really are. That is three recordings for one pixel,
which is the honest price at this point and is why it is written down rather
than done.

### The Courier pixel is out of the readout's reach, by construction

The probe gained a sixth sweep, Courier New's `g`, and a fabrication was built to
report the leftmost point of its descender tail. Windows answered every size with
the ordinary advance -- five, six, seven pixels -- rather than the point.

The reason is the size itself. Courier New's `prep` sets `INSTCTRL` below nine
pixels per em, and the failing record is at eight: `instructionControl` reads 1
there and 0 from nine upwards. **No glyph program runs at that size**, in Windows
or in ours, and a readout is a glyph program. The channel cannot be pointed at
this pixel; it is not that the fabrication is wrong.

Which settles what the pixel is. With no program running, the outline is the
scaled one and nothing else, so the difference is in the scaling and not in the
hinting -- and it is a tie. The tail's leftmost point is 346 design units, which
at eight pixels per em is `346 * 512 / 2048` exactly 86.5 sixty-fourths. We round
a half away from zero and get 87; a crossing at 87 rather than 86 is what puts
the run's start a column left of Windows'.

Rounding that half toward zero instead is worse everywhere else: 838 recorded
glyphs of 846 against 844. So the tie rule stands and the pixel stays, and what
it needs is not a different rounding but an account of how Windows scales an
outline that lands exactly between two sixty-fourths -- which the interpreter's
own source will not answer, since at this size the interpreter never runs.

The sweep is kept regardless. The `hinting` probe is now 1,236 records over six
characters and **agrees on all of them**.

### The `y`'s outline is right, which withdraws the section before last

Times New Roman's `y` is hinted at the size that fails, so the readout reaches
it. Five fabrications were built and recorded, over the four points of the tail's
curve -- 26 on-curve, 27 and 28 the controls, 29 the foot -- reading x, and one
more reading the foot's **height**.

**All five agree with Windows at every readable size**, the failing one included.
Point 26 reads at 21 sizes and point 27 at 29, both covering ten pixels per em
where the pixel goes wrong; the other three cover it or start just above it. Not
one reading differs by a sixty-fourth.

So the outline at the tail is right, in both axes, and the pixel is still wrong.
That withdraws what was concluded two sections ago. `WB_ANALYTIC` drawing the
same wrong pixel was read as saying the outline differed, on the argument that
two independent fillers agreeing against Windows had to be agreeing about their
input. They do agree about their input -- and now the input is measured correct,
so what they share is not the outline but everything between it and the ink:
the contours are turned into segments and placed into device space by one path
before either filler sees them.

That is a much smaller place to look, and a different one. The remaining
candidates are the mapping into device coordinates and the segment construction,
both of which run once and feed both fillers, and neither of which any readout
can reach -- a readout reports a point in the glyph's own frame, which is
precisely the frame now known to be right.

Ten readouts are now kept as a test, all at nought: both waist points of the `8`,
both diagonal controls and the anchor of the `7`, the interpolated point of the
`W`, and the five of the `y`.

### A half goes upward, not outward

The place both fillers share turned out to be one line of it.

A hinted glyph arrives on the grid already, so the only fractions reaching the
device mapping are the points implied between two consecutive off-curve
controls, which are exact halves of a sixty-fourth. Rounding those _away from
zero_ -- `Math.sign(value) * Math.round(Math.abs(value) * 64)` -- makes which way
a half goes depend on which side of the baseline it falls, because `place`
negates y afterwards. The same shape above and below the baseline rounds
opposite ways.

Rounding them upward instead, one direction throughout, is what agrees. Times New
Roman's `y` at twelve pixels has a tail built from three pairs of consecutive
controls, and it is the glyph that says so:

    away from zero    844 of 846 recorded glyphs
    upward            845 of 846
    toward zero       826, either way of writing it

`font`, `hinting` and `text` stay at 100 per cent and the fabricated set is
unchanged to the pixel, 7,260 of 7,308 cells and 70 wrong. So the `y` is fixed
and nothing else moved.

Two things were ruled out on the way, both by measurement. Rounding the implied
midpoint in the glyph's own frame rather than in device space is much worse --
flooring gives 440 recorded glyphs, rounding either way 680, against 844 for
leaving the exact half to be resolved later. And the tie is genuinely in the
mapping rather than in the outline: the five readouts of the `y`'s tail agree
with Windows at every readable size, so the half being rounded is one our own
arithmetic creates, not one the interpreter hands us.

**One pixel is left in 846 recorded glyphs.** It is Courier New's `g` at ten,
where `INSTCTRL` means no glyph program runs, the outline is the scaled one, and
the tail's leftmost point lands on exactly 86.5 sixty-fourths.

### The same half, in the other place

The last pixel is the same mistake as the one before it, one step earlier.

`toPixels` scaled an outline with `mulDiv`, which takes the sign out and puts it
back, so a half rounded **outward**. A coordinate is not a distance: an outline
has points either side of the baseline and of the origin, and rounding them
outward makes which way a half goes depend on which side it falls, so the same
shape mirrored is not the same shape scaled. Rounding upward instead, one
direction throughout:

    outward        845 of 846 recorded glyphs
    upward         846 of 846
    toward zero    839
    downward       838

Courier New's `g` at ten pixels per em is the glyph that says so. Its descender
tail begins at 346 design units, which at that size is exactly 86.5
sixty-fourths, and its glyph program does not run -- `INSTCTRL` sees to that --
so nothing downstream can put the half back. The device mapping wanted the same
correction for the same reason a commit earlier, and between them they are the
whole of the difference.

    glyph   846 of 846 records agree      100.0%
    font    2,655 of 2,655                100.0%
    hinting 1,339 of 1,339                100.0%
    text    55 of 55                      100.0%

`KNOWN_GAPS` is now empty. It held one entry for a long time -- `glyph`, the only
probe that records pixels and the only one that could not be satisfied by reading
a table -- and the conformance suite fails if an entry there starts agreeing, so
removing it is the suite's own account of the gap closing rather than ours.

The fabricated set stands at 7,260 of 7,308 cells and 70 wrong pixels, all of
them in four hinting fabrications built to ask questions the recorded letters no
longer answer.

### The seventy fabricated pixels are three things, not seventy

With the recorded letters at 846 of 846, what is left is 70 pixels over four
fabrications, and they divide cleanly.

**Fifty of them are one mechanism.** `cour-boxes` and `cour-widths` both put a
sub-pixel bar in a glyph with a second contour below it, and both fail the same
way: a hole in the middle of a column of ink. Courier New's `k` at ten pixels per
em is the case -- Windows draws rows 1 to 7 unbroken and we draw 1 to 5 and 7,
missing 6. The lists say why. Rows 1 to 5 carry the bar and row 7 the box, each
as a zero-length run that the narrow-box rule rescues; **row 6 has no crossings
at all**, because it falls in the gap between the two contours where neither is
present. Filling it wants a vertical rescue, and the vertical lists are empty:
the glyph is narrower than a sample column, so its horizontal edges cross no
vertical scanline and contribute nothing to rescue from. Where Windows finds the
ink is not established.

**Seventeen are a fabrication disowning its own font.** `cour-no-instctrl`
rewrites `prep` to clear `INSTCTRL` where Courier New sets it, so hinting runs at
eight pixels per em, the size the font switches it off for. Windows draws
nothing at all for the `w` and we draw a sixteen-pixel blob, and our box comes
out with a top of -22 -- twenty-two rows above the cell. Both are what a program
does when run at a size it was written to refuse; that they differ is not
surprising and says little about anything else.

**Three are `times-cvt0-fine`**, one cell at sixteen pixels, which has not been
looked at.

So the honest count is that one mechanism accounts for five sevenths of what
remains, and it is a question about glyphs a sample column wide with a gap in
them -- a shape no letter has, which is why it survives a recorded corpus that
now agrees everywhere.

### The cvt readout agrees, and its odd cell is a clip

`times-cvt0-fine` is a readout, not a picture: six characters draw a bar whose
edge sits `(cvt[0] - base)` pixels from the baseline, with the base stepped eight
sixty-fourths at a time so that between them they bracket the value. Magnified
sixty-four times, one row of bar is one sixty-fourth of control value.

Five of the six cells at sixteen pixels agree, and two of those are readings
rather than blanks: base 632 puts the bar on row 4 and base 640 on row 12, in
Windows and in ours alike. **So the control value agrees**, which is what the
fabrication was built to ask -- it was made to settle whether Windows held
something three sixty-fourths higher than our 622, and it does not.

The sixth cell is base 648, where we draw a bar on row 20 and Windows draws
nothing. All six glyphs declare the same bounding box in `glyf`, `0,0` to
`400,40` -- forty font units, a third of a pixel at this size -- and all six
programs move their points far outside it. What separates them is only how far:
row 4 and row 12 are drawn by both, row 20 by us alone. So Windows is clipping
the glyph to something derived from the box it declares, and we bound the bitmap
by where the points actually went.

That is a real difference and it is not being acted on. Every glyph in the
recorded corpus stays inside its declared box, `cour-lies` already covers the
other direction -- a header claiming more than the outline uses, which changes
nothing -- and taking the box from the header instead would put every hinted
glyph whose program nudges a point past its own `yMax` at risk for three pixels
in a synthetic one. It is written down as the account of those three pixels.

That completes the seventy: fifty are the gap in a sub-pixel glyph, seventeen are
a fabrication running hinting at a size its font disowns, and three are a bar
drawn outside the box it declared.

### The gap in a sub-pixel glyph: one hypothesis refuted, one fitted

Two things were tried on the fifty, and the honest outcome is that the one with a
mechanism is wrong and the one that works has none.

**The mechanism.** If Windows inks the gap it must have a crossing there, and the
only candidate is a vertical entry from the bar's bottom edge -- a horizontal
edge too short to cross a column, which our `calcLine` drops because `xSteps` is
nought. Emitting one entry at the column such an edge sits in would give the gap
a run to be rescued from. It is wrong: the recorded glyphs fall from 846 of 846
to 823, and the fabricated set from 70 wrong pixels to 109. Taking the entry at
the other end of the step is no better, 831 and 107. So a sub-pixel horizontal
edge really does contribute nothing, and the gap is not fed that way.

**The fitted rule.** Filling every column of a glyph narrower than a sample
column from its topmost ink to its bottommost fixes `cour-widths` outright, 240
cells to 258 with nothing wrong, and takes `cour-boxes` from 231 cells and 30
wrong pixels to 258 and 7. The fabricated set goes from 7,260 of 7,308 cells and
70 wrong to 7,298 and 27, no fixture is worse, and the recorded corpus stays at
846 of 846.

It is not adopted. The narrow-box rule earlier in this file is also measured
rather than read, but `cour-stubs` forced it: four variants, an exhaustive truth
table, and no other rule fits all four. Nothing forces this one. "Fill the
column" is one of many rules that would close these particular gaps, and the
recordings do not distinguish it from "fill a gap of one row", or "fill a gap
narrower than the ink either side of it", or several others. Adopting the first
rule that fits is how `IUP`'s truncation and `IP`'s refusal to extrapolate both
got in, and both were wrong for years of commits.

What would settle it is a fabrication rather than an argument: a one-column glyph
with a deliberately large gap, swept from one row to several. If Windows fills a
gap of any size the rule is right; if it stops somewhere there is a threshold to
find, and the rule as written is wrong about everything past it.

### Sweeping the gap, which finds a great deal more of it

`cour-gaps` is the fabrication the previous section asked for: one sub-pixel bar
cut into two pieces with the gap between them swept from a quarter of a pixel to
six, at three phases. It was built to decide between "fill the column" and a
threshold. It answers something better and something worse.

**Better:** the direction is unanimous. Of the 141 cells that disagree, **we draw
less in 141 and more in none**. Windows never leaves a hole where we fill one.
And it fills large gaps outright -- Courier New's `W` at sixteen has a gap of 5.7
pixels and Windows draws the column solid from row 0 to row 11, where we draw 0
to 3 and 9 to 11. A threshold on gap size is not what is happening.

**Worse:** we are wrong far more often than the two fabrications that prompted
this suggested. `cour-gaps` scores 117 of 258 cells and 587 wrong pixels, which
takes the fabricated set from 7,260 of 7,308 cells and 70 wrong to 7,377 of 7,566
and 657. The fifty pixels of `cour-boxes` and `cour-widths` were the visible
corner of something with six hundred in it, and the recorded letters -- still 846
of 846 -- could never have shown it, because no letter is a column wide with a
hole in it.

So "fill the column" is now much better supported than it was: unanimous in
direction, and holding at gaps far too large for any threshold reading. It is
still not adopted, because Windows does leave some holes in this fixture and a
rule that always fills cannot be right about those, and because what separates
them has not been measured. The fixture is in the ratchet at its present numbers,
which is what makes the next attempt legible.

### The phase, not the gap, and the rule goes in

The sweep separates them, and it is not the size of the hole.

At thirteen pixels per em Windows fills a gap of 5.69 pixels and leaves one of
2.44 open. No threshold reads that. What separates them is the phase: the bar at
phase 0 spans 3.81 to 4.06 pixels and lies between two sample columns, and the
bar at phase 85 spans 4.35 to 4.60 and contains one. A bar containing a column
has real crossings, is drawn by the fill in the ordinary way, and keeps its gap.
A bar containing none has nothing but zero-length runs -- and Windows draws it as
a solid column from end to end.

That is the same condition the stub check is already exempted under, so the rule
is written as the other half of it: **a glyph narrower than a sample column is
drawn as one run per column.**

    cour-gaps        117 of 258 cells, 587 wrong  ->  244 of 258, 102 wrong
    fabricated set   7,377 of 7,566, 657 wrong    ->  7,542 of 7,566, 129 wrong
    recorded glyphs  846 of 846                   ->  846 of 846

Two things put this past the objection that stopped it being adopted before. The
direction is unanimous across all 258 cells -- there is not one where Windows
leaves a hole we fill, before the rule or after, so a rule that fills too eagerly
would have shown as the opposite sign and did not. And the discriminator is
measured rather than chosen: the phase decides, the sweep varies it, and the
cells divide exactly along it.

The fourteen left are one shape and one direction: the largest gaps at the
smallest size, where the upper piece leaves the cell and Windows still draws more
of it than we do. That is a question about what reaches the bitmap, and it is the
same question `times-cvt0-fine` asks from the other side -- there we draw a bar
Windows clips, here we lose one Windows keeps.

### The run spans the box, not the ink

The fourteen that were left had one cause and it is worth having: the run in a
sub-pixel column covers the **box**, not the lit pixels between which it was
being drawn.

Courier New's `o` at ten pixels per em is the case. Its crossings are on rows -2,
-1, 4 and 5 -- the upper piece sits above the cell entirely -- so looking for the
topmost lit pixel finds row 4 and the run never reaches the top of the bitmap.
Windows draws rows 0 to 5. Its run starts at the top of the box, which is row -2,
and the bitmap clips it at 0.

Spanning `boxTop` to `boxBottom - 1`, clipped to the bitmap, finishes both
fabrications that were asking:

    cour-gaps    244 of 258 cells, 102 wrong  ->  258 of 258, nothing wrong
    cour-boxes   251 of 258, 7 wrong          ->  258 of 258, nothing wrong
    the set      7,542 of 7,566, 129 wrong    ->  7,563 of 7,566, 20 wrong

`glyph`, `font`, `hinting` and `text` all stay at 100 per cent.

**Twenty pixels remain in the whole apparatus.** Seventeen are `cour-no-instctrl`
running hinting at a size its own font disowns, and three are `times-cvt0-fine`
drawing a readout bar past the box it declared -- which is the same question as
this section from the other side, and the reason to expect it to fall to the same
kind of answer.

### The cvt bar is cut below the baseline and not above it

The three pixels of `times-cvt0-fine` are one cell, and the other five bracket it
usefully. At sixteen pixels the readout puts its bar at row `base - 628`:

    base 608, 616, 624   nothing, in Windows and in ours
    base 632             row 4     both
    base 640             row 12    both
    base 648             row 20    ours only

Row 12 is the baseline -- every other face in the same recording inks its own
full stop there. So Windows draws the bar eight rows **above** the baseline and
at it, and refuses it eight rows **below**. The glyph declares a box of `0,0` to
`400,40`, forty font units, a quarter of a pixel at this size and nothing at all
below the baseline; the bar at row 20 is the only one of the three outside it in
the direction the box has no room in.

That is a partial account rather than a rule. It says which way the cut goes and
where the boundary is for this glyph, and it does not say whether the limit is
`yMin` itself, the bitmap Windows allocates from it, or the descent of the face
-- and the bar at row 4 is as far outside the box upward as row 20 is downward,
so a symmetric clip is already ruled out.

It is left there. The fabrication's own question -- whether Windows holds a
control value three sixty-fourths above ours -- is answered by the cells that
agree, and answered no. What remains is three pixels of a synthetic glyph
deliberately drawn where it declared it would not.

### The last seventeen are a font asked to do what it refuses

`cour-no-instctrl` rewrites Courier New's `prep` to clear `INSTCTRL` where the
font sets it, so glyph programs run at eight pixels per em -- the one size the
font switches them off for. Two cells of 258 disagree, and what they show is not
a rasteriser difference.

Run at that size, our interpreter takes Courier New's `w` to an outline 27.6
pixels tall and its `W` to one 71.3 pixels tall, on an em of eight. Windows draws
the `w` as nothing at all and the `W` as the same shape we draw less one pixel.
Both implementations are producing nonsense from a program run outside the range
it was written for; they differ in which nonsense, and neither is more right.

That is the whole of it. At every other size the fabrication is stock Courier New
and agrees, and the size it changes is the size the font disowns. Chasing the
difference would be fitting an interpreter to a configuration no font asks for,
and the fabrication has already served its purpose -- it is what established that
`INSTCTRL` is read at all, and that Courier New is the only face in the set that
reaches it.

It is worth one note as a robustness observation rather than a conformance one: a
glyph program can take our interpreter to an outline three times the em without
anything refusing it. Windows, given the same program, produces an empty glyph.
Neither behaviour is specified and ours is the less defensive.

### Where the fabricated set stands

    7,563 of 7,566 cells, 20 wrong pixels

    cour-no-instctrl   17   hinting run at a size the font disables
    times-cvt0-fine     3   a readout bar drawn below the box it declared

Thirty-two fabrications, every one of the rest exact. Both remaining causes are
characterised and neither is a defect the recorded corpus can see: one asks a
font to do what it refuses, the other draws a glyph outside its own declared
extent.

### A dot product that is not allowed to divide

Bisecting the blown-up `w` finds three single bytes that each multiply its
height, and instrumenting the mover names them: an `MDRP` moving one point 8.6
pixels for a distance of five eighths of one, and again 15.8 pixels for a
distance of one and a fifth. The move along the freedom vector that shows as
`distance` along the projection vector is `distance / cos`, and as the two
approach perpendicular that runs away.

The reference refuses it. `itrp_ComputeAndCheck_PF_Proj` caches the dot product
of the two vectors and then:

    if (pfProj > -ONESIXTEENTHVECTOR && pfProj < ONESIXTEENTHVECTOR)
    {
      pfProj = (pfProj < 0 ? -ONEVECTOR : ONEVECTOR);  /* Prevent divide by small number */
    }

A dot product under a sixteenth is replaced by a whole one of the same sign,
which turns an enormous move into a merely wrong one. We had only a guard against
dividing by nought.

With it, Courier New's `W` at eight pixels per em comes out 10.5 pixels tall
rather than 71.3, and its cell agrees. `cour-no-instctrl` goes from 256 of 258
cells and 17 wrong pixels to 257 and 16, and the set to 7,564 of 7,566 and 19.
Every recorded probe is unmoved at 100 per cent, which is what a guard reachable
only outside a font's own declared range should do.

The `w` is not fixed by it and would not be by the reference either: its dot
product comes to about a thirteenth, just the wrong side of the threshold, so
both implementations divide by it. Ours draws a 27-pixel glyph on an eight-pixel
em and Windows draws nothing; what separates them is somewhere else in a program
being run where its own font says not to.

### The `w` is diagonal hinting, and the divergence is upstream of it

Tracing the glyph program through the interpreter rather than framing it by hand
gives the shape of what fails. Three times over, at bytes 601, 610 and 619, the
program runs the same nine instructions:

    SDPVTL[1]   set the dual projection vector at right angles to a line
    SFVTCA[x]   freedom along x
    MDAP  CALL
    SFVTL       freedom along a line
    RDTG        round down to grid
    SRP0
    MDRP        and move

That is diagonal hinting: the vectors are taken from the glyph's own strokes
rather than from an axis, and the `MDRP` at the end of each block is one of the
moves that blows the outline up. `0x7d` is `RDTG` and not an undefined opcode, as
a hand framing had it; the trace settles that.

Two candidate causes were tested and neither is it. The dot-product guard from
the previous section does not fire here -- the cosine comes to about a
thirteenth, above the sixteenth the reference clamps at -- so both
implementations divide by it. And the vector from a line is computed as
`zp2[p2] - zp1[p1]` where the specification measures from p2 to p1; reversing it
changes nothing at all, on any fixture, because a projection vector negated
negates every distance measured against it and the sign cancels.

So the vectors are built from points the program has already moved, and if those
differ at all the angle differs, and near perpendicular a small difference in
angle is a large difference in the move. The divergence is upstream of the
instruction that shows it, accumulated somewhere in the 226 glyph instructions
that run before it, in a program its own font disables at this size.

Sixteen pixels, one cell, and the fabrication has already told us the two things
it was built to tell us: that `INSTCTRL` is read, and that Courier New is the
only face that reaches it. This is where it stops being worth more.

### Reading the interpreter against its own source

With every recorded probe at 100 per cent, a difference can only be found by
reading. Four places were compared against `fontinstructions.c`, and the useful
thing is that two of the four were already right -- knowing which is worth as
much as changing the others.

**The dot product that divides.** A real gap, in the previous section: the
reference clamps a cosine under a sixteenth and we did not.

**The rounding routines' sign-flip guard.** Each of `RoundToGrid`,
`RoundToHalfGrid` and `RoundOff` ends with `if ((xin ^ x) < 0 && xin) x = 0`, and
`RoundToHalfGrid` with `±FNT_PIXELSIZE / 2` instead. Ours cannot flip a sign at
all -- it rounds a magnitude and puts the sign back -- and it clamps the
magnitude at nought before rounding rather than the result after. Worked through,
the two agree on every case the guard exists for: nought for the grid roundings
and a signed half for the half-grid one. **Nothing to change**, which is the sort
of thing that is easy to change wrongly if it is not checked.

**A vector set from a line.** Ours computes `zp2[p2] - zp1[p1]` where the
specification measures from p2 to p1. Reversing it moves nothing on any fixture,
because a projection vector negated negates every distance measured against it
and the two cancel. **Equivalent**, and now known to be rather than assumed.

**`ISECT` on near-parallel lines.** Ours took the midpoint whenever the two lines
were within about three degrees, on an unexplained factor of nineteen. The
reference divides unless its denominator is exactly nought. That is now what we
do: a pair of lines that nearly miss put the point a long way off, and Windows
lets them. Nothing measurable moves, which is what a near-parallel `ISECT` not
arising in any fixture looks like -- but faithfulness about a fragility is the
point of the exercise, and an undocumented constant guarding against it was not.

### Putting a near-parallel `ISECT` in front of Windows

The change in the last section moved nothing measurable, which is a poor place to
leave a change. Three fabrications now measure it: the same five points every
time, one `ISECT`, and only the second line's far end moving -- at right angles,
half a degree apart, and exactly parallel. Each reports where the point landed.

Fifty-nine sizes read, and the controls settle first: **crossing and parallel are
exact at all fifty-nine**, both putting the point a few pixels across the glyph,
which says the instruction, the readout and our operand order are all right.

Then the grazing pair. **Windows puts the point hundreds of pixels away.** Not a
midpoint, not a clamp -- at twenty pixels per em it reports 196 where the
crossing case reports 5, and at other sizes it reports **-494**. The direction is
not stable: which side of the near-parallel pair the rounding lands on decides
it. So the fragility is real, Windows has it, and the factor of nineteen we used
to guard with would have answered about five every time -- wrong by two orders of
magnitude, and wrong in a way no recording we had could see.

We match it exactly at ten of the fifty-nine and not at the rest, and that is the
honest end of it rather than a defect to chase. Dividing by a denominator near
nought multiplies whatever the inputs disagree by, and the inputs are
sixty-fourths; a sixty-fourth of angle on a point two hundred pixels out is tens
of pixels. Matching at ten sizes is the surprise. Matching at all fifty-nine is
not available to anything short of bit-identical inputs, and the test says so
rather than pretending otherwise.

### `SROUND` rounds with a mask, and the illegal period is real

Three more fabrications, and this time the reading found two mechanisms rather
than a constant. Each sets one round state and rounds a single point with
`MDAP[r]`, reporting where it landed; the point's own position moves a
sixty-fourth at a time as the size changes, so the size sweep walks the value
across every period and phase one argument describes.

**The rounding is a mask, not a division.** `SuperRound` writes
`x &= ~(period - 1)`, which is a floor to a multiple only when the period is a
power of two. Every named round state has one, so nothing in the recorded corpus
could tell the two apart. `SROUND`'s fourth period selector does not: the
reference calls it illegal and gives it **999**, and `~998` is not a floor to
anything in particular. Windows lands wherever that mask leaves it and the answer
_moves with the input_ -- 129, 131, 130, 128 across the sizes -- which is how the
mask shows itself, since a division by 999 would answer the same every time. We
gave that selector a whole pixel, which is a guess that happens to be a different
selector's answer.

**The forty-five degree form divides in 2.30 and floors in pixels.**
`Super45Round` divides by the period held as a square root in 2.30, masks _that_
to whole pixels, and multiplies back, where we floored to a multiple of a period
we had halved in sixty-fourths and left at 22.5. The period is also converted
once, so it comes out 23, 45 or 91 rather than 22.5, 45 or 90, and the phase and
threshold follow from the whole number with the reference's own rounded
divisions.

    sround-illegal    59 of 59 sizes wrong  ->  none
    sround-quarter    none either way, which is the control
    s45round-half     54 of 59 wrong        ->  2

The two that remain are off by one and are the square root rounding twice over;
`VECTORDIV` and `VECTORMUL` round rather than truncate, which is worth three of
the five on its own. Every recorded probe is unmoved at 100 per cent and the
fabricated set is unchanged, which is what a corner no font reaches should do.

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

That was true when written. It is not now: the fabricated corpus stands at
26,058 of 26,058, and the sittings that closed the rest are in section 9 -- the
point buffer, the implied midpoint on the scaled grid, the bearing carried in
whole pixels below seven per em, and the fourth phantom read out of GDI's
element as `xMin`. The sweep cells named just above went with the letters, and
which of those readings took them is not attributed; see the head of this
section.

## 8a. Widening the corpus: the styled files, Wingdings and the weight field

With every recorded fixture agreeing, the way to find what is still wrong is to
record more. The `glyphs` probe had drawn each regular outline face at ten
heights over a hundred and thirty-three characters, and each of the nine styled
files -- bold, italic and bold italic of Arial, Courier New and Times New Roman,
which are outlines of their own with programs of their own -- at three heights
over thirty-six. It had never drawn Wingdings, and it had never asked for a
weight other than 400 or 700.

The `styles` probe gives the nine files the regular faces' net, adds Wingdings
over its lower half at seven heights, and sweeps the weight field: every hundred
from 100 to 900 on two faces, and then every ten from 500 to 700 on four. That is
9,094 records, and on the first replay **8,278 of 8,758 agreed** -- 480 wrong,
which broke into three mechanisms and a sprinkle before any of them was chased:

    Wingdings                        379 of 658    heights 10, 12, 14, 18 wrong at nearly every character
    weight 600, both faces            72 of 72     500 and 700 right on either side of it
    Courier New Italic, accented      20 of 828    three characters at every height
    bold italics, single pixels        9

### Bold is synthesised above 550 and the bold file chosen above 600

Windows's cells at weight 600 matched neither the regular file's nor the bold
file's. For sixteen of the thirty-six Arial letters they were the regular cell
with its ink smeared one pixel to the right, and for the other twenty they were
not -- and the twenty were the round ones: `a b d e g o s` and the digits. Looked
at, the round letters _were_ smeared, but not past their own right edge: the `o`
had its left stem doubled and its right stem not. A smear clipped to the last
column of ink fixes the twenty and breaks the sixteen, so the edge is not the
ink's but the **bitmap's**, which can carry a blank column when the outline's
extreme lies past a pixel edge without covering a sample -- the box rule of
section 9. That is the rule this already applies to Symbol's synthesised bold,
unchanged; what was wrong was only _when_ it applies.

Two thresholds, read off the sweep of every ten:

    weight     500..550    560..600           610..700
    Arial      regular     regular, smeared   the bold file
    Times      regular     regular, smeared   the bold file
    MS Sans    regular     synthesised bold   synthesised bold
    Symbol     regular     synthesised bold   synthesised bold

So the smear begins above 550 on every kind of face -- strike family, outline
with a bold file, outline without -- and the bold _file_ is chosen above 600.
This had both at 700. A request at 600 now gets the regular outline smeared, and
one at 650 gets the bold file drawn plainly, and the metrics follow the same
gate. **The weight sweep is 720 of 720 at the hundreds and 336 of 336 at the
tens**, and nothing else moves.

### What the wide net turned out to hold

The other 408 were four things, and three of them were the probe's.

**Wingdings had never been drawn, by either side.** The probe asked for it with
the ANSI character set, the way it asks for everything else, and _the character
set outranks the name_ -- a rule this file already had. Windows fell to a bitmap
face and so did this; the cells that "agreed" at 16, 20 and 24 were MS Sans
Serif's strikes on both sides, and the ones that did not were Windows falling
somewhere else. Recorded with `GetTextFace`, where it fell is exact:

    asked for "Wingdings", ANSI    h=10   Small Fonts
                                   h=12   Arial
                                   h=14   Arial
                                   h=16   MS Sans Serif
                                   h=18   Arial
                                   h=20   MS Sans Serif
                                   h=24   MS Sans Serif

An exact strike where one exists, from any bitmap family; otherwise the outline;
never a scaled strike. This falls to MS Sans Serif at every height, scaled where
it must. Making the outline beat every scaled strike is **refused**: it takes the
`font` fixture from 5,057 to 2,842 of 5,057, so whatever scores the fallback is
not that. The four heights and their metrics stand as a gap, 16 records, with the
data above.

Asked for with the symbol set, Windows answers with Wingdings at every height,
and this answered with Symbol -- the mapper rewrote every symbol-set request to
that one face. **A name that is itself a symbol face keeps its name**; the
rewrite is only for a name that is not. With that, Wingdings proper was 609 of
658 on the first replay, and the 49 were seven characters at every height.

**Two of the seven were the record.** `'` and `,` went into the argument list as
themselves, and a quote or a comma inside a comma-separated list is not something
the replay can parse around; it drew an empty string. Punctuation now goes in as
its code, as the accented range always had.

**Five were composites with a transform.** Wingdings places mirrored copies:
`D` is glyph 38 at a scale of -1, a point reflection; `@` is glyph 34 mirrored
in `x`. This honoured a component's offset and nothing else, so the copy landed
fourteen hundred units off the cell and drew blank. Two rules came out of
putting the matrix in, and each was decided by counting:

- **A composite with no program of its own still has its components fitted.**
  Glyph 39 has no instructions; glyph 38, which it places, has three hundred
  bytes of them. This had taken the design assembly for such a composite and
  scaled it, unhinted. Running the assembly with nothing to execute afterwards
  -- the components fitted by their own programs, the composite by none -- is
  what Windows does.
- **The transform applies to the fitted component, not before its program.**
  Mirroring the design outline and then hinting it is 21 of 35; hinting and
  then mirroring is **35 of 35**.

**And the fractions fell with them.** Courier New Italic's ¼, ½ and ¾ are
three-component composites with no program of their own, and the twenty cells
that had been chased as a placement fault -- offset rounding, the bearing
carry, both refused -- were the same unhinted assembly. Fitted, they agree.

What the net held then was eleven single pixels, and four of them were one rule
-- see the next section. What it holds now is **seven single pixels**, each in a
different glyph, among the bold italics and two Courier New Italic accents; the
sixteen fallback records above; and one more metric: Wingdings answers `tmPitchAndFamily` with `FF_DONTCARE` where Symbol,
also OS/2 class 12, answers `FF_ROMAN`. Two fonts cannot say which field
decides that, so it is not decided here.

    styles   9,149 of 9,178 records, 99.7%;  glyphs 9,087 of 9,094

The earlier reading here that Windows chose a seventeen pixel size for Wingdings
at eighteen was of the fallback's metrics -- Arial's -- and is withdrawn.

### Four of the eleven were one glyph's `SCANCTRL`, leaking

Of the eleven single pixels, four were `ù ú û ü` in Arial Bold Italic at twelve
pixels: the same base `u` under four accents, all one pixel out. One cause, then.
And an odd one: **replayed alone, all four agree.** In the fixture's order they
do not. So the cell depends on what was drawn before it, which is the shape of
the point-buffer residue of section 9 -- and it is not that. In the fixture's
order the four are wrong with the buffer kept per font and size, with one buffer
shared by every face, and with the tail cleared to nought, identically.

So something else in the hinter outlives a glyph. Bisected by replaying `ù` fresh
after each of the forty records before it, exactly two predecessors flip it:
`ð` and `ø`. Diffing the hinter's own fields between a fresh `ù` and a `ù` after
`ø`, one differs that is not the point buffer: **`scanControl`, 281 after
`prep` and nought after `ø`.** The `ø` program carries a `SCANCTRL` of its own,
as glyph programs may, and this kept the value on the hinter rather than in the
graphics state the next glyph starts from. So `ø` switched dropout control off
for every glyph that followed it at that size, and the `u`'s thin stroke lost a
pixel.

Windows starts each glyph from what `prep` left. With `SCANCTRL` and `SCANTYPE`
restored to that before every glyph, the four agree in order as they did alone,
and nothing else moves: every recorded fixture holds, the fabricated corpus holds.

    styles   9,145 -> 9,149 of 9,178;  glyph 9,083 -> 9,087 of 9,094

Two notes for the record. The storage area and the control values are also kept
on the hinter across glyphs, and a glyph program may write both; whether Windows
restores those too was meant to be tested here and was not -- the switches for
it turned out not to be in the file when the runs were made -- so it stands
untested, not refuted. And the seven left are seven different glyphs, a pixel
each, with no cluster among them.

### Above thirty-one pixels, for the first time

Every glyph recorded before this was drawn into a thirty-two pixel square, so no
cell height above thirty-one had ever been compared: not the sizes where dropout
control is meant to switch off, not the sizes where `prep` takes its large
branches, not the scan converter on a glyph a hundred points across. The `sizes`
probe draws into a sixty-four pixel cell and says so in the record -- `cell=64`
-- and the replay draws into whatever the record names, thirty-two when it names
nothing. The probe library's result buffer, sized for a thirty-two pixel cell,
grew to take the thousand hex digits of a sixty-four.

Three regular faces at 36, 40, 44, 48, 56 and 64 pixels over thirty-six letters,
the three bold files at forty-eight, and Symbol at three sizes with its slant at
one: 800 cells, and **797 agree on the first replay.** The three that do not are
each a single pixel on the edge of a diagonal -- Times New Roman's `X` at 36 and
40, Courier New's `4` at 48 -- the same kind of residue as the seven in the
styled files.

    sizes   797 of 800, 99.6%;  three single pixels

Nothing had to change for it. The size chooser, the hinting, the scan converter
and its dropout rules, all read or measured below thirty-one pixels, hold at
twice that.

### `lfWidth`, recorded for the first time

A request may name an average character width as well as a height, and no
recording had ever asked for one. The `widths` probe sweeps it: three regular
outline faces at sixteen and twenty-four pixels, nine widths each from below the
natural average to nearly three times it, thirty-six letters, the metrics Windows
reports beside them, and MS Sans Serif as the strike control. 2,480 records.

**The strikes were already right**, 110 of 110: a bitmap face under a width does
what this already did. **The outline faces were not drawn stretched at all** --
the only widths that agreed were each face's own natural average at that height,
where the stretch is one -- and Windows stretches the outline itself, hinted, at
a horizontal size distinct from the vertical: the `A` asked for twice its average
is exactly twice as wide, with two-pixel stems.

Two rules read straight off the metrics. **The horizontal size is fractional:**
the vertical size times `lfWidth` over the average character width the face has
at that vertical size, not rounded to whole pixels. It reproduces the average
width Windows reports -- which is `lfWidth` itself -- at **60 of 60**, where the
integer size this had used was five short, all Courier New; and it reproduces the
maximum width, the `head` box at that fractional size, at **58 of 60**, the two
misses within a half-unit of a rounding that is presumably the scaler's 16.16.
Asked for six at sixteen pixels -- Arial's own average there -- it draws exactly
as unstretched, which a size a pixel off would not.

**And the hinting is anisotropic, in the reference's way.** `MPPEM` answers with
the size along the current projection vector; control values are kept at the
vertical scale and every read is multiplied by the stretch along that vector --
whole for `x`, none for `y`, the root of the weighted squares for a diagonal --
and every write divided by it. Three models were scored on the 1,944 stretched
cells:

    hint anisotropically, control values stretched along the projection   500 of 1,944
    scale x before hinting, control values at the vertical scale           226
    hint at the square size, then stretch the fitted x                     204

So the kind is settled and the rest is detail, and the detail is already
localised. For Arial's `E` at sixteen pixels and twice its width, the fitted
points that a program places absolutely land exactly where the square ones
doubled would -- the left stem at 2 and 4 -- while the points it places relative
to a reference land at 23 and 24 where the doubled square has 16. **A distance
moved along `x` carries the stretch a second time somewhere**, and the
instruction that does it is the next thing to trace.

    widths   1,034 of 2,480 records;  glyph 826 of 2,270;  average width 70 of 70
             with the fractional size, maximum 68 of 70

### Three more readings, and the diagonals left

The instruction that carried the stretch twice was found by tracing Arial's `E`
at the square size and the stretched one side by side: at step 54 an `MIRP`
places the right end of the bars from the **advance phantom**, with an empty
control value, so it measures the outline's own distance between the two -- and
the phantom's _original_ position had been set at the vertical scale, 8.67
against an actual 17, so the distance came out -7 instead of +1. One line.

Then the round letters, which sat a row lower than Windows's with the `E` now
exact, and not at every width: Windows's `o a e s` at sixteen pixels gain a row
at widths 7 and 12 only, not at 8, 10 or 16 -- the widths whose horizontal size
is 15 and 26. That is a `DELTA` exception keyed on the size along the
projection, which the reference's delta engine uses -- "same as `MPPEM`" -- and
this had keyed on the vertical size whatever the projection.

And the horizontal size the scaler _hints_ at is a whole number. At width 8 the
fractional size is 17.33 and the advance phantom lands at 12 from 11.56, where
Windows's right side says 11, which 11.56 cannot round to and 11.34 -- the
advance at 17 -- can. Floored for hinting, fractional for the metrics:

    hinting size    fractional 1,117   floored **1,482**   rounded 1,060   of 1,944

Refused along the way, each by count: running `prep` unstretched (461 against
632 at the time), and leaving the advance phantom unrounded under a stretch (765
against 1,117).

    widths   glyph 1,808 of 2,270;  stretched 1,482 of 1,944;  8,822 wrong pixels

What is left is **the diagonals**. Times New Roman's `N` at ten and sixteen
average width has its stems exactly where Windows has them and its diagonal
three to seven pixels thick where Windows's is one or two; Arial's at sixteen
breaks at the top. The projection along a diagonal under an anisotropic
stretch is the reference's root of the weighted squares, which this has.

Where the two runs part is not a move but a flag. The `N`'s square run executes
239 instructions and its stretched run 476, and they diverge at an `IF` on
storage 18 -- which the font's `prep` computes as

    SVTCA[x] MPPEM  SVTCA[y] MPPEM  EQ  WS 18

So the diagonals are wrong _inside_ the non-square branch: instructions this
interpreter has run correctly ten thousand times under a square scale, doing
something under a stretch that Windows does differently.

### A readout of the diagonal, and the design vector in the wrong domain

So the readout method: Times New Roman's `N` with its whole program kept and a
report appended that moves the advance phantom onto one point's `x`, sixty-four
times over, and the `hinting` probe given a pass that asks for the face under a
width so the advance it records _is_ that coordinate. Four fabrications, one per
corner of the diagonal -- points 1 and 2 on its upper edge, 19 and 18 on its
lower -- at six widths each of two heights. Two of them overflowed the scaler's
sixteen-bit word past eight pixels at sixty-four times and were recorded again
at sixteen.

**Three corners agree with Windows at every width, to the readout's
resolution. One does not:**

    width   p1 Windows   p1 ours       (16 pixels; the top of the upper edge)
      0        1.094      1.094
      7        2.109      2.109
      8        2.953      4.375
     10        4.172      7.172
     12        5.484      9.000
     16        5.812     12.516

Exactly one instruction moves that point: `MDRP[00100]` from point 2, along the
`x` freedom vector, against a dual projection `SDPVTL` set along the diagonal.
Its distance is the outline's own, and this measures that distance from the
**design** coordinates -- a rule read in an earlier sitting, for the precision
the rounded originals do not carry. Scaled with the vertical size alone, then
projected onto a dual vector that lives in the stretched domain: an unstretched
diagonal against a stretched direction. The design vector's `x` stretched before
the projection is the same line at a stretch of one and puts the point at
**4.172, 5.484, 5.813** where Windows has 4.172, 5.484, 5.812. `IP` measures its
proportions from the same design coordinates and gets the same treatment.

    stretched cells   1,482 -> 1,799 of 1,944;   wrong pixels 8,822 -> 2,217

What was left was 145 cells, and the readout method went on paying.

### The readouts confirm the model, and catch a float

Two more stack reporters replace Arial's `n` with a rectangle whose program
pushes `MPPEM` under each projection and reports it as the advance. Their rows
at width nought are `hdmx`'s device width -- the table should have been dropped
-- but every stretched row reads `MPPEM` plus a bearing carry of one or two
pixels, and with the carry taken off they are **13 along `y` and exactly this
implementation's horizontal size along `x`, at every width.** So the reference's
rule for `MPPEM` is Windows's, and three variants that had it otherwise --
the horizontal size on both axes, the larger of the two, `prep` seeing the
horizontal size on both -- were refused by count in any case.

The horizontal size itself was wrong at one width by a float: `13 * (15 / 13)`
floors to 14, so every exception keyed on 15 missed. The size is kept as the
whole number it is.

    stretched cells   1,799 -> 1,824 of 1,944;   wrong pixels 2,217 -> 1,761

A third reporter reads the arch of the `n` along `y`: **6.750 at every width
but 7 and 12, where it is 7.750** -- a whole pixel, so the x-height is eight
there, not seven. The gate on the overshoot is `11 <= MPPEM <= 13` under `y`
and closes in both. And `prep` sets the x-height as the rounding of a measured
**463 + 16 = 479** sixty-fourths: 7.48 pixels, which rounds down. Windows's
eight at horizontal sizes 15 and 26 means its 463 is at least 464 at exactly
those two sizes, and the readout of control value 6 itself says so directly:
read along `x` through the reporter's rectangle, and with the stretch and the
rectangle's bearing carry taken back off, **Windows's x-height is eight pixels at
horizontal sizes 15 and 26 and seven at every other width recorded.**

Where that eight was made took four more readouts and a reading of the
reference, and it turned out to be the one thing the reference leaves open.

### The control values are scaled at the larger size

Arial's `prep` makes its x-height by a ladder: it puts a twilight point at the
_unrounded_ cap height, 596 sixty-fourths at thirteen pixels, rounds another to
the grid at 640, and then for each control value it cares about sets a point at
the unrounded value and interpolates it between the baseline and that rounded
cap -- so every value is re-proportioned by 640/596. The x-height is 431 that
way, which interpolates to 463, plus 16 is 479, which rounds to seven pixels.
Four stack reporters read control values 2, 16, 4 and 20 along `y` as `prep`
leaves them, to the eighth of a pixel they resolve, and **all four agree with
this implementation at every width.** So the inputs to the ladder are right and
the difference is inside it -- which leaves only the arithmetic of a control
value read.

The reference has that arithmetic. When the two sizes differ it does not read the
table directly: it scales the table once, at one size, and every read is
`FixMul(value, scale)` where `scale` is `cvtStretchX` along `x`, `cvtStretchY`
along `y` and the root of their weighted squares along a diagonal; every write
is `FixDiv(value, scale)`; and `MPPEM` and the deltas' size are `pixelsPerEm`
times the same `scale`. **Which size the table is scaled at, and so what the two
stretches are, is set outside the interpreter and is not in the pseudocode.**
This implementation had the table at the vertical size, so a read along `y` was
exact and could never differ from Windows by a sixty-fourth. Scale it at the
horizontal size instead and read it back through `FixDiv(13, 15)`: the x-height
is `1062 * 15 / 32` rounded, 498, times thirteen fifteenths, 431.6, which is
**432**; at seventeen it is 564 times thirteen seventeenths, 431.3, which is 431;
at twenty-six it is 863 halved, 431.5, which rounds to 432. And 432
interpolated is 465 and 464 -- 481 and 480 with the sixteen added, both eight
pixels -- exactly at fifteen and twenty-six and nowhere else. It is the
sixty-fourth the arch had been asking for, and it was in the inputs after all,
one rounding upstream of where the readouts could see.

    stretched cells   1,824 -> 1,878 of 1,944;   wrong pixels 1,761 -> 807

The remaining large cluster was Arial at sixteen asked for five, which is
narrower than its natural average -- a horizontal size of ten under a vertical
of thirteen -- and the first such request in the corpus, which is what settles
the question the x-height could not. With the table at the horizontal size those
fifteen glyphs are wrong; with the table at **the larger of the two sizes**, and
the stretches the ratios of each size to it, they are right, and so are Arial at
twenty-four asked for five and Times New Roman's descenders at the same request.
Section 9's table and the counts below are with the larger size.

    stretched cells   1,878 -> 1,899 of 1,944;   wrong pixels 807 -> 609

The direction `FixMul` rounds a half -- toward positive infinity or away from
zero -- and whether `FixDiv` rounds or truncates were scored as well:
a half going toward positive infinity, which is what adding a half and
shifting down does, is **21 cells and 35 pixels** against 24 and 111 with the
half going away from zero, and the three that go are Times New Roman's `g`,
`j` and `y` at twenty-one pixels asked for sixteen, where a descender control
value scaled at forty-two is halved and lands on an exact negative half;
`FixDiv` truncating is 1,984 cells and 163 pixels. Nearest for both, the half
upward, is the rule -- and the x-height case itself needs the half at
twenty-six to go up. (The multiply's half is the last step in the count below,
after the ratio.)

### A ratio the scaler cannot hold

The cluster after that was twenty-one glyphs of Arial at twenty-four asked for
twelve, at a horizontal size of twenty-eight -- `21 * 12 / 9` exactly -- and
at that request the font's `prep` also sets the four-to-three flag, since
28 × 3 / 21 is 256. The flag was a coincidence: nothing the `n` runs reads it,
and its trace at twenty-eight differs from twenty-three only in the two `MPPEM`
values. The cells themselves said what was wrong. Windows's `n` is eleven
columns to this implementation's twelve, its `m` eighteen to twenty, its `X`
shifted a column: everything about them is a size narrower. **Forced to
twenty-seven, all thirty-six glyphs at that request agree.**

Twenty-eight is what one division says. Twenty-seven is what a fixed-point ratio
says: `lfWidth` over the average as a 16.16 number, rounded to the nearest, then
times the vertical size. Twelve ninths is four thirds, which is not
representable and rounds down, to 87381 of 65536, and twenty-one times that is
27.99975. The `font` fixture holds the other half of the rule: Arial at
twenty-seven pixels asked for eight has an average of twelve, and two thirds
rounds _up_, to 43691, so the size is 18.0001 and stays eighteen, where Windows
has it. Truncating the ratio instead gets the first right and loses the second
(the two extents of the `font` fixture); the one division gets the second and
loses the first (1,998 of 2,043 stretched cells and 609 pixels against 2,019
and 111); the average left unrounded before the ratio is taken is 1,142 and
21,886 pixels. Nearest is the only
reading with both, and the ratio's rounding is now the rule in section 3.

    stretched cells   1,899 -> 1,920 of 1,944;   wrong pixels 609 -> 111
    and with the multiply's half upward, above:
    stretched cells   1,920 -> 1,923 of 1,944;   wrong pixels 111 -> 35

### The stretched design coordinates keep their fraction

The one cell that was more than a pixel or two was Times New Roman's `S` at
twenty-four asked for five -- twenty-one pixels by thirteen -- whose top
terminal Windows draws a column further right. The terminal hangs off one
point, and that point is placed by `IP` between two others along `x` and then
rounded to the grid: the proportion is taken in design units, 939 between 1029
and 851, which is 352 sixty-fourths from the reference and rounds up to six
pixels. This took the proportion from the design x _stretched_ -- multiplied by
thirteen twenty-firsts, as the readout of the `N`'s diagonal had shown it must
be for a diagonal projection -- and then, because the dual projection rounds
its result to a unit, from 581, 637 and 527: which is 351, and rounds down to
five. The stretch itself cancels in a proportion along `x`; its rounding did
not. **The stretched design coordinates keep their fraction**, in `IP` and in
`MDRP`'s design distance alike, and the count says so on every face:

    stretched cells   1,923 -> 1,941 of 1,944;   wrong pixels 35 -> 4

Dividing the design y by the stretch instead, to whole units, and leaving the
x alone -- the same proportion along `x`, a different rounding along `y` and
the diagonals -- is refused at 1,898 cells and 94 pixels. How the reference
holds the stretched originals is, again, outside the pseudocode; the
precision that reproduces the recordings is a fraction of a unit.

### The `X`s: a half that rounds up, and the order of the operands

Two of the three cells left were `X`s, and the Arial one -- at twenty-four
asked for sixteen, twenty-one pixels by thirty-seven -- was two pixels on the
edges of its thick diagonal, one on each edge, seven rows apart. Both edges
run within a fraction of a sixty-fourth of a sample centre where they cross
those rows, so a one-unit difference anywhere in the four corner points
decides both. The hinting probe sweeps the widths on one letter per face, so
the `X` was copied into Arial's `n` slot -- record, metrics and all -- and
its four corners read out along `x`, first at eight times and then, with a
base subtracted so the answer fits a word, to the sixty-fourth. **Three of the
four agree with this implementation at every width recorded. The fourth,
point 3, is 368 in Windows and was 366 here**, at that one width and nowhere
else.

Point 3 is placed by `MDRP` from the opposite corner along a projection at
right angles to the diagonal, so that it lands on the line through that corner
-- which, from the corners as both sides have them, is 367 exactly. Each side
is one rounding off it, in opposite directions, and the rounding is in the
projection. A projection is two products of a sixty-fourth coordinate by a
2.14 vector component, each rounded to a sixty-fourth, and here the `y`
product is exactly -757.5. `mulDiv` takes the sign out and rounds the half
away from zero, to -758; the scaler's `ShortFracMul` adds a half and shifts,
and an arithmetic shift floors, so -757.5 goes _up_, to -757. That
sixty-fourth turns the move from 11 to 13 and puts the point at 368.

Applied to the projection alone, the rule fixed a pixel of the `X` and a cell
of `sizes` and broke Arial Italic's `f` at twenty-four, which had been right
since the `glyphs` fixture was recorded. The `f`'s cell is an `ALIGNRP` on a
slanted projection whose `x` product is exactly 125.5 -- or -125.5, depending
on which point is subtracted from which. This projected the reference point
from the point; the reference projects the point from the reference point and
negates the result. Under a symmetric rounding those are the same number, and
under this one they differ by one exactly at a half. **With the half rounding
up and the operands in the reference's order** -- in `ALIGNRP`, and in `IP`,
which the reference arranges as a projection of the two references' span, a
scaled design offset, and a projection of the point's current offset -- the
`f` is back, and nothing recorded before moves the wrong way:

    widths   1,941 of 1,944 stretched cells, 4 -> 3 wrong pixels
    sizes    797 -> 798 of 800
    styles   9,149 -> 9,150 of 9,178

The same rounding was then tried, one at a time, in the three other places a
half can fall: the point move's `LongMulDiv` costs a `styles` cell, `IP`'s
`MulDiv26Dot6` a `glyphs` cell, and the freedom-projection dot product changes
nothing. Those keep the symmetric rounding. `IP`'s design offset projected
with the current vector, as the reference's general case has it, rather than
the dual, also changes nothing recorded.

Along the way the Courier New `o` at sixteen asked for three -- a horizontal
size of four -- turned out to be drawn with grid-fitting switched off, by
Courier New's own `prep`, at that horizontal size; so its one pixel is about
how an unhinted outline is scaled under a width, not about any instruction.
Scaling it at the fractional horizontal size instead of the whole one is
refused outright: 1,939 of 2,043 and 431 pixels, most of Courier New's narrow
requests going wrong.

### `ISECT`, as a chain of roundings

The pixel left on Arial's `X` was on the left edge of its thick diagonal
above the crossing, and that edge runs from the top corner -- confirmed by
readout -- down to the point `ISECT` puts at the crossing of the two strokes.
Five more readouts: the thin diagonal's three corners, and the crossing point
itself along `x` and along `y`. **The corners agree at every width. The
crossing does not**: Windows has it at 681 along `x` where this had 680, at
twenty-one pixels asked for sixteen; at thirteen asked for sixteen Windows
has (620, 358) against (619, 357); at twenty-one asked for twenty its `y` is
521 against 520.

This computed the intersection by Cramer's rule on the exact cross products
and rounded once. The reference divides both numerator and denominator
through by the larger component of one line's direction, each division a
rounded `MulDiv26Dot6`, and then scales the other line's direction by the
ratio, rounding again. For the Arial crossing that chain is 1232 × 1060 /
1919, which is 680.52 and rounds to 681 -- the exact intersection is 680.2.
Rearranging `ISECT` as the reference has it puts the crossing at 681, and the
edge above it crosses the sample row at 416.06 sixty-fourths instead of 415.5:
the other side of the centre at 416, and the pixel goes. The same chain gives
Times New Roman's `X` at twenty-one asked for five its crossing at 232 where
the exact rule gave 233, and its pixel goes too. **And the two cells of
`sizes` that had stood since it was recorded -- Times New Roman's `X` at
thirty-six and forty pixels -- go with them**, which is the sort of thing a
mechanism does and a fitted rule does not.

    widths   1,943 of 1,944 stretched cells, 3 -> 1 wrong pixels
    sizes    798 -> 800 of 800

### What is left of `lfWidth`

**The maximum width metric** was two of seventy: Times New Roman at
twenty-one pixels asked for ten, 28.49 pixels by the box scaled and rounded
once, where Windows says 29; and Courier New at twenty-two asked for five, 5.56
where Windows says 5. Every other record's fraction is at or below .47 and
rounds down or at or above .52 and rounds up, so no rounding of the exact
product fits both. Scaling each end of the box to a sixty-fourth first, as the
scaler hands coordinates over, and rounding the difference to a pixel makes the
Times case exactly 28.50 -- **59 of 60**, and the same 927 of 927 at the square
sizes -- and is the rule now. Refused by count: the ends rounded to whole
pixels separately, 47; the square maximum times the stretch, 43; the box at the
whole horizontal size, 41. Courier New's case stays: 355 sixty-fourths, and a
horizontal size under 8.37 pixels per em would give 5, which its glyphs (drawn
at eight) and its average (five) both allow; what Windows measures it from is
not known.

One stretched cell of 1,944, one pixel: Courier New's `o` at sixteen asked
for three, which its own `prep` draws with grid-fitting off at that horizontal
size -- four pixels by thirteen -- so the pixel is about how an unhinted
outline is scaled or drawn under a width. What is known about it: the pixel is
the left half of the top row but one, where the outer shoulder crosses the
sample row at 29.5 sixty-fourths and the inner at about 44, a sliver fourteen
wide across a centre at 32 -- filled here, and neither filled nor rescued by
Windows, though dropout control is on in both by the same `SCANCTRL` word
(0x12c, on below forty-four pixels, with neither the rotated nor the stretched
condition set). Scaling the unhinted outline at the fractional horizontal size
is refused, above. Drawing a curve whose second-difference norm is small as a
single chord -- which would put that shoulder past the centre -- leaves the
pixel where it is and breaks another glyph of the same request, 34 of 36; so
the shoulder is not a chord matter either.

Nothing recorded before this moved: `font`, `glyphs` and `hinting` hold at every
record, since at a stretch of one every new path is the old one.

### The advance under a width is the hinted one

Re-recording the `hinting` probe -- extended to sweep the italic files, for the
readouts below -- brought its stretched rows into the main fixture for the
first time: Times New Roman's `N` and Arial's `n` at every width the widths
sweep uses. Twenty-three of twenty-four agreed and one did not: **the `N` at
twenty-one pixels asked for twelve advances 22 in Windows and 23 here.** The
horizontal size there is 31.5, and this scaled the design advance by it --
1479 units at 31.5 is 22.75, which rounds to 23. Windows draws the glyph at
the whole size, 31, with its program run, and the advance is what the program
leaves the advance phantom at: 1479 units at 31 is 22.39, and the phantom
rounds to 22. **The advance under a width is the hinted one at the whole
horizontal size**, as the glyph is drawn, and every stretched row agrees; the
two stretched extents of the `font` fixture, Arial at twenty-seven asked for
eight and twenty, hold.

### The family comes from the `.FOT`

The `styles` sweep had left twenty-two metric records of Wingdings: asked in its
own character set, Windows reports its pitch and family as `0x07`,
`FF_DONTCARE` with the vector and TrueType bits, where this said `0x17`,
`FF_ROMAN`, as it does for Symbol -- and Symbol is right. Both faces are `OS/2`
class 12; Wingdings is subclass 0 with a PANOSE of "pictorial, otherwise
anything", Symbol subclass 3 with a full PANOSE. Four fabrications gave each
face the other's field, one at a time, and the `styles` probe was recorded
against each: **nothing Windows reports changed**, for either face, under any of
the four. So the answer is not read from the `.TTF` when the font is used.

It is read from the `.FOT`. `CreateScalableFontResource` writes one beside
every TrueType file the installer puts in: a stub executable whose resources
are the path of the `.TTF` and a `FONTDIR` entry -- the same `FONTINFO`
header a bitmap strike carries, filled in for the outline -- and GDI
enumerates the face from that. Decoding the fourteen installed stubs, the
`dfPitchAndFamily` byte is `0x27` for the four Arials, `0x36` for the four
Courier News, `0x17` for the four Times New Romans and for Symbol, and `0x07`
for Wingdings: exactly what `GetTextMetrics` reports for each, pitch bits and
all. The manager now loads each `.FOT` with its `.TTF` and answers from it,
and the twenty-two records go. What the installer read that byte from is the
question that remains, and it needs a probe that makes a `.FOT` from a
fabricated face.

    styles   9,150 -> 9,157 of 9,178

### A name the directory holds but cannot answer

The last fifteen metric records of `styles` were one request: "Wingdings" in
the ANSI character set. Windows answers Small Fonts at ten pixels, Arial at
twelve, fourteen and eighteen, and MS Sans Serif at sixteen, twenty and
twenty-four; this answered MS Sans Serif at every height, stretched where it
had to be, because a name that could not be used fell to the family default.
The rule that scores it is the mapper's own, read in section 3, with nothing
added. Wingdings itself carries the character set mismatch, 65,000, and is
out. Every other candidate carries the same name mismatch, 10,000, so what
separates them is the height term: a strike installed at exactly the height
asked for costs nothing there, an outline realised at that height costs
nothing there but a little elsewhere, and a strike that would have to be
stretched costs 150 a pixel and more -- so **an exact strike beats an outline,
which beats a stretched strike**, and Arial, first in the directory, is the
outline. Where two strikes are exact the weight separates them or the
directory order does: at sixteen System's strike is exact too, and bold, and
loses to MS Sans Serif's; at ten Small Fonts' ten row strike and MS Serif's
are both exact and both regular, and Small Fonts wins because MS Serif's ten
and eleven row strikes are not in `SERIFE.FON` at all but at the end of
`SMALLE.FON`, after Small Fonts' own -- the directory order is the order of
the files' resources, and this now stamps each strike with its place in it.
An italic request keeps going to the italic file, as recorded before.

    styles   9,157 -> 9,172 of 9,178;   the six glyph pixels are all that is left

### The styled italics, and what a readout can and cannot reach

Six cells of `styles` were left, all single pixels, all in italic files: Arial
Bold Italic's `M` at fourteen, Times New Roman Bold Italic's pound sign at
seventeen, and four Courier New Italic and Bold Italic accents. Each was placed
against the outline it came from. The `M`'s pixel sits where a diagonal's edge
crosses a sample row 0.56 sixty-fourths past the centre; the pound sign's is on a
curve the control polygon does not reach; the Courier cases are several units of
hinting apart from Windows, where a cedilla's stem top, a cent sign's foot and a
pilcrow's counter fall differently.

None of those files was swept by the hinting probe, so it now is: the bold
italic `M`, and the accents by code, `#a3`, `#a2`, `#b8`, `#b6`, in the same
form the `styles` probe uses. Re-recording it brought the stretched rows in
too (above). Then the points the disputed edges run between were read out.

**The pound sign's four agree exactly.** Its pixel is not in the points.

**The `M`'s nine all come back one more than this has them -- x and y alike,
the baseline points included** -- at eleven pixels, and exactly equal at ten
and twelve. A hinted baseline cannot sit a sixty-fourth up, and shifting the
whole outline by one in both directions would move the disputed edge the wrong
way, so the offset is the channel's at that one size and the points are ours.
What is not ours is where the outline sits against the grid. The `M`'s program
leaves its origin phantom at -66, a pixel and two sixty-fourths left of where
it started, and the outline was carried back onto the phantom whole, as the
guillemets had taught (section 3) -- which for them was a whole pixel and here
is not. A bitmap is placed at a whole pixel; the fraction cannot move the
outline against the samples. **Carried back by the phantom's whole pixels
only**, the edge crosses at 350.56 instead of 352.56, the pixel is inside, and
nothing else in the corpus moves. Whether the whole pixels are the nearest or
those toward zero, -66 does not say.

**The Courier readouts read nothing.** Every one came back as the plain scaled
advance of the face, whatever point was asked for and whatever the program
did, and raising the file's `maxp` limits changed nothing. The reason is the
channel: GDI answers a fixed-pitch face's extent from its average character
width and never asks the glyph, so an advance phantom moved by the program is
never seen. The four Courier cells, and the pound sign's curve, need a readout
that comes back through the bitmap itself.

    styles   9,172 -> 9,173 of 9,178

### A readout through the bitmap, and an `IUP` that is not the pseudocode's

A fixed-pitch face cannot be read through its extent, so the Courier cells got a
channel of their own. `shiftReporter` in the fabricator appends to a glyph's
program the same reading as the point reporter -- `GC` on the point, along the
axis asked for, less a base -- and then shifts every contour point of the glyph
along `x` by that many _pixels_, a pixel of displacement for each sixty-fourth of
coordinate. The phantoms stay where they were, so the advance is untouched; what
moves is where the letter lands in the `styles` probe's cell, and Windows's
fabricated cell laid over its plain one gives the displacement, and so the
coordinate. The base is chosen so agreement lands three pixels to the right;
a value too far off leaves the cell and reads as no overlap, which is itself an
answer.

| glyph, size                     | point, axis | ours     | Windows         |
| ------------------------------- | ----------- | -------- | --------------- |
| Courier New Italic `¢`, 12      | 40 x        | 357      | 357             |
| Courier New Italic `¢`, 12      | 40 y        | 160      | 160             |
| Courier New Italic `¸`, 28      | 3 y, 4 y    | 26       | **35**          |
| Courier New Italic `¸`, 28      | 2 y         | 11       | **20**          |
| Courier New Italic `¸`, 28      | 9 y         | -9       | -9              |
| Courier New Italic `¸`, 28      | 0 x         | 451      | 451             |
| Courier New Bold Italic `¢`, 15 | 3 y, 4 y    | -30, -46 | **-25, -41**    |
| Courier New Bold Italic `¢`, 15 | 9 y         | 34       | 34              |
| Courier New Bold Italic `¶`, 27 | 48 y, 53 y  | -24, 0   | -24, 0          |
| Courier New Bold Italic `¶`, 27 | 51 x        | 640      | 640             |
| Courier New Bold Italic `¶`, 27 | 51 y        | -44      | out of the cell |

The cedilla says it all. Its stem top, points 2 to 8, is never touched in `y`
and sits between two anchors: the baseline point 1, hinted up nine, and point
9, which a near-horizontal move touched in `y` without moving it. Both anchors
are at the same design height, -10. **Windows lifts the run by nine -- the
first anchor's move -- with both anchors exactly where this has them.** The
pseudocode's `IUP` sorts an anchor pair by original coordinate, sends an equal
pair to the _second_, and shifts the run by that one's move, which is nought
here and what this did. Windows 3.1 takes the first. The bold cent sign is the
same shape -- its run between a point hinted up five and one at the same
design height that did not move -- and so is the pilcrow's counter, whose
first anchor did not move and whose second rose 24: Windows leaves the run
where it was, which is why its point 51 left the readout's cell. **With an
equal pair shifting by the first anchor's move, all three cells go and nothing
else in the corpus moves.** A `<=` where the pseudocode has `<` would do it;
which the scaler actually has is not known.

    styles   9,173 -> 9,176 of 9,178

Two styled cells are left. Courier New Italic's cent sign at twelve pixels has
its vertex at (357, 160) in both -- read out -- and 160 is exactly a sample row's
centre, so the pixel is the scan converter's, at a curve's minimum lying on a
sample line. Times New Roman Bold Italic's pound sign has a stroke tip on a
pixel boundary that this rescues as a dropout and Windows does not. Both are
questions for an instrument, not a readout.

### An instrument for the two scan converter cells, and where it stops

The two styled pixels left were both the scan converter's, and both were put on
an instrument. `outlineInstrument` writes a real letter's hinted outline, taken
in sixty-fourths from the rasteriser's own input, into Symbol's `A` slot as an
unhinted shape in design units exact at twenty pixels -- where the glyphs probe
draws Symbol at twenty-four points -- with no program, under Symbol's `prep`,
which leaves dropout control on in the same mode Courier New and Times New
Roman run under. Six fabrications: Courier New Italic's cent sign with its
minimum vertex exactly on a sample row, and a sixty-fourth below and above it;
Times New Roman Bold Italic's pound sign with its stroke tip on a pixel
boundary, and a sixty-fourth either way.

**Both cells reproduce exactly in the instrument**, in a different font, at a
different size, with no hinting at all: the pixel is the scan converter's and
nothing else's. The cent sign's variants place it to the sixty-fourth: a
minimum a sixty-fourth below the row centre dips through it and both draw the
pixel; a sixty-fourth above, neither does; exactly on it, this draws and
Windows does not. The pound sign's three variants all disagree alike, so its
pixel is not about the tip's boundary.

Tracing the walk showed what the pixel is in both cases: a **vertical dropout
rescue**. Two chords cross a column's centre line within one row without
covering its centre, which is a vertical dropout candidate, and the stub test
that decides whether to rescue it -- crossings on the row and its neighbour at
the columns either side, two or more each way -- is satisfied on one side
only by a zero-width on/off pair the endpoint topology emits for a vertex
lying exactly on a sample line. Take that pair away and there is no rescue.
The reference's `scanlist.c`, read for exactly this -- `LookForDropouts`,
`DoVertDropout`, `HorizCrossings` -- counts an on and an off at the same pixel
as two crossings and would rescue, as this does. **Windows 3.1 does not.**

Three single rules were tried and are refused, each by hundreds of cells across
the fabricated corpus that measured the endpoint topology and the dropout
pass in the first place: a vertex at an extremum on a sample line emitting
nothing (in the horizontal topology alone, or both), and a zero-width pair
counting nothing or once toward continuation. So the rule that separates
Windows from this `scanlist.c` is narrower than any of those, and it lives in
the binary's own dropout code -- segment 42's `0x059b` and `0x0978`, which the
reading in section 6 stopped short of -- rather than in anything the
instruments can sweep from outside. The two cells stay, with the instrument
that reproduces them in hand.

### Reading the dropout code, and what it rules out

The two cells the instruments reproduce are a vertical dropout rescue Windows
does not make, so the next place to look was the code that makes it. Segment
42's contour driver ends with two calls, and the first is not a dropout pass at
all: **`0x059b` is the span filler.** It walks each scanline's `on` and `off`
lists in step, keeps a winding count, and where the count leaves nought it
`or`s a mask from the table at `0x254` into the row and where it returns to
nought it `and`s the complement back out. `0x0978` is the whole of the
dropouts, horizontal half then vertical, mirroring the pseudocode's
`LookForDropouts`.

Three things in it were read rather than guessed, and they narrow the question
sharply.

**The stub test is the pseudocode's, argument for argument.** Each half calls
`0xe28` and then `0xeaa` and refuses the rescue unless both answer two or more.
Each of those makes three calls to the counter, short-circuiting once the sum
passes one, and their operands decode to exactly the six the pseudocode names:
for a vertical dropout at column `c` and scanline `y`, the vertical crossings
at `c+1` and the horizontal ones at `(c+1, y)` and `(c+1, y-1)` on one side,
and the mirror at `c-1` on the other. That is what this implementation already
consults.

**The placement is the pseudocode's too, fused.** `0xc8a` and `0xcf3` take the
candidate, test the bit one pixel along -- the same single neighbour this
tests, not the pseudocode's two -- and return without drawing if it is set,
otherwise setting the bit at the candidate. And the scan kind is masked to its
low bit on entry (`and word [bp-0x36],byte +0x1`), so **the binary has no
smart-dropout path at all**: no averaging of the two crossings, only the simple
placement, which is what this does.

**The crossing counter is a presence test, not a tally.** `0x0db4`, which the
whole stub test goes through, walks the `on` list to the first entry at or past
the target and on a hit _assigns_ one -- `mov word [bp-0x4],0x1`, a flag where
a tally would increment -- then walks the `off` list backwards the same way and
adds one. It returns nought, one or two and never more; `HorizCrossings` in the
pseudocode counts every occurrence. The two part only where one list holds a
coordinate twice, which nothing recorded does: adopting the binary's form
changes no cell of the recorded corpus and none of the 24,696 fabricated ones.
It is in `glyph-raster.ts` now because it is what the binary does.

One reading was **refused by measurement**. The per-candidate loop looks like a
search rather than a walk in step -- for each `on` it appears to reset the
`off` pointer and take the first entry at or past it -- and pairing that way
costs 3,273 of 24,696 fabricated cells and hundreds of recorded ones. So the
lists are paired by index, as they were, and that reading of the loop is wrong
somewhere.

What is left is a narrowing rather than an answer. The stub test consults the
same six neighbours as this does, the placement is the same, and the counter's
one difference is measurably inert -- **so the two cells are not a difference
in the dropout code at all.** They are a difference in the crossing lists it
reads: in the cent sign's case the rescue turns on a zero-length `on`/`off`
pair that the endpoint topology emits at `(8, -18)` for a vertex lying exactly
on that sample line, and with the vertex a sixty-fourth higher the pair is
absent and both agree. Where that pair comes from is `0x1342`, the endpoint
topology, which section 6 read for its turn logic and not for what it writes.

### The turn is a cross product, and that was the last of it

The dropout code being ruled out, what was left was the lists it reads, and the
pair the cent sign's rescue turned on came from the endpoint topology. So
`0x1342` was read for what it writes, which section 6 never took from it.

Two things are there. The first is a detail this already had by another route:
the `off` an endpoint contributes is emitted one pixel further along than the
`on` when the other coordinate lies exactly on a sample line -- `inc ax` guarded
by the bit for it -- which is what taking `(x + 31) >> 6` for the one and
`(x + 32) >> 6` for the other already does, since those part exactly there.

The second is the answer. **The binary classifies the turn by the sign of the
cross product** of the direction into the vertex with the direction out of it,
together with the quadrant the outgoing direction lies in:

```
cross = (x1 - x0) * (y2 - y1) - (y1 - y0) * (x2 - x1) < 0
```

and emits an `on` and an `off` together only when that sign says so, an `on` or
an `off` alone on a monotone crossing, and otherwise nothing. This decided the
same question by comparing the three points, which section 6 called "the same
rule factored differently". It is not. The two agree on every monotone
crossing, and they part at an extremum lying exactly on a sample line: the
comparison says "a minimum, emit both", and the cross product, for the cent
sign's vertex -- 761, positive, with the outgoing direction up and to the right
-- says emit nothing.

For a fill the two are the same picture, because an `on` and an `off` at one
pixel fill nothing between them. For the dropout's stub test they are not: a
coincident pair counts as a continuation and an absence does not. That is the
whole of what the two scan converter cells were, and it is why nothing else in
either corpus ever showed it.

Transcribed -- both topologies, branch for branch, including the degenerate
guards for a horizontal run continuing horizontally and a vertical one
likewise:

    fabricated glyphs   24,689 -> 24,696 of 24,696;  the six instruments exact
    styles              9,176 -> 9,178 of 9,178
    font, glyphs, hinting, sizes, widths: unchanged

Both instrument cells go, both styled cells go, and the seven wrong cells of
the fabricated corpus with them. What is left in the whole recorded corpus is
two records of `widths`: Courier New's `o` at a horizontal size of four, drawn
unhinted, and Courier New's maximum width at twenty-two pixels asked for five.

### The last two records, and what is proved about them

Two records of `widths` are what the whole recorded corpus now comes to, and
neither yields to the rules that fit the rest. What follows is what has been
ruled out, with the arithmetic, so that the next reading starts where this one
stopped.

**The maximum width of Courier New at twenty-two pixels asked for five.**
Windows reports 5; the box scaled end by end gives 355 sixty-fourths, 5.55
pixels, which rounds to 6. That is the only miss of sixty. The rule cannot be
patched, and the reason is an interval: for Windows's 5, the horizontal size
`x` must satisfy `1345x / 2048 < 5.5`, so `x < 8.373`; for the same face at
twenty-two asked for fourteen, Windows reports 16, which needs
`1345x / 2048 >= 15.5`, so `x >= 23.596`. Writing both as `22w/a` for a common
average `a` gives `a > 13.137` from the first and `a <= 13.053` from the second.
**There is no such average**, and by the same argument no constant box works
either: the first row needs a box below 1331 and the second one at or above 1340. So `tmMaxCharWidth` under a width is not the font's box scaled by any one
size, and the two rows are not both explicable by one formula of that shape.

Refused with counts, each fitting every row but one: the box at the whole
horizontal size (41 of 60), the widest drawn glyph of the realised face (14),
its span in whole columns (15), and `tmAveCharWidth` scaled by the ratio of the
box to `OS/2`'s average, which fits everything except the row asking for
fourteen. That last is the mirror image of the rule in section 3 -- one misses
the narrow row, the other the wide one -- which is the clearest sign that the
quantity is not what either of them computes.

A search over the whole family that rule belongs to says it is at its ceiling.
Every combination of a horizontal size -- the fractional one, rounded, floored,
ceilinged, truncated to sixty-fourths, and either size paired with the vertical
one -- with a working unit of pixels, sixty-fourths or 16.16, and each of five
roundings at both the ends and the final division, is 480 formulas. **Not one
reaches 60 of 60**, and twelve reach 59, all of them the rule as it stands with
its rounding written differently. Adding a constant offset in sixty-fourths does
not help either: the window that would fix the row is 3.65 to 3.81 sixty-fourths
wide and holds no whole number.

`hhea`'s own extent is refused with counts beside it. Courier New's
`xMaxExtent` less its `minLeftSideBearing` is 1321 where `head`'s box is 1345,
and 1321 is below the 1331 the failing row needs -- so it fixes that row and
breaks five others, including both natural sizes, for **55 of 60** against 59.
`head` is the table, and the box is the whole box.

What the intervals say is sharper than "no constant box". Writing each row as
the range of horizontal sizes that would produce Windows's answer, the ranges
tile the line in steps of one box-pixel, and the two Courier New rows at
twenty-two pixels want sizes of at most 8.374 and at least 23.602 for requests
of five and fourteen. Their ratio is 2.818 where the requests' is 2.800, so
**the size per unit of requested width has to rise by two thirds of a percent
between them**. A stretch computed as a 16.16 ratio cannot: its rounding moves
the size by at most a part in fifty thousand. Only a size quantised much more
coarsely could, and the whole horizontal size -- which does exactly that, and
fits all ten of Courier New's rows at twenty-four -- misses Courier New at
sixteen asked for six, and eleven rows of Arial and Times New Roman besides.

**Courier New's `o` at a horizontal size of four**, one pixel, in a glyph
Courier's own `prep` draws unhinted. Scaling the unhinted outline at the
fractional horizontal size rather than the whole one is refused again now that
the topology is right: 2,377 of 2,480 against 2,478. The pixel itself is a
**horizontal dropout rescue**. The letter's right side pinches below a pixel
there, so the `on` and the `off` land on the same column and the run fills
nothing, and the rescue puts ink one column to the left.

What is proved about it is where it is not. Rows seven and eight of the cell
have **the same crossing lists** in this implementation -- `on` at 2 and 4,
`off` at 3 and 4 -- and both rescue. Windows draws the rescued pixel at row
eight and not at row seven. Identical lists cannot produce different pictures
from the same code, so **Windows's own lists differ from these at one of those
two rows**, and the difference is in where a crossing falls, not in what the
dropout does with it. The two rescues are also supported differently: row
eight's stub test is carried by a coincident pair on the row below, and row
seven's by one horizontal crossing on the row above and one vertical crossing
in the column beside it.

The walk that places them has now been read too, and it is this one. The four
quadrant steppers the table at `ds:0x4ae` selects when dropout control is on --
`0x16d3`, `0x173a`, `0x179c`, `0x1802` -- each store a vertical crossing as the
current scan row and a horizontal one as the current column, and the two parts
of the reflection agree with this implementation to the index: an ascending
quadrant stores the horizontal entry before stepping its row, and a descending
one steps first, which is the same one-row offset this carries on the _vertical_
value instead. Their starting indices agree too -- the binary's inclusive
rounding of the near coordinate, less one on a descending walk, is exactly what
`below(y1) >> 6` gives here. Working an actual chord through both, the `o`'s
descending chord from (205, -404) to (228, -418) starts at row -7 and puts its
first vertical entry at -6 in either reading.

The flattening was read after it, at segment 44's `0x42`, and it is this
implementation too: the octagonal norm and the count of divisions by four with
its start at one and its clamp at eight; the halving past a depth of five, with
the new control at `(p1 + p2 + 1) >> 1` and the new end at
`(p1 + 2p2 + p3 + 2) >> 2`; the accumulator scaled by the square of the step
count, seeded with the second difference less the first shifted by `depth + 1`,
the second difference doubling as it goes, and each point taken as
`(accumulator + half) >> shift`. All of it line for line. One thing in it is
not implemented here and has never been reached: the routine keeps a running
total of steps for the glyph and abandons the curve outright once that total
passes 257.

So the two rows differ in none of it -- not the dropout, not the endpoint
topology, not the walk's emission or offsets, not the flattening. Instrumenting
the last term settles where they do differ. The vertical crossing at column
three that carries row seven's stub test is not from the walk at all: the walk
emits only two entries in that column, at rows twelve and six. The one at row
seven comes from the **endpoint topology**, at a flattened chord endpoint whose
`x` is 224 -- exactly the centre of column three -- with the outline turning
left and up through it. Worked through the binary's own tree that vertex emits
an `on` there, and its value rounds to the same row, so Windows has the entry
too and should rescue as this does.

Which leaves the endpoint itself. It is a stepped point of the flattening,
rounded to a sixty-fourth, and it lands exactly on a sample column; a
sixty-fourth either way and the topology never fires, the continuation is one
short, and the rescue does not happen. **The whole of the disagreement is
whether that one chord endpoint is 224.**

It is. The curve is the one from the implied midpoint (239, -484) through the
control (225, -439) to (205, -439), at a depth of one, and the point in dispute
is its midpoint: a quarter of 239 plus half of 225 plus a quarter of 205, which
is **exactly 223.5**. The accumulator holds 894 against a shift of two, and
adding the half and shifting arithmetically -- which is what `add eax,ebx` and
`sar eax,cl` do at `0x0222` -- gives 224 in either reading. The design
coordinates behind it are 999 and 774 units, which scale to 124.875 and 96.750
sixty-fourths, neither near a rounding boundary, so the scaling does not decide
it either. And the scan control words of all three faces carry none of the
stretched-text bits, so dropout control is on for a stretched glyph exactly as
it is for a square one.

So Windows has the same chord endpoint, on the same sample column, with the
same turn through it, and a stub test that this implementation now matches
neighbour for neighbour.

The outline's own scaling was the one stage left, and it is measured now rather
than read. `arial-half-400` is a rectangle whose left edge is at 400 units and
whose bearing is set to match, so nothing is carried, and whose whole program
reads that corner along `x` and puts it on the advance phantom at sixty-four
times. Four hundred units at 2,048 to the em is 12.5 sixty-fourths for each
pixel of horizontal size, so the product lands exactly on a half at seven of
the swept widths and not at the others. **Windows rounds every one of those
halves up**, at thirteen, fifteen, seventeen, twenty-one, twenty-three,
twenty-seven and thirty-seven pixels across, and agrees at the rest -- which is
what `toPixels` does. The `o`'s three outer points at exactly 135.5 are 136 in
Windows too. The side bearing is nought for every glyph of all three faces, so
nothing is carried across it either.

That is six stages read or measured against Windows, and the pixel survives all
six. What it now rests on is sharper than a stage. Rows seven and ten of that
cell are geometric mirror images and have identical crossing lists here, and
**Windows draws the rescued pixel at row ten and not at row seven**. Both
rescues need a vertical crossing at column three that the endpoint topology
emits, one an `on` where the outline crosses the column leftward and one an
`off` where it crosses rightward, and both are monotone crossings that no
reading can refuse. Windows honours one and not the other.

What distinguishes them is not the crossing but the neighbour. A rescue's stub
test wants two continuations on each side, and at rows eight, nine and ten the
row above supplies both on its own -- each of those rows carries a coincident
`on` and `off` at the same column, which is two. **Row seven is the only one
whose count has to reach two by adding a vertical crossing to a horizontal
one**, because the row above it carries only an `off` there. So the question is
sharper than "does Windows have the vertical entry": it is whether a horizontal
term and a vertical term add together at all.

One earlier refusal needs correcting in the light of the storage. The dropout
loop at `0x0a2f` does not walk the two lists in step: for each `on` it resets
the `off` pointer to the base and takes the first entry at or past it. On lists
that are well formed -- each run's `off` at or before the next run's `on` --
that is the same pairing, and it differs only where one run's `off` equals the
next run's `on`, where the search pairs the `on` with the _earlier_ `off` and
calls it a zero-length run. Implementing it cost 3,273 fabricated cells, which
says Windows does not produce that extra rescue; but the experiment was run
against lists sorted the way this implementation sorts them, and the binary's
are in the order the walk appended them. The two are not the same experiment,
and the refusal should be read as refusing the search _on sorted lists_ only.

### The `o` on an instrument, and the one thing that moves it

The cell is now on the same instrument the other two scan converter cells were:
`courier-o-plain` is Courier New's `o` exactly as it is scaled at thirteen
pixels by four, written into Symbol's `A` slot as an unhinted shape at twenty
pixels. **It reproduces the disagreement**, row for row, in another font at
another size with no hinting: Windows draws the rescued pixel on three of the
four pinched rows and this draws it on all four.

`courier-o-nudged` is the same with the inner contour a single sixty-fourth to
the right, and it **agrees in full**. That one sixty-fourth is what the whole
thing turns on, and instrumenting both says exactly what it changes. In the
plain shape a chord endpoint lands at 224, the centre of column three, so the
walk steps past that column and the endpoint topology emits the crossing
instead; nudged, the endpoint is at 225, the outline genuinely crosses the
column, and the walk emits it. **The two shapes' `on` lists for that column are
identical either way** -- the entry is at the same row with the same value, and
the counter finds it in both -- and yet Windows honours the rescue only when
the walk put it there.

So the distinction Windows draws is not between the presence of the crossing
and its absence, which is the only thing this implementation records. Making
the endpoint topology emit no vertical entries at all is refused outright,
24,583 of 25,400 fabricated cells against 25,398, so the entries are needed.
Two controls then moved one arc of the inner contour at a time, and they turn
the question over. `courier-o-upper` moves only the upper arc -- the one that
puts the endpoint on column three -- and **the lists it produces here are
identical to the plain shape's, entry for entry**, and Windows still refuses the
rescue. `courier-o-lower` moves only the lower arc, a third of the glyph away
from the disputed row, and Windows allows it.

| variant | our lists differ from plain          | Windows draws the row |
| ------- | ------------------------------------ | --------------------- |
| plain   | --                                   | no                    |
| upper   | not at all                           | no                    |
| lower   | row nineteen, and one vertical entry | yes                   |
| nudged  | the same two                         | yes                   |

The change that decides it is at **row nineteen**, four rows below the pixel:
the plain shape has two `on` entries at the same column there, and the moved
lower arc has them at different columns. The rescue in dispute is at row
fifteen, and nothing in any rule read so far -- the stub test's six neighbours,
the covered test, the placement -- reaches four rows away.

**So the effect is not local, and that rules out every per-row rule.**

Two more variants narrow what "the lower arc" means, and both still disagree:
moving the single control point nearest the vertex, and moving the other four
points of that arc while leaving it alone. Only the whole arc together moves
the thing that matters, which is one flattened vertex at the bottom of the
counter. In the plain shape it lands at 224 in `x` and -1248 in `y`, **exactly
on a sample column and exactly on a sample line at once**, and both topologies
fire at it: the horizontal one puts an `on` at column three, duplicating what
the walk already emitted there, and the vertical one puts an `off` in column
three at row nineteen. Move the arc and the vertex is at 225, the horizontal
`on` lands at column four instead, and the vertical emission does not happen.

Those two entries are the whole difference, and neither is anywhere near the
row in dispute. Row fifteen's own crossings are identical in every variant,
the entry its stub test reads -- the vertical `on` at column three, row fifteen
-- is emitted by the topology from an untouched vertex in every variant, and
the counts per list are the same on both sides, so it is not an overflow of a
block either.

    variant                     what moves            Windows draws row fifteen
    plain                       --                    no
    upper arc                   nothing in the lists  no
    one control point           nothing in the lists  no
    the arc but that point      nothing in the lists  no
    the whole lower arc         two entries, rows 19-20   yes
    the whole inner contour     the same two          yes

#### The crossing lists are not the channel

Four more variants close this off. The lower arc was moved in `y` rather than
`x`, a sixty-fourth and two sixty-fourths in each direction, which leaves the
counter's bottom vertex on the sample column and takes it off the sample line.
**All four agree in full**, 352 of 352 cells each, and so does every earlier
variant that moved the vertex off the column. The refusal happens only when the
vertex is on both at once.

That much was expected. What was not is where two of them land in this
implementation:

| variant      | vertex       | our `on` list at row 19 | Windows draws row fifteen |
| ------------ | ------------ | ----------------------- | ------------------------- |
| plain        | (224, -1248) | `[3,3]`                 | no                        |
| `yshift`, +1 | (224, -1247) | `[3,3]`                 | yes                       |
| `yup2`, +2   | (224, -1246) | `[3,3]`                 | yes                       |
| `ydown`, -1  | (224, -1249) | `[3,4]`                 | yes                       |
| `ydown2`, -2 | (224, -1250) | `[3,4]`                 | yes                       |
| `lower`      | (225, -1248) | `[3,4]`                 | yes                       |

`yshift` and `yup2` produce **byte-identical crossing lists to the plain
shape** -- all four lists, every row, every column, every value and every
order -- and Windows draws them differently. The lists were dumped from
`fillWalked` after the sort and compared entry for entry; nothing differs.

**So the crossing lists are not the whole input to the dropout decision.**
Either the lists the binary builds differ from these somewhere invisible here,
or what decides the rescue reads something else about the outline. Every
per-row rule, every rule about counts, presence, pairing or order in these four
lists is ruled out by construction: two shapes with the same lists cannot be
told apart by any function of them.

The sub-pixel channel is not it either. `spline.c`'s `CalcHorizSpSubpix` and
`CalcVertSpSubpix` serve smart dropout control, and every installed face was
read for what it asks: Arial, Courier New, Times New Roman, Symbol and
Wingdings, in all fourteen installed styles, set `SCANTYPE` to 1. The
sub-pixel routines never run for any of them, so no face here carries a channel
this implementation is missing on that account.

Where the `on` list's second entry comes from is worth recording, since it
explains the table's middle column without explaining the disagreement. The
walk's chords for the arc come out of `EvaluateSpline` at depth one, so the arc
from (205, -1259) to (239, -1214) is two chords through (224, -1248). Plain,
that midpoint sits exactly on the row's sample line, the walk emits nothing for
it, and `CheckHorizTopology` supplies the crossing at `(224 + 31) >> 6`, which
is column three. Shifted up, the chord crosses the line before reaching the
vertex, at about x=222, which is column three again. Shifted down, the chord
misses the line entirely and the next one crosses it at about x=224.4, which is
column four. The `[3,3]` and `[3,4]` columns above are that, and the two
mechanisms that produce a three are indistinguishable once the entry is in the
list.

#### And the decision half is a pure function of them

`seg42:0978` is the horizontal dropout pass, and reading it end to end says
what the decision is allowed to depend on.

Each row's crossings live in one block of a fixed stride. The `on` list grows
up from the base with its count in the first word; the `off` list grows **down**
from the end of the same block with its count in the last. That is why the
counter at `0db4` walks one forward and the other backward, and why both stop
early once past the target -- the lists are sorted ascending read that way.

The pass takes each `on` value in turn, resets the `off` pointer to the base
and takes the first entry at or past it, and calls it a dropout when the two
are equal. Then, when the stub bit is set, it asks the two sides and requires
**two from each**. Each side is the same three terms with an early exit as soon
as the running total passes one:

    below (0x0e28)   horiz(x, row + 1) + vert(x - 1, row + 1) + vert(x, row + 1)
    above (0x0eaa)   horiz(x, row - 1) + vert(x - 1, row)     + vert(x, row)

which is the offset this implementation already carries, and the two vertical
terms are guarded by the box rather than skipping the decision. Placement then
clamps to the box, and where it does not clamp it goes through `0x0c8a`, which
is a **test-and-set**: it sets the pixel at `x - 1` only if the pixel at `x` is
clear. All of that is in `glyph-raster.ts` as it stands.

Nothing in any of it reads the outline. The loop, the pairing, the stub test,
the placement and the test-and-set take the four crossing lists and the box and
nothing else. **So the whole decision half is a pure function of the lists**,
and since `courier-o-plain` and `courier-o-yup2` share their lists exactly and
Windows draws them differently, the remaining error is in the _construction_ of
the lists rather than anywhere downstream of them.

That narrows it hard, and it also refuses the obvious repairs. The one
structural difference between the two shapes is which emission supplies the
`on` entry at row nineteen: plain's doubly degenerate vertex fires the
horizontal endpoint topology, and the shifted shape's walk crosses the line and
emits the same value itself. Dropping either emission was traced through the
stub test by hand and neither reaches row fifteen: the terms that decide it are
the `off` entry at row fourteen and the vertical `on` at column three, and both
come from the top of the glyph, which no variant touches. Whatever the binary
records that this does not, it is not one of those two emissions.

#### The one non-local mechanism there is, and why it is not this either

There is exactly one way a change at the bottom of a glyph could reach a row
above it, and `scanlist.c` spells it out. The crossing lists are not
independently allocated. One flat array holds them all, and the setup walks the
scanlines from the bottom of the band upward handing each row two consecutive
regions -- `on` then `off` -- each as long as the number of crossings the
**reversal list** predicts for that scanline. A row that produces more
crossings than were predicted for it therefore runs into the region belonging
to the row above.

That is the shape of the answer this needs: rows are laid out from the bottom
up, so a spill travels upward, and the row this disagrees about is four rows
above the vertex that decides it.

It is still not the answer. The prediction comes from the reversals, and a
reversal's scanline is its coordinate plus half a pixel, less one when it is a
descending turn, shifted down six. The inner contour's two turns in `y` sit at
-1259 and -951, and the whole point of the four `y` variants is that they move
the lower one: to -1257, -1255, -1261 and -1263. **Every one of those lands on
the same scanline as the original, in both directions**, because none of them
is within a sixty-fourth of a sample line -- their remainders are 17 through 25
where a sample line wants 32. The estimate, the per-row capacity and the layout
of the whole array are therefore identical for all five shapes, and no list can
overflow in one and not another.

So the allocation is ruled out for a reason rather than by a count, and with it
the only non-local mechanism the scan converter has.

#### Counted across the whole corpus

The condition is necessary and nowhere near sufficient, and the corpus says so
in numbers. Every fabricated glyph recording was replayed with the walk counting
vertices as it went:

| cells                                                  | agreed  | disagreed |
| ------------------------------------------------------ | ------- | --------- |
| no doubly degenerate vertex anywhere                   | 242,389 | 0         |
| a vertex on a sample line and column at once           | 1,087   | 8         |
| ...where both topologies emit at that vertex           | 858     | 8         |
| ...and a rescue whose stub test needed a vertical term | 168     | 8         |

The eight are the same eight throughout: `courier-o-plain`, `-upper`, `-q10` and
`-rest`, at both weights. Not one cell without such a vertex disagrees, so
nothing is being missed elsewhere; and 168 cells carry the whole configuration
-- the vertex, both emissions, and a marginal rescue -- and are drawn exactly.
They span 53 fixtures, so it is not one instrument's quirk either.

Whatever separates the eight from the 168 is therefore finer than "a doubly
degenerate vertex near a marginal rescue", and the search for it cannot be a
search through the crossing lists, which the two shapes share.

#### Eleven mutations, all refused

Reading having run out, the walk was mutated instead and every variant scored
against the fabricated corpus. The base is 31,682 cells of 31,690 exact with 8
wrong pixels:

| mutation                                                 | cells  | wrong pixels |
| -------------------------------------------------------- | ------ | ------------ |
| base                                                     | 31,682 | 8            |
| the vertical `on` emission rounds like the `off` one     | 31,682 | 8            |
| the vertical `off` emission rounds like the `on` one     | 31,682 | 16           |
| the horizontal `on` emission rounds like the `off` one   | 31,661 | 41           |
| the horizontal `off` emission rounds like the `on` one   | 31,576 | 116          |
| a doubly degenerate vertex skips the horizontal topology | 31,560 | 404          |
| a doubly degenerate vertex skips the vertical topology   | 31,679 | 22           |
| a doubly degenerate vertex emits neither                 | 31,560 | 425          |
| it emits a horizontal `on` and `off` both                | 31,607 | 223          |
| it emits a vertical `on` and `off` both                  | 31,679 | 14           |
| its horizontal emission is keyed a row further on        | 31,559 | 611          |
| the vertical `on` list is read a row either way          | 31,643 | 65           |

Not one is better and only one is neutral -- rounding the vertical `on` emission
the other way changes nothing anywhere, so no vertical `on` from a vertex ever
lands exactly on a sample line in the whole corpus.

That is what the geometry already said it would say. The three terms the
disputed rescue weighs -- the `off` entry at row fourteen and the vertical
entries at column three and column four, all read at row fifteen -- are
produced by the top of the glyph, four rows above the vertex, and no rule keyed
on that vertex can reach them. A mutation that helps here has to be one that
changes what the _walk_ records, not what the endpoint check adds to it.

#### Three checks that leave the conclusion where it is

The measurement was confirmed without replaying anything. Comparing the
recorded cells for the two weights straight out of the fixtures, Windows draws
`plain`, `upper`, `q10` and `rest` identically and the other six differently,
at both weights. So the difference is genuinely in what Windows drew.

The outline was confirmed too. Only four segments move under the shift, all in
the inner contour, spanning `y` from -1105 to -1259, which is rows seventeen to
twenty. The outer contour is identical segment for segment. The disputed
rescue's three terms are read at rows fourteen, fifteen and sixteen, so nothing
the shift touches is inside them.

And the routine was confirmed to be the only one. A linear pass over segment 42
finds one call to the span filler at `0x059b` and one to the dropouts at
`0x0978`, both from a single driver that fills first and then drops out only
when its flag is set; the two side routines are called twice each from inside
`0x0978` and nowhere else; and the crossing counter at `0x0db4` is called six
times, all of them from the two sides. There is no second dropout pass to have
read instead.

So the conclusion is not a contradiction after all, only a very tight
statement: **the crossing lists the binary builds differ between two outlines
that give this one identical lists**, and the difference must be visible from
row fifteen's stub test, which reads rows fourteen to sixteen and columns three
and four. What the shift moves is four rows away in every direction that has
been measured.

#### And the subdivision depth, refused four ways

One place is left where two shapes a sixty-fourth apart could get different
lists out of the binary and the same ones out of this: the number of chords the
spline is cut into. Our arc is cut in two, and its midpoint is what lands on the
sample line and the sample column at once. Cut it differently and the vertex
moves, so the depth is worth scoring rather than arguing.

| mutation                              | cells  | wrong pixels |
| ------------------------------------- | ------ | ------------ |
| base                                  | 31,682 | 8            |
| one more halving everywhere           | 30,020 | 2,771        |
| one fewer halving everywhere          | 29,603 | 4,749        |
| the octagonal norm's threshold halved | 30,580 | 1,673        |
| the same threshold doubled            | 30,044 | 3,184        |

The depth as read costs between 1,665 and 4,741 wrong pixels to change in any
direction, so the chords are the binary's chords and the vertex is where this
puts it.

#### Every input to the decision, checked

`seg42:0978` makes six kinds of call and no others: the crossing counter, the
two side routines that wrap it, the plain set, and the two test-and-sets. So the
decision's inputs are the crossing lists, the box, and whatever ink is already
down. All three were compared between `courier-o-plain` and `courier-o-yup2`:

- **the lists** are identical, every list, key, value and order;
- **the box** is identical, left 2, right 4, top 14, bottom 20, and not narrow;
- **the ink** is identical, because the lists are, and the rows are rescued from
  the bottom up so nothing from a lower row reaches row fifteen's own column.

The stub gate is identical too. It is `dx & 1` from the scan kind or a local
that the routine sets to nought once and never writes again, in both halves.

That is every input, and the two shapes agree on all of them while Windows draws
them differently. One of the readings above must be wrong, and the geometry says
which it cannot be: the flattening is the same code as `spline.c`, the walk is
the same code, the box is measured, and 242,389 cells with no such vertex agree
without exception. The contradiction is recorded here rather than resolved.

#### The configuration, counted over the recorded corpus as well

The same count was run over every top-level fixture -- the recordings made from
the fonts Windows actually ships, 32,600 records of them. 175 carry a doubly
degenerate vertex and 22 carry one beside a rescue whose stub test needed a
vertical term.

**Exactly one carries the vertex and a marginal rescue at the same row and the
same column**, and it is the original disputed cell: Courier New's `o` at
height sixteen under a width of three. Its five marginal rescues are the
instrument's five, four rows apart and otherwise identical -- rows 7, 9, 9, 10
and 11 against rows 15, 17, 17, 18 and 19, the same `on` columns, the same
horizontal and vertical terms. So the instrument reproduces the original in its
stub arithmetic and not merely in its pixels.

Across both corpora the configuration occurs nine times and disagrees nine
times, and no cell that agrees carries it. That is the sharpest description
there is of what goes wrong, and it is a description rather than a rule: the
nine are one glyph at two sizes, so the separation has no more evidence behind
it than the single shape does, and inventing a rule from it would be fitting one
sample.

The coinciding rescue is the one at the vertex's own row, and it is refused on
both readings -- its lower side has nothing below it, one crossing where two are
wanted -- so it is not itself the pixel in dispute. It is four rows below that
one, which is where this started.

Four more mutations were scored and refused with it, all of the vertical terms'
row offsets, since the binary reads them one row apart from the horizontal term
and this carries that offset in the values instead:

| mutation                              | cells  | wrong pixels |
| ------------------------------------- | ------ | ------------ |
| base                                  | 31,682 | 8            |
| the two sides' vertical rows swapped  | 29,200 | 5,510        |
| both sides read the rescue's own row  | 29,498 | 3,470        |
| both sides read the row below         | 29,790 | 2,795        |
| the two sides reach a row further out | 28,468 | 7,019        |

The offsets as they stand are right by a wide margin, so the encoding is not
where the difference hides either.

The reading has to explain how a doubly degenerate vertex at the bottom of a
glyph reaches a dropout four rows above it **without passing through the
crossing lists**, since two shapes that differ only in that vertex share their
lists exactly and are drawn differently. Nothing in the scan converter as read
does, the counts rule out the block sizing that `fsc_GetHIxEstimate` computes
from the outline's reversals, and the sub-pixel lists are switched off by every
face's `SCANTYPE`. Ten instruments are committed so the comparison can be
picked up exactly where it stands.

A refusal to record with it: pairing the horizontal rescue's vertical terms one
row earlier, which is what the pseudocode's `DoHorizDropout` says literally --
`VertCrossings(x - 1, y)` and `VertCrossings(x, y)` against the horizontal
term's `y - 1` -- costs 305 cells of `glyphs` and 665 of `styles`. The vertical
values here already carry the step the horizontal keys take from theirs, so the
pseudocode's pairing is this one written in the other convention.

One asymmetry was found beside it and deliberately left alone. The side bearing
an unhinted glyph is carried across is scaled by the **vertical** size, where a
bearing is a horizontal quantity and a width request makes the two different.
Scaling it by the horizontal size instead changes nothing anywhere: every face
whose `prep` refuses to hint under a width is fixed-pitch, and its glyphs have
their left bearing exactly at the box, so the quantity is nought either way.
Nothing measures it and nothing reads it, so it stays as it is and is written
down here instead.

## 9. Where the numbers stand

Every fixture the oracle has recorded, replayed against this implementation as
it stands:

| Fixture                                                      | Records | Agreement |
| ------------------------------------------------------------ | ------- | --------- |
| `font`                                                       | 5,057   | **100%**  |
| `glyphs`                                                     | 6,046   | **100%**  |
| `hinting`                                                    | 8,470   | **100%**  |
| `lines`                                                      | 248     | **100%**  |
| `strings`, `text`, `profile`, `memory`, `handles`, `devcaps` | 322     | **100%**  |
| `styles`                                                     | 9,178   | **100%**  |
| `sizes`                                                      | 800     | **100%**  |
| `widths`                                                     | 2,480   | 99.9%     |

`KNOWN_GAPS` is empty. The `stack` fixture is not in the table because it is an
instrument rather than an oracle: its 3,650 records are the scaler's own stack,
which nothing on this side is meant to reproduce, and the conformance suite
reports them as unsupported.

The fabricated corpus -- the fonts rewritten to isolate one mechanism each, which
ask questions no stock face does -- stands at **28,170 of 28,170 cells and no
wrong pixels**.

### The chase, end to end

What follows in this section is the chase as it happened, sitting by sitting, and
**the figures inside it are the figures at the time**. This is what it came to.

**It began with ten records and a corpus that was already good.** `font` was
5,047 of 5,057, `glyphs` 5,982 of 5,982, and the fabricated set 25,882 of 26,058.
The ten were three separate rules, and each of them turned out to be about a face
Windows has to invent something for.

- **A slant Windows synthesises is measured the way it is drawn.** Symbol has no
  italic file, so an italic request gets the upright sheared -- drawn from the
  raw outline with no program run, as section 3 had established, and _measured_
  the same way. Its heights are the design ascent and descent scaled and rounded
  at the size `VDMX` picks for the upright, and its advances are the scaler's
  unhinted ones: origin phantom at `xMin - lsb`, advance phantom that far again
  plus the advance, each rounded to a sixty-fourth, differenced, rounded to a
  pixel. Rounding the design advance instead misses 51 of 6,014 recorded
  advances; this misses none.
- **A strike loses to the wrong name at ten thousand.** Four bitmap families at a
  hundred pixels answer with Arial at proof quality, and the mapper's own penalty
  table says why: a strike of the face asked for pays 150 a pixel it is short, an
  outline of another face pays 10,000 flat. Fixedsys is 12,750 away and loses; MS
  Serif is 9,750 and keeps its own, which the corpus had recorded without being
  asked.
- **And GDI's font directory is not the `SYSTEM` directory.** It is the boot fonts
  from `SYSTEM.INI` and then `WIN.INI` `[fonts]` in the order written, each `.FOT`
  naming its `.TTF` -- which is why the tie among outlines goes to Arial.

**Then a hole the corpus could not see.** With the metrics closed, `measure`
stepped a synthesised slant by one advance and `Surface` stepped its pen by
another, each with a comment saying they agreed. Nothing could catch it: every
cell of the glyph corpus draws a single character, and a single character never
steps. The stack probe could not answer it either -- a two character `TextOut`
leaves a clip of the cell where the box should be, so a string is built by a path
a single character does not take. Sixteen pairs of pixels did: **sixteen of
sixteen slanted pairs wrong, all sixteen upright controls clean.**

**The point buffer, in three parts.** The fabricated corpus's remaining error was
almost all in one instrument, and every wrong cell in it was an accented letter --
because `slope-sweep` cuts thirty-six base letters down to four points and leaves
the composites built on them alone, so their programs name points that are no
longer there. The reference does not stop them: every `CHECK_POINT` in it is
inside `FSCFG_DEBUG`. What it does instead is write past the end of a buffer
allocated from `maxp`. Arrays that _grow_ are not memory that overflows, and the
difference was the whole of it -- the phantoms are read as `length - 3`, so one
write past the last point moved the end and turned every such letter into a bar
in column nought. Sealing the count, padding to `maxp`, and **carrying the
previous glyph's tail forward** rather than clearing it took the corpus from
25,882 to 26,055. GDI's own layout later confirmed the shape to the word: the
dot's `x` array and its `y` array sit 107 apart, and `maxPoints` is 103.

**Two glyph cells, and a rule read rather than fitted.** What was left of the
recorded corpus was Symbol slanted at a thirty-two pixel cell. Six rounds refused
the shear's rounding, the lean, the subdivision depth, the threshold, the turning
point splits and the bitmap row shift -- each by hundreds of records -- and the
answer was none of them. It was **the point between two off-curve controls**: a
font expects their midpoint, and what nothing says is _which coordinates_ it is
the midpoint of. Halving the scaled ones and rounding up, `(a + b + 1) >> 1` --
the same halving `EvaluateSpline` uses for its own subdivision -- put the glyph
corpus at **6,046 of 6,046** and emptied `KNOWN_GAPS`.

**And then eight sittings on a single box.** One recorded box in 528 sat a column
right of where the rule that fits the other 527 puts it. Refused in turn: the
carry in whole pixels (38 wrong), scaled by the cell height (36), `MulDiv`
rounding (2), a half up (2); the box's left edge from `xMax` (388); a stale
recording (re-recorded, identical); a different pixel size (Windows's own metrics
say six per em). The residue was opened on the whole frame and **twelve bytes of
2,240 differ between the two cells, not one of them a coordinate** -- so the box
arrives already made.

**That is what the heap probe was built for.** `TOOLHELP` walks every block in the
system, turns a handle into a selector and reads through it without the program
holding a pointer it might not be allowed to hold. Aimed by hashing blocks before
and after a draw, it found the scaler's memory -- and then the reason the stack
had never held anything: **the scaler runs on a stack of its own.** Its thunk sets
`ss` to a relocated segment and `sp` to a saved offset before it calls. Every
frame the scan converter builds had been out of the residue probe's reach from the
beginning. In that segment the point array reads straight off -- `48 48 66 66` for
the dot's four corners -- and the word after it, swept across eleven bearings, is
`-ceil(shift * ppem * 64 / upem - 0.5)` exactly, **eleven of eleven**, halves and
all. The carry rule, until then fitted to pixels, read out of memory.

**The answer came from a sweep, not a breakpoint.** With `(min + 31) >> 6` and
`(max + 32) >> 6` read out of segment 42's instruction stream, eleven cells four
units apart could be _inverted_ rather than merely scored: each recorded column
brackets its edge to sixty-four sixty-fourths, and eleven overlapping brackets
left `min = 193 + carry` and `max = 256 + carry`, fitting all 22 boxes at that
size. Read at every other size, the sweep agreed with the implemented rule
everywhere and failed only at six per em -- and six and seven are the only sizes
where the two readings of the carry are far enough apart for any sweep to land
between them.

> **The bearing is carried in whole pixels below seven pixels per em and in
> sixty-fourths at seven and above.** Nought wrong of 704 recorded boxes; the
> boundary at eight costs sixteen and at nine seventeen.

The box that had looked like GDI contradicting its own rule for eight sittings
was its own rule all along, at a size where the rule is a different one.

**And the last cell was a phantom point.** The composite's twenty-three byte
program shifts a contour with `SHC`, whose displacement is `x[pt] - ox[pt]`, and
the trace gives `pt` as 62 and 68 in a glyph with thirty-two points -- it reads
past its own outline into what the last glyph left. Four sittings called that
unreproducible. Inverted, it came to one number, half a pixel at index 62; and
index 62 was the fourth phantom of the `ß` six records earlier, which this wrote
as nought. GDI's element, read out of its own block after the draw -- six arrays
`maxPoints + 4` words apart, the fitted `ß` matching this one 63 of 63 in `y` --
holds `0 896 0 30` in those four slots: the origin, the advance, the origin
again, and **`xMin`**, which for the Symbol dot reads `-30 233 -30 48` and settles
it. A slot holding a scaled `xMin` rounds by up to half a pixel where nought
rounds to nought. Written that way, the corpus is whole.

**On method.** Three things are worth keeping from it. A sweep beats a
breakpoint for a boundary: `dot-fine` cost one fabrication and one recording and
bracketed a rule's failure to a single sixty-fourth, where a mechanism that
stopped the machine mid-call would have read one set of numbers for one cell.
Refusals are worth writing down with their cost, because the eight readings this
chase refused are what made the ninth readable. And a rule fitted to a corpus and
a rule read out of an instruction stream are not the same kind of thing --
`(min + 31) >> 6` was both, and it was only useful as a lever once it was the
second.

The rest of this section is that chase in the order it happened.

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
