import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import App from './App';
import { PHOTO_UPLOAD_ACCEPT, isSupportedPhotoFile } from './lib/upload';

function renderRoute(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>,
  );
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('upload app', () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the landing page at the root route', () => {
    renderRoute('/');

    expect(screen.getByRole('heading', { name: /send your job photos to the tradie/i })).toBeInTheDocument();
    expect(screen.getByText(/tokenized upload path/i)).toBeInTheDocument();
  });

  it('advertises the backend image-only upload contract', () => {
    renderRoute('/upload/job_123');

    const fileInput = screen.getByLabelText(/photo files/i);
    expect(fileInput).toHaveAttribute('accept', PHOTO_UPLOAD_ACCEPT);
    expect(screen.getByText(/png, jpg, jpeg, heic, heif, or webp images only/i)).toBeInTheDocument();
    expect(fileInput.getAttribute('accept') ?? '').not.toContain('.pdf');
  });

  it('posts image files to the upload endpoint', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ ok: true, uploaded: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/upload/job_123');

    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/photo files/i), file);
    await user.click(screen.getByRole('button', { name: /upload photos/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [requestUrl, init] = fetchMock.mock.calls[0];
    expect(String(requestUrl)).toContain('/uploads/job_123/photos');
    expect(init?.method).toBe('POST');
    expect(await screen.findByText(/uploaded 1 photo successfully/i)).toBeInTheDocument();
  });

  it('rejects pdf files in the validation helper', () => {
    expect(isSupportedPhotoFile(new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' }))).toBe(false);
    expect(isSupportedPhotoFile(new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' }))).toBe(true);
  });
});
