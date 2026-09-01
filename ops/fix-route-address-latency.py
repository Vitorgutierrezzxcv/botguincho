from pathlib import Path
import re

# 1) Limpa referencias/telefones grudados no fim de enderecos de fichas.
excluded_path = Path('tools/excluded-areas.mjs')
excluded = excluded_path.read_text(encoding='utf-8')

old_stop = """    'cliente', 'associado', 'solicitante', 'telefone', 'contato', 'motivo', 'observacao', 'obs',
  ];"""
new_stop = """    'cliente', 'associado', 'solicitante', 'telefone', 'contato', 'motivo', 'observacao', 'obs',
    'referencia', 'ref', 'link', 'link do webprestador',
  ];"""
assert old_stop in excluded, 'stopLabels anchor not found'
excluded = excluded.replace(old_stop, new_stop, 1)

old_return = "  return parts.join(', ').trim();"
new_return = """  return parts.join(', ')
    // Algumas centrais colam a referencia sem espaco depois da UF: \"CONTAGEM - MGref. Mateus\".
    // Referencia, telefone e instrucoes nao fazem parte do endereco enviado ao geocoder.
    .replace(/\\b([A-Z]{2})\\s*ref\\.?\\s*:?.*$/i, '$1')
    .replace(/\\bref\\.?\\s*:?.*$/i, '')
    .replace(/\\b(?:refer[eê]ncia|telefone|contato)\\s*:.*$/i, '')
    .replace(/\\s+/g, ' ')
    .trim();"""
assert old_return in excluded, 'address block return anchor not found'
excluded = excluded.replace(old_return, new_return, 1)
excluded_path.write_text(excluded, encoding='utf-8')

normal_path = Path('tools/address-normalization.mjs')
normal = normal_path.read_text(encoding='utf-8')
old_ref = "    .replace(/\\bref\\.?\\s*:.*$/i, '')"
new_ref = """    // WebPrestador/centrais podem mandar \"MGref. Nome - telefone\" sem espaco.
    // Preserva a UF e remove tudo que e apenas referencia operacional.
    .replace(/\\b([A-Z]{2})\\s*ref\\.?\\s*:?.*$/i, '$1')
    .replace(/\\bref\\.?\\s*:?.*$/i, '')
    .replace(/\\b(?:refer[eê]ncia|telefone|contato)\\s*:.*$/i, '')"""
assert old_ref in normal, 'normalize ref anchor not found'
normal = normal.replace(old_ref, new_ref, 1)
normal_path.write_text(normal, encoding='utf-8')

# 2) Impoe budget de resposta para cotacao. Geocodificacoes lentas continuam podendo
# preencher cache em background, mas nunca seguram a fila do grupo por dezenas de segundos.
worker_path = Path('tools/vercel-whatsapp-worker.mjs')
worker = worker_path.read_text(encoding='utf-8')

pattern = re.compile(r"async function estimateQuoteRoute\(groupId, text, facts, incomingLocation = null, pending = null, options = \{\}\) \{.*?\n\}\n\nasync function handleAvailabilityRuntime", re.S)
match = pattern.search(worker)
assert match, 'estimateQuoteRoute block not found'

replacement = r'''async function estimateQuoteRoute(groupId, text, facts, incomingLocation = null, pending = null, options = {}) {
  const rawOriginAddress = extractLabeledAddressBlock(text, 'Origem') || facts.origin || extractLabeledField(text, 'Origem') || enderecoEmTextoLivre(text) || pending?.origin || null;
  const rawDestinationAddress = extractLabeledAddressBlock(text, 'Destino') || facts.destination || extractLabeledField(text, 'Destino') || pending?.destination || null;
  // Nao envia observacao, referencia, telefone ou markup da ficha para o geocoder.
  const originAddress = rawOriginAddress ? normalizeAddressForLookup(rawOriginAddress) : null;
  const destinationAddress = rawDestinationAddress ? normalizeAddressForLookup(rawDestinationAddress) : null;
  const shared = await getRecentSharedLocation(groupId);
  const originCoordinates = incomingLocation
    || (!originAddress ? (pending?.originCoordinates || shared?.coordinates || null) : null);

  const fast = options?.fast === true;
  const calculate = async () => {
    let eta = null;
    let secondLeg = null;
    let fullRoute = null;

    if (fast) {
      if (originAddress || originCoordinates) {
        eta = await computeEtaWithRetry(
          { targetAddress: originAddress, targetCoordinates: originCoordinates },
          { attempts: 1, retryDelayMs: 0 },
        ).catch(() => null);
      }
      return { originAddress, destinationAddress, originCoordinates, eta, secondLeg, fullRoute, estimatedTotalKm: null, timedOut: false };
    }

    if ((originAddress || originCoordinates) && destinationAddress) {
      fullRoute = await computeFullServiceRoute({ originAddress, destinationAddress, originCoordinates }).catch(() => null);
      if (fullRoute) {
        eta = {
          minutes: fullRoute.legToOrigin?.minutes ?? null,
          rawMinutes: fullRoute.legToOrigin?.minutes ?? null,
          distanceKm: fullRoute.legToOrigin?.km ?? null,
          approximate: Boolean(fullRoute.origin?.approximate),
          approximateLevel: fullRoute.origin?.approximateLevel || null,
        };
        secondLeg = {
          minutes: fullRoute.serviceLeg?.minutes ?? null,
          distanceKm: fullRoute.serviceLeg?.km ?? null,
        };
      }
    }

    if (!eta && (originAddress || originCoordinates)) {
      eta = await computeEtaWithRetry(
        { targetAddress: originAddress, targetCoordinates: originCoordinates },
        { attempts: 1, retryDelayMs: 0 },
      ).catch(() => null);
    }
    if (!secondLeg && originAddress && destinationAddress) {
      const [from, to] = await Promise.all([geocodeAddress(originAddress), geocodeAddress(destinationAddress)]);
      if (from && to) secondLeg = await routeBetween(from, to).catch(() => null);
    }
    const estimatedTotalKm = fullRoute?.totalKm ?? (eta?.distanceKm != null && secondLeg?.distanceKm != null
      ? Math.round((Number(eta.distanceKm) + Number(secondLeg.distanceKm)) * 10) / 10
      : null);
    return { originAddress, destinationAddress, originCoordinates, eta, secondLeg, fullRoute, estimatedTotalKm, timedOut: false };
  };

  // Uma consulta de rota jamais pode bloquear a fila do WhatsApp por dezenas de segundos.
  // 8s para ficha completa e 5s para consulta incompleta; depois responde com fallback seguro.
  const budgetMs = Math.max(2000, Math.min(10000, Number(options?.budgetMs ?? (fast ? 5000 : 8000))));
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({
      originAddress,
      destinationAddress,
      originCoordinates,
      eta: null,
      secondLeg: null,
      fullRoute: null,
      estimatedTotalKm: null,
      timedOut: true,
    }), budgetMs);
  });
  try {
    return await Promise.race([calculate(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function handleAvailabilityRuntime'''
worker = pattern.sub(lambda _: replacement, worker, count=1)

# Protocolo usa os mesmos enderecos saneados para comparar identidade de chamada.
old_identity = """    origin: extractLabeledAddressBlock(readableText, 'Origem') || context.facts?.origin || '',
    destination: extractLabeledAddressBlock(readableText, 'Destino') || context.facts?.destination || '',
"""
new_identity = """    origin: normalizeAddressForLookup(extractLabeledAddressBlock(readableText, 'Origem') || context.facts?.origin || ''),
    destination: normalizeAddressForLookup(extractLabeledAddressBlock(readableText, 'Destino') || context.facts?.destination || ''),
"""
assert old_identity in worker, 'protocol identity address anchor not found'
worker = worker.replace(old_identity, new_identity, 1)

# Mensagem de fallback nao culpa o endereco quando o problema foi tempo de provedor.
old_fallback = """    } else {
      lines.push('Não consegui calcular a rota até a origem informada. Se possível, envie a localização do WhatsApp.');
    }
  }
"""
new_fallback = """    } else if (route.timedOut) {
      lines.push('Previsão temporariamente indisponível. O endereço foi recebido corretamente, mas o cálculo da rota excedeu o tempo de resposta.');
    } else {
      lines.push('Não consegui calcular a rota com segurança agora. O endereço foi recebido; uma localização do WhatsApp pode ser usada como alternativa.');
    }
  }
"""
assert old_fallback in worker, 'quote fallback message anchor not found'
worker = worker.replace(old_fallback, new_fallback, 1)
worker_path.write_text(worker, encoding='utf-8')

# 3) Regressao exata do print do WebPrestador.
test_path = Path('tools/test-route-address-latency.mjs')
test_path.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractLabeledAddressBlock } from './excluded-areas.mjs';
import { normalizeAddressInput } from './address-normalization.mjs';

const proterlink = `ATENDIMENTO PROTERLINK
Protocolo: 2026018344
Placa: HMJ7J14
Modelo/Montadora: FIAT / STRADA 1.4 MPI FIRE FLEX 8V CS
Origem: Rua Wilson Gramiscelli, nº 117, Arvoredo, CONTAGEM - MGref. Mateus - (31)99864-2517
Destino: Avenida das Americas, nº 402, Centro, BETIM - MGref. OFICINA 1 ACOMPANHA
Link do WebPrestador:
https://app.webprestador.com.br/a/abc`;

assert.equal(
  extractLabeledAddressBlock(proterlink, 'Origem'),
  'Rua Wilson Gramiscelli, nº 117, Arvoredo, CONTAGEM - MG',
);
assert.equal(
  extractLabeledAddressBlock(proterlink, 'Destino'),
  'Avenida das Americas, nº 402, Centro, BETIM - MG',
);
assert.equal(
  normalizeAddressInput('Rua Wilson Gramiscelli, nº 117, Arvoredo, CONTAGEM - MGref. Mateus - (31)99864-2517'),
  'Rua Wilson Gramiscelli, 117, Arvoredo, CONTAGEM - MG',
);

const worker = fs.readFileSync(new URL('./vercel-whatsapp-worker.mjs', import.meta.url), 'utf8');
assert.match(worker, /budgetMs[^\n]+fast \? 5000 : 8000/);
assert.match(worker, /timedOut: true/);
assert.match(worker, /O endereço foi recebido corretamente, mas o cálculo da rota excedeu o tempo de resposta/);
assert.match(worker, /normalizeAddressForLookup\(extractLabeledAddressBlock\(readableText, 'Origem'\)/);
console.log('ROUTE_ADDRESS_LATENCY_REGRESSION_OK');
''', encoding='utf-8')

print('route/address latency patch applied')
