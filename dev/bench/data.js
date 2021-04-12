window.BENCHMARK_DATA = {
  lastUpdate: 1618197986959,
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
          id: 'a3783e733f7f642d60447dc110c7d6afb18c3d8a',
          message:
            'Merge pull request #525 from napi-rs/debian-docker\n\nci: add debian docker image',
          timestamp: '2021-04-12T11:22:23+08:00',
          tree_id: 'c3497ac24c0b682b0ff2086bdd0bbf4eb35cf70f',
          url:
            'https://github.com/napi-rs/napi-rs/commit/a3783e733f7f642d60447dc110c7d6afb18c3d8a',
        },
        date: 1618197985659,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 51004918,
            range: '±1.67%',
            unit: 'ops/sec',
            extra: '87 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 854917490,
            range: '±1.29%',
            unit: 'ops/sec',
            extra: '88 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 20620611,
            range: '±1.11%',
            unit: 'ops/sec',
            extra: '88 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 848584143,
            range: '±1.38%',
            unit: 'ops/sec',
            extra: '87 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 91755,
            range: '±24.42%',
            unit: 'ops/sec',
            extra: '71 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 97942,
            range: '±19.63%',
            unit: 'ops/sec',
            extra: '79 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 454231,
            range: '±3.39%',
            unit: 'ops/sec',
            extra: '68 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 376917,
            range: '±3.14%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 401700,
            range: '±2.87%',
            unit: 'ops/sec',
            extra: '80 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 367332,
            range: '±3.07%',
            unit: 'ops/sec',
            extra: '82 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 30190,
            range: '±2.56%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 10982,
            range: '±13%',
            unit: 'ops/sec',
            extra: '79 samples',
          },
        ],
      },
    ],
  },
}
