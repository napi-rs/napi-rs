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

  /// Fail on any error (parse failures, extraction errors, or IR conversion errors)
  /// instead of warning and skipping.
  #[arg(long)]
  strict: bool,
}

fn main() -> Result<()> {
  let args = Args::parse();

  let result = napi_typegen::generate_type_defs(&args.crate_dir, args.strict)?;

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

  Ok(())
}
