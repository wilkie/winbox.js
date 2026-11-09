//! A program's `OLESTREAM`: its table's `Get` and `Put`, called far with
//! the stream, a far pointer and a count, each answering the bytes it
//! moved (ole.h). What `OLECLI` reads and writes is a field at a time
//! (**recorded** by `olestat`, each `Put`'s count).

use crate::engine::GuestArg;

use super::core::{Ole, R, SCRATCH, plus};

/// `Put`: `count` bytes from a far pointer; whether all went.
pub(crate) async fn put(ole: &Ole<'_>, stream: u32, from: u32, count: u32) -> R<bool> {
    let table = ole.r32(stream);
    let answer = ole
        .call_far(
            ole.r32(plus(table, 4)),
            &[
                GuestArg::Long(stream),
                GuestArg::Long(from),
                GuestArg::Long(count),
            ],
        )
        .await?;

    Ok(answer == count)
}

/// `Get`: `count` bytes to a far pointer; whether all came.
pub(crate) async fn get(ole: &Ole<'_>, stream: u32, to: u32, count: u32) -> R<bool> {
    let table = ole.r32(stream);
    let answer = ole
        .call_far(
            ole.r32(table),
            &[
                GuestArg::Long(stream),
                GuestArg::Long(to),
                GuestArg::Long(count),
            ],
        )
        .await?;

    Ok(answer == count)
}

/// A doubleword written, from `OLECLI`'s scratch.
pub(crate) async fn put_long(ole: &Ole<'_>, stream: u32, value: u32) -> R<bool> {
    let at = ole.near(SCRATCH);

    ole.w32(at, value);
    put(ole, stream, at, 4).await
}

/// Bytes written, from `OLECLI`'s scratch.
pub(crate) async fn put_bytes(ole: &Ole<'_>, stream: u32, bytes: &[u8]) -> R<bool> {
    let at = ole.near(SCRATCH);

    ole.write(at, bytes);
    put(ole, stream, at, bytes.len() as u32).await
}

/// A doubleword read; none where the stream gave fewer than four bytes.
pub(crate) async fn get_long(ole: &Ole<'_>, stream: u32) -> R<Option<u32>> {
    let at = ole.near(SCRATCH);

    Ok(get(ole, stream, at, 4).await?.then(|| ole.r32(at)))
}

/// A length and a string with its nought, as a stream holds a class's
/// name.
pub(crate) async fn put_name(ole: &Ole<'_>, stream: u32, name: &[u8]) -> R<bool> {
    let mut bytes = name.to_vec();

    bytes.push(0);

    Ok(put_long(ole, stream, bytes.len() as u32).await? && put_bytes(ole, stream, &bytes).await?)
}
