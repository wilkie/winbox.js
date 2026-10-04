//! The machine itself, apart from any font's programs.

use super::*;

#[test]
fn refuses_a_program_it_cannot_run_rather_than_half_running_it() {
    // 0x89 is IDEF, which redefines an instruction; nothing here does that.
    let program = FontData::read(vec![0x89]);
    let mut hinter = Hinter::new(&program, 13.0, true, 1.0, false).unwrap();

    assert_eq!(hinter.run(&program, 0, 1), Err(Fault));
}

#[test]
fn rounds_as_the_round_state_says() {
    let program = FontData::read(Vec::new());
    let mut hinter = Hinter::new(&program, 13.0, true, 1.0, false).unwrap();

    // To the grid, a half going up and a negative half away from nought.
    assert!((hinter.round(32.0) - 64.0).abs() < f64::EPSILON);
    assert!((hinter.round(-32.0) + 64.0).abs() < f64::EPSILON);

    // Down to the grid.
    hinter.round_state(ONE, 0.0, 0.0);
    assert!((hinter.round(127.0) - 64.0).abs() < f64::EPSILON);

    // SROUND's illegal period is a mask of ~998, not a whole pixel.
    hinter.push(f64::from(0xc0 | 0x08));
    hinter.super_round(0x76).unwrap();
    assert!((hinter.state.round_period - 999.0).abs() < f64::EPSILON);
}

#[test]
fn pops_what_was_pushed_and_refuses_an_empty_stack() {
    let program = FontData::read(vec![0xb1, 3, 4, 0x23]);
    let mut hinter = Hinter::new(&program, 13.0, true, 1.0, false).unwrap();

    hinter.run(&program, 0, 4).unwrap();

    // PUSHB[1] 3 4, SWAP.
    assert_eq!(hinter.stack, vec![4, 3]);
    hinter.stack.clear();
    assert_eq!(hinter.pop(), Err(Fault));
}
