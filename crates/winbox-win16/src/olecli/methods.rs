//! The methods of WinBox's objects, by the ordinal of the export each is:
//! what an `Ole` function finds in an object's table and calls, and what a
//! program calling the table itself reaches.

use super::core::{
    Kind, OLE_ERROR_GENERIC, OLE_ERROR_MEMORY, OLE_ERROR_NOT_EQUAL, OLE_ERROR_STATIC, OLE_OK, Ole,
    R,
};
use super::draw::draw;
use super::kinds::{
    change_data, clone, copy_to_clipboard, enum_format, equal, gen_set_data, get_data,
    query_bounds, query_size, release, save_to_stream,
};
use super::objects::{kind_of, query_name, query_type, rename};

/// The methods a static object refuses, the `ERR` exports and the unnamed
/// entries its table holds (**measured** by `olemem`'s `direct` records,
/// each called through the table): `OLE_ERROR_STATIC`, but `ERRSETDATA`
/// and `ERRSETBOUNDS` `OLE_ERROR_MEMORY`, `ERRQUERYOUTOFDATE` `OLE_OK`,
/// and `ERRQUERYPROTOCOL` NULL. `ERRGETUPDATEOPTIONS` writes nothing.
pub(crate) const fn refused(ordinal: u16) -> Option<u16> {
    Some(match ordinal {
        702 | 705 => OLE_ERROR_MEMORY,
        712 => 0,
        713 => OLE_OK,
        609 | 1030 => OLE_ERROR_GENERIC,
        701 | 703 | 704 | 706..=711 | 714..=718 | 1026..=1029 => OLE_ERROR_STATIC,
        _ => return None,
    })
}

/// What a kind's own method export does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Op {
    Release,
    GetData,
    SetData,
    Save,
    Clone,
    Equal,
    Copy,
    Bounds,
    Draw,
    Enum,
    Change,
}

/// A kind's method export: its kind and what it does. A static kind's at
/// its hundred, 300, 400, 500, in one order; another class's at 600, its
/// `SetData` (602) among them.
const fn op_of(ordinal: u16) -> Option<(Kind, Op)> {
    const STATIC: [Option<Op>; 11] = [
        Some(Op::Release),
        Some(Op::GetData),
        Some(Op::Save),
        Some(Op::Clone),
        Some(Op::Equal),
        Some(Op::Copy),
        None,
        Some(Op::Bounds),
        Some(Op::Draw),
        Some(Op::Enum),
        Some(Op::Change),
    ];
    const OTHER: [Option<Op>; 12] = [
        Some(Op::Release),
        Some(Op::GetData),
        Some(Op::SetData),
        Some(Op::Save),
        Some(Op::Clone),
        Some(Op::Equal),
        Some(Op::Copy),
        None,
        Some(Op::Bounds),
        Some(Op::Draw),
        Some(Op::Enum),
        Some(Op::Change),
    ];
    let (kind, at) = match ordinal {
        300..=310 => (Kind::Mf, ordinal - 300),
        400..=410 => (Kind::Bm, ordinal - 400),
        500..=510 => (Kind::Dib, ordinal - 500),
        600..=611 => (Kind::Gen, ordinal - 600),
        _ => return None,
    };
    let op = if matches!(kind, Kind::Gen) {
        OTHER[at as usize]
    } else {
        STATIC[at as usize]
    };

    match op {
        Some(op) => Some((kind, op)),
        None => None,
    }
}

/// A method of WinBox's by its ordinal, called with its arguments, the
/// object first.
pub(crate) async fn call_own_method(ole: &Ole<'_>, ordinal: u16, args: &[u32]) -> R<u32> {
    let arg = |at: usize| args.get(at).copied().unwrap_or(0);
    let object = arg(0);

    if let Some(answer) = refused(ordinal) {
        return Ok(u32::from(answer));
    }

    if let Some(answer) = super::linked::method(ole, ordinal, args).await? {
        return Ok(answer);
    }

    let answer = match ordinal {
        910 => query_name(ole, object, arg(1), arg(2)).await?,
        911 => rename(ole, object, arg(1)).await?,
        912 => query_type(ole, object, arg(1)),
        913 if super::linked::is_le(ole, object) => {
            super::linked::query_size(ole, object, arg(1)).await?
        }
        913 => {
            let kind = kind_of(ole, object).unwrap_or(Kind::Gen);

            query_size(ole, kind, object, arg(1)).await?
        }
        _ => {
            let Some((base, op)) = op_of(ordinal) else {
                return Ok(0);
            };
            let kind = kind_of(ole, object).unwrap_or(base);

            match op {
                Op::Release => release(ole, kind, object).await?,
                Op::GetData => get_data(ole, kind, object, arg(1) as u16, arg(2)).await?,
                Op::SetData => gen_set_data(ole, object, arg(1) as u16, arg(2) as u16).await?,
                Op::Save => save_to_stream(ole, kind, object, arg(1)).await?,
                Op::Clone => clone(ole, kind, object, arg(1), arg(2), arg(3), arg(4)).await?,
                Op::Equal => {
                    if kind_of(ole, arg(1)) == Some(kind) {
                        equal(ole, kind, object, arg(1)).await?
                    } else {
                        OLE_ERROR_NOT_EQUAL
                    }
                }
                Op::Copy => copy_to_clipboard(ole, kind, object).await?,
                Op::Bounds => query_bounds(ole, kind, object, arg(1)),
                Op::Draw => draw(ole, kind, object, arg(1) as u16, arg(2), arg(3)).await?,
                Op::Enum => enum_format(ole, kind, object, arg(1) as u16),
                Op::Change => change_data(ole, kind, object, arg(1) as u16, arg(3) as u16).await?,
            }
        }
    };

    Ok(u32::from(answer))
}
