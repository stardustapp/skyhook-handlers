import {
  FetchListener, PublicEnvironment,
  FunctionDevice,
} from "./deps.ts";

import * as handlers from './handlers.ts';
import { HookCtx } from "./context.ts";
import { HookHandler } from "./contract.ts";

PublicEnvironment.bind('/process%20hook', new FunctionDevice(async input => {
  if (input?.Type !== 'Folder') throw new Error('Need Folder input');

  const handlerId = input.getStringChild('Handler', true);
  const data = input.getChild('Hook', true, 'Folder');

  const handler = (handlers as Record<string, HookHandler>)[handlerId]
    ?? (ctx => ctx.cancelAsUnrecognizable(`Handler ${handlerId} is not available`));

  const ctx = new HookCtx();
  await ctx.process(handler, {
    sourceIp: data.getStringChild('Source IP', true),
    hookFlavor: data.getStringChild('Hook flavor', true),
    hookId: data.getStringChild('Hook ID', true),

    receivedAt: new Date(data.getStringChild('Received at', true)),
    headers: new Headers(data.getChild('Headers', true, 'Folder')
      .toDictionary(x => x.Type === 'String' ? x.StringValue : '')),
    parameters: new URLSearchParams(data.getChild('Parameters', true, 'Folder')
      .toDictionary(x => x.Type === 'String' ? x.StringValue : '')),

    // TODO: the raw is not actually raw for url-encoded and form submissions :/
    payload: JSON.parse(data.getStringChild('Payload', true)),
    payloadRaw: data.getStringChild('Payload', true),
    payloadType: data.getStringChild('Payload type', true),
  });

  return ctx.toResultEntry();
}));

addEventListener("fetch", FetchListener);
