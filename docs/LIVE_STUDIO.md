# Live Studio

Creative Studio → Live Studio prepares a playlist and hands it to a streaming computer. The browser can close. The computer keeps encoding until you stop it, or until the saved deadline.

## Time limits

In `.env`:

```
LIVE_NOTIFY_AFTER_MINUTES=600
LIVE_AUTO_STOP_MINUTES=655
```

600 is 10 hours. 655 is 10 hours 55 minutes. The stop cannot be more than 660 (11 hours). If it is, the API and worker refuse to start. The notice has to be earlier than the stop.

The form can choose a shorter stop for a test. It cannot choose a later one. A short test does not send the 10-hour sentence.

Those values are copied onto the livestream when you press Prepare & Go Live. Changing `.env` later does not extend a livestream that has already started.

## YouTube

Livestreams use the official Live Streaming API. The channel needs `youtube.force-ssl`. In Integrations, **Enable comments** asks for that permission. `youtube.upload` alone cannot create a broadcast.

Kemokem sets the title, description, tags, Music category, language, privacy, Made for Kids, AI disclosure when you choose Yes or No, DVR, recording, auto start, auto stop, embed, and latency. It reads the video before writing metadata so fields you did not change stay as YouTube has them.

These stay in YouTube Studio, and the page says so: age restriction beyond Made for Kids, paid promotion, monetization, live chat moderation, and live captions.

Stopping does not delete the broadcast and does not change a public replay to private. The replay notice is sent after YouTube reports the video is processed and still has the visibility you chose.

Manual RTMPS stores the address and key encrypted. It does not set the title or complete the broadcast. The key is not shown again and is not returned to the browser.

## Streaming computer

Add the computer in Live Studio → Streaming machines and copy the token once. On that computer, install FFmpeg and Node.js 22, then run the agent in `apps/stream-agent/README.md`. Add the media folders there. The agent only lists a folder Kemokem asked for, and it skips shortcuts.

The agent calls Kemokem. It does not open a port. After a reboot it loads the original deadline and stops if that time has passed.

## Rebuild

```
docker compose up -d --build --force-recreate migrate api worker web
```

The streaming computer is not part of that command. Restart its agent only when `apps/stream-agent/agent.mjs` changes.

## What was tested here

Unit tests cover the 10-hour notice, the 10-hour-55-minute stop, the 11-hour cap, a deadline that is not moved later, path checks, and a YouTube metadata update that keeps tags it was not asked to change.

A real unlisted broadcast on Windows and Ubuntu was not run from this session. Do that with a short stop first (type the minutes on the form), then put the `.env` values back to 600 and 655 for a public stream.
