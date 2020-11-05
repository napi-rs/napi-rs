export const napiVersion = process.env['USE_NAPI_VERSION'] || parseInt(process.versions.napi ?? '1', 10)
