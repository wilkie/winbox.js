/*
 * What `SystemParametersInfo` answers and keeps, action by action, and what
 * it writes to `WIN.INI`.
 *
 * `get` records are each reading action's answer at start, its buffer
 * filled with 0x5a5a first so a word not written shows. `unknown` records
 * are actions USER's table has no case for. `set` records set an action
 * with the `fuWinIni` named (0, 1 for `SPIF_UPDATEINIFILE`, 3 adding
 * `SPIF_SENDWININICHANGE`) and give its answer, what reads back, the
 * `WIN.INI` key's text afterwards (`<none>` for no key) and the messages
 * the probe's two windows at the top were sent meanwhile:
 * `ini(A,0,0,windows)` for `WM_WININICHANGE` to `A` with `wParam` 0, the
 * offset of `lParam` and the text there; `sys(B)` for `WM_SYSCOLORCHANGE`.
 * `A` is shown, `B` is hidden. `border` records give the frame's metrics
 * and `A`'s rectangles, window and client, as the border width changes.
 * Every setting is put back as it was, `WIN.INI` too, at the end; `keys`
 * records list the keys of `[windows]` and `[Desktop]` then.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\SYSPARAM.OUT"

static HWND first;
static HWND second;
static char log[600];

static void note(LPCSTR text)
{
    if (lstrlen(log) + lstrlen(text) < sizeof(log) - 2) {
        if (log[0]) {
            lstrcat(log, " ");
        }

        lstrcat(log, text);
    }
}

LRESULT CALLBACK _export HostProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    char text[96];
    LPCSTR name = window == first ? "A" : window == second ? "B" : "?";

    switch (message) {
    case WM_WININICHANGE:
        wsprintf(text, "ini(%s,%u,%u,%s)", name, wParam, LOWORD(lParam),
                 lParam ? (LPSTR)lParam : (LPSTR) "null");
        note(text);
        return 0;

    case WM_SYSCOLORCHANGE:
        wsprintf(text, "sys(%s,%u,%lu)", name, wParam, lParam);
        note(text);
        return 0;
    }

    return DefWindowProc(window, message, wParam, lParam);
}

/* The text of a key, or `<none>`. */
static LPSTR keyText(LPCSTR section, LPCSTR key, LPSTR out)
{
    GetProfileString(section, key, "<none>", out, 80);
    return out;
}

static void getWord(LPCSTR name, UINT action)
{
    WORD word = 0x5a5a;
    BOOL answer = SystemParametersInfo(action, 0, &word, 0);

    wsprintf(probeArgs, "%s", name);
    wsprintf(probeResult, "%d %d", answer, (int)word);
    probe("get", probeArgs, probeResult);
}

static int readWord(UINT action)
{
    WORD word = 0x5a5a;

    SystemParametersInfo(action, 0, &word, 0);
    return (int)word;
}

/*
 * Sets with a word, and records the answer, the setting read back through
 * `back` (or nothing for an action with no reading one), the key's text
 * and the messages sent.
 */
static void setWord(LPCSTR name, UINT action, UINT param, UINT ini, UINT back, LPCSTR section,
                    LPCSTR key)
{
    char text[96];
    BOOL answer;

    log[0] = '\0';
    answer = SystemParametersInfo(action, param, NULL, ini);

    wsprintf(probeArgs, "%s,%u,%u", name, param, ini);

    if (back) {
        wsprintf(probeResult, "%d back=%d key=%s msgs=%s", answer, readWord(back),
                 (LPSTR)keyText(section, key, text), (LPSTR)log);
    } else {
        wsprintf(probeResult, "%d key=%s msgs=%s", answer, (LPSTR)keyText(section, key, text),
                 (LPSTR)log);
    }

    probe("set", probeArgs, probeResult);
}

static void unknown(UINT action)
{
    WORD words[2];
    BOOL answer;

    words[0] = 0x5a5a;
    words[1] = 0x5a5a;
    answer = SystemParametersInfo(action, 7, words, 0);

    wsprintf(probeArgs, "%u", action);
    wsprintf(probeResult, "%d %x %x", answer, words[0], words[1]);
    probe("unknown", probeArgs, probeResult);
}

static void mouse(LPCSTR name, int t1, int t2, int speed, UINT ini)
{
    int values[3];
    int back[3];
    char a[80];
    char b[80];
    char c[80];
    BOOL answer;

    values[0] = t1;
    values[1] = t2;
    values[2] = speed;
    log[0] = '\0';
    answer = SystemParametersInfo(SPI_SETMOUSE, 0, values, ini);
    SystemParametersInfo(SPI_GETMOUSE, 0, back, 0);

    wsprintf(probeArgs, "%s,%d,%d,%d,%u", name, t1, t2, speed, ini);
    wsprintf(probeResult, "%d back=%d,%d,%d keys=%s,%s,%s msgs=%s", answer, back[0], back[1],
             back[2], (LPSTR)keyText("windows", "MouseThreshold1", a),
             (LPSTR)keyText("windows", "MouseThreshold2", b),
             (LPSTR)keyText("windows", "MouseSpeed", c), (LPSTR)log);
    probe("set", probeArgs, probeResult);
}

static void border(LPCSTR when)
{
    RECT window;
    RECT client;

    GetWindowRect(first, &window);
    GetClientRect(first, &client);

    wsprintf(probeResult, "%d frame=%d,%d track=%d,%d min=%d,%d window=%d,%d,%d,%d client=%d,%d",
             readWord(SPI_GETBORDER), GetSystemMetrics(SM_CXFRAME), GetSystemMetrics(SM_CYFRAME),
             GetSystemMetrics(SM_CXMINTRACK), GetSystemMetrics(SM_CYMINTRACK),
             GetSystemMetrics(SM_CXMIN), GetSystemMetrics(SM_CYMIN), window.left,
             window.top, window.right, window.bottom, client.right, client.bottom);
    probe("border", when, probeResult);
}

/* The metrics USER keeps beside the settings. */
static void metrics(LPCSTR when)
{
    wsprintf(probeResult, "dblclk=%d,%d spacing=%d,%d dropalign=%d swap=%d",
             GetSystemMetrics(SM_CXDOUBLECLK), GetSystemMetrics(SM_CYDOUBLECLK),
             GetSystemMetrics(SM_CXICONSPACING), GetSystemMetrics(SM_CYICONSPACING),
             GetSystemMetrics(SM_MENUDROPALIGNMENT), GetSystemMetrics(SM_SWAPBUTTON));
    probe("metrics", when, probeResult);
}

static void font(LPCSTR name, UINT size)
{
    BYTE bytes[60];
    LOGFONT FAR *lf = (LOGFONT FAR *)bytes;
    BOOL answer;
    int at;
    int last;
    int after;

    for (at = 0; at < sizeof(bytes); at++) {
        bytes[at] = 0x5a;
    }

    answer = SystemParametersInfo(SPI_GETICONTITLELOGFONT, size, bytes, 0);
    last = bytes[49];
    after = bytes[50];
    bytes[59] = 0;

    wsprintf(probeArgs, "%s,%u", name, size);
    wsprintf(probeResult, "%d %d %d %d %x face=%s tail=%x,%x", answer, lf->lfHeight, lf->lfWidth,
             lf->lfWeight, (int)lf->lfItalic, (LPSTR)lf->lfFaceName, last, after);
    probe("get", probeArgs, probeResult);
}

static void setFont(LPCSTR name, UINT size, LOGFONT FAR *lf, UINT ini)
{
    char a[80];
    char b[80];
    char c[80];
    BOOL answer;

    log[0] = '\0';
    answer = SystemParametersInfo(SPI_SETICONTITLELOGFONT, size, lf, ini);

    wsprintf(probeArgs, "%s,%u,%u", name, size, ini);
    wsprintf(probeResult, "%d keys=%s,%s,%s msgs=%s", answer,
             (LPSTR)keyText("Desktop", "IconTitleFaceName", a),
             (LPSTR)keyText("Desktop", "IconTitleSize", b),
             (LPSTR)keyText("Desktop", "IconTitleStyle", c), (LPSTR)log);
    probe("set", probeArgs, probeResult);
}

static void setText(LPCSTR name, UINT action, UINT param, LPCSTR text, UINT ini, LPCSTR key)
{
    char out[80];
    BOOL answer;

    log[0] = '\0';
    answer = SystemParametersInfo(action, param, (LPVOID)text, ini);

    wsprintf(probeArgs, "%s,%d,%s,%u", name, (int)param, text ? text : (LPCSTR) "null", ini);
    wsprintf(probeResult, "%d key=%s msgs=%s", answer, (LPSTR)keyText("Desktop", key, out),
             (LPSTR)log);
    probe("set", probeArgs, probeResult);
}

static void keys(LPCSTR section)
{
    char list[1024];
    int length = GetProfileString(section, NULL, "", list, sizeof(list));
    int at;

    for (at = 0; at < length; at++) {
        if (list[at] == '\0') {
            list[at] = ',';
        }
    }

    list[length] = '\0';
    probe("keys", section, list);
}

/* A two by two bitmap file, four bits a pixel, for the wallpaper. */
static void writeBitmap(LPCSTR path)
{
    static BYTE file[] = {
        'B', 'M', 126, 0, 0, 0, 0, 0, 0, 0, 118, 0, 0, 0,
        40, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 4, 0, 0, 0, 0, 0, 8, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 128, 0, 0, 128, 0, 0, 0, 128, 128, 0,
        128, 0, 0, 0, 128, 0, 128, 0, 128, 128, 0, 0, 192, 192, 192, 0,
        128, 128, 128, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 255, 0,
        255, 0, 0, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 0,
        0x1e, 0, 0, 0, 0xe1, 0, 0, 0};
    HFILE handle = _lcreat(path, 0);

    _lwrite(handle, (LPCSTR)file, sizeof(file));
    _lclose(handle);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    BYTE saved[50];
    int mouseWas[3];
    int was[40];
    char text[80];
    HFILE handle;

    probeOpen(OUTPUT);

    kind.style = 0;
    kind.lpfnWndProc = HostProc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = "SysParam";
    RegisterClass(&kind);

    first = CreateWindow("SysParam", "A", WS_OVERLAPPEDWINDOW, 20, 20, 300, 200, NULL, NULL,
                         instance, NULL);
    second = CreateWindow("SysParam", "B", WS_OVERLAPPED, 40, 40, 200, 100, NULL, NULL,
                          instance, NULL);
    ShowWindow(first, SW_SHOWNORMAL);
    UpdateWindow(first);

    probeNote("defaults");
    getWord("beep", SPI_GETBEEP);
    getWord("border", SPI_GETBORDER);
    getWord("keyboardspeed", SPI_GETKEYBOARDSPEED);
    getWord("screensavetimeout", SPI_GETSCREENSAVETIMEOUT);
    getWord("screensaveactive", SPI_GETSCREENSAVEACTIVE);
    getWord("gridgranularity", SPI_GETGRIDGRANULARITY);
    getWord("keyboarddelay", SPI_GETKEYBOARDDELAY);
    getWord("icontitlewrap", SPI_GETICONTITLEWRAP);
    getWord("menudropalignment", SPI_GETMENUDROPALIGNMENT);
    getWord("fasttaskswitch", SPI_GETFASTTASKSWITCH);
    getWord("iconhorizontalspacing", SPI_ICONHORIZONTALSPACING);
    getWord("iconverticalspacing", SPI_ICONVERTICALSPACING);
    SystemParametersInfo(SPI_GETMOUSE, 0, mouseWas, 0);
    wsprintf(probeResult, "%d,%d,%d", mouseWas[0], mouseWas[1], mouseWas[2]);
    probe("get", "mouse", probeResult);
    font("icontitlelogfont", 50);
    font("icontitlelogfont", 0);
    font("icontitlelogfont", 4);
    font("icontitlelogfont", 60);
    wsprintf(probeResult, "%u swap=%d", GetDoubleClickTime(), GetSystemMetrics(SM_SWAPBUTTON));
    probe("get", "doubleclick", probeResult);

    metrics("start");

    probeNote("unknown actions");
    unknown(0);
    unknown(7);
    unknown(8);
    unknown(9);
    unknown(37);
    unknown(100);
    unknown(0x8000);

    SystemParametersInfo(SPI_GETICONTITLELOGFONT, sizeof(saved), saved, 0);
    was[0] = readWord(SPI_GETBEEP);
    was[1] = readWord(SPI_GETKEYBOARDSPEED);
    was[2] = readWord(SPI_GETKEYBOARDDELAY);
    was[3] = readWord(SPI_GETSCREENSAVETIMEOUT);
    was[4] = readWord(SPI_GETSCREENSAVEACTIVE);
    was[5] = readWord(SPI_GETGRIDGRANULARITY);
    was[6] = readWord(SPI_ICONHORIZONTALSPACING);
    was[7] = readWord(SPI_ICONVERTICALSPACING);
    was[8] = readWord(SPI_GETICONTITLEWRAP);
    was[9] = readWord(SPI_GETMENUDROPALIGNMENT);
    was[10] = readWord(SPI_GETFASTTASKSWITCH);
    was[11] = (int)GetDoubleClickTime();

    probeNote("beep");
    setWord("beep", SPI_SETBEEP, 0, 0, SPI_GETBEEP, "windows", "Beep");
    setWord("beep", SPI_SETBEEP, 5, 0, SPI_GETBEEP, "windows", "Beep");
    setWord("beep", SPI_SETBEEP, 0, 1, SPI_GETBEEP, "windows", "Beep");
    setWord("beep", SPI_SETBEEP, 2, 3, SPI_GETBEEP, "windows", "Beep");
    setWord("beep", SPI_SETBEEP, 1, 2, SPI_GETBEEP, "windows", "Beep");

    probeNote("mouse");
    mouse("mouse", 7, 12, 2, 0);
    mouse("mouse", 6, 11, 1, 1);
    mouse("mouse", 5, 10, 2, 3);

    probeNote("keyboard");
    setWord("keyboardspeed", SPI_SETKEYBOARDSPEED, 20, 0, SPI_GETKEYBOARDSPEED, "windows",
            "KeyboardSpeed");
    setWord("keyboardspeed", SPI_SETKEYBOARDSPEED, 12, 1, SPI_GETKEYBOARDSPEED, "windows",
            "KeyboardSpeed");
    setWord("keyboarddelay", SPI_SETKEYBOARDDELAY, 1, 1, SPI_GETKEYBOARDDELAY, "windows",
            "KeyboardDelay");
    setWord("keyboardspeed", SPI_SETKEYBOARDSPEED, 40, 0, SPI_GETKEYBOARDDELAY, "windows",
            "KeyboardSpeed");
    setWord("keyboardspeed", SPI_SETKEYBOARDSPEED, 40, 0, SPI_GETKEYBOARDSPEED, "windows",
            "KeyboardSpeed");
    setWord("keyboarddelay", SPI_SETKEYBOARDDELAY, 6, 3, SPI_GETKEYBOARDDELAY, "windows",
            "KeyboardDelay");
    setWord("keyboarddelay", SPI_SETKEYBOARDDELAY, 6, 3, SPI_GETKEYBOARDSPEED, "windows",
            "KeyboardDelay");

    probeNote("screen saver");
    setWord("screensavetimeout", SPI_SETSCREENSAVETIMEOUT, 300, 1, SPI_GETSCREENSAVETIMEOUT,
            "windows", "ScreenSaveTimeOut");
    setWord("screensaveactive", SPI_SETSCREENSAVEACTIVE, 1, 0, SPI_GETSCREENSAVEACTIVE,
            "windows", "ScreenSaveActive");
    setWord("screensavetimeout", SPI_SETSCREENSAVETIMEOUT, 60, 0, SPI_GETSCREENSAVEACTIVE,
            "windows", "ScreenSaveTimeOut");
    setWord("screensaveactive", SPI_SETSCREENSAVEACTIVE, 7, 1, SPI_GETSCREENSAVETIMEOUT,
            "windows", "ScreenSaveActive");
    setWord("screensavetimeout", SPI_SETSCREENSAVETIMEOUT, 0, 0, SPI_GETSCREENSAVEACTIVE,
            "windows", "ScreenSaveTimeOut");
    setWord("screensaveactive", SPI_SETSCREENSAVEACTIVE, 1, 0, SPI_GETSCREENSAVEACTIVE,
            "windows", "ScreenSaveActive");
    setWord("screensavetimeout", SPI_SETSCREENSAVETIMEOUT, 90, 0, SPI_GETSCREENSAVEACTIVE,
            "windows", "ScreenSaveTimeOut");
    setWord("screensaveactive", SPI_SETSCREENSAVEACTIVE, 0, 3, SPI_GETSCREENSAVETIMEOUT,
            "windows", "ScreenSaveActive");

    probeNote("desktop");
    setWord("gridgranularity", SPI_SETGRIDGRANULARITY, 3, 1, SPI_GETGRIDGRANULARITY, "Desktop",
            "GridGranularity");
    setWord("gridgranularity", SPI_SETGRIDGRANULARITY, 0, 0, SPI_GETGRIDGRANULARITY, "Desktop",
            "GridGranularity");
    setWord("iconhorizontalspacing", SPI_ICONHORIZONTALSPACING, 100, 1, SPI_ICONHORIZONTALSPACING,
            "Desktop", "IconSpacing");
    setWord("iconhorizontalspacing", SPI_ICONHORIZONTALSPACING, 10, 1, SPI_ICONHORIZONTALSPACING,
            "Desktop", "IconSpacing");
    setWord("iconhorizontalspacing", SPI_ICONHORIZONTALSPACING, 0, 3, SPI_ICONHORIZONTALSPACING,
            "Desktop", "IconSpacing");
    setWord("iconverticalspacing", SPI_ICONVERTICALSPACING, 90, 3, SPI_ICONVERTICALSPACING,
            "Desktop", "IconVerticalSpacing");
    setWord("iconverticalspacing", SPI_ICONVERTICALSPACING, 1, 0, SPI_ICONVERTICALSPACING,
            "Desktop", "IconVerticalSpacing");
    setWord("icontitlewrap", SPI_SETICONTITLEWRAP, 1, 1, SPI_GETICONTITLEWRAP, "Desktop",
            "IconTitleWrap");
    setWord("icontitlewrap", SPI_SETICONTITLEWRAP, 0, 1, SPI_GETICONTITLEWRAP, "Desktop",
            "IconTitleWrap");
    setWord("icontitlewrap", SPI_SETICONTITLEWRAP, 0, 1, SPI_GETICONTITLEWRAP, "Desktop",
            "IconTitleWrap");
    setWord("icontitlewrap", SPI_SETICONTITLEWRAP, 5, 3, SPI_GETICONTITLEWRAP, "Desktop",
            "IconTitleWrap");

    probeNote("menus and clicks");
    setWord("menudropalignment", SPI_SETMENUDROPALIGNMENT, 4, 1, SPI_GETMENUDROPALIGNMENT,
            "windows", "MenuDropAlignment");
    setWord("menudropalignment", SPI_SETMENUDROPALIGNMENT, 0, 1, SPI_GETMENUDROPALIGNMENT,
            "windows", "MenuDropAlignment");
    setWord("doubleclkwidth", SPI_SETDOUBLECLKWIDTH, 9, 1, 0, "windows", "DoubleClickWidth");
    setWord("doubleclkheight", SPI_SETDOUBLECLKHEIGHT, 7, 3, 0, "windows", "DoubleClickHeight");
    metrics("set");
    log[0] = '\0';
    SystemParametersInfo(SPI_SETDOUBLECLICKTIME, 0, NULL, 1);
    wsprintf(probeResult, "time=%u key=%s msgs=%s", GetDoubleClickTime(),
             (LPSTR)keyText("windows", "DoubleClickSpeed", text), (LPSTR)log);
    probe("set", "doubleclicktime,0,1", probeResult);
    SystemParametersInfo(SPI_SETDOUBLECLICKTIME, 321, NULL, 3);
    wsprintf(probeResult, "time=%u key=%s msgs=%s", GetDoubleClickTime(),
             (LPSTR)keyText("windows", "DoubleClickSpeed", text), (LPSTR)log);
    probe("set", "doubleclicktime,321,3", probeResult);
    log[0] = '\0';
    SystemParametersInfo(SPI_SETMOUSEBUTTONSWAP, 2, NULL, 1);
    wsprintf(probeResult, "swap=%d key=%s", GetSystemMetrics(SM_SWAPBUTTON),
             (LPSTR)keyText("windows", "SwapMouseButtons", text));
    probe("set", "mousebuttonswap,2,1", probeResult);
    metrics("swapped");
    SystemParametersInfo(SPI_SETMOUSEBUTTONSWAP, 1, NULL, 1);
    wsprintf(probeResult, "swap=%d key=%s", GetSystemMetrics(SM_SWAPBUTTON),
             (LPSTR)keyText("windows", "SwapMouseButtons", text));
    probe("set", "mousebuttonswap,1,1", probeResult);
    SystemParametersInfo(SPI_SETMOUSEBUTTONSWAP, 0, NULL, 0);
    wsprintf(probeResult, "swap=%d key=%s", GetSystemMetrics(SM_SWAPBUTTON),
             (LPSTR)keyText("windows", "SwapMouseButtons", text));
    probe("set", "mousebuttonswap,0,0", probeResult);
    setWord("fasttaskswitch", SPI_SETFASTTASKSWITCH, 0, 1, SPI_GETFASTTASKSWITCH, "windows",
            "CoolSwitch");
    setWord("fasttaskswitch", SPI_SETFASTTASKSWITCH, 2, 1, SPI_GETFASTTASKSWITCH, "windows",
            "CoolSwitch");
    setWord("fasttaskswitch", SPI_SETFASTTASKSWITCH, 1, 3, SPI_GETFASTTASKSWITCH, "windows",
            "CoolSwitch");

    probeNote("border");
    border("start");
    setWord("border", SPI_SETBORDER, 3, 1, SPI_GETBORDER, "windows", "BorderWidth");
    setWord("border", SPI_SETBORDER, 5, 0, SPI_GETBORDER, "windows", "BorderWidth");
    border("five");
    setWord("border", SPI_SETBORDER, 0, 1, SPI_GETBORDER, "windows", "BorderWidth");
    border("one");
    setWord("border", SPI_SETBORDER, 80, 3, SPI_GETBORDER, "windows", "BorderWidth");
    border("fifty");
    setWord("border", SPI_SETBORDER, 3, 1, SPI_GETBORDER, "windows", "BorderWidth");
    border("three");

    probeNote("icon title font");
    setFont("icontitlelogfont", 49, (LOGFONT FAR *)saved, 0);
    setFont("icontitlelogfont", 3, NULL, 0);
    ((LOGFONT FAR *)saved)->lfWeight = 700;
    setFont("icontitlelogfont", 50, (LOGFONT FAR *)saved, 0);
    font("icontitlelogfont", 50);
    setFont("icontitlelogfont", 50, (LOGFONT FAR *)saved, 1);
    ((LOGFONT FAR *)saved)->lfWeight = 400;
    ((LOGFONT FAR *)saved)->lfHeight = -11;
    setFont("icontitlelogfont", 50, (LOGFONT FAR *)saved, 3);
    font("icontitlelogfont", 50);
    setFont("icontitlelogfont", 0, NULL, 3);
    font("icontitlelogfont", 50);
    WriteProfileString("Desktop", "IconTitleFaceName", NULL);
    WriteProfileString("Desktop", "IconTitleSize", NULL);
    WriteProfileString("Desktop", "IconTitleStyle", NULL);
    setFont("icontitlelogfont", 0, NULL, 0);
    font("icontitlelogfont", 50);

    probeNote("pattern");
    setText("deskpattern", SPI_SETDESKPATTERN, 0, "170 85 170 85 170 85 170 85", 0, "Pattern");
    setText("deskpattern", SPI_SETDESKPATTERN, 0, "(None)", 1, "Pattern");
    setText("deskpattern", SPI_SETDESKPATTERN, 0, "136 0 0 0 136 0 0 0", 3, "Pattern");
    setText("deskpattern", SPI_SETDESKPATTERN, (UINT)-1, NULL, 0, "Pattern");
    setText("deskpattern", SPI_SETDESKPATTERN, (UINT)-1, "x", 0, "Pattern");
    setText("deskpattern", SPI_SETDESKPATTERN, (UINT)-1, NULL, 1, "Pattern");
    setText("deskpattern", SPI_SETDESKPATTERN, (UINT)-1, NULL, 0, "Pattern");
    setText("deskpattern", SPI_SETDESKPATTERN, 0, "(None)", 1, "Pattern");

    probeNote("wallpaper");
    writeBitmap("C:\\ORACLE\\SYSPARAM.BMP");
    handle = _lcreat("C:\\ORACLE\\SYSPARAM.TXT", 0);
    _lwrite(handle, "not a bitmap", 12);
    _lclose(handle);
    setText("deskwallpaper", SPI_SETDESKWALLPAPER, 0, "(None)", 0, "Wallpaper");
    setText("deskwallpaper", SPI_SETDESKWALLPAPER, 0, "(none)", 1, "Wallpaper");
    setText("deskwallpaper", SPI_SETDESKWALLPAPER, 0, "C:\\ORACLE\\NOFILE.BMP", 1, "Wallpaper");
    setText("deskwallpaper", SPI_SETDESKWALLPAPER, 0, "C:\\ORACLE\\SYSPARAM.TXT", 1,
            "Wallpaper");
    setText("deskwallpaper", SPI_SETDESKWALLPAPER, 0, "", 1, "Wallpaper");
    setText("deskwallpaper", SPI_SETDESKWALLPAPER, 0, "C:\\ORACLE\\SYSPARAM.BMP", 3, "Wallpaper");
    setText("deskwallpaper", SPI_SETDESKWALLPAPER, 0, NULL, 0, "Wallpaper");
    setText("deskwallpaper", SPI_SETDESKWALLPAPER, 0, NULL, 1, "Wallpaper");
    setText("deskwallpaper", SPI_SETDESKWALLPAPER, 0, NULL, 0, "Wallpaper");
    setText("deskwallpaper", SPI_SETDESKWALLPAPER, 0, "(None)", 1, "Wallpaper");

    probeNote("put back");
    SystemParametersInfo(SPI_SETBEEP, was[0], NULL, 0);
    WriteProfileString("windows", "Beep", "yes");
    SystemParametersInfo(SPI_SETMOUSE, 0, mouseWas, 0);
    WriteProfileString("windows", "MouseThreshold1", NULL);
    WriteProfileString("windows", "MouseThreshold2", NULL);
    WriteProfileString("windows", "MouseSpeed", NULL);
    SystemParametersInfo(SPI_SETKEYBOARDSPEED, was[1], NULL, 1);
    SystemParametersInfo(SPI_SETKEYBOARDDELAY, was[2], NULL, 1);
    SystemParametersInfo(SPI_SETSCREENSAVETIMEOUT, was[3], NULL, 1);
    SystemParametersInfo(SPI_SETSCREENSAVEACTIVE, was[4], NULL, 1);
    SystemParametersInfo(SPI_SETGRIDGRANULARITY, was[5], NULL, 1);
    SystemParametersInfo(SPI_ICONHORIZONTALSPACING, was[6], NULL, 0);
    SystemParametersInfo(SPI_ICONVERTICALSPACING, was[7], NULL, 0);
    WriteProfileString("Desktop", "IconSpacing", NULL);
    WriteProfileString("Desktop", "IconVerticalSpacing", NULL);
    SystemParametersInfo(SPI_SETICONTITLEWRAP, was[8], NULL, 0);
    WriteProfileString("Desktop", "IconTitleWrap", NULL);
    SystemParametersInfo(SPI_SETMENUDROPALIGNMENT, was[9], NULL, 0);
    WriteProfileString("windows", "MenuDropAlignment", NULL);
    SystemParametersInfo(SPI_SETDOUBLECLKWIDTH, 4, NULL, 0);
    SystemParametersInfo(SPI_SETDOUBLECLKHEIGHT, 4, NULL, 0);
    WriteProfileString("windows", "DoubleClickWidth", NULL);
    WriteProfileString("windows", "DoubleClickHeight", NULL);
    SystemParametersInfo(SPI_SETDOUBLECLICKTIME, was[11], NULL, 1);
    WriteProfileString("windows", "SwapMouseButtons", NULL);
    SystemParametersInfo(SPI_SETFASTTASKSWITCH, was[10], NULL, 0);
    WriteProfileString("windows", "CoolSwitch", NULL);
    keys("windows");
    keys("Desktop");
    wsprintf(probeResult, "%s|%s|%s", (LPSTR)keyText("windows", "KeyboardSpeed", text),
             (LPSTR)keyText("windows", "ScreenSaveTimeOut", text + 20),
             (LPSTR)keyText("Desktop", "GridGranularity", text + 40));
    probe("keys", "values", probeResult);

    DestroyWindow(second);
    DestroyWindow(first);
    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
