import {
  type AppointmentRecord,
  type CallbackTaskRecord,
  type CallRecord,
  type DashboardExperiment,
  type DashboardPayload,
  type InterviewTurn,
  type JobCardEnvelope,
  type JobPhoto,
  type JobRecord,
  type QuoteRecord,
  type InviteRecord,
  type OnboardingSessionRecord,
  type UploadRequestRecord,
  type StaffProfileSummary,
} from "../models.js";
import type {
  AppointmentUpsertInput,
  CallbackUpsertInput,
  CallUpsertInput,
  JobUpsertInput,
  OnboardingRepository,
  PricingInterviewRecordInput,
  QuoteUpsertInput,
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
  private readonly staffProfiles = new Map<string, StaffProfileSummary>();

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
    this.staffProfiles.set(input.staffId, {
      id: input.staffId,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      email: input.email,
      role: input.role,
      timezone: input.timezone,
      companyName: input.companyName,
      calendarProvider: input.calendarProvider,
    });
  }

  async recordVoiceConsent(_input: VoiceConsentRecordInput): Promise<void> {}

  async savePricingInterview(_input: PricingInterviewRecordInput): Promise<void> {}

  async listJobs(staffId?: string): Promise<JobRecord[]> {
    return clone([...this.jobs.values()].filter((job) => (staffId ? job.staffId === staffId : true)));
  }

  async getJobCard(jobId: string): Promise<JobCardEnvelope | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }
    const staff = job.staffId ? this.staffProfiles.get(job.staffId) : undefined;
    return {
      job: clone(job),
      staff: staff ? clone(staff) : undefined,
      quotes: job.quote ? [clone(job.quote)] : [],
      photos: clone(job.photos),
      calls: clone(job.calls),
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
    const record: JobRecord = {
      id: input.id,
      staffId: input.staffId ?? existing?.staffId,
      callerId: input.callerId ?? existing?.callerId,
      callerName: input.callerName ?? existing?.callerName,
      callerPhone: input.callerPhone ?? existing?.callerPhone,
      callerEmail: input.callerEmail ?? existing?.callerEmail,
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
}
