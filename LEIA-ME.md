# Canal de prompts entre o Claude e o Replit

Esta branch **só tem texto**: instruções para o Replit e, se der certo, os relatórios dele. Não tem código da aplicação e nunca deve ter.

## Como o Replit usa
Quando o dono do produto disser "leia o prompt atual", execute, sem mesclar esta branch no código:

```
git fetch github claude/prompts
git show github/claude/prompts:prompts/ATUAL.md
```

Depois execute o que o arquivo pede. O arquivo diz também o que responder ao final.

## Regras (valem para os dois lados)
1. **Nada secreto aqui.** O repositório pode ser público. Nunca escreva senhas, chaves de API, tokens, e-mails de clientes ou dados de empresas reais. Senhas temporárias geradas pelo sistema são entregues ao dono do produto no chat, não neste arquivo.
2. `prompts/ATUAL.md` é sempre o prompt a executar agora. Os anteriores ficam em `prompts/AAAA-MM-DD-NN-assunto.md` como histórico.
3. Cada prompt traz: contexto em uma frase, os passos, e o formato exato da resposta.
4. O Replit não deve alterar o código da aplicação por conta própria para "fazer o teste passar". Se algo falhar, relatar o erro literal e parar.

## Caminho de volta: relatórios do Replit
O Replit grava o que fez em uma **branch própria, `replit/relatorios`**, separada desta (assim os dois lados nunca escrevem na mesma branch). O Claude lê com `git fetch`.

Para enviar **sem arrastar o histórico do projeto**, use sempre uma árvore de trabalho isolada, nunca o checkout principal:

```
git fetch github
git worktree add --orphan -b replit/relatorios /tmp/relatorios   # primeira vez
# nas próximas: git worktree add /tmp/relatorios github/replit/relatorios -B replit/relatorios
cd /tmp/relatorios
# escreva relatorios/AAAA-MM-DD-NN-assunto.md, depois:
git add relatorios && git commit -m "Relatório NN" && git push github replit/relatorios
```

Cada relatório traz: o prompt executado, o hash do commit do projeto, o resultado (testes que passaram e falharam, erros copiados literalmente) e, no fim, uma seção **"Sugestão de próximo passo"**. A sugestão é só uma sugestão: o Claude e o dono do produto decidem. Nunca inclua senhas, chaves ou dados de clientes.
