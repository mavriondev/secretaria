import type { ConversationContext } from "./assistant";

/** Order and cancel work independently of unpredictable provider completion order. */
export class LiveTurns {
  current: { id: string; level: 0 | 1 | 2; training?: boolean; startedAt: number; bytes: number; controller: AbortController; committed: boolean } | null = null;
  readonly context: ConversationContext[] = [];
  private readonly seen = new Set<string>();

  begin(id: string, level: 0 | 1 | 2, training?: boolean) {
    if (this.seen.has(id)) throw new Error("Identificador de turno já utilizado.");
    if (this.seen.size >= 100) throw new Error("Limite de perguntas da sessão atingido.");
    this.cancel();
    this.seen.add(id);
    this.current = { id, level, ...(training === undefined ? {} : { training }), startedAt: Date.now(), bytes: 0, controller: new AbortController(), committed: false };
    return this.current;
  }
  isCurrent(id: string): boolean {
    return this.current?.id === id && !this.current.controller.signal.aborted;
  }
  cancel() { this.current?.controller.abort(); this.current = null; }
  remember(id: string, entry: ConversationContext) {
    if (!this.isCurrent(id)) return;
    this.context.push(entry);
    if (this.context.length > 4) this.context.shift();
  }
  clear() { this.cancel(); this.context.length = 0; this.seen.clear(); }
}
