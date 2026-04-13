import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type StaffVoiceConsentStatus = "pending" | "granted" | "revoked";
export type CallStatus =
  | "received"
  | "in_progress"
  | "completed"
  | "callback_requested"
  | "transferred"
  | "abandoned";
export type AppointmentStatus = "proposed" | "booked" | "rescheduled" | "cancelled";
export type ExperimentVariant = "control" | "dynamic-low" | "dynamic-high";

export interface StaffRecord {
  id: string;
  fullName: string;
  phoneNumber?: string;
  email?: string;
  role?: string;
  timezone?: string;
  inviteToken?: string;
  otpCode?: string;
  otpIssuedAt?: string;
  otpFailedAttempts?: number;
  otpVerifiedAt?: string;
  voiceConsentStatus: StaffVoiceConsentStatus;
  voiceConsentAt?: string;
  pricingInterview?: PricingInterviewRecord;
  pricingProfile?: PricingProfile;
  calendarConnection?: CalendarConnectionRecord;
  createdAt: string;
  updatedAt: string;
}

export interface StaffSessionRecord {
  token: string;
  staffId: string;
  createdAt: string;
  expiresAt: string;
}

export interface PricingInterviewRecord {
  answeredAt: string;
  responses: Record<string, unknown>;
}

export interface PricingProfile {
  baseCalloutFee: number;
  minimumJobPrice: number;
  hourlyRate: number;
  rushMultiplier: number;
  complexityMultiplier: number;
  confidenceFloor: number;
}

export interface CalendarConnectionRecord {
  provider: "outlook";
  accountEmail?: string;
  calendarId?: string;
  timezone?: string;
  externalConnectionId?: string;
  connectedAt: string;
}

export interface JobCardPhoto {
  id: string;
  token?: string;
  originalName?: string;
  storedPath?: string;
  publicUrl?: string;
  caption?: string;
  mimeType?: string;
  uploadedAt: string;
}

export interface QuoteRecord {
  id: string;
  staffId?: string;
  amount: number;
  currency: string;
  variant: ExperimentVariant;
  basePrice: number;
  strategyAdjustment: number;
  experimentAdjustment: number;
  floorPrice: number;
  ceilingPrice: number;
  breakdown: {
    baseCalloutFee: number;
    labourEstimate: number;
    materialsEstimate: number;
    complexityAdjustment: number;
    rushAdjustment: number;
  };
  confidence: number;
  status: "draft" | "presented" | "accepted" | "rejected";
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentRecord {
  id: string;
  status: AppointmentStatus;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  location?: string;
  notes?: string;
  outlookEventId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CallbackTaskRecord {
  id: string;
  jobId?: string;
  staffId?: string;
  status: "open" | "queued" | "done" | "cancelled";
  reason?: string;
  dueAt?: string;
  phoneNumber?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UploadRequestRecord {
  token: string;
  jobId?: string;
  callerPhone?: string;
  notes?: string;
  uploadLink?: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  files: JobCardPhoto[];
}

export interface CallRecord {
  id: string;
  staffId?: string;
  callerPhone?: string;
  direction: "inbound" | "outbound";
  status: CallStatus;
  transcript?: string;
  summary?: string;
  disposition?: string;
  jobId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  staffId?: string;
  callerPhone?: string;
  customerName?: string;
  address?: string;
  location?: {
    lat?: number;
    lng?: number;
    label?: string;
  };
  issue?: string;
  summary?: string;
  status: "new" | "quoted" | "scheduled" | "callback" | "closed";
  quote?: QuoteRecord;
  appointment?: AppointmentRecord;
  callbackTask?: CallbackTaskRecord;
  photos: JobCardPhoto[];
  calls: CallRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface VoiceContextInput {
  staffId?: string;
  callerPhone?: string;
  jobId?: string;
  callerName?: string;
  customerName?: string;
  address?: string;
  issue?: string;
}

export interface QuoteInput {
  staffId?: string;
  jobId?: string;
  callerPhone?: string;
  issue?: string;
  urgency?: string;
  complexity?: number;
  hours?: number;
  materialsEstimate?: number;
  rush?: boolean;
  location?: string;
}

export interface AppointmentInput {
  staffId?: string;
  jobId?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  location?: string;
  notes?: string;
  outlookEventId?: string;
}

export interface CallbackInput {
  staffId?: string;
  jobId?: string;
  callerPhone?: string;
  reason?: string;
  dueAt?: string;
  notes?: string;
}

export interface SendPhotoLinkInput {
  staffId?: string;
  jobId?: string;
  callerPhone?: string;
  notes?: string;
  ttlHours?: number;
}

export interface PostCallInput {
  staffId?: string;
  callId?: string;
  jobId?: string;
  callerPhone?: string;
  direction?: "inbound" | "outbound";
  status?: CallStatus;
  transcript?: string;
  summary?: string;
  disposition?: string;
}

export interface StaffInviteInput {
  fullName?: string;
  phoneNumber?: string;
  email?: string;
  role?: string;
  timezone?: string;
}

export interface StaffOtpVerificationInput {
  staffId?: string;
  inviteToken?: string;
  otpCode?: string;
}

export interface VoiceConsentInput {
  staffId?: string;
  consent?: boolean;
  signedBy?: string;
  capturedAt?: string;
}

export interface PricingInterviewInput {
  staffId?: string;
  responses?: Record<string, unknown>;
}

export interface CalendarConnectInput {
  staffId?: string;
  provider?: "outlook";
  accountEmail?: string;
  calendarId?: string;
  timezone?: string;
  externalConnectionId?: string;
}

export interface JobCard {
  job: JobRecord;
  staff?: StaffRecord;
  quotes: QuoteRecord[];
  photos: JobCardPhoto[];
  calls: CallRecord[];
}

export interface DashboardCallback {
  id: string;
  customerName: string;
  phone: string;
  reason: string;
  status: "queued" | "contacted" | "closed";
  dueAt: string;
}

export interface DashboardPayload {
  jobs: Array<{
    id: string;
    customerName: string;
    suburb: string;
    summary: string;
    status: "new" | "quoted" | "booked" | "needs_follow_up" | "completed";
    photos: Array<{ id: string; url: string; caption: string }>;
    quote: {
      basePrice: number;
      strategyAdjustment: number;
      experimentAdjustment: number;
      presentedPrice: number;
      confidence: "low" | "medium" | "high";
    };
    callback?: DashboardCallback | null;
    updatedAt: string;
  }>;
  callbacks: DashboardCallback[];
  experiments: Array<{
    name: string;
    variant: ExperimentVariant;
    exposure: string;
    lift: string;
    sampleSize: number;
  }>;
}

const dashboardExperiments: DashboardPayload["experiments"] = [
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

interface CrmSnapshot {
  seededDemo: boolean;
  staff: StaffRecord[];
  staffSessions: StaffSessionRecord[];
  jobs: JobRecord[];
  calls: CallRecord[];
  uploadRequests: UploadRequestRecord[];
  callbacks: CallbackTaskRecord[];
}

export class CrmStore {
  private readonly staff = new Map<string, StaffRecord>();
  private readonly staffSessions = new Map<string, StaffSessionRecord>();
  private readonly jobs = new Map<string, JobRecord>();
  private readonly calls = new Map<string, CallRecord>();
  private readonly uploadRequests = new Map<string, UploadRequestRecord>();
  private readonly callbacks = new Map<string, CallbackTaskRecord>();
  private stateFilePath?: string;
  private hydrated = false;
  private suspendPersistence = false;
  private seededDemo = false;

  configurePersistence(stateFilePath: string): void {
    if (this.stateFilePath === stateFilePath && this.hydrated) {
      return;
    }

    this.stateFilePath = stateFilePath;
    this.loadState();
  }

  reset(options: { deleteStateFile?: boolean } = {}): void {
    this.staff.clear();
    this.staffSessions.clear();
    this.jobs.clear();
    this.calls.clear();
    this.uploadRequests.clear();
    this.callbacks.clear();
    this.seededDemo = false;
    this.hydrated = false;

    if (options.deleteStateFile && this.stateFilePath) {
      fs.rmSync(this.stateFilePath, { force: true });
    }
  }

  getStats() {
    return {
      staff: this.staff.size,
      staffSessions: this.staffSessions.size,
      jobs: this.jobs.size,
      calls: this.calls.size,
      uploads: this.uploadRequests.size,
      callbacks: this.callbacks.size,
    };
  }

  private loadState(): void {
    if (this.hydrated) {
      return;
    }

    this.hydrated = true;
    if (!this.stateFilePath || !fs.existsSync(this.stateFilePath)) {
      return;
    }

    const rawSnapshot = fs.readFileSync(this.stateFilePath, "utf8");
    if (rawSnapshot.trim().length === 0) {
      return;
    }

    let snapshot: Partial<CrmSnapshot>;
    try {
      snapshot = JSON.parse(rawSnapshot) as Partial<CrmSnapshot>;
    } catch (error) {
      const corruptPath = `${this.stateFilePath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.stateFilePath, corruptPath);
      } catch {
        // Ignore rename failures; the store can still recover by starting empty.
      }
      console.warn("Ignoring malformed CRM snapshot", {
        stateFilePath: this.stateFilePath,
        corruptPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const staff = Array.isArray(snapshot.staff) ? snapshot.staff : [];
    const staffSessions = Array.isArray(snapshot.staffSessions) ? snapshot.staffSessions : [];
    const jobs = Array.isArray(snapshot.jobs) ? snapshot.jobs : [];
    const calls = Array.isArray(snapshot.calls) ? snapshot.calls : [];
    const uploadRequests = Array.isArray(snapshot.uploadRequests) ? snapshot.uploadRequests : [];
    const callbacks = Array.isArray(snapshot.callbacks) ? snapshot.callbacks : [];

    this.runWithoutPersistence(() => {
      this.staff.clear();
      this.staffSessions.clear();
      this.jobs.clear();
      this.calls.clear();
      this.uploadRequests.clear();
      this.callbacks.clear();

      staff.forEach((record) => this.staff.set(record.id, record));
      staffSessions.forEach((record) => this.staffSessions.set(record.token, record));
      jobs.forEach((record) => this.jobs.set(record.id, record));
      calls.forEach((record) => this.calls.set(record.id, record));
      uploadRequests.forEach((record) => this.uploadRequests.set(record.token, record));
      callbacks.forEach((record) => this.callbacks.set(record.id, record));
      this.seededDemo = snapshot.seededDemo === true;
    });
  }

  private persistState(): void {
    if (!this.stateFilePath || this.suspendPersistence) {
      return;
    }

    const directory = path.dirname(this.stateFilePath);
    fs.mkdirSync(directory, { recursive: true });

    const snapshot: CrmSnapshot = {
      seededDemo: this.seededDemo,
      staff: [...this.staff.values()],
      staffSessions: [...this.staffSessions.values()],
      jobs: [...this.jobs.values()],
      calls: [...this.calls.values()],
      uploadRequests: [...this.uploadRequests.values()],
      callbacks: [...this.callbacks.values()],
    };

    const temporaryPath = `${this.stateFilePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(snapshot, null, 2));
    fs.renameSync(temporaryPath, this.stateFilePath);
  }

  private runWithoutPersistence<T>(callback: () => T): T {
    this.suspendPersistence = true;
    try {
      return callback();
    } finally {
      this.suspendPersistence = false;
    }
  }

  seedDemoData(): void {
    if (this.seededDemo) {
      return;
    }

    this.runWithoutPersistence(() => {
      const staff = this.ensureStaff({
        id: "staff_demo_01",
        fullName: "Jordan Rivers",
        phoneNumber: "+61 4 1000 1234",
        email: "jordan@example.com",
        role: "Plumber",
        timezone: "Australia/Sydney",
        voiceConsentStatus: "granted",
        voiceConsentAt: new Date().toISOString(),
        calendarConnection: {
          provider: "outlook",
          accountEmail: "jordan@example.com",
          calendarId: "jordan-calendar",
          timezone: "Australia/Sydney",
          externalConnectionId: "outlook-demo-01",
          connectedAt: new Date().toISOString(),
        },
        pricingProfile: {
          baseCalloutFee: 180,
          minimumJobPrice: 260,
          hourlyRate: 135,
          rushMultiplier: 1.35,
          complexityMultiplier: 1.22,
          confidenceFloor: 0.62,
        },
      });

      const jobIds = {
        quoted: "job_demo_quoted",
        callback: "job_demo_callback",
        booked: "job_demo_booked",
      };

      this.ensureJob(jobIds.quoted, {
        staffId: staff.id,
        callerPhone: "+61 4 1111 2222",
        customerName: "Mia Chen",
        address: "12 Bedford Street, Newtown NSW 2042",
        location: { label: "Newtown" },
        issue: "Blocked kitchen drain",
        summary: "Blocked kitchen drain, likely same-day jetting and trap clean.",
        status: "new",
      });
      this.createQuote({
        staffId: staff.id,
        jobId: jobIds.quoted,
        callerPhone: "+61 4 1111 2222",
        issue: "Blocked kitchen drain",
        complexity: 5,
        hours: 1.4,
        materialsEstimate: 45,
        rush: false,
      });
      this.attachJobPhotos(jobIds.quoted, [
        {
          id: crypto.randomUUID(),
          publicUrl:
            "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=800&q=80",
          caption: "Kitchen sink",
          uploadedAt: new Date().toISOString(),
        },
        {
          id: crypto.randomUUID(),
          publicUrl:
            "https://images.unsplash.com/photo-1585704032915-c3400ca199e7?auto=format&fit=crop&w=800&q=80",
          caption: "Under-sink plumbing",
          uploadedAt: new Date().toISOString(),
        },
      ]);

      this.ensureJob(jobIds.callback, {
        staffId: staff.id,
        callerPhone: "+61 4 2222 3333",
        customerName: "Noah Patel",
        address: "77 Wilson Avenue, Marrickville NSW 2204",
        location: { label: "Marrickville" },
        issue: "Burst flexi-hose behind vanity",
        summary: "Burst flexi-hose behind vanity. Caller wants a callback before proceeding.",
        status: "new",
      });
      this.createQuote({
        staffId: staff.id,
        jobId: jobIds.callback,
        callerPhone: "+61 4 2222 3333",
        issue: "Burst flexi-hose behind vanity",
        complexity: 6,
        hours: 1.2,
        materialsEstimate: 80,
        rush: true,
      });
      this.createCallback({
        staffId: staff.id,
        jobId: jobIds.callback,
        callerPhone: "+61 4 2222 3333",
        reason: "Confirm quote and preferred arrival window",
        dueAt: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
        notes: "Customer asked for a quick callback before approving after-hours work.",
      });
      this.attachJobPhotos(jobIds.callback, [
        {
          id: crypto.randomUUID(),
          publicUrl:
            "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80",
          caption: "Bathroom vanity",
          uploadedAt: new Date().toISOString(),
        },
      ]);

      this.ensureJob(jobIds.booked, {
        staffId: staff.id,
        callerPhone: "+61 4 3333 4444",
        customerName: "Ava Johnson",
        address: "9 Oxford Street, Paddington NSW 2021",
        location: { label: "Paddington" },
        issue: "After-hours AC fault",
        summary: "After-hours AC fault. Caller uploaded exterior unit photos and wants the earliest slot.",
        status: "new",
      });
      this.createQuote({
        staffId: staff.id,
        jobId: jobIds.booked,
        callerPhone: "+61 4 3333 4444",
        issue: "After-hours AC fault",
        complexity: 7,
        hours: 2.2,
        materialsEstimate: 120,
        rush: true,
      });
      this.createAppointment({
        staffId: staff.id,
        jobId: jobIds.booked,
        startAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString(),
        timezone: "Australia/Sydney",
        location: "9 Oxford Street, Paddington NSW 2021",
        notes: "Customer prefers the earliest available arrival window.",
        outlookEventId: "demo-outlook-event-1",
      });
      this.attachJobPhotos(jobIds.booked, [
        {
          id: crypto.randomUUID(),
          publicUrl:
            "https://images.unsplash.com/photo-1590649554409-d2d7b6e3d7f2?auto=format&fit=crop&w=800&q=80",
          caption: "Outdoor unit",
          uploadedAt: new Date().toISOString(),
        },
      ]);

      this.seededDemo = true;
    });

    this.persistState();
  }

  ensureStaff(input: Partial<StaffRecord> & { id: string }): StaffRecord {
    const existing = this.staff.get(input.id);
    const now = new Date().toISOString();
    const record: StaffRecord = {
      id: input.id,
      fullName: input.fullName ?? existing?.fullName ?? `Staff ${input.id.slice(0, 8)}`,
      phoneNumber: input.phoneNumber ?? existing?.phoneNumber,
      email: input.email ?? existing?.email,
      role: input.role ?? existing?.role,
      timezone: input.timezone ?? existing?.timezone,
      inviteToken: input.inviteToken ?? existing?.inviteToken,
      otpCode: input.otpCode ?? existing?.otpCode,
      otpIssuedAt: input.otpIssuedAt ?? existing?.otpIssuedAt,
      otpFailedAttempts: input.otpFailedAttempts ?? existing?.otpFailedAttempts ?? 0,
      otpVerifiedAt: input.otpVerifiedAt ?? existing?.otpVerifiedAt,
      voiceConsentStatus: input.voiceConsentStatus ?? existing?.voiceConsentStatus ?? "pending",
      voiceConsentAt: input.voiceConsentAt ?? existing?.voiceConsentAt,
      pricingInterview: input.pricingInterview ?? existing?.pricingInterview,
      pricingProfile: input.pricingProfile ?? existing?.pricingProfile,
      calendarConnection: input.calendarConnection ?? existing?.calendarConnection,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.staff.set(record.id, record);
    this.persistState();
    return record;
  }

  getStaff(staffId?: string): StaffRecord | undefined {
    return staffId ? this.staff.get(staffId) : undefined;
  }

  inviteStaff(input: StaffInviteInput): StaffRecord {
    const id = crypto.randomUUID();
    const otpCode = String(crypto.randomInt(100000, 999999));
    return this.ensureStaff({
      id,
      fullName: input.fullName,
      phoneNumber: input.phoneNumber,
      email: input.email,
      role: input.role,
      timezone: input.timezone,
      inviteToken: crypto.randomUUID(),
      otpCode,
      otpIssuedAt: new Date().toISOString(),
      otpFailedAttempts: 0,
    });
  }

  verifyStaffOtp(input: StaffOtpVerificationInput): StaffRecord | undefined {
    if (!input.inviteToken || !input.otpCode) {
      return undefined;
    }

    const staff = [...this.staff.values()].find(
      (candidate) =>
        candidate.inviteToken === input.inviteToken &&
        (input.staffId == null || candidate.id === input.staffId),
    );
    if (!staff || !staff.otpCode || !staff.otpIssuedAt) {
      return undefined;
    }

    const issuedAt = new Date(staff.otpIssuedAt).getTime();
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 15 * 60 * 1000) {
      this.staff.set(staff.id, {
        ...staff,
        inviteToken: undefined,
        otpCode: undefined,
        otpIssuedAt: undefined,
        otpFailedAttempts: 0,
        updatedAt: new Date().toISOString(),
      });
      this.persistState();
      return undefined;
    }

    const failedAttempts = staff.otpFailedAttempts ?? 0;
    if (failedAttempts >= 5) {
      return undefined;
    }

    if (staff.otpCode !== input.otpCode) {
      const nextAttempts = failedAttempts + 1;
      this.staff.set(staff.id, {
        ...staff,
        inviteToken: nextAttempts >= 5 ? undefined : staff.inviteToken,
        otpCode: nextAttempts >= 5 ? undefined : staff.otpCode,
        otpIssuedAt: nextAttempts >= 5 ? undefined : staff.otpIssuedAt,
        otpFailedAttempts: nextAttempts,
        updatedAt: new Date().toISOString(),
      });
      this.persistState();
      return undefined;
    }

    const record: StaffRecord = {
      ...staff,
      inviteToken: undefined,
      otpCode: undefined,
      otpIssuedAt: undefined,
      otpFailedAttempts: 0,
      otpVerifiedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.staff.set(record.id, record);
    this.persistState();
    return record;
  }

  createStaffSession(staffId: string, ttlHours = 72): StaffSessionRecord | undefined {
    if (!this.staff.has(staffId)) {
      return undefined;
    }

    const now = new Date();
    const session: StaffSessionRecord = {
      token: crypto.randomBytes(24).toString("hex"),
      staffId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString(),
    };

    this.staffSessions.set(session.token, session);
    this.persistState();
    return session;
  }

  getStaffSession(token: string): StaffSessionRecord | undefined {
    const session = this.staffSessions.get(token);
    if (!session) {
      return undefined;
    }

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      this.staffSessions.delete(token);
      this.persistState();
      return undefined;
    }

    return session;
  }

  recordVoiceConsent(input: VoiceConsentInput): StaffRecord | undefined {
    if (!input.staffId) {
      return undefined;
    }

    const staff = this.staff.get(input.staffId);
    if (!staff) {
      return undefined;
    }

    return this.ensureStaff({
      ...staff,
      voiceConsentStatus: input.consent ? "granted" : "revoked",
      voiceConsentAt: input.capturedAt ?? new Date().toISOString(),
    });
  }

  savePricingInterview(input: PricingInterviewInput): StaffRecord | undefined {
    if (!input.staffId) {
      return undefined;
    }

    const staff = this.staff.get(input.staffId);
    if (!staff) {
      return undefined;
    }

    const profile = this.derivePricingProfile(input.responses ?? {});
    return this.ensureStaff({
      ...staff,
      pricingInterview: {
        answeredAt: new Date().toISOString(),
        responses: input.responses ?? {},
      },
      pricingProfile: profile,
    });
  }

  connectCalendar(input: CalendarConnectInput): StaffRecord | undefined {
    if (!input.staffId) {
      return undefined;
    }

    const staff = this.staff.get(input.staffId);
    if (!staff) {
      return undefined;
    }

    return this.ensureStaff({
      ...staff,
      calendarConnection: {
        provider: "outlook",
        accountEmail: input.accountEmail,
        calendarId: input.calendarId,
        timezone: input.timezone,
        externalConnectionId: input.externalConnectionId,
        connectedAt: new Date().toISOString(),
      },
    });
  }

  ensureJob(jobId?: string, defaults: Partial<JobRecord> = {}): JobRecord {
    const id = jobId ?? crypto.randomUUID();
    const existing = this.jobs.get(id);
    const now = new Date().toISOString();

    const record: JobRecord = {
      id,
      staffId: defaults.staffId ?? existing?.staffId,
      callerPhone: defaults.callerPhone ?? existing?.callerPhone,
      customerName: defaults.customerName ?? existing?.customerName,
      address: defaults.address ?? existing?.address,
      location: defaults.location ?? existing?.location,
      issue: defaults.issue ?? existing?.issue,
      summary: defaults.summary ?? existing?.summary,
      status: defaults.status ?? existing?.status ?? "new",
      quote: defaults.quote ?? existing?.quote,
      appointment: defaults.appointment ?? existing?.appointment,
      callbackTask: defaults.callbackTask ?? existing?.callbackTask,
      photos: defaults.photos ?? existing?.photos ?? [],
      calls: defaults.calls ?? existing?.calls ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.jobs.set(id, record);
    this.persistState();
    return record;
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(staffId?: string): JobRecord[] {
    return [...this.jobs.values()]
      .filter((job) => (staffId ? job.staffId === staffId : true))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  recordCall(input: PostCallInput): CallRecord {
    const callId = input.callId ?? crypto.randomUUID();
    const existing = this.calls.get(callId);
    const now = new Date().toISOString();
    const record: CallRecord = {
      id: callId,
      staffId: input.staffId ?? existing?.staffId,
      callerPhone: input.callerPhone ?? existing?.callerPhone,
      direction: input.direction ?? existing?.direction ?? "inbound",
      status: input.status ?? existing?.status ?? "received",
      transcript: input.transcript ?? existing?.transcript,
      summary: input.summary ?? existing?.summary,
      disposition: input.disposition ?? existing?.disposition,
      jobId: input.jobId ?? existing?.jobId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.calls.set(callId, record);

    if (record.jobId) {
      const job = this.ensureJob(record.jobId, {
        staffId: record.staffId,
        callerPhone: record.callerPhone,
      });
      job.calls = this.mergeById(job.calls, record);
      if (record.summary) {
        job.summary = record.summary;
      }
      if (record.status === "callback_requested") {
        job.status = "callback";
      } else if (record.status === "completed" && job.status !== "scheduled") {
        job.status = "closed";
      }
      job.updatedAt = now;
      this.jobs.set(job.id, job);
    }

    this.persistState();
    return record;
  }

  createQuote(input: QuoteInput): QuoteRecord {
    const now = new Date().toISOString();
    const record = this.buildQuoteRecord(input, {
      timestamp: now,
    });

    if (input.jobId) {
      const job = this.ensureJob(input.jobId, {
        staffId: input.staffId,
        callerPhone: input.callerPhone,
        issue: input.issue,
        status: "quoted",
      });
      job.quote = record;
      job.status = "quoted";
      job.updatedAt = now;
      this.jobs.set(job.id, job);
    }

    this.persistState();
    return record;
  }

  createAppointment(input: AppointmentInput): AppointmentRecord {
    const now = new Date().toISOString();
    const record: AppointmentRecord = {
      id: crypto.randomUUID(),
      status: input.startAt ? "booked" : "proposed",
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      location: input.location,
      notes: input.notes,
      outlookEventId: input.outlookEventId,
      createdAt: now,
      updatedAt: now,
    };

    if (input.jobId) {
      const job = this.ensureJob(input.jobId, {
        staffId: input.staffId,
        status: "scheduled",
      });
      job.appointment = record;
      job.status = record.status === "booked" ? "scheduled" : job.status;
      job.updatedAt = now;
      this.jobs.set(job.id, job);
    }

    this.persistState();
    return record;
  }

  createCallback(input: CallbackInput): CallbackTaskRecord {
    const now = new Date().toISOString();
    const record: CallbackTaskRecord = {
      id: crypto.randomUUID(),
      jobId: input.jobId,
      staffId: input.staffId,
      status: "queued",
      reason: input.reason,
      dueAt: input.dueAt,
      phoneNumber: input.callerPhone,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    this.callbacks.set(record.id, record);

    if (input.jobId) {
      const job = this.ensureJob(input.jobId, {
        staffId: input.staffId,
        callerPhone: input.callerPhone,
        status: "callback",
      });
      job.callbackTask = record;
      job.status = "callback";
      job.updatedAt = now;
      this.jobs.set(job.id, job);
    }

    this.persistState();
    return record;
  }

  createUploadRequest(input: SendPhotoLinkInput, publicAppUrl: string): UploadRequestRecord {
    const now = new Date().toISOString();
    const ttlHours = this.clampNumber(input.ttlHours ?? 24, 1, 168);
    const token = crypto.randomBytes(24).toString("hex");
    const record: UploadRequestRecord = {
      token,
      jobId: input.jobId,
      callerPhone: input.callerPhone,
      notes: input.notes,
      uploadLink: `${publicAppUrl.replace(/\/$/, "")}/upload/${token}`,
      createdAt: now,
      expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString(),
      files: [],
    };

    this.uploadRequests.set(token, record);
    this.persistState();
    return record;
  }

  getUploadRequest(token: string): UploadRequestRecord | undefined {
    return this.uploadRequests.get(token);
  }

  deleteUploadRequest(token: string): boolean {
    const deleted = this.uploadRequests.delete(token);
    if (deleted) {
      this.persistState();
    }
    return deleted;
  }

  attachUploadFiles(token: string, files: JobCardPhoto[]): UploadRequestRecord | undefined {
    const request = this.uploadRequests.get(token);
    if (!request) {
      return undefined;
    }

    const now = new Date().toISOString();
    request.files = [...request.files, ...files];
    request.completedAt = now;
    this.uploadRequests.set(token, request);

    if (request.jobId) {
      this.attachJobPhotos(request.jobId, files);
    }

    this.persistState();
    return request;
  }

  getJobCard(jobId: string): JobCard | undefined {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const staff = job.staffId ? this.staff.get(job.staffId) : undefined;
    return {
      job,
      staff,
      quotes: job.quote ? [job.quote] : [],
      photos: job.photos,
      calls: job.calls,
    };
  }

  getDashboard(publicBaseUrl: string): DashboardPayload {
    const jobs = [...this.jobs.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((job) => this.toDashboardJob(job, publicBaseUrl));

    const callbacks = [...this.callbacks.values()]
      .sort((left, right) => (right.dueAt ?? "").localeCompare(left.dueAt ?? ""))
      .map((callback) => this.toDashboardCallback(callback));

    return {
      jobs,
      callbacks,
      experiments: dashboardExperiments,
    };
  }

  private attachJobPhotos(jobId: string, photos: JobCardPhoto[]): void {
    const job = this.ensureJob(jobId);
    job.photos = this.mergeById(job.photos, ...photos);
    job.updatedAt = new Date().toISOString();
    this.jobs.set(job.id, job);
    this.persistState();
  }

  private toDashboardJob(job: JobRecord, publicBaseUrl: string): DashboardPayload["jobs"][number] {
    const quote = job.quote ?? this.previewQuote(job);
    const callback = job.callbackTask ? this.toDashboardCallback(job.callbackTask) : null;

    return {
      id: job.id,
      customerName: job.customerName ?? "Unknown caller",
      suburb: job.location?.label ?? job.address ?? "Unknown suburb",
      summary: job.summary ?? job.issue ?? "Awaiting call summary",
      status: this.toDashboardStatus(job.status),
      photos: job.photos.map((photo) => ({
        id: photo.id,
        url: this.resolvePhotoUrl(photo, publicBaseUrl),
        caption: photo.caption ?? photo.originalName ?? "Job photo",
      })),
      quote: {
        basePrice: quote.basePrice,
        strategyAdjustment: quote.strategyAdjustment,
        experimentAdjustment: quote.experimentAdjustment,
        presentedPrice: quote.amount,
        confidence: this.toDashboardConfidence(quote.confidence),
      },
      callback,
      updatedAt: new Date(job.updatedAt).toLocaleTimeString("en-AU", {
        hour: "numeric",
        minute: "2-digit",
      }),
    };
  }

  private previewQuote(job: JobRecord): QuoteRecord {
    return this.buildQuoteRecord(
      {
        jobId: job.id,
        staffId: job.staffId,
        callerPhone: job.callerPhone,
        issue: job.issue,
        location: job.location?.label ?? job.address,
      },
      {
        id: `preview-${job.id}`,
        timestamp: job.updatedAt,
      },
    );
  }

  private toDashboardCallback(callback: CallbackTaskRecord): DashboardCallback {
    const job = callback.jobId ? this.jobs.get(callback.jobId) : undefined;

    return {
      id: callback.id,
      customerName: job?.customerName ?? "Pending caller",
      phone: callback.phoneNumber ?? "Unknown phone",
      reason: callback.reason ?? "General follow-up",
      status:
        callback.status === "done"
          ? "closed"
          : callback.status === "open"
            ? "contacted"
            : "queued",
      dueAt:
        callback.dueAt == null
          ? "TBD"
          : new Date(callback.dueAt).toLocaleString("en-AU", {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            }),
    };
  }

  private toDashboardStatus(
    status: JobRecord["status"],
  ): DashboardPayload["jobs"][number]["status"] {
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

  private toDashboardConfidence(
    confidence: number,
  ): DashboardPayload["jobs"][number]["quote"]["confidence"] {
    if (confidence >= 0.84) {
      return "high";
    }
    if (confidence >= 0.68) {
      return "medium";
    }
    return "low";
  }

  private resolvePhotoUrl(photo: JobCardPhoto, publicBaseUrl: string): string {
    if (photo.publicUrl) {
      return photo.publicUrl;
    }

    if (photo.storedPath) {
      return `${publicBaseUrl.replace(/\/$/, "")}/uploads/files/${encodeURIComponent(
        path.basename(photo.storedPath),
      )}`;
    }

    return "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80";
  }

  private derivePricingProfile(responses: Record<string, unknown>): PricingProfile {
    const scale = typeof responses.scale === "number" ? responses.scale : 1;
    const urgency = typeof responses.urgency === "number" ? responses.urgency : 1;
    const baseCalloutFee = this.clampNumber(180 * scale, 120, 500);
    const minimumJobPrice = this.clampNumber(260 * scale, 180, 750);
    const hourlyRate = this.clampNumber(120 * urgency, 90, 280);
    const rushMultiplier = this.clampNumber(
      1.2 + (typeof responses.afterHours === "boolean" && responses.afterHours ? 0.2 : 0),
      1,
      2.5,
    );
    const complexityMultiplier = this.clampNumber(
      1.15 + (typeof responses.complexity === "number" ? responses.complexity / 20 : 0),
      1,
      2.5,
    );
    const confidenceFloor = this.clampNumber(
      typeof responses.confidenceFloor === "number" ? responses.confidenceFloor : 0.65,
      0.4,
      0.95,
    );

    return {
      baseCalloutFee,
      minimumJobPrice,
      hourlyRate,
      rushMultiplier,
      complexityMultiplier,
      confidenceFloor,
    };
  }

  private defaultPricingProfile(): PricingProfile {
    return {
      baseCalloutFee: 180,
      minimumJobPrice: 260,
      hourlyRate: 120,
      rushMultiplier: 1.35,
      complexityMultiplier: 1.2,
      confidenceFloor: 0.65,
    };
  }

  private buildQuoteRecord(
    input: QuoteInput,
    options: { id?: string; timestamp?: string } = {},
  ): QuoteRecord {
    const timestamp = options.timestamp ?? new Date().toISOString();
    const staff = this.getStaff(input.staffId);
    const profile = staff?.pricingProfile ?? this.defaultPricingProfile();
    const complexity = this.clampNumber(input.complexity ?? 4, 1, 10);
    const hours = this.clampNumber(input.hours ?? 1, 0.25, 24);
    const materialsEstimate = Math.max(0, input.materialsEstimate ?? 0);
    const labourEstimate = roundCurrency(hours * profile.hourlyRate);
    const basePrice = roundCurrency(profile.baseCalloutFee + labourEstimate + materialsEstimate);
    const rushAdjustment = input.rush
      ? roundCurrency(profile.baseCalloutFee * (profile.rushMultiplier - 1))
      : 0;
    const complexityAdjustment = roundCurrency(
      profile.baseCalloutFee * (profile.complexityMultiplier - 1) * (complexity / 5),
    );
    const strategyAdjustment = roundCurrency(rushAdjustment + complexityAdjustment);
    const variant = this.chooseVariant(input.callerPhone ?? input.jobId ?? crypto.randomUUID());
    const preExperiment = basePrice + strategyAdjustment;
    const experimentMultiplier = this.getVariantMultiplier(variant, input.rush);
    const experimentAdjustment = roundCurrency(preExperiment * (experimentMultiplier - 1));
    const floorPrice = profile.minimumJobPrice;
    const ceilingPrice = roundCurrency(
      Math.max(profile.minimumJobPrice * 3.5, preExperiment * 1.7),
    );
    const amount = roundCurrency(
      this.clampNumber(preExperiment + experimentAdjustment, floorPrice, ceilingPrice),
    );
    const confidence = this.clampNumber(
      0.94 - complexity / 25 - (input.rush ? 0.09 : 0) - (materialsEstimate > 350 ? 0.05 : 0),
      profile.confidenceFloor,
      0.99,
    );

    return {
      id: options.id ?? crypto.randomUUID(),
      staffId: input.staffId,
      amount,
      currency: "AUD",
      variant,
      basePrice,
      strategyAdjustment,
      experimentAdjustment,
      floorPrice,
      ceilingPrice,
      breakdown: {
        baseCalloutFee: profile.baseCalloutFee,
        labourEstimate,
        materialsEstimate: roundCurrency(materialsEstimate),
        complexityAdjustment,
        rushAdjustment,
      },
      confidence,
      status: "presented",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private chooseVariant(seed: string): ExperimentVariant {
    const bucket = Array.from(seed).reduce((sum, value) => sum + value.charCodeAt(0), 0) % 3;
    if (bucket === 1) {
      return "dynamic-high";
    }
    if (bucket === 2) {
      return "dynamic-low";
    }
    return "control";
  }

  private getVariantMultiplier(variant: ExperimentVariant, rush?: boolean): number {
    if (variant === "dynamic-high") {
      return rush ? 1.14 : 1.1;
    }
    if (variant === "dynamic-low") {
      return rush ? 0.98 : 0.94;
    }
    return 1;
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private mergeById<T extends { id: string }>(items: T[], ...values: T[]): T[] {
    const byId = new Map(items.map((item) => [item.id, item] as const));
    for (const value of values) {
      byId.set(value.id, value);
    }
    return [...byId.values()];
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export const crmStore = new CrmStore();
