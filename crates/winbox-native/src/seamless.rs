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
/// host's windows, of what kind, and whether it is its program's one on the
/// host's task bar. Any of these changed, it is made again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Made {
    pub index: usize,
    pub owner: Option<usize>,
    pub kind: TopKind,
    pub task_bar: bool,
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

/// The windows on the host's task bar, one for each task: of its windows
/// shown that nothing shown owns, its first overlapped window, else its
/// first pop-up -- first by index, which a window keeps while it lives, so
/// the choice holds while they do. Windows 3.1 has no task bar; this is the
/// host's, and a program's other windows are only kept off it. They are not
/// owned by the one on it, which would hold them above it on the host
/// where Windows lets the program stack them as it will.
fn on_task_bar(shown: &[&TopWindow]) -> Vec<usize> {
    let mut chosen: Vec<(u16, usize, bool)> = Vec::new();

    for top in shown {
        let overlapped = match top.kind {
            TopKind::Overlapped => true,
            TopKind::Popup => false,
            TopKind::Menu | TopKind::DropDown | TopKind::Switch => continue,
        };

        if host_owner(top, shown).is_some() {
            continue;
        }

        match chosen.iter_mut().find(|(task, _, _)| *task == top.task) {
            Some(one) => {
                if (overlapped, std::cmp::Reverse(top.index)) > (one.2, std::cmp::Reverse(one.1)) {
                    *one = (top.task, top.index, overlapped);
                }
            }
            None => chosen.push((top.task, top.index, overlapped)),
        }
    }

    chosen.into_iter().map(|(_, index, _)| index).collect()
}

/// What to make and take away, from the host's windows `made` and the
/// windows at the top now, front to back.
pub fn plan(made: &[Made], tops: &[TopWindow]) -> Plan {
    let shown: Vec<&TopWindow> = tops.iter().filter(|top| wanted(top)).collect();
    let task_bar = on_task_bar(&shown);
    let wants: Vec<Made> = shown
        .iter()
        .map(|top| Made {
            index: top.index,
            owner: host_owner(top, &shown),
            kind: top.kind,
            task_bar: task_bar.contains(&top.index),
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

/// A monitor of the host's: its work area, the part a window of the host's
/// may fill clear of its task bar, as left, top, right and bottom in the
/// host's pixels; and whether it is the primary one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Monitor {
    pub area: [i32; 4],
    pub primary: bool,
}

/// The emulated screen laid on the host's, and its size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostScreen {
    pub mapping: Mapping,
    pub size: (i16, i16),
}

/// How seamless mode's scale is chosen: given (`--scale`), from a width the
/// program is to see (`--resolution`), or by default -- the smallest that
/// keeps the screen within `tried` each way and is at least the primary
/// monitor's own scale, rounded (`least`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScaleChoice {
    Given(u32),
    Resolution(i32),
    Default { least: u32, tried: i32 },
}

/// The rectangle around every monitor's work area: left, top, right,
/// bottom, in the host's pixels.
pub fn bounds(monitors: &[Monitor]) -> Option<[i32; 4]> {
    let first = monitors.first()?;

    Some(monitors.iter().fold(first.area, |[l, t, r, b], monitor| {
        let [ml, mt, mr, mb] = monitor.area;

        [l.min(ml), t.min(mt), r.max(mr), b.max(mb)]
    }))
}

/// Seamless mode's scale, a whole number -- a fraction would make the
/// screen's pixels uneven on the host -- for a host rectangle `width` by
/// `height` (`ScaleChoice`). For a resolution, the scale whose width, the
/// host's divided and rounded down, is nearest the one asked for, a tie
/// going to the larger scale: 7680 across for 1280 is 6, exactly; for 1024
/// it is 8, 960 across, as 7 would give 1097, further off.
pub fn choose_scale(width: i32, height: i32, choice: ScaleChoice) -> u32 {
    let width = width.max(1);
    let height = height.max(1);

    match choice {
        ScaleChoice::Given(scale) => scale.max(1),
        ScaleChoice::Resolution(wanted) => {
            let wanted = wanted.max(1);
            let mut best = (i32::MAX, 1);

            for scale in 1..=width {
                let off = (width / scale - wanted).abs();

                if off <= best.0 {
                    best = (off, scale);
                }

                if width / scale < wanted {
                    break;
                }
            }

            u32::try_from(best.1).unwrap_or(1)
        }
        ScaleChoice::Default { least, tried } => {
            let mut scale = i32::try_from(least.max(1)).unwrap_or(1);

            while width / scale > tried.max(1) || height / scale > tried.max(1) {
                scale += 1;
            }

            u32::try_from(scale).unwrap_or(1)
        }
    }
}

/// The emulated screen made the host's desktop: one rectangle around every
/// monitor's work area, Windows 3.1 knowing of one screen only, divided by
/// `scale` and rounded down each way. Its top left is the rectangle's, left
/// of or above the primary monitor where another monitor lies there. The
/// host's pixels left over at the right and the bottom, fewer than a scale,
/// are beyond the screen: no window can be put there. A part of the
/// rectangle no monitor covers, between monitors of different sizes, is
/// screen all the same: a window may be put there, and is not seen. At most
/// `most` each way, beyond which the rectangle is cut down around the
/// primary monitor, a window past it being off the screen. With no monitor
/// to go by, `fallback` at the host's corner.
pub fn host_screen(
    monitors: &[Monitor],
    scale: u32,
    most: i16,
    fallback: (i16, i16),
) -> HostScreen {
    let scale = scale.max(1);
    let step = i32::try_from(scale).unwrap_or(1);
    let Some(bound) = bounds(monitors) else {
        return HostScreen {
            mapping: Mapping::new((0, 0), scale),
            size: fallback,
        };
    };
    let primary = monitors
        .iter()
        .find(|monitor| monitor.primary)
        .unwrap_or(&monitors[0])
        .area;
    let most = i32::from(most.max(1));
    // Along one axis: where the screen starts and its length in the
    // screen's pixels; cut down to the most around the primary monitor,
    // starting at it where it can.
    let axis = |start: i32, end: i32, primary_start: i32| {
        let length = ((end - start) / step).max(1);

        if length <= most {
            return (start, length);
        }

        let latest = end - most * step;

        (primary_start.clamp(start, latest.max(start)), most)
    };
    let (x, width) = axis(bound[0], bound[2], primary[0]);
    let (y, height) = axis(bound[1], bound[3], primary[1]);

    HostScreen {
        mapping: Mapping::new((x, y), scale),
        size: (
            i16::try_from(width).unwrap_or(i16::MAX),
            i16::try_from(height).unwrap_or(i16::MAX),
        ),
    }
}

/// The host's windows to lay in front of the host's others, front to back,
/// when `focused` has the host's keyboard: of the windows shown in `order`
/// (front to back), those of `focused`'s program -- its task's, whose one
/// window is on the task bar -- and those owned on the host by one of them,
/// a menu or a list dropped down. Other programs' windows are left where
/// the host has them: the host raises a program as the user picks it.
pub fn raised_group(
    order: &[usize],
    tops: &[TopWindow],
    made: &[Made],
    focused: usize,
) -> Vec<usize> {
    let Some(task) = tops
        .iter()
        .find(|top| top.index == focused)
        .map(|top| top.task)
    else {
        return Vec::new();
    };
    let in_group = |index: usize| {
        let mut at = Some(index);
        let mut steps = 0;

        while let Some(one) = at {
            if tops.iter().any(|top| top.index == one && top.task == task) {
                return true;
            }

            at = made
                .iter()
                .find(|made| made.index == one)
                .and_then(|made| made.owner);
            steps += 1;

            if steps > made.len() {
                break;
            }
        }

        false
    };

    order
        .iter()
        .copied()
        .filter(|&index| in_group(index))
        .collect()
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
            task: 1,
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
            task_bar: owner.is_none(),
        }
    }

    #[test]
    fn one_window_of_each_task_is_on_the_task_bar() {
        let with = |index: usize, kind: TopKind, owner: Option<usize>, task: u16| TopWindow {
            kind,
            task,
            ..top(index, owner, true)
        };
        let task_bar = |tops: &[TopWindow]| {
            let mut on: Vec<usize> = plan(&[], tops)
                .create
                .iter()
                .filter(|made| made.task_bar)
                .map(|made| made.index)
                .collect();

            on.sort_unstable();
            on
        };

        // SimTower's title: its picture, a pop-up, and the box its hidden
        // main window owns.
        let mut hidden = with(7, TopKind::Overlapped, None, 1);

        hidden.visible = false;
        assert_eq!(
            task_bar(&[
                with(9, TopKind::Popup, Some(7), 1),
                with(8, TopKind::Popup, None, 1),
                hidden,
            ]),
            [8]
        );
        // Its game: the main window, three palettes it does not own, and a
        // menu; and another program beside it.
        assert_eq!(
            task_bar(&[
                with(5, TopKind::Popup, None, 1),
                with(6, TopKind::Popup, None, 1),
                with(4, TopKind::Popup, None, 1),
                with(10, TopKind::Menu, None, 1),
                with(7, TopKind::Overlapped, None, 1),
                with(12, TopKind::Popup, Some(11), 2),
                with(11, TopKind::Overlapped, None, 2),
            ]),
            [7, 11]
        );
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
                kind: TopKind::Menu,
                task_bar: false
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
                    kind: TopKind::Popup,
                    task_bar: false
                },
                Made {
                    index: 17,
                    owner: Some(5),
                    kind: TopKind::DropDown,
                    task_bar: false
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

    fn monitor(area: [i32; 4], primary: bool) -> Monitor {
        Monitor { area, primary }
    }

    #[test]
    fn a_resolution_picks_the_nearest_whole_scale() {
        let resolution = |width, height, wanted| {
            let scale = choose_scale(width, height, ScaleChoice::Resolution(wanted));
            let screen = host_screen(
                &[monitor([0, 0, width, height], true)],
                scale,
                16383,
                (640, 480),
            );

            (scale, screen.size)
        };

        // 8K for 1280 by 720: 6, exactly.
        assert_eq!(resolution(7680, 4320, 1280), (6, (1280, 720)));
        // For 1024: 7 gives 1097, 73 over; 8 gives 960, 64 under.
        assert_eq!(resolution(7680, 4320, 1024), (8, (960, 540)));
        // A tie goes to the larger scale: 3000 for 1000 is 3; for 1200,
        // 2 gives 1500 and 3 gives 1000, each 300 off.
        assert_eq!(resolution(3000, 2000, 1000).0, 3);
        assert_eq!(resolution(3000, 2000, 1200).0, 3);
        // Wider than the host: 1.
        assert_eq!(resolution(1920, 1080, 4000), (1, (1920, 1080)));
        // 1440p at 3, rounded down: 853 by 480, a column of the host's
        // past the screen.
        assert_eq!(resolution(2560, 1440, 853), (3, (853, 480)));
    }

    #[test]
    fn the_default_scale_keeps_the_screen_within_2048() {
        let default = |width, height, least| {
            choose_scale(width, height, ScaleChoice::Default { least, tried: 2048 })
        };

        // 4K: 2, 1920 by 1080.
        assert_eq!(default(3840, 2160, 1), 2);
        assert_eq!(
            host_screen(&[monitor([0, 0, 3840, 2160], true)], 2, 16383, (640, 480)).size,
            (1920, 1080)
        );
        // 1080p: 1; at a monitor scale of 2, 2.
        assert_eq!(default(1920, 1080, 1), 1);
        assert_eq!(default(1920, 1080, 2), 2);
        // 8K: 4, 1920 by 1080.
        assert_eq!(default(7680, 4320, 1), 4);
        // Given, as it is.
        assert_eq!(choose_scale(3840, 2160, ScaleChoice::Given(3)), 3);
        assert_eq!(choose_scale(3840, 2160, ScaleChoice::Given(0)), 1);
    }

    #[test]
    fn monitors_make_one_rectangle_its_corner_where_it_may_be_negative() {
        // A smaller monitor to the left of the primary one, its top higher.
        let monitors = [
            monitor([0, 0, 2560, 1400], true),
            monitor([-1280, -200, 0, 824], false),
        ];

        assert_eq!(bounds(&monitors), Some([-1280, -200, 2560, 1400]));

        let screen = host_screen(&monitors, 1, 16383, (640, 480));

        assert_eq!(screen.mapping.origin, (-1280, -200));
        assert_eq!(screen.size, (3840, 1600));
        // A point of the primary monitor's corner is well inside the screen.
        assert_eq!(screen.mapping.to_emulated(0, 0), (1280, 200));
        assert_eq!(screen.mapping.to_host(1280, 200), (0, 0));
        // The gap below the smaller monitor is screen as well.
        assert_eq!(screen.mapping.to_emulated(-100, 1300), (1180, 1500));
        // The default scale for the whole rectangle: 2.
        assert_eq!(
            choose_scale(
                3840,
                1600,
                ScaleChoice::Default {
                    least: 1,
                    tried: 2048
                }
            ),
            2
        );

        let screen = host_screen(&monitors, 2, 16383, (640, 480));

        assert_eq!(screen.mapping.origin, (-1280, -200));
        assert_eq!(screen.size, (1920, 800));
        assert_eq!(screen.mapping.to_emulated(-1, -1), (639, 99));
        // At 3, rounded down: 1280 by 533.
        assert_eq!(
            host_screen(&monitors, 3, 16383, (640, 480)).size,
            (1280, 533)
        );
    }

    #[test]
    fn a_task_bar_along_the_top_or_left_moves_the_corner() {
        let screen = host_screen(&[monitor([62, 0, 1920, 1080], true)], 1, 16383, (640, 480));

        assert_eq!(screen.mapping.origin, (62, 0));
        assert_eq!(screen.size, (1858, 1080));
    }

    #[test]
    fn a_screen_too_large_is_cut_down_around_the_primary_monitor() {
        // Three 8K monitors side by side at scale 1, the primary on the
        // right: 23040 across, cut to 16383.
        let monitors = [
            monitor([-15360, 0, -7680, 4320], false),
            monitor([-7680, 0, 0, 4320], false),
            monitor([0, 0, 7680, 4320], true),
        ];
        let screen = host_screen(&monitors, 1, 16383, (640, 480));

        assert_eq!(screen.size, (16383, 4320));
        assert_eq!(screen.mapping.origin, (7680 - 16383, 0));
        // The primary on the left: the screen starts at its corner.
        let monitors = [
            monitor([0, 0, 7680, 4320], true),
            monitor([7680, 0, 15360, 4320], false),
            monitor([15360, 0, 23040, 4320], false),
        ];

        assert_eq!(
            host_screen(&monitors, 1, 16383, (640, 480)).mapping.origin,
            (0, 0)
        );
        // No monitor to go by.
        assert_eq!(host_screen(&[], 3, 16383, (640, 480)).size, (640, 480));
    }

    #[test]
    fn the_focused_programs_windows_are_raised_alone_in_order() {
        let with = |index: usize, kind: TopKind, owner: Option<usize>, task: u16| TopWindow {
            kind,
            task,
            ..top(index, owner, true)
        };
        // Front to back: SimTower's main window (task 1), another program's
        // window (task 2), SimTower's three palettes it does not own, the
        // other program's dialog it owns, and a menu of SimTower's, owned
        // on the host by its main window.
        let mut menu = with(10, TopKind::Menu, None, 0);

        menu.active = false;

        let tops = [
            menu,
            with(7, TopKind::Overlapped, None, 1),
            with(11, TopKind::Overlapped, None, 2),
            with(4, TopKind::Popup, None, 1),
            with(5, TopKind::Popup, None, 1),
            with(6, TopKind::Popup, None, 1),
            with(12, TopKind::Popup, Some(11), 2),
        ];
        let made: Vec<Made> = tops
            .iter()
            .map(|top| Made {
                index: top.index,
                owner: if top.index == 10 { Some(7) } else { top.owner },
                kind: top.kind,
                task_bar: false,
            })
            .collect();
        let order: Vec<usize> = tops.iter().map(|top| top.index).collect();

        // A palette focused raises SimTower's own, in the emulated order.
        assert_eq!(raised_group(&order, &tops, &made, 5), [10, 7, 4, 5, 6]);
        assert_eq!(raised_group(&order, &tops, &made, 7), [10, 7, 4, 5, 6]);
        // The other program's, its owned dialog with it.
        assert_eq!(raised_group(&order, &tops, &made, 11), [11, 12]);
        assert_eq!(raised_group(&order, &tops, &made, 12), [11, 12]);
        // A window not shown in the order raises nothing of itself.
        assert!(raised_group(&order, &tops, &made, 99).is_empty());
    }

    #[test]
    fn pixels_are_enlarged() {
        let out = fit(2, 1, &[1, 2], 4, 2);

        assert_eq!(out, vec![1, 1, 2, 2, 1, 1, 2, 2]);
    }
}
