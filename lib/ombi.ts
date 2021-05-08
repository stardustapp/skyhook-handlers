export interface Payload {
  requestId:             string;
  requestedUser:         string;
  title:                 string;
  requestedDate:         string;
  type:                  string;
  additionalInformation: null;
  longDate:              string;
  shortDate:             string;
  longTime:              string;
  shortTime:             string;
  overview:              string;
  year:                  string;
  episodesList:          string;
  seasonsList:           string;
  posterImage:           string;
  applicationName:       string;
  applicationUrl:        string;
  issueDescription:      string;
  issueCategory:         string;
  issueStatus:           string;
  issueSubject:          string;
  newIssueComment:       string;
  issueUser:             string;
  userName:              string;
  alias:                 string;
  userPreference:        string;
  denyReason:            null;
  availableDate:         string;
  notificationType:      string;
}

import { HookContext, HookData } from '../contract.ts';
export async function processHook(
  ctx: HookContext,
  data: HookData<Payload>,
) {
  const {notificationType} = data.payload;

  const channel = data.parameters.get('channel') || '##danopia';

  var output;
  switch (notificationType) {

    case 'NewRequest':
      var {requestedUser, title, type, year} = data.payload;
      switch (type) {

        case 'Movie':
          output = `New Request from \x0313${requestedUser.split('@')[0]}\x0F: `+
              `🎥 \x1F${title}\x0F ${year}`;
          break;

        default:
          // const speciman = await storeSpeciman(`ombi/${notificationType}`, data);
          output = `Received unknown media type ${notificationType}`;
      }
      break;

    case 'RequestApproved':
      var {requestedUser, title, type, year} = data.payload;
      switch (type) {

        case 'Movie':
          output = `Request from \x0313${requestedUser.split('@')[0]}\x0F is \x02Approved\x02: `+
              `🎥 \x1F${title}\x0F ${year}`;
          break;

        default:
          // const speciman = await storeSpeciman(`ombi/${notificationType}`, data);
          output = `Received unknown media type ${notificationType}`;
      }
      break;

    case 'RequestAvailable':
      var {requestedUser, title, type, year} = data.payload;
      switch (type) {

        case 'Movie':
          output = `Now Available: 🎥 \x1F${title}\x0F ${year} `+
          `\x0314- requested by\x0F \x0313${requestedUser.split('@')[0]}\x0F`;
          break;

        default:
          // const speciman = await storeSpeciman(`ombi/${notificationType}`, data);
          output = `Received unknown media type ${notificationType}`;
      }
      break;

    case 'Test':
      output = `Received Test notification. \x0303It worked!\x0F`;
      break;

    default:
      // const speciman = await storeSpeciman(`ombi/${notificationType}`, data);
      output = `Received unknown notificationType ${notificationType}`;
  }

  if (channel && output) {
    ctx.notify(channel, `[\x0307ombi\x0F] `+output);
  }
}
