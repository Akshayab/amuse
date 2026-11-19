/** Built-in connector catalog. */
export interface CatalogItem {
  id: string;
  name: string;
  emoji: string;
  description: string;
  fields: { key: string; label: string; secret?: boolean; placeholder?: string; help?: string }[];
  supportsWrite: boolean;
  setupHelp: string;
}

export const CATALOG: CatalogItem[] = [
  {
    id: "email",
    name: "Email (Gmail, Outlook, iCloud, any IMAP)",
    emoji: "✉️",
    description: "Search and read your inbox; send emails with your approval.",
    supportsWrite: true,
    setupHelp: "For Gmail: turn on 2-step verification, then create an App Password at myaccount.google.com/apppasswords. Use imap.gmail.com / smtp.gmail.com.",
    fields: [
      { key: "username", label: "Email address", placeholder: "you@gmail.com" },
      { key: "password", label: "App password", secret: true, help: "Stored in Amuse's secure credential store. Your agent never sees it." },
      { key: "imapHost", label: "IMAP server", placeholder: "imap.gmail.com" },
      { key: "smtpHost", label: "SMTP server", placeholder: "smtp.gmail.com" },
    ],
  },
  {
    id: "calendar",
    name: "Calendar (Google, Outlook, iCloud)",
    emoji: "📅",
    description: "Read your upcoming events to flag conflicts and plan around your schedule. New events are added with one-tap 'Add to calendar' buttons.",
    supportsWrite: false,
    setupHelp: "Google Calendar: Settings → your calendar → 'Secret address in iCal format'. Outlook: Settings → Shared calendars → Publish → ICS link.",
    fields: [{ key: "feedUrl", label: "Private iCal (ICS) link", secret: true, placeholder: "https://calendar.google.com/calendar/ical/.../basic.ics" }],
  },
  {
    id: "notion",
    name: "Notion",
    emoji: "📝",
    description: "Search and update pages in your Notion workspace.",
    supportsWrite: true,
    setupHelp: "Create an internal integration at notion.so/my-integrations, copy its secret, then share the pages you want with it.",
    fields: [{ key: "token", label: "Integration secret", secret: true }],
  },
  {
    id: "github",
    name: "GitHub",
    emoji: "🐙",
    description: "Check issues, PRs and notifications.",
    supportsWrite: true,
    setupHelp: "Create a fine-grained token at github.com/settings/tokens.",
    fields: [{ key: "token", label: "Personal access token", secret: true }],
  },
  {
    id: "todoist",
    name: "Todoist",
    emoji: "✅",
    description: "Read and add tasks.",
    supportsWrite: true,
    setupHelp: "Todoist → Settings → Integrations → Developer → API token.",
    fields: [{ key: "token", label: "API token", secret: true }],
  },
];

export const API_PRESETS: Record<string, { baseUrl: string; header: string }> = {
  notion: { baseUrl: "https://api.notion.com/v1", header: "Authorization: Bearer {token}" },
  github: { baseUrl: "https://api.github.com", header: "Authorization: Bearer {token}" },
  todoist: { baseUrl: "https://api.todoist.com/rest/v2", header: "Authorization: Bearer {token}" },
};
