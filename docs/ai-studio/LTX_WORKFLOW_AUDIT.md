# LTX workflow audit

Source: `docs/comfy/LTX_IA2V_Production_Shorts-2 (1).json`

This file is a ComfyUI editor document: `nodes`, `links`, `groups`, and `definitions.subgraphs`. It is not an API prompt. Creator OS does not POST it to `/prompt`.

Counted from the file: 77 nodes, 72 links, 2 subgraphs.

## Values that actually apply

Node titles disagree with the widget values. The wired value is the one the form uses.

| What | Node | Title on the node | Value that is wired |
| --- | --- | --- | --- |
| Width | 368 PrimitiveInt | Width: 960 | 576 |
| Height | 382 PrimitiveInt | Height: 540 | 1024 |
| Frame rate | 379 PrimitiveInt | FPS: 24 | 30. The first save node (400) stores 24 and is overridden by the FPS wire through node 441. The upscale save (610) stores 30 and has no frame-rate wire. |
| Duration | 378 PrimitiveFloat | Duration | 20. Wired into TrimAudioDuration (383) input 1. |
| Trim widget | 383 | title mentions 25s | Stores 25. That number is overridden by the Duration wire. |
| LoRA | 446 LoraLoaderModelOnly, mode 0 | | `mehaklora-ltx.safetensors` at 0.8 |
| Second LoRA | 449, mode 4 (bypassed) | | Same file at 1.0. Not used. |
| Prompt | 9994 Textbox, mode 0 | Manual prompt | The text starting `mehakiv OHWXPERSON` |
| Negative | 364 CLIPTextEncode | | The negative text stored on that node |
| Upscale | 609 RTXVideoSuperResolution, mode 0 | | 1152×2048, quality ULTRA |
| Image in the file | 269 LoadImage | | `Mehak Singing in a Blue Studio.png` (a ComfyUI input name, not a Creator OS file) |
| Audio in the file | 276 LoadAudio | title says wakawaka.mp3 | `AYI AYI.mp3` |

The automatic prompt nodes 602, 601 and 604 are mode 4 (bypassed). The manual prompt is the live one.

`videopreview` inside the save nodes points at an old file (`RTX_SR_00003-audio.mp4` and similar). That is not an output of a new job.

## Models named by the active loaders

- `ltx-2.3-22b-distilled-1.1-Q5_K_M.gguf`
- `mehaklora-ltx.safetensors`
- `gemma-3-12b-it-IQ4_XS.gguf`
- `ltx-2.3-22b-distilled_embeddings_connectors.safetensors`
- `ltx-2.3-22b-distilled_video_vae.safetensors`
- `ltx-2.3-22b-distilled_audio_vae.safetensors`

A bypassed FP8 loader is not in this list.

## What is not proven

No API-format export is in the repo. No render was run on the 3090 or the 3060. The 12GB card is selectable because the owner asked for that choice. The graph was built for the 24GB machine. A check can report missing models. It cannot promise the 3060 will finish.
