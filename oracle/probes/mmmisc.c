/*
 * MMSYSTEM's smaller exports: what each answers, on an installation with no
 * sound driver and (`--display vgasound`) on the one with the Sound Blaster.
 *
 * * `version`: `mmsystemGetVersion`; `wep`: MMSYSTEM's `WEP`, asked by its
 *   name; `debugstr`: that `OutputDebugStr` comes back.
 * * `stack`: `StackEnter` and `StackLeave`, called by their ordinals: the
 *   carry flag after each, whether the stack segment changed, how far the
 *   stack pointer moved, and the word on top of the stack after entering.
 * * `notify`: `mciDriverNotify`'s answer and the message it posts.
 * * `task`: `mmGetCurrentTask`, `mmTaskSignal` and the message it posts,
 *   `mmTaskYield`, and `mmTaskBlock` with messages waiting before the one it
 *   waits for: what it answers and what it did with the others.
 * * `drv`: `DrvOpen`, `DrvGetModuleHandle`, `DrvSendMessage`,
 *   `DrvDefDriverProc` and `DrvClose`, on the timer's driver.
 * * `joy`: every joystick call, for joysticks 0, 1 and 2.
 * * `mci`: a waveaudio device opened, and its creator task, its yield
 *   procedure set, asked and called, `MCI_BREAK`'s effect on it, and the
 *   device looked for by an element ID; `mciExecute` of a command that
 *   succeeds.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MMMISC.OUT"

typedef WORD(FAR PASCAL *WORDPROC)(void);
typedef BOOL(FAR PASCAL *NOTIFYPROC)(HWND, UINT, UINT);
typedef BOOL(FAR PASCAL *SIGNALPROC)(HTASK);
typedef UINT(FAR PASCAL *BLOCKPROC)(HTASK);
typedef HTASK(FAR PASCAL *TASKPROC)(void);
typedef void(FAR PASCAL *VOIDPROC)(void);
typedef void(FAR PASCAL *STRPROC)(LPCSTR);
typedef int(FAR PASCAL *WEPPROC)(int);
typedef HDRVR(FAR PASCAL *OPENPROC)(LPCSTR, LPCSTR, LPARAM);
typedef LRESULT(FAR PASCAL *CLOSEPROC)(HDRVR, LPARAM, LPARAM);
typedef HINSTANCE(FAR PASCAL *MODPROC)(HDRVR);
typedef LRESULT(FAR PASCAL *SENDPROC)(HDRVR, UINT, LPARAM, LPARAM);
typedef LRESULT(FAR PASCAL *DEFPROC)(DWORD, HDRVR, UINT, LPARAM, LPARAM);
typedef UINT(FAR PASCAL *YIELDCALL)(UINT);
typedef BOOL(FAR PASCAL *EXECPROC)(LPCSTR);
typedef UINT(FAR PASCAL *CALPROC)(UINT, UINT FAR *, UINT FAR *, UINT FAR *, UINT FAR *, UINT FAR *, UINT FAR *);

static HMODULE mmsystem;
static HWND window;
static FARPROC enterProc;
static FARPROC leaveProc;
static WORD spBefore, spEntered, spLeft, ssBefore, ssEntered, ssLeft, topEntered;
static WORD flagsEntered, flagsLeft;
static int yields;
static UINT yieldId;
static DWORD yieldData;
static int dispatched;
static YIELDPROC ourYield;

static FARPROC entry(LPCSTR name)
{
    return GetProcAddress(mmsystem, name);
}

static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_USER + 5) {
        dispatched++;
        wsprintf(probeResult, "%u,%lx", (UINT)wParam, (DWORD)lParam);
        probe("task", "dispatched", probeResult);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static UINT CALLBACK __loadds YieldProc(UINT id, DWORD data)
{
    yields++;
    yieldId = id;
    yieldData = data;
    wsprintf(probeResult, "%u,%lx", id, data);
    probe("yieldproc", "", probeResult);
    return 0x55;
}

static void stack(void)
{
    _asm {
        mov spBefore, sp
        mov ax, ss
        mov ssBefore, ax
        call dword ptr enterProc
        pushf
        pop ax
        mov flagsEntered, ax
        mov spEntered, sp
        mov ax, ss
        mov ssEntered, ax
        mov bx, sp
        mov ax, ss:[bx]
        mov topEntered, ax
        call dword ptr leaveProc
        pushf
        pop ax
        mov flagsLeft, ax
        mov spLeft, sp
        mov ax, ss
        mov ssLeft, ax
    }
}

static void joy(UINT id)
{
    JOYCAPS caps;
    JOYINFO info;
    UINT threshold = 0x1234;
    UINT xb = 1, xd = 2, yb = 3, yd = 4, zb = 5, zd = 6;

    wsprintf(probeArgs, "caps,%u", id);
    wsprintf(probeResult, "%u", joyGetDevCaps(id, &caps, sizeof(caps)));
    probe("joy", probeArgs, probeResult);

    wsprintf(probeArgs, "pos,%u", id);
    wsprintf(probeResult, "%u", joyGetPos(id, &info));
    probe("joy", probeArgs, probeResult);

    wsprintf(probeArgs, "getthreshold,%u", id);
    wsprintf(probeResult, "%u,%x", joyGetThreshold(id, &threshold), threshold);
    probe("joy", probeArgs, probeResult);

    wsprintf(probeArgs, "setthreshold,%u", id);
    wsprintf(probeResult, "%u", joySetThreshold(id, 5));
    probe("joy", probeArgs, probeResult);

    wsprintf(probeArgs, "release,%u", id);
    wsprintf(probeResult, "%u", joyReleaseCapture(id));
    probe("joy", probeArgs, probeResult);

    wsprintf(probeArgs, "capture,%u", id);
    wsprintf(probeResult, "%u", joySetCapture(window, id, 50, FALSE));
    probe("joy", probeArgs, probeResult);

    wsprintf(probeArgs, "capture-null,%u", id);
    wsprintf(probeResult, "%u", joySetCapture(NULL, id, 50, FALSE));
    probe("joy", probeArgs, probeResult);

    wsprintf(probeArgs, "calibration,%u", id);
    wsprintf(probeResult, "%u,%u,%u,%u,%u,%u,%u",
             ((CALPROC)entry("JOYSETCALIBRATION"))(id, &xb, &xd, &yb, &yd, &zb, &zd), xb, xd, yb, yd, zb, zd);
    probe("joy", probeArgs, probeResult);
}

/* The box mciExecute puts up, read and dismissed from a timer its loop
 * dispatches: its title, and each child's text. */
static void CALLBACK BoxTimer(HWND hwnd, UINT message, UINT id, DWORD time)
{
    HWND box = GetActiveWindow();
    HWND child;
    char text[128];

    KillTimer(NULL, id);
    if (box == NULL || box == window) {
        probe("box", "", "none");
        return;
    }
    GetWindowText(box, text, sizeof(text));
    lstrcpy(probeResult, text);
    for (child = GetWindow(box, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        GetWindowText(child, text, sizeof(text));
        lstrcat(probeResult, "|");
        lstrcat(probeResult, text);
    }
    probe("box", "", probeResult);
    EndDialog(box, IDOK);
}

static void execute(LPCSTR what, LPCSTR command)
{
    BOOL answer;

    SetTimer(NULL, 0, 200, (TIMERPROC)BoxTimer);
    answer = ((EXECPROC)entry("MCIEXECUTE"))(command);
    wsprintf(probeResult, "%d", answer);
    probe("mci", what, probeResult);
}

static void yieldProc(LPCSTR what, UINT id)
{
    DWORD data = 0xdeadbeefL;
    YIELDPROC proc = mciGetYieldProc(id, &data);

    /* The data's high word is a window, whose handle is the system's own:
     * said to be the probe's, or nought, or other. */
    wsprintf(probeResult, "%s,%x,%s,%s",
             proc == NULL ? (LPSTR)"null" : proc == ourYield ? (LPSTR)"ours" : (LPSTR)"other",
             LOWORD(data),
             HIWORD(data) == (UINT)window ? (LPSTR)"window" : HIWORD(data) == 0 ? (LPSTR)"0" : (LPSTR)"other",
             proc && !IsBadCodePtr((FARPROC)proc) ? (LPSTR)"code" : (LPSTR)"nocode");
    probe("mci", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS wc;
    MSG msg;
    HTASK task;
    HDRVR driver;
    MCI_OPEN_PARMS open;
    MCI_BREAK_PARMS breaks;
    DWORD result;
    UINT id;
    UINT i;

    probeOpen(OUTPUT);
    mmsystem = GetModuleHandle("MMSYSTEM");
    task = GetCurrentTask();
    ourYield = (YIELDPROC)MakeProcInstance((FARPROC)YieldProc, instance);

    wc.style = 0;
    wc.lpfnWndProc = WindowProc;
    wc.cbClsExtra = 0;
    wc.cbWndExtra = 0;
    wc.hInstance = instance;
    wc.hIcon = NULL;
    wc.hCursor = NULL;
    wc.hbrBackground = NULL;
    wc.lpszMenuName = NULL;
    wc.lpszClassName = "MmMisc";
    RegisterClass(&wc);
    window = CreateWindow("MmMisc", "mmmisc", WS_OVERLAPPED, 0, 0, 100, 100, NULL, NULL, instance, NULL);

    wsprintf(probeResult, "%x", mmsystemGetVersion());
    probe("version", "", probeResult);

    wsprintf(probeResult, "%d", ((WEPPROC)entry("WEP"))(0));
    probe("wep", "", probeResult);

    ((STRPROC)entry("OUTPUTDEBUGSTR"))("mmmisc\r\n");
    probe("debugstr", "", "returned");

    /* StackEnter, StackLeave: by ordinal. */
    enterProc = GetProcAddress(mmsystem, MAKEINTRESOURCE(32));
    leaveProc = GetProcAddress(mmsystem, MAKEINTRESOURCE(33));
    stack();
    wsprintf(probeResult, "cf=%u,ss=%s,sp=%d,top=%x", flagsEntered & 1,
             ssEntered == ssBefore ? (LPSTR)"same" : (LPSTR)"other", (int)(spBefore - spEntered), topEntered);
    probe("stack", "enter", probeResult);
    wsprintf(probeResult, "cf=%u,ss=%s,sp=%d", flagsLeft & 1,
             ssLeft == ssBefore ? (LPSTR)"same" : (LPSTR)"other", (int)(spBefore - spLeft));
    probe("stack", "leave", probeResult);

    /* mciDriverNotify: the message it posts. */
    /* What USER's posting leaves in AX: nought, or not. */
    probe("notify", "answer", ((NOTIFYPROC)entry("MCIDRIVERNOTIFY"))(window, 7, MCI_NOTIFY_SUCCESSFUL) ? "nonzero" : "0");
    if (PeekMessage(&msg, window, 0, 0, PM_REMOVE)) {
        wsprintf(probeResult, "%x,%x,%lx", msg.message, msg.wParam, msg.lParam);
    } else {
        lstrcpy(probeResult, "none");
    }
    probe("notify", "message", probeResult);
    probe("notify", "badwindow", ((NOTIFYPROC)entry("MCIDRIVERNOTIFY"))((HWND)0x1234, 7, MCI_NOTIFY_SUCCESSFUL) ? "nonzero" : "0");

    /* The tasks. */
    probe("task", "current", ((TASKPROC)entry("MMGETCURRENTTASK"))() == task ? "self" : "other");
    probe("task", "signal", ((SIGNALPROC)entry("MMTASKSIGNAL"))(task) ? "nonzero" : "0");
    if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        wsprintf(probeResult, "%x,%s,%x,%lx", msg.message, msg.hwnd ? (LPSTR)"window" : (LPSTR)"none",
                 msg.wParam, msg.lParam);
    } else {
        lstrcpy(probeResult, "none");
    }
    probe("task", "signalled", probeResult);
    probe("task", "signal-bad", ((SIGNALPROC)entry("MMTASKSIGNAL"))((HTASK)0x1234) ? "nonzero" : "0");
    ((VOIDPROC)entry("MMTASKYIELD"))();
    probe("task", "yield", "returned");

    PostAppMessage(task, 0x300, 1, 2L);
    PostMessage(window, WM_USER + 5, 3, 4L);
    PostAppMessage(task, 0x3a0, 5, 6L);
    PostAppMessage(task, 0x401, 7, 8L);
    wsprintf(probeResult, "%x", ((BLOCKPROC)entry("MMTASKBLOCK"))(task));
    probe("task", "block", probeResult);
    wsprintf(probeResult, "%d", dispatched);
    probe("task", "block-dispatched", probeResult);
    if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
        wsprintf(probeResult, "%x,%x,%lx", msg.message, msg.wParam, msg.lParam);
    } else {
        lstrcpy(probeResult, "none");
    }
    probe("task", "block-left", probeResult);
    ((SIGNALPROC)entry("MMTASKSIGNAL"))(task);
    wsprintf(probeResult, "%x", ((BLOCKPROC)entry("MMTASKBLOCK"))(task));
    probe("task", "block-again", probeResult);
    while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
    }

    /* The Drv* calls, on the timer's driver. */
    driver = ((OPENPROC)entry("DRVOPEN"))("timer", NULL, 0L);
    probe("drv", "open", driver ? "handle" : "none");
    {
        char name[128];
        LPSTR base = name;
        LPSTR at;

        name[0] = 0;
        GetModuleFileName(((MODPROC)entry("DRVGETMODULEHANDLE"))(driver), name, sizeof(name));
        for (at = name; *at; at++) {
            if (*at == '\\') {
                base = at + 1;
            }
        }
        probe("drv", "module", base);
    }
    wsprintf(probeResult, "%lx", ((SENDPROC)entry("DRVSENDMESSAGE"))(driver, DRV_QUERYCONFIGURE, 0L, 0L));
    probe("drv", "send", probeResult);
    for (i = 1; i <= 11; i++) {
        wsprintf(probeArgs, "def,%u", i);
        wsprintf(probeResult, "%lx", ((DEFPROC)entry("DRVDEFDRIVERPROC"))(0L, driver, i, 0L, 0L));
        probe("drv", probeArgs, probeResult);
    }
    wsprintf(probeResult, "%lx", ((CLOSEPROC)entry("DRVCLOSE"))(driver, 0L, 0L));
    probe("drv", "close", probeResult);
    wsprintf(probeResult, "%lx", ((CLOSEPROC)entry("DRVCLOSE"))(driver, 0L, 0L));
    probe("drv", "close-again", probeResult);

    /* The joysticks. */
    wsprintf(probeResult, "%u", joyGetNumDevs());
    probe("joy", "count", probeResult);
    joy(0);
    joy(1);
    joy(2);

    /* MCI. */
    wsprintf(probeResult, "%u", mciGetCreatorTask(0) == NULL ? 0 : 1);
    probe("mci", "creator-0", probeResult);
    yieldProc("yield-none", 1);
    wsprintf(probeResult, "%u", ((YIELDCALL)entry("MCIDRIVERYIELD"))(1));
    probe("mci", "driveryield-none", probeResult);

    open.lpstrDeviceType = "waveaudio";
    result = mciSendCommand(0, MCI_OPEN, MCI_OPEN_TYPE, (DWORD)(LPVOID)&open);
    id = open.wDeviceID;
    wsprintf(probeResult, "%lx,%u", result, id);
    probe("mci", "open", probeResult);

    probe("mci", "creator", mciGetCreatorTask(id) == task ? "self" : "other");
    wsprintf(probeResult, "%u", mciGetCreatorTask(id + 1) == NULL ? 0 : 1);
    probe("mci", "creator-next", probeResult);
    yieldProc("yield-opened", id);
    probe("mci", "yield-null-data", mciGetYieldProc(id, NULL) ? "proc" : "null");
    wsprintf(probeResult, "%u", ((YIELDCALL)entry("MCIDRIVERYIELD"))(id));
    probe("mci", "driveryield-default", probeResult);

    wsprintf(probeResult, "%d", mciSetYieldProc(id, ourYield, 0x12345678L));
    probe("mci", "setyield", probeResult);
    yieldProc("yield-set", id);
    i = ((YIELDCALL)entry("MCIDRIVERYIELD"))(id);
    wsprintf(probeResult, "%u,%d,%s,%lx", i, yields, yieldId == id ? (LPSTR)"id" : (LPSTR)"other", yieldData);
    probe("mci", "driveryield-ours", probeResult);
    wsprintf(probeResult, "%d", mciSetYieldProc(id, NULL, 0L));
    probe("mci", "setyield-null", probeResult);
    yieldProc("yield-after-null", id);
    wsprintf(probeResult, "%d", mciSetYieldProc(0, ourYield, 1L));
    probe("mci", "setyield-0", probeResult);
    wsprintf(probeResult, "%d", mciSetYieldProc(id + 1, ourYield, 1L));
    probe("mci", "setyield-next", probeResult);

    breaks.dwCallback = 0;
    breaks.nVirtKey = VK_ESCAPE;
    breaks.hwndBreak = window;
    wsprintf(probeResult, "%lx", mciSendCommand(id, MCI_BREAK, MCI_BREAK_KEY | MCI_BREAK_HWND, (DWORD)(LPVOID)&breaks));
    probe("mci", "break", probeResult);
    yieldProc("yield-break", id);
    {
        DWORD data = 0;

        mciGetYieldProc(id, &data);
        probe("mci", "break-data", data == MAKELONG(VK_ESCAPE, window) ? "key,window" : "other");
    }
    wsprintf(probeResult, "%lx", mciSendCommand(id, MCI_BREAK, MCI_BREAK_OFF, (DWORD)(LPVOID)&breaks));
    probe("mci", "break-off", probeResult);
    yieldProc("yield-break-off", id);
    breaks.nVirtKey = VK_F2;
    wsprintf(probeResult, "%lx", mciSendCommand(id, MCI_BREAK, MCI_BREAK_KEY, (DWORD)(LPVOID)&breaks));
    probe("mci", "break-nowindow", probeResult);
    yieldProc("yield-break-nowindow", id);

    wsprintf(probeResult, "%u", mciGetDeviceIDFromElementID(0x1234L, "waveaudio"));
    probe("mci", "fromelement", probeResult);
    wsprintf(probeResult, "%u", mciGetDeviceIDFromElementID(0x1234L, NULL));
    probe("mci", "fromelement-null", probeResult);

    wsprintf(probeResult, "%d", ((EXECPROC)entry("MCIEXECUTE"))("break waveaudio off"));
    probe("mci", "execute", probeResult);
    execute("execute-unknown", "status nosuch mode");
    execute("execute-word", "nosuch");
    execute("execute-spaces", "  play   waveaudio   from 99");

    wsprintf(probeResult, "%lx", mciSendCommand(id, MCI_CLOSE, 0L, 0L));
    probe("mci", "close", probeResult);
    yieldProc("yield-closed", id);
    wsprintf(probeResult, "%u", mciGetCreatorTask(id) == NULL ? 0 : 1);
    probe("mci", "creator-closed", probeResult);

    DestroyWindow(window);
    probeFinish();

    return 0;
}
