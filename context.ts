import { ErrorEntry, FolderEntry, StringEntry, shortenUrl } from "./deps.ts";
import { HookContext, HookData, HookHandler } from "./contract.ts";

export class HookCtx implements HookContext {

  cancelErr: ErrorEntry | null = null;
  cancelAsMalformed(message?: string): never {
    this.cancelErr = new ErrorEntry('Cancel',
      'hook-malformed', 'skyhook-tenant', message || 'Malformed');
    throw new Error(`Skyhook Cancel`);
  }
  cancelAsUnrecognizable(message?: string): never {
    this.cancelErr = new ErrorEntry('Cancel',
      'hook-unrecognizable', 'skyhook-tenant', message || 'Unrecognizable');
    throw new Error(`Skyhook Cancel`);
  }

  messages = new Array<{ channel: string; message: string }>();
  notify(channel: string, message: string) {
    this.messages.push({channel, message});
  }

  async process(handler: HookHandler, data: HookData) {
    try {
      await handler(this, data);
    } catch (err) {
      if (err?.message === 'Skyhook Cancel' && this.cancelErr) {
        return; // not actually an error, just an abort
      }
      throw err; // actual script crash
    }
  }

  toResultEntry() {
    if (this.cancelErr) return this.cancelErr;
    return new FolderEntry('Result', [
      new FolderEntry('Messages', this
        .messages.map((msg, idx) => new FolderEntry(`${idx+1}`, [
          new StringEntry('Channel', msg.channel),
          new StringEntry('Message', msg.message),
        ]))),
    ]);
  }

  shortenUrl(url: string) {
    return shortenUrl(url);
  }

  trimText(text: string, maxLen: number) {
    const cleaned = (text||'(n/a)').replace(/[\x00\x02\x03\x0F\x1F\x07\r]/g, '');
    const lines = cleaned.split('\n');
    const [firstLine] = lines;

    if (lines.length > 1 || cleaned.length > maxLen) {
      return firstLine.slice(0, maxLen-2)+'...';
    }
    return firstLine;
  }
}
