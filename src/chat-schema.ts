import { z } from 'zod';
import { BoardIdSchema } from './schema.js';

export const CHAT_LIMIT = 100;
export const CHAT_TEXT_LIMIT = 32_768;
export const CHAT_BYTES = 256 * 1024;
export const BindingSchema = z.uuid().brand<'ChatBinding'>();
const identity = z.uuid();
export const ChatItemSchema = z.strictObject({
  id: z.string().max(160),
  role: z.enum(['user', 'assistant', 'tool', 'notice']),
  text: z.string().max(CHAT_TEXT_LIMIT),
});
export const ChatViewSchema = z.strictObject({
  binding: BindingSchema,
  epoch: identity,
  boardId: BoardIdSchema,
  sequence: z.number().int().nonnegative(),
  idleVersion: z.number().int().nonnegative(),
  sessionLabel: z.string().max(160),
  phase: z.enum(['idle', 'submitted', 'busy', 'stopping', 'terminal-required', 'uncertain', 'disconnected']),
  runId: identity.nullable(),
  notice: z.string().max(400),
  submission: z.strictObject({ id: identity, state: z.enum(['submitted', 'observed', 'settled', 'unknown']) }).nullable(),
  items: z.array(ChatItemSchema).max(CHAT_LIMIT),
  truncated: z.boolean(),
});
export const ChatCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('send'), id: identity, epoch: identity, idleVersion: z.number().int().nonnegative(), text: z.string().min(1).max(8000).refine(text => text.trim().length > 0, 'Text is empty') }),
  z.strictObject({ kind: z.literal('abort'), id: identity, epoch: identity, runId: identity }),
]);
export const PairSchema = z.strictObject({ binding: BindingSchema, invitation: z.string().regex(/^[a-f0-9]{64}$/) });
export const ReceiptSchema = z.strictObject({ id: identity, status: z.enum(['submitted', 'stop-requested']) });
export type ChatItem = z.infer<typeof ChatItemSchema>;
export type ChatView = z.infer<typeof ChatViewSchema>;
export type ChatCommand = z.infer<typeof ChatCommandSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
export type Binding = z.infer<typeof BindingSchema>;
export interface ChatAdapter {
  snapshot(): ChatView;
  subscribe(listener: (view: ChatView) => void): () => void;
  submit(command: ChatCommand): Receipt;
}
