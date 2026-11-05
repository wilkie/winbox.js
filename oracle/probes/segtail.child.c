/*
 * A program `segtail.c` starts and lets end before it loads its library:
 * its code and data had memory the library's segments may come to. It
 * fills an array of its data with A5h, so that what it leaves there is not
 * nought.
 */

#include <windows.h>

static char fill[2048];

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    int k;

    for (k = 0; k < (int)sizeof(fill); k++) {
        fill[k] = (char)0xa5;
    }

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return fill[7] == (char)0xa5 ? 0 : 1;
}
