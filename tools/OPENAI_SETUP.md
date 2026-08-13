# IA do Bot Guincho

A plataforma administrativa usa a OpenAI Responses API para interpretar e responder mensagens dos grupos autorizados.

## Configuração

No servidor persistente, defina:

```bash
export OPENAI_API_KEY="sua-chave"
export OPENAI_MODEL="gpt-5-mini"
```

A chave nunca deve ser commitada no GitHub. A plataforma mostra apenas se a chave está configurada.

## Comportamento

- A IA só processa mensagens de grupos selecionados na plataforma.
- Status, conversas privadas e grupos não autorizados são ignorados.
- O modo humano pausa respostas automáticas sem desconectar o WhatsApp.
- As instruções da IA podem ser editadas no painel.
- O contexto recente é mantido apenas em memória do processo para dar continuidade às conversas.
- Imagens recebidas podem ser enviadas à IA para interpretação; outros tipos de mídia entram como contexto textual.
