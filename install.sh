#!/usr/bin/env bash
# dsh-vision 一键安装（macOS / Linux）
# 未检测到 Node.js 时，自动从国内镜像下载免安装版 Node.js（无需管理员权限）。
set -e

echo
echo "============================================================"
echo "  dsh-vision 识图插件 —— 一键安装"
echo "============================================================"
echo

NODE_BIN=""

# ── 第 1 步：查找已有的 Node.js ──
echo "  [1/3] 正在查找 Node.js ..."
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  for p in "$HOME"/.cache/codex-runtimes/*/dependencies/node/bin/node \
           /usr/local/bin/node /usr/bin/node; do
    if [ -x "$p" ]; then NODE_BIN="$p"; break; fi
  done
fi

# ── 第 2 步：都没有 → 国内镜像自动下载 ──
if [ -z "$NODE_BIN" ]; then
  echo
  echo "  [2/3] 未检测到 Node.js，正在用国内镜像自动下载并安装..."
  echo "        （免安装版、无需管理员权限，约 30MB，稍等 1~2 分钟）"
  echo

  case "$(uname -s)" in
    Darwin) OS=darwin ;;
    Linux)  OS=linux ;;
    *) echo "  [错误] 不支持的系统：$(uname -s)"; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64)  ARCH=x64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) ARCH=x64 ;;
  esac

  # 默认用已验证的 LTS 版本；优先动态获取最新 LTS（失败则回退）
  VER="v24.19.0"
  VER_DYN=$(curl -fsSL --max-time 20 "https://registry.npmmirror.com/-/binary/node/index.json" 2>/dev/null \
    | grep -m1 '"lts":"' | sed -n 's/.*"version":"\(v[0-9.]*\)".*/\1/p')
  [ -n "$VER_DYN" ] && VER="$VER_DYN"

  DEST="$HOME/.dsh/node-runtime"
  mkdir -p "$DEST"
  TARBALL="node-$VER-$OS-$ARCH.tar.xz"
  TMP="/tmp/$TARBALL"

  MIRRORS=(
    "https://registry.npmmirror.com/-/binary/node/$VER"
    "https://mirrors.huaweicloud.com/nodejs/$VER"
    "https://mirrors.cloud.tencent.com/nodejs-release/$VER"
  )

  OK=0
  for M in "${MIRRORS[@]}"; do
    echo "  [下载] $M/$TARBALL"
    if curl -fL --max-time 900 -o "$TMP" "$M/$TARBALL" 2>/dev/null \
       || wget -q -O "$TMP" "$M/$TARBALL" 2>/dev/null; then
      OK=1; break
    fi
  done
  if [ "$OK" != 1 ]; then
    echo "  [错误] 所有镜像下载均失败，请检查网络后重试。"
    exit 1
  fi

  echo "  [解压] $TARBALL -> $DEST"
  tar -xJf "$TMP" -C "$DEST"
  rm -f "$TMP"

  NODE_BIN="$DEST/node-$VER-$OS-$ARCH/bin/node"
  if [ ! -x "$NODE_BIN" ]; then
    echo "  [错误] 解压后未找到 node。"
    exit 1
  fi
  echo "  [完成] Node.js 已就绪：$NODE_BIN"
fi

echo
echo "  [3/3] 使用 Node.js：$NODE_BIN"
echo
"$NODE_BIN" "$(dirname "$0")/install.mjs"
