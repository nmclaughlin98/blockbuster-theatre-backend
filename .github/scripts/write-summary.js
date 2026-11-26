const fs = require('node:fs');

const mode = process.argv[2]; // 'build' or 'deploy'
const completedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const jobStatus = process.env.JOB_STATUS;
const summaryFile = process.env.GITHUB_STEP_SUMMARY;

const lines = [];
let steps = [];

if (mode === 'build') {
    const branch = process.env.BUILD_BRANCH;
    const buildNumber = process.env.BUILD_NUMBER;

    lines.push(
        '### 🚀 Build Summary',
        `**Completed at:** \`${completedAt}\``,
        `**Status:** \`${jobStatus}\``,
        `**Branch:** \`${branch}\``,
        `**Build Number:** \`${buildNumber}\``,
        `**Artifact Name:** \`build-artifact-${buildNumber}\``,
    );

    steps = [
        ['Checkout Code', process.env.CHECKOUT_OUTCOME],
        ['Setup Node.js', process.env.SETUP_NODE_OUTCOME],
        ['Install Dependencies', process.env.INSTALL_DEPENDENCIES_OUTCOME],
        ['Check TypeScript Compilation', process.env.COMPILE_OUTCOME],
        ['Synthesize CDK App (dev)', process.env.SYNTHESIZE_DEV_OUTCOME],
        ['Synthesize CDK App (prod)', process.env.SYNTHESIZE_PROD_OUTCOME],
        ['Upload Build Artifact', process.env.UPLOAD_ARTIFACT_OUTCOME],
    ];

    console.log(`Build #${buildNumber} on ${branch}: ${jobStatus} at ${completedAt}`);
} else {
    const branch = process.env.DEPLOY_BRANCH;
    const deployEnv = process.env.DEPLOY_ENVIRONMENT;
    const deployStack = process.env.DEPLOY_STACK;
    const buildNumber = process.env.DEPLOY_BUILD_NUMBER;
    const buildRunId = process.env.DEPLOY_BUILD_RUN_ID;

    lines.push(
        '### 🚀 Deploy Summary',
        `**Completed at:** \`${completedAt}\``,
        `**Status:** \`${jobStatus}\``,
        `**Branch:** \`${branch}\``,
        `**Environment:** \`${deployEnv}\``,
        `**Stack:** \`${deployStack}\``,
        `**Build Number:** \`${buildNumber}\``,
    );

    if (buildRunId) {
        lines.push(`**Build Run ID:** \`${buildRunId}\``);
    }

    steps = [
        ['Checkout Repository', process.env.CHECKOUT_OUTCOME],
        ['Setup Node.js', process.env.SETUP_NODE_OUTCOME],
        ['Install Dependencies', process.env.INSTALL_DEPENDENCIES_OUTCOME],
        ['Download Deployment Assembly', process.env.DOWNLOAD_ASSEMBLY_OUTCOME],
        ['Validate Deployment Assembly', process.env.VALIDATE_ASSEMBLY_OUTCOME],
        ['Configure AWS Credentials', process.env.CONFIGURE_AWS_OUTCOME],
        ['Deploy CDK Stack', process.env.DEPLOY_CDK_OUTCOME],
    ];

    console.log(
        `Deploy of ${deployStack} (build #${buildNumber}) on ${branch}: ${jobStatus} at ${completedAt}`,
    );
}

if (jobStatus === 'failure') {
    lines.push('', '#### Failure Summary');
    const failed = steps.filter(([, outcome]) => outcome === 'failure');
    if (failed.length > 0) {
        for (const [name] of failed) {
            lines.push(`- ${name} failed.`);
        }
    } else {
        lines.push('- The job failed, but no individual step reported a failure.');
    }
}

if (summaryFile) {
    fs.appendFileSync(summaryFile, `${lines.join('\n')}\n`, 'utf8');
}
