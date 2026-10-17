# Dot-source this in a PowerShell session whose Windows credential vault is unavailable
# (symptom: `docker pull` fails with "error getting credentials - A specified logon session does not exist").
# It runs a private copy of docker.exe with an empty config so the Windows credential helper is never invoked.
# Public images (postgres, redis, caddy, node) need no credentials.
#   . .\infra\scripts\docker-env.ps1
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$tools = Join-Path $root '.tools'
$cfg = Join-Path $root '.dockercfg'
New-Item -ItemType Directory -Force $tools, $cfg | Out-Null
if (-not (Test-Path (Join-Path $tools 'docker.exe'))) {
  Copy-Item 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' (Join-Path $tools 'docker.exe')
}
Set-Content (Join-Path $cfg 'config.json') '{"auths":{}}'
$clean = ($env:PATH -split ';' | Where-Object { $_ -notlike '*Docker\Docker\resources\bin*' }) -join ';'
$env:PATH = "$tools;$clean"
$env:DOCKER_CONFIG = $cfg
$env:DOCKER_HOST = 'npipe:////./pipe/dockerDesktopLinuxEngine'
Write-Host "docker -> $((Get-Command docker).Source)"
