/**
 * E-mail sending lives behind this interface so a provider can be plugged in later without touching the routes.
 * Today nothing is configured: the password reset link is shown to the administrator, who passes it on.
 */
export type EmailMessage = { para: string; assunto: string; texto: string };
export interface EmailSender {
  /** True when messages can actually be delivered. */
  readonly configurado: boolean;
  enviar(message: EmailMessage): Promise<{ enviado: true } | { enviado: false; motivo: string }>;
}

export class EmailNaoConfigurado implements EmailSender {
  readonly configurado = false;
  async enviar(): Promise<{ enviado: false; motivo: string }> {
    return { enviado: false, motivo: "Envio de e-mail não configurado. Repasse o link por um canal seguro." };
  }
}

/** The sender in use. Replace the instance when a provider is contracted; nothing else changes. */
export const enviarEmail: EmailSender = new EmailNaoConfigurado();
