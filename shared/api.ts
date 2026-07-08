import { z } from 'zod';
import { PRECISION_VALUES } from './dates.js';

export const MediaTypeSchema = z.enum(['photo','letter','article','audio','video','pdf']);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const StatusSchema = z.enum(['pending','transcribed','reviewed']);
export type Status = z.infer<typeof StatusSchema>;

export const PersonRoleSchema = z.enum(['subject','author','recipient']);
export type PersonRole = z.infer<typeof PersonRoleSchema>;

export const PrecisionSchema = z.enum(PRECISION_VALUES);
export type { Precision } from './dates.js';

export const ConfidenceSchema = z.object({
  overall: z.enum(['high','medium','low']),
  summary: z.string(),
  flaggedSpans: z.array(z.object({ text: z.string(), reason: z.string() })),
});
export type AiConfidence = z.infer<typeof ConfidenceSchema>;

export const PersonRefSchema = z.object({ id: z.number(), name: z.string(), role: PersonRoleSchema });
export type PersonRef = z.infer<typeof PersonRefSchema>;

export const ItemSummarySchema = z.object({
  id: z.number(),
  title: z.string().nullable(),
  media_type: MediaTypeSchema,
  date_start: z.string().nullable(),
  date_end: z.string().nullable(),
  date_precision: PrecisionSchema,
  status: StatusSchema,
  content_hash: z.string(),
  thumb_path: z.string().nullable(),
});
export type ItemSummary = z.infer<typeof ItemSummarySchema>;

export const ItemDetailSchema = ItemSummarySchema.extend({
  file_path: z.string(),
  created_at: z.string(),
  description: z.string().nullable(),
  transcription_diplomatic: z.string().nullable(),
  transcription_normalized: z.string().nullable(),
  ai_error: z.string().nullable(),
  ai_names: z.string().nullable(),          // JSON string, NOT parsed
  ai_confidence: ConfidenceSchema.nullable(), // parsed object | null
  people: z.array(PersonRefSchema),
});
export type ItemDetail = z.infer<typeof ItemDetailSchema>;

export const PersonSchema = z.object({ id: z.number(), name: z.string(), notes: z.string().nullable() });
export type Person = z.infer<typeof PersonSchema>;

export const CreatePersonBodySchema = z.object({ name: z.string().min(1), notes: z.string().optional() });
export type CreatePersonBody = z.infer<typeof CreatePersonBodySchema>;
export const CreatePersonResultSchema = z.object({ id: z.number(), name: z.string() });
export type CreatePersonResult = z.infer<typeof CreatePersonResultSchema>;

export const ImportResultSchema = z.union([
  z.object({ path: z.string(), itemId: z.number(), duplicate: z.boolean() }),
  z.object({ path: z.string(), error: z.string() }),
]);
export type ImportResult = z.infer<typeof ImportResultSchema>;

export const QueueResultSchema = z.object({ processed: z.number(), failed: z.number() });
export type QueueResult = z.infer<typeof QueueResultSchema>;

export const PatchItemBodySchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  transcription_diplomatic: z.string().optional(),
  transcription_normalized: z.string().optional(),
  date: z.object({
    start: z.string().nullable().optional(),
    end: z.string().nullable().optional(),
    precision: PrecisionSchema.optional(),
  }).optional(),
  status: z.literal('reviewed').optional(),
});
export type PatchItemBody = z.infer<typeof PatchItemBodySchema>;

export const LinkPersonBodySchema = z.object({ personId: z.number(), role: PersonRoleSchema });
export type LinkPersonBody = z.infer<typeof LinkPersonBodySchema>;
