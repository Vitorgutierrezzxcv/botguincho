# Worker persistente do BotGuincho

O painel continua na Vercel. Esta composição executa apenas o worker persistente do WhatsApp e o proxy HTTPS na VPS.

## Instalação

Execute como `root`:

```bash
curl -fsSL https://raw.githubusercontent.com/Vitorgutierrezzxcv/botguincho/main/ops/bootstrap-vps.sh | bash
```

O instalador cria um segredo administrativo aleatório em `/opt/botguincho/.env.vps`, inicia os contêineres e mantém os dados e a sessão do WhatsApp em `/opt/botguincho-data`.

## Variáveis da Vercel

Configure em Production e Preview:

```text
BOTGUINCHO_WORKER_URL=https://botguincho.IP-COM-HIFENS.sslip.io
BOTGUINCHO_ADMIN_TOKEN=o mesmo valor de /opt/botguincho/.env.vps
```

Nunca envie o token em captura de tela ou mensagem. Depois das variáveis, faça um novo deploy do painel.

## Operação

```bash
cd /opt/botguincho
docker compose --env-file .env.vps -f compose.vps.yml ps
docker compose --env-file .env.vps -f compose.vps.yml logs -f --tail=100
bash ops/deploy-vps.sh
```

Os serviços usam reinício automático. A sessão do WhatsApp e os registros permanecem fora dos contêineres para sobreviver a atualizações e reinicializações da VPS.
