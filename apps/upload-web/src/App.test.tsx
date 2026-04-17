import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function byTextContent(expected: string) {
  return (_content: string, node: Element | null) => node?.textContent?.trim() === expected;
}

function uploadSummary(overrides: Record<string, unknown> = {}) {
  return {
    fileCount: 0,
    status: 'pending',
    expiresAt: '2026-04-16T00:00:00.000Z',
    requestedBy: 'Jordan',
    businessName: 'Jordan Plumbing',
    siteLabel: '14 Clarence Street',
    jobSummary: 'Blocked stormwater drain',
    requestNote: 'Show the whole area first, then the blocked outlet.',
    ...overrides,
  };
}

describe('upload app', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the landing page at the root route', () => {
    renderRoute('/');

    expect(screen.getByRole('heading', { name: /send photos of the job/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /open the link from the text/i })).toBeInTheDocument();
    expect(screen.getByText(/under 2 minutes/i)).toBeInTheDocument();
  });

  it('advertises the backend image-only upload contract', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        ok: true,
        upload: uploadSummary(),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderRoute('/upload/job_123');

    const fileInput = await screen.findByLabelText(/choose photos/i);
    expect(await screen.findByText(byTextContent('0 sent already'))).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /send photos to jordan plumbing/i })).toBeInTheDocument();
    expect(screen.getAllByText(/blocked stormwater drain/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/best photos to send/i)).toBeInTheDocument();
    expect(screen.getByText(/attached to this job so the team can review them fast/i)).toBeInTheDocument();
    expect(fileInput).toHaveAttribute('accept', PHOTO_UPLOAD_ACCEPT);
    expect(fileInput.getAttribute('accept') ?? '').not.toContain('.pdf');
  });

  it('posts image files to the upload endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          upload: uploadSummary(),
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          ok: true,
          uploaded: 1,
          upload: uploadSummary({
            fileCount: 1,
            status: 'completed',
          }),
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup({ applyAccept: false });

    renderRoute('/upload/job_123');
    expect(await screen.findByText(byTextContent('0 sent already'))).toBeInTheDocument();

    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' });
    await user.upload(await screen.findByLabelText(/choose photos/i), file);
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
    expect(await screen.findByText(/sent 1 photo\./i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(byTextContent('1 sent already'))).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /photos sent\./i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload photos/i })).not.toBeInTheDocument();
  });

  it('shows selected files and allows clearing them before upload', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        ok: true,
        upload: uploadSummary(),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/upload/job_123');

    await screen.findByText(byTextContent('0 sent already'));

    const file = new File(['image'], 'site-photo.jpg', { type: 'image/jpeg' });
    await user.upload(await screen.findByLabelText(/choose photos/i), file);

    expect(screen.getByText(/site-photo\.jpg/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear selection/i }));

    expect(screen.queryByText(/site-photo\.jpg/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /ready to send/i })).not.toBeInTheDocument();
  });

  it('keeps valid photos when one unsupported file is selected', async () => {
    fetchMock.mockResolvedValueOnce(
      mockJsonResponse({
        ok: true,
        upload: uploadSummary(),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderRoute('/upload/job_123');
    await screen.findByText(byTextContent('0 sent already'));

    const goodFile = new File(['image'], 'site-photo.jpg', { type: 'image/jpeg' });
    const badFile = new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' });
    await user.upload(await screen.findByLabelText(/choose photos/i), [goodFile, badFile]);

    expect(screen.getByText(/site-photo\.jpg/i)).toBeInTheDocument();
    expect(screen.queryByText(/invoice\.pdf/i)).not.toBeInTheDocument();
  });

  it('shows a clear error when the upload token has expired', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ ok: false }, 410));
    vi.stubGlobal('fetch', fetchMock);

    renderRoute('/upload/job_123');

    expect(await screen.findByText(/this link has expired\./i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/choose photos/i)).not.toBeInTheDocument();
    expect(screen.getByText(/ask your tradie or office to text you a new photo link/i)).toBeInTheDocument();
  });

  it('rejects pdf files in the validation helper', () => {
    expect(isSupportedPhotoFile(new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' }))).toBe(false);
    expect(isSupportedPhotoFile(new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' }))).toBe(true);
  });
});
