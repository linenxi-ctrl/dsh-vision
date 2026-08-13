@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title dsh-vision 一键安装

echo.
echo  ============================================================
echo    dsh-vision 识图插件 —— 一键安装
echo  ============================================================
echo.

set "NODE_EXE="

echo  [1/3] 正在查找 Node.js ...

rem (1) node in PATH
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"

rem (2) known locations: Codex runtime / common install dirs
if not defined NODE_EXE (
    for /d %%D in ("%USERPROFILE%\.cache\codex-runtimes\*") do (
        if exist "%%~D\dependencies\node\bin\node.exe" set "NODE_EXE=%%~D\dependencies\node\bin\node.exe"
    )
)
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

rem (3) node previously downloaded by this script (reuse)
if not defined NODE_EXE (
    for /d %%D in ("%USERPROFILE%\.dsh\node-runtime\node-v*") do (
        if exist "%%~D\node.exe" set "NODE_EXE=%%~D\node.exe"
    )
)

rem ---- step 2: not found -> auto download from domestic mirror ----
if not defined NODE_EXE (
    echo.
    echo  [2/3] 未检测到 Node.js，正在用国内镜像自动下载并安装...
    echo        （免安装版、无需管理员权限，约 30MB，稍等 1~2 分钟）
    echo.
    for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap-node.ps1"') do set "NODE_EXE=%%i"
    echo.
)

if not defined NODE_EXE (
    echo  [错误] 自动安装 Node.js 失败。
    echo         请检查网络后重试，或手动到 https://npmmirror.com/mirrors/node/ 下载安装。
    echo.
    pause
    exit /b 1
)

echo.
echo  [3/3] 使用 Node.js：!NODE_EXE!
echo.
"!NODE_EXE!" "%~dp0install.mjs"
echo.
pause
exit /b 0
