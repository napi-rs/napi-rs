# Rust crate releases

The async-runtime work is a coordinated major release:

| Crate                 | Required major | Baseline |
| --------------------- | -------------: | -------: |
| `napi`                |              4 |   3.10.3 |
| `napi-derive-backend` |              6 |    5.1.1 |
| `napi-derive`         |              4 |    3.5.9 |

The publication order is fixed:

1. Publish `napi-build` and `napi-sys` if their versions are not already available, waiting for
   each exact version in both the crates.io API and sparse index. They are registry dependencies of
   the packaged runtime.
2. Publish `napi` and wait for the same visibility.
3. Publish `napi-derive-backend` and wait for the same visibility.
4. Publish `napi-derive` and wait for the same visibility.
5. Let release-plz process all remaining workspace crates with those five crates explicitly
   excluded.

`.github/release-coordination.mjs` owns this sequence. A retry is safe: release-plz does
nothing for a version that is already published. Each coordinated invocation uses a config that
disables the workspace and enables exactly one crate; `--manifest-path` alone does not isolate a
member of this virtual workspace. The final workspace invocation uses
`.github/release-plz-remaining.toml`, which excludes the prerequisites and coordinated crates. The
release job is also serialized across `main` pushes.

`release-plz.toml` sets `release_always = false`, so publishing happens only after the generated
release PR is merged. It also keeps package-qualified tags for the single-crate release configs.

## Semver gate

Run:

```sh
yarn check:release-coordination
yarn test:release-coordination
node .github/release-coordination.mjs check-semver
```

The pinned release-plz action detects the `napi` Rust API break, but it proposes patch releases for
the derive crates because their breaking behavior is in generated code. The explicit
cargo-semver-checks gate uses `--default-features`, first proves that a minor runtime release is
rejected, then verifies that the manifest's major release is sufficient.

`napi-derive-backend` is also checked with all features. Its breaking changes are in generated code,
not its Rust library API, and `napi-derive` is a proc-macro-only crate. Those generated-code
contracts are therefore protected by the explicit major-version, dependency, and package-isolation
checks instead.
