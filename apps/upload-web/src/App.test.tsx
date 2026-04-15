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

  it('advertises the backend image-only upload contract', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        ok: true,
        upload: {
          token: 'job_123',
          jobId: 'job_123',
          fileCount: 0,
          status: 'pending',
          expiresAt: '2026-04-16T00:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderRoute('/upload/job_123');

    const fileInput = screen.getByLabelText(/photo files/i);
    expect(await screen.findByText(/0 already uploaded/i)).toBeInTheDocument();
    expect(fileInput).toHaveAttribute('accept', PHOTO_UPLOAD_ACCEPT);
    expect(fileInput.getAttribute('accept') ?? '').not.toContain('.pdf');
  });

  it('posts image files to the upload endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          upload: {
            token: 'job_123',
            jobId: 'job_123',
            notes: 'Show the damaged fittings and the switchboard.',
            fileCount: 0,
            status: 'pending',
            expiresAt: '2026-04-16T00:00:00.000Z',
          },
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ ok: true, uploaded: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/upload/job_123');

    expect(await screen.findByText(/show the damaged fittings and the switchboard/i)).toBeInTheDocument();

    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/photo files/i), file);
    await user.click(screen.getByRole('button', { name: /upload 1 photo/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([requestUrl]) => String(requestUrl).includes('/uploads/job_123/photos'))).toBe(true);
    });

    const [, init] =
      fetchMock.mock.calls.find(([requestUrl]) => String(requestUrl).includes('/uploads/job_123/photos')) ?? [];
    expect(init).toBeDefined();
    const requestUrl = String(
      fetchMock.mock.calls.find(([nextUrl]) => String(nextUrl).includes('/uploads/job_123/photos'))?.[0] ?? '',
    );
    expect(String(requestUrl)).toContain('/uploads/job_123/photos');
    expect(init?.method).toBe('POST');
    expect(await screen.findByText(/uploaded 1 photo successfully/i)).toBeInTheDocument();
    expect(screen.getByText(/1 already uploaded/i)).toBeInTheDocument();
  });

  it('shows selected files and allows clearing them before upload', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        ok: true,
        upload: {
          token: 'job_123',
          jobId: 'job_123',
          fileCount: 0,
          status: 'pending',
          expiresAt: '2026-04-16T00:00:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/upload/job_123');

    await screen.findByText(/0 already uploaded/i);

    const file = new File(['image'], 'site-photo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/photo files/i), file);

    expect(screen.getByText(/site-photo\.jpg/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear selection/i }));

    expect(screen.getByText(/no files selected yet/i)).toBeInTheDocument();
  });

  it('shows a clear error when the upload token has expired', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ ok: false }, 410));
    vi.stubGlobal('fetch', fetchMock);

    renderRoute('/upload/job_123');

    expect(await screen.findByText(/upload link has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload photos/i })).toBeDisabled();
  });

  it('rejects pdf files in the validation helper', () => {
    expect(isSupportedPhotoFile(new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' }))).toBe(false);
    expect(isSupportedPhotoFile(new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' }))).toBe(true);
  });
});
