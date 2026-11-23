import { useState } from 'react';
import { FEEDBACK_LABEL, FEEDBACK_NOTE_MAX, FEEDBACK_VERDICTS, type AlertFeedback, type FeedbackVerdict } from '@shared/domain/alerts/types';
import type { Tone } from '../../config/categories';
import { Tag } from '../ui/Tag';

export const VERDICT_TONE: Record<FeedbackVerdict, Tone> = {
  useful: 'ok',
  irrelevant: 'muted',
  'false-positive': 'crit',
  miscategorised: 'warn',
};

/** The verdict tag shown on an alert row once someone has reviewed it. */
export function FeedbackTag({ feedback }: { feedback: AlertFeedback | null | undefined }) {
  if (!feedback) return null;
  return (
    <Tag tone={VERDICT_TONE[feedback.verdict]} title={feedback.note || undefined}>
      {FEEDBACK_LABEL[feedback.verdict].toUpperCase()}
    </Tag>
  );
}

/**
 * Verdict buttons and an optional note for one alert (v0.67.0). Choosing the current verdict again
 * clears it. Feedback is separate from acknowledging: it does not close the alert.
 */
export function FeedbackControls({
  feedback,
  onSave,
  disabled = false,
}: {
  feedback: AlertFeedback | null | undefined;
  onSave: (f: AlertFeedback | null) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [note, setNote] = useState(feedback?.note ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (verdict: FeedbackVerdict | null) => {
    setBusy(true);
    try {
      await onSave(verdict ? { verdict, note: note.trim().slice(0, FEEDBACK_NOTE_MAX), at: new Date().toISOString() } : null);
    } finally {
      setBusy(false);
    }
  };
  const noteChanged = !!feedback && note.trim() !== feedback.note;
  return (
    <div className="space-y-1" role="group" aria-label="Feedback on this alert">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-wt-fg-dim">WAS THIS ALERT:</span>
        {FEEDBACK_VERDICTS.map((v) => {
          const on = feedback?.verdict === v;
          return (
            <button
              key={v}
              type="button"
              disabled={disabled || busy}
              aria-pressed={on}
              onClick={() => void save(on ? null : v)}
              className={`border px-1.5 ${on ? 'border-wt-fg bg-wt-fg text-wt-bg' : 'border-wt-line-strong text-wt-fg-muted hover:text-wt-fg'} disabled:opacity-50`}
            >
              {FEEDBACK_LABEL[v].toUpperCase()}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="text-wt-fg-dim">NOTE</span>
          <input
            type="text"
            value={note}
            maxLength={FEEDBACK_NOTE_MAX}
            disabled={disabled || busy}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional: why (saved with the verdict)"
            className="h-6 min-w-0 flex-1 border border-wt-line-strong bg-wt-bg px-1 text-2xs"
          />
        </label>
        {noteChanged && (
          <button type="button" disabled={busy} onClick={() => void save(feedback!.verdict)} className="text-wt-fg-muted hover:text-wt-fg">
            [SAVE NOTE]
          </button>
        )}
      </div>
    </div>
  );
}
