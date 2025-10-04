# AddressSanitizer (ASAN) Setup for NAPI-RS

This document explains the AddressSanitizer configuration for detecting memory errors in NAPI-RS across different platforms.

## CI Workflow (`asan.yml`)

The ASAN workflow tests memory safety on Linux and Windows:

### Supported Configurations:

| Platform       | Toolchain | Notes                                    |
| -------------- | --------- | ---------------------------------------- |
| Ubuntu 24.04   | GCC       | Full `-Z build-std` support with libasan |
| Windows Latest | MSVC      | Uses Visual Studio's AddressSanitizer    |

### Key Features:

- **Nightly Rust**: Both platforms use nightly toolchain with `-Z sanitizer=address`
- **Platform-Specific Build**:
  - Linux: Full `-Z build-std` support for standard library instrumentation
  - Windows: Uses `CARGO_UNSTABLE_BUILD_STD` environment variable
- **Full Node.js Testing**: Both platforms support testing Node.js native modules

## Local Development

### Windows Setup

```powershell
# Set environment variables
$env:RUSTFLAGS = "-Zsanitizer=address"
$env:ASAN_OPTIONS = "windows_hook_rtl_allocators=true:detect_leaks=0:print_stats=1"

# Build with nightly
rustup default nightly
yarn workspace @examples/napi build --target x86_64-pc-windows-msvc

# Run tests
yarn test

# Alternative: Build with std from source (advanced)
# This requires using cargo directly instead of napi CLI
cargo +nightly build -Z build-std --target x86_64-pc-windows-msvc --manifest-path examples/napi/Cargo.toml
```

### Linux Setup

```bash
# Set flags
export RUSTFLAGS="-Z sanitizer=address"
export ASAN_OPTIONS="detect_leaks=1:check_initialization_order=true"

# Build with nightly
rustup default nightly
yarn workspace @examples/napi build -- -Z build-std

# Preload ASAN library
export LD_PRELOAD=$(gcc -print-file-name=libasan.so)

# Run tests
yarn test
```

## Common ASAN Options

| Option                        | Description                          | Default          |
| ----------------------------- | ------------------------------------ | ---------------- |
| `detect_leaks`                | Enable leak detection                | 1 (0 on Windows) |
| `print_stats`                 | Print allocator statistics           | 0                |
| `check_initialization_order`  | Check static initialization order    | 0                |
| `strict_string_checks`        | Strict checking for string functions | 0                |
| `halt_on_error`               | Stop on first error                  | 1                |
| `windows_hook_rtl_allocators` | Hook Windows heap functions          | 0                |

## Interpreting ASAN Reports

ASAN reports memory errors with stack traces:

```
==12345==ERROR: AddressSanitizer: heap-use-after-free
READ of size 4 at 0x60400000dfb4 thread T0
    #0 0x7f... in function_name file.rs:123:45
    #1 0x7f... in caller file.rs:456:78
```

Common error types:

- **heap-use-after-free**: Accessing freed memory
- **heap-buffer-overflow**: Writing beyond allocated bounds
- **stack-buffer-overflow**: Stack corruption
- **use-after-scope**: Using stack variables after scope ends
- **global-buffer-overflow**: Overflow in global variables

## Troubleshooting

### Windows Issues

1. **Missing ASAN DLL**: The workflow automatically searches for the DLL. Ensure Visual Studio is installed.

2. **Symbol Resolution**: Install debugging symbols:

   ```powershell
   # For better stack traces
   $env:ASAN_SYMBOLIZER_PATH = "C:\Program Files\LLVM\bin\llvm-symbolizer.exe"
   ```

3. **False Positives with Node.js**: Some Node.js internals may trigger ASAN. Use:
   ```powershell
   $env:ASAN_OPTIONS = "windows_hook_rtl_allocators=true:detect_leaks=0:suppressions=asan.supp"
   ```

### Cross-Platform Suppression File

Create `asan.supp` for known false positives:

```
# Suppress Node.js internal allocations
leak:node.exe
leak:libnode.so
```

## Performance Impact

- ASAN typically causes 2-3x slowdown
- Memory usage increases by ~3x
- Use `CARGO_PROFILE_DEV_OPT_LEVEL=1` to improve performance

## Additional Resources

- [Rust ASAN Documentation](https://doc.rust-lang.org/beta/unstable-book/compiler-flags/sanitizer.html)
- [MSVC AddressSanitizer](https://docs.microsoft.com/en-us/cpp/sanitizers/asan)
- [Clang AddressSanitizer](https://clang.llvm.org/docs/AddressSanitizer.html)
