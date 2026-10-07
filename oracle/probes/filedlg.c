/*
 * COMMDLG.DLL's Open dialog used with the mouse, as a person uses it: the
 * presses put into the system queue through USER's MOUSE_EVENT as the mouse
 * driver puts them, a second apart -- a hook's timer's -- so no two make a
 * double click that are not meant to.
 *
 * `GetOpenFileName` is asked for the text files of `C:\WINDOWS`, with a
 * hook. Each second the hook writes what the last step came to and takes
 * the next:
 *
 * * `open`: nothing yet -- the dialog as it opens.
 * * `click-dir`: the directories' third row, `system`, pressed and let go.
 * * `dblclick-dir`: the same row double clicked.
 * * `dblclick-up`: the second row, `windows`, double clicked.
 * * `click-file`: the files' second row pressed and let go.
 * * `drop`: the drives' button pressed and let go.
 * * `choose`: the dropped list's row of the drive chosen now, C:, pressed
 *   and let go. (Its first is A:, which the recorder's machine cannot read,
 *   and Windows says so in a box of its own.)
 *
 * For each, `log`: the `WM_COMMAND`s the hook was sent from the controls,
 * each the control's identifier and the notification, in hexadecimal; and
 * `state`: the control with the focus, the directory's name the dialog
 * shows, the files' and directories' counts and the directory list's
 * selection, the file name, and whether the drives' list is dropped.
 *
 * The rows are found from each list's window and `LB_GETITEMHEIGHT`, the
 * drives' list below its combo box by the combo box's item height and its
 * selection.
 */

#include "probe.h"
#include <commdlg.h>
#include <dlgs.h>

#define OUTPUT "C:\\ORACLE\\FILEDLG.OUT"

/* Each record is closed into the file, so a hang leaves those before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

#define SF_ABSOLUTE 0x8000
#define MOVE 0x0001
#define LEFTDOWN 0x0002
#define LEFTUP 0x0004

#define STEP_TIMER 77

typedef BOOL(FAR PASCAL *OPENPROC)(OPENFILENAME FAR *);

static const char *STEPS[] = {"open",      "click-dir", "dblclick-dir", "dblclick-up",
                              "click-file", "drop",      "choose"};

static FARPROC mouseEvent;
static char log[1024];
static LPSTR logAt;
static int step;

static void note(WPARAM id, WORD code)
{
    if (logAt - log >= (int)sizeof(log) - 16) {
        return;
    }

    logAt += wsprintf(logAt, "%s%x:%x", (LPSTR)(logAt == log ? "" : " "), id, code);
}

static WORD mouseFlags;
static WORD mouseX;
static WORD mouseY;

static void mouse(WORD flags, WORD x, WORD y)
{
    mouseFlags = flags;
    mouseX = x;
    mouseY = y;

    _asm {
        push si
        push di
        mov ax, mouseFlags
        mov bx, mouseX
        mov cx, mouseY
        mov dx, 2
        xor si, si
        xor di, di
        call dword ptr mouseEvent
        pop di
        pop si
    }
}

/* A point of the screen as MOUSE_EVENT's absolute coordinates, 0 to 65535. */
static WORD across(int x)
{
    return (WORD)(((DWORD)x * 65536L + GetSystemMetrics(SM_CXSCREEN) - 1) /
                  GetSystemMetrics(SM_CXSCREEN));
}

static WORD down(int y)
{
    return (WORD)(((DWORD)y * 65536L + GetSystemMetrics(SM_CYSCREEN) - 1) /
                  GetSystemMetrics(SM_CYSCREEN));
}

/* The left button pressed and let go at a point of the screen, once or twice. */
static void click(int x, int y, int times)
{
    int time;

    mouse(SF_ABSOLUTE | MOVE, across(x), down(y));

    for (time = 0; time < times; time++) {
        mouse(SF_ABSOLUTE | MOVE | LEFTDOWN, across(x), down(y));
        mouse(SF_ABSOLUTE | MOVE | LEFTUP, across(x), down(y));
    }
}

/* A row of a list box of the dialog's, pressed 20 pixels in. */
static void row(HWND dialog, int id, int item, int times)
{
    HWND list = GetDlgItem(dialog, id);
    POINT at;
    int height = (int)SendMessage(list, LB_GETITEMHEIGHT, 0, 0L);

    at.x = 20;
    at.y = item * height + height / 2;
    ClientToScreen(list, &at);
    click(at.x, at.y, times);
}

static void state(HWND dialog)
{
    char directory[80];
    char name[80];
    HWND focus = GetFocus();

    GetDlgItemText(dialog, stc1, directory, sizeof(directory));
    GetDlgItemText(dialog, edt1, name, sizeof(name));
    wsprintf(probeResult, "focus=%x,dir=%s,files=%d,dirs=%d,dirsel=%d,name=%s,dropped=%d",
             focus ? GetDlgCtrlID(focus) : 0, (LPSTR)directory,
             (int)SendDlgItemMessage(dialog, lst1, LB_GETCOUNT, 0, 0L),
             (int)SendDlgItemMessage(dialog, lst2, LB_GETCOUNT, 0, 0L),
             (int)SendDlgItemMessage(dialog, lst2, LB_GETCURSEL, 0, 0L), (LPSTR)name,
             (int)SendDlgItemMessage(dialog, cmb2, CB_GETDROPPEDSTATE, 0, 0L));
}

/* What the last step came to, and the next taken. */
static void next(HWND dialog)
{
    HWND drives = GetDlgItem(dialog, cmb2);
    RECT r;
    int height;

    probe("log", STEPS[step], log);
    state(dialog);
    probe("state", STEPS[step], probeResult);
    logAt = log;
    *logAt = '\0';
    step++;

    switch (step) {
    case 1:
        row(dialog, lst2, 2, 1);
        break;
    case 2:
        row(dialog, lst2, 2, 2);
        break;
    case 3:
        row(dialog, lst2, 1, 2);
        break;
    case 4:
        row(dialog, lst1, 1, 1);
        break;
    case 5:
        GetWindowRect(drives, &r);
        click(r.right - 8, (r.top + r.bottom) / 2, 1);
        break;
    case 6:
        GetWindowRect(drives, &r);
        height = (int)SendMessage(drives, CB_GETITEMHEIGHT, 0, 0L);
        click(r.left + 20,
              r.bottom + 1 + (int)SendMessage(drives, CB_GETCURSEL, 0, 0L) * height + height / 2,
              1);
        break;
    default:
        KillTimer(dialog, STEP_TIMER);
        PostMessage(dialog, WM_COMMAND, IDCANCEL, 0L);
        break;
    }
}

UINT FAR PASCAL _export Hook(HWND dialog, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_INITDIALOG:
        SetTimer(dialog, STEP_TIMER, 1000, NULL);
        return TRUE;
    case WM_COMMAND:
        if (wParam == lst1 || wParam == lst2 || wParam == cmb2 || wParam == edt1) {
            note(wParam, HIWORD(lParam));
        }

        return FALSE;
    case WM_TIMER:
        if (wParam == STEP_TIMER) {
            next(dialog);
            return TRUE;
        }

        return FALSE;
    }

    return FALSE;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;
    OPENPROC open;
    OPENFILENAME ofn;
    char file[260];
    BOOL answer;

    probeOpen(OUTPUT);
    logAt = log;
    *logAt = '\0';

    mouseEvent = GetProcAddress(GetModuleHandle("USER"), "MOUSE_EVENT");
    library = LoadLibrary("COMMDLG.DLL");
    open = library >= (HINSTANCE)32 ? (OPENPROC)GetProcAddress(library, "GetOpenFileName") : NULL;
    probe("entry", "MOUSE_EVENT", mouseEvent ? "found" : "missing");
    probe("entry", "GetOpenFileName", open ? "found" : "missing");

    if (!mouseEvent || !open) {
        probeFinish();
        return 0;
    }

    file[0] = '\0';
    _fmemset(&ofn, 0, sizeof(ofn));
    ofn.lStructSize = sizeof(ofn);
    ofn.hInstance = instance;
    ofn.lpstrFilter = "Text Files (*.TXT)\0*.txt\0";
    ofn.nFilterIndex = 1;
    ofn.lpstrFile = file;
    ofn.nMaxFile = sizeof(file);
    ofn.lpstrInitialDir = "C:\\WINDOWS";
    ofn.Flags = OFN_ENABLEHOOK | OFN_HIDEREADONLY;
    ofn.lpfnHook = (UINT(CALLBACK *)(HWND, UINT, WPARAM, LPARAM))MakeProcInstance((FARPROC)Hook,
                                                                                   instance);

    answer = open(&ofn);
    wsprintf(probeResult, "%d", answer ? 1 : 0);
    probe("GetOpenFileName", "", probeResult);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
