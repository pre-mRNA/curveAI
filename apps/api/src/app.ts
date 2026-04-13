import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { type ZodTypeAny } from "zod";
import { type AppEnv } from "./config/env";
import {
  crmStore,
  type AppointmentInput,
  type CallbackInput,
  type CalendarConnectInput,
  type JobRecord,
  type JobCardPhoto,
  type PostCallInput,
  type PricingInterviewInput,
  type QuoteInput,
  type SendPhotoLinkInput,
  type StaffInviteInput,
  type StaffOtpVerificationInput,
  type VoiceConsentInput,
  type VoiceContextInput,
} from "./store/crm-store";
import {
  appointmentInputSchema,
  calendarConnectInputSchema,
  callbackInputSchema,
  postCallInputSchema,
  pricingInterviewInputSchema,
  quoteInputSchema,
  sendPhotoLinkInputSchema,
  staffInviteInputSchema,
  staffOtpVerificationInputSchema,
  voiceConsentInputSchema,
  voiceContextInputSchema,
} from "./validation";

type JsonRecord = Record<string, unknown>;
type AuthenticatedActor = { kind: "admin" } | { kind: "staff"; staffId: string };
type RequestWithRawBody = Request & { rawBody?: string };

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }

  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function respondError(res: Response, status: number, message: string, details?: JsonRecord): Response {
  return res.status(status).json({
    ok: false,
    error: {
      message,
      ...(details ? { details } : {}),
    },
  });
}

function validateInput<TSchema extends ZodTypeAny>(
  res: Response,
  schema: TSchema,
  input: unknown,
): TSchema["_output"] | undefined {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  respondError(res, 400, "Invalid request payload", {
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
  return undefined;
}

function makeToolList() {
  return ["quote", "appointment", "callback", "send-photo-link", "end_call"];
}

function sanitizeStaff<T extends { otpCode?: unknown; inviteToken?: unknown }>(
  staff: T | undefined,
): Omit<T, "otpCode" | "inviteToken"> | undefined {
  if (!staff) {
    return undefined;
  }

  const { otpCode: _otpCode, inviteToken: _inviteToken, ...safeStaff } = staff;
  return safeStaff;
}

function getAccessToken(req: Request): string | undefined {
  const authorization = req.get("authorization");
  if (authorization) {
    const [scheme, ...rest] = authorization.split(/\s+/);
    if (scheme && /^bearer$/i.test(scheme) && rest.length > 0) {
      return rest.join(" ").trim();
    }
  }

  return asString(req.get("x-admin-token")) ?? asString(req.get("x-staff-session"));
}

function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeSignature(signature: string | undefined): string | undefined {
  if (!signature) {
    return undefined;
  }
  return signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
}

function signAutomationRequest(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

function authenticateActor(req: Request, env: AppEnv): AuthenticatedActor | undefined {
  const token = getAccessToken(req);
  if (!token) {
    return undefined;
  }

  if (env.adminToken && timingSafeEqualText(token, env.adminToken)) {
    return { kind: "admin" };
  }

  const session = crmStore.getStaffSession(token);
  if (!session) {
    return undefined;
  }

  return {
    kind: "staff",
    staffId: session.staffId,
  };
}

function requireAdminAuth(env: AppEnv) {
  return (req: Request, res: Response, next: NextFunction) => {
    const actor = authenticateActor(req, env);
    if (!actor || actor.kind !== "admin") {
      return respondError(res, 401, "Admin authentication is required");
    }
    return next();
  };
}

function requireAutomationSignature(env: AppEnv) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!env.automationSharedSecret) {
      return respondError(res, 503, "Automation signature secret is not configured");
    }

    const timestamp = asString(req.get("x-curve-timestamp"));
    const signature = normalizeSignature(asString(req.get("x-curve-signature")));
    const rawBody = (req as RequestWithRawBody).rawBody ?? "";

    if (!timestamp || !signature) {
      return respondError(res, 401, "Signed automation headers are required");
    }

    const timestampMs = Number(timestamp);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      return respondError(res, 401, "Automation signature timestamp is invalid or expired");
    }

    const expected = signAutomationRequest(env.automationSharedSecret, timestamp, rawBody);
    if (!timingSafeEqualText(signature, expected)) {
      return respondError(res, 401, "Automation signature did not match");
    }

    return next();
  };
}

function requireStaffAccess(req: Request, res: Response, env: AppEnv, staffId: string | undefined) {
  const actor = authenticateActor(req, env);
  if (!actor) {
    respondError(res, 401, "Authentication is required");
    return undefined;
  }

  if (!staffId) {
    respondError(res, 400, "staffId is required");
    return undefined;
  }

  if (actor.kind === "admin" || actor.staffId === staffId) {
    return actor;
  }

  respondError(res, 403, "You do not have access to that staff record");
  return undefined;
}

function createUploadMiddleware(uploadDir: string) {
  const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);
  fs.mkdirSync(uploadDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDir),
    filename: (_req, file, callback) => {
      const safeBaseName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
      callback(null, `${Date.now()}-${crypto.randomUUID()}-${safeBaseName}`);
    },
  });

  return multer({
    storage,
    fileFilter: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const isImageMime = file.mimetype.startsWith("image/");
      if (!isImageMime || !allowedExtensions.has(extension)) {
        callback(new Error("Only image uploads are allowed"));
        return;
      }
      callback(null, true);
    },
    limits: {
      fileSize: 15 * 1024 * 1024,
      files: 10,
    },
  });
}

function removeUploadedFiles(files: Express.Multer.File[]): void {
  for (const file of files) {
    try {
      fs.rmSync(file.path, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function extractFiles(
  files: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] } | undefined,
): Express.Multer.File[] {
  if (!files) {
    return [];
  }

  if (Array.isArray(files)) {
    return files;
  }

  return [...(files.files ?? []), ...(files.photos ?? [])];
}

function toInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "TC";
}

function toConfidenceLabel(confidence?: number): string {
  if (confidence == null) {
    return "Awaiting confidence";
  }
  if (confidence >= 0.84) {
    return "High confidence";
  }
  if (confidence >= 0.68) {
    return "Medium confidence";
  }
  return "Low confidence";
}

function toPhotoTint(seed: string): string {
  const palette = ["indigo", "cyan", "teal", "orange", "pink"];
  const bucket = Array.from(seed).reduce((sum, character) => sum + character.charCodeAt(0), 0) % palette.length;
  return palette[bucket] ?? "indigo";
}

function toTradiePhoto(photo: JobCardPhoto) {
  return {
    id: photo.id,
    caption: photo.caption ?? photo.originalName ?? "Job photo",
    tint: toPhotoTint(photo.id),
  };
}

function toTradieJob(job: JobRecord, publicBaseUrl: string) {
  const customerName = job.customerName ?? "Unknown caller";
  const suburb = job.location?.label ?? job.address ?? "Unknown suburb";
  const quote = job.quote;
  const nextAction =
    job.callbackTask?.status === "queued"
      ? "Return the callback and confirm scope"
      : job.appointment
        ? "Arrive for the scheduled appointment"
        : quote
          ? "Confirm the quote and lock in the booking"
          : "Collect more detail and confirm the next step";

  return {
    id: job.id,
    customerName,
    customerInitials: toInitials(customerName),
    phoneNumber: job.callerPhone ?? "Unknown phone",
    addressLine: job.address ?? suburb,
    suburb,
    proposedQuote: quote ? `$${Math.round(quote.amount)}` : "Pending quote",
    quoteConfidence: toConfidenceLabel(quote?.confidence),
    nextAction,
    notes: job.summary ?? job.issue ?? "Awaiting call summary",
    photos: job.photos.map(toTradiePhoto),
    locationSummary: job.location?.label ?? suburb,
    photoUrls: job.photos.map((photo) => ({
      id: photo.id,
      url:
        photo.publicUrl ??
        (photo.storedPath
          ? `${publicBaseUrl.replace(/\/$/, "")}/uploads/files/${encodeURIComponent(path.basename(photo.storedPath))}`
          : undefined),
    })),
  };
}

export function createApp(env: AppEnv) {
  crmStore.configurePersistence(env.stateFilePath);
  if (env.enableDemoData) {
    crmStore.seedDemoData();
  }

  const app = express();
  const upload = createUploadMiddleware(env.uploadDir);
  const uploadPhotos = upload.fields([
    { name: "files", maxCount: 10 },
    { name: "photos", maxCount: 10 },
  ]);
  const adminOnly = requireAdminAuth(env);
  const automationOnly = requireAutomationSignature(env);
  const captureRawBody = (req: Request, _res: Response, buffer: Buffer) => {
    (req as RequestWithRawBody).rawBody = buffer.toString("utf8");
  };
  const allowHeaders = [
    "authorization",
    "content-type",
    "x-admin-token",
    "x-staff-session",
    "x-curve-signature",
    "x-curve-timestamp",
  ].join(", ");
  const allowMethods = "GET,POST,OPTIONS";

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const origin = asString(req.get("origin"));
    if (origin && env.allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", allowHeaders);
      res.setHeader("Access-Control-Allow-Methods", allowMethods);
    }

    if (req.method === "OPTIONS") {
      return origin && !env.allowedOrigins.includes(origin) ? res.sendStatus(403) : res.sendStatus(204);
    }

    return next();
  });
  app.use(express.json({ limit: "2mb", verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, verify: captureRawBody }));
  app.use("/uploads/files", express.static(env.uploadDir));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "curve-ai-api",
      env: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
      stats: crmStore.getStats(),
      secretsLoaded: env.secretsFilePaths.map((filePath) => path.basename(filePath)),
    });
  });

  app.get("/dashboard", adminOnly, (_req, res) => {
    res.json(crmStore.getDashboard(env.publicBaseUrl));
  });

  app.post("/voice/context", automationOnly, (req, res) => {
    const body = asObject(req.body);
    const input: VoiceContextInput = {
      staffId: asString(body.staffId),
      callerPhone: asString(body.callerPhone),
      jobId: asString(body.jobId),
      callerName: asString(body.callerName),
      customerName: asString(body.customerName),
      address: asString(body.address),
      issue: asString(body.issue),
    };
    const validatedInput = validateInput(res, voiceContextInputSchema, input);
    if (!validatedInput) {
      return;
    }

    const staff =
      crmStore.getStaff(validatedInput.staffId) ??
      (validatedInput.staffId ? crmStore.ensureStaff({ id: validatedInput.staffId }) : undefined);
    const job = validatedInput.jobId
      ? crmStore.ensureJob(validatedInput.jobId, {
          staffId: validatedInput.staffId,
          callerPhone: validatedInput.callerPhone,
          customerName: validatedInput.customerName,
          address: validatedInput.address,
          issue: validatedInput.issue,
        })
      : undefined;

    res.json({
      ok: true,
      context: {
        staff: sanitizeStaff(staff),
        job,
        caller: {
          phone: input.callerPhone,
          name: input.callerName,
        },
        directives: [
          "Collect the job details, location, and urgency.",
          "Quote within guardrails and prefer callback if confidence is low.",
          "Book the Outlook calendar if the staff member is connected.",
          "Send a photo upload link when imagery would improve the estimate.",
          "Use the end_call tool when the issue is resolved or a callback is scheduled.",
        ],
        availableTools: makeToolList(),
      },
    });
  });

  app.post("/voice/tools/quote", automationOnly, (req, res) => {
    const body = asObject(req.body);
    const input: QuoteInput = {
      staffId: asString(body.staffId),
      jobId: asString(body.jobId),
      callerPhone: asString(body.callerPhone),
      issue: asString(body.issue),
      urgency: asString(body.urgency),
      complexity: asNumber(body.complexity),
      hours: asNumber(body.hours),
      materialsEstimate: asNumber(body.materialsEstimate),
      rush: asBoolean(body.rush),
      location: asString(body.location),
    };
    const validatedInput = validateInput(res, quoteInputSchema, input);
    if (!validatedInput) {
      return;
    }

    const quote = crmStore.createQuote(validatedInput);
    res.status(201).json({
      ok: true,
      quote,
    });
  });

  app.post("/voice/tools/appointment", automationOnly, (req, res) => {
    const body = asObject(req.body);
    const input: AppointmentInput = {
      staffId: asString(body.staffId),
      jobId: asString(body.jobId),
      startAt: asString(body.startAt),
      endAt: asString(body.endAt),
      timezone: asString(body.timezone),
      location: asString(body.location),
      notes: asString(body.notes),
      outlookEventId: asString(body.outlookEventId),
    };
    const validatedInput = validateInput(res, appointmentInputSchema, input);
    if (!validatedInput) {
      return;
    }

    const appointment = crmStore.createAppointment(validatedInput);
    res.status(201).json({
      ok: true,
      appointment,
    });
  });

  app.post("/voice/tools/callback", automationOnly, (req, res) => {
    const body = asObject(req.body);
    const input: CallbackInput = {
      staffId: asString(body.staffId),
      jobId: asString(body.jobId),
      callerPhone: asString(body.callerPhone),
      reason: asString(body.reason),
      dueAt: asString(body.dueAt),
      notes: asString(body.notes),
    };
    const validatedInput = validateInput(res, callbackInputSchema, input);
    if (!validatedInput) {
      return;
    }

    const callbackTask = crmStore.createCallback(validatedInput);
    res.status(201).json({
      ok: true,
      callbackTask,
    });
  });

  app.post("/voice/tools/send-photo-link", automationOnly, (req, res) => {
    const body = asObject(req.body);
    const input: SendPhotoLinkInput = {
      staffId: asString(body.staffId),
      jobId: asString(body.jobId),
      callerPhone: asString(body.callerPhone),
      notes: asString(body.notes),
      ttlHours: asNumber(body.ttlHours),
    };
    const validatedInput = validateInput(res, sendPhotoLinkInputSchema, input);
    if (!validatedInput) {
      return;
    }

    const uploadRequest = crmStore.createUploadRequest(validatedInput, env.publicAppUrl);
    res.status(201).json({
      ok: true,
      uploadRequest,
      message: "Photo upload link generated. Send the uploadLink to the caller via SMS.",
    });
  });

  app.post("/voice/post-call", automationOnly, (req, res) => {
    const body = asObject(req.body);
    const input: PostCallInput = {
      staffId: asString(body.staffId),
      callId: asString(body.callId),
      jobId: asString(body.jobId),
      callerPhone: asString(body.callerPhone),
      direction: body.direction === "outbound" ? "outbound" : "inbound",
      status: asString(body.status) as PostCallInput["status"],
      transcript: asString(body.transcript),
      summary: asString(body.summary),
      disposition: asString(body.disposition),
    };
    const validatedInput = validateInput(res, postCallInputSchema, input);
    if (!validatedInput) {
      return;
    }

    const call = crmStore.recordCall(validatedInput);
    res.status(201).json({
      ok: true,
      call,
    });
  });

  app.post("/staff/invite", adminOnly, (req, res) => {
    const body = asObject(req.body);
    const input: StaffInviteInput = {
      fullName: asString(body.fullName),
      phoneNumber: asString(body.phoneNumber),
      email: asString(body.email),
      role: asString(body.role),
      timezone: asString(body.timezone),
    };
    const validatedInput = validateInput(res, staffInviteInputSchema, input);
    if (!validatedInput) {
      return;
    }

    const staff = crmStore.inviteStaff(validatedInput);
    const safeStaff = sanitizeStaff(staff);
    res.status(201).json({
      ok: true,
      staff: safeStaff,
      inviteCode: staff.inviteToken,
      ...(env.nodeEnv === "production"
        ? {}
        : {
            otpCode: staff.otpCode,
            note: "OTP is returned only outside production. Production should send it out-of-band.",
          }),
    });
  });

  app.post("/staff/verify-otp", (req, res) => {
    const body = asObject(req.body);
    const input: StaffOtpVerificationInput = {
      staffId: asString(body.staffId),
      inviteToken: asString(body.inviteToken),
      otpCode: asString(body.otpCode),
    };
    const validatedInput = validateInput(res, staffOtpVerificationInputSchema, input);
    if (!validatedInput) {
      return;
    }

    const staff = crmStore.verifyStaffOtp(validatedInput);
    if (!staff) {
      return respondError(res, 404, "Staff not found or OTP did not match");
    }

    const session = crmStore.createStaffSession(staff.id);
    if (!session) {
      return respondError(res, 500, "Unable to create a staff session");
    }

    return res.json({
      ok: true,
      staff: sanitizeStaff(staff),
      session: {
        token: session.token,
        expiresAt: session.expiresAt,
      },
    });
  });

  app.get("/staff/me", (req, res) => {
    const actor = authenticateActor(req, env);
    if (!actor) {
      return respondError(res, 401, "Authentication is required");
    }

    if (actor.kind === "admin") {
      return respondError(res, 400, "Admin tokens do not map to a single staff profile");
    }

    const staff = crmStore.getStaff(actor.staffId);
    if (!staff) {
      return respondError(res, 404, "Staff not found");
    }

    return res.json({
      ok: true,
      staff: sanitizeStaff(staff),
    });
  });

  app.get("/jobs", (req, res) => {
    const actor = authenticateActor(req, env);
    if (!actor) {
      return respondError(res, 401, "Authentication is required");
    }

    const requestedStaffId = asString(req.query.staffId);
    if (actor.kind !== "admin" && requestedStaffId && requestedStaffId !== actor.staffId) {
      return respondError(res, 403, "You do not have access to that staff queue");
    }

    const staffId = actor.kind === "admin" ? requestedStaffId : actor.staffId;
    const jobs = crmStore.listJobs(staffId).map((job) => toTradieJob(job, env.publicBaseUrl));

    return res.json({
      ok: true,
      jobs,
    });
  });

  app.post("/staff/voice-consent", (req, res) => {
    const body = asObject(req.body);
    const input: VoiceConsentInput = {
      staffId: asString(body.staffId),
      consent: asBoolean(body.consent),
      signedBy: asString(body.signedBy),
      capturedAt: asString(body.capturedAt),
    };
    const validatedInput = validateInput(res, voiceConsentInputSchema, input);
    if (!validatedInput) {
      return;
    }

    if (!requireStaffAccess(req, res, env, validatedInput.staffId)) {
      return;
    }

    const staff = crmStore.recordVoiceConsent(validatedInput);
    if (!staff) {
      return respondError(res, 404, "Staff not found");
    }

    return res.json({
      ok: true,
      staff: sanitizeStaff(staff),
      signedBy: validatedInput.signedBy,
    });
  });

  app.post("/staff/pricing-interview", (req, res) => {
    const body = asObject(req.body);
    const input: PricingInterviewInput = {
      staffId: asString(body.staffId),
      responses: asObject(body.responses),
    };
    const validatedInput = validateInput(res, pricingInterviewInputSchema, input);
    if (!validatedInput) {
      return;
    }

    if (!requireStaffAccess(req, res, env, validatedInput.staffId)) {
      return;
    }

    const staff = crmStore.savePricingInterview(validatedInput);
    if (!staff) {
      return respondError(res, 404, "Staff not found");
    }

    return res.json({
      ok: true,
      staff: sanitizeStaff(staff),
      pricingProfile: staff.pricingProfile,
    });
  });

  app.post("/staff/calendar/connect", (req, res) => {
    const body = asObject(req.body);
    const input: CalendarConnectInput = {
      staffId: asString(body.staffId),
      provider: "outlook",
      accountEmail: asString(body.accountEmail),
      calendarId: asString(body.calendarId),
      timezone: asString(body.timezone),
      externalConnectionId: asString(body.externalConnectionId),
    };
    const validatedInput = validateInput(res, calendarConnectInputSchema, input);
    if (!validatedInput) {
      return;
    }

    if (!requireStaffAccess(req, res, env, validatedInput.staffId)) {
      return;
    }

    const staff = crmStore.connectCalendar(validatedInput);
    if (!staff) {
      return respondError(res, 404, "Staff not found");
    }

    return res.json({
      ok: true,
      staff: sanitizeStaff(staff),
      calendarConnection: staff.calendarConnection,
    });
  });

  app.get("/jobs/:jobId/card", (req, res) => {
    const jobId = asString(req.params.jobId);
    if (!jobId) {
      return respondError(res, 400, "jobId is required");
    }

    const card = crmStore.getJobCard(jobId);
    if (!card) {
      return respondError(res, 404, "Job not found", { jobId });
    }

    const actor = authenticateActor(req, env);
    if (!actor) {
      return respondError(res, 401, "Authentication is required");
    }
    if (actor.kind !== "admin" && card.job.staffId && card.job.staffId !== actor.staffId) {
      return respondError(res, 403, "You do not have access to that job");
    }

    return res.json({
      ok: true,
      card: {
        ...card,
        staff: sanitizeStaff(card.staff),
      },
    });
  });

  const requireActiveUploadToken = (req: Request, res: Response, next: NextFunction) => {
    const token = asString(req.params.token);
    if (!token) {
      return respondError(res, 400, "token is required");
    }

    const uploadRequest = crmStore.getUploadRequest(token);
    if (!uploadRequest) {
      return respondError(res, 404, "Upload token not found");
    }

    if (new Date(uploadRequest.expiresAt).getTime() < Date.now()) {
      crmStore.deleteUploadRequest(token);
      return respondError(res, 410, "Upload link has expired");
    }

    return next();
  };

  const handleUpload = (req: Request, res: Response) => {
    const token = asString(req.params.token);
    if (!token) {
      return respondError(res, 400, "token is required");
    }

    const uploadRequest = crmStore.getUploadRequest(token);
    if (!uploadRequest) {
      return respondError(res, 404, "Upload token not found");
    }

    if (new Date(uploadRequest.expiresAt).getTime() < Date.now()) {
      removeUploadedFiles(extractFiles(req.files as { [fieldname: string]: Express.Multer.File[] } | undefined));
      crmStore.deleteUploadRequest(token);
      return respondError(res, 410, "Upload link has expired");
    }

    const files = extractFiles(req.files as { [fieldname: string]: Express.Multer.File[] } | undefined);
    if (files.length === 0) {
      return respondError(res, 400, "At least one file must be uploaded in the files or photos field");
    }

    const photoRecords = files.map((file) => ({
      id: crypto.randomUUID(),
      token,
      originalName: file.originalname,
      storedPath: file.path,
      mimeType: file.mimetype,
      caption: file.originalname,
      uploadedAt: new Date().toISOString(),
    }));

    const updated = crmStore.attachUploadFiles(token, photoRecords);
    if (!updated) {
      removeUploadedFiles(files);
      return respondError(res, 404, "Upload token not found");
    }

    const safeFiles = photoRecords.map((photo) => ({
      id: photo.id,
      originalName: photo.originalName,
      caption: photo.caption,
      uploadedAt: photo.uploadedAt,
    }));

    return res.status(201).json({
      ok: true,
      uploaded: photoRecords.length,
      uploadRequest: {
        ...updated,
        files: updated.files.map((photo) => ({
          id: photo.id,
          originalName: photo.originalName,
          caption: photo.caption,
          uploadedAt: photo.uploadedAt,
        })),
      },
      files: safeFiles,
    });
  };

  app.post("/uploads/:token", requireActiveUploadToken, uploadPhotos, handleUpload);
  app.post("/uploads/:token/photos", requireActiveUploadToken, uploadPhotos, handleUpload);

  app.use((error: unknown, _req: Request, res: Response, next: (error?: unknown) => void) => {
    if (error instanceof multer.MulterError || error instanceof Error) {
      return respondError(res, 400, error.message);
    }
    return next(error);
  });

  app.use((_req, res) => {
    res.status(404).json({
      ok: false,
      error: {
        message: "Not found",
      },
    });
  });

  return app;
}
