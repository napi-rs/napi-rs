FROM messense/manylinux2014-cross:ppc64le

ENV RUSTUP_HOME=/usr/local/rustup \
  CARGO_HOME=/usr/local/cargo \
  PATH=/usr/local/cargo/bin:$PATH \
  CC=clang \
  CC_powerpc64le_unknown_linux_gnu=clang \
  CXX=clang++ \
  CXX_powerpc64le_unknown_linux_gnu=clang++ \
  CFLAGS="--sysroot=/usr/powerpc64le-unknown-linux-gnu/powerpc64le-unknown-linux-gnu/sysroot" \
  CXXFLAGS="--sysroot=/usr/powerpc64le-unknown-linux-gnu/powerpc64le-unknown-linux-gnu/sysroot" \
  C_INCLUDE_PATH="/usr/powerpc64le-unknown-linux-gnu/powerpc64le-unknown-linux-gnu/sysroot/usr/include" \
  LDFLAGS="-L/usr/powerpc64le-unknown-linux-gnu/lib/llvm-18/lib"

ADD ./lib/llvm-18 /usr/powerpc64le-unknown-linux-gnu/lib/llvm-18

RUN apt-get update && \
  apt-get install -y --fix-missing --no-install-recommends curl gnupg gpg-agent ca-certificates openssl && \
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
  rustup target add powerpc64le-unknown-linux-gnu && \
  corepack enable && \
  ln -sf /usr/bin/clang-18 /usr/bin/clang && \
  ln -sf /usr/bin/clang++-18 /usr/bin/clang++ && \
  ln -sf /usr/bin/lld-18 /usr/bin/lld && \
  ln -sf /usr/bin/clang-18 /usr/bin/cc
