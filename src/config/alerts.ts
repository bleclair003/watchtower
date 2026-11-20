import type { AlertSeverity, DeliveryStatus } from '@shared/domain/alerts/types';
import type { Tone } from './categories';

export const SEVERITY_TONE: Record<AlertSeverity, Tone> = { INFORMATION: 'info', ADVISORY: 'ok', WARNING: 'warn', CRITICAL: 'crit' };

export const DELIVERY_TONE: Record<DeliveryStatus, Tone> = {
  sent: 'ok',
  failed: 'crit',
  'suppressed-cooldown': 'muted',
  'not-requested': 'inactive',
  'not-configured': 'warn',
  pending: 'warn',
};
