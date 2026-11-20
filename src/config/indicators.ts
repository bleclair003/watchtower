import type { IndicatorState, RaiBand } from '@shared/domain/indicators/types';
import type { Tone } from './categories';

export const INDICATOR_STATE_TONE: Record<IndicatorState, Tone> = {
  TRIGGERED: 'crit',
  ELEVATED: 'warn',
  NORMAL: 'ok',
  UNKNOWN: 'muted',
  DATA_UNAVAILABLE: 'inactive',
  DISABLED: 'inactive',
};

export const INDICATOR_STATE_LABEL: Record<IndicatorState, string> = {
  TRIGGERED: 'TRIGGERED',
  ELEVATED: 'ELEVATED',
  NORMAL: 'NORMAL',
  UNKNOWN: 'UNKNOWN',
  DATA_UNAVAILABLE: 'NO DATA',
  DISABLED: 'DISABLED',
};

export const BAND_TONE: Record<RaiBand, Tone> = {
  BASELINE: 'ok',
  INCREASED: 'info',
  ELEVATED: 'warn',
  SIGNIFICANT: 'warn',
  EXCEPTIONAL: 'crit',
};

export const RAI_DISCLAIMER =
  'The Regional Activity Index measures unusual activity in the sources WATCHTOWER monitors. It is not a probability of conflict, attack or any other event.';
