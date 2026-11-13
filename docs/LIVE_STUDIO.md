# Live Studio

Creative Studio → Live Studio takes videos from the library, or from an upload, and hands them to a streaming computer you pick. That computer prepares the file and sends the livestream. On the Windows NVIDIA PCs it uses the NVIDIA encoder. The Kemokem server does not encode. The browser can close. The selected computer keeps sending until you stop it, or until the saved deadline.

## Time limits

In `.env`:

```
LIVE_NOTIFY_AFTER_MINUTES=600
LIVE_AUTO_STOP_MINUTES=655
```

600 is 10 hours. 655 is 10 hours 55 minutes. The stop cannot be more than 660 (11 hours). If it is, the API and worker refuse to start. The notice has to be earlier than the stop.

The form can choose a shorter stop for a test. It cannot choose a later one. A short test does not send the 10-hour sentence.

Those values are copied onto the livestream when you press Go live. Changing `.env` later does not extend a livestream that has already started.

## YouTube

Livestreams use the official Live Streaming API. The channel needs `youtube.force-ssl`. In Integrations, **Enable comments** asks for that permission. `youtube.upload` alone cannot create a broadcast.

Kemokem sets the title, description, tags, Music category, language, privacy, Made for Kids, age restriction when you choose 18+, paid promotion when you choose Yes or No, mid-roll ads when you choose on or off, embedded captions when the file already contains them, AI disclosure when you choose Yes or No, DVR, recording, auto start, auto stop, embed, and latency. It reads the video before writing metadata so fields you did not change stay as YouTube has them. If YouTube refuses age restriction, paid promotion, or ads, the livestream still starts and the refusal is shown on the session.

Live chat moderation and automatic captions stay in YouTube Studio. The page says so. The captions control only tells YouTube that captions are already inside the video file.

Stopping does not delete the broadcast and does not change a public replay to private. The replay notice is sent after YouTube reports the video is processed and still has the visibility you chose.

Manual RTMPS stores the address and key encrypted. It does not set the title or complete the broadcast. The key is not shown again and is not returned to the browser.

## Where it runs

Add the computer under Streaming machines and run `apps/stream-agent` on it. On Create stream, choose the videos and press Make one video. That PC normalizes them and saves one file. YouTube stays closed. Press Go live to open the broadcast and send that file. The page checks progress every 5 seconds only while the file is being made or the stream is on air. Active stream shows the on-air time. Stop stream ends it. A library video that is already on that same PC is read there. A video from another PC, or an upload, is copied onto the selected PC first.

## Rebuild

```
docker compose up -d --build --force-recreate migrate api worker web
```

Restart the streaming agent on the Windows PC when `apps/stream-agent/agent.mjs` changes. The Kemokem server is not the encoder.

## What was tested here

Unit tests cover the 10-hour notice, the 10-hour-55-minute stop, the 11-hour cap, a deadline that is not moved later, path checks, and a YouTube metadata update that keeps tags it was not asked to change.

A real unlisted broadcast on Windows and Ubuntu was not run from this session. Do that with a short stop first (type the minutes on the form), then put the `.env` values back to 600 and 655 for a public stream.
