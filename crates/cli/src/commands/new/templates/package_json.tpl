{
  "name": "{{ name }}",
  "version": "1.0.0",
  "main": "index.js",
  "types": "index.d.ts",
  "napi": {
    "name": "{{ binary_name }}",
    "targets": [{% for target in targets %}
      "{{ target }}"{% if not loop.last %},{% endif %}{% endfor %}
    ],
    "package": {
      "name": "{{ binary_name }}"
    }
  },
  "license": "{{ license }}",
  "engines": {
    "node": "{{ node_version_requirement }}"
  },
  "scripts": {
    "build": "napi build --release --strip",
    "build:debug": "napi build",
    "artifacts": "napi artifacts",
    "preversion": "napi version"
  }
}
