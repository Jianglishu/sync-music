#!/bin/bash

# SyncMusic 启动脚本
# 使用: 双击运行 或 终端执行 ./start.sh

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=============================="
echo "  SyncMusic 多设备音乐同步"
echo "=============================="
echo ""

# 检查 node_modules
if [ ! -d "node_modules" ]; then
  echo "📦 首次运行，正在安装依赖..."
  npm install
  echo ""
fi

# 检查 yt-dlp（可选，用于音频提取兜底）
if ! command -v yt-dlp &>/dev/null; then
  echo "⚠️  提示: 未检测到 yt-dlp"
  echo "   音频提取功能可能受限，建议安装:"
  echo "   brew install yt-dlp"
  echo ""
fi

echo "🚀 正在启动..."
echo "   Vite 开发服务器 + Electron"
echo "   首次启动约需 3-5 秒"
echo ""

# 启动 Vite + Electron
npm run dev
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -ne 0 ]; then
  echo "❌ 启动失败 (错误码: $EXIT_CODE)"
else
  echo "✅ 应用已关闭"
fi

read -p "按 Enter 键关闭此窗口..."
