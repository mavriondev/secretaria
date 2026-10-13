# Fluxo de versões: GitHub e VPS sempre iguais

**Regra de ouro:** o GitHub (branch `claude/ajustes-secretaria`) é a fonte da verdade do código. A VPS roda sempre um commit conhecido. O que fica só na VPS são as configurações e segredos (`/tato/config/tato.env`) e os dados; isso nunca vai para o GitHub.

## Como saber se estão iguais
- Na VPS: `python3 scripts/update-vps.py status` mostra a versão ativa, o commit (SHA) e a versão anterior.
- Pelo navegador ou `curl`: `https://<endereço>/api/healthz` responde `{"status":"ok","versao":"<SHA>"}`. Em desenvolvimento aparece `desenvolvimento`.
- No GitHub: o último commit da branch. Se o SHA do `healthz` é o mesmo, estão iguais.

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
