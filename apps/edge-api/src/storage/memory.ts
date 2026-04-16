import {
  type AiTestCaseRecord,
  type AiTestRunRecord,
  type AppointmentRecord,
  type CalendarConnectionRecord,
  type CallbackTaskRecord,
  type CallRecord,
  type CustomerProfile,
  type DashboardExperiment,
  type DashboardPayload,
  type InterviewTurn,
  type JobCardEnvelope,
  type JobLocation,
  type JobPhoto,
  type JobRecord,
  type QuoteRecord,
  type InviteRecord,
  type OnboardingSessionRecord,
  type PricingInterviewRecord,
  type PricingProfileRecord,
  type StaffRecord,
  type StaffSessionRecord,
  type UploadRequestRecord,
  type StaffProfileSummary,
} from "../models.js";
import type {
  AppointmentUpsertInput,
  StaffCalendarConnectionInput,
  StaffAuthStateInput,
  CallbackUpsertInput,
  CallUpsertInput,
  JobUpsertInput,
  OnboardingRepository,
  PricingInterviewRecordInput,
  QuoteUpsertInput,
  StaffInviteInput,
  StaffSessionInput,
  StaffProfileUpsertInput,
  UploadRequestInput,
  VoiceConsentRecordInput,
} from "./repository.js";

const dashboardExperiments: DashboardExperiment[] = [
  {
    name: "After-hours urgency premium",
    variant: "dynamic-high",
    exposure: "34%",
    lift: "+9% revenue",
    sampleSize: 148,
  },
  {
    name: "Short-job close-out discount",
    variant: "control",
    exposure: "48%",
    lift: "Baseline",
    sampleSize: 214,
  },
  {
    name: "Customer-acquired photo uplift",
    variant: "dynamic-low",
    exposure: "18%",
    lift: "+5% conversion",
    sampleSize: 93,
  },
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function ensureArray<T>(value?: T[] | null): T[] {
  return Array.isArray(value) ? value : [];
}

function derivePricingProfile(responses: Record<string, unknown>): PricingProfileRecord {
  const numeric = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return {
    baseCalloutFee: numeric(responses.baseCalloutFee, 180),
    minimumJobPrice: numeric(responses.minimumJobPrice, 160),
    hourlyRate: numeric(responses.hourlyRate, 145),
    rushMultiplier: numeric(responses.rushMultiplier, 1.35),
    complexityMultiplier: numeric(responses.complexityMultiplier, 1.2),
    confidenceFloor: numeric(responses.confidenceFloor, 0.68),
  };
}

function toStaffSummary(staff: StaffRecord): StaffProfileSummary {
  return {
    id: staff.id,
    fullName: staff.fullName,
    phoneNumber: staff.phoneNumber,
    email: staff.email,
    role: staff.role,
    timezone: staff.timezone,
    companyName: staff.companyName,
    calendarProvider: staff.calendarProvider,
    outlookCalendarId: staff.calendarConnection?.calendarId,
    voiceCloneId: staff.voiceCloneId,
    updatedAt: staff.updatedAt,
  };
}

function toDashboardConfidence(confidence: number): DashboardPayload["jobs"][number]["quote"]["confidence"] {
  if (confidence >= 0.84) {
    return "high";
  }
  if (confidence >= 0.68) {
    return "medium";
  }
  return "low";
}

function toDashboardStatus(status: JobRecord["status"]): DashboardPayload["jobs"][number]["status"] {
  if (status === "scheduled") {
    return "booked";
  }
  if (status === "callback") {
    return "needs_follow_up";
  }
  if (status === "closed") {
    return "completed";
  }
  return status;
}

function normalizePhoneNumber(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const plusPrefixed = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) {
    return undefined;
  }
  if (digits.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }
  if (plusPrefixed) {
    return `+${digits}`;
  }
  if (/^0\d{9}$/.test(digits)) {
    return `+61${digits.slice(1)}`;
  }
  if (/^61\d{9}$/.test(digits)) {
    return `+${digits}`;
  }
  return digits.length >= 8 ? `+${digits}` : digits;
}

function normalizeEmail(value?: string): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

function chooseLatestJob(jobs: JobRecord[]): JobRecord | undefined {
  return [...jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function toCustomerSuburb(location?: JobLocation, address?: string): string | undefined {
  return location?.label ?? location?.suburb ?? address;
}

function choosePreferredDisplayName(candidate?: string, existing?: string): string | undefined {
  const nextValue = candidate?.trim();
  const currentValue = existing?.trim();
  if (!nextValue) {
    return currentValue || undefined;
  }
  if (!currentValue) {
    return nextValue;
  }

  const sameIgnoringCase = nextValue.localeCompare(currentValue, undefined, { sensitivity: "accent" }) === 0;
  if (sameIgnoringCase) {
    return nextValue.length >= currentValue.length ? nextValue : currentValue;
  }

  const nextWords = nextValue.split(/\s+/u).length;
  const currentWords = currentValue.split(/\s+/u).length;
  if (nextWords !== currentWords) {
    return nextWords > currentWords ? nextValue : currentValue;
  }

  if (nextValue.length !== currentValue.length) {
    return nextValue.length > currentValue.length ? nextValue : currentValue;
  }

  return currentValue;
}

export class InMemoryOnboardingRepository implements OnboardingRepository {
  private readonly invites = new Map<string, InviteRecord>();
  private readonly sessions = new Map<string, OnboardingSessionRecord>();
  private readonly turns = new Map<string, InterviewTurn[]>();
  private readonly jobs = new Map<string, JobRecord>();
  private readonly quotes = new Map<string, QuoteRecord>();
  private readonly appointments = new Map<string, AppointmentRecord>();
  private readonly callbacks = new Map<string, CallbackTaskRecord>();
  private readonly calls = new Map<string, CallRecord>();
  private readonly uploadRequests = new Map<string, UploadRequestRecord>();
  private readonly photos = new Map<string, JobPhoto>();
  private readonly automationReplayExpiries = new Map<string, string>();
  private readonly staffRecords = new Map<string, StaffRecord>();
  private readonly staffSessions = new Map<string, StaffSessionRecord>();
  private readonly aiTestCases = new Map<string, AiTestCaseRecord>();
  private readonly aiTestRuns = new Map<string, AiTestRunRecord>();

  async createInvite(invite: InviteRecord): Promise<void> {
    this.invites.set(invite.id, clone(invite));
  }

  async saveInvite(invite: InviteRecord): Promise<void> {
    this.invites.set(invite.id, clone(invite));
  }

  async getInviteByCode(code: string): Promise<InviteRecord | undefined> {
    for (const invite of this.invites.values()) {
      if (invite.code === code) {
        return clone(invite);
      }
    }
    return undefined;
  }

  async getInviteById(id: string): Promise<InviteRecord | undefined> {
    const invite = this.invites.get(id);
    return invite ? clone(invite) : undefined;
  }

  async saveSession(session: OnboardingSessionRecord): Promise<void> {
    this.sessions.set(session.id, clone(session));
  }

  async getSessionById(id: string): Promise<OnboardingSessionRecord | undefined> {
    const session = this.sessions.get(id);
    return session ? clone(session) : undefined;
  }

  async getSessionByCalendarState(state: string): Promise<OnboardingSessionRecord | undefined> {
    for (const session of this.sessions.values()) {
      if (session.calendar?.authState === state) {
        return clone(session);
      }
    }
    return undefined;
  }

  async appendTurn(sessionId: string, turn: InterviewTurn): Promise<void> {
    const current = this.turns.get(sessionId) ?? [];
    current.push(clone(turn));
    this.turns.set(sessionId, current);
  }

  async listTurns(sessionId: string): Promise<InterviewTurn[]> {
    return clone(this.turns.get(sessionId) ?? []);
  }

  async upsertStaffProfile(input: StaffProfileUpsertInput): Promise<void> {
    const existing = this.staffRecords.get(input.staffId);
    this.staffRecords.set(input.staffId, {
      id: input.staffId,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber ?? existing?.phoneNumber,
      email: input.email ?? existing?.email,
      role: input.role ?? existing?.role,
      timezone: input.timezone ?? existing?.timezone,
      companyName: input.companyName ?? existing?.companyName,
      calendarProvider: input.calendarProvider ?? existing?.calendarProvider,
      outlookCalendarId: existing?.outlookCalendarId,
      voiceCloneId: existing?.voiceCloneId,
      inviteTokenHash: existing?.inviteTokenHash,
      otpCodeHash: existing?.otpCodeHash,
      otpIssuedAt: existing?.otpIssuedAt,
      otpFailedAttempts: existing?.otpFailedAttempts ?? 0,
      otpVerifiedAt: existing?.otpVerifiedAt,
      authExpiresAt: existing?.authExpiresAt,
      voiceConsentStatus: existing?.voiceConsentStatus ?? "pending",
      voiceConsentAt: existing?.voiceConsentAt,
      pricingInterview: existing?.pricingInterview,
      pricingProfile: existing?.pricingProfile,
      calendarConnection: existing?.calendarConnection,
      createdAt: existing?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    });
  }

  async recordVoiceConsent(input: VoiceConsentRecordInput): Promise<void> {
    const existing = this.staffRecords.get(input.staffId);
    if (!existing) {
      return;
    }
    this.staffRecords.set(input.staffId, {
      ...existing,
      voiceConsentStatus: input.consent ? "granted" : "revoked",
      voiceConsentAt: input.capturedAt,
      updatedAt: input.capturedAt,
    });
  }

  async savePricingInterview(input: PricingInterviewRecordInput): Promise<void> {
    const existing = this.staffRecords.get(input.staffId);
    if (!existing) {
      return;
    }
    const pricingInterview: PricingInterviewRecord = {
      answeredAt: input.capturedAt,
      responses: clone(input.responses),
    };
    this.staffRecords.set(input.staffId, {
      ...existing,
      pricingInterview,
      pricingProfile: derivePricingProfile(input.responses),
      updatedAt: input.capturedAt,
    });
  }

  async getStaff(staffId: string): Promise<StaffRecord | undefined> {
    const staff = this.staffRecords.get(staffId);
    return staff ? clone(staff) : undefined;
  }

  async findStaffByInviteTokenHash(inviteTokenHash: string): Promise<StaffRecord | undefined> {
    for (const staff of this.staffRecords.values()) {
      if (staff.inviteTokenHash === inviteTokenHash) {
        return clone(staff);
      }
    }
    return undefined;
  }

  async saveStaffInvite(input: StaffInviteInput): Promise<StaffRecord> {
    const existing = this.staffRecords.get(input.staffId);
    const record: StaffRecord = {
      id: input.staffId,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber ?? existing?.phoneNumber,
      email: input.email ?? existing?.email,
      role: input.role ?? existing?.role,
      timezone: input.timezone ?? existing?.timezone,
      companyName: existing?.companyName,
      calendarProvider: existing?.calendarProvider,
      outlookCalendarId: existing?.outlookCalendarId,
      voiceCloneId: existing?.voiceCloneId,
      inviteTokenHash: input.inviteTokenHash,
      otpCodeHash: input.otpCodeHash,
      otpIssuedAt: input.otpIssuedAt,
      otpFailedAttempts: input.otpFailedAttempts,
      otpVerifiedAt: undefined,
      authExpiresAt: input.authExpiresAt,
      voiceConsentStatus: existing?.voiceConsentStatus ?? "pending",
      voiceConsentAt: existing?.voiceConsentAt,
      pricingInterview: existing?.pricingInterview,
      pricingProfile: existing?.pricingProfile,
      calendarConnection: existing?.calendarConnection,
      createdAt: existing?.createdAt ?? input.createdAt,
      updatedAt: input.updatedAt,
    };
    this.staffRecords.set(record.id, clone(record));
    return clone(record);
  }

  async saveStaffAuthState(input: StaffAuthStateInput): Promise<StaffRecord | undefined> {
    const existing = this.staffRecords.get(input.staffId);
    if (!existing) {
      return undefined;
    }
    const record: StaffRecord = {
      ...existing,
      inviteTokenHash: input.inviteTokenHash,
      otpCodeHash: input.otpCodeHash,
      otpIssuedAt: input.otpIssuedAt,
      otpFailedAttempts: input.otpFailedAttempts ?? existing.otpFailedAttempts ?? 0,
      otpVerifiedAt: input.otpVerifiedAt,
      authExpiresAt: input.authExpiresAt,
      createdAt: input.createdAt ?? existing.createdAt,
      updatedAt: input.updatedAt,
    };
    this.staffRecords.set(record.id, clone(record));
    return clone(record);
  }

  async createStaffSession(input: StaffSessionInput): Promise<void> {
    this.staffSessions.set(input.tokenHash, clone(input));
  }

  async getStaffSession(tokenHash: string): Promise<StaffSessionRecord | undefined> {
    const session = this.staffSessions.get(tokenHash);
    return session ? clone(session) : undefined;
  }

  async deleteStaffSession(tokenHash: string): Promise<void> {
    this.staffSessions.delete(tokenHash);
  }

  async saveStaffCalendarConnection(input: StaffCalendarConnectionInput): Promise<CalendarConnectionRecord> {
    const existing = this.staffRecords.get(input.staffId);
    if (!existing) {
      throw new Error(`Staff ${input.staffId} not found`);
    }
    const calendarConnection: CalendarConnectionRecord = {
      provider: input.provider,
      status: input.status,
      accountEmail: input.accountEmail,
      calendarId: input.calendarId,
      calendarLabel: input.calendarLabel,
      timezone: input.timezone,
      authState: input.authState,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      tokenExpiresAt: input.tokenExpiresAt,
      lastError: input.lastError,
      connectedAt: input.connectedAt,
      updatedAt: input.updatedAt,
    };
    this.staffRecords.set(input.staffId, {
      ...existing,
      calendarProvider: input.provider,
      outlookCalendarId: input.calendarId,
      calendarConnection,
      updatedAt: input.updatedAt,
    });
    return clone(calendarConnection);
  }

  async getStaffByCalendarAuthState(state: string): Promise<StaffRecord | undefined> {
    return clone(
      [...this.staffRecords.values()].find((staff) => staff.calendarConnection?.authState === state),
    );
  }

  async deleteStaffCalendarConnection(staffId: string): Promise<void> {
    const existing = this.staffRecords.get(staffId);
    if (!existing) {
      return;
    }
    this.staffRecords.set(staffId, {
      ...existing,
      calendarProvider: undefined,
      outlookCalendarId: undefined,
      calendarConnection: undefined,
      updatedAt: new Date().toISOString(),
    });
  }

  async listJobs(staffId?: string): Promise<JobRecord[]> {
    return clone([...this.jobs.values()].filter((job) => (staffId ? job.staffId === staffId : true)));
  }

  async getJobCard(jobId: string): Promise<JobCardEnvelope | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }
    const staff = job.staffId ? this.staffRecords.get(job.staffId) : undefined;
    const customerId =
      job.callerId ??
      [...this.jobs.values()].find(
        (candidate) =>
          candidate.callerId &&
          ((job.callerPhone && normalizePhoneNumber(candidate.callerPhone) === normalizePhoneNumber(job.callerPhone)) ||
            (job.callerEmail && normalizeEmail(candidate.callerEmail) === normalizeEmail(job.callerEmail))),
      )?.callerId;
    return {
      job: clone(job),
      staff: staff ? toStaffSummary(staff) : undefined,
      customer: customerId ? await this.getCustomerProfile(customerId) : undefined,
      quotes: job.quote ? [clone(job.quote)] : [],
      photos: clone(job.photos),
      calls: clone(job.calls),
    };
  }

  async getCustomerProfile(customerId: string): Promise<CustomerProfile | undefined> {
    const jobs = [...this.jobs.values()].filter((job) => job.callerId === customerId);
    if (jobs.length === 0) {
      return undefined;
    }

    const latestJob = chooseLatestJob(jobs);
    const normalizedPhone = normalizePhoneNumber(latestJob?.callerPhone);
    const normalizedEmail = normalizeEmail(latestJob?.callerEmail);
    const relatedCalls = [...this.calls.values()].filter(
      (call) =>
        jobs.some((job) => job.id === call.jobId) ||
        (normalizedPhone ? normalizePhoneNumber(call.callerPhone) === normalizedPhone : false),
    );
    const relatedUploads = [...this.uploadRequests.values()].filter(
      (upload) =>
        jobs.some((job) => job.id === upload.jobId) ||
        (normalizedPhone ? normalizePhoneNumber(upload.callerPhone) === normalizedPhone : false),
    );
    const latestCall = [...relatedCalls].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    const knownStaffIds = [...new Set(jobs.map((job) => job.staffId).filter((value): value is string => Boolean(value)))];
    const photoIds = new Set(jobs.flatMap((job) => job.photos.map((photo) => photo.id)));
    const displayName = jobs.reduce<string | undefined>(
      (current, job) => choosePreferredDisplayName(job.callerName, current),
      undefined,
    );

    return {
      id: customerId,
      displayName,
      phoneNumber: latestJob?.callerPhone,
      normalizedPhone,
      email: latestJob?.callerEmail,
      normalizedEmail,
      address: latestJob?.address,
      location: latestJob?.location ? clone(latestJob.location) : undefined,
      latestSummary: latestJob?.summary ?? latestJob?.issue,
      latestCallSummary: latestCall?.summary,
      latestCallAt: latestCall?.updatedAt,
      lastJobId: latestJob?.id,
      firstSeenAt: [...jobs].sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]?.createdAt ?? latestJob?.createdAt ?? new Date().toISOString(),
      lastSeenAt: latestJob?.updatedAt ?? new Date().toISOString(),
      lastContactAt: latestCall?.updatedAt ?? latestJob?.updatedAt ?? new Date().toISOString(),
      totalJobs: jobs.length,
      totalCalls: relatedCalls.length,
      totalUploads: relatedUploads.length,
      totalPhotos: photoIds.size,
      knownStaffIds,
      recentJobs: [...jobs]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 5)
        .map((job) => ({
          jobId: job.id,
          staffId: job.staffId,
          status: job.status,
          summary: job.summary ?? job.issue,
          suburb: toCustomerSuburb(job.location, job.address),
          quotedPrice: job.quote?.amount,
          photoCount: job.photos.length,
          updatedAt: job.updatedAt,
        })),
    };
  }

  async listCallbacks(staffId?: string): Promise<CallbackTaskRecord[]> {
    return clone([...this.callbacks.values()].filter((callback) => (staffId ? callback.staffId === staffId : true)));
  }

  async listExperiments(): Promise<DashboardExperiment[]> {
    return clone(dashboardExperiments);
  }

  async ensureJob(input: JobUpsertInput): Promise<JobRecord> {
    const now = new Date().toISOString();
    const existing = this.jobs.get(input.id);
    const callerPhone = input.callerPhone ?? existing?.callerPhone;
    const callerEmail = input.callerEmail ?? existing?.callerEmail;
    const normalizedPhone = normalizePhoneNumber(callerPhone);
    const normalizedEmail = normalizeEmail(callerEmail);
    let callerId = input.callerId ?? existing?.callerId;

    if (!callerId && (normalizedPhone || normalizedEmail)) {
      for (const candidate of this.jobs.values()) {
        if (
          candidate.callerId &&
          ((normalizedPhone && normalizePhoneNumber(candidate.callerPhone) === normalizedPhone) ||
            (normalizedEmail && normalizeEmail(candidate.callerEmail) === normalizedEmail))
        ) {
          callerId = candidate.callerId;
          break;
        }
      }
    }

    if (!callerId && (normalizedPhone || normalizedEmail || input.callerName || existing?.callerName)) {
      callerId = globalThis.crypto.randomUUID();
    }

    const record: JobRecord = {
      id: input.id,
      staffId: input.staffId ?? existing?.staffId,
      callerId,
      callerName: input.callerName ?? existing?.callerName,
      callerPhone,
      callerEmail,
      address: input.address ?? existing?.address,
      location: input.location ? clone(input.location) : existing?.location ? clone(existing.location) : undefined,
      issue: input.issue ?? existing?.issue,
      summary: input.summary ?? existing?.summary,
      status: input.status ?? existing?.status ?? "new",
      quote: input.quote ? clone(input.quote) : existing?.quote ? clone(existing.quote) : undefined,
      appointment: input.appointment ? clone(input.appointment) : existing?.appointment ? clone(existing.appointment) : undefined,
      callbackTask: input.callbackTask ? clone(input.callbackTask) : existing?.callbackTask ? clone(existing.callbackTask) : undefined,
      photos: input.photos ? clone(input.photos) : existing?.photos ? clone(existing.photos) : [],
      calls: input.calls ? clone(input.calls) : existing?.calls ? clone(existing.calls) : [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.jobs.set(record.id, record);
    return clone(record);
  }

  async upsertQuote(input: QuoteUpsertInput): Promise<QuoteRecord> {
    const existing = this.jobs.get(input.jobId);
    const record: QuoteRecord = {
      id: input.id ?? globalThis.crypto.randomUUID(),
      jobId: input.jobId,
      staffId: input.staffId ?? existing?.staffId,
      amount: input.amount,
      currency: input.currency,
      variant: input.variant ?? "control",
      basePrice: input.basePrice ?? input.amount,
      strategyAdjustment: input.strategyAdjustment ?? 0,
      experimentAdjustment: input.experimentAdjustment ?? 0,
      floorPrice: input.floorPrice ?? Math.max(90, input.amount - 60),
      ceilingPrice: input.ceilingPrice ?? input.amount + 120,
      confidence: input.confidence ?? 0.5,
      status: input.status ?? "draft",
      rationale: input.rationale ? clone(input.rationale) : [],
      createdAt: input.createdAt ?? new Date().toISOString(),
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    this.quotes.set(record.id, record);
    const job = await this.ensureJob({
      id: input.jobId,
      staffId: input.staffId ?? existing?.staffId,
      quote: record,
      status: "quoted",
    });
    job.quote = record;
    job.status = "quoted";
    job.updatedAt = new Date().toISOString();
    this.jobs.set(job.id, clone(job));
    return record;
  }

  async upsertAppointment(input: AppointmentUpsertInput): Promise<AppointmentRecord> {
    const existing = this.jobs.get(input.jobId);
    const record: AppointmentRecord = {
      id: input.id ?? globalThis.crypto.randomUUID(),
      jobId: input.jobId,
      staffId: input.staffId ?? existing?.staffId,
      status: input.status ?? "proposed",
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      location: input.location,
      notes: input.notes,
      outlookEventId: input.outlookEventId,
      createdAt: input.createdAt ?? new Date().toISOString(),
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    this.appointments.set(record.id, record);
    const job = await this.ensureJob({
      id: input.jobId,
      staffId: input.staffId ?? existing?.staffId,
      appointment: record,
      status: record.status === "booked" ? "scheduled" : existing?.status ?? "new",
    });
    job.appointment = record;
    if (record.status === "booked") {
      job.status = "scheduled";
    }
    job.updatedAt = new Date().toISOString();
    this.jobs.set(job.id, clone(job));
    return record;
  }

  async upsertCallback(input: CallbackUpsertInput): Promise<CallbackTaskRecord> {
    const now = new Date().toISOString();
    const record: CallbackTaskRecord = {
      id: input.id ?? globalThis.crypto.randomUUID(),
      jobId: input.jobId,
      staffId: input.staffId,
      status: input.status ?? "queued",
      reason: input.reason,
      dueAt: input.dueAt,
      phoneNumber: input.phoneNumber,
      notes: input.notes,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    this.callbacks.set(record.id, clone(record));
    if (record.jobId) {
      const job = await this.ensureJob({
        id: record.jobId,
        staffId: record.staffId,
        callerPhone: record.phoneNumber,
        callbackTask: record,
        status: record.status === "done" ? "closed" : "callback",
      });
      job.callbackTask = record;
      job.status = record.status === "done" ? "closed" : "callback";
      job.updatedAt = now;
      this.jobs.set(job.id, clone(job));
    }
    return clone(record);
  }

  async recordCall(input: CallUpsertInput): Promise<CallRecord> {
    const now = new Date().toISOString();
    const record: CallRecord = {
      id: input.id ?? globalThis.crypto.randomUUID(),
      staffId: input.staffId,
      callerPhone: input.callerPhone,
      direction: input.direction ?? "inbound",
      status: input.status ?? "received",
      transcript: input.transcript,
      summary: input.summary,
      disposition: input.disposition,
      jobId: input.jobId,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    this.calls.set(record.id, clone(record));
    if (record.jobId) {
      const job = await this.ensureJob({
        id: record.jobId,
        staffId: record.staffId,
        callerPhone: record.callerPhone,
      });
      job.calls = [...job.calls, record];
      job.updatedAt = now;
      this.jobs.set(job.id, clone(job));
    }
    return clone(record);
  }

  async createUploadRequest(input: UploadRequestInput): Promise<UploadRequestRecord> {
    const now = new Date().toISOString();
    const token = input.token ?? globalThis.crypto.randomUUID().replace(/-/g, "");
    const jobId = input.jobId ?? `job_${token.slice(0, 8)}`;
    const job = await this.ensureJob({
      id: jobId,
      staffId: input.staffId,
      callerPhone: input.callerPhone,
      summary: input.notes ?? "Customer photo upload received.",
      status: "new",
    });
    const request: UploadRequestRecord = {
      token,
      jobId: job.id,
      staffId: input.staffId,
      callerPhone: input.callerPhone,
      notes: input.notes,
      uploadLink: input.uploadLink,
      status: "pending",
      createdAt: now,
      expiresAt: input.expiresAt,
      fileCount: 0,
      files: [],
    };
    this.uploadRequests.set(token, clone(request));
    this.jobs.set(job.id, clone(job));
    return clone(request);
  }

  async getUploadRequest(token: string): Promise<UploadRequestRecord | undefined> {
    const request = this.uploadRequests.get(token);
    return request ? clone(request) : undefined;
  }

  async completeUploadRequest(token: string, photos: JobPhoto[]): Promise<UploadRequestRecord | undefined> {
    const request = this.uploadRequests.get(token);
    if (!request) {
      return undefined;
    }
    if (request.status !== "pending" || new Date(request.expiresAt).getTime() < Date.now()) {
      return undefined;
    }
    const now = new Date().toISOString();
    const updated: UploadRequestRecord = {
      ...request,
      status: "completed",
      completedAt: now,
      fileCount: request.fileCount + photos.length,
      files: [...request.files, ...clone(photos)],
    };
    this.uploadRequests.set(token, clone(updated));
    const job = this.jobs.get(request.jobId);
    if (job) {
      job.photos = [...job.photos, ...clone(photos)];
      job.updatedAt = now;
      this.jobs.set(job.id, clone(job));
    }
    photos.forEach((photo) => this.photos.set(photo.id, clone(photo)));
    return clone(updated);
  }

  async getPhotoAsset(photoId: string): Promise<JobPhoto | undefined> {
    const photo = this.photos.get(photoId);
    return photo ? clone(photo) : undefined;
  }

  async claimAutomationReplay(fingerprint: string, expiresAt: string): Promise<boolean> {
    const existingExpiry = this.automationReplayExpiries.get(fingerprint);
    if (existingExpiry && Date.parse(existingExpiry) > Date.now()) {
      return false;
    }
    this.automationReplayExpiries.set(fingerprint, expiresAt);
    return true;
  }

  async listAiTestCases(): Promise<AiTestCaseRecord[]> {
    return clone(
      [...this.aiTestCases.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  async getAiTestCase(id: string): Promise<AiTestCaseRecord | undefined> {
    const record = this.aiTestCases.get(id);
    return record ? clone(record) : undefined;
  }

  async getAiTestCaseBySlug(slug: string): Promise<AiTestCaseRecord | undefined> {
    for (const testCase of this.aiTestCases.values()) {
      if (testCase.slug === slug) {
        return clone(testCase);
      }
    }
    return undefined;
  }

  async saveAiTestCase(testCase: AiTestCaseRecord): Promise<void> {
    this.aiTestCases.set(testCase.id, clone(testCase));
  }

  async listAiTestRuns(caseId?: string): Promise<AiTestRunRecord[]> {
    return clone(
      [...this.aiTestRuns.values()]
        .filter((run) => (caseId ? run.caseId === caseId : true))
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    );
  }

  async getAiTestRun(id: string): Promise<AiTestRunRecord | undefined> {
    const record = this.aiTestRuns.get(id);
    return record ? clone(record) : undefined;
  }

  async saveAiTestRun(run: AiTestRunRecord): Promise<void> {
    this.aiTestRuns.set(run.id, clone(run));
  }
}
