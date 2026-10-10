# Active voice provider

The application routes use ElevenLabs, not GPT-Live or GPT-Audio. Sol remains the reasoning/ERP model.

- Scribe v2 Realtime: server-side WebSocket, manual commits from local speech detection, PCM 24 kHz. A single-use token is obtained through the connected account; it is never logged or sent to the browser.
- A connection closes after final transcription, so the app does not stream silence while Sol queries data. New utterances reconnect, queue at most thirty seconds of audio, and discard prior-session events on interruption.
- Eleven v4 Turbo: HTTP text-to-dialogue streaming via the authenticated connector, PCM 24 kHz, Portuguese language, text normalization. Each request has one voice and bounded text; no post-generation transcription or review.
- Existing feminine/masculine preferences map to Sarah/Roger, verified in the connected account. These are multilingual stock voices, not claimed to be native Brazilian voices.
- Direct HTTP upload compatibility uses Scribe v2 batch; it is not the live path.
- The old OpenAI voice modules remain for historical scripts/tests, not as automatic fallbacks.

## Permissions and cost

Required: Speech to Text access, Text to Speech access, Voices read. The Scribe single-use-token endpoint requires speech_to_text. Models read is optional and is not used by the running app.

Only metadata/authorization requests and local protocol tests were used during integration; no paid sample audio was generated. A connected account is not proof that speech scopes are enabled.

## Privacy

The app does not persist recordings. Provider-side logging/retention follows the ElevenLabs account terms: zero retention via enable_logging=false is enterprise-only and is not silently claimed for Starter.
