/*
 * Opening a file through MCI, in an installation with no sound driver: as
 * Championship Slots of the corpus opens its sounds, by the file's name
 * alone, the device found by its extension.
 *
 * The probe writes its own files first: waveform files of 64 and of 45
 * samples of silence at 11025 a second, a MIDI file of one empty track, and
 * one of a note held a quarter, 96 ticks at the file's 96 a quarter.
 *
 * * `open`: the case; what opening answered, in hexadecimal, and whether a
 *   device ID came back.
 * * `status`: for an opened device, MCI_STATUS of its length: the answer
 *   and the length, in hexadecimal.
 * * `mode`, `format`: MCI_STATUS of its mode and its time format.
 * * `play`: MCI_PLAY with MCI_WAIT: the answer; `play-nowait` without.
 * * `stop`: MCI_STOP's answer.
 * * `close`: what closing it answered.
 * * `error`: mciGetErrorString for each answer that was not nought.
 */

#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MCIFILE.OUT"

static const BYTE WAVE_HEAD[44] = {
    'R', 'I', 'F', 'F', 36 + 64, 0, 0, 0, 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ',
    16,  0,   0,   0,   1,       0, 1, 0, 0x11, 0x2b, 0, 0, 0x11, 0x2b, 0, 0,
    1,   0,   8,   0,   'd',     'a', 't', 'a', 64, 0, 0, 0,
};

static const BYTE MIDI_FILE[26] = {
    'M', 'T', 'h', 'd', 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    'M', 'T', 'r', 'k', 0, 0, 0, 4, 0, 0xff, 0x2f, 0,
};

static const BYTE MIDI_NOTE[34] = {
    'M', 'T', 'h', 'd', 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    'M', 'T', 'r', 'k', 0, 0, 0, 12, 0, 0x90, 60, 64, 96, 0x80, 60, 64, 0, 0xff, 0x2f, 0,
};

static void write(LPCSTR path, const BYTE FAR *bytes, int count, int silence)
{
    HFILE file = _lcreat(path, 0);
    BYTE quiet[64];
    int i;

    for (i = 0; i < 64; i++) {
        quiet[i] = 0x80;
    }

    _lwrite(file, (LPCSTR)bytes, count);

    /* The waveform header's sizes for the samples that follow. */
    if (silence) {
        BYTE sizes[4];

        sizes[0] = (BYTE)(36 + silence);
        sizes[1] = sizes[2] = sizes[3] = 0;
        _llseek(file, 4, 0);
        _lwrite(file, (LPCSTR)sizes, 4);
        sizes[0] = (BYTE)silence;
        _llseek(file, 40, 0);
        _lwrite(file, (LPCSTR)sizes, 4);
        _llseek(file, 0, 2);
    }

    if (silence) {
        _lwrite(file, (LPCSTR)quiet, silence);
    }

    _lclose(file);
}

static void error(LPCSTR name, DWORD answer)
{
    char text[256];

    if (answer) {
        mciGetErrorString(answer, text, sizeof(text));
        probe("error", name, text);
    }
}

static void file(LPCSTR name, LPCSTR type, LPCSTR element)
{
    MCI_OPEN_PARMS open;
    MCI_STATUS_PARMS status;
    MCI_PLAY_PARMS play;
    MCI_GENERIC_PARMS generic;
    DWORD answer;

    open.dwCallback = 0;
    open.wDeviceID = 0;
    open.lpstrDeviceType = type;
    open.lpstrElementName = element;
    open.lpstrAlias = NULL;
    answer = mciSendCommand(0, MCI_OPEN,
                            MCI_OPEN_ELEMENT | MCI_WAIT | (type ? MCI_OPEN_TYPE : 0),
                            (DWORD)(LPVOID)&open);
    wsprintf(probeResult, "%lx,%s", answer, (LPSTR)(open.wDeviceID ? "id" : "none"));
    probe("open", name, probeResult);
    error(name, answer);

    if (answer) {
        return;
    }

    status.dwCallback = 0;
    status.dwReturn = 0xdeadL;
    status.dwItem = MCI_STATUS_LENGTH;
    answer = mciSendCommand(open.wDeviceID, MCI_STATUS, MCI_STATUS_ITEM, (DWORD)(LPVOID)&status);
    wsprintf(probeResult, "%lx,%lx", answer, status.dwReturn);
    probe("status", name, probeResult);
    error(name, answer);

    status.dwReturn = 0xdeadL;
    status.dwItem = MCI_STATUS_MODE;
    answer = mciSendCommand(open.wDeviceID, MCI_STATUS, MCI_STATUS_ITEM, (DWORD)(LPVOID)&status);
    wsprintf(probeResult, "%lx,%lx", answer, status.dwReturn);
    probe("mode", name, probeResult);

    status.dwReturn = 0xdeadL;
    status.dwItem = MCI_STATUS_TIME_FORMAT;
    answer = mciSendCommand(open.wDeviceID, MCI_STATUS, MCI_STATUS_ITEM, (DWORD)(LPVOID)&status);
    wsprintf(probeResult, "%lx,%lx", answer, status.dwReturn);
    probe("format", name, probeResult);

    play.dwCallback = 0;
    answer = mciSendCommand(open.wDeviceID, MCI_PLAY, MCI_WAIT, (DWORD)(LPVOID)&play);
    wsprintf(probeResult, "%lx", answer);
    probe("play", name, probeResult);
    error(name, answer);

    play.dwCallback = 0;
    answer = mciSendCommand(open.wDeviceID, MCI_PLAY, 0, (DWORD)(LPVOID)&play);
    wsprintf(probeResult, "%lx", answer);
    probe("play-nowait", name, probeResult);

    generic.dwCallback = 0;
    answer = mciSendCommand(open.wDeviceID, MCI_STOP, MCI_WAIT, (DWORD)(LPVOID)&generic);
    wsprintf(probeResult, "%lx", answer);
    probe("stop", name, probeResult);

    generic.dwCallback = 0;
    answer = mciSendCommand(open.wDeviceID, MCI_CLOSE, MCI_WAIT, (DWORD)(LPVOID)&generic);
    wsprintf(probeResult, "%lx", answer);
    probe("close", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    write("C:\\ORACLE\\QUIET.WAV", WAVE_HEAD, sizeof(WAVE_HEAD), 64);
    write("C:\\ORACLE\\EMPTY.MID", MIDI_FILE, sizeof(MIDI_FILE), 0);
    write("C:\\ORACLE\\SHORT.WAV", WAVE_HEAD, sizeof(WAVE_HEAD), 45);
    write("C:\\ORACLE\\NOTE.MID", MIDI_NOTE, sizeof(MIDI_NOTE), 0);

    file("wave", NULL, "C:\\ORACLE\\QUIET.WAV");
    file("wave-typed", "waveaudio", "C:\\ORACLE\\QUIET.WAV");
    file("wave-45", NULL, "C:\\ORACLE\\SHORT.WAV");
    file("midi", NULL, "C:\\ORACLE\\EMPTY.MID");
    file("midi-note", NULL, "C:\\ORACLE\\NOTE.MID");
    file("missing", NULL, "C:\\ORACLE\\MISSING.WAV");
    file("unknown", NULL, "C:\\ORACLE\\QUIET.XYZ");

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
