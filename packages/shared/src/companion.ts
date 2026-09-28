import { z } from 'zod';

export const localProviderSchema = z.enum(['codex', 'antigravity']);
export const companionCapabilitySchema = z.object({
  installed: z.boolean(),
  ready: z.boolean(),
  version: z.string().max(160),
  detail: z.string().max(200),
});
export const companionCapabilitiesSchema = z.object({
  codex: companionCapabilitySchema,
  antigravity: companionCapabilitySchema,
});
export const companionResultSchemas = {
  hashtags: z.object({
    hashtags: z.string().trim().min(1).max(1000).regex(/^#[\p{L}\p{M}\p{N}_]+(?:\s+#[\p{L}\p{M}\p{N}_]+)*$/u),
  }).strict(),
  thumbnailCopy: z.object({ thumbnailText: z.string().trim().min(1).max(100) }).strict(),
};
export type CompanionTask = keyof typeof companionResultSchemas;
export type CompanionDevice = {
  id: string;
  name: string;
  online: boolean;
  capabilities: Partial<z.infer<typeof companionCapabilitiesSchema>>;
  jobs: { id: string; task: CompanionTask; status: 'queued' | 'running' }[];
};
