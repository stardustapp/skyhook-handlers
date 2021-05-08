const accountChannelMap: Record<string,string|undefined> = {
  'Danopia': '##danopia',
}

import { HookContext, HookData } from '../contract.ts';
export async function processHook(
  ctx: HookContext,
  data: HookData<{
    account?: {
      name: string;
    };
    project: {
      name: string;
    };
    trigger: {
      type: string;
      message: string;
    };
    error: {
      exceptionClass: string;
      message: string;
      context: string;
      url: string;
    };
  }>,
) {
  const {account, project, trigger, error} = data.payload;

  var channel;
  if (account?.name) {
    channel = accountChannelMap[account.name] || channel;
  }
  channel = data.parameters.get('channel') || channel;
  if (!channel) {
    return;
  }

  const context = "[\x0313bugsnag\x0F/\x0306"+project.name+"\x0F] ";
  switch (trigger.type) {
    case 'firstException':
      ctx.notify(channel, context+
          trigger.message+" \x0314in "+error.context+"\x0F: "+
          error.exceptionClass.split('.').slice(-1)[0]+" "+error.message+" "+
          "\x0302\x1F"+await ctx.shortenUrl(error.url)+"\x0F");
      break;

    default:
      ctx.notify(channel, context+
          "\x0314"+trigger.type+"\x0F: "+trigger.message);
  }
}
