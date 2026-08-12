import { chromium, type BrowserContext, type Page, type Response } from 'playwright';
import type { TowTruckPosition } from '../domain/types.js';
import type { TrackingProvider } from './contracts.js';

type CandidatePosition = {
  latitude: number;
  longitude: number;
  speedKph?: number;
  ignitionOn?: boolean;
  capturedAt?: string;
  vehicleId?: string;
};

function numberFrom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function findPosition(value: unknown, vehicleId: string): CandidatePosition | undefined {
  if (!value || typeof value !== 'object') return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPosition(item, vehicleId);
      if (found) return found;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const latitude = numberFrom(record.latitude ?? record.lat ?? record.Latitude ?? record.Lat);
  const longitude = numberFrom(record.longitude ?? record.lng ?? record.lon ?? record.Longitude ?? record.Lng);
  const embeddedVehicle = String(
    record.vehicleId ?? record.vehicle ?? record.plate ?? record.placa ?? record.name ?? record.nome ?? '',
  );

  if (
    latitude !== undefined &&
    longitude !== undefined &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180 &&
    (!embeddedVehicle || embeddedVehicle.toLowerCase().includes(vehicleId.toLowerCase()))
  ) {
    return {
      latitude,
      longitude,
      vehicleId: embeddedVehicle || undefined,
      speedKph: numberFrom(record.speed ?? record.velocidade ?? record.speedKph),
      ignitionOn:
        typeof (record.ignition ?? record.ignicao ?? record.ignitionOn) === 'boolean'
          ? Boolean(record.ignition ?? record.ignicao ?? record.ignitionOn)
          : undefined,
      capturedAt: String(record.updatedAt ?? record.lastUpdate ?? record.dataHora ?? record.timestamp ?? '') || undefined,
    };
  }

  for (const child of Object.values(record)) {
    const found = findPosition(child, vehicleId);
    if (found) return found;
  }

  return undefined;
}

export class GConnectBrowserProvider implements TrackingProvider {
  private readonly loginUrl = process.env.GCONNECT_LOGIN_URL;
  private readonly username = process.env.GCONNECT_USERNAME;
  private readonly password = process.env.GCONNECT_PASSWORD;
  private readonly usernameSelector = process.env.GCONNECT_USERNAME_SELECTOR ?? 'input[type="text"], input[name*="user" i], input[name*="login" i]';
  private readonly passwordSelector = process.env.GCONNECT_PASSWORD_SELECTOR ?? 'input[type="password"]';
  private readonly submitSelector = process.env.GCONNECT_SUBMIT_SELECTOR ?? 'button[type="submit"], input[type="submit"]';
  private readonly timeoutMs = Number(process.env.GCONNECT_TIMEOUT_MS ?? 30000);

  isConfigured(): boolean {
    return Boolean(this.loginUrl && this.username && this.password);
  }

  async getCurrentPosition(vehicleId: string): Promise<TowTruckPosition> {
    if (!this.isConfigured()) {
      throw new Error('GConnect não configurado. Defina GCONNECT_LOGIN_URL, GCONNECT_USERNAME e GCONNECT_PASSWORD.');
    }

    const browser = await chromium.launch({ headless: true });
    let context: BrowserContext | undefined;

    try {
      context = await browser.newContext();
      const page = await context.newPage();
      const candidate = await this.capturePosition(page, vehicleId);

      if (!candidate) {
        throw new Error(`Não foi possível localizar coordenadas válidas para o veículo ${vehicleId} no GConnect.`);
      }

      return {
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        speedKph: candidate.speedKph,
        ignitionOn: candidate.ignitionOn,
        capturedAt: candidate.capturedAt || new Date().toISOString(),
      };
    } finally {
      await context?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  private async capturePosition(page: Page, vehicleId: string): Promise<CandidatePosition | undefined> {
    const candidates: CandidatePosition[] = [];

    const inspectResponse = async (response: Response) => {
      const contentType = response.headers()['content-type'] ?? '';
      if (!contentType.includes('application/json')) return;

      try {
        const body = await response.json();
        const found = findPosition(body, vehicleId);
        if (found) candidates.push(found);
      } catch {
        // Nem toda resposta marcada como JSON é legível pelo Playwright.
      }
    };

    page.on('response', response => {
      void inspectResponse(response);
    });

    await page.goto(this.loginUrl!, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
    await page.locator(this.usernameSelector).first().fill(this.username!);
    await page.locator(this.passwordSelector).first().fill(this.password!);
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: this.timeoutMs }).catch(() => undefined),
      page.locator(this.submitSelector).first().click(),
    ]);

    await page.waitForTimeout(2500);

    const search = page.locator('input[placeholder*="veículo" i], input[placeholder*="veiculo" i], input[type="search"]').first();
    if (await search.count()) {
      await search.fill(vehicleId).catch(() => undefined);
      await page.waitForTimeout(1500);
    }

    const vehicleText = page.getByText(vehicleId, { exact: false }).first();
    if (await vehicleText.count()) {
      await vehicleText.click().catch(() => undefined);
      await page.waitForTimeout(2000);
    }

    if (candidates.length > 0) return candidates.at(-1);

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const coordinateMatch = bodyText.match(/(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/);
    if (coordinateMatch) {
      return {
        latitude: Number(coordinateMatch[1]),
        longitude: Number(coordinateMatch[2]),
        capturedAt: new Date().toISOString(),
      };
    }

    return undefined;
  }
}
