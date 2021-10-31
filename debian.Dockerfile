FROM ubuntu:18.04

ARG NASM_VERSION=2.15.05

ENV RUSTUP_HOME=/usr/local/rustup \
  CARGO_HOME=/usr/local/cargo \
  PATH=/usr/local/cargo/bin:$PATH \
  CC=clang \
  CXX=clang++

RUN apt-get update && \
  apt-get install curl wget gnupg software-properties-common -y --fix-missing --no-install-recommends && \
  wget -O - https://apt.llvm.org/llvm-snapshot.gpg.key | apt-key add - && \
  echo "deb http://apt.llvm.org/bionic/ llvm-toolchain-bionic-13 main" >> /etc/apt/sources.list && \
  echo "deb-src http://apt.llvm.org/bionic/ llvm-toolchain-bionic-13 main" >> /etc/apt/sources.list && \
  add-apt-repository ppa:ubuntu-toolchain-r/test -y && \
  apt-get update && \
  apt-get install -y --fix-missing --no-install-recommends \
  curl \
  gcc-10 \
  g++-10 \
  llvm-13 \
  clang-13 \
  lld-13 \
  xz-utils \
  rcs \
  make \
  git \
  gcc-aarch64-linux-gnu \
  g++-aarch64-linux-gnu \
  gcc-arm-linux-gnueabihf \
  g++-arm-linux-gnueabihf \
  ninja-build && \
  curl -fsSL https://deb.nodesource.com/setup_16.x | bash - && \
  apt-get update && \
  apt-get install nodejs -y && \
  apt-get autoremove -y && \
  curl https://sh.rustup.rs -sSf | sh -s -- -y && \
  rustup target add aarch64-unknown-linux-gnu && \
  rustup target add armv7-unknown-linux-gnueabihf && \
  npm install -g pnpm yarn && \
  ln -sf /usr/bin/clang++13 /usr/bin/clang++ && \
  ln -sf /usr/bin/clang-13 /usr/bin/clang && \
  ln -sf /usr/bin/lld-13 /usr/bin/lld && \
  ln -sf /usr/bin/gcc-10 /usr/bin/gcc && \
  ln -sf /usr/bin/g++-10 /usr/bin/g++ && \
  ln -sf /usr/bin/gcc-10 /usr/bin/cc

RUN wget https://www.nasm.us/pub/nasm/releasebuilds/${NASM_VERSION}/nasm-${NASM_VERSION}.tar.xz && \
  tar -xf nasm-${NASM_VERSION}.tar.xz && \
  cd nasm-${NASM_VERSION} && \
  ./configure --prefix=/usr/ && \
  make && \
  make install && \
  cd / && \
  rm -rf nasm-${NASM_VERSION} && \
  rm nasm-${NASM_VERSION}.tar.xz
