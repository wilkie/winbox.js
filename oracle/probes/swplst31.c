/*
 * `swplist`'s cases from a program marked for Windows 3.10 (`PROBE_WIN31`:
 * its header's expected version 30Ah), so that each window has USER's bit
 * 4 of the byte at 26h (`USER.EXE` seg8 `0425`-`0432`): a list of windows
 * all shown is then never counted for RDW_NOCHILDREN (seg7 `08c6`-`08d5`).
 */

#define PROBE_WIN31
#define OUTPUT "C:\\ORACLE\\SWPLST31.OUT"

#include "swplist.c"
