type PlayInboxReturn = (finish: () => void) => void;

const inboxReturns = new Map<string, PlayInboxReturn>();

export function registerNotificationInboxReturn(routeKey: string, play: PlayInboxReturn): () => void {
  inboxReturns.set(routeKey, play);
  return () => {
    if (inboxReturns.get(routeKey) === play) inboxReturns.delete(routeKey);
  };
}

export function playNotificationInboxReturn(routeKey: string, finish: () => void): void {
  const play = inboxReturns.get(routeKey);
  if (play) play(finish);
  else finish();
}
