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
nothing for a version that is already visible, and the coordinator checks crates.io before invoking
it. After each registry publication, the coordinator verifies the package-qualified Git tag and
GitHub release. If publication succeeded before release-plz failed, it re-enters release-plz's
git-only path to repair a missing tag or release. Re-run the failed workflow so the retry uses the
same release commit; artifact repair intentionally retains the release-PR gate and must not tag a
later `main` commit. Git artifacts without visibility in both crates.io views are treated as an
inconsistent partial release, not as an ineligible release. Each coordinated invocation uses a
config that disables the workspace and enables exactly one crate; `--manifest-path` alone does not
isolate a member of this virtual workspace. The final workspace invocation uses
`.github/release-plz-remaining.toml`, which excludes the prerequisites and coordinated crates.

`release-plz.toml` sets `release_always = false`, so publishing happens only after the generated
release PR is merged. That mode uses GitHub's associated-PR and PR-commit APIs, so the release job
retains `pull-requests: read`; the direct CLI receives the workflow token as `GIT_TOKEN`. Do not add
GitHub Actions concurrency to the release job: GitHub replaces an older pending job when another
push arrives, which can discard the release-PR merge run. Concurrency remains on release-PR
generation, where replacing stale pending work is safe.

Both the direct publisher and the release-PR action are pinned to release-plz `0.3.159`. All release
configs keep package-qualified Git tags and GitHub release names.

## Semver gate

Run:

```sh
yarn check:release-coordination
yarn test:release-coordination
node .github/release-coordination.mjs check-semver
```

The pinned release-plz action detects the `napi` Rust API break, but it proposes patch releases for
the derive crates because their breaking behavior is in generated code. The explicit
cargo-semver-checks gate first proves against `napi` `3.10.3` that the existing `tokio_rt` surface
requires a major release. That negative check stops after `napi` `4.0.0` is registry-visible.
Positive checks intentionally let cargo-semver-checks select the newest published version at or
below the manifest version. This makes the same gate compare future `4.x` work to the latest
published `4.x` release instead of permanently accepting breaks against the old `3.x` baseline.

Once `napi` `4.0.0` is registry-visible, the gate also checks pure `async-runtime` and combined
`async-runtime,tokio_rt` public surfaces. `napi-derive-backend` is checked with all features against
its dynamic registry baseline. Its breaking changes are in generated code, not its Rust library
API, and `napi-derive` is a proc-macro-only crate. Those generated-code contracts are protected by
the explicit major-version, exact path-dependency requirement, and package-isolation checks instead.
