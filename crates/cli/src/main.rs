mod commands;
mod utils;

fn main() {
  commands::run(std::env::args().collect());
}
