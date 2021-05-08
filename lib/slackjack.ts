import { HookContext, HookData } from '../contract.ts';

export async function processHook(
  ctx: HookContext,
  data: HookData<Record<string, string | undefined>>,
) {

  const { channel, text, username, url } = data.payload;
  if (!channel || !text || !username) {
    ctx.cancelAsUnrecognizable();
  }

  let linesToSkip = 0;
  if (username === 'plexpy' || username === 'tautulli') {
    linesToSkip = 1;
  }
  const bodyText = text
    .replace(/\r/g, '')
    .split('\n')
    .slice(linesToSkip)
    .join(' - ');

  const urlSuffix = url
    ? `\x0F \x0302\x1F${await ctx.shortenUrl(url)}\x0F`
    : '';

  ctx.notify(channel,
    `[\x0307${username}\x0F] `+
    ctx.trimText(bodyText, 140)+
    urlSuffix);
};
