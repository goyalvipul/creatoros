# Kemokem AI integrations

Gemini image and video work stays on a server key. Prompt writing was built for OpenAI, then stopped. Kemokem will not call the paid OpenAI API. Sign in with ChatGPT cannot use a ChatGPT Plus plan on this private public site until OpenAI approves the app. MiniMax is unchanged. Nothing is published until you use the existing Publish control.

A ChatGPT Plus or Gemini app subscription does not pay for these calls. Kemokem does not invent a dollar price. Every paid action says: **Cost estimate unavailable — this operation may be billable.**

Keys live in the server environment, not in the database:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

Add them to `.env`, then rebuild:

```bash
docker compose up -d --build --force-recreate migrate api worker web
```

Settings → AI shows `NOT_CONFIGURED` until the key is present. Test connection lists models. That check does not generate an image and does not prove that billing or quota is available.

Limits use the America/Vancouver day and month. They count requests that reached the provider, including failures. They are not an invoice.

## What you can do

### Scene prompts (ChatGPT plan — approval required)

Kemokem is classified **Requires OpenAI approval**. It is a private, invitation-only website at `https://os.goyalfamily.ca`. The API runs on your Ubuntu server and prompt requests would run on that server, not on your laptop. OpenAI’s current docs allow ChatGPT-plan usage for open-source tools, personal projects that run locally, and selected private apps. A remotely hosted private app is told to [join the waitlist](https://openai.com/form/sign-in-with-chatgpt-interest/).

Sources: [Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart), [open-source plan usage](https://developers.openai.com/siwc/token-sharing-open-source), [using your plan in other apps](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites).

There is no Continue with ChatGPT button, because that flow is not authorized for this deployment and a button would only fail. Generate prompt, Improve prompt, and Variations stay disabled. Typed prompts are unchanged. `OPENAI_API_KEY` is not used.

### Scene prompts (designed, not callable)

Where: Create Studio → MiniMax H3, on each clip. Create Studio → Long Videos, on each scene.

Buttons:

- **Generate prompt** writes an image prompt (one still frame) and a video prompt (motion over the clip). They are not the same text.
- **Improve prompt** revises the prompt already in the box.
- **Variations** returns up to three drafts.
- **Apply video prompt** copies the video prompt into the scene or clip. If you already typed something, Kemokem asks before replacing it.
- **Copy** puts the video prompt on the clipboard.

Vocal scenes include a lip-sync note. The note is a warning. The prompt does not lock the mouth to the song. B-roll does not ask for lip sync.

The draft is saved as a prompt version with the model name and time. Applying a Long Videos version also stores the video prompt on that scene, so a refresh keeps it. MiniMax still uses the clip prompt you applied. It does not start a render.

Empty lyrics stay empty. A character name is not treated as a face. Reference pictures remain the visual source.

### Scene images (Gemini Nano Banana)

Where: each Long Video scene, **Generate image**. The project header has **Generate missing images** for up to four scenes that have no picture, one job at a time.

The worker sends the image prompt plus the scene’s reference pictures and any library pictures named on the creator profile. If there are more pictures than that model allows here, the request stops and lists the count. Pictures are not dropped to make the call fit.

| Model | Reference pictures kept |
| --- | --- |
| gemini-3.1-flash-lite-image | 1 |
| gemini-2.5-flash-image | 3 |
| gemini-nano-banana-2.1, gemini-3.1-flash-image, gemini-3-pro-image | 8 |

Aspect choices: 16:9, 9:16, 1:1, 4:5, 3:2, 4:3, 21:9. Sizes: 1K and 2K. 4K is not offered.

The image is written under Kemokem attachments (`ai/{workspace}/{id}.png`). It survives a reload. **Use on scene** copies it onto that Long Videos scene as a reference. The AI original stays. **Variation** asks for another image from an existing one and keeps the previous file. MiniMax is not started.

A second image request is refused while one is queued or running, so a double-click does not buy two images. If the worker stops mid-call, the job is marked failed and is not sent again. Retry only by pressing the button, which is a new billable request.

### Video analysis and publishing text (Gemini)

Where: Publishing → open a title → **AI publishing assistant**, next to the post form.

- **Analyze video** uploads that linked library file to Gemini and stores a summary, key moments, hook, strengths, and thumbnail ideas. Unclear speech is marked uncertain. Lyrics are not invented.
- **Show analysis** reads the saved result.
- **Generate publishing details** needs that analysis. It drafts titles, a description, tags, a caption, a thumbnail idea, a hook, and a call to action for the platform you have selected.
- **Apply title**, **Apply description**, and **Apply tags** fill only that field. If the field already has text, Kemokem asks before replacing it.
- The form’s existing save and publish buttons are unchanged. Applying a suggestion does not post.

Closing the page does not cancel a provider call that has already started. The result is stored on the job. Open the same video and choose Show analysis.

### Creator voice

Settings → AI → Creator voice. Name, niche, tone, character notes, words to avoid, and links are sent as context. They are per workspace. They do not describe a face and they are not shared into another workspace.

### What is refused

- A viewer cannot run or change AI.
- Only the owner can change models, limits, and the creator voice.
- Requests stop when the daily or monthly count is reached.
- Keys are not returned to the browser, not stored in `NEXT_PUBLIC_` variables, and not written into logs on purpose. Provider errors are scrubbed if they echo a key.
- Text inside lyrics or a prompt cannot instruct Kemokem to publish, spend, or reveal secrets. Model output is a draft, not a command.

## Models you can select

Prompt: `gpt-5-mini` (default), `gpt-5`, `gpt-4.1-mini`, `gpt-4.1`.

Image: `gemini-nano-banana-2.1` (default), `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-3-pro-image`, `gemini-2.5-flash-image`.

Video and metadata: `gemini-2.5-flash` (default), `gemini-2.5-pro`, `gemini-3-flash`.

Test connection shows which of these the key’s project actually lists. Pick one that appears there. A model in the menu that the project cannot access will fail that request and will not be reported as success.

## What was not done

No live OpenAI or Gemini call has been made from this build. Tests use fixtures and do not spend credit. Image generation, video analysis, and metadata are implemented and waiting on keys plus your confirmation of a real call. Dollar prices are not shown because there is no verified price table for this account. 4K images are not offered. The phone push for AI stays a digest or in-app alert until you turn push on for that event in Settings → Notifications.
