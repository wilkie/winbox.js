/*
 * The heap an edit control takes its memory in, where a superclass of
 * `Edit` changes the window's instance before it hands `WM_NCCREATE` on, as
 * a Visual Basic 1.0 text box does (`VBRUN100.DLL` seg58 `0321`-`036b`): a
 * moveable block of 256 bytes (`GMEM_MOVEABLE | GMEM_ZEROINIT`) locked and
 * made a local heap with `LocalInit`, the window's instance
 * (`GWW_HINSTANCE`) set to it, the `CREATESTRUCT`'s too, then
 * `CallWindowProc` with `Edit`'s procedure.
 *
 * Four ways, each a multi-line edit control of the superclass, its text set
 * to "Hello edit" after it is made: `both` (the window's instance and the
 * `CREATESTRUCT`'s set to the block), `window` (the window's alone),
 * `createstruct` (the `CREATESTRUCT`'s alone) and `none` (the block made,
 * neither set). The superclass's procedure loads its own DS (`__loadds`):
 * USER calls a window's procedure with the window's instance in AX, which
 * an exported procedure of a program's would take as its DS.
 *
 * * `instance`: the window's instance after it is made, as `block` where it
 *   is the block's handle, `program` where it is the probe's.
 * * `text`: `WM_GETTEXTLENGTH` and `EM_GETLINECOUNT` after the text is set.
 * * `gethandle`: where `EM_GETHANDLE`'s handle is: `block` where it reads
 *   as a moveable local handle in the block (the word at its offset an
 *   offset in the block, the text there), with the handle and the block's
 *   `GlobalSize`; `program` where `LocalLock` of it in the probe's own heap
 *   gives the text, with whether the block grew past its 256 bytes; else
 *   `neither`.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\EDINST.OUT"

static WNDPROC editProc;
static HGLOBAL block;
static int how;

#define BOTH 0
#define WINDOW 1
#define CREATESTRUCT_ONLY 2
#define NONE 3

LRESULT CALLBACK __export __loadds Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_NCCREATE) {
        LPCREATESTRUCT create = (LPCREATESTRUCT)lParam;

        block = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
        LocalInit(SELECTOROF(GlobalLock(block)), 0, (UINT)GlobalSize(block) - 1);

        if (how == BOTH || how == WINDOW) {
            SetWindowWord(window, GWW_HINSTANCE, (WORD)block);
        }

        if (how == BOTH || how == CREATESTRUCT_ONLY) {
            create->hInstance = (HINSTANCE)block;
        }
    }

    return CallWindowProc((FARPROC)editProc, window, message, wParam, lParam);
}

static BOOL isText(LPCSTR text)
{
    return lstrcmp(text, "Hello edit") == 0;
}

static void where(LPCSTR name, HLOCAL handle)
{
    UINT segment = SELECTOROF(GlobalLock(block));
    DWORD size = GlobalSize(block);
    BOOL inBlock = FALSE;
    LPSTR own;

    if (handle && (DWORD)(UINT)handle + 2 <= size) {
        UINT offset = *(UINT FAR *)MAKELP(segment, (UINT)handle);

        inBlock = offset && (DWORD)offset + 11 <= size &&
                  isText((LPCSTR)MAKELP(segment, offset));
    }

    GlobalUnlock(block);

    if (inBlock) {
        wsprintf(probeResult, "block,%x,%lu", (UINT)handle, size);
    } else if (handle && (own = LocalLock(handle)) != NULL && isText(own)) {
        wsprintf(probeResult, "program,%s", (LPSTR)(size > 256 ? "grew" : "256"));
    } else {
        lstrcpy(probeResult, "neither");
    }

    if (!inBlock && handle) {
        LocalUnlock(handle);
    }

    probe("gethandle", name, probeResult);
}

static void made(HINSTANCE instance, LPCSTR name, int asked)
{
    HWND window;
    WORD now;

    how = asked;
    block = NULL;
    window = CreateWindow("EdInst", "", WS_POPUP | ES_MULTILINE, 0, 0, 200, 80, NULL, NULL,
                          instance, NULL);

    if (!window) {
        probe("instance", name, "no window");
        return;
    }

    now = GetWindowWord(window, GWW_HINSTANCE);
    probe("instance", name,
          now == (WORD)block ? "block" : now == (WORD)instance ? "program" : "other");

    SetWindowText(window, "Hello edit");
    wsprintf(probeResult, "%ld,%ld", SendMessage(window, WM_GETTEXTLENGTH, 0, 0L),
             SendMessage(window, EM_GETLINECOUNT, 0, 0L));
    probe("text", name, probeResult);

    where(name, (HLOCAL)SendMessage(window, EM_GETHANDLE, 0, 0L));

    DestroyWindow(window);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);

    GetClassInfo(NULL, "Edit", &kind);
    editProc = kind.lpfnWndProc;
    kind.lpfnWndProc = Proc;
    kind.hInstance = instance;
    kind.lpszClassName = "EdInst";
    RegisterClass(&kind);

    made(instance, "both", BOTH);
    made(instance, "window", WINDOW);
    made(instance, "createstruct", CREATESTRUCT_ONLY);
    made(instance, "none", NONE);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
