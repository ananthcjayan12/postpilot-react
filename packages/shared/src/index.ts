import { z } from 'zod';
export const platformSchema = z.enum(['youtube', 'instagram', 'facebook']);
export type Platform = z.infer<typeof platformSchema>;
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
});
export const settingsInput = z.object({
  youtube: z.boolean(),
  instagram: z.boolean(),
  facebook: z.boolean(),
  notify: z.boolean(),
  confirm: z.boolean(),
  schedulerEnabled: z.boolean().default(true),
});
export const defaultSettings = {
  youtube: true,
  instagram: true,
  facebook: true,
  notify: true,
  confirm: true,
  schedulerEnabled: true,
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
