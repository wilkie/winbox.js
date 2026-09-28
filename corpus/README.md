# The corpus

Windows 3.x programs winbox.js is tried against, beyond the programs that come with Windows. They find what the probes do not think to ask.

Nothing of theirs is stored here. `manifest.json` says where each is published — a URL, or an archive.org item and file from the [Windows 3.x games collection](https://archive.org/details/softwarelibrary_win3_games) — with the SHA-256 of the archive fetched, archive.org's own SHA-1 and MD5 where it has them, the program to run inside it, what it imports, and what kind of thing it exercises. That is enough to fetch the same bytes again, anywhere.

```sh
node scripts/corpus/fetch.mjs            # fetch, check and unpack everything into corpus/programs/
node scripts/corpus/fetch.mjs skifree hearts # just these
CORPUS=1 npx jest test/corpus --forceExit            # run each, and report
CORPUS=skifree,hearts npx jest test/corpus --forceExit
```

What real Windows shows for a program is recorded under DOSBox, by the `launch` probe, which starts it from its own folder, as the survey does:

```sh
node scripts/oracle/build-probes.mjs launch
node scripts/oracle/record.mjs launch --corpus skifree --shoot starting:10   # and --then <keys>:<seconds> for more
```

The screens go to `corpus/reports/windows/<id>.png`, beside the survey's own `corpus/reports/<id>.png`, so the two can be compared.

The survey runs each program on the raster desktop from its own folder, `C:\CORPUS\<ID>`, as Program Manager starts a program, for a while. It writes `corpus/reports/<id>.json` — how many calls it made, which reach nothing yet, whether it faulted or ended, its last calls — and `<id>.png`, the screen. `corpus/reports/summary.md` ranks what is missing by how many programs want it.

## Choosing programs

The sample is chosen for variety rather than taken whole: small programs whose every import is either part of Windows or brought in their own archive, spread over what they exercise — only KERNEL, USER and GDI; the floating-point emulator; the sound driver; multimedia; the common dialogs and the shell; DDE and TOOLHELP; Borland's and Microsoft's control libraries; libraries of their own; and the Visual Basic and Klik & Play runtimes they bring. A program that needs a library it does not bring is left out.

To add one, put its entry in `manifest.json` with an empty `sha256`, run `node scripts/corpus/fetch.mjs --hash <id>`, and fill it in.
