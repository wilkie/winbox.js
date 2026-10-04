/*
 * The sound calls programs of the corpus make, in an installation with no
 * sound driver: sndPlaySound (Star Trek: The Next Generation war game and
 * FIBS/W), mciSendString (Flak), and SOUND's OpenSound (Tetris for
 * Windows).
 *
 * The probe writes its own waveform file first, 64 samples of silence.
 *
 * * `snd`: the case; what sndPlaySound answered.
 * * `mci`: the command's number, in order, and the command string; what
 *   mciSendString answered, in hex, and the text it gave back, in brackets.
 * * `sound`: the call; what it answered.
 *
 * With a sound card (`--display vgasound`), the sequencer warns that the
 * file may not play correctly with the default MIDI setup, in a box the
 * recorder answers with Enter; each record is on the disk as it is written,
 * for the recorder to see when to.
 */

#define PROBE_FLUSH
#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\SNDPLAY.OUT"

static const BYTE WAVE_HEAD[44] = {
    'R', 'I', 'F', 'F', 36 + 64, 0, 0, 0, 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ',
    16,  0,   0,   0,   1,       0, 1, 0, 0x11, 0x2b, 0, 0, 0x11, 0x2b, 0, 0,
    1,   0,   8,   0,   'd',     'a', 't', 'a', 64, 0, 0, 0,
};

int FAR PASCAL OpenSound(void);
void FAR PASCAL CloseSound(void);
int FAR PASCAL SetVoiceQueueSize(int voice, int bytes);
int FAR PASCAL StartSound(void);
int FAR PASCAL StopSound(void);
int FAR PASCAL SetVoiceNote(int voice, int value, int length, int cdots);
int FAR PASCAL SetVoiceAccent(int voice, int tempo, int volume, int mode, int pitch);
int FAR PASCAL SetVoiceSound(int voice, DWORD frequency, int duration);
int FAR PASCAL SetSoundNoise(int source, int duration);
int FAR PASCAL SetVoiceEnvelope(int voice, int shape, int repeat);
int FAR PASCAL CountVoiceNotes(int voice);
int FAR PASCAL WaitSoundState(int state);
int FAR PASCAL SyncAllVoices(void);
int FAR PASCAL SetVoiceThreshold(int voice, int notes);
int FAR PASCAL GetThresholdStatus(void);

static const BYTE MIDI_NOTE[34] = {
    'M', 'T', 'h', 'd', 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    'M', 'T', 'r', 'k', 0, 0, 0, 12, 0, 0x90, 60, 64, 96, 0x80, 60, 64, 0, 0xff, 0x2f, 0,
};

static void snd(LPCSTR name, LPCSTR sound, UINT flags)
{
    wsprintf(probeResult, "%d", sndPlaySound(sound, flags));
    probe("snd", name, probeResult);
}

static void mci(LPCSTR command)
{
    char text[128];
    DWORD answer;

    static int step;
    char name[160];

    lstrcpy(text, "untouched");
    answer = mciSendString(command, text, sizeof(text), NULL);
    wsprintf(probeResult, "%lx [%s]", answer, (LPSTR)text);
    wsprintf(name, "%d %s", ++step, command);
    probe("mci", name, probeResult);
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    HFILE file;
    BYTE quiet[64];
    int i;
    int voices;

    probeOpen(OUTPUT);

    for (i = 0; i < 64; i++) {
        quiet[i] = 0x80;
    }

    file = _lcreat("C:\\ORACLE\\QUIET.WAV", 0);
    _lwrite(file, (LPCSTR)WAVE_HEAD, sizeof(WAVE_HEAD));
    _lwrite(file, (LPCSTR)quiet, 64);
    _lclose(file);

    file = _lcreat("C:\\ORACLE\\NOTE.MID", 0);
    _lwrite(file, (LPCSTR)MIDI_NOTE, sizeof(MIDI_NOTE));
    _lclose(file);

    snd("file-sync", "C:\\ORACLE\\QUIET.WAV", SND_SYNC);
    snd("file-async", "C:\\ORACLE\\QUIET.WAV", SND_ASYNC);
    snd("missing", "C:\\ORACLE\\MISSING.WAV", SND_SYNC);
    snd("missing-nodefault", "C:\\ORACLE\\MISSING.WAV", SND_SYNC | SND_NODEFAULT);
    snd("system-start", "SystemStart", SND_SYNC);
    snd("null", NULL, 0);

    mci("open C:\\ORACLE\\QUIET.WAV type waveaudio alias quiet");
    mci("status quiet length");
    mci("status quiet mode");
    mci("play quiet wait");
    mci("close quiet");
    mci("open C:\\ORACLE\\QUIET.WAV alias again");
    mci("close again");
    mci("play nothing");
    mci("open C:\\ORACLE\\MISSING.WAV type waveaudio");
    mci("nonsense");
    mci("sysinfo all quantity");
    mci("sysinfo all name 1");
    mci("open C:\\ORACLE\\NOTE.MID type sequencer alias sq");
    mci("status sq length");
    mci("status sq time format");
    mci("status sq position");
    mci("set sq time format milliseconds");
    mci("status sq length");
    mci("status sq time format");
    mci("play sq from 0");
    mci("seek sq to start");
    mci("stop sq");
    mci("status sq ready");
    mci("info sq product");
    mci("status sq bogus");
    mci("open C:\\ORACLE\\NOTE.MID type sequencer alias sq");
    mci("close all");
    mci("close sq");
    mci("");

    voices = OpenSound();
    wsprintf(probeResult, "%d", voices);
    probe("sound", "OpenSound", probeResult);

    if (voices > 0) {
        wsprintf(probeResult, "%d", SetVoiceQueueSize(1, 256));
        probe("sound", "SetVoiceQueueSize", probeResult);
        wsprintf(probeResult, "%d", SetVoiceAccent(1, 120, 64, 0, 0));
        probe("sound", "SetVoiceAccent", probeResult);
        wsprintf(probeResult, "%d", SetVoiceNote(1, 40, 16, 0));
        probe("sound", "SetVoiceNote", probeResult);
        wsprintf(probeResult, "%d", SetVoiceNote(1, 0, 16, 0));
        probe("sound", "SetVoiceNote-rest", probeResult);
        wsprintf(probeResult, "%d", SetVoiceNote(1, 99, 16, 0));
        probe("sound", "SetVoiceNote-bad", probeResult);
        wsprintf(probeResult, "%d", SetVoiceSound(1, 0x01b80000L, 10));
        probe("sound", "SetVoiceSound", probeResult);
        wsprintf(probeResult, "%d", CountVoiceNotes(1));
        probe("sound", "CountVoiceNotes", probeResult);
        wsprintf(probeResult, "%d", SetVoiceNote(2, 40, 16, 0));
        probe("sound", "SetVoiceNote-voice2", probeResult);
        wsprintf(probeResult, "%d", SetSoundNoise(0, 10));
        probe("sound", "SetSoundNoise", probeResult);
        wsprintf(probeResult, "%d", SetVoiceEnvelope(1, 0, 1));
        probe("sound", "SetVoiceEnvelope", probeResult);
        wsprintf(probeResult, "%d", SetVoiceThreshold(1, 1));
        probe("sound", "SetVoiceThreshold", probeResult);
        wsprintf(probeResult, "%d", GetThresholdStatus());
        probe("sound", "GetThresholdStatus", probeResult);
        wsprintf(probeResult, "%d", StartSound());
        probe("sound", "StartSound", probeResult);
        wsprintf(probeResult, "%d", WaitSoundState(0));
        probe("sound", "WaitSoundState", probeResult);
        wsprintf(probeResult, "%d", CountVoiceNotes(1));
        probe("sound", "CountVoiceNotes-after", probeResult);
        wsprintf(probeResult, "%d", SyncAllVoices());
        probe("sound", "SyncAllVoices", probeResult);
        wsprintf(probeResult, "%d", StopSound());
        probe("sound", "StopSound", probeResult);
    }

    CloseSound();
    probe("sound", "CloseSound", "done");

    wsprintf(probeResult, "%d", OpenSound());
    probe("sound", "OpenSound-again", probeResult);
    CloseSound();

    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
