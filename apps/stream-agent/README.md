# Kemokem streaming agent

This program runs on the computer that will encode the livestream. Kemokem in the browser does not have to stay open. The agent calls out over HTTPS. Nothing on this computer needs a public port.

Install FFmpeg and Node.js 22 on that computer first. In Kemokem, open Creative Studio → Live Studio → Streaming machines, add the computer, and copy the token. The token is shown once.

## Run

```bash
KEMOKEM_URL=https://os.goyalfamily.ca KEMOKEM_TOKEN='paste-token' node agent.mjs
```

Optional:

- `KEMOKEM_HEARTBEAT_SEC` defaults to 25.
- `KEMOKEM_DATA` defaults to `~/.kemokem-stream`. Cached videos and the combined file stay there.

## Keep it running

Linux, as your user (the user who can read the media folders):

```ini
# ~/.config/systemd/user/kemokem-stream.service
[Service]
Environment=KEMOKEM_URL=https://os.goyalfamily.ca
Environment=KEMOKEM_TOKEN=paste-token
ExecStart=/usr/bin/node /path/to/creatoros/apps/stream-agent/agent.mjs
Restart=always
```

`systemctl --user enable --now kemokem-stream`

Windows: Task Scheduler, trigger At log on, action `node.exe` with argument `C:\path\to\agent.mjs`, and the two environment variables. The account has to be able to read the approved folders.

macOS: a LaunchAgent plist with the same environment variables and `RunAtLoad` true.

Approved folders are set in Live Studio. The agent will not list a folder Kemokem did not ask for, and it skips shortcuts. It does not delete or rename your original videos.

The stream key stays in the agent process only long enough to start FFmpeg. It is not written to the log lines sent back to Kemokem.

A livestream still running when this computer reboots is not started again for a fresh 11 hours. The agent asks Kemokem for the original deadline and stops if that time has passed.
