@echo off
chcp 65001 >nul
cd /d %~dp0
echo ==============================================
echo   《今天也没倒闭》局域网开玩启动器
echo ==============================================
if not exist "dist\index.html" (
  echo [1/2] 首次运行，正在构建生产版本...
  call npm run build
) else (
  echo [1/2] 检测到已有构建，如需更新代码请先重新构建或手动删除 dist。
)
echo [2/2] 启动局域网服务器（默认端口 8080，可用 set PORT=xxxx 修改）
node serve-lan.cjs
pause
