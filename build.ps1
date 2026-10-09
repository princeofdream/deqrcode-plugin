#Requires -Version 5.1
<#
.SYNOPSIS
    deQRCode 构建脚本（Windows / PowerShell）

.DESCRIPTION
    依次执行：依赖安装 → 图标生成 → 单元测试 →（可选）识别率评测 → 构建 → web-ext lint → 打包。

.EXAMPLE
    .\build.ps1
    构建 Firefox 版本。

.EXAMPLE
    .\build.ps1 -Browser chrome
    构建 Chrome / Edge 版本。

.EXAMPLE
    .\build.ps1 -Browser all -Package
    依次构建两个浏览器版本并打包到 .\artifacts\<browser>\。

.EXAMPLE
    .\build.ps1 -SkipInstall -SkipTests
    已装好依赖时快速构建。
#>
[CmdletBinding()]
param(
    [ValidateSet('firefox', 'chrome', 'all')]
    [string]$Browser = 'firefox',

    [switch]$SkipInstall,
    [switch]$SkipTests,
    [switch]$Eval,
    [switch]$NoLint,
    [switch]$Package,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

function Write-Step { param($Message) Write-Host "[build] $Message" -ForegroundColor Cyan }
function Write-Ok   { param($Message) Write-Host "[ ok ] $Message" -ForegroundColor Green }
function Write-Warn { param($Message) Write-Host "[warn] $Message" -ForegroundColor Yellow }
function Write-Fail { param($Message) Write-Host "[fail] $Message" -ForegroundColor Red; exit 1 }

Write-Step "工作目录: $(Get-Location)"

# 1) Node 版本检查
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Fail "未找到 node，请先安装 Node >= 18" }
$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 18) { Write-Fail "Node 版本过低（当前 $(& node -v)），需要 >= 18" }
Write-Ok "Node $(& node -v)"

# 2) 依赖安装
if ($SkipInstall) {
    Write-Warn "跳过依赖安装"
    if (-not (Test-Path 'node_modules')) { Write-Fail "node_modules 不存在，请去掉 -SkipInstall" }
}
else {
    Write-Step "安装依赖…"
    if (Test-Path 'package-lock.json') { & npm ci } else { & npm install }
    if ($LASTEXITCODE -ne 0) { Write-Fail "依赖安装失败" }
    Write-Ok "依赖就绪"
}

$version = & node -p 'require("./package.json").version'
Write-Step "版本: $version"

# 3) 清理
if ($Clean) {
    Write-Step "清理 dist 与 artifacts"
    if (Test-Path 'dist') { Remove-Item -Recurse -Force 'dist' }
    if (Test-Path 'artifacts') { Remove-Item -Recurse -Force 'artifacts' }
}

# 4) 图标
if ((Test-Path 'icons/48.png') -and (Test-Path 'icons/96.png') -and (Test-Path 'icons/128.png')) {
    Write-Ok "图标已存在"
}
else {
    Write-Step "生成占位图标…（如需自定义请替换 icons\*.png 后重新构建）"
    & npm run icons
    if ($LASTEXITCODE -ne 0) { Write-Fail "图标生成失败" }
    Write-Ok "图标已生成"
}

# 5) 单元测试
if (-not $SkipTests) {
    Write-Step "运行单元测试…"
    & npm test
    if ($LASTEXITCODE -ne 0) { Write-Fail "单元测试失败" }
    Write-Ok "单元测试通过"
}

# 6) 识别率评测门禁
if ($Eval) {
    Write-Step "运行识别率评测…"
    & npm run eval
    if ($LASTEXITCODE -ne 0) { Write-Fail "识别率门禁未通过" }
    Write-Ok "识别率门禁通过"
}

# 7) 构建 + lint + 打包
function Invoke-BuildOne {
    param([string]$Target)

    Write-Step "构建 $Target 版本…"
    & npm run "build:$Target"
    if ($LASTEXITCODE -ne 0) { Write-Fail "构建失败 ($Target)" }
    Write-Ok "构建完成 -> dist/"

    if (-not $NoLint) {
        if ($Target -eq 'firefox') {
            Write-Step "运行 web-ext lint…"
            & npm run lint
            if ($LASTEXITCODE -ne 0) { Write-Fail "web-ext lint 未通过" }
            Write-Ok "lint 通过"
        }
        else {
            Write-Warn "Chrome 版本跳过 web-ext lint（该工具面向 Firefox）"
        }
    }

    if ($Package) {
        $out = Join-Path 'artifacts' $Target
        New-Item -ItemType Directory -Force -Path $out | Out-Null
        Write-Step "打包到 $out …"
        & node node_modules/web-ext/bin/web-ext.js build --source-dir ./dist --artifacts-dir $out --filename "deqrcode-$version-$Target.zip" --overwrite-dest
        if ($LASTEXITCODE -ne 0) { Write-Fail "打包失败 ($Target)" }
        Write-Ok "打包完成 -> $out/"
    }
}

if ($Browser -eq 'all') {
    Invoke-BuildOne 'firefox'
    Invoke-BuildOne 'chrome'
}
else {
    Invoke-BuildOne $Browser
}

Write-Ok "全部完成（browser=$Browser, version=$version）"
