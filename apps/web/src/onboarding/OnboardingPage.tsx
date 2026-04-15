import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import {
  clearOnboardingSession,
  readOnboardingSession,
  saveOnboardingSession,
  type StoredOnboardingSession,
} from '../lib/onboardingSession';
import type {
  CalendarConnectResponse,
  OnboardingConsentPayload,
  OnboardingFinalizeResponse,
  OnboardingReview,
  OnboardingReviewProfile,
  OnboardingReviewUpdate,
  OnboardingSession,
  OnboardingStep,
} from '../types';

const STEPS: Array<{ id: OnboardingStep; label: string; description: string }> = [
  { id: 'consent', label: 'Consent', description: 'Confirm recording and clone permissions.' },
  { id: 'interview', label: 'Interview', description: 'Answer the structured voice interview.' },
  { id: 'review', label: 'Extraction review', description: 'Check the extracted profile for gaps.' },
  { id: 'calendar', label: 'Calendar connect', description: 'Link a Microsoft calendar.' },
  { id: 'voice_sample', label: 'Voice sample', description: 'Record a clean cloning sample.' },
  { id: 'finalize', label: 'Finalize', description: 'Lock in the staff profile.' },
];

const STEP_GUIDANCE: Record<OnboardingStep, { title: string; detail: string }> = {
  consent: {
    title: 'Check every permission before we start.',
    detail: 'The interview only opens after all three consent boxes are checked, so nothing starts by accident.',
  },
  interview: {
    title: 'Capture the first answer and keep moving.',
    detail: 'Type the response the voice interviewer would have heard so the transcript stays aligned.',
  },
  review: {
    title: 'Make the extracted profile canonical.',
    detail: 'Fix names, services, pricing rules, and escalation details before the data moves downstream.',
  },
  calendar: {
    title: 'Connect Microsoft calendar from the backend flow.',
    detail: 'Launch the auth handoff, then return here to confirm the connection before moving on.',
  },
  voice_sample: {
    title: 'Record a clean voice sample for cloning.',
    detail: 'Use the browser microphone, keep the clip short, and avoid background noise.',
  },
  finalize: {
    title: 'Confirm the handoff and close the session.',
    detail: 'Finalize only after the calendar connection and voice sample are both complete.',
  },
  complete: {
    title: 'The onboarding profile is locked.',
    detail: 'The session is complete and the staff record is ready for the ops console.',
  },
};

const REVIEW_FIELDS: Array<{
  key: keyof OnboardingReviewProfile;
  label: string;
  placeholder: string;
}> = [
  { key: 'staffName', label: 'Staff name', placeholder: 'Name shown in the agent profile' },
  { key: 'companyName', label: 'Company name', placeholder: 'Trading name or business name' },
  { key: 'role', label: 'Role', placeholder: 'Owner, dispatcher, senior tradie...' },
  { key: 'serviceArea', label: 'Service area', placeholder: 'Suburbs, region, or catchment' },
  { key: 'services', label: 'Services', placeholder: 'Plumbing, electrical, HVAC, etc.' },
  { key: 'hours', label: 'Hours', placeholder: 'Business hours and after-hours rules' },
  { key: 'pricingPreference', label: 'Pricing preference', placeholder: 'Fixed price, callout + labour, etc.' },
  { key: 'communicationStyle', label: 'Communication style', placeholder: 'Direct, warm, concise, high-context...' },
  { key: 'salesStyle', label: 'Sales style', placeholder: 'Low pressure, persuasive, consultative...' },
  { key: 'riskTolerance', label: 'Risk tolerance', placeholder: 'What the agent may quote or promise' },
  { key: 'escalationRules', label: 'Escalation rules', placeholder: 'When to hand off to a human' },
  { key: 'exclusions', label: 'Exclusions', placeholder: 'Work the agent should never book' },
  { key: 'calendarProvider', label: 'Calendar provider', placeholder: 'Microsoft, Google, etc.' },
  { key: 'crmProvider', label: 'CRM provider', placeholder: 'ServiceM8, simPRO, Jobber...' },
];

function safeStep(value: string | undefined): OnboardingStep {
  const matches = STEPS.find((step) => step.id === value);
  return matches?.id ?? 'consent';
}

function createBlankConsent(): OnboardingConsentPayload {
  return {
    recordingConsent: false,
    voiceCloneConsent: false,
    dataProcessingConsent: false,
  };
}

function createEmptyReviewDraft(): OnboardingReviewUpdate {
  return {
    staffName: '',
    companyName: '',
    role: '',
    serviceArea: '',
    services: '',
    hours: '',
    pricingPreference: '',
    communicationStyle: '',
    salesStyle: '',
    riskTolerance: '',
    escalationRules: '',
    exclusions: '',
    calendarProvider: 'Microsoft',
    crmProvider: '',
    summary: '',
    confidence: 'medium',
    missingItems: [],
  };
}

function draftFromReview(review: OnboardingReview): OnboardingReviewUpdate {
  return {
    ...createEmptyReviewDraft(),
    ...review.profile,
    summary: review.summary,
    confidence: review.confidence,
    missingItems: review.missingItems,
  };
}

function uploadUrlForCalendarResponse(response: CalendarConnectResponse): string {
  return response.authorizationUrl ?? response.redirectUrl ?? response.url ?? '';
}

function statusTone(session?: OnboardingSession | null): string {
  if (!session) {
    return 'neutral';
  }

  if (session.status === 'complete') {
    return 'good';
  }

  if (session.status === 'blocked') {
    return 'warn';
  }

  return 'accent';
}

export default function OnboardingPage() {
  const { inviteCode: inviteParam = '' } = useParams();
  const inviteCode = inviteParam.trim();
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [session, setSession] = useState<OnboardingSession | null>(null);
  const [sessionToken, setSessionToken] = useState('');
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('consent');
  const [consent, setConsent] = useState<OnboardingConsentPayload>(createBlankConsent());
  const [startingSession, setStartingSession] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [answerDraft, setAnswerDraft] = useState('');
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [answerSaving, setAnswerSaving] = useState(false);
  const [review, setReview] = useState<OnboardingReview | null>(null);
  const [reviewDraft, setReviewDraft] = useState<OnboardingReviewUpdate>(createEmptyReviewDraft());
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [calendarConnectState, setCalendarConnectState] = useState<'idle' | 'loading' | 'ready' | 'connected'>('idle');
  const [calendarLink, setCalendarLink] = useState('');
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceDurationSeconds, setVoiceDurationSeconds] = useState(0);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceUploading, setVoiceUploading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeResult, setFinalizeResult] = useState<OnboardingFinalizeResponse | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);

  const activeStepIndex = useMemo(
    () => Math.max(0, STEPS.findIndex((step) => step.id === currentStep)),
    [currentStep],
  );
  const activeStep = STEPS[activeStepIndex] ?? STEPS[0];
  const nextStep = STEPS[activeStepIndex + 1];
  const activeStepGuide = STEP_GUIDANCE[currentStep];

  const transcript = session?.transcript ?? [];
  const readyToFinalize = Boolean(session?.calendarConnected && session?.voiceSampleUploaded);
  const recordingSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined';

  async function refreshSession(
    nextSessionId = session?.id,
    nextToken = sessionToken,
    options?: { syncStep?: boolean },
  ) {
    if (!nextSessionId || !nextToken) {
      return null;
    }

    const nextSession = await apiClient.getOnboardingSession(nextSessionId, nextToken);
    setSession(nextSession);
    setCurrentQuestion(nextSession.currentQuestion || '');
    if (options?.syncStep !== false) {
      setCurrentStep(safeStep(nextSession.currentStep));
    }
    return nextSession;
  }

  async function refreshReview(nextSessionId = session?.id, nextToken = sessionToken) {
    if (!nextSessionId || !nextToken) {
      return null;
    }

    setReviewLoading(true);
    setReviewError(null);

    try {
      const nextReview = await apiClient.getOnboardingReview(nextSessionId, nextToken);
      setReview(nextReview);
      setReviewDraft(draftFromReview(nextReview));
      return nextReview;
    } catch (error) {
      setReview(null);
      setReviewError(error instanceof Error ? error.message : 'Unable to load extraction review');
      return null;
    } finally {
      setReviewLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;

    async function hydrateStoredSession(storedSession: StoredOnboardingSession) {
      try {
        const nextSession = await apiClient.getOnboardingSession(storedSession.sessionId, storedSession.sessionToken);
        if (!alive) {
          return;
        }

        setSession(nextSession);
        setSessionToken(storedSession.sessionToken);
        setCurrentQuestion(nextSession.currentQuestion || '');
        setCurrentStep(safeStep(nextSession.currentStep));
        setBootstrapError(null);
        void refreshReview(storedSession.sessionId, storedSession.sessionToken);
      } catch (error) {
        if (!alive) {
          return;
        }

        clearOnboardingSession();
        setSession(null);
        setSessionToken('');
        setCurrentStep('consent');
        setBootstrapError(error instanceof Error ? error.message : 'Saved onboarding session expired.');
      } finally {
        if (alive) {
          setBootstrapLoading(false);
        }
      }
    }

    if (!inviteCode) {
      clearOnboardingSession();
      setBootstrapError('Invite code is required to start onboarding.');
      setBootstrapLoading(false);
      return () => {
        alive = false;
      };
    }

    const stored = readOnboardingSession();
    if (stored && stored.inviteCode === inviteCode) {
      void hydrateStoredSession(stored);
    } else {
      if (stored) {
        clearOnboardingSession();
      }
      setBootstrapLoading(false);
    }

    return () => {
      alive = false;
    };
  }, [inviteCode]);

  useEffect(() => {
    return () => {
      if (voicePreviewUrl) {
        URL.revokeObjectURL(voicePreviewUrl);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current?.stream?.getTracks().forEach((track) => track.stop());
    };
  }, [voicePreviewUrl]);

  const submitConsent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBootstrapError(null);

    if (!consent.recordingConsent || !consent.voiceCloneConsent || !consent.dataProcessingConsent) {
      setBootstrapError('All consent checkboxes must be checked before starting the interview.');
      return;
    }

    setStartingSession(true);

    try {
      const startResponse = await apiClient.startOnboardingSession(inviteCode, consent);
      const nextSession = startResponse.session;

      saveOnboardingSession({
        inviteCode,
        sessionId: nextSession.id,
        sessionToken: startResponse.sessionToken,
      });

      setSession(nextSession);
      setSessionToken(startResponse.sessionToken);
      setCurrentQuestion(nextSession.currentQuestion || '');
      setCurrentStep(nextSession.currentStep || 'interview');
      setReview(null);
      setReviewDraft(createEmptyReviewDraft());
      setCalendarLink('');
      setCalendarMessage(null);
      setFinalizeResult(null);

      void refreshSession(nextSession.id, startResponse.sessionToken);
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : 'Unable to start onboarding session.');
    } finally {
      setStartingSession(false);
    }
  };

  const saveAnswer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session || !sessionToken) {
      setAnswerError('Start the onboarding session first.');
      return;
    }

    const answer = answerDraft.trim();
    if (!answer) {
      setAnswerError('Enter a response before saving the answer.');
      return;
    }

    setAnswerSaving(true);
    setAnswerError(null);

    try {
      await apiClient.submitOnboardingTurn(session.id, sessionToken, {
        text: answer,
        transcriptFormat: 'typed',
      });

      setAnswerDraft('');
      await refreshSession(session.id, sessionToken);
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : 'Unable to save the interview answer.');
    } finally {
      setAnswerSaving(false);
    }
  };

  const probeNextQuestion = async () => {
    if (!session || !sessionToken) {
      setAnswerError('Start the onboarding session first.');
      return;
    }

    setAnswerSaving(true);
    setAnswerError(null);

    try {
      const nextQuestionResponse = await apiClient.requestOnboardingNextQuestion(session.id, sessionToken);
      setCurrentQuestion(nextQuestionResponse.question);
      setCurrentStep('interview');
      await refreshSession(session.id, sessionToken);
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : 'Unable to request the next question.');
    } finally {
      setAnswerSaving(false);
    }
  };

  const openReview = async () => {
    if (!session || !sessionToken) {
      setReviewError('Start the onboarding session first.');
      return;
    }

    setCurrentStep('review');
    await refreshReview(session.id, sessionToken);
  };

  const updateReviewField = (key: keyof OnboardingReviewUpdate, value: string) => {
    setReviewDraft((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const saveReview = async () => {
    if (!session || !sessionToken) {
      setReviewError('Start the onboarding session first.');
      return;
    }

    setReviewLoading(true);
    setReviewError(null);

    try {
      const nextReview = await apiClient.saveOnboardingReview(session.id, sessionToken, reviewDraft);
      setReview(nextReview);
      setReviewDraft(draftFromReview(nextReview));
      void refreshSession(session.id, sessionToken, { syncStep: false }).catch(() => undefined);
      setCurrentStep('calendar');
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Unable to save extraction review.');
    } finally {
      setReviewLoading(false);
    }
  };

  const connectCalendar = async () => {
    if (!session || !sessionToken) {
      setCalendarMessage('Start the onboarding session first.');
      return;
    }

    setCalendarConnectState('loading');
    setCalendarMessage(null);

    try {
      const response = await apiClient.startMicrosoftCalendarConnect(session.id, sessionToken);
      const connectUrl = uploadUrlForCalendarResponse(response);

      if (response.connected) {
        setCalendarConnectState('connected');
        setCalendarMessage(response.accountEmail ? `Microsoft calendar connected for ${response.accountEmail}.` : 'Microsoft calendar connected.');
        void refreshSession(session.id, sessionToken, { syncStep: false }).catch(() => undefined);
        setCurrentStep('voice_sample');
        return;
      }

      if (connectUrl) {
        setCalendarLink(connectUrl);
        setCalendarConnectState('ready');
        setCalendarMessage('Open Microsoft to finish the calendar connection, then come back and refresh status.');
        return;
      }

      setCalendarConnectState('ready');
      setCalendarMessage('Microsoft sign-in could not be started yet. Refresh when the backend is available.');
    } catch (error) {
      setCalendarConnectState('idle');
      setCalendarMessage(error instanceof Error ? error.message : 'Unable to start Microsoft calendar connect.');
    }
  };

  const refreshCalendarStatus = async () => {
    if (!session || !sessionToken) {
      return;
    }

    try {
      const nextSession = await refreshSession(session.id, sessionToken, { syncStep: false });
      if (nextSession?.calendarConnected) {
        setCalendarConnectState('connected');
        setCurrentStep('voice_sample');
        setCalendarMessage('Microsoft calendar is connected.');
      }
    } catch (error) {
      setCalendarMessage(error instanceof Error ? error.message : 'Unable to refresh calendar status.');
    }
  };

  const startVoiceRecording = async () => {
    setVoiceError(null);

    if (!recordingSupported) {
      setVoiceError('This browser does not support microphone recording.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setVoiceBlob(blob);
        const startedAt = recordingStartedAtRef.current ?? Date.now();
        setVoiceDurationSeconds(Math.max(5, Math.round((Date.now() - startedAt) / 1000)));
        recordingStartedAtRef.current = null;
        const nextUrl = URL.createObjectURL(blob);
        setVoicePreviewUrl((currentUrl) => {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }
          return nextUrl;
        });
        stream.getTracks().forEach((track) => track.stop());
        setVoiceRecording(false);
      };

      recorder.start();
      setVoiceRecording(true);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Unable to start microphone recording.');
    }
  };

  const stopVoiceRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const uploadVoiceSample = async () => {
    if (!session || !sessionToken) {
      setVoiceError('Start the onboarding session first.');
      return;
    }

    if (!voiceBlob) {
      setVoiceError('Record a clean voice sample before uploading.');
      return;
    }

    setVoiceUploading(true);
    setVoiceError(null);

    try {
      const result = await apiClient.uploadOnboardingVoiceSample(session.id, sessionToken, {
        blob: voiceBlob,
        sampleLabel: 'Browser voice sample',
        durationSeconds: voiceDurationSeconds || 30,
        transcript: transcript.filter((turn) => turn.speaker === 'staff').map((turn) => turn.text).join(' ').slice(0, 500),
        noiseLevel: 'low',
      });
      if (!result.uploaded) {
        throw new Error('The backend did not accept the voice sample.');
      }

      void refreshSession(session.id, sessionToken, { syncStep: false }).catch(() => undefined);
      setCurrentStep('finalize');
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Unable to upload the voice sample.');
    } finally {
      setVoiceUploading(false);
    }
  };

  const finalizeOnboarding = async () => {
    if (!session || !sessionToken) {
      setVoiceError('Start the onboarding session first.');
      return;
    }

    if (!readyToFinalize) {
      setVoiceError('Complete calendar connection and voice sample upload before finalizing.');
      return;
    }

    setFinalizing(true);
    setVoiceError(null);

    try {
      const result = await apiClient.finalizeOnboarding(session.id, sessionToken);
      setFinalizeResult(result);
      clearOnboardingSession();
      void refreshSession(session.id, sessionToken, { syncStep: false }).catch(() => undefined);
      setCurrentStep('complete');
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Unable to finalize onboarding.');
    } finally {
      setFinalizing(false);
    }
  };

  if (bootstrapLoading) {
    return (
      <div className="shell onboarding-shell">
        <div className="container">
          <div className="card">
            <div className="card-inner">
              <div className="eyebrow">Invite onboarding</div>
              <h1>Preparing your secure onboarding session.</h1>
              <p className="muted">Checking the invite and reloading any existing session state.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (bootstrapError && !session) {
    return (
      <div className="shell onboarding-shell">
        <div className="container">
          <div className="hero onboarding-hero">
            <div className="eyebrow">Invite onboarding</div>
            <h1>Secure staff onboarding for the browser.</h1>
            <p>
              The invite link could not be opened. This page only works with a valid invite code and an active
              onboarding session.
            </p>
          </div>

          <div className="card">
            <div className="card-inner onboarding-error">
              <h2>Invite unavailable</h2>
              <p className="pill warn">{bootstrapError}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (currentStep === 'complete') {
    return (
      <div className="shell onboarding-shell">
        <div className="container onboarding-layout">
          <div className="hero onboarding-hero">
            <div className="eyebrow">Invite onboarding</div>
            <h1>Onboarding complete.</h1>
            <p>The staff profile is ready to hand over to the ops console and downstream routing.</p>
          </div>

          <div className="card">
            <div className="card-inner onboarding-stage">
              <div className="pill good">Session complete</div>
              <h2>{session?.staffName || 'New staff member'}</h2>
              <p className="muted">
                {finalizeResult?.staffId ? `Staff record ${finalizeResult.staffId} has been finalized.` : 'The onboarding session closed successfully.'}
              </p>
              <div className="meta-row">
                <span className="pill accent">Invite {inviteCode}</span>
                <span className={`pill ${statusTone(session)}`}>{session?.status ?? 'complete'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell onboarding-shell">
      <div className="container onboarding-layout">
        <header className="hero onboarding-hero">
          <div className="eyebrow">Invite onboarding</div>
          <h1>Structured voice onboarding for tradies.</h1>
          <p>
            Invite code <code>{inviteCode}</code> opens a secure session for consent, interview, extraction review,
            Microsoft calendar connect, voice sample capture, and finalization. The flow remembers progress on this
            device so it can be resumed without losing context.
          </p>
          <div className="meta-row">
            <span className="pill accent">Step {activeStepIndex + 1} of {STEPS.length}</span>
            <span className={`pill ${statusTone(session)}`}>{session?.status ?? 'invited'}</span>
            {session?.id ? <span className="pill">Session {session.id}</span> : null}
          </div>
        </header>

        <div className="card stage-card">
          <div className="card-inner stage-card-inner">
            <div className="stage-copy">
              <div className="eyebrow">Current stage</div>
              <h2>{activeStepGuide.title}</h2>
              <p className="muted">{activeStepGuide.detail}</p>
            </div>
            <div className="stage-meta">
              <div className="stage-metric">
                <span className="muted">Focus now</span>
                <strong>{activeStep.label}</strong>
              </div>
              <div className="stage-metric">
                <span className="muted">Next up</span>
                <strong>{nextStep?.label ?? 'Complete'}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="stepper" aria-label="Onboarding steps">
          {STEPS.map((step, index) => (
            <div className={`step ${index === activeStepIndex ? 'current' : ''} ${index < activeStepIndex ? 'complete' : ''}`} key={step.id}>
              <span className="step-index">{index + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <div className="muted">{step.description}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid onboarding-grid">
          <section className="stack">
            {currentStep === 'consent' ? (
              <div className="card">
                <div className="card-inner onboarding-stage">
                  <div className="eyebrow">Consent</div>
                  <h2>Confirm the onboarding permissions before we begin.</h2>
                  <p className="muted">
                    The session will only start after every consent item is checked. No placeholder session is created.
                  </p>

                  <form className="form-stack" onSubmit={submitConsent}>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={consent.recordingConsent}
                        onChange={(event) =>
                          setConsent((current) => ({ ...current, recordingConsent: event.target.checked }))
                        }
                      />
                      <span>I consent to recording the interview for onboarding and internal review.</span>
                    </label>

                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={consent.voiceCloneConsent}
                        onChange={(event) =>
                          setConsent((current) => ({ ...current, voiceCloneConsent: event.target.checked }))
                        }
                      />
                      <span>I consent to using a clean voice sample for voice cloning.</span>
                    </label>

                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={consent.dataProcessingConsent}
                        onChange={(event) =>
                          setConsent((current) => ({ ...current, dataProcessingConsent: event.target.checked }))
                        }
                      />
                      <span>I consent to using my onboarding responses to build my staff profile.</span>
                    </label>

                    <div className="inline-actions">
                      <button className="button" type="submit" disabled={startingSession}>
                        {startingSession ? 'Starting...' : 'Begin interview'}
                      </button>
                    </div>
                  </form>

                  {bootstrapError ? <p className="pill warn">{bootstrapError}</p> : null}
                </div>
              </div>
            ) : null}

            {currentStep === 'interview' ? (
              <div className="card">
                <div className="card-inner onboarding-stage">
                  <div className="eyebrow">Interview</div>
                  <h2>Answer the structured interview.</h2>
                  <p className="muted">
                    The deeper analyst will be used later to generate follow-up probes and extraction coverage.
                  </p>

                  <div className="conversation-card">
                    <div className="conversation-header">
                      <span className="pill accent">Current question</span>
                      <button className="button secondary" type="button" onClick={() => void probeNextQuestion()}>
                        Ask next question
                      </button>
                    </div>
                    <p>{currentQuestion || 'The next interview prompt will appear here once the session is active.'}</p>
                  </div>

                  <form className="form-stack" onSubmit={saveAnswer}>
                    <label className="field">
                      <span>Your response</span>
                      <textarea
                        className="text-area"
                        rows={6}
                        value={answerDraft}
                        onChange={(event) => setAnswerDraft(event.target.value)}
                        placeholder="Type the response that the voice interviewer would have captured."
                      />
                    </label>

                    <div className="inline-actions">
                      <button className="button" type="submit" disabled={answerSaving}>
                        {answerSaving ? 'Saving...' : 'Save response'}
                      </button>
                      <button className="button secondary" type="button" onClick={() => void openReview()}>
                        Open extraction review
                      </button>
                    </div>
                  </form>

                  {answerError ? <p className="pill warn">{answerError}</p> : null}
                  <div className="transcript-stack">
                    <h3>Transcript</h3>
                    {transcript.length ? (
                      transcript.map((turn) => (
                        <div className="transcript-item" key={turn.id}>
                          <div className="meta-row">
                            <span className={`pill ${turn.speaker === 'staff' ? 'accent' : 'neutral'}`}>{turn.speaker}</span>
                            <span className="muted">{turn.createdAt}</span>
                          </div>
                          <p>{turn.text}</p>
                        </div>
                      ))
                    ) : (
                      <p className="muted">The live transcript will appear here after the first saved answer.</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {currentStep === 'review' ? (
              <div className="card">
                <div className="card-inner onboarding-stage">
                  <div className="eyebrow">Extraction review</div>
                  <h2>Review the extracted profile before it becomes canonical.</h2>
                  <p className="muted">
                    This is where gaps get resolved before calendar and voice setup continue.
                  </p>

                  {!review && !reviewLoading ? (
                    <div className="inline-actions">
                      <button className="button" type="button" onClick={() => void refreshReview()}>
                        Load extraction review
                      </button>
                    </div>
                  ) : null}

                  {reviewLoading ? <p className="pill accent">Loading extraction review...</p> : null}
                  {reviewError ? <p className="pill warn">{reviewError}</p> : null}

                  {review ? (
                    <div className="review-grid">
                      <div className="review-summary card">
                        <div className="card-inner">
                          <h3>Summary</h3>
                          <p>{review.summary}</p>
                          <div className="meta-row">
                            <span className="pill">Confidence {review.confidence}</span>
                            <span className="pill warn">{review.missingItems.length} missing items</span>
                          </div>
                        </div>
                      </div>

                      <div className="review-checklist">
                        <h3>Coverage checklist</h3>
                        <div className="jobs">
                          {review.checklist.map((item) => (
                            <div className="job" key={item.label}>
                              <div className="job-header">
                                <strong>{item.label}</strong>
                                <span className={`pill ${item.status === 'done' ? 'good' : item.status === 'partial' ? 'accent' : 'warn'}`}>
                                  {item.status}
                                </span>
                              </div>
                              {item.notes ? <div className="muted">{item.notes}</div> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="review-form">
                    {REVIEW_FIELDS.map((field) => (
                      <label className="field" key={field.key}>
                        <span>{field.label}</span>
                        <input
                          type="text"
                          value={(reviewDraft[field.key] as string | undefined) ?? ''}
                          placeholder={field.placeholder}
                          onChange={(event) => updateReviewField(field.key, event.target.value)}
                        />
                      </label>
                    ))}

                    <label className="field">
                      <span>Review summary</span>
                      <textarea
                        className="text-area"
                        rows={4}
                        value={reviewDraft.summary ?? ''}
                        onChange={(event) => updateReviewField('summary', event.target.value)}
                      />
                    </label>

                    <div className="inline-actions">
                      <button className="button" type="button" onClick={() => void saveReview()} disabled={reviewLoading}>
                        {reviewLoading ? 'Saving...' : 'Save review and continue'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {currentStep === 'calendar' ? (
              <div className="card">
                <div className="card-inner onboarding-stage">
                  <div className="eyebrow">Calendar connect</div>
                  <h2>Connect the staff calendar.</h2>
                  <p className="muted">
                    Microsoft calendar auth is launched from the backend so the browser never sees the secret material.
                  </p>

                  <div className="calendar-card">
                    <div className="meta-row">
                      <span className="pill accent">Microsoft</span>
                      <span className={`pill ${session?.calendarConnected ? 'good' : 'warn'}`}>
                        {session?.calendarConnected ? 'Connected' : 'Not connected yet'}
                      </span>
                    </div>

                    <div className="inline-actions">
                      <button className="button" type="button" onClick={() => void connectCalendar()} disabled={calendarConnectState === 'loading'}>
                        {calendarConnectState === 'loading' ? 'Starting Microsoft auth...' : 'Connect Microsoft calendar'}
                      </button>
                      <button className="button secondary" type="button" onClick={() => void refreshCalendarStatus()}>
                        Refresh status
                      </button>
                    </div>

                    {calendarLink ? (
                      <a className="calendar-link" href={calendarLink} target="_blank" rel="noreferrer">
                        Open Microsoft connection link
                      </a>
                    ) : null}

                    {calendarMessage ? <p className="pill accent">{calendarMessage}</p> : null}

                    {session?.calendarConnected ? (
                      <div className="inline-actions">
                        <button className="button" type="button" onClick={() => setCurrentStep('voice_sample')}>
                          Continue to voice sample
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {currentStep === 'voice_sample' ? (
              <div className="card">
                <div className="card-inner onboarding-stage">
                  <div className="eyebrow">Voice sample</div>
                  <h2>Capture a clean sample for cloning.</h2>
                  <p className="muted">
                    Use the browser microphone and keep the sample short, quiet, and consistent.
                  </p>

                  {!recordingSupported ? <p className="pill warn">This browser does not support microphone recording.</p> : null}

                  <div className="voice-controls">
                    <div className="inline-actions">
                      {!voiceRecording ? (
                        <button className="button" type="button" onClick={() => void startVoiceRecording()} disabled={!recordingSupported}>
                          Start recording
                        </button>
                      ) : (
                        <button className="button secondary" type="button" onClick={stopVoiceRecording}>
                          Stop recording
                        </button>
                      )}
                      <button className="button" type="button" onClick={() => void uploadVoiceSample()} disabled={voiceUploading || !voiceBlob}>
                        {voiceUploading ? 'Uploading...' : 'Upload sample'}
                      </button>
                    </div>

                    {voicePreviewUrl ? (
                      <audio controls src={voicePreviewUrl} className="voice-preview">
                        Your browser does not support the audio element.
                      </audio>
                    ) : null}

                    <div className="meta-row">
                      <span className="pill">{voiceRecording ? 'Recording live' : 'Idle'}</span>
                      <span className="pill">{voiceBlob ? 'Sample captured' : 'No sample yet'}</span>
                    </div>
                  </div>

                  {voiceError ? <p className="pill warn">{voiceError}</p> : null}

                  {session?.voiceSampleUploaded ? (
                    <div className="inline-actions">
                      <button className="button" type="button" onClick={() => setCurrentStep('finalize')}>
                        Continue to finalize
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {currentStep === 'finalize' ? (
              <div className="card">
                <div className="card-inner onboarding-stage">
                  <div className="eyebrow">Finalize</div>
                  <h2>Lock the onboarding profile.</h2>
                  <p className="muted">
                    The session is ready to close once the calendar and voice sample are both complete.
                  </p>

                  <div className="review-summary card">
                    <div className="card-inner">
                      <div className="meta-row">
                        <span className="pill">{session?.calendarConnected ? 'Calendar connected' : 'Calendar pending'}</span>
                        <span className="pill">{session?.voiceSampleUploaded ? 'Voice sample uploaded' : 'Voice sample pending'}</span>
                        <span className="pill">{readyToFinalize ? 'Ready to finalize' : 'Still waiting'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="inline-actions">
                    <button className="button" type="button" onClick={() => void finalizeOnboarding()} disabled={finalizing || !readyToFinalize}>
                      {finalizing ? 'Finalizing...' : 'Finalize onboarding'}
                    </button>
                  </div>

                  {voiceError ? <p className="pill warn">{voiceError}</p> : null}
                </div>
              </div>
            ) : null}
          </section>

          <aside className="stack">
            <div className="card">
              <div className="card-inner onboarding-sidebar">
                <div className="eyebrow">Session snapshot</div>
                <h3>{session?.staffName || 'New onboarding session'}</h3>
                <p className="muted">
                  {session?.summary || 'The session will populate as the interview and extraction review progress.'}
                </p>

                <div className="snapshot-grid">
                  <div className="stat">
                    <span className="muted">Interview turns</span>
                    <strong>{transcript.length}</strong>
                  </div>
                  <div className="stat">
                    <span className="muted">Review confidence</span>
                    <strong>{review?.confidence ?? 'pending'}</strong>
                  </div>
                  <div className="stat">
                    <span className="muted">Calendar</span>
                    <strong>{session?.calendarConnected ? 'Connected' : 'Pending'}</strong>
                  </div>
                  <div className="stat">
                    <span className="muted">Voice sample</span>
                    <strong>{session?.voiceSampleUploaded ? 'Uploaded' : 'Pending'}</strong>
                  </div>
                </div>

                <div className="meta-row">
                  <span className="pill accent">Invite {inviteCode}</span>
                  {session?.id ? <span className="pill">Session {session.id}</span> : null}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-inner onboarding-sidebar">
                <div className="eyebrow">Guidance</div>
                <h3>What this onboarding flow captures</h3>
                <ul className="guide-list">
                  <li>Consent for recording and cloning.</li>
                  <li>Structured interview answers and follow-up probes.</li>
                  <li>Editable extraction of business, pricing, and communication preferences.</li>
                  <li>Calendar connect and a separate clean voice sample.</li>
                  <li>Finalized staff profile ready for the ops console and the later mobile app.</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
