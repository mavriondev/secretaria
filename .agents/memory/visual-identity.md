---
name: Visual identity (2026-10 redesign)
description: The user's chosen look for Tato and the constraints future UI work must keep.
---
Tato is dark-only outside the public TV panels (tokens on :root, no global light theme or toggle). DM Sans is the single typeface, and the palette is amber primary with teal as the second colour, coral for errors and green for ok.

**Why:** On 2026-10-13 the user asked verbatim for "layout mais escuro, cores marcantes, de uma forma que não parece IA, use a fonte DM SANS em todo o sistema". He explicitly dislikes the generic "AI startup" look (purple gradients, glass, neon).

**How to apply:** New screens must use the existing tokens and DM Sans; never reintroduce Inter/IBM Plex/Fraunces or a global light theme. No emojis or ✓/✗/⏳ glyphs in UI: use lucide icons.

Public TV panels may offer a light option, with dark as the default. Keep that option scoped to the TV rather than changing the rest of Tato.

**Why:** The TV-panel request explicitly asks for both themes; it does not replace the earlier dark-only direction for the application.

**How to apply:** Keep management screens and other application screens dark. Apply the chosen TV theme only to the TV or its preview.

Verification pattern that worked: create temporary dono/administrador/gestor accounts in the dev DB with the usuario:criar script (table is "usuarios", flag column "senha_temporaria"), review with the testing subagent at 1280 and 390, then delete the accounts.
