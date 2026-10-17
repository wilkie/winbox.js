/*
 * COMMDLG's Print and Print Setup dialogs, `PrintDlg`, as programs use them
 * and as a person does: with the keys through USER's `KEYBD_EVENT`, a timer
 * of the program's taking a step at a time, and every box COMMDLG puts up
 * read and answered with Enter.
 *
 * The probe writes the printers it uses into WIN.INI itself, so the run
 * finds the same entries wherever it runs: the default printer, `Apple
 * LaserWriter Plus` on `LPT1:` with the PostScript driver, and the same
 * printer on `LPT2:` too. What the driver answers -- its paper sizes, its
 * resolutions, its DEVMODE -- is the driver's; those records are kept
 * apart, as `print`, `setup`, `devmode` and `devnames`.
 *
 * * `error`: calls refused before any printer driver is loaded, what each
 *   answers and `CommDlgExtendedError` after it.
 * * `noprinter`: WIN.INI with no default printer, a default that does not
 *   parse, a DEVMODE naming a printer WIN.INI does not have: the answer,
 *   the error, and any box COMMDLG put up.
 * * `box`: a box COMMDLG put up during a dialog: its caption, then each
 *   control's text.
 * * `print`, `setup`: one record a control of the Print or Print Setup
 *   dialog at a step: whether it is enabled, shown, checked and a tab stop,
 *   its text, and a combo box's items with the one chosen.
 * * `focus`: the control with the focus at a step.
 * * `hook`: `WM_INITDIALOG` given to each hook, whether its `lParam` was
 *   the structure, and the messages it was given before.
 * * `help`: `HELPMSGSTRING`'s message, as the owner was sent it.
 * * `result`: what `PrintDlg` answered, the error, the flags, the pages
 *   and copies, which handles it left, and whether the hooks were cleared.
 * * `devnames`: the DEVNAMES left: its offsets, `wDefault`, its strings.
 * * `devmode`: the DEVMODE left, the fields COMMDLG reads and writes.
 * * `driver`: the printer in WIN.INI, and what the driver itself answers
 *   asked directly: whether it has ExtDeviceMode, DeviceMode and
 *   DeviceCapabilities, its DEVMODE's size, and some of its capabilities.
 *
 * * `reload`: whether COMMDLG was still loaded once the probe let it go.
 *
 * A call refused for its size takes down the count COMMDLG keeps of its
 * print calls without having taken it up (`COMMDLG.DLL` seg3 `0cc7`,
 * `3de2`, `3ed8`). Before COMMDLG's first print call, that leaves unloaded
 * the strings it finds the driver's functions by: the probe shows it, then
 * lets COMMDLG go and loads it again. The other refusals come after the
 * runs with the printer, and the last run asks for the default again: the
 * strings, once loaded, stay.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <commdlg.h>
#include <string.h>

#define OUTPUT "C:\\ORACLE\\PRDLG.OUT"

#define PRINTER "Apple LaserWriter Plus"

/* DeviceCapabilities's indexes, as COMMDLG passes them. */
#define DC_PAPERS 2
#define DC_BINS 6
#define DC_ENUMRESOLUTIONS 13
#define DC_ORIENTATION 17

typedef BOOL(FAR PASCAL *PRINTPROC)(PRINTDLG FAR *);
typedef DWORD(FAR PASCAL *ERRORPROC)(void);

static PRINTPROC printDlg;
static ERRORPROC extendedError;
static FARPROC keybdEvent;
static HINSTANCE instance;
static HWND owner;
static UINT helpMessage;
static PRINTDLG pd;
static int run;
static int step;
static FARPROC timerThunk;
static FARPROC printHook;
static FARPROC setupHook;
static char before[256];
static LPSTR beforeAt;
static int setupSawPrint;
static LPCSTR runName;
static int sub;

static const int PRINT_IDS[] = {0x445, 0x440, 0x430, 0x420, 0x421, 0x422, 0x441, 0x480, 0x442, 0x481,
                                0x443, 0x470, 0x444, 0x482, 0x410, 0x411, IDOK, IDCANCEL, 0x400, 0x40e};
static const int SETUP_IDS[] = {0x432, 0x440, 0x422, 0x423, 0x470, 0x430, 0x43c, 0x420, 0x421,
                                0x431, 0x441, 0x471, 0x442, 0x472, IDOK, IDCANCEL, 0x400, 0x40e};

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

/* Which of the dialogs a window is: 1 Print, 2 Print Setup, 0 neither. */
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
    int index;

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

/* A box COMMDLG put up: its caption and its controls' texts, then Enter. */
static void box(HWND hwnd)
{
    HWND child;
    LPSTR out = probeResult;
    char text[200];

    GetWindowText(hwnd, text, sizeof(text));
    out += wsprintf(out, "%s", (LPSTR)text);

    for (child = GetWindow(hwnd, GW_CHILD); child; child = GetWindow(child, GW_HWNDNEXT)) {
        GetWindowText(child, text, sizeof(text));

        if (text[0]) {
            out += wsprintf(out, " | %s", (LPSTR)text);
        }
    }

    wsprintf(probeArgs, "%s %d", runName, step);
    probe("box", probeArgs, probeResult);
    press(VK_RETURN, 0x1c);
}

static void text(HWND dialog, int id, LPCSTR value)
{
    SetDlgItemText(dialog, id, value);
}

static void record(HWND dialog, int id, LPCSTR what)
{
    GetDlgItemText(dialog, id, probeResult, 64);
    probe("text", what, probeResult);
}

UINT FAR PASCAL _export PrintHook(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        wsprintf(probeArgs, "print %s", runName);
        wsprintf(probeResult, "param=%d before=%s", lParam == (LPARAM)(PRINTDLG FAR *)&pd ? 1 : 0,
                 (LPSTR)before);
        probe("hook", probeArgs, probeResult);
        before[0] = '\0';
        beforeAt = before;
        return TRUE;
    } else if (!GetDlgItem(hwnd, 0x480) && beforeAt - before < 240) {
        beforeAt += wsprintf(beforeAt, "%x,", message);
    }

    (void)wParam;
    return FALSE;
}

UINT FAR PASCAL _export SetupHook(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == WM_INITDIALOG) {
        wsprintf(probeArgs, "setup %s", runName);
        wsprintf(probeResult, "param=%d before=%s", lParam == (LPARAM)(PRINTDLG FAR *)&pd ? 1 : 0,
                 (LPSTR)before);
        probe("hook", probeArgs, probeResult);
        before[0] = '\0';
        beforeAt = before;
        return TRUE;
    } else if (GetDlgItem(hwnd, 0x480) && GetDlgItem(hwnd, 0x482)) {
        setupSawPrint++;
    } else if (!GetDlgItem(hwnd, 0x471) && beforeAt - before < 240) {
        beforeAt += wsprintf(beforeAt, "%x,", message);
    }

    (void)wParam;
    return FALSE;
}

/* The Print dialog, a step at a time. */
static void printSteps(HWND dialog)
{
    switch (step) {
    case 1:
        controls(dialog, "start");
        alt('C', 0x2e);
        press('A', 0x1e);
        press('7', 0x08);
        break;
    case 2:
        record(dialog, 0x482, "copies-typed");
        text(dialog, 0x482, "3");
        text(dialog, 0x480, "0");
        press(VK_RETURN, 0x1c);
        break;
    case 3:
        text(dialog, 0x480, "10");
        press(VK_RETURN, 0x1c);
        break;
    case 4:
        text(dialog, 0x480, "3");
        text(dialog, 0x481, "0");
        press(VK_RETURN, 0x1c);
        break;
    case 5:
        text(dialog, 0x481, "12");
        press(VK_RETURN, 0x1c);
        break;
    case 6:
        text(dialog, 0x480, "");
        text(dialog, 0x481, "");
        press(VK_RETURN, 0x1c);
        break;
    case 7:
        text(dialog, 0x480, "x");
        press(VK_RETURN, 0x1c);
        break;
    case 8:
        text(dialog, 0x480, "3");
        text(dialog, 0x481, "y");
        press(VK_RETURN, 0x1c);
        break;
    case 9:
        text(dialog, 0x481, "4");
        text(dialog, 0x482, "");
        press(VK_RETURN, 0x1c);
        break;
    case 10:
        text(dialog, 0x482, "0");
        press(VK_RETURN, 0x1c);
        break;
    case 11:
        text(dialog, 0x482, "x");
        press(VK_RETURN, 0x1c);
        break;
    case 12:
        text(dialog, 0x482, "99999");
        press(VK_RETURN, 0x1c);
        break;
    case 13:
        controls(dialog, "after-boxes");
        CheckRadioButton(dialog, 0x420, 0x422, 0x420);
        text(dialog, 0x480, "6");
        controls(dialog, "typed-from");
        alt('H', 0x23);
        break;
    case 14:
        alt('S', 0x1f);
        break;
    case 15:
        controls(dialog, "after-setup");
        text(dialog, 0x480, "4");
        text(dialog, 0x481, "2");
        text(dialog, 0x482, "2");
        alt('I', 0x17);
        break;
    case 16:
        controls(dialog, "ok");
        press(VK_RETURN, 0x1c);
        break;
    }
}

/* The Print Setup dialog from the Print dialog's Setup button. */
static void setupFromPrint(HWND dialog)
{
    sub++;

    if (sub == 1) {
        controls(dialog, "from-print");
        alt('L', 0x26);
    } else if (sub == 2) {
        controls(dialog, "landscape");
        press(VK_RETURN, 0x1c);
    }
}

static void setupSteps(HWND dialog)
{
    switch (step) {
    case 1:
        controls(dialog, "start");
        alt('P', 0x19);
        break;
    case 2:
        controls(dialog, "specific");
        press(VK_UP, 0x48);
        break;
    case 3:
        controls(dialog, "up");
        alt('P', 0x19);
        break;
    case 4:
        SendDlgItemMessage(dialog, 0x470, CB_SETCURSEL, 1, 0);
        SendMessage(dialog, WM_COMMAND, 0x470,
                    MAKELPARAM(GetDlgItem(dialog, 0x470), CBN_SELCHANGE));
        controls(dialog, "second");
        alt('L', 0x26);
        break;
    case 5:
        controls(dialog, "landscape");
        alt('H', 0x23);
        break;
    case 6:
        press(VK_RETURN, 0x1c);
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

    step++;

    /* A run that went wrong is ended rather than left to hang. */
    if (step > 40 && which) {
        PostMessage(active, WM_COMMAND, IDCANCEL, 0);
        return;
    }

    if (run == 1) {
        if (which == 2) {
            step--;
            setupFromPrint(active);
        } else if (which == 1) {
            printSteps(active);
        }
    } else if (run == 2) {
        if (which == 2) {
            setupSteps(active);
        }
    } else if (which) {
        if (step == 1) {
            controls(active, runName);
        } else if (step == 2) {
            press(run == 3 ? VK_ESCAPE : VK_RETURN, run == 3 ? 0x01 : 0x1c);
        }
    }
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

    /* dmDeviceName; dmSpecVersion, dmSize, dmFields; dmOrientation,
     * dmPaperSize, dmCopies, dmDefaultSource, dmPrintQuality, dmYResolution. */
    wsprintf(probeResult, "%s spec=%x size=%x fields=%lx orient=%d paper=%d copies=%d source=%d "
                          "quality=%d yres=%d",
             mode, *(WORD FAR *)(mode + 0x20), *(WORD FAR *)(mode + 0x24),
             *(DWORD FAR *)(mode + 0x28), *(short FAR *)(mode + 0x2c), *(short FAR *)(mode + 0x2e),
             *(short FAR *)(mode + 0x36), *(short FAR *)(mode + 0x38), *(short FAR *)(mode + 0x3a),
             *(short FAR *)(mode + 0x40));
    GlobalUnlock(pd.hDevMode);
    probe("devmode", what, probeResult);
}

static void result(LPCSTR what, BOOL answer)
{
    wsprintf(probeResult,
             "%d,%lx flags=%lx from=%u to=%u copies=%u devmode=%d devnames=%d dc=%d printhook=%d "
             "setuphook=%d setupsawprint=%d",
             answer ? 1 : 0, error(), pd.Flags, pd.nFromPage, pd.nToPage, pd.nCopies,
             pd.hDevMode ? 1 : 0, pd.hDevNames ? 1 : 0, pd.hDC ? 1 : 0, pd.lpfnPrintHook ? 1 : 0,
             pd.lpfnSetupHook ? 1 : 0, setupSawPrint ? 1 : 0);
    probe("result", what, probeResult);
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

/* A dialog's run: the structure as `reset` and the caller left it. */
static void dialog(int which, LPCSTR what)
{
    UINT timer;
    BOOL answer;

    run = which;
    runName = what;
    step = 0;
    sub = 0;
    setupSawPrint = 0;
    before[0] = '\0';
    beforeAt = before;
    timer = SetTimer(NULL, 0, 500, (TIMERPROC)timerThunk);
    answer = printDlg(&pd);
    KillTimer(NULL, timer);
    result(what, answer);
    devnames(what);
    devmode(what);
}

static void failure(LPCSTR function, LPCSTR what)
{
    UINT timer;
    BOOL answer;

    run = 0;
    runName = what;
    step = 0;
    timer = SetTimer(NULL, 0, 500, (TIMERPROC)timerThunk);
    answer = printDlg(&pd);
    KillTimer(NULL, timer);
    wsprintf(probeResult, "%d,%lx devmode=%d devnames=%d", answer ? 1 : 0, error(),
             pd.hDevMode ? 1 : 0, pd.hDevNames ? 1 : 0);
    probe(function, what, probeResult);
}

static HGLOBAL names(LPCSTR driver, LPCSTR device, LPCSTR port, WORD flags)
{
    HGLOBAL handle = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 128);
    LPSTR at = GlobalLock(handle);
    WORD FAR *offsets = (WORD FAR *)at;

    offsets[0] = 8;
    lstrcpy(at + 8, driver);
    offsets[1] = 8 + lstrlen(driver) + 1;
    lstrcpy(at + offsets[1], device);
    offsets[2] = offsets[1] + lstrlen(device) + 1;
    lstrcpy(at + offsets[2], port);
    offsets[3] = flags;
    GlobalUnlock(handle);
    return handle;
}

static HGLOBAL mode(LPCSTR device)
{
    HGLOBAL handle = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, 0x44);
    LPSTR at = GlobalLock(handle);

    lstrcpy(at, device);
    *(WORD FAR *)(at + 0x20) = 0x30a;
    *(WORD FAR *)(at + 0x24) = 0x44;
    GlobalUnlock(handle);
    return handle;
}

LRESULT FAR PASCAL _export OwnerProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    if (message == helpMessage && helpMessage) {
        wsprintf(probeResult, "dialog=%d param=%d", kind((HWND)wParam), lParam == (LPARAM)(PRINTDLG FAR *)&pd ? 1 : 0);
        probe("help", runName, probeResult);
        return 0;
    }

    return DefWindowProc(hwnd, message, wParam, lParam);
}

static void errors(void)
{
    HGLOBAL handle;

    reset(0);
    pd.lStructSize = sizeof(pd) - 1;
    failure("error", "size");
    reset(PD_RETURNDEFAULT);
    pd.hDevMode = mode(PRINTER);
    failure("error", "returndefault-devmode");
    GlobalFree(pd.hDevMode);
    reset(PD_ENABLEPRINTTEMPLATE);
    failure("error", "print-noname");
    reset(PD_ENABLEPRINTTEMPLATE);
    pd.hInstance = NULL;
    pd.lpPrintTemplateName = "NOSUCH";
    failure("error", "print-noinstance");
    reset(PD_ENABLEPRINTTEMPLATE);
    pd.lpPrintTemplateName = "NOSUCH";
    failure("error", "print-notemplate");
    reset(PD_ENABLEPRINTTEMPLATEHANDLE);
    failure("error", "print-nohandle");
    reset(PD_PRINTSETUP | PD_ENABLESETUPTEMPLATE);
    failure("error", "setup-noname");
    reset(PD_PRINTSETUP | PD_ENABLESETUPTEMPLATE);
    pd.lpSetupTemplateName = "NOSUCH";
    failure("error", "setup-notemplate");
    reset(PD_ENABLEPRINTHOOK);
    failure("error", "print-nohook");
    reset(PD_PRINTSETUP | PD_ENABLESETUPHOOK);
    failure("error", "setup-nohook");
    reset(PD_ENABLESETUPHOOK);
    failure("error", "print-nosetuphook");

    reset(0);
    pd.hDevNames = handle = names("pscript", "No Such Printer", "LPT1:", 0);
    failure("error", "devnames-nosuch");
    GlobalFree(handle);
    reset(0);
    pd.hDevNames = handle = names("unidrv", PRINTER, "LPT1:", 0);
    failure("error", "devnames-driver");
    GlobalFree(handle);
    reset(0);
    pd.hDevNames = handle = names("pscript", PRINTER, "COM1:", 0);
    failure("error", "devnames-port");
    GlobalFree(handle);
    reset(PD_PRINTSETUP);
    pd.hDevNames = handle = names("pscript", PRINTER, "LPT2:", DN_DEFAULTPRN);
    failure("error", "devnames-default");
    GlobalFree(handle);
}

typedef int(FAR PASCAL *EXTDEVICEMODE)(HWND, HANDLE, LPVOID, LPSTR, LPSTR, LPVOID, LPSTR, WORD);
typedef DWORD(FAR PASCAL *DEVICECAPABILITIES)(LPSTR, LPSTR, WORD, LPSTR, LPVOID);

/* What the driver itself answers, asked as COMMDLG asks it. */
static void driver(void)
{
    HINSTANCE module = LoadLibrary("pscript.DRV");
    EXTDEVICEMODE extDeviceMode = NULL;
    DEVICECAPABILITIES deviceCapabilities = NULL;
    char text[80];

    GetProfileString("windows", "device", "", text, sizeof(text));
    probe("driver", "device", text);
    GetProfileString("devices", PRINTER, "", text, sizeof(text));
    probe("driver", "devices", text);

    if (module >= (HINSTANCE)32) {
        extDeviceMode = (EXTDEVICEMODE)GetProcAddress(module, "ExtDeviceMode");
        deviceCapabilities = (DEVICECAPABILITIES)GetProcAddress(module, "DeviceCapabilities");
    }

    wsprintf(probeResult, "%d extdevicemode=%d devicemode=%d devicecapabilities=%d",
             module >= (HINSTANCE)32 ? 1 : 0, extDeviceMode ? 1 : 0,
             module >= (HINSTANCE)32 && GetProcAddress(module, "DeviceMode") ? 1 : 0,
             deviceCapabilities ? 1 : 0);
    probe("driver", "load", probeResult);

    if (extDeviceMode) {
        wsprintf(probeResult, "%d", extDeviceMode(owner, module, NULL, PRINTER, "LPT1:", NULL, NULL, 0));
        probe("driver", "extdevicemode-size", probeResult);
    }

    if (deviceCapabilities) {
        wsprintf(probeResult, "papers=%ld bins=%ld resolutions=%ld orientation=%ld",
                 deviceCapabilities(PRINTER, "LPT1:", DC_PAPERS, NULL, NULL),
                 deviceCapabilities(PRINTER, "LPT1:", DC_BINS, NULL, NULL),
                 deviceCapabilities(PRINTER, "LPT1:", DC_ENUMRESOLUTIONS, NULL, NULL),
                 deviceCapabilities(PRINTER, "LPT1:", DC_ORIENTATION, NULL, NULL));
        probe("driver", "capabilities", probeResult);
    }

    if (module >= (HINSTANCE)32) {
        FreeLibrary(module);
    }
}

static void noPrinter(void)
{
    WriteProfileString("windows", "device", "");
    reset(PD_RETURNDEFAULT);
    failure("noprinter", "returndefault");
    reset(PD_NOWARNING);
    failure("noprinter", "print-nowarning");
    reset(0);
    failure("noprinter", "print");
    reset(PD_PRINTSETUP);
    failure("noprinter", "setup");

    WriteProfileString("windows", "device", "JustAName");
    reset(PD_RETURNDEFAULT);
    failure("noprinter", "parse-returndefault");
    reset(PD_NOWARNING);
    failure("noprinter", "parse-print");

    WriteProfileString("windows", "device", PRINTER ",pscript,LPT1:");
    reset(PD_NOWARNING);
    pd.hDevMode = mode("Nowhere");
    failure("noprinter", "devmode-nowhere");
    GlobalFree(pd.hDevMode);

    WriteProfileString("devices", "Nocomma", "pscript");
    reset(PD_NOWARNING);
    pd.hDevMode = mode("Nocomma");
    failure("noprinter", "devmode-nocomma");
    GlobalFree(pd.hDevMode);
    WriteProfileString("devices", "Nocomma", NULL);
}

int PASCAL WinMain(HINSTANCE current, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    WNDCLASS wc;

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

    helpMessage = RegisterWindowMessage("commdlg_help");
    timerThunk = MakeProcInstance((FARPROC)Tick, instance);
    printHook = MakeProcInstance((FARPROC)PrintHook, instance);
    setupHook = MakeProcInstance((FARPROC)SetupHook, instance);

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

    driver();

    /* A structure of the wrong size before COMMDLG's first print call takes
     * its count of calls below nought, and the next asks the driver for
     * nothing; COMMDLG let go and loaded again starts afresh. */
    reset(0);
    pd.lStructSize = sizeof(pd) + 1;
    failure("error", "first-size");
    reset(PD_RETURNDEFAULT);
    dialog(0, "first-default");
    forget();
    FreeLibrary(library);
    wsprintf(probeResult, "%d", GetModuleHandle("COMMDLG") ? 1 : 0);
    probe("reload", "loaded-after-free", probeResult);
    library = LoadLibrary("COMMDLG.DLL");
    printDlg = (PRINTPROC)GetProcAddress(library, "PrintDlg");
    extendedError = (ERRORPROC)GetProcAddress(library, "CommDlgExtendedError");

    /* With the printer: the default, as a program asks for it. */
    reset(PD_RETURNDEFAULT | PD_RETURNIC);
    dialog(0, "returndefault");
    forget();

    reset(PD_RETURNDEFAULT | PD_RETURNDC);
    dialog(0, "returndc");
    forget();

    /* The Print dialog, its boxes, Help and Setup. */
    reset(PD_SHOWHELP | PD_ENABLEPRINTHOOK | PD_ENABLESETUPHOOK | PD_PAGENUMS | PD_COLLATE);
    pd.lpfnPrintHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))printHook;
    pd.lpfnSetupHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))setupHook;
    pd.nFromPage = 2;
    pd.nToPage = 5;
    pd.nCopies = 3;
    dialog(1, "print");
    forget();

    /* Print Setup alone: the printers, the up arrow, the second printer. */
    reset(PD_PRINTSETUP | PD_SHOWHELP | PD_ENABLESETUPHOOK);
    pd.lpfnSetupHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))setupHook;
    dialog(2, "setup");

    /* The Print dialog for the printer Print Setup chose, without the
     * flags that would show its hidden parts; hooks given but not asked for. */
    pd.Flags = PD_HIDEPRINTTOFILE | PD_NOSELECTION | PD_NOPAGENUMS;
    pd.lpfnPrintHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))printHook;
    pd.lpfnSetupHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))setupHook;
    dialog(3, "hidden");
    forget();

    /* Cancelled, with nothing given: what COMMDLG made is let go. */
    reset(PD_PRINTSETUP);
    dialog(3, "cancel");
    forget();

    /* Copies kept in the DEVMODE, to a file, a DC asked for. */
    reset(PD_DISABLEPRINTTOFILE | PD_PRINTTOFILE | PD_SELECTION | PD_USEDEVMODECOPIES |
          PD_RETURNIC);
    pd.nCopies = 4;
    dialog(4, "devmodecopies");
    forget();

    errors();
    noPrinter();

    /* The default again, after the refusal of a structure's size: the count
     * COMMDLG keeps of its print calls was taken down by that refusal too. */
    reset(PD_RETURNDEFAULT);
    dialog(0, "after-size");
    forget();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
