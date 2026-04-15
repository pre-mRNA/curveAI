import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, getUploadRequest, uploadPhotos, type UploadRequestSummary } from './api/client';
import { uploadBrand, uploadBrandStyle } from './brand';
import { PHOTO_UPLOAD_ACCEPT, isSupportedPhotoFile } from './lib/upload';

function maskToken(value: string) {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatExpiry(value: string | undefined) {
  if (!value) {
    return 'Expiry not available';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Expiry not available';
  }

  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

export default function UploadPage() {
  const { token = '' } = useParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadRequest, setUploadRequest] = useState<UploadRequestSummary | null>(null);
  const [loadingRequest, setLoadingRequest] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadButtonLabel = selectedFiles.length === 1 ? 'Upload 1 photo' : 'Upload photos';
  const uploadBlocked =
    loadingRequest ||
    error === 'This upload link has expired.' ||
    error === 'Missing upload token.' ||
    error === 'Unable to load upload request' ||
    Boolean(error?.startsWith('Upload request failed'));
  const expiryLabel = uploadRequest ? formatExpiry(uploadRequest.expiresAt) : '';
  const statusLabel =
    loadingRequest ? 'Checking link' : error ? 'Link needs attention' : uploadRequest?.status === 'completed' ? 'Upload finished' : 'Link active';

  useEffect(() => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      setPreviewUrls([]);
      return undefined;
    }

    const nextPreviews = selectedFiles.map((file) => URL.createObjectURL(file));
    setPreviewUrls(nextPreviews);

    return () => {
      if (typeof URL.revokeObjectURL === 'function') {
        nextPreviews.forEach((url) => URL.revokeObjectURL(url));
      }
    };
  }, [selectedFiles]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoadingRequest(true);
      setError(null);

      try {
        const nextRequest = await getUploadRequest(token);
        if (!active) {
          return;
        }
        setUploadRequest(nextRequest);
      } catch (requestError) {
        if (!active) {
          return;
        }
        if (requestError instanceof ApiError && requestError.status === 410) {
          setError('This upload link has expired.');
          return;
        }
        setError(requestError instanceof TypeError ? 'Unable to load upload request.' : 'Unable to load upload request');
      } finally {
        if (active) {
          setLoadingRequest(false);
        }
      }
    };

    if (!token) {
      setLoadingRequest(false);
      setError('Missing upload token.');
      return () => {
        active = false;
      };
    }

    void load();

    return () => {
      active = false;
    };
  }, [token]);

  const clearSelection = () => {
    setSelectedFiles([]);
    setMessage(null);
    if (error === 'Only image files are accepted.' || error === 'Choose at least one image.') {
      setError(null);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const onSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
    setMessage(null);
    setError(null);

    if (nextFiles.some((file) => !isSupportedPhotoFile(file))) {
      clearSelection();
      setError('Only image files are accepted.');
      return;
    }

    setSelectedFiles(nextFiles);
    event.currentTarget.value = '';
  };

  const onUpload = async () => {
    if (!selectedFiles.length) {
      setError('Choose at least one image.');
      return;
    }

    if (selectedFiles.some((file) => !isSupportedPhotoFile(file))) {
      setError('Only image files are accepted.');
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await uploadPhotos(token, selectedFiles);
      setMessage(`Uploaded ${result.uploaded} photo${result.uploaded === 1 ? '' : 's'} successfully.`);
      setUploadRequest((current) =>
        current
          ? {
              ...current,
              fileCount: current.fileCount + result.uploaded,
            }
          : current,
      );
      setSelectedFiles([]);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (uploadError) {
      setError(uploadError instanceof TypeError ? 'Upload failed. Check the connection and try again.' : uploadError instanceof Error ? uploadError.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-wrap" style={uploadBrandStyle}>
      <div className="container">
        <div className="card upload-card">
          <div className="card-inner">
            <div className="eyebrow">{uploadBrand.eyebrow}</div>
            <h1>Upload your site photos.</h1>
            <div className="meta-row">
              <span className="pill accent">Secure link <code>{token ? maskToken(token) : 'missing'}</code></span>
              {uploadRequest ? <span className="pill">{uploadRequest.fileCount} already uploaded</span> : null}
            </div>

            <div className="upload-summary-grid">
              <div className="summary-card">
                <span className="summary-label">Status</span>
                <strong>{statusLabel}</strong>
              </div>
              <div className="summary-card">
                <span className="summary-label">Expires</span>
                <strong>{expiryLabel || 'Checking…'}</strong>
              </div>
              <div className="summary-card">
                <span className="summary-label">Best to send</span>
                <strong>Wide shots and close-ups</strong>
              </div>
            </div>

            <div className="upload-panel">
              <div className="upload-panel-copy">
                <strong>Add photos from the job site</strong>
                <div className="muted">
                  {loadingRequest
                    ? 'Checking the upload link and loading job details.'
                    : 'PNG, JPG, JPEG, HEIC, HEIF, or WebP images only.'}
                </div>
                {!loadingRequest ? (
                  <div className="muted">Choose multiple photos at once, then tap upload when everything is ready.</div>
                ) : null}
              </div>

              {!loadingRequest ? (
                <ul className="tip-list compact">
                  <li>Show the full area first, then add the detail shots.</li>
                  <li>Include model labels, fittings, or damaged parts if they matter.</li>
                  <li>You can upload several images in one pass.</li>
                </ul>
              ) : null}

              <label className="field" htmlFor="upload-files">
                <span>Photo files</span>
                <input
                  ref={fileInputRef}
                  id="upload-files"
                  className="text-input"
                  type="file"
                  accept={PHOTO_UPLOAD_ACCEPT}
                  multiple
                  onChange={onSelect}
                  disabled={uploadBlocked}
                />
              </label>

              <div className="meta-row">
                <button
                  className="button"
                  type="button"
                  onClick={onUpload}
                  disabled={uploadBlocked || uploading || !selectedFiles.length}
                >
                  {uploading ? 'Uploading...' : uploadButtonLabel}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={clearSelection}
                  disabled={loadingRequest || uploading || !selectedFiles.length}
                >
                  Clear selection
                </button>
              </div>
            </div>

            <div className="selection-summary" aria-live="polite">
              <div className="selection-summary-head">
                <h2>Selected files</h2>
                <span className="pill">{selectedFiles.length} selected</span>
              </div>

              <div className="selection-list">
                {selectedFiles.length ? (
                  selectedFiles.map((file, index) => (
                    <div className="selection-item" key={`${file.name}-${file.size}-${file.lastModified}`}>
                      <div className="selection-item-main">
                        {previewUrls[index] ? <img className="selection-thumb" src={previewUrls[index]} alt="" /> : null}
                        <div className="selection-copy">
                          <strong>{file.name}</strong>
                          <span className="muted">{file.type || 'unknown type'}</span>
                        </div>
                      </div>
                      <span className="muted">{formatFileSize(file.size)}</span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <strong>No files selected yet.</strong>
                    <p className="muted">Choose one or more images to queue them for upload.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="upload-feedback" aria-live="polite">
              {message ? <p className="pill good">{message}</p> : null}
              {error ? <p className="pill warn">{error}</p> : null}
            </div>

            <div className="trust-note">
              <strong>What happens next</strong>
              <p className="muted">The photos attach to the tradie’s job card immediately after the upload completes.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
