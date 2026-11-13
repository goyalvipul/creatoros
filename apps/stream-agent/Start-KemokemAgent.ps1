#Requires -Version 5.1
<#
Headless launcher for the Windows Task Scheduler LocalService account.
Starts Node agent, retries on unexpected exits and logs only generic lifecycle events.
Does not log secrets or FFmpeg command lines.
#>
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:ProgramData 'KemokemStreamAgent'
$configPath = Join-Path $root 'config.json'
$secretPath = Join-Path $root 'token.machine.dpapi'
$logPath = Join-Path $root 'logs\launcher.log'
function Note([string] $Message) {
    try { Add-Content -LiteralPath $logPath -Encoding UTF8 -Value ("{0:u} {1}" -f (Get-Date), $Message) } catch {}
}
if (!(Test-Path -LiteralPath $configPath -PathType Leaf)) { Note 'Missing config'; exit 2 }
if (!(Test-Path -LiteralPath $secretPath -PathType Leaf)) { Note 'Missing encrypted token'; exit 3 }
try {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $cipher = [IO.File]::ReadAllBytes($secretPath)
    $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
        $cipher, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    try { $env:KEMOKEM_TOKEN = [Text.Encoding]::UTF8.GetString($plainBytes) }
    finally { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
    $env:KEMOKEM_URL = [string]$config.KemokemUrl
    $env:KEMOKEM_DATA = [string]$config.DataDir
    $env:KEMOKEM_HEARTBEAT_SEC = [string]$config.HeartbeatSec
    $env:PATH = ([string]$config.FFmpegBinDir) + ';' + $env:PATH
    $env:NODE_ENV = 'production'
    if (!(Test-Path -LiteralPath ([string]$config.AgentPath) -PathType Leaf)) { Note 'Agent entrypoint missing'; exit 4 }
    if (!(Test-Path -LiteralPath ([string]$config.NodePath) -PathType Leaf)) { Note 'Node.js entrypoint missing'; exit 5 }
    Set-Location -LiteralPath (Split-Path -Parent ([string]$config.AgentPath))
    Note 'Launcher started; agent supervision active.'
    while ($true) {
        # The agent must reconcile previous stream deadlines after any restart.
        & ([string]$config.NodePath) ([string]$config.AgentPath)
        $code = $LASTEXITCODE
        Note ("Agent process exited (code {0}); retry in 20 seconds." -f $code)
        Start-Sleep -Seconds 20
    }
} catch {
    Note 'Launcher failed to initialize. Check config, permissions, Node and FFmpeg.'
    exit 6
} finally {
    Remove-Item Env:\KEMOKEM_TOKEN -ErrorAction SilentlyContinue
}
