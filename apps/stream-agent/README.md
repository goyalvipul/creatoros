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

Put the mp4 files in `C:\MehakLive`. Make one video reads them there, writes `C:\MehakLive\normalized`, and saves `C:\MehakLive\live.mp4`. It does not download the videos. Go live sends `live.mp4`.

## Keep it running

Windows Task Scheduler, trigger At log on, action `node.exe`, argument the full path to `agent.mjs`, and the two environment variables. The account has to be able to read the videos and use the NVIDIA encoder.

Approved folders are set in Live Studio. The agent will not list a folder Kemokem did not ask for, and it skips shortcuts. It does not delete or rename your original videos.

The stream key stays in the agent process only long enough to start FFmpeg. It is not written to the log lines sent back to Kemokem.

A livestream still running when this computer reboots is not started again for a fresh 11 hours. The agent asks Kemokem for the original deadline and stops if that time has passed.
