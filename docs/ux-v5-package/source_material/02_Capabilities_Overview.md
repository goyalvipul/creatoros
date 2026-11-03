# Creator OS capabilities

As of 2026-11-03. What the app can do. A one-line limit is included only where a login, a PC, or an approval is required.

## Runs on its own

- **Download.** Original file, same bytes as on the PC, from the Library file list, a file page, an asset’s files, a linked video on Publishing, and ComfyUI History. The thumbnail is a separate smaller preview. The PC that holds the file must be on. In the installed phone app, Download opens in the phone’s browser so the app stays on the page.
- **Email sync.** Connected Gmail accounts sync every 5 minutes. New mail is classified as it arrives.
- **Social sync.** Connected Instagram, Facebook, and YouTube comment accounts sync every 15 minutes. YouTube uploads and other platform imports sync every 30 minutes. A scheduled post is checked about once a minute. Nothing is posted, replied to, or paid on that timer.
- **Auto collaboration.** A new email that looks like a collaboration is notified and kept in the inbox for review. A clear one (several commercial terms, confidence at least 0.8, not a newsletter) is confirmed into the pipeline by itself. A casual mention of a brand or a video stays in the inbox. A later email on a thread already in the pipeline notifies “New email on a collaboration”. No deal is created. No reply is sent.
- **Auto project from that email.** The same clear collaboration email creates a Production project in Draft, linked to that thread. A second email on the thread does not create a second project. The project is a draft. It does not publish.
- **Generation notice.** A finished LTX, MiniMax, or Audio job notifies once and opens ComfyUI History.

## Home and Inbox & Today

- Daily counts: ideas, production, ready assets, unposted targets, scheduled and published posts, open inquiries, replies, invoices, blocked work.
- Top 3 today, with the reason each item is first. Snooze, set a due date, complete, or open the item.
- Activity, upcoming releases, scan warnings, device storage, recent files, inquiries, campaign deadlines.
- Filter by brand. Quick add: idea, song, video project, brand, deal, follow-up, publication, folder.
- Global search (Ctrl/Cmd+K) across assets, projects, brands, posts, and contacts.
- In-app notifications. Quiet hours hold non-critical ones. The bell lists generation, possible collaboration, pipeline, and reply notices.
- Internal action queue when the Todo app is not connected. Link or create a Todo task when it is.

## Content

- Idea inbox: text, link, notes, genre, pillar, audience, language, channel, score, effort, priority, tags, status.
- Convert an idea into a project and keep the link back to the idea.
- Content templates (music single, lyric video, Reel, Short, behind the scenes, and others) that start a checklist. Editable.

## Production

- Brands, then projects (song, campaign, travel, other), scenes, versions, and posts.
- Project stage, owner, due date, brief, decision history, shot list, and checklist.
- Scene states and an approved final. A file existing is not treated as finished.
- Attach indexed files. Originals stay on the PC that holds them.

## ComfyUI

- Generate on the 24GB (3090) or 12GB (3060) PC. The queue dot shows free or busy.
- LTX video. Audio (Qwen voice clone) with Mehak reference clips or a library file. MiniMax H3, up to 8 segments.
- Pick or create a project. A finished video is added to that project’s publishing list. Voice files are not.
- History: play, Download the original, send an LTX clip back into the form. A library file on this page has the same Download.
- Windows task name: the agent can query that one scheduled task, or end and run it. No general shell.
- The PC that rendered the file must be on to play or download it.

## Library and devices

- Pair a Windows (or Linux) scanner with a one-time code. Label, revoke, and rotate it. Hostname changes do not change the device.
- Any number of folders per machine, including SMB paths that machine can already see.
- Include and exclude rules, schedules, and a Sync now button.
- Index path, size, dates, and type. Probe duration, resolution, codec, and thumbnails when ffmpeg is on that PC.
- Wait until a file stops growing before indexing it.
- Exact copies across PCs count as one media object and two locations. Same filename with different bytes stays two files. A quick sample is never called an exact duplicate.
- Near-duplicate hints stay suggestions until you confirm them.
- Offline PC stays in the list with last seen. A file is missing only after complete scans and a grace period.
- Search and filter by name, path, type, device, duplicate group, online state, project, and tags.
- Copy path. Play and seek while that PC is on.
- Download on each available file in the list, on the file page, and on each file under an asset. Original bytes, not the preview.
- Rename, move, or delete one file only after you confirm that one file. Scanning itself does not change files.
- Remove a folder from Creator OS without deleting the files. Refused while a file from it is still linked.

## Publishing

- One publishing title per project, with the linked videos.
- Click a file name to play it. Download sits beside Unlink and saves the original while that PC is on.
- Upload a video from a Mac or phone into a scanned folder on a PC that is on, then link it. The bytes are not recompressed. An existing name is not overwritten. Needs the scanner build that includes upload.
- Matrix of variants and accounts: not planned, planned, ready, scheduled, submitted, published (verified or entered by you), failed, removed.
- Captions per platform, hashtags, privacy, language, planned time, post URL, and status.
- Paste a post link. That record is entered by you until a connector verifies it.
- Publish to YouTube, Instagram, or a Facebook Page when that account is connected and the file’s PC is on. TikTok direct post stays off until the app is approved. Nothing posts until you confirm.
- Import your YouTube uploads when Google is connected. An import without a confirmed file match stays unattached.

## Calendar

- Scheduled posts, project due dates, and collaboration dates in America/Vancouver (changeable).
- Drag to reschedule. Warns on collisions.

## Collaborations

- Inbox of mail and manual notes. Folders: inbox, starred, follow-up, in pipeline, archived.
- Move and star locally. Starring or archiving does not change Gmail.
- Manual intake: paste a thread, save a link, record sender and dates.
- Screen mail. Dismiss unrelated mail. Confirm or dismiss a possible collaboration by hand.
- Auto collaboration: a clear commercial email confirms itself into the pipeline. Weaker mail stays in the inbox.
- Auto project: that same email creates one Draft production project for the thread.
- Pipeline stages from new inquiry through paid or declined. Contacts and partner companies.
- Deals: amount, currency, rights, deadlines, deliverables. Deliverable status is separate from the post status.
- Invoices, partial payments, amount still due, overdue. Several currencies. Display currency CAD.
- Marking an invoice Paid counts the full amount as received. A partial payment counts only what was recorded.
- Business expenses, with an optional receipt photo. Earnings are paid invoices minus business expenses.
- Personal tax entries stay out of that earnings total.
- Invoice suggestions read from email text (not PDFs) and wait for you to confirm.
- Reply from Creator OS only if Gmail sending is enabled, and only when you press Send.

## Socials

- Instagram inbox, comments, and replies when that Instagram account is connected. One login per account.
- Facebook Page messages and comments, same rule.
- YouTube comments, polled, when comments are enabled on the Google connection.
- Leads and a scheduled list.
- Trends from messages and comments already stored here. Opening a group does not call the platform and does not send anything.
- Threads and TikTok connectors exist and stay off until the app and permissions allow them.

## Workflows

- Rules for draft replies, replies that wait for approval, and automatic replies.
- Match on contains, whole word, exact message, or emoji.
- Test a rule, turn it on per account, and a kill switch. An automatic rule does not run until it passes a test.
- Approval queue.

## Analytics and channels

- Counts and money by brand, account, platform, and period. Platform numbers and numbers you typed stay labelled differently.
- Goals and progress. CSV export.
- Brands, channels, and social accounts. Accounts on different channels stay separate.
- Edit or archive a brand, channel, or account. History of posts, projects, and deals is kept.

## Integrations

Each one shows connected, not configured, expired, or unsupported, and the next step. Core screens work with none of them connected.

- Gmail: connect one or more accounts. Auto sync every 5 minutes. Read, classify, and file into the collaboration inbox. Sending is a separate switch and still needs Send.
- YouTube: auto import of uploads and stats about every 30 minutes. Comments sync about every 15 minutes when comments are enabled. Upload when you publish.
- Instagram and Facebook Pages: auto sync of inbox and comments about every 15 minutes once the account is connected. Threads and TikTok stay off until the app and permissions allow them.
- Postiz: optional, if you host it and give the URL and key.
- Todo app: your existing list. Creator OS keeps the project and the deal. The Todo app keeps the task’s due time and completion unless you override. If it is offline, the action stays pending and is not shown as synced.

## Account, settings, and operations

- First-run setup. Skip and resume.
- Roles: Owner, Editor, Viewer. Viewers cannot open mail, money, media, or devices. Editors cannot open owner-only sections (publishing, money, ComfyUI, storage, settings, and the rest listed in the app).
- Password sign-in, lockout, sessions you can revoke, optional two-factor. No email reset. Another owner, or a command on the server, resets a password.
- Light and dark theme. Installable on a phone over HTTPS. Usable at phone width.
- Offline: drafts already started on the phone can wait and sync later. Generate, publish, pay, and file delete do not queue.
- Health of the database, queue, workers, agents, and backups.
- Backup of the database and small attachments. Restore from that backup. Original videos stay on the PCs and are not inside the backup. The encryption key is in `.env`, not in the backup.
- Audit log. Job retries and failed jobs you can see.

## What it does not do

- It does not edit or transcode video.
- It does not post, email, agree, or pay unless you confirm that step.
- It does not delete or move originals during a scan.
- It does not treat a local file as a published post.
- It does not read Instagram or TikTok private messages beyond what the approved API returns.
- It does not scan a phone’s own files. The phone app is a window onto the server.
