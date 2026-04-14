export interface ChecklistTemplateItem {
  id: string;
  section: string;
  title: string;
  prompt: string;
  keywords: string[];
}

export const onboardingChecklist: ChecklistTemplateItem[] = [
  {
    id: "services",
    section: "business",
    title: "Core services",
    prompt: "What kinds of jobs do you want the agent to talk about and qualify?",
    keywords: ["plumbing", "electrical", "hvac", "aircon", "drain", "hot water", "leak", "repair", "install"],
  },
  {
    id: "service_area",
    section: "business",
    title: "Service area",
    prompt: "Which suburbs, regions, or travel limits should the agent use when booking work?",
    keywords: ["sydney", "suburb", "postcode", "travel", "radius", "area", "region", "nsw", "metro"],
  },
  {
    id: "hours",
    section: "operations",
    title: "Operating hours",
    prompt: "What hours do you work, and do you want to handle after-hours or emergency calls?",
    keywords: ["after hours", "emergency", "weekend", "hours", "open", "close", "availability", "24/7"],
  },
  {
    id: "pricing",
    section: "pricing",
    title: "Pricing rules",
    prompt: "How do you usually quote jobs, and when should the agent avoid locking in a price?",
    keywords: ["quote", "pricing", "callout", "estimate", "fixed", "hourly", "price", "deposit", "approval"],
  },
  {
    id: "communication",
    section: "style",
    title: "Communication style",
    prompt: "How should the agent sound with customers, and how direct or consultative should it be?",
    keywords: ["friendly", "direct", "professional", "chatty", "brief", "calm", "tone", "style"],
  },
  {
    id: "escalation",
    section: "operations",
    title: "Escalation rules",
    prompt: "When should the agent book directly, and when should it create a callback instead?",
    keywords: ["callback", "escalate", "transfer", "book", "appointment", "schedule", "approval"],
  },
  {
    id: "crm",
    section: "systems",
    title: "CRM and workflow",
    prompt: "What job management or CRM system do you use today, if any?",
    keywords: ["crm", "jobber", "service", "servicem8", "simpro", "fergus", "hubspot", "spreadsheet"],
  },
  {
    id: "calendar",
    section: "systems",
    title: "Calendar readiness",
    prompt: "Should the agent write appointments straight into your calendar once you're connected?",
    keywords: ["calendar", "outlook", "microsoft", "book", "appointment", "availability"],
  },
];
