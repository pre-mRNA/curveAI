export type JobStatus = 'new' | 'quoted' | 'booked' | 'needs_follow_up' | 'completed';

export type CallbackStatus = 'queued' | 'contacted' | 'closed';

export type PricingExperimentVariant = 'control' | 'dynamic-low' | 'dynamic-high';

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
  status: CallbackStatus;
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

export interface PricingExperiment {
  name: string;
  variant: PricingExperimentVariant;
  exposure: string;
  lift: string;
  sampleSize: number;
}

export interface DashboardPayload {
  jobs: JobSummary[];
  callbacks: CallbackTask[];
  experiments: PricingExperiment[];
}
