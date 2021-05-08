import { filesize } from "../deps.ts";
import moment from 'https://cdn.skypack.dev/moment?dts';
import 'https://cdn.skypack.dev/moment-timezone';

interface Payload {
  movie:           Movie;
  remoteMovie:     RemoteMovie;
  release?:        Release;
  downloadClient?: string;
  downloadId:      string;
  eventType:       string;
  movieFile?:      MovieFile;
  isUpgrade?:      boolean;
}

export interface Movie {
  id:          number;
  title:       string;
  releaseDate: Date;
  folderPath:  string;
  tmdbId:      number;
  imdbId:      string;
}

export interface MovieFile {
  id:             number;
  relativePath:   string;
  path:           string;
  quality:        string;
  qualityVersion: number;
  size:           number;
  releaseGroup?:  string; // manual
}

export interface Release {
  quality:        string;
  qualityVersion: number;
  releaseTitle:   string;
  indexer:        string;
  size:           number;
  releaseGroup?:  string; // manual
}

export interface RemoteMovie {
  tmdbId: number;
  imdbId: string;
  title:  string;
  year:   number;
}

import { HookContext, HookData } from '../contract.ts';
export async function processHook(
  ctx: HookContext,
  data: HookData<Payload>,
) {
  const {eventType} = data.payload;

  const channel = data.parameters.get('channel') || '##danopia';
  const tz = data.parameters.get('viewer-timezone') || 'America/Los_Angeles';

  var output;
  switch (eventType) {

    case 'Download':
      var {movie, movieFile, remoteMovie, isUpgrade} = data.payload;
      var {releaseGroup, quality} = movieFile!;

      var upgradeTag = '';
      if (isUpgrade) {
        upgradeTag = ` (\x0304upgrade!\x0F)`;
      }

      var groupField = '';
      if (releaseGroup) {
        groupField = `\x0314-\x0F \x0306${releaseGroup}\x0F `;
      }

      output = `📥 \x1F${movie.title}\x0F ${remoteMovie.year} `+ // inbox emoji
          `\x0314[released \x0315${formatReleaseDate(movie.releaseDate, tz)}\x0314] `+
          groupField+
          `\x0314@\x0F \x0313${quality}\x0F${upgradeTag}`;
      break;

    case 'Grab':
      var {release, movie} = data.payload;
      var {quality, releaseGroup, releaseTitle, indexer, size} = release!;

      output = `🕓 \x1F${movie.title}\x0F `+ // clock emoji
          `\x0314-\x0F \x0313${filesize(size)}\x0F `+
          `\x0314@\x0F \x0315${indexer}\x0F`+
          `: \x0302${releaseTitle}\x0F`;
      break;

    case 'Test':
      output = `Received Test notification. \x0303It worked!\x0F`;
      break;

    default:
      output = `Received unknown eventType ${eventType}`;
  }

  if (channel && output) {
    ctx.notify(channel, `[\x0307radarr\x0F] `+output);
  }
}

// utc string => ircfragment. old dates are just date/time.
// as they're more recent, the output is more excited.
function formatReleaseDate(timestamp: Date, tz: string) {
  const m = (moment(timestamp) as any).tz(tz) as moment.Moment;
  const fullFmt = m.format('M/D/YY');

  const oldCutoff = moment().subtract(1, 'year');
  const futureCutoff = moment().add(1, 'day');
  if (oldCutoff > m || futureCutoff < m) {
    // movie is 6+ months old, or future
    return fullFmt;
  }

  const hotCutoff = moment().subtract(1, 'weeks');
  if (hotCutoff > m) {
    // movie is 0.5-6 months old
    const monthsAgo = moment().diff(m, 'months');
    return `${fullFmt} (~${monthsAgo} months ago)`;
  }

  // it's HOT!
  return `\x02this week!\x02 (${fullFmt})`;
}
