export type HookHandler = (ctx: HookContext, data: HookData<any>) => void | Promise<void>;

export interface HookContext {
  notify(channel: string, message: string): void;

  /** If the hook does't look anything like you expect,
   * mark it unrelated so it can proceed to the next script. */
  cancelAsUnrecognizable(message?: string): never;
  /** If the hook is from the right place, but has an incorrect detail
   * (bad signature, invalid field value) mark it as unprocessable.
   * This will not be automatically retried. */
  cancelAsMalformed(message?: string): never;

  // Nice lil helpers.
  shortenUrl(url: string): Promise<string>;
  trimText(text: string, maxLen: number): string;
}

export interface HookData<T=JSONValue> {
  sourceIp?: string;
  hookFlavor: string;
  hookId: string;

  receivedAt: Date;
  headers: Headers;
  parameters: URLSearchParams;

  payload: T;
  payloadRaw: string; // for signature verification
  payloadType: string;
}

// Structures that JSON can encode directly
export type JSONPrimitive = string | number | boolean | null | undefined;
export type JSONValue = JSONPrimitive | JSONObject | JSONArray;
export type JSONObject = {[key: string]: JSONValue};
export type JSONArray = JSONValue[];
