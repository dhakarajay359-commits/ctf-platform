const nodemailer = require('nodemailer');
const https = require('https');
const http = require('http');
const url = require('url');
const querystring = require('querystring');
const db = require('../db');

/**
 * Retrieve notification settings from DB
 */
async function getNotificationConfig() {
  const rows = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'notify_%' OR key LIKE 'smtp_%' OR key LIKE 'whatsapp_%'").all();
  const config = {};
  rows.forEach(r => { config[r.key] = r.value; });
  return config;
}

/**
 * Create Nodemailer transporter based on SMTP settings
 */
async function getTransporter() {
  const config = await getNotificationConfig();
  if (!config.smtp_host || !config.smtp_user) {
    return null;
  }
  return nodemailer.createTransport({
    host: config.smtp_host,
    port: Number(config.smtp_port) || 587,
    secure: config.smtp_secure === '1' || Number(config.smtp_port) === 465,
    auth: {
      user: config.smtp_user,
      pass: config.smtp_pass || ''
    }
  });
}

/**
 * Send an email via configured SMTP
 */
async function sendEmail({ to, subject, text, html }) {
  const config = await getNotificationConfig();
  const transporter = await getTransporter();
  
  if (!transporter) {
    console.log(`[Notifier] SMTP not configured. Skipped sending email to ${to}`);
    return { success: false, error: 'SMTP settings are not configured in Admin panel.' };
  }

  const from = config.smtp_from || config.smtp_user;
  try {
    const info = await transporter.sendMail({
      from: `"CTF Platform" <${from}>`,
      to,
      subject,
      text,
      html
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Notifier] Email failed to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

function formatPhoneNumber(phone) {
  if (!phone) return '';
  let clean = String(phone).replace(/[^\d]/g, '');
  if (clean.length === 10) {
    clean = '91' + clean;
  }
  return clean;
}

async function sendWhatsApp({ phone, message, eventTitle }) {
  const config = await getNotificationConfig();
  const cleanPhone = formatPhoneNumber(phone);
  const webhookUrl = config.whatsapp_webhook_url;
  
  if (!webhookUrl) {
    return { 
      success: false, 
      error: 'WhatsApp Gateway not configured in settings.' 
    };
  }

  return new Promise((resolve) => {
    try {
      // Support CallMeBot GET API
      if (webhookUrl.includes('callmebot.com')) {
        const apiKey = config.whatsapp_api_token || '';
        const getUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
        https.get(getUrl, (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, response: body });
            } else {
              resolve({ success: false, error: `Gateway returned ${res.statusCode}: ${body}` });
            }
          });
        }).on('error', (err) => {
          resolve({ success: false, error: err.message });
        });
        return;
      }

      // Support UltraMsg API (api.ultramsg.com)
      if (webhookUrl.includes('ultramsg.com')) {
        const token = config.whatsapp_api_token || '';
        const postData = querystring.stringify({
          token: token,
          to: '+' + cleanPhone,
          body: message
        });

        const parsed = url.parse(webhookUrl);
        const options = {
          hostname: parsed.hostname,
          port: 443,
          path: parsed.path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const req = https.request(options, (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => {
            try {
              const parsedRes = JSON.parse(body);
              if (parsedRes.sent === 'true' || parsedRes.sent === true || res.statusCode < 300) {
                resolve({ success: true, response: body });
              } else {
                resolve({ success: false, error: parsedRes.message || body });
              }
            } catch(e) {
              if (res.statusCode < 300) resolve({ success: true, response: body });
              else resolve({ success: false, error: body });
            }
          });
        });

        req.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });

        req.setTimeout(15000, () => {
          req.destroy();
          resolve({ success: false, error: 'UltraMsg gateway timeout' });
        });

        req.write(postData);
        req.end();
        return;
      }

      const parsed = url.parse(webhookUrl);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;

      const payload = JSON.stringify({
        phone: cleanPhone,
        message,
        event: eventTitle || 'Live CTF Event',
        token: config.whatsapp_api_token || undefined,
        timestamp: new Date().toISOString()
      });

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(config.whatsapp_api_token ? { 'Authorization': `Bearer ${config.whatsapp_api_token}` } : {})
        }
      };

      const req = client.request(options, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, response: body });
          } else {
            resolve({ success: false, error: `Gateway returned status ${res.statusCode}: ${body}` });
          }
        });
      });

      req.on('error', (err) => {
        console.error(`[Notifier] WhatsApp request error for ${cleanPhone}:`, err.message);
        resolve({ success: false, error: err.message });
      });

      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ success: false, error: 'WhatsApp Gateway timeout' });
      });

      req.write(payload);
      req.end();
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

/**
 * Get all registered participants from live_registration_submissions
 */
async function getRegisteredParticipants() {
  const submissions = await db.prepare('SELECT id, data, submitted_at FROM live_registration_submissions').all();
  const participants = [];
  const seen = new Set();

  for (const s of submissions) {
    try {
      const d = JSON.parse(s.data);
      let email = null;
      let phone = null;
      let name = null;
      let college = null;

      for (const [key, val] of Object.entries(d)) {
        const k = key.toLowerCase().trim();
        const v = val ? String(val).trim() : '';
        if (!v) continue;

        if (k.includes('mail')) {
          email = v;
        } else if (k.includes('mobile') || k.includes('phone') || k.includes('whatsapp') || k.includes('contact') || k.includes('number')) {
          phone = v;
        } else if (k.includes('name') && !k.includes('college') && !k.includes('team')) {
          name = v;
        } else if (k.includes('college') || k.includes('university') || k.includes('institute')) {
          college = v;
        }
      }

      name = name || 'Participant';
      if (email || phone) {
        const uniqueKey = (email || '').toLowerCase() + '|' + (phone || '');
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          participants.push({
            id: s.id,
            name,
            email,
            phone,
            college: college || ''
          });
        }
      }
    } catch (e) {}
  }
  return participants;
}

/**
 * Dispatch CTF Start Alert to all registered users (Email + WhatsApp)
 */
async function broadcastStartAlert(customMsg = null, originUrl = '') {
  const participants = await getRegisteredParticipants();
  const settingsRows = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'live_%' OR key = 'event_name'").all();
  const settings = {};
  settingsRows.forEach(r => { settings[r.key] = r.value; });

  const eventName = settings.event_name || settings.live_registration_title || 'Live CTF Event';
  const startStr = settings.live_ctf_event_start ? new Date(settings.live_ctf_event_start).toLocaleString() : 'Now';
  const endStr = settings.live_ctf_event_end ? new Date(settings.live_ctf_event_end).toLocaleString() : 'TBD';

  const defaultText = `🚨 ALERT: ${eventName} is STARTING NOW!\n\nEvent Schedule: ${startStr} - ${endStr}\n\nLogin and access the live target servers now at:\n${originUrl || 'http://localhost:3000'}/challenges.html\n\nGood luck!`;
  const messageText = customMsg || defaultText;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; background: #0b0f19; color: #fff; padding: 30px; border-radius: 8px; max-width: 600px; margin: auto;">
      <h2 style="color: #00d2ff; margin-top: 0;">🚨 ${eventName} is LIVE!</h2>
      <p style="font-size: 16px; color: #d0d7de;">Get ready! The live CTF challenge servers are now accessible.</p>
      
      <div style="background: rgba(255,255,255,0.05); border-left: 4px solid #00d2ff; padding: 15px; margin: 20px 0;">
        <p style="margin: 0; color: #8b949e;"><strong>Start Time:</strong> ${startStr}</p>
        <p style="margin: 5px 0 0 0; color: #8b949e;"><strong>End Time:</strong> ${endStr}</p>
      </div>

      <p style="margin: 25px 0;">
        <a href="${originUrl || 'http://localhost:3000'}/challenges.html" 
           style="background: #00d2ff; color: #000; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 4px; display: inline-block;">
          Enter Live Arena →
        </a>
      </p>

      <p style="font-size: 12px; color: #8b949e; margin-top: 30px;">
        You received this notification because you registered for ${eventName}.
      </p>
    </div>
  `;

  const results = {
    total: participants.length,
    emailSent: 0,
    emailFailed: 0,
    whatsappSent: 0,
    whatsappFailed: 0,
    details: []
  };

  for (const p of participants) {
    const detail = { name: p.name, email: p.email, phone: p.phone, emailResult: null, whatsappResult: null };

    // Send Email
    if (p.email) {
      const emailRes = await sendEmail({
        to: p.email,
        subject: `[ALERT] ${eventName} is LIVE!`,
        text: messageText,
        html: htmlContent
      });
      detail.emailResult = emailRes;
      if (emailRes.success) results.emailSent++;
      else results.emailFailed++;
    }

    // Send WhatsApp
    if (p.phone) {
      const waRes = await sendWhatsApp({
        phone: p.phone,
        message: messageText,
        eventTitle: eventName
      });
      detail.whatsappResult = waRes;
      if (waRes.success) results.whatsappSent++;
      else results.whatsappFailed++;
    }

    results.details.push(detail);
  }

  // Mark notified flag in settings
  await db.prepare("INSERT INTO settings (key, value) VALUES ('live_start_notified_at', ?) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value").run(new Date().toISOString());

  return results;
}

module.exports = {
  getNotificationConfig,
  getRegisteredParticipants,
  sendEmail,
  sendWhatsApp,
  broadcastStartAlert
};
