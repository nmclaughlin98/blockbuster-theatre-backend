const fs = require('node:fs/promises');

const commitsMarker = 'pr-commits';
const dateMarker = 'pr-date';
const summaryMarker = 'pr-summary';
const testingMarker = 'pr-testing';
const pageSize = 100;
const BUILD_COMMANDS = new Map([
    ['Check TypeScript Compilation', 'npm run build'],
    ['Synthesize CDK App (dev)', 'npx cdk synth -c env=dev --output cdk-out/dev'],
    ['Synthesize CDK App (prod)', 'npx cdk synth -c env=prod --output cdk-out/prod'],
]);

function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatCommits(commits) {
    if (!commits.length) return '- No commits yet.';

    return commits
        .map((commit) => {
            const subject = commit.commit.message.split(/\r?\n/, 1)[0].trim() || '(empty commit message)';
            const safeSubject = escapeHtml(subject.replace(/`/g, "'"));

            return `- \`${commit.sha.slice(0, 7)}\` ${safeSubject}`;
        })
        .join('\n');
}

function formatSummary(commits) {
    if (!commits.length) return '- No summary yet.';

    return commits
        .map((commit) => {
            const subject = commit.commit.message.split(/\r?\n/, 1)[0].trim() || '(empty commit message)';

            return `- ${escapeHtml(subject)}`;
        })
        .join('\n');
}

function formatTesting(jobs) {
    if (!jobs) return 'CI results will be updated when the build workflow completes.';

    const outcomes = new Map();

    for (const job of jobs) {
        for (const step of job.steps || []) {
            const command = BUILD_COMMANDS.get(step.name);

            if (command) outcomes.set(command, step.conclusion || step.status || 'unknown');
        }
    }

    if (!outcomes.size) return 'Build workflow results were unavailable.';

    const results = [
        ['npm test', outcomes.get('npm test') || 'not run in the build workflow'],
        ...outcomes,
    ];

    return results.map(([command, outcome]) => {
        const result = outcome === 'success' ? 'passed' : outcome;

        return `- \`${command}\` — ${escapeHtml(result)}`;
    }).join('\n');
}

function replaceMarkedSection(body, markerName, content) {
    const startMarker = `<!-- ${markerName}:start -->`;
    const endMarker = `<!-- ${markerName}:end -->`;
    const startIndex = body.indexOf(startMarker);
    const endIndex = body.indexOf(endMarker);

    if (
        startIndex < 0 ||
        endIndex < startIndex + startMarker.length ||
        body.indexOf(startMarker, startIndex + startMarker.length) >= 0 ||
        body.indexOf(endMarker, endIndex + endMarker.length) >= 0
    ) {
        return null;
    }

    return `${body.slice(0, startIndex + startMarker.length)}\n${content}\n${body.slice(endIndex)}`;
}

function buildPullRequestBody(body, commits, createdAt, jobs) {
    const date = new Date(createdAt);

    if (Number.isNaN(date.getTime())) throw new Error('Pull request creation date is invalid.');

    const dateStartMarker = `<!-- ${dateMarker}:start -->`;
    const dateStartIndex = body.indexOf(dateStartMarker);
    const dateHeading = [...body.slice(0, dateStartIndex).matchAll(/(?:^|\r?\n)## Date\r?\n/g)].at(-1);

    if (
        dateStartIndex < 0 ||
        !dateHeading ||
        body.indexOf(dateStartMarker, dateStartIndex + dateStartMarker.length) >= 0
    ) {
        return null;
    }

    const dateHeadingStart = dateHeading.index + (dateHeading[0].startsWith('\n') ? 1 : 0);
    const templateBody = body.slice(dateHeadingStart);
    const withDate = replaceMarkedSection(templateBody, dateMarker, date.toLocaleDateString('en-GB'));
    if (withDate == null) return null;

    const withCommits = replaceMarkedSection(withDate, commitsMarker, formatCommits(commits));
    if (withCommits == null) return null;

    const withSummary = replaceMarkedSection(withCommits, summaryMarker, formatSummary(commits));
    if (withSummary == null) return null;

    return replaceMarkedSection(withSummary, testingMarker, formatTesting(jobs));
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
    const repository = event.repository;
    let pullRequest = event.pull_request;
    let jobs;

    if (!repository?.owner?.login || !repository?.name) {
        throw new Error('GitHub repository details are missing from the event.');
    }

    const apiUrl = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
    const repositoryPath = `${repository.owner.login}/${repository.name}`;

    if (event.workflow_run) {
        const run = event.workflow_run;
        const associatedPullRequests = await requestJson(
            `${apiUrl}/repos/${repositoryPath}/commits/${run.head_sha}/pulls?per_page=${pageSize}`,
            token,
        );

        if (!Array.isArray(associatedPullRequests)) {
            throw new Error('GitHub returned an invalid pull request list for the build commit.');
        }

        pullRequest = associatedPullRequests.find(
            (candidate) => candidate.state === 'open' && candidate.head?.sha === run.head_sha,
        );

        if (!pullRequest) {
            console.log('No open pull request matches the completed build.');

            return;
        }

        const result = await requestJson(
            `${apiUrl}/repos/${repositoryPath}/actions/runs/${run.id}/jobs?per_page=${pageSize}`,
            token,
        );

        if (!Array.isArray(result?.jobs)) throw new Error('GitHub returned invalid build job results.');
        jobs = result.jobs;
    } else if (!pullRequest) {
        throw new Error('This workflow requires a pull_request or workflow_run event.');
    }

    const commits = [];
    let page = 1;

    while (true) {
        const pageCommits = await requestJson(
            `${apiUrl}/repos/${repositoryPath}/pulls/${pullRequest.number}/commits?per_page=${pageSize}&page=${page}`,
            token,
        );

        if (!Array.isArray(pageCommits))
            throw new Error('GitHub returned an invalid pull request commit list.');

        commits.push(...pageCommits);

        if (pageCommits.length < pageSize) break;

        page += 1;
    }

    const body = pullRequest.body || '';
    const updatedBody = buildPullRequestBody(body, commits, pullRequest.created_at, jobs);

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

module.exports = {
    buildPullRequestBody,
    formatCommits,
    formatSummary,
    formatTesting,
    replaceMarkedSection,
};
