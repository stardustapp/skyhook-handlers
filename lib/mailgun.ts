import { filesize } from "https://cloudydeno.github.io/deno-bitesized/formatting/filesize@v1.ts";

import { HookContext, HookData } from '../contract.ts';
export async function processHook(
  ctx: HookContext,
  data: HookData<Record<string,string | undefined>>,
) {

  const {recipient, sender, from, timestamp} = data.payload;
  const subject = ctx.trimText(data.payload.subject || '(No subject)', 150);
  const body = data.payload['stripped-text'] || '(No body)';
  const origSender = data.payload.Sender || data.payload.sender;
  if (!origSender) ctx.cancelAsUnrecognizable('No "Sender" or "sender" field present');

  var channel;
  if (recipient?.startsWith('irc-freenode-')) {
    channel = '#' + recipient.split('@')[0].split('-').slice(2).join('-');
  }
  if (!channel) {
    return;
  }

  if (sender?.endsWith('@nds.fedex.com')) {
    const trackingMatch = body.match(/Tracking number\W+:(\d+)/);
    const updateMatch = body.match(/Activity\/Location\r\n  ([0-9\/]+ [0-9:]+ [ap]m)\W+([^\r\n]+)\r\n\W+([^\r\n]+)\r\n/);
    if (trackingMatch && updateMatch) {
      ctx.notify(channel,
        "[\x0313fedex\x0F/\x0306"+trackingMatch[1]+"\x0F] "+
             "\x02"+updateMatch[2]+"\x02 "+
             "near \x0306"+updateMatch[3]+"\x0F "+
             "\x0315(at "+updateMatch[1]+")\x0F");
      return;
    }
  }

  // Salesforce/AbuseHQ abuse complaints (sent by DigitalOcean)
  const doSubjectMatch = subject.match(/\[([^\]]+)\] Ticket (#[0-9]+: [^:]+)/);
  const doLinkMatch = body.match(/https:\/\/[^/]+.abusehq.net\/share\/.+/);
  if (doSubjectMatch && doLinkMatch) {
    ctx.notify(channel,
      "[\x0313abuse\x0F/\x0306"+doSubjectMatch[1]+"\x0F] "+
      doSubjectMatch[2]+" "+
      "\x0302\x1F"+doLinkMatch[0]+"\x0F");
    return;
  }

  let contents = body;
  const urlMatch = body.match(/^.+:\/\/.+$/m);
  if (urlMatch) {
    contents = urlMatch[0];
  }

  let trailer = '';
  let attachments = Object
    .keys(data.payload)
    .filter(x => (data.payload[x] as any).filename)
    .map(x => data.payload[x] as unknown as {filename: string, name: string, headers: [string,string][]})
    .map(x => {
      let str = `\x0315${x.filename||x.name}\x0314`;
      const sizeHeader = x.headers.find(y => y[0].toLowerCase() === 'content-length');
      if (sizeHeader && parseInt(sizeHeader[1]) > 0) {
        str += ` (${filesize(parseInt(sizeHeader[1]))})`;
      }
      return str;
    });
  if (attachments.length > 0) {
    const attachS = attachments.length > 1 ? 's' : '';
    trailer += ` \x0314/ \x02${attachments.length}\x02 attachment${attachS}: ${attachments.join(', ')}`;
  }

  ctx.notify(channel,
    "[\x0313email\x0F/\x0306"+origSender+"\x0F] "+
    ctx.trimText(subject, 150)+" \x0315/ "+ctx.trimText(contents, 150)+trailer+"\x0F");
}
