/*
 * A Win386 program that does nothing: `w386box.c` starts it. In 386
 * enhanced mode it starts, its `WinMain` returns and it ends; in standard
 * mode its supervisor shows its box before any of its 32-bit code runs.
 */

#include <windows.h>

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
