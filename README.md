# Bot Guincho

MVP de automação operacional para empresas de guincho que recebem solicitações de seguradoras via WhatsApp.

## Objetivo do MVP

Automatizar o fluxo inicial de despacho:

1. Receber uma solicitação de atendimento.
2. Identificar seguradora, veículo, serviço, origem, destino e observações.
3. Consultar a posição atual do guincho por um provedor de rastreamento.
4. Calcular distância e ETA até a origem.
5. Aplicar regras operacionais antes de responder automaticamente.
6. Responder à seguradora no formato esperado.
7. Ao receber autorização, criar uma ocorrência e acionar o motorista.

## Estratégia técnica

O projeto começa desacoplado das integrações reais para que WhatsApp, ENGESP e Google Maps possam ser conectados progressivamente sem travar o desenvolvimento.

### Integrações previstas

- WhatsApp Business Platform / Groups API
- ENGESP ou provedor de rastreamento compatível
- Google Maps Routes API
- Banco PostgreSQL/Supabase

## Regras de segurança operacional

O sistema não aceita todos os chamados cegamente. Solicitações com restrições como rua estreita, garagem, altura limitada, veículo pesado ou outras exceções devem poder exigir aprovação humana.

## Estado atual

Estrutura inicial do backend, parser de ocorrências e contratos das integrações.
