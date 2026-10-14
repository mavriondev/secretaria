# E-mail do domínio na VPS

Configuração de infraestrutura em 14/10/2026. Não altera o código da aplicação.

## Acesso à caixa

- Caixa: `contato@oitato.com.br`; login é o endereço completo.
- Servidor de entrada e saída: `oitato.com.br` (o certificado público existente cobre esse nome).
- IMAP: porta **993**, SSL/TLS obrigatório.
- SMTP para aplicativos: porta **587**, STARTTLS e autenticação obrigatórios.
- Senha: definida pelo proprietário no formulário seguro. Não consta neste documento.
- Compatível com aplicativos como Thunderbird e Outlook. **Não foi instalado webmail.**

Não é necessário criar `mail.oitato.com.br`: o nome usado é o próprio domínio, que já possui registro A.

## Infraestrutura e segurança

O Exim existente foi mantido, passando de entrega apenas local para recebimento público e envio autenticado. O pacote daemon-heavy acrescenta autenticação Dovecot; não foi instalado outro MTA. Aliases e entrega local do sistema continuam disponíveis.

- Exim: portas 25 (recebimento SMTP) e 587 (envio autenticado).
- Dovecot 2.4: somente IMAP criptografado na porta 993; autenticação de usuários virtuais, não das contas Linux.
- Caixa Maildir em `/var/vmail/oitato.com.br/contato/Maildir`, usuário sem shell `vmail`.
- Senha somente como hash SHA512-CRYPT no arquivo protegido `/etc/dovecot/tato-users`.
- Aliases `postmaster` e `abuse` entregam na caixa de contato; destinatários desconhecidos são rejeitados.
- Relay externo sem autenticação é rejeitado. Na submissão autenticada, remetente deve coincidir com a conta.
- Limite de mensagem de 20 MB, caixa de 1 GB no transporte de entrega e limite de submissão de 100 destinatários/hora.
- Fail2ban protege autenticação de e-mail; jail SSH padrão também está ativo. UFW libera 25, 587 e 993.
- Não há filtro antispam/antivírus nem backup externo da caixa configurados por este trabalho.

Antes da configuração, backup protegido em `/root/tato-mail-backup/exim-before.tgz`.

## Arquivos de configuração no servidor

- `/etc/exim4/update-exim4.conf.conf`: modo internet e configuração dividida.
- `/etc/exim4/conf.d/main/00_tato_mail`: TLS, limites e assinatura DKIM.
- `/etc/exim4/conf.d/main/04_tato_mail_ports`: portas SMTP e limites de conexão.
- `/etc/exim4/conf.d/router/350_tato_virtual`: roteamento do domínio virtual.
- `/etc/exim4/conf.d/transport/30_tato_maildir`: entrega Maildir.
- `/etc/exim4/conf.d/auth/30_tato_dovecot`: autenticação por socket do Dovecot, anunciada só após TLS.
- `/etc/exim4/conf.d/acl/30_exim4-config_check_rcpt`: proteções adicionais na submissão.
- `/etc/dovecot/dovecot.conf`: configuração Dovecot 2.4.
- `/etc/fail2ban/jail.d/tato-mail.local`: proteção contra tentativas de senha.

## Certificado e renovação

Dovecot usa o certificado `tato-dominio` em `/etc/letsencrypt-tato/live/tato-dominio/`.
Exim usa uma cópia com permissões restritas em `/etc/exim4/tato-tls/`, porque o processo não deve receber acesso geral às chaves da instalação.

O hook `/etc/letsencrypt-tato/renewal-hooks/deploy/tato-mail` atualiza as cópias do Exim e recarrega Exim e Dovecot quando o certificado do domínio é renovado. O hook foi executado e os serviços permaneceram ativos. O timer de renovação já existente continua responsável pela renovação.

## DNS pendente no Registro.br

O domínio tinha **Null MX** (`0 .`), que declara que não recebe e-mail. Remover esse MX e publicar:

| Tipo | Nome | Prioridade | Valor |
|---|---|---|---|
| MX | @ (raiz) | 10 | oitato.com.br. |
| TXT | @ (raiz) | — | `v=spf1 ip4:187.77.232.164 -all` |
| TXT | tato._domainkey | — | valor público DKIM abaixo |
| TXT | _dmarc | — | `v=DMARC1; p=none; adkim=r; aspf=r` |

Não alterar os registros A/CNAME do site. Se houver SPF existente, consolidar em um único registro, não criar um segundo SPF.

Valor do TXT DKIM (uma única entrada, sem incluir as crases):

```text
v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnuNJ9CTZrITuuVMJYTOGW/6/7gHgx5Ur5dtSehoRmkrt49zok5Oe7Lh4qZvTXrqzoL80/HQuDclf3yKSYTfdovOvCcjtye3oNrZQWn3QxmvL6t8HSfQ8F6teFwwGqvoGkBARzkNJzaZiYedmHYcBW8lno40qjkQwIEu5hglG0Qs2Wv3OphlTlPlvcUicJKebsotQbSNLP4fSgy7l/V2CqpPSViChGU5wvJ/LYgStsX0L6+iEl6XWTnNxb2I2nB+2SqotfpgbF5eIeq4TRJO0jJtFkEjaVYpY/DM91VMh2LyIRRFQOa+BL7l+S9icjSF9FFaIJYKP0oSYCJZZbxvT4QIDAQAB
```

A chave **privada** fica protegida em `/etc/exim4/tato-dkim/private.pem`, nunca no repositório.

No painel da hospedagem da VPS, ajustar DNS reverso (PTR) de `187.77.232.164` para `oitato.com.br`. Esse ajuste não é feito no Registro.br. O PTR anterior era o hostname padrão da VPS; sem alinhamento, destinatários podem classificar mensagens como spam ou rejeitá-las.

## Push do Tato

O contato VAPID da instalação foi ajustado para `mailto:contato@oitato.com.br`, preservando as chaves existentes em `/tato/config/tato.env`. Validação local de VAPID passou e o serviço Tato foi reiniciado.

Push não envia e-mails e não depende do MX para transportar notificações. A entrega real depende da assinatura e permissão de notificações no aparelho; não foi feito teste de entrega em aparelho neste trabalho.

## Verificações realizadas

- Conexão externa SMTP 25: STARTTLS disponível, relay não autenticado rejeitado, destinatários desconhecidos rejeitados.
- SMTP 587: certificado válido, autenticação com a senha definida, bloqueio sem autenticação e bloqueio de remetente divergente.
- Envio autenticado de mensagem temporária para a própria caixa e leitura via IMAP 993 com certificado válido.
- Mensagem temporária removida por UID EXPUNGE, sem apagar outras mensagens.
- Exim, Dovecot, Fail2ban, Nginx e Tato ativos; API do Tato saudável.
- Não foi enviado teste para destinatário externo. Recebimento via MX e reputação de envio só podem ser concluídos depois dos ajustes DNS e PTR.
