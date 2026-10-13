/*
 * A system-modal dialog, a dialog owned by another program's window, and
 * `WM_ACTIVATEAPP` as the activation moves between two programs: which
 * windows are told what, where the activation and the focus go, which
 * window is system modal, which task is locked, and what the other program
 * can do meanwhile. Read out of `USER.EXE`: the dialog made with
 * `DS_SYSMODAL` is made system modal as soon as it is a window, the window
 * system modal before kept in its word at 58h (seg24 `062d`-`064b`), and a
 * dialog owned by the system-modal window is made system modal too (seg24
 * `011c`-`0148`); `DialogBox`'s loop puts it on top of all as it shows it,
 * and locks the task (seg25 `0826`-`0859`); `EndDialog` lets the task go,
 * and makes the window system modal before so again, and active (seg25
 * `2579`, `25e8`-`260b`).
 *
 * Windows at the top of this program: A at (20, 20) and B at (20, 240),
 * shown, A last and so active; H, hidden; Q, a pop-up owned by A, shown.
 * Of SYSDLGC.EXE (`sysdlg.child.c`), started at once: C and E, shown, and
 * G, hidden. The dialogs are built in memory: D, a pop-up with a caption, a
 * system menu and a modal frame and a push button D1, `DS_SYSMODAL` or
 * not as the case says, and N, the same with a button N1 and without
 * `DS_SYSMODAL`. A message filter (`WH_MSGFILTER`) is set throughout.
 *
 * Both programs append to C:\ORACLE\SYSDLG.TXT as things happen, so the
 * lines of the two are in the order they happened; at each case's end the
 * lines are read back and written as records, by case and number; what
 * comes as A is made active again after a case is written under the case's
 * name and `-reset`:
 *
 * * `msg`: each of `WM_ACTIVATEAPP`, `WM_NCACTIVATE`, `WM_ACTIVATE`,
 *   `WM_SETFOCUS`, `WM_KILLFOCUS`, `WM_ENABLE`, `WM_CANCELMODE`,
 *   `WM_KEYDOWN`, `WM_USER`, `WM_WINDOWPOSCHANGING` and
 *   `WM_WINDOWPOSCHANGED` that A, B, H, Q, C, E, G, D or N got: the window,
 *   the message, then for the focus messages the window named, for the
 *   activation messages `wParam` and the window named in `lParam`'s low
 *   word, for `WM_ACTIVATEAPP` `wParam` and the task named in `lParam` (P
 *   this program's, C the other's), for the position messages the flags
 *   and the window to go after, for `WM_USER` the window named in
 *   `wParam`, else `wParam`. A window not the probe's is `?` and its
 *   class.
 * * `hook`: the message filter called with the message `WM_START` that a
 *   dialog posts itself: the code and the window.
 * * `state`: at a point of the case, `GetFocus`, `GetActiveWindow`,
 *   `GetSysModalWindow`, `IsTaskLocked` (P or C), whether A and C are
 *   enabled, and whether D shows.
 * * `answer`, `filter`, `replied`: what `DialogBoxIndirect` and
 *   `CallMsgFilter` answered, and whether C answered `WM_USER` posted to
 *   it.
 *
 * The cases:
 *
 * * `app`: C made active with `SetActiveWindow`, then A again.
 * * `sysmodal`: D, `DS_SYSMODAL`, owned by A. Its first tick presses F7
 *   with `KEYBD_EVENT`; its second posts C `WM_USER`, makes B, then D
 *   active with `SetActiveWindow`, calls `CallMsgFilter` with code 7, and
 *   ends D with 9. Nothing sends C a message while the task is locked: the
 *   send would wait for C's task, which cannot run.
 * * `nested`: D, `DS_SYSMODAL`, runs N, owned by D, at its tick; N's tick
 *   ends N with 3, then D is ended with 4.
 * * `owner`: C made active, then D, without `DS_SYSMODAL`, owned by C; its
 *   tick ends it with 5.
 * * `modeless`: D made with `CreateDialogIndirect`, `DS_SYSMODAL` and
 *   `WS_VISIBLE`, owned by A, ended, then destroyed; `destroyed` the same,
 *   destroyed without being ended, and then `LockMyTask(FALSE)`.
 */

#define PROBE_FLUSH
#include "probe.h"

#include <string.h>

#define OUTPUT "C:\\ORACLE\\SYSDLG.OUT"
#define LOG "C:\\ORACLE\\SYSDLG.TXT"

#define ID_D1 101
#define ID_N1 201
#define TICK 1
#define WM_REPLY (WM_USER + 1)
#define WM_START (WM_USER + 10)

typedef HTASK(FAR PASCAL *ISTASKLOCKED)(void);
typedef void(FAR PASCAL *LOCKMYTASK)(BOOL);

enum { SYSMODAL, NESTED, OWNER };

static HINSTANCE instance;
static HWND windowA, windowB, windowH, windowQ;
static HWND windowC, windowE, windowG;
static HWND dialogD, dialogN;
static HWND itemD1, itemN1;
static HTASK taskP, taskC;
static int kind;
static int ticks;
static BOOL replied;
static HGLOBAL memoryD, memorySys, memoryN, memoryVis;
static HOOKPROC hook;
static HOOKPROC filterProc;
static FARPROC keybdEvent;
static ISTASKLOCKED isTaskLocked;
static LOCKMYTASK lockMyTask;
static WORD keyAX;
static WORD keyBX;
static LPCSTR label = "";
/* The dialogs' procedures through instance thunks, which set their data
 * segment whichever task's stack they are called on: D's is called from C's
 * `DefWindowProc` as C takes the focus from it. */
static FARPROC dialogProc;
static FARPROC dialogProcN;
static int number;

static char line[96];
static char far text[12000];

static void note(void)
{
    HFILE file = _lopen(LOG, OF_READWRITE);

    if (file == HFILE_ERROR) {
        file = _lcreat(LOG, 0);
    }

    _llseek(file, 0L, 2);
    _lwrite(file, line, lstrlen(line));
    _lwrite(file, "\r\n", 2);
    _lclose(file);
}

/* Apart, so that the far pointer is loaded only where it is one: the
 * compiler loads it as the function begins, and `lParam` of most messages
 * is no selector. */
static void logPosition(HWND window, UINT message, WINDOWPOS FAR *pos)
{
    wsprintf(line, "%04x %04x %04x %04x", window, message, pos->flags, pos->hwndInsertAfter);
    note();
}

static void logMessage(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_ACTIVATEAPP:
    case WM_NCACTIVATE:
    case WM_ACTIVATE:
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
    case WM_ENABLE:
    case WM_CANCELMODE:
    case WM_KEYDOWN:
    case WM_USER:
        wsprintf(line, "%04x %04x %04x %08lx", window, message, wParam, lParam);
        note();
        break;
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
        logPosition(window, message, (WINDOWPOS FAR *)lParam);
        break;
    }
}

/* A point of the case, its windows as handles, named as it is written. */
static void state(LPCSTR when)
{
    wsprintf(line, "S %s %04x %04x %04x %04x %d %d %d", when, GetFocus(), GetActiveWindow(),
             GetSysModalWindow(), isTaskLocked ? isTaskLocked() : 0xffff,
             IsWindowEnabled(windowA) != 0, IsWindowEnabled(windowC) != 0,
             dialogD && IsWindow(dialogD) && IsWindowVisible(dialogD));
    note();
}

static void mark(LPCSTR what, int value)
{
    wsprintf(line, "M %s %d", what, value);
    note();
}

static void name(LPSTR out, WORD hwnd)
{
    if (hwnd == 0) {
        lstrcpy(out, "0");
    } else if (hwnd == 0xffff) {
        lstrcpy(out, "-1");
    } else if (hwnd == 0xfffe) {
        lstrcpy(out, "-2");
    } else if ((HWND)hwnd == windowA) {
        lstrcpy(out, "A");
    } else if ((HWND)hwnd == windowB) {
        lstrcpy(out, "B");
    } else if ((HWND)hwnd == windowH) {
        lstrcpy(out, "H");
    } else if ((HWND)hwnd == windowQ) {
        lstrcpy(out, "Q");
    } else if ((HWND)hwnd == windowC) {
        lstrcpy(out, "C");
    } else if ((HWND)hwnd == windowE) {
        lstrcpy(out, "E");
    } else if ((HWND)hwnd == windowG) {
        lstrcpy(out, "G");
    } else if ((HWND)hwnd == dialogD) {
        lstrcpy(out, "D");
    } else if ((HWND)hwnd == dialogN) {
        lstrcpy(out, "N");
    } else if ((HWND)hwnd == itemD1) {
        lstrcpy(out, "D1");
    } else if ((HWND)hwnd == itemN1) {
        lstrcpy(out, "N1");
    } else if (IsWindow((HWND)hwnd)) {
        /* Another program's or USER's own: its class. */
        lstrcpy(out, "?");
        GetClassName((HWND)hwnd, out + 1, 14);
    } else {
        lstrcpy(out, "?");
    }
}

static void task(LPSTR out, WORD handle)
{
    if (handle == 0) {
        lstrcpy(out, "0");
    } else if ((HTASK)handle == taskP) {
        lstrcpy(out, "P");
    } else if ((HTASK)handle == taskC) {
        lstrcpy(out, "C");
    } else {
        lstrcpy(out, "?");
    }
}

static WORD hex(LPSTR at)
{
    WORD value = 0;

    while (*at && *at != ' ') {
        char c = *at++;

        value = (WORD)(value * 16 + (c <= '9' ? c - '0' : c - 'a' + 10));
    }

    return value;
}

static LPSTR field(LPSTR at, int skip)
{
    while (skip-- > 0) {
        while (*at && *at != ' ') {
            at++;
        }

        while (*at == ' ') {
            at++;
        }
    }

    return at;
}

/* One line of the log, written as its record. */
static void emit(LPSTR one)
{
    char who[16];
    char a[16];
    char b[16];
    char c[16];
    char d[16];
    WORD message;

    wsprintf(probeArgs, "%s,%d", label, number++);

    if (one[0] == 'S' && one[1] == ' ') {
        LPSTR at = field(one, 2);
        char when[24];
        int i = 0;
        LPSTR w = field(one, 1);

        while (*w && *w != ' ' && i < 23) {
            when[i++] = *w++;
        }

        when[i] = '\0';
        name(a, hex(at));
        name(b, hex(field(at, 1)));
        name(c, hex(field(at, 2)));

        if (hex(field(at, 3)) == 0xffff) {
            lstrcpy(d, "missing");
        } else {
            task(d, hex(field(at, 3)));
        }

        wsprintf(probeResult, "%s:focus=%s,active=%s,sysmodal=%s,locked=%s,a=%c,c=%c,d=%c",
                 (LPSTR)when, (LPSTR)a, (LPSTR)b, (LPSTR)c, (LPSTR)d, *field(at, 4),
                 *field(at, 5), *field(at, 6));
        probe("state", probeArgs, probeResult);
        return;
    }

    if (one[0] == 'M' && one[1] == ' ') {
        probe("mark", probeArgs, field(one, 1));
        return;
    }

    if (one[0] == 'H' && one[1] == ' ') {
        name(a, hex(field(one, 2)));
        wsprintf(probeResult, "%d,%s", (int)hex(field(one, 1)), (LPSTR)a);
        probe("hook", probeArgs, probeResult);
        return;
    }

    name(who, hex(one));
    message = hex(field(one, 1));

    switch (message) {
    case WM_SETFOCUS:
    case WM_KILLFOCUS:
        name(a, hex(field(one, 2)));
        wsprintf(probeResult, "%s,%04x,%s", (LPSTR)who, message, (LPSTR)a);
        break;
    case WM_NCACTIVATE:
    case WM_ACTIVATE:
        name(a, hex(field(one, 3) + 4));
        wsprintf(probeResult, "%s,%04x,%d,%s", (LPSTR)who, message, hex(field(one, 2)),
                 (LPSTR)a);
        break;
    case WM_ACTIVATEAPP:
        task(a, hex(field(one, 3) + 4));
        wsprintf(probeResult, "%s,%04x,%d,%s", (LPSTR)who, message, hex(field(one, 2)),
                 (LPSTR)a);
        break;
    case WM_WINDOWPOSCHANGING:
    case WM_WINDOWPOSCHANGED:
        name(a, hex(field(one, 3)));
        wsprintf(probeResult, "%s,%04x,%02x,%s", (LPSTR)who, message,
                 hex(field(one, 2)) & 0xff, (LPSTR)a);
        break;
    case WM_USER:
        name(a, hex(field(one, 2)));
        wsprintf(probeResult, "%s,%04x,%s", (LPSTR)who, message, (LPSTR)a);
        break;
    default:
        wsprintf(probeResult, "%s,%04x,%04x", (LPSTR)who, message, hex(field(one, 2)));
        break;
    }

    probe("msg", probeArgs, probeResult);
}

/* The log read back and written, then emptied. */
static void flush(void)
{
    HFILE file = _lopen(LOG, OF_READ);
    int length = 0;
    int i;
    LPSTR start = text;

    if (file != HFILE_ERROR) {
        length = _lread(file, text, sizeof(text) - 1);
        _lclose(file);
    }

    text[length < 0 ? 0 : length] = '\0';

    for (i = 0; text[i]; i++) {
        if (text[i] == '\r') {
            text[i] = '\0';
        } else if (text[i] == '\n') {
            text[i] = '\0';

            if (*start) {
                emit(start);
            }

            start = text + i + 1;
        }
    }

    file = _lcreat(LOG, 0);
    _lclose(file);
    number = 0;
}

static void key(BYTE vk, BOOL up)
{
    keyAX = (WORD)vk | (up ? 0x8000 : 0);
    keyBX = 0x41;

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

static void settle(int times)
{
    MSG msg;
    int i;

    for (i = 0; i < times; i++) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        Yield();
    }
}

DWORD FAR PASCAL _export FilterProc(int code, WPARAM wParam, LPARAM lParam)
{
    MSG FAR *msg = (MSG FAR *)lParam;

    if (code >= 0 && msg->message == WM_START) {
        wsprintf(line, "H %x %04x", code, msg->hwnd);
        note();
    }

    return DefHookProc(code, wParam, lParam, &hook);
}

LONG FAR PASCAL _export WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    if (message == WM_REPLY) {
        replied = TRUE;
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

BOOL FAR PASCAL _export DialogProcN(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    switch (message) {
    case WM_INITDIALOG:
        dialogN = hwnd;
        itemN1 = GetDlgItem(hwnd, ID_N1);
        state("ninit");
        PostMessage(hwnd, WM_START, 0, 0L);
        return TRUE;
    case WM_START:
        SetTimer(hwnd, TICK, 200, NULL);
        return TRUE;
    case WM_TIMER:
        KillTimer(hwnd, TICK);
        state("ntick");
        EndDialog(hwnd, 3);
        state("nended");
        return TRUE;
    }

    return FALSE;
}

BOOL FAR PASCAL _export DialogProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    logMessage(hwnd, message, wParam, lParam);

    switch (message) {
    case WM_INITDIALOG:
        dialogD = hwnd;
        itemD1 = GetDlgItem(hwnd, ID_D1);
        ticks = 0;
        state("init");
        PostMessage(hwnd, WM_START, 0, 0L);
        return TRUE;
    case WM_START:
        state("started");
        SetTimer(hwnd, TICK, 200, NULL);
        return TRUE;
    case WM_TIMER:
        KillTimer(hwnd, TICK);
        ticks++;
        state("tick");

        if (kind == SYSMODAL && ticks == 1) {
            key(VK_F7, FALSE);
            key(VK_F7, TRUE);
            SetTimer(hwnd, TICK, 200, NULL);
            return TRUE;
        }

        if (kind == SYSMODAL) {
            MSG msg;

            replied = FALSE;
            PostMessage(windowC, WM_USER, (WPARAM)windowA, 0L);
            SetActiveWindow(windowB);
            state("toB");
            SetActiveWindow(hwnd);
            state("toD");
            msg.hwnd = hwnd;
            msg.message = WM_START;
            msg.wParam = 0;
            msg.lParam = 0;
            msg.time = 0;
            msg.pt.x = 0;
            msg.pt.y = 0;
            mark("filter", CallMsgFilter(&msg, 7));
            EndDialog(hwnd, 9);
        } else if (kind == NESTED) {
            HWND d = dialogD;

            mark("nanswer", DialogBoxIndirect(instance, memoryN, hwnd, (DLGPROC)dialogProcN));
            dialogD = d;
            state("back");
            EndDialog(hwnd, 4);
        } else {
            EndDialog(hwnd, 5);
        }

        state("ended");
        return TRUE;
    }

    return FALSE;
}

/* A template in a global block: a dialog with one push button. */
static BYTE FAR *template;
static int at;

static void byte(BYTE value)
{
    template[at++] = value;
}

static void word(WORD value)
{
    byte(LOBYTE(value));
    byte(HIBYTE(value));
}

static void string(LPCSTR text)
{
    while (*text) {
        byte(*text++);
    }

    byte(0);
}

static HGLOBAL build(DWORD style, LPCSTR caption, int id, LPCSTR button, int x)
{
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 256);
    DWORD control = BS_PUSHBUTTON | WS_TABSTOP | WS_CHILD | WS_VISIBLE;

    template = (BYTE FAR *)GlobalLock(memory);
    at = 0;
    word(LOWORD(style));
    word(HIWORD(style));
    byte(1);
    word(x);
    word(60);
    word(120);
    word(50);
    byte(0);
    byte(0);
    string(caption);
    word(10);
    word(20);
    word(40);
    word(14);
    word(id);
    word(LOWORD(control));
    word(HIWORD(control));
    byte(0x80);
    string(button);
    byte(0);
    GlobalUnlock(memory);
    return memory;
}

/* Back to A active with the focus, and the log written under the case's
 * name and `-reset`. */
static void reset(LPCSTR after)
{
    static char name[24];

    wsprintf(name, "%s-reset", after);
    label = name;
    number = 0;
    dialogD = NULL;
    dialogN = NULL;
    SetActiveWindow(windowA);
    SetFocus(windowA);
    settle(20);
    flush();
}

static void begin(LPCSTR name)
{
    label = name;
    number = 0;
}

int PASCAL WinMain(HINSTANCE hinst, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    DWORD style;
    int i;
    HFILE file;

    instance = hinst;
    probeOpen(OUTPUT);
    file = _lcreat(LOG, 0);
    _lclose(file);
    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    isTaskLocked = (ISTASKLOCKED)GetProcAddress(GetModuleHandle("KERNEL"), "ISTASKLOCKED");
    lockMyTask = (LOCKMYTASK)GetProcAddress(GetModuleHandle("USER"), "LOCKMYTASK");
    taskP = GetCurrentTask();
    dialogProc = MakeProcInstance((FARPROC)DialogProc, hinst);
    dialogProcN = MakeProcInstance((FARPROC)DialogProcN, hinst);

    wc.style = 0;
    wc.lpfnWndProc = WindowProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = NULL;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszMenuName = NULL;
    wc.lpszClassName = "ProbeSysDlg";
    RegisterClass(&wc);

    windowH = CreateWindow("ProbeSysDlg", "H", WS_OVERLAPPEDWINDOW, 60, 100, 200, 100, NULL,
                           NULL, instance, NULL);
    windowB = CreateWindow("ProbeSysDlg", "B", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 240, 300,
                           200, NULL, NULL, instance, NULL);
    windowA = CreateWindow("ProbeSysDlg", "A", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 20, 20, 300,
                           200, NULL, NULL, instance, NULL);
    windowQ = CreateWindow("ProbeSysDlg", "Q", WS_POPUP | WS_CAPTION | WS_VISIBLE, 200, 160, 140,
                           80, windowA, NULL, instance, NULL);

    style = WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME;
    memoryD = build(style, "D", ID_D1, "D1", 40);
    memorySys = build(style | DS_SYSMODAL, "D", ID_D1, "D1", 40);
    memoryVis = build(style | DS_SYSMODAL | WS_VISIBLE, "D", ID_D1, "D1", 40);
    memoryN = build(style, "N", ID_N1, "N1", 100);

    WinExec("SYSDLGC.EXE", SW_SHOWNORMAL);

    for (i = 0; i < 200 && !windowC; i++) {
        settle(1);
        windowC = FindWindow(NULL, "Probe C");
    }

    windowE = FindWindow(NULL, "Probe E");
    windowG = FindWindow(NULL, "Probe G");
    probe("started", "C", (LPSTR)(windowC && windowE && windowG ? "yes" : "no"));

    if (windowC && keybdEvent && isTaskLocked && lockMyTask) {
        taskC = GetWindowTask(windowC);
        filterProc = (HOOKPROC)MakeProcInstance((FARPROC)FilterProc, instance);
        hook = SetWindowsHook(WH_MSGFILTER, filterProc);
        reset("setup");

        begin("app");
        SetActiveWindow(windowC);
        settle(10);
        state("toC");
        SetActiveWindow(windowA);
        settle(10);
        state("toA");
        flush();
        reset("app");

        begin("sysmodal");
        kind = SYSMODAL;
        mark("answer", DialogBoxIndirect(instance, memorySys, windowA, (DLGPROC)dialogProc));
        state("after");
        settle(20);
        mark("replied", replied);
        state("settled");
        flush();
        reset("sysmodal");

        begin("nested");
        kind = NESTED;
        mark("answer", DialogBoxIndirect(instance, memorySys, windowA, (DLGPROC)dialogProc));
        state("after");
        flush();
        reset("nested");

        begin("owner");
        kind = OWNER;
        SetActiveWindow(windowC);
        settle(10);
        state("before");
        mark("answer", DialogBoxIndirect(instance, memoryD, windowC, (DLGPROC)dialogProc));
        state("after");
        settle(10);
        state("settled");
        flush();
        reset("owner");

        begin("modeless");
        dialogD = CreateDialogIndirect(instance, (LPCSTR)GlobalLock(memoryVis), windowA,
                                       (DLGPROC)dialogProc);
        GlobalUnlock(memoryVis);
        state("made");
        EndDialog(dialogD, 1);
        state("ended");
        DestroyWindow(dialogD);
        state("destroyed");
        flush();
        reset("modeless");

        begin("destroyed");
        dialogD = CreateDialogIndirect(instance, (LPCSTR)GlobalLock(memoryVis), windowA,
                                       (DLGPROC)dialogProc);
        GlobalUnlock(memoryVis);
        state("made");
        DestroyWindow(dialogD);
        state("destroyed");
        lockMyTask(FALSE);
        state("unlocked");
        flush();
        reset("destroyed");

        UnhookWindowsHook(WH_MSGFILTER, filterProc);
        SendMessage(windowC, WM_CLOSE, 0, 0L);
        settle(20);
    }

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
