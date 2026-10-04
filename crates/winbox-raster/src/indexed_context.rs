//! A drawing context whose pixels are palette indices, a byte each: the
//! store of a device-dependent bitmap.

use std::cell::RefCell;
use std::fmt;
use std::rc::Rc;

use crate::DevicePalette;
use crate::colour_match::{DisplayKind, matched_index};

/// Pixels' palette indices, shared: a view's are its parent's.
pub type Indices = Rc<RefCell<Vec<u8>>>;

/// A palette shared by everything that holds it, as the TypeScript engine's
/// `DevicePalette` objects are: an entry changed in place is seen by all.
pub type SharedPalette = Rc<RefCell<DevicePalette>>;

/// Whether a pixel may be written.
pub type Clip = Rc<dyn Fn(i32, i32) -> bool>;

/// The rectangle written since it was last taken, as left, top, right and
/// bottom, the last two outside it, and who is told when the first pixel
/// after a clean frame is written.
struct Marks {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    on_dirty: Option<Box<dyn FnMut()>>,
}

impl Marks {
    fn clean() -> Self {
        Self {
            left: i32::MAX,
            top: i32::MAX,
            right: i32::MIN,
            bottom: i32::MIN,
            on_dirty: None,
        }
    }
}

/// A rectangle of pixels, left and top in it, right and bottom outside.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// Pixels as RGBA bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageData {
    pub width: i32,
    pub height: i32,
    pub data: Vec<u8>,
}

/// A context whose pixels are palette indices. Everything that draws
/// reaches the pixels through `set_pixel`, which turns the colour into the
/// palette's index for it as it is drawn, by the display driver's own rule
/// (`matched_index`): the colour a pen, text, a background and `SetPixel`
/// all draw, `penmatch` recorded. A colour with no alpha draws nothing.
///
/// `pixels` and `image_data` still hand back RGBA bytes, built from the
/// indices when asked, so anything that reads a context as colours reads
/// this one the same way.
///
/// The store may be another's: a window's context draws into the screen's
/// pixels, from where the window's client area starts (`base`) a screen row
/// at a time (`stride`), and only where `clip` says the window is what
/// shows -- which is how a window covered by another cannot draw over it.
/// What such a context writes is marked on the screen's context, where it
/// is shown from.
///
/// The TypeScript engine's context is a `BitmapContext`, whose lines, glyphs
/// and fills all come down to `setPixel`; those are not part of this one.
pub struct IndexedContext {
    pub width: i32,
    pub height: i32,
    pub indices: Indices,
    pub palette: SharedPalette,

    /// The display whose driver draws here, whose rule picks each colour's
    /// index; `None` for the VGA's. Set on the screen, and on a bitmap as it
    /// is selected into a device context.
    pub display: Option<DisplayKind>,

    /// The last colour turned into an index, and the index it turned into.
    last: Option<(u32, usize)>,

    /// Where pixel (0, 0) is in `indices`, and how far apart two rows are.
    pub base: isize,
    pub stride: isize,

    /// Whether a pixel may be written, or `None` for all of them.
    pub clip: Option<Clip>,

    /// The clip region of the device context the bitmap is selected into.
    pub dc_clip: Option<Clip>,

    /// Where the marks are kept: this context's own, or for a view, those
    /// of the context whose pixels these are.
    marks: Rc<RefCell<Marks>>,

    /// Whether these pixels are another context's, and where this one's
    /// start in the context that keeps the marks.
    owned: bool,
    pub owner_x: i32,
    pub owner_y: i32,
}

impl fmt::Debug for IndexedContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("IndexedContext")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("base", &self.base)
            .field("stride", &self.stride)
            .field("display", &self.display)
            .field("owned", &self.owned)
            .finish_non_exhaustive()
    }
}

impl Clone for IndexedContext {
    /// Another handle on the same context: its pixels and its marks are
    /// shared, as a TypeScript reference to it would share them.
    fn clone(&self) -> Self {
        Self {
            width: self.width,
            height: self.height,
            indices: Rc::clone(&self.indices),
            palette: Rc::clone(&self.palette),
            display: self.display,
            last: self.last,
            base: self.base,
            stride: self.stride,
            clip: self.clip.clone(),
            dc_clip: self.dc_clip.clone(),
            marks: Rc::clone(&self.marks),
            owned: self.owned,
            owner_x: self.owner_x,
            owner_y: self.owner_y,
        }
    }
}

impl IndexedContext {
    pub fn new(width: i32, height: i32, indices: Indices, palette: SharedPalette) -> Self {
        Self {
            width,
            height,
            indices,
            palette,
            display: None,
            last: None,
            base: 0,
            stride: width as isize,
            clip: None,
            dc_clip: None,
            marks: Rc::new(RefCell::new(Marks::clean())),
            owned: false,
            owner_x: 0,
            owner_y: 0,
        }
    }

    /// This context drawing into `owner`'s pixels, `x, y` in from its
    /// corner: what it writes is marked there.
    pub fn own_by(&mut self, owner: &Self, x: i32, y: i32) {
        self.marks = Rc::clone(&owner.marks);
        self.owned = true;
        self.owner_x = x + owner.owner_x;
        self.owner_y = y + owner.owner_y;
    }

    /// Whether these pixels are another context's.
    pub fn is_owned(&self) -> bool {
        self.owned
    }

    /// Who is told when the first pixel after a clean frame is written. A
    /// view marks its owner's frame, and is never told: the owner is.
    pub fn on_dirty(&mut self, notify: Option<Box<dyn FnMut()>>) {
        if !self.owned {
            self.marks.borrow_mut().on_dirty = notify;
        }
    }

    /// Where a pixel is in `indices`, or -1 outside the context.
    pub fn address(&self, x: i32, y: i32) -> isize {
        if x < 0 || y < 0 || x >= self.width || y >= self.height {
            return -1;
        }

        self.base + y as isize * self.stride + x as isize
    }

    /// The index for a colour given as RGBA bytes.
    pub fn index_of(&mut self, colour: [u8; 4]) -> usize {
        let key = u32::from(colour[0]) << 16 | u32::from(colour[1]) << 8 | u32::from(colour[2]);

        if let Some((last, index)) = self.last
            && last == key
        {
            return index;
        }

        let index = matched_index(
            self.display.unwrap_or_default(),
            &mut self.palette.borrow_mut(),
            colour[0],
            colour[1],
            colour[2],
        );

        self.last = Some((key, index));
        index
    }

    pub fn set_pixel(&mut self, x: i32, y: i32, colour: [u8; 4]) {
        if colour[3] == 0 || x < 0 || y < 0 || x >= self.width || y >= self.height {
            return;
        }

        if self.clip.as_ref().is_some_and(|clip| !clip(x, y)) {
            return;
        }

        if self.dc_clip.as_ref().is_some_and(|clip| !clip(x, y)) {
            return;
        }

        let index = self.index_of(colour);
        let at = self.address(x, y);

        // An address past the store is no pixel, as a typed array's write
        // past its end is nothing.
        if let Ok(at) = usize::try_from(at)
            && let Some(pixel) = self.indices.borrow_mut().get_mut(at)
        {
            *pixel = index as u8;
        }

        self.mark_rect(x, y, x + 1, y + 1);
    }

    /// Records that a rectangle was written, the right and bottom edges
    /// outside it.
    pub fn mark_rect(&self, left: i32, top: i32, right: i32, bottom: i32) {
        let (left, top, right, bottom) = (
            left + self.owner_x,
            top + self.owner_y,
            right + self.owner_x,
            bottom + self.owner_y,
        );
        let notify = {
            let mut marks = self.marks.borrow_mut();
            let clean = marks.right <= marks.left;

            marks.left = marks.left.min(left);
            marks.top = marks.top.min(top);
            marks.right = marks.right.max(right);
            marks.bottom = marks.bottom.max(bottom);

            if clean { marks.on_dirty.take() } else { None }
        };

        // Told with the marks let go, so that it may ask for them.
        if let Some(mut notify) = notify {
            notify();

            let mut marks = self.marks.borrow_mut();

            if marks.on_dirty.is_none() {
                marks.on_dirty = Some(notify);
            }
        }
    }

    /// The rectangle written since the last call, clipped to the pixels. A
    /// view's writes are its owner's to take, and it has none of its own.
    pub fn take_dirty(&self) -> Option<Rect> {
        if self.owned {
            return None;
        }

        let mut marks = self.marks.borrow_mut();
        let rect = Rect {
            left: marks.left.max(0),
            top: marks.top.max(0),
            right: marks.right.min(self.width),
            bottom: marks.bottom.min(self.height),
        };

        marks.left = i32::MAX;
        marks.top = i32::MAX;
        marks.right = i32::MIN;
        marks.bottom = i32::MIN;

        (rect.right > rect.left && rect.bottom > rect.top).then_some(rect)
    }

    /// The colour of the index at an address of the store, black for none.
    fn colour_at(&self, at: isize) -> [u8; 3] {
        let indices = self.indices.borrow();
        let index = usize::try_from(at)
            .ok()
            .and_then(|at| indices.get(at).copied());

        index
            .and_then(|index| {
                self.palette
                    .borrow()
                    .colours
                    .get(usize::from(index))
                    .copied()
            })
            .unwrap_or([0, 0, 0])
    }

    /// The pixels as RGBA bytes, made from the indices.
    pub fn pixels(&self) -> Vec<u8> {
        let mut rgba = Vec::with_capacity((self.width.max(0) * self.height.max(0) * 4) as usize);

        for y in 0..self.height {
            for x in 0..self.width {
                let at = self.base + y as isize * self.stride + x as isize;
                let [red, green, blue] = self.colour_at(at);

                rgba.extend_from_slice(&[red, green, blue, 0xff]);
            }
        }

        rgba
    }

    /// A rectangle of the pixels as RGBA bytes; what is outside the context
    /// is left clear.
    pub fn image_data(&self, x: i32, y: i32, width: i32, height: i32) -> ImageData {
        let mut data = vec![0; (width.max(0) * height.max(0) * 4) as usize];

        for row in 0..height {
            for column in 0..width {
                let (sx, sy) = (x + column, y + row);

                if sx < 0 || sy < 0 || sx >= self.width || sy >= self.height {
                    continue;
                }

                let [red, green, blue] =
                    self.colour_at(self.base + sy as isize * self.stride + sx as isize);
                let to = ((row * width + column) * 4) as usize;

                data[to..to + 4].copy_from_slice(&[red, green, blue, 0xff]);
            }
        }

        ImageData {
            width,
            height,
            data,
        }
    }
}
