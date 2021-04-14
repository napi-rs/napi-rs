window.BENCHMARK_DATA = {
  lastUpdate: 1618383756857,
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
          id: '72c222f71d4f9448d28a87b693d7fb047ac67967',
          message:
            'Merge pull request #533 from napi-rs/create-string-from-cstring\n\nfeat(napi): expose create_string_from_c_char for C ffi scenario',
          timestamp: '2021-04-14T14:55:40+08:00',
          tree_id: 'adfbf59872cce1a707b53b9ba35e677f4cfd9324',
          url:
            'https://github.com/napi-rs/napi-rs/commit/72c222f71d4f9448d28a87b693d7fb047ac67967',
        },
        date: 1618383754889,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 46229478,
            range: '±1.26%',
            unit: 'ops/sec',
            extra: '82 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 689657133,
            range: '±0.77%',
            unit: 'ops/sec',
            extra: '86 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 18880878,
            range: '±0.73%',
            unit: 'ops/sec',
            extra: '85 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 674153461,
            range: '±1.25%',
            unit: 'ops/sec',
            extra: '86 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 82280,
            range: '±24.27%',
            unit: 'ops/sec',
            extra: '70 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 84532,
            range: '±48.18%',
            unit: 'ops/sec',
            extra: '76 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 417426,
            range: '±2.9%',
            unit: 'ops/sec',
            extra: '77 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 359159,
            range: '±4.12%',
            unit: 'ops/sec',
            extra: '80 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 386967,
            range: '±2.57%',
            unit: 'ops/sec',
            extra: '82 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 353274,
            range: '±2.82%',
            unit: 'ops/sec',
            extra: '80 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 31721,
            range: '±2.16%',
            unit: 'ops/sec',
            extra: '73 samples',
          },
          {
            name: 'Async task#thread safe function',
            value: 10881,
            range: '±12.84%',
            unit: 'ops/sec',
            extra: '77 samples',
          },
        ],
      },
    ],
  },
}
