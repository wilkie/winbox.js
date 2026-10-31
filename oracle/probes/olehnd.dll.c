/*
 * An object handler for `olehnd.c`: the library the registration database
 * names under the class `OleHnd`'s `protocol\StdFileEditing\handler` key,
 * which OLECLI loads and calls in place of its own defaults, as the OLE
 * 1.0 programmer's reference describes object handlers: its `DllCreate`,
 * `DllCreateFromClip`, `DllCreateLinkFromClip`, `DllCreateFromTemplate`,
 * `DllCreateFromFile`, `DllCreateLinkFromFile`, `DllCreateInvisible` and
 * `DllLoadFromStream` given what the client gave its `Ole` function, and
 * each passing it on to OLECLI's `Def` export of the same name.
 *
 * Each call is written down for `HndTake` to hand back: what it was given
 * -- each string, whether a pointer is the one the probe expects (`HndSet`
 * tells it the client, the document and the out pointer), the render
 * option, the format by its name, the type and the class's atom by its
 * name -- and what the `Def` export answered and made.
 *
 * `HndSet`'s mode: 0 passes each call on; 1 answers `OLE_ERROR_GENERIC`
 * without calling the default; 2 passes it on and then puts its own
 * `QueryBounds` in the object's method table, which writes down that it
 * was called and calls the method that was there; 3 puts that method back.
 */

#include <windows.h>
#include <ole.h>

typedef OLESTATUS(FAR PASCAL *LOADPROC)(LPOLESTREAM, LPSTR, LPOLECLIENT, LHCLIENTDOC, LPSTR,
                                        LPOLEOBJECT FAR *, LONG, ATOM, UINT);
typedef OLESTATUS(FAR PASCAL *CLIPPROC)(LPSTR, LPOLECLIENT, LHCLIENTDOC, LPSTR, LPOLEOBJECT FAR *,
                                        UINT, UINT, LONG);
typedef OLESTATUS(FAR PASCAL *LINKCLIPPROC)(LPSTR, LPOLECLIENT, LHCLIENTDOC, LPSTR,
                                            LPOLEOBJECT FAR *, UINT, UINT);
typedef OLESTATUS(FAR PASCAL *CREATEPROC)(LPSTR, LPOLECLIENT, LPSTR, LHCLIENTDOC, LPSTR,
                                          LPOLEOBJECT FAR *, UINT, UINT);
typedef OLESTATUS(FAR PASCAL *FILEPROC)(LPSTR, LPOLECLIENT, LPSTR, LPSTR, LHCLIENTDOC, LPSTR,
                                        LPOLEOBJECT FAR *, UINT, UINT);
typedef OLESTATUS(FAR PASCAL *LINKFILEPROC)(LPSTR, LPOLECLIENT, LPSTR, LPSTR, LPSTR, LHCLIENTDOC,
                                            LPSTR, LPOLEOBJECT FAR *, UINT, UINT);
typedef OLESTATUS(FAR PASCAL *INVISIBLEPROC)(LPSTR, LPOLECLIENT, LPSTR, LHCLIENTDOC, LPSTR,
                                             LPOLEOBJECT FAR *, UINT, UINT, BOOL);
typedef OLESTATUS(FAR PASCAL *BOUNDSPROC)(LPOLEOBJECT, RECT FAR *);

static char log[1500];
static int mode;
static LPOLECLIENT wantClient;
static LHCLIENTDOC wantDoc;
static LPOLEOBJECT FAR *wantOut;
static LPOLEOBJECTVTBL patched;
static BOUNDSPROC saved;

static void add(LPCSTR text)
{
    if (lstrlen(log) + lstrlen(text) + 2 < sizeof(log)) {
        if (log[0]) {
            lstrcat(log, "|");
        }

        lstrcat(log, text);
    }
}

/* A string argument, or `0` for none. */
static LPSTR text(LPSTR out, LPCSTR name, LPCSTR value)
{
    return out + wsprintf(out, "%s=%s,", name, value ? value : (LPCSTR) "0");
}

/* A pointer argument: the one expected, none, or another. */
static LPSTR same(LPSTR out, LPCSTR name, const void FAR *value, const void FAR *wanted)
{
    return out + wsprintf(out, "%s=%s,", name, !value ? "0" : value == wanted ? "same" : "other");
}

static LPSTR format(LPSTR out, UINT cf)
{
    char name[40];

    if (cf >= 0xc000) {
        name[0] = 0;
        GetClipboardFormatName(cf, name, sizeof name);
        return out + wsprintf(out, "cf=%s,", (LPSTR)name);
    }

    return out + wsprintf(out, "cf=%u,", cf);
}

static FARPROC def(LPCSTR name)
{
    return GetProcAddress(GetModuleHandle("OLECLI"), name);
}

/* What the default answered, and whether it made an object. */
static void answered(LPCSTR name, OLESTATUS answer, LPOLEOBJECT FAR *out)
{
    char line[80];

    wsprintf(line, "%s=%u %s", name, (unsigned)answer, out && *out ? "object" : "0");
    add(line);
}

OLESTATUS FAR PASCAL _export HndQueryBounds(LPOLEOBJECT object, RECT FAR *bounds)
{
    OLESTATUS answer = saved ? saved(object, bounds) : OLE_ERROR_GENERIC;
    char line[60];

    wsprintf(line, "HndQueryBounds=%u", (unsigned)answer);
    add(line);
    return answer;
}

/* After the default: the object's table changed in mode 2. */
static OLESTATUS made(OLESTATUS answer, LPOLEOBJECT FAR *out)
{
    if (mode == 2 && answer <= OLE_WAIT_FOR_RELEASE && out && *out) {
        patched = (*out)->lpvtbl;
        saved = (BOUNDSPROC)patched->QueryBounds;
        patched->QueryBounds = HndQueryBounds;
        add("patched");
    }

    return answer;
}

OLESTATUS FAR PASCAL _export DllLoadFromStream(LPOLESTREAM stream, LPSTR protocol,
                                               LPOLECLIENT client, LHCLIENTDOC doc, LPSTR name,
                                               LPOLEOBJECT FAR *out, LONG type, ATOM klass,
                                               UINT cf)
{
    char line[300];
    char atom[40];
    LPSTR at = line;
    OLESTATUS answer;

    at += wsprintf(at, "DllLoadFromStream(");
    at += wsprintf(at, "stream=%s,", stream ? "given" : "0");
    at = text(at, "protocol", protocol);
    at = same(at, "client", client, wantClient);
    at += wsprintf(at, "doc=%s,", doc == wantDoc ? "same" : "other");
    at = text(at, "name", name);
    at = same(at, "out", out, wantOut);
    atom[0] = 0;
    GlobalGetAtomName(klass, atom, sizeof atom);
    at += wsprintf(at, "type=%ld,class=%s,", type, (LPSTR)atom);
    at = format(at, cf);
    wsprintf(at - 1, ")");
    add(line);

    if (mode == 1) {
        return OLE_ERROR_GENERIC;
    }

    answer = ((LOADPROC)def("DefLoadFromStream"))(stream, protocol, client, doc, name, out, type,
                                                   klass, cf);
    answered("DefLoadFromStream", answer, out);
    return made(answer, out);
}

OLESTATUS FAR PASCAL _export DllCreateFromClip(LPSTR protocol, LPOLECLIENT client, LHCLIENTDOC doc,
                                               LPSTR name, LPOLEOBJECT FAR *out, UINT render,
                                               UINT cf, LONG type)
{
    char line[300];
    LPSTR at = line;
    OLESTATUS answer;

    at += wsprintf(at, "DllCreateFromClip(");
    at = text(at, "protocol", protocol);
    at = same(at, "client", client, wantClient);
    at += wsprintf(at, "doc=%s,", doc == wantDoc ? "same" : "other");
    at = text(at, "name", name);
    at = same(at, "out", out, wantOut);
    at += wsprintf(at, "render=%u,", render);
    at = format(at, cf);
    at += wsprintf(at, "type=%ld,", type);
    wsprintf(at - 1, ")");
    add(line);

    if (mode == 1) {
        return OLE_ERROR_GENERIC;
    }

    answer = ((CLIPPROC)def("DefCreateFromClip"))(protocol, client, doc, name, out, render, cf,
                                                   type);
    answered("DefCreateFromClip", answer, out);
    return made(answer, out);
}

OLESTATUS FAR PASCAL _export DllCreateLinkFromClip(LPSTR protocol, LPOLECLIENT client,
                                                   LHCLIENTDOC doc, LPSTR name,
                                                   LPOLEOBJECT FAR *out, UINT render, UINT cf)
{
    char line[300];
    LPSTR at = line;
    OLESTATUS answer;

    at += wsprintf(at, "DllCreateLinkFromClip(");
    at = text(at, "protocol", protocol);
    at = same(at, "client", client, wantClient);
    at += wsprintf(at, "doc=%s,", doc == wantDoc ? "same" : "other");
    at = text(at, "name", name);
    at = same(at, "out", out, wantOut);
    at += wsprintf(at, "render=%u,", render);
    at = format(at, cf);
    wsprintf(at - 1, ")");
    add(line);

    if (mode == 1) {
        return OLE_ERROR_GENERIC;
    }

    answer =
        ((LINKCLIPPROC)def("DefCreateLinkFromClip"))(protocol, client, doc, name, out, render, cf);
    answered("DefCreateLinkFromClip", answer, out);
    return made(answer, out);
}

/* The arguments `DllCreate` and `DllCreateFromTemplate` share. */
static LPSTR created(LPSTR at, LPCSTR function, LPCSTR second, LPSTR protocol, LPOLECLIENT client,
                     LPSTR klass, LHCLIENTDOC doc, LPSTR name, LPOLEOBJECT FAR *out)
{
    at += wsprintf(at, "%s(", function);
    at = text(at, "protocol", protocol);
    at = same(at, "client", client, wantClient);
    at = text(at, second, klass);
    at += wsprintf(at, "doc=%s,", doc == wantDoc ? "same" : "other");
    at = text(at, "name", name);
    return same(at, "out", out, wantOut);
}

OLESTATUS FAR PASCAL _export DllCreate(LPSTR protocol, LPOLECLIENT client, LPSTR klass,
                                       LHCLIENTDOC doc, LPSTR name, LPOLEOBJECT FAR *out,
                                       UINT render, UINT cf)
{
    char line[300];
    LPSTR at = created(line, "DllCreate", "class", protocol, client, klass, doc, name, out);
    OLESTATUS answer;

    at += wsprintf(at, "render=%u,", render);
    at = format(at, cf);
    wsprintf(at - 1, ")");
    add(line);

    if (mode == 1) {
        return OLE_ERROR_GENERIC;
    }

    answer =
        ((CREATEPROC)def("DefCreate"))(protocol, client, klass, doc, name, out, render, cf);
    answered("DefCreate", answer, out);
    return made(answer, out);
}

OLESTATUS FAR PASCAL _export DllCreateFromTemplate(LPSTR protocol, LPOLECLIENT client,
                                                   LPSTR file, LHCLIENTDOC doc, LPSTR name,
                                                   LPOLEOBJECT FAR *out, UINT render, UINT cf)
{
    char line[300];
    LPSTR at =
        created(line, "DllCreateFromTemplate", "template", protocol, client, file, doc, name, out);
    OLESTATUS answer;

    at += wsprintf(at, "render=%u,", render);
    at = format(at, cf);
    wsprintf(at - 1, ")");
    add(line);

    if (mode == 1) {
        return OLE_ERROR_GENERIC;
    }

    answer = ((CREATEPROC)def("DefCreateFromTemplate"))(protocol, client, file, doc, name, out,
                                                         render, cf);
    answered("DefCreateFromTemplate", answer, out);
    return made(answer, out);
}

OLESTATUS FAR PASCAL _export DllCreateFromFile(LPSTR protocol, LPOLECLIENT client, LPSTR klass,
                                               LPSTR file, LHCLIENTDOC doc, LPSTR name,
                                               LPOLEOBJECT FAR *out, UINT render, UINT cf)
{
    char line[300];
    LPSTR at = line;
    OLESTATUS answer;

    at += wsprintf(at, "DllCreateFromFile(");
    at = text(at, "protocol", protocol);
    at = same(at, "client", client, wantClient);
    at = text(at, "class", klass);
    at = text(at, "file", file);
    at += wsprintf(at, "doc=%s,", doc == wantDoc ? "same" : "other");
    at = text(at, "name", name);
    at = same(at, "out", out, wantOut);
    at += wsprintf(at, "render=%u,", render);
    at = format(at, cf);
    wsprintf(at - 1, ")");
    add(line);

    if (mode == 1) {
        return OLE_ERROR_GENERIC;
    }

    answer = ((FILEPROC)def("DefCreateFromFile"))(protocol, client, klass, file, doc, name, out,
                                                   render, cf);
    answered("DefCreateFromFile", answer, out);
    return made(answer, out);
}

OLESTATUS FAR PASCAL _export DllCreateLinkFromFile(LPSTR protocol, LPOLECLIENT client, LPSTR klass,
                                                   LPSTR file, LPSTR item, LHCLIENTDOC doc,
                                                   LPSTR name, LPOLEOBJECT FAR *out, UINT render,
                                                   UINT cf)
{
    char line[300];
    LPSTR at = line;
    OLESTATUS answer;

    at += wsprintf(at, "DllCreateLinkFromFile(");
    at = text(at, "protocol", protocol);
    at = same(at, "client", client, wantClient);
    at = text(at, "class", klass);
    at = text(at, "file", file);
    at = text(at, "item", item);
    at += wsprintf(at, "doc=%s,", doc == wantDoc ? "same" : "other");
    at = text(at, "name", name);
    at = same(at, "out", out, wantOut);
    at += wsprintf(at, "render=%u,", render);
    at = format(at, cf);
    wsprintf(at - 1, ")");
    add(line);

    if (mode == 1) {
        return OLE_ERROR_GENERIC;
    }

    answer = ((LINKFILEPROC)def("DefCreateLinkFromFile"))(protocol, client, klass, file, item, doc,
                                                           name, out, render, cf);
    answered("DefCreateLinkFromFile", answer, out);
    return made(answer, out);
}

OLESTATUS FAR PASCAL _export DllCreateInvisible(LPSTR protocol, LPOLECLIENT client, LPSTR klass,
                                                LHCLIENTDOC doc, LPSTR name, LPOLEOBJECT FAR *out,
                                                UINT render, UINT cf, BOOL activate)
{
    char line[300];
    LPSTR at = created(line, "DllCreateInvisible", "class", protocol, client, klass, doc, name, out);
    OLESTATUS answer;

    at += wsprintf(at, "render=%u,", render);
    at = format(at, cf);
    at += wsprintf(at, "activate=%d,", activate);
    wsprintf(at - 1, ")");
    add(line);

    if (mode == 1) {
        return OLE_ERROR_GENERIC;
    }

    answer = ((INVISIBLEPROC)def("DefCreateInvisible"))(protocol, client, klass, doc, name, out,
                                                         render, cf, activate);
    answered("DefCreateInvisible", answer, out);
    return made(answer, out);
}

/* The probe says what it expects, and the mode; 3 puts back the method mode 2 replaced. */
void FAR PASCAL _export HndSet(int newMode, LPOLECLIENT client, LHCLIENTDOC doc,
                               LPOLEOBJECT FAR *out)
{
    if (newMode == 3) {
        if (patched && saved) {
            patched->QueryBounds = saved;
        }

        patched = NULL;
        saved = NULL;
        newMode = 0;
    }

    mode = newMode;
    wantClient = client;
    wantDoc = doc;
    wantOut = out;
}

/* What was written down since last asked: copied out and forgotten. */
int FAR PASCAL _export HndTake(LPSTR out, int size)
{
    int n = lstrlen(log);

    if (n >= size) {
        n = size - 1;
    }

    lstrcpyn(out, log, n + 1);
    log[0] = 0;
    return n;
}

/* Whether the method table mode 2 changed is the one an object has, and what is in its slot. */
int FAR PASCAL _export HndTable(LPOLEOBJECT object)
{
    if (!patched || !object) {
        return 0;
    }

    if (object->lpvtbl == patched) {
        return 1;
    }

    return object->lpvtbl->QueryBounds == HndQueryBounds ? 2 : 3;
}

int FAR PASCAL LibMain(HANDLE instance, WORD data, WORD heap, LPSTR command)
{
    (void)instance;
    (void)data;
    (void)heap;
    (void)command;
    return 1;
}
