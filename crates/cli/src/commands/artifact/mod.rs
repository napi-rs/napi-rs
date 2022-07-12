use std::{
  env::current_dir,
  fs::{copy, read_dir},
  path::{Path, PathBuf},
};

use clap::Args;
use log::trace;

use crate::utils::{CommandResult, Executable, NapiConfig, Target};

#[derive(Args, Debug)]
/// Copy artifacts from Github Actions into specified dir
pub struct ArtifactCommandArgs {
  /// The path to artifact directory.
  #[clap(short, long = "dir", default_value = "artifacts", value_parser)]
  artifacts_dir: String,

  /// Where would the artifacts be moved to.
  #[clap(long, default_value = "npm", value_parser)]
  dist: String,

  /// Path to napi config file.
  #[clap(short, long = "config", value_parser)]
  config_file: Option<PathBuf>,

  /// Change working directory.
  #[clap(long, value_parser)]
  cwd: Option<PathBuf>,
}

pub struct ArtifactCommand {
  args: ArtifactCommandArgs,
  cwd: PathBuf,
  config: NapiConfig,
}

impl TryFrom<(ArtifactCommandArgs, Vec<String>)> for ArtifactCommand {
  type Error = ();

  fn try_from((args, _): (ArtifactCommandArgs, Vec<String>)) -> Result<Self, Self::Error> {
    let cwd = args.cwd.clone().unwrap_or_else(|| current_dir().unwrap());

    Ok(Self {
      config: NapiConfig::from_package_json(
        cwd.join(
          args
            .config_file
            .clone()
            .unwrap_or_else(|| "package.json".into()),
        ),
      )
      .expect("Failed to parse config file"),
      cwd,
      args,
    })
  }
}

impl Executable for ArtifactCommand {
  fn execute(&mut self) -> CommandResult {
    let artifacts_dir = self.cwd.join(&self.args.artifacts_dir);
    let npm_dirs_base = self.cwd.join(&self.args.dist);

    let mut artifacts = vec![];
    collect_artifacts(&artifacts_dir, &mut artifacts);
    trace!("Found {} artifacts: {:?}", artifacts.len(), artifacts);

    let platforms = self
      .config
      .targets()
      .iter()
      .map(|triple| {
        let target = Target::from(&triple);
        target.platform_arch_abi
      })
      .collect::<Vec<_>>();

    for artifact in artifacts.iter() {
      let file_name = artifact.file_name().unwrap().to_string_lossy();
      let mut parsed = file_name.split('.');
      let binary_name = parsed.next();
      let platform = parsed.next();

      if binary_name.is_none() || platform.is_none() {
        trace!("Unknown file: {}, skipped.", file_name);
        continue;
      }

      let binary_name = binary_name.unwrap();
      let platform = platform.unwrap();

      if binary_name == self.config.binary_name() && platforms.iter().any(|p| p == platform) {
        let npm_dir_target = npm_dirs_base.join(platform).join(file_name.as_ref());
        let cwd_target = self.cwd.join(file_name.as_ref());

        trace!(
          "Moving {} to {}",
          cwd_target.display(),
          npm_dir_target.display()
        );
        copy(artifact, npm_dir_target).expect("Failed to copy artifact.");

        trace!(
          "Moving {} to {}",
          cwd_target.display(),
          cwd_target.display()
        );
        copy(artifact, cwd_target).expect("Failed to copy artifact.");
      } else {
        trace!("Did not match, skipping file: {}", file_name);
      }
    }

    Ok(())
  }
}

fn collect_artifacts(dir: &Path, artifacts: &mut Vec<PathBuf>) {
  let dir =
    read_dir(&dir).unwrap_or_else(|_| panic!("Failed to read  directory: {}", dir.display()));

  dir.flatten().for_each(|desc| {
    let path = desc.path();
    if path.is_dir() {
      collect_artifacts(&path, artifacts);
    } else if path.is_file() && path.ends_with(".node") {
      artifacts.push(path);
    }
  });
}
