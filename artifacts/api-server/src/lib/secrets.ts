import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Connection strings of customer databases are stored encrypted. The key lives only in the server's environment (COMPANY_DATA_KEY), never in the database. */
export class SecretsUnavailable extends Error {
  constructor() { super("Defina o segredo COMPANY_DATA_KEY no servidor (um texto longo e aleatório) antes de conectar o banco de uma empresa."); this.name = "SecretsUnavailable"; }
}
export const secretsConfigured = () => (process.env.COMPANY_DATA_KEY ?? "").length >= 16;
const key = () => {
  if (!secretsConfigured()) throw new SecretsUnavailable();
  return createHash("sha256").update(process.env.COMPANY_DATA_KEY!).digest();
};
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${body.toString("base64")}`;
}
export function decryptSecret(stored: string): string {
  const [version, iv, tag, body] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Segredo armazenado em formato desconhecido.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  try { return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8"); }
  catch { throw new Error("Não foi possível abrir o segredo da empresa: a chave COMPANY_DATA_KEY mudou ou o dado foi alterado."); }
}
