# canary

[![Daily](https://github.com/andrewmacheret/canary/actions/workflows/daily.yml/badge.svg)](https://github.com/andrewmacheret/canary/actions/workflows/daily.yml) [![Test and deploy](https://github.com/andrewmacheret/canary/actions/workflows/deploy.yml/badge.svg)](https://github.com/andrewmacheret/canary/actions/workflows/deploy.yml) [![License](https://img.shields.io/badge/license-MIT-lightgray.svg)](https://github.com/andrewmacheret/canary/blob/master/LICENSE.md)

Daily health checks for my web projects and Lambdas. Each project has a `/healthcheck` URL that checks the project and the things it depends on, and says which one is broken. A failing check fails that project's Canary workflow, so GitHub emails me and the project's README badge turns red.

## How it works

1. Every day at 15:00 UTC, EventBridge Scheduler (`CanaryDaily`) runs the Lambda in `lambda/` (`CanaryDispatch`) in AWS. It starts `.github/workflows/daily.yml`.
2. `daily.yml` starts the `canary.yml` workflow in every repo listed in `repos.txt`. It also starts `homebrew-tap`'s `update.yml`, which points the tap at the latest releases.
3. Each repo's `canary.yml` calls `.github/workflows/healthcheck.yml` here with its health check URL.
4. `check.mjs` reads the health check and fails if anything in it is broken. It tries again after 30 seconds before failing, since cold Lambdas sometimes time out once.

None of these workflows has a GitHub `schedule` trigger, since GitHub turns those off in a public repo after 60 days without a commit. So nothing needs regular pushes.

If the Lambda fails, like when its token expired, or doesn't run for 26 hours, a CloudWatch alarm emails me through the SNS topic `CanaryAlerts`. That matters because GitHub only emails about runs that fail, not runs that never start.

This repo has to stay public, since public repos can't call a private repo's `healthcheck.yml`.

## Health checks

A Lambda's health check returns JSON, with HTTP 200 when everything works and 503 when something doesn't:

```json
{ "status": "ok", "checks": [{ "name": "NHL standings", "ok": true, "detail": "32 teams" }] }
```

A static site can't run code on S3, so its health check is a page at `www/healthcheck/index.html` that runs the checks in the browser with [`healthcheck.js`](https://github.com/andrewmacheret/andrewmacheret.com/blob/master/www/healthcheck.js) from andrewmacheret.com. `check.mjs` opens the page in headless Chrome and reads the result. See the top of `healthcheck.js` for the options, or [nhl-client's page](https://github.com/andrewmacheret/nhl-client/blob/master/www/healthcheck/index.html) for an example. Open any health check page in a browser to see the same results.

Health checks are public, so don't call third parties that limit how often you can call them. Report how the last scheduled run went instead.

To run one locally (static sites need Chrome):

```
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node check.mjs https://andrewmacheret.com/projects/nhl/healthcheck/
```

## Adding a project

1. Add a health check: a `/healthcheck` route for a Lambda, or `www/healthcheck/index.html` for a static site (`public/healthcheck/index.html` with Vite).
2. Copy `.github/workflows/canary.yml` from [nhl-client](https://github.com/andrewmacheret/nhl-client/blob/master/.github/workflows/canary.yml) and change the URL.
3. Add the Canary badge to the project's README, and add `.github/workflows/canary.yml` to its deploy workflow's `paths-ignore`.
4. Add the repo to `repos.txt`. `CANARY_TOKEN` already covers all my repos.

## Tokens

There are two GitHub tokens, since `GITHUB_TOKEN` can't start workflows in other repos. Both are fine-grained personal access tokens with "Actions: Read and write" permission. When one expires, the run it starts fails and I get an email.

- `CANARY_TOKEN`, a secret in this repo, lets `daily.yml` start every repo's canary. It covers all my repos. Replace it with `gh secret set CANARY_TOKEN --repo andrewmacheret/canary`.
- The Lambda's token only needs this repo. It's an SSM SecureString parameter, `/canary/github-token`, and only the Lambda's role can read it. Replace it without putting it in a command line or shell history by pasting it, then pressing Enter and Ctrl-D:

  ```
  aws ssm put-parameter --profile personal --region us-east-1 --name /canary/github-token \
    --type SecureString --overwrite --value file:///dev/stdin
  ```

## AWS

Made by hand once, in account `515875352897`, `us-east-1`. The deploy workflow only updates the Lambda's code and settings.

- Lambda `CanaryDispatch` (Node 24), role `CanaryDispatch`: reads `/canary/github-token` and writes to its log group `/aws/lambda/CanaryDispatch` (30 day retention).
- EventBridge Scheduler `CanaryDaily`, `cron(0 15 * * ? *)` in UTC. UTC since a Pacific time schedule has a 25 hour gap when daylight saving time ends, which would set off the "not running" alarm. Role `CanaryDispatchScheduler` can only invoke the Lambda.
- CloudWatch alarms `CanaryDispatchErrors` (any error in an hour) and `CanaryDispatchNotRunning` (no run in 26 hours), sending to SNS topic `CanaryAlerts`, which emails me.
- `GitHubDeployCanary` is the deploy role, which only this repo's `master` branch can assume, stored in the repo variable `AWS_ROLE_ARN`.
