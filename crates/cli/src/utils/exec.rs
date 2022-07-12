use log::info;
use std::io;
use std::process::Command;

pub fn try_install_cargo_binary(name: &str, bin: &str) {
  if detect_binary(bin).expect("Failed to detect cargo binary") {
    return;
  }

  info!("Cargo binary {} is required but not installed.", name);
  info!("Downloading cargo binary {}...", name);

  let mut cmd = Command::new("cargo");
  cmd.args(&["install", name]);
  cmd
    .spawn()
    .and_then(|mut p| p.wait())
    .unwrap_or_else(|e| panic!("Failed to install binary {}.\n{}", bin, e));
}

fn detect_binary(bin: &str) -> io::Result<bool> {
  let output = Command::new("cargo").arg("help").arg(bin).output()?;

  Ok(output.status.success())
}
