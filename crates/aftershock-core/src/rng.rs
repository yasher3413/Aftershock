//! Counter-based random numbers.
//!
//! Every draw is a pure function of `(seed, sim_index, game_index, stream)`,
//! so results never depend on thread scheduling, and changing the inputs of
//! one game never shifts the random numbers seen by any other game. This is
//! what makes before/after odds comparisons nearly noise free.

/// Streams keep independent draws for the same game apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u64)]
pub enum Stream {
    Outcome = 1,
    Scoreline = 2,
    LiveGoals = 3,
    Playoff = 4,
    Chaos = 5,
    /// Per-simulation team strength noise, keyed by team index in the
    /// `game` slot of the key.
    TeamStrength = 6,
}

const GOLDEN: u64 = 0x9E37_79B9_7F4A_7C15;

/// SplitMix64 finalizer. A strong 64-bit bijective mixer.
#[inline(always)]
pub fn mix64(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Hash a key tuple into 64 random bits.
#[inline(always)]
pub fn hash4(seed: u64, sim: u64, game: u64, stream: u64) -> u64 {
    let mut h = mix64(seed.wrapping_add(GOLDEN));
    h = mix64(h ^ sim.wrapping_mul(GOLDEN).wrapping_add(0x632B_E59B_D9B4_E019));
    h = mix64(
        h ^ game
            .wrapping_mul(0xD6E8_FEB8_6659_FD93)
            .wrapping_add(GOLDEN),
    );
    mix64(h ^ stream.wrapping_mul(0xA076_1D64_78BD_642F))
}

/// Uniform in `[0, 1)` with 53 bits of precision.
#[inline(always)]
pub fn uniform(seed: u64, sim: u64, game: u64, stream: Stream) -> f64 {
    to_unit(hash4(seed, sim, game, stream as u64))
}

/// Map 64 random bits to `[0, 1)`.
#[inline(always)]
pub fn to_unit(bits: u64) -> f64 {
    (bits >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
}

/// Map 64 random bits to an `f32` in `[0, 1)` with 24 bits of precision.
#[inline(always)]
pub fn to_unit_f32(bits: u64) -> f32 {
    (bits >> 40) as f32 * (1.0 / (1u32 << 24) as f32)
}

/// The `(seed, sim)` prefix of [`hash4`], computed once per simulation.
///
/// `SimKey::new(seed, sim).game(g).bits(stream)` equals
/// `hash4(seed, sim, g, stream)` exactly; it only skips recomputing the
/// first two mixing rounds for every game.
#[derive(Clone, Copy, Debug)]
pub struct SimKey(u64);

/// The `(seed, sim, game)` prefix of [`hash4`].
#[derive(Clone, Copy, Debug)]
pub struct GameKey(u64);

impl SimKey {
    /// Prefix for simulation `sim` under `seed`.
    #[inline(always)]
    pub fn new(seed: u64, sim: u64) -> Self {
        let h = mix64(seed.wrapping_add(GOLDEN));
        SimKey(mix64(
            h ^ sim.wrapping_mul(GOLDEN).wrapping_add(0x632B_E59B_D9B4_E019),
        ))
    }

    /// Prefix for game `game` in this simulation.
    #[inline(always)]
    pub fn game(self, game: u64) -> GameKey {
        GameKey(mix64(
            self.0
                ^ game
                    .wrapping_mul(0xD6E8_FEB8_6659_FD93)
                    .wrapping_add(GOLDEN),
        ))
    }
}

impl GameKey {
    /// The 64 random bits for `stream`; equal to `hash4`.
    #[inline(always)]
    pub fn bits(self, stream: Stream) -> u64 {
        mix64(self.0 ^ (stream as u64).wrapping_mul(0xA076_1D64_78BD_642F))
    }

    /// `f32` uniform in `[0, 1)` for `stream`.
    #[inline(always)]
    pub fn uniform_f32(self, stream: Stream) -> f32 {
        to_unit_f32(self.bits(stream))
    }
}

/// A small sequential generator seeded from a counter key, for places that
/// need several draws from one key (for example, a playoff series).
#[derive(Clone, Debug)]
pub struct KeyedRng {
    state: u64,
}

impl KeyedRng {
    pub fn new(seed: u64, sim: u64, game: u64, stream: Stream) -> Self {
        Self {
            state: hash4(seed, sim, game, stream as u64),
        }
    }

    #[inline(always)]
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(GOLDEN);
        mix64(self.state)
    }

    #[inline(always)]
    pub fn next_f64(&mut self) -> f64 {
        to_unit(self.next_u64())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniform_is_deterministic_and_in_range() {
        for sim in 0..1000 {
            let a = uniform(42, sim, 7, Stream::Outcome);
            let b = uniform(42, sim, 7, Stream::Outcome);
            assert_eq!(a, b);
            assert!((0.0..1.0).contains(&a));
        }
    }

    #[test]
    fn streams_and_keys_differ() {
        let a = uniform(1, 2, 3, Stream::Outcome);
        assert_ne!(a, uniform(1, 2, 3, Stream::Scoreline));
        assert_ne!(a, uniform(1, 2, 4, Stream::Outcome));
        assert_ne!(a, uniform(1, 3, 3, Stream::Outcome));
        assert_ne!(a, uniform(2, 2, 3, Stream::Outcome));
    }

    #[test]
    fn sim_key_matches_hash4() {
        for (seed, sim, game) in [(0, 0, 0), (42, 7, 1343), (u64::MAX, 19_999, 5)] {
            let g = SimKey::new(seed, sim).game(game);
            for s in [
                Stream::Outcome,
                Stream::Scoreline,
                Stream::LiveGoals,
                Stream::Playoff,
                Stream::Chaos,
                Stream::TeamStrength,
            ] {
                assert_eq!(g.bits(s), hash4(seed, sim, game, s as u64));
            }
        }
    }

    #[test]
    fn unit_f32_in_range() {
        assert_eq!(to_unit_f32(0), 0.0);
        assert!(to_unit_f32(u64::MAX) < 1.0);
    }

    #[test]
    fn uniform_mean_is_close_to_half() {
        let n = 200_000u64;
        let sum: f64 = (0..n).map(|i| uniform(9, i, 0, Stream::Outcome)).sum();
        let mean = sum / n as f64;
        assert!((mean - 0.5).abs() < 0.005, "mean {mean}");
    }
}
