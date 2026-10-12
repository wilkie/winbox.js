//! Seamless mode's reckoning, apart from any host: where a window of the
//! emulated screen goes on the host's, and which of the host's windows are
//! made, kept and taken away as the windows at the top change. The host's
//! own side is `seamless_host.rs`.

use winbox_win16::seamless::{TopKind, TopWindow};
use winbox_win16::windows::Placement;

/// The emulated screen laid on the host's: its top left at `origin`, in
/// the host's pixels, and each of its pixels `scale` of the host's square.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mapping {
    pub origin: (i32, i32),
    pub scale: u32,
}

impl Mapping {
    pub fn new(origin: (i32, i32), scale: u32) -> Self {
        Self {
            origin,
            scale: scale.max(1),
        }
    }

    fn scale(self) -> i32 {
        i32::try_from(self.scale).unwrap_or(1)
    }

    /// A point of the emulated screen on the host's.
    pub fn to_host(self, x: i32, y: i32) -> (i32, i32) {
        (
            self.origin.0 + x * self.scale(),
            self.origin.1 + y * self.scale(),
        )
    }

    /// A rectangle of the emulated screen -- left, top, width, height --
    /// on the host's: where, and how large.
    pub fn rect_to_host(self, rect: [i32; 4]) -> ((i32, i32), (u32, u32)) {
        let size = |n: i32| u32::try_from(n.max(1) * self.scale()).unwrap_or(1);

        (
            self.to_host(rect[0], rect[1]),
            (size(rect[2]), size(rect[3])),
        )
    }

    /// A point of the host's screen on the emulated one: the pixel it is
    /// in, rounded down, off the screen as well.
    pub fn to_emulated(self, x: i32, y: i32) -> (i32, i32) {
        (
            (x - self.origin.0).div_euclid(self.scale()),
            (y - self.origin.1).div_euclid(self.scale()),
        )
    }

    /// A point of a host's window showing `rect` of the emulated screen,
    /// from the window's top left, as a point of the emulated screen: the
    /// window shows that rectangle wherever the host has put it, and a
    /// point outside it, while the pointer is held, lies beyond it.
    pub fn in_window(self, rect: [i32; 4], x: i32, y: i32) -> (i32, i32) {
        (
            rect[0] + x.div_euclid(self.scale()),
            rect[1] + y.div_euclid(self.scale()),
        )
    }

    /// The host's window -- where its top left is, how large it is --
    /// as a rectangle of the emulated screen, as a drag of the host's
    /// leaves it.
    pub fn rect_to_emulated(self, at: (i32, i32), size: (u32, u32)) -> [i32; 4] {
        let (left, top) = self.to_emulated(at.0, at.1);
        let length = |n: u32| (i32::try_from(n).unwrap_or(i32::MAX) / self.scale()).max(1);

        [left, top, length(size.0), length(size.1)]
    }
}

/// The emulated rectangle a window at the top shows as on the host: where
/// it is, but a minimized one's where it goes back to, the host showing the
/// icon in its own way.
pub fn shown_rect(top: &TopWindow) -> [i32; 4] {
    match (top.placement, top.restore) {
        (Placement::Minimized, Some(restore)) => restore,
        _ => top.rect,
    }
}

/// Whether the host is to show a window at the top: it is visible. An icon
/// is visible, and is shown minimized.
pub fn wanted(top: &TopWindow) -> bool {
    top.visible
}

/// What a host's window was made for: which window, owned by which of the
/// host's windows, of what kind. Any of these changed, it is made again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Made {
    pub index: usize,
    pub owner: Option<usize>,
    pub kind: TopKind,
}

/// The host's windows made and taken away for a change of the windows at
/// the top.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    /// Taken away, owned ones before their owners.
    pub destroy: Vec<usize>,
    /// Made, back to front: an owner before what it owns.
    pub create: Vec<Made>,
    /// Every window shown, front to back, as the host is to stack them.
    pub order: Vec<usize>,
}

/// The owner a host's window is made with: the window's owner, where the
/// host shows that too -- the host has no hidden owner to give it. USER's
/// own windows that nothing owns -- a combo box's list dropped down, a menu
/// tracked with no window, Alt and Tab's switch window -- are owned on the
/// host by the active window, or else the one in front, so that the host
/// neither shows them on its task bar nor lets them fall behind it.
fn host_owner(top: &TopWindow, shown: &[&TopWindow]) -> Option<usize> {
    let own = top
        .owner
        .filter(|owner| shown.iter().any(|other| other.index == *owner));

    if own.is_some()
        || !matches!(
            top.kind,
            TopKind::Menu | TopKind::DropDown | TopKind::Switch
        )
    {
        return own;
    }

    let applications = || {
        shown.iter().filter(|other| {
            other.index != top.index && matches!(other.kind, TopKind::Overlapped | TopKind::Popup)
        })
    };

    applications()
        .find(|other| other.active)
        .or_else(|| applications().next())
        .map(|other| other.index)
}

/// What to make and take away, from the host's windows `made` and the
/// windows at the top now, front to back.
pub fn plan(made: &[Made], tops: &[TopWindow]) -> Plan {
    let shown: Vec<&TopWindow> = tops.iter().filter(|top| wanted(top)).collect();
    let wants: Vec<Made> = shown
        .iter()
        .map(|top| Made {
            index: top.index,
            owner: host_owner(top, &shown),
            kind: top.kind,
        })
        .collect();

    // Taken away: what is no longer shown, or is shown otherwise; and then
    // whatever a window taken away owns, which the host takes with it.
    let mut destroy: Vec<usize> = made
        .iter()
        .filter(|one| !wants.contains(one))
        .map(|one| one.index)
        .collect();
    let mut grew = true;

    while grew {
        grew = false;

        for one in made {
            if !destroy.contains(&one.index)
                && one.owner.is_some_and(|owner| destroy.contains(&owner))
            {
                destroy.push(one.index);
                grew = true;
            }
        }
    }

    // Owned before owners: the deeper first.
    let depth = |index: usize| {
        let mut depth = 0;
        let mut at = made.iter().find(|one| one.index == index);

        while let Some(one) = at.and_then(|one| one.owner) {
            depth += 1;
            at = made.iter().find(|other| other.index == one);

            if depth > made.len() {
                break;
            }
        }

        depth
    };

    destroy.sort_by_key(|&index| std::cmp::Reverse(depth(index)));

    let kept: Vec<usize> = made
        .iter()
        .map(|one| one.index)
        .filter(|index| !destroy.contains(index))
        .collect();
    // Back to front, but never before its owner.
    let mut waiting: Vec<Made> = wants
        .iter()
        .rev()
        .filter(|want| !kept.contains(&want.index))
        .copied()
        .collect();
    let mut create = Vec::new();

    while !waiting.is_empty() {
        let ready = waiting
            .iter()
            .position(|want| {
                want.owner.is_none_or(|owner| {
                    kept.contains(&owner) || create.iter().any(|made: &Made| made.index == owner)
                })
            })
            .unwrap_or(0);

        create.push(waiting.remove(ready));
    }

    Plan {
        destroy,
        create,
        order: shown.iter().map(|top| top.index).collect(),
    }
}

/// A window's pixels cut out of the screen's: `rect` of the `width` by
/// `height` screen, each pixel off the screen black -- there is nothing
/// drawn there to show.
pub fn cut(width: usize, height: usize, pixels: &[u32], rect: [i32; 4]) -> Vec<u32> {
    let (w, h) = (rect[2].max(0) as usize, rect[3].max(0) as usize);
    let mut out = vec![0; w * h];

    for row in 0..h {
        let y = rect[1] + row as i32;

        if y < 0 || y as usize >= height {
            continue;
        }

        for column in 0..w {
            let x = rect[0] + column as i32;

            if x >= 0 && (x as usize) < width {
                out[row * w + column] = pixels[y as usize * width + x as usize];
            }
        }
    }

    out
}

/// A window's pixels drawn `out_width` by `out_height`, as large as the
/// host's window has them: each of the host's pixels the one it lies on.
pub fn fit(
    width: usize,
    height: usize,
    pixels: &[u32],
    out_width: usize,
    out_height: usize,
) -> Vec<u32> {
    let mut out = vec![0; out_width * out_height];

    if width == 0 || height == 0 {
        return out;
    }

    for row in 0..out_height {
        let from = (row * height / out_height) * width;

        for column in 0..out_width {
            out[row * out_width + column] = pixels[from + column * width / out_width];
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn top(index: usize, owner: Option<usize>, visible: bool) -> TopWindow {
        TopWindow {
            index,
            hwnd: index as u16 * 4 + 0x20,
            rect: [10, 20, 100, 50],
            restore: None,
            z: 0,
            owner,
            visible,
            placement: Placement::Normal,
            caption: String::new(),
            kind: TopKind::Overlapped,
            active: false,
            captioned: true,
            sizable: true,
            disabled: false,
        }
    }

    fn made(index: usize, owner: Option<usize>) -> Made {
        Made {
            index,
            owner,
            kind: TopKind::Overlapped,
        }
    }

    #[test]
    fn a_point_goes_to_the_host_and_back() {
        let mapping = Mapping::new((100, 40), 2);

        assert_eq!(mapping.to_host(0, 0), (100, 40));
        assert_eq!(mapping.to_host(639, 479), (1378, 998));
        assert_eq!(mapping.to_emulated(1378, 998), (639, 479));
        // Either pixel of the host's two makes one of the screen's.
        assert_eq!(mapping.to_emulated(1379, 999), (639, 479));
        // Off the screen, to the left and above, it rounds down.
        assert_eq!(mapping.to_emulated(99, 39), (-1, -1));
        assert_eq!(mapping.to_emulated(98, 38), (-1, -1));
        assert_eq!(mapping.to_emulated(97, 37), (-2, -2));
    }

    #[test]
    fn a_rectangle_goes_to_the_host_and_back() {
        let mapping = Mapping::new((0, 32), 2);
        let (at, size) = mapping.rect_to_host([-5, 10, 200, 100]);

        assert_eq!(at, (-10, 52));
        assert_eq!(size, (400, 200));
        assert_eq!(mapping.rect_to_emulated(at, size), [-5, 10, 200, 100]);
        // Nothing is made smaller than a pixel.
        assert_eq!(mapping.rect_to_host([0, 0, 0, 0]).1, (2, 2));
    }

    #[test]
    fn a_point_of_a_window_is_a_point_of_its_rectangle() {
        let mapping = Mapping::new((100, 40), 2);

        assert_eq!(mapping.in_window([50, 60, 200, 100], 0, 0), (50, 60));
        assert_eq!(mapping.in_window([50, 60, 200, 100], 399, 199), (249, 159));
        // Held outside the window, to its left and above.
        assert_eq!(mapping.in_window([50, 60, 200, 100], -1, -3), (49, 58));
    }

    #[test]
    fn a_scale_of_nought_is_one() {
        assert_eq!(Mapping::new((0, 0), 0).scale, 1);
    }

    #[test]
    fn new_windows_are_made_owners_first() {
        // Front to back: a dialog owned by the main window, which is under it.
        let tops = [top(5, Some(2), true), top(2, None, true)];
        let plan = plan(&[], &tops);

        assert_eq!(plan.create, vec![made(2, None), made(5, Some(2))]);
        assert!(plan.destroy.is_empty());
        assert_eq!(plan.order, vec![5, 2]);
    }

    #[test]
    fn nothing_changes_for_the_same_windows() {
        let tops = [top(5, Some(2), true), top(2, None, true)];
        let plan = plan(&[made(2, None), made(5, Some(2))], &tops);

        assert!(plan.create.is_empty());
        assert!(plan.destroy.is_empty());
    }

    #[test]
    fn a_hidden_window_is_taken_away_with_what_it_owns() {
        // The main window hidden: the host would take its owned window with
        // it, so that is made again, owned by nothing.
        let tops = [top(5, Some(2), true), top(2, None, false)];
        let plan = plan(&[made(2, None), made(5, Some(2))], &tops);

        assert_eq!(plan.destroy, vec![5, 2]);
        assert_eq!(plan.create, vec![made(5, None)]);
        assert_eq!(plan.order, vec![5]);
    }

    #[test]
    fn an_owner_shown_again_makes_its_window_again() {
        let tops = [top(5, Some(2), true), top(2, None, true)];
        let plan = plan(&[made(5, None)], &tops);

        assert_eq!(plan.destroy, vec![5]);
        assert_eq!(plan.create, vec![made(2, None), made(5, Some(2))]);
    }

    #[test]
    fn a_window_of_another_kind_is_made_again() {
        let mut menu = top(7, Some(2), true);

        menu.kind = TopKind::Menu;

        let tops = [menu, top(2, None, true)];
        let plan = plan(&[made(2, None), made(7, Some(2))], &tops);

        assert_eq!(plan.destroy, vec![7]);
        assert_eq!(
            plan.create,
            vec![Made {
                index: 7,
                owner: Some(2),
                kind: TopKind::Menu
            }]
        );
    }

    #[test]
    fn a_list_dropped_down_is_owned_by_the_active_window() {
        // Front to back: the list, owned by nothing; the Open dialog, active;
        // Notepad, which owns it.
        let mut list = top(17, None, true);
        let mut dialog = top(5, Some(3), true);

        list.kind = TopKind::DropDown;
        dialog.kind = TopKind::Popup;
        dialog.active = true;

        let tops = [list, dialog, top(3, None, true)];
        let plan = plan(&[], &tops);

        assert_eq!(
            plan.create,
            vec![
                made(3, None),
                Made {
                    index: 5,
                    owner: Some(3),
                    kind: TopKind::Popup
                },
                Made {
                    index: 17,
                    owner: Some(5),
                    kind: TopKind::DropDown
                }
            ]
        );
    }

    #[test]
    fn an_owner_in_front_is_made_first() {
        // An owned window behind its owner, as a program may stack them.
        let tops = [top(2, None, true), top(5, Some(2), true)];
        let plan = plan(&[], &tops);

        assert_eq!(plan.create, vec![made(2, None), made(5, Some(2))]);
    }

    #[test]
    fn a_destroyed_chain_goes_deepest_first() {
        let tops = [top(9, None, true)];
        let plan = plan(&[made(2, None), made(5, Some(2)), made(6, Some(5))], &tops);

        assert_eq!(plan.destroy, vec![6, 5, 2]);
        assert_eq!(plan.create, vec![made(9, None)]);
    }

    #[test]
    fn a_minimized_window_shows_where_it_goes_back_to() {
        let mut icon = top(3, None, true);

        icon.placement = Placement::Minimized;
        icon.rect = [8, 440, 36, 36];
        icon.restore = Some([40, 30, 300, 200]);
        assert_eq!(shown_rect(&icon), [40, 30, 300, 200]);
        assert!(wanted(&icon));
    }

    #[test]
    fn pixels_off_the_screen_are_black() {
        let pixels: Vec<u32> = (0..16).collect();
        let out = cut(4, 4, &pixels, [-1, 2, 3, 3]);

        assert_eq!(out, vec![0, 8, 9, 0, 12, 13, 0, 0, 0]);
    }

    #[test]
    fn pixels_are_enlarged() {
        let out = fit(2, 1, &[1, 2], 4, 2);

        assert_eq!(out, vec![1, 1, 2, 2, 1, 1, 2, 2]);
    }
}
