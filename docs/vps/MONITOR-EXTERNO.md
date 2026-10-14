# Monitor externo do Tato (quando a VPS inteira cai)

A aba **Saúde do sistema** roda dentro do próprio Tato. Se a VPS desligar, perder a rede ou o Nginx parar, ela não consegue avisar ninguém. Para esse caso existe um teste simples de fora: um serviço gratuito de "uptime" chama o endereço de saúde a cada 5 minutos e manda e-mail quando ele parar de responder.

Nada precisa ser instalado na VPS: o endereço já existe, é público e não entrega dado algum além de `{"status":"ok"}`.

## O endereço

```
https://187.77.232.164/tato/api/healthz
```

Resposta esperada: código HTTP `200` com o corpo `{"status":"ok"}`. Para conferir à mão: `curl -sk https://187.77.232.164/tato/api/healthz`.

O certificado é emitido para o IP, por isso alguns monitores perguntam se devem **ignorar erros de certificado** ou **aceitar certificado não verificado**: não é necessário para o certificado atual (Let's Encrypt, válido), mas marcar essa opção evita alarmes falsos se um dia a renovação atrasar. O aviso de certificado vencendo já é dado pelo próprio Tato na aba Saúde do sistema.

## Passo a passo (UptimeRobot, plano gratuito)

1. Crie uma conta em https://uptimerobot.com com o seu e-mail (o plano gratuito permite 50 monitores de 5 em 5 minutos).
2. **Add New Monitor**.
3. *Monitor Type*: **HTTP(s)**.
4. *Friendly Name*: `Tato`.
5. *URL (or IP)*: `https://187.77.232.164/tato/api/healthz`.
6. *Monitoring Interval*: **5 minutes**.
7. Em *Alert Contacts To Notify*, marque o seu e-mail (já aparece cadastrado). Se quiser receber no celular, instale o app do UptimeRobot e marque o contato "push" também.
8. **Create Monitor**. Em alguns minutos aparece "Up".

Opcional: em *Advanced Settings* → *Keyword*, escolha **Keyword exists** com o texto `ok`. Assim o monitor só considera "no ar" quando a resposta de verdade é a do Tato (e não uma página de erro do Nginx com código 200).

## Alternativas gratuitas equivalentes

- **Better Stack (Uptime)**: https://betterstack.com/uptime — "Create monitor", URL acima, intervalo 3 minutos no plano gratuito, alerta por e-mail e telefone.
- **Freshping**: https://www.freshworks.com/website-monitoring/ — "Add check", URL acima, 1 minuto no plano gratuito.
- **cron-job.org**: https://cron-job.org — cria um "job" que chama a URL a cada 5 minutos e avisa por e-mail quando falhar (serve, embora seja um agendador e não um monitor).

Em todos: tipo HTTP(S), método GET, URL acima, aceitar resposta 200, avisar o seu e-mail.

## O que fazer quando o monitor avisar "down"

1. Abra `https://187.77.232.164/tato/` no navegador. Se abrir, foi uma queda momentânea de rede; o monitor avisa "up" sozinho.
2. Se não abrir, entre na VPS por SSH e rode: `systemctl status tato nginx postgresql` e `df -h /`.
   - `tato` parado: `journalctl -u tato -n 100` mostra o motivo; `systemctl restart tato`.
   - `nginx` parado: `nginx -t` e `systemctl restart nginx`.
   - disco em 100 %: `journalctl --vacuum-size=500M`, `apt-get clean`, apague releases antigas em `/tato/releases` (não a atual nem a anterior).
3. Se o SSH também não responder, a VPS está fora: use o painel do provedor para reiniciar a máquina.

## Quando a instalação passar a ter um endereço próprio

Troque a URL do monitor para `https://<endereço>/tato/api/healthz` (ou o caminho que a instalação usar). Nada mais muda: o endpoint é o mesmo. Mantenha o monitor antigo por alguns dias até confirmar que o novo responde.

## O que o endpoint não faz

- Não confere banco, backup, disco nem certificado: isso é trabalho da aba **Saúde do sistema**, dentro do app, que avisa pela caixa de avisos do dono.
- Não exige login e não aceita nada além de GET; não há dado de empresa nele.
