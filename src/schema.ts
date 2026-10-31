import { z } from 'zod';
import { ChordSymbolSchema } from './music.js';

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_BOARDS = 128;
export const BoardIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/).brand<'BoardId'>();
export const RevisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1).brand<'Revision'>();
const text = z.string().trim().min(1).max(120);
const description = z.string().trim().max(1200).optional();
export const ContentSchema = z.strictObject({
  title: text,
  description,
  tempo: z.number().int().min(40).max(200).default(90),
  groups: z.array(z.strictObject({
    id: BoardIdSchema,
    title: text,
    description,
    chords: z.array(ChordSymbolSchema).min(1).max(32),
  })).min(1).max(12),
}).superRefine((content, context) => {
  if (new Set(content.groups.map(group => group.id)).size !== content.groups.length) {
    context.addIssue({ code: 'custom', path: ['groups'], message: 'Group IDs must be unique' });
  }
});
export const BoardSchema = z.strictObject({
  id: BoardIdSchema,
  revision: RevisionSchema.refine(revision => revision > 0, 'Persisted revision must be positive'),
  content: ContentSchema,
});
export type BoardId = z.infer<typeof BoardIdSchema>;
export type Revision = z.infer<typeof RevisionSchema>;
export type Content = z.infer<typeof ContentSchema>;
export type Board = z.infer<typeof BoardSchema>;

export const demoContent = ContentSchema.parse({
  title: 'The same D, a different way home',
  description: 'Compare the bright major IV with the subtle minor iv. This is a harmony teaching example, not a verified transcription of any song.',
  groups: [
    { id: 'major', title: 'Major IV', description: 'D → G → D · A bright return to the tonic.', chords: ['D', 'G', 'D'] },
    { id: 'minor', title: 'Minor iv', description: 'D → Gm → D · B becomes B♭. These guitar shapes also change register and doubled notes.', chords: ['D', 'Gm', 'D'] },
  ],
});
