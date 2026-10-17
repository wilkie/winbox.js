/*
 * COMMDLG's Print and Print Setup dialogs, `PrintDlg`, in the cases `prdlg`
 * leaves out: Options... and the printer driver's own dialog it runs,
 * `WM_COMMAND` 3 and 4, a program's own templates by name and by handle,
 * the context of `PD_RETURNDC` on `FILE:` with `PD_PRINTTOFILE`, and the
 * Print dialog's Setup button opening Print Setup again after it ends with
 * `PDERR_DEFAULTDIFFERENT`. Driven as `prdlg` drives the dialogs: the keys
 * through USER's `KEYBD_EVENT`, a timer of the program's taking a step at a
 * time, and every other window COMMDLG or the driver puts up read and
 * answered with Enter.
 *
 * As `prdlg`, the probe writes the printers it uses into WIN.INI itself:
 * the default printer, `Apple LaserWriter Plus` on `LPT1:` with the
 * PostScript driver, and the same printer on `LPT2:`.
 *
 * * `setup`, `print`: a control of the dialog at a step, as `prdlg`
 *   writes them; `focus`, the control with the focus.
 * * `box`: another window at a step -- the driver's own dialog, or a box
 *   -- its caption, then each control's text.
 * * `command`: what the dialog's procedure answered `WM_COMMAND` 4.
 * * `result`: what `PrintDlg` answered, as it answered it, the error, the
 *   flags, the handles it left.
 * * `devnames`, `devmode`: what it left, as `prdlg` writes them.
 * * `dc`: the device context left, its technology and width.
 * * `template`: whether the program's template handle was left to it.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <commdlg.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\PRDLGX.OUT"

#define PRINTER "Apple LaserWriter Plus"

typedef BOOL(FAR PASCAL *PRINTPROC)(PRINTDLG FAR *);
typedef DWORD(FAR PASCAL *ERRORPROC)(void);

static PRINTPROC printDlg;
static ERRORPROC extendedError;
static FARPROC keybdEvent;
static HINSTANCE instance;
static HWND owner;
static PRINTDLG pd;
static int run;
static int step;
static FARPROC timerThunk;
static LPCSTR runName;

static const int PRINT_IDS[] = {0x445, 0x440, 0x430, 0x420, 0x421, 0x422, 0x441, 0x480,
                                0x442, 0x481, 0x443, 0x470, 0x444, 0x482, 0x410, 0x411,
                                IDOK,  IDCANCEL, 0x400, 0x40e, 0x500};
static const int SETUP_IDS[] = {0x432, 0x440, 0x422, 0x423, 0x470, 0x430, 0x43c, 0x420, 0x421, 0x431,
                                0x441, 0x471, 0x442, 0x472, IDOK,  IDCANCEL, 0x400, 0x40e, 0x500};

/* The runs. */
#define RUN_OPTIONS 1
#define RUN_COMMANDS 2
#define RUN_PRINT_COMMAND 3
#define RUN_TO_FILE 4
#define RUN_SETUP_TEMPLATE 5
#define RUN_PRINT_TEMPLATE 6
#define RUN_SETUP_HANDLE 7
#define RUN_DEFAULT_DIFFERENT 8

static WORD keyAX;
static WORD keyBX;

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

static void alt(BYTE vk, BYTE scan)
{
    key(VK_MENU, 0x38, FALSE);
    press(vk, scan);
    key(VK_MENU, 0x38, TRUE);
}

static DWORD error(void)
{
    return extendedError ? extendedError() : 0xffffffffL;
}

/* Which of the dialogs a window is: 1 Print, 2 Print Setup, 3 another, 0 none. */
static int kind(HWND hwnd)
{
    if (!hwnd || hwnd == owner) {
        return 0;
    }

    if (GetDlgItem(hwnd, 0x480) && GetDlgItem(hwnd, 0x482)) {
        return 1;
    }

    if (GetDlgItem(hwnd, 0x471) && GetDlgItem(hwnd, 0x423)) {
        return 2;
    }

    return 3;
}

static void controls(HWND dialog, LPCSTR what)
{
    const int *ids = kind(dialog) == 1 ? PRINT_IDS : SETUP_IDS;
    int count = kind(dialog) == 1 ? sizeof(PRINT_IDS) / sizeof(int) : sizeof(SETUP_IDS) / sizeof(int);
    LPCSTR function = kind(dialog) == 1 ? "print" : "setup";
    HWND focus = GetFocus();
    char caption[64];
    int index;

    GetWindowText(dialog, caption, sizeof(caption));
    wsprintf(probeArgs, "%s caption", what);
    probe(function, probeArgs, caption);

    for (index = 0; index < count; index++) {
        HWND control = GetDlgItem(dialog, ids[index]);
        char name[16];
        char text[80];
        LPSTR out = probeResult;

        wsprintf(probeArgs, "%s %x", what, ids[index]);

        if (!control) {
            probe(function, probeArgs, "none");
            continue;
        }

        GetClassName(control, name, sizeof(name));
        GetWindowText(control, text, sizeof(text));
        out += wsprintf(out, "%d%d%d%d %s", IsWindowEnabled(control) ? 1 : 0,
                        IsWindowVisible(control) ? 1 : 0,
                        lstrcmpi(name, "Button") == 0 ? (int)SendMessage(control, BM_GETCHECK, 0, 0)
                                                     : 0,
                        (GetWindowLong(control, GWL_STYLE) & WS_TABSTOP) ? 1 : 0, (LPSTR)text);

        if (lstrcmpi(name, "ComboBox") == 0) {
            int items = (int)SendMessage(control, CB_GETCOUNT, 0, 0);
            int item;

            out += wsprintf(out, " [%d:%d]", items, (int)SendMessage(control, CB_GETCURSEL, 0, 0));

            for (item = 0; item < items && out - probeResult < 1800; item++) {
                SendMessage(control, CB_GETLBTEXT, item, (LPARAM)(LPSTR)text);
                out += wsprintf(out, " |%s", (LPSTR)text);
            }
        }

        probe(function, probeArgs, probeResult);
    }

    wsprintf(probeResult, "%x", focus ? GetDlgCtrlID(focus) : 0);
    probe("focus", what, probeResult);
}

/* Another window: its caption and its controls' texts, then Enter. */
static void box(HWND hwnd)
{
    HWND child;
    LPSTR out = probeResult;
    char text[200];

    GetWindowText(hwnd, text, sizeof(text));
    out += wsprintf(out, "%s", (LPSTR)text);

    for (child = GetWindow(hwnd, GW_CHILD); child && out - probeResult < 1800;
         child = GetWindow(child, GW_HWNDNEXT)) {
        GetWindowText(child, text, sizeof(text));

        if (text[0]) {
            out += wsprintf(out, " | %s", (LPSTR)text);
        }
    }

    wsprintf(probeArgs, "%s %d", runName, step);
    probe("box", probeArgs, probeResult);
    press(VK_RETURN, 0x1c);
}

static void steps(HWND dialog, int which)
{
    switch (run) {
    case RUN_OPTIONS:
        if (step == 1) {
            controls(dialog, "options-start");
            alt('O', 0x18);
        } else if (step == 2) {
            controls(dialog, "options-after");
            press(VK_ESCAPE, 0x01);
        }
        break;
    case RUN_COMMANDS:
        if (step == 1) {
            alt('L', 0x26);
        } else if (step == 2) {
            SendDlgItemMessage(dialog, 0x470, CB_SETCURSEL, 1, 0);
            SendMessage(dialog, WM_COMMAND, 0x470,
                        MAKELPARAM(GetDlgItem(dialog, 0x470), CBN_SELCHANGE));
            controls(dialog, "commands-changed");
            wsprintf(probeResult, "%ld", SendMessage(dialog, WM_COMMAND, 4, 0));
            probe("command", "4", probeResult);
            controls(dialog, "commands-four");
        } else if (step == 3) {
            PostMessage(dialog, WM_COMMAND, 3, MAKELPARAM(7, 0));
        }
        break;
    case RUN_PRINT_COMMAND:
        if (step == 1) {
            PostMessage(dialog, WM_COMMAND, 3, MAKELPARAM(5, 0));
        }
        break;
    case RUN_TO_FILE:
        if (step == 1) {
            alt('L', 0x26);
        } else if (step == 2) {
            press(VK_RETURN, 0x1c);
        }
        break;
    case RUN_SETUP_TEMPLATE:
        if (step == 1) {
            controls(dialog, "template");
            press(VK_RETURN, 0x1c);
        }
        break;
    case RUN_PRINT_TEMPLATE:
        if (step == 1) {
            controls(dialog, "template");
            press(VK_ESCAPE, 0x01);
        }
        break;
    case RUN_SETUP_HANDLE:
        if (step == 1) {
            controls(dialog, "handle");
            press(VK_ESCAPE, 0x01);
        }
        break;
    case RUN_DEFAULT_DIFFERENT:
        if (step == 1 && which == 1) {
            /* The default printer changed under the Print dialog's feet:
             * its DEVNAMES, marked the default, is no longer. */
            WriteProfileString("windows", "device", PRINTER ",pscript,LPT2:");
            alt('S', 0x1f);
        } else if (which == 2) {
            controls(dialog, "reopened");
            press(VK_ESCAPE, 0x01);
        } else if (which == 1) {
            GetDlgItemText(dialog, 0x440, probeResult, 80);
            probe("print", "different-after 440", probeResult);
            WriteProfileString("windows", "device", PRINTER ",pscript,LPT1:");
            press(VK_ESCAPE, 0x01);
        }
        break;
    }
}

static void next(void)
{
    HWND active = GetActiveWindow();
    int which = kind(active);

    if (which == 3) {
        box(active);
        return;
    }

    if (!which) {
        return;
    }

    step++;

    /* A run that went wrong is ended rather than left to hang. */
    if (step > 20) {
        PostMessage(active, WM_COMMAND, IDCANCEL, 0);
        return;
    }

    steps(active, which);
}

void FAR PASCAL _export Tick(HWND hwnd, UINT message, UINT id, DWORD time)
{
    next();
    (void)hwnd;
    (void)message;
    (void)id;
    (void)time;
}

static void devnames(LPCSTR what)
{
    LPSTR names;

    if (!pd.hDevNames) {
        probe("devnames", what, "none");
        return;
    }

    names = GlobalLock(pd.hDevNames);

    if (!names) {
        probe("devnames", what, "unlocked");
        return;
    }

    wsprintf(probeResult, "%x,%x,%x,%x %s|%s|%s", ((WORD FAR *)names)[0], ((WORD FAR *)names)[1],
             ((WORD FAR *)names)[2], ((WORD FAR *)names)[3], names + ((WORD FAR *)names)[0],
             names + ((WORD FAR *)names)[1], names + ((WORD FAR *)names)[2]);
    GlobalUnlock(pd.hDevNames);
    probe("devnames", what, probeResult);
}

static void devmode(LPCSTR what)
{
    LPSTR mode;

    if (!pd.hDevMode) {
        probe("devmode", what, "none");
        return;
    }

    mode = GlobalLock(pd.hDevMode);

    if (!mode) {
        probe("devmode", what, "unlocked");
        return;
    }

    wsprintf(probeResult, "%s spec=%x size=%x fields=%lx orient=%d paper=%d copies=%d source=%d "
                          "quality=%d yres=%d",
             mode, *(WORD FAR *)(mode + 0x20), *(WORD FAR *)(mode + 0x24),
             *(DWORD FAR *)(mode + 0x28), *(short FAR *)(mode + 0x2c), *(short FAR *)(mode + 0x2e),
             *(short FAR *)(mode + 0x36), *(short FAR *)(mode + 0x38), *(short FAR *)(mode + 0x3a),
             *(short FAR *)(mode + 0x40));
    GlobalUnlock(pd.hDevMode);
    probe("devmode", what, probeResult);
}

static void forget(void)
{
    if (pd.hDC) {
        DeleteDC(pd.hDC);
    }

    if (pd.hDevMode) {
        GlobalFree(pd.hDevMode);
    }

    if (pd.hDevNames) {
        GlobalFree(pd.hDevNames);
    }
}

static void reset(DWORD flags)
{
    _fmemset(&pd, 0, sizeof(pd));
    pd.lStructSize = sizeof(pd);
    pd.hwndOwner = owner;
    pd.hInstance = instance;
    pd.Flags = flags;
    pd.nFromPage = 0xffff;
    pd.nToPage = 0xffff;
    pd.nMinPage = 1;
    pd.nMaxPage = 9;
    pd.nCopies = 1;
}

/* A run: the structure as `reset` and the caller left it. */
static void dialog(int which, LPCSTR what)
{
    UINT timer;
    int answer;

    run = which;
    runName = what;
    step = 0;
    timer = SetTimer(NULL, 0, 500, (TIMERPROC)timerThunk);
    answer = printDlg(&pd);
    KillTimer(NULL, timer);
    wsprintf(probeResult, "%d,%lx flags=%lx from=%u to=%u copies=%u devmode=%d devnames=%d dc=%d",
             answer, error(), pd.Flags, pd.nFromPage, pd.nToPage, pd.nCopies, pd.hDevMode ? 1 : 0,
             pd.hDevNames ? 1 : 0, pd.hDC ? 1 : 0);
    probe("result", what, probeResult);
    devnames(what);
    devmode(what);

    if (pd.hDC) {
        wsprintf(probeResult, "technology=%d horzres=%d", GetDeviceCaps(pd.hDC, TECHNOLOGY),
                 GetDeviceCaps(pd.hDC, HORZRES));
        probe("dc", what, probeResult);
    }
}

LRESULT FAR PASCAL _export OwnerProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE current, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    WNDCLASS wc;
    HGLOBAL handle;

    instance = current;
    probeOpen(OUTPUT);
    keybdEvent = GetProcAddress(GetModuleHandle("USER"), "KEYBD_EVENT");
    library = LoadLibrary("COMMDLG.DLL");

    if (library >= (HINSTANCE)32) {
        printDlg = (PRINTPROC)GetProcAddress(library, "PrintDlg");
        extendedError = (ERRORPROC)GetProcAddress(library, "CommDlgExtendedError");
    }

    probe("entry", "", keybdEvent && printDlg && extendedError ? "found" : "missing");

    if (!keybdEvent || !printDlg || !extendedError) {
        probeFinish();
        return 0;
    }

    timerThunk = MakeProcInstance((FARPROC)Tick, instance);

    WriteProfileString("windows", "device", PRINTER ",pscript,LPT1:");
    WriteProfileString("devices", PRINTER, "pscript,LPT1:,LPT2:");

    _fmemset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = OwnerProc;
    wc.hInstance = instance;
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = "PrintOwner";
    RegisterClass(&wc);
    owner = CreateWindow("PrintOwner", "Owner", WS_OVERLAPPEDWINDOW, 0, 0, 640, 480, NULL, NULL,
                         instance, NULL);
    ShowWindow(owner, SW_SHOWNORMAL);
    UpdateWindow(owner);
    SetCursorPos(639, 479);

    /* Options... runs the driver's own dialog on Print Setup's DEVMODE. */
    reset(PD_PRINTSETUP);
    dialog(RUN_OPTIONS, "options");
    forget();

    /* WM_COMMAND 4 takes the structure's printer again; 3 ends with its
     * lParam. */
    reset(PD_PRINTSETUP);
    dialog(RUN_COMMANDS, "commands");
    forget();

    reset(0);
    dialog(RUN_PRINT_COMMAND, "print-command");
    forget();

    /* Print to File, with a DC asked for: on FILE:. */
    reset(PD_RETURNDC);
    dialog(RUN_TO_FILE, "to-file");
    forget();

    reset(PD_RETURNDEFAULT | PD_RETURNDC | PD_PRINTTOFILE);
    dialog(0, "default-to-file");
    forget();

    /* The program's own templates. */
    reset(PD_PRINTSETUP | PD_ENABLESETUPTEMPLATE);
    pd.lpSetupTemplateName = "SETUPDLG";
    dialog(RUN_SETUP_TEMPLATE, "setup-template");
    forget();

    reset(PD_ENABLEPRINTTEMPLATE);
    pd.lpPrintTemplateName = "PRINTDLG";
    dialog(RUN_PRINT_TEMPLATE, "print-template");
    forget();

    reset(PD_PRINTSETUP | PD_ENABLESETUPTEMPLATEHANDLE);
    handle = LoadResource(instance, FindResource(instance, "SETUPDLG", RT_DIALOG));
    pd.hSetupTemplate = handle;
    dialog(RUN_SETUP_HANDLE, "setup-handle");
    wsprintf(probeResult, "%d", GlobalSize(handle) != 0 ? 1 : 0);
    probe("template", "left", probeResult);
    FreeResource(handle);
    forget();

    /* Setup... from the Print dialog, after the default printer changed. */
    reset(0);
    dialog(RUN_DEFAULT_DIFFERENT, "different");
    forget();

    WriteProfileString("windows", "device", PRINTER ",pscript,LPT1:");
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
