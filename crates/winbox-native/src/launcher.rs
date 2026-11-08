//! `winbox-native --launcher` (`kb/guides/launcher.md`, step 5): a small
//! window of the front end's own -- winit and softbuffer, as the rest --
//! listing the library's groups and their items, each with its icon from
//! its group file's bits, an item that cannot run shown but disabled with
//! why. Choosing an item starts `winbox-native --launch` for it, a process
//! of its own (design A); the launcher holds no machine.
//!
//! The window is WinBox's, not Windows': it follows the page's launcher
//! menu (`src/run/ui/launcher.tsx`) -- the arrows, Home, End and a letter
//! move; Right, Enter or Space opens a group; Left or Escape goes back to
//! the group; Escape on a group closes the window -- and draws in the
//! system font of the Windows its programs are kept on (`SYSTEM.INI`'s
//! `fonts.fon`), the icons in that display's colours, as
//! `src/run/group-icon.ts` draws them on the page.

use std::collections::BTreeSet;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::rc::Rc;

use softbuffer::{Context, Surface};
use winbox_raster::bitmap_font::{BitmapFontEntry, read_bitmap_font};
use winbox_raster::device_palette::DevicePalette;
use winbox_win16::groups::Icon;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::ActiveEventLoop;
use winit::keyboard::{Key as WinitKey, NamedKey};
use winit::window::{Window, WindowId};

use crate::library::{self, Group, Item, Source};
use crate::programs::Store;

/// A key the launcher takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    Up,
    Down,
    Home,
    End,
    Left,
    Right,
    Enter,
    Space,
    Escape,
    Tab,
    Letter(char),
}

/// A row of the list: a group, or an item of an open group.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Row {
    Group(usize),
    Item(usize, usize),
}

/// What a key or a click asks of the launcher.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    None,
    /// An item run: its group's place and its own, and whether its working
    /// directory, not there, was confirmed.
    Launch {
        group: usize,
        item: usize,
        anyway: bool,
    },
    Close,
}

/// Program Manager's box for an item whose working directory is not
/// there, asked in the launcher's own words as the page's launcher asks
/// it: "The working directory is invalid.", OK and Cancel, Cancel first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Confirm {
    pub group: usize,
    pub item: usize,
    pub ok: bool,
}

/// The caption and text of the confirmation, as Program Manager's box has
/// them (`kb/topics/program-manager-dde.md`, "Running an item").
pub const INVALID_CAPTION: &str = "Invalid Path";
pub const INVALID_TEXT: &str = "The working directory is invalid.";

/// The launcher's list: the groups, which are open, the row selected and
/// a confirmation being asked, if one is.
#[derive(Debug)]
pub struct Model {
    pub groups: Vec<Group>,
    /// What is said where there is nothing to list.
    pub empty: Option<String>,
    pub open: BTreeSet<usize>,
    pub selected: usize,
    pub confirm: Option<Confirm>,
}

impl Model {
    pub fn new(groups: Vec<Group>, empty: Option<String>) -> Self {
        Self {
            groups,
            empty,
            open: BTreeSet::new(),
            selected: 0,
            confirm: None,
        }
    }

    /// The rows shown: each group, and beneath an open one its items.
    pub fn rows(&self) -> Vec<Row> {
        let mut rows = Vec::new();

        for (at, group) in self.groups.iter().enumerate() {
            rows.push(Row::Group(at));

            if self.open.contains(&at) {
                rows.extend((0..group.items.len()).map(|item| Row::Item(at, item)));
            }
        }

        rows
    }

    pub fn row(&self) -> Option<Row> {
        self.rows().get(self.selected).copied()
    }

    pub fn item(&self, group: usize, item: usize) -> Option<&Item> {
        self.groups.get(group)?.items.get(item)
    }

    /// A row's text, as it is shown and read.
    pub fn label(&self, row: Row) -> String {
        match row {
            Row::Group(group) => self.groups[group].label.clone(),
            Row::Item(group, item) => self.groups[group].items[item].name(),
        }
    }

    /// What is said of the row selected, beneath the list, and read with
    /// it: an item's reason it cannot run (`Cannot run: needs WRITE.EXE,
    /// which is not in this Windows.`), a group's note; or what is said
    /// where nothing is listed.
    pub fn status(&self) -> Option<String> {
        if let Some(empty) = &self.empty {
            return Some(empty.clone());
        }

        match self.row()? {
            Row::Group(group) => self.groups[group].note.clone(),
            Row::Item(group, item) => self.groups[group].items[item]
                .reason
                .as_ref()
                .map(|reason| format!("Cannot run: {reason}.")),
        }
    }

    /// Whether a row can be chosen: a group always, an item that can run.
    pub fn enabled(&self, row: Row) -> bool {
        match row {
            Row::Group(_) => true,
            Row::Item(group, item) => self.groups[group].items[item].reason.is_none(),
        }
    }

    fn select(&mut self, row: Row) {
        if let Some(at) = self.rows().iter().position(|&one| one == row) {
            self.selected = at;
        }
    }

    /// A row chosen, by a click or Enter: a group opened, or closed where
    /// it is open; an item run, or its confirmation asked; a disabled
    /// item, nothing.
    pub fn choose(&mut self, row: Row) -> Action {
        self.select(row);

        match row {
            Row::Group(group) => {
                if !self.open.remove(&group) {
                    self.open.insert(group);
                }

                Action::None
            }
            Row::Item(group, item) => {
                let Some(chosen) = self.item(group, item) else {
                    return Action::None;
                };

                if chosen.reason.is_some() {
                    Action::None
                } else if chosen.launch.run.directory_there {
                    Action::Launch {
                        group,
                        item,
                        anyway: false,
                    }
                } else {
                    self.confirm = Some(Confirm {
                        group,
                        item,
                        ok: false,
                    });
                    Action::None
                }
            }
        }
    }

    /// A key pressed.
    pub fn key(&mut self, key: Key) -> Action {
        if let Some(confirm) = self.confirm.as_mut() {
            return match key {
                Key::Left | Key::Right | Key::Tab | Key::Up | Key::Down => {
                    confirm.ok = !confirm.ok;
                    Action::None
                }
                Key::Enter | Key::Space => {
                    let confirm = *confirm;

                    self.confirm = None;

                    if confirm.ok {
                        Action::Launch {
                            group: confirm.group,
                            item: confirm.item,
                            anyway: true,
                        }
                    } else {
                        Action::None
                    }
                }
                Key::Escape => {
                    self.confirm = None;
                    Action::None
                }
                _ => Action::None,
            };
        }

        let rows = self.rows();

        if rows.is_empty() {
            return if key == Key::Escape {
                Action::Close
            } else {
                Action::None
            };
        }

        let last = rows.len() - 1;
        let row = rows[self.selected.min(last)];

        match key {
            Key::Up => self.selected = self.selected.min(last).saturating_sub(1),
            Key::Down => self.selected = (self.selected + 1).min(last),
            Key::Home => self.selected = 0,
            Key::End => self.selected = last,
            Key::Right => {
                if let Row::Group(group) = row {
                    self.open.insert(group);

                    if !self.groups[group].items.is_empty() {
                        self.select(Row::Item(group, 0));
                    }
                }
            }
            Key::Left => match row {
                Row::Item(group, _) => self.select(Row::Group(group)),
                Row::Group(group) => {
                    self.open.remove(&group);
                }
            },
            Key::Escape => match row {
                Row::Item(group, _) => {
                    self.open.remove(&group);
                    self.select(Row::Group(group));
                }
                Row::Group(_) => return Action::Close,
            },
            Key::Enter | Key::Space => {
                if let Row::Group(group) = row {
                    self.open.insert(group);

                    if !self.groups[group].items.is_empty() {
                        self.select(Row::Item(group, 0));
                    }

                    return Action::None;
                }

                return self.choose(row);
            }
            Key::Letter(letter) => {
                // The next row whose text begins with the letter, after the
                // one selected, round to the first.
                let wanted = letter.to_ascii_lowercase();
                let found = (1..=rows.len())
                    .map(|step| (self.selected + step) % rows.len())
                    .find(|&at| {
                        self.label(rows[at])
                            .chars()
                            .next()
                            .is_some_and(|first| first.to_ascii_lowercase() == wanted)
                    });

                if let Some(at) = found {
                    self.selected = at;
                }
            }
            Key::Tab => {}
        }

        Action::None
    }
}

/// What starts an item, a process of its own: this program again, with
/// `--launch`, the item's install, its name and its group's, the library,
/// and how the launcher was asked to show programs; `--mode` where the
/// program is kept for another than the standard one; and where its
/// working directory is not there and OK was chosen, `--directory-anyway`.
pub fn launch_arguments(
    group: &Group,
    item: &Item,
    mode: &str,
    anyway: bool,
    settings: &Settings,
) -> Vec<String> {
    let mut arguments = vec![
        "--launch".to_string(),
        group.install.clone(),
        item.name(),
        "--group".to_string(),
        group.name.clone(),
        "--library".to_string(),
        settings.library.display().to_string(),
    ];

    if mode != library::STANDARD {
        arguments.extend(["--mode".to_string(), mode.to_string()]);
    }

    if let Some(source) = &settings.source {
        arguments.extend(source.arguments());
    }

    if settings.seamless {
        arguments.push("--seamless".to_string());
    }

    if settings.sound {
        arguments.push("--sound".to_string());
    }

    if anyway {
        arguments.push("--directory-anyway".to_string());
    }

    arguments
}

/// What the launcher passes on to what it starts.
#[derive(Debug, Clone)]
pub struct Settings {
    pub library: PathBuf,
    pub source: Option<Source>,
    pub seamless: bool,
    pub sound: bool,
}

/// The display's colours an icon of `depth` bits is drawn in, and the
/// index of the window's colour (`displayColours`, `group-icon.ts`).
fn icon_colours(display: &str, depth: u8) -> (Vec<[u8; 3]>, usize) {
    let mode = winbox_win16::display::mode(display)
        .or_else(|| winbox_win16::display::mode("vga"))
        .expect("the VGA");
    let own = DevicePalette::depth_of(mode.colors);
    let kind = mode.palette.as_deref();
    let mut palette = if depth == own {
        DevicePalette::for_display(mode.colors, kind == Some("ega"), kind == Some("8514"))
    } else {
        DevicePalette::for_depth(depth)
    };
    let window = mode.sys_colors.get(5).copied().unwrap_or(0x00ff_ffff);
    let index = palette.index(window as u8, (window >> 8) as u8, (window >> 16) as u8);

    (palette.colours, index)
}

/// An icon's pixels as the page draws them (`iconPixels`): each the
/// window's colour index `AND`ed with the mask, `XOR`ed with the picture's
/// index, then that index's colour; `0RGB`, the top row first, with its
/// width and height. None where its bits are fewer than its header says.
pub fn icon_pixels(icon: &Icon, display: &str) -> Option<Pixels> {
    let width = usize::from(icon.cx);
    let height = usize::from(icon.cy);
    let width_bytes = usize::from(icon.width_bytes);
    let planes = usize::from(icon.planes.max(1));
    let bits = usize::from(icon.bits_pixel.max(1));
    let picture_row = ((width * bits + 15) >> 3) & !1;

    if width == 0
        || height == 0
        || icon.and.len() < height * width_bytes
        || icon.xor.len() < height * planes * picture_row
    {
        return None;
    }

    let depth = u8::try_from(planes * bits).unwrap_or(8);
    let (colours, window) = icon_colours(display, depth);
    let mut pixels = Vec::with_capacity(width * height);

    for row in 0..height {
        for column in 0..width {
            let and = (icon.and[row * width_bytes + (column >> 3)] >> (7 - (column & 7))) & 1;
            let mut index = 0usize;

            for plane in 0..planes {
                let bit = column * bits;
                let byte = icon.xor[(row * planes + plane) * picture_row + (bit >> 3)];
                let value = (usize::from(byte) >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);

                index |= value << (plane * bits);
            }

            let shown = ((if and == 1 { window } else { 0 }) ^ index) & (colours.len() - 1);
            let [red, green, blue] = colours[shown];

            pixels.push(u32::from(red) << 16 | u32::from(green) << 8 | u32::from(blue));
        }
    }

    Some((width, height, pixels))
}

/// An icon's pixels: its width and height, and each `0RGB`, the top row
/// first.
pub type Pixels = (usize, usize, Vec<u32>);

/// The system font of the first base read that has one: `SYSTEM.INI`'s
/// `[boot] fonts.fon`, in `WINDOWS\SYSTEM`, its first strike.
pub fn system_font(bases: &[PathBuf]) -> Option<BitmapFontEntry> {
    fn child(folder: &Path, name: &str) -> Option<PathBuf> {
        std::fs::read_dir(folder)
            .ok()?
            .flatten()
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(name)
            })
            .map(|entry| entry.path())
    }

    bases.iter().find_map(|base| {
        let windows = child(base, "WINDOWS")?;
        let ini = std::fs::read(child(&windows, "SYSTEM.INI")?).ok()?;
        let name = winbox_win16::profile::Profile::new(&ini).get(b"boot", b"fonts.fon", false)?;
        let name = library::latin1(&name);
        let file = child(&child(&windows, "SYSTEM")?, name.trim())?;

        read_bitmap_font(std::fs::read(file).ok()?)
            .into_iter()
            .find(|entry| !entry.is_vector())
    })
}

/// The launcher's colours: Windows 3.1's defaults on the VGA, its window,
/// its text, its highlight and its grey text.
const WHITE: u32 = 0x00ff_ffff;
const BLACK: u32 = 0;
const HIGHLIGHT: u32 = 0x0000_0080;
const GREY: u32 = 0x0080_8080;
const FACE: u32 = 0x00c0_c0c0;

/// Rows' heights: a group's, and an item's, its icon and a margin.
const GROUP_HEIGHT: usize = 24;
const ITEM_HEIGHT: usize = 36;
const STATUS_HEIGHT: usize = 40;

/// A frame being drawn: its pixels and size, and the font.
struct Canvas<'a> {
    pixels: &'a mut [u32],
    width: usize,
    height: usize,
    font: &'a BitmapFontEntry,
}

impl Canvas<'_> {
    fn fill(&mut self, left: usize, top: usize, right: usize, bottom: usize, colour: u32) {
        for y in top.min(self.height)..bottom.min(self.height) {
            for x in left.min(self.width)..right.min(self.width) {
                self.pixels[y * self.width + x] = colour;
            }
        }
    }

    fn frame(&mut self, left: usize, top: usize, right: usize, bottom: usize, colour: u32) {
        self.fill(left, top, right, top + 1, colour);
        self.fill(left, bottom.saturating_sub(1), right, bottom, colour);
        self.fill(left, top, left + 1, bottom, colour);
        self.fill(right.saturating_sub(1), top, right, bottom, colour);
    }

    fn text_width(&self, text: &str) -> usize {
        library::bytes_of(text)
            .iter()
            .map(|&code| usize::from(self.font.character(u32::from(code)).width))
            .sum()
    }

    /// Text drawn from its cell's top left, clipped at `right`.
    fn text(&mut self, mut x: usize, y: usize, right: usize, text: &str, colour: u32) {
        for code in library::bytes_of(text) {
            let glyph = self.font.glyph(u32::from(code));
            let width = glyph.first().map_or(0, Vec::len);

            if x + width > right.min(self.width) {
                break;
            }

            for (row, bits) in glyph.iter().enumerate() {
                for (column, &bit) in bits.iter().enumerate() {
                    if bit != 0 && y + row < self.height {
                        self.pixels[(y + row) * self.width + x + column] = colour;
                    }
                }
            }

            x += width;
        }
    }

    fn icon(&mut self, x: usize, y: usize, icon: &Pixels) {
        let (width, height, pixels) = icon;

        for row in 0..*height {
            for column in 0..*width {
                if x + column < self.width && y + row < self.height {
                    self.pixels[(y + row) * self.width + x + column] = pixels[row * width + column];
                }
            }
        }
    }

    /// Text wrapped at words to fit between `left` and `right`.
    fn wrapped(&mut self, left: usize, top: usize, right: usize, text: &str, colour: u32) {
        let line = usize::from(self.font.header.pix_height);
        let mut y = top;
        let mut current = String::new();

        for word in text.split(' ') {
            let tried = if current.is_empty() {
                word.to_string()
            } else {
                format!("{current} {word}")
            };

            if self.text_width(&tried) > right.saturating_sub(left) && !current.is_empty() {
                self.text(left, y, right, &current, colour);
                y += line;
                current = word.to_string();
            } else {
                current = tried;
            }
        }

        self.text(left, y, right, &current, colour);
    }
}

/// The window: the model, the font, each item's icon drawn once, and the
/// processes started.
struct Launcher {
    model: Model,
    font: BitmapFontEntry,
    icons: Vec<Vec<Option<Pixels>>>,
    modes: Vec<String>,
    settings: Settings,
    window: Option<Rc<Window>>,
    surface: Option<Surface<Rc<Window>, Rc<Window>>>,
    /// The first row shown, scrolled to keep the selection in view.
    top: usize,
    cursor: (f64, f64),
    children: Vec<Child>,
}

impl Launcher {
    fn height_of(row: Row) -> usize {
        match row {
            Row::Group(_) => GROUP_HEIGHT,
            Row::Item(..) => ITEM_HEIGHT,
        }
    }

    /// The window's title, which tells the row selected: what a reader of
    /// the screen is told of the window as it changes.
    fn title(&self) -> String {
        match self.model.row() {
            Some(row) => {
                let label = self.model.label(row);

                match (row, self.model.enabled(row)) {
                    (Row::Group(group), _) => format!(
                        "WinBox Launcher: {label}, group, {}",
                        if self.model.open.contains(&group) {
                            "open"
                        } else {
                            "closed"
                        }
                    ),
                    (Row::Item(..), true) => format!("WinBox Launcher: {label}"),
                    (Row::Item(..), false) => format!(
                        "WinBox Launcher: {label}, unavailable. {}",
                        self.model.status().unwrap_or_default()
                    ),
                }
            }
            None => "WinBox Launcher".to_string(),
        }
    }

    /// The row at a point of the window, as it was last drawn.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn row_at(&self, y: f64, list_height: usize) -> Option<Row> {
        let y = y.max(0.0) as usize;
        let rows = self.model.rows();
        let mut at = 0usize;

        for &row in rows.iter().skip(self.top) {
            let height = Self::height_of(row);

            if at >= list_height {
                break;
            }

            if y >= at && y < at + height {
                return Some(row);
            }

            at += height;
        }

        None
    }

    /// The first row shown made such that the selection is in view.
    fn scroll(&mut self, list_height: usize) {
        let rows = self.model.rows();
        let selected = self.model.selected.min(rows.len().saturating_sub(1));

        if selected < self.top {
            self.top = selected;
        }

        while self.top < selected
            && rows[self.top..=selected]
                .iter()
                .map(|&row| Self::height_of(row))
                .sum::<usize>()
                > list_height
        {
            self.top += 1;
        }
    }

    fn act(&mut self, action: Action, event_loop: &ActiveEventLoop) {
        match action {
            Action::None => {}
            Action::Close => event_loop.exit(),
            Action::Launch {
                group,
                item,
                anyway,
            } => {
                let chosen = &self.model.groups[group];
                let arguments = launch_arguments(
                    chosen,
                    &chosen.items[item],
                    &self.modes[group],
                    anyway,
                    &self.settings,
                );

                match std::env::current_exe()
                    .and_then(|exe| Command::new(exe).args(&arguments).spawn())
                {
                    Ok(child) => {
                        eprintln!("started: {}", arguments.join(" "));
                        self.children.push(child);
                    }
                    Err(error) => eprintln!("{}: not started: {error}", chosen.items[item].name()),
                }
            }
        }

        if let Some(window) = &self.window {
            window.set_title(&self.title());
            window.request_redraw();
        }
    }

    #[allow(clippy::too_many_lines)]
    fn draw(&mut self) {
        let Some(window) = self.window.clone() else {
            return;
        };
        let size = window.inner_size();
        let (Some(width), Some(height)) =
            (NonZeroU32::new(size.width), NonZeroU32::new(size.height))
        else {
            return;
        };
        let list_height = (size.height as usize).saturating_sub(STATUS_HEIGHT);

        self.scroll(list_height);

        let Some(surface) = self.surface.as_mut() else {
            return;
        };

        if surface.resize(width, height).is_err() {
            return;
        }

        let Ok(mut buffer) = surface.buffer_mut() else {
            return;
        };
        let mut canvas = Canvas {
            width: size.width as usize,
            height: size.height as usize,
            pixels: &mut buffer,
            font: &self.font,
        };
        let line = usize::from(self.font.header.pix_height);
        let right = canvas.width;

        canvas.fill(0, 0, right, canvas.height, WHITE);

        let rows = self.model.rows();
        let mut y = 0;

        for (at, &row) in rows.iter().enumerate().skip(self.top) {
            let height = Self::height_of(row);

            if y >= list_height {
                break;
            }

            let selected = at == self.model.selected && self.model.confirm.is_none();
            let enabled = self.model.enabled(row);
            let ink = match (selected, enabled) {
                (true, _) => WHITE,
                (false, true) => BLACK,
                (false, false) => GREY,
            };

            match row {
                Row::Group(group) => {
                    let marker = if self.model.open.contains(&group) {
                        "-"
                    } else {
                        "+"
                    };

                    if selected {
                        canvas.fill(0, y, right, y + height, HIGHLIGHT);
                    }

                    canvas.text(6, y + height.saturating_sub(line) / 2, right, marker, ink);
                    canvas.text(
                        20,
                        y + height.saturating_sub(line) / 2,
                        right,
                        &self.model.label(row),
                        ink,
                    );
                }
                Row::Item(group, item) => {
                    if let Some(Some(icon)) =
                        self.icons.get(group).and_then(|icons| icons.get(item))
                    {
                        canvas.icon(24, y + 2, icon);
                    }

                    let label = self.model.label(row);
                    let x = 64;

                    if selected {
                        canvas.fill(
                            x - 2,
                            (y + height.saturating_sub(line) / 2).saturating_sub(1),
                            x + canvas.text_width(&label) + 2,
                            y + usize::midpoint(height, line) + 1,
                            HIGHLIGHT,
                        );
                    }

                    canvas.text(x, y + height.saturating_sub(line) / 2, right, &label, ink);
                }
            }

            y += height;
        }

        // The status line: why the item selected cannot run, or a group's
        // note, or what is said where nothing is kept.
        let status_top = list_height;

        canvas.fill(0, status_top, right, canvas.height, FACE);
        canvas.fill(0, status_top, right, status_top + 1, GREY);

        if let Some(status) = self.model.status() {
            canvas.wrapped(6, status_top + 4, right.saturating_sub(6), &status, BLACK);
        }

        // Program Manager's box, in the middle, over the list.
        if let Some(confirm) = self.model.confirm {
            let box_width = (canvas.text_width(INVALID_TEXT) + 40).max(220);
            let box_height = line * 5 + 24;
            let left = right.saturating_sub(box_width) / 2;
            let top = list_height.saturating_sub(box_height) / 2;

            canvas.fill(left, top, left + box_width, top + box_height, FACE);
            canvas.frame(left, top, left + box_width, top + box_height, BLACK);
            canvas.fill(
                left + 1,
                top + 1,
                left + box_width - 1,
                top + line + 5,
                HIGHLIGHT,
            );
            canvas.text(left + 6, top + 3, left + box_width, INVALID_CAPTION, WHITE);
            canvas.text(
                left + 20,
                top + line * 2,
                left + box_width,
                INVALID_TEXT,
                BLACK,
            );

            for (at, (label, focused)) in [("OK", confirm.ok), ("Cancel", !confirm.ok)]
                .into_iter()
                .enumerate()
            {
                let button_left = left + box_width / 2 - 80 + at * 90;
                let button_top = top + line * 3 + 8;

                canvas.frame(
                    button_left,
                    button_top,
                    button_left + 70,
                    button_top + line + 8,
                    BLACK,
                );

                if focused {
                    canvas.frame(
                        button_left + 1,
                        button_top + 1,
                        button_left + 69,
                        button_top + line + 7,
                        BLACK,
                    );
                }

                let x = button_left + 70usize.saturating_sub(canvas.text_width(label)) / 2;

                canvas.text(x, button_top + 4, button_left + 70, label, BLACK);
            }
        }

        let _ = buffer.present();
    }
}

/// A key of winit's as the launcher takes it.
fn key_of(key: &WinitKey) -> Option<Key> {
    Some(match key {
        WinitKey::Named(NamedKey::ArrowUp) => Key::Up,
        WinitKey::Named(NamedKey::ArrowDown) => Key::Down,
        WinitKey::Named(NamedKey::ArrowLeft) => Key::Left,
        WinitKey::Named(NamedKey::ArrowRight) => Key::Right,
        WinitKey::Named(NamedKey::Home) => Key::Home,
        WinitKey::Named(NamedKey::End) => Key::End,
        WinitKey::Named(NamedKey::Enter) => Key::Enter,
        WinitKey::Named(NamedKey::Space) => Key::Space,
        WinitKey::Named(NamedKey::Escape) => Key::Escape,
        WinitKey::Named(NamedKey::Tab) => Key::Tab,
        WinitKey::Character(text) => {
            let letter = text.chars().next()?;

            if letter == ' ' {
                Key::Space
            } else if letter.is_alphanumeric() {
                Key::Letter(letter)
            } else {
                return None;
            }
        }
        _ => return None,
    })
}

impl ApplicationHandler for Launcher {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }

        let attributes = Window::default_attributes()
            .with_title(self.title())
            .with_inner_size(LogicalSize::new(360.0, 480.0));
        let window = Rc::new(
            event_loop
                .create_window(attributes)
                .expect("the launcher's window"),
        );

        self.surface = Context::new(window.clone())
            .and_then(|context| Surface::new(&context, window.clone()))
            .ok();
        self.window = Some(window);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::RedrawRequested => self.draw(),
            WindowEvent::Resized(_) => {
                if let Some(window) = &self.window {
                    window.request_redraw();
                }
            }
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => {
                if let Some(key) = key_of(&event.logical_key) {
                    let action = self.model.key(key);

                    self.act(action, event_loop);
                }
            }
            WindowEvent::CursorMoved { position, .. } => self.cursor = (position.x, position.y),
            WindowEvent::MouseInput {
                state: ElementState::Pressed,
                button: MouseButton::Left,
                ..
            } => {
                if self.model.confirm.is_some() {
                    return;
                }

                let list_height = self
                    .window
                    .as_ref()
                    .map_or(0, |window| window.inner_size().height as usize)
                    .saturating_sub(STATUS_HEIGHT);

                if let Some(row) = self.row_at(self.cursor.1, list_height) {
                    let action = self.model.choose(row);

                    self.act(action, event_loop);
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _: &ActiveEventLoop) {
        // The processes started let go of as they end.
        self.children
            .retain_mut(|child| matches!(child.try_wait(), Ok(None)));
    }
}

/// The launcher's list read from the library, with the mode each group's
/// program is kept for, and the folders of the bases read.
pub fn read(
    store: &Store,
    cache: PathBuf,
    given: Option<Source>,
    modes: bool,
) -> (Model, Vec<String>, Vec<PathBuf>) {
    let mut reader = library::Reader::new(store, cache, given);

    reader.modes = modes;

    let (groups, empty) = reader.launcher();
    let programs = store.programs();
    let kept_modes = groups
        .iter()
        .map(|group| {
            programs
                .iter()
                .find(|program| program.name == group.install)
                .map_or_else(
                    || library::STANDARD.to_string(),
                    |program| program.mode.clone(),
                )
        })
        .collect();
    let folders = programs
        .iter()
        .filter_map(|program| reader.base(program).map(|(base, _)| base.folder))
        .collect();

    (Model::new(groups, empty), kept_modes, folders)
}

/// `--launcher`: the window opened over the library, until it is closed.
pub fn run(options: &crate::Options) {
    let store = crate::library_store(options);
    let given = match (&options.assets, &options.windows) {
        (Some(assets), _) => Some(Source::Assets(assets.clone())),
        (None, Some(windows)) => Some(Source::Windows(windows.clone())),
        (None, None) => None,
    };

    if let Some(earlier) = library::earlier(&store, &crate::cache_folder()) {
        eprintln!("{earlier}");
    }

    let (model, kept_modes, folders) =
        read(&store, crate::made_cache(), given.clone(), crate::MODES);
    let Some(font) = system_font(&folders) else {
        print!("{}", crate::programs::listing(&store));
        crate::refuse(&match &model.empty {
            Some(empty) => empty.clone(),
            None => "the launcher draws in the system font of the Windows its programs are kept on, and none of theirs is here: give --assets or --windows".to_string(),
        });
    };
    let icons = model
        .groups
        .iter()
        .map(|group| {
            let display = store
                .program(&group.install)
                .ok()
                .flatten()
                .map_or_else(|| "vga".to_string(), |program| program.display);

            group
                .items
                .iter()
                .map(|item| {
                    item.icon
                        .as_ref()
                        .and_then(|icon| icon_pixels(icon, &display))
                })
                .collect()
        })
        .collect();
    let mut launcher = Launcher {
        model,
        font,
        icons,
        modes: kept_modes,
        settings: Settings {
            library: store.root.clone(),
            source: given,
            seamless: options.seamless,
            sound: options.sound,
        },
        window: None,
        surface: None,
        top: 0,
        cursor: (0.0, 0.0),
        children: Vec::new(),
    };

    crate::event_loop()
        .run_app(&mut launcher)
        .expect("the launcher's event loop");
}

#[cfg(test)]
mod tests;
