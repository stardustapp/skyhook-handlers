import type * as EventPayloads from 'https://unpkg.com/@octokit/webhooks-types@3.73.1/schema.d.ts';
// https://github.com/octokit/webhooks/tree/master/payload-examples/api.github.com

import { HookContext, HookData, JSONValue } from 'https://crux.land/4BuXDK';
import { resolveFromCheckSuiteApiUrl } from './github-actions.ts';

import moment from 'https://cdn.skypack.dev/moment?dts';
import multimatch from 'https://cdn.skypack.dev/multimatch?dts';

const sleep = (ms: number) => new Promise(ok => setTimeout(ok, ms));

const orgChannelMap: Record<string,string | undefined> = {
  'stardustapp': '#stardust',
  'danopia': '#stardust',
  'relrod': '#dagd',
  'noexc': '#noexc',
};

const channelMessageCapMap: Record<string,number | undefined> = {
  '#hledger': 8,
  '#hledger-bots': 8,
  '#stardust': 5,
  '##danopia': 5,
};

const commitMsgLengthMap: Record<string,number | undefined> = {
  '#dagd': 200,
};

export async function processHook(
  ctx: HookContext,
  data: HookData<Record<string,JSONValue>>,
) {
  console.log('github webhook data:', JSON.stringify(data));
  const payload = data.payload as Record<string,JSONValue>;
  const pushPayload = data.payload as unknown as EventPayloads.PushEvent;

  const eventType = data.headers.get('X-GitHub-Event');
  const hookSource = pushPayload.repository
    ? pushPayload.repository.name
    : (pushPayload.organization || pushPayload.sender).login;

  var channel;
  var urlHandler = (url: string) => ctx.shortenUrl(url);
  var isBranchRelevant = (branch: string) => true;
  var isActionRelevant = (branch: string) => true;
  var hasBors = false;
  var isBors = (name: string) => false;

  if (pushPayload.organization) {
    channel = orgChannelMap[pushPayload.organization.login];
  }
  if (pushPayload.repository && pushPayload.repository.owner) {
    channel = orgChannelMap[pushPayload.repository.owner.login] || channel;
  }
  if (data.parameters) {
    channel = data.parameters.get('channel') || channel;

    if (data.parameters.get('longurl')) {
      urlHandler = async (url) => url;
    }

    // Globing for or against a set of patterns
    // Note that the glob engine supports ! so these are redundant.
    const branch_filter = data.parameters.get('branch_filter');
    const branch_ignore = data.parameters.get('branch_ignore');
    if (branch_filter) {
      const patterns = branch_filter.split(',');
      isBranchRelevant = (branch) => multimatch(branch, patterns).length > 0;
    }
    if (branch_ignore) {
      const patterns = branch_ignore.split(',');
      isBranchRelevant = (branch) => multimatch(branch, patterns).length == 0;
    }

    const action_filter = data.parameters.get('action_filter');
    const action_ignore = data.parameters.get('action_ignore');
    if (action_filter) {
      const patterns = action_filter.split(',');
      isActionRelevant = (action) => multimatch(action, patterns).length > 0;
    }
    if (action_ignore) {
      const patterns = action_ignore.split(',');
      isActionRelevant = (action) => multimatch(action, patterns).length == 0;
    }

    // Accept a bors username for special handling
    const bors = data.parameters.get("bors");
    if (bors) {
      hasBors = true;
      isBors = (name) => name.toLowerCase() == bors.toLowerCase();
    }
  }

  if (!channel) {
    return;
  }
  const maxCommits = channelMessageCapMap[channel] || 3;
  const commitMsgLength = commitMsgLengthMap[channel] || 70;

  if (eventType === 'push') {
    // code was pushed
    const payload = data.payload as EventPayloads.WebhookPayloadPush;

    const noun = (payload.commits.length == 1 ? 'commit' : 'commits');
    const branch = payload.ref.split('/').slice(2).join('/');
    var verb = 'pushed';
    if (payload.forced) {
      verb = '\x0304force-pushed\x0F';
    }

    // if we have a branch filter, let's check that FIRST
    if (!isBranchRelevant(branch)) {
      console.log('Ignoring irrelevant branch', branch);
      return;
    }

    // projects using bors don't normally care about push unless it's out-of-band to default
    if (hasBors && !(branch == payload.repository.default_branch && !isBors(payload.pusher.name))) {
      console.log('Ignoring non-default branch', branch, 'from', payload.pusher.name);
      return;
    }

    // are empty pushes even pushes at all?
    if (payload.commits.length === 0) {
      // branch deletion
      if (payload.deleted) {
        ctx.notify(channel,
            "[\x0313"+payload.repository.name+"\x0F] "+
            "\x0315"+payload.pusher.name+"\x0F "+
            '\x0305deleted\x0F '+
            "branch \x0306"+branch+"\x0F");
        return;

      // branch creation w/ no new commits
      } else if (payload.created) {
        // say what branch it's based off
        var suffix = '';
        if (payload.base_ref) {
          // whine a lil bit if github can do this
          if (payload.base_ref === payload.ref) {
            ctx.notify('#stardust', 'halp, i just got an empty github branch creation based on itself');
          }

          const baseBranch = payload.base_ref.split('/').slice(2).join('/');
          suffix = ` based on \x0306${baseBranch}\x0F`;
        }

        ctx.notify(channel,
            "[\x0313"+payload.repository.name+"\x0F] "+
            "\x0315"+payload.pusher.name+"\x0F "+
            '\x02created\x02 '+
            "branch \x0306"+branch+"\x0F"+suffix+": "+
            "\x0302\x1F"+await urlHandler(payload.compare)+"\x0F");
        return;

      // force-push without adding anything new
      } else if (payload.forced) {
        const [prevHash, newHash] = payload.compare.split('/').slice(-1)[0].split('...');
        ctx.notify(channel,
            "[\x0313"+payload.repository.name+"\x0F] "+
            "\x0315"+payload.pusher.name+"\x0F "+
            '\x0304force-reverted\x0F '+
            "\x0306"+branch+"\x0F "+
            "to \x0314"+newHash.slice(0, 7)+"\x0F "+
            "(was \x0314"+prevHash.slice(0, 7)+"\x0F)");
        return;
      }
    }

    // handle merges without listing the commits
    // (if we got this far, there are nonzero commits in the payload)
    if (payload.base_ref) {
      const baseBranch = payload.base_ref.split('/').slice(2).join('/');
      ctx.notify(channel,
          "[\x0313"+payload.repository.name+"\x0F] "+
          "\x0315"+payload.pusher.name+"\x0F "+
          "merged "+(payload.commits.length-1)+" "+
          (payload.commits.length == 2 ? 'commit' : 'commits')+" "+
          "from \x0306"+baseBranch+"\x0F "+
          "into \x0306"+branch+"\x0F: "+
          "\x0302\x1F"+await urlHandler(payload.compare)+"\x0F");
      return;
    }

    // bors pushes PRs into staging, let's make a nice message for it
    if (isBors(payload.pusher.name) /*&& branch === 'staging'*/ && payload.commits.length) {
      const lastCommit = payload.commits.slice(-1)[0];
      const mergeMatch = lastCommit.message.match(/^Merge #(\d+)\n\n\d+: (.+)/);
      if (isBors(lastCommit.committer.name) && mergeMatch) {
        // we definitely have bors staging a PR merge
        const pullNum = +mergeMatch[1];
        const pullUrl = payload.repository.html_url+'/pull/'+pullNum;

        ctx.notify(channel,
            "[\x0313"+payload.repository.name+"\x0F] "+
            "\x0315"+payload.pusher.name+"\x0F "+
            "merged "+(payload.commits.length-1)+" "+
            (payload.commits.length == 2 ? 'commit' : 'commits')+" "+
            "into \x0306"+branch+"\x0F "+
            "from PR \x02#"+pullNum+"\x02: "+
            ctx.trimText(mergeMatch[2], 140)+' '+
            "\x0302\x1F"+await urlHandler(pullUrl)+"\x0F");
        return;
      }
    }

    // new branches get commented on with a special header, even w/ one commit
    if (payload.created) {
      ctx.notify(channel,
          "[\x0313"+payload.repository.name+"\x0F] "+
          "\x0315"+payload.pusher.name+"\x0F "+
          "created \x0306"+branch+"\x0F "+
          "with \x02"+payload.commits.length+"\x02 "+
          "new "+noun+": "+
          "\x0302\x1F"+await urlHandler(payload.compare)+"\x0F");

    // shorthand for adding one commit to an existing branch
    } else if (payload.commits.length === 1) {
      const commit = payload.commits[0];

      // only include committer name if different than pusher
      var committerName = '';
      if (commit.committer.username != payload.pusher.name) {
        committerName = " \x0315"+commit.committer.name+"\x0F";
      }

      ctx.notify(channel,
          "[\x0313"+payload.repository.name+"\x0F] "+
          "\x0315"+payload.pusher.name+"\x0F "+
          verb+" "+
          "to \x0306"+branch+"\x0F: "+
          "\x0314"+commit.id.slice(0, 7)+"\x0F"+
          committerName+": "+
          ctx.trimText(commit.message, commitMsgLength)+"\x0F "+
          "\x0302\x1F"+await urlHandler(payload.compare)+"\x0F");

      // we already sent the commit. don't repeat ourselves.
      return;

    } else {
      // not a new branch, so let's send a normal push message
      ctx.notify(channel,
          "[\x0313"+payload.repository.name+"\x0F] "+
          "\x0315"+payload.pusher.name+"\x0F "+
          verb+" "+
          "\x02"+payload.commits.length+"\x02 "+
          'new '+noun+" "+
          "to \x0306"+branch+"\x0F: "+
          "\x0302\x1F"+await urlHandler(payload.compare)+"\x0F");
    }

    // if we haven't bailed yet, we still want to read out the first few commits
    for (const commit of payload.commits.slice(0, maxCommits)) {
      // only include committer name if different than pusher
      var committerName = '';
      if (commit.committer.username != payload.pusher.name) {
        committerName = " \x0315"+commit.committer.name+"\x0F";
      }

      await sleep(900);
      ctx.notify(channel,
          " \x0313"+payload.repository.name+"\x0F/"+
          "\x0306"+branch+"\x0F "+
          "\x0314"+commit.id.slice(0, 7)+"\x0F"+
          committerName+": "+
          ctx.trimText(commit.message, commitMsgLength));
    }
    return;
  } else

  if (eventType === 'issues') {
    const payload = data.payload as EventPayloads.WebhookPayloadIssues;

    const {action} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    // try being informative
    var interjection = '';
    switch (true) {

      case !!payload.changes:
        // <user> changed the body of issue #31...
        interjection = 'the ' +
          Object.keys(payload.changes!).join(', ') +
          ' of ';
        break;

      case !!payload.label:
        // <user> unlabeled help-wanted on issue #31...
        // <user> labeled help-wanted on issue #31...
        interjection = "\x0306"+payload.label!.name+"\x0F on ";
        break;

      case payload.action.includes('milestone') && !!payload.issue.milestone:
        // <user> [de]milestoned v1.0 on issue #31...
        interjection = "\x0306"+payload.issue.milestone!.title +"\x0F on ";
        break;
    }

    ctx.notify(channel,
        "[\x0313"+payload.repository.name+"\x0F] "+
        "\x0315"+payload.sender.login+"\x0F "+
        payload.action+" "+
        interjection+
        "issue \x02#"+payload.issue.number+"\x02: "+
        ctx.trimText(payload.issue.title, 70)+"\x0F "+
        "\x0302\x1F"+await urlHandler(payload.issue.html_url)+"\x0F");
    return;
  } else

  if (eventType === 'pull_request') {
    const payload = data.payload as EventPayloads.Pu;

    let {action, pull_request} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    // try being informative
    var interjection = '';
    var suffix = '';
    switch (true) {

      case !!payload.changes:
        // <user> changed the body of PR #31...
        interjection = 'the ' +
          Object.keys(payload.changes).join(', ') +
          ' of ';
        break;

      case action === 'synchronize':
        // drop when not verbose
        //if (verbosity < 4)
        return;
        // <user> synchronized fix-it for PR #31...
        // action = 'synchronized';
        // interjection = "\x0306"+pull_request.base.ref+"\x0F for ";
        // break;

      case action === 'opened':
        // <user> opened new PR #31 with 3 commits from feature-branch...
        interjection = "new ";
        const noun = (pull_request.commits == 1 ? 'commit' : 'commits');
        suffix = " with "+pull_request.commits+" "+noun+
            " from \x0306"+pull_request.head.label+"\x0F";
        break;

      case action === 'closed' && pull_request.merged:
        // <user> closed and merged PR #31 into master...
        interjection = "and merged ";
        suffix = " into \x0306"+pull_request.base.ref+"\x0F";
        break;

      case !!payload.label:
        // <user> unlabeled help-wanted on PR #31...
        // <user> labeled help-wanted on PR #31...
        interjection = "\x0306"+payload.label!.name+"\x0F on ";
        break;

      case payload.action.includes('milestone') && !!pull_request.milestone:
        // <user> [de]milestoned v1.0 on PR #31...
        interjection = "\x0306"+pull_request.milestone!.title +"\x0F on ";
        break;
    }

    ctx.notify(channel,
        "[\x0313"+payload.repository.name+"\x0F] "+
        "\x0315"+payload.sender.login+"\x0F "+
        action+" "+
        interjection+
        "PR \x02#"+pull_request.number+"\x02"+suffix+": "+
        ctx.trimText(pull_request.title, 70)+"\x0F "+
        "\x0302\x1F"+await urlHandler(pull_request.html_url)+"\x0F");
    return;

  } else

  if (eventType === 'milestone') {
    const payload = data.payload as EventPayloads.WebhookPayloadMilestone;

    const {milestone, action, sender, repository} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    ctx.notify(channel,
        "[\x0313"+repository.name+"\x0F] "+
        "\x0315"+sender.login+"\x0F "+
        action+" milestone "+
        "\x0306"+milestone.title +"\x0F, "+
        "due on \x02"+moment.utc(milestone.due_on).calendar()+"\x02: "+
        ctx.trimText(milestone.description, 140)+"\x0F "+
        "\x0302\x1F"+await urlHandler(milestone.html_url)+"\x0F");
    return;

  } else

  if (eventType === 'label') {
    const payload = data.payload as EventPayloads.WebhookPayloadLabel;

    const {label, action, sender, repository} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    // name changes are special
    if (payload.changes && payload.changes.name) {
      // <user> renamed label needs:one to needs:two
      ctx.notify(channel,
          "[\x0313"+repository.name+"\x0F] "+
          "\x0315"+sender.login+"\x0F "+
          "renamed label "+
          "\x0306"+payload.changes.name.from +"\x0F "+
          "to \x0306"+label.name +"\x0F");
      return;
    }

    // <user> created label needs:one
    ctx.notify(channel,
        "[\x0313"+repository.name+"\x0F] "+
        "\x0315"+sender.login+"\x0F "+
        action+" label "+
        "\x0306"+label.name +"\x0F");
    return;

  } else

  if (eventType === 'commit_comment') {
    const payload = data.payload as EventPayloads.WebhookPayloadCommitComment;

    const {action, repository, sender, comment} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    const subject = 'commit '+
      "\x0314"+comment.commit_id.slice(0, 7)+"\x0F";

    // special syntax: user commented on issue #423: body... <url>
    if (action === 'created') {
      ctx.notify(channel,
          "[\x0313"+repository.name+"\x0F] "+
          "\x0315"+sender.login+"\x0F "+
          "commented on "+subject+": "+
          ctx.trimText(comment.body, 140)+"\x0F "+
          "\x0302\x1F"+await urlHandler(comment.html_url)+"\x0F");
      return;
    }

    // basic syntax
    ctx.notify(channel,
        "[\x0313"+repository.name+"\x0F] "+
        "\x0315"+sender.login+"\x0F "+
        action+" a comment on "+subject+": "+
        "\x0302\x1F"+await urlHandler(comment.html_url)+"\x0F");
    return;

  } else

  if (eventType === 'issue_comment') {
    const payload = data.payload as EventPayloads.WebhookPayloadIssueComment;

    const {action, repository, sender, issue, comment} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    var type = 'issue';
    if (issue.pull_request) {
      type = 'PR';
    }

    // special syntax: user commented on issue #423: body... <url>
    if (action === 'created') {
      ctx.notify(channel,
          "[\x0313"+repository.name+"\x0F] "+
          "\x0315"+sender.login+"\x0F "+
          "commented on "+type+" \x02#"+issue.number+"\x02: "+
          ctx.trimText(comment.body, 140)+"\x0F "+
          "\x0302\x1F"+await urlHandler(comment.html_url)+"\x0F");
      return;
    }

    // basic syntax
    ctx.notify(channel,
        "[\x0313"+repository.name+"\x0F] "+
        "\x0315"+sender.login+"\x0F "+
        action+" a comment on "+type+" \x02#"+issue.number+"\x02: "+
        "\x0302\x1F"+await urlHandler(comment.html_url)+"\x0F");
    return;

  } else

  if (eventType === 'pull_request_review') {
    const payload = data.payload as EventPayloads.WebhookPayloadPullRequestReview;

    const {action, repository, sender, pull_request, review} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    // only handle 'submitted', no idea what else it could be
    if (action === 'submitted') {
      var reviewBody = '';
      if (review.body) {
        reviewBody = ": "+ctx.trimText(review.body ?? 'No text.', 140)+"\x0F";
      }
      ctx.notify(channel,
          "[\x0313"+repository.name+"\x0F] "+
          "\x0315"+sender.login+"\x0F "+
          "reviewed PR \x02#"+pull_request.number+"\x02 "+
          "and \x0306"+review.state+"\x0F"+reviewBody+" "+
          "\x0302\x1F"+await urlHandler(review.html_url)+"\x0F");
      return;
    }

  } else

  if (eventType === 'pull_request_review_comment') {
    const payload = data.payload as EventPayloads.WebhookPayloadPullRequestReviewComment;

    const {action, repository, sender, pull_request, comment} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    // special syntax: user commented on issue #423: body... <url>
    if (action === 'created') {
      ctx.notify(channel,
          "[\x0313"+repository.name+"\x0F] "+
          "\x0315"+sender.login+"\x0F "+
          "commented in a review of PR \x02#"+pull_request.number+"\x02 "+
          "at "+comment.path+": "+
          ctx.trimText(comment.body, 140)+"\x0F "+
          "\x0302\x1F"+await urlHandler(comment.html_url)+"\x0F");
      return;
    }

    // basic syntax
    ctx.notify(channel,
        "[\x0313"+repository.name+"\x0F] "+
        "\x0315"+sender.login+"\x0F "+
        action+" a comment on a review of PR \x02#"+pull_request.number+"\x02: "+
        "\x0302\x1F"+await urlHandler(comment.html_url)+"\x0F");
    return;

  } else

  if (eventType === 'gollum') {
    const payload = data.payload as EventPayloads.WebhookPayloadGollum;

    const {pages, repository, sender} = payload;
    const relPages = pages.filter(p =>
        isActionRelevant(p.action));

    var pageText = relPages.map(page => `${page.action} \x0306${page.page_name}\x0F`).join(', ');
    if (relPages.length === 0) {
      console.log('Ignoring irrelevant action', payload.pages[0].action);
      return;
    } else if (relPages.length === 1) {
      pageText += " \x0302\x1F"+await urlHandler(relPages[0].html_url)+"\x0F";
    } else {
      pageText += "\x0302\x1F"+await urlHandler(repository.url+'/wiki')+"\x0F";
    }

    ctx.notify(channel,
        "[\x0313"+repository.name+"\x0F] "+
        "\x0315"+sender.login+"\x0F changed the wiki: "+pageText);
    return;
  } else

  // TODO: what's appropriate here?
  if (eventType === 'check_run') {
    const payload = data.payload as EventPayloads.WebhookPayloadCheckRun;

    const {action, check_run, repository} = payload;
    const {id, node_id, external_id, head_sha, html_url, status, conclusion, started_at, completed_at, output, name, check_suite} = check_run;
    console.log('TODO: check_run', {action, id, head_sha, status, conclusion, name});
    return;
  } else

  if (eventType === 'check_suite') {
    const payload = data.payload as EventPayloads.WebhookPayloadCheckSuite;

    const {action, check_suite, repository} = payload;
    const {id, node_id, head_branch, head_sha, status, conclusion, url, before, after, pull_requests, app, created_at, updated_at, latest_check_runs_count, head_commit} = check_suite;
    // console.log('TODO: check_suite', {action, id, head_sha, head_branch, status, conclusion, latest_check_runs_count});

    if (app.slug !== 'github-actions') {
      console.log('TODO: ignoring github check_suite for non-Actions app:', app.slug, '-', app.name);
      return;
    }
    if (status !== 'completed') {
      console.log('ignoring github check_suite status', status);
      return;
    }

    let webUrl = repository.html_url + '/actions';
    let flowName = `Actions workflow`;

    if (repository.private === false) {
      // try {
        const actionsRun = await resolveFromCheckSuiteApiUrl(check_suite.url);

        if (actionsRun.conclusion === 'success' && actionsRun.event === 'schedule') {
          // Ignore successful crons
          return;
        }
        const workflow = await fetch(actionsRun.workflow_url).then(x => x.json());

        webUrl = actionsRun.html_url;
        flowName = `${workflow.name} #${actionsRun.run_number}`;

      // } catch (err) {
      //   throw new Error(`Failed to resolve check suite to github actions:`)
      // }
    }

    const totalSeconds = (new Date(updated_at).valueOf() - new Date(created_at).valueOf()) / 1000;
    const timePassed = totalSeconds > 90
      ? `${Math.floor(totalSeconds / 60)} min ${Math.floor(totalSeconds % 60)} sec`
      : `${Math.floor(totalSeconds)} seconds`;

    // some colors
    var stateFrag = conclusion;
    if (conclusion === 'failure') stateFrag = `\x0304${'failed'}\x0F`;
    else if (conclusion === 'success') stateFrag = `\x0303${'passed'}\x0F`;
    // else if (conclusion === 'action_required') stateFrag = `\x0315${conclusion}\x0F`;
    else stateFrag = `\`${conclusion}\``;

    ctx.notify(channel,
        "[\x0313"+repository.name+"\x0F] "+
        "\x0314"+head_sha.slice(0, 7)+"\x0F "+
        `${flowName} ${stateFrag} on \x0306${head_branch}\x0F after ${timePassed} `+
        `\x0302\x1F${await urlHandler(webUrl)}\x0F`);
    return;

  } else

  if (eventType === 'status' || eventType === 'deployment' || eventType === 'deployment_status' || eventType === 'page_build') {
    const payload = data.payload as EventPayloads.WebhookPayloadStatus | EventPayloads.WebhookPayloadDeployment | EventPayloads.WebhookPayloadDeploymentStatus | EventPayloads.WebhookPayloadPageBuild;

    const {repository} = payload;
    let commit: {sha: string};
    let state: string;
    let description: string | null;
    let target_url: string | null = null;
    let context: string;

    // adapt deployments to look like normal statuses
    if (eventType === 'status') {
      const status = payload as EventPayloads.WebhookPayloadStatus;
      state = status.state;
      commit = status.commit;
      context = status.context;
      target_url = status.target_url;
      description = status.description;
    } else
    if (eventType === 'deployment') {
      const {deployment} = payload as EventPayloads.WebhookPayloadDeployment;
      state = 'info';
      commit = deployment; // for sha
      context = 'deployment';
      description = deployment.task+' '+deployment.environment;
    } else
    if (eventType === 'deployment_status') {
      const {deployment, deployment_status} = payload as EventPayloads.WebhookPayloadDeploymentStatus;
      state = deployment_status.status;
      commit = deployment; // for sha
      context = 'deployment status';
      target_url = deployment_status.target_url;
      description = deployment.task+' '+deployment.environment;
    } else
    if (eventType === 'page_build') {
      const {build} = payload as EventPayloads.WebhookPayloadPageBuild;
      state = build.status;
      commit = {sha: build.commit};
      context = 'page';
      description = build.error.message;
      if (!description) {
        description = "took "+(Math.round(build.duration/1000*10)/10)+" seconds";
      }
    } else
    throw new Error(`unhandled event`);

    const ignoredStates = ['pending', 'success'];
    if (ignoredStates.includes(state)) {
      console.log('ignoring github commit status', state);
      return;
    }

    // bors doesn't specify a URL, among others
    var urlField = '';
    if (target_url) {
      urlField = " \x0302\x1F"+await urlHandler(target_url)+"\x0F";
    }

    // some colors
    let stateFrag = state;
    if (state === 'failure') stateFrag = `\x0304${state}\x0F`;
    if (state === 'success' ||
        state === 'built') stateFrag = `\x0303${state}\x0F`;
    if (state === 'pending') stateFrag = `\x0315${state}\x0F`;

    ctx.notify(channel,
        "[\x0313"+repository.name+"\x0F] "+
        "\x0314"+commit.sha.slice(0, 7)+"\x0F "+
        (context || 'build')+' '+
        stateFrag+": "+
        ctx.trimText(description ?? 'No description.', 140)+"\x0F"
        +urlField);
    return;

  } else

  if (eventType === 'watch') {
    const payload = data.payload as EventPayloads.WebhookPayloadWatch;

    if ('stars' in data.parameters) {
      console.log('Ignoring legacy star event due to "stars" param');
      return;
    }
    ctx.notify(channel,
        "[\x0313"+payload.repository.name+"\x0F] "+
        "\x0315"+payload.sender.login+"\x0F "+
        "starred the repository! ⭐ (PS: This is from a legacy webhook event. Please check 'star' instead of 'watch' in the webhook settings, or add '&stars' to the webhook URL if you use the 'Send me everything' setting.)");
    return;

  } else

  if (eventType === 'star') {
    const payload = data.payload as EventPayloads.WebhookPayloadStar;

    if (payload.action === 'created') {
      ctx.notify(channel,
          "[\x0313"+payload.repository.name+"\x0F] "+
          "\x0315"+payload.sender.login+"\x0F "+
          "starred the repository! ⭐");
    } else {
      ctx.notify(channel,
          "[\x0313"+payload.repository.name+"\x0F] "+
          "\x0315"+payload.sender.login+"\x0F "+
          payload.action+" their star of the repository.");
    }
    return;

  } else

  if (eventType === 'member') {
    const payload = data.payload as EventPayloads.WebhookPayloadMember;

    const {action} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    if (action === 'added') {
      ctx.notify(channel,
          "[\x0313"+payload.repository.name+"\x0F] "+
          "\x0315"+payload.member.login+"\x0F "+
          "is now a repository collaborator 👍");
    } else {
      ctx.notify(channel,
          "[\x0313"+payload.repository.name+"\x0F] "+
          "\x0315"+payload.member.login+"\x0F "+
          "was "+action+" as a collaborator");
    }
    return;

  } else

  if (eventType === 'fork') {
    const payload = data.payload as EventPayloads.WebhookPayloadFork;

    ctx.notify(channel,
        "[\x0313"+payload.repository.name+"\x0F] "+
        "\x0315"+payload.forkee.owner.login+"\x0F "+
        "created a fork @ "+
        "\x0313"+payload.forkee.full_name+"\x0F");
    return;

  } else

  if (eventType === 'create' || eventType === 'delete') {
    const payload = data.payload as EventPayloads.WebhookPayloadCreate | EventPayloads.WebhookPayloadDelete;

    const {ref, ref_type, repository, sender} = payload;

    // Ignore branch create/delete event since push handles it w/ more detail
    if (ref_type === 'branch') {
      console.log('Ignoring github', eventType, 'event for a branch');
      return;
    }

    // <user> <create/delete>d <tag> <v1>
    ctx.notify(channel,
        "[\x0313"+repository.name+"\x0F] "+
        "\x0315"+sender.login+"\x0F "+
        eventType+"d "+ref_type+" "+
        "\x0306"+ref+"\x0F");
    return;

  } else

  if (eventType === 'repository') {
    const payload = data.payload as EventPayloads.WebhookPayloadRepository;

    const {action, changes, repository, sender} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    let changesTxt = '';
    if (changes) {
      changesTxt = Object.keys(changes).map(x => '`'+x+'`').join(', ');
    }

    ctx.notify(channel,
        "[\x0313"+repository.name+"\x0F] "+
        "\x0315"+sender.login+"\x0F "+
        action+" the repository "+changesTxt);
    return;

  } else

  if (eventType === 'repository_vulnerability_alert') {
    const payload = data.payload as EventPayloads.WebhookPayloadRepositoryVulnerabilityAlert;

    const {action, repository, alert} = payload;
    if (action !== 'create') {
      console.log('Ignoring unrecognized action', action);
      return;
    }

    ctx.notify(channel,
        "[\x0313"+repository?.name+"\x0F] "+
        `\x02\x1F\x034/!\\\x0F `+
        "\x034Inbound Vulnerability Alert\x0F - "+
        "\x0311"+alert.affected_package_name+"\x0F "+
        "\x0313"+alert.affected_range+"\x0F subject to "+
        "\x0307"+alert.external_identifier+"\x0F - "+
        "\x0310fixed in \x0306"+alert.fixed_in+"\x0F "+
        "\x0302\x1F"+await urlHandler(alert.external_reference)+"\x0F");
    return;

  } else

  if (eventType === 'project_column') {
    const payload = data.payload as EventPayloads.WebhookPayloadProjectColumn;

    const {action, project_column} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    ctx.notify(channel,
        "[\x0313"+payload.repository.name+"\x0F] "+
        "\x0315"+payload.sender.login+"\x0F "+
        action+' '+
        "project column "+project_column.name);
    return;

  } else

  if (eventType === 'project_card') {
    const payload = data.payload as EventPayloads.WebhookPayloadProjectCard;

    const {action, project_card} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    ctx.notify(channel,
        "[\x0313"+payload.repository.name+"\x0F] "+
        "\x0315"+payload.sender.login+"\x0F "+
        action+' '+
        "project card: "+
        ctx.trimText(project_card.note, action == "created" ? 300 : 80));
    return;

  } else

  if (eventType === 'project') {
    const payload = data.payload as EventPayloads.WebhookPayloadProject;

    const {action, project} = payload;
    if (!isActionRelevant(action)) {
      console.log('Ignoring irrelevant action', action);
      return;
    }

    ctx.notify(channel,
        "[\x0313"+payload.repository.name+"\x0F] "+
        "\x0315"+payload.sender.login+"\x0F "+
        action+' '+
        "project "+
        project.name);
    return;

  } else

  if (eventType === 'ping') {
    const payload = data.payload as EventPayloads.WebhookPayloadPing;

    const pingUrl = payload.hook.type === 'Organization'
      ? `https://github.com/${payload.organization.login}`
      : payload.repository.html_url;
    ctx.notify(channel, "[\x0313"+hookSource+"\x0F] "+
        "This GitHub hook is working! Received a `ping` event. "+
        payload.zen + ' '+
        "\x0302\x1F"+await urlHandler(pingUrl)+"\x0F");
    return;

  } else

  if (eventType === 'meta') {
    const payload = data.payload as EventPayloads.WebhookPayloadMeta;

    ctx.notify(channel, "[\x0313"+hookSource+"\x0F] "+
        "Looks like this GitHub webhook was "+
        "\x0305"+payload.action+"\x0F");
    return;
  }

  const speciman = await storeSpeciman(`github/${eventType}`, data);

  console.log('got weird message', JSON.stringify(data));
  ctx.notify(channel, "[\x0313"+hookSource+"\x0F] "+
         "Got Github event of unhandled type: " + eventType);
  ctx.notify('#stardust-noise', `Got Github event for ${channel} of unhandled type "${eventType}": ${speciman}`);
}
