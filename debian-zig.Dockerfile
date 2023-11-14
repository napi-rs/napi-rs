FROM ghcr.io/napi-rs/napi-rs/nodejs-rust:lts-debian

ARG ZIG_VERSION=0.11.0

RUN wget https://ziglang.org/download/${ZIG_VERSION}/zig-linux-x86_64-${ZIG_VERSION}.tar.xz && \
  tar -xvf zig-linux-x86_64-${ZIG_VERSION}.tar.xz && \
  mv zig-linux-x86_64-${ZIG_VERSION} /usr/local/zig && \
  ln -sf /usr/local/zig/zig /usr/local/bin/zig && \
  rm zig-linux-x86_64-${ZIG_VERSION}.tar.xz
