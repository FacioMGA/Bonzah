import { describe, expect, it } from 'vitest';
import { TravelProductAdapter } from '../travel/TravelProductAdapter.js';
import { HealthProductAdapter } from '../health/HealthProductAdapter.js';
import { HomeProductAdapter } from '../home/HomeProductAdapter.js';
import { MotorProductAdapter } from '../motor/MotorProductAdapter.js';

// IPID must be resolvable at quote stage, before purchase (Peter, 2026-07-21).
describe('product IPID resolution (quote-stage disclosure)', () => {
  it('travel resolves the selected trip-type IPID asset', () => {
    const asset = new TravelProductAdapter().resolveIpidAsset('CY', { variant: 'single_trip' });
    expect(asset?.filename).toBe('Travel_Single_Trip_IPID.pdf');
    expect(asset?.absolutePath).toMatch(/\.pdf$/);
  });

  it('health resolves the Brit Immigration Health IPID', () => {
    const asset = new HealthProductAdapter().resolveIpidAsset('CY');
    expect(asset?.filename).toBe('Brit_Immigration_Health_IPID.pdf');
  });

  it('home resolves a territory-specific IPID for each live territory', () => {
    const home = new HomeProductAdapter();
    expect(home.resolveIpidAsset('GR')?.filename).toBe('Home_IPID_Beazley_Cyprus_Greece_2023.pdf');
    expect(home.resolveIpidAsset('CY')?.filename).toBe('Home_IPID_Beazley_Cyprus_Greece_2023.pdf');
    expect(home.resolveIpidAsset('PT')?.filename).toBe('Home_IPID_Beazley_Spain_Portugal.pdf');
  });

  it('home fails closed for an unconfigured territory rather than defaulting', () => {
    expect(() => new HomeProductAdapter().resolveIpidAsset('FR')).toThrow(/HOME_IPID_NOT_CONFIGURED/);
  });

  it('motor resolves the approved Santam IPIDs for Cyprus and Portugal', () => {
    const motor = new MotorProductAdapter();
    expect(motor.resolveIpidAsset('CY')?.filename).toBe(
      'Abbeygate_Motor_Cyprus_IPID_LIC_Santam_UMR_B176026EEA6152.pdf',
    );
    expect(motor.resolveIpidAsset('PT')?.filename).toBe('Abbeygate_Motor_Portugal_IPID_LIC_Santam_August2026.pdf');
    expect(() => motor.resolveIpidAsset('GR')).toThrow(/MOTOR_IPID_NOT_CONFIGURED/);
  });
});
