---
kind: function
module: GDI
name: GDISelectPalette
ordinal: 361
summary: GDI's half of SelectPalette: selects a palette into a device context for the foreground or the background, and answers the palette before.
versions:
  '3.1': exact
probes: [dcinner, palreal]
topics: [palettes]
---

## Observed behaviour

- [[measured]] It answers the palette the context had ([[probe:dcinner]]).
- [[measured]] Selected for the foreground, the palette becomes GDI's foreground palette: [[fn:GDI.IsDCCurrentPalette]] then answers 1 for any context with it selected, one it was selected into for the background too.
- [[measured]] USER's [[fn:USER.SelectPalette]] of a memory context passes the background: `IsDCCurrentPalette` stays nought.

## Inside Windows

[[read out]] `GDI.EXE` seg22 `0271` exchanges the context's palette at 1Ah for the one given, keeping the palettes' counts of contexts. For the foreground, a palette that is not GDI's foreground palette (`[480h]`) becomes it, and no palette is then the one realized last (`[482h]` nought).

USER's `SelectPalette` (`USER.EXE` seg6 `00a2`) passes the background where it was asked for, where the palette is the stock one, and where the context is no window's or the window is neither the active one nor in it.

## Implementation

In both engines as read out, and USER's `SelectPalette` passes it the background as USER does ([[topic:palettes]]). [[probe:dcinner]] agrees in both on the VGA and the 256-colour display, and [[probe:palreal]] still does.
