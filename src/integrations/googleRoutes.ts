import type { RouteEstimate } from '../domain/types.js';

type LatLng = {
  latitude: number;
  longitude: number;
};

type ComputeRouteInput = {
  origin: LatLng;
  destinationAddress: string;
};

type GoogleRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
  }>;
  error?: {
    message?: string;
    status?: string;
  };
};

export class GoogleRoutesClient {
  private readonly apiKey?: string;

  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async computeEta(input: ComputeRouteInput): Promise<RouteEstimate> {
    if (!this.apiKey) {
      throw new Error('Google Routes não configurado. Defina GOOGLE_MAPS_API_KEY.');
    }

    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: input.origin,
          },
        },
        destination: {
          address: input.destinationAddress,
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
    });

    const body = (await response.json()) as GoogleRoutesResponse;

    if (!response.ok) {
      throw new Error(body.error?.message ?? `Google Routes retornou HTTP ${response.status}.`);
    }

    const route = body.routes?.[0];
    if (!route?.distanceMeters || !route.duration) {
      throw new Error('Google Routes não retornou uma rota válida.');
    }

    const durationSeconds = Number(route.duration.replace('s', ''));
    if (!Number.isFinite(durationSeconds)) {
      throw new Error('Duração inválida retornada pelo Google Routes.');
    }

    return {
      distanceMeters: route.distanceMeters,
      durationSeconds,
      trafficAware: true,
    };
  }
}

export function roundEtaToOperationalMinutes(durationSeconds: number, stepMinutes = 10): number {
  const minutes = durationSeconds / 60;
  return Math.ceil(minutes / stepMinutes) * stepMinutes;
}
