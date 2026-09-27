/*
 * SHELL's DoEnvironmentSubst, FindExecutable and ExtractIcon:
 *
 * * `subst`: DoEnvironmentSubst's answer, as its two words in hex, and the
 *   string after, for a string and the size given.
 * * `find`: FindExecutable's answer, `inst` for an instance handle and else
 *   the number, and the path it found.
 * * `extract`: ExtractIcon's answer: `icon` for a handle, else the number.
 */

#include "probe.h"
#include <shellapi.h>

#define OUTPUT "C:\\ORACLE\\SHELL2.OUT"

/* Not in the import library: found by name. */
typedef DWORD(FAR PASCAL *SUBSTPROC)(LPSTR, UINT);

static SUBSTPROC doEnvironmentSubst;

static void subst(LPCSTR what, LPCSTR text, UINT size)
{
    static char buffer[200];
    DWORD answer;

    lstrcpy(buffer, text);
    answer = doEnvironmentSubst(buffer, size);
    wsprintf(probeResult, "%04x,%04x:%s", HIWORD(answer), LOWORD(answer), (LPSTR)buffer);
    probe("subst", what, probeResult);
}

static void find(LPCSTR file, LPCSTR directory)
{
    char result[160];
    HINSTANCE answer;

    lstrcpy(result, "untouched");
    answer = FindExecutable(file, directory, result);

    if ((UINT)answer > 32) {
        wsprintf(probeResult, "inst:%s", (LPSTR)result);
    } else {
        wsprintf(probeResult, "%u:%s", (UINT)answer, (LPSTR)result);
    }

    wsprintf(probeArgs, "%s|%s", file, (LPSTR)(directory ? directory : "NULL"));
    probe("find", probeArgs, probeResult);
}

static void extract(HINSTANCE instance, LPCSTR file, UINT index)
{
    HICON answer = ExtractIcon(instance, file, index);

    wsprintf(probeArgs, "%s|%d", file, (int)index);

    if ((UINT)answer > 1 && index != 0xffff) {
        lstrcpy(probeResult, "icon");
        DestroyIcon(answer);
    } else {
        wsprintf(probeResult, "%u", (UINT)answer);
    }

    probe("extract", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HFILE file;

    probeOpen(OUTPUT);

    doEnvironmentSubst = (SUBSTPROC)GetProcAddress(GetModuleHandle("SHELL"), "DoEnvironmentSubst");

    /* `windir`, which winbox.js's tasks have too: its host lends them no
     * others, where DOSBox lent COMSPEC, PATH and BLASTER. */
    subst("windir", "%windir%", 200);
    subst("inside", "x%windir%y", 200);
    subst("two", "%windir%;%windir%", 200);
    subst("unknown", "a%NOSUCHNAME%b", 200);
    subst("upper", "%WINDIR%", 200);
    subst("percent percent", "100%%", 200);
    subst("one percent", "100%", 200);
    subst("empty", "", 200);
    subst("no variables", "plain text", 200);
    subst("small", "%windir%", 6);
    subst("exact", "%windir%", 11);
    subst("one short", "%windir%", 10);

    file = _lcreat("C:\\ORACLE\\SAMPLE.XYZ", 0);
    _lclose(file);
    file = _lcreat("C:\\ORACLE\\SAMPLE.TXT", 0);
    _lclose(file);
    file = _lcreat("C:\\ORACLE\\SAMPLE.BMP", 0);
    _lclose(file);

    find("C:\\WINDOWS\\WIN.INI", NULL);
    find("WIN.INI", "C:\\WINDOWS");
    find("C:\\WINDOWS\\NOTEPAD.EXE", NULL);
    find("NOTEPAD.EXE", "C:\\WINDOWS");
    find("C:\\ORACLE\\SAMPLE.TXT", NULL);
    find("c:\\oracle\\sample.txt", NULL);
    find("C:\\ORACLE\\SAMPLE.BMP", NULL);
    find("C:\\ORACLE\\SAMPLE.XYZ", NULL);
    find("C:\\ORACLE\\NOTHERE.TXT", NULL);
    find("SAMPLE.TXT", "C:\\ORACLE");
    find("SAMPLE.TXT", NULL);
    find("C:\\NODIR\\X.TXT", NULL);

    extract(instance, "C:\\WINDOWS\\PROGMAN.EXE", 0xffff);
    extract(instance, "C:\\WINDOWS\\PROGMAN.EXE", 0);
    extract(instance, "C:\\WINDOWS\\PROGMAN.EXE", 4);
    extract(instance, "C:\\WINDOWS\\PROGMAN.EXE", 99);
    extract(instance, "C:\\WINDOWS\\MORICONS.DLL", 0xffff);
    extract(instance, "C:\\WINDOWS\\MORICONS.DLL", 5);
    extract(instance, "C:\\WINDOWS\\NOTEPAD.EXE", 0xffff);
    extract(instance, "C:\\WINDOWS\\SYSTEM\\GDI.EXE", 0xffff);
    extract(instance, "C:\\WINDOWS\\SYSTEM\\GDI.EXE", 0);
    extract(instance, "C:\\WINDOWS\\WIN.INI", 0xffff);
    extract(instance, "C:\\WINDOWS\\WIN.INI", 0);
    extract(instance, "C:\\WINDOWS\\NOTHERE.EXE", 0);
    extract(instance, "C:\\WINDOWS\\NOTHERE.EXE", 0xffff);

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
