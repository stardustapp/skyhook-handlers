interface Message {
    AlarmName: string;
    AlarmDescription: string | null;
    AWSAccountId: string;
    NewStateValue: string;
    OldStateValue: string;
    NewStateReason: string;
    StateChangeTime: string;
    Region: string;
    Trigger: Trigger;
}

interface Trigger {
    MetricName: string;
    Namespace: string;
    Statistic: string;
    StatisticType: string;
    Dimensions: string;
    Period: number;
    Unit: string;
    EvaluationPeriods: number;
    Threshold: number;
    ComparisonOperator: string;
    TreatMissingData: string;
    EvaluateLowSampleCountPercentile: number;
}

import { HookContext, HookData } from '../contract.ts';
export async function processHook(
  ctx: HookContext,
  data: HookData<Record<string,string | undefined>>,
) {
  const channel = data.parameters.get('channel') || '#stardust-noise';

  const {Type, MessageId, TopicArn, Subject, Message, Timestamp} = data.payload;
  // also signature and unsub stuff
  switch (Type) {
    case 'SubscriptionConfirmation':
      ctx.notify(channel, `SNS Subscription, confirm here: ${data.payload.SubscribeURL}`);
      return;
    case 'Notification':
      break;
    default:
      ctx.notify(channel, `Received SNS '${Type}' from ${TopicArn}. "${Subject||''}"`);
      return;
  }
  console.log('cloudwatch SNS message body:', Message);

  const {
    AlarmName, AlarmDescription, Trigger,
    NewStateValue, NewStateReason, StateChangeTime, OldStateValue,
  } = JSON.parse(Message || '{}') as Message;

  // determine AWS IDs
  const regionId = TopicArn?.split(':')[3]; // "Region" is the pretty name :(
  const awsConsoleUrl = `https://console.aws.amazon.com/cloudwatch/home?region=${regionId}`;
  const alarmUrl = `${awsConsoleUrl}#alarm:alarmFilter=ANY;name=${encodeURIComponent(AlarmName)}`;

  // Color-code the status
  const stateColor = ({
    'ALARM': '\x0304', // red
    'OK': '\x0303', // green
  } as Record<string,string|undefined>)[NewStateValue];

  // Try making a shorter description
  var longDesc = "\x0314"+NewStateReason+"\x0F";
  // make sure there's nothing fancy going on, so we can handle it
  if (Trigger.EvaluationPeriods === 1 && Trigger.StatisticType === 'Statistic') {
    const comparisonSymbol = ({
      GreaterThanOrEqualToThreshold: '>=',
      GreaterThanThreshold: '>',
      LessThanOrEqualToThreshold: '<=',
      LessThanThreshold: '<',
    } as Record<string,string|undefined>)[Trigger.ComparisonOperator] || Trigger.ComparisonOperator;

    longDesc = `The ${Trigger.Statistic.toLowerCase()} of \`${Trigger.MetricName}\``;
    longDesc += ` over ${Math.round(Trigger.Period/60)} minutes`;
    // SNS msg doesn't include value field, so try to parse it
    const newValueMatch = NewStateReason.match(/ \[([0-9\-.]+) /)
    if (newValueMatch) {
      longDesc += ` was \`${+newValueMatch[1]}\`,`;
    }
    longDesc += ` alarms when \`${comparisonSymbol} ${Trigger.Threshold}\``;
  }

  ctx.notify(channel,
      "[\x0313aws\x0F/"+
      "\x0306"+regionId+"\x0F] "+
      stateColor+
        '\x02'+NewStateValue+'\x02: '+
        AlarmName+'\x0F '+
      '- '+longDesc+' '+
      "\x0302\x1F"+await ctx.shortenUrl(alarmUrl)+"\x0F"
      )
}
