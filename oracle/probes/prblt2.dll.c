/*
 * The printer's driver of `prblt2.c`: `prdrv.dll.c`'s, under this probe's
 * name, `PRBLT2D`, its `BitBlt` summing what it is given and copying
 * between monochrome bitmaps (`PRDRV_COPIES`).
 */

#define PRDRV_COPIES
#include "prdrv.dll.c"
