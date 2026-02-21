use std::path::PathBuf;
use std::process::Command;

/// Find the workspace root by looking for the top-level Cargo.toml with [workspace].
fn workspace_root() -> PathBuf {
  let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  // crates/typegen -> workspace root is ../../
  manifest_dir
    .parent()
    .and_then(|p| p.parent())
    .expect("Could not find workspace root")
    .to_owned()
}

/// Get the path to the napi-typegen binary built by cargo test.
fn typegen_bin() -> PathBuf {
  let path = PathBuf::from(env!("CARGO_BIN_EXE_napi-typegen"));
  assert!(
    path.exists(),
    "napi-typegen binary not found at {}",
    path.display()
  );
  path
}

#[test]
fn snapshot_examples_napi() {
  let root = workspace_root();
  let examples_napi = root.join("examples").join("napi");

  if !examples_napi.exists() {
    if std::env::var("CI").is_ok() {
      panic!(
        "examples/napi not found at {} — this should not happen in CI",
        examples_napi.display()
      );
    }
    eprintln!(
      "Skipping snapshot test: examples/napi not found at {}",
      examples_napi.display()
    );
    return;
  }

  let output = Command::new(typegen_bin())
    .arg("--crate-dir")
    .arg(&examples_napi)
    .output()
    .expect("Failed to run napi-typegen");

  assert!(
    output.status.success(),
    "napi-typegen failed with status {}: {}",
    output.status,
    String::from_utf8_lossy(&output.stderr)
  );

  let actual = String::from_utf8(output.stdout).expect("Output is not valid UTF-8");
  let mut actual_lines: Vec<&str> = actual.lines().filter(|l| !l.is_empty()).collect();
  actual_lines.sort();

  let snapshot_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("tests")
    .join("snapshots")
    .join("examples_napi.jsonl");

  if !snapshot_path.exists() {
    panic!(
      "Snapshot file not found at {}. Generate it with:\n  \
       cargo run -p napi-typegen -- --crate-dir examples/napi --output-file crates/typegen/tests/snapshots/examples_napi.jsonl",
      snapshot_path.display()
    );
  }

  let expected = std::fs::read_to_string(&snapshot_path).expect("Failed to read snapshot file");
  let mut expected_lines: Vec<&str> = expected.lines().filter(|l| !l.is_empty()).collect();
  expected_lines.sort();

  // Compare sorted vecs — preserves duplicates (unlike BTreeSet) and handles
  // non-deterministic file walk order.
  if actual_lines != expected_lines {
    let mut msg = String::new();

    // Find lines present in expected but not in actual
    let mut missing = Vec::new();
    let mut extra = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < expected_lines.len() && j < actual_lines.len() {
      match expected_lines[i].cmp(actual_lines[j]) {
        std::cmp::Ordering::Equal => {
          i += 1;
          j += 1;
        }
        std::cmp::Ordering::Less => {
          missing.push(expected_lines[i]);
          i += 1;
        }
        std::cmp::Ordering::Greater => {
          extra.push(actual_lines[j]);
          j += 1;
        }
      }
    }
    missing.extend_from_slice(&expected_lines[i..]);
    extra.extend_from_slice(&actual_lines[j..]);

    if !missing.is_empty() {
      msg.push_str(&format!(
        "\n--- Missing from output ({} lines) ---\n",
        missing.len()
      ));
      for line in &missing[..missing.len().min(10)] {
        msg.push_str(&format!("  {}\n", line));
      }
      if missing.len() > 10 {
        msg.push_str(&format!("  ... and {} more\n", missing.len() - 10));
      }
    }
    if !extra.is_empty() {
      msg.push_str(&format!(
        "\n+++ Extra in output ({} lines) +++\n",
        extra.len()
      ));
      for line in &extra[..extra.len().min(10)] {
        msg.push_str(&format!("  {}\n", line));
      }
      if extra.len() > 10 {
        msg.push_str(&format!("  ... and {} more\n", extra.len() - 10));
      }
    }
    msg.push_str(&format!(
      "\nExpected {} lines, got {} lines.\n\
       To update the snapshot, run:\n  \
       cargo run -p napi-typegen -- --crate-dir examples/napi --output-file crates/typegen/tests/snapshots/examples_napi.jsonl",
      expected_lines.len(),
      actual_lines.len()
    ));
    panic!("Snapshot mismatch:{}", msg);
  }
}

/// Run with --strict to ensure no items silently fail conversion.
/// This catches regressions where an item can no longer be converted —
/// the non-strict snapshot test would only show a "missing" line.
#[test]
fn strict_mode_examples_napi() {
  let root = workspace_root();
  let examples_napi = root.join("examples").join("napi");

  if !examples_napi.exists() {
    if std::env::var("CI").is_ok() {
      panic!(
        "examples/napi not found at {} — this should not happen in CI",
        examples_napi.display()
      );
    }
    eprintln!(
      "Skipping strict test: examples/napi not found at {}",
      examples_napi.display()
    );
    return;
  }

  let output = Command::new(typegen_bin())
    .arg("--crate-dir")
    .arg(&examples_napi)
    .arg("--strict")
    .output()
    .expect("Failed to run napi-typegen");

  assert!(
    output.status.success(),
    "napi-typegen --strict failed with status {}:\n{}",
    output.status,
    String::from_utf8_lossy(&output.stderr)
  );

  let stderr = String::from_utf8_lossy(&output.stderr);
  assert!(
    !stderr.contains("Warning:"),
    "napi-typegen --strict produced warnings (should have failed instead):\n{}",
    stderr
  );

  let stdout = String::from_utf8_lossy(&output.stdout);
  assert!(
    !stdout.trim().is_empty(),
    "napi-typegen --strict produced no output — expected type definitions"
  );
}
