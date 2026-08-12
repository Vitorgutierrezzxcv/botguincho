import type { Decision, ServiceRequest } from './types.js';

export function decideRequest(request: ServiceRequest): Decision {
  if (!request.origin || !request.service) {
    return {
      action: 'HUMAN_REVIEW',
      reason: 'Solicitação incompleta: origem ou tipo de serviço ausente.',
    };
  }

  if (request.restrictions.length > 0) {
    return {
      action: 'HUMAN_REVIEW',
      reason: `Restrição operacional detectada: ${request.restrictions.join(', ')}.`,
    };
  }

  return {
    action: 'AUTO_ACCEPT',
    reason: 'Solicitação padrão sem restrições operacionais detectadas.',
  };
}
