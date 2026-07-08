import type { AiConfidence } from '@shared/api.js';

export interface ConfidenceBannerProps {
  confidence: AiConfidence | null;
  aiError: string | null;
}

export function ConfidenceBanner({ confidence, aiError }: ConfidenceBannerProps) {
  return (
    <div>
      {aiError !== null && <p role="alert">AI error: {aiError}</p>}
      {confidence !== null ? (
        <p>
          <span
            data-testid="confidence-overall"
            className={`confidence-badge confidence-${confidence.overall}`}
          >
            {confidence.overall}
          </span>{' '}
          confidence — {confidence.summary}
        </p>
      ) : (
        <p className="hint">Not yet transcribed.</p>
      )}
    </div>
  );
}
