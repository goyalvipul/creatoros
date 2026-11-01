# ComfyUI / LTX implementation status

Date: 2026-10-25.

| Piece | State |
| --- | --- |
| Sidebar **ComfyUI**, page `/comfy` | Written. Owner only. |
| Inner tab **LTX** | Form, draft, validate, machine choice, job list, playback. |
| Inner tab **MiniMax H3** | Form, draft, machine choice, playback. Posts `MINIMAX H3 Motion Context FINAL API.json`. Provider `comfyui-h3`. Migration `0023_h3_drafts`. A live render was not started from the session that added this. |
| Editor graph | Not sent to ComfyUI. |
| API prompt `docs/comfy/LTX_IA2V_Production (API).json` | Generate posts this file with the form’s image, audio, prompt, size, frame rate, duration, start and LoRA strength. |
| Machines | First open with an empty list adds the 3090 (`100.85.189.23:8188`, preferred) and the 3060 (`100.113.189.17:8188`). Both answered `/system_stats` from this server. |
| Check | Reads stats and model names. Does not render. |
| Validate | Local only. |
| Generate | Queues a job, uploads the library files, posts `/prompt`, and polls `/history`. The mp4 stays on that PC. |

Migration `0018_comfy_ltx` adds `gpu_workers` and `ltx_drafts`. Jobs reuse `generation_jobs` with provider `comfyui-ltx`.

A full render was not started from this session. The site shows this after `docker compose up -d --build` recreates `migrate`, `api`, `worker` and `web`.
