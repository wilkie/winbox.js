/*
 * How long MCI's sequencer, MCISEQ.DRV, takes a MIDI file to be, in each
 * of its time formats, and how long a play of it lasts, on the
 * installation with a sound card (`--display vgasound`), where it plays
 * through the MIDI Mapper. `adlibseq`'s file ends its track half a second
 * after its last note, and Windows gives its length to the last note.
 *
 * The probe writes five files of its own, each at 96 ticks a quarter and
 * 120 a minute, a quarter half a second, with Microsoft's mark first; the
 * notes on channel 1, which the mapper's setup sends nowhere:
 *
 * * `EOT96`: a note from tick 0 to 96, and the end of the track 96 ticks
 *   after it.
 * * `EOT0`: the same, its track ending at the note's end.
 * * `TEXT`: the note, a text event 96 ticks after it, and the end 96 ticks
 *   after that.
 * * `TWO`: two tracks, the first only the mark and the tempo and its end
 *   480 ticks in; the second the note, ending with it.
 * * `ODD`: a note from tick 0 to 95, and the end a tick after.
 *
 * Each opened, its length asked in song pointers, milliseconds, the four
 * SMPTE formats; then some played, waited for, and where they ended asked.
 *
 * * `mci`: the command, and what mciSendString answered, in hex, and the
 *   text it gave back, in brackets.
 * * `took`: how long a play waited for took, by timeGetTime, to the
 *   nearest 100 milliseconds. Not an answer.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\SEQLEN.OUT"

/* The header, then the track's mark and tempo, for each file. */
#define HEADER(format, tracks) \
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, format, 0x00, tracks, 0x00, 0x60
#define TRACK(length) 0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, length
#define MARK_AND_TEMPO \
    0x00, 0xff, 0x7f, 0x03, 0x00, 0x00, 0x41, 0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20

static const BYTE songEot96[] = {
    HEADER(0, 1), TRACK(26), MARK_AND_TEMPO,
    0x00, 0x90, 0x3c, 0x40, 0x60, 0x80, 0x3c, 0x40, 0x60, 0xff, 0x2f, 0x00,
};

static const BYTE songEot0[] = {
    HEADER(0, 1), TRACK(26), MARK_AND_TEMPO,
    0x00, 0x90, 0x3c, 0x40, 0x60, 0x80, 0x3c, 0x40, 0x00, 0xff, 0x2f, 0x00,
};

static const BYTE songText[] = {
    HEADER(0, 1), TRACK(34), MARK_AND_TEMPO,
    0x00, 0x90, 0x3c, 0x40, 0x60, 0x80, 0x3c, 0x40,
    0x60, 0xff, 0x01, 0x04, 0x65, 0x6e, 0x64, 0x2e, 0x60, 0xff, 0x2f, 0x00,
};

static const BYTE songTwo[] = {
    HEADER(1, 2), TRACK(19), MARK_AND_TEMPO, 0x83, 0x60, 0xff, 0x2f, 0x00,
    TRACK(12), 0x00, 0x90, 0x3c, 0x40, 0x60, 0x80, 0x3c, 0x40, 0x00, 0xff, 0x2f, 0x00,
};

static const BYTE songOdd[] = {
    HEADER(0, 1), TRACK(26), MARK_AND_TEMPO,
    0x00, 0x90, 0x3c, 0x40, 0x5f, 0x80, 0x3c, 0x40, 0x01, 0xff, 0x2f, 0x00,
};

static void pump(DWORD ms)
{
    DWORD from = timeGetTime();
    MSG msg;

    while (timeGetTime() - from < ms) {
        while (PeekMessage(&msg, NULL, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }
}

static void mci(LPCSTR command)
{
    char text[128];
    DWORD answer;

    lstrcpy(text, "untouched");
    answer = mciSendString(command, text, sizeof(text), NULL);
    wsprintf(probeResult, "%lx [%s]", answer, (LPSTR)text);
    probe("mci", command, probeResult);
}

/* A play waited for, and how long it took. */
static void played(LPCSTR command)
{
    DWORD from = timeGetTime();

    mci(command);
    wsprintf(probeResult, "%lu", ((timeGetTime() - from) + 50) / 100 * 100);
    probe("took", command, probeResult);
}

static void written(LPCSTR name, const BYTE *bytes, UINT size)
{
    HFILE file = _lcreat(name, 0);

    _lwrite(file, (LPCSTR)bytes, size);
    _lclose(file);
}

/* A file's length in each format; it is left in milliseconds. */
static void lengths(void)
{
    mci("status song length");
    mci("set song time format milliseconds");
    mci("status song length");
    mci("set song time format smpte 24");
    mci("status song length");
    mci("set song time format smpte 25");
    mci("status song length");
    mci("set song time format smpte 30 drop");
    mci("status song length");
    mci("set song time format smpte 30");
    mci("status song length");
    mci("status song position");
    mci("set song time format song pointer");
    mci("status song length");
    mci("set song time format milliseconds");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    written("C:\\ORACLE\\EOT96.MID", songEot96, sizeof(songEot96));
    written("C:\\ORACLE\\EOT0.MID", songEot0, sizeof(songEot0));
    written("C:\\ORACLE\\TEXT.MID", songText, sizeof(songText));
    written("C:\\ORACLE\\TWO.MID", songTwo, sizeof(songTwo));
    written("C:\\ORACLE\\ODD.MID", songOdd, sizeof(songOdd));

    probeNote("a note, and the track's end 96 ticks after it");
    mci("open C:\\ORACLE\\EOT96.MID type sequencer alias song");
    lengths();
    played("play song wait");
    mci("status song position");
    played("play song from 0 to 250 wait");
    mci("status song position");
    mci("set song time format smpte 25");
    mci("status song position");
    mci("set song time format milliseconds");
    mci("seek song to end");
    mci("status song position");
    mci("close song");

    probeNote("the track ending with its note");
    mci("open C:\\ORACLE\\EOT0.MID type sequencer alias song");
    lengths();
    played("play song wait");
    mci("status song position");
    mci("close song");

    probeNote("a text event after the note");
    mci("open C:\\ORACLE\\TEXT.MID type sequencer alias song");
    lengths();
    played("play song from 0 to 1000 wait");
    mci("status song position");
    mci("close song");

    probeNote("two tracks, the first ending last");
    mci("open C:\\ORACLE\\TWO.MID type sequencer alias song");
    lengths();
    played("play song wait");
    mci("status song position");
    mci("close song");

    probeNote("a note of 95 ticks, the end a tick after");
    mci("open C:\\ORACLE\\ODD.MID type sequencer alias song");
    lengths();
    mci("set song time format song pointer");
    mci("seek song to end");
    mci("status song position");
    mci("close song");

    probeFinish();

    return 0;
}
