import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ApiError, getUploadRequest, uploadPhotos, type UploadRequestSummary } from './api/client';
import { PHOTO_UPLOAD_ACCEPT, isSupportedPhotoFile } from './lib/upload';

function UploadLanding() {
  return (
    <div className="shell">
      <div className="container">
        <header className="hero hero--upload">
          <div className="hero-copy">
            <div className="eyebrow">Customer Upload</div>
            <h1>Send your job photos to the tradie.</h1>
            <p>
              Use the secure upload link from SMS to add site photos, damaged parts, or other job details from your
              phone.
            </p>
          </div>
          <div className="hero-card">
            <span className="pill accent">Mobile first</span>
            <strong>Fast image upload</strong>
            <p className="muted">The upload form is tuned for one-handed use, large tap targets, and multiple images.</p>
          </div>
        </header>

        <div className="card">
          <div className="card-inner">
            <h2>Open the tokenized upload path</h2>
            <p className="muted">
              The live upload experience runs at <code>/upload/:token</code>. Root access is only a landing page.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadPage() {
  const { token = '' } = useParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadRequest, setUploadRequest] = useState<UploadRequestSummary | null>(null);
  const [loadingRequest, setLoadingRequest] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
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
    <div className="upload-wrap">
      <div className="container">
        <div className="card upload-card">
          <div className="card-inner">
            <div className="eyebrow">Customer Upload</div>
            <h1>Send your photos to the tradie.</h1>
            <div className="meta-row">
              <span className="pill accent">Token <code>{token || 'missing'}</code></span>
              {uploadRequest ? <span className="pill">{uploadRequest.fileCount} already uploaded</span> : null}
            </div>
            {uploadRequest?.notes ? <p className="muted">{uploadRequest.notes}</p> : null}

            <div className="upload-panel">
              <div className="upload-panel-copy">
                <strong>Upload images from the job site</strong>
                <div className="muted">
                  {loadingRequest
                    ? 'Checking the upload link and loading job details.'
                    : 'PNG, JPG, JPEG, HEIC, HEIF, or WebP images only.'}
                </div>
                {!loadingRequest ? <div className="muted">Select multiple files at once, then tap upload when you are ready.</div> : null}
              </div>

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
                  selectedFiles.map((file) => (
                    <div className="selection-item" key={`${file.name}-${file.size}-${file.lastModified}`}>
                      <strong>{file.name}</strong>
                      <span className="muted">{file.type || 'unknown type'}</span>
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

            <p className="muted">The photos attach to the job card immediately after the upload completes.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<UploadLanding />} />
      <Route path="/upload/:token" element={<UploadPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
