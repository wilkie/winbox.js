/*
 * An installer, as real ones are made, whose work a layer must keep
 * (`kb/formats/layer.md`): what it writes on C:, run once on the oracle,
 * then read back by the program it installed, INSTLAYC.EXE
 * (`instlay.child.c`), started from where it was installed.
 *
 * Its media are itself and the program beside it, in C:\WINDOWS where the
 * recorder puts both: the folder it was started from, where the program is
 * beside it, else C:\WINDOWS -- the probe harnesses start it from C:\, and
 * the page from its media's folder. It installs, in the order a Setup
 * does:
 *
 * * `mkdir`: its program's folder, C:\INSTLAY.
 * * `unpack`: two files in COMPRESS's format (`lzdata.h`) written into
 *   C:\WINDOWS\TEMP, as an installer unpacks its cabinet: a text and a
 *   library.
 * * `lzcopy`: the text expanded into C:\INSTLAY\README.TXT by LZOpenFile
 *   and LZCopy: what LZCopy answers.
 * * `find`, `verinst`: VerFindFile, then VerInstallFile, of the library
 *   into WINDOWS\SYSTEM, expanded on the way; and of the program, from the
 *   media's folder into C:\INSTLAY: what each answers.
 * * `clean`: the unpacked files deleted.
 * * `profile`: WIN.INI's [InstLay] -- its folder, and the program on the
 *   media it came from, which are not kept -- and a private INSTLAY.INI
 *   in its folder and in Windows' folder, by WritePrivateProfileString.
 * * `delete`: a file of Windows' deleted, SYSTEM\SETUP.REG.
 * * `scratch`: a folder made, a file written in it, both deleted: one in
 *   C:\INSTLAY and one in C:\WINDOWS.
 * * `stamp`: whether the files it wrote have one stamp, against
 *   README.TXT's.
 * * `exec`, `ended`: the program it installed started, and waited for:
 *   both written once it has ended, after its records.
 *   That program writes its own records into this file, `c.` before each.
 */

#include "probe.h"
#include <lzexpand.h>
#include <ver.h>
#include <direct.h>
#include <dos.h>

#pragma library("lzexpand")
#pragma library("ver")

#include "lzdata.h"

#define OUTPUT "C:\\ORACLE\\INSTLAY.OUT"
#define HOME "C:\\INSTLAY"
#define TEMP "C:\\WINDOWS\\TEMP"

/* Each record is closed into the file, so a hang leaves those before it,
 * and the program it starts can add its own. */
static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

#define probe record

static char text[256];

/* The media's folder, and the program on them. */
static char media[144];
static char mediaProgram[160];

/* The folder the installer was started from, where the program it
 * installs is beside it; C:\WINDOWS, where the recorder puts both, else. */
static void findMedia(HINSTANCE instance)
{
    OFSTRUCT of;
    int slash = 0;
    int i;

    GetModuleFileName(instance, media, sizeof(media));

    for (i = 0; media[i]; i++) {
        if (media[i] == '\\') {
            slash = i;
        }
    }

    media[slash] = 0;
    wsprintf(mediaProgram, "%s\\INSTLAYC.EXE", (LPSTR)media);

    if (slash <= 2 || OpenFile(mediaProgram, &of, OF_EXIST) == HFILE_ERROR) {
        lstrcpy(media, "C:\\WINDOWS");
        wsprintf(mediaProgram, "%s\\INSTLAYC.EXE", (LPSTR)media);
    }
}

static void putFile(LPCSTR path, const unsigned char *data, unsigned int size)
{
    HFILE file = _lcreat(path, 0);
    UINT wrote = _lwrite(file, (LPCSTR)data, size);

    _lclose(file);
    wsprintf(text, "%u", wrote);
    probe("unpack", path, text);
}

static void lzcopy(LPCSTR from, LPCSTR to)
{
    OFSTRUCT of;
    HFILE source = LZOpenFile((LPSTR)from, &of, OF_READ);
    HFILE dest = LZOpenFile((LPSTR)to, &of, OF_CREATE);
    LONG copied = LZCopy(source, dest);

    LZClose(source);
    LZClose(dest);
    wsprintf(probeArgs, "%s>%s", (LPSTR)from, (LPSTR)to);
    wsprintf(text, "%ld", copied);
    probe("lzcopy", probeArgs, text);
}

static void find(LPCSTR file)
{
    char current[144];
    char dest[144];
    UINT currentLength = sizeof(current);
    UINT destLength = sizeof(dest);
    UINT answer;

    current[0] = dest[0] = 0;
    answer = VerFindFile(VFFF_ISSHAREDFILE, (LPSTR)file, NULL, HOME, current, &currentLength, dest,
                         &destLength);
    wsprintf(text, "%x|%s|%s", answer, (LPSTR)current, (LPSTR)dest);
    probe("find", file, text);
}

static void install(LPCSTR source, LPCSTR dest, LPCSTR from, LPCSTR to)
{
    char temporary[144];
    UINT length = sizeof(temporary);
    DWORD answer;

    temporary[0] = 0;
    answer = VerInstallFile(0, (LPSTR)source, (LPSTR)dest, (LPSTR)from, (LPSTR)to, "", temporary,
                            &length);
    wsprintf(probeArgs, "%s\\%s>%s\\%s", (LPSTR)from, (LPSTR)source, (LPSTR)to, (LPSTR)dest);
    wsprintf(text, "%lx|%s", answer, (LPSTR)temporary);
    probe("verinst", probeArgs, text);
}

static void erase(LPCSTR what, LPCSTR path)
{
    OFSTRUCT of;

    probe(what, path, (LPSTR)(OpenFile(path, &of, OF_DELETE) == HFILE_ERROR ? "error" : "deleted"));
}

static void profile(LPCSTR file, LPCSTR section, LPCSTR key, LPCSTR value)
{
    BOOL done = file ? WritePrivateProfileString(section, key, value, file)
                     : WriteProfileString(section, key, value);

    wsprintf(probeArgs, "%s [%s] %s=%s", (LPSTR)(file ? file : "WIN.INI"), (LPSTR)section,
             (LPSTR)key, (LPSTR)value);
    probe("profile", probeArgs, (LPSTR)(done ? "yes" : "no"));
}

/* A folder made, a file written in it, both let go of. */
static void scratch(LPCSTR folder)
{
    char file[80];
    HFILE handle;
    int made = mkdir(folder);

    wsprintf(file, "%s\\SCRATCH.TMP", folder);
    handle = _lcreat(file, 0);
    _lwrite(handle, "scratch", 7);
    _lclose(handle);
    erase("scratch", file);
    wsprintf(text, "%d %d", made, rmdir(folder));
    probe("scratch", folder, text);
}

static void stampOf(LPCSTR path, unsigned *date, unsigned *time)
{
    HFILE file = _lopen(path, OF_READ);

    *date = *time = 0;

    if (file != HFILE_ERROR) {
        _dos_getftime(file, date, time);
        _lclose(file);
    }
}

static void stamps(void)
{
    static const char *WRITTEN[] = {
        HOME "\\INSTLAYC.EXE", HOME "\\INSTLAY.INI", "C:\\WINDOWS\\SYSTEM\\INSTLAY.DLL",
        "C:\\WINDOWS\\INSTLAY.INI", "C:\\WINDOWS\\WIN.INI",
    };
    unsigned date;
    unsigned time;
    unsigned readmeDate;
    unsigned readmeTime;
    int i;

    stampOf(HOME "\\README.TXT", &readmeDate, &readmeTime);

    for (i = 0; i < 5; i++) {
        stampOf(WRITTEN[i], &date, &time);
        probe("stamp", WRITTEN[i],
              (LPSTR)(date == readmeDate && time == readmeTime ? "as README.TXT" : "other"));
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    UINT started;
    DWORD start;
    MSG msg;

    probeOpen(OUTPUT);
    findMedia(instance);

    wsprintf(text, "%d", mkdir(HOME));
    probe("mkdir", HOME, text);

    putFile(TEMP "\\INSTLAY.TX_", LZ_TEXT, LZ_TEXT_SIZE);
    putFile(TEMP "\\INSTLAY.DL_", LZ_RUNS, LZ_RUNS_SIZE);

    lzcopy(TEMP "\\INSTLAY.TX_", HOME "\\README.TXT");

    find("INSTLAY.DLL");
    install("INSTLAY.DL_", "INSTLAY.DLL", TEMP, "C:\\WINDOWS\\SYSTEM");
    find("INSTLAYC.EXE");
    install("INSTLAYC.EXE", "INSTLAYC.EXE", media, HOME);

    erase("clean", TEMP "\\INSTLAY.TX_");
    erase("clean", TEMP "\\INSTLAY.DL_");

    profile(NULL, "InstLay", "Path", HOME);
    profile(NULL, "InstLay", "Media", mediaProgram);
    profile(HOME "\\INSTLAY.INI", "Settings", "Level", "3");
    profile(HOME "\\INSTLAY.INI", "Settings", "Name", "Layered");
    profile("INSTLAY.INI", "Installed", "From", "C:\\WINDOWS");

    erase("delete", "C:\\WINDOWS\\SYSTEM\\SETUP.REG");

    scratch(HOME "\\TMP");
    scratch("C:\\WINDOWS\\INSTTMP");

    stamps();

    /* Not held open while the program adds its records: a handle open
     * across them writes at the end the file had when it was opened. */
    _lclose(probeHandle);
    probeHandle = HFILE_ERROR;
    started = WinExec(HOME "\\INSTLAYC.EXE", SW_SHOWMINNOACTIVE);

    /* Until the program has ended, as an installer waits for what it
     * runs: half a minute at most. */
    for (start = GetTickCount(); started > 32 && GetModuleUsage(started) &&
                                 GetTickCount() - start < 30000;) {
        if (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            DispatchMessage(&msg);
        } else {
            Yield();
        }
    }

    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
    probe("exec", HOME "\\INSTLAYC.EXE", (LPSTR)(started > 32 ? "inst" : "error"));
    probe("ended", "INSTLAYC", (LPSTR)(started > 32 && GetModuleUsage(started) ? "no" : "yes"));
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
