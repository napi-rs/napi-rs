FROM node:lts-alpine

ENV PATH="/aarch64-linux-musl-cross/bin:/usr/local/cargo/bin/rustup:/root/.cargo/bin:$PATH" \
  RUSTFLAGS="-C target-feature=-crt-static" \
  CC="clang" \
  CXX="clang++" \
  GN_EXE=gn

RUN apk add --update --no-cache wget musl-dev && \
  sed -i -e 's/v[[:digit:]]\..*\//edge\//g' /etc/apk/repositories && \
  apk add --update --no-cache --repository http://dl-cdn.alpinelinux.org/alpine/edge/testing \
  rustup \
  bash \
  python3 \
  python2 \
  git \
  build-base \
  clang \
  cmake \
  llvm \
  gn \
  tar \
  ninja && \
  apk upgrade && \
  npm install -g pnpm

RUN rustup-init -y && \
  yarn global add pnpm && \
  rustup target add aarch64-unknown-linux-musl && \
  wget https://musl.cc/aarch64-linux-musl-cross.tgz && \
  tar -xvf aarch64-linux-musl-cross.tgz && \
  rm aarch64-linux-musl-cross.tgz
