//! `VER`, Windows' version information and file installation, as WinBox's
//! own: each routine of `VER.DLL` followed as it is read out (`kb/ver`,
//! `kb/topics/version-information.md`). As `src/win16/ver/`.
//!
//! VER reads files through `LZEXPAND`, so a file `COMPRESS` made is read
//! as the file it holds: here, WinBox's own (`lzexpand/`), called as VER
//! calls it. Its other calls go to KERNEL, USER and KEYBOARD as it makes
//! them. What it keeps on its stack -- a file's headers, the names it
//! builds -- is kept below the caller's stack here too (`Frame`), where the
//! calls it makes can be given it.
//!
//! It is kept as `COMMDLG` is (`own_modules.rs`): with `VER.DLL` on the
//! drive, a program that imports `VER` gets the file's library, each
//! import of an export answered here linked to WinBox's stub; with none,
//! WinBox's stubs throughout.

mod languages;

use winbox_cpu::{AX, CX, DI, DS, DX, ES, SP, SS};

use crate::call::{Answer, Args, Implementation, Later, Stop};
use crate::commdlg::api::{self, Arg, Called};
use crate::engine::Engine;
use crate::lzexpand::{lz_close, lz_copy, lz_open_file, lz_read, lz_seek};
use crate::system::System;

pub use languages::{LANGUAGES, UNKNOWN_LANGUAGE};

/// The module's name, and its file's.
pub const NAME: &str = "VER";

/// The function that answers an export WinBox has made its own.
pub(crate) fn implementation(name: &str) -> Option<Implementation> {
    Some(match name {
        "WEP" => Implementation::Sync(wep),
        "GetFileResourceSize" => Implementation::Async(get_file_resource_size_export),
        "GetFileResource" => Implementation::Async(get_file_resource_export),
        "GetFileVersionInfoSize" => Implementation::Async(get_file_version_info_size_export),
        "GetFileVersionInfo" => Implementation::Async(get_file_version_info_export),
        "VerFindFile" => Implementation::Async(ver_find_file_export),
        "VerInstallFile" => Implementation::Async(ver_install_file_export),
        "VerLanguageName" => Implementation::Sync(ver_language_name),
        "VerQueryValue" => Implementation::Async(ver_query_value_export),
        _ => return None,
    })
}

const fn sel(far: u32) -> u16 {
    (far >> 16) as u16
}

const fn off(far: u32) -> u16 {
    far as u16
}

const fn far(selector: u16, offset: u16) -> u32 {
    (selector as u32) << 16 | offset as u32
}

const fn plus(at: u32, n: u16) -> u32 {
    far(sel(at), off(at).wrapping_add(n))
}

fn rd8(engine: &Engine, at: u32) -> u8 {
    engine.system().read_far(at, 1)[0]
}

fn wr8(engine: &Engine, at: u32, value: u8) {
    engine.system().write_far(at, &[value]);
}

fn rd16(engine: &Engine, at: u32) -> u16 {
    u16::from(rd8(engine, at)) | u16::from(rd8(engine, plus(at, 1))) << 8
}

fn wr16(engine: &Engine, at: u32, value: u16) {
    wr8(engine, at, value as u8);
    wr8(engine, plus(at, 1), (value >> 8) as u8);
}

fn rd32(engine: &Engine, at: u32) -> u32 {
    u32::from(rd16(engine, at)) | u32::from(rd16(engine, plus(at, 2))) << 16
}

fn wr32(engine: &Engine, at: u32, value: u32) {
    wr16(engine, at, value as u16);
    wr16(engine, plus(at, 2), (value >> 16) as u16);
}

/// A string at a far pointer, without its nought.
fn string_at(engine: &Engine, at: u32) -> Vec<u8> {
    engine.system().read_string(at)
}

fn write_string(engine: &Engine, at: u32, bytes: &[u8]) {
    let mut copy = bytes.to_vec();

    copy.push(0);
    engine.system().write_far(at, &copy);
}

/// A frame of bytes below the stack, as VER keeps its locals: `at` its
/// start, taken away as it goes.
struct Frame<'a> {
    engine: &'a Engine,
    saved: u16,
    at: u32,
}

impl<'a> Frame<'a> {
    fn new(engine: &'a Engine, size: u16) -> Self {
        let mut system = engine.system();
        let saved = system.cpu.regs[SP];
        let sp = saved.wrapping_sub(size.wrapping_add(1) & !1);

        system.cpu.regs[SP] = sp;

        Self {
            engine,
            saved,
            at: far(system.cpu.segments[SS].selector, sp),
        }
    }
}

impl Drop for Frame<'_> {
    fn drop(&mut self) {
        self.engine.system().cpu.regs[SP] = self.saved;
    }
}

/// USER's `lstrcmpi`, of two strings where they are.
async fn lstrcmpi(engine: &Engine, a: u32, b: u32) -> Result<i16, Stop> {
    Ok(api::word(engine, "USER", "lstrcmpi", &[Arg::D(a), Arg::D(b)]).await? as i16)
}

/// KERNEL's `lstrlen`, of a string where it is.
async fn lstrlen(engine: &Engine, at: u32) -> Result<u16, Stop> {
    api::word(engine, "KERNEL", "lstrlen", &[Arg::D(at)]).await
}

/// KERNEL's `lstrcpy`, where the strings are.
async fn lstrcpy(engine: &Engine, to: u32, from: u32) -> Result<(), Stop> {
    api::api(engine, "KERNEL", "lstrcpy", &[Arg::D(to), Arg::D(from)]).await?;
    Ok(())
}

/// The resource type of version information.
const RT_VERSION: u32 = 16;

/// `__AHINCR`: what a huge pointer's selector goes up by every 64K.
const AHINCR: u16 = 8;

/// A program's headers read (seg3 `0488`): opened by `LZOpenFile` sharing
/// it, else in compatibility mode; its old header checked for `MZ`, its new
/// header's 40h bytes read at the place the old one names and checked for
/// `NE`, and the file left at the new header. Whether it is one, and the
/// handle `LZOpenFile` gave, or its error.
///
/// Not followed: a ROM module's header, copied where KERNEL's
/// `IsRomModule` names one (seg3 `04a0`); Windows 3.1's answers nought
/// (`KRNL386.EXE` seg2 `1e9b`).
async fn open_executable(engine: &Engine, file: u32, header: u32) -> Result<(bool, i32), Stop> {
    let frame = Frame::new(engine, 0xd0);
    let of = frame.at;
    let old = plus(frame.at, 0x90);
    let mut handle = lz_open_file(engine, file, of, 0x40).await?;

    if handle < 0 {
        handle = lz_open_file(engine, file, of, 0).await?;
    }

    if handle < 0 {
        return Ok((false, handle));
    }

    let h = handle as u16;

    if lz_read(engine, h, old, 0x40).await? != 0x40 || rd16(engine, old) != 0x5a4d {
        return Ok((false, handle));
    }

    let place = rd32(engine, plus(old, 0x3c)) as i32;

    if lz_seek(engine, h, place, 0).await? != place {
        return Ok((false, handle));
    }

    if lz_read(engine, h, header, 0x40).await? != 0x40 || rd16(engine, header) != 0x454e {
        return Ok((false, handle));
    }

    lz_seek(engine, h, place, 0).await?;

    Ok((true, handle))
}

/// A resource as the resource table names it: its place and length, in
/// units of the table's shift.
struct Found {
    shift: u16,
    offset: u16,
    length: u16,
}

/// A resource found in the resource table (seg3 `05d2`), read from the new
/// header on: the shift, then each type -- its number, its count -- its
/// resources read one by one where the type is the one wanted, the others
/// passed over. A type or a name is matched by its number alone, its top
/// bit taken off, against the argument's low word.
async fn find_resource(
    engine: &Engine,
    handle: u16,
    header: u32,
    kind: u32,
    id: u32,
) -> Result<Option<Found>, Stop> {
    let frame = Frame::new(engine, 0x16);
    let shift_at = frame.at;
    let type_at = plus(frame.at, 2);
    let count_at = plus(frame.at, 4);
    let info = plus(frame.at, 0xa);

    lz_seek(
        engine,
        handle,
        i32::from(rd16(engine, plus(header, 0x24))),
        1,
    )
    .await?;

    if lz_read(engine, handle, shift_at, 2).await? != 2 {
        return Ok(None);
    }

    let shift = rd16(engine, shift_at);

    if shift > 12 {
        return Ok(None);
    }

    loop {
        if lz_read(engine, handle, type_at, 2).await? != 2 || rd16(engine, type_at) == 0 {
            return Ok(None);
        }

        if lz_read(engine, handle, count_at, 6).await? != 6 {
            return Ok(None);
        }

        let count = rd16(engine, count_at);

        if rd16(engine, type_at) & 0x7fff == kind as u16 {
            for _ in 0..count {
                if lz_read(engine, handle, info, 12).await? != 12 {
                    return Ok(None);
                }

                if rd16(engine, plus(info, 6)) & 0x7fff == id as u16 {
                    return Ok(Some(Found {
                        shift,
                        offset: rd16(engine, info),
                        length: rd16(engine, plus(info, 2)),
                    }));
                }
            }

            return Ok(None);
        }

        lz_seek(engine, handle, i32::from(count.wrapping_mul(12)), 1).await?;
    }
}

/// `GetFileResourceSize` (seg3 `0010`): a resource's length, and its place
/// in the file. A file that is no Windows program would be given to
/// Win32s's `W32SYS.DLL` where VER can load it (seg4 `003e`): no Win32s is
/// installed, and it answers nought.
async fn get_file_resource_size(
    engine: &Engine,
    file: u32,
    kind: u32,
    id: u32,
    offset_at: u32,
) -> Result<u32, Stop> {
    let frame = Frame::new(engine, 0x40);
    let header = frame.at;
    let (opened, handle) = open_executable(engine, file, header).await?;

    if !opened {
        lz_close(engine, handle as u16).await?;

        return Ok(0);
    }

    let found = find_resource(engine, handle as u16, header, kind, id).await?;

    lz_close(engine, handle as u16).await?;

    let Some(found) = found else {
        return Ok(0);
    };

    wr32(engine, offset_at, u32::from(found.offset) << found.shift);

    Ok(u32::from(found.length) << found.shift)
}

/// `count` bytes read into a huge buffer (seg3 `07c9`), 4000h at a time,
/// the selector stepped by `__AHINCR` past each 64K: how many were read,
/// or -1 for `LZRead`'s error.
async fn huge_read(engine: &Engine, handle: u16, to: u32, count: u32) -> Result<u32, Stop> {
    let mut left = count;
    let mut at = to;

    while left > 0x4000 {
        let read = lz_read(engine, handle, at, 0x4000).await?;

        if read >= 0x4000 {
            left -= 0x4000;

            let (offset, carried) = off(at).overflowing_add(0x4000);

            at = far(
                sel(at).wrapping_add(if carried { AHINCR } else { 0 }),
                offset,
            );
            continue;
        }

        if read < 0 {
            return Ok(u32::MAX);
        }

        left -= read as u32;
        break;
    }

    if left < 0x4000 {
        let read = lz_read(engine, handle, at, left as u16).await?;

        if read < 0 {
            return Ok(u32::MAX);
        }

        left = left.wrapping_sub(read as u32);
    }

    Ok(count.wrapping_sub(left))
}

/// `GetFileResource` (seg3 `017e`): a resource's bytes, found or at a
/// place given.
async fn get_file_resource(
    engine: &Engine,
    file: u32,
    kind: u32,
    id: u32,
    offset: u32,
    length: u32,
    data: u32,
) -> Result<u16, Stop> {
    let frame = Frame::new(engine, 0x90);
    let header = frame.at;
    let of = plus(frame.at, 0x40);
    let mut offset = offset;
    let mut length = length;
    let handle;

    if offset == 0 {
        let (opened, found_handle) = open_executable(engine, file, header).await?;

        handle = found_handle;

        if !opened {
            lz_close(engine, handle as u16).await?;

            return Ok(0);
        }

        let Some(found) = find_resource(engine, handle as u16, header, kind, id).await? else {
            lz_close(engine, handle as u16).await?;

            return Ok(0);
        };

        offset = u32::from(found.offset) << found.shift;

        let size = u32::from(found.length) << found.shift;

        if size < length {
            length = size;
        }
    } else {
        let mut opener = lz_open_file(engine, file, of, 0x40).await?;

        if opener < 0 {
            opener = lz_open_file(engine, file, of, 0).await?;
        }

        if opener < 0 {
            return Ok(0);
        }

        handle = opener;
    }

    // Read where it is (seg3 `0776`).
    let h = handle as u16;
    let read = lz_seek(engine, h, offset as i32, 0).await? == offset as i32
        && huge_read(engine, h, data, length).await? == length;

    lz_close(engine, h).await?;

    Ok(u16::from(read))
}

/// `GetFileVersionInfoSize` (seg3 `086e`): the version resource's length
/// -- its block's own, where that is no more than the resource's -- once
/// its first 48h bytes show `VS_FIXEDFILEINFO`'s signature, `FEEF04BDh`, at
/// 14h.
async fn get_file_version_info_size(
    engine: &Engine,
    file: u32,
    handle_at: u32,
) -> Result<u32, Stop> {
    let size = get_file_resource_size(engine, file, RT_VERSION, 1, handle_at).await?;

    if size == 0 {
        return Ok(0);
    }

    let frame = Frame::new(engine, 0x48);
    let at = frame.at;
    let handle = rd32(engine, handle_at);

    if get_file_resource(engine, file, RT_VERSION, 1, handle, 0x48, at).await? == 0 {
        return Ok(0);
    }

    let length = rd16(engine, at);

    if u32::from(length) > size
        || rd16(engine, plus(at, 0x14)) != 0x04bd
        || rd16(engine, plus(at, 0x16)) != 0xfeef
    {
        return Ok(0);
    }

    Ok(u32::from(length))
}

/// `GetFileVersionInfo` (seg3 `0906`): `GetFileResource` of the version
/// resource.
async fn get_file_version_info(
    engine: &Engine,
    file: u32,
    handle: u32,
    length: u32,
    data: u32,
) -> Result<u16, Stop> {
    get_file_resource(engine, file, RT_VERSION, 1, handle, length, data).await
}

/// `VerQueryValue` (seg3 `0943`): a value of a version block by its path.
/// Each part, the backslashes before it passed over, is looked for among
/// the children of the block found last, by USER's `lstrcmpi`; a block
/// must have room for itself in what is left of the whole, and a child
/// must be longer than five bytes. The block's last byte is made nought
/// while it is walked, and the path's separator each part ends at, and
/// both put back.
async fn ver_query_value(
    engine: &Engine,
    block: u32,
    sub_block: u32,
    buffer_at: u32,
    length_at: u32,
) -> Result<u16, Stop> {
    let mut at = block;
    let mut path = sub_block;

    if (rd16(engine, at) as i16) < 5 {
        return Ok(0);
    }

    let end_offset = off(at).wrapping_add(rd16(engine, at)).wrapping_sub(1);
    let end = far(sel(at), end_offset);
    let last = rd8(engine, end);

    wr8(engine, end, 0);

    while rd8(engine, path) != 0 {
        while rd8(engine, path) == b'\\' {
            path = plus(path, 1);
        }

        if rd8(engine, path) == 0 {
            break;
        }

        let room = end_offset.wrapping_sub(off(at)).wrapping_add(1);

        if (room as i16) < 5 || room < rd16(engine, at) {
            wr8(engine, end, last);

            return Ok(0);
        }

        let key = lstrlen(engine, plus(at, 4)).await?.wrapping_add(4) & 0xfffc;
        let first = (rd16(engine, plus(at, 2)).wrapping_add(3) & 0xfffc)
            .wrapping_add(key)
            .wrapping_add(4);

        if rd16(engine, at) < first {
            wr8(engine, end, last);

            return Ok(0);
        }

        let block_end = off(at).wrapping_add(rd16(engine, at));

        at = plus(at, first);

        let start = path;

        while rd8(engine, path) != 0 && rd8(engine, path) != b'\\' {
            path = plus(path, 1);
        }

        let separator = rd8(engine, path);

        wr8(engine, path, 0);

        let mut compared = 1;

        loop {
            let length = rd16(engine, at) as i16;

            if length <= 5 || (block_end.wrapping_sub(off(at)) as i16) < length {
                break;
            }

            compared = lstrcmpi(engine, start, plus(at, 4)).await?;

            if compared == 0 {
                break;
            }

            at = plus(at, rd16(engine, at).wrapping_add(3) & 0xfffc);
        }

        wr8(engine, path, separator);

        if compared != 0 {
            wr8(engine, end, last);

            return Ok(0);
        }
    }

    if length_at != 0 {
        wr16(engine, length_at, rd16(engine, plus(at, 2)));
    }

    let key = lstrlen(engine, plus(at, 4)).await?.wrapping_add(4) & 0xfffc;

    wr32(
        engine,
        buffer_at,
        far(sel(at), off(at).wrapping_add(key).wrapping_add(4)),
    );
    wr8(engine, end, last);

    Ok(1)
}

/// `VerLanguageName` (seg3 `1599`): a language's name, VER's string of its
/// number, else of nought, "Unknown Language", cut to the buffer; its whole
/// length answered. A buffer of nought is given the whole name.
#[allow(clippy::unnecessary_wraps)]
fn ver_language_name(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let language = args.word(system);
    let to = args.dword(system);
    let size = usize::from(args.word(system));
    let name = LANGUAGES
        .iter()
        .find(|&&(number, _)| number == language)
        .map_or(UNKNOWN_LANGUAGE, |&(_, name)| name)
        .as_bytes();
    let length = name.len();
    let mut copy = if size <= length && size > 0 {
        name[..size - 1].to_vec()
    } else {
        name.to_vec()
    };

    copy.push(0);
    system.write_far(to, &copy);

    Ok(Answer::Word(length as u16))
}

/// A folder and a name joined (seg3 `1192`): the folder copied, a
/// backslash added where it ends in neither one nor a colon, and the name
/// after. The folder's length with its backslash.
fn join(folder: &[u8], name: &[u8]) -> (Vec<u8>, usize) {
    let mut out = folder.to_vec();

    if let Some(&last) = out.last()
        && last != b'\\'
        && last != b':'
    {
        out.push(b'\\');
    }

    let length = out.len();

    out.extend_from_slice(name);
    (out, length)
}

/// Whether a file is a module loaded from it (seg3 `113a`):
/// `GetModuleHandle` of its name, and the module's file the path, by
/// `lstrcmpi`.
async fn in_use(engine: &Engine, path: &[u8], name: u32) -> Result<bool, Stop> {
    let module = api::word(engine, "KERNEL", "GetModuleHandle", &[Arg::D(name)]).await?;

    if module <= 1 {
        return Ok(false);
    }

    let file = api::api(
        engine,
        "KERNEL",
        "GetModuleFilename",
        &[Arg::W(module), api::buffer(0x104), Arg::W(0x104)],
    )
    .await?;
    let compared = api::word(
        engine,
        "USER",
        "lstrcmpi",
        &[api::text(path), api::text(&file.string(0))],
    )
    .await?;

    Ok(compared == 0)
}

/// A file looked for in folders (seg3 `1200`): in each, while there is
/// room for the name, by `OpenFile`'s `OF_EXIST`; then the name alone,
/// where `OpenFile` looks. That backslash's place, or nought, and the
/// folder it was found in -- `OpenFile`'s path to its last backslash, the
/// root's kept, cut to `size` and made ANSI.
async fn find_in(
    engine: &Engine,
    file: u32,
    size: u16,
    folders: &[u32],
) -> Result<(u16, Vec<u8>), Stop> {
    let name = string_at(engine, file);
    let length = lstrlen(engine, file).await?;
    let mut first = true;
    let mut index = 0;

    loop {
        let path = if first && index < folders.len() && folders[index] != 0 {
            let folder = folders[index];

            if lstrlen(engine, folder).await?.wrapping_add(length) >= 0x103 {
                index += 1;
                continue;
            }

            join(&string_at(engine, folder), &name).0
        } else if first {
            first = false;
            name.clone()
        } else {
            return Ok((0, Vec::new()));
        };
        let opened = api::api(
            engine,
            "KERNEL",
            "OpenFile",
            &[api::text(&path), api::buffer(136), Arg::W(0x4000)],
        )
        .await?;

        if opened.word() == 0xffff {
            index += 1;

            if !first {
                return Ok((0, Vec::new()));
            }

            continue;
        }

        let found = &opened.buffers[1][8..];
        let whole = &found[..found.iter().position(|&b| b == 0).unwrap_or(found.len())];
        let mut slash = whole.iter().rposition(|&b| b == b'\\').unwrap_or(0) as u16;

        if slash <= 3 {
            slash += 1;
        }

        let cut = usize::from(if size.wrapping_sub(1) < slash {
            size.wrapping_sub(1)
        } else {
            slash
        });
        let folder = &whole[..cut.min(whole.len())];
        let ansi = api::api(
            engine,
            "KEYBOARD",
            "OemToAnsi",
            &[api::text(folder), api::buffer(folder.len() + 1)],
        )
        .await?;

        return Ok((slash, ansi.string(1)));
    }
}

const VFFF_ISSHAREDFILE: u16 = 1;
const VFF_CURNEDEST: u16 = 1;
const VFF_FILEINUSE: u16 = 2;
const VFF_BUFFTOOSMALL: u16 = 4;

/// Whether the system folder's first `n` bytes are Windows' folder, by
/// `lstrcmpi`.
async fn within(engine: &Engine, system_dir: u32, windows: u32, n: u16) -> Result<bool, Stop> {
    let at = plus(system_dir, n);
    let kept = rd8(engine, at);

    wr8(engine, at, 0);

    let compared = lstrcmpi(engine, windows, system_dir).await?;

    wr8(engine, at, kept);

    Ok(compared == 0)
}

/// Where a file should go, given back as `VerFindFile` gives it (seg3 `14ec`).
async fn to_dest(
    engine: &Engine,
    mut result: u16,
    dest: u32,
    length: u16,
    dest_dir: u32,
    cur_dir: u32,
    dest_length_at: u32,
) -> Result<u16, Stop> {
    if rd16(engine, dest_length_at) > length {
        lstrcpy(engine, dest_dir, dest).await?;

        let n = lstrlen(engine, dest_dir).await?;

        if n != 0 && rd8(engine, plus(dest_dir, n - 1)) == b'\\' {
            wr8(engine, plus(dest_dir, n - 1), 0);
        }

        if lstrcmpi(engine, cur_dir, dest_dir).await? != 0 {
            result |= VFF_CURNEDEST;
        }
    } else {
        result |= VFF_BUFFTOOSMALL;
    }

    wr16(engine, dest_length_at, length.wrapping_add(1));

    Ok(result)
}

/// `VerFindFile` (seg3 `1315`): where a file is, and where it should go.
/// Windows' folder is asked for, whatever `szWinDir` says. The file is
/// looked for in the program's folder, Windows' and the system's -- the
/// program's last for a shared file -- then where `OpenFile` looks. A
/// shared file goes in the system folder where that is inside Windows',
/// in Windows' otherwise; another in the program's folder.
#[allow(clippy::too_many_arguments)]
async fn ver_find_file(
    engine: &Engine,
    flags: u16,
    file: u32,
    app_dir: u32,
    cur_dir: u32,
    cur_length_at: u32,
    dest_dir: u32,
    dest_length_at: u32,
) -> Result<u16, Stop> {
    let mut result = 0;
    let frame = Frame::new(engine, 0x210);
    let windows = frame.at;
    let system_dir = plus(frame.at, 0x108);
    let windows_call = api::api(
        engine,
        "KERNEL",
        "GetWindowsDirectory",
        &[api::buffer(0x104), Arg::W(0x104)],
    )
    .await?;

    write_string(engine, windows, &windows_call.string(0));

    let system_call = api::api(
        engine,
        "KERNEL",
        "GetSystemDirectory",
        &[api::buffer(0x104), Arg::W(0x104)],
    )
    .await?;

    write_string(
        engine,
        system_dir,
        &if system_call.word() == 0 {
            windows_call.string(0)
        } else {
            system_call.string(0)
        },
    );

    let shared = flags & VFFF_ISSHAREDFILE != 0;
    let folders = if shared {
        [windows, system_dir, app_dir]
    } else {
        [app_dir, windows, system_dir]
    };
    let (length, found) = find_in(engine, file, 0x104, &folders).await?;
    let current = if length != 0 { found } else { Vec::new() };

    if rd16(engine, cur_length_at) > length {
        let copy = Frame::new(engine, current.len() as u16 + 2);

        write_string(engine, copy.at, &current);
        lstrcpy(engine, cur_dir, copy.at).await?;
    } else {
        result |= VFF_BUFFTOOSMALL;
    }

    wr16(engine, cur_length_at, length.wrapping_add(1));

    if dest_dir != 0 {
        if shared {
            let windows_name = string_at(engine, windows);
            let system_name = string_at(engine, system_dir);
            let n = windows_name.len();
            let at = |index: usize| system_name.get(index).copied().unwrap_or(0);
            let chosen = if n != 0 && windows_name[n - 1] == b'\\' {
                if at(n - 1) == b'\\' && within(engine, system_dir, windows, n as u16).await? {
                    system_name.clone()
                } else if at(n - 1) != b'\\' {
                    Vec::new()
                } else {
                    windows_name.clone()
                }
            } else if at(n) == b'\\' && within(engine, system_dir, windows, n as u16).await? {
                system_name.clone()
            } else {
                windows_name.clone()
            };
            let copy = Frame::new(engine, chosen.len() as u16 + 2);

            write_string(engine, copy.at, &chosen);
            result = to_dest(
                engine,
                result,
                copy.at,
                chosen.len() as u16,
                dest_dir,
                cur_dir,
                dest_length_at,
            )
            .await?;
        } else {
            let length = lstrlen(engine, app_dir).await?;

            result = to_dest(
                engine,
                result,
                app_dir,
                length,
                dest_dir,
                cur_dir,
                dest_length_at,
            )
            .await?;
        }
    }

    if current.first().is_some_and(|&b| b != 0) {
        let (path, _) = join(&current, &string_at(engine, file));

        if in_use(engine, &path, file).await? {
            result |= VFF_FILEINUSE;
        }
    }

    Ok(result)
}

const VIFF_FORCEINSTALL: u16 = 1;
const VIFF_DONTDELETEOLD: u16 = 2;
const VIF_TEMPFILE: u32 = 0x1;
const VIF_MISMATCH: u32 = 0x2;
const VIF_SRCOLD: u32 = 0x4;
const VIF_DIFFLANG: u32 = 0x8;
const VIF_DIFFTYPE: u32 = 0x20;
const VIF_WRITEPROT: u32 = 0x40;
const VIF_FILEINUSE: u32 = 0x80;
const VIF_OUTOFSPACE: u32 = 0x100;
const VIF_CANNOTCREATE: u32 = 0x800;
const VIF_CANNOTDELETE: u32 = 0x1000;
const VIF_CANNOTRENAME: u32 = 0x2000;
const VIF_CANNOTDELETECUR: u32 = 0x4000;
const VIF_OUTOFMEMORY: u32 = 0x8000;
const VIF_CANNOTREADSRC: u32 = 0x10000;
const VIF_BUFFTOOSMALL: u32 = 0x40000;

/// DOS's error as a VIF flag (seg3 `0b42`): access denied, sharing
/// violation, or none.
const fn dos_error(code: u16) -> u32 {
    match code {
        5 => 0x200,
        0x20 => 0x400,
        _ => 0,
    }
}

/// A DOS call: AX, DS:DX and ES:DI a path each, as given; the carry, AX and
/// CX after.
async fn dos(
    engine: &Engine,
    ax: u16,
    first: u32,
    second: Option<u32>,
) -> Result<(bool, u16, u16), Stop> {
    let saved = {
        let mut system = engine.system();
        let cpu = &mut system.cpu;
        let saved = (
            cpu.regs[AX],
            cpu.regs[CX],
            cpu.regs[DX],
            cpu.regs[DI],
            cpu.segments[DS].selector,
            cpu.segments[ES].selector,
            cpu.flags,
        );

        cpu.regs[AX] = ax;
        cpu.load_segment(DS, sel(first)).map_err(Stop::Processor)?;
        cpu.regs[DX] = off(first);

        if let Some(second) = second {
            cpu.load_segment(ES, sel(second)).map_err(Stop::Processor)?;
            cpu.regs[DI] = off(second);
        }

        saved
    };

    api::api(engine, "KERNEL", "Dos3Call", &[]).await?;

    let mut system = engine.system();
    let cpu = &mut system.cpu;
    let after = (cpu.flags & 1 != 0, cpu.regs[AX], cpu.regs[CX]);

    cpu.regs[AX] = saved.0;
    cpu.regs[CX] = saved.1;
    cpu.regs[DX] = saved.2;
    cpu.regs[DI] = saved.3;
    cpu.load_segment(DS, saved.4).map_err(Stop::Processor)?;
    cpu.load_segment(ES, saved.5).map_err(Stop::Processor)?;
    cpu.flags = saved.6;

    Ok(after)
}

/// A path made OEM, on the stack (a frame the caller keeps).
async fn oem<'a>(engine: &'a Engine, path: &[u8]) -> Result<Frame<'a>, Stop> {
    let frame = Frame::new(engine, 0x104);
    let called = api::api(
        engine,
        "KEYBOARD",
        "AnsiToOem",
        &[api::text(path), api::buffer(0x104)],
    )
    .await?;

    write_string(engine, frame.at, &called.string(1));

    Ok(frame)
}

/// A file's attributes (seg3 `0ac2`, DOS 4300h on its OEM name): the
/// attributes, or none where it is not there.
async fn attributes(engine: &Engine, path: &[u8]) -> Result<Option<u16>, Stop> {
    let name = oem(engine, path).await?;
    let (carry, _, cx) = dos(engine, 0x4300, name.at, None).await?;

    Ok((!carry).then_some(cx))
}

/// A file made, or deleted, by `OpenFile` (seg3 `0b63`, `0b94`): its answer,
/// its error kept (`[50h]`).
async fn open_file(engine: &Engine, path: &[u8], style: u16, kept: &mut u16) -> Result<i16, Stop> {
    let called: Called = api::api(
        engine,
        "KERNEL",
        "OpenFile",
        &[api::text(path), api::buffer(136), Arg::W(style)],
    )
    .await?;
    let of = &called.buffers[1];

    *kept = u16::from_le_bytes([of[2], of[3]]);

    Ok(called.word() as i16)
}

/// A file renamed (seg3 `0bd6`, DOS 5600h on the OEM names): DOS's error,
/// or nought.
async fn rename(engine: &Engine, from: &[u8], to: &[u8], kept: &mut u16) -> Result<u16, Stop> {
    let old = oem(engine, from).await?;
    let fresh = oem(engine, to).await?;
    let (carry, ax, _) = dos(engine, 0x5600, old.at, Some(fresh.at)).await?;

    *kept = if carry { ax } else { 0 };

    Ok(*kept)
}

/// A file's version information, in a block of memory of its own (seg3
/// `0c34`): asked for in 800h bytes, and again in as many as its block
/// says where that is more. The block's far pointer and handle.
///
/// VER keeps it in its own local heap; here it is a global block, freed as
/// VER frees its own.
async fn version_of(engine: &Engine, path: &[u8]) -> Result<Option<(u32, u16)>, Stop> {
    let mut size = 0x800_u32;

    loop {
        let handle = crate::lzexpand::global_alloc(engine, 0x42, size).await?;

        if handle == 0 {
            return Ok(None);
        }

        let at = crate::lzexpand::global_lock(engine, handle).await?;
        let got = {
            let name = Frame::new(engine, path.len() as u16 + 2);

            write_string(engine, name.at, path);
            get_file_version_info(engine, name.at, 0, size, at).await?
        };

        if got == 0 {
            crate::lzexpand::global_free(engine, handle).await?;

            return Ok(None);
        }

        if u32::from(rd16(engine, at)) > size {
            size = u32::from(rd16(engine, at));
            crate::lzexpand::global_free(engine, handle).await?;
            continue;
        }

        return Ok(Some((at, handle)));
    }
}

/// A version block's `\VarFileInfo\Translation`: its far pointer and its
/// count of languages.
async fn translations(engine: &Engine, at: u32) -> Result<Option<(u32, u16)>, Stop> {
    let frame = Frame::new(engine, 0x30);
    let path = frame.at;
    let value = plus(frame.at, 0x1a);
    let length = plus(frame.at, 0x1e);

    write_string(engine, path, b"\\VarFileInfo\\Translation");

    if ver_query_value(engine, at, path, value, length).await? == 0 {
        return Ok(None);
    }

    Ok(Some((rd32(engine, value), rd16(engine, length) >> 2)))
}

/// The installed file's version and the new one's compared (seg3 `0e72`):
/// an installed version later than the new one's is `VIF_SRCOLD`; another
/// type or subtype `VIF_DIFFTYPE`; a language of the installed one's that
/// the new one lacks `VIF_DIFFLANG` -- an installed code page of nought
/// agreeing with any but 1200 -- each with `VIF_MISMATCH`. New information
/// not to be read is `VIF_SRCOLD`; installed information not to be read
/// is no difference.
async fn compare(engine: &Engine, dest: &[u8], temporary: &[u8]) -> Result<u32, Stop> {
    let mut result = 0;
    let Some((installed, installed_handle)) = version_of(engine, dest).await? else {
        return Ok(0);
    };
    let Some((fresh, fresh_handle)) = version_of(engine, temporary).await? else {
        crate::lzexpand::global_free(engine, installed_handle).await?;

        return Ok(VIF_MISMATCH | VIF_SRCOLD);
    };
    let was = |at: u16| rd32(engine, plus(installed, at));
    let is = |at: u16| rd32(engine, plus(fresh, at));

    if was(0x1c) > is(0x1c) || (was(0x1c) == is(0x1c) && was(0x20) > is(0x20)) {
        result |= VIF_MISMATCH | VIF_SRCOLD;
    }

    if was(0x38) != is(0x38) || was(0x3c) != is(0x3c) {
        result |= VIF_MISMATCH | VIF_DIFFTYPE;
    }

    if let Some((old_at, old_count)) = translations(engine, installed).await?
        && let Some((new_at, new_count)) = translations(engine, fresh).await?
    {
        for i in 0..old_count {
            let language = rd16(engine, plus(old_at, 4 * i));
            let page = rd16(engine, plus(old_at, 4 * i + 2));
            let mut found = false;

            for j in 0..new_count {
                if rd16(engine, plus(new_at, 4 * j)) != language {
                    continue;
                }

                let new_page = rd16(engine, plus(new_at, 4 * j + 2));

                if (page == 0 && new_page != 0x4b0) || page == new_page {
                    found = true;
                    break;
                }
            }

            if !found {
                result |= VIF_MISMATCH | VIF_DIFFLANG;
            }
        }
    }

    crate::lzexpand::global_free(engine, fresh_handle).await?;
    crate::lzexpand::global_free(engine, installed_handle).await?;

    Ok(result)
}

/// `VerInstallFile` (seg3 `0c9a`): a file copied, expanded, into a
/// temporary file beside where it goes, compared with what is there, and
/// put in its place.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
async fn ver_install_file(
    engine: &Engine,
    flags: u16,
    src_file: u32,
    dest_file: u32,
    src_dir: u32,
    dest_dir: u32,
    cur_dir: u32,
    tmp_file: u32,
    tmp_length_at: u32,
) -> Result<u32, Stop> {
    let mut kept = 0_u16;
    let mut result = 0_u32;
    let (source, _) = join(&string_at(engine, src_dir), &string_at(engine, src_file));
    let source_handle = {
        let frame = Frame::new(engine, 0x90 + source.len() as u16 + 2);

        write_string(engine, plus(frame.at, 0x90), &source);
        lz_open_file(engine, plus(frame.at, 0x90), frame.at, 0).await?
    };

    if source_handle < 0 {
        return Ok(VIF_CANNOTREADSRC);
    }

    let source_handle = source_handle as u16;
    let (dest, folder_length) = join(&string_at(engine, dest_dir), &string_at(engine, dest_file));
    let mut temporary = dest.clone();
    let dest_attributes = attributes(engine, &dest).await?;
    let mut made = true;

    if let Some(attributes) = dest_attributes {
        if attributes & 1 != 0 {
            lz_close(engine, source_handle).await?;

            return Ok(result | VIF_WRITEPROT);
        }

        if in_use(engine, &dest, dest_file).await? {
            lz_close(engine, source_handle).await?;

            return Ok(result | VIF_FILEINUSE);
        }
    }

    // A temporary file given, forcing, and there: it is used.
    if flags & VIFF_FORCEINSTALL != 0 && rd8(engine, tmp_file) != 0 {
        temporary = join(&string_at(engine, dest_dir), &string_at(engine, tmp_file)).0;

        if attributes(engine, &temporary).await?.is_some() {
            made = false;
        }
    }

    if made {
        temporary = dest[..folder_length].to_vec();
        temporary.extend_from_slice(b"temp.");

        let mut i: u16 = 0;

        loop {
            temporary.truncate(folder_length + 5);

            for shift in [8, 4, 0] {
                let digit = ((i >> shift) & 0xf) as u8;

                temporary.push(if digit < 10 {
                    b'0' + digit
                } else {
                    0x37 + digit
                });
            }

            if attributes(engine, &temporary).await?.is_none() {
                break;
            }

            if i > 0xfff {
                lz_close(engine, source_handle).await?;

                return Ok(result | VIF_CANNOTCREATE);
            }

            i += 1;
        }

        let handle = open_file(engine, &temporary, 0x1000, &mut kept).await?;

        if handle < 0 {
            lz_close(engine, source_handle).await?;

            return Ok(result | dos_error(kept) | VIF_CANNOTCREATE);
        }

        let copied = lz_copy(engine, source_handle, handle as u16).await?;

        api::api(engine, "KERNEL", "_lclose", &[Arg::W(handle as u16)]).await?;

        if (-8..0).contains(&copied) {
            const FAILED: [u32; 8] = [
                VIF_CANNOTREADSRC,
                VIF_OUTOFSPACE,
                VIF_CANNOTREADSRC,
                VIF_OUTOFSPACE,
                VIF_OUTOFMEMORY,
                VIF_OUTOFMEMORY,
                VIF_CANNOTREADSRC,
                VIF_CANNOTREADSRC,
            ];

            result |= FAILED[(-copied - 1) as usize];
            open_file(engine, &temporary, 0x200, &mut kept).await?;
            lz_close(engine, source_handle).await?;

            return Ok(result);
        }
    }

    if dest_attributes.is_some() {
        if flags & VIFF_FORCEINSTALL == 0 {
            result |= compare(engine, &dest, &temporary).await?;
        }

        // The installed file deleted.
        if result == 0 && open_file(engine, &dest, 0x200, &mut kept).await? < 0 {
            result |= dos_error(kept) | VIF_CANNOTDELETE;
            open_file(engine, &temporary, 0x200, &mut kept).await?;
            lz_close(engine, source_handle).await?;

            return Ok(result);
        }
    }

    if result != 0 {
        // Left in the temporary file: its name given back, where there is room.
        let name = &temporary[folder_length..];

        if name.len() < usize::from(rd16(engine, tmp_length_at)) {
            write_string(engine, tmp_file, name);
            result |= VIF_TEMPFILE;
        } else {
            result |= VIF_BUFFTOOSMALL;
            open_file(engine, &temporary, 0x200, &mut kept).await?;
        }

        wr16(engine, tmp_length_at, name.len() as u16 + 1);
        lz_close(engine, source_handle).await?;

        return Ok(result);
    }

    // The copy where it was found before, deleted.
    if flags & VIFF_DONTDELETEOLD == 0
        && cur_dir != 0
        && rd8(engine, cur_dir) != 0
        && lstrcmpi(engine, cur_dir, dest_dir).await? != 0
    {
        let (old, _) = join(&string_at(engine, cur_dir), &string_at(engine, dest_file));

        kept = 0;

        if attributes(engine, &old).await?.is_some()
            && (in_use(engine, &old, dest_file).await?
                || open_file(engine, &old, 0x200, &mut kept).await? < 0)
        {
            result |= dos_error(kept) | VIF_CANNOTDELETECUR;
        }
    }

    if rename(engine, &temporary, &dest, &mut kept).await? != 0 {
        result |= dos_error(kept) | VIF_CANNOTRENAME;
        open_file(engine, &temporary, 0x200, &mut kept).await?;
    }

    lz_close(engine, source_handle).await?;

    Ok(result)
}

/// VER's exit procedure (seg1 `0000`): 1.
#[allow(clippy::unnecessary_wraps)]
fn wep(_: &mut System, _: &mut Args) -> Result<Answer, Stop> {
    Ok(Answer::Word(1))
}

fn get_file_resource_size_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (file, kind, id, offset) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            get_file_resource_size(engine, file, kind, id, offset).await?,
        ))
    })
}

fn get_file_resource_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (file, kind, id, offset, length, data) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Word(
            get_file_resource(engine, file, kind, id, offset, length, data).await?,
        ))
    })
}

fn get_file_version_info_size_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (file, handle) = {
            let system = engine.system();

            (args.dword(&system), args.dword(&system))
        };

        Ok(Answer::Dword(
            get_file_version_info_size(engine, file, handle).await?,
        ))
    })
}

fn get_file_version_info_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (file, handle, length, data) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Word(
            get_file_version_info(engine, file, handle, length, data).await?,
        ))
    })
}

fn ver_find_file_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (flags, file, _windows, app, cur, cur_length, dest, dest_length) = {
            let system = engine.system();

            (
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Word(
            ver_find_file(engine, flags, file, app, cur, cur_length, dest, dest_length).await?,
        ))
    })
}

fn ver_install_file_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (flags, src_file, dest_file, src_dir, dest_dir, cur_dir, tmp_file, tmp_length) = {
            let system = engine.system();

            (
                args.word(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Dword(
            ver_install_file(
                engine, flags, src_file, dest_file, src_dir, dest_dir, cur_dir, tmp_file,
                tmp_length,
            )
            .await?,
        ))
    })
}

fn ver_query_value_export(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (block, sub_block, buffer, length) = {
            let system = engine.system();

            (
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
                args.dword(&system),
            )
        };

        Ok(Answer::Word(
            ver_query_value(engine, block, sub_block, buffer, length).await?,
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::Kept;

    /// Each export WinBox answers here is one the TypeScript engine
    /// answers, and no other: its table is `kept.rs`'s.
    #[test]
    fn ours_agree() {
        let kept = Kept::named(NAME).expect("VER kept");

        for export in kept.exports.iter().flatten() {
            assert_eq!(
                implementation(export.name).is_some(),
                !export.stub,
                "{} answered by one engine only",
                export.name
            );
        }
    }

    #[test]
    fn joins_as_ver_joins() {
        assert_eq!(join(b"C:\\A", b"B.DLL"), (b"C:\\A\\B.DLL".to_vec(), 5));
        assert_eq!(join(b"C:\\", b"B.DLL"), (b"C:\\B.DLL".to_vec(), 3));
        assert_eq!(join(b"C:", b"B.DLL"), (b"C:B.DLL".to_vec(), 2));
        assert_eq!(join(b"", b"B.DLL"), (b"B.DLL".to_vec(), 0));
    }
}
