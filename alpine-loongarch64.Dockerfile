FROM node:22-alpine

ENV PATH="/loongarch64-linux-musl-cross/bin:/usr/local/cargo/bin/rustup:/root/.cargo/bin:$PATH" \
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
  ninja && \
  apk update && \
  apk upgrade

ARG LOONGARCH64_MUSL_CROSS_URL="https://github.com/loong64/musl-cross-make/releases/download/20260507/loongarch64-linux-musl-cross.tgz"
ARG LOONGARCH64_MUSL_CROSS_SHA256="4b3b27a6bd025eae62cefce2d727baf530cb24add35fde834645a2ae85d8581e"
RUN rustup-init -y && \
  yarn global add pnpm lerna && \
  rustup target add loongarch64-unknown-linux-musl && \
  wget -O loongarch64-linux-musl-cross.tgz "${LOONGARCH64_MUSL_CROSS_URL}" && \
  echo "${LOONGARCH64_MUSL_CROSS_SHA256}  loongarch64-linux-musl-cross.tgz" | sha256sum -c - && \
  tar -xvf loongarch64-linux-musl-cross.tgz && \
  rm loongarch64-linux-musl-cross.tgz
