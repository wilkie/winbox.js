/*
 * What RegisterClass answers a program marked for Windows 3.10
 * (`PROBE_WIN31`: its header's expected version 30Ah). USER asks
 * `GetExpWinVer` of the class's instance (`USER.EXE` seg8 `0152`-`015b`)
 * and answers 1 where it is 300h or less, else the class's atom (seg8
 * `0280`-`028f`); `classinf`, made for 3.00, is answered 1.
 *
 * * `version`: GetExpWinVer of the probe's instance.
 * * `register`: what RegisterClass answers -- `string atom` at C000h or
 *   above, `1`, or the number; then whether GetClassInfo answers the same.
 * * `again`: a second class's answer, and whether it differs from the
 *   first's.
 * * `unregister`: UnregisterClass of the first, then RegisterClass of it
 *   again: whether the atom is the same.
 */

#define PROBE_WIN31

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\REGCLS31.OUT"

WORD FAR PASCAL GetExpWinVer(HINSTANCE instance);

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(window, message, wParam, lParam);
}

static void describe(ATOM answer)
{
    if (answer >= 0xc000) {
        lstrcpy(probeResult, "string atom");
    } else {
        wsprintf(probeResult, "%x", (UINT)answer);
    }
}

static ATOM registerNamed(HINSTANCE instance, LPCSTR name)
{
    WNDCLASS kind;

    kind.style = CS_HREDRAW | CS_VREDRAW;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 0;
    kind.cbWndExtra = 0;
    kind.hInstance = instance;
    kind.hIcon = NULL;
    kind.hCursor = LoadCursor(NULL, IDC_ARROW);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = NULL;
    kind.lpszClassName = name;
    return RegisterClass(&kind);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;
    ATOM first, second, third;

    probeOpen(OUTPUT);

    wsprintf(probeResult, "%x", GetExpWinVer(instance));
    probe("version", "mine", probeResult);

    first = registerNamed(instance, "RegClass31");
    describe(first);
    probe("register", "answer", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)((ATOM)GetClassInfo(instance, "RegClass31", &kind) == first ? "same" : "differ"));
    probe("register", "GetClassInfo", probeResult);

    second = registerNamed(instance, "RegClass31b");
    describe(second);
    probe("again", "answer", probeResult);
    wsprintf(probeResult, "%s", (LPSTR)(second == first ? "same" : "differ"));
    probe("again", "the first's", probeResult);

    wsprintf(probeResult, "%d", UnregisterClass("RegClass31", instance));
    probe("unregister", "answer", probeResult);
    third = registerNamed(instance, "RegClass31");
    wsprintf(probeResult, "%s", (LPSTR)(third == first ? "same" : "differ"));
    probe("unregister", "registered again", probeResult);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
