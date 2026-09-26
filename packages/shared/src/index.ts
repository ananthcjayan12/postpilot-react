import { z } from 'zod';
export const platformSchema = z.enum(['youtube', 'instagram', 'facebook']);
export type Platform = z.infer<typeof platformSchema>;
export const videoMetadataSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration: z.number().positive().finite(),
});
export type VideoMetadata = z.infer<typeof videoMetadataSchema>;
export function shortsEligibility(metadata?: VideoMetadata): string | null {
  if (!metadata) return 'Video dimensions and duration could not be read. Choose a playable video to check Shorts eligibility.';
  if (metadata.width > metadata.height) return 'Shorts require a square or vertical frame. Export this video in portrait format; vertical footage inside a landscape frame does not qualify.';
  if (metadata.duration > 180) return 'Shorts must be 3 minutes or less. Trim the video before uploading as a Short.';
  return null;
}
export const postInput = z.object({
  title: z.string().trim().min(1).max(100),
  caption: z.string().max(5000).default(''),
  mediaId: z.string().uuid(),
  platforms: z
    .array(platformSchema)
    .min(1)
    .max(3)
    .transform((p) => [...new Set(p)]),
  action: z.enum(['draft', 'schedule', 'publish']),
  scheduledFor: z.string().datetime().optional(),
  youtubeFormat: z.enum(['video', 'short']).default('video'),
  videoMetadata: videoMetadataSchema.optional(),
  hashtags: z.string().max(1000).default(''),
  thumbnailMediaId: z.string().uuid().nullable().optional(),
});
export const settingsInput = z.object({
  youtube: z.boolean(),
  instagram: z.boolean(),
  facebook: z.boolean(),
  notify: z.boolean(),
  confirm: z.boolean(),
  schedulerEnabled: z.boolean().default(true),
  geminiApiKey: z.string().trim().min(10).max(500).nullable().optional(),
  openaiApiKey: z.string().trim().min(10).max(500).nullable().optional(),
  aiRoutes: z.object({
    metadata: z.enum(['gemini:gemini-3.8-flash', 'gemini:gemini-2.5-flash']),
    hashtags: z.enum(['gemini:gemini-3.8-flash', 'gemini:gemini-2.5-flash', 'openai:gpt-5-mini', 'openai:gpt-4.1-mini']),
    thumbnailCopy: z.enum(['gemini:gemini-3.8-flash', 'gemini:gemini-2.5-flash', 'openai:gpt-5-mini', 'openai:gpt-4.1-mini']),
    thumbnail: z.enum(['gemini:gemini-3.1-flash-image', 'gemini:gemini-2.5-flash-image', 'openai:gpt-image-2.5-flare', 'openai:gpt-image-2.5-sunburst']),
    thumbnailResolution: z.enum(['1K', '2K', '4K']),
  }).default({
    metadata: 'gemini:gemini-3.8-flash',
    hashtags: 'gemini:gemini-3.8-flash',
    thumbnailCopy: 'gemini:gemini-3.8-flash',
    thumbnail: 'gemini:gemini-3.1-flash-image',
    thumbnailResolution: '1K',
  }),
  contentLanguage: z.object({
    mode: z.enum(['english', 'malayalam', 'malayalam_english', 'custom']),
    custom: z.string().trim().max(120).default(''),
  }).refine((value) => value.mode !== 'custom' || value.custom.length > 0, {
    message: 'Enter a custom language or language mix.', path: ['custom'],
  }).default({ mode: 'english', custom: '' }),
});
export const defaultSettings = {
  youtube: true,
  instagram: true,
  facebook: true,
  notify: true,
  confirm: true,
  schedulerEnabled: true,
  aiRoutes: {
    metadata: 'gemini:gemini-3.8-flash' as const,
    hashtags: 'gemini:gemini-3.8-flash' as const,
    thumbnailCopy: 'gemini:gemini-3.8-flash' as const,
    thumbnail: 'gemini:gemini-3.1-flash-image' as const,
    thumbnailResolution: '1K' as const,
  },
  contentLanguage: { mode: 'english' as const, custom: '' },
};
export const uploadInput = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']),
  size: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 ** 3),
});
export const PART_SIZE = 8 * 1024 ** 2;
