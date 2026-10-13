# Fluxo de versões: GitHub e VPS sempre iguais

**Regra de ouro:** o GitHub (branch `claude/ajustes-secretaria`) é a fonte da verdade do código. A VPS roda sempre um commit conhecido. O que fica só na VPS são as configurações e segredos (`/tato/config/tato.env`) e os dados; isso nunca vai para o GitHub.

## Como saber se estão iguais
- Na VPS: `python3 scripts/update-vps.py status` mostra a versão ativa, o commit (SHA) e a versão anterior.
- Pelo navegador ou `curl`: `https://<endereço>/api/healthz` responde `{"status":"ok","versao":"<SHA>"}`. Em desenvolvimento aparece `desenvolvimento`.
- No GitHub: o último commit da branch. Se o SHA do `healthz` é o mesmo, estão iguais.

## Nada que existe só na VPS pode se perder (passo 0 de toda atualização)
Já aconteceu de haver ajustes na VPS que o Git não tinha. Por isso, **antes de qualquer atualização**, quem atualiza confere o que a VPS tem a mais:
1. `python3 scripts/update-vps.py drift --source <checkout> --revision <SHA do commit que deveria descrever a VPS>` compara o código que está rodando com esse commit e lista só os **nomes** dos arquivos: "só na VPS", "diferente na VPS" e "só no Git". O commit de referência é o último que registrou o estado da VPS (hoje, `b9e37b3`, "Sincronizar snapshot instalado do Tato na VPS"); depois de cada atualização, é o commit ativado.
2. Se aparecer algo em "só na VPS" ou "diferente na VPS", **a atualização não prossegue**. Esses arquivos são copiados para um checkout, recebem `git commit` em uma branch `vps-sync-AAAAMMDD` e `git push`. Só depois alguém decide a junção (nunca sobrescrever): a versão mais recente de cada arquivo vence e a outra fica no histórico do Git.
3. O que o `drift` não vê (por não ser código da aplicação) tem outro cuidado: Nginx, systemd e HTTPS ficam copiados em `docs/vps`; configuração e chaves (`/tato/config`) ficam só na VPS e precisam de cópia protegida fora dela; os dados do banco ficam no backup que a atualização faz sozinha.

## Poder voltar atrás
- Todo estado importante recebe uma etiqueta (tag) no Git: `vps-AAAAMMDD` para o que estava na VPS antes de cada atualização e `implantado-AAAAMMDD` para o que foi ativado. Dá para voltar a qualquer um com `git checkout <tag>`.
- A atualização guarda o código anterior em `/tato/releases` e `python3 scripts/update-vps.py rollback ...` volta a ele em minutos, sem mexer nos dados.
- Cada atualização faz um backup do banco em `/tato/backups`. Restaurar o banco é outra operação, feita só com cuidado e autorização.
- A migração do banco só adiciona colunas e tabelas, então o código antigo continua funcionando depois dela.

## Do GitHub para a VPS (o caminho normal)
1. O trabalho novo entra no GitHub com testes passando. Quem fechou o trabalho informa o **SHA completo** (40 caracteres) que está pronto para a VPS.
2. Na VPS, em um checkout separado de `/tato/app`: `git fetch` e `git checkout <SHA>`.
3. `python3 scripts/update-vps.py prepare --source <checkout> --revision <SHA>` (não para o serviço; compila a versão).
4. `python3 scripts/update-vps.py activate --release <ID que o prepare mostrou> --confirm-production --ack-schema-compatible` (para o serviço por poucos minutos, faz backup, aplica a migração aditiva do banco, troca o código, confere a saúde; se falhar, volta sozinho ao código anterior).
5. `python3 scripts/update-vps.py status` e `curl .../api/healthz`: o SHA deve ser o do passo 1.
6. Quem ativou escreve um relatório curto no canal com o SHA ativado e a saída do `status`.

## Da VPS para o GitHub (só quando algo mudar na VPS)
- **Código não se edita na VPS.** Se for preciso corrigir algo com urgência, faça a correção em um checkout, faça `git commit` e `git push` para a branch **antes** de ativar. Assim o que roda é sempre um commit que existe no GitHub.
- Quem mexe na VPS (por exemplo scripts de operação, modelos de Nginx/systemd em `docs/vps`) faz commit na mesma branch com `git pull --rebase` antes do push, e avisa no canal.
- Configuração e chaves (`tato.env`) não vão para o GitHub. O que mudou delas é registrado só pelos **nomes** das variáveis, nunca pelos valores.

## O que quem desenvolve faz sempre
- Antes de começar e antes de enviar: `git fetch` e incorporar o que veio da VPS.
- Ao mudar o schema do banco: rodar `python3 scripts/gerar-migracao-aditiva.py` e fazer commit de `lib/db/migracao-aditiva.sql` junto. Sem isso a VPS recusa a versão.
- Informar o SHA pronto para a VPS e o que mudou, em português simples.
