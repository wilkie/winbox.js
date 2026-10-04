//! A device-dependent bitmap: what `CreateBitmap`, `CreateCompatibleBitmap`
//! and `LoadBitmap` make, and what a memory device context draws into.

use std::cell::RefCell;
use std::rc::Rc;

use crate::DevicePalette;
use crate::colour_match::DisplayKind;
use crate::indexed_context::{Clip, IndexedContext, Indices, SharedPalette};

thread_local! {
    /// The palettes of each depth, and the EGA's: one of each, shared by
    /// every bitmap made without a palette of its own, as the TypeScript
    /// engine's `DevicePalette.MONO`, `SIXTEEN`, `EGA` and `TWO_FIFTY_SIX`
    /// are. A palette realized on the 256-colour display changes that one
    /// in place, for everything that holds it.
    static SHARED: [SharedPalette; 4] = [
        Rc::new(RefCell::new(DevicePalette::mono())),
        Rc::new(RefCell::new(DevicePalette::sixteen())),
        Rc::new(RefCell::new(DevicePalette::ega())),
        Rc::new(RefCell::new(DevicePalette::two_fifty_six())),
    ];
}

/// The shared palette for a depth in bits a pixel.
pub fn palette_for_depth(depth: u8) -> SharedPalette {
    SHARED.with(|shared| {
        Rc::clone(match depth {
            1 => &shared[0],
            4 => &shared[1],
            _ => &shared[3],
        })
    })
}

/// The shared palette of a display's own bitmaps, and of any bitmap at its
/// depth: a display mode may name one of its driver's own.
pub fn palette_for_display(display: DisplayKind, depth: Option<u8>) -> SharedPalette {
    let depth = depth.unwrap_or_else(|| display.depth());

    if depth == display.depth() && display.ega {
        return SHARED.with(|shared| Rc::clone(&shared[2]));
    }

    palette_for_depth(depth)
}

/// A bitmap made in a shape no device context takes -- planes and bits a
/// pixel that are neither monochrome nor the display's: the shape, and its
/// bytes as they were given, with no pixels (`patmono`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shape {
    pub planes: u16,
    pub bits: u16,
    pub bytes: Vec<u8>,
}

/// A device-dependent bitmap.
///
/// One byte a pixel, holding an index into the palette for the bitmap's
/// depth -- black and white for a monochrome bitmap, the display's colours
/// for any other. There is one store: a memory device context's drawing,
/// `BitBlt`, `PatBlt`, `GetPixel` and the bits calls all work on these
/// bytes, so nothing drawn one way is missed by another. Colours are turned
/// into indices when they are drawn, as a display driver does, and back into
/// colours only when something asks for them.
///
/// A clone is another handle on the same bitmap, sharing its pixels, as a
/// TypeScript reference to it would.
#[derive(Debug, Clone)]
pub struct DeviceBitmap {
    width: i32,
    height: i32,
    pub depth: u8,
    pub indices: Indices,
    pub device_palette: SharedPalette,
    pub context: IndexedContext,

    /// The one-by-one bitmap a new memory device context starts with.
    pub placeholder: bool,

    /// Whether it has been selected into a device context: until then the
    /// driver's header GDI keeps for it points at no bits (`gdiobj`).
    pub selected: bool,

    pub shape: Option<Shape>,
}

impl DeviceBitmap {
    /// A bitmap of a size and depth, its pixels `indices` or all index 0,
    /// and its palette `palette` or the shared one for its depth.
    pub fn new(
        width: i32,
        height: i32,
        depth: u8,
        indices: Option<Indices>,
        palette: Option<SharedPalette>,
    ) -> Self {
        let palette = palette.unwrap_or_else(|| palette_for_depth(depth));
        let indices = indices.unwrap_or_else(|| {
            Rc::new(RefCell::new(vec![
                0;
                usize::try_from(width * height)
                    .unwrap_or(0)
            ]))
        });
        let context = IndexedContext::new(width, height, Rc::clone(&indices), Rc::clone(&palette));

        Self {
            width,
            height,
            depth,
            indices,
            device_palette: palette,
            context,
            placeholder: false,
            selected: false,
            shape: None,
        }
    }

    /// A view of `parent`'s pixels: `width` by `height` from `left, top`,
    /// drawn only where `clip` allows. Nothing is copied; what is drawn
    /// through the view is drawn on the parent, and marked there. This is a
    /// window's client area on the screen.
    pub fn view(
        parent: &Self,
        left: i32,
        top: i32,
        width: i32,
        height: i32,
        clip: Option<Clip>,
    ) -> Self {
        let mut view = Self::new(
            width,
            height,
            parent.depth,
            Some(Rc::clone(&parent.indices)),
            Some(Rc::clone(&parent.device_palette)),
        );
        let context = &mut view.context;

        context.display = parent.context.display;
        // The parent's width, not its stride, as the TypeScript engine has it.
        context.base = top as isize * parent.width as isize + left as isize;
        context.stride = parent.width as isize;
        context.clip = clip;
        context.own_by(&parent.context, left, top);

        view
    }

    /// Whether this bitmap's pixels are another's.
    pub fn is_view(&self) -> bool {
        self.context.is_owned()
    }

    /// Its pixels kept in `indices` from now on, `base` and `stride` placing
    /// them as `IndexedContext`'s do: a WinG bitmap's are its bits in the
    /// machine's memory, taken again when that memory moves.
    pub fn rebind(&mut self, indices: Indices, base: Option<isize>, stride: Option<isize>) {
        self.context.indices = Rc::clone(&indices);
        self.indices = indices;

        if let Some(base) = base {
            self.context.base = base;
        }

        if let Some(stride) = stride {
            self.context.stride = stride;
        }
    }

    /// Writes an index at a pixel, where the pixel exists and may be
    /// written.
    pub fn put(&self, x: i32, y: i32, index: u8) {
        let Ok(at) = usize::try_from(self.context.address(x, y)) else {
            return;
        };

        if self.context.clip.as_ref().is_some_and(|clip| !clip(x, y))
            || self
                .context
                .dc_clip
                .as_ref()
                .is_some_and(|clip| !clip(x, y))
        {
            return;
        }

        if let Some(pixel) = self.indices.borrow_mut().get_mut(at) {
            *pixel = index;
        }
    }

    /// A device bitmap's size is its own, whatever surface it is selected
    /// into.
    pub fn width(&self) -> i32 {
        self.width
    }

    pub fn height(&self) -> i32 {
        self.height
    }

    pub fn bpp(&self) -> u8 {
        self.depth
    }

    /// The bytes a row of the bitmap takes at its depth, rounded up to a
    /// whole number of four.
    pub fn width_bytes(&self) -> i32 {
        let bits = (i32::from(self.depth) * self.width + 7) & !7;

        ((bits >> 3) + 3) & !3
    }

    /// The index at a pixel, or `None` outside the bitmap.
    pub fn index_at(&self, x: i32, y: i32) -> Option<u8> {
        let at = usize::try_from(self.context.address(x, y)).ok()?;

        self.indices.borrow().get(at).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn puts_and_reads_indices() {
        let bitmap = DeviceBitmap::new(3, 2, 4, None, None);

        bitmap.put(2, 1, 9);
        bitmap.put(3, 1, 9);
        assert_eq!(bitmap.index_at(2, 1), Some(9));
        assert_eq!(bitmap.index_at(3, 1), None);
        assert_eq!(*bitmap.indices.borrow(), vec![0, 0, 0, 0, 0, 9]);
        assert_eq!(bitmap.width_bytes(), 4);
        assert!(Rc::ptr_eq(&bitmap.device_palette, &palette_for_depth(4)));
    }

    #[test]
    fn a_view_draws_on_its_parent_and_marks_it() {
        let screen = DeviceBitmap::new(8, 8, 4, None, None);
        let mut view = DeviceBitmap::view(&screen, 2, 3, 4, 4, Some(Rc::new(|x, _| x != 1)));

        view.put(0, 0, 12);
        view.put(1, 0, 12);
        view.context.set_pixel(3, 1, [0xff, 0xff, 0xff, 0xff]);
        assert!(view.is_view());
        assert_eq!(screen.index_at(2, 3), Some(12));
        assert_eq!(screen.index_at(3, 3), Some(0));
        assert_eq!(screen.index_at(5, 4), Some(15));
        assert_eq!(view.context.take_dirty(), None);
        assert_eq!(
            screen.context.take_dirty(),
            Some(crate::indexed_context::Rect {
                left: 5,
                top: 4,
                right: 6,
                bottom: 5
            })
        );

        view.rebind(Rc::new(RefCell::new(vec![7; 4])), Some(0), Some(2));
        assert_eq!(view.index_at(1, 1), Some(7));
        assert_eq!(view.index_at(2, 1), None);
    }

    #[test]
    fn the_ega_has_its_own_palette() {
        let ega = DisplayKind {
            colors: 16,
            ega: true,
        };

        assert_eq!(
            palette_for_display(ega, None).borrow().colours[8],
            [0x40, 0x40, 0x40]
        );
        assert_eq!(palette_for_display(ega, Some(1)).borrow().size(), 2);
    }
}
