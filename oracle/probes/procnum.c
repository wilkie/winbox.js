/*
 * GetProcAddress of a name that is `#` and digits: KERNEL takes such a name
 * for the ordinal its digits make (`KRNL386.EXE` seg1 `50b3`-`511c`), and
 * looks any other up by name.
 *
 * * `procnum`: for each module (KERNEL, USER and GDI as Windows keeps them,
 *   COMMDLG loaded from its file) and each string, which ordinal the address
 *   GetProcAddress gives is: the first ordinal from 1 whose address, asked
 *   for by number (a name whose segment is nought), is the same; "null" for
 *   none given; "other" for an address no ordinal below the bound gives.
 *   Addresses themselves are not recorded: they are where Windows put the
 *   code. KERNEL takes an ordinal's low 15 bits (seg1 `4ff2`), so `#32769`
 *   is ordinal 1 as 32769 asked for by number is.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\PROCNUM.OUT"

/* The highest ordinal compared: past USER's last export (USER.EXE's
 * entry table ends below 700). */
#define BOUND 1100

static const char *strings[] = {
    "#1",     "#2",    "#01",    "#0001",  "#0",    "#",      "#65537", "#65536", "#65535",
    "#1x",    "#x1",   "# 1",    "#+1",    "#-1",   "#1 ",    "#12345", "#113",   "#178",
    "#9",     "1",     "#00",    "#1#",    "##1",    "#32769", "#32768", "#32770",
};

static void ask(LPCSTR label, HINSTANCE module, LPCSTR name)
{
    FARPROC found = GetProcAddress(module, name);
    int ordinal;

    if (!found) {
        lstrcpy(probeResult, "null");
    } else {
        lstrcpy(probeResult, "other");
        for (ordinal = 1; ordinal <= BOUND; ordinal++) {
            if (GetProcAddress(module, MAKEINTRESOURCE(ordinal)) == found) {
                wsprintf(probeResult, "ordinal %d", ordinal);
                break;
            }
        }
    }

    wsprintf(probeArgs, "%s %s", label, name);
    probe("procnum", probeArgs, probeResult);
}

/* An ordinal asked for by number, the name's segment nought. */
static void numbered(LPCSTR label, HINSTANCE module, UINT number)
{
    FARPROC found = GetProcAddress(module, MAKEINTRESOURCE(number));
    int ordinal;

    lstrcpy(probeResult, found ? "other" : "null");
    for (ordinal = 1; found && ordinal <= BOUND; ordinal++) {
        if (GetProcAddress(module, MAKEINTRESOURCE(ordinal)) == found) {
            wsprintf(probeResult, "ordinal %d", ordinal);
            break;
        }
    }

    wsprintf(probeArgs, "%s number %u", label, number);
    probe("procnum", probeArgs, probeResult);
}

static void each(LPCSTR label, HINSTANCE module)
{
    /* `#`, 130 noughts and a 5: past the 127 characters KERNEL copies of a
     * name (seg2 `0710`). */
    static char longer[140];
    int i;

    for (i = 0; i < (int)(sizeof(strings) / sizeof(strings[0])); i++) {
        ask(label, module, strings[i]);
    }

    longer[0] = '#';
    for (i = 1; i <= 130; i++) {
        longer[i] = '0';
    }
    longer[131] = '5';
    longer[132] = '\0';
    ask(label, module, longer);
    longer[126] = '7';
    ask(label, module, longer);
    numbered(label, module, 32769U);
    numbered(label, module, 32768U);
    numbered(label, module, 65535U);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HINSTANCE library;

    probeOpen(OUTPUT);

    each("KERNEL", GetModuleHandle("KERNEL"));
    each("USER", GetModuleHandle("USER"));
    each("GDI", GetModuleHandle("GDI"));

    library = LoadLibrary("COMMDLG.DLL");
    if (library >= HINSTANCE_ERROR) {
        each("COMMDLG", library);
        ask("COMMDLG", library, "GETOPENFILENAME");
        ask("COMMDLG", library, "GetOpenFileName");
        FreeLibrary(library);
    } else {
        probe("procnum", "COMMDLG", "not loaded");
    }

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
