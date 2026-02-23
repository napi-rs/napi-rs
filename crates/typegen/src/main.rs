use std::io::{BufWriter, Write};
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "napi-typegen")]
#[command(about = "Generate TypeScript type definitions from #[napi]-annotated Rust source files")]
struct Args {
  /// Root directory of the Rust crate to scan
  #[arg(long, default_value = ".")]
  crate_dir: PathBuf,

  /// Output file path for type definitions (one JSON object per line).
  /// Each line is a serialized TypeDef matching the proc-macro's output format.
  /// If not specified, writes to stdout.
  #[arg(long)]
  output_file: Option<PathBuf>,

  /// Path to a pre-computed `cargo metadata --format-version 1` JSON file.
  /// When provided, napi-typegen reads this file instead of running `cargo metadata`
  /// as a subprocess. Useful in sandboxed builds (e.g. Nix) where cargo is not
  /// available at typegen time.
  #[arg(long)]
  cargo_metadata: Option<PathBuf>,

  /// Fail on any error (parse failures, extraction errors, or IR conversion errors)
  /// instead of warning and skipping.
  #[arg(long)]
  strict: bool,
}

fn main() -> Result<()> {
  let args = Args::parse();

  let result =
    napi_typegen::generate_type_defs(&args.crate_dir, args.cargo_metadata.as_deref(), args.strict)?;

  if let Some(output_file) = &args.output_file {
    // Write to file
    if let Some(parent) = output_file.parent() {
      std::fs::create_dir_all(parent)
        .with_context(|| format!("Failed to create output directory: {}", parent.display()))?;
    }
    let file = std::fs::File::create(output_file)
      .with_context(|| format!("Failed to create output file: {}", output_file.display()))?;
    let mut writer = BufWriter::new(file);
    for td in &result.type_defs {
      writeln!(writer, "{}", td)?;
    }
    writer.flush()?;
    eprintln!(
      "Generated {} type definitions to {}",
      result.type_defs.len(),
      output_file.display()
    );
  } else {
    // Write to stdout
    for td in &result.type_defs {
      println!("{}", td);
    }
  }

  if result.parse_errors > 0 {
    eprintln!(
      "Warning: {} file(s) had parse errors and were skipped",
      result.parse_errors
    );
    std::process::exit(2);
  }

  Ok(())
}
