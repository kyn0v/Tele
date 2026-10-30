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
  title: '同一个 D，不同的回家路',
  description: '先听大四级的明亮，再听小四级的微妙转折。这是和声教学示例，不是任何歌曲的已核实原版。',
  groups: [
    { id: 'major', title: '大四级', description: 'D → G → D · 明亮、舒展地回到主和弦。', chords: ['D', 'G', 'D'] },
    { id: 'minor', title: '小四级', description: 'D → Gm → D · 只把 B 降为 B♭，听听色彩如何改变。', chords: ['D', 'Gm', 'D'] },
  ],
});
