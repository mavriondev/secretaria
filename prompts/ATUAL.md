# Prompt 02: testar o canal de volta (relatório pela branch)

Contexto: queremos que você registre seus resultados numa branch, para o Claude ler sem copiar e colar. Este teste só verifica se isso funciona com segurança. **Não altere o código da aplicação.**

1. Leia `LEIA-ME.md` desta branch (`git show github/claude/prompts:LEIA-ME.md`), seção "Caminho de volta".
2. Crie a branch `replit/relatorios` numa árvore de trabalho isolada, como a seção descreve, e **não** use o checkout principal para o envio.
3. Grave o arquivo `relatorios/2026-10-13-02-teste-do-canal.md` com:
   - o hash do commit atual do projeto (`git rev-parse HEAD` no checkout principal);
   - a saída de `pnpm --filter @workspace/api-server run test`, só o resumo (quantos passaram e falharam);
   - se o `git push` funcionou ou o erro literal que apareceu;
   - uma seção "Sugestão de próximo passo" com o que você acha que deveria ser feito agora.
4. Envie com `git push github replit/relatorios`.
5. Confira que o checkout principal continua intacto: `git status` e `git log --oneline -3` no projeto, sem arquivos novos de relatório nele.
6. Responda ao dono do produto, no chat, só com: se o envio funcionou (sim ou não, com o erro se não) e o hash do commit do relatório.

Se o push for recusado por falta de permissão, **pare** e diga isso. Não tente outro jeito de contornar.
