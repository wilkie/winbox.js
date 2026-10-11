/*
 * `SPI_LANGDRIVER`: a language driver loaded, let go of and loaded again,
 * and USER's string functions handed to it while it is loaded.
 *
 * Read out of `USER.EXE`: the action (seg41 `116f`) asks seg3 `1f34`,
 * which lets go of the driver loaded with `FreeLibrary`, keeping its
 * file's name; takes none, or an empty name, as done; else loads the file
 * named with `LoadLibrary` and finds its ordinal 1, and where either fails
 * loads the one before again by its name and answers FALSE. With
 * `SPIF_UPDATEINIFILE`, `SYSTEM.INI`'s `[boot] LANGUAGE.DLL` is written,
 * the name given where a driver is loaded and an empty one where not.
 *
 * The driver is LANGDRVD.DLL (`langdrv.dll.c`), which writes down each
 * call and answers so that each can be told apart. Each `strings` record
 * calls `lstrcmp`, `lstrcmpi`, `AnsiUpper` with a string and with a
 * character, `AnsiLower`, `AnsiUpperBuff`, `AnsiLowerBuff`, `IsCharAlpha`,
 * `IsCharAlphaNumeric`, `IsCharUpper` and `IsCharLower`, giving each one's
 * answer -- for a pointer, its offset less the string's; for an `IsChar`,
 * whether it is true and its low byte -- and the strings afterwards, then
 * what the driver wrote down (`log`). Each `spi` record is the call's
 * answer, whether the driver's module is loaded, and `SYSTEM.INI`'s
 * `[boot] LANGUAGE.DLL` (`<none>` for no key).
 */

#include "probe.h"

#define OUTPUT "C:\\ORACLE\\LANGDRV.OUT"

typedef void(FAR PASCAL *LOGPROC)(LPSTR);

static void strings(LPCSTR name)
{
    char upper[16];
    char lower[16];
    char buffUp[16];
    char buffLow[16];
    char log[600];
    LPSTR answerUp;
    LPSTR answerLow;
    DWORD answerChar;
    HMODULE driver;
    WORD is[4];

    lstrcpy(upper, "abc");
    lstrcpy(lower, "XYZ");
    lstrcpy(buffUp, "def");
    lstrcpy(buffLow, "UVW");

    answerUp = AnsiUpper(upper);
    answerChar = (DWORD)AnsiUpper((LPSTR)MAKELP(0, 'q'));
    answerLow = AnsiLower(lower);

    is[0] = IsCharAlpha('a');
    is[1] = IsCharAlphaNumeric('5');
    is[2] = IsCharUpper('A');
    is[3] = IsCharLower('A');

    /* Each `IsChar` answer as whether it is true, and its low byte: the
     * high byte without a driver is USER's data segment's selector's. */
    wsprintf(probeResult,
             "cmp=%d cmpi=%d up=%d:%s char=%lx low=%d:%s upbuff=%u:%s lowbuff=%u:%s "
             "alpha=%d:%x alnum=%d:%x isup=%d:%x islow=%d:%x",
             lstrcmp("apple", "Bear"), lstrcmpi("apple", "Bear"), (int)(answerUp - upper),
             (LPSTR)upper, answerChar, (int)(answerLow - lower), (LPSTR)lower,
             AnsiUpperBuff(buffUp, 2), (LPSTR)buffUp, AnsiLowerBuff(buffLow, 3), (LPSTR)buffLow,
             is[0] != 0, is[0] & 0xff, is[1] != 0, is[1] & 0xff, is[2] != 0, is[2] & 0xff,
             is[3] != 0, is[3] & 0xff);
    probe("strings", name, probeResult);

    driver = GetModuleHandle("LANGDRVD");

    if (driver) {
        LOGPROC take = (LOGPROC)GetProcAddress(driver, "LANGLOG");

        if (take) {
            take(log);
            probe("log", name, log);
        }
    }
}

static void spi(LPCSTR name, LPCSTR file, UINT ini)
{
    BOOL answer;
    char key[80];

    answer = SystemParametersInfo(SPI_LANGDRIVER, 0, (LPVOID)file, ini);
    GetPrivateProfileString("boot", "LANGUAGE.DLL", "<none>", key, sizeof(key), "SYSTEM.INI");
    wsprintf(probeResult, "%d loaded=%d key=%s", answer, GetModuleHandle("LANGDRVD") != NULL,
             (LPSTR)key);
    wsprintf(probeArgs, "%s,%u", name, ini);
    probe("spi", probeArgs, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);
    SetErrorMode(SEM_NOOPENFILEERRORBOX);

    strings("none");

    spi("null", NULL, 0);
    spi("empty", "", 0);
    spi("missing", "NOSUCH.DLL", 1);
    strings("missing");

    spi("driver", "LANGDRVD.DLL", 0);
    strings("driver");

    spi("missingafter", "NOSUCH.DLL", 0);
    strings("missingafter");

    spi("again", "LANGDRVD.DLL", 3);
    strings("again");

    spi("emptyafter", "", 1);
    strings("emptyafter");

    spi("driverini", "LANGDRVD.DLL", 1);
    spi("nullafter", NULL, 1);
    strings("nullafter");

    WritePrivateProfileString("boot", "LANGUAGE.DLL", "", "SYSTEM.INI");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
