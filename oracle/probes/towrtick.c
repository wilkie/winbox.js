/*
 * Starts SimTower as `launch` does, and reads its game clock out of its
 * data segment four times a second, as the recorder presses its keys
 * (`record.mjs towrtick --corpus simtower --cycles 80000 --shoot
 * started:10 --then y:30 --then Return:90`).
 *
 * SimTower's clock, as read out of SIMTOWER.EXE (kb/topics/timing.md, "A
 * game that paces itself by its work"): the tick of the day, a word at
 * DGROUP 0b3e2h, 0 to 2,599 (seg65 `01c5`-`01e4`), and the day, a double
 * word at 0b3e4h, counted on at tick 2,300 (seg65 `04ab`-`04c3`). The game
 * is running where the word at 7842h is 1 and the one at 2aah nought
 * (seg76 `024c`-`025a`); the word at 0de38h, 1 from the start (seg38
 * `0551`), lets a tick go by without waiting for 96 ms of GetTickCount
 * (seg65 `01a5`-`01c1`).
 *
 * * `starting`, `started`: as `launch`.
 * * `ticks`: a batch of samples, each `ms:day:tick:running:paused:fast`,
 *   GetTickCount's milliseconds and the words read then, written ten at a
 *   time so as to cost SimTower next to nothing.
 * * `code`: once the tower is running, each code segment of the global
 *   heap, `MODULE:segment:handle:address:size`, for a profile of where the
 *   processor is -- a build of DOSBox that writes CS at each millisecond,
 *   not the oracle's own -- to be told by module.
 *
 * Its records are SimTower's state, kept with the corpus's reports and not
 * committed.
 */

#include "probe.h"
#include <direct.h>
#include <toolhelp.h>

#define OUTPUT "C:\\ORACLE\\TOWRTICK.OUT"
#define SAMPLE_MS 250
#define BATCH 10

static void record(LPCSTR function, LPCSTR args, LPCSTR result)
{
    probe(function, args, result);
    _lclose(probeHandle);
    probeHandle = _lopen(OUTPUT, OF_WRITE);
    _llseek(probeHandle, 0, 2);
}

static UINT tower;
static char batch[1024];
static int samples;

static int mapped;

/* The global heap's code segments, by their module, a few to a record. */
static void map(void)
{
    GLOBALENTRY entry;
    MODULEENTRY module;
    char one[96];
    BOOL more;
    int count = 0;

    batch[0] = '\0';
    entry.dwSize = sizeof(GLOBALENTRY);
    more = GlobalFirst(&entry, GLOBAL_ALL);

    while (more) {
        if (entry.wType == GT_CODE) {
            module.dwSize = sizeof(MODULEENTRY);
            lstrcpy(module.szModule, "?");
            ModuleFindHandle(&module, entry.hOwner);
            wsprintf(one, "%s%s:%u:%04x:%08lx:%lx", (LPSTR)(count ? " " : ""),
                     (LPSTR)module.szModule, entry.wData, (UINT)entry.hBlock, entry.dwAddress,
                     entry.dwBlockSize);
            lstrcat(batch, one);

            if (++count == 8) {
                record("code", "", batch);
                batch[0] = '\0';
                count = 0;
            }
        }

        entry.dwSize = sizeof(GLOBALENTRY);
        more = GlobalNext(&entry, GLOBAL_ALL);
    }

    if (count) {
        record("code", "", batch);
    }

    batch[0] = '\0';
}

static void sample(void)
{
    WORD FAR *words = (WORD FAR *)MAKELP(tower, 0);
    DWORD day = *(DWORD FAR *)MAKELP(tower, 0xb3e4);
    char one[64];

    if (!mapped && words[0x7842 / 2] == 1) {
        mapped = 1;
        samples = 0;
        map();
    }

    wsprintf(one, "%s%lu:%lu:%u:%u:%u:%u", (LPSTR)(samples ? " " : ""), GetTickCount(), day,
             words[0xb3e2 / 2], words[0x7842 / 2], words[0x2aa / 2], words[0xde38 / 2]);
    lstrcat(batch, one);

    if (++samples == BATCH) {
        record("ticks", "", batch);
        batch[0] = '\0';
        samples = 0;
    }
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    char folder[128];
    char path[128];
    char *slash;
    HFILE file;
    int length;
    UINT answer;
    MSG msg;

    probeOpen(OUTPUT);

    file = _lopen("C:\\ORACLE\\LAUNCH.TXT", OF_READ);
    length = file == HFILE_ERROR ? 0 : _lread(file, path, sizeof(path) - 1);

    if (file != HFILE_ERROR) {
        _lclose(file);
    }

    path[length < 0 ? 0 : length] = '\0';
    lstrcpy(folder, path);
    slash = folder + lstrlen(folder);

    while (slash > folder && *slash != '\\') {
        slash--;
    }

    *slash = '\0';
    chdir(folder);

    record("starting", path, "yes");
    answer = WinExec(path, SW_SHOWNORMAL);

    if (answer > 32) {
        /* The instance handle is the handle of the program's DGROUP. */
        tower = SELECTOROF(GlobalLock((HGLOBAL)answer));
        GlobalUnlock((HGLOBAL)answer);
        wsprintf(probeResult, "inst %04x", tower);
    } else {
        wsprintf(probeResult, "%u", answer);
    }

    record("started", path, probeResult);

    if (answer > 32 && SetTimer(NULL, 1, SAMPLE_MS, NULL)) {
        while (GetMessage(&msg, NULL, 0, 0)) {
            if (msg.message == WM_TIMER) {
                sample();
            }

            DispatchMessage(&msg);
        }
    } else {
        while (GetMessage(&msg, NULL, 0, 0)) {
            DispatchMessage(&msg);
        }
    }

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
