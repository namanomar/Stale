/** Plain-language setup guides shown on each connector's "How to connect" tab. */
export interface Guide {
  /** One sentence on why you would connect it. */
  pitch: string;
  /** What Stale reads from it. */
  reads: string[];
  /** How it decides who to trust. */
  trust: string[];
  /** What you need before starting. */
  needs: string[];
  steps: { title: string; body: string; code?: string }[];
  link?: { label: string; href: string };
  /** Honest limits worth knowing before you start. */
  note?: string;
}

export const GUIDES: Record<string, Guide> = {
  slack: {
    pitch: "Learn from decisions as people make them, in the channels where they happen.",
    reads: ["Messages in channels the bot is invited to (live, as they are posted)", "Recent history of chosen channels, on demand", "Names of channels and people, if you add a bot token"],
    trust: ["Your own workspace members are trusted", "Slack Connect channels shared with another company, guests from other workspaces, and other apps' bot messages are untrusted", "You can mark any channel as always untrusted by its ID"],
    needs: ["Permission to create a Slack app in your workspace", "A public address Slack can reach (a tunnel such as cloudflared is fine while developing)"],
    steps: [
      { title: "Create a Slack app", body: "Go to api.slack.com/apps, choose Create New App → From scratch, and pick your workspace." },
      { title: "Add permissions", body: "Under OAuth & Permissions → Bot Token Scopes add the scopes below, then Install to Workspace and copy the Bot User OAuth Token (starts with xoxb-).", code: "channels:read\nchannels:history\nusers:read\ngroups:history   # only for private channels" },
      { title: "Copy the signing secret", body: "Basic Information → App Credentials → Signing Secret. Slack uses it to sign every event, and Stale rejects anything not signed with it." },
      { title: "Connect here", body: "Press Connect on this page and paste the signing secret and the bot token. Stale gives you a Request URL." },
      { title: "Point Slack at Stale", body: "Event Subscriptions → turn on → paste the Request URL. Slack checks it immediately. Then under Subscribe to bot events add the events below and save.", code: "message.channels\nmessage.groups   # private channels" },
      { title: "Invite the bot", body: "In each channel you want remembered, type the line below. The bot only sees channels it was invited to.", code: "/invite @YourApp" },
    ],
    link: { label: "Slack app dashboard", href: "https://api.slack.com/apps" },
    note: "Slack must be able to reach your Request URL over the internet. On a laptop, run a tunnel and use its address.",
  },
  email: {
    pitch: "Vendors and customers say important things by email. Forward them here and the sender's domain decides how far to trust them.",
    reads: ["Subject and plain-text body of each forwarded email", "The sender address and date"],
    trust: ["Senders at the company domains you list are trusted", "Everyone else, including look-alike domains, is untrusted: remembered, but never able to trigger an action"],
    needs: ["A mail rule, or an inbound-email service (Postmark, Mailgun, SendGrid, Zapier) that can POST JSON"],
    steps: [
      { title: "Create the address", body: "Press Connect, list your company's domains (for example northwind.com) and create it. You get an address and a secret. The secret is shown once." },
      { title: "Send mail to it", body: "Have your mail tool POST each message as JSON with the secret in a header. A quick test from a terminal:", code: "curl -X POST <your address> \\\n  -H \"x-stale-secret: <your secret>\" \\\n  -H \"content-type: application/json\" \\\n  -d '{\"from\":\"vendor@acme.com\",\"subject\":\"Quote\",\"text\":\"Our price is $90 per unit.\"}'" },
      { title: "Automate it", body: "In Postmark or Mailgun set the inbound webhook to your address. For Gmail or Outlook, use a Zapier or Make step that posts new mail matching a label." },
    ],
    note: "Mail is pushed to Stale; Stale does not log in to your mailbox. That keeps it simple and keeps your mailbox credentials out of the system.",
  },
  jira: {
    pitch: "Schedules, owners and blockers live in tickets. When a ticket slips, anything that assumed the old date should know.",
    reads: ["Issues in the projects you choose: title, description, status", "Comments on those issues"],
    trust: ["Your team's tickets and comments are trusted", "Reports and comments from service-desk customers are untrusted"],
    needs: ["An Atlassian Cloud site (yourcompany.atlassian.net)", "An API token for an account that can see the projects"],
    steps: [
      { title: "Create an API token", body: "Open id.atlassian.com → Security → API tokens → Create API token. Copy it." },
      { title: "Connect here", body: "Press Connect and enter your site (for example yourcompany.atlassian.net), your Atlassian email and the token. Stale checks it against Jira before saving anything." },
      { title: "Choose projects and import", body: "Pick the projects to read. The newest issues and comments are imported; run it again any time, already-seen items are skipped." },
    ],
    link: { label: "Create an Atlassian API token", href: "https://id.atlassian.com/manage-profile/security/api-tokens" },
    note: "Only Atlassian Cloud sites are supported (it will refuse any other address).",
  },
  github: {
    pitch: "Engineering decisions hide in issues and review threads. Capture them, and keep strangers' comments out of the trusted set.",
    reads: ["Issues and pull requests: title, body, state, labels", "Comments on them"],
    trust: ["Owners, members and collaborators are trusted", "Everyone else, such as drive-by commenters on a public repo, is untrusted"],
    needs: ["A GitHub account with access to the repositories", "A personal access token with read access to Issues and Pull requests"],
    steps: [
      { title: "Create a token", body: "GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate. Select the repositories and give Issues and Pull requests read-only access." },
      { title: "Connect here", body: "Press Connect and paste the token. Stale checks it against GitHub before saving." },
      { title: "Choose repositories and import", body: "Pick the repositories to read. The newest issues, PRs and comments are imported; repeat any time." },
    ],
    link: { label: "Create a fine-grained token", href: "https://github.com/settings/personal-access-tokens/new" },
  },
  notion: {
    pitch: "Wikis and policies are where facts quietly go out of date. Connect them and every edit is compared with what was believed before.",
    reads: ["The text of pages you share with the integration (headings, paragraphs, lists, to-dos, tables)"],
    trust: ["Pages inside your workspace are trusted"],
    needs: ["Permission to create an internal integration in Notion"],
    steps: [
      { title: "Create an integration", body: "Open notion.so/profile/integrations → New integration → Internal. Copy the Internal Integration Secret." },
      { title: "Share pages with it", body: "Notion integrations see nothing by default. On each page (or a parent page) open ••• → Connections → add your integration." },
      { title: "Connect here", body: "Press Connect and paste the secret. Stale checks it before saving." },
      { title: "Choose pages and import", body: "Pick the pages to read. Edited pages are read again; unchanged ones are skipped." },
    ],
    link: { label: "Notion integrations", href: "https://www.notion.so/profile/integrations" },
  },
  webhook: {
    pitch: "Anything that can send an HTTP request can feed memory: your CRM, a form, a cron job, Zapier, n8n.",
    reads: ["Whatever text you POST, with a source name and optional author and link"],
    trust: ["Trusted by default", "Add \"untrusted\": true to any request that came from outside your company"],
    needs: ["Something that can make a POST request"],
    steps: [
      { title: "Create the webhook", body: "Press Connect. You get an address and a secret (shown once)." },
      { title: "Send text to it", body: "POST JSON with the secret in a header:", code: "curl -X POST <your address> \\\n  -H \"x-stale-secret: <your secret>\" \\\n  -H \"content-type: application/json\" \\\n  -d '{\"source\":\"CRM\",\"author\":\"Dana\",\"text\":\"The renewal price is $9,000 per year.\"}'" },
      { title: "Repeat safely", body: "Include an \"id\" if you may resend the same item; repeats with the same id are ignored." },
    ],
  },
};
