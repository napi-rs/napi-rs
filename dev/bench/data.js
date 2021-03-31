window.BENCHMARK_DATA = {
  lastUpdate: 1617179949839,
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
          id: '3e239f69b286cfb6a972b3585198a4ef71774b9c',
          message:
            'Merge pull request #520 from napi-rs/fix-clippy\n\nstyle: fix clippy error',
          timestamp: '2021-03-31T16:35:10+08:00',
          tree_id: '95eda9858b3e53c176553c6b73f114e184164df9',
          url:
            'https://github.com/napi-rs/napi-rs/commit/3e239f69b286cfb6a972b3585198a4ef71774b9c',
        },
        date: 1617179948004,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 45790832,
            range: '±0.22%',
            unit: 'ops/sec',
            extra: '95 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 596015627,
            range: '±0.19%',
            unit: 'ops/sec',
            extra: '93 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 14127359,
            range: '±0.37%',
            unit: 'ops/sec',
            extra: '95 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 594247092,
            range: '±0.17%',
            unit: 'ops/sec',
            extra: '93 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 86815,
            range: '±22.82%',
            unit: 'ops/sec',
            extra: '70 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 42124,
            range: '±55.42%',
            unit: 'ops/sec',
            extra: '49 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 402718,
            range: '±2.95%',
            unit: 'ops/sec',
            extra: '84 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 366709,
            range: '±2.83%',
            unit: 'ops/sec',
            extra: '86 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 371654,
            range: '±2.79%',
            unit: 'ops/sec',
            extra: '85 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 328091,
            range: '±6.79%',
            unit: 'ops/sec',
            extra: '75 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 29695,
            range: '±2.63%',
            unit: 'ops/sec',
            extra: '82 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 1304,
            range: '±172.75%',
            unit: 'ops/sec',
            extra: '74 samples',
          },
        ],
      },
    ],
  },
}
