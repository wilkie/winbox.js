/*
 * MCI's string interface given a device's type and its file in one word,
 * `type!file`, as Lode Runner: The Legend Returns opens its music: `open
 * sequencer!C:\...\LRTITLE1.mid alias song`. The probe writes a MIDI file
 * of its own (one note, 96 ticks a quarter, as `seqlen`'s `EOT96`) and opens
 * it so, and in the forms beside it: the file alone, a file that is not
 * there, the type alone before the `!`, nothing before it, a type there is
 * none of, the file named relative to the current folder, and `type` given
 * as well. Each open is asked its length, and closed.
 *
 * * `mci`: the command, and what mciSendString answered, in hex, and the
 *   text it gave back, in brackets.
 * * `wave`: the same, for the file opened on the `waveaudio` type, which
 *   its driver answers.
 * * `unopened`: the same, for a command naming `type!file` that is not a
 *   device the task has open, which mciSendString opens itself.
 */

#define PROBE_FLUSH
#include "probe.h"
#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MCIBANG.OUT"

static const BYTE song[] = {
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x00, 0x60,
    0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 26,
    0x00, 0xff, 0x7f, 0x03, 0x00, 0x00, 0x41, 0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x00, 0x90, 0x3c, 0x40, 0x60, 0x80, 0x3c, 0x40, 0x60, 0xff, 0x2f, 0x00,
};

static void asking(LPCSTR function, LPCSTR command)
{
    char text[128];
    DWORD answer;

    lstrcpy(text, "untouched");
    answer = mciSendString(command, text, sizeof(text), NULL);
    wsprintf(probeResult, "%lx [%s]", answer, (LPSTR)text);
    probe(function, command, probeResult);
}

static void mci(LPCSTR command)
{
    asking("mci", command);
}

/* What the open made, if it made one, and closed. */
static void asked(void)
{
    mci("status song length");
    mci("close song");
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HFILE file;

    probeOpen(OUTPUT);

    file = _lcreat("C:\\ORACLE\\BANG.MID", 0);
    _lwrite(file, (LPCSTR)song, sizeof(song));
    _lclose(file);

    probeNote("the type and the file in one word, as Lode Runner opens its music");
    mci("open sequencer!C:\\ORACLE\\BANG.mid alias song");
    asked();

    probeNote("the file alone");
    mci("open C:\\ORACLE\\BANG.MID alias song");
    asked();

    probeNote("a file that is not there");
    mci("open sequencer!C:\\ORACLE\\NONE.MID alias song");
    asked();

    probeNote("the type alone before the mark");
    mci("open sequencer! alias song");
    asked();

    probeNote("nothing before the mark");
    mci("open !C:\\ORACLE\\BANG.MID alias song");
    asked();

    probeNote("a type there is none of");
    mci("open nothing!C:\\ORACLE\\BANG.MID alias song");
    asked();

    probeNote("the waveaudio type given a MIDI file");
    asking("wave", "open waveaudio!C:\\ORACLE\\BANG.MID alias song");
    asking("wave", "status song length");
    asking("wave", "close song");

    probeNote("the file relative to the current folder");
    mci("open sequencer!BANG.MID alias song");
    asked();

    probeNote("with type as well");
    mci("open sequencer!C:\\ORACLE\\BANG.MID type sequencer alias song");
    asked();

    probeNote("no alias");
    mci("open sequencer!C:\\ORACLE\\BANG.MID");
    asking("unopened", "status sequencer!C:\\ORACLE\\BANG.MID length");
    mci("status C:\\ORACLE\\BANG.MID length");
    mci("close all");

    probeFinish();

    return 0;
}
