/*
 * Shared machinery for oracle probes.
 *
 * A probe is a real Win16 program that calls part of the API with known
 * arguments and writes down what came back. The same binary runs twice: once
 * under genuine Windows 3.1 to record the answers, and once under WinBox.js to
 * see whether we agree. Nothing here is clever, on purpose -- the probe must
 * not be a plausible place for a discrepancy to originate.
 *
 * Output is one record per line:
 *
 *     function <TAB> arguments <TAB> result
 *
 * Tab-separated because none of the three fields can contain a tab, and line
 * oriented so a diff points at the exact call that disagrees.
 *
 * The probe reports through `_lcreat` and `_lwrite`, which means those two
 * KERNEL functions are load-bearing: if they are broken on our side, a probe
 * produces nothing at all rather than producing wrong answers. That is the
 * right failure -- silence is unmistakable, and it is a smaller thing to get
 * right than what is being measured.
 */

#ifndef PROBE_H
#define PROBE_H

#include <windows.h>

/* Scratch space for building the two variable fields of a record. Probes fill
 * these with wsprintf and hand them straight to probe(). */
char probeArgs[512];
char probeResult[512];

static HFILE probeHandle = HFILE_ERROR;

/* Opens the file a probe writes its records to. */
static void probeOpen(LPCSTR path)
{
    probeHandle = _lcreat(path, 0);
}

/* Writes one record. */
static void probe(LPCSTR function, LPCSTR args, LPCSTR result)
{
    char line[1200];
    int length;

    if (probeHandle == HFILE_ERROR) {
        return;
    }

    length = wsprintf(line, "%s\t%s\t%s\r\n", function, args, result);
    _lwrite(probeHandle, line, length);
}

/* Records a note rather than a call: a comment, or a section marker. */
static void probeNote(LPCSTR text)
{
    probe("#", "", text);
}

/*
 * Closes the record file and shuts Windows down.
 *
 * Probes run as the Windows shell so that starting Windows starts the probe
 * and nothing else, with no Program Manager in the way. Exiting the shell is
 * how Windows is told to stop, which returns DOS to the script that launched
 * it -- the whole run is then unattended from `win` to a file on disk.
 */
static void probeFinish(void)
{
    if (probeHandle != HFILE_ERROR) {
        _lclose(probeHandle);
        probeHandle = HFILE_ERROR;
    }

    ExitWindows(0, 0);
}

#endif
