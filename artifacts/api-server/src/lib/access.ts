import type { SessionUser } from "./auth";

export const ERP_TYPES = ["sankhya", "totvs", "protheus", "outro"] as const;
export const ERP_LABEL: Record<string, string> = { sankhya: "Sankhya", totvs: "TOTVS", protheus: "Protheus", outro: "Outro", demonstracao: "Demonstração" };

const ALWAYS = new Set(["GET /auth/me", "POST /auth/logout", "POST /auth/senha"]);
/** Routes that read the company's ERP data. A company whose database is not connected yet must never reach them. */
const NEEDS_DATA = [/^\/assistant\//, /^\/conference$/, /^\/demo\/status$/, /^\/knowledge\/catalog$/, /^\/dados/, /^\/documents/];
const MANAGER = [
  /^POST \/assistant\/(ask|audio)$/, /^GET \/assistant\/(voice\/config|live)$/, /^GET \/settings$/,
  /^GET \/documents$/, /^POST \/documents$/, /^GET \/documents\/\d+\/download$/,
];

export type Decision = { ok: true } | { ok: false; status: 401 | 403 | 409; error: string };
const deny = (status: 403 | 409, error: string): Decision => ({ ok: false, status, error });

/** One place decides who may call what, so a new route is closed to managers and owners until it is listed here. */
export function authorize(user: SessionUser, method: string, path: string): Decision {
  const key = `${method.toUpperCase()} ${path}`;
  if (ALWAYS.has(key)) return { ok: true };
  if (user.mustChangePassword) return deny(403, "Troque a senha temporária antes de continuar.");
  if (user.role === "dono") return path.startsWith("/plataforma/") ? { ok: true } : deny(403, "O dono do produto gerencia empresas; para usar uma empresa, entre com um usuário dela.");
  if (path.startsWith("/plataforma/")) return deny(403, "Esta área é restrita ao dono do produto.");
  if (user.role === "gestor" && !MANAGER.some(rule => rule.test(key))) return deny(403, "Seu perfil não tem acesso a esta área.");
  if (!user.dataReady && NEEDS_DATA.some(rule => rule.test(path))) return deny(409, "A base de dados desta empresa ainda não foi conectada. Fale com o responsável pela implantação.");
  return { ok: true };
}
