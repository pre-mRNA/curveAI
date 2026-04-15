import type { DashboardPayload } from '../types';

export const mockDashboard: DashboardPayload = {
  jobs: [
    {
      id: 'job_1024',
      customerName: 'Mia Chen',
      suburb: 'Newtown',
      summary: 'Blocked kitchen drain, needs same-day assessment and possible high-pressure jetting.',
      status: 'quoted',
      photos: [
        { id: 'photo_1', caption: 'Kitchen sink' },
        { id: 'photo_2', caption: 'Under-sink pipework' },
      ],
      quote: {
        basePrice: 180,
        strategyAdjustment: 25,
        experimentAdjustment: -10,
        presentedPrice: 195,
        confidence: 'high',
      },
      callback: null,
      updatedAt: '10 mins ago',
    },
    {
      id: 'job_1025',
      customerName: 'Noah Patel',
      suburb: 'Marrickville',
      summary: 'Burst flexi-hose behind vanity. Customer wants a callback before proceeding.',
      status: 'needs_follow_up',
      photos: [
        { id: 'photo_3', caption: 'Bathroom vanity' },
      ],
      quote: {
        basePrice: 240,
        strategyAdjustment: 0,
        experimentAdjustment: 35,
        presentedPrice: 275,
        confidence: 'medium',
      },
      callback: {
        id: 'cb_1',
        customerName: 'Noah Patel',
        phone: '+61 4 1111 2222',
        reason: 'Confirm quote and preferred arrival window',
        status: 'queued',
        dueAt: 'Today 2:30 PM',
      },
      updatedAt: '22 mins ago',
    },
    {
      id: 'job_1026',
      customerName: 'Ava Johnson',
      suburb: 'Paddington',
      summary: 'After-hours AC fault. Caller uploaded exterior unit photos and wants the earliest bookable slot.',
      status: 'booked',
      photos: [
        { id: 'photo_4', caption: 'Outdoor unit' },
      ],
      quote: {
        basePrice: 320,
        strategyAdjustment: -20,
        experimentAdjustment: 0,
        presentedPrice: 300,
        confidence: 'high',
      },
      callback: null,
      updatedAt: '1 hour ago',
    },
  ],
  callbacks: [
    {
      id: 'cb_1',
      customerName: 'Noah Patel',
      phone: '+61 4 1111 2222',
      reason: 'Confirm quote and preferred arrival window',
      status: 'queued',
      dueAt: 'Today 2:30 PM',
    },
    {
      id: 'cb_2',
      customerName: 'Sofia Brown',
      phone: '+61 4 3333 4444',
      reason: 'Request more photos before final pricing',
      status: 'contacted',
      dueAt: 'Today 11:00 AM',
    },
  ],
  experiments: [
    {
      name: 'Dynamic pricing - after hours',
      variant: 'dynamic-high',
      exposure: '38%',
      lift: '+11% margin',
      sampleSize: 148,
    },
    {
      name: 'Short-job discounting',
      variant: 'control',
      exposure: '50%',
      lift: 'Baseline',
      sampleSize: 214,
    },
    {
      name: 'Urgency premium',
      variant: 'dynamic-low',
      exposure: '12%',
      lift: '+4% conversion',
      sampleSize: 83,
    },
  ],
};
