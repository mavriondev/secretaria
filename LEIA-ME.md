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
