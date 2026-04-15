import { useEffect, useState } from 'react';

import { apiClient } from './api/client';

export function ProtectedImage({
  photoId,
  adminToken,
  alt,
}: {
  photoId: string;
  adminToken: string;
  alt: string;
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    setResolvedUrl(null);
    setLoadFailed(false);

    void apiClient
      .fetchProtectedAsset(photoId, adminToken)
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
  }, [adminToken, photoId]);

  if (resolvedUrl) {
    return <img src={resolvedUrl} alt={alt} loading="lazy" />;
  }

  return <div className="photo-placeholder">{loadFailed ? 'Photo unavailable' : 'Loading photo…'}</div>;
}
