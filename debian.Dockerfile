FROM messense/manylinux2014-cross:x86_64

ARG NASM_VERSION=2.16.01

ENV RUSTUP_HOME=/usr/local/rustup \
  CARGO_HOME=/usr/local/cargo \
  PATH=/usr/local/cargo/bin:$PATH \
  CC=clang \
  CXX=clang++ \
  CC_x86_64_unknown_linux_gnu=clang \
  CXX_x86_64_unknown_linux_gnu=clang++ \
  RUST_TARGET=x86_64-unknown-linux-gnu

RUN apt-get update && \
  apt-get install -y --fix-missing --no-install-recommends curl gnupg gpg-agent ca-certificates openssl && \
  mkdir -p /etc/apt/keyrings && \
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
  curl -fsSL https://apt.llvm.org/llvm-snapshot.gpg.key | gpg --dearmor -o /etc/apt/keyrings/llvm-snapshot.gpg && \
  echo "deb [signed-by=/etc/apt/keyrings/llvm-snapshot.gpg] http://apt.llvm.org/jammy/ llvm-toolchain-jammy-18 main" >> /etc/apt/sources.list && \
  echo "deb-src [signed-by=/etc/apt/keyrings/llvm-snapshot.gpg] http://apt.llvm.org/jammy/ llvm-toolchain-jammy-18 main" >> /etc/apt/sources.list && \
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
  apt-get update && \
  apt-get install -y --fix-missing --no-install-recommends \
  llvm-18 \
  clang-18 \
  lld-18 \
  libc++-18-dev \
  libc++abi-18-dev \
  nodejs \
  xz-utils \
  rcs \
  git \
  make \
  cmake \
  ninja-build && \
  apt-get autoremove -y && \
  curl https://sh.rustup.rs -sSf | sh -s -- -y && \
  npm install -g npm yarn pnpm && \
  ln -sf /usr/bin/clang-18 /usr/bin/clang && \
  ln -sf /usr/bin/clang++-18 /usr/bin/clang++ && \
  ln -sf /usr/bin/lld-18 /usr/bin/lld && \
  ln -sf /usr/bin/clang-18 /usr/bin/cc

RUN wget https://www.nasm.us/pub/nasm/releasebuilds/${NASM_VERSION}/nasm-${NASM_VERSION}.tar.xz && \
  tar -xf nasm-${NASM_VERSION}.tar.xz && \
  cd nasm-${NASM_VERSION} && \
  ./configure --prefix=/usr/ && \
  make && \
  make install && \
  cd / && \
  rm -rf nasm-${NASM_VERSION} && \
  rm nasm-${NASM_VERSION}.tar.xz

ENV LDFLAGS="-fuse-ld=lld --sysroot=/usr/x86_64-unknown-linux-gnu/x86_64-unknown-linux-gnu/sysroot" \
  CFLAGS="--sysroot=/usr/x86_64-unknown-linux-gnu/x86_64-unknown-linux-gnu/sysroot" \
  CXXFLAGS="--sysroot=/usr/x86_64-unknown-linux-gnu/x86_64-unknown-linux-gnu/sysroot" \
  C_INCLUDE_PATH="/usr/x86_64-unknown-linux-gnu/x86_64-unknown-linux-gnu/sysroot/usr/include"
