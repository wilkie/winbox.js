---
kind: topic
name: Window classes
summary: What GetClassInfo answers for a program's class and for USER's own, what RegisterClass answers, and whose a window made with no instance is — as three probes recorded them.
probes: [classinf, nullinst, unregcls]
---

A window class is registered by an instance and found by its name. [[probe:classinf]] registers one of its own and asks [[fn:USER.GetClassInfo]] about it, about USER's own classes, and about names that are no class.

## Finding a class

- [[measured]] Asked with an instance, `GetClassInfo` finds the classes that instance registered. The name matches in any case: `CLASSINFO` finds `ClassInfo`.
- [[measured]] USER's own classes are found with no instance, and not with a program's: `Button` asked with the probe's instance is not found. A program's class is not found with no instance.
- [[measured]] A name that is no class answers nought, with an instance or without.
- [[measured]] The answer for a class that is found is its atom: one of USER's string atoms, C000h or above, the same each time it is asked, for a class named by a string, and 8002h for the dialogs' class.

## What it fills in

- [[measured]] For a program's class, what it was registered with: its style, its procedure, its class and window extra bytes, its instance, icon, cursor and brush, and its menu's name. The class's name is the pointer that was passed in.
- [[measured]] For USER's classes, no icon, no brush and no menu, a cursor, USER's instance, and their own style and window extra bytes:

  | class | style | window bytes |
  |---|---|---|
  | `Button` | `8Bh` | 3 |
  | `Edit` | `88h` | 6 |
  | `Static` | `80h` | 6 |
  | `ListBox` | `88h` | 2 |
  | `ScrollBar` | `8Bh` | 10 |
  | `ComboBox` | `88h` | 2 |
  | dialogs, `8002h` | `2808h` | 30 |

## What RegisterClass answers

- [[measured]] [[fn:USER.RegisterClass]] answered 1 for the probe, a program made for Windows 3.0, not the class's atom that `GetClassInfo` answers. Windows 3.1 is documented to answer the atom; whether a program made for 3.1 gets it is not measured.

## A window with no instance

- [[measured]] [[probe:nullinst]] makes a window at the top and a child with an instance of nought. USER keeps the program's own instance for each, its data segment less one ([[topic:task-startup]]), and calls the window's procedure with that data. The recording cannot tell it from the class's instance, which was the same there.
- [[measured]] A Cribbage of the corpus makes its windows this way. With nought kept, its procedure ran with DS 1 and faulted.

## Letting a class go

[[measured]] [[probe:unregcls]] registers classes and lets them go with [[fn:USER.UnregisterClass]], as a Solitaire of the corpus does as it ends. It asks [[fn:USER.GetClassInfo]] whether each class is still found. winbox.js agrees with all 11 records.

- [[measured]] The program's own class goes, and the answer is 1. The name is matched without regard to case.
- [[measured]] A class that is not there, one already gone, one named with another instance, and USER's own `BUTTON` all answer nought and are left as they are.
- [[measured]] While a window of the class is left, the answer is nought. Once that window is destroyed, the class goes.
- [[measured]] [[fn:USER.GetInputState]] answers nought with nothing waiting, and with a `WM_KEYDOWN` posted, which is a message and not input.

## In winbox.js

`src/win16/user/GetClassInfo.ts` has the call; it writes the ten fields itself, since USER's procedures are functions here and a menu's name is kept as a string. `RegisterClass` answers the class's handle, which is the known gap in [[probe:classinf]]'s conformance. USER's classes other than the controls and dialogs are not answered.
