//! The groups an instance has loaded, as the group model holds them
//! (`crate::groups`): what Program Manager's DDE reads -- the group list,
//! a group's text, its items -- until its groups are windows of their own.
//! As `src/win16/progman/loaded.ts`.
//!
//! `PROGMAN.EXE` keeps a group as a structure in its data segment (seg4
//! `1d8a`: the next, its MDI child, its block, its items, its file's path
//! and its number), the groups linked in the order they were loaded (`[13Ah]`
//! the first, `[13Eh]` the last) and `[13Ch]` the current one, and asks
//! each child window for its title, place and state. WinBox's has no group
//! windows yet: a group here is its number, path and model, in the order
//! loaded, and its window's state is what loading would have given it --
//! `SetWindowPlacement` of the file's `nCmdShow` (seg4 `1f04`-`1f51`) --
//! with the last loaded current (`1f78`) and on top.

use super::main::{Pm, R};
use crate::commdlg::api::{self, Arg};
use crate::groups::Group;

/// A group loaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Loaded {
    /// Its number, `GroupN=`'s.
    pub n: u16,
    /// Its file's path as `[Groups]` gives it (`[si+8]`).
    pub path: Vec<u8>,
    pub group: Group,
}

impl Loaded {
    /// Its window's title: the group's name (`1efd`).
    pub(crate) fn title(&self) -> &[u8] {
        &self.group.name
    }

    /// Whether its window is an icon: the file's show command one that
    /// minimizes.
    pub(crate) fn iconic(&self) -> bool {
        matches!(self.group.show, 2 | 6 | 7)
    }

    /// Whether its window is maximized.
    pub(crate) fn zoomed(&self) -> bool {
        self.group.show == 3
    }
}

/// An instance's groups.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Groups {
    /// In the order loaded (`[13Ah]`'s list).
    pub list: Vec<Loaded>,
    /// `[13Ch]`, an index into `list`.
    pub current: Option<usize>,
}

impl Groups {
    /// The groups as the MDI client's children are walked, the top first
    /// (`GetWindow(client, GW_CHILD)`, then `GW_HWNDNEXT`): the last loaded
    /// on top.
    pub(crate) fn top_down(&self) -> impl Iterator<Item = (usize, &Loaded)> {
        self.list.iter().enumerate().rev()
    }
}

/// An instance's groups, taken for a while.
pub(crate) fn groups(pm: &Pm<'_>) -> Groups {
    let instance = pm.ds.wrapping_sub(1);

    pm.e.system()
        .progman
        .instances
        .get(&instance)
        .cloned()
        .unwrap_or_default()
}

/// An instance's groups, changed.
pub(crate) fn change(pm: &Pm<'_>, f: impl FnOnce(&mut Groups)) {
    let instance = pm.ds.wrapping_sub(1);
    let mut system = pm.e.system();

    f(system.progman.instances.entry(instance).or_default());
}

/// A group loaded from its file (seg4 `1d4d`): its number, the lowest not
/// taken where it has none (`1d5c`-`1d6d`); its file read as seg4
/// `01d7`-`02b3` reads it -- `_lopen` with `OF_SHARE_DENY_NONE`, its size
/// by `_llseek` to its end, refused under 24h bytes, `_lread` whole into a
/// global block -- and taken as the model takes it (`read_group`, which
/// refuses what the file's loader refuses). It becomes the last of the
/// list and the current group.
///
/// Not yet: the boxes the file shows for a group it cannot load, its
/// window, its icons, and arranging it where `AutoArrange` is on (seg4
/// `177f`).
pub(crate) async fn load(pm: &Pm<'_>, n: u16, path: &[u8]) -> R<()> {
    let mut n = n;

    if n == 0 {
        let taken: Vec<u16> = groups(pm).list.iter().map(|group| group.n).collect();

        n = (1..=u16::MAX).find(|n| !taken.contains(n)).unwrap_or(0);
    }

    let Some(data) = read_file(pm, path).await? else {
        return Ok(());
    };
    let Ok(group) = crate::groups::read_group(&data) else {
        return Ok(());
    };

    change(pm, |groups| {
        groups.list.push(Loaded {
            n,
            path: path.to_vec(),
            group,
        });
        groups.current = Some(groups.list.len() - 1);
    });
    Ok(())
}

/// A file's bytes, read as the group loader reads it; none where it cannot
/// be opened or is too short to be a group.
async fn read_file(pm: &Pm<'_>, path: &[u8]) -> R<Option<Vec<u8>>> {
    let file = pm
        .kernel("_lopen", &[api::text(path), Arg::W(0x40)])
        .await? as u16;

    if file == 0xffff {
        return Ok(None);
    }

    let size = pm
        .kernel("_llseek", &[Arg::W(file), Arg::D(0), Arg::W(2)])
        .await?;
    let mut data = None;

    if (0x24..0x10000).contains(&size) {
        pm.kernel("_llseek", &[Arg::W(file), Arg::D(0), Arg::W(0)])
            .await?;

        let memory = pm
            .kernel("GlobalAlloc", &[Arg::W(0x42), Arg::D(size)])
            .await? as u16;

        if memory != 0 {
            let at = pm.kernel("GlobalLock", &[Arg::W(memory)]).await?;
            let read = pm
                .kernel("_lread", &[Arg::W(file), Arg::D(at), Arg::W(size as u16)])
                .await?;

            if read as u16 == size as u16 {
                data = Some(pm.e.system().read_far(at, size as usize));
            }

            pm.kernel("GlobalUnlock", &[Arg::W(memory)]).await?;
            pm.kernel("GlobalFree", &[Arg::W(memory)]).await?;
        }
    }

    pm.kernel("_lclose", &[Arg::W(file)]).await?;
    Ok(data)
}
