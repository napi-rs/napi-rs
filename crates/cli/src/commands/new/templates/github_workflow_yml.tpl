name: CI

env:
  APP_NAME: '{{ binary_name }}'
  MACOSX_DEPLOYMENT_TARGET: '10.13'

on:
  push:
    branches:
      - main
    tags-ignore:
      - '**'
    paths-ignore:
      - '**/*.md'
      - 'LICENSE'
      - '**/*.gitignore'
      - '.editorconfig'
      - 'docs/**'
  pull_request:

jobs:
  build:
    if: "!contains(github.event.head_commit.message, 'skip ci')"
    strategy:
      fail-fast: false
      matrix:
        settings:{% for (target, github_workflow_config) in targets %}
          - target: {{ target.triple }}
            host: {{ github_workflow_config.host }}{% if github_workflow_config.build_image %}
            build_image: {{ github_workflow_config.build_image }}{% endif %}{% if github_workflow_config.build_setup %}
            setup: |{% for line in github_workflow_config.build_setup %}
              {{line}}{% endfor %}{% endif %}{% endfor %}

    name: stable - ${{ "{{" }} matrix.settings.target {{ "}}" }} - node@16
    runs-on: ${{ "{{" }} matrix.settings.host {{ "}}" }}
    steps:
      - uses: actions/checkout@v3

      - name: Install
        uses: actions-rs/toolchain@v1
        if: ${{ "{{" }} !matrix.settings.build_image {{ "}}" }}
        with:
          profile: minimal
          override: true
          toolchain: stable
          target: ${{ "{{" }} matrix.settings.target {{ "}}" }}

      - name: Cache cargo
        uses: actions/cache@v3
        with:
          path: |
            ~/.cargo/registry/index/
            ~/.cargo/registry/cache/
            ~/.cargo/git/db/
            .cargo-cache/registry/index/
            .cargo-cache/registry/cache/
            .cargo-cache/git/db/
            target/
          key: ${{ "{{" }} matrix.settings.target {{ "}}" }}-cargo-${{ "{{" }} matrix.settings.host {{ "}}" }}

      - name: Build in docker
        uses: addnab/docker-run-action@v3
        if: ${{ "{{" }} matrix.settings.build_image {{ "}}" }} 
        with:
          image: ${{ "{{" }} matrix.settings.build_image {{ "}}" }} 
          options: --user 0:0 -v ${{ "{{" }} github.workspace {{ "}}" }}/.cargo-cache/git/db:/root/.cargo/git/db -v ${{ "{{" }} github.workspace {{ "}}" }}/.cargo/registry/cache:/root/.cargo/registry/cache -v ${{ "{{" }} github.workspace {{ "}}" }}/.cargo/registry/index:/root/.cargo/registry/index -v ${{ "{{" }} github.workspace {{ "}}" }}:/build -w /build
          run: |
            ${{ "{{" }} matrix.settings.setup {{ "}}" }} 
            cargo install napi-cli
            napi build --target ${{ "{{" }} matrix.settings.target {{ "}}" }} --platform --strip

      - name: Build
        shell: bash
        if: ${{ "{{" }} !matrix.settings.build_image {{ "}}" }} 
        run: |
          ${{ "{{" }} matrix.settings.setup {{ "}}" }} 
          cargo install napi-cli
          napi build --target ${{ "{{" }} matrix.settings.target {{ "}}" }} --platform --strip

      - name: Upload artifact
        uses: actions/upload-artifact@v3
        with:
          name: bindings-${{ "{{" }} matrix.settings.target {{ "}}" }}
          path: ${{ "{{" }} env.APP_NAME  {{ "}}" }}.*.node
          if-no-files-found: error
  {% for (target, github_workflow_config) in targets %}{% if github_workflow_config.test %}
  test-{{ target.triple }}:
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        node: ['16']
    name: test - {{ target.triple }} - node@${{ "{{" }} matrix.node {{ "}}" }}
    runs-on: {{ github_workflow_config.host }}
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup node
        uses: actions/setup-node@v3
        with:
          node-version: ${{ "{{" }} matrix.node {{ "}}" }}
          check-latest: true
          cache: yarn
      
      - name: Install dependencies
        run: | {% if github_workflow_config.yarn_cpu %}
          yarn config set supportedArchitectures.cpu "{{ github_workflow_config.yarn_cpu }}"{% endif %}{% if github_workflow_config.yarn_libc %}
          yarn config set supportedArchitectures.libc "{{ github_workflow_config.yarn_libc }}"{% endif %}
          yarn install
      
      - name: Download artifacts
        uses: actions/download-artifact@v2
        with:
          name: bindings-{{ target.triple }}
          path: .
      {% if github_workflow_config.test_image %}
      - name: Prepare docker env
        run: docker run --rm --privileged multiarch/qemu-user-static:register --reset
      
      - name: Test in docker
        uses: addnab/docker-run-action@v3
        with:
          image: {{ github_workflow_config.test_image }}
          options: -v ${{ "{{" }} github.workspace {{ "}}" }}:/build -w /build
          run: |{% for line in github_workflow_config.test_setup %}
            {{line}}{% endfor%} 
            yarn test
      {% else %}
      - name: Test bindings
        run:
          yarn test
      {% endif %}{% endif %}{% endfor %}
  publish:
    name: Publish
    runs-on: ubuntu-latest
    needs:
      - build{% for (target, gh) in targets %}{% if gh.test %}
      - test-{{target.triple}}{% endif %}{% endfor %}
    steps:
      - uses: actions/checkout@v2
      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: 16
          check-latest: true
          cache: 'yarn'
      - name: 'Install dependencies'
        run: yarn install

      - name: Download all artifacts
        uses: actions/download-artifact@v2
        with:
          path: artifacts

      - name: Move artifacts
        run: yarn artifacts

      - name: List packages
        run: ls -R ./npm
        shell: bash

      - name: Publish
        run: |
          if git log -1 --pretty=%B | grep "^[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+$";
          then
            echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" >> ~/.npmrc
            npm publish --access public
          elif git log -1 --pretty=%B | grep "^[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+";
          then
            echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" >> ~/.npmrc
            npm publish --tag next --access public
          else
            echo "Not a release, skipping publish"
          fi
        env:
          GITHUB_TOKEN: ${{ "{{" }} secrets.GITHUB_TOKEN {{ "}}" }}
          NPM_TOKEN: ${{ "{{" }} secrets.NPM_TOKEN {{ "}}" }}
