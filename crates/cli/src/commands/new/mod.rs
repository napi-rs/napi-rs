use clap::Args;
use dialoguer::{theme::ColorfulTheme, Input, MultiSelect, Select};
use minijinja::{context, Environment};
use std::{fs, io, path::PathBuf};

use crate::utils::*;

/// Create a new project with pre-configured boilerplate
#[derive(Args, Debug)]
pub struct NewCommandArgs {
  /// The path where the napi-rs project will be created
  #[clap(value_parser)]
  path: PathBuf,

  /// Name of the napi-rs project
  #[clap(short = 'n', long, value_parser)]
  name: Option<String>,

  /// Minimum node-api version support
  #[clap(short = 'v', long, default_value_t = NapiVersion::NAPI4, value_parser)]
  min_node_api: u8,

  /// License for opensourced project
  #[clap(short = 'l', long, default_value = "UNLICENSED", value_parser)]
  license: String,

  /// All targets the crate will be compiled for. Use `--default-targets` to use the default ones.
  #[clap(short = 't', long, value_parser)]
  targets: Option<Vec<String>>,

  /// Whether enable default targets
  #[clap(long, value_parser)]
  enable_default_targets: bool,

  /// Whether enable all targets
  #[clap(long, value_parser)]
  enable_all_targets: bool,

  /// Whether enable the `type-def` feature for typescript definitions auto-generation
  #[clap(long, value_parser)]
  enable_type_def: bool,

  /// Whether generate preconfigured github actions to crate folder
  #[clap(long, value_parser)]
  enable_github_actions: bool,

  /// Use default preset and skip all interactive prompts
  #[clap(short = 'y', long, value_parser)]
  yes: bool,
}

impl TryFrom<(NewCommandArgs, Vec<String>)> for NewCommand {
  type Error = ();

  fn try_from((args, _): (NewCommandArgs, Vec<String>)) -> Result<Self, Self::Error> {
    Ok(Self { args })
  }
}

pub struct NewCommand {
  args: NewCommandArgs,
}

impl Executable for NewCommand {
  fn execute(&mut self) -> CommandResult {
    if let Err(e) = fs::create_dir_all(&self.args.path) {
      eprintln!("{}", e);
      eprintln!(
        "Failed to create directory {:?}",
        self.args.path.as_os_str()
      );

      return Err(());
    }

    let default_name = self
      .args
      .path
      .iter()
      .last()
      .unwrap()
      .to_string_lossy()
      .to_string();

    if self.args.yes {
      self.args.name = Some(default_name);
      self.use_targets(DEFAULT_TARGETS);
      self.args.enable_type_def = true;
      self.args.enable_github_actions = true;
    } else {
      self.fetch_name(default_name);
      self.fetch_license();
      self.fetch_napi_version();
      self.fetch_targets();
      self.fetch_type_def();
      self.fetch_gh_actions();
    }

    if let Err(e) = self.write_files() {
      eprintln!("{}", e);
      return Err(());
    }
    Ok(())
  }
}

impl NewCommand {
  fn fetch_name(&mut self, default: String) {
    self.args.name.get_or_insert_with(|| {
      Input::with_theme(&ColorfulTheme::default())
        .with_prompt("Package name (The name filed in your package.json)")
        .default(default.to_owned())
        .interact_text()
        .unwrap()
    });
  }

  fn fetch_license(&mut self) {
    self.args.license = Input::with_theme(&ColorfulTheme::default())
      .with_prompt("License")
      .default("MIT".to_owned())
      .interact_text()
      .unwrap();
  }

  fn fetch_napi_version(&mut self) {
    let versions = (1_u8..9)
      .map(|v| format!("napi{} ({})", v, napi_engine_requirement(v)))
      .collect::<Vec<_>>();

    self.args.min_node_api = Select::with_theme(&ColorfulTheme::default())
      .with_prompt("Minimum node-api version (with node version requirement)")
      .items(&versions)
      .default(3)
      .interact()
      .unwrap() as u8
      + 1;
  }

  fn use_targets(&mut self, targets: &[&str]) {
    self.args.targets = Some(targets.iter().map(|t| t.to_string()).collect::<Vec<_>>());
  }

  fn fetch_targets(&mut self) {
    if self.args.enable_default_targets {
      self.use_targets(DEFAULT_TARGETS);
    } else if self.args.enable_all_targets {
      self.use_targets(AVAILABLE_TARGETS);
    } else {
      let mut targets: Vec<String> = Vec::new();
      loop {
        let selected_target_indices = MultiSelect::with_theme(&ColorfulTheme::default())
          .with_prompt(
            "Choose target(s) you want to support ([space] to select, [enter] to confirm)",
          )
          .clear(true)
          .items(AVAILABLE_TARGETS)
          .defaults(
            &AVAILABLE_TARGETS
              .iter()
              .map(|t| DEFAULT_TARGETS.contains(t))
              .collect::<Vec<bool>>(),
          )
          .report(true)
          .interact()
          .unwrap();

        if !selected_target_indices.is_empty() {
          for index in selected_target_indices {
            targets.push(AVAILABLE_TARGETS[index].to_string());
          }
          break;
        }
      }
      self.args.targets = Some(targets);
    }
  }

  fn fetch_type_def(&mut self) {
    self.args.enable_type_def = self.args.enable_type_def || {
      let items = vec!["Yes", "No"];
      let selected_index = Select::with_theme(&ColorfulTheme::default())
        .with_prompt("Enable type-def feature (typescript definitions auto-generation)")
        .items(&items)
        .default(0)
        .interact()
        .unwrap();

      selected_index == 0
    };
  }

  fn fetch_gh_actions(&mut self) {
    self.args.enable_github_actions = self.args.enable_github_actions || {
      let items = vec!["Yes", "No"];
      let selected_index = Select::with_theme(&ColorfulTheme::default())
        .with_prompt("Enable github actions")
        .items(&items)
        .default(0)
        .interact()
        .unwrap();

      selected_index == 0
    };
  }

  fn write_files(&self) -> io::Result<()> {
    let name = self.args.name.as_ref().unwrap();
    let targets = self.args.targets.as_ref().unwrap();
    let mut env = Environment::new();

    self.write_cargo_toml(&mut env, name)?;
    self.write_lib_files(&mut env)?;
    self.write_package_json(&mut env, name, targets)?;
    self.write_github_workflow(&mut env, name, targets)?;
    write_file(
      &self.args.path.join(".gitignore"),
      include_str!("templates/.gitignore"),
    )?;
    write_file(
      &self.args.path.join(".npmignore"),
      include_str!("templates/.gitignore"),
    )?;

    Ok(())
  }

  fn write_cargo_toml(&self, env: &mut Environment, name: &str) -> io::Result<()> {
    let file_name = "Cargo.toml";
    env
      .add_template(file_name, include_str!("templates/cargo_toml.tpl"))
      .unwrap();
    let template = env.get_template(file_name).unwrap();
    let features = vec![format!("napi{}", self.args.min_node_api)];
    let mut derive_features: Vec<&str> = vec![];
    if self.args.enable_type_def {
      derive_features.push("type-def");
    }
    let cargo_toml = template
      .render(context!(
        name => package_name_to_crate_name(name),
        license => self.args.license,
        napi_version => 2,
        napi_derive_version => 2,
        napi_build_version => 2,
        features => features,
        derive_features => derive_features,
      ))
      .unwrap();

    write_file(&self.args.path.join(file_name), &cargo_toml)
  }

  fn write_lib_files(&self, _env: &mut Environment) -> io::Result<()> {
    write_file(
      &self.args.path.join("src/lib.rs"),
      include_str!("templates/lib_rs.tpl"),
    )?;

    write_file(
      &self.args.path.join("build.rs"),
      include_str!("templates/build_rs.tpl"),
    )?;

    Ok(())
  }

  fn write_package_json(
    &self,
    env: &mut Environment,
    name: &str,
    targets: &[String],
  ) -> io::Result<()> {
    let file_name = "package.json";
    env
      .add_template(file_name, include_str!("templates/package_json.tpl"))
      .unwrap();

    let template = env.get_template(file_name).unwrap();
    let package_json = template
      .render(context!(
        name => name,
        binary_name => package_name_to_binary_name(name),
        targets => targets,
        license => self.args.license,
        node_version_requirement => napi_engine_requirement(self.args.min_node_api),
      ))
      .unwrap();

    write_file(&self.args.path.join(file_name), &package_json)
  }

  fn write_github_workflow(
    &self,
    env: &mut Environment,
    name: &str,
    targets: &[String],
  ) -> io::Result<()> {
    if !self.args.enable_github_actions {
      return Ok(());
    }

    let file_name = "CI.yml";
    env
      .add_template(file_name, include_str!("templates/github_workflow_yml.tpl"))
      .unwrap();

    let template = env.get_template(file_name).unwrap();
    let github_workflow = template
      .render(context!(
        binary_name => package_name_to_binary_name(name),
        targets => targets.iter().filter_map(|t| get_github_workflow_config(t).map(|github_config| (Target::new(t), github_config))).collect::<Vec<_>>(),
      ))
      .unwrap();

    info!("Write file: .github/workflows");
    write_file(
      &self.args.path.join(".github/workflows").join(file_name),
      &github_workflow,
    )
  }
}

fn package_name_to_crate_name(name: &str) -> String {
  name.trim_start_matches('@').replace('/', "-")
}

fn package_name_to_binary_name(name: &str) -> String {
  name.split('/').last().unwrap().to_string()
}
