window.BENCHMARK_DATA = {
  lastUpdate: 1620384352486,
  repoUrl: 'https://github.com/napi-rs/napi-rs',
  entries: {
    Benchmark: [
      {
        commit: {
          author: {
            email: 'lynweklm@gmail.com',
            name: 'LongYinan',
            username: 'Brooooooklyn',
          },
          committer: {
            email: 'noreply@github.com',
            name: 'GitHub',
            username: 'web-flow',
          },
          distinct: true,
          id: '6a43ed64f453ad4b4222e626edd1be798e116e6d',
          message:
            'Merge pull request #551 from napi-rs/rust-1.52\n\nchore: apply 1.52 clippy rules',
          timestamp: '2021-05-07T18:38:17+08:00',
          tree_id: 'e3aeca1b7622ec9a50ea9e6071814b55d9729771',
          url:
            'https://github.com/napi-rs/napi-rs/commit/6a43ed64f453ad4b4222e626edd1be798e116e6d',
        },
        date: 1620384349300,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 47418472,
            range: '±0.47%',
            unit: 'ops/sec',
            extra: '91 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 617747822,
            range: '±0.45%',
            unit: 'ops/sec',
            extra: '94 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 15364117,
            range: '±0.9%',
            unit: 'ops/sec',
            extra: '86 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 611949233,
            range: '±0.45%',
            unit: 'ops/sec',
            extra: '95 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 80670,
            range: '±22.85%',
            unit: 'ops/sec',
            extra: '69 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 16637,
            range: '±162.38%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 407410,
            range: '±3.23%',
            unit: 'ops/sec',
            extra: '84 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 365019,
            range: '±3.18%',
            unit: 'ops/sec',
            extra: '86 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 363729,
            range: '±3.05%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 329893,
            range: '±3.22%',
            unit: 'ops/sec',
            extra: '83 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 30096,
            range: '±1.77%',
            unit: 'ops/sec',
            extra: '85 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 1306,
            range: '±173.83%',
            unit: 'ops/sec',
            extra: '77 samples',
          },
        ],
      },
    ],
  },
}
