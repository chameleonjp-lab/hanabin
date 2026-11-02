// Test-only boundary: public gameplay must never reach a live ranking service.
export async function installPublicSmokeNetworkGuard(context, baseURL) {
  const base = new URL(baseURL);
  const unexpected = [];
  const mockedRankingReads = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.origin === base.origin && url.pathname.startsWith(base.pathname) &&
        ['GET', 'HEAD'].includes(method)) {
      // Routing is not reapplied to redirect hops; do not follow them.
      const response = await route.fetch({maxRedirects: 0});
      if (response.status() >= 300 && response.status() < 400) {
        unexpected.push({method, pathname: url.pathname, reason: 'redirect'});
        return route.abort('blockedbyclient');
      }
      return route.fulfill({response});
    }
    // This read RPC is fulfilled locally, never forwarded, even on the public run.
    if (method === 'POST' && url.pathname === '/rest/v1/rpc/get_best_score_ranking') {
      mockedRankingReads.push(url.pathname);
      return route.fulfill({status: 200, contentType: 'application/json', body: '[]'});
    }
    unexpected.push({method, pathname: url.pathname});
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => {
    unexpected.push({method: 'WEBSOCKET', pathname: new URL(socket.url()).pathname});
    socket.close();
  });
  return {unexpected, mockedRankingReads};
}
