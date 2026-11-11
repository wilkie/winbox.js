/*
 * `fptask` recorded with a coprocessor: the same two programs, each
 * floating-point instruction run on the unit, and KERNEL's task switch
 * keeping each task's control word (`KRNL386.EXE` seg1 `818b`, `8216`).
 * `QUIET`: neither divides, as DOSBox's unit, which the recording's
 * coprocessor is, gathers no exceptions ([[probe:fpemu]]). See `fptask.c`.
 */

#define OUTPUT "C:\\ORACLE\\FPTSK87.OUT"
#define LOG "C:\\ORACLE\\FPTSK87.TXT"
#define CHILD "C:\\WINDOWS\\FPTSK87C.EXE"
#define QUIET

#include "fptask.c"
