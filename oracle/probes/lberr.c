/*
 * What a list box and a combo box answer when a message fails, all 32 bits
 * of it: whether `LB_ERR` comes back as FFFFh or as FFFFFFFFh, and the same
 * for the answers that are indices. File Manager walks a list with
 * `LB_GETTEXT` until the answer is -1 as a long.
 *
 * Records `answer`: each message's answer in hexadecimal, all 32 bits.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LBERR.OUT"

static void answer(LPCSTR what, LONG value)
{
    wsprintf(probeResult, "%08lX", value);
    probe("answer", what, probeResult);
}

LONG FAR PASCAL _export HostProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    return DefWindowProc(hwnd, message, wParam, lParam);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    WNDCLASS windowClass;
    HWND host;
    HWND list;
    HWND combo;
    char text[64];

    probeOpen(OUTPUT);

    windowClass.style = 0;
    windowClass.lpfnWndProc = HostProc;
    windowClass.cbClsExtra = 0;
    windowClass.cbWndExtra = 0;
    windowClass.hInstance = instance;
    windowClass.hIcon = NULL;
    windowClass.hCursor = NULL;
    windowClass.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    windowClass.lpszMenuName = NULL;
    windowClass.lpszClassName = "LbErr";
    RegisterClass(&windowClass);

    host = CreateWindow("LbErr", "Errors", WS_OVERLAPPEDWINDOW, 20, 20, 300, 200, NULL, NULL,
                        instance, NULL);
    list = CreateWindow("LISTBOX", "", WS_CHILD | WS_VISIBLE | WS_BORDER | LBS_NOTIFY, 8, 8, 100,
                        80, host, (HMENU)100, instance, NULL);
    combo = CreateWindow("COMBOBOX", "", WS_CHILD | WS_VISIBLE | CBS_DROPDOWNLIST, 120, 8, 100,
                         80, host, (HMENU)101, instance, NULL);

    SendMessage(list, LB_ADDSTRING, 0, (LPARAM)(LPSTR) "one");
    SendMessage(list, LB_ADDSTRING, 0, (LPARAM)(LPSTR) "two");
    SendMessage(combo, CB_ADDSTRING, 0, (LPARAM)(LPSTR) "one");

    answer("lb-add", SendMessage(list, LB_ADDSTRING, 0, (LPARAM)(LPSTR) "three"));
    answer("lb-getcursel", SendMessage(list, LB_GETCURSEL, 0, 0L));
    answer("lb-gettext", SendMessage(list, LB_GETTEXT, 99, (LPARAM)(LPSTR)text));
    answer("lb-gettextlen", SendMessage(list, LB_GETTEXTLEN, 99, 0L));
    answer("lb-setcursel", SendMessage(list, LB_SETCURSEL, 99, 0L));
    answer("lb-setcursel-none", SendMessage(list, LB_SETCURSEL, (WPARAM)-1, 0L));
    answer("lb-deletestring", SendMessage(list, LB_DELETESTRING, 99, 0L));
    answer("lb-getitemdata", SendMessage(list, LB_GETITEMDATA, 99, 0L));
    answer("lb-findstring", SendMessage(list, LB_FINDSTRING, (WPARAM)-1, (LPARAM)(LPSTR) "zz"));
    answer("lb-getsel", SendMessage(list, LB_GETSEL, 99, 0L));
    answer("lb-insert", SendMessage(list, LB_INSERTSTRING, 99, (LPARAM)(LPSTR) "x"));
    answer("lb-selectstring", SendMessage(list, LB_SELECTSTRING, (WPARAM)-1, (LPARAM)(LPSTR) "zz"));
    answer("lb-getselcount", SendMessage(list, LB_GETSELCOUNT, 0, 0L));
    answer("lb-gettopindex", SendMessage(list, LB_GETTOPINDEX, 0, 0L));
    answer("lb-getcount", SendMessage(list, LB_GETCOUNT, 0, 0L));
    answer("cb-getcursel", SendMessage(combo, CB_GETCURSEL, 0, 0L));
    answer("cb-getlbtext", SendMessage(combo, CB_GETLBTEXT, 99, (LPARAM)(LPSTR)text));
    answer("cb-getlbtextlen", SendMessage(combo, CB_GETLBTEXTLEN, 99, 0L));
    answer("cb-setcursel", SendMessage(combo, CB_SETCURSEL, 99, 0L));
    answer("cb-findstring", SendMessage(combo, CB_FINDSTRING, (WPARAM)-1, (LPARAM)(LPSTR) "zz"));
    answer("cb-getitemdata", SendMessage(combo, CB_GETITEMDATA, 99, 0L));

    DestroyWindow(host);
    probeFinish();

    return 0;
}
