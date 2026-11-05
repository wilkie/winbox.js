/*
 * The library `segtail.c` loads: a code segment holding `SegtailCode`, and
 * a data segment whose uninitialised array, `tail`, the file has no bytes
 * for -- it lies past the segment's length, inside its minimum allocation.
 * `SegtailData` hands the array's address back, so that the probe can read
 * what KERNEL left there.
 */

#include <windows.h>

static char tail[1024];

int FAR PASCAL _export SegtailCode(void)
{
    return 7;
}

LPSTR FAR PASCAL _export SegtailData(void)
{
    return (LPSTR)tail;
}

int FAR PASCAL LibMain(HANDLE instance, WORD data, WORD heap, LPSTR command)
{
    (void)instance;
    (void)data;
    (void)heap;
    (void)command;
    return 1;
}
