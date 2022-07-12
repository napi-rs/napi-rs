use crate::utils::{Executable, SimpleLogger};
use clap::Parser;
use std::convert::TryFrom;

mod artifact;
mod build;
mod new;
mod vvv;

use artifact::*;
use build::*;
use new::*;
use vvv::*;

#[derive(Parser)]
#[clap(name = "napi", bin_name = "napi", version, about, long_about = None)]
enum Cli {
  New(Box<NewCommandArgs>),
  Build(Box<BuildCommandArgs>),
  Artifact(Box<ArtifactCommandArgs>),
  /// Prints info about the cli
  Vvv,
}

macro_rules! run_command {
  ( $src:ident, $raw_args:ident, $( ($branch:ident, $cmd:ty) ),* ) => {
    match $src {
      $(
        Cli::$branch(parsed_args) => {
          <$cmd>::try_from((*parsed_args, $raw_args))
            .and_then(|mut cmd| cmd.execute())
            .unwrap_or_else(|_| {
              std::process::exit(1);
            });
        }
      ),*
      Cli::Vvv => {
        <CliInfoCommand>::try_from(((), $raw_args))
          .and_then(|mut cmd| cmd.execute())
          .unwrap_or_else(|_| {
            std::process::exit(1);
          });
      }
      #[allow(unreachable_patterns)]
      _ => unreachable!(),
    }
  };
}

pub fn run(args: Vec<String>) {
  let cli = Cli::parse_from(&args);

  // eat the error of setting logger
  if log::set_boxed_logger(Box::new(SimpleLogger)).is_err() {}
  log::set_max_level(log::LevelFilter::Trace);

  run_command!(
    cli,
    args,
    (New, NewCommand),
    (Build, BuildCommand),
    (Artifact, ArtifactCommand)
  );
}
