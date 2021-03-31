window.BENCHMARK_DATA = {
  lastUpdate: 1617198547047,
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
          id: 'b8310e365237e6ab549fd7131d6f17e6b8a4fbe4',
          message:
            'Merge pull request #522 from napi-rs/tsfn-release-error\n\nfix(napi): do not call release tsfn in Drop when ref count is 0',
          timestamp: '2021-03-31T21:41:35+08:00',
          tree_id: '5dc3d31b26a31d5a80a58dd4e8f7b13c85cc0a8f',
          url:
            'https://github.com/napi-rs/napi-rs/commit/b8310e365237e6ab549fd7131d6f17e6b8a4fbe4',
        },
        date: 1617198545502,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 45926900,
            range: '±0.26%',
            unit: 'ops/sec',
            extra: '93 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 593452275,
            range: '±0.26%',
            unit: 'ops/sec',
            extra: '94 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 13844887,
            range: '±1.93%',
            unit: 'ops/sec',
            extra: '90 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 596469298,
            range: '±0.29%',
            unit: 'ops/sec',
            extra: '93 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 83630,
            range: '±35.03%',
            unit: 'ops/sec',
            extra: '76 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 72344,
            range: '±48.27%',
            unit: 'ops/sec',
            extra: '80 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 390612,
            range: '±3.6%',
            unit: 'ops/sec',
            extra: '83 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 344652,
            range: '±3.72%',
            unit: 'ops/sec',
            extra: '83 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 346625,
            range: '±3.51%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 315597,
            range: '±3.63%',
            unit: 'ops/sec',
            extra: '83 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 30455,
            range: '±2.29%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 1292,
            range: '±175.46%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
        ],
      },
    ],
  },
}
