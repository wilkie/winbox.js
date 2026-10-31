//! `OLECLI`'s functions a program calls, each its arguments checked and
//! then, for an object, the method its table holds called: what ole.h
//! declares, as the OLE 1.0 programmer's reference describes them, their
//! answers **recorded** by `olestat` and `olemem`. As
//! `src/win16/olecli/api.ts`.

use crate::commdlg::api::Arg;

use super::core::{
    CF_BITMAP, CF_DIB, CF_METAFILEPICT, Kind, Method, OLE_ERROR_ADDRESS, OLE_ERROR_CLASS,
    OLE_ERROR_FORMAT, OLE_ERROR_OBJECT, OLE_ERROR_PROTOCOL, OLE_ERROR_STATIC,
    OLE_ERROR_STATIC_FROM_OTHER_OS, OLE_ERROR_STREAM, OLE_OK, OLERENDER_DRAW, OLERENDER_FORMAT,
    OT_STATIC, Ole, R, SCRATCH,
};
use super::handlers::{Way, make};
use super::kinds::{load_static, static_from_clipboard};
use super::objects::{MethodArg, call_method, doc_error, is_object, name_error, writable};
use super::streams::get;

/// The protocols OLE 1.0 names: embedding and linking, and pictures
/// alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Protocol {
    Std,
    Static,
}

/// A protocol's name, compared as `lstrcmpi` compares.
pub(crate) fn protocol_of(ole: &Ole<'_>, at: u32) -> Option<Protocol> {
    if at == 0 || !ole.readable(at, 1) {
        return None;
    }

    let name = ole.string(at);

    if name.eq_ignore_ascii_case(b"StdFileEditing") {
        Some(Protocol::Std)
    } else if name.eq_ignore_ascii_case(b"Static") {
        Some(Protocol::Static)
    } else {
        None
    }
}

/// An object's method called once the object is found to be one:
/// `OLE_ERROR_OBJECT` where it is not.
pub(crate) async fn method(ole: &Ole<'_>, object: u32, name: Method, args: &[MethodArg]) -> R<u16> {
    if !is_object(ole, object) {
        return Ok(OLE_ERROR_OBJECT);
    }

    Ok(call_method(ole, object, name, args).await? as u16)
}

use MethodArg::{D, W};

/// The first of the errors a call's checks find, or none.
fn first(checks: &[u16]) -> u16 {
    checks
        .iter()
        .copied()
        .find(|check| *check != 0)
        .unwrap_or(0)
}

pub(crate) async fn save_to_stream(ole: &Ole<'_>, object: u32, stream: u32) -> R<u16> {
    if is_object(ole, object) && !writable(ole, stream, 4) {
        return Ok(OLE_ERROR_ADDRESS);
    }

    method(ole, object, Method::SaveToStream, &[D(stream)]).await
}

/// `OleLoadFromStream`: the stream's version and type read, then by the
/// protocol: `Static` reads a static object -- its class's name and what
/// that class keeps -- and `StdFileEditing` an embedded or linked one. A
/// version written by another system is `OLE_ERROR_STATIC_FROM_OTHER_OS`;
/// type nought `OLE_OK` with no object; a type the protocol does not read
/// `OLE_ERROR_PROTOCOL`; a stream that gives fewer bytes than asked for,
/// or a class's name of nought bytes, `OLE_ERROR_STREAM` (**recorded** by
/// `olestat`'s `load` records, where each stops reading).
pub(crate) async fn load_from_stream(
    ole: &Ole<'_>,
    stream: u32,
    protocol: u32,
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
) -> R<u16> {
    let kind = protocol_of(ole, protocol);
    let checked = first(&[
        doc_error(ole, doc),
        if kind.is_some() {
            0
        } else {
            OLE_ERROR_PROTOCOL
        },
        name_error(ole, name),
    ]);

    if checked != 0 {
        return Ok(checked);
    }

    if !writable(ole, out, 4) || !writable(ole, stream, 4) {
        return Ok(OLE_ERROR_ADDRESS);
    }

    ole.w32(out, 0);

    let at = ole.near(SCRATCH);

    if !get(ole, stream, at, 4).await? {
        return Ok(OLE_ERROR_STREAM);
    }

    let version = ole.r32(at);

    if !get(ole, stream, at, 4).await? {
        return Ok(OLE_ERROR_STREAM);
    }

    let kind_of_object = ole.r32(at);
    let embedded_or_linked =
        kind == Some(Protocol::Std) && (kind_of_object == 1 || kind_of_object == 2);

    // An embedded or linked object is read whatever system wrote it
    // (**measured** by `oleemb`'s `other os`).
    if version >> 16 != 0 && !embedded_or_linked {
        return Ok(OLE_ERROR_STATIC_FROM_OTHER_OS);
    }

    if kind_of_object == 0 {
        return Ok(OLE_OK);
    }

    if embedded_or_linked {
        // The class read, then its handler given the rest of the stream,
        // the class as an atom and a format of nought (**measured** by
        // `olehnd`). The atom is the object's, taken by
        // `DefLoadFromStream`; nothing made, its handler's to keep or let
        // go (`unrecorded`).
        let Some(class) = super::linked::get_class(ole, stream).await? else {
            return Ok(OLE_ERROR_STREAM);
        };
        let atom = ole.add_atom_text(&class).await?;

        return make(
            ole,
            Way::Load,
            &class,
            &[
                stream,
                protocol,
                client,
                doc,
                name,
                out,
                kind_of_object,
                u32::from(atom),
                0,
            ],
        )
        .await;
    }

    if kind != Some(Protocol::Static) || kind_of_object != OT_STATIC {
        return Ok(OLE_ERROR_PROTOCOL);
    }

    if !get(ole, stream, at, 4).await? {
        return Ok(OLE_ERROR_STREAM);
    }

    let length = ole.r32(at);

    if length == 0 || length > 0x100 || !get(ole, stream, at, length).await? {
        return Ok(OLE_ERROR_STREAM);
    }

    let class = ole.string(at);

    load_static(ole, stream, &class, client, doc, name, out).await
}

pub(crate) async fn clone(
    ole: &Ole<'_>,
    object: u32,
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
) -> R<u16> {
    if !is_object(ole, object) {
        return Ok(OLE_ERROR_OBJECT);
    }

    let checked = first(&[
        doc_error(ole, doc),
        name_error(ole, name),
        if writable(ole, out, 4) {
            0
        } else {
            OLE_ERROR_ADDRESS
        },
    ]);

    if checked != 0 {
        return Ok(checked);
    }

    method(
        ole,
        object,
        Method::Clone,
        &[D(client), D(doc), D(name), D(out)],
    )
    .await
}

/// `OleCopyFromLink` and `OleObjectConvert`: the document checked before
/// the method is called (**measured** by `olemem`: `OLE_ERROR_HANDLE` for
/// nought, where the method answers `OLE_ERROR_STATIC`).
pub(crate) async fn copy_from_link(
    ole: &Ole<'_>,
    object: u32,
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
) -> R<u16> {
    if !is_object(ole, object) {
        return Ok(OLE_ERROR_OBJECT);
    }

    let checked = doc_error(ole, doc);

    if checked != 0 {
        return Ok(checked);
    }

    method(
        ole,
        object,
        Method::CopyFromLink,
        &[D(client), D(doc), D(name), D(out)],
    )
    .await
}

pub(crate) async fn object_convert(
    ole: &Ole<'_>,
    object: u32,
    protocol: u32,
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
) -> R<u16> {
    if !is_object(ole, object) {
        return Ok(OLE_ERROR_OBJECT);
    }

    let checked = doc_error(ole, doc);

    if checked != 0 {
        return Ok(checked);
    }

    method(
        ole,
        object,
        Method::ObjectConvert,
        &[D(protocol), D(client), D(doc), D(name), D(out)],
    )
    .await
}

pub(crate) async fn equal(ole: &Ole<'_>, a: u32, b: u32) -> R<u16> {
    if !is_object(ole, b) {
        return Ok(OLE_ERROR_OBJECT);
    }

    method(ole, a, Method::Equal, &[D(b)]).await
}

/// The static formats on the clipboard, in the order asked for: a
/// picture, a DIB, a bitmap.
const STATIC_FORMATS: [u16; 3] = [CF_METAFILEPICT, CF_DIB, CF_BITMAP];

async fn available(ole: &Ole<'_>, format: u16) -> R<bool> {
    Ok(ole
        .user("IsClipboardFormatAvailable", &[Arg::W(format)])
        .await? as u16
        != 0)
}

/// `OleQueryCreateFromClip(protocol, render, format)` and
/// `OleQueryLinkFromClip`: for `Static`, drawn, whether a picture, a DIB
/// or a bitmap is on the clipboard; in a format, whether that one is; with
/// no rendering `OLE_ERROR_FORMAT`. For `StdFileEditing`, whether
/// `cfOwnerLink` (`cfObjectLink` for a link) is, after `cfFileName` -- not
/// yet whether its server can embed. Another protocol `OLE_ERROR_PROTOCOL`
/// (**recorded** by `olestat`; the formats asked about seen as WinBox ran
/// `OLECLI.DLL`).
pub(crate) async fn query_from_clip(
    ole: &Ole<'_>,
    protocol: u32,
    render: u16,
    format: u16,
    link: bool,
) -> R<u16> {
    let kind = protocol_of(ole, protocol);

    if kind == Some(Protocol::Std) {
        let (file_name, wanted) = {
            let formats = &ole.state().formats;
            let at = |index: usize| formats.get(index).copied().unwrap_or(0);

            (at(5), if link { at(0) } else { at(2) })
        };

        available(ole, file_name).await?;

        return Ok(if available(ole, wanted).await? {
            OLE_OK
        } else {
            OLE_ERROR_FORMAT
        });
    }

    if kind != Some(Protocol::Static) || link {
        return Ok(if kind.is_some() {
            OLE_ERROR_FORMAT
        } else {
            OLE_ERROR_PROTOCOL
        });
    }

    Ok(if static_format(ole, render, format).await? != 0 {
        OLE_OK
    } else {
        OLE_ERROR_FORMAT
    })
}

/// The format a static object would be made of, by the rendering asked
/// for; nought for none.
async fn static_format(ole: &Ole<'_>, render: u16, format: u16) -> R<u16> {
    if render == OLERENDER_DRAW {
        for each in STATIC_FORMATS {
            if available(ole, each).await? {
                return Ok(each);
            }
        }

        return Ok(0);
    }

    if render == OLERENDER_FORMAT && available(ole, format).await? {
        return Ok(format);
    }

    Ok(0)
}

/// `OleCreateFromClip(protocol, client, doc, name, out, render, format)`:
/// the document, the name and the out pointer checked, then the protocol;
/// for `Static`, the first of the clipboard's formats, in its order, that
/// is a picture, a DIB or a bitmap, made into a static object.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn create_from_clip(
    ole: &Ole<'_>,
    protocol: u32,
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
    render: u16,
    format: u16,
) -> R<u16> {
    let checked = first(&[
        doc_error(ole, doc),
        name_error(ole, name),
        if writable(ole, out, 4) {
            0
        } else {
            OLE_ERROR_ADDRESS
        },
    ]);

    if checked != 0 {
        return Ok(checked);
    }

    let kind = protocol_of(ole, protocol);

    if kind == Some(Protocol::Std) {
        ole.w32(out, 0);
        return via_clip(
            ole,
            false,
            &[
                protocol,
                client,
                doc,
                name,
                out,
                u32::from(render),
                u32::from(format),
                2,
            ],
        )
        .await;
    }

    if kind != Some(Protocol::Static) {
        return Ok(if kind.is_some() {
            OLE_ERROR_FORMAT
        } else {
            OLE_ERROR_PROTOCOL
        });
    }

    ole.w32(out, 0);

    if static_format(ole, render, format).await? == 0 {
        return Ok(OLE_ERROR_FORMAT);
    }

    let mut each = 0;

    loop {
        each = ole.user("EnumClipboardFormats", &[Arg::W(each)]).await? as u16;

        if each == 0 {
            return Ok(OLE_ERROR_FORMAT);
        }

        if STATIC_FORMATS.contains(&each) && (render != OLERENDER_FORMAT || each == format) {
            break;
        }
    }

    let handle = ole.user("GetClipboardData", &[Arg::W(each)]).await? as u16;
    let kind = match each {
        CF_METAFILEPICT => Kind::Mf,
        CF_BITMAP => Kind::Bm,
        _ => Kind::Dib,
    };

    static_from_clipboard(ole, kind, handle, client, doc, name, out).await
}

/// An object made from the clipboard by its class's handler: the class
/// `OwnerLink` or `ObjectLink` names, none `OLE_ERROR_FORMAT`; the
/// clipboard's defaults work only while this is under way (`handlers.rs`).
async fn via_clip(ole: &Ole<'_>, linked: bool, args: &[u32]) -> R<u16> {
    let Some(class) = super::linked::clip_class(ole, linked).await? else {
        return Ok(OLE_ERROR_FORMAT);
    };

    ole.state().clipping = true;

    let answer = Box::pin(make(
        ole,
        if linked { Way::LinkClip } else { Way::Clip },
        &class,
        args,
    ))
    .await;

    ole.state().clipping = false;
    answer
}

/// `OleCreateLinkFromClip`: a link of a static picture is not made:
/// `OLE_ERROR_FORMAT` for `Static`; `StdFileEditing` a link to
/// `ObjectLink`'s document, made by its class's handler.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn create_link_from_clip(
    ole: &Ole<'_>,
    protocol: u32,
    client: u32,
    doc: u32,
    name: u32,
    out: u32,
    render: u16,
    format: u16,
) -> R<u16> {
    let checked = first(&[
        doc_error(ole, doc),
        name_error(ole, name),
        if writable(ole, out, 4) {
            0
        } else {
            OLE_ERROR_ADDRESS
        },
    ]);

    if checked != 0 {
        return Ok(checked);
    }

    if protocol_of(ole, protocol) == Some(Protocol::Std) {
        ole.w32(out, 0);
        return via_clip(
            ole,
            true,
            &[
                protocol,
                client,
                doc,
                name,
                out,
                u32::from(render),
                u32::from(format),
            ],
        )
        .await;
    }

    Ok(if protocol_of(ole, protocol).is_some() {
        OLE_ERROR_FORMAT
    } else {
        OLE_ERROR_PROTOCOL
    })
}

/// A call checking a pointer argument's room before the method:
/// `OLE_ERROR_ADDRESS` where an object's pointer argument cannot be
/// written.
pub(crate) async fn method_with_out(
    ole: &Ole<'_>,
    object: u32,
    name: Method,
    out: u32,
    room: u16,
    args: &[MethodArg],
) -> R<u16> {
    if is_object(ole, object) && !writable(ole, out, room) {
        return Ok(OLE_ERROR_ADDRESS);
    }

    method(ole, object, name, args).await
}

/// `OleEnumFormats`: nought for what is not an object (**recorded** by
/// `olestat`).
pub(crate) async fn enum_formats(ole: &Ole<'_>, object: u32, format: u16) -> R<u16> {
    if !is_object(ole, object) {
        return Ok(0);
    }

    method(ole, object, Method::EnumFormats, &[W(format)]).await
}

/// `OleQueryProtocol`: the method's answer, a far pointer; NULL for what
/// is not an object.
pub(crate) async fn query_protocol(ole: &Ole<'_>, object: u32, protocol: u32) -> R<u32> {
    if !is_object(ole, object) {
        return Ok(0);
    }

    call_method(ole, object, Method::QueryProtocol, &[D(protocol)]).await
}

/// `OleRequestData`: format nought `OLE_ERROR_FORMAT` before the method
/// (**measured** by `olemem`).
pub(crate) async fn request_data(ole: &Ole<'_>, object: u32, format: u16) -> R<u16> {
    if is_object(ole, object) && format == 0 {
        return Ok(OLE_ERROR_FORMAT);
    }

    method(ole, object, Method::RequestData, &[W(format)]).await
}

/// `OleLockServer`: a static object has no server, `OLE_ERROR_STATIC`,
/// nothing written (**recorded** by `olestat`).
pub(crate) async fn lock_server(ole: &Ole<'_>, object: u32, out: u32) -> R<u16> {
    if !is_object(ole, object) {
        return Ok(OLE_ERROR_OBJECT);
    }

    if super::linked::is_le(ole, object) {
        return if writable(ole, out, 4) {
            super::linked::lock_server(ole, object, out).await
        } else {
            Ok(OLE_ERROR_ADDRESS)
        };
    }

    Ok(OLE_ERROR_STATIC)
}

/// The checks of a call that makes an embedded or linked object of a
/// class: the document, the name, the out pointer, the protocol
/// (`StdFileEditing`), then the class in the registration database
/// (`OLE_ERROR_CLASS` where it is not, **recorded** by `olestat`). As
/// `api.ts`'s `checkClass`.
async fn check_class(
    ole: &Ole<'_>,
    protocol: u32,
    class: u32,
    doc: u32,
    name: u32,
    out: u32,
) -> R<u16> {
    let checked = first(&[
        doc_error(ole, doc),
        name_error(ole, name),
        if writable(ole, out, 4) {
            0
        } else {
            OLE_ERROR_ADDRESS
        },
    ]);

    if checked != 0 {
        return Ok(checked);
    }

    if protocol_of(ole, protocol) != Some(Protocol::Std) {
        return Ok(OLE_ERROR_PROTOCOL);
    }

    if class == 0 || !ole.readable(class, 1) {
        return Ok(OLE_ERROR_CLASS);
    }

    Ok(if super::linked::class_known(ole, class).await? {
        OLE_OK
    } else {
        OLE_ERROR_CLASS
    })
}

/// `OleCreate` and `OleCreateInvisible`: the checks, then the object made
/// by its class's handler or its default (`handlers.rs`). `values` are the
/// `Dll` export's arguments.
pub(crate) async fn create(ole: &Ole<'_>, way: Way, values: &[u32]) -> R<u16> {
    let (protocol, class, doc, name, out) = (values[0], values[2], values[3], values[4], values[5]);
    let checked = check_class(ole, protocol, class, doc, name, out).await?;

    if checked != 0 {
        return Ok(checked);
    }

    make(ole, way, &ole.string(class), values).await
}

/// `OleCreateFromTemplate`: its class the registration database's for the
/// template's extension (**measured** by `olehnd`, whose handler is so
/// found and given the template); none, `OLE_ERROR_CLASS`.
pub(crate) async fn create_from_template(ole: &Ole<'_>, values: &[u32]) -> R<u16> {
    let (protocol, template, doc, name, out) =
        (values[0], values[2], values[3], values[4], values[5]);
    let class = if template != 0 && ole.readable(template, 1) {
        super::handlers::class_of_file(ole, template).await?
    } else {
        None
    };
    let at = ole.near(SCRATCH + 0x600);

    if let Some(class) = &class {
        let mut bytes = class.clone();

        bytes.push(0);
        ole.write(at, &bytes);
    }

    let checked = check_class(
        ole,
        protocol,
        if class.is_some() { at } else { 0 },
        doc,
        name,
        out,
    )
    .await?;

    if checked != 0 {
        return Ok(checked);
    }

    make(ole, Way::Template, &class.unwrap_or_default(), values).await
}

/// `OleCreateFromFile` and `OleCreateLinkFromFile`: the checks, then the
/// object made by its class's handler or its default.
pub(crate) async fn create_from_file(ole: &Ole<'_>, linked: bool, values: &[u32]) -> R<u16> {
    let (protocol, class) = (values[0], values[2]);
    let (doc, name, out) = if linked {
        (values[5], values[6], values[7])
    } else {
        (values[4], values[5], values[6])
    };
    let checked = check_class(ole, protocol, class, doc, name, out).await?;

    if checked != 0 {
        return Ok(checked);
    }

    make(
        ole,
        if linked { Way::LinkFile } else { Way::File },
        &ole.string(class),
        values,
    )
    .await
}
