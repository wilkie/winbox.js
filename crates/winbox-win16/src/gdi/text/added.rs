//! `AddFontResource` and `RemoveFontResource`: a font file added to GDI's
//! font table and taken away (`kb/topics/font-resources.md`, recorded by
//! `fontres`). GDI tells no window; the program that adds a font sends
//! `WM_FONTCHANGE` itself, as Control Panel's Fonts does.

use crate::call::{Answer, Args, Stop};
use crate::handles::Object;
use crate::system::System;

/// What a font is named by: a file's name, or a module's handle in a far
/// pointer whose selector is nought (`GDI.EXE` seg2 `0e46`).
enum Named {
    File(String),
    Handle(u16),
}

/// The name a program passed; `None` where GDI's check of it fails: a
/// handle of nought, or a name over 255 characters (seg2 `0e70`, `0e79`).
fn named(system: &System, far: u32) -> Option<Named> {
    if far >> 16 == 0 {
        let handle = (far & 0xffff) as u16;

        return (handle != 0).then_some(Named::Handle(handle));
    }

    let text: String = system
        .read_string(far)
        .iter()
        .map(|&byte| char::from(byte))
        .collect();

    (text.len() < 0x100).then_some(Named::File(text))
}

/// A file found as `LoadLibrary` finds one (seg2 `0b96`): by its path, or
/// a name alone where KERNEL looks. Its path and bytes.
fn found(system: &System, name: &str) -> Option<(String, Vec<u8>)> {
    if name.is_empty() {
        return None;
    }

    match name.rsplit_once(['\\', '/']) {
        Some((folder, file)) => {
            let folder = if folder.contains(':') {
                folder.to_string()
            } else {
                format!("{}\\{folder}", system.files.path().trim_end_matches('\\'))
            };

            system.files.read_from(&folder, file)
        }
        None => system
            .search_places(None, None)
            .iter()
            .find_map(|place| system.files.read_from(place, name)),
    }
}

/// The file a module's handle names: a library's.
fn file_of_handle(system: &System, handle: u16) -> Option<String> {
    match system.handles.resolve(handle)? {
        Object::Library(module) => Some(system.modules[module].path.clone()),
        _ => None,
    }
}

pub fn add_font_resource_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let name = match named(system, far) {
        Some(Named::File(name)) => name,
        Some(Named::Handle(handle)) => match file_of_handle(system, handle) {
            Some(path) => path,
            None => return Ok(Answer::Word(0)),
        },
        None => return Ok(Answer::Word(0)),
    };
    let Some((path, bytes)) = found(system, &name) else {
        return Ok(Answer::Word(0));
    };
    let beside = path
        .rsplit_once('\\')
        .map_or("", |(folder, _)| folder)
        .to_string();

    system.fonts();

    let limit = crate::fonts::version_limit(crate::fonts::Device::of(&system.display).big_font());
    let System { fonts, files, .. } = system;
    let fonts = fonts.as_mut().expect("the fonts, loaded");
    // The `.TTF` a stub names, where it is: the system directory,
    // Windows', or beside the stub.
    let read = |ttf: &str| {
        ["C:\\WINDOWS\\SYSTEM", "C:\\WINDOWS", beside.as_str()]
            .iter()
            .find_map(|folder| files.read_from(folder, ttf))
            .map(|(_, bytes)| bytes)
    };

    Ok(Answer::Word(fonts.add_resource(&path, bytes, limit, read)))
}

pub fn remove_font_resource_call(system: &mut System, args: &mut Args) -> Result<Answer, Stop> {
    let far = args.dword(system);
    let name = match named(system, far) {
        // A handle's module, by its name.
        Some(Named::Handle(handle)) => match file_of_handle(system, handle) {
            Some(path) => crate::fonts::font_file(
                &found(system, &path)
                    .map(|(_, bytes)| bytes)
                    .unwrap_or_default(),
            )
            .map(|file| file.module)
            .unwrap_or_default(),
            None => return Ok(Answer::Word(0)),
        },
        Some(Named::File(name)) => name,
        None => return Ok(Answer::Word(0)),
    };
    let bytes = found(system, &name).map(|(_, bytes)| bytes);

    system.fonts();

    let fonts = system.fonts.as_mut().expect("the fonts, loaded");
    let before = fonts.outline_files();
    let removed = fonts.remove_resource(&name, bytes.as_deref());
    let after = fonts.outline_files();
    let gone: Vec<_> = before
        .into_iter()
        .filter(|font| !after.iter().any(|each| std::rc::Rc::ptr_eq(each, font)))
        .collect();

    orphan_outlines(system, &gone);
    Ok(Answer::Word(u16::from(removed)))
}

/// The fonts realised from an outline file whose stub's slot was emptied:
/// GDI's table no longer names their face, and `GetTextFace` of a device
/// context holding one answers an empty name (GDI seg6 `0000` deletes the
/// slot's atoms; **recorded** by `fontdef`). They draw as they did.
fn orphan_outlines(system: &mut System, gone: &[std::rc::Rc<winbox_raster::TrueTypeFont>]) {
    if gone.is_empty() {
        return;
    }

    for object in &mut system.gdi.objects {
        if let crate::gdi::GdiObject::Font(crate::gdi::Font::Made { font, .. }) = object
            && let Some(outline) = &font.outline
            && gone
                .iter()
                .any(|each| std::rc::Rc::ptr_eq(each, &outline.font))
        {
            font.face.clear();
        }
    }
}
