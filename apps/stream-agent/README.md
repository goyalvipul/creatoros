# Kemokem streaming agent

This program runs on the Windows PC that encodes the livestream. Kemokem does not encode it. The agent calls out over HTTPS. Nothing on that PC needs a public port.

Install FFmpeg (with the NVIDIA encoder, `h264_nvenc`) and Node.js 22 on that PC first. In Kemokem, open Creative Studio → Live Studio → Streaming machines, add the computer, and copy the token. The token is shown once.

## Run

```powershell
$env:KEMOKEM_URL = 'https://os.goyalfamily.ca'
$env:KEMOKEM_TOKEN = 'paste-token'
node C:\path\to\creatoros\apps\stream-agent\agent.mjs
```

Optional:

- `KEMOKEM_HEARTBEAT_SEC` defaults to 25.
- `KEMOKEM_DATA` defaults to `%USERPROFILE%\.kemokem-stream`.
- `KEMOKEM_MEDIA` defaults to `C:\MehakLive`.

Run this on the RTX 3060 only. Name that computer so the name includes 3060. Leave the window open as the Windows user who can see the GPU and `C:\MehakLive`.

Put the mp4 files in `C:\MehakLive`. Make one video reads them there, writes `C:\MehakLive\normalized`, and saves `C:\MehakLive\stream\live.mp4`. That stream folder is not listed as a clip. Go live uses `C:\MehakLive\stream\live.mp4` when that file is already there, without building again. It does not download the videos.

## Keep it running

Windows Task Scheduler, trigger At log on, action `node.exe`, argument the full path to `agent.mjs`, and the two environment variables. The account has to be able to read the videos and use the NVIDIA encoder.

Approved folders are set in Live Studio. The agent will not list a folder Kemokem did not ask for, and it skips shortcuts. It does not delete or rename your original videos.

The stream key stays in the agent process only long enough to start FFmpeg. It is not written to the log lines sent back to Kemokem.

A livestream still running when this computer reboots is not started again for a fresh 11 hours. The agent asks Kemokem for the original deadline and stops if that time has passed.

Command to set the agent file on task schedular on windows machine - 

```
$ErrorActionPreference = "Stop"

$source = "D:\creatoros\apps\stream-agent\agent.mjs"
$target = "C:\ProgramData\KemokemAgent\app\agent.mjs"
$task = "Kemokem Stream Agent"
$configPath = "C:\ProgramData\KemokemAgent\config.json"

# 1. Verify the downloaded source exists
if (!(Test-Path $source -PathType Leaf)) {
    throw "Source file not found: $source"
}

# 2. Validate JavaScript using the existing Node runtime
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$node = [string]$config.NodePath

if (!(Test-Path $node -PathType Leaf)) {
    throw "Node executable not found: $node"
}

& $node --check $source

if ($LASTEXITCODE -ne 0) {
    throw "JavaScript syntax check failed. Existing agent unchanged."
}

Write-Host "Syntax validation passed." -ForegroundColor Green

# 3. Stop the running agent
Stop-ScheduledTask -TaskName $task
Start-Sleep -Seconds 3

# 4. Back up and replace, then restart
$backup = "$target.backup.$(Get-Date -Format yyyyMMddHHmmss)"

try {
    Copy-Item $target $backup -Force
    Copy-Item $source $target -Force

    # Verify both files are identical
    $sourceHash = (Get-FileHash $source -Algorithm SHA256).Hash
    $targetHash = (Get-FileHash $target -Algorithm SHA256).Hash

    if ($sourceHash -ne $targetHash) {
        throw "File verification failed."
    }

    Write-Host "Agent updated and verified." -ForegroundColor Green
}
catch {
    if (Test-Path $backup) {
        Copy-Item $backup $target -Force
    }
    throw
}
finally {
    Start-ScheduledTask -TaskName $task
}

# 5. Check running task
Start-Sleep -Seconds 5

Get-ScheduledTask -TaskName $task |
    Select-Object TaskName, State

Write-Host "`nBackup: $backup" -ForegroundColor Cyan

# 6. Show latest logs
Get-Content "C:\ProgramData\KemokemAgent\logs\agent.log" -Tail 25
```