//! USER's system parameters: what `SystemParametersInfo` reads and sets,
//! kept as USER keeps them, read from `WIN.INI` as USER reads them as it
//! starts, and written back to it under the names in USER's string table.
//!
//! **Read out** of `USER.EXE`: the export (seg41 `1895`) checks its
//! arguments and goes to seg41 `0ed6`, which turns `uiAction` less one into
//! a place in a table of 36 (`16a5`); an action past it, or nought, answers
//! FALSE, as do 7, 8 and 9, which the table sends to the same place
//! (`1693`). Each setting that changes with `SPIF_UPDATEINIFILE` (bit 0 of
//! `fuWinIni`) is written with `WriteProfileString` by a helper (`0e91`)
//! that loads the section's and the key's names from the string table:
//! `[Windows]` (string 0) or `[Desktop]` (string 50h). Whether the last
//! write took is kept, and at the end (`16ed`), with
//! `SPIF_SENDWININICHANGE` (bit 1) as well, `WM_WININICHANGE` is sent to
//! every window at the top with the section's name. **Recorded** by
//! `sysparam`, action by action.
//!
//! Where USER reads them as it starts is seg3: the keyboard's at `0356`,
//! the mouse's at `03f9`, the clicks', the menus' and the beep's at `1182`
//! to `128d`, the grid at `12a2`, the screen saver's at `20fc`, the border
//! at `226c`, and the icons' and their titles' at `1c4e` (the routine
//! `SPI_SETICONTITLELOGFONT` calls too). Most go through a helper (`0286`)
//! that asks `GetProfileString` for one character and gives the default
//! where there is none, else asks `GetProfileInt`.

use crate::call::{Answer, Args, Later, Stop};
use crate::engine::Engine;
use crate::messages::Param;
use crate::system::System;

const SPI_GETBEEP: u16 = 1;
const SPI_SETBEEP: u16 = 2;
const SPI_GETMOUSE: u16 = 3;
const SPI_SETMOUSE: u16 = 4;
const SPI_GETBORDER: u16 = 5;
const SPI_SETBORDER: u16 = 6;
const SPI_GETKEYBOARDSPEED: u16 = 10;
const SPI_SETKEYBOARDSPEED: u16 = 11;
const SPI_ICONHORIZONTALSPACING: u16 = 13;
const SPI_GETSCREENSAVETIMEOUT: u16 = 14;
const SPI_SETSCREENSAVETIMEOUT: u16 = 15;
const SPI_GETSCREENSAVEACTIVE: u16 = 16;
const SPI_SETSCREENSAVEACTIVE: u16 = 17;
const SPI_GETGRIDGRANULARITY: u16 = 18;
const SPI_SETGRIDGRANULARITY: u16 = 19;
const SPI_SETDESKWALLPAPER: u16 = 20;
const SPI_SETDESKPATTERN: u16 = 21;
const SPI_GETKEYBOARDDELAY: u16 = 22;
const SPI_SETKEYBOARDDELAY: u16 = 23;
const SPI_ICONVERTICALSPACING: u16 = 24;
const SPI_GETICONTITLEWRAP: u16 = 25;
const SPI_SETICONTITLEWRAP: u16 = 26;
const SPI_GETMENUDROPALIGNMENT: u16 = 27;
const SPI_SETMENUDROPALIGNMENT: u16 = 28;
const SPI_SETDOUBLECLKWIDTH: u16 = 29;
const SPI_SETDOUBLECLKHEIGHT: u16 = 30;
const SPI_GETICONTITLELOGFONT: u16 = 31;
const SPI_SETDOUBLECLICKTIME: u16 = 32;
const SPI_SETMOUSEBUTTONSWAP: u16 = 33;
const SPI_SETICONTITLELOGFONT: u16 = 34;
const SPI_GETFASTTASKSWITCH: u16 = 35;
const SPI_SETFASTTASKSWITCH: u16 = 36;

const SPIF_UPDATEINIFILE: u16 = 1;
const SPIF_SENDWININICHANGE: u16 = 2;

const WM_WININICHANGE: u16 = 0x001a;
const WM_SYSCOLORCHANGE: u16 = 0x0015;

const SM_CXBORDER: i16 = 5;
const SM_CYBORDER: i16 = 6;
const SM_CXICON: i16 = 11;
const SM_CYICON: i16 = 12;
const SM_CXMIN: i16 = 28;
const SM_CYMIN: i16 = 29;
const SM_CXFRAME: i16 = 32;
const SM_CYFRAME: i16 = 33;
const SM_CXMINTRACK: i16 = 34;
const SM_CYMINTRACK: i16 = 35;
const SM_CXDOUBLECLK: i16 = 36;
const SM_CYDOUBLECLK: i16 = 37;
const SM_CXICONSPACING: i16 = 38;
const SM_CYICONSPACING: i16 = 39;
const SM_MENUDROPALIGNMENT: i16 = 40;

const WS_THICKFRAME: u32 = 0x0004_0000;

/// The two sections, by their names in USER's string table.
const WINDOWS: &[u8] = b"Windows";
const DESKTOP: &[u8] = b"Desktop";

/// The border width the displays' metrics were recorded with: the
/// installation's `BorderWidth=3`, which is also USER's default.
const RECORDED_BORDER: i16 = 3;

/// What USER keeps of the settings, each as it keeps it (USER's data
/// segment, seg45, in brackets).
#[derive(Debug, Clone)]
pub struct Parameters {
    /// Whether `MessageBeep` sounds (`[14Ch]`): the word given, as given.
    pub beep: u16,
    /// The mouse's two thresholds and its speed, as `SPI_SETMOUSE` gave
    /// them.
    pub mouse: [u16; 3],
    /// The sizing frame's width in borders, 1 to 50 (`[4F8h]`).
    pub border: i16,
    /// The keyboard's repeat: its speed in the low five bits and its delay
    /// in the two above, as one word (`[0E6h]`).
    pub keyboard: u16,
    /// The screen saver's delay in seconds, negative while it is not
    /// active (`[0E8h]`).
    pub screen_save: i16,
    /// The sizing grid, in pixels: eight to a unit, never less than 1
    /// (`[6E8h]`).
    pub grid: i16,
    /// `SM_CXICONSPACING` and `SM_CYICONSPACING` (`[0C0h]`, `[0C2h]`).
    pub icon_spacing: [u16; 2],
    /// Whether icons' titles wrap (`[1B2h]`).
    pub icon_title_wrap: u16,
    /// `SM_MENUDROPALIGNMENT` (`[0C4h]`).
    pub menu_drop_alignment: u16,
    /// `SM_CXDOUBLECLK` and `SM_CYDOUBLECLK` (`[0BCh]`, `[0BEh]`).
    pub double_click_size: [u16; 2],
    /// The icons' titles' `LOGFONT` (`[91Ah]`).
    pub icon_title_font: [u8; 50],
    /// Whether Alt+Tab switches at once (`[1AEh]`).
    pub fast_task_switch: u16,
    /// The wallpaper's file, as `SPI_SETDESKWALLPAPER` last loaded one:
    /// none for "(None)". Kept; not yet drawn.
    pub wallpaper: Option<Vec<u8>>,
    /// The desktop's pattern, as `SPI_SETDESKPATTERN` last made one: none
    /// for "(None)". Kept; not yet drawn.
    pub pattern: Option<Vec<u8>>,
}

impl System {
    /// The settings, read from `WIN.INI` the first time, as USER reads
    /// them as it starts; and the double-click time and the mouse's
    /// buttons with them, where nothing set them yet.
    pub(crate) fn parameters(&mut self) -> &mut Parameters {
        if self.parameters.is_none() {
            let loaded = self.load_parameters();

            self.parameters = Some(loaded);
        }

        self.parameters.as_mut().expect("the settings")
    }

    fn load_parameters(&mut self) -> Parameters {
        // seg3 `1190`: `SetDoubleClickTime`, which takes nought for 500.
        if self.user_state.double_click_time.is_none() {
            let time = setting(self, b"DoubleClickSpeed", 0);

            self.user_state.double_click_time = Some(if time == 0 { 500 } else { time });
        }

        // seg3 `11ea`: a first character of Y, in either case, swaps them.
        if self.swap_buttons.is_none() {
            let swap = first_is_y(self, b"SwapMouseButtons", b"");

            self.swap_buttons = Some(u16::from(swap));
        }

        // seg3 `0356`: no speed, 15 and no delay; else the delay's two
        // bits above the speed, where there is one.
        let speed = setting(self, b"KeyboardSpeed", 0xffff);
        let keyboard = if speed == 0xffff {
            0x000f
        } else {
            match setting(self, b"KeyboardDelay", 0xffff) {
                0xffff => speed,
                delay => speed | (delay & 3) << 5,
            }
        };

        // seg3 `03f9`: the first threshold the mouse driver's own, 2 as
        // recorded; the second read only for a speed of 2, nought else.
        let threshold = setting(self, b"MouseThreshold1", 2);
        let speed = setting(self, b"MouseSpeed", 1);
        let second = if speed == 2 {
            setting(self, b"MouseThreshold2", 10)
        } else {
            0
        };

        // seg3 `20fc`: a delay not active is kept negative.
        let mut screen_save = setting(self, b"ScreenSaveTimeOut", 0) as i16;

        if setting(self, b"ScreenSaveActive", 0) == 0 && screen_save > 0 {
            screen_save = -screen_save;
        }

        // seg3 `12a2`: `GetProfileInt` itself, eight pixels to a unit.
        let grid =
            (crate::profiles_kernel::profile_int(self, DESKTOP, b"GridGranularity", 0) << 3) as i16;
        let spacing = [
            self.recorded_metric(SM_CXICONSPACING),
            self.recorded_metric(SM_CYICONSPACING),
        ];
        let icon_spacing = [
            crate::profiles_kernel::profile_int(self, DESKTOP, b"IconSpacing", spacing[0])
                .max(self.recorded_metric(SM_CXICON)),
            crate::profiles_kernel::profile_int(self, DESKTOP, b"IconVerticalSpacing", spacing[1])
                .max(self.recorded_metric(SM_CYICON)),
        ];

        Parameters {
            beep: u16::from(first_is_y(self, b"Beep", b"Y")),
            mouse: [threshold, second, speed],
            border: (setting(self, b"BorderWidth", 3) as i16).clamp(1, 50),
            keyboard,
            screen_save,
            grid: if grid == 0 { 1 } else { grid },
            icon_spacing,
            icon_title_wrap: crate::profiles_kernel::profile_int(
                self,
                DESKTOP,
                b"IconTitleWrap",
                1,
            ),
            menu_drop_alignment: setting(self, b"MenuDropAlignment", 0),
            double_click_size: [
                setting(self, b"DoubleClickWidth", 4),
                setting(self, b"DoubleClickHeight", 4),
            ],
            icon_title_font: icon_title_font_of_profile(self),
            fast_task_switch: setting(self, b"CoolSwitch", 1),
            wallpaper: None,
            pattern: None,
        }
    }

    /// A metric as the display recorded it.
    fn recorded_metric(&self, index: i16) -> u16 {
        self.display
            .metrics_by_index
            .get(&index.to_string())
            .copied()
            .unwrap_or(0) as u16
    }

    /// A metric that follows the settings, once they are read: the border's
    /// (seg3 `24bc`, `253b`), the clicks', the icons' spacing and the
    /// menus' alignment, which USER keeps among its metrics.
    pub(crate) fn parameter_metric(&self, index: i16) -> Option<i32> {
        let parameters = self.parameters.as_ref()?;
        let border = i32::from(parameters.border - RECORDED_BORDER);
        let recorded = |index: i16| i32::from(self.recorded_metric(index) as i16);

        Some(match index {
            SM_CXFRAME => recorded(SM_CXBORDER) * i32::from(parameters.border + 1),
            SM_CYFRAME => recorded(SM_CYBORDER) * i32::from(parameters.border + 1),
            SM_CXMIN | SM_CXMINTRACK => recorded(index) + 2 * border * recorded(SM_CXBORDER),
            SM_CYMIN | SM_CYMINTRACK => recorded(index) + 2 * border * recorded(SM_CYBORDER),
            SM_CXDOUBLECLK => i32::from(parameters.double_click_size[0] as i16),
            SM_CYDOUBLECLK => i32::from(parameters.double_click_size[1] as i16),
            SM_CXICONSPACING => i32::from(parameters.icon_spacing[0] as i16),
            SM_CYICONSPACING => i32::from(parameters.icon_spacing[1] as i16),
            SM_MENUDROPALIGNMENT => i32::from(parameters.menu_drop_alignment as i16),
            _ => return None,
        })
    }

    /// An entry of `WIN.INI` written, or taken away for none: whether it
    /// was.
    fn write_setting(&mut self, section: &[u8], key: &[u8], value: Option<&[u8]>) -> bool {
        let mut profile = self.read_profile(b"WIN.INI");

        profile.set(section, key, value.map(trimmed));

        let written = self.write_profile(b"WIN.INI", &profile);

        if written {
            self.profiles
                .insert(crate::profiles_kernel::key_of(b"WIN.INI"), profile);
        }

        written
    }
}

/// A value as `WriteProfileString` writes it: its trailing spaces and tabs
/// cut.
fn trimmed(value: &[u8]) -> &[u8] {
    let end = value
        .iter()
        .rposition(|&byte| byte != b' ' && byte != b'\t')
        .map_or(0, |at| at + 1);

    &value[..end]
}

/// One of `[Windows]`'s settings as USER's helper reads it (seg3 `0286`):
/// the default where the entry gives no character, else `GetProfileInt`'s
/// number.
fn setting(system: &mut System, key: &[u8], default: u16) -> u16 {
    let profile = system.read_profile(b"WIN.INI");

    match profile.get(WINDOWS, key, true) {
        Some(value) if !value.is_empty() => {
            crate::profiles_kernel::profile_int(system, WINDOWS, key, default)
        }
        _ => default,
    }
}

/// Whether a `[Windows]` entry's first character is a Y, in either case:
/// how USER reads `Beep` and `SwapMouseButtons` (seg3 `11ea`, `1238`).
fn first_is_y(system: &mut System, key: &[u8], default: &[u8]) -> bool {
    let profile = system.read_profile(b"WIN.INI");
    let value = profile
        .get(WINDOWS, key, true)
        .unwrap_or_else(|| default.to_vec());

    value
        .first()
        .is_some_and(|first| first.eq_ignore_ascii_case(&b'Y'))
}

/// The display's dots to the inch upward, for the icons' titles' height.
pub(crate) fn logical_pixels_y(system: &System) -> i32 {
    let modes: serde_json::Value =
        serde_json::from_str(include_str!("../data/displays.json")).unwrap_or_default();

    modes
        .as_object()
        .and_then(|modes| {
            modes
                .values()
                .find(|mode| mode["name"].as_str() == Some(system.display.name.as_str()))
        })
        .and_then(|mode| mode["logicalPixelsY"].as_i64())
        .map_or(96, |dots| dots as i32)
}

/// USER's own `MulDiv` (seg1 `39ab`): the product, half the divisor added,
/// divided toward nought.
fn mul_div(value: i16, by: i16, over: i16) -> i16 {
    if over == 0 {
        return value;
    }

    let product = i32::from(value) * i32::from(by) + i32::from(over as u16 >> 1);

    (product / i32::from(over)) as i16
}

/// The icons' titles' `LOGFONT` as `[Desktop]` gives it (seg3 `1c81`): all
/// noughts, then `IconTitleFaceName` (MS Sans Serif), `IconTitleSize` in
/// points (8) on the display's dots to the inch, made negative, and a
/// weight of 700 where `IconTitleStyle`'s low bit is set, else 400.
fn icon_title_font_of_profile(system: &mut System) -> [u8; 50] {
    let profile = system.read_profile(b"WIN.INI");
    let mut font = [0u8; 50];
    let face = profile
        .get(DESKTOP, b"IconTitleFaceName", true)
        .unwrap_or_else(|| b"MS Sans Serif".to_vec());
    let size = crate::profiles_kernel::profile_int(system, DESKTOP, b"IconTitleSize", 8) as i16;
    let style = crate::profiles_kernel::profile_int(system, DESKTOP, b"IconTitleStyle", 0);
    let dots = logical_pixels_y(system) as i16;
    let height = mul_div(size, dots, 72).wrapping_neg();

    font[0..2].copy_from_slice(&height.to_le_bytes());
    font[8..10].copy_from_slice(&(if style & 1 != 0 { 700u16 } else { 400 }).to_le_bytes());

    // `GetProfileString` with 32 bytes: 31 of the name and a nought.
    for (at, &byte) in face.iter().take(31).enumerate() {
        font[18 + at] = byte;
    }

    font
}

/// What an action leaves to be done once USER's own state is set: each in
/// the order USER does it.
#[derive(Default)]
struct After {
    /// The border's change, in borders: every sizable window grown by it.
    border: Option<i32>,
    /// Everything drawn again.
    redraw: bool,
    /// `WM_SYSCOLORCHANGE` sent to every window at the top (seg41 `0be0`).
    sys_color_change: bool,
    /// `WM_WININICHANGE` sent, with the section named.
    ini_change: Option<Vec<u8>>,
}

/// Whether the last write took, and the section it named (seg41 `bp-6Ch`,
/// `bp-3Ch`).
#[derive(Default)]
struct Writes {
    written: bool,
    section: Vec<u8>,
}

impl Writes {
    fn write(
        &mut self,
        system: &mut System,
        section: &[u8],
        key: &[u8],
        value: Option<&[u8]>,
    ) -> bool {
        self.section = section.to_vec();
        self.written = system.write_setting(section, key, value);
        self.written
    }
}

/// A word written at a far pointer.
fn write_word(system: &mut System, far: u32, at: u32, value: u16) {
    let to = (far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff);

    system.write_far(to, &value.to_le_bytes());
}

fn read_word(system: &System, far: u32, at: u32) -> u16 {
    let from = (far & 0xffff_0000) | (far.wrapping_add(at) & 0xffff);
    let bytes = system.read_far(from, 2);

    u16::from_le_bytes([bytes[0], bytes[1]])
}

/// A string at a far pointer, without its nought.
fn read_string(system: &System, far: u32) -> Vec<u8> {
    let mut out = Vec::new();

    while out.len() < 0x400 {
        let at = (far & 0xffff_0000) | (far.wrapping_add(out.len() as u32) & 0xffff);
        let byte = system.read_far(at, 1)[0];

        if byte == 0 {
            break;
        }

        out.push(byte);
    }

    out
}

/// A number as USER writes one, `wsprintf`'s `%d`.
fn decimal(value: u16) -> Vec<u8> {
    (value as i16).to_string().into_bytes()
}

/// `SystemParametersInfo`: a setting read or set, as USER's table has each
/// (seg41 `0ed6`). TRUE, or FALSE for an action it has no case for and
/// for a setting it would not take.
///
/// Not followed: a reading action given a null pointer, which USER writes
/// through and faults on, answers FALSE here; `SPI_LANGDRIVER` (12),
/// which loads a language driver, answers FALSE; and nothing is made of
/// the keyboard's repeat, the mouse's acceleration, the screen saver, the
/// pattern or the wallpaper beyond keeping them.
pub fn system_parameters_info(engine: &Engine, mut args: Args) -> Later<'_> {
    Box::pin(async move {
        let (answer, after) = {
            let mut system = engine.system();
            let action = args.word(&system);
            let param = args.word(&system);
            let far = args.dword(&system);
            let ini = args.word(&system);

            system.raster();
            set(&mut system, action, param, far, ini)
        };

        if let Some(delta) = after.border {
            grow_frames(engine, delta).await?;
        }

        if after.sys_color_change {
            broadcast(engine, WM_SYSCOLORCHANGE, None).await?;
        }

        if after.redraw {
            engine.system().repaint_all();
        }

        if let Some(section) = after.ini_change {
            broadcast(engine, WM_WININICHANGE, Some(&section)).await?;
        }

        Ok(Answer::Word(u16::from(answer)))
    })
}

/// USER's own state read or set, and `WIN.INI` written: whether the action
/// was taken, and what is left to do.
#[allow(clippy::too_many_lines)]
fn set(system: &mut System, action: u16, param: u16, far: u32, ini: u16) -> (bool, After) {
    let update = ini & SPIF_UPDATEINIFILE != 0;
    let mut after = After::default();
    let mut writes = Writes::default();
    let reading = matches!(
        action,
        SPI_GETBEEP
            | SPI_GETMOUSE
            | SPI_GETBORDER
            | SPI_GETKEYBOARDSPEED
            | SPI_GETSCREENSAVETIMEOUT
            | SPI_GETSCREENSAVEACTIVE
            | SPI_GETGRIDGRANULARITY
            | SPI_GETKEYBOARDDELAY
            | SPI_GETICONTITLEWRAP
            | SPI_GETMENUDROPALIGNMENT
            | SPI_GETICONTITLELOGFONT
            | SPI_GETFASTTASKSWITCH
    );

    if reading && far == 0 {
        return (false, after);
    }

    system.parameters();

    let word = |system: &mut System, value: u16| {
        write_word(system, far, 0, value);
        (true, After::default())
    };

    match action {
        SPI_GETBEEP => {
            let value = system.parameters().beep;

            return word(system, value);
        }
        SPI_SETBEEP => {
            system.parameters().beep = param;

            if update {
                let value: &[u8] = if param == 0 { b"No" } else { b"Yes" };

                writes.write(system, WINDOWS, b"Beep", Some(value));
            }
        }
        SPI_GETMOUSE => {
            let mouse = system.parameters().mouse;

            for (at, value) in mouse.into_iter().enumerate() {
                write_word(system, far, at as u32 * 2, value);
            }

            return (true, after);
        }
        SPI_SETMOUSE => {
            let mouse = [0, 2, 4].map(|at| read_word(system, far, at));

            system.parameters().mouse = mouse;

            if update {
                let mut any = false;

                for (key, value) in [
                    b"MouseThreshold1".as_slice(),
                    b"MouseThreshold2",
                    b"MouseSpeed",
                ]
                .into_iter()
                .zip(mouse)
                {
                    any |= writes.write(system, WINDOWS, key, Some(&decimal(value)));
                }

                writes.written = any;
            }
        }
        SPI_GETBORDER => {
            let value = system.parameters().border as u16;

            return word(system, value);
        }
        SPI_SETBORDER => {
            let before = system.parameters().border;
            let border = (param as i16).clamp(1, 50);

            if border == before {
                return (true, after);
            }

            system.parameters().border = border;
            after.border = Some(i32::from(border - before));
            after.redraw = true;

            if update {
                writes.write(system, WINDOWS, b"BorderWidth", Some(&decimal(param)));
            }
        }
        SPI_GETKEYBOARDSPEED => {
            let value = system.parameters().keyboard & 0x1f;

            return word(system, value);
        }
        SPI_SETKEYBOARDSPEED => {
            let keyboard = &mut system.parameters().keyboard;

            *keyboard = (*keyboard & 0xffe0) | param;

            if update {
                writes.write(system, WINDOWS, b"KeyboardSpeed", Some(&decimal(param)));
            }
        }
        SPI_GETKEYBOARDDELAY => {
            let value = (system.parameters().keyboard & 0x60) >> 5;

            return word(system, value);
        }
        SPI_SETKEYBOARDDELAY => {
            let keyboard = &mut system.parameters().keyboard;

            *keyboard = (*keyboard & 0xff9f) | param << 5;

            if update {
                writes.write(system, WINDOWS, b"KeyboardDelay", Some(&decimal(param)));
            }
        }
        SPI_ICONHORIZONTALSPACING | SPI_ICONVERTICALSPACING => {
            let (at, least, key) = if action == SPI_ICONHORIZONTALSPACING {
                (0, SM_CXICON, b"IconSpacing".as_slice())
            } else {
                (1, SM_CYICON, b"IconVerticalSpacing".as_slice())
            };

            // A pointer with a selector reads (`11ed`); none, and nought,
            // does nothing.
            if far >> 16 != 0 {
                let value = system.parameters().icon_spacing[at];

                return word(system, value);
            }

            if param == 0 {
                return (true, after);
            }

            let spacing = param.max(system.recorded_metric(least));

            system.parameters().icon_spacing[at] = spacing;

            if update {
                writes.write(system, DESKTOP, key, Some(&decimal(spacing)));
            }
        }
        SPI_GETSCREENSAVETIMEOUT => {
            let value = system.parameters().screen_save.unsigned_abs();

            return word(system, value);
        }
        SPI_SETSCREENSAVETIMEOUT => {
            let delay = &mut system.parameters().screen_save;

            *delay = if *delay < 0 {
                (param as i16).wrapping_neg()
            } else {
                param as i16
            };

            if update {
                writes.write(system, WINDOWS, b"ScreenSaveTimeOut", Some(&decimal(param)));
            }
        }
        SPI_GETSCREENSAVEACTIVE => {
            let value = u16::from(system.parameters().screen_save > 0);

            return word(system, value);
        }
        SPI_SETSCREENSAVEACTIVE => {
            let delay = &mut system.parameters().screen_save;

            if (param != 0 && *delay < 0) || (param == 0 && *delay > 0) {
                *delay = delay.wrapping_neg();
            }

            if update {
                writes.write(
                    system,
                    WINDOWS,
                    b"ScreenSaveActive",
                    Some(&decimal(u16::from(param != 0))),
                );
            }
        }
        SPI_GETGRIDGRANULARITY => {
            let value = (system.parameters().grid / 8) as u16;

            return word(system, value);
        }
        SPI_SETGRIDGRANULARITY => {
            system.parameters().grid = ((param << 3) as i16).max(1);

            if update {
                writes.write(system, DESKTOP, b"GridGranularity", Some(&decimal(param)));
            }
        }
        SPI_SETDESKWALLPAPER => {
            let given = (far != 0 && far != 0xffff_ffff).then(|| read_string(system, far));

            if !set_wallpaper(system, given.clone()) {
                return (false, after);
            }

            if update && far != 0xffff_ffff {
                let value = given.unwrap_or_else(|| b"(None)".to_vec());

                writes.write(system, DESKTOP, b"Wallpaper", Some(&value));
            }

            after.redraw = true;
        }
        SPI_SETDESKPATTERN => {
            if param == 0xffff && far != 0 {
                return (false, after);
            }

            let given = (far != 0).then(|| read_string(system, far));

            if !set_pattern(system, param == 0xffff, given) {
                return (false, after);
            }

            after.sys_color_change = true;
            after.redraw = true;

            if update {
                let value = (far != 0).then(|| read_string(system, far));

                writes.write(system, DESKTOP, b"Pattern", value.as_deref());
            }
        }
        SPI_GETICONTITLEWRAP => {
            let value = system.parameters().icon_title_wrap;

            return word(system, value);
        }
        SPI_SETICONTITLEWRAP => {
            let wrap = u16::from(param != 0);

            if system.parameters().icon_title_wrap != 0 && wrap != 0 {
                return (true, after);
            }

            system.parameters().icon_title_wrap = wrap;
            after.redraw = true;

            if update {
                writes.write(system, DESKTOP, b"IconTitleWrap", Some(&decimal(wrap)));
            }
        }
        SPI_GETMENUDROPALIGNMENT => {
            let value = system.parameters().menu_drop_alignment;

            return word(system, value);
        }
        SPI_SETMENUDROPALIGNMENT => {
            system.parameters().menu_drop_alignment = u16::from(param != 0);

            if update {
                writes.write(system, WINDOWS, b"MenuDropAlignment", Some(&decimal(param)));
            }
        }
        SPI_SETDOUBLECLKWIDTH | SPI_SETDOUBLECLKHEIGHT => {
            let (at, key) = if action == SPI_SETDOUBLECLKWIDTH {
                (0, b"DoubleClickWidth".as_slice())
            } else {
                (1, b"DoubleClickHeight".as_slice())
            };

            system.parameters().double_click_size[at] = param;

            if update {
                writes.write(system, WINDOWS, key, Some(&decimal(param)));
            }
        }
        SPI_GETICONTITLELOGFONT => {
            // As many bytes as asked for (seg1 `39e2`); past the
            // structure, noughts.
            let font = system.parameters().icon_title_font;
            let bytes: Vec<u8> = (0..usize::from(param))
                .map(|at| font.get(at).copied().unwrap_or(0))
                .collect();

            if !bytes.is_empty() {
                system.write_far(far, &bytes);
            }

            return (true, after);
        }
        SPI_SETDOUBLECLICKTIME => {
            system.user_state.double_click_time = Some(if param == 0 { 500 } else { param });

            if update {
                writes.write(system, WINDOWS, b"DoubleClickSpeed", Some(&decimal(param)));
            }
        }
        SPI_SETMOUSEBUTTONSWAP => {
            system.swap_buttons = Some(u16::from(param != 0));

            if update {
                writes.write(
                    system,
                    WINDOWS,
                    b"SwapMouseButtons",
                    Some(&decimal(u16::from(param == 1))),
                );
            }
        }
        SPI_SETICONTITLELOGFONT => {
            if (far != 0 && param != 50) || (far == 0 && param != 0) {
                return (false, after);
            }

            let font = if far == 0 {
                icon_title_font_of_profile(system)
            } else {
                let mut font = [0u8; 50];

                font.copy_from_slice(&system.read_far(far, 50));
                font
            };

            system.parameters().icon_title_font = font;
            after.redraw = true;

            if update {
                if far == 0 {
                    // Nothing written, and the section's name never loaded:
                    // the message names what was there, nothing as
                    // recorded.
                    writes.written = true;
                } else {
                    let face: Vec<u8> = font[18..]
                        .iter()
                        .copied()
                        .take_while(|&byte| byte != 0)
                        .collect();
                    let height = u16::from_le_bytes([font[0], font[1]]);
                    let weight = u16::from_le_bytes([font[8], font[9]]);

                    writes.write(system, DESKTOP, b"IconTitleFaceName", Some(&face));
                    writes.write(system, DESKTOP, b"IconTitleSize", Some(&decimal(height)));
                    writes.write(
                        system,
                        DESKTOP,
                        b"IconTitleStyle",
                        Some(&decimal(u16::from(weight == 700))),
                    );
                }
            }
        }
        SPI_GETFASTTASKSWITCH => {
            let value = system.parameters().fast_task_switch;

            return word(system, value);
        }
        SPI_SETFASTTASKSWITCH => {
            let fast = u16::from(param == 1);

            system.parameters().fast_task_switch = fast;

            if update {
                writes.write(system, WINDOWS, b"CoolSwitch", Some(&decimal(fast)));
            }
        }
        _ => return (false, after),
    }

    if writes.written && ini & SPIF_SENDWININICHANGE != 0 {
        after.ini_change = Some(writes.section);
    }

    (true, after)
}

/// The wallpaper loaded (seg21 `04d2`): the name given, else `[Desktop]`'s
/// `Wallpaper`, of which none fails; "(None)", in any case, is none and
/// does; else the file, opened as `OpenFile` finds it -- here, as named or
/// in Windows' directory -- must be a bitmap, `BM` and a header of 12 or 40
/// bytes after its fourteen (seg21 `0131`). Whether it was taken.
fn set_wallpaper(system: &mut System, given: Option<Vec<u8>>) -> bool {
    let name = if let Some(name) = given {
        name
    } else {
        let profile = system.read_profile(b"WIN.INI");
        let Some(name) = profile
            .get(DESKTOP, b"Wallpaper", true)
            .filter(|name| !name.is_empty())
        else {
            return false;
        };

        name
    };

    if name.eq_ignore_ascii_case(b"(None)") {
        system.parameters().wallpaper = None;
        return true;
    }

    let path: String = name.iter().map(|&byte| char::from(byte)).collect();
    let found = system.files.open(&path).or_else(|| {
        (!path.contains(['\\', '/', ':']))
            .then(|| system.files.open(&format!("C:\\WINDOWS\\{path}")))
            .flatten()
    });
    let Some(handle) = found else {
        return false;
    };
    let file = system.files.resolve(handle).expect("an open file");
    let head = file.read(18);

    system.files.close(handle);

    let bitmap = head.len() == 18
        && head.starts_with(b"BM")
        && matches!(
            u32::from_le_bytes([head[14], head[15], head[16], head[17]]),
            12 | 40
        );

    if bitmap {
        system.parameters().wallpaper = Some(name);
    }

    bitmap
}

/// The pattern made (seg41 `0a61`): `[Desktop]`'s `Pattern` where the
/// action names none, of which none fails; nothing, an empty name or
/// "(None)" is none. Whether it was taken.
fn set_pattern(system: &mut System, from_profile: bool, given: Option<Vec<u8>>) -> bool {
    let pattern = if from_profile {
        let profile = system.read_profile(b"WIN.INI");
        let Some(pattern) = profile
            .get(DESKTOP, b"Pattern", true)
            .filter(|pattern| !pattern.is_empty())
        else {
            return false;
        };

        Some(pattern)
    } else {
        given
    };

    system.parameters().pattern =
        pattern.filter(|pattern| !pattern.is_empty() && !pattern.eq_ignore_ascii_case(b"(None)"));
    true
}

/// A message sent to every window at the top (`SendMessage` with
/// `HWND_BROADCAST`, seg1 `22e3`), as `EnumWindows` takes them. A section's
/// name goes in a block of `GlobalAlloc`'s, `GMEM_DDESHARE`, its offset
/// nought, freed after (seg1 `0093`).
async fn broadcast(engine: &Engine, message: u16, text: Option<&[u8]>) -> Result<(), Stop> {
    let (hwnds, block, far) = {
        let mut guard = engine.system();
        let system = &mut *guard;
        let hwnds = system.top_level_hwnds();
        let (block, far) = match text {
            Some(text) => {
                let Some(index) = system.global.allocate(
                    &mut system.cpu.bus,
                    &mut system.descriptors,
                    text.len() as u32 + 1,
                    0x1000,
                ) else {
                    return Ok(());
                };
                let far = u32::from(winbox_machine::segment_selector(index)) << 16;
                let mut bytes = text.to_vec();

                bytes.push(0);
                system.write_far(far, &bytes);
                (winbox_machine::handle_for(index), far)
            }
            None => (0, 0),
        };

        (hwnds, block, far)
    };

    for hwnd in hwnds {
        if engine.system().window_named(hwnd).is_some() {
            engine
                .send_message(hwnd, message, 0, &mut Param::Value(far))
                .await?;
        }
    }

    if block != 0 {
        let _ = crate::memory::global_free(&mut engine.system(), &mut Args::repeat(block));
    }

    Ok(())
}

/// Every sizable window grown by the border's change, its client area as
/// it was (seg41 `0d6e`): one not minimized moved and sized, one minimized
/// given a larger place to be restored to; each window's children after
/// it.
async fn grow_frames(engine: &Engine, delta: i32) -> Result<(), Stop> {
    let (dx, dy, windows) = {
        let system = engine.system();
        let dx = delta * i32::from(system.recorded_metric(SM_CXBORDER) as i16);
        let dy = delta * i32::from(system.recorded_metric(SM_CYBORDER) as i16);
        let mut windows = Vec::new();

        for hwnd in system.top_level_hwnds() {
            if let Some(index) = system.window_named(hwnd) {
                windows.push(hwnd);
                windows.extend(system.descendants(index));
            }
        }

        (dx, dy, windows)
    };

    for hwnd in windows {
        let place = {
            let mut system = engine.system();
            let Some(index) = system.window_named(hwnd) else {
                continue;
            };
            let window = system.windows[index].as_ref().expect("a window");

            if window.style & WS_THICKFRAME == 0 {
                continue;
            }

            if window.placement == crate::windows::Placement::Minimized {
                if let Some(window) = system.windows[index].as_mut()
                    && let Some([left, top, width, height]) = window.restore_rect
                {
                    window.restore_rect =
                        Some([left - dx, top - dy, width + 2 * dx, height + 2 * dy]);
                }

                continue;
            }

            let (x, y) = window
                .parent
                .and_then(|parent| system.windows[parent].as_ref())
                .map_or((0, 0), |parent| {
                    (
                        parent.left + parent.client.left,
                        parent.top + parent.client.top,
                    )
                });

            (
                index,
                window.left - x - dx,
                window.top - y - dy,
                window.width + 2 * dx,
                window.height + 2 * dy,
            )
        };
        let (index, x, y, width, height) = place;

        engine
            .position_raster(
                hwnd,
                index,
                0,
                x as i16,
                y as i16,
                width as i16,
                height as i16,
                0x011c,
            )
            .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The icon title's font on the VGA and on the EGA, as `sizing`
    /// recorded it on the VGA.
    #[test]
    fn icon_title_font_as_recorded() {
        let mut system = System::new();
        let vga = icon_title_font_of_profile(&mut system);

        assert_eq!(i16::from_le_bytes([vga[0], vga[1]]), -11);
        assert_eq!(u16::from_le_bytes([vga[8], vga[9]]), 400);
        assert_eq!(&vga[18..32], b"MS Sans Serif\0");

        system.display = crate::display::mode("ega").unwrap();

        let ega = icon_title_font_of_profile(&mut system);

        assert_eq!(i16::from_le_bytes([ega[0], ega[1]]), -8);
    }

    /// USER's `MulDiv` rounds a half away from nought only upward: -11
    /// points at 96 dots is -14, as `sysparam` recorded.
    #[test]
    fn mul_div_as_recorded() {
        assert_eq!(mul_div(8, 96, 72), 11);
        assert_eq!(mul_div(-11, 96, 72), -14);
    }

    /// With no `WIN.INI`, USER's defaults: the beep on, a border of 3,
    /// the keyboard's 15 and no delay, the grid's 1.
    #[test]
    fn defaults_without_a_profile() {
        let mut system = System::new();
        let parameters = system.parameters().clone();

        assert_eq!(parameters.beep, 1);
        assert_eq!(parameters.border, 3);
        assert_eq!(parameters.keyboard, 15);
        assert_eq!(parameters.grid, 1);
        assert_eq!(parameters.mouse, [2, 0, 1]);
        assert_eq!(parameters.fast_task_switch, 1);
        assert_eq!(system.user_state.double_click_time, Some(500));
    }

    /// The keyboard's speed set past its five bits runs into the delay's,
    /// as `sysparam` recorded.
    #[test]
    fn keyboard_speed_runs_into_the_delay() {
        let mut system = System::new();

        system.parameters().keyboard = 0x0c | 1 << 5;
        set(&mut system, SPI_SETKEYBOARDSPEED, 40, 0, 0);
        assert_eq!(system.parameters().keyboard & 0x1f, 8);
        assert_eq!((system.parameters().keyboard & 0x60) >> 5, 1);
    }
}
