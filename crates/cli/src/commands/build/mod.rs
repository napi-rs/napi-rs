use crate::utils::*;
use cargo_metadata::{MetadataCommand, Package};
use clap::Args;
use clap_cargo::Features;
use log::{error, trace};
use minijinja::{context, Environment};
use rand::{thread_rng, RngCore};
use std::env::{current_dir, current_exe, temp_dir, var};
use std::fmt::Write;
use std::fs;
use std::path::PathBuf;
use std::process::{exit, Command};

#[derive(Args, Debug, Default)]
/// Build the napi-rs crates
pub struct BuildCommandArgs {
  /// Build for the target triple, bypassed to `cargo build --target`
  #[clap(short, long, value_parser)]
  target: Option<String>,

  /// Path to the `Cargo.toml` manifest
  #[clap(long, value_parser)]
  cwd: Option<PathBuf>,

  // Directory for all crate generated artifacts, see `cargo build --target-dir`
  #[clap(long, value_parser)]
  target_dir: Option<PathBuf>,

  /// Path to where all the built files would be put
  #[clap(short, long, value_parser)]
  output_dir: Option<PathBuf>,

  /// Add platform triple to the generated nodejs binding file, eg: `[name].linux-x64-gnu.node`
  #[clap(long, value_parser)]
  platform: bool,

  /// Path to the generate JS binding file. Only works with `--platform` flag
  #[clap(long = "js", value_parser)]
  js_binding: Option<String>,

  /// Package name in generated js binding file. Only works with `--platform` flag
  #[clap(long, value_parser)]
  js_package_name: Option<String>,

  /// Path to napi config, only JSON format accepted. Default to `package.json` under `cwd`.
  #[clap(long = "config", short, value_parser)]
  config_file: Option<PathBuf>,

  /// Disable JS binding file generation
  #[clap(long = "no-js", value_parser)]
  disable_js_binding: bool,

  /// Path and filename of generated type def file. relative to `--cwd` or `--output_dir` if provided
  #[clap(long, value_parser)]
  dts: Option<PathBuf>,

  /// Do not output header notes like `// eslint-ignore` to `.d.ts` file
  #[clap(long, value_parser)]
  no_dts_header: bool,

  /// Whether strip the library to achieve the minimum file size
  #[clap(short, long, value_parser)]
  strip: bool,

  /// Build in release mode
  #[clap(short, long, value_parser)]
  release: bool,

  /// Verbosely log build command trace
  #[clap(short, long, value_parser)]
  verbose: bool,

  /// Build only the specified binary
  #[clap(long, value_parser)]
  bin: Option<String>,

  /// Build the specified library or the one at cwd
  #[clap(short, long, value_parser)]
  package: Option<String>,

  #[clap(flatten)]
  features: Features,

  /// [experimental] cross-compile for the specified target
  #[clap(long, value_parser)]
  cross_compile: bool,

  /// watch the crate changes and build continiously
  #[clap(short, long, value_parser)]
  watch: bool,

  /// All other flags bypassed to `cargo build` command. Usage: `napi build -- -p sub-crate`
  #[clap(last = true, value_parser)]
  bypass_flags: Vec<String>,
}

impl TryFrom<(BuildCommandArgs, Vec<String>)> for BuildCommand {
  type Error = ();

  fn try_from((args, raw_args): (BuildCommandArgs, Vec<String>)) -> Result<Self, Self::Error> {
    trace!("napi build command receive args: {:?}", args);
    let cwd = args.cwd.clone().unwrap_or_else(|| current_dir().unwrap());

    let manifest_path = cwd.join("Cargo.toml");

    if !manifest_path.exists() {
      error!("Could not find Cargo.toml at {:?}", manifest_path);
      return Err(());
    }

    match MetadataCommand::new().manifest_path(manifest_path).exec() {
      Ok(metadata) => {
        let pkg = metadata.root_package().or_else(|| {
          if let Some(package_arg) = &args.package {
            metadata
              .packages
              .iter()
              .find(|pkg| &pkg.name == package_arg)
          } else {
            None
          }
        });

        match pkg {
          Some(pkg) => Ok(BuildCommand {
            output_dir: args
              .output_dir
              .clone()
              .or_else(|| args.cwd.clone())
              .or_else(|| {
                pkg
                  .manifest_path
                  .parent()
                  .map(|p| p.as_std_path().to_path_buf())
              })
              .unwrap_or_else(|| PathBuf::from("./")),
            target_dir: args
              .target_dir
              .clone()
              .unwrap_or_else(|| metadata.target_directory.clone().into_std_path_buf()),
            cdylib_target: pkg
              .targets
              .iter()
              .find(|t| t.crate_types.iter().any(|t| t == "cdylib"))
              .map(|t| &t.name)
              .cloned(),
            bin_target: args.bin.clone().or_else(|| {
              pkg
                .targets
                .iter()
                .find(|t| t.kind.iter().any(|t| t == "bin"))
                .map(|t| &t.name)
                .cloned()
            }),
            target: Target::from(
              args
                .target
                .clone()
                .unwrap_or_else(get_system_default_target),
            ),
            intermediate_type_file: get_intermediate_type_file(),
            package: pkg.clone(),
            config: NapiConfig::from_package_json(
              cwd.join(
                args
                  .config_file
                  .clone()
                  .unwrap_or_else(|| "package.json".into()),
              ),
            )
            .expect("Failed to parse config file"),
            args,
            raw_args,
          }),
          None => {
            error!("Could not find crate to build");
            Err(())
          }
        }
      }
      Err(e) => {
        error!("Could not parse cargo manifest\n{}", e);
        Err(())
      }
    }
  }
}

pub struct BuildCommand {
  args: BuildCommandArgs,
  raw_args: Vec<String>,
  output_dir: PathBuf,
  target_dir: PathBuf,
  package: Package,
  cdylib_target: Option<String>,
  bin_target: Option<String>,
  target: Target,
  intermediate_type_file: PathBuf,
  config: NapiConfig,
}

impl Executable for BuildCommand {
  fn execute(&mut self) -> CommandResult {
    if self.args.verbose {
      log::set_max_level(log::LevelFilter::Trace)
    }

    self.run()?;

    Ok(())
  }
}

impl BuildCommand {
  fn run(&self) -> CommandResult {
    if self.cdylib_target.is_none() {
      warn!(
        r#"Missing `crate-type = ["cdylib"]` in [lib] config, not gonna generate node binding"#
      );
    }

    let mut cmd = self.create_command();
    if !self.args.watch {
      trace!(
        "Running cargo build with args: {:?}",
        cmd
          .get_args()
          .map(|arg| arg.to_string_lossy())
          .collect::<Vec<_>>()
          .join(" ")
      );
    }

    let exit_status = cmd
      .spawn()
      .expect("failed to execute `cargo build`")
      .wait()
      .expect("failed to execute `cargo build`");

    if exit_status.success() {
      self.post_build();
    } else {
      error!("`cargo build` failed");
      exit(exit_status.code().unwrap());
    }

    Ok(())
  }

  fn create_command(&self) -> Command {
    let mut cmd = if self.args.watch {
      try_install_cargo_binary("cargo-watch", "watch");
      let mut watch = Command::new("cargo");
      watch.args(["watch", "--why", "-i", "*.{js,ts,node}"]);
      if let Some(watch_path) = self.package.manifest_path.as_std_path().parent() {
        watch.arg("-w").arg(watch_path.as_os_str());
      }

      let exe = current_exe().expect("Failed to get current executable");
      watch.arg("--").arg(&exe);
      // started with js binary by `yarn napi ...`
      // or started with cargo binary by `cargo napi`
      // the `current_exe()` would be `node/cargo` and the first element of raw_args would be `path/to/napi`
      match &exe.file_stem().and_then(|n| n.to_str()) {
        Some(exe_name) => match *exe_name {
          "node" | "cargo" => {
            watch.arg(self.raw_args.first().unwrap());
          }
          _ => {}
        },
        None => {}
      }

      watch.arg("build");
      watch
    } else if !self.args.cross_compile {
      let mut build = Command::new("cargo");
      build.arg("build");
      build
    } else if self.target.platform == NodePlatform::Windows {
      // lazy install to reduce the size of non-cross-compiling senerios.
      try_install_cargo_binary("cargo-xwin", "xwin");
      let mut build = Command::new("cargo");
      build.args(["xwin", "build"]);
      build
    } else {
      try_install_cargo_binary("cargo-zigbuild", "zigbuild");
      let mut build = Command::new("cargo");
      build.arg("zigbuild");
      build
    };

    self
      .set_cwd(&mut cmd)
      .set_features(&mut cmd)
      .set_target(&mut cmd)
      .set_envs(&mut cmd)
      .set_bypass_args(&mut cmd)
      .set_package(&mut cmd);

    cmd
  }

  fn set_cwd(&self, cmd: &mut Command) -> &Self {
    if let Some(cwd) = &self.args.cwd {
      trace!("set cargo working dir to {}", cwd.display());
      cmd.current_dir(cwd);
    }

    self
  }

  fn set_envs(&self, cmd: &mut Command) -> &Self {
    let mut envs = vec![(
      "TYPE_DEF_TMP_PATH",
      self.intermediate_type_file.to_str().unwrap(),
    )];

    let mut rust_flags = match var("RUSTFLAGS") {
      Ok(s) => s,
      Err(_) => String::new(),
    };

    if self.target.triple.contains("musl") && !rust_flags.contains("target-feature=-crt-static") {
      rust_flags.push_str(" -C target-feature=-crt-static");
    }

    if self.args.strip && !rust_flags.contains("link-arg=-s") {
      rust_flags.push_str(" -C link-arg=-s");
    }

    if !rust_flags.is_empty() {
      envs.push(("RUSTFLAGS", &rust_flags));
    }

    // only set if no linker specified in vars
    // no worry about user configuration in `.cargo/config.toml`
    // it has higher priority than linker vars
    if let Some(linker) = self.target.linker() {
      if var("RUSTC_LINKER").is_err()
        && var(format!("CARGET_TARGET_{}_LINKER", self.target.env_print())).is_err()
      {
        envs.push(("RUSTC_LINKER", linker));
      }
    }

    trace!("set environment variables: ");
    envs.iter().for_each(|(k, v)| {
      trace!("  {}={}", k, v);
      cmd.env(k, v);
    });

    self
  }

  fn set_target(&self, cmd: &mut Command) -> &Self {
    trace!("set compiling target to {}", &self.target.triple);
    cmd.arg("--target").arg(&self.target.triple);

    self
  }

  fn set_bypass_args(&self, cmd: &mut Command) -> &Self {
    trace!("bypassing flags: {:?}", self.args.bypass_flags);

    if self.args.release {
      cmd.arg("--release");
    }

    if self.args.target_dir.is_some() {
      cmd
        .arg("--target-dir")
        .arg(self.args.target_dir.as_ref().unwrap());
    }

    if self.args.verbose {
      cmd.arg("--verbose");
    }

    cmd.args(self.args.bypass_flags.iter());

    self
  }

  fn set_features(&self, cmd: &mut Command) -> &Self {
    let mut args = vec![];
    if self.args.features.all_features {
      args.push(String::from("--all-features"))
    } else if self.args.features.no_default_features {
      args.push(String::from("--no-default-features"))
    } else if !self.args.features.features.is_empty() {
      args.push(String::from("--features"));
      args.extend_from_slice(&self.args.features.features);
    }

    trace!("set features flags: {:?}", args);
    cmd.args(args);

    self
  }

  fn set_package(&self, cmd: &mut Command) -> &Self {
    let mut args = vec![];

    if let Some(package) = &self.args.package {
      args.push("-p");
      args.push(package.as_ref());
    }

    if let Some(bin) = &self.args.bin {
      args.push("--bin");
      args.push(bin);
    }

    if !args.is_empty() {
      trace!("set package flags: {:?}", args);
      cmd.args(args);
    }

    self
  }

  fn post_build(&self) {
    self.copy_output();

    // only for cdylib
    if self.cdylib_target.is_some() {
      self.process_type_def();
      self.write_js_binding();
    }
  }

  fn copy_output(&self) {
    if let Some((src_name, dest_name)) = self.get_artifact_names() {
      let mut src = self.target_dir.clone();
      let mut dest = self.output_dir.clone();

      src.push(&self.target.triple);
      src.push(if self.args.release {
        "release"
      } else {
        "debug"
      });

      src.push(src_name);
      dest.push(dest_name);

      info!("copy artifact from {} to {}", src.display(), dest.display());

      if let Ok(()) = fs::remove_file(&dest) {};
      if let Err(e) = fs::copy(&src, &dest) {
        error!("Failed to move artifact to dest path. {}", e);
      };
    }
  }

  fn get_artifact_names(&self) -> Option<(/* src */ String, /* dist */ String)> {
    if let Some(cdylib) = &self.cdylib_target {
      let cdylib = cdylib.clone().replace('-', "_");
      let src_name = match self.target.platform {
        NodePlatform::Darwin => {
          format!("lib{}.dylib", cdylib)
        }
        NodePlatform::Windows => {
          format!("{}.dll", cdylib)
        }
        _ => {
          format!("lib{}.so", cdylib)
        }
      };

      let dest_name = format!(
        "{}{}.node",
        self.config.binary_name(),
        if self.args.platform {
          format!(".{}", self.target.platform_arch_abi)
        } else {
          "".to_owned()
        }
      );

      Some((src_name, dest_name))
    } else if let Some(bin) = &self.bin_target {
      let src_name = if self.target.platform == NodePlatform::Windows {
        format!("{}.exe", bin)
      } else {
        bin.clone()
      };

      let dest_name = src_name.clone();

      Some((src_name, dest_name))
    } else {
      None
    }
  }

  fn process_type_def(&self) {
    if !self.intermediate_type_file.exists() {
      return;
    }

    let mut dest = self.output_dir.clone();
    match &self.args.dts {
      Some(dts) => dest.push(dts),
      None => dest.push("index.d.ts"),
    };

    let type_def_file = IntermidiateTypeDefFile::from(&self.intermediate_type_file);
    let dts = type_def_file
      .into_dts(!self.args.no_dts_header)
      .expect("Failed to parse type def file");

    write_file(&dest, &dts).expect("Failed to write type def file");
  }

  fn write_js_binding(&self) {
    if !self.args.platform || self.args.disable_js_binding {
      return;
    }

    let mut output = self.output_dir.clone();
    output.push(
      self
        .args
        .js_binding
        .clone()
        .unwrap_or_else(|| String::from("index.js")),
    );

    let mut env = Environment::new();
    env
      .add_template("index.js", include_str!("./templates/binding.tpl"))
      .unwrap();

    let binding = env
      .get_template("index.js")
      .and_then(|template| {
        template.render(context!(
          binary_name => self.config.binary_name(),
          package_name => self.args.js_package_name.as_deref().unwrap_or_else(|| self.config.package_name())
        ))
      })
      .expect("Failed to generate js binding file.");

    write_file(&output, &binding).expect("Failed to write js binding file");
  }
}

fn get_intermediate_type_file() -> PathBuf {
  let len = 16;
  let mut rng = thread_rng();
  let mut data = vec![0; len];
  rng.fill_bytes(&mut data);

  let mut hex_string = String::with_capacity(2 * len);
  for byte in data {
    write!(hex_string, "{:02X}", byte).unwrap();
  }

  temp_dir().join(format!("type_def.{}.tmp", hex_string))
}
