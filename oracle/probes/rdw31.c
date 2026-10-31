/*
 * `rdwwalk`'s cases from a program marked for Windows 3.10 (`PROBE_WIN31`:
 * its header's expected version 30Ah), so that each window has USER's bit
 * 4 of the byte at 26h (`USER.EXE` seg8 `0425`-`0432`): a window outside
 * the client area it is in passed over (seg1 `406e`-`4084`), all of a window
 * made due without RDW_ERASE keeping its erase (`4250`-`425c`), and a
 * minimized window of a class with an icon not showing for its client area
 * (`3e35`-`3e46`, `1c7e`-`1c8c`).
 */

#define PROBE_WIN31
#define OUTPUT "C:\\ORACLE\\RDW31.OUT"

#include "rdwwalk.c"
