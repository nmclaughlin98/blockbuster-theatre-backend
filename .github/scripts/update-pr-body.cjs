const fs = require('node:fs/promises');

const commitsMarker = 'pr-commits';
const dateMarker = 'pr-date';
const pageSize = 100;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatCommits(commits) {
  if (!commits.length) return '- No commits yet.';

  return commits.map((commit) => {
    const subject = commit.commit.message.split(/\r?\n/, 1)[0].trim() || '(empty commit message)';
    const safeSubject = escapeHtml(subject.replace(/`/g, "'"));
    return `- \`${commit.sha.slice(0, 7)}\` ${safeSubject}`;
  }).join('\n');
}

function replaceMarkedSection(body, markerName, content) {
  const startMarker = `<!-- ${markerName}:start -->`;
  const endMarker = `<!-- ${markerName}:end -->`;
  const startIndex = body.indexOf(startMarker);
  const endIndex = body.indexOf(endMarker);

  if (
    startIndex < 0
    || endIndex < startIndex + startMarker.length
    || body.indexOf(startMarker, startIndex + startMarker.length) >= 0
    || body.indexOf(endMarker, endIndex + endMarker.length) >= 0
  ) {
    return null;
  }

  return `${body.slice(0, startIndex + startMarker.length)}\n${content}\n${body.slice(endIndex)}`;
}

function buildPullRequestBody(body, commits, createdAt) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) throw new Error('Pull request creation date is invalid.');

  const withCommits = replaceMarkedSection(body, commitsMarker, formatCommits(commits));
  if (withCommits == null) return null;

  return replaceMarkedSection(withCommits, dateMarker, date.toISOString().slice(0, 10));
}

async function requestJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });
  const responseText = await response.text();
  let data = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      throw new Error(`GitHub returned invalid JSON (${response.status}).`, { cause: error });
    }
  }
  if (!response.ok) {
    throw new Error(data?.message || `GitHub API request failed (${response.status}).`);
  }
  return data;
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const token = process.env.GITHUB_TOKEN;
  if (!eventPath || !token) throw new Error('GitHub event path and token are required.');

  const event = JSON.parse(await fs.readFile(eventPath, 'utf8'));
  const pullRequest = event.pull_request;
  const repository = event.repository;
  if (!pullRequest || !repository?.owner?.login || !repository?.name) {
    throw new Error('This workflow requires a pull_request event.');
  }

  const apiUrl = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const repositoryPath = `${repository.owner.login}/${repository.name}`;
  const commits = [];
  let page = 1;

  while (true) {
    const pageCommits = await requestJson(
      `${apiUrl}/repos/${repositoryPath}/pulls/${pullRequest.number}/commits?per_page=${pageSize}&page=${page}`,
      token,
    );
    if (!Array.isArray(pageCommits)) throw new Error('GitHub returned an invalid pull request commit list.');
    commits.push(...pageCommits);
    if (pageCommits.length < pageSize) break;
    page += 1;
  }

  const body = pullRequest.body || '';
  const updatedBody = buildPullRequestBody(body, commits, pullRequest.created_at);
  if (updatedBody == null) {
    console.warn('PR body markers are missing or duplicated; generated sections were not updated.');
    return;
  }
  if (updatedBody === body) {
    console.log('Generated PR details are already up to date.');
    return;
  }

  await requestJson(`${apiUrl}/repos/${repositoryPath}/pulls/${pullRequest.number}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: updatedBody }),
  });
  console.log(`Updated generated details for PR #${pullRequest.number}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { buildPullRequestBody, formatCommits, replaceMarkedSection };
