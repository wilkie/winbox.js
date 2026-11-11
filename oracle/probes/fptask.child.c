/*
 * The program `fptask.c` starts: it writes its floating-point view to
 * C:\ORACLE\FPTASK.TXT as it starts and as it takes each WM_USER. At the
 * first it sets its own control word -- rounding toward nought, every
 * exception masked -- and gathers an invalid operation, nought by nought,
 * but where `QUIET` is defined, and writes its view again. It closes when
 * its window is closed.
 */

#include <windows.h>

#ifndef LOG
#define LOG "C:\\ORACLE\\FPTASK.TXT"
#endif

static FARPROC fpmathEntry;
static WORD fpWord;
static WORD fpStatus;
static WORD fpAnswer;
static double fpResult;

static WORD fpmath(WORD function)
{
    _asm {
        push bx
        push cx
        push dx
        push si
        push di
        push es
        mov bx, function
        call dword ptr fpmathEntry
        mov fpAnswer, ax
        pop es
        pop di
        pop si
        pop dx
        pop cx
        pop bx
    }
    return fpAnswer;
}

static void note(LPCSTR when)
{
    char line[160];
    HFILE file;

    _asm {
        fstcw fpWord
        fstsw fpStatus
    }
    wsprintf(line, "%s: cw %04x sw %04x fpmath5 %04x fpmath8 %04x fpmath10 %u\r\n", when, fpWord,
             fpStatus, fpmath(5), fpmath(8), fpmath(10));

    file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lclose(file);
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER) {
        if (wParam == 1) {
            note("first message");
            fpWord = 0x0f3f;
            _asm {
                fldcw fpWord
            }
#ifndef QUIET
            _asm {
                fldz
                fldz
                fdivp st(1), st
                fstp fpResult
            }
#endif
            note("its own set");
        } else {
            note("second message");
        }

        return 0;
    }

    if (message == WM_DESTROY) {
        PostQuitMessage(0);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    HWND window;
    MSG msg;

    fpmathEntry = GetProcAddress(GetModuleHandle("WIN87EM"), "__FPMATH");
    note("at start");

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "FpTaskChild";
    RegisterClass(&kind);

    window = CreateWindow("FpTaskChild", "Child", WS_OVERLAPPEDWINDOW, 300, 200, 150, 100, NULL,
                          NULL, instance, NULL);
    ShowWindow(window, show);

    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    return msg.wParam;
}
