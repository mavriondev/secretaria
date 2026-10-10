# Hybrid voice contract

Historical document. The active provider contract is now **ELEVENLABS-VOICE.md**.

## Current direct-stream mode (supersedes playback gates below)

At the user's explicit request, all spoken answers now use GPT-Audio-1.5 streaming immediately from Sol's grounded text. GPT-Live remains the input transport; its generated output is discarded. No second transcription, speech comparison or complete-audio approval buffer runs in the active speech path. Audit fields distinguish unverified streaming from historical verified audio. Source financial facts still come from ERP queries. No mini fallback or saved conversations. HTTP includeVoice still returns a complete WAV because that endpoint is not a streaming transport; live voice forwards each incoming PCM chunk immediately.

The sections below describe the earlier gated implementation and are historical, not the current playback policy.

The live browser route uses GPT-Live-1 input and nonfinancial conversation, retaining GPT-6.1 Sol for question interpretation and tools. It does not run a second transcription model on the same microphone audio. The standalone file-upload transcription route remains independent.

Live startup uses Brazilian Bossa/Tempo according to the female/male setting. Financial, researched, ambiguous, numeric or unapproved speech uses GPT-Audio-1.5 with Marin/Cedar. There is no mini fallback. Different timbres across the two paths are intentional.

GPT-Audio-1.5 output stays in bounded transient memory. Its transcript and a separate GPT-Transcribe recognition of the waveform are compared against the approved text. Exact matches pass; otherwise Sol adjudicates strictly for formatting/number-representation equivalence only. This is a probabilistic check, not a mathematical guarantee of pronunciation. Disagreement, timeout or provider failure withholds audio and leaves text available. No audio chunk is released before these checks. The legacy OPENAI_TTS_MODEL override is intentionally no longer used; the approved speech model is fixed.

## Playback boundary

Never forward a provider audio delta directly to the browser. Native audio is bounded in memory and withheld until:

1. Local VAD commits a question, the paced input queue drains and the Live transcript settles.
2. Sol classifies the response without metrics, documents or external sources.
3. Both question/approved backend answer and the candidate native transcript pass the conservative nonfinancial gate.

Unapproved or incomplete native output is discarded; the UI explicitly identifies the validated-text alternative for a general turn. Financial turns never call nativeSpeech for playback. Audit parameters identify the actual output path and preserve Sol's original text when a native conversational response replaces it. This lexical gate is conservative and not a general-purpose semantic proof; do not broaden it to allow financial paraphrases.

## Provider limitations

GPT-Live has no completed-input-transcript or completed-output-audio event. The adapter uses a bounded quiet window after local VAD and an output silence/transcript window. A late input transcript correction closes the session instead of silently acting on a changed request. Transcript timestamps exclude fragments predating a new turn. Generation, queued browser playback and backend completion are separate states.

The safety buffers add latency. Do not advertise this as unbuffered full-duplex financial speech. Native output is generated concurrently but only approved speech is played.

No app audio is saved. The model session uses store:false. This does not override the provider's own data retention policy. The idle/session limits remain 60/300 seconds. Graceful shutdown requests session.close and records whether final usage was received; duration billing continues while the Live session is open.

## Verification

Run the ordinary API and browser-audio unit tests. The opt-in check-hybrid-live script exercises a real provider greeting with transient synthetic PCM and no saved recording; it incurs API usage. Browser checks additionally need to exercise greeting → financial question in the same session, stop/restart and queued-audio interruption. Generation audio_done does not imply the speaker queue has drained.
