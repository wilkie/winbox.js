---
kind: topic
name: Registration database
summary: How Windows 3.1 keeps its registration database — the REG.DAT file, its keys and shared texts, and SHELL's RegOpenKey, RegQueryValue, RegEnumKey and the rest — read out of SHELL.DLL and measured against the installation's own database.
probes: [registry]
---

File associations and OLE servers are kept in the registration database, `REG.DAT` in the Windows directory. Programs reach it through seven calls in `SHELL.DLL`: File Manager, to learn what opens a file, and the Registration Info Editor. The code is SHELL's segment 2, and segment 7 for the writer.

## The file

- [[read out]] **The header** is 20h bytes (seg2 `0e72`):
  - `SHCC3.10`;
  - 20h;
  - the node table's offset and number of entries;
  - the text area's offset and size;
  - the number of hash buckets, 37 in the installation's file;
  - the head of the free list.
- [[read out]] **The node table** is 8-byte entries, and one index names every kind:
  - entry 0 is the root;
  - entries 1 to the bucket count are the heads of the hash buckets' chains;
  - a **key** is its next sibling, its first child, its name's text and its value's text, or 0 for none;
  - a **text** is the next in its bucket's chain, how many use it, its length, and where it is in the text area.
- [[read out]] **The text area** holds each text just after a word naming its entry back, packed with no nought between them.
- [[read out]] **Texts are shared** by names and values alike: `txtfile` is the value of `.txt` and of `.ini`, and the name of a key, and is stored once.
- [[read out]] **A text's bucket** is its first 39 characters, upper-cased, summed as signed bytes, taken modulo the bucket count, plus one (seg2 `063e`).
- [[measured]] The installation's `REG.DAT` decodes entirely by this: every back reference, every count and every bucket.

## Keys

- [[read out]] `HKEY_CLASSES_ROOT`, 1, is not the root but the root's child `.classes`, found again at every call. Any other handle is `0001:` and a key's entry (seg2 `0dbc`).
- [[read out]] A new key is put **first** among its parent's children (seg2 `08f4`). Children therefore come newest first, not sorted.
- [[measured]] [[probe:registry]] enumerates the classes root from `WordDocument` to `.ini`, the file's order. A key it makes comes first after that.
- [[read out]] A name is matched without regard to case, and takes the case of whichever spelling was stored first. A value must match exactly to be shared.
- [[read out]] **A path is refused with error 2** if it:
  - has a component longer than 63 characters;
  - has a character at or below a space or above 7Fh;
  - ends in a backslash;
  - begins with a backslash anywhere but the root.

## The calls

- [[measured]] `RegQueryValue` writes up to its buffer's size less one and a nought, and sets the size to what it wrote plus one. A key with no value reads as empty, size 1. A size of nought writes nothing.
- [[measured]] `RegEnumKey` names a key's children one index at a time, and answers 2 past the last.
- [[measured]] **`RegSetValue`:**
  - takes only `REG_SZ` (1); any other type answers 7;
  - makes the path's keys as it needs them;
  - an empty value takes the key's value away.
- [[measured]] `RegDeleteKey` deletes a key and everything under it. A key that is not there, or an empty name, answers 2.
- [[measured]] `RegCloseKey` answers 7 when nothing is open. It ignores its handle and only counts the keys open (seg2 `1114`).
- [[read out]] The database is read when a key is first opened. Changes are written back when the last key closes, and every call opens and closes for itself. A change made with no key open therefore reaches the disk at once.

## Not yet done

- `WIN.INI`'s `[embedding]` section, which SHELL copies in when a key is first opened and out when it writes (seg2 `1730`, `18b4`).
- SHELL writes a temporary file and renames it into place, where winbox.js writes `REG.DAT` directly.
- The order SHELL packs the texts in when it writes, and the database being dropped and read again under memory pressure.

## In winbox.js

- `src/win16/shell/registry.ts` reads, changes and writes the file.
- `src/win16/shell/reg-api.ts` holds the calls.
