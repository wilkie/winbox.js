/*
 * USER's ordinal 481, Hardware_Event, called by ordinal in registers (`USER.EXE`
 * seg1 `4d6c`): AX a message, CX and DX its `paramL` and `paramH`, SI and DI
 * the extra information, put in the system queue -- as `keybd_event`'s and
 * `mouse_event`'s own put calls it (`4c82`). It reads the system
 * queue's selector from DS:0, where `keybd_event` has USER's segment 44,
 * which no export names; DS here is USER's data segment, segment 45
 * (ordinal 285's answer, seg41 `1737`), the one a program can name. Its
 * word 0 is no queue's selector, and what USER does with it is what is
 * recorded.
 *
 * * `put`: AX as it comes back, `non-nought` or `nought`.
 * * `taken`: the message `PeekMessage` takes for it: its window (`main`,
 *   `child`, `none`, `other`), `wParam`, `lParam`; and `GetMessageExtraInfo`.
 *
 * Cases: extra information 3333h:0000h; 0000h:the child's handle; the
 * child's handle:0000h.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\HWEVENT.OUT"

typedef WORD(FAR PASCAL *W2)(WORD, WORD);

static WORD userData;
static WORD regAx;
static WORD regCx;
static WORD regDx;
static WORD regSi;
static WORD regDi;
static WORD answer;
static HWND main;
static HWND child;

static void put(void)
{
    FARPROC proc = GetProcAddress(GetModuleHandle("USER"), MAKEINTRESOURCE(481));
    WORD segmentOfUser = userData;
    WORD valueAx = regAx;
    WORD valueCx = regCx;
    WORD valueDx = regDx;
    WORD valueSi = regSi;
    WORD valueDi = regDi;
    WORD answered;

    /* The locals are on the stack, read through SS, so they stay in reach
     * once DS is USER's. */
    _asm {
        push ds
        push si
        push di
        mov ax, valueAx
        mov cx, valueCx
        mov dx, valueDx
        mov si, valueSi
        mov di, valueDi
        mov ds, segmentOfUser
        call dword ptr proc
        pop di
        pop si
        pop ds
        mov answered, ax
    }

    answer = answered;
}

static LPCSTR named(HWND window)
{
    return !window ? "none" : window == main ? "main" : window == child ? "child" : "other";
}

static void run(WORD si, WORD di, LPCSTR what)
{
    MSG msg;
    BOOL got;

    regAx = WM_USER + 0x55;
    regCx = 0x1111;
    regDx = 0x2222;
    regSi = si;
    regDi = di;
    put();
    probe("put", what, answer ? "non-nought" : "nought");

    got = PeekMessage(&msg, NULL, WM_USER + 0x55, WM_USER + 0x55, PM_REMOVE);

    if (got) {
        wsprintf(probeResult, "%s %04x %08lx extra=%08lx", named(msg.hwnd), msg.wParam,
                 msg.lParam, GetMessageExtraInfo());
    } else {
        lstrcpy(probeResult, "nothing");
    }

    probe("taken", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    MSG msg;

    probeOpen(OUTPUT);

    userData = ((W2)GetProcAddress(GetModuleHandle("USER"), MAKEINTRESOURCE(285)))(0, 0);
    main = CreateWindow("STATIC", "Main", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 10, 10, 300, 200,
                        NULL, NULL, instance, NULL);
    child = CreateWindow("STATIC", "", WS_CHILD | WS_VISIBLE, 10, 10, 50, 50, main, (HMENU)1,
                         instance, NULL);
    SetActiveWindow(main);

    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        DispatchMessage(&msg);
    }

    run(0x3333, 0, "3333:0");
    run(0, (WORD)child, "0:child");
    run((WORD)child, 0, "child:0");

    DestroyWindow(main);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
