# WhatsApp Web — Bot Guincho

## Objetivo

Cada cliente conecta o próprio WhatsApp via QR Code e escolhe somente os grupos que o bot pode monitorar e responder.

## Segurança de sessão

- Nenhum número de telefone é gravado no código-fonte.
- A autenticação fica em diretório local da máquina/servidor.
- Os diretórios de sessão devem permanecer fora do Git.
- Grupos não selecionados, conversas individuais e Status são ignorados.

## Painel local

Instale as dependências e execute:

```bash
npm install
npm run wa:admin
```

Por padrão o painel usa:

- porta `3001`;
- cliente `cliente-teste`;
- dados em `~/.botguincho-wa`.

Variáveis opcionais:

```bash
WHATSAPP_ADMIN_PORT=3001
WHATSAPP_CLIENT_ID=cliente-teste
WHATSAPP_ADMIN_DATA_DIR=/caminho/persistente
WHATSAPP_WEB_TEST_COMMAND=!ping
WHATSAPP_WEB_TEST_REPLY="PONG - Bot Guincho funcionando no grupo autorizado!"
```

## Fluxo

1. Abrir o painel.
2. Escanear o QR em WhatsApp > Configurações > Aparelhos conectados.
3. Aguardar o status `Conectado`.
4. Selecionar os grupos autorizados.
5. Salvar.
6. Testar `!ping` em um grupo selecionado e em outro não selecionado.

## Hospedagem

O painel pode ser servido por uma aplicação web tradicional, mas o processo que mantém o WhatsApp Web precisa de runtime persistente, navegador headless e armazenamento persistente de sessão. Não deve depender de uma função serverless efêmera para manter a sessão ativa.
