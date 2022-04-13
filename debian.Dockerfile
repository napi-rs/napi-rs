FROM messense/manylinux2014-cross:x86_64

ARG NASM_VERSION=2.15.05

ENV RUSTUP_HOME=/usr/local/rustup \
  CARGO_HOME=/usr/local/cargo \
  PATH=/usr/local/cargo/bin:$PATH \
  CC=clang \
  CXX=clang++ \
  CC_x86_64_unknown_linux_gnu=clang \
  CXX_x86_64_unknown_linux_gnu=clang++ \
  CARGO_BUILD_TARGET=""

RUN wget -O - https://apt.llvm.org/llvm-snapshot.gpg.key | apt-key add - && \
  echo "deb http://apt.llvm.org/focal/ llvm-toolchain-focal-13 main" >> /etc/apt/sources.list && \
  echo "deb-src http://apt.llvm.org/focal/ llvm-toolchain-focal-13 main" >> /etc/apt/sources.list && \
  curl -sL https://deb.nodesource.com/setup_16.x | bash - && \
  apt-get install -y --fix-missing --no-install-recommends \
  curl \
  llvm-13 \
  clang-13 \
  lld-13 \
  nodejs \
  xz-utils \
  rcs \
  git \
  make \
  gcc-aarch64-linux-gnu \
  g++-aarch64-linux-gnu \
  gcc-arm-linux-gnueabihf \
  g++-arm-linux-gnueabihf \
  ninja-build && \
  apt-get autoremove -y && \
  curl https://sh.rustup.rs -sSf | sh -s -- -y && \
  rustup target add aarch64-unknown-linux-gnu && \
  rustup target add armv7-unknown-linux-gnueabihf && \
  npm install -g yarn pnpm lerna && \
  ln -sf /usr/bin/clang-13 /usr/bin/clang && \
  ln -sf /usr/bin/clang++-13 /usr/bin/clang++ && \
  ln -sf /usr/bin/lld-13 /usr/bin/lld && \
  ln -sf /usr/bin/clang-13 /usr/bin/cc

RUN wget https://www.nasm.us/pub/nasm/releasebuilds/${NASM_VERSION}/nasm-${NASM_VERSION}.tar.xz && \
  tar -xf nasm-${NASM_VERSION}.tar.xz && \
  cd nasm-${NASM_VERSION} && \
  ./configure --prefix=/usr/ && \
  make && \
  make install && \
  cd / && \
  rm -rf nasm-${NASM_VERSION} && \
  rm nasm-${NASM_VERSION}.tar.xz
