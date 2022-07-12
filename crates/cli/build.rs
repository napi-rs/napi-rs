use std::env;
use std::fs;
use std::path::Path;

fn main() {
  let target = env::var("TARGET").unwrap();
  let dest_path = Path::new("./src/commands/vvv").join("target");
  fs::write(&dest_path, &target).unwrap();
}
