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

O projeto é desacoplado das integrações reais para que WhatsApp, ENGESP e Google Maps possam ser conectados progressivamente sem travar o desenvolvimento.

### Integrações previstas

- WhatsApp Business Platform / Groups API
- ENGESP ou provedor de rastreamento compatível
- Google Maps Routes API
- Banco PostgreSQL/Supabase

## WhatsApp POC

A primeira POC de webhook da Meta já está implementada.

Endpoints:

- `GET /webhooks/whatsapp` — validação do webhook pela Meta.
- `POST /webhooks/whatsapp` — recebimento e processamento de eventos.
- `POST /api/poc/whatsapp-webhook` — simulação local de payload em desenvolvimento.
- `POST /api/requests/parse` — teste direto do parser de solicitações.
- `GET /health` — estado básico do serviço e das configurações do WhatsApp.

A validação de `X-Hub-Signature-256` usa `META_APP_SECRET`. Em produção, essa variável é obrigatória.

`WHATSAPP_SEND_ENABLED=false` mantém a integração em dry-run. Só habilite envio real depois de validar número, token, versão da Graph API e comportamento da conta.

### Atenção: grupos existentes das seguradoras

A Groups API oficial da Meta possui um ciclo próprio de criação/convite de participantes. Portanto, o projeto **não assume** que um número Cloud API possa simplesmente ser adicionado a qualquer grupo convencional já criado por uma seguradora. Eventos onde um `groupId` for detectado são processados, mas a resposta ao grupo fica em dry-run até validarmos a conta habilitada e o fluxo oficial aplicável.

Isso é deliberado para impedir que a automação responda para o destino errado ou dependa de um comportamento não confirmado da plataforma.

## Regras de segurança operacional

O sistema não aceita todos os chamados cegamente. Solicitações com restrições como rua estreita, garagem, altura limitada, veículo pesado ou outras exceções devem poder exigir aprovação humana.

### Cancelamento depois da confirmação

- A seguradora pode cancelar sem cobrança até 15 minutos após a confirmação do chamado.
- Depois de 15 minutos, a saída e o deslocamento são cobrados integralmente pela quilometragem total congelada na autorização.
- Valor ou quilometragem parcial informado pela central não substitui o cálculo integral.
- Horário da confirmação, prazo, horário do cancelamento, quilômetros e valor ficam registrados no chamado e na auditoria.

## Configuração

Copie `.env.example` para `.env` e preencha as credenciais necessárias.

```bash
npm install
npm run dev
```

Para build de produção:

```bash
npm run build
npm start
```

## Estado atual

- backend Node.js + TypeScript;
- parser inicial de ocorrências;
- motor inicial de decisão;
- webhook Meta/WhatsApp;
- validação de assinatura do webhook;
- cliente Cloud API para mensagens individuais;
- processamento em dry-run para grupos;
- contratos para rastreador e rotas.

Próximas etapas: validar o cenário real de grupos das seguradoras, integrar ENGESP e conectar Google Routes para cálculo de ETA.
