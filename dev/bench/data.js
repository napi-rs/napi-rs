window.BENCHMARK_DATA = {
  lastUpdate: 1616140319689,
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
          id: '69b8773350aed5fd58f91596197dc5aa3185583b',
          message:
            'Merge pull request #510 from napi-rs/fix-object-finalizer\n\nfix(napi): finalizer maybe_ref pointer value',
          timestamp: '2021-03-19T15:48:06+08:00',
          tree_id: '3ceac829c190651f6eedc4c6de8b3fe36899d0fa',
          url:
            'https://github.com/napi-rs/napi-rs/commit/69b8773350aed5fd58f91596197dc5aa3185583b',
        },
        date: 1616140317763,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 44980384,
            range: '±0.83%',
            unit: 'ops/sec',
            extra: '91 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 604632415,
            range: '±0.87%',
            unit: 'ops/sec',
            extra: '86 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 15121851,
            range: '±0.81%',
            unit: 'ops/sec',
            extra: '91 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 607319714,
            range: '±0.38%',
            unit: 'ops/sec',
            extra: '89 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 76304,
            range: '±28.22%',
            unit: 'ops/sec',
            extra: '71 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 68976,
            range: '±31.19%',
            unit: 'ops/sec',
            extra: '76 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 314179,
            range: '±43.71%',
            unit: 'ops/sec',
            extra: '64 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 348326,
            range: '±2.99%',
            unit: 'ops/sec',
            extra: '84 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 361870,
            range: '±3.25%',
            unit: 'ops/sec',
            extra: '80 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 299583,
            range: '±13.72%',
            unit: 'ops/sec',
            extra: '79 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 29601,
            range: '±2.59%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 12423,
            range: '±7.96%',
            unit: 'ops/sec',
            extra: '77 samples',
          },
        ],
      },
    ],
  },
}
