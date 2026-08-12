export type RestrictionCode =
  | 'NARROW_ACCESS'
  | 'LOW_HEIGHT'
  | 'UNDERGROUND'
  | 'HEAVY_VEHICLE'
  | 'LOCKED_WHEEL'
  | 'DAMAGED_VEHICLE'
  | 'UNKNOWN_RESTRICTION';

export type ServiceRequest = {
  insurer?: string;
  vehicle?: string;
  reason?: string;
  service?: string;
  origin?: string;
  destination?: string;
  reference?: string;
  passengers?: number;
  restrictions: RestrictionCode[];
  rawText: string;
};

export type TowTruckPosition = {
  latitude: number;
  longitude: number;
  capturedAt: string;
  speedKph?: number;
  ignitionOn?: boolean;
};

export type RouteEstimate = {
  distanceMeters: number;
  durationSeconds: number;
  trafficAware: boolean;
};

export type Decision = {
  action: 'AUTO_ACCEPT' | 'HUMAN_REVIEW' | 'REJECT';
  reason: string;
};
