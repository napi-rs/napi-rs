FROM ghcr.io/napi-rs/napi-rs/nodejs-rust:lts-alpine

ARG ZIG_VERSION=0.9.1

RUN apk add xz && \
  rustup target add x86_64-unknown-linux-gnu && \
  wget https://ziglang.org/download/${ZIG_VERSION}/zig-linux-x86_64-${ZIG_VERSION}.tar.xz && \
  tar -xvf zig-linux-x86_64-${ZIG_VERSION}.tar.xz && \
  mv zig-linux-x86_64-${ZIG_VERSION} /usr/local/zig && \
  ln -sf /usr/local/zig/zig /usr/local/bin/zig && \
  rm zig-linux-x86_64-${ZIG_VERSION}.tar.xz
