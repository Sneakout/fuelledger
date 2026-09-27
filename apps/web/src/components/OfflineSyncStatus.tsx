import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { getOfflineSyncSnapshot, retryOfflineRequests, subscribeOfflineSync, syncOfflineRequests } from '../lib/offline-sync';

export function OfflineSyncStatus({ demo = false }: { demo?: boolean }) {
  const state = useSyncExternalStore(subscribeOfflineSync, getOfflineSyncSnapshot, getOfflineSyncSnapshot);
  if (state.attention > 0)
    return <button className="status sync-status attention" onClick={() => void retryOfflineRequests()} title={`${state.lastError ?? 'A saved record needs attention.'} Click to retry.`}><TriangleAlert /> {state.attention} sync issue{state.attention === 1 ? '' : 's'}</button>;
  if (state.syncing)
    return <span className="status sync-status syncing"><RefreshCw /> Syncing {state.pending} saved record{state.pending === 1 ? '' : 's'}</span>;
  if (!state.online || state.pending > 0)
    return <button className="status sync-status offline" onClick={() => void syncOfflineRequests()} title="Records saved here will post automatically when the connection returns."><CloudOff /> Offline · {state.pending} saved</button>;
  return <span className="status"><i/> {demo ? 'Demo mode' : 'All records synced'}</span>;
}
