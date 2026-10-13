/*
 * SHELL's `ExtractAssociatedIcon` and USER's `DumpIcon`, as Program
 * Manager uses them for an item it adds: the icon of a program, or of the
 * program a document is associated with, or a default from the caller's
 * own module, with the path and index it writes back; and where in a
 * locked icon its masks are.
 *
 * The probe's own module carries two icons of its own drawing, in the
 * VGA's sixteen colours, numbered 2 and 6 (`associco.rc`), the numbers `ExtractAssociatedIcon` loads from
 * the instance it is given when it finds no icon in the file. Each record
 * is the path and index passed, then whether an icon came back, the path
 * and index written back (the probe's own path written as `SELF`), and
 * what `DumpIcon` says of the locked icon: the header's byte count, where
 * the two masks are from the start of the lock, the two sizes it answers,
 * the header's width, height, bytes a mask row, planes and bits, and a sum
 * of the masks' bytes. A handle's value is never written.
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\ASSOCICO.OUT"

HICON WINAPI ExtractAssociatedIcon(HINSTANCE, LPSTR, UINT FAR *);
HICON WINAPI ExtractIcon(HINSTANCE, LPCSTR, UINT);
DWORD WINAPI DumpIcon(LPSTR, UINT FAR *, LPSTR FAR *, LPSTR FAR *);

#pragma library("shell")

static HINSTANCE module;
static char self[128];

/* What `DumpIcon` says of an icon, into `out`. */
static void dump(HICON icon, LPSTR out)
{
    LPSTR info;
    LPSTR first = NULL;
    LPSTR second = NULL;
    UINT header = 0;
    DWORD sizes;
    WORD sum = 0;
    LPWORD words;
    WORD i;

    info = (LPSTR)LockResource((HGLOBAL)icon);

    if (!info) {
        lstrcpy(out, "unlocked");
        return;
    }

    sizes = DumpIcon(info, &header, &first, &second);
    words = (LPWORD)info;

    for (i = 0; i < LOWORD(sizes) + HIWORD(sizes); i++) {
        sum += (BYTE)first[i];
    }

    wsprintf(out, "cb=%u,first=%u,second=%u,sizes=%u:%u,hdr=%u:%u:%u:%u:%u,sum=%u", header,
             OFFSETOF(first) - OFFSETOF(info), OFFSETOF(second) - OFFSETOF(info),
             LOWORD(sizes), HIWORD(sizes), words[2], words[3], words[4], (BYTE)info[10],
             (BYTE)info[11], sum);
    GlobalUnlock((HGLOBAL)icon);
}

static void associated(LPCSTR path, UINT index)
{
    char buffer[128];
    char facts[160];
    HICON icon;
    UINT written = index;

    lstrcpy(buffer, path);
    icon = ExtractAssociatedIcon(module, buffer, &written);

    if (icon) {
        dump(icon, facts);
    } else {
        lstrcpy(facts, "-");
    }

    wsprintf(probeArgs, "%s,%u", path, index);
    wsprintf(probeResult, "%s,%s,%u,%s", (LPSTR)(icon ? "icon" : "0"),
             (LPSTR)(lstrcmpi(buffer, self) == 0 ? "SELF" : buffer), written, (LPSTR)facts);
    probe("ExtractAssociatedIcon", probeArgs, probeResult);

    if (icon) {
        DestroyIcon(icon);
    }
}

static void make(LPCSTR path)
{
    HFILE file = _lcreat(path, 0);

    _lwrite(file, "plain text", 10);
    _lclose(file);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT header = 99;
    LPSTR first = NULL;
    LPSTR second = NULL;
    char facts[160];
    HICON icon;
    DWORD sizes;

    probeOpen(OUTPUT);
    module = instance;
    GetModuleFileName(instance, self, sizeof(self));

    make("C:\\ORACLE\\NOEXT");
    make("C:\\ORACLE\\PLAIN.XYZ");
    make("C:\\ORACLE\\NOTES.TXT");

    associated("C:\\WINDOWS\\NOTEPAD.EXE", 0);
    associated("C:\\WINDOWS\\NOTEPAD.EXE", 1);
    associated("C:\\WINDOWS\\PROGMAN.EXE", 0);
    associated("C:\\WINDOWS\\PROGMAN.EXE", 9);
    associated("C:\\WINDOWS\\MORICONS.DLL", 3);
    associated("C:\\WINDOWS\\WIN.COM", 0);
    associated("C:\\WINDOWS\\SYSTEM\\USER.EXE", 0);
    associated("C:\\ORACLE\\NOTES.TXT", 0);
    associated("C:\\ORACLE\\NOTES.TXT", 2);
    associated("C:\\WINDOWS\\SETUP.TXT", 0);
    associated("C:\\ORACLE\\PLAIN.XYZ", 0);
    associated("C:\\ORACLE\\NOEXT", 0);
    associated("C:\\NOPE.EXE", 0);
    associated("C:\\NOPE.TXT", 0);
    associated("NOTEPAD.EXE", 0);

    /* `DumpIcon` of the icons that come other ways. */
    icon = ExtractIcon(instance, "C:\\WINDOWS\\NOTEPAD.EXE", 0);
    dump(icon, facts);
    probe("DumpIcon", "ExtractIcon", facts);
    DestroyIcon(icon);

    icon = LoadIcon(instance, MAKEINTRESOURCE(6));
    dump(icon, facts);
    probe("DumpIcon", "LoadIcon,6", facts);

    sizes = DumpIcon(NULL, &header, &first, &second);
    wsprintf(probeResult, "%lx,cb=%u,%s", sizes, header,
             (LPSTR)(first || second ? "written" : "untouched"));
    probe("DumpIcon", "null", probeResult);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
