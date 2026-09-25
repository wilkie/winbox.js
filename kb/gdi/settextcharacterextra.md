---
kind: function
module: GDI
name: SetTextCharacterExtra
ordinal: 8
summary: Sets the extra space added after every character a device context draws or measures.
versions:
  '3.1': exact
probes: [textxtra]
---

## Observed behaviour

- [[measured]] The gap goes after each character: the ink's right edge moves by exactly the spacing times the characters before it. 24 of 24 on a VGA and on an EGA. See [[fonts:8q]].
- Not yet measured: whether the gap after the **last** character counts toward a string's width, which decides the ground, how far the rules run and where `TA_RIGHT` and `TA_CENTER` put the string.
- [[read out]] GDI's own synthesised bold raises the extra by one while it draws. See [[topic:synthetic-bold]].

## Implementation

The replay of [[probe:textxtra]] sets the spacing through this call, as the probe did, and every record agrees. The previous spacing it returns is not recorded.
