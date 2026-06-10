import { google } from "googleapis";

export type JobEmailCategory =
  | "interview"
  | "offer"
  | "rejection"
  | "application_received"
  | "assessment"
  | "follow_up"
  | "other_job";

export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  category: JobEmailCategory;
}

// Keywords per category — checked against subject + snippet (lowercased)
const CATEGORY_RULES: { category: JobEmailCategory; keywords: string[] }[] = [
  {
    category: "offer",
    keywords: [
      "offer letter", "job offer", "we are pleased to offer", "pleased to extend",
      "offer of employment", "congratulations", "welcome to the team", "accepted your application",
      "we'd like to offer", "we would like to offer",
    ],
  },
  {
    category: "interview",
    keywords: [
      "interview", "interview invitation", "schedule a call", "schedule an interview",
      "phone screen", "video call", "zoom call", "technical interview", "hiring manager",
      "next steps", "we'd like to speak", "let's connect", "meet with our team",
    ],
  },
  {
    category: "rejection",
    keywords: [
      "unfortunately", "not moving forward", "will not be moving", "not selected",
      "other candidates", "regret to inform", "decided to pursue", "not a fit",
      "we won't be", "position has been filled", "no longer considering",
      "decided not to move", "not the right fit",
    ],
  },
  {
    category: "assessment",
    keywords: [
      "take-home", "coding challenge", "assessment", "technical test", "skills test",
      "hackerrank", "codility", "testgorilla", "pymetrics", "complete the following",
      "online test", "technical assessment",
    ],
  },
  {
    category: "application_received",
    keywords: [
      "application received", "thank you for applying", "thanks for applying",
      "we received your application", "application confirmation", "successfully submitted",
      "we have received your", "application for the",
    ],
  },
  {
    category: "follow_up",
    keywords: [
      "following up", "checking in", "update on your application",
      "status of your application", "we wanted to update you",
    ],
  },
];

// Gmail search query — only fetch emails that look job-related at all
const JOB_GMAIL_QUERY = [
  "application", "interview", "offer", "hiring", "recruiter",
  "position", "role", "job", "career", "talent", "HR",
].map((k) => `subject:(${k})`).join(" OR ");

export function classifyEmail(subject: string, snippet: string): JobEmailCategory | null {
  const text = `${subject} ${snippet}`.toLowerCase();

  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return rule.category;
    }
  }

  // Fallback: if it has generic job-related words but didn't match a specific category
  const genericJobWords = ["application", "position", "role", "recruiter", "hiring", "candidate"];
  if (genericJobWords.some((w) => text.includes(w))) {
    return "other_job";
  }

  return null; // Not job-related, skip
}

export function createGmailClient(refreshToken?: string) {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  if (refreshToken) {
    auth.setCredentials({ refresh_token: refreshToken });
  }
  return auth;
}

export function getAuthUrl(chatId: number): string {
  const auth = createGmailClient();
  return auth.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
    state: chatId.toString(),
    prompt: "consent select_account",
  });
}

export async function fetchJobEmails(
  auth: any,
  sinceTimestamp: number
): Promise<EmailSummary[]> {
  const gmail = google.gmail({ version: "v1", auth });

  const afterQuery = `after:${Math.floor(sinceTimestamp / 1000)}`;
  const query = `is:unread ${afterQuery} (${JOB_GMAIL_QUERY})`;

  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 20,
  });

  const messages = listRes.data.messages || [];
  if (messages.length === 0) return [];

  const emails: EmailSummary[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;

    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });

    const headers = detail.data.payload?.headers || [];
    const get = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "Unknown";

    const subject = get("Subject");
    const snippet = detail.data.snippet ?? "";
    const category = classifyEmail(subject, snippet);

    if (!category) continue; // Not job-related after local check — skip

    emails.push({
      id: msg.id,
      from: get("From"),
      subject,
      snippet,
      date: get("Date"),
      category,
    });
  }

  return emails;
}
