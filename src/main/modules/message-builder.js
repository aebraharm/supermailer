'use strict';

const { renderTemplate, htmlToText, buildRecipientData } = require('./personalize');
const { formatAddress, validateEmail } = require('./email-utils');

/**
 * Builds nodemailer message objects from a campaign snapshot and a recipient.
 *
 * Headers come only from the configured sender account: From is the sender
 * the user configured, Reply-To is the user's reply address, and
 * List-Unsubscribe is added for marketing campaigns when an unsubscribe
 * address/URL is configured. No headers are forged or spoofed.
 */

const SUBJECT_MAX = 300;

/**
 * Compose the final content for one recipient.
 * campaign: { subject, bodyHtml, bodyText, senderName, fromEmail, replyTo, unsubscribeText? }
 */
function renderForRecipient(campaign, recipient) {
  const data = buildRecipientData(recipient);
  const subject = renderTemplate(campaign.subject || '', data, { escape: false })
    .replace(/[\r\n]+/g, ' ')
    .slice(0, SUBJECT_MAX);
  const html = renderTemplate(campaign.bodyHtml || '', data, { escape: true });
  let text = campaign.bodyText && campaign.bodyText.trim()
    ? renderTemplate(campaign.bodyText, data, { escape: false })
    : htmlToText(html);

  if (campaign.footerHtml) {
    const footer = renderTemplate(campaign.footerHtml, data, { escape: true });
    return {
      subject,
      html: `${html}\n${footer}`,
      text: `${text}\n\n${htmlToText(footer)}`
    };
  }
  return { subject, html, text };
}

/**
 * Build the nodemailer mail options for a recipient.
 * Returns { mail, warnings }.
 */
function buildMailOptions(campaign, recipient) {
  const warnings = [];
  const check = validateEmail(recipient.email);
  if (!check.valid) {
    throw Object.assign(new Error(`Invalid recipient address: ${recipient.email}`), { kind: 'permanent' });
  }
  const rendered = renderForRecipient(campaign, recipient);
  if (!rendered.subject) warnings.push('Subject is empty.');

  const mail = {
    from: formatAddress(campaign.senderName, campaign.fromEmail),
    to: recipient.email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    headers: {}
  };
  if (campaign.replyTo) mail.replyTo = campaign.replyTo;
  if (campaign.listUnsubscribe) {
    mail.headers['List-Unsubscribe'] = campaign.listUnsubscribe;
    // One-click unsubscribe (RFC 8058) requires an HTTPS endpoint.
    if (/<https:\/\//i.test(campaign.listUnsubscribe)) {
      mail.headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
  }
  return { mail, warnings };
}

/** Sample personalization values used for previews. */
const SAMPLE_RECIPIENT = {
  email: 'jane.doe@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  extra: {}
};

module.exports = { renderForRecipient, buildMailOptions, SAMPLE_RECIPIENT };
