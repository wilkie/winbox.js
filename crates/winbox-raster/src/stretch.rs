//! Which source columns and rows each destination column and row of a
//! stretched bitmap is made of: GDI's own stretcher, `GDI.EXE` seg32 `03ba`,
//! as none of the display drivers stretches (`VGA.DRV`'s raster
//! capabilities, `46d9h`, have no `RC_STRETCHBLT`).
//!
//! **Read out**, the colour path (seg32 `099e`), and **recorded** by
//! `stretch` on the VGA: every column and row of sixteen cases, shrinking,
//! enlarging and mirrored, in the three stretch modes. Each axis has an
//! error term starting at the larger size less half the smaller. The two
//! axes differ in when they step: a column steps once its term falls below
//! nought, a row once it reaches nought. Shrinking 16 to 7, the columns
//! shown are 1, 4, 6, 8, 11, 13, 15, and the rows 1, 4, 6, 8, 10, 13, 15.

/// For each of `size` destination columns, the source columns of `from`
/// that fall into it, in the order GDI combines them (seg32 `1268`, `12d3`,
/// `1341` and `13ac`). Mirrored, the source is walked from its right.
pub fn stretch_columns(from: i32, size: i32, mirror: bool) -> Vec<Vec<i32>> {
    let mut groups: Vec<Vec<i32>> = vec![Vec::new(); size.max(0) as usize];

    if from >= size {
        let mut error = from - (size >> 1);
        let mut d = 0;

        for i in 0..from {
            if let Some(group) = groups.get_mut(d) {
                group.push(if mirror { from - 1 - i } else { i });
            }

            error -= size;

            if error < 0 {
                error += from;
                d += 1;
            }
        }
    } else {
        let mut error = size - (from >> 1);
        let mut s = if mirror { from - 1 } else { 0 };

        for group in &mut groups {
            group.push(s);
            error -= from;

            if error < 0 {
                error += size;
                s += if mirror { -1 } else { 1 };
            }
        }
    }

    groups
}

/// For each of `size` destination rows, top to bottom, the source rows of
/// `from` that fall into it (seg32 `0e96`, `0ed3` and `0eef`). Shrinking in
/// `COLORONCOLOR`, only the row shown is read; in the other modes, every
/// row of its group is combined into it. Mirroring fills the destination
/// from its other end and walks the source the same way.
pub fn stretch_rows(from: i32, size: i32, combines: bool) -> Vec<Vec<i32>> {
    let mut groups: Vec<Vec<i32>> = Vec::new();
    let mut error = from.max(size) - (from.min(size) >> 1);

    if size < from {
        let mut group = Vec::new();

        for s in 0..from {
            if combines {
                group.push(s);
            }

            error -= size;

            if error <= 0 {
                error += from;
                groups.push(if combines {
                    std::mem::take(&mut group)
                } else {
                    vec![s]
                });
                group = Vec::new();
            }
        }
    } else {
        for s in 0..from {
            groups.push(vec![s]);
            error -= from;

            while error > 0 {
                groups.push(vec![s]);
                error -= from;
            }

            error += size;
        }
    }

    groups.truncate(size.max(0) as usize);
    groups
}

/// Which axis a map is of.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Axis {
    Rows,
    Columns,
}

/// Which source row (or column) each of `size` rows of a `from`-row bitmap
/// stretched shows, `other` and `other_size` being the other axis, as
/// `COLORONCOLOR` shows it: the scroll bar's arrows, and `StretchBlt`.
///
/// * **Within a pixel on both axes** (seg32 `0504`): copied as it is, and
///   on enlarging, the last row and column shown once more.
/// * **Colour** (seg32 `099e`, EGA and VGA): `stretch_columns` and
///   `stretch_rows`, a column showing the last of its group.
/// * **Monochrome** (seg32 `0000`, the Hercules): enlarging, row `d` shows
///   `(d * from + ceil(from / 2) - 1) / size`; columns are dealt out from
///   the source, each `size / from` times, the remainder spread one more at
///   a time from the second. Reducing shows `d * from / size`, rounded
///   down, which is not read out: only a last row under the bar's outline
///   has shown it.
///
/// **Read out**, and **recorded** by `chrome` and `noscroll`.
pub fn stretch_map(
    from: i32,
    size: i32,
    other: i32,
    other_size: i32,
    axis: Axis,
    mono: bool,
) -> Vec<i32> {
    let mut map = Vec::new();

    if (from - size).abs() <= 1 && (other - other_size).abs() <= 1 {
        for d in 0..size {
            map.push(d.min(from - 1));
        }

        return map;
    }

    if !mono {
        // An empty group, which only a size of nought on one side can make,
        // shows nothing, as the TypeScript engine's `undefined` is stored
        // as nought.
        return match axis {
            Axis::Rows => stretch_rows(from, size, false)
                .iter()
                .map(|group| group.first().copied().unwrap_or(0))
                .collect(),
            Axis::Columns => stretch_columns(from, size, false)
                .iter()
                .map(|group| group.last().copied().unwrap_or(0))
                .collect(),
        };
    }

    if size < from {
        for d in 0..size {
            map.push((i64::from(d) * i64::from(from) / i64::from(size)) as i32);
        }

        return map;
    }

    if axis == Axis::Columns {
        let each = size / from;
        let extra = size % from;
        let mut balance = 0;

        for s in 0..from {
            let mut count = each;

            if balance > 0 {
                count += 1;
                balance -= from;
            }

            balance += extra;

            for _ in 0..count {
                if map.len() >= size as usize {
                    break;
                }

                map.push(s);
            }
        }

        return map;
    }

    for d in 0..size {
        let half_up = (from + 1) / 2;

        map.push(((d * from + half_up - 1) / size).min(from - 1));
    }

    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shrinking_sixteen_to_seven_shows_the_recorded_columns_and_rows() {
        let columns: Vec<i32> = stretch_columns(16, 7, false)
            .iter()
            .map(|group| *group.last().unwrap())
            .collect();
        let rows: Vec<i32> = stretch_rows(16, 7, false)
            .iter()
            .map(|group| group[0])
            .collect();

        assert_eq!(columns, vec![1, 4, 6, 8, 11, 13, 15]);
        assert_eq!(rows, vec![1, 4, 6, 8, 10, 13, 15]);
    }

    #[test]
    fn enlarging_repeats_each_row() {
        assert_eq!(
            stretch_rows(2, 4, false),
            vec![vec![0], vec![0], vec![1], vec![1]]
        );
    }
}
