// Runs the What-If Lab's simulation natively, exactly as the page does:
// reality, then the scenario with the same seed.
use std::io::Read;
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let n: u32 = args[1].parse().unwrap();
    let mut s = String::new();
    std::io::stdin().read_to_string(&mut s).unwrap();
    let state: aftershock_wasm::State = serde_json::from_str(&s).unwrap();
    let t = std::time::Instant::now();
    let out = aftershock_wasm::simulate_state(&state, n, 1, || t.elapsed().as_secs_f64() * 1000.0).unwrap();
    println!("{}", out);
}
