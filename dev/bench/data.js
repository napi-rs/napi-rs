window.BENCHMARK_DATA = {
  "lastUpdate": 1651032608091,
  "repoUrl": "https://github.com/napi-rs/napi-rs",
  "entries": {
    "Benchmark": [
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "ae45d335f8e4a4b73845595f188b5a8be42982b7",
          "message": "Merge pull request #1113 from napi-rs/upgrade-ci-config\n\nci: upgrade configuration",
          "timestamp": "2022-04-01T14:47:17+08:00",
          "tree_id": "2c01aa69535a5349c33a0f8052df8dcbb20ad970",
          "url": "https://github.com/napi-rs/napi-rs/commit/ae45d335f8e4a4b73845595f188b5a8be42982b7"
        },
        "date": 1648796049021,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 61223218,
            "range": "±1.58%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 810503885,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20807811,
            "range": "±1.52%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 755610355,
            "range": "±1.52%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 369798,
            "range": "±9.49%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1779468,
            "range": "±3.27%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42650,
            "range": "±1.22%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8019,
            "range": "±1.25%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7452,
            "range": "±0.47%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16867,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10163,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12231,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 391356,
            "range": "±5.51%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 341281,
            "range": "±5.34%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 343115,
            "range": "±5.11%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 310836,
            "range": "±5.7%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 32212,
            "range": "±3.88%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 363,
            "range": "±3.04%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 26819,
            "range": "±3.64%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2023,
            "range": "±3.11%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 25169,
            "range": "±5.47%",
            "unit": "ops/sec",
            "extra": "72 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "0009379f3138d4adc9f7275b75e8e83448a0864f",
          "message": "chore: publish\n\n - @napi-rs/cli@2.5.0",
          "timestamp": "2022-04-01T14:50:23+08:00",
          "tree_id": "52d63210f214c0cdee02ec59585788db535a81ad",
          "url": "https://github.com/napi-rs/napi-rs/commit/0009379f3138d4adc9f7275b75e8e83448a0864f"
        },
        "date": 1648796479950,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 49689837,
            "range": "±1.81%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 813766281,
            "range": "±1.05%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 17445595,
            "range": "±1.71%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 818334034,
            "range": "±1.17%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 309295,
            "range": "±10.13%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1530136,
            "range": "±7.32%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37029,
            "range": "±1.16%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6748,
            "range": "±0.79%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6660,
            "range": "±0.98%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15633,
            "range": "±0.96%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8983,
            "range": "±0.83%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 11266,
            "range": "±1.13%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 341606,
            "range": "±5.69%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 325185,
            "range": "±5.54%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 322666,
            "range": "±5.78%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 287801,
            "range": "±6.33%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 32667,
            "range": "±2.72%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 405,
            "range": "±4.28%",
            "unit": "ops/sec",
            "extra": "64 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24232,
            "range": "±2.08%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1783,
            "range": "±3.2%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22759,
            "range": "±2.51%",
            "unit": "ops/sec",
            "extra": "78 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "a88bc57ea302e674596831015a768649b45db81e",
          "message": "chore: publish\n\n - @napi-rs/cli@2.6.0",
          "timestamp": "2022-04-01T14:51:38+08:00",
          "tree_id": "bfa765ee586cff5a6306486b9e3f8f9343dbb683",
          "url": "https://github.com/napi-rs/napi-rs/commit/a88bc57ea302e674596831015a768649b45db81e"
        },
        "date": 1648796553305,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 47478078,
            "range": "±1.95%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 815057180,
            "range": "±0.92%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16850139,
            "range": "±1.65%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 793494738,
            "range": "±1.24%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 301822,
            "range": "±10.68%",
            "unit": "ops/sec",
            "extra": "58 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1401444,
            "range": "±4.15%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 35881,
            "range": "±1.42%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6657,
            "range": "±1.09%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6613,
            "range": "±1.12%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14543,
            "range": "±1.57%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8094,
            "range": "±1.25%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10108,
            "range": "±1.44%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 343450,
            "range": "±5.4%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 311129,
            "range": "±5.22%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 339305,
            "range": "±4.77%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 321413,
            "range": "±5.15%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36984,
            "range": "±2.71%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 399,
            "range": "±3.65%",
            "unit": "ops/sec",
            "extra": "62 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 23809,
            "range": "±3.13%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1876,
            "range": "±2.71%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22442,
            "range": "±2.69%",
            "unit": "ops/sec",
            "extra": "77 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "83712d7312eb99e2f6483d5da9a8f010c994fe20",
          "message": "Merge pull request #1115 from napi-rs/fix-cargo-name-restrict\n\nfix(cli): should not throw if cargoName is provided but no package.name",
          "timestamp": "2022-04-01T17:19:11+08:00",
          "tree_id": "26bd59b4f47d99e8ac5ffeb1634944f61930383e",
          "url": "https://github.com/napi-rs/napi-rs/commit/83712d7312eb99e2f6483d5da9a8f010c994fe20"
        },
        "date": 1648805004425,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 44312755,
            "range": "±1.99%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 883050869,
            "range": "±1.37%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19181691,
            "range": "±1.85%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 879317422,
            "range": "±1.5%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 341994,
            "range": "±10.83%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1553643,
            "range": "±4.42%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36055,
            "range": "±1.21%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6154,
            "range": "±1.07%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6418,
            "range": "±0.81%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15290,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8960,
            "range": "±0.98%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 11044,
            "range": "±1.27%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 394664,
            "range": "±5.96%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 325024,
            "range": "±5.54%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 346909,
            "range": "±5.38%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 323106,
            "range": "±5.69%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 33071,
            "range": "±4.13%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 406,
            "range": "±7.01%",
            "unit": "ops/sec",
            "extra": "59 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24732,
            "range": "±2.83%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1837,
            "range": "±2.16%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 23552,
            "range": "±2.08%",
            "unit": "ops/sec",
            "extra": "78 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "dc87c4632227c6fc30a4c8d71b73980f1f7caaf8",
          "message": "chore: publish\n\n - @napi-rs/cli@2.6.1",
          "timestamp": "2022-04-01T17:20:00+08:00",
          "tree_id": "10c50e9485336d5598893f969817b03d9c846f82",
          "url": "https://github.com/napi-rs/napi-rs/commit/dc87c4632227c6fc30a4c8d71b73980f1f7caaf8"
        },
        "date": 1648805286454,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55307468,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713024788,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 17847694,
            "range": "±1%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 711127959,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 373328,
            "range": "±8.2%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1924014,
            "range": "±5.92%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38907,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7614,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7583,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16980,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10164,
            "range": "±0.02%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12278,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 403809,
            "range": "±4.88%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 362904,
            "range": "±4.72%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 350144,
            "range": "±4.71%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 326399,
            "range": "±4.88%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 39050,
            "range": "±1.18%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 415,
            "range": "±2.39%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29197,
            "range": "±1.1%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2158,
            "range": "±2.18%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 28928,
            "range": "±2.56%",
            "unit": "ops/sec",
            "extra": "84 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "1535e721509b98c50654bd0bac81d6e0282217d2",
          "message": "chore: publish\n\n - @napi-rs/cli@2.6.2",
          "timestamp": "2022-04-02T02:34:10+08:00",
          "tree_id": "183fc88f2697fe3b0727105421beb21db46bd2b9",
          "url": "https://github.com/napi-rs/napi-rs/commit/1535e721509b98c50654bd0bac81d6e0282217d2"
        },
        "date": 1648838859460,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 46854810,
            "range": "±0.61%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 603208655,
            "range": "±0.53%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16392679,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 599021601,
            "range": "±0.38%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 323208,
            "range": "±10.46%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1571913,
            "range": "±6.21%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 33471,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6607,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6558,
            "range": "±0.43%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14594,
            "range": "±0.39%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8612,
            "range": "±0.33%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10397,
            "range": "±1.24%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 355625,
            "range": "±5.24%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 325751,
            "range": "±5.21%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 310234,
            "range": "±5.15%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 294365,
            "range": "±5.29%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 30439,
            "range": "±1.27%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 355,
            "range": "±3.73%",
            "unit": "ops/sec",
            "extra": "50 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24466,
            "range": "±1.35%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1944,
            "range": "±0.42%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 24278,
            "range": "±2.63%",
            "unit": "ops/sec",
            "extra": "84 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "5994ef1b9519e2146851e5cdb38087d3a8d04c5b",
          "message": "Merge pull request #1130 from napi-rs/fix-rust-1.57\n\nfix(napi): remove CString::from_vec_with_nul_unchecked",
          "timestamp": "2022-04-13T11:27:09+08:00",
          "tree_id": "4f76837c26f195bcf2b16575ec69e0b9b763dd13",
          "url": "https://github.com/napi-rs/napi-rs/commit/5994ef1b9519e2146851e5cdb38087d3a8d04c5b"
        },
        "date": 1649820926042,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 59428638,
            "range": "±0.42%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 592565127,
            "range": "±0.18%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20977855,
            "range": "±0.22%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 591329293,
            "range": "±0.4%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 405103,
            "range": "±7.44%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2124069,
            "range": "±1.26%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 43788,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8074,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8024,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17710,
            "range": "±0.62%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10922,
            "range": "±0.18%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12823,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 382168,
            "range": "±4.33%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 327679,
            "range": "±4.13%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 354598,
            "range": "±4.04%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 311926,
            "range": "±4.44%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36007,
            "range": "±0.98%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 403,
            "range": "±3.6%",
            "unit": "ops/sec",
            "extra": "64 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30199,
            "range": "±0.48%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2259,
            "range": "±1.76%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30719,
            "range": "±1.72%",
            "unit": "ops/sec",
            "extra": "88 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "c605911cdf559ccea541de4c9b5de87caa2424d8",
          "message": "chore(napi): show tips if create different buffers with same data",
          "timestamp": "2022-04-13T13:24:53+08:00",
          "tree_id": "03de9c1e9f347ca2f7d761ec1d869b2db2b0e84f",
          "url": "https://github.com/napi-rs/napi-rs/commit/c605911cdf559ccea541de4c9b5de87caa2424d8"
        },
        "date": 1649827888952,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 59820702,
            "range": "±0.44%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 592251521,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20861152,
            "range": "±0.76%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 591703560,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 411960,
            "range": "±6.49%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2163668,
            "range": "±1.71%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 43953,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7839,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7760,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 18054,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10727,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12469,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 382606,
            "range": "±3.92%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 326314,
            "range": "±3.92%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 360110,
            "range": "±3.94%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 312247,
            "range": "±3.97%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37502,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 461,
            "range": "±3.69%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30960,
            "range": "±1.6%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2314,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31779,
            "range": "±1.63%",
            "unit": "ops/sec",
            "extra": "79 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "waltonseymour@users.noreply.github.com",
            "name": "Walt Seymour",
            "username": "waltonseymour"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "73882337cc1076b6cb70d8d8180f1891a9c639b4",
          "message": "unrwap -> unwrap",
          "timestamp": "2022-04-14T14:24:32+08:00",
          "tree_id": "43b5153b5bfc4992e074b7173516b46c2cbfe209",
          "url": "https://github.com/napi-rs/napi-rs/commit/73882337cc1076b6cb70d8d8180f1891a9c639b4"
        },
        "date": 1649917695439,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 60214539,
            "range": "±0.38%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 591707539,
            "range": "±0.29%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 21072185,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 590969696,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 414406,
            "range": "±7.22%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2175737,
            "range": "±1.26%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 44368,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7950,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7853,
            "range": "±0.22%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 18096,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10805,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12703,
            "range": "±0.37%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 381699,
            "range": "±4.23%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 328717,
            "range": "±4.1%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 364273,
            "range": "±3.97%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 316551,
            "range": "±4.22%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37005,
            "range": "±1.12%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 396,
            "range": "±3.7%",
            "unit": "ops/sec",
            "extra": "62 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31429,
            "range": "±0.52%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2287,
            "range": "±1.69%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31764,
            "range": "±1.71%",
            "unit": "ops/sec",
            "extra": "83 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "cd9bb0c5d6cff78addaf3f5ca3f302e83dc5a84f",
          "message": "docs: add return Promise callback function\n\nFix https://github.com/napi-rs/napi-rs/issues/1128",
          "timestamp": "2022-04-14T14:24:47+08:00",
          "tree_id": "12cadf57b2d6c9fefd48cbe918bb19e6017e22d8",
          "url": "https://github.com/napi-rs/napi-rs/commit/cd9bb0c5d6cff78addaf3f5ca3f302e83dc5a84f"
        },
        "date": 1649918019191,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 54919043,
            "range": "±0.3%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 711305773,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19133868,
            "range": "±0.95%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 706420256,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 289112,
            "range": "±12.42%",
            "unit": "ops/sec",
            "extra": "54 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1517005,
            "range": "±4.57%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37427,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7570,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7497,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16801,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10301,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12139,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 375592,
            "range": "±6.18%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 332896,
            "range": "±6.3%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 324334,
            "range": "±5.95%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 313196,
            "range": "±6.34%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38436,
            "range": "±1.21%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 409,
            "range": "±3.06%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29994,
            "range": "±0.51%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2116,
            "range": "±2.2%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 29828,
            "range": "±1.39%",
            "unit": "ops/sec",
            "extra": "81 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "ce308a3b54fc0f2343e168226d67a14b6e435696",
          "message": "Release independent packages\n\nnapi@2.3.0\nnapi-derive@2.3.0",
          "timestamp": "2022-04-14T17:27:21+08:00",
          "tree_id": "b7524010f043fd0dc914d157398f330b277e903d",
          "url": "https://github.com/napi-rs/napi-rs/commit/ce308a3b54fc0f2343e168226d67a14b6e435696"
        },
        "date": 1649928745893,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 48135787,
            "range": "±1.6%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 798478470,
            "range": "±1.24%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16009236,
            "range": "±1.76%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 765045459,
            "range": "±1.51%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 313114,
            "range": "±9.28%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1684922,
            "range": "±7.12%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36015,
            "range": "±1.17%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6333,
            "range": "±1.12%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6288,
            "range": "±1.5%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15033,
            "range": "±1.27%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8458,
            "range": "±1.39%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 11053,
            "range": "±1.39%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 378656,
            "range": "±5.11%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 316974,
            "range": "±5.2%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 344734,
            "range": "±4.69%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 309239,
            "range": "±5.11%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 32897,
            "range": "±2.32%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 395,
            "range": "±3.47%",
            "unit": "ops/sec",
            "extra": "59 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 23839,
            "range": "±3%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1816,
            "range": "±2.15%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22002,
            "range": "±2.41%",
            "unit": "ops/sec",
            "extra": "78 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "ucs3721@outlook.com",
            "name": "Chanakya",
            "username": "U-C-S"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "09d7fd671acd534aeaf556784952e6dee25a8316",
          "message": "fix `cannot find trait ToNapiValue` error",
          "timestamp": "2022-04-15T21:02:40+08:00",
          "tree_id": "10e952bf12883fb072dcf7572f6ccdd038bf9a07",
          "url": "https://github.com/napi-rs/napi-rs/commit/09d7fd671acd534aeaf556784952e6dee25a8316"
        },
        "date": 1650027985379,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55481023,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713570183,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19272885,
            "range": "±0.76%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710968424,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 373509,
            "range": "±8.42%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1949767,
            "range": "±2.45%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 39567,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7589,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7582,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17121,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10422,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12290,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 403219,
            "range": "±5.31%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 350574,
            "range": "±5.07%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 355996,
            "range": "±4.8%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 328445,
            "range": "±5.11%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38189,
            "range": "±1.15%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 425,
            "range": "±3.28%",
            "unit": "ops/sec",
            "extra": "54 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30242,
            "range": "±0.42%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2150,
            "range": "±1.89%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30980,
            "range": "±0.45%",
            "unit": "ops/sec",
            "extra": "85 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "9c5558888995913efe9b7cf7f288eadefdc6d9c2",
          "message": "ci: more effective cache config",
          "timestamp": "2022-04-15T21:40:20+08:00",
          "tree_id": "d6dc3caf5ee1a18e4ea8a26787cf3c687d834c81",
          "url": "https://github.com/napi-rs/napi-rs/commit/9c5558888995913efe9b7cf7f288eadefdc6d9c2"
        },
        "date": 1650030579865,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 47494109,
            "range": "±0.63%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 767486589,
            "range": "±0.66%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 17341938,
            "range": "±0.94%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 758705973,
            "range": "±1.04%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 315603,
            "range": "±10.41%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1751446,
            "range": "±6.79%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 34057,
            "range": "±0.88%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 5974,
            "range": "±0.74%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 5983,
            "range": "±0.68%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13798,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 7912,
            "range": "±0.61%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9996,
            "range": "±0.73%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 355566,
            "range": "±4.94%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 299168,
            "range": "±4.64%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 330614,
            "range": "±4.93%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 281926,
            "range": "±5.08%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 32748,
            "range": "±2.2%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 419,
            "range": "±2.95%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 23359,
            "range": "±1.74%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1715,
            "range": "±4.29%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 19889,
            "range": "±3.24%",
            "unit": "ops/sec",
            "extra": "77 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "e81e3dbb2ea2c8cbbb88eb840abd8a9d56913f67",
          "message": "Release independent packages\n\nnapi@2.3.1",
          "timestamp": "2022-04-15T21:41:14+08:00",
          "tree_id": "30677a1d2d6e1225f98751f7544b105df0f46840",
          "url": "https://github.com/napi-rs/napi-rs/commit/e81e3dbb2ea2c8cbbb88eb840abd8a9d56913f67"
        },
        "date": 1650030681409,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 49602736,
            "range": "±0.82%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 628059726,
            "range": "±0.71%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16861833,
            "range": "±1.46%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 608856645,
            "range": "±0.52%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 323388,
            "range": "±9.08%",
            "unit": "ops/sec",
            "extra": "60 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1626112,
            "range": "±3.49%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 32685,
            "range": "±0.38%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6500,
            "range": "±0.44%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6478,
            "range": "±0.34%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14969,
            "range": "±0.48%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 9356,
            "range": "±0.63%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10758,
            "range": "±0.65%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 374002,
            "range": "±5.39%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 330991,
            "range": "±4.95%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 330172,
            "range": "±5.09%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 302122,
            "range": "±5.19%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 30432,
            "range": "±0.74%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 391,
            "range": "±2.65%",
            "unit": "ops/sec",
            "extra": "64 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24862,
            "range": "±1.73%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1939,
            "range": "±1.96%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 25762,
            "range": "±1.78%",
            "unit": "ops/sec",
            "extra": "85 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "e785e31e19b779a99ddd4c4a45ac4ed801f3d107",
          "message": "build: install alpine build-base on stable channel",
          "timestamp": "2022-04-17T22:21:13+08:00",
          "tree_id": "aaa3df8029b6f63d3c968aefe03261e8f6285491",
          "url": "https://github.com/napi-rs/napi-rs/commit/e785e31e19b779a99ddd4c4a45ac4ed801f3d107"
        },
        "date": 1650205528190,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55306171,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712696618,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19593751,
            "range": "±0.72%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 712638048,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 367816,
            "range": "±9.12%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1815961,
            "range": "±6.1%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38750,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7609,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7642,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17269,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10404,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12009,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 402347,
            "range": "±5.47%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 346858,
            "range": "±5.44%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 351823,
            "range": "±5.17%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 326654,
            "range": "±5.31%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37917,
            "range": "±1.17%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 408,
            "range": "±3.42%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29972,
            "range": "±0.63%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2182,
            "range": "±2.07%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30469,
            "range": "±2.17%",
            "unit": "ops/sec",
            "extra": "84 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "8cb6708be7937143088a99ddaf25fff07d78212b",
          "message": "build: do not upgrade system components in alpine",
          "timestamp": "2022-04-17T23:40:37+08:00",
          "tree_id": "cf99d3fbc4cdad10abbfe9d5c3690cba8f5d107c",
          "url": "https://github.com/napi-rs/napi-rs/commit/8cb6708be7937143088a99ddaf25fff07d78212b"
        },
        "date": 1650210354663,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 46190738,
            "range": "±0.39%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 599705027,
            "range": "±0.38%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16249756,
            "range": "±0.9%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 593111630,
            "range": "±0.41%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 320061,
            "range": "±9.67%",
            "unit": "ops/sec",
            "extra": "59 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1592882,
            "range": "±4.53%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 33235,
            "range": "±0.39%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6573,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6518,
            "range": "±0.29%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14683,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8922,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10272,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 345439,
            "range": "±5.46%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 298114,
            "range": "±5.45%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 292732,
            "range": "±5%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 268078,
            "range": "±5.08%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 29315,
            "range": "±1.04%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 383,
            "range": "±3.18%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24201,
            "range": "±1.57%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1867,
            "range": "±1.93%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 24481,
            "range": "±1.86%",
            "unit": "ops/sec",
            "extra": "76 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "4f422b6625daaddf75bb422331e0b80c14c9b901",
          "message": "build: tweak alpine image",
          "timestamp": "2022-04-18T12:19:48+08:00",
          "tree_id": "97050cdcf06cf8c020a98d0f659e4af820961459",
          "url": "https://github.com/napi-rs/napi-rs/commit/4f422b6625daaddf75bb422331e0b80c14c9b901"
        },
        "date": 1650258093812,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 45555215,
            "range": "±0.52%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 588189080,
            "range": "±0.61%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15937518,
            "range": "±0.77%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 596617651,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 301022,
            "range": "±8.93%",
            "unit": "ops/sec",
            "extra": "59 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1482081,
            "range": "±5.78%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 32573,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6438,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6435,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14481,
            "range": "±0.33%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8740,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9965,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 355753,
            "range": "±5.03%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 301737,
            "range": "±5.04%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 299470,
            "range": "±5.04%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 276988,
            "range": "±5.05%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 27802,
            "range": "±2.11%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 381,
            "range": "±2.75%",
            "unit": "ops/sec",
            "extra": "50 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24459,
            "range": "±1.79%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1808,
            "range": "±1.48%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22935,
            "range": "±3.19%",
            "unit": "ops/sec",
            "extra": "78 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "gabrinelson27@gmail.com",
            "name": "Gabriel Francisco",
            "username": "ceifa"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "c39060984d4cae560da7c1a7994ba6c1e33fa101",
          "message": "feat(cli): add build option to not include the header in dts file (#1140)\n\n* Add build option to not include the header in dts file\r\n\r\n* Fix lint",
          "timestamp": "2022-04-22T16:52:43+08:00",
          "tree_id": "84c296f1b0b0a198259ae06f1e5c079e7cc19f76",
          "url": "https://github.com/napi-rs/napi-rs/commit/c39060984d4cae560da7c1a7994ba6c1e33fa101"
        },
        "date": 1650617986506,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 43986262,
            "range": "±0.93%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 566649115,
            "range": "±1%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15445419,
            "range": "±0.72%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 572481919,
            "range": "±0.64%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 314621,
            "range": "±9.66%",
            "unit": "ops/sec",
            "extra": "60 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1691373,
            "range": "±6.12%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 31841,
            "range": "±1.04%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6077,
            "range": "±0.96%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 5962,
            "range": "±1.72%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13877,
            "range": "±1.04%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8224,
            "range": "±0.56%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9731,
            "range": "±1.06%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 340980,
            "range": "±5.07%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 304446,
            "range": "±5.1%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 306923,
            "range": "±5.21%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 270527,
            "range": "±4.92%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 26396,
            "range": "±2.62%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 371,
            "range": "±2.91%",
            "unit": "ops/sec",
            "extra": "56 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 22355,
            "range": "±2.2%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1676,
            "range": "±2.54%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22399,
            "range": "±1.97%",
            "unit": "ops/sec",
            "extra": "80 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "gabrinelson27@gmail.com",
            "name": "Gabriel Francisco",
            "username": "ceifa"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "d56c9c56a8f145f4d4b2a76d1fd4e0d2d522a312",
          "message": "fix(napi-derive): simplify the optional values in generated declaration file (#1141)",
          "timestamp": "2022-04-22T16:53:27+08:00",
          "tree_id": "a80383b61d9dab99d1c3ae92f701cf7661c1e797",
          "url": "https://github.com/napi-rs/napi-rs/commit/d56c9c56a8f145f4d4b2a76d1fd4e0d2d522a312"
        },
        "date": 1650640675053,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 39222003,
            "range": "±1.79%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 615201248,
            "range": "±1.9%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 14063562,
            "range": "±2.23%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 658539197,
            "range": "±2.1%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 261025,
            "range": "±8.35%",
            "unit": "ops/sec",
            "extra": "57 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1233267,
            "range": "±9.05%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 28480,
            "range": "±2.47%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 5147,
            "range": "±2.01%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 4837,
            "range": "±2.17%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 11317,
            "range": "±2.45%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 6592,
            "range": "±2.49%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 8203,
            "range": "±1.84%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 281536,
            "range": "±6.01%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 260240,
            "range": "±6.06%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 267206,
            "range": "±6.59%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 234598,
            "range": "±6.48%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 16082,
            "range": "±4.83%",
            "unit": "ops/sec",
            "extra": "54 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 332,
            "range": "±2.11%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 12686,
            "range": "±4.98%",
            "unit": "ops/sec",
            "extra": "64 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1313,
            "range": "±1.72%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 10179,
            "range": "±5.25%",
            "unit": "ops/sec",
            "extra": "64 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "454d3b8cab7d90012abdb030fe857708cfba3114",
          "message": "chore: build node 18 linux arm image",
          "timestamp": "2022-04-22T23:16:06+08:00",
          "tree_id": "3170c6e793b958f32e0e41d2d042baf257a64a92",
          "url": "https://github.com/napi-rs/napi-rs/commit/454d3b8cab7d90012abdb030fe857708cfba3114"
        },
        "date": 1650640946285,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55326300,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712213656,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19294379,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 709819746,
            "range": "±0.22%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 353613,
            "range": "±9.67%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1724712,
            "range": "±3.73%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 39420,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7558,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7511,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17129,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10121,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12177,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 392070,
            "range": "±5.98%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 344852,
            "range": "±5.98%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 341364,
            "range": "±5.69%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 310152,
            "range": "±6.07%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38918,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 423,
            "range": "±2.73%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29418,
            "range": "±2.04%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2134,
            "range": "±2.17%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30130,
            "range": "±2.18%",
            "unit": "ops/sec",
            "extra": "86 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "gabrinelson27@gmail.com",
            "name": "Gabriel Francisco",
            "username": "ceifa"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "581e3bbb8775013fad49d78645229482429f2062",
          "message": "chore(napi): add u64 to BigInt conversion through From trait (#1143)\n\n* Add u64 to BigInt conversion through From trait\r\n\r\n* Fix lint",
          "timestamp": "2022-04-23T00:29:18+08:00",
          "tree_id": "113095a8a003c2574db95ce9c2494c18bdfb3492",
          "url": "https://github.com/napi-rs/napi-rs/commit/581e3bbb8775013fad49d78645229482429f2062"
        },
        "date": 1650645371802,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55369939,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712940048,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19387472,
            "range": "±1.39%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 804805444,
            "range": "±0.76%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 376467,
            "range": "±8.48%",
            "unit": "ops/sec",
            "extra": "64 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1934921,
            "range": "±3.75%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 39764,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7574,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7517,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17262,
            "range": "±0.38%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10162,
            "range": "±0.02%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12142,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 413488,
            "range": "±5.17%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 360188,
            "range": "±5%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 350362,
            "range": "±4.72%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 331658,
            "range": "±4.93%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36010,
            "range": "±3.69%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 441,
            "range": "±3.48%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29352,
            "range": "±0.78%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2170,
            "range": "±2.03%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30061,
            "range": "±0.61%",
            "unit": "ops/sec",
            "extra": "83 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "eee42e92e7e5bbe43ed95ddbe402e484c32713a7",
          "message": "Merge pull request #1144 from mischnic/empty-buffer",
          "timestamp": "2022-04-23T20:33:28+08:00",
          "tree_id": "9e305c723e0e5846d365ac2cc994096bbb3987ad",
          "url": "https://github.com/napi-rs/napi-rs/commit/eee42e92e7e5bbe43ed95ddbe402e484c32713a7"
        },
        "date": 1650717568051,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 42042854,
            "range": "±1.51%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 540532644,
            "range": "±1.49%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 14351108,
            "range": "±1.58%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 526976615,
            "range": "±1.42%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 282790,
            "range": "±6.69%",
            "unit": "ops/sec",
            "extra": "56 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1403505,
            "range": "±4.52%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 30270,
            "range": "±1.45%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 5623,
            "range": "±1.65%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 5736,
            "range": "±1.32%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 12999,
            "range": "±1.46%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 7713,
            "range": "±1.64%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9276,
            "range": "±1.42%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 322762,
            "range": "±6.17%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 274426,
            "range": "±6.89%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 277528,
            "range": "±6.18%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 259367,
            "range": "±5.78%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 21469,
            "range": "±5.51%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 311,
            "range": "±5.31%",
            "unit": "ops/sec",
            "extra": "59 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 18323,
            "range": "±4.3%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1502,
            "range": "±3.66%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 18203,
            "range": "±2.88%",
            "unit": "ops/sec",
            "extra": "72 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "a41cc07f215d881a5178e998a12e8d3832ad885c",
          "message": "Release independent packages\n\nnapi@2.3.2\nnapi-derive@2.3.1",
          "timestamp": "2022-04-25T16:09:57+08:00",
          "tree_id": "a677a13d9cd564bcec559dc1b95f262dd4dafc27",
          "url": "https://github.com/napi-rs/napi-rs/commit/a41cc07f215d881a5178e998a12e8d3832ad885c"
        },
        "date": 1650874778637,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 54931280,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 714874979,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18834404,
            "range": "±0.86%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 711065972,
            "range": "±0.3%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 362093,
            "range": "±8.87%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1790107,
            "range": "±4.63%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38563,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7217,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7562,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17049,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10265,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12034,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 410393,
            "range": "±5.13%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 352304,
            "range": "±4.87%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 358201,
            "range": "±4.69%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 324419,
            "range": "±5.29%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 39170,
            "range": "±1.58%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 436,
            "range": "±2.71%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30437,
            "range": "±1.73%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2236,
            "range": "±2%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31246,
            "range": "±0.39%",
            "unit": "ops/sec",
            "extra": "86 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "5aa61c214255cc49eb4f5b1cadc02dd15a946b89",
          "message": "fix(napi): use create_buffer/arrary_buffer if provided data is empty",
          "timestamp": "2022-04-26T16:53:13+08:00",
          "tree_id": "60ba9cbbc136d018104e84f4c7ee6e341ffd03fb",
          "url": "https://github.com/napi-rs/napi-rs/commit/5aa61c214255cc49eb4f5b1cadc02dd15a946b89"
        },
        "date": 1650963598409,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55267266,
            "range": "±0.34%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 714208261,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19394811,
            "range": "±0.76%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 712055404,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 365914,
            "range": "±8.76%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1785058,
            "range": "±6.93%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38809,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7629,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7599,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15926,
            "range": "±0.39%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10229,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12246,
            "range": "±0.06%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 407880,
            "range": "±4.98%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 351146,
            "range": "±5.03%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 351021,
            "range": "±4.93%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 333374,
            "range": "±4.98%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36952,
            "range": "±2.34%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 432,
            "range": "±2.71%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29696,
            "range": "±1.85%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2201,
            "range": "±1.93%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30496,
            "range": "±0.49%",
            "unit": "ops/sec",
            "extra": "85 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "cc79c9794ebe202837ea847d598c4c1af6320b76",
          "message": "fix(napi-derive): should transform struct case on Impl",
          "timestamp": "2022-04-26T18:04:14+08:00",
          "tree_id": "01fd178cfdc948fc371d05f1371d779cdae29c34",
          "url": "https://github.com/napi-rs/napi-rs/commit/cc79c9794ebe202837ea847d598c4c1af6320b76"
        },
        "date": 1650967707831,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 47986561,
            "range": "±0.91%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 635707657,
            "range": "±0.75%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16925142,
            "range": "±1.58%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 613395202,
            "range": "±0.95%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 345126,
            "range": "±9.89%",
            "unit": "ops/sec",
            "extra": "59 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1628891,
            "range": "±6.29%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 34777,
            "range": "±1.02%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6968,
            "range": "±0.75%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6918,
            "range": "±0.92%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15803,
            "range": "±0.84%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 9462,
            "range": "±0.98%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10870,
            "range": "±0.92%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 368267,
            "range": "±5.28%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 311388,
            "range": "±5.51%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 320498,
            "range": "±4.95%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 289116,
            "range": "±4.98%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 27943,
            "range": "±2.26%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 390,
            "range": "±3%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24753,
            "range": "±1.85%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1938,
            "range": "±0.86%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 24058,
            "range": "±2.99%",
            "unit": "ops/sec",
            "extra": "84 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "8ae06dccc883657909637e158781d6d2d64b784f",
          "message": "Merge pull request #1149 from napi-rs/multi-impl-typedef\n\nfix(cli): generated type def on multi impl blocks",
          "timestamp": "2022-04-26T18:21:35+08:00",
          "tree_id": "6a661793f3051420873f043d327c15fdb3eec52b",
          "url": "https://github.com/napi-rs/napi-rs/commit/8ae06dccc883657909637e158781d6d2d64b784f"
        },
        "date": 1650968907836,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 45334533,
            "range": "±0.73%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 590404789,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15979707,
            "range": "±0.88%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 585823701,
            "range": "±0.33%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 313179,
            "range": "±10.64%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1437131,
            "range": "±8.82%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 32449,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6349,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6336,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14053,
            "range": "±0.67%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8572,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10170,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 342720,
            "range": "±5.32%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 303357,
            "range": "±5.51%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 304873,
            "range": "±5.48%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 283505,
            "range": "±5.15%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 25917,
            "range": "±3.33%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 341,
            "range": "±2.75%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 21097,
            "range": "±3.17%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1757,
            "range": "±2.06%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 23041,
            "range": "±2.41%",
            "unit": "ops/sec",
            "extra": "83 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "2c775082cd5507d53fa5accbe024dd96b1b3e7f7",
          "message": "Merge pull request #1150 from napi-rs/into-reference\n\nfeat(napi): support return Reference on class instance",
          "timestamp": "2022-04-26T21:33:59+08:00",
          "tree_id": "0b85e4ba29c55dd389c41e267918baca5a7ea28b",
          "url": "https://github.com/napi-rs/napi-rs/commit/2c775082cd5507d53fa5accbe024dd96b1b3e7f7"
        },
        "date": 1650980288585,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55216047,
            "range": "±0.41%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 711649932,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19486035,
            "range": "±0.69%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710936111,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 353400,
            "range": "±9.51%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1645366,
            "range": "±4.7%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38565,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7645,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7578,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16927,
            "range": "±0.44%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10258,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12019,
            "range": "±0.55%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 396093,
            "range": "±5.64%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 352584,
            "range": "±5.31%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 344679,
            "range": "±5.28%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 328298,
            "range": "±5.28%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38107,
            "range": "±1.25%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 433,
            "range": "±3.23%",
            "unit": "ops/sec",
            "extra": "46 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29709,
            "range": "±0.44%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2192,
            "range": "±2.01%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30155,
            "range": "±0.38%",
            "unit": "ops/sec",
            "extra": "87 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "46e12eaa52011338d14a94b6f847312487154272",
          "message": "Merge pull request #1151 from napi-rs/upgrade-dependencies\n\nchore: upgrade dependencies",
          "timestamp": "2022-04-27T12:03:13+08:00",
          "tree_id": "e9981332f2831e9112bc41c8aa8c171ab12d14b0",
          "url": "https://github.com/napi-rs/napi-rs/commit/46e12eaa52011338d14a94b6f847312487154272"
        },
        "date": 1651032606425,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 54983105,
            "range": "±0.34%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712047770,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19448295,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 709896496,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 347596,
            "range": "±10.95%",
            "unit": "ops/sec",
            "extra": "59 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1695365,
            "range": "±4.11%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 39281,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7574,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7566,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16878,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10377,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12077,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 388500,
            "range": "±5.72%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 333980,
            "range": "±5.76%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 344175,
            "range": "±5.15%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 308892,
            "range": "±5.69%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38804,
            "range": "±1.2%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 416,
            "range": "±3.39%",
            "unit": "ops/sec",
            "extra": "58 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30219,
            "range": "±0.58%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2180,
            "range": "±2.16%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30278,
            "range": "±2.22%",
            "unit": "ops/sec",
            "extra": "87 samples"
          }
        ]
      }
    ]
  }
}