import type { CyberSnapshot } from '@shared/domain/cyber';

/** SIMULATED cyber page data for demo mode and tests. Invented CVEs and items. */
export function buildDemoCyber(now: number): CyberSnapshot {
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const day = (d: number) => at(d * 24).slice(0, 10);
  return {
    computedAt: at(0),
    epssAt: at(2),
    simulated: true,
    kev: [
      { cve: 'CVE-2026-0001', vendor: '[SIMULATED] Demo', product: 'Gateway', name: 'Demo Gateway Authentication Bypass', added: day(1), due: day(-20), ransomware: true, epss: 0.74, percentile: 0.995 },
      { cve: 'CVE-2026-0002', vendor: '[SIMULATED] Demo', product: 'Mail Server', name: 'Demo Mail Server Remote Code Execution', added: day(6), due: day(-15), ransomware: false, epss: 0.03, percentile: 0.85 },
    ],
    advisories: [
      { title: '[SIMULATED] Joint advisory: state actor targets demo infrastructure', url: 'https://example.invalid/cisa-1', at: at(20), label: 'Joint advisory', routine: false },
      { title: '[SIMULATED] ICS advisory: Demo PLC', url: 'https://example.invalid/cisa-2', at: at(30), label: 'ICS advisory', routine: true },
    ],
    agencies: [{ title: '[SIMULATED] AL26-001 - Critical vulnerability in demo product', url: 'https://example.invalid/cccs', at: at(10), label: 'Canadian Centre for Cyber Security' }],
    outages: [{ title: '[SIMULATED] Internet outage — Demo Country: government order (nationwide)', url: 'https://example.invalid/outage', at: at(5), label: 'Cloudflare Radar', cause: 'GOVERNMENT_DIRECTED', ongoing: true }],
  };
}
