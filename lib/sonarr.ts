import { filesize } from "../deps.ts";
import moment from 'https://cdn.skypack.dev/moment?dts';
import 'https://cdn.skypack.dev/moment-timezone';

interface Payload {
  episodes:     Episode[];
  release?:     Release;
  eventType:    string;
  series:       Series;
  episodeFile?: EpisodeFile;
  isUpgrade?:   boolean;
}

interface EpisodeFile {
  id:             number;
  relativePath:   string;
  path:           string;
  quality:        string;
  qualityVersion: number;
  releaseGroup:   string;
  sceneName:      string;
}

interface Episode {
  id:             number;
  episodeNumber:  number;
  seasonNumber:   number;
  title:          string;
  airDate?:       string;
  airDateUtc?:    string;
  quality?:       string;
  qualityVersion: number;
  releaseGroup?:  string;
  sceneName?:     string;
}

interface Release {
  quality:        string;
  qualityVersion: number;
  releaseGroup:   string;
  releaseTitle:   string;
  indexer:        string;
  size:           number;
}

interface Series {
  id:     number;
  title:  string;
  path:   string;
  tvdbId: number;
}


import { HookContext, HookData } from '../contract.ts';
export async function processHook(
  ctx: HookContext,
  data: HookData<Payload>,
) {
  const {eventType} = data.payload;

  const channel = data.parameters.get('channel') || '##danopia';
  const tz = data.parameters.get('viewer-timezone') || 'America/Los_Angeles';

  let output = '';
  switch (eventType) {

    case 'Download': {
      let {episodes, episodeFile, isUpgrade, series} = data.payload;
      let {releaseGroup, quality} = episodeFile!;

      let episodeNames = episodes
        .map(ep => `\x0315${ep.title}\x0F`)
        .join(` \x0314/\x0F `);

      let upgradeTag = '';
      if (isUpgrade) {
        upgradeTag = ` (\x0304upgrade!\x0F)`;
      }

      let groupField = '';
      if (releaseGroup) {
        groupField = `\x0314-\x0F \x0306${releaseGroup}\x0F `;
      }

      output = `${String.fromCodePoint(0x1F4E5)} \x1F${series.title}\x0F `+ // inbox emoji
          `${buildEpisodeString(episodes, true, tz)} `+
          groupField+
          `\x0314@\x0F \x0313${quality}\x0F${upgradeTag}: `+
          episodeNames.slice(0, 170);
      break;
    }

    case 'Grab': {
      let {episodes, release, series} = data.payload;
      let {quality, releaseGroup, releaseTitle, indexer, size} = release!;

      output = `${String.fromCodePoint(0x1F553)} \x1F${series.title}\x0F `+ // clock emoji
          `${buildEpisodeString(episodes, false, tz)} `+
          `\x0314-\x0F \x0313${filesize(size)}\x0F `+
          `\x0314@\x0F \x0315${indexer}\x0F`+
          `: \x0302${releaseTitle}\x0F`;
      break;
    }

    case 'Test':
      output = `Received Test notification. \x0303It worked!\x0F`;
      break;

    default:
      output = `Received unknown eventType ${eventType}`;
  }

  if (channel && output) {
    ctx.notify(channel, `[\x0307sonarr\x0F] `+output);
  }
  // if (channel === '##danopia' && eventType == 'Download' && output) {
  //   await notify('##purdue', output);
  // }

  //"\x0302\x1F"+shortenUrl(payload.build_url)+"\x0F");
}

// s02e04
// s02e04 / s02e04 / s02e04 / s02e04
function buildEpisodeString(episodes: Episode[], showAirTags: boolean, tz: string) {
  // single-season check
  const firstSeason = episodes[0].seasonNumber;
  if (episodes.every(ep => ep.seasonNumber === firstSeason)) {
    // width check
    if (episodes.length > 4) {
      // contiguous check
      var thisEpNum = episodes[0].episodeNumber;
      if (episodes.every(ep => thisEpNum++ == ep.episodeNumber)) {

        // it's def a big range, so let's short-circuit :D
        const firstEp = episodes[0];
        const lastEp = episodes.slice(-1)[0];
        var airTag = '';
        if (showAirTags && firstEp.airDateUtc && lastEp.airDateUtc) {
          airTag = ` \x0314[aired \x0315${formatAirDate(firstEp.airDateUtc, tz)} thru \x0315${formatAirDate(lastEp.airDateUtc, tz)}\x0314]`;
        }
        return `\x0303s${padNum(firstSeason, '\x0309')}\x0303e${padNum(firstEp.episodeNumber, '\x0309')}\x0303..e${padNum(lastEp.episodeNumber, '\x0309')}${airTag}\x0F`;
      }
    }

    // todo: be really smart here lol
  }

  return episodes
    .map(ep => {
      var airTag = '';
      if (showAirTags && episodes.length <= 4 && ep.airDateUtc) {
        airTag = ` \x0314[aired \x0315${formatAirDate(ep.airDateUtc, tz)}\x0314]`;
      }
      return `\x0303s${padNum(ep.seasonNumber, '\x0309')}\x0303e${padNum(ep.episodeNumber, '\x0309')}${airTag}\x0F`;
    }).join(` \x0314/\x0F `);
}

// s03e04, not s3e4
// pass a color code to put it before the first nonzero digit
function padNum(num: number, sep='') {
  if (num < 10) return '0'+sep+num;
  return sep+num;
}

// utc string => ircfragment. old dates are just date/time.
// as they're more recent, the output is more excited.
function formatAirDate(timestamp: string, tz: string) {
  const m = (moment(timestamp) as any).tz(tz) as moment.Moment;
  const fullFmt = (m.format('M/D/YY H:mm') as string).replace(':00', 'h');

  const oldCutoff = moment().subtract(1, 'month');
  const futureCutoff = moment().add(1, 'day');
  if (oldCutoff > m || futureCutoff < m) {
    return fullFmt;
  }

  const dayCutoff = moment().subtract(1, 'days');
  if (dayCutoff > m) {
    const daysAgo = moment().diff(m, 'days');
    return `${fullFmt} (~${daysAgo} days ago)`;
  }

  const hotCutoff = moment().subtract(2, 'hours');
  if (hotCutoff > m) {
    const hoursAgo = moment().diff(m, 'hours');
    return `\x02${hoursAgo} hours ago\x02 (${fullFmt})`;
  }

  // it's HOT!
  const hoursAgo = moment().diff(m, 'minutes');
  return `\x02${hoursAgo} minutes ago!\x02 (${fullFmt})`;
}
