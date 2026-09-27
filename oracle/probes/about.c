/*
 * SHELL's About box, read while it is up, from a timer:
 *
 * * `resources`: GetFreeSystemResources for 0, 1 and 2.
 * * `about`: for each ShellAbout, the caption, then each control's text by
 *   its id, `-` for one hidden, and the icon's control as `icon` or `none`.
 *   The memory line is `free` when it reads as GetFreeSpace(1000h) in
 *   kilobytes, its thousands separated, and the resources line `resources`
 *   when it reads as GetFreeSystemResources(0): each within a little of
 *   what they answer now, as both move while the box is made.
 * * `answer`: what ShellAbout answered, and the string it was given after.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ABOUT.OUT"

/* Each record is closed into the file, so a fault leaves those before it. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

typedef int(FAR PASCAL *ABOUTPROC)(HWND, LPCSTR, LPCSTR, HICON);

static LPCSTR label;
static char text[1400];

/* A number as the box shows it, its thousands separated by commas, and
 * then what follows it; -1 when it is not written so. */
static long shown(LPCSTR text, LPCSTR after)
{
    long n = 0;
    int digits = 0;
    int group = -1;

    for (; *text; text++) {
        if (*text >= '0' && *text <= '9') {
            n = n * 10 + (*text - '0');
            digits++;

            if (group >= 0 && ++group > 3) {
                return -1;
            }
        } else if (*text == ',' && digits && (group < 0 ? digits <= 3 : group == 3)) {
            group = 0;
        } else {
            break;
        }
    }

    if (!digits || (group >= 0 && group != 3) || lstrcmp(text, after)) {
        return -1;
    }

    return n;
}

static int within(long a, long b, long by)
{
    return a >= 0 && a - b <= by && b - a <= by;
}

static void read(HWND dialog)
{
    static const int ids[] = { 101, 112, 115, 108, 109, 110, 102, 103, 104, 113, 105, 106, 107, 1 };
    char one[160];
    char expected[40];
    int i;

    GetWindowText(dialog, one, sizeof(one));
    lstrcpy(text, one);

    for (i = 0; i < sizeof(ids) / sizeof(ids[0]); i++) {
        HWND control = GetDlgItem(dialog, ids[i]);

        GetDlgItemText(dialog, ids[i], one, sizeof(one));

        if (ids[i] == 104 && within(shown(one, " KB Free"), GetFreeSpace(0x1000) >> 10, 256)) {
            lstrcpy(one, "free");
        }

        if (ids[i] == 105 && within(shown(one, "% Free"), GetFreeSystemResources(0), 3)) {
            lstrcpy(one, "resources");
        }

        wsprintf(expected, "|%d=", ids[i]);
        lstrcat(text, expected);
        lstrcat(text, control && !IsWindowVisible(control) ? "-" : one);
    }

    lstrcat(text, "|111=");
    lstrcat(text, !IsWindowVisible(GetDlgItem(dialog, 111))
                      ? "-"
                      : SendDlgItemMessage(dialog, 111, STM_GETICON, 0, 0L) ? "icon" : "none");
    probe("about", label, text);
}

void CALLBACK __export Tick(HWND window, UINT message, UINT id, DWORD time)
{
    HWND dialog = GetActiveWindow();

    KillTimer(NULL, id);
    read(dialog);
    PostMessage(dialog, WM_COMMAND, IDOK, 0L);

    (void)window;
    (void)message;
    (void)time;
}

static void about(ABOUTPROC shellAbout, LPCSTR what, LPSTR app, LPCSTR other, HICON icon)
{
    int answer;

    label = what;
    SetTimer(NULL, 0, 300, (TIMERPROC)Tick);
    answer = shellAbout(NULL, app, other, icon);
    wsprintf(probeResult, "%d/%s", answer, app);
    probe("answer", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    static char plain[] = "Probe";
    static char split[] = "Caption#Line";
    static char leading[] = "#Line only";
    static char again[] = "Probe again";
    HINSTANCE shell;
    ABOUTPROC shellAbout;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "%u,%u,%u", GetFreeSystemResources(0), GetFreeSystemResources(1),
             GetFreeSystemResources(2));
    probe("resources", "0,1,2", probeResult);

    shell = LoadLibrary("SHELL.DLL");
    shellAbout = (ABOUTPROC)GetProcAddress(shell, "ShellAbout");

    about(shellAbout, "plain, an icon", plain, "Other stuff", LoadIcon(NULL, IDI_APPLICATION));
    about(shellAbout, "split, no icon", split, "", NULL);
    about(shellAbout, "leading #, no icon", leading, "Two\nlines", NULL);
    about(shellAbout, "no other stuff", again, NULL, LoadIcon(NULL, IDI_HAND));

    FreeLibrary(shell);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
