# dsh-vision 依赖引导脚本：在国内镜像下载并解压 Node.js（免安装版，零管理员权限）
# 供 install.bat 在“未检测到 Node.js”时自动调用，也可单独运行：
#   powershell -NoProfile -ExecutionPolicy Bypass -File bootstrap-node.ps1
# 成功时向 stdout 输出 node.exe 的完整路径（install.bat 用 for /f 捕获）。
param(
  [string]$InstallDir = ""   # 解压目录；默认 %USERPROFILE%\.dsh\node-runtime
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# PowerShell 5.1 默认 TLS 1.0/1.1，会导致所有 HTTPS 镜像握手失败，必须强制 TLS 1.2
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:USERPROFILE '.dsh\node-runtime'
}

# 架构映射（Node 下载命名：x64 / arm64 / x86）
$arch = $env:PROCESSOR_ARCHITECTURE
switch ($arch) {
  'AMD64' { $arch = 'x64'; break }
  'ARM64' { $arch = 'arm64'; break }
  'x86'   { $arch = 'x86'; break }
  default { $arch = 'x64' }
}

# 1) 动态获取最新 LTS 版本；失败则回退到已验证的硬编码版本
$version = 'v24.19.0'
try {
  $idx = Invoke-RestMethod -Uri 'https://registry.npmmirror.com/-/binary/node/index.json' -TimeoutSec 20
  $latest = $idx | Where-Object { $_.lts } | Select-Object -First 1
  if ($latest -and $latest.version) { $version = $latest.version }
} catch {
  Write-Host "  [提示] 获取最新版本号失败，回退到 $version"
}

$zipName = "node-$version-win-$arch.zip"
$zipPath = Join-Path $env:TEMP $zipName

# 2) 依次尝试多个国内镜像（npmmirror → 华为云 → 腾讯云）
$mirrors = @(
  "https://registry.npmmirror.com/-/binary/node/$version",
  "https://mirrors.huaweicloud.com/nodejs/$version",
  "https://mirrors.cloud.tencent.com/nodejs-release/$version"
)

$downloaded = $false
foreach ($m in $mirrors) {
  $url = "$m/$zipName"
  Write-Host "  [下载] $url"
  try {
    Invoke-WebRequest -Uri $url -OutFile $zipPath -TimeoutSec 600 -UseBasicParsing
    if ((Get-Item $zipPath).Length -gt 1000000) { $downloaded = $true; break }
  } catch {
    Write-Host "  [失败] $($_.Exception.Message)"
  }
}

if (-not $downloaded) {
  Write-Host "  [错误] 所有镜像下载均失败，请检查网络后重试。"
  exit 1
}

# 3) 解压（优先系统自带 tar.exe，快；不存在则用 PowerShell 内置 Expand-Archive）
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Write-Host "  [解压] $zipName -> $InstallDir"
try {
  & tar.exe -xf $zipPath -C $InstallDir
} catch {
  Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
}

# 4) 定位解压出来的 node.exe 并输出完整路径
$nodeExe = Get-ChildItem -Path $InstallDir -Recurse -Filter 'node.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nodeExe) {
  Write-Host "  [错误] 解压后未找到 node.exe。"
  exit 1
}

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Write-Host "  [完成] Node.js 已就绪：$($nodeExe.FullName)"
Write-Output $nodeExe.FullName
exit 0
