import { transcribeDraft, verifyTranscription, type VisionClient } from './transcriber.js';

export interface ConfidenceReport {
  overall: 'high' | 'medium' | 'low';
  summary: string;
  flaggedSpans: { text: string; reason: string }[];
}

export interface TranscriptionResult {
  transcriptionDiplomatic: string | null;
  transcriptionNormalized: string | null;
  title: string;
  description: string;
  date: { start: string | null; end: string | null; precision: string };
  names: string[];
  documentType: string;
  confidence: ConfidenceReport;
}

export interface TranscriptionEngine {
  transcribe(images: Buffer[], mediaType: string): Promise<TranscriptionResult>;
}

/**
 * Two-pass LLM vision engine: a draft transcription pass followed by a
 * verification pass that re-checks the draft against the image(s) and attaches
 * a confidence report. The verify pass always runs — even when the draft found
 * no text it can catch a missed inscription. Errors from either pass propagate
 * unchanged; there are no retries or fallbacks.
 */
export function createLlmVisionEngine(client: VisionClient): TranscriptionEngine {
  return {
    async transcribe(images, mediaType) {
      const draft = await transcribeDraft(client, images, mediaType);
      const verified = await verifyTranscription(client, images, mediaType, draft);
      return {
        transcriptionDiplomatic: verified.transcription_diplomatic,
        transcriptionNormalized: verified.transcription_normalized,
        title: verified.title,
        description: verified.description,
        date: verified.date,
        names: verified.names,
        documentType: verified.documentType,
        confidence: verified.confidence,
      };
    },
  };
}
