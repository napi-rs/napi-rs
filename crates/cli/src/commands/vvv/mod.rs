use crate::utils::{CommandResult, Executable};

pub struct CliInfoCommand {
  build_target: &'static str,
  cargo: &'static str,
  version: &'static str,
  name: &'static str,
  bin: &'static str,
}

impl TryFrom<((), Vec<String>)> for CliInfoCommand {
  type Error = ();

  fn try_from((_, _): ((), Vec<String>)) -> Result<Self, Self::Error> {
    Ok(CliInfoCommand {
      build_target: include_str!("./target"),
      cargo: env!("CARGO"),
      version: env!("CARGO_PKG_VERSION"),
      name: env!("CARGO_PKG_NAME"),
      bin: env!("CARGO_BIN_NAME"),
    })
  }
}

impl Executable for CliInfoCommand {
  fn execute(&mut self) -> CommandResult {
    println!("Cargo path:       {}", self.cargo);
    println!("Cli crate name:   {}", self.name);
    println!("cli bin name:     {}", self.bin);
    println!("Cli version:      {}", self.version);
    println!("Cli build target: {}", self.build_target);

    Ok(())
  }
}
