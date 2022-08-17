window.BENCHMARK_DATA = {
  "lastUpdate": 1660746270550,
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
          "id": "ad6dffc409a25c2451a1dbf201d409eeaf8274a9",
          "message": "Merge pull request #1152 from napi-rs/drop-node-17\n\nchore: drop node 17, add node 18",
          "timestamp": "2022-04-27T13:31:56+08:00",
          "tree_id": "73ff3f65917d552f57c5f05173889a908fea3683",
          "url": "https://github.com/napi-rs/napi-rs/commit/ad6dffc409a25c2451a1dbf201d409eeaf8274a9"
        },
        "date": 1651037937027,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 54325409,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712438936,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19316901,
            "range": "±0.7%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710155937,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 352675,
            "range": "±9.78%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1671258,
            "range": "±6.52%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 39494,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7602,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7578,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16935,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10435,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "100 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12089,
            "range": "±0.07%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 408239,
            "range": "±6.05%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 354546,
            "range": "±5.54%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 345054,
            "range": "±5.4%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 319381,
            "range": "±5.66%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38363,
            "range": "±1.13%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 425,
            "range": "±2.26%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30050,
            "range": "±0.65%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2196,
            "range": "±2.1%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31077,
            "range": "±0.44%",
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
          "id": "ce0125553180d12e865c4d4fd14e06ee0bdbf6a4",
          "message": "chore: publish\n\n - @napi-rs/cli@2.7.0",
          "timestamp": "2022-04-27T13:32:36+08:00",
          "tree_id": "f7bd8d4bf084435fd078dbd6dd6800b7059c9a00",
          "url": "https://github.com/napi-rs/napi-rs/commit/ce0125553180d12e865c4d4fd14e06ee0bdbf6a4"
        },
        "date": 1651038414989,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55256908,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713145679,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19290946,
            "range": "±1.07%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710480000,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 357782,
            "range": "±9.46%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1749021,
            "range": "±5.01%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 39561,
            "range": "±0.18%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7591,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7581,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16944,
            "range": "±0.29%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10414,
            "range": "±0.06%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12040,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 399259,
            "range": "±5.68%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 349666,
            "range": "±5.54%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 347630,
            "range": "±5.27%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 321351,
            "range": "±5.74%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37473,
            "range": "±1.84%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 416,
            "range": "±2.96%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30175,
            "range": "±0.59%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2188,
            "range": "±2.08%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30981,
            "range": "±0.41%",
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
          "id": "43d39fae3e976f311274a2f95bdf796272aad948",
          "message": "Merge pull request #1153 from napi-rs/update-windows-crate\n\nchore(napi): upgrade windows crate",
          "timestamp": "2022-04-27T14:12:22+08:00",
          "tree_id": "4e998eebc6ab0742c5346155d880650ef0e5a242",
          "url": "https://github.com/napi-rs/napi-rs/commit/43d39fae3e976f311274a2f95bdf796272aad948"
        },
        "date": 1651040404696,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55208068,
            "range": "±0.29%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713162505,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19305527,
            "range": "±1.24%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710417529,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 369665,
            "range": "±9.23%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1886419,
            "range": "±5.42%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 39755,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7565,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7539,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17050,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10357,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12072,
            "range": "±0.02%",
            "unit": "ops/sec",
            "extra": "100 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 408132,
            "range": "±4.88%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 358148,
            "range": "±4.94%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 357810,
            "range": "±4.44%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 340625,
            "range": "±4.48%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38648,
            "range": "±1.18%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 416,
            "range": "±3.69%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29901,
            "range": "±0.86%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2189,
            "range": "±1.78%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30554,
            "range": "±1.93%",
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
          "id": "2fecc109ef822efbaa81cb365699d2f67f6a1f51",
          "message": "Release independent packages\n\nnapi@2.3.3\nnapi-derive@2.3.2",
          "timestamp": "2022-04-27T14:14:04+08:00",
          "tree_id": "179aa8d97347db0a096e4227e72bf493d3dfff67",
          "url": "https://github.com/napi-rs/napi-rs/commit/2fecc109ef822efbaa81cb365699d2f67f6a1f51"
        },
        "date": 1651040790117,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55272417,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713031249,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19205574,
            "range": "±0.74%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 709111453,
            "range": "±0.46%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 362926,
            "range": "±9.37%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1712583,
            "range": "±5.11%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 39738,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7628,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7617,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17449,
            "range": "±0.41%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10303,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12220,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 399188,
            "range": "±5.36%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 354244,
            "range": "±5.13%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 348605,
            "range": "±4.91%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 326163,
            "range": "±5.24%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38180,
            "range": "±1.25%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 410,
            "range": "±3.46%",
            "unit": "ops/sec",
            "extra": "64 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29961,
            "range": "±0.48%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2156,
            "range": "±1.87%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30421,
            "range": "±0.82%",
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
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "8ee7df10bd4bc4ae1f146a52d88f81ced7bc514f",
          "message": "Merge pull request #1155 from napi-rs/invalid-return-type\n\nfix(napi-derive): invalid TypeScript return type",
          "timestamp": "2022-04-27T18:38:54+08:00",
          "tree_id": "d3c5701488c16a303d771c34f2e14f53b8ca13af",
          "url": "https://github.com/napi-rs/napi-rs/commit/8ee7df10bd4bc4ae1f146a52d88f81ced7bc514f"
        },
        "date": 1651056247336,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 54766951,
            "range": "±0.5%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 711659468,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18473537,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 709985803,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 349232,
            "range": "±10.9%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1617994,
            "range": "±5.6%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 39637,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7498,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7511,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17378,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10318,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12178,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 391029,
            "range": "±5.67%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 338662,
            "range": "±6.11%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 345138,
            "range": "±5.42%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 325282,
            "range": "±5.53%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37409,
            "range": "±1.04%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 429,
            "range": "±4.16%",
            "unit": "ops/sec",
            "extra": "58 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30100,
            "range": "±0.94%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2119,
            "range": "±2.56%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30336,
            "range": "±0.51%",
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
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "8681cadc0ffabb3974df9a8bcc19562aac80490c",
          "message": "Release independent packages\n\nnapi-derive@2.3.3",
          "timestamp": "2022-04-27T18:39:52+08:00",
          "tree_id": "d54fabc09c48a853aecbaf7eef5705341cc2a167",
          "url": "https://github.com/napi-rs/napi-rs/commit/8681cadc0ffabb3974df9a8bcc19562aac80490c"
        },
        "date": 1651056838498,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 42526297,
            "range": "±1.08%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 568790429,
            "range": "±0.91%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 14574211,
            "range": "±2.06%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 574917030,
            "range": "±0.56%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 298239,
            "range": "±11.02%",
            "unit": "ops/sec",
            "extra": "58 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1595934,
            "range": "±6.16%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 31427,
            "range": "±0.96%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6096,
            "range": "±0.78%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6105,
            "range": "±1.11%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13595,
            "range": "±0.73%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8286,
            "range": "±1.11%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9655,
            "range": "±1.13%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 339613,
            "range": "±5.38%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 290896,
            "range": "±5.41%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 286328,
            "range": "±5.9%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 265988,
            "range": "±5.81%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 28218,
            "range": "±2.28%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 342,
            "range": "±2.66%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 22358,
            "range": "±2.89%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1776,
            "range": "±2.5%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22297,
            "range": "±2.99%",
            "unit": "ops/sec",
            "extra": "80 samples"
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
          "id": "a91a8b42010bad5db52584fa9bdedbe6e368d8d3",
          "message": "Merge pull request #1159 from bnoordhuis/from_reason\n\nfeat(napi): make Error::from_reason() generic",
          "timestamp": "2022-05-02T14:13:59+08:00",
          "tree_id": "905122a5485bf6fbee1824296aff1d10aaffb83a",
          "url": "https://github.com/napi-rs/napi-rs/commit/a91a8b42010bad5db52584fa9bdedbe6e368d8d3"
        },
        "date": 1651472621730,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 56045092,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713788793,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 17697801,
            "range": "±0.77%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710320741,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 409271,
            "range": "±8.02%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1769307,
            "range": "±7.71%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37445,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7509,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7487,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16067,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10516,
            "range": "±0.06%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12249,
            "range": "±0.02%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 420211,
            "range": "±5.26%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 351313,
            "range": "±5.13%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 373221,
            "range": "±5.1%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 342113,
            "range": "±5.23%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37078,
            "range": "±1.23%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1066,
            "range": "±26.53%",
            "unit": "ops/sec",
            "extra": "37 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29651,
            "range": "±1.4%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2079,
            "range": "±1.88%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 29887,
            "range": "±0.51%",
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
          "id": "68a6d507ff3aa24cec1b28d9823fa2408643e2a2",
          "message": "Merge pull request #1162 from napi-rs/add-debian-aarch64-cross-image\n\nfeat(cli): new command upgrade",
          "timestamp": "2022-05-03T20:03:37+08:00",
          "tree_id": "a6586054dbbd88665412737055f6f57580b63de3",
          "url": "https://github.com/napi-rs/napi-rs/commit/68a6d507ff3aa24cec1b28d9823fa2408643e2a2"
        },
        "date": 1651579923341,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55448865,
            "range": "±0.29%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 706960593,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18059721,
            "range": "±1.01%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 701666272,
            "range": "±0.37%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 268886,
            "range": "±10.21%",
            "unit": "ops/sec",
            "extra": "55 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 999031,
            "range": "±6.92%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 34670,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7336,
            "range": "±0.18%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7391,
            "range": "±0.18%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15706,
            "range": "±0.43%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10422,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10936,
            "range": "±2.05%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 353766,
            "range": "±8.14%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 306108,
            "range": "±8.04%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 316459,
            "range": "±7.8%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 301788,
            "range": "±8.2%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 29192,
            "range": "±3.28%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1875,
            "range": "±5.62%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 23593,
            "range": "±5.83%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1898,
            "range": "±4.4%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 25129,
            "range": "±2.63%",
            "unit": "ops/sec",
            "extra": "75 samples"
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
          "id": "4fb120ab341592b481f049f4e0ad23eb55f25011",
          "message": "Merge pull request #1161 from devongovett/reference-crash\n\nfix(napi): handle the referenced object is finalized before `Reference::drop`",
          "timestamp": "2022-05-04T11:45:48+08:00",
          "tree_id": "a71a0c6b9322c7ab2e4a9b453b4cadeb271c9a64",
          "url": "https://github.com/napi-rs/napi-rs/commit/4fb120ab341592b481f049f4e0ad23eb55f25011"
        },
        "date": 1651636415510,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 63325649,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 812217301,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20898108,
            "range": "±0.92%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 793744554,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 433309,
            "range": "±8.15%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1854509,
            "range": "±5.24%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42032,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8119,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8085,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 18482,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11668,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13592,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "100 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 469392,
            "range": "±5.11%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 381548,
            "range": "±5.29%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 405306,
            "range": "±5.09%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 378569,
            "range": "±4.94%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 35958,
            "range": "±2.34%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1616,
            "range": "±16.23%",
            "unit": "ops/sec",
            "extra": "52 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31094,
            "range": "±1.48%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2208,
            "range": "±2.43%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30289,
            "range": "±2.91%",
            "unit": "ops/sec",
            "extra": "80 samples"
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
          "id": "74cfcd377ab8e362b4fa53a0a9d913cb4c19f6de",
          "message": "build: export C_INCLUDE_PATH in aarch64 linux gnu image",
          "timestamp": "2022-05-04T14:47:54+08:00",
          "tree_id": "880f76883f76e6b2d6fa279edb1f2926a8eaeb0d",
          "url": "https://github.com/napi-rs/napi-rs/commit/74cfcd377ab8e362b4fa53a0a9d913cb4c19f6de"
        },
        "date": 1651647208680,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55990818,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713040144,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18352605,
            "range": "±0.87%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710681921,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 394291,
            "range": "±10.62%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1681753,
            "range": "±4.7%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37219,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7414,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7350,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16205,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10490,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12013,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 405257,
            "range": "±6.17%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 342040,
            "range": "±5.74%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 369614,
            "range": "±5.79%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 334777,
            "range": "±5.76%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 39029,
            "range": "±2.14%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1415,
            "range": "±24.43%",
            "unit": "ops/sec",
            "extra": "41 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30210,
            "range": "±1.65%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2150,
            "range": "±2.12%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30324,
            "range": "±2.24%",
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
          "id": "e7464383d3d9fb3af4a7645499ff840eab944bb0",
          "message": "build: add --sysroot flag to clang/clang++ in aarch64 linux gnu image",
          "timestamp": "2022-05-04T16:34:28+08:00",
          "tree_id": "326463bfcacb9c9cb6397abe9130700906f08e56",
          "url": "https://github.com/napi-rs/napi-rs/commit/e7464383d3d9fb3af4a7645499ff840eab944bb0"
        },
        "date": 1651653548917,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55194107,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712777788,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18448694,
            "range": "±0.59%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 711147548,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 421592,
            "range": "±8.39%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1836660,
            "range": "±6.98%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37607,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7415,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7350,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16408,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10102,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 11658,
            "range": "±0.47%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 427773,
            "range": "±4.98%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 360479,
            "range": "±4.77%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 375249,
            "range": "±4.85%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 344247,
            "range": "±5.68%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36860,
            "range": "±1.71%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1397,
            "range": "±39.13%",
            "unit": "ops/sec",
            "extra": "27 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30227,
            "range": "±1.53%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2174,
            "range": "±1.76%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31219,
            "range": "±2.44%",
            "unit": "ops/sec",
            "extra": "60 samples"
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
          "id": "4f120ba8ff38742ac10946ce58b566d3ae1a5cf1",
          "message": "Merge pull request #1166 from napi-rs/generator\n\nIterator Support",
          "timestamp": "2022-05-06T19:53:35+08:00",
          "tree_id": "8b884f583d53e0b8710a26ca5e52b31b24d7afb8",
          "url": "https://github.com/napi-rs/napi-rs/commit/4f120ba8ff38742ac10946ce58b566d3ae1a5cf1"
        },
        "date": 1651838310627,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 54140884,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712422064,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18543889,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710736346,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 379534,
            "range": "±11.18%",
            "unit": "ops/sec",
            "extra": "64 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1654911,
            "range": "±3.71%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37012,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7356,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7319,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16395,
            "range": "±1.11%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10051,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 11796,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 404570,
            "range": "±6.03%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 341727,
            "range": "±5.66%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 361125,
            "range": "±5.69%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 328085,
            "range": "±6.21%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37599,
            "range": "±1.33%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1729,
            "range": "±16.29%",
            "unit": "ops/sec",
            "extra": "49 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29286,
            "range": "±0.4%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2100,
            "range": "±2.34%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 29134,
            "range": "±2.35%",
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
          "id": "e094f78e08105c314f0fe9f06ea7ee7a68f29dc8",
          "message": "Merge pull request #1167 from napi-rs/dyn-load\n\nUse libloading on Windows",
          "timestamp": "2022-05-06T22:43:42+08:00",
          "tree_id": "e0e2bb0596a64a220071f4bb4acace66e70fd400",
          "url": "https://github.com/napi-rs/napi-rs/commit/e094f78e08105c314f0fe9f06ea7ee7a68f29dc8"
        },
        "date": 1651848556899,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 60181945,
            "range": "±0.36%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 595772040,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19965313,
            "range": "±0.61%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 593779568,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 423122,
            "range": "±7.2%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1895200,
            "range": "±4.59%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 43457,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8134,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8073,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17528,
            "range": "±0.91%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11302,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12868,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 374313,
            "range": "±5.23%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 333713,
            "range": "±4.58%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 352464,
            "range": "±4.81%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 311390,
            "range": "±4.75%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36316,
            "range": "±2.89%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2291,
            "range": "±8.54%",
            "unit": "ops/sec",
            "extra": "46 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29687,
            "range": "±1.37%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2214,
            "range": "±1.61%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30758,
            "range": "±1.66%",
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
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "e778e400e9274614c0a2b92ee1a57c294d6c1ae2",
          "message": "chore: publish\n\n - @napi-rs/cli@2.8.0-alpha.0",
          "timestamp": "2022-05-06T23:05:27+08:00",
          "tree_id": "df9e5b304bb16b2fe102fd527abb01090432a68a",
          "url": "https://github.com/napi-rs/napi-rs/commit/e778e400e9274614c0a2b92ee1a57c294d6c1ae2"
        },
        "date": 1651850586260,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 44294539,
            "range": "±1.13%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 716179126,
            "range": "±1.19%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 14327693,
            "range": "±1.32%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 725799287,
            "range": "±1.14%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 315115,
            "range": "±10.4%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1465307,
            "range": "±5.29%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 35382,
            "range": "±0.96%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6374,
            "range": "±1.28%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6482,
            "range": "±1.06%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14556,
            "range": "±1.23%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8690,
            "range": "±1%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10226,
            "range": "±1.05%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 322157,
            "range": "±5.84%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 297681,
            "range": "±5.59%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 297861,
            "range": "±6.01%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 273181,
            "range": "±5.76%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 26039,
            "range": "±3.99%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2073,
            "range": "±4.33%",
            "unit": "ops/sec",
            "extra": "45 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 21943,
            "range": "±2.54%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1681,
            "range": "±3.3%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 20916,
            "range": "±2.61%",
            "unit": "ops/sec",
            "extra": "80 samples"
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
          "id": "d728b3ab3caeb9a4bd5ddeb52942cceacfffc7a9",
          "message": "chore: publish\n\n - @napi-rs/cli@2.8.0",
          "timestamp": "2022-05-07T15:49:00+08:00",
          "tree_id": "d0a3bd363e399d9ab01ab7926262df8f34affc6a",
          "url": "https://github.com/napi-rs/napi-rs/commit/d728b3ab3caeb9a4bd5ddeb52942cceacfffc7a9"
        },
        "date": 1651910041520,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55845579,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 711795572,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18507316,
            "range": "±0.51%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710685926,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 390660,
            "range": "±9.61%",
            "unit": "ops/sec",
            "extra": "59 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1698208,
            "range": "±3.99%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36942,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7514,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7412,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16156,
            "range": "±0.84%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10239,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12124,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 394825,
            "range": "±5.81%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 349919,
            "range": "±5.52%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 355269,
            "range": "±5.63%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 326712,
            "range": "±6.25%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 39420,
            "range": "±1.1%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 997,
            "range": "±36.53%",
            "unit": "ops/sec",
            "extra": "31 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29957,
            "range": "±1.77%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2143,
            "range": "±2.18%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30182,
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
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "daf5f1f9e9c1eaa58f040ac07b1feb0f986ca13a",
          "message": "Release independent packages\n\n- napi@2.4.0\n- napi-derive@2.4.0\n- napi-sys@2.2.0\n- napi-build@2.0.0",
          "timestamp": "2022-05-07T15:51:22+08:00",
          "tree_id": "ff8413b660d28df5168b5178587791b72136d22a",
          "url": "https://github.com/napi-rs/napi-rs/commit/daf5f1f9e9c1eaa58f040ac07b1feb0f986ca13a"
        },
        "date": 1651910967123,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55733287,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712952142,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 17757213,
            "range": "±1.06%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710331494,
            "range": "±0.18%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 387593,
            "range": "±10.98%",
            "unit": "ops/sec",
            "extra": "60 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1677074,
            "range": "±4.53%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36276,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7479,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7496,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16723,
            "range": "±0.42%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10283,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12034,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 397808,
            "range": "±5.99%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 336326,
            "range": "±5.76%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 351544,
            "range": "±5.83%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 329600,
            "range": "±6.3%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37680,
            "range": "±1.31%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1137,
            "range": "±29.62%",
            "unit": "ops/sec",
            "extra": "49 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29765,
            "range": "±1.89%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2091,
            "range": "±1.39%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30130,
            "range": "±2.3%",
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
          "id": "700f78fbf6a7526c3bc7a530437df442f5bcdddb",
          "message": "Merge pull request #1169 from napi-rs/setup-sys\n\nfix(napi): load Node-API symbols manually on Windows",
          "timestamp": "2022-05-07T20:21:47+08:00",
          "tree_id": "79f7e4f4b7d9bc5154fe584dee133ec0c5dc0add",
          "url": "https://github.com/napi-rs/napi-rs/commit/700f78fbf6a7526c3bc7a530437df442f5bcdddb"
        },
        "date": 1651926436419,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 46019095,
            "range": "±0.33%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 590102550,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15361851,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 587561818,
            "range": "±0.3%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 333058,
            "range": "±10.89%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1451492,
            "range": "±6.35%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 30437,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6110,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6101,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13974,
            "range": "±0.51%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8534,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10135,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 342376,
            "range": "±5.79%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 298599,
            "range": "±5.59%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 315421,
            "range": "±5.8%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 285389,
            "range": "±5.46%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 26285,
            "range": "±2.57%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1517,
            "range": "±9.82%",
            "unit": "ops/sec",
            "extra": "46 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 21605,
            "range": "±2.59%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1705,
            "range": "±2.2%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 21333,
            "range": "±3.01%",
            "unit": "ops/sec",
            "extra": "79 samples"
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
          "id": "79d7453713edc26bb283f1b63c5314a06163f323",
          "message": "Release independent packages",
          "timestamp": "2022-05-07T20:23:01+08:00",
          "tree_id": "dd6b480bd084a6400d8f3f162d4f49d11baccb0c",
          "url": "https://github.com/napi-rs/napi-rs/commit/79d7453713edc26bb283f1b63c5314a06163f323"
        },
        "date": 1651926883944,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 60007652,
            "range": "±0.48%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 593433416,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20115804,
            "range": "±0.76%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 591568422,
            "range": "±0.22%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 456985,
            "range": "±7.43%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2213102,
            "range": "±1.35%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 44177,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7948,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7969,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17839,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11170,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12763,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 389079,
            "range": "±3.95%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 336894,
            "range": "±4.25%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 365665,
            "range": "±4.15%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 322406,
            "range": "±4.05%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38523,
            "range": "±1.52%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2675,
            "range": "±8.73%",
            "unit": "ops/sec",
            "extra": "43 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30481,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2148,
            "range": "±1.75%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31778,
            "range": "±0.37%",
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
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "7203632bb307d2a1c6251d192caf8414f0407da6",
          "message": "chore: add RUST_TARGET env in debian.Dockerfile",
          "timestamp": "2022-05-09T12:17:01+08:00",
          "tree_id": "e5eff5673db9e7ce0b01e055f6f35a08b8f556ef",
          "url": "https://github.com/napi-rs/napi-rs/commit/7203632bb307d2a1c6251d192caf8414f0407da6"
        },
        "date": 1652070141657,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 47507626,
            "range": "±0.48%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 604786723,
            "range": "±0.39%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15543846,
            "range": "±1.01%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 598013299,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 360416,
            "range": "±9.04%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1677394,
            "range": "±4.73%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 31297,
            "range": "±0.41%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6317,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6225,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13893,
            "range": "±0.78%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8725,
            "range": "±0.29%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10036,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 366733,
            "range": "±5.84%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 313827,
            "range": "±5.81%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 332962,
            "range": "±5.62%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 300135,
            "range": "±5.9%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 29802,
            "range": "±1.14%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1080,
            "range": "±38.22%",
            "unit": "ops/sec",
            "extra": "31 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24911,
            "range": "±1.71%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1832,
            "range": "±1.74%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 25477,
            "range": "±0.53%",
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
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "5ecf16e5ad10503cbbe5163839c41e5fa4b99ebf",
          "message": "Merge pull request #1176 from napi-rs/remove-thread-local\n\nRemove `thread_local!` usage, add electron test",
          "timestamp": "2022-05-10T19:16:31+08:00",
          "tree_id": "e5258fd21007ac94657196923b93a3d10d67fa95",
          "url": "https://github.com/napi-rs/napi-rs/commit/5ecf16e5ad10503cbbe5163839c41e5fa4b99ebf"
        },
        "date": 1652181694513,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55995250,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 714252199,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18526569,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710898085,
            "range": "±0.53%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 385702,
            "range": "±10.38%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1748207,
            "range": "±5.98%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36027,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7431,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7454,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16776,
            "range": "±0.36%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10197,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12154,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 419625,
            "range": "±5.58%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 351127,
            "range": "±5.4%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 380922,
            "range": "±5.05%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 341589,
            "range": "±5.51%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37639,
            "range": "±1.15%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1389,
            "range": "±32.99%",
            "unit": "ops/sec",
            "extra": "28 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29974,
            "range": "±1.99%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2035,
            "range": "±2.31%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30783,
            "range": "±0.37%",
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
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "57ea8dc8f3c888c63ceb0ced0fb80086e53c117a",
          "message": "Merge pull request #1172 from devongovett/weak-reference\n\nAdd support for weak references",
          "timestamp": "2022-05-10T21:27:16+08:00",
          "tree_id": "26992374a836faf2c878497c005dbab23b00240d",
          "url": "https://github.com/napi-rs/napi-rs/commit/57ea8dc8f3c888c63ceb0ced0fb80086e53c117a"
        },
        "date": 1652189740934,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 63525768,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 813088155,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 21001990,
            "range": "±0.56%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 812227072,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 413091,
            "range": "±10.25%",
            "unit": "ops/sec",
            "extra": "64 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1837972,
            "range": "±7.68%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 41433,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8580,
            "range": "±0.46%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8567,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 19568,
            "range": "±0.56%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 12044,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 14237,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 456900,
            "range": "±5.66%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 383557,
            "range": "±5.55%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 393994,
            "range": "±5.41%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 362242,
            "range": "±5.71%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 40660,
            "range": "±1.5%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1693,
            "range": "±42.72%",
            "unit": "ops/sec",
            "extra": "28 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31251,
            "range": "±1.79%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2333,
            "range": "±2.25%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32624,
            "range": "±2.21%",
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
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "3d4c4215851e582b8d553d37d8861972e9107c59",
          "message": "Merge pull request #1177 from napi-rs/iterator-default-constructor\n\nfix(napi): missing iterator implementation from class factory",
          "timestamp": "2022-05-10T22:23:45+08:00",
          "tree_id": "caf3e3d958bd70d34948fd0a6521387f3d1b23c3",
          "url": "https://github.com/napi-rs/napi-rs/commit/3d4c4215851e582b8d553d37d8861972e9107c59"
        },
        "date": 1652192939163,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 56007742,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 711862262,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18331636,
            "range": "±0.98%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710392983,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 415906,
            "range": "±10.08%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1798201,
            "range": "±4.72%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 40998,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8430,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8443,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 18953,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11609,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13807,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 463678,
            "range": "±5.38%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 398591,
            "range": "±5.46%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 410056,
            "range": "±5.13%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 367433,
            "range": "±5.6%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 39252,
            "range": "±1.71%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 971,
            "range": "±31.9%",
            "unit": "ops/sec",
            "extra": "30 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31710,
            "range": "±1.88%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2041,
            "range": "±3.46%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31768,
            "range": "±0.69%",
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
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "fb8d8b97d60b53f50b9595f70ac3d1f8d311ba9a",
          "message": "Release independent packages\n\nnapi@2.4.2\nnapi-derive@2.4.2\nnapi-sys@2.2.2",
          "timestamp": "2022-05-10T22:32:06+08:00",
          "tree_id": "5347815fe329f12cf8d3324991a96e4605baadc0",
          "url": "https://github.com/napi-rs/napi-rs/commit/fb8d8b97d60b53f50b9595f70ac3d1f8d311ba9a"
        },
        "date": 1652193756419,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55931323,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713391698,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 17866808,
            "range": "±0.33%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 711124991,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 385184,
            "range": "±11.46%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1624478,
            "range": "±4.42%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37186,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7421,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7474,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16873,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10485,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12226,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 424038,
            "range": "±5.36%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 351642,
            "range": "±5.33%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 360242,
            "range": "±5.38%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 347522,
            "range": "±5.73%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36352,
            "range": "±1.74%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2575,
            "range": "±4.28%",
            "unit": "ops/sec",
            "extra": "42 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 28818,
            "range": "±1.93%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2095,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 29044,
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
          "id": "6c1d0f040953e6db6b682dc24e1269baa5592214",
          "message": "Merge pull request #1178 from napi-rs/either-type\n\nfix(napi): type constraint for either types",
          "timestamp": "2022-05-12T16:58:45+08:00",
          "tree_id": "551870cbe00274850f7fae699ba4d3b457b686a5",
          "url": "https://github.com/napi-rs/napi-rs/commit/6c1d0f040953e6db6b682dc24e1269baa5592214"
        },
        "date": 1652346510983,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 46195746,
            "range": "±0.41%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 602609813,
            "range": "±0.36%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15372977,
            "range": "±0.42%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 601898145,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 363300,
            "range": "±9.78%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1666524,
            "range": "±5.78%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 31732,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6296,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6318,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14311,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8772,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10347,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 356196,
            "range": "±5.31%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 320586,
            "range": "±5.41%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 332828,
            "range": "±5.41%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 302111,
            "range": "±5.53%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 29580,
            "range": "±1.36%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1357,
            "range": "±24.51%",
            "unit": "ops/sec",
            "extra": "30 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24560,
            "range": "±2.05%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1830,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 24971,
            "range": "±1.92%",
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
          "id": "822f4af1ccda63d58971fa50edf4927287ea6cf3",
          "message": "Release independent packages\n\n- napi@2.4.3",
          "timestamp": "2022-05-12T16:59:33+08:00",
          "tree_id": "901f75191ba1667978910dd115a62e80e258f2d0",
          "url": "https://github.com/napi-rs/napi-rs/commit/822f4af1ccda63d58971fa50edf4927287ea6cf3"
        },
        "date": 1652346924643,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 53267114,
            "range": "±1.46%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 654685601,
            "range": "±1.33%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15618114,
            "range": "±1.06%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 577703251,
            "range": "±0.62%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 328816,
            "range": "±10.75%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1436546,
            "range": "±5.7%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 32191,
            "range": "±0.43%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6328,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6226,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14318,
            "range": "±0.7%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8749,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10277,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 354538,
            "range": "±5.61%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 308552,
            "range": "±5.91%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 314730,
            "range": "±5.91%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 295608,
            "range": "±5.88%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 28623,
            "range": "±1.99%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1679,
            "range": "±9.38%",
            "unit": "ops/sec",
            "extra": "46 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 22604,
            "range": "±2.53%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1736,
            "range": "±2.21%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22933,
            "range": "±1.36%",
            "unit": "ops/sec",
            "extra": "81 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "devongovett@gmail.com",
            "name": "Devon Govett",
            "username": "devongovett"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "d6c755c4eb8b2a56e226866d9a595ad2d712ebcc",
          "message": "fix(napi-derive): `js_name` support for getters and setters (#1179)",
          "timestamp": "2022-05-13T12:55:54+08:00",
          "tree_id": "15f03651a73ce2172697af8437260c5c701cace1",
          "url": "https://github.com/napi-rs/napi-rs/commit/d6c755c4eb8b2a56e226866d9a595ad2d712ebcc"
        },
        "date": 1652418353545,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 40106053,
            "range": "±1.42%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 518790604,
            "range": "±1.69%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 13530516,
            "range": "±1.53%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 544414919,
            "range": "±0.74%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 330385,
            "range": "±10.12%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1397129,
            "range": "±5.36%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 28793,
            "range": "±1.07%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 5783,
            "range": "±0.87%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 5779,
            "range": "±0.64%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 12698,
            "range": "±1.36%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8041,
            "range": "±0.69%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9339,
            "range": "±0.74%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 335515,
            "range": "±5.59%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 294776,
            "range": "±5.91%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 313121,
            "range": "±5.64%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 288642,
            "range": "±5.2%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 25201,
            "range": "±2.47%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1927,
            "range": "±5.99%",
            "unit": "ops/sec",
            "extra": "39 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 20813,
            "range": "±3.11%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1584,
            "range": "±2.5%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 19669,
            "range": "±2.85%",
            "unit": "ops/sec",
            "extra": "77 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "messense@icloud.com",
            "name": "messense",
            "username": "messense"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "1399288df5b16fd615b2b0a5a24f72ac602635a4",
          "message": "feat(cli): allow specifying an alternative cargo binary via `CARGO` env var (#1181)",
          "timestamp": "2022-05-14T15:03:31+08:00",
          "tree_id": "45a1b81aec59c12a22686f34b5675efe782387c9",
          "url": "https://github.com/napi-rs/napi-rs/commit/1399288df5b16fd615b2b0a5a24f72ac602635a4"
        },
        "date": 1652512404512,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 60151508,
            "range": "±0.5%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 591325547,
            "range": "±0.64%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18689903,
            "range": "±0.5%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 592783393,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 455038,
            "range": "±6.56%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2085005,
            "range": "±6.93%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42846,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8198,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7948,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17222,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11489,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12759,
            "range": "±0.48%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 387036,
            "range": "±4.6%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 334105,
            "range": "±4.52%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 362815,
            "range": "±4.41%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 320553,
            "range": "±4.6%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38047,
            "range": "±1.93%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 3026,
            "range": "±2.57%",
            "unit": "ops/sec",
            "extra": "42 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31694,
            "range": "±0.45%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2227,
            "range": "±1.57%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32021,
            "range": "±0.47%",
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
          "id": "b797a243e2a7188588bdcc958a66e8ee9855c6b1",
          "message": "chore: publish\n\n - @napi-rs/cli@2.9.0",
          "timestamp": "2022-05-14T17:03:09+08:00",
          "tree_id": "f5cac63c17a66247df367524e35f66c2c7f09888",
          "url": "https://github.com/napi-rs/napi-rs/commit/b797a243e2a7188588bdcc958a66e8ee9855c6b1"
        },
        "date": 1652519417279,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 54560915,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712320431,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 17850860,
            "range": "±0.88%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710008932,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 388217,
            "range": "±11.18%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1702371,
            "range": "±6.18%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36235,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7510,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7492,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16593,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10486,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "100 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12068,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 412543,
            "range": "±5.38%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 351832,
            "range": "±5.63%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 375233,
            "range": "±5.43%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 347546,
            "range": "±5.83%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36902,
            "range": "±1.1%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1379,
            "range": "±21.42%",
            "unit": "ops/sec",
            "extra": "44 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 28753,
            "range": "±1.76%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2130,
            "range": "±2.07%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 29048,
            "range": "±0.4%",
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
          "id": "a2b993acd27f651df53fc0915ec200009b7a0e3c",
          "message": "chore: upgrade npm dependencies (#1182)",
          "timestamp": "2022-05-14T18:56:50+08:00",
          "tree_id": "5a39f5676bc6f3132527ba8c18719ff417de4a34",
          "url": "https://github.com/napi-rs/napi-rs/commit/a2b993acd27f651df53fc0915ec200009b7a0e3c"
        },
        "date": 1652526435548,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 49366876,
            "range": "±0.55%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 638821954,
            "range": "±0.6%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16495182,
            "range": "±0.61%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 651500189,
            "range": "±0.55%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 369157,
            "range": "±9.73%",
            "unit": "ops/sec",
            "extra": "59 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1615555,
            "range": "±3.62%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 33188,
            "range": "±0.46%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6868,
            "range": "±0.51%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6723,
            "range": "±0.61%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15185,
            "range": "±0.69%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 9683,
            "range": "±0.48%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 11214,
            "range": "±0.59%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 391057,
            "range": "±5.26%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 337376,
            "range": "±5.77%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 355660,
            "range": "±5.18%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 326574,
            "range": "±5.64%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 31401,
            "range": "±1.52%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 677,
            "range": "±25.68%",
            "unit": "ops/sec",
            "extra": "38 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 26438,
            "range": "±1.71%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1960,
            "range": "±0.81%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 26740,
            "range": "±1.82%",
            "unit": "ops/sec",
            "extra": "86 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "messense@icloud.com",
            "name": "messense",
            "username": "messense"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "5cbeac59dcad653c8eeb11233f97c769b374f946",
          "message": "Add `rust-version` field to `Cargo.toml`s (#1190)",
          "timestamp": "2022-05-20T16:23:10+08:00",
          "tree_id": "6487d17cda65e897ca44ccc6442b03c40e2aaa4e",
          "url": "https://github.com/napi-rs/napi-rs/commit/5cbeac59dcad653c8eeb11233f97c769b374f946"
        },
        "date": 1653035446213,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 45685070,
            "range": "±0.56%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 590623294,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15271345,
            "range": "±0.29%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 589867313,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 347823,
            "range": "±9.51%",
            "unit": "ops/sec",
            "extra": "64 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1464740,
            "range": "±8.54%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 30681,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6205,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6104,
            "range": "±0.71%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13885,
            "range": "±0.94%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8725,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10193,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 350984,
            "range": "±5.21%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 309468,
            "range": "±5.25%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 324063,
            "range": "±5.51%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 275361,
            "range": "±5.79%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 24646,
            "range": "±3.67%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1425,
            "range": "±7.09%",
            "unit": "ops/sec",
            "extra": "62 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 19474,
            "range": "±3.65%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1424,
            "range": "±2.71%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 19071,
            "range": "±5.93%",
            "unit": "ops/sec",
            "extra": "73 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "acevedoflores.jose@gmail.com",
            "name": "Jose L",
            "username": "jose-acevedoflores"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "5be415d3d90cf1a5ce440d3c6ac639ab0ea3e93f",
          "message": "feat(napi-derive): add ts_arg_type attribute to override individual args on functions (#1192)",
          "timestamp": "2022-05-22T13:43:11+08:00",
          "tree_id": "595fe1cfa5b883bf689fb1e28e9d2652094b213d",
          "url": "https://github.com/napi-rs/napi-rs/commit/5be415d3d90cf1a5ce440d3c6ac639ab0ea3e93f"
        },
        "date": 1653198587256,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 56051944,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713227498,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18276352,
            "range": "±0.63%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 713103545,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 415837,
            "range": "±8.35%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1898487,
            "range": "±7.34%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36722,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7412,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7394,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17092,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10200,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12229,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 433349,
            "range": "±4.85%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 367585,
            "range": "±4.74%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 373691,
            "range": "±4.86%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 348154,
            "range": "±5.37%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38675,
            "range": "±1.11%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1260,
            "range": "±26.25%",
            "unit": "ops/sec",
            "extra": "39 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30109,
            "range": "±1.19%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2012,
            "range": "±1.8%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30705,
            "range": "±0.47%",
            "unit": "ops/sec",
            "extra": "88 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "messense@icloud.com",
            "name": "messense",
            "username": "messense"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "beb75111fcf46f60edfc00d83f6141a67f145cb3",
          "message": "fix(cli): parse host target triple from `rustc -vV` (#1191)",
          "timestamp": "2022-05-22T13:43:35+08:00",
          "tree_id": "8b58f5c551217eb505cf3523b854fdc31d4d1846",
          "url": "https://github.com/napi-rs/napi-rs/commit/beb75111fcf46f60edfc00d83f6141a67f145cb3"
        },
        "date": 1653199358744,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 59967386,
            "range": "±0.4%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 594115833,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19610204,
            "range": "±0.48%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 592031976,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 452253,
            "range": "±6.59%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2134140,
            "range": "±3.57%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 43915,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8201,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7910,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 18205,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11127,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12577,
            "range": "±0.41%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 384326,
            "range": "±4.77%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 333534,
            "range": "±4.46%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 363879,
            "range": "±4.32%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 322044,
            "range": "±4.49%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36543,
            "range": "±1.15%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2515,
            "range": "±13.86%",
            "unit": "ops/sec",
            "extra": "38 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30256,
            "range": "±1.28%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2042,
            "range": "±1.52%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30941,
            "range": "±1.62%",
            "unit": "ops/sec",
            "extra": "85 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "acevedoflores.jose@gmail.com",
            "name": "Jose Acevedo",
            "username": "jose-acevedoflores"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "796ba363f524c3e8ee72ee58986ffc4edf88963e",
          "message": "test(napi-derive): add trybuild negative macro tests",
          "timestamp": "2022-05-23T11:55:19+08:00",
          "tree_id": "cdbdaf475ddd7d5bbb6e31173f73934e98267dbb",
          "url": "https://github.com/napi-rs/napi-rs/commit/796ba363f524c3e8ee72ee58986ffc4edf88963e"
        },
        "date": 1653278642350,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 44117213,
            "range": "±1.74%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 711457359,
            "range": "±0.4%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 14556944,
            "range": "±1.66%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 731538925,
            "range": "±0.56%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 317689,
            "range": "±11.71%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1515497,
            "range": "±8.38%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 32896,
            "range": "±0.66%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6189,
            "range": "±0.57%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6090,
            "range": "±0.5%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14332,
            "range": "±0.73%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8664,
            "range": "±0.63%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10229,
            "range": "±0.69%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 341352,
            "range": "±5.86%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 288710,
            "range": "±5.67%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 311642,
            "range": "±5.56%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 273736,
            "range": "±5.34%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 30130,
            "range": "±2.84%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1879,
            "range": "±3.34%",
            "unit": "ops/sec",
            "extra": "60 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 22589,
            "range": "±1.84%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1622,
            "range": "±1.95%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 20179,
            "range": "±2.1%",
            "unit": "ops/sec",
            "extra": "77 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "ivan@mnt.io",
            "name": "Ivan Enderlin",
            "username": "Hywan"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "56e71a76d39ebb033e407811d9d0f4e7ee18e903",
          "message": "feat(napi) Return an error instead of panicking.",
          "timestamp": "2022-05-25T14:43:23+08:00",
          "tree_id": "07634d3717254cf7d3156c42d083f2650e82fb3e",
          "url": "https://github.com/napi-rs/napi-rs/commit/56e71a76d39ebb033e407811d9d0f4e7ee18e903"
        },
        "date": 1653461256691,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55851116,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 711808683,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18218236,
            "range": "±1.76%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710406601,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 398155,
            "range": "±8.82%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1918685,
            "range": "±4.42%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36522,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7470,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7453,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17058,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10379,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12265,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 418587,
            "range": "±5.16%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 348935,
            "range": "±5.09%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 360826,
            "range": "±5.32%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 338295,
            "range": "±5.75%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37297,
            "range": "±2.06%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1453,
            "range": "±20.14%",
            "unit": "ops/sec",
            "extra": "47 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 28438,
            "range": "±2.33%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2063,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 28888,
            "range": "±6.14%",
            "unit": "ops/sec",
            "extra": "87 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "scott_s829@163.com",
            "name": "Sunli",
            "username": "sunli829"
          },
          "committer": {
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "5cdfc8cb7efc7ec3abfe9316fee8ee65b6f6f66b",
          "message": "feat(napi) implement `From<Infallible>` for `napi::Error`",
          "timestamp": "2022-05-30T21:44:03+08:00",
          "tree_id": "e28949fdc25ad3798da5cda9370d85ab326f9371",
          "url": "https://github.com/napi-rs/napi-rs/commit/5cdfc8cb7efc7ec3abfe9316fee8ee65b6f6f66b"
        },
        "date": 1653918547828,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 45067606,
            "range": "±1.66%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 649762107,
            "range": "±0.73%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15872275,
            "range": "±0.78%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 648666372,
            "range": "±0.65%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 356922,
            "range": "±9.54%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1804653,
            "range": "±5.23%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 34739,
            "range": "±0.48%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6137,
            "range": "±0.53%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6139,
            "range": "±0.89%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14799,
            "range": "±0.47%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8816,
            "range": "±0.58%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10175,
            "range": "±0.64%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 355060,
            "range": "±5.08%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 300840,
            "range": "±5.23%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 320912,
            "range": "±4.69%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 278554,
            "range": "±4.69%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 41937,
            "range": "±1.76%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2801,
            "range": "±4.68%",
            "unit": "ops/sec",
            "extra": "52 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 27659,
            "range": "±2.18%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1784,
            "range": "±2.14%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 23051,
            "range": "±1.5%",
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
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "67cf075f8637b11ece42830a7405bb10f8ace884",
          "message": "Merge pull request #1198 from Hywan/feat-tonapivalue-vec-numbers",
          "timestamp": "2022-05-30T23:50:24+08:00",
          "tree_id": "2e09b3e064af54ae83f6c1b8f87205d53d07d44e",
          "url": "https://github.com/napi-rs/napi-rs/commit/67cf075f8637b11ece42830a7405bb10f8ace884"
        },
        "date": 1653926076529,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 45521157,
            "range": "±1.27%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 680945619,
            "range": "±1.36%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16452351,
            "range": "±1.14%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 685017201,
            "range": "±0.85%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 354188,
            "range": "±9.55%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1564100,
            "range": "±6.69%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 33222,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6562,
            "range": "±0.85%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6559,
            "range": "±0.94%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15317,
            "range": "±0.9%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8795,
            "range": "±1.17%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10933,
            "range": "±0.98%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 358673,
            "range": "±5.33%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 312690,
            "range": "±5.33%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 328498,
            "range": "±5.12%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 305620,
            "range": "±4.73%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 44720,
            "range": "±2.03%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2546,
            "range": "±4.49%",
            "unit": "ops/sec",
            "extra": "49 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 26936,
            "range": "±2.39%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1748,
            "range": "±2.53%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 23630,
            "range": "±1.42%",
            "unit": "ops/sec",
            "extra": "79 samples"
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
          "id": "717f96acfc78162d868d7ef665c339d8101608ca",
          "message": "ci: fix debian image",
          "timestamp": "2022-05-31T12:53:49+08:00",
          "tree_id": "05e4799c4571913284bcd34f7da2f775cc4b6f90",
          "url": "https://github.com/napi-rs/napi-rs/commit/717f96acfc78162d868d7ef665c339d8101608ca"
        },
        "date": 1653973252412,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55759182,
            "range": "±0.29%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 721484610,
            "range": "±0.79%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20832946,
            "range": "±0.81%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 807378806,
            "range": "±0.3%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 413671,
            "range": "±9.06%",
            "unit": "ops/sec",
            "extra": "62 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1747470,
            "range": "±1.97%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 39515,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8466,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8439,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 18875,
            "range": "±0.42%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11574,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13782,
            "range": "±0.33%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 439703,
            "range": "±6.42%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 366556,
            "range": "±6.35%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 379794,
            "range": "±6.12%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 335863,
            "range": "±6.49%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 39010,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2150,
            "range": "±8.62%",
            "unit": "ops/sec",
            "extra": "36 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31058,
            "range": "±1.7%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2154,
            "range": "±2.59%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31479,
            "range": "±2.71%",
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
          "id": "04a865270c5ceddf862ea03a49327f7389c300b0",
          "message": "Merge pull request #1201 from napi-rs/class-instance\n\nfeat(napi): support into_instance in class struct",
          "timestamp": "2022-06-04T01:26:16+08:00",
          "tree_id": "45efbc646fa613c2b4a45272ec29a03cf2d52c61",
          "url": "https://github.com/napi-rs/napi-rs/commit/04a865270c5ceddf862ea03a49327f7389c300b0"
        },
        "date": 1654277680856,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 57273536,
            "range": "±0.43%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 594313625,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20500340,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 595016204,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 440758,
            "range": "±7.38%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1899972,
            "range": "±4.27%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42614,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8291,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8445,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17374,
            "range": "±0.36%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11333,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12414,
            "range": "±0.5%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 377416,
            "range": "±4.64%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 333999,
            "range": "±4.66%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 353924,
            "range": "±4.6%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 319150,
            "range": "±4.91%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36044,
            "range": "±1.52%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1842,
            "range": "±3.53%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29643,
            "range": "±0.94%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2000,
            "range": "±1.74%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 29562,
            "range": "±1.84%",
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
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "548f358fdbaeba43be4a91aaec3b411a404ffb61",
          "message": "Merge pull request #1202 from napi-rs/misc\n\nMisc fix",
          "timestamp": "2022-06-04T01:56:41+08:00",
          "tree_id": "b52276693bbd52f601c000b2ff0ef9bcea973e27",
          "url": "https://github.com/napi-rs/napi-rs/commit/548f358fdbaeba43be4a91aaec3b411a404ffb61"
        },
        "date": 1654279404722,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55554627,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713679301,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18971890,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 711238235,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 399925,
            "range": "±9.13%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1624790,
            "range": "±5.85%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37083,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7650,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7633,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16819,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10325,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12291,
            "range": "±0.06%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 419381,
            "range": "±5.36%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 353885,
            "range": "±5.34%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 375850,
            "range": "±5.11%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 338322,
            "range": "±5.13%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38092,
            "range": "±1.4%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1680,
            "range": "±8.75%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 28358,
            "range": "±1.22%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1921,
            "range": "±1.41%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 28177,
            "range": "±1.19%",
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
          "id": "2e7f3affe1f95cd7c17899a6d94798ec567c5f79",
          "message": "Release independent packages\n\nnapi@2.5.0\nnapi-derive@2.5.0\nnapi-build@2.0.1",
          "timestamp": "2022-06-10T15:37:27+08:00",
          "tree_id": "28bf05052a26b52e20c25c0f900edf417ecfcbbd",
          "url": "https://github.com/napi-rs/napi-rs/commit/2e7f3affe1f95cd7c17899a6d94798ec567c5f79"
        },
        "date": 1654847540559,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 56144339,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 593019684,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19988017,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 592655338,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 458794,
            "range": "±6.58%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2078826,
            "range": "±3.29%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 44465,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8328,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8348,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 18100,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11100,
            "range": "±0.41%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12620,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 399132,
            "range": "±4.14%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 341506,
            "range": "±4.32%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 363599,
            "range": "±4.28%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 320392,
            "range": "±4.47%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38236,
            "range": "±1.23%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2543,
            "range": "±3.55%",
            "unit": "ops/sec",
            "extra": "49 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30806,
            "range": "±0.43%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2072,
            "range": "±0.4%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31145,
            "range": "±0.28%",
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
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "90184ef55274691531d5db06a712560096c420c6",
          "message": "Merge pull request #1209 from napi-rs/cli-template-upgrade\n\nfeat(cli): upgrade new project template to yarn3",
          "timestamp": "2022-06-10T18:22:40+08:00",
          "tree_id": "387b8cb1efb5b27f54bae08842ec0e67fec5499e",
          "url": "https://github.com/napi-rs/napi-rs/commit/90184ef55274691531d5db06a712560096c420c6"
        },
        "date": 1654856971409,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 47438668,
            "range": "±1.29%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 706202715,
            "range": "±0.7%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 17237694,
            "range": "±1.07%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 692861616,
            "range": "±1.13%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 340893,
            "range": "±10.02%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1899672,
            "range": "±5.29%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 35204,
            "range": "±0.91%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6724,
            "range": "±0.64%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6671,
            "range": "±0.96%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15505,
            "range": "±0.74%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 9096,
            "range": "±0.98%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10491,
            "range": "±1.09%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 371517,
            "range": "±5.17%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 306304,
            "range": "±5.18%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 328373,
            "range": "±5.14%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 289102,
            "range": "±5.09%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36149,
            "range": "±4.98%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1997,
            "range": "±4.61%",
            "unit": "ops/sec",
            "extra": "47 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24804,
            "range": "±2.29%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1769,
            "range": "±1.39%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 23090,
            "range": "±1.79%",
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
          "id": "df5bb1ae304cba7ae9e887007923747a383d5bcd",
          "message": "chore: publish\n\n - @napi-rs/cli@2.10.0",
          "timestamp": "2022-06-10T18:24:43+08:00",
          "tree_id": "b72870830715ee47cf972a8b356245c48d933d24",
          "url": "https://github.com/napi-rs/napi-rs/commit/df5bb1ae304cba7ae9e887007923747a383d5bcd"
        },
        "date": 1654857282229,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 39585077,
            "range": "±0.67%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 629678989,
            "range": "±0.71%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15120581,
            "range": "±1.38%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 626071641,
            "range": "±0.85%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 324224,
            "range": "±10.16%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1436809,
            "range": "±7.39%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 32708,
            "range": "±0.66%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6070,
            "range": "±0.89%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6064,
            "range": "±0.62%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13907,
            "range": "±0.75%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8428,
            "range": "±1%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9847,
            "range": "±0.76%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 324977,
            "range": "±5.32%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 264909,
            "range": "±5.68%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 271414,
            "range": "±5.33%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 247665,
            "range": "±6.42%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 32372,
            "range": "±5.67%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2284,
            "range": "±5.53%",
            "unit": "ops/sec",
            "extra": "43 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 21617,
            "range": "±3.73%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1604,
            "range": "±2.47%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 18801,
            "range": "±4.24%",
            "unit": "ops/sec",
            "extra": "71 samples"
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
          "id": "53a4759a47457a003e7cb79dca3c59c3181a886e",
          "message": "fix docker images",
          "timestamp": "2022-06-14T06:35:22Z",
          "tree_id": "242e8d413b043b87bdd6d10f2d43e7599c258baf",
          "url": "https://github.com/napi-rs/napi-rs/commit/53a4759a47457a003e7cb79dca3c59c3181a886e"
        },
        "date": 1655189047205,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55960221,
            "range": "±0.3%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 711825012,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18957830,
            "range": "±1.16%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710766503,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 386561,
            "range": "±10%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1779594,
            "range": "±6.84%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37069,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7603,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7542,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17080,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10048,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12032,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 399772,
            "range": "±5.66%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 349957,
            "range": "±5.51%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 356349,
            "range": "±5.07%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 332421,
            "range": "±5.62%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37371,
            "range": "±1.21%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1957,
            "range": "±22.99%",
            "unit": "ops/sec",
            "extra": "32 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29859,
            "range": "±0.58%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1977,
            "range": "±2.47%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 29366,
            "range": "±1.07%",
            "unit": "ops/sec",
            "extra": "71 samples"
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
          "id": "f879a05b7fa45decfa1df3e11527fefe15a9cace",
          "message": "ci: fix docker images",
          "timestamp": "2022-06-14T14:58:03+08:00",
          "tree_id": "1494147be05ce471fc969516300d4219831e3ebc",
          "url": "https://github.com/napi-rs/napi-rs/commit/f879a05b7fa45decfa1df3e11527fefe15a9cace"
        },
        "date": 1655201741971,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 60094804,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 593926418,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19837855,
            "range": "±0.53%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 592368516,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 449120,
            "range": "±7.08%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2033834,
            "range": "±3.86%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42593,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8492,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8527,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17998,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11071,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12812,
            "range": "±0.33%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 395120,
            "range": "±4.4%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 340300,
            "range": "±4.2%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 359244,
            "range": "±4.11%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 327258,
            "range": "±4.5%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37036,
            "range": "±0.81%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2394,
            "range": "±6.15%",
            "unit": "ops/sec",
            "extra": "47 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31004,
            "range": "±0.46%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2113,
            "range": "±1.49%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30784,
            "range": "±1.9%",
            "unit": "ops/sec",
            "extra": "88 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "jplatte+git@posteo.de",
            "name": "Jonas Platte",
            "username": "jplatte"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "7cf87eaf20d3fac367b07ab7a71698a101592aa4",
          "message": "chore(napi): replace lazy_static with once_cell (#1213)",
          "timestamp": "2022-06-25T11:19:45+08:00",
          "tree_id": "acb996b5ddbac8fed62d7de9e4b8e056b689d15b",
          "url": "https://github.com/napi-rs/napi-rs/commit/7cf87eaf20d3fac367b07ab7a71698a101592aa4"
        },
        "date": 1656127526411,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55874050,
            "range": "±0.22%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712839338,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19361186,
            "range": "±0.92%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 708218312,
            "range": "±0.55%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 385460,
            "range": "±9.47%",
            "unit": "ops/sec",
            "extra": "59 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1622377,
            "range": "±3.96%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37447,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7382,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7373,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16653,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10119,
            "range": "±0.44%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12060,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 408800,
            "range": "±6.13%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 343576,
            "range": "±6.1%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 366401,
            "range": "±6.04%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 339883,
            "range": "±6.24%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38200,
            "range": "±1.13%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2571,
            "range": "±4.3%",
            "unit": "ops/sec",
            "extra": "40 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29555,
            "range": "±1.93%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2025,
            "range": "±2.53%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 29802,
            "range": "±2.27%",
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
          "id": "496fc3e54ad58463c212fe912fed56551bc95a35",
          "message": "chore: add team members into FUNDING.yml",
          "timestamp": "2022-06-30T19:43:37+08:00",
          "tree_id": "bc6b347c294bc671605275d8f209205d0b872a8f",
          "url": "https://github.com/napi-rs/napi-rs/commit/496fc3e54ad58463c212fe912fed56551bc95a35"
        },
        "date": 1656589787830,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 43467058,
            "range": "±1.76%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 630609223,
            "range": "±0.91%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16057225,
            "range": "±1.33%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 626636437,
            "range": "±0.95%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 327852,
            "range": "±10.97%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1476872,
            "range": "±2.99%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 31862,
            "range": "±1.35%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 5907,
            "range": "±1.18%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 5946,
            "range": "±1.22%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14205,
            "range": "±0.88%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8289,
            "range": "±1.08%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9843,
            "range": "±0.98%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 332180,
            "range": "±5.88%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 285856,
            "range": "±5.8%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 303096,
            "range": "±5.66%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 267360,
            "range": "±5.7%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37958,
            "range": "±3.46%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2974,
            "range": "±4.18%",
            "unit": "ops/sec",
            "extra": "58 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 23339,
            "range": "±4.93%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1546,
            "range": "±3.05%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 20757,
            "range": "±2.53%",
            "unit": "ops/sec",
            "extra": "74 samples"
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
          "id": "dface0c6a73308d73a38958574087ee7b6e3c60f",
          "message": "Merge pull request #1200 from Hywan/feat-either-n-up-to-26\n\nfeat(napi) Implement `Either3` to `Either26`.",
          "timestamp": "2022-07-05T17:35:15+08:00",
          "tree_id": "855ac703a4f7677daf528e189d51b6e99552cbe8",
          "url": "https://github.com/napi-rs/napi-rs/commit/dface0c6a73308d73a38958574087ee7b6e3c60f"
        },
        "date": 1657014302434,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 56159316,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713905401,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19417095,
            "range": "±0.46%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 712514238,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 413983,
            "range": "±8.15%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1790282,
            "range": "±7.84%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38435,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7609,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7589,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17107,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10193,
            "range": "±0.39%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12428,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 416768,
            "range": "±5.95%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 355329,
            "range": "±5.38%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 370176,
            "range": "±5.41%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 348112,
            "range": "±5.45%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36148,
            "range": "±1.88%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1286,
            "range": "±32.49%",
            "unit": "ops/sec",
            "extra": "32 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30417,
            "range": "±1.5%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2150,
            "range": "±1.86%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31147,
            "range": "±1.88%",
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
          "id": "c3b59c8a12ee558c5168979c2de57e2689ba8d05",
          "message": "Merge pull request #1219 from napi-rs/return-if-invalid\n\nfeat(napi-derive): support return_if_invalid",
          "timestamp": "2022-07-05T20:07:57+08:00",
          "tree_id": "bb2236d45b464223571e32437089fc77396957a0",
          "url": "https://github.com/napi-rs/napi-rs/commit/c3b59c8a12ee558c5168979c2de57e2689ba8d05"
        },
        "date": 1657023383341,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55891197,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713449462,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19100444,
            "range": "±0.91%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 713563314,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 402010,
            "range": "±10.16%",
            "unit": "ops/sec",
            "extra": "62 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1861651,
            "range": "±9.07%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38632,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7695,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7653,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17031,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10304,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12430,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 416612,
            "range": "±5.43%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 354542,
            "range": "±5.14%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 368907,
            "range": "±5.25%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 343724,
            "range": "±5.8%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38713,
            "range": "±1.48%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1956,
            "range": "±28.4%",
            "unit": "ops/sec",
            "extra": "27 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 32016,
            "range": "±1.66%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2144,
            "range": "±2.33%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32326,
            "range": "±2.19%",
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
          "id": "20577a117fdaa51b3ca6cb4dcc66e2012a78fa4a",
          "message": "Merge pull request #1221 from napi-rs/inject-this\n\nfeat(napi-derive): allow injecting this in class method",
          "timestamp": "2022-07-06T11:16:28+08:00",
          "tree_id": "9ca03dce641993c0c9c97578360e968739447a23",
          "url": "https://github.com/napi-rs/napi-rs/commit/20577a117fdaa51b3ca6cb4dcc66e2012a78fa4a"
        },
        "date": 1657077827580,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 45752630,
            "range": "±0.38%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 602775608,
            "range": "±0.36%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16003332,
            "range": "±0.7%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 593317978,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 350956,
            "range": "±9.33%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1728891,
            "range": "±2.87%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 31343,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6445,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6450,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13983,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8913,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10378,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 352209,
            "range": "±5.39%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 310523,
            "range": "±5.55%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 332622,
            "range": "±5.34%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 297967,
            "range": "±5.46%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 28517,
            "range": "±2.08%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2238,
            "range": "±7.9%",
            "unit": "ops/sec",
            "extra": "34 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 25110,
            "range": "±2.51%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1791,
            "range": "±0.75%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 24476,
            "range": "±3.49%",
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
          "id": "1ac7fcf2ce3c5bd8ddda75b25f88d6339db8b354",
          "message": "Merge pull request #1223 from napi-rs/strict-check-optional\n\nfix(napi): validate fn for Option<T>",
          "timestamp": "2022-07-06T14:34:30+08:00",
          "tree_id": "81a419ebc317cee05e9a31641ca3e82b741910be",
          "url": "https://github.com/napi-rs/napi-rs/commit/1ac7fcf2ce3c5bd8ddda75b25f88d6339db8b354"
        },
        "date": 1657089661996,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55370765,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712816118,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19269678,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 709796982,
            "range": "±0.18%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 389266,
            "range": "±10.56%",
            "unit": "ops/sec",
            "extra": "60 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1643312,
            "range": "±4.51%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37170,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7666,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7656,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16614,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10605,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12360,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 413172,
            "range": "±5.84%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 346634,
            "range": "±5.71%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 366317,
            "range": "±5.59%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 344248,
            "range": "±5.82%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36714,
            "range": "±1.58%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2531,
            "range": "±18.19%",
            "unit": "ops/sec",
            "extra": "46 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31353,
            "range": "±1.3%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2069,
            "range": "±3.14%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31991,
            "range": "±2.32%",
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
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "2bc9218547a01f4b88a1c4589f972df4edfb4b41",
          "message": "Merge pull request #1224 from napi-rs/clone-ref\n\nfeat(napi): clone reference for TypedArray/Buffer",
          "timestamp": "2022-07-06T19:49:06+08:00",
          "tree_id": "12a39c7234cb20a2b5ac2b0166ecacc5a6479426",
          "url": "https://github.com/napi-rs/napi-rs/commit/2bc9218547a01f4b88a1c4589f972df4edfb4b41"
        },
        "date": 1657108493263,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 59753536,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 591759127,
            "range": "±0.5%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20069254,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 592140526,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 466899,
            "range": "±7.11%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2159698,
            "range": "±8.16%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 43311,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8307,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "100 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8271,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "100 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 18141,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11581,
            "range": "±0.07%",
            "unit": "ops/sec",
            "extra": "100 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12943,
            "range": "±0.34%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 397919,
            "range": "±4.39%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 348224,
            "range": "±4.4%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 368284,
            "range": "±4.2%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 332693,
            "range": "±4.35%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37310,
            "range": "±1.38%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 3940,
            "range": "±4.99%",
            "unit": "ops/sec",
            "extra": "39 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 33019,
            "range": "±0.72%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2182,
            "range": "±1.58%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 33259,
            "range": "±1.62%",
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
          "id": "60ed3ab474a8877fb2d239acce3035666fd3f298",
          "message": "Merge pull request #1225 from napi-rs/upgrade-dependencies\n\nchore(cli): upgrade npm dependencies",
          "timestamp": "2022-07-06T21:46:05+08:00",
          "tree_id": "0772548e5ce9406effe0b3a3c070f89325965305",
          "url": "https://github.com/napi-rs/napi-rs/commit/60ed3ab474a8877fb2d239acce3035666fd3f298"
        },
        "date": 1657115582257,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 56937274,
            "range": "±1.12%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 883071402,
            "range": "±1.31%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19778729,
            "range": "±1.39%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 913061048,
            "range": "±1.19%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 368210,
            "range": "±8.66%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1879465,
            "range": "±4.71%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42821,
            "range": "±1.18%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7620,
            "range": "±1.32%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7611,
            "range": "±1.13%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17760,
            "range": "±1.49%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10642,
            "range": "±1.53%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12526,
            "range": "±1.16%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 407059,
            "range": "±5.23%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 333747,
            "range": "±5.51%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 357582,
            "range": "±5.42%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 332464,
            "range": "±5.85%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 32025,
            "range": "±3.63%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1944,
            "range": "±9.11%",
            "unit": "ops/sec",
            "extra": "41 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 28840,
            "range": "±1.98%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1955,
            "range": "±2.08%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22745,
            "range": "±3.69%",
            "unit": "ops/sec",
            "extra": "74 samples"
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
          "id": "2d979866578994f98b20aa451e2e46dd92085fd2",
          "message": "chore: publish\n\n - @napi-rs/cli@2.10.1",
          "timestamp": "2022-07-06T23:32:26+08:00",
          "tree_id": "02710a38e0de86f70dc32b88d5a3850db745328f",
          "url": "https://github.com/napi-rs/napi-rs/commit/2d979866578994f98b20aa451e2e46dd92085fd2"
        },
        "date": 1657121851725,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 63411630,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 810134041,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 21968123,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 808410488,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 397365,
            "range": "±10.62%",
            "unit": "ops/sec",
            "extra": "57 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1681703,
            "range": "±4.55%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37809,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7711,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7661,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17217,
            "range": "±1.05%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11934,
            "range": "±0.06%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 14089,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 439372,
            "range": "±6.39%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 377563,
            "range": "±6.11%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 389815,
            "range": "±6.05%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 347643,
            "range": "±6.32%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 39061,
            "range": "±1.39%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1917,
            "range": "±12.55%",
            "unit": "ops/sec",
            "extra": "46 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 32719,
            "range": "±1.93%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1997,
            "range": "±2.38%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31405,
            "range": "±2.67%",
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
          "id": "661b418eb6173b8291b10968993a940a91eda689",
          "message": "Release independent packages\n\nnapi@2.6.0\nnapi-derive@2.6.0",
          "timestamp": "2022-07-06T23:33:50+08:00",
          "tree_id": "8f8e381b61ae6ae08d0c3a0bd373a536c62c743c",
          "url": "https://github.com/napi-rs/napi-rs/commit/661b418eb6173b8291b10968993a940a91eda689"
        },
        "date": 1657122239749,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 63649195,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 739066709,
            "range": "±1.13%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18850527,
            "range": "±1.07%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710218081,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 367126,
            "range": "±10.68%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1514280,
            "range": "±9.27%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36107,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7730,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7622,
            "range": "±0.18%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16880,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10479,
            "range": "±0.06%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12391,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 396651,
            "range": "±6.74%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 337270,
            "range": "±6.11%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 341838,
            "range": "±6.29%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 326091,
            "range": "±6.38%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 34700,
            "range": "±4.24%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2631,
            "range": "±3.06%",
            "unit": "ops/sec",
            "extra": "41 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31794,
            "range": "±2.32%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2019,
            "range": "±2.52%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31791,
            "range": "±2.42%",
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
          "id": "523bcc3068f949b62d3a98af26afb989953aba26",
          "message": "Merge pull request #1227 from napi-rs/buffer-drop\n\nfix(napi): drop buffer inner data only when Reference count is 0",
          "timestamp": "2022-07-07T00:14:20+08:00",
          "tree_id": "542da614df72021b853fe119f7118455a0d83a10",
          "url": "https://github.com/napi-rs/napi-rs/commit/523bcc3068f949b62d3a98af26afb989953aba26"
        },
        "date": 1657124335842,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 56121579,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713472329,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19105691,
            "range": "±0.57%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 711936692,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 411801,
            "range": "±8.79%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1859521,
            "range": "±6.3%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36457,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7729,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7630,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16928,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10473,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12415,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 417689,
            "range": "±5.53%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 352561,
            "range": "±5.28%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 376174,
            "range": "±5.68%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 347114,
            "range": "±5.46%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36393,
            "range": "±1.56%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1082,
            "range": "±25%",
            "unit": "ops/sec",
            "extra": "45 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30254,
            "range": "±2.22%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2007,
            "range": "±2.62%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31909,
            "range": "±0.66%",
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
          "id": "087b3ed594dd49e49b2b4d0c21424709e1ca0f97",
          "message": "Release independent packages\n\nnapi@2.6.1",
          "timestamp": "2022-07-07T00:17:02+08:00",
          "tree_id": "9834c46d7348aeb5078ded0fdf626b7c7e0dc154",
          "url": "https://github.com/napi-rs/napi-rs/commit/087b3ed594dd49e49b2b4d0c21424709e1ca0f97"
        },
        "date": 1657124704734,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 44424954,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 566069307,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15219002,
            "range": "±0.89%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 565138948,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 353903,
            "range": "±8.73%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1584739,
            "range": "±6.59%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 31283,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6161,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6078,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13808,
            "range": "±0.44%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8295,
            "range": "±0.03%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9884,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 349472,
            "range": "±5.22%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 308065,
            "range": "±5.05%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 327107,
            "range": "±5.11%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 285034,
            "range": "±5.56%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 28519,
            "range": "±1.31%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1469,
            "range": "±18.87%",
            "unit": "ops/sec",
            "extra": "30 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 25935,
            "range": "±1.49%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1759,
            "range": "±1.92%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 27014,
            "range": "±0.61%",
            "unit": "ops/sec",
            "extra": "80 samples"
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
          "id": "d0a9cbfa8642a3363ecc92188381a11f431d2841",
          "message": "Merge pull request #1228 from Hywan/fix-option-t-null\n\nfix(napi) `undefined` is recognized as a valid `None` for `Option<T>`",
          "timestamp": "2022-07-07T22:30:07+08:00",
          "tree_id": "f3415a4cbd6a37a76be32f4615704e68f7de86a8",
          "url": "https://github.com/napi-rs/napi-rs/commit/d0a9cbfa8642a3363ecc92188381a11f431d2841"
        },
        "date": 1657204503436,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 56093912,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713577613,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19339667,
            "range": "±1.01%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 707315291,
            "range": "±0.51%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 405851,
            "range": "±9.47%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1823512,
            "range": "±4.09%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38317,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7720,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7622,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17218,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10196,
            "range": "±0.95%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12510,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 416766,
            "range": "±4.96%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 353442,
            "range": "±4.92%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 381681,
            "range": "±4.95%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 342652,
            "range": "±5.47%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38164,
            "range": "±1.56%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 3716,
            "range": "±8.42%",
            "unit": "ops/sec",
            "extra": "44 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31699,
            "range": "±1.8%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2150,
            "range": "±1.87%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32103,
            "range": "±2.82%",
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
          "id": "71da74c9f0d49376d9f480d1b3f29d9dff222f87",
          "message": "Merge pull request #1230 from napi-rs/fix-tsfn-leak\n\nfix(napi): memory leak in ThreadsafeFunction",
          "timestamp": "2022-07-08T11:54:18+08:00",
          "tree_id": "dec0283017029ff4d8d6d8d235c8a030a385c43f",
          "url": "https://github.com/napi-rs/napi-rs/commit/71da74c9f0d49376d9f480d1b3f29d9dff222f87"
        },
        "date": 1657253053334,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 42948717,
            "range": "±1.49%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 692442232,
            "range": "±0.7%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 14247143,
            "range": "±1.57%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 711597101,
            "range": "±0.86%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 323048,
            "range": "±10.83%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1516618,
            "range": "±7.67%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 31867,
            "range": "±1.3%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 5933,
            "range": "±1.09%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 5775,
            "range": "±1.28%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13745,
            "range": "±1.14%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8178,
            "range": "±1.12%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9554,
            "range": "±1.65%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 315553,
            "range": "±6.15%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 273255,
            "range": "±5.81%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 290204,
            "range": "±5.68%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 261997,
            "range": "±5.77%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 25506,
            "range": "±3.55%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1670,
            "range": "±3.15%",
            "unit": "ops/sec",
            "extra": "50 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 20689,
            "range": "±3.22%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1624,
            "range": "±2.27%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 19593,
            "range": "±2.46%",
            "unit": "ops/sec",
            "extra": "79 samples"
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
          "id": "3eccf45439d9c682ea678ea9242d355d0f0e4b45",
          "message": "Release independent packages\n\nnapi@2.6.2",
          "timestamp": "2022-07-08T13:50:37+08:00",
          "tree_id": "89049e5208c519d59497237b5daf1ac9ff49c4e4",
          "url": "https://github.com/napi-rs/napi-rs/commit/3eccf45439d9c682ea678ea9242d355d0f0e4b45"
        },
        "date": 1657259743293,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 59939876,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 593607804,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20348455,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 592384876,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 473824,
            "range": "±6.74%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2114869,
            "range": "±4.81%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 43621,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8174,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8055,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 18103,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11685,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13121,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 405188,
            "range": "±4.14%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 342165,
            "range": "±4.07%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 373158,
            "range": "±4.04%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 327336,
            "range": "±4.16%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37988,
            "range": "±1.21%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2212,
            "range": "±2.47%",
            "unit": "ops/sec",
            "extra": "64 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 33262,
            "range": "±0.65%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2136,
            "range": "±1.94%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 33358,
            "range": "±1.64%",
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
          "id": "2f59c6ae91da6001d6a59ca948a553cb19b809c1",
          "message": "Merge pull request #1234 from napi-rs/mutex-in-tsfn",
          "timestamp": "2022-07-10T10:34:55+08:00",
          "tree_id": "f73cad376833524037f9ea71403d82abc39968a6",
          "url": "https://github.com/napi-rs/napi-rs/commit/2f59c6ae91da6001d6a59ca948a553cb19b809c1"
        },
        "date": 1657420983003,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 57720817,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 593889173,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19481668,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 592211488,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 448520,
            "range": "±6.92%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2028692,
            "range": "±8.15%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42831,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7835,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7947,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17289,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10748,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13339,
            "range": "±0.22%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 387948,
            "range": "±4.12%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 328710,
            "range": "±4.44%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 355580,
            "range": "±4.13%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 320919,
            "range": "±4.08%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38464,
            "range": "±1.1%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2507,
            "range": "±3.86%",
            "unit": "ops/sec",
            "extra": "49 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 32736,
            "range": "±1.24%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2163,
            "range": "±1.54%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32689,
            "range": "±1.87%",
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
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "40c132aefc7fe0bc466c3b06cdfdaddb4dec8416",
          "message": "Merge pull request #1235 from napi-rs/buffer-leak\n\nfix(napi): memory leak in Buffer/ArrayBuffer",
          "timestamp": "2022-07-11T21:48:42+08:00",
          "tree_id": "281ddc7e9a1447eb23a57af2ab757854d43bfaf4",
          "url": "https://github.com/napi-rs/napi-rs/commit/40c132aefc7fe0bc466c3b06cdfdaddb4dec8416"
        },
        "date": 1657547662873,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 50303922,
            "range": "±1.08%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 729137413,
            "range": "±0.97%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18287181,
            "range": "±0.96%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 739015653,
            "range": "±0.73%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 357912,
            "range": "±10.21%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1818596,
            "range": "±8.73%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 36177,
            "range": "±0.91%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6828,
            "range": "±0.79%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6782,
            "range": "±0.88%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16525,
            "range": "±0.81%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 9560,
            "range": "±1.18%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 11337,
            "range": "±1.23%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 349974,
            "range": "±5.83%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 311605,
            "range": "±5.75%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 323417,
            "range": "±5.75%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 298441,
            "range": "±5.84%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 45093,
            "range": "±1.35%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 3432,
            "range": "±4.65%",
            "unit": "ops/sec",
            "extra": "60 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29143,
            "range": "±3.21%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1827,
            "range": "±2.46%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 25008,
            "range": "±3.66%",
            "unit": "ops/sec",
            "extra": "79 samples"
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
          "id": "5b2bff79d4dd657dc0e547bf2cf5635bc504748b",
          "message": "Release independent packages\n\nnapi@2.6.3",
          "timestamp": "2022-07-11T21:54:02+08:00",
          "tree_id": "dcd34bd450d91701dd63b5c3fe0cc0037f112463",
          "url": "https://github.com/napi-rs/napi-rs/commit/5b2bff79d4dd657dc0e547bf2cf5635bc504748b"
        },
        "date": 1657548638299,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 47221737,
            "range": "±1.85%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 729557755,
            "range": "±0.71%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 17478975,
            "range": "±1.52%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 703494307,
            "range": "±1.09%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 335965,
            "range": "±10.7%",
            "unit": "ops/sec",
            "extra": "61 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1586688,
            "range": "±7.29%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 35273,
            "range": "±0.87%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6447,
            "range": "±0.65%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6425,
            "range": "±0.8%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15483,
            "range": "±0.89%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 7959,
            "range": "±0.9%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10124,
            "range": "±0.68%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 353163,
            "range": "±5.47%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 291366,
            "range": "±5.86%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 306063,
            "range": "±5.77%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 285949,
            "range": "±5.62%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 38276,
            "range": "±2.52%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 3910,
            "range": "±10.12%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 26794,
            "range": "±2.19%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1812,
            "range": "±2.62%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 23823,
            "range": "±1.35%",
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
          "id": "a5c9f12454c9de48584e292e5454b40742617aa5",
          "message": "Merge pull request #1247 from oyyd/fix\n\ndocs: fix typo",
          "timestamp": "2022-07-22T16:00:52+08:00",
          "tree_id": "88a32c1c11e50021dfe22d2d50dbfa11e15e395a",
          "url": "https://github.com/napi-rs/napi-rs/commit/a5c9f12454c9de48584e292e5454b40742617aa5"
        },
        "date": 1658477343837,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 57466195,
            "range": "±0.3%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 595899393,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20346120,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 594449601,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 433398,
            "range": "±6.75%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1793604,
            "range": "±5.01%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 44023,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7941,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7904,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17692,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10607,
            "range": "±0.07%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12554,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 380694,
            "range": "±4.32%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 323180,
            "range": "±4.72%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 345453,
            "range": "±4.56%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 317848,
            "range": "±4.5%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36762,
            "range": "±1.31%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 438,
            "range": "±8.57%",
            "unit": "ops/sec",
            "extra": "31 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31086,
            "range": "±1.46%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1829,
            "range": "±1.71%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 30864,
            "range": "±0.51%",
            "unit": "ops/sec",
            "extra": "82 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "kieseljake@live.com",
            "name": "Jacob Kiesel",
            "username": "Xaeroxe"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "1040c41760e456482047b2696d5c7147f43b5c1c",
          "message": "feat(napi): add some useful derived traits for the Null type (#1241)",
          "timestamp": "2022-07-22T23:45:02+08:00",
          "tree_id": "18d444ade6e7686afc70579bd4358e9d84a08129",
          "url": "https://github.com/napi-rs/napi-rs/commit/1040c41760e456482047b2696d5c7147f43b5c1c"
        },
        "date": 1658505833356,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55079782,
            "range": "±0.36%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 705621661,
            "range": "±0.45%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19034565,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 708729862,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 344911,
            "range": "±11.99%",
            "unit": "ops/sec",
            "extra": "55 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1445120,
            "range": "±6.38%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38537,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7743,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7676,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17187,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10259,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12124,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 382016,
            "range": "±6.22%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 344476,
            "range": "±6.07%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 335639,
            "range": "±5.81%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 326184,
            "range": "±6.52%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36191,
            "range": "±3.3%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1003,
            "range": "±23.4%",
            "unit": "ops/sec",
            "extra": "28 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 29808,
            "range": "±2.61%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1680,
            "range": "±1.66%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 29047,
            "range": "±2.79%",
            "unit": "ops/sec",
            "extra": "80 samples"
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
          "id": "ed5fd4083c16832d01ce7c843f6b3c2acf2290a4",
          "message": "fix(cli): upgrade freebsd ci",
          "timestamp": "2022-07-23T00:00:42+08:00",
          "tree_id": "8865cb4d9ba9328e4b30cbfded5e999bfb7e15d1",
          "url": "https://github.com/napi-rs/napi-rs/commit/ed5fd4083c16832d01ce7c843f6b3c2acf2290a4"
        },
        "date": 1658506336902,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 43492413,
            "range": "±1.43%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 618774068,
            "range": "±1.47%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15709669,
            "range": "±1.74%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 630486018,
            "range": "±1.15%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 310322,
            "range": "±11.84%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1406382,
            "range": "±11.35%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 32206,
            "range": "±1.19%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 5928,
            "range": "±1.04%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 5837,
            "range": "±1.2%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14308,
            "range": "±0.8%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8359,
            "range": "±0.84%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10143,
            "range": "±0.81%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 326076,
            "range": "±6.07%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 292602,
            "range": "±5.29%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 316391,
            "range": "±4.86%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 276701,
            "range": "±5.08%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 26825,
            "range": "±4.85%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1808,
            "range": "±10.33%",
            "unit": "ops/sec",
            "extra": "41 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 20561,
            "range": "±3.89%",
            "unit": "ops/sec",
            "extra": "56 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1363,
            "range": "±2.78%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 17955,
            "range": "±4.14%",
            "unit": "ops/sec",
            "extra": "70 samples"
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
          "id": "c8f946e4d574e8a4a9d2dd842d82a0829655cc00",
          "message": "chore: publish\n\n - @napi-rs/cli@2.10.2",
          "timestamp": "2022-07-23T00:01:17+08:00",
          "tree_id": "c232b27f401ec79c8b886f73e4f8beee834c0b24",
          "url": "https://github.com/napi-rs/napi-rs/commit/c8f946e4d574e8a4a9d2dd842d82a0829655cc00"
        },
        "date": 1658507067458,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 40952463,
            "range": "±2.07%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 646844765,
            "range": "±1.26%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16001461,
            "range": "±1.45%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 664698495,
            "range": "±1.1%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 312216,
            "range": "±11.33%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1337766,
            "range": "±7.79%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 33968,
            "range": "±1.12%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6227,
            "range": "±1%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6122,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14920,
            "range": "±0.96%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8653,
            "range": "±0.93%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10239,
            "range": "±1.05%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 335791,
            "range": "±5.24%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 280034,
            "range": "±5.38%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 289634,
            "range": "±5.43%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 261993,
            "range": "±5.7%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 28120,
            "range": "±5.15%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1763,
            "range": "±21.72%",
            "unit": "ops/sec",
            "extra": "37 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 28177,
            "range": "±3.6%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1344,
            "range": "±3.66%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 18873,
            "range": "±3.61%",
            "unit": "ops/sec",
            "extra": "73 samples"
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
          "id": "bb46793837d432bdc536255458bf63e8588966a8",
          "message": "chore: publish\n\n - @napi-rs/cli@2.10.3",
          "timestamp": "2022-07-27T14:40:36+08:00",
          "tree_id": "1736e0a858d9d8c3df206205cff8094307cfb211",
          "url": "https://github.com/napi-rs/napi-rs/commit/bb46793837d432bdc536255458bf63e8588966a8"
        },
        "date": 1658904264547,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55932142,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 594398193,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20752846,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 593704225,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 441320,
            "range": "±6.91%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2017475,
            "range": "±4.46%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42747,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7906,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7905,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17438,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11594,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "100 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13147,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 387405,
            "range": "±4.2%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 338023,
            "range": "±4.15%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 361170,
            "range": "±4.08%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 322187,
            "range": "±4.18%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36007,
            "range": "±1.05%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2603,
            "range": "±8.7%",
            "unit": "ops/sec",
            "extra": "40 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31414,
            "range": "±0.58%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2137,
            "range": "±1.64%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32105,
            "range": "±1.74%",
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
          "id": "037d96060749b47c09b342978eaeaa37ffe5586e",
          "message": "ci: fix self testing for Android platforms (#1248)",
          "timestamp": "2022-07-27T15:25:28+08:00",
          "tree_id": "c4d81ea5c7c49e0ef941f8c620b2fb6c63ef1bea",
          "url": "https://github.com/napi-rs/napi-rs/commit/037d96060749b47c09b342978eaeaa37ffe5586e"
        },
        "date": 1658907202429,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 60209618,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 594273588,
            "range": "±0.19%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20852045,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 595042638,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 431714,
            "range": "±6.99%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2011842,
            "range": "±1.96%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 43003.8,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7933,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7933.2,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17496,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11458,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12825,
            "range": "±0.37%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 389951,
            "range": "±4.79%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 334612,
            "range": "±4.61%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 357248,
            "range": "±4.38%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 318091,
            "range": "±4.76%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 34511,
            "range": "±1.3%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2050,
            "range": "±4.45%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31181,
            "range": "±0.57%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2102,
            "range": "±2.09%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31418,
            "range": "±1.88%",
            "unit": "ops/sec",
            "extra": "71 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "git@seri.tools",
            "name": "Dennis Duda",
            "username": "seritools"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "a9a62f225e6b789e16a420bf2d819b6c1421861d",
          "message": "feat(napi): add derived traits to `ThreadsafeFunctionCallMode` (#1243)\n\nThis makes it possible to reuse the same value, e.g. when writing utility/helper functions.",
          "timestamp": "2022-07-31T15:29:26+08:00",
          "tree_id": "c5fc34e1812d72cd972afdde83d6aa9d5d18747b",
          "url": "https://github.com/napi-rs/napi-rs/commit/a9a62f225e6b789e16a420bf2d819b6c1421861d"
        },
        "date": 1659253049917,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 43234879,
            "range": "±0.92%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 653817645,
            "range": "±0.63%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15790692,
            "range": "±1.44%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 651217698,
            "range": "±0.58%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 361159,
            "range": "±9.61%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1719540,
            "range": "±10.05%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 33538,
            "range": "±1.06%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6047,
            "range": "±0.61%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 5986,
            "range": "±0.89%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14473,
            "range": "±1.12%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8325,
            "range": "±0.82%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10142,
            "range": "±0.92%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 345695,
            "range": "±5.32%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 310935,
            "range": "±5.08%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 318391,
            "range": "±5.09%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 289568,
            "range": "±5.09%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 40123,
            "range": "±2.36%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2302,
            "range": "±3.75%",
            "unit": "ops/sec",
            "extra": "55 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 28834,
            "range": "±2.47%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1713,
            "range": "±2.54%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22630,
            "range": "±3.94%",
            "unit": "ops/sec",
            "extra": "75 samples"
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
          "id": "6aeb116eb9744f3a8a7e1d68b1da8da57d197ea2",
          "message": "ci: tweak changes for Dockerfiles",
          "timestamp": "2022-07-31T08:49:12Z",
          "tree_id": "00932bc2e98697b6c3f2a74f1809579b0c6c5801",
          "url": "https://github.com/napi-rs/napi-rs/commit/6aeb116eb9744f3a8a7e1d68b1da8da57d197ea2"
        },
        "date": 1659257785934,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55153578,
            "range": "±0.37%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712641045,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18265277,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710961321,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 410500,
            "range": "±8.51%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1902480,
            "range": "±2.1%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38914,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7684,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7665,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17136,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10150,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12052,
            "range": "±0.07%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 409144,
            "range": "±5.75%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 344313,
            "range": "±5.38%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 363538,
            "range": "±5.19%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 343878,
            "range": "±5.53%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 35907,
            "range": "±1.14%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2433,
            "range": "±10.06%",
            "unit": "ops/sec",
            "extra": "35 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31122,
            "range": "±1.62%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2016,
            "range": "±2.18%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32088,
            "range": "±1.94%",
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
          "id": "e30019aa5ce6257fc835546ade9a3c0e399b0262",
          "message": "chore(napi): update ci template",
          "timestamp": "2022-07-31T18:01:47+08:00",
          "tree_id": "cd46cedf53fdece0f5ceb8b8846f5d32056de1d5",
          "url": "https://github.com/napi-rs/napi-rs/commit/e30019aa5ce6257fc835546ade9a3c0e399b0262"
        },
        "date": 1659262226100,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 57749132,
            "range": "±0.36%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 592703785,
            "range": "±0.5%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20220770,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 592817067,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 447943,
            "range": "±7.44%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1978220,
            "range": "±2.06%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 44340,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7983,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7970,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17514,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11078,
            "range": "±0.07%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13135,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 386452,
            "range": "±3.87%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 335248,
            "range": "±4.13%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 356627,
            "range": "±3.89%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 318333,
            "range": "±4.04%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37525,
            "range": "±0.84%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2801,
            "range": "±5.7%",
            "unit": "ops/sec",
            "extra": "40 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 32783,
            "range": "±0.83%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2069,
            "range": "±1.8%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 33029,
            "range": "±1.03%",
            "unit": "ops/sec",
            "extra": "69 samples"
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
          "id": "cb6fffd73fce69afc3bb3b116729561c17e476b8",
          "message": "feat(cli): support npmClient config (#1253)",
          "timestamp": "2022-07-31T20:43:25+08:00",
          "tree_id": "671acc4a16714d862cf0a3a5674481b243bbb9e5",
          "url": "https://github.com/napi-rs/napi-rs/commit/cb6fffd73fce69afc3bb3b116729561c17e476b8"
        },
        "date": 1659271934346,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 45089006,
            "range": "±1.02%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 757305491,
            "range": "±1.01%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 14738450,
            "range": "±1.63%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 748326331,
            "range": "±1.13%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 321816,
            "range": "±10.92%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1646716,
            "range": "±6.94%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 34473,
            "range": "±0.9%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6232,
            "range": "±0.84%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6213,
            "range": "±1.02%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 15217,
            "range": "±0.82%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8634,
            "range": "±0.89%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10402,
            "range": "±0.86%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 359149,
            "range": "±5.66%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 315994,
            "range": "±6.1%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 325013,
            "range": "±6.01%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 288982,
            "range": "±5.78%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 29962,
            "range": "±3.79%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2135,
            "range": "±5.09%",
            "unit": "ops/sec",
            "extra": "46 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 23314,
            "range": "±5.14%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1631,
            "range": "±2.43%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 21594,
            "range": "±2.37%",
            "unit": "ops/sec",
            "extra": "81 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "amr.bashir2015@gmail.com",
            "name": "Amr Bashir",
            "username": "amrbashir"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "9be7ae2bf90aa1de32c0787e80661178642f4861",
          "message": "feat(cli): use `CARGO_TARGET_DIR` if set (#1251)\n\n* feat: use `CARGO_TARGET_DIR` if set\r\n\r\n* use `||` instead of `??`\r\n\r\n* use `CARGO_BUILD_TARGET_DIR` also if set\r\n\r\n* disable eslint prefer-nullish-coalescing",
          "timestamp": "2022-07-31T22:41:32+08:00",
          "tree_id": "854c27bd4724f92ec106b70202f803346ddb2591",
          "url": "https://github.com/napi-rs/napi-rs/commit/9be7ae2bf90aa1de32c0787e80661178642f4861"
        },
        "date": 1659278719422,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 59259462,
            "range": "±0.5%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 591245913,
            "range": "±0.22%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20791618,
            "range": "±0.51%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 593409145,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 446989,
            "range": "±6.42%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2205808,
            "range": "±1.72%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 44045,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7985,
            "range": "±0.08%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7965,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17619,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10890,
            "range": "±0.3%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13007,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 390331,
            "range": "±3.88%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 339128,
            "range": "±4.04%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 358561,
            "range": "±4.15%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 320971,
            "range": "±4.16%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36424,
            "range": "±0.91%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2386,
            "range": "±9.3%",
            "unit": "ops/sec",
            "extra": "43 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31408,
            "range": "±0.58%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2080,
            "range": "±1.52%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31941,
            "range": "±1.69%",
            "unit": "ops/sec",
            "extra": "83 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "amr.bashir2015@gmail.com",
            "name": "Amr Bashir",
            "username": "amrbashir"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "0e75c59f0e957a52de6e2a944eecbbf7346cb835",
          "message": "chore: improve `*.node` doesn't exist warning msg (#1254)",
          "timestamp": "2022-08-03T08:01:15+08:00",
          "tree_id": "5b19698689aff4d68d30d467813d217ef2bb6dff",
          "url": "https://github.com/napi-rs/napi-rs/commit/0e75c59f0e957a52de6e2a944eecbbf7346cb835"
        },
        "date": 1659485404166,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 58331888,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 592743111,
            "range": "±0.45%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20817829,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 593086776,
            "range": "±0.2%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 451965,
            "range": "±6.76%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2105044,
            "range": "±1.7%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 43375,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7961,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7993,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17644,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11570,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13053,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 394267,
            "range": "±4.1%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 338549,
            "range": "±4.03%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 362766,
            "range": "±3.95%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 319842,
            "range": "±4.14%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36758,
            "range": "±1.55%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2155,
            "range": "±5.6%",
            "unit": "ops/sec",
            "extra": "56 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 32006,
            "range": "±1.32%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2162,
            "range": "±1.55%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 33109,
            "range": "±0.36%",
            "unit": "ops/sec",
            "extra": "85 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "amr.bashir2015@gmail.com",
            "name": "Amr Bashir",
            "username": "amrbashir"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "3d2ca943924f0af8033375bb3bd4220d47c1fbc9",
          "message": "feat(cli): add an option to specify the github release name (#1255)",
          "timestamp": "2022-08-04T00:10:51+08:00",
          "tree_id": "d55ad4e0710f0a89527c26642761d9791bc8aee6",
          "url": "https://github.com/napi-rs/napi-rs/commit/3d2ca943924f0af8033375bb3bd4220d47c1fbc9"
        },
        "date": 1659543576670,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 60358865,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 594356938,
            "range": "±0.69%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20708543,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 594586505,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 429800,
            "range": "±7.07%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1961585,
            "range": "±2.24%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42475,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8093,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7864,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17754,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11056,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12828,
            "range": "±0.68%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 389357,
            "range": "±4.66%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 330178,
            "range": "±4.72%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 351203,
            "range": "±4.9%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 313816,
            "range": "±4.43%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36966,
            "range": "±1.64%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2507,
            "range": "±8.21%",
            "unit": "ops/sec",
            "extra": "48 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 32625,
            "range": "±0.67%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2164,
            "range": "±1.6%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32813,
            "range": "±1.74%",
            "unit": "ops/sec",
            "extra": "85 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "kieseljake@live.com",
            "name": "Jacob Kiesel",
            "username": "Xaeroxe"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "94e8e54b38a475908452d23ec06e8b715d07ebb0",
          "message": "feat(napi): call sync functions within tokio runtime (#1242)",
          "timestamp": "2022-08-04T00:12:35+08:00",
          "tree_id": "f2bb680ba67bacda0912ebc949fc4ca121c43f99",
          "url": "https://github.com/napi-rs/napi-rs/commit/94e8e54b38a475908452d23ec06e8b715d07ebb0"
        },
        "date": 1659544277077,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 59279900,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 592115343,
            "range": "±0.34%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19437938,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 590860413,
            "range": "±0.37%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 430460,
            "range": "±7.17%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2249626,
            "range": "±0.97%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42310,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 8081,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7867,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17752,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11061,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13069,
            "range": "±0.23%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 387869,
            "range": "±4.35%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 327163,
            "range": "±4.52%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 359172,
            "range": "±4.34%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 324446,
            "range": "±4.37%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 37249,
            "range": "±1.4%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2323,
            "range": "±8.35%",
            "unit": "ops/sec",
            "extra": "47 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 32496,
            "range": "±0.6%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2190,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32765,
            "range": "±2.1%",
            "unit": "ops/sec",
            "extra": "87 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "amr.bashir2015@gmail.com",
            "name": "Amr Bashir",
            "username": "amrbashir"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "b54e6982377a1aa2a5c62c28aac2f601c53c3810",
          "message": "feat(cli): allow specifying an existing release (#1256)",
          "timestamp": "2022-08-04T12:12:18+08:00",
          "tree_id": "54bae3e544a2f18beff05e8953140ae8bd637c17",
          "url": "https://github.com/napi-rs/napi-rs/commit/b54e6982377a1aa2a5c62c28aac2f601c53c3810"
        },
        "date": 1659586749772,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 60269446,
            "range": "±0.29%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 595367216,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20510342,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 594654911,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 427732,
            "range": "±6.99%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1889114,
            "range": "±7.26%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42691,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7818,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7788,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17481,
            "range": "±0.36%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10489,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12616,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 385274,
            "range": "±4.72%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 335625,
            "range": "±4.73%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 353786,
            "range": "±4.72%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 309344,
            "range": "±4.43%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36846,
            "range": "±0.9%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2011,
            "range": "±5.59%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 32033,
            "range": "±0.63%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2152,
            "range": "±1.76%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32157,
            "range": "±1.71%",
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
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "0f14799776e0335a08f1c0b1cce973bf7c0fd353",
          "message": "feat(napi-derive): support set property attribute in napi macro (#1257)",
          "timestamp": "2022-08-06T21:54:58+08:00",
          "tree_id": "f604f801a5134adc0822c7f7daee51d0cab8b638",
          "url": "https://github.com/napi-rs/napi-rs/commit/0f14799776e0335a08f1c0b1cce973bf7c0fd353"
        },
        "date": 1659794661072,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 57458247,
            "range": "±0.24%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 592776501,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20618549,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 592424258,
            "range": "±0.22%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 448302,
            "range": "±6.51%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2043645,
            "range": "±5.28%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 43307,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7930,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7841,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "100 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17753,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11057,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13030,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 389104,
            "range": "±4.2%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 342689,
            "range": "±4.12%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 365554,
            "range": "±4%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 321073,
            "range": "±4.14%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 35008,
            "range": "±1.7%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2495,
            "range": "±8.65%",
            "unit": "ops/sec",
            "extra": "41 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31157,
            "range": "±1.23%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2068,
            "range": "±1.59%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32274,
            "range": "±0.39%",
            "unit": "ops/sec",
            "extra": "89 samples"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "ivan@mnt.io",
            "name": "Ivan Enderlin",
            "username": "Hywan"
          },
          "committer": {
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "6a9fdba8b655be97c2ae39c534ca7cb868df0af8",
          "message": "feat(napi-derive) Support `#[napi(strict)]` on `&T` and `&mut T`. (#1238)",
          "timestamp": "2022-08-06T21:55:35+08:00",
          "tree_id": "a6f6f18023fed024a87f87b5199e287d5e9e11da",
          "url": "https://github.com/napi-rs/napi-rs/commit/6a9fdba8b655be97c2ae39c534ca7cb868df0af8"
        },
        "date": 1659795387058,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 43608771,
            "range": "±1.04%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 746792764,
            "range": "±1.33%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16678151,
            "range": "±1.01%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 781396332,
            "range": "±0.81%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 345401,
            "range": "±8.95%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1807560,
            "range": "±2.92%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 35473,
            "range": "±0.85%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6287,
            "range": "±0.93%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6216,
            "range": "±0.92%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14458,
            "range": "±1.05%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8724,
            "range": "±0.57%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10302,
            "range": "±0.71%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 345510,
            "range": "±5.49%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 275607,
            "range": "±5.91%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 294058,
            "range": "±5.61%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 271665,
            "range": "±5.43%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 30852,
            "range": "±2.55%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2001,
            "range": "±4.43%",
            "unit": "ops/sec",
            "extra": "49 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24040,
            "range": "±2.15%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1669,
            "range": "±2.34%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 23204,
            "range": "±2.52%",
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
          "id": "cb9239d8dc14a2c79ceeb456e8318f3d635d8bb2",
          "message": "fix(napi): either for #[napi(object)] types (#1258)",
          "timestamp": "2022-08-07T01:16:28+08:00",
          "tree_id": "ec1cb2dacc4f323e73c1df7356f73f668ab7b5ad",
          "url": "https://github.com/napi-rs/napi-rs/commit/cb9239d8dc14a2c79ceeb456e8318f3d635d8bb2"
        },
        "date": 1659806449228,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 57880723,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 592806158,
            "range": "±0.52%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20594846,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 591689447,
            "range": "±0.51%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 445865,
            "range": "±6.92%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2052222,
            "range": "±1.26%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 43182,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7945,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7839,
            "range": "±0.36%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17733,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11185,
            "range": "±0.06%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12621,
            "range": "±0.21%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 387054,
            "range": "±4.15%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 336193,
            "range": "±4.07%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 358908,
            "range": "±3.92%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 314584,
            "range": "±4.13%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 35879,
            "range": "±0.84%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2140,
            "range": "±7.44%",
            "unit": "ops/sec",
            "extra": "53 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31681,
            "range": "±0.63%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2075,
            "range": "±1.73%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32180,
            "range": "±1.89%",
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
          "id": "a0c7176693518c8ef4dc0f54a5ae34550339fdb5",
          "message": "Release independent packages\n\n- napi@2.7.0\n- napi-derive@2.7.0",
          "timestamp": "2022-08-07T12:51:15+08:00",
          "tree_id": "e6f3658b19ece7b1704b8423d2b2325ff7b8abb4",
          "url": "https://github.com/napi-rs/napi-rs/commit/a0c7176693518c8ef4dc0f54a5ae34550339fdb5"
        },
        "date": 1659848245367,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 58711369,
            "range": "±1.76%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 982271272,
            "range": "±0.79%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 21745670,
            "range": "±1.1%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 980270919,
            "range": "±0.81%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 403407,
            "range": "±8.25%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2223655,
            "range": "±2.36%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 44350,
            "range": "±1.07%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7779,
            "range": "±1.01%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7942,
            "range": "±0.7%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 19195,
            "range": "±0.59%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10819,
            "range": "±0.67%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13389,
            "range": "±0.62%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 444136,
            "range": "±5.27%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 375723,
            "range": "±5.39%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 391110,
            "range": "±5.29%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 360630,
            "range": "±5.03%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 33865,
            "range": "±3.57%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2179,
            "range": "±12.83%",
            "unit": "ops/sec",
            "extra": "44 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 30267,
            "range": "±1.68%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2081,
            "range": "±0.96%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 26907,
            "range": "±2.84%",
            "unit": "ops/sec",
            "extra": "80 samples"
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
          "id": "b8f96d517db224b39bb25f6defe9464fa37784e7",
          "message": "chore: publish\n\n@napi-rs/cli@2.11.0",
          "timestamp": "2022-08-07T16:08:34+08:00",
          "tree_id": "c128d0d1bca6866af55b1c8d14857fe129d31f63",
          "url": "https://github.com/napi-rs/napi-rs/commit/b8f96d517db224b39bb25f6defe9464fa37784e7"
        },
        "date": 1659860309634,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 46341653,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 604300492,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15810265,
            "range": "±0.45%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 607377102,
            "range": "±0.29%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 350278,
            "range": "±10.36%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1530858,
            "range": "±7.4%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 33322,
            "range": "±0.33%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6468,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6438,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14609,
            "range": "±0.47%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8616,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10271,
            "range": "±0.29%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 364231,
            "range": "±5.63%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 309964,
            "range": "±5.82%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 321456,
            "range": "±5.56%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 301067,
            "range": "±5.57%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 27082,
            "range": "±5.59%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1030,
            "range": "±20.34%",
            "unit": "ops/sec",
            "extra": "49 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24151,
            "range": "±2.31%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1778,
            "range": "±2.28%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 24044,
            "range": "±2.94%",
            "unit": "ops/sec",
            "extra": "70 samples"
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
          "id": "4412c28c6d628553a400d9181d11e8e4efcebe2c",
          "message": "chore(napi): enhance error message when unwrap failed from JsObject (#1259)",
          "timestamp": "2022-08-07T23:05:49+08:00",
          "tree_id": "3a8130dcda5cb85d7b5b8ee431cb90b1192fe5f1",
          "url": "https://github.com/napi-rs/napi-rs/commit/4412c28c6d628553a400d9181d11e8e4efcebe2c"
        },
        "date": 1659885050311,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 45909196,
            "range": "±1.59%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 747705576,
            "range": "±0.93%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16621588,
            "range": "±1.44%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 754665519,
            "range": "±0.87%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 321311,
            "range": "±10.65%",
            "unit": "ops/sec",
            "extra": "66 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1480534,
            "range": "±6.62%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 34645,
            "range": "±0.78%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6003,
            "range": "±0.77%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6121,
            "range": "±0.84%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14487,
            "range": "±0.78%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8455,
            "range": "±0.84%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9898,
            "range": "±0.93%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 337518,
            "range": "±5.74%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 290898,
            "range": "±5.88%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 302620,
            "range": "±5.79%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 284461,
            "range": "±5.18%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 31204,
            "range": "±4.83%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1871,
            "range": "±4.14%",
            "unit": "ops/sec",
            "extra": "51 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24397,
            "range": "±2.25%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1596,
            "range": "±4.63%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 21177,
            "range": "±2.23%",
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
          "id": "4cd1c3aaf84f3d5e0b3b16bb106add360105be6b",
          "message": "chore: publish\n\n - @napi-rs/cli@2.11.1",
          "timestamp": "2022-08-09T13:26:02+08:00",
          "tree_id": "0b8b940532337766303cbdb6651ca42c36212ed5",
          "url": "https://github.com/napi-rs/napi-rs/commit/4cd1c3aaf84f3d5e0b3b16bb106add360105be6b"
        },
        "date": 1660023039346,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 58882390,
            "range": "±4.43%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 595624397,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20882073,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 593387979,
            "range": "±0.25%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 445009,
            "range": "±7.42%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2137849,
            "range": "±1.88%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 42875,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7942,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7845,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17616,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11045,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12522,
            "range": "±0.38%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 383198,
            "range": "±4.14%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 339112,
            "range": "±4.15%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 361433,
            "range": "±4.03%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 328185,
            "range": "±4.03%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36082,
            "range": "±1.38%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2033,
            "range": "±3.7%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 32156,
            "range": "±0.71%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2120,
            "range": "±0.28%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 33060,
            "range": "±0.5%",
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
            "email": "lynweklm@gmail.com",
            "name": "LongYinan",
            "username": "Brooooooklyn"
          },
          "distinct": true,
          "id": "c6aeb06e04158a40f89a9f19a1c480e5522db599",
          "message": "chore: publish\n\n - @napi-rs/cli@2.11.2",
          "timestamp": "2022-08-12T13:26:17+08:00",
          "tree_id": "78a300afb2e05e9567a502a6a156e47e09d45cfb",
          "url": "https://github.com/napi-rs/napi-rs/commit/c6aeb06e04158a40f89a9f19a1c480e5522db599"
        },
        "date": 1660282287496,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55277030,
            "range": "±0.33%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 713876900,
            "range": "±0.12%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19268037,
            "range": "±0.65%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 712684179,
            "range": "±0.48%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 399338,
            "range": "±10.22%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1881220,
            "range": "±6.02%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38222,
            "range": "±0.18%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7520,
            "range": "±0.17%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7629,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17471,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 9975,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12154,
            "range": "±0.04%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 415172,
            "range": "±5.33%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 346570,
            "range": "±5.52%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 357537,
            "range": "±5.35%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 353325,
            "range": "±5.25%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36465,
            "range": "±0.94%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2108,
            "range": "±13.63%",
            "unit": "ops/sec",
            "extra": "34 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31141,
            "range": "±0.64%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2138,
            "range": "±2.03%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32095,
            "range": "±0.53%",
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
          "id": "aad4712e0f5dfb3ed8ffa8b7be4b9c015b829f9e",
          "message": "chore: publish\n\n - @napi-rs/cli@2.11.3",
          "timestamp": "2022-08-12T16:20:22+08:00",
          "tree_id": "7dc6ddf1be0edb5e10c97374049a343d8ed8a184",
          "url": "https://github.com/napi-rs/napi-rs/commit/aad4712e0f5dfb3ed8ffa8b7be4b9c015b829f9e"
        },
        "date": 1660292776235,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 46954061,
            "range": "±0.5%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 607508347,
            "range": "±0.33%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16159898,
            "range": "±1.01%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 604099885,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 358151,
            "range": "±9.35%",
            "unit": "ops/sec",
            "extra": "60 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1545313,
            "range": "±3.64%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 32614,
            "range": "±0.37%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6512,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6525,
            "range": "±0.26%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14881,
            "range": "±0.38%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8498,
            "range": "±0.27%",
            "unit": "ops/sec",
            "extra": "94 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10408,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 362941,
            "range": "±5.64%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 312114,
            "range": "±5.66%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 332301,
            "range": "±5.78%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 308567,
            "range": "±5.51%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 29445,
            "range": "±1.38%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1323,
            "range": "±18.76%",
            "unit": "ops/sec",
            "extra": "34 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 25925,
            "range": "±1.83%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1763,
            "range": "±2.82%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 27235,
            "range": "±1.3%",
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
          "id": "2d2e4425b4e718d67060d089d4a72b620cbfda76",
          "message": "Merge pull request #1266 from napi-rs/zig-cross-fix\n\nfix(cli): zig cross to *-apple-darwin target",
          "timestamp": "2022-08-12T17:39:49+08:00",
          "tree_id": "e0e242b8572f6f2755d981db009f28c420ff4dab",
          "url": "https://github.com/napi-rs/napi-rs/commit/2d2e4425b4e718d67060d089d4a72b620cbfda76"
        },
        "date": 1660297841209,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 55248194,
            "range": "±0.43%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 712816854,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 19188307,
            "range": "±0.47%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 711325100,
            "range": "±0.18%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 413976,
            "range": "±8.33%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1859897,
            "range": "±2.81%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 38277,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7683,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7694,
            "range": "±0.32%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17390,
            "range": "±0.13%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10055,
            "range": "±0.36%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12165,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 423465,
            "range": "±5.62%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 360973,
            "range": "±5.05%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 376550,
            "range": "±4.94%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 347640,
            "range": "±5.65%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36131,
            "range": "±0.92%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2372,
            "range": "±13.28%",
            "unit": "ops/sec",
            "extra": "37 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31415,
            "range": "±2%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2125,
            "range": "±0.31%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 32111,
            "range": "±1.96%",
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
          "id": "8784ed9459942d4d0251d6bc7755c1eaaefc8595",
          "message": "Merge pull request #1265 from liby/feature/update-ci-template\n\nchore(napi): use recommended `vmactions/freebsd-vm@v0`",
          "timestamp": "2022-08-12T17:40:10+08:00",
          "tree_id": "bb871c174d3ea7595e118bf253a0ef397bb798a4",
          "url": "https://github.com/napi-rs/napi-rs/commit/8784ed9459942d4d0251d6bc7755c1eaaefc8595"
        },
        "date": 1660298534361,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 42706265,
            "range": "±2.29%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 703525423,
            "range": "±1.21%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15386391,
            "range": "±1.81%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 714356822,
            "range": "±0.87%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 308061,
            "range": "±11.09%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1395694,
            "range": "±5.8%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 33102,
            "range": "±1.07%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 5883,
            "range": "±0.84%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 5873,
            "range": "±0.61%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14571,
            "range": "±0.99%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8252,
            "range": "±1.02%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10288,
            "range": "±1%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 325006,
            "range": "±5.33%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 290526,
            "range": "±5.95%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 300158,
            "range": "±5.93%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 268669,
            "range": "±5.76%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 33135,
            "range": "±2.87%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1884,
            "range": "±3.11%",
            "unit": "ops/sec",
            "extra": "53 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 24536,
            "range": "±2.04%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1721,
            "range": "±2.42%",
            "unit": "ops/sec",
            "extra": "82 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 22360,
            "range": "±3.66%",
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
          "id": "6bd682279d0c052e107aa94d979c995f68c52080",
          "message": "Merge pull request #1263 from xhuz/main\n\nfeat(napi): support rust array to js array",
          "timestamp": "2022-08-12T21:04:43+08:00",
          "tree_id": "1add51f338fffca2dc9f94aae45d9e6174cefa48",
          "url": "https://github.com/napi-rs/napi-rs/commit/6bd682279d0c052e107aa94d979c995f68c52080"
        },
        "date": 1660309829549,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 44120404,
            "range": "±1.09%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 642645310,
            "range": "±0.85%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 16001237,
            "range": "±0.6%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 641455264,
            "range": "±0.59%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 310085,
            "range": "±10.85%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1550750,
            "range": "±2.83%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 34148,
            "range": "±0.68%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 5973,
            "range": "±0.7%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6033,
            "range": "±0.6%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13908,
            "range": "±0.79%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8176,
            "range": "±0.81%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10041,
            "range": "±0.79%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 332105,
            "range": "±5.49%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 283530,
            "range": "±6.04%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 295866,
            "range": "±5.44%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 264703,
            "range": "±5.4%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 29145,
            "range": "±3.54%",
            "unit": "ops/sec",
            "extra": "62 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1967,
            "range": "±5.81%",
            "unit": "ops/sec",
            "extra": "45 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 25399,
            "range": "±3.73%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1743,
            "range": "±3.21%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 19830,
            "range": "±3.6%",
            "unit": "ops/sec",
            "extra": "65 samples"
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
          "id": "304bddeae97fe4bd93ae08cf48b86972c846b059",
          "message": "chore: publish\n\n - @napi-rs/cli@2.11.4",
          "timestamp": "2022-08-13T01:11:37+08:00",
          "tree_id": "1423e02d28cbe1507d1990901e0d3ad88e24d2d8",
          "url": "https://github.com/napi-rs/napi-rs/commit/304bddeae97fe4bd93ae08cf48b86972c846b059"
        },
        "date": 1660325042418,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 54729411,
            "range": "±0.81%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 711637737,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 18793141,
            "range": "±0.55%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 710009659,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 385358,
            "range": "±9.77%",
            "unit": "ops/sec",
            "extra": "65 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1694879,
            "range": "±4.11%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 37898,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7668,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 7695,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "99 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 17286,
            "range": "±0.43%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 10071,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 12169,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 400030,
            "range": "±6.31%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 333469,
            "range": "±5.98%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 349987,
            "range": "±6.13%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 344553,
            "range": "±6.34%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36828,
            "range": "±0.86%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1225,
            "range": "±21.95%",
            "unit": "ops/sec",
            "extra": "49 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31043,
            "range": "±2.07%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2139,
            "range": "±2.16%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31799,
            "range": "±2.2%",
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
            "email": "noreply@github.com",
            "name": "GitHub",
            "username": "web-flow"
          },
          "distinct": true,
          "id": "8d0045f5b633eadbb444ef6eb581e0c60b508bb8",
          "message": "Merge pull request #1270 from napi-rs/custom-finalize\n\nfeat(napi): allow implement custom finalize logic for Class",
          "timestamp": "2022-08-17T14:25:51+08:00",
          "tree_id": "53d5831b5cd242d306370500536298b3db1c1493",
          "url": "https://github.com/napi-rs/napi-rs/commit/8d0045f5b633eadbb444ef6eb581e0c60b508bb8"
        },
        "date": 1660718296467,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 59612957,
            "range": "±0.22%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 593561601,
            "range": "±0.78%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 20608128,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 592733817,
            "range": "±0.22%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 443322,
            "range": "±6.59%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 2040108,
            "range": "±5.26%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 43617,
            "range": "±0.11%",
            "unit": "ops/sec",
            "extra": "96 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 7998,
            "range": "±0.09%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 8014,
            "range": "±0.1%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 16791,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "98 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 11151,
            "range": "±0.06%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 13117,
            "range": "±0.05%",
            "unit": "ops/sec",
            "extra": "100 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 385738,
            "range": "±4.39%",
            "unit": "ops/sec",
            "extra": "81 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 332878,
            "range": "±4.32%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 363768,
            "range": "±3.98%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 322702,
            "range": "±4.27%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 36591,
            "range": "±0.98%",
            "unit": "ops/sec",
            "extra": "78 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 2405,
            "range": "±5.26%",
            "unit": "ops/sec",
            "extra": "50 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 31821,
            "range": "±0.66%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 2157,
            "range": "±2.07%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 31961,
            "range": "±0.49%",
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
          "id": "5030cfb8fbae5f91f72bd0ca252b94272b0fe7f5",
          "message": "Merge pull request #1272 from napi-rs/support-instanceof\n\nfeat(napi-derive): implement instance_of for Class",
          "timestamp": "2022-08-17T16:00:46+08:00",
          "tree_id": "5de6450c79141e5df871c7f728e3ff8b7b53098c",
          "url": "https://github.com/napi-rs/napi-rs/commit/5030cfb8fbae5f91f72bd0ca252b94272b0fe7f5"
        },
        "date": 1660723918695,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 45522722,
            "range": "±0.49%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 576256012,
            "range": "±0.8%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 14766344,
            "range": "±1.54%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 591204297,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 338784,
            "range": "±9.65%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1357281,
            "range": "±6.29%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 31900,
            "range": "±0.15%",
            "unit": "ops/sec",
            "extra": "97 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 6415,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 6425,
            "range": "±0.14%",
            "unit": "ops/sec",
            "extra": "95 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 14347,
            "range": "±0.35%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8616,
            "range": "±0.47%",
            "unit": "ops/sec",
            "extra": "92 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 10208,
            "range": "±0.16%",
            "unit": "ops/sec",
            "extra": "93 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 353043,
            "range": "±5.6%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 309367,
            "range": "±5.69%",
            "unit": "ops/sec",
            "extra": "77 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 321863,
            "range": "±5.73%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 304188,
            "range": "±5.54%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 29101,
            "range": "±1.66%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1823,
            "range": "±7.03%",
            "unit": "ops/sec",
            "extra": "40 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 25593,
            "range": "±1.72%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1798,
            "range": "±2.69%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 24444,
            "range": "±3.31%",
            "unit": "ops/sec",
            "extra": "82 samples"
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
          "id": "242b292079b6df9b0ccb86988d9d7f0d0c082d0b",
          "message": "Merge pull request #1273 from napi-rs/do-not-restrict-this\n\nfeat(napi-derive): support inject This<Value> into raw function",
          "timestamp": "2022-08-17T18:46:53+08:00",
          "tree_id": "2c964134007396651c091b5396fda7be77fc2667",
          "url": "https://github.com/napi-rs/napi-rs/commit/242b292079b6df9b0ccb86988d9d7f0d0c082d0b"
        },
        "date": 1660733705966,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 43271046,
            "range": "±1.68%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 695044990,
            "range": "±1.01%",
            "unit": "ops/sec",
            "extra": "91 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 15482093,
            "range": "±1.06%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 703219671,
            "range": "±0.88%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 310527,
            "range": "±10.31%",
            "unit": "ops/sec",
            "extra": "67 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1319140,
            "range": "±5.73%",
            "unit": "ops/sec",
            "extra": "76 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 31362,
            "range": "±1.35%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 5852,
            "range": "±0.8%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 5763,
            "range": "±0.75%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 13637,
            "range": "±1.08%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 8352,
            "range": "±0.82%",
            "unit": "ops/sec",
            "extra": "87 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 9829,
            "range": "±0.75%",
            "unit": "ops/sec",
            "extra": "83 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 330499,
            "range": "±6.19%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 287583,
            "range": "±6.49%",
            "unit": "ops/sec",
            "extra": "72 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 298167,
            "range": "±6.57%",
            "unit": "ops/sec",
            "extra": "70 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 270942,
            "range": "±6.35%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 27883,
            "range": "±3.27%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1859,
            "range": "±4.18%",
            "unit": "ops/sec",
            "extra": "53 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 22659,
            "range": "±3.18%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1585,
            "range": "±3.13%",
            "unit": "ops/sec",
            "extra": "80 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 19250,
            "range": "±9.31%",
            "unit": "ops/sec",
            "extra": "74 samples"
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
          "id": "c4eb51b5093800a34b770928ced719780450e671",
          "message": "Merge pull request #1274 from napi-rs/weak-reference\n\nfeat(napi): add get and get_mut method on `WeakReference`",
          "timestamp": "2022-08-17T22:12:02+08:00",
          "tree_id": "58ee9821394e4926b25b4f7dbea54126c6a205f8",
          "url": "https://github.com/napi-rs/napi-rs/commit/c4eb51b5093800a34b770928ced719780450e671"
        },
        "date": 1660746268284,
        "tool": "benchmarkjs",
        "benches": [
          {
            "name": "noop#napi-rs",
            "value": 39893330,
            "range": "±1.37%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "noop#JavaScript",
            "value": 671739146,
            "range": "±0.9%",
            "unit": "ops/sec",
            "extra": "90 samples"
          },
          {
            "name": "Plus number#napi-rs",
            "value": 14452615,
            "range": "±1.64%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "Plus number#JavaScript",
            "value": 651946085,
            "range": "±0.99%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "Create buffer#napi-rs",
            "value": 298575,
            "range": "±10.11%",
            "unit": "ops/sec",
            "extra": "63 samples"
          },
          {
            "name": "Create buffer#JavaScript",
            "value": 1379437,
            "range": "±7.16%",
            "unit": "ops/sec",
            "extra": "73 samples"
          },
          {
            "name": "createArray#createArrayJson",
            "value": 28344,
            "range": "±1.28%",
            "unit": "ops/sec",
            "extra": "84 samples"
          },
          {
            "name": "createArray#create array for loop",
            "value": 5270,
            "range": "±1.32%",
            "unit": "ops/sec",
            "extra": "85 samples"
          },
          {
            "name": "createArray#create array with serde trait",
            "value": 5371,
            "range": "±1.09%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "getArrayFromJs#get array from json string",
            "value": 12372,
            "range": "±1.35%",
            "unit": "ops/sec",
            "extra": "86 samples"
          },
          {
            "name": "getArrayFromJs#get array from serde",
            "value": 7767,
            "range": "±0.92%",
            "unit": "ops/sec",
            "extra": "89 samples"
          },
          {
            "name": "getArrayFromJs#get array with for loop",
            "value": 8914,
            "range": "±0.96%",
            "unit": "ops/sec",
            "extra": "88 samples"
          },
          {
            "name": "Get Set property#Get Set from native#u32",
            "value": 315381,
            "range": "±6.3%",
            "unit": "ops/sec",
            "extra": "69 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#u32",
            "value": 276101,
            "range": "±5.49%",
            "unit": "ops/sec",
            "extra": "71 samples"
          },
          {
            "name": "Get Set property#Get Set from native#string",
            "value": 278063,
            "range": "±5.67%",
            "unit": "ops/sec",
            "extra": "68 samples"
          },
          {
            "name": "Get Set property#Get Set from JavaScript#string",
            "value": 263591,
            "range": "±5.25%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#spawn task",
            "value": 25292,
            "range": "±2.4%",
            "unit": "ops/sec",
            "extra": "74 samples"
          },
          {
            "name": "Async task#ThreadSafeFunction",
            "value": 1665,
            "range": "±3.31%",
            "unit": "ops/sec",
            "extra": "52 samples"
          },
          {
            "name": "Async task#Tokio future to Promise",
            "value": 19355,
            "range": "±3.43%",
            "unit": "ops/sec",
            "extra": "75 samples"
          },
          {
            "name": "Query#query * 100",
            "value": 1551,
            "range": "±2.37%",
            "unit": "ops/sec",
            "extra": "79 samples"
          },
          {
            "name": "Query#query * 1",
            "value": 18070,
            "range": "±2.15%",
            "unit": "ops/sec",
            "extra": "77 samples"
          }
        ]
      }
    ]
  }
}