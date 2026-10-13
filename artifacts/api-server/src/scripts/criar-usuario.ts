import { and, eq } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";
import { ensureDemoCompany, hashPassword, normalizeEmail, passwordProblem, temporaryPassword, validEmail } from "../lib/auth";

/**
 * Creates the first accounts of an installation (the product owner, or an administrator for a company), since there is no one to log in and create them.
 *   pnpm --filter @workspace/api-server run usuario:criar -- dono voce@exemplo.com "Seu Nome"
 *   pnpm --filter @workspace/api-server run usuario:criar -- administrador gestor@empresa.com "Nome" 1
 * The password comes from USUARIO_SENHA, or a temporary one is generated and printed once. It must be replaced at the first login.
 */
const args = process.argv.slice(2).filter(a => a !== "--");
const [papel, emailArg, nome, empresaArg] = args;
async function main() {
  if ((papel !== "dono" && papel !== "administrador" && papel !== "gestor") || !emailArg || !nome) {
    console.error('Uso: usuario:criar -- <dono|administrador|gestor> <email> "<nome>" [empresaId]');
    process.exit(1);
  }
  const email = normalizeEmail(emailArg);
  if (!validEmail(email)) { console.error("E-mail inválido."); process.exit(1); }
  const companyId = papel === "dono" ? null : Number(empresaArg ?? 1);
  if (papel !== "dono" && !Number.isInteger(companyId)) { console.error("Informe o número da empresa."); process.exit(1); }
  await ensureDemoCompany();
  const password = process.env.USUARIO_SENHA ?? temporaryPassword();
  const problem = passwordProblem(password);
  if (problem) { console.error(problem); process.exit(1); }
  const [existing] = await db.select().from(usersTable).where(and(eq(usersTable.email, email)));
  const values = { companyId, email, name: nome, role: papel, passwordHash: await hashPassword(password), mustChangePassword: true, active: true };
  if (existing) await db.update(usersTable).set(values).where(eq(usersTable.id, existing.id));
  else await db.insert(usersTable).values(values);
  console.log(`${existing ? "Conta atualizada" : "Conta criada"}: ${email} (${papel}${companyId ? `, empresa ${companyId}` : ""}).`);
  if (!process.env.USUARIO_SENHA) console.log(`Senha temporária (aparece só agora): ${password}`);
  await pool.end();
}
main().catch(error => { console.error(error); process.exit(1); });
