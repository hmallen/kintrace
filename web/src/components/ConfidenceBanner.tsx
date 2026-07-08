import type { AiConfidence } from '@shared/api.js';

const BADGE_COLORS: Record<AiConfidence['overall'], string> = {
  high: '#166534',
  medium: '#92400e',
  low: '#991b1b',
};

export interface ConfidenceBannerProps {
  confidence: AiConfidence | null;
  aiError: string | null;
}

export function ConfidenceBanner({ confidence, aiError }: ConfidenceBannerProps) {
  return (
    <div>
      {aiError !== null && (
        <p role="alert" style={{ color: '#991b1b' }}>
          AI error: {aiError}
        </p>
      )}
      {confidence !== null ? (
        <p>
          <span
            data-testid="confidence-overall"
            style={{
              display: 'inline-block',
              padding: '0 0.5em',
              borderRadius: '1em',
              border: `1px solid ${BADGE_COLORS[confidence.overall]}`,
              color: BADGE_COLORS[confidence.overall],
              fontSize: '0.75rem',
            }}
          >
            {confidence.overall}
          </span>{' '}
          confidence — {confidence.summary}
        </p>
      ) : (
        <p style={{ color: '#777' }}>Not yet transcribed.</p>
      )}
    </div>
  );
}
