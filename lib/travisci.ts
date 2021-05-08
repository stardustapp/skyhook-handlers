const orgChannelMap: Record<string,string|undefined> = {
  'stardustapp': '#stardust',
  'danopia': '#stardust',
  'relrod': '#dagd',
  'noexc': '#noexc',
}

interface Payload {
  repository?: {name: string; owner_name: string};
  status_message?: string;
  state?: string;
  result_message?: string;
  commit: string;
  number: string;
  duration: number;
  branch?: string;
  build_url: string;
}

import { HookContext, HookData } from '../contract.ts';
export async function processHook(
  ctx: HookContext,
  data: HookData<Payload>,
) {
  const {
    repository, commit, branch,
    status_message, state, result_message, number, duration, build_url,
  } = data.payload;

  var channel: string = '';
  if (repository?.owner_name) {
    channel = orgChannelMap[repository.owner_name] || channel;
  }
  channel = data.parameters.get('channel') || channel;

  if (!channel) {
    return;
  }

  // Color-code the status
  var text = status_message;
  console.log('travis hook with state', state,
      'smessage', status_message,
      'rmessage', result_message);
  switch (state) {
    case 'passed':
    case 'fixed':
      text = '\x0303'+text+'\x0F';
      break;
    case 'failed':
    case 'broken':
    case 'errored':
      text = '\x0305'+text+'\x0F';
      break;
    case 'started':
      text = '\x0307'+text+'\x0F';
      break;
    default:
      console.warn('WARN: travisci job did weird thing', state);
  }

  let timeText = '';
  if (state !== 'started') {
    timeText = " in "+(Math.round(duration/60*10)/10)+" minutes";
  }

  ctx.notify(channel,
      "[\x0313"+repository?.name+"\x0F] "+
      "\x0314"+commit.slice(0, 7)+"\x0F "+
      "Build #"+number+" "+
      text+" "+
      "on \x0306"+branch+"\x0F"+timeText+": "+
      "\x0302\x1F"+await ctx.shortenUrl(build_url)+"\x0F");
}
