import type { EvidenceAssessment, IncidentStatus } from '@shared/domain/incidents/types';
import type { Tone } from './categories';

export const STATUS_TONE: Record<IncidentStatus, Tone> = { developing: 'warn', stable: 'info', closed: 'inactive' };

export const ASSESSMENT_TONE: Record<EvidenceAssessment, Tone> = {
  confirmed: 'ok',
  unconfirmed: 'muted',
  disputed: 'warn',
  context: 'info',
};

export const ASSESSMENT_HELP: Record<EvidenceAssessment, string> = {
  confirmed: 'You judge the claim established, e.g. by independent corroboration.',
  unconfirmed: 'Reported but not yet established.',
  disputed: 'Contradicted by other evidence or by the parties involved.',
  context: 'Background that informs the situation but is not itself a development.',
};
