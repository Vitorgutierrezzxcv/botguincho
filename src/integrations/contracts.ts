import type { RouteEstimate, TowTruckPosition } from '../domain/types.js';

export interface TrackingProvider {
  getCurrentPosition(vehicleId: string): Promise<TowTruckPosition>;
}

export interface RoutingProvider {
  estimate(params: {
    origin: TowTruckPosition;
    destinationAddress: string;
  }): Promise<RouteEstimate>;
}

export interface MessagingProvider {
  sendText(params: {
    conversationId: string;
    text: string;
  }): Promise<void>;
}
