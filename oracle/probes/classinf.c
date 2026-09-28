/*
 * GetClassInfo: a class of the probe's own, asked for by its instance and
 * by none; USER's own classes, asked for with no instance; and names that
 * are no class.
 *
 * * `register`: what RegisterClass answers.
 * * `info`: GetClassInfo's answer -- `atom` for the atom RegisterClass
 *   answered, `string atom` for another at C000h or above, or the number --
 *   then the WNDCLASS it filled: its style,
 *   whether its procedure is the one registered (`proc`) or another
 *   (`other`), the class and window extra bytes, the instance as `mine`,
 *   `none` or the number, the icon, cursor and brush as `yes`, `none` or
 *   the number, the menu name, and whether the class name is the pointer
 *   passed in (`passed`) or another.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\CLASSINF.OUT"

LRESULT CALLBACK __export Proc(HWND window, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(window, message, wParam, lParam);
}

static HINSTANCE mine;
static ATOM registered;

static void handle(LPSTR out, WORD value)
{
    if (!value) {
        lstrcpy(out, "none");
    } else if (value < 0x40) {
        wsprintf(out, "%u", value);
    } else {
        lstrcpy(out, "yes");
    }
}

static void ask(LPCSTR what, HINSTANCE instance, LPCSTR name)
{
    WNDCLASS kind;
    BOOL answer;
    char icon[8], cursor[8], brush[8], menu[40], owner[8];

    _fmemset(&kind, 0xcc, sizeof(kind));
    answer = GetClassInfo(instance, name, &kind);

    if (!answer) {
        probe("info", what, "0");
        return;
    }

    if ((UINT)answer < 0xc000 && (UINT)answer != registered) {
        wsprintf(probeResult, "%x", (UINT)answer);
        probe("number", what, probeResult);
    }

    handle(icon, (WORD)kind.hIcon);
    handle(cursor, (WORD)kind.hCursor);
    handle(brush, (WORD)kind.hbrBackground);

    if (HIWORD((DWORD)kind.lpszMenuName)) {
        lstrcpy(menu, kind.lpszMenuName);
    } else {
        wsprintf(menu, "#%u", LOWORD((DWORD)kind.lpszMenuName));
    }

    if (kind.hInstance == mine) {
        lstrcpy(owner, "mine");
    } else if (!kind.hInstance) {
        lstrcpy(owner, "none");
    } else {
        lstrcpy(owner, "other");
    }

    if ((UINT)answer == registered) {
        lstrcpy(owner + 0, owner);
    }

    wsprintf(probeResult, "%s style=%x %s cls=%d wnd=%d inst=%s icon=%s cursor=%s brush=%s menu=%s name=%s",
             (LPSTR)((UINT)answer == registered ? "atom" : (UINT)answer >= 0xc000 ? "string atom" : "number"), kind.style, (LPSTR)(kind.lpfnWndProc == (WNDPROC)Proc ? "proc" : "other"),
             kind.cbClsExtra, kind.cbWndExtra, (LPSTR)owner, (LPSTR)icon, (LPSTR)cursor,
             (LPSTR)brush, (LPSTR)menu,
             (LPSTR)(kind.lpszClassName == name ? "passed" : "other"));
    probe("info", what, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS kind;

    probeOpen(OUTPUT);
    mine = instance;

    kind.style = CS_HREDRAW | CS_VREDRAW | CS_DBLCLKS;
    kind.lpfnWndProc = Proc;
    kind.cbClsExtra = 6;
    kind.cbWndExtra = 10;
    kind.hInstance = instance;
    kind.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    kind.hCursor = LoadCursor(NULL, IDC_CROSS);
    kind.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    kind.lpszMenuName = "MainMenu";
    kind.lpszClassName = "ClassInfo";
    registered = RegisterClass(&kind);
    wsprintf(probeResult, "%s", (LPSTR)(registered >= 0xc000 ? "string atom" : registered ? "not an atom" : "0"));
    probe("register", "answer", probeResult);
    if (registered < 0xc000) {
        wsprintf(probeResult, "%x", registered);
        probe("register", "number", probeResult);
    }
    wsprintf(probeResult, "%s", (LPSTR)(GetClassInfo(instance, "ClassInfo", &kind) == GetClassInfo(instance, "CLASSINFO", &kind) ? "same" : "differ"));
    probe("register", "the atom asked for twice", probeResult);

    ask("mine, by my instance", instance, "ClassInfo");
    ask("mine, by no instance", NULL, "ClassInfo");
    ask("mine, other case", instance, "CLASSINFO");
    ask("Button", NULL, "Button");
    ask("Edit", NULL, "Edit");
    ask("Static", NULL, "Static");
    ask("ListBox", NULL, "ListBox");
    ask("ScrollBar", NULL, "ScrollBar");
    ask("ComboBox", NULL, "ComboBox");
    ask("dialog", NULL, MAKEINTRESOURCE(0x8002));
    ask("Button, by my instance", instance, "Button");
    ask("no such class", instance, "NoSuchClass");
    ask("no such class, no instance", NULL, "NoSuchClass");

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
