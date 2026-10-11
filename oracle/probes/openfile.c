/*
 * What `OpenFile` answers and leaves in its `OFSTRUCT` for each of its
 * actions (`KRNL386.EXE` seg1 `5390`): `OF_EXIST` with each access and
 * sharing flag, on a file there, one not there, one read-only and one held
 * open; `OF_REOPEN` with `OF_EXIST`, `OF_VERIFY`, `OF_CREATE` and
 * `OF_DELETE`; `OF_CREATE`, `OF_DELETE`, `OF_PARSE`, `OF_CANCEL` and
 * `OF_PROMPT`.
 *
 * Each `open` record is a call: what it answered, then the structure, which
 * is filled with EEh before each call unless the name says it is used
 * again: `c=` its count of bytes, `f=` whether the disk is fixed, `e=`
 * DOS's error, `r=` its reserved four bytes -- `stamp` where they are the
 * date and the time DOS's function 5700h gives the file before the call or
 * after, `kept` where they are as they were, else `other` -- and `p=` its
 * path.
 *
 * The probe's own file is handle 5 throughout. `OFTEST.DAT` holds five
 * bytes; `OFRO.DAT` is read-only; `NOFILE.DAT` and the directory `NODIR`
 * are not there; `OFNEW.DAT` is made and deleted. Last, `OF_PROMPT` for a
 * file not there, after a record of `prompt`: the recorder answers the box
 * that comes up with Enter (`record.mjs --shoot prompt --then Return`).
 */

#define PROBE_FLUSH
#include "probe.h"

#define OUTPUT "C:\\ORACLE\\OPENFILE.OUT"

#define TEST "C:\\ORACLE\\OFTEST.DAT"
#define READONLY "C:\\ORACLE\\OFRO.DAT"
#define MISSING "C:\\ORACLE\\NOFILE.DAT"
#define NEWFILE "C:\\ORACLE\\OFNEW.DAT"

extern unsigned SetAttributes(LPCSTR path, unsigned attributes);
#pragma aux SetAttributes = "push ds" "mov ds,dx" "mov dx,ax" "mov ax,4301h" "int 21h" "pop ds" \
    "sbb ax,ax" parm[dx ax][cx] value[ax] modify[dx];

extern unsigned long Stamp(unsigned handle);
#pragma aux Stamp = "mov ax,5700h" "int 21h" "jnc done" "xor cx,cx" "xor dx,dx" "done:" \
    "mov ax,cx" parm[bx] value[dx ax] modify[cx];

static OFSTRUCT of;

/* What the structure's reserved bytes held before the call, and the date
 * and time DOS gave the file it names before the call and after, as the
 * structure keeps them: the date's word first. */
static BYTE before[4];
static DWORD stampBefore;
static DWORD stampAfter;

static DWORD stampOf(LPCSTR path)
{
    HFILE handle = _lopen(path, OF_READ);
    unsigned long stamp;

    if (handle == HFILE_ERROR) {
        return 0;
    }

    stamp = Stamp(handle);
    _lclose(handle);
    return stamp;
}

static void prepare(LPCSTR path, OFSTRUCT FAR *buffer)
{
    _fmemcpy(before, buffer->reserved, 4);
    stampBefore = stampOf(path);
}

static BOOL holds(OFSTRUCT FAR *buffer, DWORD stamp)
{
    return stamp && *(WORD FAR *)&buffer->reserved[0] == HIWORD(stamp) &&
           *(WORD FAR *)&buffer->reserved[2] == LOWORD(stamp);
}

static void report(LPCSTR name, int answer, OFSTRUCT FAR *buffer)
{
    LPCSTR reserved;

    stampAfter = stampOf(buffer->szPathName);

    if (holds(buffer, stampBefore) || holds(buffer, stampAfter)) {
        reserved = "stamp";
    } else if (_fmemcmp(before, buffer->reserved, 4) == 0) {
        reserved = "kept";
    } else {
        reserved = "other";
    }

    wsprintf(probeResult, "%d c=%u f=%u e=%u r=%s p=%s", answer, buffer->cBytes,
             buffer->fFixedDisk, buffer->nErrCode, reserved, (LPSTR)buffer->szPathName);
    probe("open", name, probeResult);
}

static void fill(OFSTRUCT FAR *buffer)
{
    _fmemset(buffer, 0xee, sizeof(OFSTRUCT));
    buffer->szPathName[sizeof(buffer->szPathName) - 1] = '\0';
}

/* A call with the structure filled afresh; a handle it opened, closed. */
static HFILE call(LPCSTR name, LPCSTR path, UINT mode, BOOL close)
{
    HFILE answer;

    fill(&of);
    prepare(path, &of);
    answer = OpenFile(path, &of, mode);
    report(name, answer, &of);

    if (close && answer != HFILE_ERROR && answer > 0) {
        _lclose(answer);
    }

    return answer;
}

/* A call with a structure kept from before. */
static HFILE again(LPCSTR name, LPCSTR path, OFSTRUCT FAR *buffer, UINT mode)
{
    HFILE answer;

    prepare(buffer->szPathName, buffer);
    answer = OpenFile(path, buffer, mode);
    report(name, answer, buffer);

    if (answer != HFILE_ERROR && answer > 0 && !(mode & (OF_EXIST | OF_DELETE))) {
        _lclose(answer);
    }

    return answer;
}

int PASCAL WinMain(HINSTANCE instance, HINSTANCE previous, LPSTR command, int show)
{
    OFSTRUCT first;
    OFSTRUCT kept;
    HFILE made;
    HFILE held;
    LONG size;

    probeOpen(OUTPUT);
    SetErrorMode(SEM_FAILCRITICALERRORS);

    SetAttributes(READONLY, 0);
    OpenFile(READONLY, &kept, OF_DELETE);
    OpenFile(NEWFILE, &kept, OF_DELETE);
    made = _lcreat(TEST, 0);
    _lwrite(made, "hello", 5);
    _lclose(made);
    made = _lcreat(READONLY, 0);
    _lclose(made);
    SetAttributes(READONLY, 1);

    call("exist", TEST, OF_EXIST, FALSE);
    call("exist,read", TEST, OF_EXIST | OF_READ, FALSE);
    call("exist,write", TEST, OF_EXIST | OF_WRITE, FALSE);
    call("exist,readwrite", TEST, OF_EXIST | OF_READWRITE, FALSE);
    call("exist,exclusive", TEST, OF_EXIST | OF_READWRITE | OF_SHARE_EXCLUSIVE, FALSE);
    call("exist,denynone", TEST, OF_EXIST | OF_SHARE_DENY_NONE, FALSE);
    call("exist,bare", "OFTEST.DAT", OF_EXIST, FALSE);
    call("exist,missing", MISSING, OF_EXIST, FALSE);
    call("exist,nodir", "C:\\ORACLE\\NODIR\\NOFILE.DAT", OF_EXIST, FALSE);
    call("exist,readonly", READONLY, OF_EXIST, FALSE);
    call("exist,readonly,write", READONLY, OF_EXIST | OF_WRITE, FALSE);
    call("exist,readonly,readwrite", READONLY, OF_EXIST | OF_READWRITE, FALSE);

    held = call("held", TEST, OF_READWRITE | OF_SHARE_EXCLUSIVE, FALSE);
    call("held,exist", TEST, OF_EXIST, FALSE);
    call("held,exist,denynone", TEST, OF_EXIST | OF_SHARE_DENY_NONE, FALSE);
    call("held,read", TEST, OF_READ, TRUE);

    if (held != HFILE_ERROR) {
        _lclose(held);
    }

    call("read", TEST, OF_READ, TRUE);
    first = of;
    kept = first;
    again("reopen,exist", "C:\\ORACLE\\IGNORED.DAT", &kept, OF_REOPEN | OF_EXIST);
    kept = first;
    again("reopen,read", "C:\\ORACLE\\IGNORED.DAT", &kept, OF_REOPEN | OF_READ);
    kept = first;
    again("reopen,verify", TEST, &kept, OF_REOPEN | OF_VERIFY);
    kept = first;
    kept.reserved[0] ^= 1;
    again("reopen,verify,changed", TEST, &kept, OF_REOPEN | OF_VERIFY);
    kept = first;
    lstrcpy(kept.szPathName, MISSING);
    kept.nErrCode = 0;
    again("reopen,missing", MISSING, &kept, OF_REOPEN | OF_READ);
    kept = first;
    lstrcpy(kept.szPathName, NEWFILE);
    again("reopen,create", NEWFILE, &kept, OF_REOPEN | OF_CREATE);
    again("reopen,delete", NEWFILE, &kept, OF_REOPEN | OF_DELETE);
    call("exist,deleted", NEWFILE, OF_EXIST, FALSE);

    made = call("create", NEWFILE, OF_CREATE, FALSE);

    if (made != HFILE_ERROR) {
        _lwrite(made, "abc", 3);
        _lclose(made);
    }

    made = call("create,again", NEWFILE, OF_CREATE | OF_READWRITE, FALSE);

    if (made != HFILE_ERROR) {
        size = _llseek(made, 0L, 2);
        _lclose(made);
        wsprintf(probeResult, "%ld", size);
        probe("size", "create,again", probeResult);
    }

    call("create,exist", NEWFILE, OF_CREATE | OF_EXIST, FALSE);
    call("delete", NEWFILE, OF_DELETE, FALSE);
    call("delete,missing", NEWFILE, OF_DELETE, FALSE);
    call("parse", "c:\\oracle\\.\\oftest.dat", OF_PARSE, FALSE);
    call("parse,missing", MISSING, OF_PARSE, FALSE);
    call("cancel,missing", MISSING, OF_EXIST | OF_CANCEL, FALSE);
    call("prompt,present", TEST, OF_EXIST | OF_PROMPT, FALSE);

    SetAttributes(READONLY, 0);
    OpenFile(READONLY, &kept, OF_DELETE);

    probe("prompt", "ready", "");
    call("prompt,missing", MISSING, OF_EXIST | OF_PROMPT | OF_CANCEL, FALSE);
    call("prompt,parse", "C:\\ORACLE\\NODIR\\NOFILE.DAT", OF_READ | OF_PROMPT, FALSE);

    OpenFile(TEST, &kept, OF_DELETE);
    probeFinish();

    (void)instance;
    (void)previous;
    (void)command;
    (void)show;
    return 0;
}
