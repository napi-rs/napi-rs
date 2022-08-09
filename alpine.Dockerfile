FROM node:14-alpine

ENV PATH="/aarch64-linux-musl-cross/bin:/usr/local/cargo/bin/rustup:/root/.cargo/bin:$PATH" \
  RUSTFLAGS="-C target-feature=-crt-static" \
  CC="clang" \
  CXX="clang++" \
  GN_EXE=gn

RUN apk add --update --no-cache bash wget cmake musl-dev clang llvm build-base python3 && \
  sed -i -e 's/v[[:digit:]]\..*\//edge\//g' /etc/apk/repositories && \
  apk add --update --no-cache --repository https://dl-cdn.alpinelinux.org/alpine/edge/testing \
  rustup \
  git \
  gn \
  tar \
  ninja

RUN rustup-init -y && \
  yarn global add pnpm lerna && \
  rustup target add aarch64-unknown-linux-musl && \
  wget https://github.com/napi-rs/napi-rs/releases/download/linux-musl-cross%4010/aarch64-linux-musl-cross.tgz && \
  tar -xvf aarch64-linux-musl-cross.tgz && \
  rm aarch64-linux-musl-cross.tgz
