window.BENCHMARK_DATA = {
  lastUpdate: 1617355241524,
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
          id: 'e4753b7c1d839ab53de42107aeb5395db8749431',
          message:
            'Merge pull request #519 from c-nixon/check-CARGO_CFG_TARGET_OS-in-build',
          timestamp: '2021-04-02T17:16:25+08:00',
          tree_id: 'b9f10745dc339649d4c4b3e1f1b3c3fa74334e08',
          url:
            'https://github.com/napi-rs/napi-rs/commit/e4753b7c1d839ab53de42107aeb5395db8749431',
        },
        date: 1617355240137,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 43626612,
            range: '±1.22%',
            unit: 'ops/sec',
            extra: '91 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 638451806,
            range: '±0.94%',
            unit: 'ops/sec',
            extra: '90 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 17557876,
            range: '±1.14%',
            unit: 'ops/sec',
            extra: '88 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 633429710,
            range: '±1.05%',
            unit: 'ops/sec',
            extra: '89 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 75309,
            range: '±19.77%',
            unit: 'ops/sec',
            extra: '74 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 62150,
            range: '±29.08%',
            unit: 'ops/sec',
            extra: '72 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 372659,
            range: '±3.77%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 326761,
            range: '±3.42%',
            unit: 'ops/sec',
            extra: '82 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 343217,
            range: '±3.34%',
            unit: 'ops/sec',
            extra: '79 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 304088,
            range: '±4.03%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 25318,
            range: '±3.89%',
            unit: 'ops/sec',
            extra: '74 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 1199,
            range: '±164.45%',
            unit: 'ops/sec',
            extra: '73 samples',
          },
        ],
      },
    ],
  },
}
