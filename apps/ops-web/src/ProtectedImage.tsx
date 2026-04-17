import { useEffect, useRef, useState } from 'react';

import { createBlobPromiseCache } from '../../../packages/shared/src/blobPromiseCache';
import { apiClient } from './api/client';

const photoBlobCache = createBlobPromiseCache({ maxEntries: 24, ttlMs: 3 * 60 * 1000 });

function getPhotoBlob(photoId: string, adminToken: string) {
  return photoBlobCache.get(photoId, () => apiClient.fetchProtectedAsset(photoId, adminToken));
}

export function clearProtectedImageCache() {
  photoBlobCache.clear();
}

export function ProtectedImage({
  photoId,
  adminToken,
  alt,
  eager = false,
}: {
  photoId: string;
  adminToken: string;
  alt: string;
  eager?: boolean;
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(eager);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setShouldLoad(eager);
  }, [eager, photoId]);

  useEffect(() => {
    if (shouldLoad) {
      return undefined;
    }

    const node = containerRef.current;
    if (!node) {
      return undefined;
    }

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px 0px' },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [photoId, shouldLoad]);

  useEffect(() => {
    if (!shouldLoad) {
      setResolvedUrl(null);
      setLoadFailed(false);
      return undefined;
    }

    let active = true;
    let objectUrl: string | null = null;

    setResolvedUrl(null);
    setLoadFailed(false);

    void getPhotoBlob(photoId, adminToken)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (!active) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setResolvedUrl(objectUrl);
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [adminToken, photoId, shouldLoad]);

  if (resolvedUrl) {
    return <img src={resolvedUrl} alt={alt} loading="lazy" decoding="async" />;
  }

  return (
    <div ref={containerRef} className="photo-placeholder">
      {loadFailed ? 'Photo unavailable' : 'Loading photo…'}
    </div>
  );
}
