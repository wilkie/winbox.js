/*
 * Installable drivers, from the driver's side: every call USER makes to a
 * driver's `DriverProc` as a program opens, asks and closes it. The driver
 * is the probe's own library, `DRVMSGD.DLL` (`drvmsg.dll.c`), which logs each
 * call to a file this reads back after each step.
 *
 * * `open`, `close`, `send`: what the call answered (a handle as `h1`...,
 *   in the order they came, or `0`).
 * * `calls`: the calls the driver was given by that step, each as
 *   `message(id,driver,first,second)=answer`; a handle is named as above,
 *   or `new` for one no call answered, an identifier that is the driver's
 *   own handle is `self`, and `DRV_OPEN`'s first parameter is the text it
 *   points to, in quotes.
 * * `walk`: `GetNextDriver`'s list, as aliases, forwards (0), backwards (2),
 *   first instances only (1).
 * * `info`: `GetDriverInfo`'s answer, alias and whether its module is the
 *   library.
 * * `loaded`: whether the library is loaded, and its count.
 * * `default`: what `DefDriverProc` answers for a message, with no driver,
 *   and with an open one (`live-`).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\DRVMSG.OUT"
#define LOG "C:\\ORACLE\\DRVMSG.BIN"

typedef struct {
    DWORD id;
    WORD driver;
    WORD message;
    LONG first;
    LONG second;
    LONG answer;
    char text[24];
} ENTRY;

typedef struct {
    UINT length;
    HANDLE hDriver;
    HINSTANCE hModule;
    char szAliasName[128];
} DRIVERINFO;

typedef HANDLE(FAR PASCAL *OPENPROC)(LPCSTR, LPCSTR, LONG);
typedef LONG(FAR PASCAL *CLOSEPROC)(HANDLE, LONG, LONG);
typedef LONG(FAR PASCAL *SENDPROC)(HANDLE, WORD, LONG, LONG);
typedef HANDLE(FAR PASCAL *NEXTPROC)(HANDLE, DWORD);
typedef BOOL(FAR PASCAL *INFOPROC)(HANDLE, DRIVERINFO FAR *);
typedef HINSTANCE(FAR PASCAL *MODULEPROC)(HANDLE);
typedef LONG(FAR PASCAL *DEFPROC)(DWORD, HANDLE, WORD, LONG, LONG);

static OPENPROC openDriver;
static CLOSEPROC closeDriver;
static SENDPROC sendMessage;
static NEXTPROC nextDriver;
static INFOPROC driverInfo;
static MODULEPROC driverModule;
static DEFPROC defaultProc;

static HANDLE handles[8];
static int handleCount;
static LONG logRead;
static char text[1800];

/* A handle by the order it came in, or `new` for one not yet seen. */
static LPCSTR nameOf(WORD handle)
{
    static char name[8];
    int index;

    if (!handle) {
        return "0";
    }

    for (index = 0; index < handleCount; index++) {
        if ((WORD)handles[index] == handle) {
            wsprintf(name, "h%d", index + 1);
            return name;
        }
    }

    return "new";
}

static LPCSTR remember(HANDLE handle)
{
    if (handle && handleCount < 8) {
        handles[handleCount++] = handle;
    }

    return nameOf((WORD)handle);
}

/* The driver's calls since the last step. */
static void calls(LPCSTR step)
{
    ENTRY entry;
    char one[120];
    char id[16];
    char first[40];
    int file;

    text[0] = '\0';
    file = _lopen(LOG, 0);

    if (file != -1) {
        _llseek(file, logRead, 0);

        while (_lread(file, (LPSTR)(ENTRY FAR *)&entry, sizeof(entry)) == sizeof(entry)) {
            logRead += sizeof(entry);

            if (entry.id && entry.id == (DWORD)entry.driver) {
                lstrcpy(id, "self");
            } else if (entry.id && entry.id < 0x10000L && lstrcmp(nameOf((WORD)entry.id), "new")) {
                lstrcpy(id, nameOf((WORD)entry.id));
            } else {
                wsprintf(id, "%lx", entry.id);
            }

            if (entry.message == 3) {
                wsprintf(first, "\"%s\"", (LPSTR)entry.text);
            } else {
                wsprintf(first, "%lx", entry.first);
            }

            wsprintf(one, "%s%x(%s,%s,%s,%lx)=%lx", (LPSTR)(text[0] ? " " : ""), entry.message,
                     (LPSTR)id, (LPSTR)nameOf(entry.driver), (LPSTR)first, entry.second,
                     entry.answer);

            if (lstrlen(text) + lstrlen(one) < sizeof(text) - 1) {
                lstrcat(text, one);
            }
        }

        _lclose(file);
    }

    probe("calls", step, text[0] ? text : "none");
}

static void walk(LPCSTR what, DWORD flags)
{
    DRIVERINFO info;
    char one[140];
    HANDLE handle;
    int count;

    text[0] = '\0';
    count = 0;
    handle = nextDriver(0, flags);

    while (handle && count < 16) {
        info.length = sizeof(info);
        info.szAliasName[0] = '\0';
        driverInfo(handle, &info);
        wsprintf(one, "%s%s", (LPSTR)(count ? "," : ""), (LPSTR)info.szAliasName);
        lstrcat(text, one);
        count++;
        handle = nextDriver(handle, flags);
    }

    probe("walk", what, text);
}

static void loaded(LPCSTR step)
{
    HMODULE module;

    module = GetModuleHandle("DRVMSGD");

    if (module) {
        wsprintf(probeResult, "loaded,%d", GetModuleUsage(module));
    } else {
        lstrcpy(probeResult, "gone");
    }

    probe("loaded", step, probeResult);
}

static void info(LPCSTR what, HANDLE handle)
{
    DRIVERINFO driver;
    char file[128];
    BOOL answer;

    driver.length = sizeof(driver);
    driver.hDriver = 0;
    driver.hModule = 0;
    lstrcpy(driver.szAliasName, "untouched");
    answer = driverInfo(handle, &driver);
    file[0] = '\0';

    if (driver.hModule) {
        GetModuleFileName(driver.hModule, file, sizeof(file));
    }

    wsprintf(probeResult, "%d,%s,%s,%s", answer, (LPSTR)nameOf((WORD)driver.hDriver),
             (LPSTR)driver.szAliasName,
             (LPSTR)(lstrlen(file) >= 11 && !lstrcmpi(file + lstrlen(file) - 11, "DRVMSGD.DLL") ? "library" : file));
    probe("info", what, probeResult);
}

static void opened(LPCSTR step, LPCSTR name, LPCSTR section, LONG parameter)
{
    probe("open", step, remember(openDriver(name, section, parameter)));
    calls(step);
}

static void closed(LPCSTR step, HANDLE handle)
{
    wsprintf(probeResult, "%ld", closeDriver(handle, 0x33L, 0x44L));
    probe("close", step, probeResult);
    calls(step);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HMODULE user;
    int message;
    char step[16];

    probeOpen(OUTPUT);

    /* A log left from before is not this run's. */
    _lclose(_lcreat(LOG, 0));

    user = GetModuleHandle("USER");
    sendMessage = (SENDPROC)GetProcAddress(user, MAKEINTRESOURCE(251));
    openDriver = (OPENPROC)GetProcAddress(user, MAKEINTRESOURCE(252));
    closeDriver = (CLOSEPROC)GetProcAddress(user, MAKEINTRESOURCE(253));
    driverModule = (MODULEPROC)GetProcAddress(user, MAKEINTRESOURCE(254));
    defaultProc = (DEFPROC)GetProcAddress(user, MAKEINTRESOURCE(255));
    driverInfo = (INFOPROC)GetProcAddress(user, MAKEINTRESOURCE(256));
    nextDriver = (NEXTPROC)GetProcAddress(user, MAKEINTRESOURCE(257));

    walk("before", 0);
    loaded("before");

    /* By its file's name, which no section names. */
    opened("file", "DRVMSGD.DLL", NULL, 0x1111L);
    loaded("file");
    opened("file-again", "DRVMSGD.DLL", NULL, 0x2222L);
    loaded("file-again");

    walk("forwards", 0);
    walk("backwards", 2);
    walk("first-instances", 1);
    info("h1", handles[0]);
    info("h2", handles[1]);
    probe("module", "h1", (LPSTR)(driverModule(handles[0]) == GetModuleHandle("DRVMSGD") ? "module" : "other"));

    for (message = 1; message <= 11; message++) {
        wsprintf(step, "live-%x", message);
        wsprintf(probeResult, "%ld", defaultProc(0x101L, handles[0], (WORD)message, 0L, 0L));
        probe("default", step, probeResult);
    }

    wsprintf(probeResult, "%ld", sendMessage(handles[0], 0x800, 5L, 7L));
    probe("send", "h1", probeResult);
    calls("send-h1");
    wsprintf(probeResult, "%ld", sendMessage(handles[1], 0x801, 1L, 2L));
    probe("send", "h2", probeResult);
    calls("send-h2");

    /* By an alias the probe gives it, with words after the file's name. */
    WritePrivateProfileString("drivers", "probedrv", "drvmsgd.dll some words", "SYSTEM.INI");
    opened("alias", "probedrv", NULL, 0x3333L);
    info("alias", handles[2]);
    opened("alias-section", "probedrv", "drivers", 0x4444L);

    /* An open the driver refuses, while it is loaded. */
    opened("refused", "DRVMSGD.DLL", NULL, 0xdeadL);
    loaded("refused");

    closed("close-h4", handles[3]);
    closed("close-h3", handles[2]);
    closed("close-h2", handles[1]);
    loaded("close-h2");
    walk("one-left", 0);
    closed("close-h1", handles[0]);
    loaded("close-h1");
    walk("after", 0);

    /* An open the driver refuses when it is the first. */
    opened("refused-first", "DRVMSGD.DLL", NULL, 0xdeadL);
    loaded("refused-first");

    /* Nothing by that name. */
    probe("open", "missing", remember(openDriver("NOSUCH.DRV", NULL, 0L)));

    WritePrivateProfileString("drivers", "probedrv", NULL, "SYSTEM.INI");

    for (message = 1; message <= 11; message++) {
        wsprintf(step, "%x", message);
        wsprintf(probeResult, "%ld", defaultProc(0L, 0, (WORD)message, 0L, 0L));
        probe("default", step, probeResult);
    }

    wsprintf(probeResult, "%ld", defaultProc(0L, 0, 0x800, 5L, 7L));
    probe("default", "800", probeResult);

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
