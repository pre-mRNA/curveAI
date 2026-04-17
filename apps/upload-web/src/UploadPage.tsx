import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PublicActionCard, PublicFactStrip, PublicMiniSteps, PublicSidePanel } from '../../../packages/shared/src/publicShell';
import { ApiError, getUploadRequest, uploadPhotos, type UploadRequestSummary } from './api/client';
import { uploadBrand, uploadBrandStyle } from './brand';
import { PHOTO_UPLOAD_ACCEPT, isSupportedPhotoFile } from './lib/upload';

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

function requesterLabel(uploadRequest: UploadRequestSummary | null) {
  return uploadRequest?.businessName || uploadRequest?.requestedBy || 'your tradie';
}

const GENERIC_JOB_SUMMARIES = new Set(['customer photo upload requested.', 'photo upload requested from voice tooling.']);

function jobLabel(uploadRequest: UploadRequestSummary | null) {
  const summary = uploadRequest?.jobSummary?.trim();
  const note = uploadRequest?.requestNote?.trim();
  if (summary && summary.toLowerCase() !== note?.toLowerCase() && !GENERIC_JOB_SUMMARIES.has(summary.toLowerCase())) {
    return summary;
  }
  return uploadRequest?.siteLabel || 'the job';
}

type UploadPageState = 'loading' | 'ready' | 'completed' | 'missing' | 'expired' | 'error';

function SelectionPreview({ file, eager = false }: { file: File; eager?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [shouldLoad, setShouldLoad] = useState(eager);

  useEffect(() => {
    setShouldLoad(eager);
  }, [eager, file]);

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
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      setPreviewUrl(null);
      return undefined;
    }

    const nextUrl = URL.createObjectURL(file);
    setPreviewUrl(nextUrl);

    return () => {
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(nextUrl);
      }
    };
  }, [file, shouldLoad]);

  return (
    <div ref={containerRef} className="selection-thumb-wrap" aria-hidden="true">
      {previewUrl ? <img className="selection-thumb" src={previewUrl} alt="" /> : <div className="selection-thumb placeholder" />}
    </div>
  );
}

export default function UploadPage() {
  const { token = '' } = useParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadRequest, setUploadRequest] = useState<UploadRequestSummary | null>(null);
  const [pageState, setPageState] = useState<UploadPageState>('loading');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadButtonLabel = selectedFiles.length === 1 ? 'Upload 1 photo' : 'Upload photos';
  const loadingRequest = pageState === 'loading';
  const uploadBlocked = pageState !== 'ready';
  const showRecoveryState = pageState === 'missing' || pageState === 'expired' || pageState === 'error';
  const showCompletedState = pageState === 'completed';
  const showReadyState = pageState === 'ready';
  const expiryLabel = uploadRequest ? formatExpiry(uploadRequest.expiresAt) : '';
  const requester = requesterLabel(uploadRequest);
  const job = jobLabel(uploadRequest);

  useEffect(() => {
    let active = true;
    setUploadRequest(null);
    setSelectedFiles([]);
    setMessage(null);
    setUploading(false);

    const load = async () => {
      setPageState('loading');
      setError(null);

      try {
        const nextRequest = await getUploadRequest(token);
        if (!active) {
          return;
        }
        setUploadRequest(nextRequest);
        setPageState(nextRequest.status === 'completed' ? 'completed' : 'ready');
      } catch (requestError) {
        if (!active) {
          return;
        }
        if (requestError instanceof ApiError && requestError.status === 410) {
          setPageState('expired');
          setError('This link has expired.');
          return;
        }
        if (requestError instanceof ApiError && requestError.status === 404) {
          setPageState('missing');
          setError('This link is missing.');
          return;
        }
        setPageState('error');
        setError(requestError instanceof TypeError ? 'We could not open this link.' : 'We could not open this link.');
      }
    };

    if (!token) {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setPageState('missing');
      setError('This link is missing.');
      return () => {
        active = false;
      };
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    void load();

    return () => {
      active = false;
    };
  }, [token]);

  const clearSelection = () => {
    setSelectedFiles([]);
    setMessage(null);
    if (error === 'Only photo files are allowed.' || error === 'Pick at least one photo.') {
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

    const validFiles = nextFiles.filter((file) => isSupportedPhotoFile(file));
    const skippedFiles = nextFiles.length - validFiles.length;

    if (!validFiles.length && skippedFiles > 0) {
      clearSelection();
      setError('Only photo files are allowed.');
      return;
    }

    if (skippedFiles > 0) {
      setError(`Skipped ${skippedFiles} file${skippedFiles === 1 ? '' : 's'}. Only photo files are allowed.`);
    }

    setSelectedFiles(validFiles);
    event.currentTarget.value = '';
  };

  const onUpload = async () => {
    if (!selectedFiles.length) {
      setError('Pick at least one photo.');
      return;
    }

    if (selectedFiles.some((file) => !isSupportedPhotoFile(file))) {
      setError('Only photo files are allowed.');
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await uploadPhotos(token, selectedFiles);
      setMessage(`Sent ${result.uploaded} photo${result.uploaded === 1 ? '' : 's'}. You can close this page.`);
      setUploadRequest(result.upload);
      setPageState(result.upload.status === 'completed' ? 'completed' : 'ready');
      setSelectedFiles([]);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof TypeError
          ? 'Upload failed. Check your signal and try again.'
          : uploadError instanceof Error
            ? uploadError.message
            : 'Upload failed.',
      );
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
            <h1>
              {showRecoveryState
                ? 'We could not open this photo link.'
                : showCompletedState
                  ? 'Photos sent.'
                  : `Send photos to ${requesterLabel(uploadRequest)}.`}
            </h1>
            <p className="muted upload-intro">
              {showRecoveryState
                ? 'Ask the person who sent it to text you a new link.'
                : showCompletedState
                  ? 'The photos have gone through.'
                  : `These photos help with ${jobLabel(uploadRequest)}. A few clear shots now helps ${requesterLabel(uploadRequest)} quote it or turn up ready.`}
            </p>
            <div className="meta-row">
              <span className="pill accent">Photo link</span>
              {!showRecoveryState && !showCompletedState ? <span className="pill">Under 2 minutes</span> : null}
              {uploadRequest ? <span className="pill">{uploadRequest.fileCount} sent already</span> : null}
            </div>

            {uploadRequest ? (
              <PublicFactStrip
                className="upload-route-facts"
                facts={[
                  { label: 'Requested by', value: requester },
                  { label: 'For this job', value: job },
                  {
                    label: uploadRequest.status === 'completed' ? 'Status' : 'Link status',
                    value: uploadRequest.status === 'completed' ? 'Done' : expiryLabel,
                    tone: uploadRequest.status === 'completed' ? 'good' : 'accent',
                  },
                ]}
              />
            ) : null}

            <div className="upload-route-grid">
              <div className="upload-route-main">
                {showReadyState || loadingRequest ? (
                  <PublicActionCard
                    eyebrow="Send photos"
                    title="Pick the photos you want to send"
                    description={loadingRequest ? 'Checking your link.' : 'Pick one or more photos, check them below, then send them together.'}
                    className="upload-panel"
                  >
                    {!loadingRequest ? (
                      <PublicMiniSteps
                        steps={[
                          { id: 'pick', title: 'Pick photos', detail: 'Use your library or take new ones.' },
                          { id: 'check', title: 'Check them', detail: 'Make sure the problem is easy to see.' },
                          { id: 'send', title: 'Send them', detail: 'They go straight onto this job.' },
                        ]}
                      />
                    ) : null}

                    <label className="field upload-dropzone" htmlFor="upload-files">
                      <span>Choose photos</span>
                      <input
                        ref={fileInputRef}
                        id="upload-files"
                        className="text-input upload-file-input"
                        type="file"
                        accept={PHOTO_UPLOAD_ACCEPT}
                        multiple
                        onChange={onSelect}
                        disabled={uploadBlocked}
                      />
                      {!loadingRequest ? <span className="muted">Tap here to open your photo library or take new photos.</span> : null}
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
                  </PublicActionCard>
                ) : null}

                {showCompletedState ? (
                  <PublicActionCard
                    eyebrow="Done"
                    title="Photos sent"
                    description="The photos have been sent. You can close this page now."
                    className="upload-panel"
                  >
                    <ul className="tip-list compact">
                      <li>{requester} can review these photos now.</li>
                      <li>If they need more, they can text you another link.</li>
                    </ul>
                  </PublicActionCard>
                ) : null}

                {showRecoveryState ? (
                  <PublicActionCard
                    eyebrow="Need a new link"
                    title="This photo link is not working"
                    description={
                      pageState === 'expired'
                        ? 'This link has expired.'
                        : pageState === 'missing'
                          ? 'This link is missing.'
                          : 'We could not open this link.'
                    }
                    className="upload-panel"
                  >
                    <p className="muted">Ask your tradie or office to text you a new photo link.</p>
                    <ul className="tip-list compact">
                      <li>Open the newest text they sent you.</li>
                      <li>If it still fails, ask them to resend the link.</li>
                    </ul>
                  </PublicActionCard>
                ) : null}

                {selectedFiles.length ? (
                  <div className="selection-summary" aria-live="polite">
                    <div className="selection-summary-head">
                      <h2>Ready to send</h2>
                      <span className="pill">{selectedFiles.length} picked</span>
                    </div>

                    <div className="selection-list">
                      {selectedFiles.map((file, index) => (
                        <div className="selection-item" key={`${file.name}-${file.size}-${file.lastModified}`}>
                          <div className="selection-item-main">
                            <SelectionPreview file={file} eager={index < 4} />
                            <div className="selection-copy">
                              <strong>{file.name}</strong>
                              <span className="muted">{file.type || 'unknown type'}</span>
                            </div>
                          </div>
                          <span className="muted">{formatFileSize(file.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="upload-feedback" aria-live="polite">
                  {message ? <p className="pill good">{message}</p> : null}
                  {error && !showRecoveryState ? <p className="pill warn">{error}</p> : null}
                </div>
              </div>

              <aside className="upload-route-side">
                {uploadRequest?.requestNote ? (
                  <PublicSidePanel eyebrow="Best photos to send" title="Show the right parts">
                    <p>{uploadRequest.requestNote}</p>
                  </PublicSidePanel>
                ) : null}

                <PublicSidePanel eyebrow="What helps most" title="Keep it simple">
                  <ul className="tip-list compact">
                    <li>Start with one wide photo of the whole area.</li>
                    <li>Then add close-ups of the leak, damage, label, or blocked part.</li>
                    <li>Use good light if you can.</li>
                  </ul>
                </PublicSidePanel>

                <PublicSidePanel eyebrow="What happens next" title="After you send them">
                  <p className="muted">These photos are attached to this job so the team can review them fast.</p>
                  <p className="muted">
                    {showRecoveryState
                      ? 'Once you get a new link, open it and send the photos there.'
                      : uploadRequest?.status === 'completed'
                        ? `${requester} can review these photos now.`
                        : `${requester} gets these photos straight away and they are attached to this job.`}
                  </p>
                </PublicSidePanel>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
