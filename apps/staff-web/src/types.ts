export type StaffVoiceConsentStatus = 'pending' | 'granted' | 'revoked';
export type JobStatus = 'new' | 'quoted' | 'booked' | 'needs_follow_up' | 'completed';

export interface StaffSession {
  token: string;
  expiresAt: string;
  staffId: string;
}

export interface CalendarConnection {
  provider: 'outlook';
  accountEmail?: string;
  calendarId?: string;
  timezone?: string;
  externalConnectionId?: string;
  connectedAt: string;
}

export interface PricingProfile {
  baseCalloutFee: number;
  minimumJobPrice: number;
  hourlyRate: number;
  rushMultiplier: number;
  complexityMultiplier: number;
  confidenceFloor: number;
}

export interface StaffProfile {
  id: string;
  fullName: string;
  phoneNumber?: string;
  email?: string;
  role?: string;
  timezone?: string;
  companyName?: string;
  calendarProvider?: string;
  outlookCalendarId?: string;
  voiceCloneId?: string;
  updatedAt?: string;
  voiceConsentStatus: StaffVoiceConsentStatus;
  voiceConsentAt?: string;
  otpVerifiedAt?: string;
  calendarConnection?: CalendarConnection;
  pricingProfile?: PricingProfile;
}

export interface PhotoAsset {
  id: string;
  url: string;
  caption: string;
}

export interface CallbackTask {
  id: string;
  customerName: string;
  phone: string;
  reason: string;
  status: 'queued' | 'contacted' | 'closed';
  dueAt: string;
}

export interface QuoteState {
  basePrice: number;
  strategyAdjustment: number;
  experimentAdjustment: number;
  presentedPrice: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface JobSummary {
  id: string;
  customerName: string;
  suburb: string;
  summary: string;
  status: JobStatus;
  photos: PhotoAsset[];
  quote: QuoteState;
  callback?: CallbackTask | null;
  updatedAt: string;
}

export interface CallRecord {
  id: string;
  direction: 'inbound' | 'outbound';
  status: 'received' | 'in_progress' | 'completed' | 'callback_requested' | 'transferred' | 'abandoned';
  summary?: string;
  transcript?: string;
  createdAt: string;
}

export interface DetailedQuote {
  id: string;
  amount: number;
  currency: string;
  variant: 'control' | 'dynamic-low' | 'dynamic-high';
  confidence: number;
  status: 'draft' | 'presented' | 'accepted' | 'rejected';
  rationale: string[];
  createdAt: string;
}

export interface Appointment {
  id: string;
  status: 'proposed' | 'booked' | 'rescheduled' | 'cancelled';
  startAt?: string;
  endAt?: string;
  timezone?: string;
  location?: string;
  notes?: string;
}

export interface JobCard {
  job: {
    id: string;
    staffId?: string;
    callerName?: string;
    callerPhone?: string;
    callerEmail?: string;
    address?: string;
    issue?: string;
    summary?: string;
    status: 'new' | 'quoted' | 'scheduled' | 'callback' | 'closed';
    photos: Array<{
      id: string;
      filename: string;
      url?: string;
      caption?: string;
      uploadedAt: string;
    }>;
    appointment?: Appointment;
    callbackTask?: {
      id: string;
      reason?: string;
      phoneNumber?: string;
      dueAt?: string;
      notes?: string;
    };
    createdAt: string;
    updatedAt: string;
  };
  staff?: {
    id: string;
    fullName: string;
    role?: string;
  };
  quotes: DetailedQuote[];
  photos: Array<{
    id: string;
    filename: string;
    url?: string;
    caption?: string;
    uploadedAt: string;
  }>;
  calls: CallRecord[];
}

export interface JudgeChecklistItem {
  label: string;
  detail: string;
}

export interface TestScenario {
  id: string;
  title: string;
  category: string;
  prompt: string;
  objective: string;
  successCriteria: JudgeChecklistItem[];
  judgeNotes: string;
}
