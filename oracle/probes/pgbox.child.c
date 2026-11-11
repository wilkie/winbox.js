/*
 * The program `pgbox.c` starts: it makes a window of its own and waits for
 * messages. Told WM_USER, it reads a byte at the linear address 80000000h,
 * which WIN386 has not given it (`pgtouch`), through a selector of its own,
 * with no exception handler of its own. Told WM_USER + 1, it answers how
 * many of its reads went on past the instruction, and the byte the last
 * one left in AL: 5Ah, as it was before, where the read was stepped over.
 */

#include <windows.h>

static UINT reads;
static BYTE value;
static UINT sel;

static void readFar(void)
{
    UINT selector = sel;
    BYTE got = 0;

    _asm {
        push es
        mov ax, selector
        mov es, ax
        xor bx, bx
        mov al, 5Ah
        mov al, es:[bx]
        pop es
        mov got, al
    }
    value = got;
    reads++;
}

static UINT dpmiSelector(void)
{
    UINT made = 0;

    _asm {
        mov ax, 0000h
        mov cx, 1
        int 31h
        jc refused
        mov made, ax
        mov bx, ax
        mov ax, 0007h
        mov cx, 8000h
        mov dx, 0000h
        int 31h
        mov bx, made
        mov ax, 0008h
        xor cx, cx
        mov dx, 0FFFFh
        int 31h
    refused:
        nop
    }

    return made;
}

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER) {
        if (!sel) {
            sel = dpmiSelector();
        }
        if (sel) {
            readFar();
        }
        return 0;
    }

    if (message == WM_USER + 1) {
        return MAKELONG(reads, value);
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
    kind.lpszClassName = "PgBoxChild";
    RegisterClass(&kind);
    CreateWindow("PgBoxChild", "Paging", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 100, 200, 150,
                 NULL, NULL, instance, NULL);

    while (GetMessage(&msg, NULL, 0, 0)) {
        DispatchMessage(&msg);
    }

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
