# CreatorOS v5 — Cursor package

This is a **feature-preserving UX/UI modernization** package, not a replacement application or database migration.

## Install into the repository

1. Copy this whole folder to the root of your existing `creatoros` repository as `ux-v5-package/` (or keep it under `docs/` if preferred). Do not overwrite any existing files of the same name.
2. Open the existing CreatorOS workspace in Cursor.
3. Switch Cursor to its strongest available code-analysis mode, select the repository as the workspace, and paste the bootstrap instruction below.
4. Have Cursor read `ux-v5-package/CURSOR_MASTER_PROMPT.md` and all files under `source_material/`; the prototype in `visual_reference/` is **visual inspiration only**.
5. Let Cursor perform **Phase 0 read-only audit**. Review its inventory and migration plan. Do not authorize code changes until you are happy with feature mapping, test plan, PWA safeguards and rollback.
6. When satisfied, explicitly tell Cursor `APPROVE V5 IMPLEMENTATION PHASE 1` and require the tool to stop between subsequent phases.

## Exact bootstrap prompt to paste into Cursor

> Work in my **existing CreatorOS repository**, not a new application. Read `ux-v5-package/CURSOR_MASTER_PROMPT.md` completely. Then read all 5 files in `ux-v5-package/source_material/`, inspect the v5 interactive prototype and screenshots in `ux-v5-package/visual_reference/` as design direction only, and independently inspect the current codebase, hidden controls, background jobs, APIs, integrations, worker/agent protocols, finances and PWA. The running source of truth outweighs old documents; I confirm LTX already works, so preserve its exact behavior. **Execute Phase 0 only:** create evidence-based feature/action inventory and existing-to-v5 parity mapping under `docs/ux-v5/`. Do not edit app code, change packages, migrate data, trigger real jobs/messages/posts, restart production, or deploy. Show coverage, gaps and risks, then stop for explicit approval.

## Safety reminder

The prototype has illustrative local/demo content and cannot be treated as a list of all current features. The requirement is **verified preservation of existing internal, external, hidden, background and PWA behavior**. A prompt alone cannot guarantee defect-free migration; inventory, tests, review gates and rollback are mandatory.
