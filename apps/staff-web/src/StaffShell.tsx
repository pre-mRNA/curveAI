import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  getJobCard,
  getStaffJobs,
  getStaffProfile,
  launchStaffSetup,
} from './api/client';
import { staffBrand, staffBrandStyle } from './brand';
import { ProtectedImage } from './ProtectedImage';
import { testScenarios } from './testStudio';
import type { JobCard, JobSummary, StaffProfile } from './types';

type Tab = 'queue' | 'setup' | 'tests';
function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value?: string) {
  if (!value) {
    return 'TBD';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildCallHref(phone?: string) {
  return phone ? `tel:${phone.replace(/\s+/g, '')}` : undefined;
}

function buildMapHref(address?: string) {
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : undefined;
}

function queueTone(status: JobSummary['status']) {
  switch (status) {
    case 'quoted':
      return 'accent';
    case 'booked':
      return 'good';
    case 'needs_follow_up':
      return 'warn';
    default:
      return 'neutral';
  }
}

function calendarSetupLabel(connection?: StaffProfile['calendarConnection']) {
  if (connection?.status === 'connected') {
    return 'Done';
  }
  if (connection?.status === 'pending') {
    return 'Connecting';
  }
  if (connection?.status === 'error') {
    return 'Needs attention';
  }
  return 'Not done';
}

function voiceSetupLabel(status: StaffProfile['voiceConsentStatus']) {
  return status === 'granted' ? 'Done' : 'Not done';
}

function profileCompletionScore(staff: StaffProfile | null) {
  if (!staff) {
    return { ready: 0, total: 3 };
  }

  const checks = [
    staff.voiceConsentStatus === 'granted',
    staff.calendarConnection?.status === 'connected',
    Boolean(staff.pricingProfile),
  ];

  return {
    ready: checks.filter(Boolean).length,
    total: checks.length,
  };
}

function nextSetupStep(profile: StaffProfile | null) {
  const setup = profile?.setup;
  if (setup?.status === 'completed') {
    return {
      title: 'Review your setup',
      detail: 'Open the private setup page any time you want to check or update how the assistant works.',
    };
  }

  if (setup?.status === 'in_progress') {
    switch (setup.currentStep) {
      case 'consent':
        return {
          title: 'Start the private setup',
          detail: 'Open the setup page and say yes to the permissions so the interview can begin.',
        };
      case 'interview':
        return {
          title: 'Answer the setup questions',
          detail: 'Keep going on the private setup page so the assistant learns your jobs and rules.',
        };
      case 'review':
        return {
          title: 'Check the business details',
          detail: 'Review and fix the saved details before you move on to the calendar and voice steps.',
        };
      case 'calendar':
        return {
          title: 'Connect Microsoft calendar',
          detail: 'Finish the calendar step on the private setup page so bookings can land in the right place.',
        };
      case 'voice_sample':
        return {
          title: 'Record the voice sample',
          detail: 'Use the private setup page to upload the short voice sample before you finish.',
        };
      case 'finalize':
        return {
          title: 'Finish setup',
          detail: 'The last step is ready. Open the private setup page and finish the flow.',
        };
      default:
        return {
          title: 'Continue setup',
          detail: 'Open the private setup page and keep going from where you left off.',
        };
    }
  }

  if (!profile || profile.voiceConsentStatus !== 'granted') {
    return {
      title: 'Start setup',
      detail: 'Open the private setup page to set your jobs, rules, calendar, and voice in one flow.',
    };
  }

  if (profile.calendarConnection?.status !== 'connected') {
    return {
      title: 'Connect Microsoft calendar',
      detail: 'Link the calendar where booked jobs should land.',
    };
  }

  if (!profile.pricingProfile) {
    return {
      title: 'Set your starting prices',
      detail: 'Add your callout, minimum, and hourly pricing so quotes are usable.',
    };
  }

  return {
    title: 'Continue setup',
    detail: 'Open the private setup page to bring these details into the main setup flow.',
  };
}

function setupActionLabel(profile: StaffProfile | null) {
  if (profile?.setup?.status === 'completed') {
    return 'Review setup';
  }
  if (profile?.setup?.status === 'in_progress') {
    return 'Continue setup';
  }
  return 'Start setup';
}

function setupStepLabel(profile: StaffProfile | null) {
  const step = profile?.setup?.currentStep;
  switch (step) {
    case 'consent':
      return 'Permissions';
    case 'interview':
      return 'Questions';
    case 'review':
      return 'Check details';
    case 'calendar':
      return 'Calendar';
    case 'voice_sample':
      return 'Voice sample';
    case 'finalize':
      return 'Finish';
    case 'complete':
      return 'Complete';
    default:
      return profile?.setup?.status === 'completed' ? 'Complete' : 'Not started';
  }
}

const COMPACT_JOB_STATUS_LABEL: Record<JobSummary['status'], string> = {
  new: 'New',
  quoted: 'Quoted',
  booked: 'Booked',
  needs_follow_up: 'Follow up',
  completed: 'Done',
};

export default function StaffShell({
  staff,
  onSignOut,
}: {
  staff: StaffProfile;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>('queue');
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const selectedJobIdRef = useRef<string | null>(null);
  const jobsAbortRef = useRef<AbortController | null>(null);
  const jobCardAbortRef = useRef<AbortController | null>(null);
  const jobsRequestIdRef = useRef(0);
  const [selectedJobCard, setSelectedJobCard] = useState<JobCard | null>(null);
  const [jobCardLoading, setJobCardLoading] = useState(false);
  const [jobCardError, setJobCardError] = useState<string | null>(null);
  const [profile, setProfile] = useState(staff);
  const [setupLaunchBusy, setSetupLaunchBusy] = useState(false);
  const [setupLaunchError, setSetupLaunchError] = useState<string | null>(null);
  const [copiedScenarioId, setCopiedScenarioId] = useState<string | null>(null);
  const [mobileQueueView, setMobileQueueView] = useState<'list' | 'detail'>('list');
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  );

  const completion = profileCompletionScore(profile);
  const queuedCallbacks = useMemo(() => jobs.filter((job) => job.callback).length, [jobs]);
  const setupNext = nextSetupStep(profile);

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== 'hidden');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  async function reloadProfile() {
    try {
      const nextProfile = await getStaffProfile();
      setProfile(nextProfile);
      return nextProfile;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        onSignOut();
      }
      throw error;
    }
  }

  async function loadJobs(nextSelectedId?: string | null) {
    jobsAbortRef.current?.abort();
    const controller = new AbortController();
    jobsAbortRef.current = controller;
    const requestId = jobsRequestIdRef.current + 1;
    jobsRequestIdRef.current = requestId;
    setJobsLoading(true);
    setJobsError(null);
    try {
      const nextJobs = await getStaffJobs(controller.signal);
      if (controller.signal.aborted || jobsRequestIdRef.current !== requestId) {
        return [];
      }
      const candidateId = nextSelectedId ?? selectedJobIdRef.current;
      const resolvedSelectedId =
        candidateId && nextJobs.some((job) => job.id === candidateId) ? candidateId : nextJobs[0]?.id ?? null;

      setJobs(nextJobs);
      setSelectedJobId(resolvedSelectedId);
      setSelectedJobCard((current) => (resolvedSelectedId && current?.job.id === resolvedSelectedId ? current : null));
      if (!resolvedSelectedId) {
        setMobileQueueView('list');
      }
      return nextJobs;
    } catch (error) {
      if ((error instanceof DOMException && error.name === 'AbortError') || controller.signal.aborted) {
        return [];
      }
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        onSignOut();
        return [];
      }
      setJobsError(error instanceof Error ? error.message : 'Unable to load queue');
      return [];
    } finally {
      if (jobsRequestIdRef.current === requestId) {
        setJobsLoading(false);
      }
      if (jobsAbortRef.current === controller) {
        jobsAbortRef.current = null;
      }
    }
  }

  useEffect(() => {
    if (tab !== 'queue' || !isDocumentVisible) {
      return undefined;
    }

    void loadJobs();

    const timer = window.setInterval(() => {
      void loadJobs();
    }, 30000);

    return () => {
      window.clearInterval(timer);
      jobsAbortRef.current?.abort();
    };
  }, [isDocumentVisible, tab]);

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null;
  const selectedJobUpdatedAt = selectedJob?.updatedAt ?? null;

  useEffect(() => {
    if (!selectedJobId) {
      jobCardAbortRef.current?.abort();
      setSelectedJobCard(null);
      return;
    }

    jobCardAbortRef.current?.abort();
    const controller = new AbortController();
    jobCardAbortRef.current = controller;
    const load = async () => {
      setJobCardLoading(true);
      setJobCardError(null);
      try {
        const card = await getJobCard(selectedJobId, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setSelectedJobCard(card);
      } catch (error) {
        if ((error instanceof DOMException && error.name === 'AbortError') || controller.signal.aborted) {
          return;
        }
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          onSignOut();
          return;
        }
        setSelectedJobCard(null);
        setJobCardError(error instanceof Error ? error.message : 'Unable to load job card');
      } finally {
        if (!controller.signal.aborted) {
          setJobCardLoading(false);
        }
        if (jobCardAbortRef.current === controller) {
          jobCardAbortRef.current = null;
        }
      }
    };

    void load();
    return () => {
      controller.abort();
    };
  }, [onSignOut, selectedJobId, selectedJobUpdatedAt]);

  async function continueSetup() {
    setSetupLaunchBusy(true);
    setSetupLaunchError(null);

    try {
      const result = await launchStaffSetup();
      window.location.assign(result.launchUrl);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        onSignOut();
        return;
      }
      setSetupLaunchError(error instanceof Error ? error.message : 'Could not open setup right now.');
    } finally {
      setSetupLaunchBusy(false);
    }
  }

  async function copyScenarioPrompt(id: string, prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedScenarioId(id);
      window.setTimeout(() => {
        setCopiedScenarioId((current) => (current === id ? null : current));
      }, 1800);
    } catch {
      setCopiedScenarioId(null);
    }
  }

  const mobileDetailTitle = selectedJob?.customerName ?? selectedJobCard?.job.callerName ?? 'Job card';
  const callHref = buildCallHref(selectedJobCard?.job.callerPhone);
  const mapHref = buildMapHref(selectedJobCard?.job.address);
  const latestQuote = selectedJobCard?.quotes[0] ?? null;
  const callbackTask = selectedJobCard?.job.callbackTask;
  const appointment = selectedJobCard?.job.appointment;
  const currentQuotePrice = latestQuote?.amount ?? selectedJob?.quote.presentedPrice ?? null;

  return (
    <div className="shell" style={staffBrandStyle}>
      <div className="container">
        <header className="hero hero--staff">
          <div className="hero-copy">
            <div className="eyebrow">{staffBrand.eyebrow}</div>
            <h1>{staffBrand.heroTitle}</h1>
            <p>{staffBrand.heroDescription}</p>
          </div>

          <div className="hero-card">
            <span className="pill accent">{staffBrand.badgeLabel}</span>
            <strong>{profile.fullName}</strong>
            <p className="muted">
              {profile.role ?? 'Staff'}{profile.companyName ? ` · ${profile.companyName}` : ''}{' '}
              {profile.timezone ? `· ${profile.timezone}` : ''}
            </p>
            <div className="hero-metrics">
              <div>
                <span className="metric-label">Queue</span>
                <strong>{jobs.length}</strong>
              </div>
              <div>
                <span className="metric-label">Setup</span>
                <strong>
                  {completion.ready}/{completion.total}
                </strong>
              </div>
            </div>
          </div>
        </header>

        <section className="topbar">
          <div className="topbar-copy">
            <strong>{profile.fullName}</strong>
            <span className="muted">
              Voice {voiceSetupLabel(profile.voiceConsentStatus)} · Calendar{' '}
              {calendarSetupLabel(profile.calendarConnection)}
            </span>
          </div>
          <div className="topbar-stats">
            <div className="mini-stat">
              <span className="muted">Open jobs</span>
              <strong>{jobs.length}</strong>
            </div>
            <div className="mini-stat">
              <span className="muted">Callbacks</span>
              <strong>{queuedCallbacks}</strong>
            </div>
            <div className="mini-stat">
              <span className="muted">Pricing</span>
              <strong>{profile.pricingProfile ? formatCurrency(profile.pricingProfile.baseCalloutFee) : 'Unset'}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="button secondary" type="button" onClick={() => void reloadProfile()}>
              Refresh profile
            </button>
            <button className="button secondary" type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </section>

        <nav className="tabbar" aria-label="Staff app sections">
          <button className={`tab ${tab === 'queue' ? 'active' : ''}`} type="button" onClick={() => setTab('queue')}>
            Queue
          </button>
          <button className={`tab ${tab === 'setup' ? 'active' : ''}`} type="button" onClick={() => setTab('setup')}>
            Setup
          </button>
          <button className={`tab ${tab === 'tests' ? 'active' : ''}`} type="button" onClick={() => setTab('tests')}>
            Test Studio
          </button>
        </nav>

        {tab === 'queue' ? (
          <section className={`staff-grid staff-grid--queue ${mobileQueueView === 'detail' ? 'show-detail' : 'show-list'}`}>
            <div className="card queue-panel queue-panel--list">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">Job queue</div>
                  <h2>Your jobs</h2>
                  <p className="muted">Tap a job to open the job card on this phone.</p>
                </div>
                {jobsError ? <p className="pill warn">{jobsError}</p> : null}
                {jobsLoading ? <div className="empty-state">Loading queue…</div> : null}
                {!jobsLoading && jobs.length === 0 ? (
                  <div className="empty-state">
                    <strong>No jobs yet.</strong>
                    <p className="muted">New jobs will show here.</p>
                  </div>
                ) : null}
                <div className="job-list">
                  {jobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      className={`job-card ${selectedJobId === job.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedJobId(job.id);
                        setMobileQueueView('detail');
                      }}
                    >
                      <div className="job-card-head">
                        <div>
                          <strong>{job.customerName}</strong>
                          <div className="muted">{job.suburb}</div>
                        </div>
                        <span className={`pill ${queueTone(job.status)}`}>{job.status.replace(/_/g, ' ')}</span>
                      </div>
                      <p>{job.summary}</p>
                      <div className="job-card-meta">
                        <span>{formatCurrency(job.quote.presentedPrice)}</span>
                        <span>{job.updatedAt}</span>
                        <span>{job.photos.length} photos</span>
                      </div>
                      <div className="job-card-hints">
                        {job.callback?.dueAt ? <span className="pill warn">Call back due</span> : null}
                        {job.status === 'booked' ? <span className="pill good">Visit booked</span> : null}
                      </div>
                      <div className="job-card-cta">
                        <span className="pill neutral">{COMPACT_JOB_STATUS_LABEL[job.status]}</span>
                        <strong>Open job card</strong>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="card queue-panel queue-panel--detail">
              <div className="card-inner">
                <div className="queue-mobile-actions">
                  <button className="button secondary compact queue-back-button" type="button" onClick={() => setMobileQueueView('list')}>
                    Back to jobs
                  </button>
                  <span className="pill neutral">{mobileDetailTitle}</span>
                </div>
                <div className="section-header">
                  <div className="eyebrow">Job card</div>
                  <h2>{selectedJob?.customerName ?? 'Pick a job'}</h2>
                  <p className="muted">Start with the summary, then the photos and call notes.</p>
                </div>

                {jobCardLoading ? <div className="empty-state">Loading job card…</div> : null}
                {jobCardError ? <p className="pill warn">{jobCardError}</p> : null}

                {!jobCardLoading && !selectedJobCard ? (
                  <div className="empty-state">
                    <strong>No job picked.</strong>
                    <p className="muted">Pick a job from the list to see the details.</p>
                  </div>
                ) : null}

                {selectedJobCard ? (
                  <div className="detail-stack">
                    <div className="detail-panel detail-hero-panel">
                      <div className="detail-hero-top">
                        <div className="detail-status-row">
                          <span className={`pill ${queueTone(selectedJob?.status ?? 'new')}`}>{selectedJobCard.job.status.replace(/_/g, ' ')}</span>
                          {callbackTask?.dueAt ? <span className="pill warn">Callback {formatDateTime(callbackTask.dueAt)}</span> : null}
                          {appointment?.startAt ? <span className="pill good">{formatDateTime(appointment.startAt)}</span> : null}
                        </div>
                        <div className="detail-action-row">
                          {callHref ? (
                            <a className="button compact quick-action" href={callHref}>
                              Call customer
                            </a>
                          ) : null}
                          {mapHref ? (
                            <a className="button secondary compact quick-action" href={mapHref} target="_blank" rel="noreferrer">
                              Open map
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <div className="detail-grid">
                        <div>
                          <span className="label">Customer</span>
                          <strong>{selectedJobCard.job.callerName ?? 'No name yet'}</strong>
                        </div>
                        <div>
                          <span className="label">Phone</span>
                          <strong>{selectedJobCard.job.callerPhone ?? 'No phone yet'}</strong>
                        </div>
                        <div>
                          <span className="label">Address</span>
                          <strong>{selectedJobCard.job.address ?? 'Not added yet'}</strong>
                        </div>
                        <div>
                          <span className="label">Appointment</span>
                          <strong>{formatDateTime(selectedJobCard.job.appointment?.startAt)}</strong>
                        </div>
                      </div>
                      <p className="detail-summary">{selectedJobCard.job.summary ?? selectedJobCard.job.issue ?? 'Waiting for summary'}</p>
                      {callbackTask?.reason ? (
                        <div className="detail-brief">
                          <span className="label">What to do now</span>
                          <strong>{callbackTask.reason}</strong>
                          {callbackTask.notes ? <p className="muted">{callbackTask.notes}</p> : null}
                        </div>
                      ) : null}
                      <div className="detail-stat-grid">
                        <div className="detail-stat">
                          <span className="label">Current price</span>
                          <strong>{currentQuotePrice ? formatCurrency(currentQuotePrice) : 'No quote yet'}</strong>
                        </div>
                        <div className="detail-stat">
                          <span className="label">Photos</span>
                          <strong>{selectedJobCard.photos.length}</strong>
                        </div>
                        <div className="detail-stat">
                          <span className="label">Call notes</span>
                          <strong>{selectedJobCard.calls.length}</strong>
                        </div>
                        <div className="detail-stat">
                          <span className="label">Next step</span>
                          <strong>
                            {callbackTask?.reason
                              ? callbackTask.reason
                              : appointment?.startAt
                                ? 'Attend visit'
                                : 'Review and call back'}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="detail-panel">
                      <div className="detail-section-head">
                        <h3>Photos</h3>
                        <span className="pill neutral">{selectedJobCard.photos.length}</span>
                      </div>
                      {selectedJobCard.photos.length ? (
                        <div className="photo-grid">
                          {selectedJobCard.photos.map((photo, index) => (
                            <div key={photo.id} className="photo-thumb">
                              <ProtectedImage photoId={photo.id} alt={photo.caption ?? photo.filename} eager={index === 0} />
                              <span>{photo.caption ?? photo.filename}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state compact">No photos yet.</div>
                      )}
                    </div>

                    <div className="detail-panel">
                      <div className="detail-section-head">
                        <h3>Call notes</h3>
                        <span className="pill neutral">{selectedJobCard.calls.length}</span>
                      </div>
                      {selectedJobCard.calls.length ? (
                        <div className="call-list">
                          {selectedJobCard.calls.map((call) => (
                            <div className="call-item" key={call.id}>
                              <strong>{call.status.replace(/_/g, ' ')}</strong>
                              <span className="muted">{formatDateTime(call.createdAt)}</span>
                              <p>{call.summary ?? call.transcript ?? 'No notes yet.'}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state compact">No call notes yet.</div>
                      )}
                    </div>

                    <div className="detail-panel">
                      <div className="detail-section-head">
                        <h3>Quote history</h3>
                        <span className="pill neutral">{selectedJobCard.quotes.length}</span>
                      </div>
                      {selectedJobCard.quotes.length ? (
                        <div className="quote-list">
                          {selectedJobCard.quotes.map((quote) => (
                            <div className="quote-item" key={quote.id}>
                              <strong>{formatCurrency(quote.amount)}</strong>
                              <span className="muted">
                                {quote.variant} · {quote.status}
                              </span>
                              <small>{quote.rationale[0] ?? 'No note saved.'}</small>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state compact">No quote yet.</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'setup' ? (
          <section className="setup-grid">
            <div className="card">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">Readiness</div>
                  <h2>Finish setup</h2>
                  <p className="muted">The private setup page is now the main place to finish how the assistant works.</p>
                </div>
                <div className="setup-next-card">
                  <span className="label">Next best step</span>
                  <strong>{setupNext.title}</strong>
                  <p className="muted">{setupNext.detail}</p>
                </div>
                <div className="readiness-list">
                  <div className="readiness-item">
                    <strong>Voice consent</strong>
                    <span className={`pill ${profile.voiceConsentStatus === 'granted' ? 'good' : 'warn'}`}>
                      {profile.voiceConsentStatus}
                    </span>
                  </div>
                  <div className="readiness-item">
                    <strong>Calendar</strong>
                    <span
                      className={`pill ${
                        profile.calendarConnection?.status === 'connected'
                          ? 'good'
                          : profile.calendarConnection?.status === 'error'
                            ? 'warn'
                            : 'warn'
                      }`}
                    >
                      {profile.calendarConnection?.status === 'connected'
                        ? 'done'
                        : profile.calendarConnection?.status === 'pending'
                          ? 'connecting'
                          : profile.calendarConnection?.status === 'error'
                            ? 'error'
                            : 'waiting'}
                    </span>
                  </div>
                  <div className="readiness-item">
                    <strong>Pricing</strong>
                    <span className={`pill ${profile.pricingProfile ? 'good' : 'warn'}`}>
                      {profile.pricingProfile ? 'done' : 'waiting'}
                    </span>
                  </div>
                </div>
                <div className="setup-next-card">
                  <span className="label">Private setup flow</span>
                  <strong>{setupStepLabel(profile)}</strong>
                  <p className="muted">
                    {profile.setup?.status === 'completed'
                      ? 'Your main setup flow is complete. Open it again any time you want to review or change it.'
                      : profile.setup?.status === 'in_progress'
                        ? 'We will open the private setup page and continue from where you left off.'
                        : 'We will open the private setup page and start from the first step.'}
                  </p>
                </div>
                <div className="button-row">
                  <button className="button" type="button" onClick={() => void continueSetup()} disabled={setupLaunchBusy}>
                    {setupLaunchBusy ? 'Opening setup...' : setupActionLabel(profile)}
                  </button>
                </div>
                {setupLaunchError ? <p className="pill warn">{setupLaunchError}</p> : null}
              </div>
            </div>

            <div className="card">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">What happens on the setup page</div>
                  <h2>One flow, not three separate forms</h2>
                </div>
                <ul className="guide-list compact">
                  <li>Answer the setup questions so the assistant learns your jobs, rules, and tone.</li>
                  <li>Check the details before anything is saved as your working setup.</li>
                  <li>Connect the calendar and upload the voice sample in the same flow.</li>
                </ul>
              </div>
            </div>

            <div className="card">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">Current details</div>
                  <h2>What is already on file</h2>
                </div>
                  <div className="field-grid">
                    <div className="readiness-item">
                      <strong>Voice</strong>
                      <span>{voiceSetupLabel(profile.voiceConsentStatus)}</span>
                    </div>
                    <div className="readiness-item">
                      <strong>Calendar</strong>
                      <span>{calendarSetupLabel(profile.calendarConnection)}</span>
                    </div>
                    <div className="readiness-item">
                      <strong>Pricing</strong>
                      <span>{profile.pricingProfile ? formatCurrency(profile.pricingProfile.baseCalloutFee) : 'Not set'}</span>
                    </div>
                    <div className="readiness-item">
                      <strong>Calendar account</strong>
                      <span>{profile.calendarConnection?.accountEmail ?? 'Not connected yet'}</span>
                    </div>
                    <div className="readiness-item">
                      <strong>Calendar name</strong>
                      <span>{profile.calendarConnection?.calendarLabel ?? profile.calendarConnection?.calendarId ?? 'Primary'}</span>
                    </div>
                    <div className="readiness-item">
                      <strong>Timezone</strong>
                      <span>{profile.calendarConnection?.timezone ?? profile.timezone ?? 'Australia/Sydney'}</span>
                    </div>
                  </div>
                  <p className="muted">
                    These details stay visible here, but changes now happen through the private setup flow so the assistant only has one source of truth.
                  </p>
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'tests' ? (
          <section className="tests-grid">
            <div className="card">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">AI Test Studio</div>
                  <h2>Seed the judge loop before automation lands</h2>
                  <p className="muted">
                    This is the first deck for fixed prompts, adversarial scenarios, and explicit success criteria. The
                    next layer is the executor + third-model judge.
                  </p>
                </div>
                <div className="studio-summary">
                  <div className="mini-stat">
                    <span className="muted">Scenarios</span>
                    <strong>{testScenarios.length}</strong>
                  </div>
                  <div className="mini-stat">
                    <span className="muted">Judge model</span>
                    <strong>Planned</strong>
                  </div>
                  <div className="mini-stat">
                    <span className="muted">Target</span>
                    <strong>Voice agent</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="scenario-list">
              {testScenarios.map((scenario) => (
                <article className="card scenario-card" key={scenario.id}>
                  <div className="card-inner">
                    <div className="scenario-head">
                      <span className="pill accent">{scenario.category}</span>
                      <div className="scenario-actions">
                        {copiedScenarioId === scenario.id ? <span className="pill good">Copied</span> : null}
                        <button className="button secondary compact" type="button" onClick={() => void copyScenarioPrompt(scenario.id, scenario.prompt)}>
                          Copy prompt
                        </button>
                        <code>{scenario.id}</code>
                      </div>
                    </div>
                    <h3>{scenario.title}</h3>
                    <p className="muted">{scenario.objective}</p>

                    <div className="scenario-block">
                      <span className="label">Operator prompt</span>
                      <p>{scenario.prompt}</p>
                    </div>

                    <div className="scenario-block">
                      <span className="label">Success criteria</span>
                      <div className="judge-list">
                        {scenario.successCriteria.map((criterion) => (
                          <div className="judge-item" key={criterion.label}>
                            <strong>{criterion.label}</strong>
                            <p>{criterion.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="scenario-block">
                      <span className="label">Judge notes</span>
                      <p>{scenario.judgeNotes}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
