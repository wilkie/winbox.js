/*
 * The system keys pressed while a child window has the focus: where
 * Alt+F4, Alt+Space, Alt and a menu's letter, Alt alone and F10 go, and
 * what comes of them.
 *
 * `T` is an overlapped window at (40, 40), 400 by 300, with a menu bar of
 * two pop-ups, `&File` (`&Open`, 100) and `&Edit` (`&Undo`, 200). In it, at
 * (10, 10), 200 by 100, is the child that has the focus: `E`, an edit
 * control subclassed to see its messages, or `K`, a child of the probe's own
 * class whose procedure calls `DefWindowProc` for everything. Each case
 * makes them afresh, gives the child the focus, puts the keys in through
 * USER's own `KEYBD_EVENT` as the keyboard driver would, and then takes
 * and dispatches every message waiting, with `TranslateMessage`.
 *
 * The keys, each pressed (`+`) or released (`-`):
 *
 * * `altf4`: +Alt +F4 -F4 -Alt.
 * * `altspace`: +Alt +Space -Space -Alt, then Escape twice.
 * * `altletter`: +Alt +F -F -Alt, then Escape twice.
 * * `altalone`: +Alt -Alt, then F, then Escape twice.
 * * `f10`: F10 alone, then Escape twice.
 * * `altf10`: +Alt -Alt, then F10, then Escape twice.
 *
 * Each case once with `E` focused (`edit,case`), once with `K`
 * (`kid,case`), and once with `K` made inside `M`, a child of the same class
 * in `T` at (5, 5), 300 by 200 (`deep,case`), for whether the keys go to the
 * parent or to the top-level window. Alt+F4, Alt alone and F10 once more
 * with `T` itself focused (`top,case`).
 *
 * The result, in order: each message a window procedure was handed, as the
 * window (`T`, `M`, `E`, `K`) and the message's number in hex -- a key's
 * with its virtual key and `a` where bit 29 of `lParam` says Alt was down;
 * `WM_SYSCOMMAND` with `wParam` and `lParam`; `WM_COMMAND` with its id;
 * `WM_INITMENUPOPUP` with the pop-up (`F`, `E`, `S` for the system menu)
 * and `WM_MENUSELECT` with the item or pop-up and its flags. A message
 * taken from the queue that is not a key's is written first with `@`, so a
 * posted `WM_SYSCOMMAND` shows apart from one sent. Then `=`, and whether
 * `T` is still there (`open`, `closed`) and which window has the focus.
 *
 * In `WM_MENUSELECT`, the system menu's pop-up as the item of the menu
 * `WM_INITMENU` named is `s`: the handle it carries is not the one
 * `GetSystemMenu` answers, which `WM_INITMENUPOPUP` names. An item's flags
 * are written without `MF_GRAYED` and `MF_DISABLED`. An earlier recording
 * had them, and the system menu's Restore, the first item Alt+Space
 * selects, came without `MF_GRAYED` (`2080`) -- and `GetMenuState` of it
 * in the menu `GetSystemMenu` answers was nought, not grayed, both as
 * `WM_INITMENUPOPUP` named that menu and once the pop-up had closed. Yet
 * Windows draws it grayed (`menus`), and USER's code that grays the system
 * menu's items runs as the menu starts, before `WM_INITMENU` (`USER.EXE`
 * seg17 `01ac`, seg9 `0d8b`). Why it reads as not grayed is not worked out;
 * this probe is about where the keys go, so the bits are left out here
 * rather than guessed at.
 *
 * `WM_ENTERIDLE` ends a menu still open when the keys have run out with
 * `WM_CANCELMODE`, so that a menu that did not take them all cannot hang the
 * probe; it is written as `T121` the first time.
 */

/* Each record on the disk as it is made, in case a case hangs. */
#define PROBE_FLUSH

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ALTCHILD.OUT"

#define ID_OPEN 100
#define ID_UNDO 200

static HINSTANCE module;
static HWND top;
static HWND child;
static HWND middle;
static HMENU fileMenu;
static HMENU editMenu;
static FARPROC editProc;
static FARPROC keybdEvent;
static BOOL idled;
static char events[1600];

static WORD keyAX;
static WORD keyBX;

static LPCSTR whose(HWND hwnd)
{
    static char handle[8];

    if (hwnd == NULL) {
        return "none";
    }

    if (hwnd == top) {
        return "T";
    }

    if (hwnd == child) {
        return GetWindowWord(hwnd, GWW_ID) == 1 ? "E" : "K";
    }

    if (hwnd == middle) {
        return "M";
    }

    wsprintf(handle, "%04x", hwnd);
    return handle;
}

static LPCSTR hex(WORD value)
{
    static char text[8];

    wsprintf(text, "%x", value);
    return text;
}

static LPCSTR menuName(HMENU menu)
{
    static char handle[8];

    if (menu == NULL) {
        return "0";
    }

    if (menu == fileMenu) {
        return "F";
    }

    if (menu == editMenu) {
        return "E";
    }

    if (top && menu == GetSystemMenu(top, FALSE)) {
        return "S";
    }

    wsprintf(handle, "%04x", menu);
    return handle;
}

static void add(LPCSTR text)
{
    if (lstrlen(events) + lstrlen(text) + 2 < sizeof(events)) {
        lstrcat(events, text);
        lstrcat(events, ",");
    }
}

/* A message a procedure was handed, if it is one this probe watches. */
static void note(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    char one[48];
    LPCSTR who = whose(hwnd);

    switch (message) {
    case WM_KEYDOWN:
    case WM_KEYUP:
    case WM_CHAR:
    case WM_SYSKEYDOWN:
    case WM_SYSKEYUP:
    case WM_SYSCHAR:
        wsprintf(one, "%s%x:%x%s", who, message, wParam,
                 (HIWORD(lParam) & 0x2000) ? "a" : "");
        break;
    case WM_SYSCOMMAND:
        wsprintf(one, "%s%x:%x/%lx", who, message, wParam, lParam);
        break;
    case WM_COMMAND:
        wsprintf(one, "%s%x:%x", who, message, wParam);
        break;
    case WM_CLOSE:
    case WM_DESTROY:
    case WM_MENUCHAR:
        wsprintf(one, "%s%x", who, message);
        break;
    case WM_INITMENUPOPUP:
        wsprintf(one, "%s%x:%s", who, message, menuName((HMENU)wParam));
        break;
    case WM_INITMENU:
        wsprintf(one, "%s%x", who, message);
        break;
    case WM_MENUSELECT:
        if (LOWORD(lParam) == 0xffff) {
            wsprintf(one, "%s%x:%x/ffff", who, message, wParam);
        } else if ((LOWORD(lParam) & (MF_POPUP | MF_SYSMENU)) == (MF_POPUP | MF_SYSMENU) &&
                   (HMENU)wParam != GetSystemMenu(hwnd, FALSE)) {
            wsprintf(one, "%s%x:s/%x", who, message, LOWORD(lParam));
        } else {
            /* Without the grayed and disabled bits: see the comment above. */
            wsprintf(one, "%s%x:%s/%x", who, message,
                     (LOWORD(lParam) & MF_POPUP) ? menuName((HMENU)wParam) : hex(wParam),
                     LOWORD(lParam) & ~(MF_GRAYED | MF_DISABLED));
        }
        break;
    default:
        return;
    }

    add(one);
}

LONG FAR PASCAL _export TopProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    note(hwnd, message, wParam, lParam);

    /* A menu still open with no keys left: ended, so the probe goes on. */
    if (message == WM_ENTERIDLE) {
        if (!idled) {
            add("T121");
            idled = TRUE;
        }

        SendMessage(hwnd, WM_CANCELMODE, 0, 0L);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export KidProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    note(hwnd, message, wParam, lParam);
    return DefWindowProc(hwnd, message, wParam, lParam);
}

LONG FAR PASCAL _export EditSpy(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    note(hwnd, message, wParam, lParam);
    return CallWindowProc(editProc, hwnd, message, wParam, lParam);
}

/* One key, pressed or released, as the keyboard driver hands it to USER:
 * AL the virtual key, AH 80h for a release, BL the scan code. */
static void key(BYTE vk, BYTE scan, BOOL up)
{
    keyAX = (WORD)vk | (up ? 0x8000 : 0);
    keyBX = scan;

    _asm {
        push si
        push di
        mov ax, keyAX
        mov bx, keyBX
        xor si, si
        xor di, di
        call dword ptr keybdEvent
        pop di
        pop si
    }
}

static void press(BYTE vk, BYTE scan)
{
    key(vk, scan, FALSE);
    key(vk, scan, TRUE);
}

/* Everything waiting taken, translated and dispatched. */
static void pump(void)
{
    MSG message;
    int count = 0;

    while (count < 80 && PeekMessage(&message, NULL, 0, 0, PM_REMOVE)) {
        if (message.message == WM_SYSCOMMAND || message.message == WM_CLOSE ||
            message.message == WM_COMMAND) {
            char one[24];

            wsprintf(one, "@%s%x", whose(message.hwnd), message.message);
            add(one);
        }

        TranslateMessage(&message);
        DispatchMessage(&message);
        count++;
    }
}

static void make(LPCSTR kind)
{
    HMENU bar = CreateMenu();

    fileMenu = CreatePopupMenu();
    AppendMenu(fileMenu, MF_STRING, ID_OPEN, "&Open");
    editMenu = CreatePopupMenu();
    AppendMenu(editMenu, MF_STRING, ID_UNDO, "&Undo");
    AppendMenu(bar, MF_POPUP, (UINT)fileMenu, "&File");
    AppendMenu(bar, MF_POPUP, (UINT)editMenu, "&Edit");

    top = CreateWindow("AltTop", "T", WS_OVERLAPPEDWINDOW, 40, 40, 400, 300, NULL, bar, module,
                       NULL);

    if (lstrcmp(kind, "edit") == 0) {
        child = CreateWindow("EDIT", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 200, 100, top,
                             (HMENU)1, module, NULL);
        editProc = (FARPROC)SetWindowLong(child, GWL_WNDPROC, (LONG)(WNDPROC)EditSpy);
    } else if (lstrcmp(kind, "kid") == 0) {
        child = CreateWindow("AltKid", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 200, 100,
                             top, (HMENU)2, module, NULL);
    } else if (lstrcmp(kind, "deep") == 0) {
        middle = CreateWindow("AltKid", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 5, 5, 300, 200, top,
                              (HMENU)3, module, NULL);
        child = CreateWindow("AltKid", "", WS_CHILD | WS_VISIBLE | WS_BORDER, 10, 10, 200, 100,
                             middle, (HMENU)2, module, NULL);
    } else {
        child = NULL;
    }

    ShowWindow(top, SW_SHOWNORMAL);
    UpdateWindow(top);
    SetFocus(child ? child : top);
    pump();
}

#define VK_F_ 0x46

static void run(LPCSTR kind, LPCSTR name)
{
    char one[48];

    make(kind);
    events[0] = '\0';
    idled = FALSE;

    if (lstrcmp(name, "f10") != 0) {
        key(VK_MENU, 0x38, FALSE);
    }

    if (lstrcmp(name, "altf4") == 0) {
        press(VK_F4, 0x3e);
        key(VK_MENU, 0x38, TRUE);
    } else if (lstrcmp(name, "altspace") == 0) {
        press(VK_SPACE, 0x39);
        key(VK_MENU, 0x38, TRUE);
    } else if (lstrcmp(name, "altletter") == 0) {
        press(VK_F_, 0x21);
        key(VK_MENU, 0x38, TRUE);
    } else if (lstrcmp(name, "altalone") == 0) {
        key(VK_MENU, 0x38, TRUE);
        press(VK_F_, 0x21);
    } else if (lstrcmp(name, "altf10") == 0) {
        key(VK_MENU, 0x38, TRUE);
        press(VK_F10, 0x44);
    } else {
        press(VK_F10, 0x44);
    }

    if (lstrcmp(name, "altf4") != 0) {
        press(VK_ESCAPE, 0x01);
        press(VK_ESCAPE, 0x01);
    }

    pump();

    wsprintf(one, "=%s,%s", IsWindow(top) ? (LPCSTR)"open" : (LPCSTR)"closed",
             whose(GetFocus()));
    add(one);

    wsprintf(probeArgs, "%s,%s", kind, name);
    probe("keys", probeArgs, events);

    if (IsWindow(top)) {
        DestroyWindow(top);
    }

    top = NULL;
    child = NULL;
    middle = NULL;
    pump();
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);
    module = instance;

    kind.style = 0;
    kind.lpfnWndProc = TopProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = GetStockObject(WHITE_BRUSH);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "AltTop";
    RegisterClass(&kind);

    kind.lpfnWndProc = KidProc;
    kind.lpszClassName = "AltKid";
    RegisterClass(&kind);

    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    probe("entry", "KEYBD_EVENT", keybdEvent ? "found" : "missing");

    if (keybdEvent) {
        run("edit", "altf4");
        run("edit", "altspace");
        run("edit", "altletter");
        run("edit", "altalone");
        run("edit", "f10");
        run("edit", "altf10");
        run("kid", "altf4");
        run("kid", "altspace");
        run("kid", "altletter");
        run("kid", "altalone");
        run("kid", "f10");
        run("deep", "altf4");
        run("deep", "altspace");
        run("deep", "altletter");
        run("deep", "altalone");
        run("deep", "f10");
        run("top", "altf4");
        run("top", "altalone");
        run("top", "f10");
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
