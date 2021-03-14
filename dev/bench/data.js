window.BENCHMARK_DATA = {
  lastUpdate: 1615712725048,
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
          id: '3dd071540b48bf4459053ccf5e51edee61a62173',
          message:
            'Merge pull request #503 from fanatid/patch-1\n\nRemove deprecated `register_module` from example in README.md',
          timestamp: '2021-03-14T17:01:26+08:00',
          tree_id: '2763006b3e040502fb70a985081a37a0aaeee570',
          url:
            'https://github.com/napi-rs/napi-rs/commit/3dd071540b48bf4459053ccf5e51edee61a62173',
        },
        date: 1615712723564,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 45716259,
            range: '±0.27%',
            unit: 'ops/sec',
            extra: '97 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 591075888,
            range: '±0.15%',
            unit: 'ops/sec',
            extra: '95 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 14046585,
            range: '±0.32%',
            unit: 'ops/sec',
            extra: '94 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 588876953,
            range: '±0.32%',
            unit: 'ops/sec',
            extra: '95 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 86251,
            range: '±22.74%',
            unit: 'ops/sec',
            extra: '69 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 62792,
            range: '±55.25%',
            unit: 'ops/sec',
            extra: '84 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 235768,
            range: '±80.52%',
            unit: 'ops/sec',
            extra: '52 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 355905,
            range: '±3.55%',
            unit: 'ops/sec',
            extra: '85 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 368047,
            range: '±2.82%',
            unit: 'ops/sec',
            extra: '86 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 324678,
            range: '±3.1%',
            unit: 'ops/sec',
            extra: '84 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 29402,
            range: '±4.26%',
            unit: 'ops/sec',
            extra: '84 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 11746,
            range: '±7.9%',
            unit: 'ops/sec',
            extra: '73 samples',
          },
        ],
      },
    ],
  },
}
