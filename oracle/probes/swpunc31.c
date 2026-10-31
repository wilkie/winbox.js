/*
 * `swpunc`'s cases from a program marked for Windows 3.10 (`PROBE_WIN31`:
 * its header's expected version 30Ah), so that each window has USER's bit
 * 4 of the byte at 26h (`USER.EXE` seg8 `0425`-`0432`). A list of
 * windows all shown is counted only where they are of a program made before
 * 3.10 (seg7 `08c6`-`08d5`): for these, what they uncover is made due
 * through their parent with RDW_ALLCHILDREN, 85h, never RDW_NOCHILDREN
 * (`093f`-`0958`).
 */

#define PROBE_WIN31
#define OUTPUT "C:\\ORACLE\\SWPUNC31.OUT"

#include "swpunc.c"
