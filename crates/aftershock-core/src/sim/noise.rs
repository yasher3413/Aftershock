//! Per-simulation team strength noise.
//!
//! In each simulation every team gets a strength shift
//! `delta[t] = team_sigma * Phi^-1(u)`, with `u` from the counter RNG keyed
//! by `(seed, sim, team, Stream::TeamStrength)`. Future games and playoff
//! games are tilted on the log-odds scale by `delta[home] - delta[away]`.

use crate::rng::{hash4, Stream};

/// Smallest and largest uniform fed to the inverse normal CDF.
const U_MIN: f64 = 1e-12;

/// Inverse of the standard normal CDF (Acklam's algorithm, relative error
/// below 1.2e-9 over the whole range). `p` must be in `(0, 1)`.
pub fn inv_norm_cdf(p: f64) -> f64 {
    const A: [f64; 6] = [
        -3.969_683_028_665_376e1,
        2.209_460_984_245_205e2,
        -2.759_285_104_469_687e2,
        1.383_577_518_672_69e2,
        -3.066_479_806_614_716e1,
        2.506_628_277_459_239,
    ];
    const B: [f64; 5] = [
        -5.447_609_879_822_406e1,
        1.615_858_368_580_409e2,
        -1.556_989_798_598_866e2,
        6.680_131_188_771_972e1,
        -1.328_068_155_288_572e1,
    ];
    const C: [f64; 6] = [
        -7.784_894_002_430_293e-3,
        -3.223_964_580_411_365e-1,
        -2.400_758_277_161_838,
        -2.549_732_539_343_734,
        4.374_664_141_464_968,
        2.938_163_982_698_783,
    ];
    const D: [f64; 4] = [
        7.784_695_709_041_462e-3,
        3.224_671_290_700_398e-1,
        2.445_134_137_142_996,
        3.754_408_661_907_416,
    ];
    const P_LOW: f64 = 0.024_25;
    let tail = |q: f64| {
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    };
    if p < P_LOW {
        tail((-2.0 * p.ln()).sqrt())
    } else if p <= 1.0 - P_LOW {
        let q = p - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    } else {
        -tail((-2.0 * (1.0 - p).ln()).sqrt())
    }
}

/// Strength shift of `team` in simulation `sim` for a given `sigma`.
#[inline]
pub fn team_delta(seed: u64, sim: u64, team: u64, sigma: f64) -> f64 {
    let bits = hash4(seed, sim, team, Stream::TeamStrength as u64);
    // Midpoint of the 53-bit cell keeps u strictly inside (0, 1).
    let u = ((bits >> 11) as f64 + 0.5) * (1.0 / (1u64 << 53) as f64);
    sigma * inv_norm_cdf(u.clamp(U_MIN, 1.0 - U_MIN))
}

/// Tilt a win probability on the log-odds scale:
/// `sigmoid(logit(p) + shift)`, written with `ratio = exp(shift)` as
/// `p r / (p r + 1 - p)`. Probabilities of exactly 0 or 1 are unchanged.
#[inline(always)]
pub fn tilt(p: f64, ratio: f64) -> f64 {
    let a = p * ratio;
    a / (a + (1.0 - p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inverse_normal_known_values() {
        let cases = [
            (0.5, 0.0),
            (0.975, 1.959_963_984_540_054),
            (0.025, -1.959_963_984_540_054),
            (0.841_344_746_068_542_9, 1.0),
            (0.001, -3.090_232_306_167_813_5),
            (1e-10, -6.361_340_902_404_056),
            (0.999_999, 4.753_424_308_822_899),
        ];
        for (p, z) in cases {
            let got = inv_norm_cdf(p);
            assert!(
                (got - z).abs() <= 1e-8 * z.abs().max(1.0),
                "p {p}: {got} vs {z}"
            );
        }
    }

    #[test]
    fn inverse_normal_is_monotone_and_symmetric() {
        let mut prev = f64::NEG_INFINITY;
        for i in 1..10_000 {
            let p = i as f64 / 10_000.0;
            let z = inv_norm_cdf(p);
            assert!(z > prev);
            assert!((z + inv_norm_cdf(1.0 - p)).abs() < 1e-8);
            prev = z;
        }
    }

    #[test]
    fn team_deltas_have_unit_variance_per_sigma() {
        let n = 200_000u64;
        let (mut s, mut s2) = (0.0, 0.0);
        for sim in 0..n {
            let d = team_delta(9, sim, 3, 1.0);
            assert!(d.is_finite());
            s += d;
            s2 += d * d;
        }
        let mean = s / n as f64;
        let var = s2 / n as f64 - mean * mean;
        assert!(mean.abs() < 0.01, "mean {mean}");
        assert!((var - 1.0).abs() < 0.02, "var {var}");
        assert_eq!(team_delta(9, 1, 3, 0.0), 0.0);
    }

    #[test]
    fn tilt_matches_logistic_shift() {
        let sig = |x: f64| 1.0 / (1.0 + (-x).exp());
        let logit = |p: f64| (p / (1.0 - p)).ln();
        for &p in &[0.1, 0.45, 0.5, 0.8, 0.97] {
            for &s in &[-0.7, -0.1, 0.0, 0.3, 1.2] {
                let want = sig(logit(p) + s);
                assert!((tilt(p, f64::exp(s)) - want).abs() < 1e-12);
            }
        }
        assert_eq!(tilt(0.0, 3.0), 0.0);
        assert_eq!(tilt(1.0, 0.2), 1.0);
    }
}
