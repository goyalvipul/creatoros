# Creator OS — agent handoff (read this first)

One-file briefing for a new AI agent or a person picking up this repository. It says what the product is, where the code lives, how a change is made, which commands deploy it, and what is true right now.

Deeper detail, when you need it: `AGENTS.md` (short rules), `docs/PRODUCT_SPEC.md` (full intent), `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/IMPLEMENTATION_PROGRESS.md` (ledger), `docs/OPERATIONS.md` (backup and the scanner), `docs/EXTERNAL_PREREQUISITES.md`, `docs/TEST_MATRIX.md`, `FEATURES.md`.

**Keep this file current.** If you change a screen, an API, a migration, a command, or what is actually running, update the matching section here in the same change. Do not leave the next agent reading yesterday's behavior.

Last updated: 2026-10-25, on the Ubuntu host `guardobox`, working tree not yet committed.

## 1. What this product is

Creator OS is a private, self-hosted app for one owner. The owner runs a virtual singer, **Mehak**, and will add more brands later. The daily question is: what have I created, on which machine, where has each version been posted, which message or payment needs a reply, and what should I do next.

It must stay useful with zero third-party credentials. Nothing is posted, emailed, or paid until the owner presses the button for that one action. Indexing never moves, renames, or deletes original media. Those three happen only when the owner confirms that one file in the library, and only on the PC that holds it.

Today it is a single owner. Every owned row is scoped by `org_id`. Roles are VIEWER < EDITOR < OWNER.

### How the owner's world is organized

```
Brand (Channels page: Mehak, and later others)
  └─ Channel (a purpose under that brand, for example the main Mehak channel)
       └─ Social account (YouTube, Instagram, Facebook, TikTok, …)
            linked to a provider connection in Integrations

Creative project (Production) and logical asset (Library → Assets)
  └─ Distribution variant, called a "title" on the Publishing plan
       └─ Attached library videos (file instances on a Windows PC)
            └─ One publish action per file per account
```

Brands, channels, and accounts are created on **Channels**. Production projects and Publishing titles can belong to a brand. A new brand does not appear in Publishing until it exists on Channels. Its accounts show up as columns only after they are added under that brand's channels.

## 2. Rules that do not bend

1. Indexing never modifies, moves, or deletes original media. Rename, move, and delete run only after the owner confirms that one file, on the PC that holds it, inside a folder that PC already indexes.
2. Nothing is sent, posted, or paid without an explicit owner action on that item.
3. No fake data. An unconfigured integration reports `NOT_CONFIGURED` or `BLOCKED_EXTERNAL` and the next human step. Demo rows are labelled DEMO and can be removed.
4. Postgres and Redis are not published beyond loopback. No default password. Secrets live only in `.env`, never in code, logs, chat, or git.
5. Counts come from their own tables. Never count by joining file instances × publications × deliverables.
6. A file is "missing" only after complete scans plus a grace period. Offline is not missing.
7. Say what you ran and what you did not. A written test that was not executed is not evidence.

## 3. Where the code lives

```
apps/api            Fastify REST under /api/v1. Routes: src/routes/{core,content,storage,work,socials}.ts
apps/worker         BullMQ. Scheduled jobs in src/jobs.ts. On-demand jobs (sync, backup, publish) in src/main.ts
apps/web            Next.js App Router PWA. Screens in src/app/(app)/*. The installed phone app draws under the status bar (`viewport-fit: cover`). The top bar has a `safe-top` spacer (`env(safe-area-inset-top)`); the bottom nav uses `safe-bottom`.
apps/scanner-agent  Go. Windows service or Linux systemd. Scans are read-only. Confirmed rename, move, and delete are the only writes.
packages/domain     Enums, Zod, pure rules
packages/db         Drizzle schema in src/schema/*, SQL migrations in drizzle/*.sql plus drizzle/meta/_journal.json
packages/services   All business logic. The API, the worker, and tests call this. Do not put rules only in a route.
packages/connectors Platform HTTP: Google, YouTube, Gmail, Meta, publish uploads, Postiz, Todo
packages/ui         Shared UI bits (the app's own components are apps/web/src/components/ui.tsx)
infra/docker        Dockerfile (one file, targets migrate / api / worker / web) and Caddyfile
infra/scripts       dev, backup, restore, diagnostics, restart-test, tailscale, agent build
tests/integration   Vitest + real Postgres
tests/e2e           Playwright, desktop and 360px
```

HTTP: `makeRouter` in `apps/api/src/http.ts`. GET defaults to VIEWER; other methods default to EDITOR. Responses are `{data, meta, error}`. Viewer-private GETs are the `PRIVATE_GET` regex in that file.

UI components used everywhere: `PageHeader`, `Select`, `Button`, `ActionButton` (confirm + toast), `FormDialog`, `useApi`, `post`, `put`, `del`, `refresh` from `@/lib/api` and `@/components/ui`.

### Screens

| Path                                                                            | What it is                                               |
| ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `/`                                                                             | Home / daily briefing                                    |
| `/today`                                                                        | Inbox and today                                          |
| `/content`                                                                      | Ideas                                                    |
| `/production`, `/production/[id]`                                               | Projects, scenes, checklists                             |
| `/library`                                                                      | Files across machines. Filters, upload marks, Extra tag  |
| `/publishing`                                                                   | Plan matrix: titles × accounts for the selected brand    |
| `/publishing/[variantId]`                                                       | One title: link videos, publish each file to one account |
| `/calendar`                                                                     | Publications, deadlines, commitments                     |
| `/collaborations`, `/collaborations/threads/[id]`, `/collaborations/deals/[id]` | CRM, email, invoices                                     |
| `/collaborations/invoices/new`, `/collaborations/invoices/[id]`                 | Invoice document: from, to, lines, bank details          |
| `/socials/*`                                                                    | Comments, inbox, leads, scheduled. Not the email inbox   |
| `/channels`                                                                     | Brands → channels → social accounts                      |
| `/storage`                                                                      | Devices, scan roots, pairing                             |
| `/integrations`                                                                 | OAuth and opt-in scopes                                  |
| `/analytics`, `/workflows`, `/settings`                                         | Reports, automations, health, demo data                  |

### Route files

| File                             | Owns                                                |
| -------------------------------- | --------------------------------------------------- |
| `apps/api/src/routes/core.ts`    | Auth, health, settings, search                      |
| `apps/api/src/routes/content.ts` | Brands, projects, assets, publishing, publications  |
| `apps/api/src/routes/storage.ts` | Devices, roots, library, file stream, library marks |
| `apps/api/src/routes/work.ts`    | Integrations OAuth, mail, CRM, backups, jobs        |
| `apps/api/src/routes/socials.ts` | Social inbox, comments, workflows                   |

### Migrations

Hand-written SQL in `packages/db/drizzle/NNNN_name.sql`, plus a new entry in `packages/db/drizzle/meta/_journal.json` (next `idx` after the last one). Update the matching Drizzle table in `packages/db/src/schema/`. Do not edit a migration that has already been applied on the server. Current last migration: **`0013_invoice_document`**.

The `migrate` container runs these once, before the API starts. It does not run again just because you rebuilt the API.

## 4. How to change or add a feature

1. Read this file and the service you will touch. Follow an existing function instead of inventing a new pattern.
2. If the database changes: next SQL file, journal entry, Drizzle column. Prefer a nullable column or a new table over rewriting history.
3. Put the behavior in `packages/services`. Routes stay thin.
4. Add the route with `makeRouter`. Side effects that must not double-run go on a BullMQ job with `attempts: 1` and a claimed database row (see publish).
5. Build the screen in `apps/web/src/app/(app)/`. Empty, error, and offline states are part of the screen. Keep it usable at 360px.
6. Add an integration test under `tests/integration/test`. The owner sometimes says not to run it; still write it, and say you did not run it.
7. Update this file and `docs/IMPLEMENTATION_PROGRESS.md`.
8. Deploy with the command in section 6. `docker compose build` alone does not change the site the owner is looking at.

Do not commit unless the owner asks. Do not push. The owner pushes.

## 5. What is true right now (2026-10-19)

These behaviors are in the working tree. They are on the running site only after the deploy command in section 6 has been run since the edit.

### Publishing

- The plan dropdown is **brands** from Channels (`GET /catalog`), not creative projects. `GET /publishing/matrix?brandId=` limits both the account columns (via `channels.brand_id`) and the title rows.
- A title created while a brand is selected stores `distribution_variants.brand_id`. Older titles were backfilled from the asset's brand or the project's brand. A title with no brand shows only under **All brands**.
- Each row has an **×** on the right. `DELETE /variants/:id` removes the plan row. The file is not deleted. A publication that already went out stays (`variant_id` is set null).
- Opening a title goes to `/publishing/[variantId]`. **Link a file** lists every video in the same folder on the same machine as that title's asset (`GET /library?kind=VIDEO&assetId=&sameFolder=true`). A folder asset already holds those files. A title whose asset only has one of them still offers the rest of that folder. Unlink does not delete the file or a post already sent.
- **To match** lists posts imported from a connected account that are not attached to a plan. Each row opens the library file when one is stored (`/library?file=`), and opens the platform URL otherwise. **Link to plan** calls `POST /publications/:id/link-variant`. The plan list follows the brand filter.
- **Publish** is per file and per account. Same `requestId` does not upload twice. Worker job name `publish`, queue `requests`, `attempts: 1`. The draft row is claimed from `QUEUED`. States: `QUEUED`, `UPLOADING`, `PUBLISHED`, `FAILED`, `UNCERTAIN`. Uncertain means bytes may have arrived; do not auto-retry.
- The worker streams the file from the online Windows agent with the same signed URL as `/files/:id/stream` (`packages/services/src/agent-file.ts`). If that PC is off, the draft becomes `FAILED` and is not marked published.
- YouTube needs opt-in scope `youtube.upload` (**Enable uploads** on Integrations). Privacy must be chosen; nothing defaults to public. The publish dialog also asks for Video or Short (`publish_drafts.content_form`, migration `0015_youtube_form`). YouTube has no upload flag for that: a Short is a vertical or square file of at most 3 minutes, and choosing Short adds `#Shorts` to the title. Description is the description only. Tags go to `snippet.tags` and are not copied into the description. The file is streamed with `duplex: 'half'`; without that, Node rejects the body before YouTube sees it. Facebook Page video needs opt-in `pages_manage_posts` (**Enable Page videos**). That scope is not part of a normal Page reconnect. The upload goes to `graph-video.facebook.com` as form fields (Graph ignores a JSON body) and declares the byte length actually read, in the `end_offset` chunks Facebook returns. Declaring the older scanned size makes Facebook return error 6000 / 1363045. A failed or uncertain upload keeps **Try again** enabled. Only an in-progress upload or a published post locks the button. Instagram Login does not accept the file bytes (`upload_type=resumable` is ignored and Instagram answers `video_url is required`). The worker gives Instagram a 30-minute signed `GET /api/v1/files/:id/stream?token=` on `APP_BASE_URL`. Instagram downloads it while the owning PC stays on. The original is not copied. The link expires. After publish, the stored link is the platform `permalink`, not `instagram.com/reel/{numeric id}`. A post with no title shows its caption on the calendar. TikTok stays disabled (audit). **Add a live post** is still the manual path.
- A socket `EPIPE` used to exit the worker about once a minute and leave the draft on `UPLOADING`, so Publish spun with no error. The worker now logs that and stays up. On startup it marks any leftover `UPLOADING` draft `FAILED` so Try again is available.
- Code: `packages/services/src/publishing.ts`, `packages/services/src/publish-run.ts`, `packages/connectors/src/publish-upload.ts`, `apps/worker/src/jobs.ts` (`jobPublish`), `apps/web/src/app/(app)/publishing/`.
- Test written, not run: `tests/integration/test/publishing-upload.test.ts`. Not live-verified against YouTube, Instagram, or Facebook.
- Live Instagram for @mehakviking has been Meta `API access blocked` (OAuthException 200). The button should show that error. Reconnect does not clear a Meta block.

### Content ideas

- Status path on each card: New → Start researching → Approve, Reject, Archive, or Delete. **Bring back** restores an archived idea to the status it had before archive (`ideas.archived_from`), and a rejected idea to New. Delete sets `deleted_at`. It hides the idea and leaves any Production project that was already created.
- **New idea** and **Edit** are pages (`/content/new`, `/content/[id]`), not a dialog. The form opens with every field filled in. Saving an idea that already has a project does not change that project.
- Pitch is no longer a separate box. **Detailed concept** is the writing field at the top. Old pitches are shown in that field the first time you edit them. Search looks at the concept text. **Dictate** on that field uses the browser speech service (Chrome or Edge); other browsers show the control disabled. Caddy must send `Permissions-Policy: microphone=(self)`. `microphone=()` blocks the laptop prompt; phone browsers often ignore it. Restart Caddy after changing `infra/docker/Caddyfile`.
- Unsaved writing is stored in this browser (`localStorage` key `cos-idea-draft:`). Closing the app and opening New idea or that idea again restores it. **Discard** clears it. **Capture** or **Save** clears it after the server accepts the idea.
- Extra fields: song title plus an optional library audio file, detailed concept (bold, italic, underline, lists; emoji is plain text), audience, competitor, hook, narrative, and distribution. Detailed concept is stored as HTML and sanitized in `packages/domain/src/rich-html.ts` (those tags only, no attributes).
- **Make a project** copies those fields onto the project, along with the brief and concept the project already had. Production → Details → Edit changes the project copy. Later idea edits do not follow it.
- Code: `packages/services/src/projects.ts` (`createIdea`, `updateIdea`, `deleteIdea`, `convertIdea`), `apps/api/src/routes/content.ts`, `apps/web/src/app/(app)/content/page.tsx`, `apps/web/src/components/creative-fields.tsx`, `apps/web/src/app/(app)/production/[id]/page.tsx`. Migration `0012_idea_brief`.

### Library

- List rows include tags (`packages/services/src/library.ts`). The page uses those for YouTube / Instagram / TikTok marks and the Extra tag (`PUT /library/marks`). A missing `tags` array must be treated as empty. Calling `.some` on it crashed the whole Library page.
- Library opens on Assets, then Files, then Duplicates. Opening an asset lists that folder’s files with the same row actions and file detail as the Files tab (`GET /library?assetId=`). **Add to title** on a video attaches it to a publishing title for that asset, or creates the title first (`POST /variants`, then `POST /variants/:id/files`). Nothing is posted. Versions still unlinks a file from the asset without touching the original.
- File detail → **On this PC** can rename, move, or delete that one original. Move stays on the same drive and inside a folder that PC already indexes. Delete removes the file from the disk (not the Recycle Bin) and hides it from the library; posts already sent stay. The change is queued (`file_operations`, migration `0017_file_operations`) until the agent on that PC polls `GET /agents/file-operations` and reports `POST /agents/file-operations/result`. The agent binary on each Windows PC has to be replaced and the service restarted before this runs. `docker compose` does not update those PCs. Unlink still does not touch the file.
- Library → Assets builds one asset per folder, machine and file kind. The title is `folder_machine` (`devices.display_name`, so the 12GB and 24GB PCs stay separate). Folder is the parent directory of the file. Kinds are Videos, Images, Audio, Document, Project. The list is newest file modification first and can be filtered by machine (`GET /assets/machines`, `GET /assets?deviceId=`). Identity is `logical_assets.folder_key` + `device_id` + `kind`, source `folder`. Migration `0014_folder_assets`. Opening the tab or finishing a scan runs `syncFolderAssets`. Original files are not moved.

### ComfyUI / LTX

- Left nav **ComfyUI**, page `/comfy`. Inside it, **LTX** is the working tab. MiniMax H3 is a tab that does not start a job.
- Generate posts `docs/comfy/LTX_IA2V_Production (API).json` to the selected PC’s `/prompt`. The editor graph is not sent. The job is queued (`generation_jobs`, provider `comfyui-ltx`), the worker uploads the library image and audio, then polls `/history`. The mp4 stays in that PC’s ComfyUI output folder. The page plays it through `/api/v1/comfy/jobs/:id/video`.
- The first visit with an empty machine list adds the 3090 at `http://100.85.189.23:8188` (preferred) and the 3060 at `http://100.113.189.17:8188`. Both answered from this server. A public address is still refused. **Check** does not render. **Validate** does not call the PC. The 12GB card can be selected; the form warns that this graph was built for 24GB.
- Defaults from the API file: 576×1024, 30 fps, 30 seconds, start at 48 seconds, LoRA `mehaklora-ltx.safetensors` at 0.88. The worker polls every 15 seconds (`ltx` on the jobs queue) and also takes the `ltx` request as soon as Generate is pressed. The Docker image does not copy `docs/`, so the same API file is also at `packages/services/ltx/`. A missing file shows the form and says Generate cannot start; it does not blank the page. Rebuild `api`, `worker` and `web`.
- Creates and edits made while the phone is offline (a workflow, an idea, a draft) stay on that phone and sync when the connection returns. The banner says they are on the phone until the server accepts them. Generate, publish, pay, file delete, and turning a workflow on are not queued. The service worker keeps the last opened pages for that fallback and still asks the server first while online. Rebuild `web`.

### Mail, invoices, socials (already in earlier commits)

- Collaborations inbox is email and pasted threads. Social threads stay in Socials.
- Workflows can be created from scratch or imported from a template. The editor is an ordered canvas: drag a step, or use Move up and Move down. Match options include contains, whole word, the entire message, and emoji. Steps still run in a straight line. A failed condition stops the rest. Nothing is sent unless the workflow is Fully automatic and that account is allowed to send.
- Editors and viewers do not see Publishing, Calendar, Collaborations, Socials, Workflows, ComfyUI, Analytics, Channels, Storage & Devices, Integrations or Settings. The nav hides them and those API paths require OWNER. They still have Home, Content and Production. Editors also have Inbox & Today and Library. Viewers do not.
- Settings → Team: an owner can permanently delete another person (`DELETE /members/:id`). That removes their sign-in. Files, posts and deals stay. You cannot delete yourself, and the last active owner stays.
- Workspace OS publishes tasks into Today. Integrations → Todo app stores the address, the `creatoros` access token and the `wos_whsec_` signing secret. The webhook is `POST /api/v1/integrations/workspace-os/webhook` (raw body HMAC, 5 minute skew, deduped by `X-WOS-Event-Id`). Completing a received task is patched back. A missed webhook is filled by listing `/api/v1/integrations/creatoros/tasks` (`items`, also accepted as `tasks`) on the fast sync. Details: `docs/TODO_ADAPTER_CONTRACT.md`. The running site shows this only after `docker compose up -d --build`.
- `GET /socials/platforms` fills the social tabs. Stored Instagram diagnostics are attached only when an Instagram connection exists. Do not run that probe on the first account in the list: a Facebook or YouTube connection makes the probe throw `Social account not found` and every tab fails.
- A social reply is not blocked by a 24 hour window. Send stays available. Nothing is sent until the owner presses Send. `sendEligibility` in `packages/services/src/social.ts`.
- Gmail: starred sync, invoice search, full message text, per-message reply, live CAD totals. Sending mail needs **Enable sending** (`gmail.send`).
- YouTube comments need **Enable comments** (`youtube.force-ssl`).
- Invoice amounts in CAD use a stored FX rate (Frankfurter, then open.er-api). If both fail, the last rate is kept. Nothing is invented.
- Home highlights open the record they were counted from. A thread opens `/collaborations/threads/[id]`, an invoice opens `/collaborations/invoices/[id]`, a deal or deliverable opens `/collaborations/deals/[id]`, a planned post opens `/publishing/[variantId]`, and a task you typed or that arrived from Workspace OS opens that row on Today (`/today?action=`). The count tiles use the same filter as the number: Need a reply is `state=NEED_REPLY&linked=deal` (those threads are often already in the Pipeline folder, so the folder is not forced to Inbox), Possible collaborations is triage `POSSIBLE` plus category `COLLABORATION` with no opportunity yet, Overdue invoices is the invoices tab on `OVERDUE`, Posts to match opens Publishing on To match, Due today filters Today to that local day. Instagram messages inside the possible-collaborations count stay in Socials. `actionSourcePath` in `packages/services/src/actions.ts` builds the link at read time, and a refresh of an open action also rewrites `deep_link`.
- An invoice status is chosen on the Invoices table (`POST /invoices/:id/status`): Issued, Confirmed, Paid, Sent, Overdue, Void. A new invoice is Issued. An Issued invoice whose due date has passed becomes Overdue on that save and on the existing worker pass. Confirmed, Sent, Paid and Void stay as chosen. Paid is the label; money still shows from recorded payments. Void is refused when a payment exists. **Split** (`POST /invoices/:id/split`) keeps the first amount and due date on the same invoice number and creates one or more invoices for the other amounts and due dates. Deal, currency and billing details are copied. New numbers come from `INV-year-####`. Migration `0016_invoice_status` adds `SENT` and `CONFIRMED`.
- An invoice document is a page: `/collaborations/invoices/new` and `/collaborations/invoices/[id]`. From, to, dates, number, currency, lines (description, quantity, unit price, tax percent) and bank details are editable. Line amount, subtotal, tax and amount due are calculated; amount due is stored as `invoices.amount_minor`. Lines live in `invoice_lines`. Creating without lines (email suggestions, tests) still sends `amountMinor` only. Migration `0013_invoice_document`. Code: `packages/services/src/crm.ts` (`createInvoice`, `updateInvoice`, `getInvoice`), `apps/api/src/routes/work.ts`, `apps/web/src/app/(app)/collaborations/invoice-editor.tsx`.

## 6. Commands

Run these from the repo root: `~/workspace/creatoros` on the Ubuntu server, or the clone on the Windows PC.

### Deploy so the owner actually sees the change

`docker compose build` only creates images. The containers already running keep the old image. `docker compose restart` starts those same containers again. It does not load new code or a changed `.env`.

After application code changes, including a new migration:

```bash
docker compose up -d --build
```

That rebuilds api, worker, web, and migrate, runs pending migrations, then starts the new containers. Postgres data is kept.

If you only need some of the services, include **migrate** whenever a new SQL file exists. The API will query columns that do not exist yet if you skip it.

```bash
docker compose up -d --build --force-recreate migrate api web
```

`--force-recreate` replaces those containers even when Compose thinks nothing changed. Use it when a rebuild did not show up in the browser.

Check:

```bash
docker compose ps
docker compose logs migrate --tail 30
curl -sS http://127.0.0.1:8080/api/v1/health/ready
```

Web, API, and worker should have been created just now. Migrate should say it exited after "migrations applied". Then reload the browser page. While online the service worker asks the server first, so a reload picks up the new page. It only keeps the last opened pages for when the phone is offline.

### Day to day

| You want                                       | Command                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| Status                                         | `docker compose ps`                                                   |
| Follow one log                                 | `docker compose logs -f api` (or `worker`, `web`, `caddy`, `migrate`) |
| Stop / start the same containers               | `docker compose stop` / `docker compose start`                        |
| Restart without new code                       | `docker compose restart`                                              |
| Apply a `.env` change (not `API_INTERNAL_URL`) | `docker compose up -d`                                                |
| `API_INTERNAL_URL` changed                     | `docker compose up -d --build web`                                    |
| Change still invisible                         | `docker compose up -d --force-recreate`                               |
| Health                                         | `curl -sS http://127.0.0.1:8080/api/v1/health/ready`                  |
| Support bundle, no secrets                     | `pnpm diagnostics`                                                    |
| Backup / restore                               | Automatic backup is once a day, 03:15 America/Vancouver. `pnpm restore ./backups/<file>.dump` checks; add `--yes` to replace the live database. Scheduled dumps are in the `worker` container at `/data/backups` (`docker compose cp`). |
| Prove restarts keep data                       | `pnpm restart-test`                                                   |
| Tailscale HTTPS                                | `pnpm tailscale enable`                                               |

Do not change `POSTGRES_PASSWORD` after the first start. Changing `ENCRYPTION_KEY` makes stored OAuth tokens unreadable; reconnect integrations after that.

### Develop and test

Prefer tests on a machine with more than this server's 3.8 GB RAM. The Ubuntu box is the running app.

```bash
pnpm install --frozen-lockfile
pnpm dev                         # local API + web; needs the dev compose profile for Postgres/Redis
pnpm check                       # format, lint, typecheck, unit
pnpm typecheck
pnpm --filter @creatoros/web typecheck
pnpm test:integration            # real Postgres. Unset TEST_DATABASE_URL first so the harness starts its own DB
pnpm test:agent                  # Go
pnpm test:e2e                    # Playwright. Do not run bare playwright after pnpm build
pnpm build
pnpm db:migrate
pnpm agent:build -- --all
```

On Windows, before any `docker` command in an agent shell: `. .\infra\scripts\docker-env.ps1`. If that changes the directory, `cd` back to the repo.

`pnpm test:e2e` builds the web app against the test API. A bundle from `pnpm build` points at another API and every browser test fails at sign-in.

### Git

```bash
git status
git log --oneline -15
git diff
```

Commit only when the owner asks. Do not chain `git commit` with other commands. The owner runs `git push`. Remote: `https://github.com/goyalvipul/creatoros.git`, branch `main`.

## 7. Runtime

- pnpm 12, TypeScript 5.9 ESM strict, Node 22 in the images. Postgres 17, Redis 7, Caddy 2, Go for the scanner, ffmpeg/ffprobe.
- Compose project name `creatoros`. Services: `db`, `redis`, `migrate`, `api`, `worker`, `web`, `caddy`. Host port **8080**. Profile `dev` adds loopback-only `db-proxy` (5432) and `redis-proxy` (6379).
- Memory limits: db 1g, api 768m, worker 768m, web 512m, redis 384m, caddy 128m.
- One Dockerfile, `infra/docker/Dockerfile`. Building the web target still compiles the API and the worker in the build stage. Next.js bakes `rewrites()` at build time, so `API_INTERNAL_URL=http://api:4000` is set in that stage.
- `AGENT_LOOPBACK_HOST` rewrites `127.0.0.1` / `localhost` in agent listen URLs so the API container can reach an agent on the Docker host. On this Linux server set it to the bridge address (often `172.17.0.1`) if the default `host.docker.internal` mapping is not enough.
- Auth: session cookie, Argon2id, CSRF, login throttling, optional TOTP. No public sign-up. The first visit is the setup wizard.
- Jobs the owner triggers (sync, backup, publish) go on the BullMQ queue `requests`. Repeating jobs go on `jobs`.

### This server

- Host: Ubuntu `guardobox`. Checkout `~/workspace/creatoros`. LAN `192.168.1.151`, Tailscale `100.108.120.8`. About 2 cores and 3.8 GB RAM. No GPU. Do not run the full integration or Playwright suites here.
- Public URL in use: `https://os.goyalfamily.ca` (Caddy on 8080 behind that name). `APP_BASE_URL` and `ALLOWED_ORIGINS` must be that origin or the browser gets a cross-site error.
- Scanner PCs (Tailscale): 12 GB GPU at `100.113.189.17`, 24 GB GPU at `100.85.189.23`.
- The other Ubuntu box `intelnuc` runs Nextcloud on 8080. Do not deploy Creator OS there.
- Google OAuth redirect must be exactly `<APP_BASE_URL>/api/v1/integrations/oauth/callback`, the same in `.env` and in Google Cloud. Google rejects a raw IP and plain HTTP except localhost.
- Secrets: `.env` only. Losing `ENCRYPTION_KEY` (documented in `.env.example`; the compose file uses that name) makes stored tokens unreadable. Back it up apart from the database dump.
- Windows dev PC, when used: `D:\creatoros`, PowerShell. That machine could not push by itself. Confirm `git log origin/main..main` before assuming GitHub matches the server.

## 8. Scanner, in short

- Commands: `pair | run | install | uninstall | start | stop | status | reset-state | systemd-unit`. Service install is Windows. Linux prints a systemd unit.
- Listens on 7755. Identity is the UUID in `agent.json`, not the hostname.
- Pair with a one-time code from Storage. Requests are HMAC-signed.
- Stream: `GET {listenUrl}/v1/stream?root=&path=&exp=&sig=`, with Range. The path must stay inside the granted root.
- A COMPLETE scan must list every file still present. Missing an entry starts the missing-candidate path. An empty complete scan of a root that had files is treated as unreachable, not as "everything was deleted".
- Stop with `creatoros-agent stop` or `systemctl stop`. Do not kill the process and walk away.

## 9. Traps

- `docker compose build` does not switch the running site. Follow with `up -d`, or use the single `up -d --build` command.
- Rebuilding `api` and `web` without `migrate` skips a new migration. The new API then errors on the missing column.
- `docker compose restart` does not reload `.env` or a new image.
- Library and Publishing are client pages. A type error fails `pnpm --filter @creatoros/web build` inside the image (`next build` type-checks). `Badge` accepts `className`. Do not call `.some` on a field the list API does not return.
- PowerShell cannot `cd` into `(app)` or `[id]`. Use the editor tools or `-LiteralPath`.
- PowerShell `Set-Content -Encoding UTF8` writes a BOM. Use the editor tools.
- Notification tests must read the `notifications` table. Quiet hours hide non-critical rows from the visible list.
- Counts, publish cells, and "published / attached" are separate queries. Do not join files to posts and count the product.
- Facebook `pages_manage_posts` and YouTube `youtube.upload` are opt-in. Do not add them to the default connect scopes or a normal reconnect drops or widens permissions by surprise.
- Instagram "API access blocked" is a Meta app problem, not an expired token.

## 10. What a new agent should do first

1. Read this file. Then `git status` and `git log --oneline -10`.
2. `docker compose ps` and `curl -sS http://127.0.0.1:8080/api/v1/health/ready`.
3. Ask the owner for the task if it is not already in the message. Do not restyle unrelated screens.
4. Change `packages/services` first, then the route, then the page. Update this file before you stop.
5. If the owner should see it on `os.goyalfamily.ca`, deploy with section 6 and say whether you ran that command.
