# Prompt 01: login e base multiempresa (já executado manualmente pelo dono)

Atualize o código a partir da branch claude/ajustes-secretaria (commit c72d9d3).

1. `git fetch github` e `git merge github/claude/ajustes-secretaria`. Em conflito, manter a versão da branch nos arquivos de código e preservar só a configuração própria do Replit.
2. `pnpm install`, `pnpm --filter @workspace/db run push`, `pnpm --filter @workspace/api-server run demo:setup` (nesta ordem: o push apaga as views e o demo:setup as recria).
3. Criar as contas iniciais com `pnpm --filter @workspace/api-server run usuario:criar -- dono EMAIL "Nome"` e `... -- administrador EMAIL2 "Nome" 1`.
4. `pnpm --filter @workspace/api-server run test` e reiniciar a aplicação.
5. Responder com: hash do commit, testes que passaram e falharam. As senhas temporárias vão só para o dono do produto, no chat.
