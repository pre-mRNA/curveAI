import { useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { uploadPhotos } from './api/client';
import { PHOTO_UPLOAD_ACCEPT, isSupportedPhotoFile } from './lib/upload';

function UploadLanding() {
  return (
    <div className="shell">
      <div className="container">
        <header className="hero">
          <div className="eyebrow">Customer Upload</div>
          <h1>Send your job photos to the tradie.</h1>
          <p>
            Use the secure upload link from SMS to add site photos, damaged parts, or other job details from your
            phone.
          </p>
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSelect = (files: FileList | null) => {
    const nextFiles = files ? Array.from(files) : [];
    setMessage(null);
    setError(null);

    if (nextFiles.some((file) => !isSupportedPhotoFile(file))) {
      setSelectedFiles([]);
      setError('Only image files are accepted.');
      return;
    }

    setSelectedFiles(nextFiles);
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
      setSelectedFiles([]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-wrap">
      <div className="container">
        <div className="card">
          <div className="card-inner">
            <div className="eyebrow">Customer Upload</div>
            <h1>Send your photos to the tradie.</h1>
            <p className="muted">
              Reference token: <code>{token || 'missing'}</code>
            </p>

            <div className="dropzone">
              <div>
                <strong>Upload images from the job site</strong>
                <div className="muted">PNG, JPG, JPEG, HEIC, HEIF, or WebP images only.</div>
              </div>
              <label className="field" htmlFor="upload-files">
                <span>Photo files</span>
                <input
                  id="upload-files"
                  className="text-input"
                  type="file"
                  accept={PHOTO_UPLOAD_ACCEPT}
                  multiple
                  onChange={(event) => onSelect(event.target.files)}
                />
              </label>
              <button className="button" type="button" onClick={onUpload} disabled={uploading}>
                {uploading ? 'Uploading...' : 'Upload photos'}
              </button>
            </div>

            <div style={{ height: 14 }} />

            <div className="field">
              <label>Selected files</label>
              <div className="card">
                <div className="card-inner">
                  {selectedFiles.length ? (
                    selectedFiles.map((file) => <div key={file.name}>{file.name}</div>)
                  ) : (
                    <div className="muted">No files selected yet.</div>
                  )}
                </div>
              </div>
            </div>

            {message ? <p className="pill good">{message}</p> : null}
            {error ? <p className="pill warn">{error}</p> : null}

            <p className="muted">
              Your files are posted to <code>/uploads/:token/photos</code> on the configured API base URL.
            </p>
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
