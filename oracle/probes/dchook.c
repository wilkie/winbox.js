/*
 * `dcinner` with the hook's calls recorded (`hookcall`): GDI calls a
 * device context's hook -- the context, `DCHC_INVALIDVISRGN`, the data and
 * nought -- from the calls that use the context while `SetHookFlags` has
 * the flag set.
 */

#define DCINNER_HOOKCALLS
#define OUTPUT "C:\\ORACLE\\DCHOOK.OUT"

#include "dcinner.c"
