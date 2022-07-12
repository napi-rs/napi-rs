[package]
name = "{{ name }}"
version = "1.0.0"
edition = "2021"
license = "{{ license }}"

[lib]
crate-type = ["cdylib"]

[dependencies]
# Default enable napi4 feature, see https://nodejs.org/api/n-api.html#node-api-version-matrix
napi = { version = "{{ napi_version }}", default-features = false, features = {% if features %}[{% for feature in features %}"{{feature}}"{% if not loop.last %}, {% endif %}{% endfor %}]{% else %}["napi4"]{% endif %} }
napi-derive = { version = "{{ napi_derive_version }}", default-features = false{% if derive_features %}, features = [{% for feature in derive_features %}"{{feature}}"{% if not loop.last %}, {% endif %}{% endfor %}]{% endif %} }

[build-dependencies]
napi-build = "{{ napi_build_version }}"

[profile.release]
lto = true
