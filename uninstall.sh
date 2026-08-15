#!/usr/bin/env bash
# @linenxi-ctrl/dsh-vision 一键卸载（macOS / Linux）
set -e

echo
echo "============================================================"
echo "  dsh-vision 识图插件 —— 一键卸载"
echo "============================================================"
echo

NODE_BIN=""

# 1) node in PATH
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  # 2) known locations
  for p in "$HOME"/.cache/codex-runtimes/*/dependencies/node/bin/node \
           "$HOME/.dsh/node-runtime/"*/bin/node \
           /usr/local/bin/node /usr/bin/node; do
    if [ -x "$p" ]; then NODE_BIN="$p"; break; fi
  done
fi

# 3) none -> download from domestic mirror
if [ -z "$NODE_BIN" ]; then
  echo "  [信息] 未检测到 Node.js，正在用国内镜像自动下载..."
  NODE_BIN="$(curl -fsSL --max-time 20 "https://registry.npmmirror.com/-/binary/node/index.json" 2>/dev/null \
    | grep -m1 '"lts":"' | sed -n 's/.*"version":"\(v[0-9.]*\)".*/\1/p')"
  VER="${NODE_BIN:-v24.19.0}"
  case "$(uname -s)" in
    Darwin) OS=darwin ;; Linux) OS=linux ;; *) echo "  [错误] 不支持的系统"; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) ARCH=x64 ;;
  esac
  TARBALL="node-$VER-$OS-$ARCH.tar.xz"
  DEST="$HOME/.dsh/node-runtime"
  mkdir -p "$DEST"
  OK=0
  for M in "https://registry.npmmirror.com/-/binary/node/$VER" "https://mirrors.huaweicloud.com/nodejs/$VER" "https://mirrors.cloud.tencent.com/nodejs-release/$VER"; do
    if curl -fL --max-time 900 -o "/tmp/$TARBALL" "$M/$TARBALL" 2>/dev/null; then OK=1; break; fi
  done
  [ "$OK" = 1 ] || { echo "  [错误] 下载 Node.js 失败"; exit 1; }
  tar -xJf "/tmp/$TARBALL" -C "$DEST"
  rm -f "/tmp/$TARBALL"
  NODE_BIN="$DEST/node-$VER-$OS-$ARCH/bin/node"
fi

echo "  [信息] 使用 Node.js：$NODE_BIN"
"$NODE_BIN" "$(dirname "$0")/uninstall.mjs"
