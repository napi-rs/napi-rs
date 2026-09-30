/*
 * The `malloc` / `free` exports of a wasm32-wasip1-threads module whose libc
 * allocator is wrapped (see `heap_sync_link_lines` in `wasi.rs`).
 *
 * `@emnapi/core` allocates through the module's `malloc` / `free` exports.
 * Under `--wrap=malloc` / `--wrap=free`, napi-build's `--export=malloc` /
 * `--export=free` resolve to `__wrap_malloc` / `__wrap_free`, and the module
 * has no `malloc` / `free` export at all; `wasm-ld` has no option to rename an
 * export. The two functions below carry the export names instead. Their calls
 * are references to `malloc` / `free`, and `--wrap` points those at
 * `__wrap_malloc` / `__wrap_free`, the locked entries.
 *
 * napi-build embeds the object built from this file, so an addon build needs
 * no C compiler. Rebuild it with wasi-sdk 32 (clang 22.1.0) and these exact
 * flags; the result is `wasi_heap_sync_exports.o`, byte for byte:
 *
 *   "$WASI_SDK_PATH/bin/clang" --target=wasm32-wasip1-threads -O2 -c \
 *     wasi_heap_sync_exports.c -o wasi_heap_sync_exports.o
 */
typedef __SIZE_TYPE__ size_t;
void *malloc(size_t);
void free(void *);
__attribute__((export_name("malloc"))) void *napi_rs_export_malloc(size_t n) { return malloc(n); }
__attribute__((export_name("free"))) void napi_rs_export_free(void *p) { free(p); }
