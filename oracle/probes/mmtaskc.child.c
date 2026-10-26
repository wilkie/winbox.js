/*
 * The program `mmtaskc.c` starts with LoadModule: it waits for a timer's
 * message a fifth of a second on, so that it is there as LoadModule comes
 * back, and ends.
 */

#include <windows.h>

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    MSG message;
    UINT timer = SetTimer(NULL, 0, 200, NULL);

    while (GetMessage(&message, NULL, 0, 0) && message.message != WM_TIMER) {
        DispatchMessage(&message);
    }

    KillTimer(NULL, timer);

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
