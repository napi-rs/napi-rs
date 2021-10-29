window.BENCHMARK_DATA = {
  lastUpdate: 1635514222232,
  repoUrl: 'https://github.com/napi-rs/napi-rs',
  entries: {
    Benchmark: [
      {
        commit: {
          author: {
            email: 'mail@joaomoreno.com',
            name: 'João Moreno',
            username: 'joaomoreno',
          },
          committer: {
            email: 'noreply@github.com',
            name: 'GitHub',
            username: 'web-flow',
          },
          distinct: true,
          id: '03125d44b85af23b032d902a89aa31d2a39eb9e6',
          message:
            'Make sure CI fails if `yarn test` fails (#818)\n\nmake sure CI fails if `yarn test` fails\r\n\r\nCo-authored-by: LongYinan <lynweklm@gmail.com>',
          timestamp: '2021-10-29T21:19:18+08:00',
          tree_id: '2ae076c61f613d81ff939a74d3ab292e533bd8c0',
          url: 'https://github.com/napi-rs/napi-rs/commit/03125d44b85af23b032d902a89aa31d2a39eb9e6',
        },
        date: 1635514220258,
        tool: 'benchmarkjs',
        benches: [
          {
            name: 'noop#napi-rs',
            value: 43095196,
            range: '±0.68%',
            unit: 'ops/sec',
            extra: '91 samples',
          },
          {
            name: 'noop#JavaScript',
            value: 557485251,
            range: '±0.85%',
            unit: 'ops/sec',
            extra: '91 samples',
          },
          {
            name: 'Plus number#napi-rs',
            value: 14050757,
            range: '±0.82%',
            unit: 'ops/sec',
            extra: '91 samples',
          },
          {
            name: 'Plus number#JavaScript',
            value: 556617234,
            range: '±1.09%',
            unit: 'ops/sec',
            extra: '92 samples',
          },
          {
            name: 'Create buffer#napi-rs',
            value: 293915,
            range: '±11.98%',
            unit: 'ops/sec',
            extra: '72 samples',
          },
          {
            name: 'Create buffer#JavaScript',
            value: 1537448,
            range: '±7.27%',
            unit: 'ops/sec',
            extra: '81 samples',
          },
          {
            name: 'createArray#createArrayJson',
            value: 27809,
            range: '±0.74%',
            unit: 'ops/sec',
            extra: '92 samples',
          },
          {
            name: 'createArray#create array for loop',
            value: 6273,
            range: '±0.49%',
            unit: 'ops/sec',
            extra: '91 samples',
          },
          {
            name: 'createArray#create array with serde trait',
            value: 6209,
            range: '±0.71%',
            unit: 'ops/sec',
            extra: '92 samples',
          },
          {
            name: 'getArrayFromJs#get array from json string',
            value: 13269,
            range: '±1.36%',
            unit: 'ops/sec',
            extra: '90 samples',
          },
          {
            name: 'getArrayFromJs#get array from serde',
            value: 7826,
            range: '±0.74%',
            unit: 'ops/sec',
            extra: '91 samples',
          },
          {
            name: 'getArrayFromJs#get array with for loop',
            value: 9263,
            range: '±1.1%',
            unit: 'ops/sec',
            extra: '88 samples',
          },
          {
            name: 'Get Set property#Get Set from native#u32',
            value: 333090,
            range: '±5.95%',
            unit: 'ops/sec',
            extra: '75 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#u32',
            value: 287470,
            range: '±5.64%',
            unit: 'ops/sec',
            extra: '78 samples',
          },
          {
            name: 'Get Set property#Get Set from native#string',
            value: 301589,
            range: '±5.44%',
            unit: 'ops/sec',
            extra: '78 samples',
          },
          {
            name: 'Get Set property#Get Set from JavaScript#string',
            value: 269427,
            range: '±5.54%',
            unit: 'ops/sec',
            extra: '80 samples',
          },
          {
            name: 'Async task#spawn task',
            value: 23174,
            range: '±3.31%',
            unit: 'ops/sec',
            extra: '71 samples',
          },
          {
            name: 'Async task#ThreadSafeFunction',
            value: 321,
            range: '±3.1%',
            unit: 'ops/sec',
            extra: '36 samples',
          },
          {
            name: 'Async task#Tokio future to Promise',
            value: 19633,
            range: '±1.8%',
            unit: 'ops/sec',
            extra: '79 samples',
          },
          {
            name: 'Query#query * 100',
            value: 1583,
            range: '±2.63%',
            unit: 'ops/sec',
            extra: '79 samples',
          },
          {
            name: 'Query#query * 1',
            value: 19244,
            range: '±2.25%',
            unit: 'ops/sec',
            extra: '82 samples',
          },
        ],
      },
    ],
  },
}
