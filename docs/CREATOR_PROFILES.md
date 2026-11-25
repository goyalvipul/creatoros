# Creator profiles

Open Settings → Creator profiles, or follow Creator profile from Channels & identity. Select the existing creator, fill the profile, and explicitly save. The workspace default is separate from branded profiles. JSON import previews a complete replacement draft; it does not save until the owner confirms Save. Image references use the shared library, with the primary reference first. Profile edits do not run paid generation.

Publishing metadata resolves the profile from the selected social account's channel and brand. It does not substitute the workspace default for a missing branded profile. Existing long-video image generation already uses the project's brand. Studio prompts and generation remain explicitly authored and are not silently rewritten.

The existing Hosted MCP creators.profile operation continues to return the stored profile by brand ID. No new gateway operation or credential is required. Use owner-approved UI saves for profile changes. No production creator data is seeded by this change.

Current limitations: image reference ordering is advisory; semantic role metadata, separate audio reference assets, and dedicated reference upload/compression are not included in this schema-preserving implementation. The profile editor manages existing fields and image IDs. Navigation guard covers creator switching and browser unload; in-app navigation may discard unsaved edits. Profile and brand detail writes are separate requests and may succeed independently.
