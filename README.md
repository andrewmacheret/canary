# canary

[![Daily](https://github.com/andrewmacheret/canary/actions/workflows/daily.yml/badge.svg)](https://github.com/andrewmacheret/canary/actions/workflows/daily.yml) [![License](https://img.shields.io/badge/license-MIT-lightgray.svg)](https://github.com/andrewmacheret/canary/blob/master/LICENSE.md)

Daily health checks for my web projects and Lambdas. Each project has a `/healthcheck` URL that checks the project and the things it depends on, and says which one is broken. A failing check fails that project's Canary workflow, so GitHub emails me and the project's README badge turns red.

## How it works

1. `.github/workflows/daily.yml` runs every day at 15:00 UTC. It starts the `canary.yml` workflow in every repo listed in `repos.txt`.
2. Each repo's `canary.yml` calls `.github/workflows/healthcheck.yml` here with its health check URL.
3. `check.mjs` reads the health check and fails if anything in it is broken.

Each repo's `canary.yml` only has a `workflow_dispatch` trigger. GitHub turns off scheduled workflows in a public repo after 60 days without a commit, but that rule only covers schedules, so only `daily.yml` here needs commits. It fails with "Push to canary" if this repo goes 45 days without one. Workflows that make commits on their own to get around the rule break GitHub's terms, so a real push has to do it.

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

1. Add a health check: a `/healthcheck` route for a Lambda, or `www/healthcheck/index.html` for a static site.
2. Copy `.github/workflows/canary.yml` from [nhl-client](https://github.com/andrewmacheret/nhl-client/blob/master/.github/workflows/canary.yml) and change the URL.
3. Add the Canary badge to the project's README, and add `.github/workflows/canary.yml` to its deploy workflow's `paths-ignore`.
4. Add the repo to `repos.txt`, and give the `CANARY_TOKEN` token access to it.

## Token

`daily.yml` starts workflows in other repos, which `GITHUB_TOKEN` can't do. It uses `CANARY_TOKEN`, a fine-grained personal access token for the repos in `repos.txt` with "Actions: Read and write" permission. When it expires, `daily.yml` fails. Create a new one and store it with `gh secret set CANARY_TOKEN --repo andrewmacheret/canary`.
