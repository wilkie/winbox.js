/*
 * The program `pghost.c` starts: it makes a window of its own and waits for
 * messages. Told WM_USER, it takes a 0501h block of four pages, writes page
 * 1, frees it, and calls lstrlen with a far pointer to the block's first
 * page, which in 386 enhanced mode is then not present (`pgfree`), through
 * a selector of its own, with no exception handler of its own. Told WM_USER
 * + 1, it answers how many of its calls returned, and lstrlen's answer.
 */

#include <windows.h>

static UINT calls;
static UINT answer;
static UINT sel;

/* The selector based at a freed block's first page; nought where DPMI
 * refused. */
static UINT freedPage(void)
{
    UINT made = 0;

    _asm {
        push si
        push di
        mov ax, 0000h
        mov cx, 1
        int 31h
        jc refused
        mov made, ax
        mov ax, 0501h
        xor bx, bx
        mov cx, 4000h
        int 31h
        jc refused
        push si
        push di
        push bx
        push cx
        mov dx, cx
        mov cx, bx
        mov bx, made
        mov ax, 0007h
        add dx, 1000h
        adc cx, 0
        int 31h
        mov bx, made
        mov ax, 0008h
        xor cx, cx
        mov dx, 0FFFFh
        int 31h
        push es
        mov ax, made
        mov es, ax
        mov byte ptr es:[0], 41h
        pop es
        pop dx
        pop cx
        mov bx, made
        mov ax, 0007h
        int 31h
        pop di
        pop si
        mov ax, 0502h
        int 31h
    refused:
        pop di
        pop si
    }

    return made;
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER) {
        if (!sel) {
            sel = freedPage();
        }
        if (sel) {
            answer = lstrlen((LPSTR)MAKELP(sel, 0));
            calls++;
        }
        return 0;
    }

    if (message == WM_USER + 1) {
        return MAKELONG(calls, answer);
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
    MSG msg;

    kind.style = 0;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = NULL;
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "PgHostChild";
    RegisterClass(&kind);
    CreateWindow("PgHostChild", "Paging", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 100, 200, 150,
                 NULL, NULL, instance, NULL);

    while (GetMessage(&msg, NULL, 0, 0)) {
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
