/*
 * The program `thswch.c` starts, its command line its mode. It posts the
 * probe's window ("THSwchP") `WM_USER + 1` with the far address of
 * `Jumped` in lParam, then waits: in `GetMessage` for mode `1`; for mode
 * `2`, for a timer's message a fifth of a second on, then giving the
 * processor up with `Yield` over and over. It never comes back
 * from waiting by itself. `Jumped`, where the probe sends it, writes
 * `child jumped <mode>` to the probe's file and ends the program through
 * DOS, `INT 21h` 4Ch.
 */

#include <windows.h>

static int mode;

static void record(void)
{
    char line[40];
    HFILE file = _lopen("C:\\ORACLE\\THSWCH.OUT", OF_WRITE);
    int length;

    if (file == HFILE_ERROR) {
        return;
    }

    _llseek(file, 0L, 2);
    length = wsprintf(line, "child\tjumped\t%d\r\n", mode);
    _lwrite(file, line, length);
    _lclose(file);
}

/* Gone to with the registers as the task's switch left them: DS made the
 * program's own first. */
static void __declspec(naked) __far Jumped(void)
{
    _asm {
        mov ax, SEG mode
        mov ds, ax
        call record
        mov ax, 4c00h
        int 21h
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND probe = FindWindow("THSwchP", NULL);
    MSG message;

    mode = command[0] - '0';
    PostMessage(probe, WM_USER + 1, (WPARAM)mode, (LPARAM)(void __far *)Jumped);

    if (mode == 1) {
        while (GetMessage(&message, NULL, 0, 0)) {
            DispatchMessage(&message);
        }
    } else {
        /* A timer's message a fifth of a second on waited for first, so
         * that WinExec has come back to the probe however it waits. */
        UINT timer = SetTimer(NULL, 0, 200, NULL);

        while (GetMessage(&message, NULL, 0, 0) && message.message != WM_TIMER) {
            DispatchMessage(&message);
        }

        KillTimer(NULL, timer);

        for (;;) {
            if (PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
                DispatchMessage(&message);
            }

            Yield();
        }
    }

    (void)instance;
    (void)previous;
    (void)show;
    return 0;
}
