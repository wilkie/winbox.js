/*
 * MMSYSTEM's buffered file I/O, the mmio functions: opening, reading,
 * writing, seeking, the buffer and its pointers, RIFF chunks, memory files,
 * an I/O procedure of the probe's own, and the errors.
 *
 * * `fourcc`: mmioStringToFOURCC of a string and flags: the code's four
 *   bytes, printed as characters with a byte under 20h as `.`, and in
 *   hexadecimal.
 * * `proc`: mmioInstallIOProc: what came back, as `0`, `mem` (the procedure
 *   found for `MEM `), `own` (the probe's) or `other`.
 * * `open`: mmioOpen: `0` for no handle, `1` for TRUE, `h` for a handle;
 *   and the structure's wErrorRet where one was given.
 * * `info`: mmioGetInfo after a call: dwFlags, fccIOProc, which procedure,
 *   wErrorRet, whether htask is nought, cchBuffer, whether there is a
 *   buffer and the offsets of pchNext, pchEndRead and pchEndWrite from it,
 *   lBufOffset, lDiskOffset, adwInfo[0], and whether hmmio is the handle.
 * * `ck`: an MMCKINFO after a call: the answer, ckid, cksize, fccType,
 *   dwDataOffset, dwFlags.
 * * `read`, `write`, `seek`, `close`, `flush`, `advance`, `setbuffer`,
 *   `setinfo`, `getinfo`, `send`, `rename`: the answer, in hexadecimal.
 * * `bytes`: a file's bytes as the disk has them, in hexadecimal.
 * * `msg`: each message the probe's own procedure was sent: the message,
 *   its two parameters as the procedure reads them, lDiskOffset as it
 *   finds it, and whether the structure it is given is at the handle.
 */

#include "probe.h"

#include <mmsystem.h>

#define OUTPUT "C:\\ORACLE\\MMIO.OUT"
#define WAVE "C:\\ORACLE\\MMIO.WAV"
#define SMALL "C:\\ORACLE\\SMALL.DAT"
#define POKED "C:\\ORACLE\\POKED.DAT"

static LPMMIOPROC memProc;
static LPMMIOPROC ownProc;

/* The probe's procedure's own file: 64 bytes and how many are in it. */
static char ownStore[64];
static long ownSize;

static void hex(LPSTR out, const BYTE FAR *bytes, int count)
{
    int i;

    for (i = 0; i < count; i++) {
        wsprintf(out + i * 2, "%02x", bytes[i]);
    }

    out[count * 2] = '\0';
}

static void fcc(LPSTR out, FOURCC code)
{
    int i;

    for (i = 0; i < 4; i++) {
        BYTE c = (BYTE)(code >> (8 * i));

        out[i] = (char)(c < 0x20 ? '.' : c);
    }

    out[4] = '\0';
}

static LPCSTR procName(LPMMIOPROC proc)
{
    if (!proc) {
        return "0";
    }

    if (proc == memProc) {
        return "mem";
    }

    if (proc == ownProc) {
        return "own";
    }

    return "other";
}

/* A pointer's offset from the buffer's, or `x` for one in another segment. */
static void offset(LPSTR out, HPSTR buffer, HPSTR at)
{
    if (SELECTOROF(at) != SELECTOROF(buffer)) {
        lstrcpy(out, "x");
    } else {
        wsprintf(out, "%x", OFFSETOF(at) - OFFSETOF(buffer));
    }
}

static void dump(LPCSTR name, HMMIO h)
{
    MMIOINFO info;
    UINT answer;
    char code[5];
    char next[8], endRead[8], endWrite[8];

    _fmemset(&info, 0xcc, sizeof(info));
    answer = mmioGetInfo(h, &info, 0);

    if (answer) {
        wsprintf(probeResult, "%x", answer);
        probe("info", name, probeResult);
        return;
    }

    fcc(code, info.fccIOProc);

    if (info.pchBuffer) {
        offset(next, info.pchBuffer, info.pchNext);
        offset(endRead, info.pchBuffer, info.pchEndRead);
        offset(endWrite, info.pchBuffer, info.pchEndWrite);
    } else {
        wsprintf(next, "%lx", (DWORD)info.pchNext);
        wsprintf(endRead, "%lx", (DWORD)info.pchEndRead);
        wsprintf(endWrite, "%lx", (DWORD)info.pchEndWrite);
    }

    wsprintf(probeResult,
             "flags=%lx fcc=%s proc=%s err=%x task=%s cch=%lx buf=%s/%x next=%s endread=%s "
             "endwrite=%s bufoff=%lx disk=%lx a0=%lx a1=%lx a2=%lx r=%lx,%lx h=%s",
             info.dwFlags, (LPSTR)code, (LPSTR)procName(info.pIOProc), info.wErrorRet,
             (LPSTR)(info.htask ? "set" : "0"), info.cchBuffer,
             (LPSTR)(info.pchBuffer ? "buf" : "0"), info.pchBuffer ? OFFSETOF(info.pchBuffer) : 0,
             (LPSTR)next, (LPSTR)endRead, (LPSTR)endWrite, info.lBufOffset, info.lDiskOffset,
             info.adwInfo[0], info.adwInfo[1], info.adwInfo[2], info.dwReserved1,
             info.dwReserved2, (LPSTR)(info.hmmio == h ? "same" : "other"));
    probe("info", name, probeResult);
}

static void chunk(LPCSTR name, UINT answer, const MMCKINFO FAR *ck)
{
    char id[5], type[5];

    fcc(id, ck->ckid);
    fcc(type, ck->fccType);
    wsprintf(probeResult, "%x id=%s size=%lx type=%s data=%lx flags=%lx", answer, (LPSTR)id,
             ck->cksize, (LPSTR)type, ck->dwDataOffset, ck->dwFlags);
    probe("ck", name, probeResult);
}

static void answer(LPCSTR function, LPCSTR name, DWORD value)
{
    wsprintf(probeResult, "%lx", value);
    probe(function, name, probeResult);
}

static void opened(LPCSTR name, HMMIO h, const MMIOINFO FAR *info)
{
    if (info) {
        wsprintf(probeResult, "%s,%x", (LPSTR)(h == 0 ? "0" : h == (HMMIO)1 ? "1" : "h"),
                 info->wErrorRet);
    } else {
        wsprintf(probeResult, "%s", (LPSTR)(h == 0 ? "0" : h == (HMMIO)1 ? "1" : "h"));
    }

    probe("open", name, probeResult);
}

/* A file's bytes as the disk has them, 32 to a record. */
static void bytes(LPCSTR name, LPCSTR path)
{
    BYTE data[256];
    HFILE file = _lopen(path, OF_READ);
    int count, at;

    if (file == HFILE_ERROR) {
        probe("bytes", name, "none");
        return;
    }

    count = _lread(file, data, sizeof(data));
    _lclose(file);

    for (at = 0; at < count; at += 32) {
        int n = count - at < 32 ? count - at : 32;

        wsprintf(probeArgs, "%s@%x", (LPSTR)name, at);
        hex(probeResult, data + at, n);
        probe("bytes", probeArgs, probeResult);
    }

    if (count == 0) {
        probe("bytes", name, "empty");
    }
}

static void readAnswer(LPCSTR name, HMMIO h, long count)
{
    BYTE data[80];
    long got;

    _fmemset(data, 0xee, sizeof(data));
    got = mmioRead(h, (HPSTR)data, count);
    wsprintf(probeResult, "%lx ", got);
    hex(probeResult + lstrlen(probeResult), data, (int)(count < 40 ? count : 40));
    probe("read", name, probeResult);
}

LRESULT FAR PASCAL _export OwnIOProc(LPSTR lpmmioinfo, UINT msg, LPARAM lParam1, LPARAM lParam2)
{
    LPMMIOINFO info = (LPMMIOINFO)lpmmioinfo;
    char text[128];
    LRESULT result = 0;
    long n;

    wsprintf(probeArgs, "%x", msg);

    switch (msg) {
    case MMIOM_OPEN:
    case MMIOM_RENAME:
        wsprintf(text, "%s|%s", lParam1 ? (LPSTR)lParam1 : (LPSTR)"(null)",
                 (msg == MMIOM_RENAME && lParam2) ? (LPSTR)lParam2 : (LPSTR)"");
        wsprintf(probeResult, "%s disk=%lx flags=%lx at=%s", (LPSTR)text, info->lDiskOffset,
                 info->dwFlags, (LPSTR)(OFFSETOF(info) == (UINT)info->hmmio ? "h" : "x"));
        break;

    case MMIOM_READ:
    case MMIOM_WRITE:
    case MMIOM_WRITEFLUSH:
        /* The pointer as where it is: in MMSYSTEM's buffer, or the caller's. */
        if (info->pchBuffer && SELECTOROF(lParam1) == SELECTOROF(info->pchBuffer)) {
            wsprintf(text, "buf+%x", OFFSETOF(lParam1) - OFFSETOF(info->pchBuffer));
        } else {
            lstrcpy(text, "user");
        }

        wsprintf(probeResult, "%s %lx disk=%lx flags=%lx at=%s", (LPSTR)text, lParam2,
                 info->lDiskOffset, info->dwFlags,
                 (LPSTR)(OFFSETOF(info) == (UINT)info->hmmio ? "h" : "x"));
        break;

    default:
        wsprintf(probeResult, "%lx %lx disk=%lx flags=%lx at=%s", lParam1, lParam2,
                 info->lDiskOffset, info->dwFlags,
                 (LPSTR)(OFFSETOF(info) == (UINT)info->hmmio ? "h" : "x"));
        break;
    }

    probe("msg", probeArgs, probeResult);

    switch (msg) {
    case MMIOM_OPEN:
        info->lDiskOffset = 0;
        info->adwInfo[1] = 0x5150;
        break;

    case MMIOM_READ:
        n = lParam2;

        if (info->lDiskOffset + n > ownSize) {
            n = ownSize - info->lDiskOffset;
        }

        if (n < 0) {
            n = 0;
        }

        _fmemcpy((LPSTR)lParam1, ownStore + info->lDiskOffset, (int)n);
        info->lDiskOffset += n;
        result = n;
        break;

    case MMIOM_WRITE:
    case MMIOM_WRITEFLUSH:
        n = lParam2;

        if (info->lDiskOffset + n > sizeof(ownStore)) {
            n = sizeof(ownStore) - info->lDiskOffset;
        }

        _fmemcpy(ownStore + info->lDiskOffset, (LPSTR)lParam1, (int)n);
        info->lDiskOffset += n;

        if (info->lDiskOffset > ownSize) {
            ownSize = info->lDiskOffset;
        }

        result = n;
        break;

    case MMIOM_SEEK:
        if (lParam2 == SEEK_SET) {
            info->lDiskOffset = lParam1;
        } else if (lParam2 == SEEK_CUR) {
            info->lDiskOffset += lParam1;
        } else {
            info->lDiskOffset = ownSize + lParam1;
        }

        result = info->lDiskOffset;
        break;

    case MMIOM_CLOSE:
    case MMIOM_RENAME:
        result = 0;
        break;

    default:
        result = 0x12340000L + lParam1;
        break;
    }

    return result;
}

static void fourccs(void)
{
    static char shortText[] = "ab\0cd";
    static char emptyText[] = "\0xyz";
    char code[5];
    FOURCC value;

    value = mmioStringToFOURCC("wave", 0);
    fcc(code, value);
    wsprintf(probeResult, "%s %lx", (LPSTR)code, value);
    probe("fourcc", "wave,0", probeResult);

    value = mmioStringToFOURCC("wave", MMIO_TOUPPER);
    fcc(code, value);
    wsprintf(probeResult, "%s %lx", (LPSTR)code, value);
    probe("fourcc", "wave,upper", probeResult);

    value = mmioStringToFOURCC("Fm1", MMIO_TOUPPER);
    fcc(code, value);
    wsprintf(probeResult, "%s %lx", (LPSTR)code, value);
    probe("fourcc", "Fm1,upper", probeResult);

    value = mmioStringToFOURCC(shortText, 0);
    fcc(code, value);
    wsprintf(probeResult, "%s %lx", (LPSTR)code, value);
    probe("fourcc", "ab-nul-cd,0", probeResult);

    value = mmioStringToFOURCC(emptyText, 0);
    fcc(code, value);
    wsprintf(probeResult, "%s %lx", (LPSTR)code, value);
    probe("fourcc", "nul-xyz,0", probeResult);

    value = mmioStringToFOURCC("abcdef", 0);
    fcc(code, value);
    wsprintf(probeResult, "%s %lx", (LPSTR)code, value);
    probe("fourcc", "abcdef,0", probeResult);

    value = mmioStringToFOURCC("wave", 1);
    wsprintf(probeResult, "%lx", value);
    probe("fourcc", "wave,1", probeResult);

    value = mmioStringToFOURCC("wave", 0x30);
    wsprintf(probeResult, "%lx", value);
    probe("fourcc", "wave,30", probeResult);
}

static void procs(void)
{
    LPMMIOPROC found;

    memProc = mmioInstallIOProc(FOURCC_MEM, NULL, MMIO_FINDPROC);
    probe("proc", "find-mem", memProc ? "set" : "0");

    found = mmioInstallIOProc(FOURCC_DOS, NULL, MMIO_FINDPROC);
    probe("proc", "find-dos", procName(found));

    found = mmioInstallIOProc(FOURCC_MEM, NULL, MMIO_REMOVEPROC);
    probe("proc", "remove-mem", procName(found));

    found = mmioInstallIOProc(FOURCC_MEM, NULL, MMIO_FINDPROC);
    probe("proc", "find-mem-again", procName(found));

    found = mmioInstallIOProc(mmioFOURCC('X', 'Y', 'Z', ' '), ownProc, MMIO_INSTALLPROC | 8);
    probe("proc", "install-badflag", procName(found));

    found = mmioInstallIOProc(0, ownProc, MMIO_INSTALLPROC);
    probe("proc", "install-nofcc", procName(found));

    found = mmioInstallIOProc(mmioFOURCC('X', 'Y', 'Z', ' '), NULL, MMIO_FINDPROC);
    probe("proc", "find-xyz-none", procName(found));

    found = mmioInstallIOProc(mmioFOURCC('X', 'Y', 'Z', ' '), ownProc, MMIO_FINDPROC);
    probe("proc", "find-with-proc", procName(found));

    found = mmioInstallIOProc(mmioFOURCC('X', 'Y', 'Z', ' '), ownProc, 0);
    probe("proc", "no-action", procName(found));

    found = mmioInstallIOProc(mmioFOURCC('G', 'L', 'B', ' '), ownProc,
                              MMIO_INSTALLPROC | MMIO_GLOBALPROC);
    probe("proc", "install-global", procName(found));

    found = mmioInstallIOProc(mmioFOURCC('G', 'L', 'B', ' '), NULL, MMIO_FINDPROC);
    probe("proc", "find-global", procName(found));

    found = mmioInstallIOProc(mmioFOURCC('G', 'L', 'B', ' '), NULL, MMIO_REMOVEPROC);
    probe("proc", "remove-global", procName(found));

    found = mmioInstallIOProc(mmioFOURCC('G', 'L', 'B', ' '), NULL, MMIO_FINDPROC);
    probe("proc", "find-global-gone", procName(found));
}

static void badHandles(void)
{
    MMIOINFO info;
    MMCKINFO ck;
    char data[8];

    answer("close", "nohandle", mmioClose(0, 0));
    answer("read", "nohandle", mmioRead(0, data, 4));
    answer("write", "nohandle", mmioWrite(0, data, 4));
    answer("seek", "nohandle", mmioSeek(0, 0, SEEK_SET));
    answer("getinfo", "nohandle", mmioGetInfo(0, &info, 0));
    answer("setbuffer", "nohandle", mmioSetBuffer(0, NULL, 0, 0));
    answer("flush", "nohandle", mmioFlush(0, 0));
    answer("advance", "nohandle", mmioAdvance(0, NULL, 0));
    answer("send", "nohandle", mmioSendMessage(0, MMIOM_USER, 0, 0));

    _fmemset(&ck, 0, sizeof(ck));
    chunk("descend-nohandle", mmioDescend(0, &ck, NULL, 0), &ck);
    _fmemset(&ck, 0, sizeof(ck));
    chunk("ascend-nohandle", mmioAscend(0, &ck, 0), &ck);
    _fmemset(&ck, 0, sizeof(ck));
    chunk("create-nohandle", mmioCreateChunk(0, &ck, 0), &ck);
}

static void missing(void)
{
    MMIOINFO info;
    HMMIO h;

    _fmemset(&info, 0, sizeof(info));
    info.wErrorRet = 0x1234;
    h = mmioOpen("C:\\ORACLE\\NOPE.WAV", &info, MMIO_READ);
    opened("missing", h, &info);

    h = mmioOpen("C:\\ORACLE\\NOPE.WAV", NULL, MMIO_READ);
    opened("missing-noinfo", h, NULL);

    _fmemset(&info, 0, sizeof(info));
    info.wErrorRet = 0x1234;
    h = mmioOpen("C:\\NODIR\\NOPE.WAV", &info, MMIO_READ);
    opened("missing-dir", h, &info);

    _fmemset(&info, 0, sizeof(info));
    info.wErrorRet = 0x1234;
    h = mmioOpen(WAVE, &info, 0x80000L);
    opened("badflags", h, &info);
}

static void writeWave(void)
{
    static const BYTE FORMAT[16] = {1, 0, 1, 0, 0x11, 0x2b, 0, 0, 0x11, 0x2b, 0, 0, 1, 0, 8, 0};
    MMCKINFO riff, fmt, data, list, comment;
    HMMIO h;

    h = mmioOpen(WAVE, NULL, MMIO_CREATE | MMIO_WRITE | MMIO_ALLOCBUF);
    opened("create", h, NULL);
    dump("create", h);

    _fmemset(&riff, 0, sizeof(riff));
    riff.fccType = mmioFOURCC('W', 'A', 'V', 'E');
    riff.cksize = 0x1111;
    chunk("riff", mmioCreateChunk(h, &riff, MMIO_CREATERIFF), &riff);
    dump("riff", h);

    _fmemset(&fmt, 0, sizeof(fmt));
    fmt.ckid = mmioFOURCC('f', 'm', 't', ' ');
    fmt.cksize = 16;
    chunk("fmt", mmioCreateChunk(h, &fmt, 0), &fmt);
    answer("write", "fmt", mmioWrite(h, (HPSTR)FORMAT, 16));
    chunk("fmt-ascend", mmioAscend(h, &fmt, 0), &fmt);
    dump("fmt", h);

    _fmemset(&data, 0, sizeof(data));
    data.ckid = mmioFOURCC('d', 'a', 't', 'a');
    chunk("data", mmioCreateChunk(h, &data, 0), &data);
    answer("write", "data", mmioWrite(h, "\x80\x81\x82", 3));
    dump("data", h);
    chunk("data-ascend", mmioAscend(h, &data, 0), &data);
    dump("data-ascend", h);

    _fmemset(&list, 0, sizeof(list));
    list.fccType = mmioFOURCC('I', 'N', 'F', 'O');
    chunk("list", mmioCreateChunk(h, &list, MMIO_CREATELIST), &list);

    _fmemset(&comment, 0, sizeof(comment));
    comment.ckid = mmioFOURCC('I', 'C', 'M', 'T');
    comment.cksize = 5;
    chunk("icmt", mmioCreateChunk(h, &comment, 0), &comment);
    answer("write", "icmt", mmioWrite(h, "odd!", 5));
    chunk("icmt-ascend", mmioAscend(h, &comment, 0), &comment);
    chunk("list-ascend", mmioAscend(h, &list, 0), &list);
    chunk("riff-ascend", mmioAscend(h, &riff, 0), &riff);
    dump("riff-ascend", h);

    chunk("create-badflag", mmioCreateChunk(h, &comment, MMIO_FINDCHUNK), &comment);
    chunk("ascend-badflag", mmioAscend(h, &comment, 1), &comment);
    chunk("descend-badflag", mmioDescend(h, &comment, NULL, 0x80), &comment);

    answer("seek", "cur", mmioSeek(h, 0, SEEK_CUR));
    answer("seek", "end0", mmioSeek(h, 0, SEEK_END));
    dump("seek-end0", h);
    answer("seek", "end4", mmioSeek(h, 4, SEEK_END));
    answer("seek", "end-4", mmioSeek(h, -4, SEEK_END));
    answer("seek", "set0", mmioSeek(h, 0, SEEK_SET));
    answer("seek", "origin3", mmioSeek(h, 0, 3));
    dump("seek-set0", h);

    answer("close", "create", mmioClose(h, 0));
    bytes("wave", WAVE);
}

static void readWave(void)
{
    MMCKINFO riff, fmt, data, list, comment, ck;
    HMMIO h;

    h = mmioOpen(WAVE, NULL, MMIO_READ | MMIO_ALLOCBUF);
    opened("read", h, NULL);
    dump("read", h);

    _fmemset(&riff, 0, sizeof(riff));
    riff.fccType = mmioFOURCC('W', 'A', 'V', 'E');
    chunk("find-riff", mmioDescend(h, &riff, NULL, MMIO_FINDRIFF), &riff);
    dump("find-riff", h);

    _fmemset(&fmt, 0, sizeof(fmt));
    fmt.ckid = mmioFOURCC('f', 'm', 't', ' ');
    chunk("find-fmt", mmioDescend(h, &fmt, &riff, MMIO_FINDCHUNK), &fmt);
    readAnswer("fmt", h, 16);
    chunk("fmt-ascend", mmioAscend(h, &fmt, 0), &fmt);

    _fmemset(&data, 0, sizeof(data));
    data.ckid = mmioFOURCC('d', 'a', 't', 'a');
    chunk("find-data", mmioDescend(h, &data, &riff, MMIO_FINDCHUNK), &data);
    readAnswer("data", h, 10);
    dump("data-read", h);
    chunk("data-ascend", mmioAscend(h, &data, 0), &data);
    answer("seek", "after-data", mmioSeek(h, 0, SEEK_CUR));

    _fmemset(&list, 0, sizeof(list));
    list.fccType = mmioFOURCC('I', 'N', 'F', 'O');
    chunk("find-list", mmioDescend(h, &list, &riff, MMIO_FINDLIST), &list);

    _fmemset(&comment, 0, sizeof(comment));
    chunk("any", mmioDescend(h, &comment, &list, 0), &comment);
    readAnswer("icmt", h, 5);
    chunk("icmt-ascend", mmioAscend(h, &comment, 0), &comment);
    chunk("list-ascend", mmioAscend(h, &list, 0), &list);

    _fmemset(&ck, 0, sizeof(ck));
    chunk("past-parent", mmioDescend(h, &ck, &riff, 0), &ck);

    answer("seek", "to-12", mmioSeek(h, 12, SEEK_SET));
    _fmemset(&ck, 0, sizeof(ck));
    ck.ckid = mmioFOURCC('z', 'z', 'z', 'z');
    chunk("find-zzzz", mmioDescend(h, &ck, &riff, MMIO_FINDCHUNK), &ck);
    answer("seek", "after-zzzz", mmioSeek(h, 0, SEEK_CUR));

    answer("seek", "to-0", mmioSeek(h, 0, SEEK_SET));
    _fmemset(&ck, 0, sizeof(ck));
    ck.fccType = mmioFOURCC('A', 'V', 'I', ' ');
    chunk("find-avi", mmioDescend(h, &ck, NULL, MMIO_FINDRIFF), &ck);

    answer("seek", "to-0b", mmioSeek(h, 0, SEEK_SET));
    _fmemset(&ck, 0, sizeof(ck));
    chunk("top", mmioDescend(h, &ck, NULL, 0), &ck);
    answer("seek", "after-top", mmioSeek(h, 0, SEEK_CUR));

    answer("close", "read", mmioClose(h, 0));
}

static void smallBuffer(void)
{
    MMIOINFO info;
    HMMIO h;
    UINT r;
    int i;

    _fmemset(&info, 0, sizeof(info));
    info.cchBuffer = 16;
    h = mmioOpen(WAVE, &info, MMIO_READ);
    opened("small", h, &info);
    dump("small-open", h);
    readAnswer("small-5", h, 5);
    dump("small-5", h);
    readAnswer("small-20", h, 20);
    dump("small-20", h);
    answer("seek", "small-3", mmioSeek(h, 3, SEEK_SET));
    dump("small-seek3", h);
    answer("seek", "small-40", mmioSeek(h, 40, SEEK_SET));
    dump("small-seek40", h);
    readAnswer("small-4", h, 4);
    dump("small-4", h);
    answer("seek", "small-cur", mmioSeek(h, 0, SEEK_CUR));
    answer("seek", "small-end", mmioSeek(h, 0, SEEK_END));
    dump("small-end", h);
    readAnswer("small-eof", h, 4);
    dump("small-eof", h);
    answer("seek", "small-neg", mmioSeek(h, -3, SEEK_SET));
    dump("small-neg", h);
    answer("close", "small", mmioClose(h, 0));

    /* Advancing through the file, each buffer used up by the probe. */
    _fmemset(&info, 0, sizeof(info));
    info.cchBuffer = 16;
    h = mmioOpen(WAVE, &info, MMIO_READ);
    mmioGetInfo(h, &info, 0);

    for (i = 0; i < 8; i++) {
        char next[8], endRead[8];

        r = mmioAdvance(h, &info, MMIO_READ);
        offset(next, info.pchBuffer, info.pchNext);
        offset(endRead, info.pchBuffer, info.pchEndRead);
        wsprintf(probeArgs, "advance-%d", i);
        wsprintf(probeResult, "%x next=%s endread=%s bufoff=%lx disk=%lx first=%02x", r,
                 (LPSTR)next, (LPSTR)endRead, info.lBufOffset, info.lDiskOffset,
                 (BYTE)*info.pchNext);
        probe("advance", probeArgs, probeResult);

        if (info.pchNext == info.pchEndRead) {
            break;
        }

        info.pchNext = info.pchEndRead;
    }

    answer("setinfo", "advanced", mmioSetInfo(h, &info, 0));
    dump("advanced", h);
    answer("advance", "badflag", mmioAdvance(h, NULL, 2));
    answer("advance", "noinfo", mmioAdvance(h, NULL, MMIO_READ));
    dump("advance-noinfo", h);
    answer("getinfo", "badflag", mmioGetInfo(h, &info, 1));
    answer("setinfo", "badflag", mmioSetInfo(h, &info, 1));
    answer("flush", "badflag", mmioFlush(h, 1));
    answer("setbuffer", "badflag", mmioSetBuffer(h, NULL, 16, 1));
    answer("close", "advanced", mmioClose(h, 0));

    /* No buffer at all. */
    h = mmioOpen(WAVE, NULL, MMIO_READ);
    opened("unbuffered", h, NULL);
    dump("unbuffered", h);
    answer("advance", "unbuffered", mmioAdvance(h, NULL, MMIO_READ));
    readAnswer("unbuffered-5", h, 5);
    dump("unbuffered-5", h);
    answer("seek", "unbuffered-2", mmioSeek(h, 2, SEEK_CUR));
    dump("unbuffered-seek", h);
    answer("setbuffer", "unbuffered-8", mmioSetBuffer(h, NULL, 8, 0));
    dump("unbuffered-setbuffer", h);
    readAnswer("unbuffered-3", h, 3);
    dump("unbuffered-3", h);
    answer("setbuffer", "unbuffered-32", mmioSetBuffer(h, NULL, 32, 0));
    dump("unbuffered-setbuffer32", h);
    answer("setbuffer", "unbuffered-0", mmioSetBuffer(h, NULL, 0, 0));
    dump("unbuffered-setbuffer0", h);
    answer("close", "unbuffered", mmioClose(h, 0));

    /* A buffer of the allocated kind made larger and smaller with data in it. */
    h = mmioOpen(WAVE, NULL, MMIO_READ | MMIO_ALLOCBUF);
    readAnswer("alloc-6", h, 6);
    dump("alloc-6", h);
    answer("setbuffer", "alloc-4", mmioSetBuffer(h, NULL, 4, 0));
    dump("alloc-4", h);
    answer("setbuffer", "alloc-64", mmioSetBuffer(h, NULL, 64, 0));
    dump("alloc-64", h);
    readAnswer("alloc-more", h, 3);
    dump("alloc-more", h);
    answer("close", "alloc", mmioClose(h, 0));

    _fmemset(&info, 0, sizeof(info));
    info.cchBuffer = 100;
    h = mmioOpen(WAVE, &info, MMIO_READ | MMIO_ALLOCBUF);
    dump("alloc-100", h);
    answer("close", "alloc-100", mmioClose(h, 0));
}

static void poked(void)
{
    static char own[16];
    MMIOINFO info;
    HMMIO h;
    int i;

    _fmemset(&info, 0, sizeof(info));
    info.cchBuffer = 8;
    h = mmioOpen(POKED, &info, MMIO_CREATE | MMIO_WRITE);
    opened("poked", h, &info);
    mmioGetInfo(h, &info, 0);

    for (i = 0; i < 8; i++) {
        info.pchNext[i] = (char)('A' + i);
    }

    info.pchNext += 8;
    info.dwFlags |= MMIO_DIRTY;
    answer("advance", "poked-1", mmioAdvance(h, &info, MMIO_WRITE));
    dump("poked-1", h);
    info.pchNext[0] = 'I';
    info.pchNext[1] = 'J';
    info.pchNext += 2;
    answer("advance", "poked-clean", mmioAdvance(h, &info, MMIO_WRITE));
    dump("poked-clean", h);
    answer("seek", "poked-reseek", mmioSeek(h, 8, SEEK_SET));
    mmioGetInfo(h, &info, 0);
    info.pchNext[0] = 'K';
    info.pchNext[1] = 'L';
    info.pchNext += 2;
    info.dwFlags |= MMIO_DIRTY;
    answer("setinfo", "poked", mmioSetInfo(h, &info, 0));
    dump("poked-setinfo", h);
    answer("flush", "poked", mmioFlush(h, 0));
    dump("poked-flush", h);
    answer("write", "poked", mmioWrite(h, "mnop", 4));
    answer("seek", "poked-back", mmioSeek(h, -3, SEEK_CUR));
    dump("poked-back", h);
    answer("write", "poked-over", mmioWrite(h, "Z", 1));
    dump("poked-over", h);
    answer("write", "poked-long", mmioWrite(h, "0123456789ab", 12));
    dump("poked-long", h);
    answer("flush", "poked-empty", mmioFlush(h, MMIO_EMPTYBUF));
    dump("poked-empty", h);
    answer("setbuffer", "poked-own", mmioSetBuffer(h, own, sizeof(own), 0));
    dump("poked-own", h);
    answer("write", "poked-own", mmioWrite(h, "xy", 2));
    dump("poked-own-write", h);
    answer("close", "poked", mmioClose(h, 0));
    bytes("poked", POKED);

    /* A buffer of the program's own given at the open. */
    _fmemset(&info, 0, sizeof(info));
    info.cchBuffer = sizeof(own);
    info.pchBuffer = own;
    h = mmioOpen(WAVE, &info, MMIO_READ);
    opened("ownbuf", h, &info);
    dump("ownbuf", h);
    readAnswer("ownbuf", h, 4);
    dump("ownbuf-4", h);
    wsprintf(probeResult, "%02x%02x%02x%02x", (BYTE)own[0], (BYTE)own[1], (BYTE)own[2],
             (BYTE)own[3]);
    probe("ownbuf-bytes", "ownbuf", probeResult);
    answer("close", "ownbuf", mmioClose(h, 0));

    /* A write-only file read. */
    h = mmioOpen(SMALL, NULL, MMIO_CREATE | MMIO_WRITE);
    answer("write", "small-write", mmioWrite(h, "hello", 5));
    readAnswer("small-writeonly", h, 2);
    answer("close", "small-write", mmioClose(h, 0));
    bytes("small-write", SMALL);
}

static void memory(void)
{
    MMIOINFO info;
    HGLOBAL block;
    HPSTR buffer;
    HMMIO h;
    int i;

    block = GlobalAlloc(GMEM_MOVEABLE, 32);
    buffer = (HPSTR)GlobalLock(block);

    for (i = 0; i < 32; i++) {
        buffer[i] = (char)('a' + i % 26);
    }

    _fmemset(&info, 0, sizeof(info));
    info.fccIOProc = FOURCC_MEM;
    info.pchBuffer = buffer;
    info.cchBuffer = 32;
    h = mmioOpen(NULL, &info, MMIO_READWRITE);
    opened("mem", h, &info);
    dump("mem", h);
    readAnswer("mem-10", h, 10);
    dump("mem-10", h);
    answer("seek", "mem-end", mmioSeek(h, 0, SEEK_END));
    answer("seek", "mem-end2", mmioSeek(h, 2, SEEK_END));
    answer("seek", "mem-40", mmioSeek(h, 40, SEEK_SET));
    answer("seek", "mem-cur", mmioSeek(h, 0, SEEK_CUR));
    answer("seek", "mem-28", mmioSeek(h, 28, SEEK_SET));
    answer("write", "mem-noexpand", mmioWrite(h, "0123456789", 10));
    dump("mem-noexpand", h);
    answer("advance", "mem-read", mmioAdvance(h, NULL, MMIO_READ));
    answer("advance", "mem-write", mmioAdvance(h, NULL, MMIO_WRITE));
    answer("flush", "mem", mmioFlush(h, 0));
    answer("setbuffer", "mem", mmioSetBuffer(h, NULL, 64, 0));
    dump("mem-setbuffer", h);
    answer("close", "mem", mmioClose(h, 0));
    answer("globalsize", "mem", GlobalSize(block));

    /* One that grows. */
    _fmemset(&info, 0, sizeof(info));
    info.fccIOProc = FOURCC_MEM;
    info.pchBuffer = buffer;
    info.cchBuffer = 32;
    info.adwInfo[0] = 16;
    h = mmioOpen(NULL, &info, MMIO_READWRITE | MMIO_CREATE);
    opened("grow", h, &info);
    dump("grow", h);
    answer("write", "grow-40", mmioWrite(h, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$", 40));
    dump("grow-40", h);
    answer("seek", "grow-0", mmioSeek(h, 0, SEEK_SET));
    readAnswer("grow-40", h, 40);
    answer("seek", "grow-end", mmioSeek(h, 0, SEEK_END));
    answer("advance", "grow-write", mmioAdvance(h, NULL, MMIO_WRITE));
    dump("grow-advance", h);
    answer("close", "grow", mmioClose(h, 0));
    answer("globalsize", "grow", GlobalSize(block) >= 48 ? 1 : 0);
    GlobalUnlock(block);
    GlobalFree(block);

    /* One MMSYSTEM makes the buffer for. */
    _fmemset(&info, 0, sizeof(info));
    info.fccIOProc = FOURCC_MEM;
    info.cchBuffer = 64;
    h = mmioOpen(NULL, &info, MMIO_READWRITE | MMIO_CREATE | MMIO_ALLOCBUF);
    opened("mem-alloc", h, &info);
    dump("mem-alloc", h);
    answer("write", "mem-alloc", mmioWrite(h, "four", 4));
    dump("mem-alloc-write", h);
    answer("close", "mem-alloc", mmioClose(h, 0));

    /* With no buffer. */
    _fmemset(&info, 0, sizeof(info));
    info.fccIOProc = FOURCC_MEM;
    h = mmioOpen(NULL, &info, MMIO_READWRITE);
    opened("mem-none", h, &info);
    dump("mem-none", h);
    readAnswer("mem-none", h, 4);
    answer("close", "mem-none", mmioClose(h, 0));

    /* Named by its extension. */
    _fmemset(&info, 0, sizeof(info));
    h = mmioOpen("C:\\ORACLE\\X.MEM+Y", &info, MMIO_READ);
    opened("mem-name", h, &info);
    dump("mem-name", h);
    if (h) {
        answer("close", "mem-name", mmioClose(h, 0));
    }

    /* A flag a memory file does not take. */
    _fmemset(&info, 0, sizeof(info));
    info.fccIOProc = FOURCC_MEM;
    h = mmioOpen(NULL, &info, MMIO_READWRITE | MMIO_EXIST);
    opened("mem-exist", h, &info);
}

static void own(void)
{
    MMIOINFO info;
    LPMMIOPROC found;
    HMMIO h;

    found = mmioInstallIOProc(mmioFOURCC('X', 'Y', 'Z', ' '), ownProc, MMIO_INSTALLPROC);
    probe("proc", "install-xyz", procName(found));
    found = mmioInstallIOProc(mmioFOURCC('X', 'Y', 'Z', ' '), NULL, MMIO_FINDPROC);
    probe("proc", "find-xyz", procName(found));

    ownSize = 0;
    _fmemset(&info, 0, sizeof(info));
    h = mmioOpen("C:\\ORACLE\\FOO.xyz+inner", &info, MMIO_READWRITE | MMIO_CREATE);
    opened("own", h, &info);
    dump("own", h);
    answer("write", "own", mmioWrite(h, "12345", 5));
    answer("seek", "own-1", mmioSeek(h, 1, SEEK_SET));
    readAnswer("own-2", h, 2);
    answer("seek", "own-end", mmioSeek(h, 0, SEEK_END));
    answer("send", "own", mmioSendMessage(h, MMIOM_USER + 1, 7, 9));
    dump("own-end", h);
    answer("close", "own", mmioClose(h, 0));

    _fmemset(&info, 0, sizeof(info));
    h = mmioOpen("C:\\ORACLE\\FOO.XYZ+inner", &info, MMIO_READWRITE | MMIO_ALLOCBUF);
    opened("own-buffered", h, &info);
    dump("own-buffered", h);
    answer("write", "own-buffered", mmioWrite(h, "abcdef", 6));
    answer("seek", "own-buffered-2", mmioSeek(h, 2, SEEK_SET));
    readAnswer("own-buffered-3", h, 3);
    answer("seek", "own-buffered-end", mmioSeek(h, 0, SEEK_END));
    dump("own-buffered-end", h);
    answer("flush", "own-buffered", mmioFlush(h, 0));
    answer("close", "own-buffered", mmioClose(h, MMIO_FHOPEN));

    _fmemset(&info, 0, sizeof(info));
    info.fccIOProc = mmioFOURCC('X', 'Y', 'Z', ' ');
    h = mmioOpen("plain", &info, MMIO_READ);
    opened("own-byfcc", h, &info);
    answer("close", "own-byfcc", mmioClose(h, 0));

    _fmemset(&info, 0, sizeof(info));
    info.pIOProc = ownProc;
    h = mmioOpen(NULL, &info, MMIO_READ);
    opened("own-byproc", h, &info);
    dump("own-byproc", h);
    answer("close", "own-byproc", mmioClose(h, 0));

    answer("rename", "own", mmioRename("C:\\ORACLE\\A.XYZ+q", "B.XYZ", NULL, 0));
    answer("rename", "badflag", mmioRename("C:\\ORACLE\\A.XYZ+q", "B.XYZ", NULL, 1));

    found = mmioInstallIOProc(mmioFOURCC('X', 'Y', 'Z', ' '), NULL, MMIO_REMOVEPROC);
    probe("proc", "remove-xyz", procName(found));
    found = mmioInstallIOProc(mmioFOURCC('X', 'Y', 'Z', ' '), NULL, MMIO_FINDPROC);
    probe("proc", "find-xyz-gone", procName(found));

    _fmemset(&info, 0, sizeof(info));
    h = mmioOpen("C:\\ORACLE\\FOO.XYZ+inner", &info, MMIO_READ);
    opened("own-gone", h, &info);
    dump("own-gone", h);
    if (h) {
        answer("close", "own-gone", mmioClose(h, 0));
    }

    _fmemset(&info, 0, sizeof(info));
    h = mmioOpen("C:\\ORACLE\\MMIO.ABC+", &info, MMIO_READ);
    opened("plus-abc", h, &info);
    dump("plus-abc", h);
    if (h) {
        answer("close", "plus-abc", mmioClose(h, 0));
    }
}

static void names(void)
{
    MMIOINFO info;
    char name[128];
    HMMIO h;
    HFILE file;

    lstrcpy(name, "C:\\oracle\\.\\mmio.wav");
    h = mmioOpen(name, NULL, MMIO_PARSE);
    opened("parse", h, NULL);
    probe("name", "parse", name);

    lstrcpy(name, "C:\\ORACLE\\NOPE.WAV");
    h = mmioOpen(name, NULL, MMIO_PARSE);
    opened("parse-missing", h, NULL);
    probe("name", "parse-missing", name);

    lstrcpy(name, "C:\\oracle\\mmio.wav");
    h = mmioOpen(name, NULL, MMIO_EXIST);
    opened("exist", h, NULL);
    probe("name", "exist", name);

    lstrcpy(name, "C:\\ORACLE\\NOPE.WAV");
    _fmemset(&info, 0, sizeof(info));
    h = mmioOpen(name, &info, MMIO_EXIST);
    opened("exist-missing", h, &info);
    probe("name", "exist-missing", name);

    lstrcpy(name, SMALL);
    _fmemset(&info, 0, sizeof(info));
    h = mmioOpen(name, &info, MMIO_DELETE);
    opened("delete", h, &info);
    probe("name", "delete", name);
    _fmemset(&info, 0, sizeof(info));
    h = mmioOpen(name, &info, MMIO_DELETE);
    opened("delete-again", h, &info);

    lstrcpy(name, "C:\\MMX");
    _fmemset(&info, 0, sizeof(info));
    info.adwInfo[0] = 0x1234;
    h = mmioOpen(name, &info, MMIO_GETTEMP);
    opened("gettemp", h, &info);
    probe("name", "gettemp", name);

    /* A DOS file handle of the program's own. */
    file = _lopen(WAVE, OF_READ);
    _fmemset(&info, 0, sizeof(info));
    info.adwInfo[0] = file;
    h = mmioOpen(NULL, &info, MMIO_READ);
    opened("hfile", h, &info);
    dump("hfile", h);
    readAnswer("hfile", h, 4);
    answer("close", "hfile-fhopen", mmioClose(h, MMIO_FHOPEN));
    answer("llseek", "hfile", _llseek(file, 0, 1));

    _fmemset(&info, 0, sizeof(info));
    info.adwInfo[0] = file;
    h = mmioOpen(NULL, &info, MMIO_READ | MMIO_ALLOCBUF);
    opened("hfile-buffered", h, &info);
    dump("hfile-buffered", h);
    readAnswer("hfile-buffered", h, 4);
    dump("hfile-buffered-4", h);
    answer("close", "hfile", mmioClose(h, 0));
    answer("lclose", "hfile", (DWORD)(long)_lclose(file));
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    probeOpen(OUTPUT);

    ownProc = (LPMMIOPROC)MakeProcInstance((FARPROC)OwnIOProc, instance);

    fourccs();
    procs();
    badHandles();
    missing();
    writeWave();
    readWave();
    smallBuffer();
    poked();
    memory();
    own();
    names();

    probeFinish();

    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
