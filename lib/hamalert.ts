import { HookContext, HookData } from '../contract.ts';
export async function processHook(
  ctx: HookContext,
  data: HookData<Record<string,string | undefined>>,
) {

    const {
      fullCallsign,
      frequency,
      band,
      mode,
      modeDetail,
      speed,
      spotter,
      spotterContinent,
      snr,
      comment,
      source,
    } = data.payload;

  var channel = data.parameters.get('channel');
  if (!channel) {
    return;
  }

  let out: string = '';

  // source: e.g. [hamalert] or [hamalert/rbn]
  out += "[\x0307" + 'hamalert';
  if (source) {
    out += '/' + source;
  }
  out += "\x0F] ";
  out += "\x0306" + spotter + "\x0F ";
  if (spotterContinent) {
    out += "in \x0309" + spotterContinent + "\x0F ";
  }
  out += "spotted \x0305" + fullCallsign + "\x0F ";
  out += "using \x0302";
  if (speed) {
    out += speed + 'wpm ';
  }
  out += mode;
  if (modeDetail && modeDetail != mode) {
    out += ' (' + modeDetail + ')';
  }
  out += "\x0F ";
  out += "(\x0303" + band + ' @ ' + frequency + " MHz";
  if (snr) {
    out += ', ' + snr + 'dB';
  }
  out += "\x0F)";
  if (comment) {
    out += "\x0304" + comment + "\x0F";
  }

  ctx.notify(channel, out);
}
