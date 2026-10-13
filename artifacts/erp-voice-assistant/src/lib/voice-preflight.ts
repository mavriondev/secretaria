export const VOICE_WARNING = 'Não foi possível confirmar o acesso à voz. Use texto, peça ao administrador para verificar a integração ou tente voz mesmo sem confirmação.';
export const VOICE_CHECK_FAILED = 'Não foi possível verificar a disponibilidade da voz. Use texto, verifique novamente ou tente voz mesmo sem confirmação.';
export const VOICE_CHECK_LIMIT = 'A verificação é somente de leitura: não confirma todas as permissões de fala e transcrição, nem testa microfone ou HTTPS.';

export class VoicePreflightWarning extends Error {}

/** Warn before microphone capture; an explicit user choice can proceed despite an inconclusive probe. */
export async function beforeVoiceCapture<T>(
  load: () => Promise<{ reachable: boolean; expiresAt: string }>,
  begin: () => Promise<T>,
  allowUnconfirmed = false,
): Promise<T> {
  // Voices-read is not a prerequisite for TTS or Scribe. This choice only
  // skips the advisory probe, never session authorization or browser permissions.
  if (allowUnconfirmed) return begin();
  let status: { reachable: boolean; expiresAt: string };
  try { status = await load(); }
  catch { throw new VoicePreflightWarning(VOICE_CHECK_FAILED); }
  if (!status.reachable) throw new VoicePreflightWarning(VOICE_WARNING);
  if (!Number.isFinite(Date.parse(status.expiresAt)) || Date.parse(status.expiresAt) <= Date.now()) {
    throw new VoicePreflightWarning(VOICE_CHECK_FAILED);
  }
  return begin();
}
