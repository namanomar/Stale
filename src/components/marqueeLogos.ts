/**
 * Names for the "works with" strip. The artwork lives in public/logos.svg (open "SVG Logos" collection, CC0),
 * so it is cached by the browser instead of being sent inside every page. Logos remain trademarks of their owners
 * and are shown only to say the tool can send data to Stale (the first five natively, the rest via a webhook).
 */
export interface Logo {
  id: string;
  name: string;
}

/** Mostly-black marks: drawn as white silhouettes in dark mode so they do not disappear. */
export const DARK_LOGOS = new Set(["github","ifttt","zendesk","intercom","linear","typeform","datadog","sentry","vercel","circleci","wordpress","square"]);

export const MARQUEE_LOGOS: Logo[] = [{"id":"slack","name":"Slack"},{"id":"github","name":"GitHub"},{"id":"jira","name":"Jira"},{"id":"notion","name":"Notion"},{"id":"zapier","name":"Zapier"},{"id":"n8n","name":"n8n"},{"id":"ifttt","name":"IFTTT"},{"id":"stripe","name":"Stripe"},{"id":"hubspot","name":"HubSpot"},{"id":"salesforce","name":"Salesforce"},{"id":"shopify","name":"Shopify"},{"id":"zendesk","name":"Zendesk"},{"id":"intercom","name":"Intercom"},{"id":"linear","name":"Linear"},{"id":"asana","name":"Asana"},{"id":"trello","name":"Trello"},{"id":"airtable","name":"Airtable"},{"id":"discord","name":"Discord"},{"id":"twilio","name":"Twilio"},{"id":"gitlab","name":"GitLab"},{"id":"bitbucket","name":"Bitbucket"},{"id":"figma","name":"Figma"},{"id":"mailchimp","name":"Mailchimp"},{"id":"sendgrid","name":"SendGrid"},{"id":"typeform","name":"Typeform"},{"id":"pagerduty","name":"PagerDuty"},{"id":"datadog","name":"Datadog"},{"id":"sentry","name":"Sentry"},{"id":"vercel","name":"Vercel"},{"id":"cloudflare","name":"Cloudflare"},{"id":"aws","name":"AWS"},{"id":"clickup","name":"ClickUp"},{"id":"monday","name":"monday.com"},{"id":"jenkins","name":"Jenkins"},{"id":"circleci","name":"CircleCI"},{"id":"postman","name":"Postman"},{"id":"supabase","name":"Supabase"},{"id":"segment","name":"Segment"},{"id":"mixpanel","name":"Mixpanel"},{"id":"webflow","name":"Webflow"},{"id":"wordpress","name":"WordPress"},{"id":"telegram","name":"Telegram"},{"id":"whatsapp","name":"WhatsApp"},{"id":"zoom","name":"Zoom"},{"id":"loom","name":"Loom"},{"id":"miro","name":"Miro"},{"id":"xero","name":"Xero"},{"id":"paypal","name":"PayPal"},{"id":"square","name":"Square"},{"id":"box","name":"Box"},{"id":"confluence","name":"Confluence"},{"id":"opsgenie","name":"Opsgenie"},{"id":"pipedrive","name":"Pipedrive"},{"id":"dropbox","name":"Dropbox"},{"id":"drive","name":"Google Drive"},{"id":"calendar","name":"Google Calendar"},{"id":"teams","name":"Microsoft Teams"},{"id":"docker","name":"Docker"}];
