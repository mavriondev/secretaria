---
name: VPS source provenance
description: Keep installed source, built artifacts and future development versions distinct when syncing GitHub.
---
Treat `main` as the public source lineage and `claude/ajustes-secretaria` as reconciled development. A prepared-only release can advance the source branch without changing the installed application. Use the active release's VERSION/health fingerprint, not a branch head, to identify production. Do not imply that publishing code to GitHub deploys it to the VPS.

**Why:** The user wants source visibility while retaining newer changes that are not necessarily installed. The gated TV workflow explicitly requires preparation without activation if any gate fails, so source and runtime may legitimately differ.

**How to apply:** Compare actual VPS files with both development and remote heads before syncing. If the installation has no Git metadata, report content equality and build fingerprints separately; a matching source reference is not proof of the build's original Git SHA. Preserve remote ancestry and use only fast-forward reference updates.

Application GitHub writes must use the authorized GitHub integration. Never repurpose the token reserved for the private communication repository.

**Why:** The user explicitly separated application synchronization from the Claude communication channel. Successful reads or repository-level push flags do not prove the current credential can write.

**How to apply:** Confirm an actual write with the existing integration, stop on a refusal and use its authorization recovery flow. Git REST object/ref writes through the integration can avoid unavailable shell Git authentication without exposing credentials.

For runtime diagnostics, an unidentified revision is preferable to an inferred Git SHA. In Replit development, use a public build identifier rather than treating the editor's current Git reference as the process's revision.

**Why:** The API can still be executing its last compiled bundle while the editor and frontend already contain later, uncommitted changes. A Git reference at diagnostic time would falsely imply those changes are executing.

**How to apply:** Bind identity to the artifact being built, preserve it when restarting that same artifact, and do not relabel installed code when publishing source elsewhere. Clearly distinguish server build identity from independently changing frontend development.
