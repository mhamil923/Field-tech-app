// File: app/lib/uploadQueueRunner.js
//
// Drives the upload queue from app lifecycle + connectivity. Mount once, high in the
// tree (see app/_layout.tsx). Everything here is a TRIGGER — the actual attempt/
// success/delete rules live in uploadQueue.js.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { drainQueue, recoverCachedOrphans, migrateManifestPaths } from './uploadQueue';

export function useUploadQueueRunner() {
  useEffect(() => {
    let cancelled = false;
    const safeDrain = (force = false) => {
      if (cancelled) return;
      drainQueue({ force }).catch(() => {});
    };

    // 1. Repair any manifest paths left absolute by an earlier build — iOS gives the
    //    app a new container UUID on every update, which invalidates stored file://
    //    URIs while the files themselves move across intact. Must run BEFORE anything
    //    reads or uploads, or every entry looks missing.
    migrateManifestPaths()
      .catch(() => ({}))
      // 2. First launch after the failsafe update: sweep the OLD cacheDirectory for
      //    signed PDFs stranded by the pre-failsafe build.
      .then(() => recoverCachedOrphans().catch(() => []))
      .finally(() => safeDrain(false));

    // 2. App comes to the foreground.
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') safeDrain(false);
    });

    // 3. Connectivity regained — the trigger that matters after a job in a dead spot.
    let wasOnline = null;
    const netSub = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      if (online && wasOnline === false) safeDrain(true); // ignore backoff on regain
      wasOnline = online;
    });

    // 4. Slow heartbeat so a long-running session still drains without an event.
    const timer = setInterval(() => safeDrain(false), 5 * 60 * 1000);

    return () => {
      cancelled = true;
      appSub.remove();
      netSub();
      clearInterval(timer);
    };
  }, []);
}
