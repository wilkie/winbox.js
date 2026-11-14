/*
 * `visrule`'s cases from a program marked for Windows 3.10 (`PROBE_WIN31`:
 * its header's expected version 30Ah), so that each window has USER's bit
 * 2 of the byte at 26h (`USER.EXE` seg8 `0425`-`0432`): `DCX_PARENTCLIP`
 * then takes the parent's region without asking whether the parent has
 * `WS_CLIPCHILDREN` (seg1 `851a`-`8527`), and a minimized window of a class
 * with an icon has nothing for its client area (`1c7e`-`1c8c`).
 */

#define PROBE_WIN31
#define OUTPUT "C:\\ORACLE\\VISR31.OUT"

#include "visrule.c"
