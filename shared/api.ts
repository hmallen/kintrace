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

export const ItemGroupSchema = z.object({
  id: z.number(),
  label: z.string().nullable(),
  createdAt: z.string(),
  items: z.array(ItemSummarySchema),
});
export type ItemGroup = z.infer<typeof ItemGroupSchema>;

export const ItemGroupSuggestionSchema = z.object({
  item: ItemSummarySchema,
  confidence: z.enum(['possible', 'likely']),
  reasons: z.array(z.enum(['filename', 'title', 'transcription'])),
});
export type ItemGroupSuggestion = z.infer<typeof ItemGroupSuggestionSchema>;

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
  group: ItemGroupSchema.nullable().optional(),
});
export type ItemDetail = z.infer<typeof ItemDetailSchema>;

export const PersonSchema = z.object({ id: z.number(), name: z.string(), notes: z.string().nullable() });
export type Person = z.infer<typeof PersonSchema>;

export const EventSummarySchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  date_start: z.string().nullable(),
  date_end: z.string().nullable(),
  date_precision: PrecisionSchema,
  person_id: z.number().nullable(),
  source_type: z.enum(['gedcom']).nullable(),
  gedcom_import_id: z.number().nullable(),
  gedcom_xref: z.string().nullable(),
  gedcom_tag: z.string().nullable(),
  gedcom_date_raw: z.string().nullable(),
  source_text: z.string().nullable(),
});
export type EventSummary = z.infer<typeof EventSummarySchema>;

export const TimelineStoryParagraphSchema = z.object({
  text: z.string().min(1),
  sourceItemIds: z.array(z.number().int().positive()).min(1),
});
export type TimelineStoryParagraph = z.infer<typeof TimelineStoryParagraphSchema>;

export const TimelineStorySectionSchema = z.object({
  heading: z.string().min(1),
  paragraphs: z.array(TimelineStoryParagraphSchema).min(1),
});
export type TimelineStorySection = z.infer<typeof TimelineStorySectionSchema>;

export const TimelineStorySchema = z.object({
  title: z.string().min(1),
  sections: z.array(TimelineStorySectionSchema).min(1),
});
export type TimelineStory = z.infer<typeof TimelineStorySchema>;

export const TimelineStorySourceSchema = z.object({
  itemId: z.number().int().positive(),
  title: z.string(),
  dateStart: z.string().nullable(),
  dateEnd: z.string().nullable(),
  datePrecision: PrecisionSchema,
  available: z.boolean(),
});
export type TimelineStorySource = z.infer<typeof TimelineStorySourceSchema>;

export const TimelineStoryStateSchema = z.object({
  story: TimelineStorySchema.nullable(),
  sources: z.array(TimelineStorySourceSchema),
  generatedAt: z.string().nullable(),
  model: z.string().nullable(),
  storySourceCount: z.number().int().nonnegative(),
  eligibleSourceCount: z.number().int().nonnegative(),
  stale: z.boolean(),
  canGenerate: z.boolean(),
  unavailableReason: z.enum(['openai_not_configured', 'no_reviewed_media']).nullable(),
});
export type TimelineStoryState = z.infer<typeof TimelineStoryStateSchema>;

export const GedcomWarningSchema = z.object({
  line: z.number().optional(),
  code: z.string(),
  message: z.string(),
});
export type GedcomWarning = z.infer<typeof GedcomWarningSchema>;

export const GedcomImportCountsSchema = z.object({
  peopleQueued: z.number(),
  relationshipsQueued: z.number(),
  eventsQueued: z.number(),
  warnings: z.number(),
});
export type GedcomImportCounts = z.infer<typeof GedcomImportCountsSchema>;

export const GedcomImportResultSchema = z.object({
  importId: z.number(),
  duplicate: z.boolean(),
  counts: GedcomImportCountsSchema,
  warnings: z.array(GedcomWarningSchema),
});
export type GedcomImportResult = z.infer<typeof GedcomImportResultSchema>;

export const GedcomReviewGroupSchema = z.enum(['people', 'relationships', 'events']);
export type GedcomReviewGroup = z.infer<typeof GedcomReviewGroupSchema>;
export const GedcomReviewStatusSchema = z.enum(['pending', 'accepted', 'rejected']);
export type GedcomReviewStatus = z.infer<typeof GedcomReviewStatusSchema>;
export const GedcomReviewItemSchema = z.object({
  id: z.number(),
  importId: z.number(),
  group: GedcomReviewGroupSchema,
  label: z.string(),
  gedcomXref: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  status: GedcomReviewStatusSchema,
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
});
export type GedcomReviewItem = z.infer<typeof GedcomReviewItemSchema>;
export const GedcomReviewQueueSchema = z.object({
  groups: z.array(z.object({
    group: GedcomReviewGroupSchema,
    items: z.array(GedcomReviewItemSchema),
  })),
});
export type GedcomReviewQueue = z.infer<typeof GedcomReviewQueueSchema>;
export const GedcomReviewSelectionBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});
export type GedcomReviewSelectionBody = z.infer<typeof GedcomReviewSelectionBodySchema>;

export const CreatePersonBodySchema = z.object({ name: z.string().min(1), notes: z.string().optional() });
export type CreatePersonBody = z.infer<typeof CreatePersonBodySchema>;
export const CreatePersonResultSchema = z.object({ id: z.number(), name: z.string() });
export type CreatePersonResult = z.infer<typeof CreatePersonResultSchema>;

export const MergePeopleBodySchema = z.object({
  keepId: z.number().int().positive(),
  duplicateId: z.number().int().positive(),
}).refine(({ keepId, duplicateId }) => keepId !== duplicateId, {
  message: 'keepId and duplicateId must be different',
});
export type MergePeopleBody = z.infer<typeof MergePeopleBodySchema>;
export const MergePeopleResultSchema = PersonSchema;
export type MergePeopleResult = z.infer<typeof MergePeopleResultSchema>;

export const ImportResultSchema = z.union([
  z.object({
    path: z.string(),
    itemId: z.number(),
    duplicate: z.boolean(),
    mediaType: MediaTypeSchema,
    status: StatusSchema,
    autoSelected: z.boolean(),
  }),
  z.object({ path: z.string(), error: z.string() }),
]);
export type ImportResult = z.infer<typeof ImportResultSchema>;

export const QueueResultSchema = z.object({ processed: z.number(), failed: z.number() });
export type QueueResult = z.infer<typeof QueueResultSchema>;

export const PatchItemBodySchema = z.object({
  media_type: MediaTypeSchema.optional(),
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

export const CreateItemGroupBodySchema = z.object({
  itemIds: z.array(z.number().int().positive()).min(2),
  label: z.string().trim().min(1).max(200).optional(),
});
export type CreateItemGroupBody = z.infer<typeof CreateItemGroupBodySchema>;

export const AddItemGroupMemberBodySchema = z.object({
  itemId: z.number().int().positive(),
});
export type AddItemGroupMemberBody = z.infer<typeof AddItemGroupMemberBodySchema>;

export const UpdateItemGroupBodySchema = z.object({
  label: z.string().trim().min(1).max(200).nullable(),
});
export type UpdateItemGroupBody = z.infer<typeof UpdateItemGroupBodySchema>;
