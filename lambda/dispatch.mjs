const DISPATCH_URL = 'https://api.github.com/repos/andrewmacheret/canary/actions/workflows/daily.yml/dispatches';

// Starts daily.yml, which starts every repo's canary
export async function dispatch(token, fetchImpl = fetch) {
  const response = await fetchImpl(DISPATCH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'andrewmacheret-canary',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({ ref: 'master' }),
    signal: AbortSignal.timeout(10_000)
  });
  // GitHub answers 204 with no body when the run starts
  if (!response.ok) {
    throw new Error(`GitHub didn't start daily.yml: ${response.status} ${await response.text()}`);
  }
}
