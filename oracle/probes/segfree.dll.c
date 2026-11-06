/*
 * The library `segfree.c` loads and frees: a code segment holding
 * `SegfreeCode`, and a data segment.
 */

#include <windows.h>

static char kept[64];

int FAR PASCAL _export SegfreeCode(void)
{
    kept[0] = 1;
    return 7;
}

int FAR PASCAL LibMain(HANDLE instance, WORD data, WORD heap, LPSTR command)
{
    (void)instance;
    (void)data;
    (void)heap;
    (void)command;
    return 1;
}
