@echo off
chcp 65001 >nul

echo ==============================
echo   SyncMusic 多设备音乐同步
echo ==============================
echo.

if not exist "node_modules" (
  echo 📦 首次运行，正在安装依赖...
  call npm install
  echo.
)

echo 🚀 正在启动...
echo    Vite 开发服务器 + Electron
echo    首次启动约需 3-5 秒
echo.

call npm run dev

echo.
if %errorlevel% neq 0 (
  echo ❌ 启动失败 (错误码: %errorlevel%)
) else (
  echo ✅ 应用已关闭
)

pause
