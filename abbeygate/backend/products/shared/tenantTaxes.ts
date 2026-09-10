import type { TenantConfig } from '../../platform/tenant/tenantConfig.js';

export interface TenantTaxResult {
  netPremium: number;
  iptAmount: number;
  adminFee: number;
  grossPremium: number;
}

/**
 * Apply tenant-specific IPT and admin fee to a net premium.
 *
 * Cyprus: flat fee (default 2 EUR)
 * Portugal: rate-based (default 9%)
 * Other countries: either (whichever is declared in tenant config).
 */
export function applyTenantTaxes(tenant: TenantConfig, netPremium: number): TenantTaxResult {
  const net = Math.max(0, Number(netPremium) || 0);
  const iptFlat = Number(tenant.ipt.flatFee || 0);
  const iptRate = Number(tenant.ipt.rate || 0);
  const iptAmount = iptFlat > 0 ? iptFlat : Number((net * iptRate).toFixed(2));
  const adminFee = Number(tenant.adminFee) || 0;
  const grossPremium = Number((net + iptAmount + adminFee).toFixed(2));
  return {
    netPremium: Number(net.toFixed(2)),
    iptAmount: Number(iptAmount.toFixed(2)),
    adminFee: Number(adminFee.toFixed(2)),
    grossPremium,
  };
}
