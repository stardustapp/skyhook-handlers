import { HookContext, HookData } from '../contract.ts';
export async function processHook(
  ctx: HookContext,
  data: HookData<Record<string,string | undefined>>,
) {

  const {state, ruleName, message} = data.payload;

  var channel = data.parameters.get('channel');
  var instance = data.parameters.get('instance');
  if (!channel || !instance) {
    return;
  }

  let statusText: string | null = null;
  switch (state) {
    case 'ok':
      statusText = '\x0303\x02'+state+'\x0F';
      break;
    case 'pending':
      statusText = '\x0307\x02'+state+'\x0F';
      break;
    case 'alerting':
      statusText = '\x0305\x02'+state+'\x0F';
      break;
    case undefined:
      throw new Error('grafana body had undefined state');
    default:
      console.log('unhandled grafana state: '+state);
  }

  ctx.notify(
    channel,
    "[\x0307"+'grafana'+"\x0F/\x0306"+instance+"\x0F] "+
    "\x0313"+ruleName+"\x0F "+
    "is now "+statusText+
    `\x0314: ${message}\x0F`);
}
