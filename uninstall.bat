@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title dsh-vision 一键卸载

echo.
echo  ============================================================
echo    dsh-vision 识图插件 —— 一键卸载
echo  ============================================================
echo.

set "NODE_EXE="

rem 1) node in PATH
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"

rem 2) known locations: Codex runtime / common install dirs
if not defined NODE_EXE (
    for /d %%D in ("%USERPROFILE%\.cache\codex-runtimes\*") do (
        if exist "%%~D\dependencies\node\bin\node.exe" set "NODE_EXE=%%~D\dependencies\node\bin\node.exe"
    )
)
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

rem 3) node previously downloaded by install.bat (reuse)
if not defined NODE_EXE (
    for /d %%D in ("%USERPROFILE%\.dsh\node-runtime\node-v*") do (
        if exist "%%~D\node.exe" set "NODE_EXE=%%~D\node.exe"
    )
)

rem 4) none -> auto download from domestic mirror
if not defined NODE_EXE (
    echo  [信息] 未检测到 Node.js，正在用国内镜像自动下载...
    echo.
    for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bootstrap-node.ps1"') do set "NODE_EXE=%%i"
    echo.
)

if not defined NODE_EXE (
    echo  [错误] 无法获取 Node.js，卸载中止。
    echo         请手动删除：^<DSH_HOME^>/dsh-vision、profiles/*/node_modules/@linenxi-ctrl/dsh-vision、
    echo         以及 ^<DSH_HOME^>/.agent-presets/vision，并从 cordis.patch.yml 移除 vision 行。
    echo.
    pause
    exit /b 1
)

echo  [信息] 使用 Node.js：!NODE_EXE!
echo.
"!NODE_EXE!" "%~dp0uninstall.mjs"
echo.
pause
exit /b 0
