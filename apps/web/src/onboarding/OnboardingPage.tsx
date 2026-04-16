import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { onboardingBrand, onboardingBrandStyle } from '../brand';
import { PublicActionCard, PublicFactStrip, PublicSidePanel } from '../../../../packages/shared/src/publicShell';
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
  { id: 'consent', label: 'Permissions', description: 'Say yes so we can start.' },
  { id: 'interview', label: 'Questions', description: 'Answer a few simple questions.' },
  { id: 'review', label: 'Check details', description: 'Make sure your details look right.' },
  { id: 'calendar', label: 'Calendar', description: 'Connect your Microsoft calendar.' },
  { id: 'voice_sample', label: 'Voice', description: 'Record a short voice sample.' },
  { id: 'finalize', label: 'Finish', description: 'Finish setup.' },
  { id: 'complete', label: 'Complete', description: 'Setup is done.' },
];

const VISIBLE_STEPS = STEPS.filter((step) => step.id !== 'complete');

const STEP_GUIDANCE: Record<OnboardingStep, { title: string; detail: string }> = {
  consent: {
    title: 'Say yes so we can set this up for you.',
    detail: 'You only do this once. Then we can build the assistant around your jobs and voice.',
  },
  interview: {
    title: 'Answer in plain words.',
    detail: 'Write it the way you would explain it to a new office person.',
  },
  review: {
    title: 'Check the details before you move on.',
    detail: 'Fix names, services, prices, and handoff rules here.',
  },
  calendar: {
    title: 'Connect the calendar you use for jobs.',
    detail: 'We use this to book work into the right calendar.',
  },
  voice_sample: {
    title: 'Record a short clean voice sample.',
    detail: 'Use your normal voice and record somewhere quiet if you can.',
  },
  finalize: {
    title: 'Finish the setup.',
    detail: 'Finish only after the calendar and voice sample are both done.',
  },
  complete: {
    title: 'Setup is done.',
    detail: 'Your details are saved and ready to use.',
  },
};

const REVIEW_FIELDS: Array<{
  key: keyof OnboardingReviewProfile;
  label: string;
  placeholder: string;
}> = [
  { key: 'staffName', label: 'Your name', placeholder: 'Name to show customers' },
  { key: 'companyName', label: 'Business name', placeholder: 'Business or trading name' },
  { key: 'role', label: 'Your role', placeholder: 'Owner, office, senior tradie...' },
  { key: 'serviceArea', label: 'Work area', placeholder: 'Suburbs or area you cover' },
  { key: 'services', label: 'Jobs you do', placeholder: 'Plumbing, electrical, HVAC...' },
  { key: 'hours', label: 'Work hours', placeholder: 'Normal hours and after-hours rules' },
  { key: 'pricingPreference', label: 'How you price jobs', placeholder: 'Fixed price, callout plus labour...' },
  { key: 'communicationStyle', label: 'How the assistant should sound', placeholder: 'Direct, friendly, short...' },
  { key: 'salesStyle', label: 'How hard to sell', placeholder: 'Soft sell, direct, helpful...' },
  { key: 'riskTolerance', label: 'What it can promise', placeholder: 'What it can quote or book without asking you' },
  { key: 'escalationRules', label: 'When to pass to you', placeholder: 'When the assistant should stop and ask you' },
  { key: 'exclusions', label: 'Jobs to avoid', placeholder: 'Work the assistant should never book' },
  { key: 'calendarProvider', label: 'Calendar app', placeholder: 'Microsoft, Google...' },
  { key: 'crmProvider', label: 'Job system', placeholder: 'ServiceM8, simPRO, Jobber...' },
];

const REVIEW_GROUPS: Array<{
  title: string;
  description: string;
  fields: Array<typeof REVIEW_FIELDS[number]>;
}> = [
  {
    title: 'Business basics',
    description: 'Who you are, what the business is called, and where you work.',
    fields: REVIEW_FIELDS.filter((field) => ['staffName', 'companyName', 'role', 'serviceArea', 'services', 'hours'].includes(field.key)),
  },
  {
    title: 'How the assistant should talk',
    description: 'Set the tone, selling style, and when it should stop and ask you.',
    fields: REVIEW_FIELDS.filter((field) =>
      ['communicationStyle', 'salesStyle', 'riskTolerance', 'escalationRules', 'exclusions'].includes(field.key),
    ),
  },
  {
    title: 'Pricing and systems',
    description: 'How jobs get priced and which tools you already use.',
    fields: REVIEW_FIELDS.filter((field) => ['pricingPreference', 'calendarProvider', 'crmProvider'].includes(field.key)),
  },
];

function safeStep(value: string | undefined): OnboardingStep {
  const matches = STEPS.find((step) => step.id === value);
  return matches?.id ?? 'consent';
}

function isStepAtOrAfter(step: OnboardingStep, target: OnboardingStep): boolean {
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const targetIndex = STEPS.findIndex((item) => item.id === target);
  if (stepIndex === -1 || targetIndex === -1) {
    return false;
  }
  return stepIndex >= targetIndex;
}

function formatTurnTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
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
  return response.authorizationUrl ?? '';
}

export default function OnboardingPage() {
  const { inviteCode: inviteParam = '' } = useParams();
  const inviteCode = inviteParam.trim();
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [session, setSession] = useState<OnboardingSession | null>(null);
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

  const transcript = session?.transcript ?? [];
  const readyToFinalize = Boolean(session?.calendarConnected && session?.voiceSampleUploaded);
  const recordingSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined';

  async function hydrateInterviewQuestion(nextSession: OnboardingSession) {
    const nextStep = safeStep(nextSession.currentStep);
    if (nextStep !== 'interview' || nextSession.currentQuestion) {
      return nextSession.currentQuestion || '';
    }

    try {
      const nextQuestionResponse = await apiClient.requestOnboardingNextQuestion(nextSession.id);
      setCurrentQuestion(nextQuestionResponse.question);
      return nextQuestionResponse.question;
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : 'Could not load the first question.');
      return '';
    }
  }

  function applySession(nextSession: OnboardingSession, options?: { syncStep?: boolean }) {
    setSession(nextSession);
    if (options?.syncStep !== false) {
      setCurrentStep(safeStep(nextSession.currentStep));
    }
    setCurrentQuestion(nextSession.currentQuestion || '');
  }

  async function refreshSession(nextSessionId = session?.id, options?: { syncStep?: boolean }) {
    if (!nextSessionId) {
      return null;
    }

    const nextSession = await apiClient.getOnboardingSession(nextSessionId);
    applySession(nextSession, options);
    if (!nextSession.currentQuestion) {
      await hydrateInterviewQuestion(nextSession);
    }
    return nextSession;
  }

  async function refreshReview(nextSessionId = session?.id) {
    if (!nextSessionId) {
      return null;
    }

    setReviewLoading(true);
    setReviewError(null);

    try {
      const nextReview = await apiClient.getOnboardingReview(nextSessionId);
      setReview(nextReview);
      setReviewDraft(draftFromReview(nextReview));
      return nextReview;
    } catch (error) {
      setReview(null);
      setReviewError(error instanceof Error ? error.message : 'Could not load your details.');
      return null;
    } finally {
      setReviewLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    setBootstrapLoading(true);
    setBootstrapError(null);
    setSession(null);
    setCurrentStep('consent');
    setConsent(createBlankConsent());
    setCurrentQuestion('');
    setAnswerDraft('');
    setAnswerError(null);
    setReview(null);
    setReviewDraft(createEmptyReviewDraft());
    setReviewError(null);
    setCalendarConnectState('idle');
    setCalendarLink('');
    setCalendarMessage(null);
    setVoiceRecording(false);
    setVoiceBlob(null);
    setVoiceDurationSeconds(0);
    setVoicePreviewUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
      return '';
    });
    setVoiceError(null);
    setFinalizeResult(null);

    async function hydrateInviteSession(nextInviteCode: string) {
      try {
        const nextSession = await apiClient.resumeOnboardingSession(nextInviteCode);
        if (!alive) {
          return;
        }

        if (!nextSession) {
          setSession(null);
          setCurrentStep('consent');
          setBootstrapError(null);
          return;
        }

        const nextStep = safeStep(nextSession.currentStep);
        applySession(nextSession);
        setBootstrapError(null);
        if (!nextSession.currentQuestion) {
          await hydrateInterviewQuestion(nextSession);
        }
        if (nextStep === 'review') {
          void refreshReview(nextSession.id);
        }
      } catch (error) {
        if (!alive) {
          return;
        }

        setSession(null);
        setCurrentStep('consent');
        setBootstrapError(error instanceof Error ? error.message : 'This setup link is no longer available.');
      } finally {
        if (alive) {
          setBootstrapLoading(false);
        }
      }
    }

    if (!inviteCode) {
      setBootstrapError('Invite code is required to start onboarding.');
      setBootstrapLoading(false);
      return () => {
        alive = false;
      };
    }

    void hydrateInviteSession(inviteCode);

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
      setBootstrapError('Please tick all three boxes before you start.');
      return;
    }

    setStartingSession(true);

    try {
      const startResponse = await apiClient.startOnboardingSession(inviteCode, consent);
      const nextSession = startResponse.session;

      applySession(nextSession);
      setReview(null);
      setReviewDraft(createEmptyReviewDraft());
      setCalendarLink('');
      setCalendarMessage(null);
      setFinalizeResult(null);
      if (!nextSession.currentQuestion) {
        await hydrateInterviewQuestion(nextSession);
      }
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : 'Could not start setup.');
    } finally {
      setStartingSession(false);
    }
  };

  const saveAnswer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session) {
      setAnswerError('Start setup first.');
      return;
    }

    const answer = answerDraft.trim();
    if (!answer) {
      setAnswerError('Type an answer before you save.');
      return;
    }

    setAnswerSaving(true);
    setAnswerError(null);

    try {
      const nextSession = await apiClient.submitOnboardingTurn(session.id, {
        text: answer,
        transcriptFormat: 'typed',
      });

      setAnswerDraft('');
      applySession(nextSession);
      if (!nextSession.currentQuestion && safeStep(nextSession.currentStep) === 'interview') {
        await hydrateInterviewQuestion(nextSession);
      }
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : 'Could not save your answer.');
    } finally {
      setAnswerSaving(false);
    }
  };

  const probeNextQuestion = async () => {
    if (!session) {
      setAnswerError('Start setup first.');
      return;
    }

    setAnswerSaving(true);
    setAnswerError(null);

    try {
      const nextQuestionResponse = await apiClient.requestOnboardingNextQuestion(session.id);
      setCurrentQuestion(nextQuestionResponse.question);
      setCurrentStep('interview');
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : 'Could not load the next question.');
    } finally {
      setAnswerSaving(false);
    }
  };

  const openReview = async () => {
    if (!session) {
      setReviewError('Start setup first.');
      return;
    }

    setCurrentStep('review');
    await refreshReview(session.id);
  };

  const updateReviewField = (key: keyof OnboardingReviewUpdate, value: string) => {
    setReviewDraft((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const saveReview = async () => {
    if (!session) {
      setReviewError('Start setup first.');
      return;
    }

    setReviewLoading(true);
    setReviewError(null);

    try {
      const nextResponse = await apiClient.saveOnboardingReview(session.id, reviewDraft);
      setReview(nextResponse.review);
      setReviewDraft(draftFromReview(nextResponse.review));
      applySession(nextResponse.session);
      setCurrentStep('calendar');
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Could not save your details.');
    } finally {
      setReviewLoading(false);
    }
  };

  const connectCalendar = async () => {
    if (!session) {
      setCalendarMessage('Start setup first.');
      return;
    }

    setCalendarConnectState('loading');
    setCalendarMessage(null);

    try {
      const response = await apiClient.startMicrosoftCalendarConnect(session.id);
      const connectUrl = uploadUrlForCalendarResponse(response);
      if (response.session) {
        applySession(response.session, { syncStep: false });
      }

      if (response.connected) {
        setCalendarConnectState('connected');
        setCalendarMessage(response.accountEmail ? `Calendar connected for ${response.accountEmail}.` : 'Calendar connected.');
        setCurrentStep('voice_sample');
        return;
      }

      if (connectUrl) {
        setCalendarLink(connectUrl);
        setCalendarConnectState('ready');
        setCalendarMessage('Open Microsoft, finish sign-in, then come back here.');
        return;
      }

      setCalendarConnectState('ready');
      setCalendarMessage('Microsoft sign-in could not start yet. Try again in a moment.');
    } catch (error) {
      setCalendarConnectState('idle');
      setCalendarMessage(error instanceof Error ? error.message : 'Could not start Microsoft sign-in.');
    }
  };

  const refreshCalendarStatus = async () => {
    if (!session) {
      return;
    }

    try {
      const nextSession = await refreshSession(session.id, { syncStep: false });
      if (nextSession?.calendarConnected) {
        setCalendarConnectState('connected');
        setCurrentStep('voice_sample');
        setCalendarMessage('Calendar is connected.');
      }
    } catch (error) {
      setCalendarMessage(error instanceof Error ? error.message : 'Could not check the calendar yet.');
    }
  };

  const startVoiceRecording = async () => {
    setVoiceError(null);

    if (!recordingSupported) {
      setVoiceError('This browser cannot record audio.');
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
      setVoiceError(error instanceof Error ? error.message : 'Could not start recording.');
    }
  };

  const stopVoiceRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const uploadVoiceSample = async () => {
    if (!session) {
      setVoiceError('Start setup first.');
      return;
    }

    if (!voiceBlob) {
      setVoiceError('Record your voice before you upload.');
      return;
    }

    setVoiceUploading(true);
    setVoiceError(null);

    try {
      const result = await apiClient.uploadOnboardingVoiceSample(session.id, {
        blob: voiceBlob,
        sampleLabel: 'Browser voice sample',
        durationSeconds: voiceDurationSeconds || 30,
        transcript: transcript.filter((turn) => turn.speaker === 'staff').map((turn) => turn.text).join(' ').slice(0, 500),
        noiseLevel: 'low',
      });
      if (!result.uploaded) {
        throw new Error('The voice sample was not accepted.');
      }

      void refreshSession(session.id, { syncStep: false }).catch(() => undefined);
      setCurrentStep('finalize');
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Could not upload your voice.');
    } finally {
      setVoiceUploading(false);
    }
  };

  const finalizeOnboarding = async () => {
    if (!session) {
      setVoiceError('Start setup first.');
      return;
    }

    if (!readyToFinalize) {
      setVoiceError('Finish the calendar and voice steps first.');
      return;
    }

    setFinalizing(true);
    setVoiceError(null);

    try {
      const result = await apiClient.finalizeOnboarding(session.id);
      setFinalizeResult(result);
      setSession((current) =>
        current
          ? {
              ...current,
              status: 'complete',
            }
          : current,
      );
      setCurrentStep('complete');
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : 'Could not finish setup.');
    } finally {
      setFinalizing(false);
    }
  };

  if (bootstrapLoading) {
    return (
      <div className="shell onboarding-shell" style={onboardingBrandStyle}>
        <div className="container">
          <div className="card">
            <div className="card-inner">
              <div className="eyebrow">{onboardingBrand.eyebrow}</div>
              <h1>Getting your setup ready.</h1>
              <p className="muted">Checking your link and loading the next step.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (bootstrapError && !session) {
    return (
      <div className="shell onboarding-shell" style={onboardingBrandStyle}>
        <div className="container">
          <div className="hero onboarding-hero">
            <div className="eyebrow">{onboardingBrand.eyebrow}</div>
            <h1>We could not open this setup link.</h1>
            <p>This page only works with a valid private setup link.</p>
          </div>

          <div className="card">
            <div className="card-inner onboarding-error">
              <h2>Invite unavailable</h2>
              <p className="pill warn">{bootstrapError}</p>
              <p className="muted">Ask the person who sent this setup link to text or email you a new one.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (currentStep === 'complete') {
    return (
      <div className="shell onboarding-shell" style={onboardingBrandStyle}>
        <div className="container onboarding-layout">
          <div className="hero onboarding-hero">
            <div className="eyebrow">{onboardingBrand.eyebrow}</div>
            <h1>Setup complete.</h1>
            <p>Your details are saved and ready to use.</p>
          </div>

          <div className="card">
            <div className="card-inner onboarding-stage">
              <div className="pill good">All done</div>
              <h2>{session?.staffName || 'New staff member'}</h2>
              <p className="muted">
                {finalizeResult?.staffId ? 'Your setup is saved and ready to use.' : 'Your setup has been saved.'}
              </p>
              <ul className="guide-list compact">
                <li>Your business details and rules are saved.</li>
                <li>Your calendar and voice sample are attached to this setup.</li>
                <li>You can close this page now.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeStepIndex = Math.max(0, VISIBLE_STEPS.findIndex((step) => step.id === currentStep));
  const activeStep = VISIBLE_STEPS[activeStepIndex] ?? VISIBLE_STEPS[0];
  const nextStep = STEPS[STEPS.findIndex((step) => step.id === currentStep) + 1];
  const activeStepGuide = STEP_GUIDANCE[currentStep];

  return (
    <div className="shell onboarding-shell" style={onboardingBrandStyle}>
      <div className="container onboarding-layout">
        <header className="hero onboarding-hero">
          <div className="eyebrow">{onboardingBrand.eyebrow}</div>
          <h1>Set up your assistant.</h1>
          <p>This private link sets up how the assistant talks, books, and handles your jobs. Keep this page open until you finish.</p>
          <div className="meta-row">
            <span className="pill accent">Step {activeStepIndex + 1} of {VISIBLE_STEPS.length}</span>
            <span className="pill">Private setup link</span>
            <span className="pill">Best done in one go</span>
          </div>
        </header>

        <div className="card stage-card stage-card--summary">
          <div className="card-inner stage-card-inner">
            <div className="stage-copy">
              <div className="eyebrow">Right now</div>
              <h2>{activeStepGuide.title}</h2>
              <p className="muted">{activeStepGuide.detail}</p>
            </div>
            <PublicFactStrip
              className="stage-fact-strip"
              facts={[
                { label: 'Do this now', value: activeStep.label, tone: 'accent' },
                { label: 'Then this', value: nextStep?.label ?? 'Complete' },
                { label: 'Progress', value: `${activeStepIndex + 1} of ${VISIBLE_STEPS.length}` },
              ]}
            />
          </div>
        </div>

        <div className="stepper" aria-label="Onboarding steps">
          {VISIBLE_STEPS.map((step, index) => (
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
              <PublicActionCard
                eyebrow="Permissions"
                title="Say yes to these three things first."
                description="This lets us set up the assistant properly and saves you doing it again later."
                className="onboarding-stage-card"
              >
                  <div className="support-grid">
                    <div className="support-card">
                      <strong>What this setup covers</strong>
                      <ul className="guide-list compact">
                        <li>Your jobs, pricing, and handoff rules.</li>
                        <li>Your calendar connection for bookings.</li>
                        <li>Your voice sample so the assistant sounds more like you.</li>
                      </ul>
                    </div>
                    <div className="support-card">
                      <strong>Good to know</strong>
                      <ul className="guide-list compact">
                        <li>You can check and fix the details before you finish.</li>
                        <li>Nothing gets booked until you connect your calendar.</li>
                        <li>You only need microphone access for the voice step.</li>
                      </ul>
                    </div>
                  </div>

                  <form className="form-stack" onSubmit={submitConsent}>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={consent.recordingConsent}
                        onChange={(event) =>
                          setConsent((current) => ({ ...current, recordingConsent: event.target.checked }))
                        }
                      />
                      <span>Yes, you can record this setup so we do not miss anything.</span>
                    </label>

                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={consent.voiceCloneConsent}
                        onChange={(event) =>
                          setConsent((current) => ({ ...current, voiceCloneConsent: event.target.checked }))
                        }
                      />
                      <span>Yes, you can use my voice sample so the assistant sounds like me.</span>
                    </label>

                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={consent.dataProcessingConsent}
                        onChange={(event) =>
                          setConsent((current) => ({ ...current, dataProcessingConsent: event.target.checked }))
                        }
                      />
                      <span>Yes, you can use my answers to set up my jobs, prices, and rules.</span>
                    </label>

                    <div className="inline-actions">
                      <button className="button" type="submit" disabled={startingSession}>
                        {startingSession ? 'Starting...' : 'Start setup'}
                      </button>
                    </div>
                  </form>

                  {bootstrapError ? <p className="pill warn">{bootstrapError}</p> : null}
              </PublicActionCard>
            ) : null}

            {currentStep === 'interview' ? (
              <PublicActionCard
                eyebrow="Questions"
                title="Answer a few questions."
                description="Keep it simple. Type it how you would say it on the phone."
                className="onboarding-stage-card"
              >

                  <div className="conversation-card">
                    <div className="conversation-header">
                      <span className="pill accent">Question</span>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => void probeNextQuestion()}
                        disabled={answerSaving}
                      >
                        {answerSaving ? 'Loading...' : 'Next question'}
                      </button>
                    </div>
                    <p>{currentQuestion || 'Your next question will show here.'}</p>
                  </div>

                  <form className="form-stack" onSubmit={saveAnswer}>
                    <label className="field">
                      <span>Your answer</span>
                      <textarea
                        className="text-area"
                        rows={6}
                        value={answerDraft}
                        onChange={(event) => setAnswerDraft(event.target.value)}
                        placeholder="Type your answer here."
                      />
                    </label>

                    <div className="inline-actions">
                      <button className="button" type="submit" disabled={answerSaving}>
                        {answerSaving ? 'Saving...' : 'Save answer'}
                      </button>
                      <button className="button secondary" type="button" onClick={() => void openReview()} disabled={answerSaving}>
                        Check details
                      </button>
                    </div>
                  </form>

                  {answerError ? <p className="pill warn">{answerError}</p> : null}
                  <div className="transcript-stack">
                    <h3>Your answers</h3>
                    {transcript.length ? (
                      transcript.map((turn) => (
                        <div className="transcript-item" key={turn.id}>
                          <div className="meta-row">
                            <span className={`pill ${turn.speaker === 'staff' ? 'accent' : 'neutral'}`}>{turn.speaker}</span>
                            {formatTurnTimestamp(turn.createdAt) ? <span className="muted">{formatTurnTimestamp(turn.createdAt)}</span> : null}
                          </div>
                          <p>{turn.text}</p>
                        </div>
                      ))
                    ) : (
                      <p className="muted">Your answers will show here after you save the first one.</p>
                    )}
                  </div>
              </PublicActionCard>
            ) : null}

            {currentStep === 'review' ? (
              <PublicActionCard
                eyebrow="Check details"
                title="Make sure these details look right."
                description="Fix anything wrong before you move on."
                className="onboarding-stage-card"
              >

                  {!review && !reviewLoading ? (
                    <div className="inline-actions">
                      <button className="button" type="button" onClick={() => void refreshReview()}>
                        Load details
                      </button>
                    </div>
                  ) : null}

                  {reviewLoading ? <p className="pill accent">Loading details...</p> : null}
                  {reviewError ? <p className="pill warn">{reviewError}</p> : null}

                  {review ? (
                    <div className="review-grid">
                      <div className="review-summary card">
                        <div className="card-inner">
                          <h3>Summary</h3>
                          <p>{review.summary}</p>
                          <div className="meta-row">
                            <span className="pill">Confidence {review.confidence}</span>
                            <span className={`pill ${review.missingItems.length ? 'warn' : 'good'}`}>
                              {review.missingItems.length ? `${review.missingItems.length} still to check` : 'Looks good'}
                            </span>
                          </div>
                          {review.missingItems.length ? (
                            <div className="review-alert-list">
                              {review.missingItems.map((item) => (
                                <div className="review-alert-item" key={item}>
                                  {item}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="review-checklist">
                        <h3>Checklist</h3>
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
                    {REVIEW_GROUPS.map((group) => (
                      <div className="review-section-card" key={group.title}>
                        <div className="review-section-header">
                          <h3>{group.title}</h3>
                          <p className="muted">{group.description}</p>
                        </div>
                        <div className="review-section-fields">
                          {group.fields.map((field) => (
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
                        </div>
                      </div>
                    ))}

                    <div className="review-section-card">
                      <div className="review-section-header">
                        <h3>Short summary</h3>
                        <p className="muted">Write the one-para summary the assistant should work from.</p>
                      </div>
                      <label className="field">
                        <span>Review summary</span>
                        <textarea
                          className="text-area"
                          rows={4}
                          value={reviewDraft.summary ?? ''}
                          onChange={(event) => updateReviewField('summary', event.target.value)}
                        />
                      </label>
                    </div>

                    <div className="inline-actions review-actions">
                      <button className="button" type="button" onClick={() => void saveReview()} disabled={reviewLoading}>
                        {reviewLoading ? 'Saving...' : review?.missingItems.length ? 'Save anyway and keep going' : 'Save and keep going'}
                      </button>
                    </div>
                  </div>
              </PublicActionCard>
            ) : null}

            {currentStep === 'calendar' ? (
              <PublicActionCard
                eyebrow="Calendar"
                title="Connect your calendar."
                description="Tap the button below. Microsoft opens in a new tab. When you finish there, come back here and check again."
                className="onboarding-stage-card"
              >
                  <div className="support-card">
                    <strong>Quick steps</strong>
                    <ul className="guide-list compact">
                      <li>Tap <strong>Connect Microsoft</strong>.</li>
                      <li>Finish the sign-in in the new tab.</li>
                      <li>Come back here and tap <strong>I’m back, check again</strong>.</li>
                    </ul>
                  </div>

                  <div className="calendar-card">
                    <div className="meta-row">
                      <span className="pill accent">Microsoft</span>
                      <span className={`pill ${session?.calendarConnected ? 'good' : 'warn'}`}>
                        {session?.calendarConnected ? 'Connected' : 'Not connected'}
                      </span>
                    </div>

                    <div className="inline-actions">
                      <button className="button" type="button" onClick={() => void connectCalendar()} disabled={calendarConnectState === 'loading'}>
                        {calendarConnectState === 'loading' ? 'Opening Microsoft...' : 'Connect Microsoft'}
                      </button>
                      <button className="button secondary" type="button" onClick={() => void refreshCalendarStatus()}>
                        I’m back, check again
                      </button>
                    </div>

                    {calendarLink ? (
                      <a className="calendar-link" href={calendarLink} target="_blank" rel="noreferrer">
                        Open Microsoft again
                      </a>
                    ) : null}

                    {calendarMessage ? <p className="pill accent">{calendarMessage}</p> : null}

                    {session?.calendarConnected ? (
                      <div className="inline-actions">
                        <button className="button" type="button" onClick={() => setCurrentStep('voice_sample')}>
                          Next: voice sample
                        </button>
                      </div>
                    ) : null}
                  </div>
              </PublicActionCard>
            ) : null}

            {currentStep === 'voice_sample' ? (
              <PublicActionCard
                eyebrow="Voice"
                title="Record a short voice sample."
                description="Use your microphone and say it in your normal voice. Aim for about 20 to 30 seconds in a quiet spot."
                className="onboarding-stage-card"
              >
                  <div className="support-card">
                    <strong>A good sample is simple</strong>
                    <ul className="guide-list compact">
                      <li>Say your name and business name.</li>
                      <li>Say the jobs you do and where you work.</li>
                      <li>Use your normal voice and keep background noise low.</li>
                    </ul>
                  </div>

                  <div className="conversation-card">
                    <div className="conversation-header">
                      <span className="pill accent">Tip</span>
                    </div>
                    <p>Say your name, the jobs you do, where you work, and how customers can book with you.</p>
                  </div>

                  {!recordingSupported ? <p className="pill warn">This browser does not support microphone recording.</p> : null}

                  <div className="voice-controls">
                    <div className="inline-actions">
                      {!voiceRecording ? (
                        <button className="button" type="button" onClick={() => void startVoiceRecording()} disabled={!recordingSupported}>
                          Start
                        </button>
                      ) : (
                        <button className="button secondary" type="button" onClick={stopVoiceRecording}>
                          Stop
                        </button>
                      )}
                      <button className="button" type="button" onClick={() => void uploadVoiceSample()} disabled={voiceUploading || !voiceBlob}>
                        {voiceUploading ? 'Uploading...' : 'Upload voice'}
                      </button>
                    </div>

                    {voicePreviewUrl ? (
                      <audio controls src={voicePreviewUrl} className="voice-preview">
                        Your browser does not support the audio element.
                      </audio>
                    ) : null}

                    <div className="meta-row">
                      <span className="pill">{voiceRecording ? 'Recording live' : 'Idle'}</span>
                      <span className="pill">{voiceBlob ? 'Voice saved' : 'No voice yet'}</span>
                    </div>
                  </div>

                  {voiceError ? <p className="pill warn">{voiceError}</p> : null}

                    {session?.voiceSampleUploaded ? (
                      <div className="inline-actions">
                        <button className="button" type="button" onClick={() => setCurrentStep('finalize')}>
                        Next: finish
                      </button>
                      </div>
                    ) : null}
              </PublicActionCard>
            ) : null}

            {currentStep === 'finalize' ? (
              <PublicActionCard
                eyebrow="Finish"
                title="Finish setup."
                description="You can finish once the calendar and voice sample are both done."
                className="onboarding-stage-card"
              >

                  <div className="review-summary card">
                    <div className="card-inner">
                      <div className="meta-row">
                        <span className="pill">{session?.calendarConnected ? 'Calendar done' : 'Calendar not done'}</span>
                        <span className="pill">{session?.voiceSampleUploaded ? 'Voice done' : 'Voice not done'}</span>
                        <span className="pill">{readyToFinalize ? 'Ready' : 'Not ready yet'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="inline-actions">
                    <button className="button" type="button" onClick={() => void finalizeOnboarding()} disabled={finalizing || !readyToFinalize}>
                      {finalizing ? 'Finishing...' : 'Finish setup'}
                    </button>
                  </div>

                  {voiceError ? <p className="pill warn">{voiceError}</p> : null}
              </PublicActionCard>
            ) : null}
          </section>

          <aside className="stack">
            <PublicSidePanel eyebrow="Setup so far" title={session?.staffName || 'Your setup'}>
              <p className="muted">
                {session?.summary || 'This shows what is done and what is left.'}
              </p>
              <div className="snapshot-grid">
                <div className="stat">
                  <span className="muted">Answers</span>
                  <strong>{transcript.length}</strong>
                </div>
                <div className="stat">
                  <span className="muted">Details</span>
                  <strong>{review?.confidence ?? 'waiting'}</strong>
                </div>
                <div className="stat">
                  <span className="muted">Calendar</span>
                  <strong>{session?.calendarConnected ? 'Done' : 'Waiting'}</strong>
                </div>
                <div className="stat">
                  <span className="muted">Voice</span>
                  <strong>{session?.voiceSampleUploaded ? 'Done' : 'Waiting'}</strong>
                </div>
              </div>
            </PublicSidePanel>

            <PublicSidePanel eyebrow="What this setup gives you" title="By the time you finish">
              <ul className="guide-list">
                <li>The assistant knows the jobs you take and the ones you avoid.</li>
                <li>It uses the pricing and handoff rules you save here.</li>
                <li>It can book into the calendar you connect.</li>
                <li>It can sound more like you after the voice step.</li>
              </ul>
            </PublicSidePanel>
          </aside>
        </div>
      </div>
    </div>
  );
}
