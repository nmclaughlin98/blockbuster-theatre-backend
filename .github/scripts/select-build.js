const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

function appendFile(filePath, content) {
    if (filePath) fs.appendFileSync(filePath, content, 'utf8');
}

function fail(message) {
    console.error(`Error: ${message}`);
    process.exit(1);
}

function ghApi(args) {
    const output = execFileSync('gh', ['api', ...args], {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
    });
    return output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

const RUN_SUMMARY_JQ = `.workflow_runs[] | {
  id,
  run_number,
  head_sha,
  head_branch,
  event,
  conclusion,
  repo_full_name: .head_repository.full_name
}`;

const env = process.env;
const eventName = env.GITHUB_EVENT_NAME;
const summaryFile = env.GITHUB_STEP_SUMMARY;
const outputFile = env.GITHUB_OUTPUT;

let buildRunId;
let targetBuild;
let targetBranch;
let buildSha;
let targetEnvironment;
let targetStack;

if (eventName === 'workflow_run') {
    buildRunId = env.TRIGGER_RUN_ID;
    targetBuild = env.TRIGGER_RUN_NUMBER;
    targetBranch = env.TRIGGER_HEAD_BRANCH;
    buildSha = env.TRIGGER_HEAD_SHA;

    if (targetBranch === 'main') {
        targetEnvironment = 'prod';
    } else if (targetBranch === 'dev') {
        targetEnvironment = 'dev';
    } else {
        fail('Only main and dev builds can be deployed.');
    }

    targetStack = 'backend';
} else {
    targetEnvironment = env.INPUT_TARGET_ENV || 'dev';

    if (targetEnvironment === 'auto') {
        if (env.GITHUB_REF === 'refs/heads/main') {
            targetEnvironment = 'prod';
        } else {
            targetEnvironment = 'dev';
        }
    }

    if (targetEnvironment !== 'prod' && targetEnvironment !== 'dev') {
        fail("Environment must be 'dev' or 'prod'.");
    }

    const allowNonMainProd = env.INPUT_ALLOW_NON_MAIN_PROD || 'false';
    if (allowNonMainProd !== 'true' && allowNonMainProd !== 'false') {
        fail('Production branch override must be true or false.');
    }

    const currentBranch = (env.GITHUB_REF || '').replace(/^refs\/heads\//, '');
    if (targetEnvironment === 'prod') {
        if (!(env.GITHUB_REF || '').startsWith('refs/heads/')) {
            fail('Production deployments must be triggered from a branch.');
        }
        if (allowNonMainProd === 'false' && env.GITHUB_REF !== 'refs/heads/main') {
            fail('Production deployments must be triggered from main.');
        }
    }

    const requestedBuild = env.INPUT_BUILD_NUMBER || 'latest';
    if (requestedBuild !== 'latest' && !/^[0-9]+$/.test(requestedBuild)) {
        fail("Build number must be numeric or 'latest'.");
    }

    const repo = env.GITHUB_REPOSITORY;
    const endpoint = `repos/${repo}/actions/workflows/build.yml/runs?per_page=100`;
    let selectedRun;

    if (targetEnvironment === 'prod') {
        const query = [`${endpoint}&event=push&status=success`];
        if (allowNonMainProd === 'false') {
            query.push('-f', 'branch=main');
        } else if (requestedBuild === 'latest') {
            query.push('-f', `branch=${currentBranch}`);
        }

        if (requestedBuild === 'latest') {
            const runs = ghApi(['-X', 'GET', ...query, '--jq', RUN_SUMMARY_JQ]);
            selectedRun = runs[0];
        } else {
            const runs = ghApi(['-X', 'GET', '--paginate', ...query, '--jq', RUN_SUMMARY_JQ]);
            selectedRun = runs.find((r) => String(r.run_number) === requestedBuild);
        }

        if (
            !selectedRun ||
            !selectedRun.head_branch ||
            selectedRun.event !== 'push' ||
            selectedRun.conclusion !== 'success' ||
            selectedRun.repo_full_name !== repo
        ) {
            fail('Production requires a successful push build from this repository.');
        }

        if (allowNonMainProd === 'false' && selectedRun.head_branch !== 'main') {
            fail('Production requires a main push build unless the override is enabled.');
        }

        if (
            allowNonMainProd === 'true' &&
            requestedBuild === 'latest' &&
            selectedRun.head_branch !== currentBranch
        ) {
            fail('The latest build must come from the selected branch.');
        }

        if (allowNonMainProd === 'true') {
            console.log('::warning::Production branch override enabled. Review the selected build before deploying.');
            appendFile(summaryFile, '**Warning:** Production branch override enabled.\n');
        }
    } else if (requestedBuild === 'latest') {
        const runs = ghApi([endpoint, '--jq', RUN_SUMMARY_JQ]);
        selectedRun = runs[0];
    } else {
        const runs = ghApi(['--paginate', endpoint, '--jq', RUN_SUMMARY_JQ]);
        selectedRun = runs.find((r) => String(r.run_number) === requestedBuild);
    }

    if (!selectedRun) {
        fail('No build found for the requested build number.');
    }

    buildRunId = String(selectedRun.id);
    targetBuild = String(selectedRun.run_number);
    buildSha = String(selectedRun.head_sha);
    targetBranch = String(selectedRun.head_branch);

    if (!/^[0-9]+$/.test(buildRunId) || !/^[0-9]+$/.test(targetBuild) || !/^[0-9a-f]{40}$/.test(buildSha)) {
        fail('No build found for the requested build number.');
    }

    targetStack = env.INPUT_TARGET_STACK || 'backend';
    if (targetStack !== 'backend' && targetStack !== 'auth') {
        fail("target_stack must be 'backend' or 'auth'.");
    }
}

appendFile(
    outputFile,
    [
        `build_number=${targetBuild}`,
        `build_run_id=${buildRunId}`,
        `deploy_environment=${targetEnvironment}`,
        `deploy_stack=${targetStack}`,
        `deploy_branch=${targetBranch}`,
        `build_sha=${buildSha}`,
        '',
    ].join('\n')
);

appendFile(
    summaryFile,
    [
        `## 🚀 Deploying Build #${targetBuild}`,
        `**Build Number:** \`${targetBuild}\``,
        `**Deployment Environment:** \`${targetEnvironment}\``,
        `**Deployment Stack:** \`${targetStack}\``,
        `**Build Branch:** \`${targetBranch}\``,
        `**Build Run ID:** \`${buildRunId}\``,
        '',
    ].join('\n')
);