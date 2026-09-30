/** Minimal Telegram Bot API client (idea gate, chores, digests, kill switch). */
import { htmlEscape } from './util.js';

export interface TgUser { id: number; username?: string; first_name?: string }
export interface TgMessage { message_id: number; chat: { id: number }; from?: TgUser; text?: string }
export interface TgCallback { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }
export type Buttons = { text: string; data: string }[][];

export class Telegram {
  private readonly base: string;

  constructor(token: string, private readonly chatId: string, private readonly allowedUserIds: Set<string>) {
    this.base = `https://api.telegram.org/bot${token}`;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): Telegram | undefined {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chat = env.TELEGRAM_CHAT_ID;
    if (!token || !chat) return undefined;
    const allowed = new Set((env.TELEGRAM_ALLOWED_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    return new Telegram(token, chat, allowed);
  }

  isAllowed(user: TgUser | undefined, chatId?: number): boolean {
    if (!user) return false;
    if (this.allowedUserIds.size) return this.allowedUserIds.has(String(user.id));
    // Without an explicit allow-list only the private chat with the configured person counts
    // (in a private chat the chat id is the user id); in a group, every member would pass.
    return String(chatId) === this.chatId && String(user.id) === this.chatId;
  }

  private async call<T>(method: string, body: Record<string, unknown>, timeoutMs = 20_000): Promise<T | undefined> {
    try {
      const res = await fetch(`${this.base}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
      if (!json.ok) {
        console.error(`[telegram] ${method} failed: ${json.description ?? res.status}`);
        return undefined;
      }
      return json.result;
    } catch (err) {
      console.error(`[telegram] ${method} error: ${(err as Error).message}`);
      return undefined;
    }
  }

  /** Send HTML text (caller escapes dynamic parts). Long texts are split. Returns the last message id. */
  async send(html: string, buttons?: Buttons): Promise<number | undefined> {
    const chunks: string[] = [];
    let rest = html;
    while (rest.length > 3900) {
      // Prefer a line break; otherwise a space outside a tag, so no chunk ends inside <b>…</b> or &amp;.
      let at = rest.lastIndexOf('\n', 3900);
      if (at < 1000) {
        at = 3900;
        while (at > 1000 && (rest[at] !== ' ' || rest.lastIndexOf('<', at) > rest.lastIndexOf('>', at))) at--;
        if (at <= 1000) at = 3900;
      }
      chunks.push(rest.slice(0, at));
      rest = rest.slice(at);
    }
    chunks.push(rest);
    let last: number | undefined;
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const markup = isLast && buttons ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {};
      let msg = await this.call<TgMessage>('sendMessage', { chat_id: this.chatId, text: chunks[i], parse_mode: 'HTML', disable_web_page_preview: true, ...markup });
      // If Telegram rejects the HTML (a broken tag or entity), still deliver the words.
      if (!msg) {
        const plain = chunks[i]!.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        msg = await this.call<TgMessage>('sendMessage', { chat_id: this.chatId, text: plain, disable_web_page_preview: true, ...markup });
      }
      last = msg?.message_id ?? last;
    }
    return last;
  }

  async sendPlain(text: string, buttons?: Buttons): Promise<number | undefined> {
    return this.send(htmlEscape(text), buttons);
  }

  async answerCallback(id: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
  }

  async clearButtons(messageId: number): Promise<void> {
    await this.call('editMessageReplyMarkup', { chat_id: this.chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  }

  /** Long-poll for updates. */
  async poll(offset: number, timeoutSec = 25): Promise<TgUpdate[]> {
    const updates = await this.call<TgUpdate[]>('getUpdates', { offset, timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] }, (timeoutSec + 10) * 1000);
    return updates ?? [];
  }

  async getMe(): Promise<TgUser | undefined> {
    return this.call<TgUser>('getMe', {});
  }
}
