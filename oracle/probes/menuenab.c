/*
 * What `EnableMenuItem`, `CheckMenuItem` and `GetMenuState` answer for an
 * item there is and one there is not, by command and by position, in a
 * menu bar, its pop-ups and a window's system menu: Windows Help grays
 * seven commands its menu does not have, each answered -1.
 *
 * The bar, `M`: "&File" (`F`: "&Open" 100, a separator, "&Save" 101,
 * "&More" (`S`: "&Item" 102, "&Save" 101), "E&xit" 103), "&Edit" 200 and
 * "&View" 300. 101 is in `F` and again in `S`, after it.
 *
 * Each record is the call (`enable`, `check`, `state`), what was asked --
 * the menu, the item and `cmd` or `pos` -- and the answer in hexadecimal;
 * after a change, `after`: the flags `GetMenuState` answers for each place
 * the change could have reached, by position, `F`'s and then `S`'s.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\MENUENAB.OUT"

static HMENU bar;
static HMENU file;
static HMENU sub;
static HMENU sys;

static LPCSTR nameOf(HMENU menu)
{
    if (menu == bar) {
        return "M";
    }

    if (menu == file) {
        return "F";
    }

    if (menu == sub) {
        return "S";
    }

    if (menu == sys) {
        return "sys";
    }

    return "null";
}

static void after(void)
{
    int i;
    char *at = probeResult;

    for (i = 0; i < GetMenuItemCount(file); i++) {
        at += wsprintf(at, "%x ", GetMenuState(file, i, MF_BYPOSITION));
    }

    at += wsprintf(at, "/");

    for (i = 0; i < GetMenuItemCount(sub); i++) {
        at += wsprintf(at, " %x", GetMenuState(sub, i, MF_BYPOSITION));
    }

    at += wsprintf(at, " / M");

    for (i = 0; i < GetMenuItemCount(bar); i++) {
        at += wsprintf(at, " %x", GetMenuState(bar, i, MF_BYPOSITION));
    }

    probe("after", probeArgs, probeResult);
}

/* An item as the records name it: a pop-up's handle by the pop-up's name,
 * as handles differ from run to run. */
static void itemOf(UINT item, char *out)
{
    if (item == (UINT)file || item == (UINT)sub) {
        lstrcpy(out, nameOf((HMENU)item));
    } else {
        wsprintf(out, "%x", item);
    }
}

static void enable(HMENU menu, UINT item, UINT flags)
{
    char named[8];

    itemOf(item, named);
    wsprintf(probeArgs, "%s,%s,%s,%x", nameOf(menu), (LPSTR)named,
             (LPSTR)((flags & MF_BYPOSITION) ? "pos" : "cmd"), flags & ~MF_BYPOSITION);
    wsprintf(probeResult, "%x", (UINT)EnableMenuItem(menu, item, flags));
    probe("enable", probeArgs, probeResult);
    after();
}

static void check(HMENU menu, UINT item, UINT flags)
{
    wsprintf(probeArgs, "%s,%x,%s,%x", nameOf(menu), item,
             (LPSTR)((flags & MF_BYPOSITION) ? "pos" : "cmd"), flags & ~MF_BYPOSITION);
    wsprintf(probeResult, "%x", (UINT)CheckMenuItem(menu, item, flags));
    probe("check", probeArgs, probeResult);
    after();
}

static void state(HMENU menu, UINT item, UINT flags)
{
    wsprintf(probeArgs, "%s,%x,%s", nameOf(menu), item,
             (LPSTR)((flags & MF_BYPOSITION) ? "pos" : "cmd"));
    wsprintf(probeResult, "%x", (UINT)GetMenuState(menu, item, flags));
    probe("state", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HWND window;
    UINT id;

    probeOpen(OUTPUT);

    sub = CreatePopupMenu();
    AppendMenu(sub, MF_STRING, 102, "&Item");
    AppendMenu(sub, MF_STRING, 101, "&Save");

    file = CreatePopupMenu();
    AppendMenu(file, MF_STRING, 100, "&Open");
    AppendMenu(file, MF_SEPARATOR, 0, NULL);
    AppendMenu(file, MF_STRING, 101, "&Save");
    AppendMenu(file, MF_POPUP, (UINT)sub, "&More");
    AppendMenu(file, MF_STRING, 103, "E&xit");

    bar = CreateMenu();
    AppendMenu(bar, MF_POPUP, (UINT)file, "&File");
    AppendMenu(bar, MF_STRING, 200, "&Edit");
    AppendMenu(bar, MF_STRING, 300, "&View");

    window = CreateWindow("STATIC", "", WS_OVERLAPPEDWINDOW, 20, 20, 300, 200, NULL, bar,
                          instance, NULL);
    sys = GetSystemMenu(window, FALSE);

    /* What is there, by command, through the pop-ups, and by position. */
    enable(bar, 100, MF_GRAYED);
    enable(bar, 102, MF_DISABLED);
    enable(bar, 200, MF_GRAYED);
    enable(bar, 100, MF_ENABLED);
    enable(file, 2, MF_BYPOSITION | MF_GRAYED);
    enable(bar, 0, MF_BYPOSITION | MF_GRAYED);
    enable(bar, 0, MF_BYPOSITION | MF_ENABLED);
    enable(file, 3, MF_BYPOSITION | MF_GRAYED);
    enable(file, 3, MF_BYPOSITION | MF_ENABLED);

    /* The same command twice: which of them. */
    enable(bar, 101, MF_GRAYED);
    enable(file, 101, MF_ENABLED);
    enable(sub, 101, MF_ENABLED);

    /* Windows Help's commands, which are not there. */
    for (id = 0x579; id <= 0x57f; id++) {
        enable(bar, id, MF_GRAYED);
    }

    /* Nought, which is the separator's command, and -1. */
    enable(file, 0, MF_GRAYED);
    enable(file, 0, MF_ENABLED);
    enable(bar, 0xffff, MF_GRAYED);

    /* Past the end, by position; a pop-up's handle as a command. */
    enable(bar, 3, MF_BYPOSITION | MF_GRAYED);
    enable(file, 5, MF_BYPOSITION | MF_GRAYED);
    enable(bar, (UINT)file, MF_GRAYED);
    enable(bar, (UINT)sub, MF_GRAYED);

    /* No menu. */
    enable(NULL, 100, MF_GRAYED);

    /* The system menu. */
    enable(sys, SC_CLOSE, MF_GRAYED);
    enable(sys, SC_CLOSE, MF_ENABLED);
    enable(sys, SC_KEYMENU, MF_GRAYED);
    enable(sys, 0, MF_BYPOSITION | MF_GRAYED);
    enable(sys, 20, MF_BYPOSITION | MF_GRAYED);
    enable(bar, SC_CLOSE, MF_GRAYED);

    /* CheckMenuItem finds an item as EnableMenuItem does. */
    check(bar, 102, MF_CHECKED);
    check(bar, 0x579, MF_CHECKED);
    check(bar, 5, MF_BYPOSITION | MF_CHECKED);
    check(bar, 102, MF_UNCHECKED);

    /* And GetMenuState. */
    state(bar, 100, MF_BYCOMMAND);
    state(bar, 0x579, MF_BYCOMMAND);
    state(bar, 0, MF_BYPOSITION);
    state(bar, 3, MF_BYPOSITION);
    state(file, 0, MF_BYCOMMAND);
    state(file, 1, MF_BYPOSITION);
    state(sys, SC_CLOSE, MF_BYCOMMAND);
    state(sys, SC_KEYMENU, MF_BYCOMMAND);
    state(NULL, 100, MF_BYCOMMAND);

    DestroyWindow(window);
    probeFinish();

    return 0;
}
