const { Resend } = require('resend');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

// AI provider is controlled by the AI_PROVIDER env var: 'gemini' | 'openai' | 'groq'
const AI_PROVIDER = (process.env.AI_PROVIDER || 'groq').toLowerCase();

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, bottleneck } = req.body;
  // 'es' when the form was opened with ?lang=es (fernvayconsulting.com/es/); anything else is English.
  const lang = req.body.lang === 'es' ? 'es' : 'en';

  if (!name || !email || !bottleneck) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const prompt = `You are a senior AI automation and business systems consultant at Fernvay Consulting — a boutique consultancy that helps small and mid-size businesses streamline operations using AI and modern automation tools.

A potential client named ${name} has shared their biggest business bottleneck:

"${bottleneck}"

Write a warm, professional, and genuinely helpful email response directly to ${name}. The email should:

Open by acknowledging their specific challenge with empathy
Offer 2–3 concrete, actionable strategies using AI or automation that could realistically solve it in simple, easy to understand, non-technical language
Subtly position Fernvay Consulting as the natural partner to implement this
Close with a soft, non-pushy invitation to schedule a free 30-minute discovery call
Tone: expert but approachable, confident but not salesy. Length: 200-250 words. Do not include a subject line. Start directly with the greeting. Do not include a sign-off, signature, name, or title at the end — the email must end with the invitation sentence itself; a signature is appended separately.` + (lang === 'es' ? SPANISH_INSTRUCTIONS : '');

  // ── Step 1: Generate AI response ──────────────────────────────
  let aiResponse;
  try {
    if (AI_PROVIDER === 'gemini') {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const result = await model.generateContent(prompt);
      aiResponse = result.response.text();

    } else if (AI_PROVIDER === 'openai') {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
      });
      aiResponse = completion.choices[0].message.content;

    } else {
      // Default: Groq (GPT-OSS 120B)
      const groq = new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
      });
      const completion = await groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
      });
      aiResponse = completion.choices[0].message.content;
    }
  } catch (err) {
    console.error(`AI error (provider: ${AI_PROVIDER}):`, err);
    return res.status(500).json({ error: `AI generation failed (${AI_PROVIDER}). Check your API key.` });
  }

  // ── Step 2: Send email via Resend ─────────────────────────────
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromAddress = process.env.EMAIL_FROM || 'Fernvay Consulting <onboarding@resend.dev>';
    const siteUrl = process.env.SITE_URL || 'https://fernvayconsulting.com';

    await resend.emails.send({
      from: fromAddress,
      to: email,
      // Plain, conversational subject: promotional phrasing ("free AI
      // solution", "is here") pushes first-contact emails toward spam.
      subject: lang === 'es'
        ? `${name.split(' ')[0]}, algunas ideas sobre lo que nos compartió`
        : `${name.split(' ')[0]}, a few ideas on what you shared`,
      html: lang === 'es' ? buildEmailHtmlEs(name, bottleneck, aiResponse) : buildEmailHtml(name, bottleneck, aiResponse),
      text: lang === 'es' ? buildEmailTextEs(name, aiResponse, siteUrl) : buildEmailText(name, aiResponse, siteUrl),
      // Replies go to a real inbox, and the unsubscribe header points at a real
      // address. EMAIL_USER isn't always set, which used to produce
      // "mailto:undefined" — a header that hurts spam scoring. No one-click
      // header: there is no endpoint that processes a one-click POST.
      replyTo: REPLY_TO,
      headers: {
        'List-Unsubscribe': `<mailto:${process.env.EMAIL_USER || REPLY_TO}?subject=unsubscribe>`,
      },
    });

    // BCC notify email if set
    if (process.env.NOTIFY_EMAIL) {
      await resend.emails.send({
        from: fromAddress,
        to: process.env.NOTIFY_EMAIL,
        subject: `New lead${lang === 'es' ? ' (Spanish)' : ''}: ${name} — ${email}`,
        html: `<p><strong>Name:</strong> ${name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Bottleneck:</strong> ${bottleneck}</p>
               <p><strong>Language:</strong> ${lang === 'es' ? 'Spanish' : 'English'}</p>
               <hr/>
               <p><strong>AI Response sent:</strong></p>
               <pre style="white-space:pre-wrap;">${escapeHtml(aiResponse)}</pre>`,
      });
    }
  } catch (err) {
    console.error('Resend email error:', err);
    return res.status(500).json({ error: 'Email delivery failed. Check RESEND_API_KEY and EMAIL_FROM.' });
  }

  return res.json({ success: true });
};

const REPLY_TO = process.env.REPLY_TO || 'roman@fernvayconsulting.com';

const SIGNATURE_TEXT = `Warm regards,
Roman Martinez
Founder & Senior AI Automation Consultant
Fernvay Consulting
roman@fernvayconsulting.com`;

const SIGNATURE_HTML = `<p style="margin:1.4em 0 0;line-height:1.6;">
  Warm regards,<br/>
  <strong>Roman Martinez</strong><br/>
  Founder &amp; Senior AI Automation Consultant<br/>
  Fernvay Consulting<br/>
  <a href="mailto:roman@fernvayconsulting.com" style="color:#162d52;text-decoration:none;">roman@fernvayconsulting.com</a>
</p>`;

function buildEmailText(name, aiBody, siteUrl) {
  return `${aiBody}

${SIGNATURE_TEXT}

---
Schedule a free 30-minute discovery call: https://www.fernvayconsulting.com/discovery-call/

Fernvay Consulting, LLC | ${siteUrl}
You received this because you requested a free AI solution at ${siteUrl}.
To unsubscribe, reply with "unsubscribe" in the subject line.`;
}

function buildEmailHtml(name, bottleneck, aiBody) {
  const bodyHtml = aiBody
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 1.1em 0;line-height:1.75;">${p.trim().replace(/\n/g, '<br/>')}</p>`)
    .join('') + SIGNATURE_HTML;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Your AI Solution — Fernvay Consulting</title>
</head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1ec;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
          <tr>
            <td style="background:#0d2448;background:linear-gradient(150deg,#0b1a30 0%,#0d2448 50%,#162d5e 100%);padding:40px 48px 36px;text-align:center;">
              <img src="${process.env.ASSETS_URL || 'https://fernvay-lead-form.vercel.app'}/assets/images/Fernvay_Logo_Darkback.svg"
                   alt="Fernvay Consulting" width="180" height="auto"
                   style="display:block;margin:0 auto 24px;width:180px;max-width:100%;" />
              <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:300;color:#f4f1ec;line-height:1.2;">
                Your Custom AI Solution<br/>
                <em style="font-style:italic;color:#e8c87a;">is ready.</em>
              </h1>
              <p style="margin:14px 0 0;font-size:12px;font-weight:300;letter-spacing:1px;color:rgba(176,200,224,.8);">
                Based on your bottleneck: &ldquo;${escapeHtml(bottleneck.slice(0, 120))}${bottleneck.length > 120 ? '&hellip;' : ''}&rdquo;
              </p>
            </td>
          </tr>
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,#c9a84c,#e8c87a,#c9a84c);"></td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:44px 48px;color:#162d52;font-size:15px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:0 48px 44px;text-align:center;">
              <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td style="background:#c9a84c;">
                    <a href="https://www.fernvayconsulting.com/discovery-call/"
                       style="display:inline-block;padding:14px 36px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;text-decoration:none;color:#0d1f3c;">
                      Schedule a Free Discovery Call
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:12px;color:#3a6199;line-height:1.6;">
                No obligation. No hard pitch. Just 30 minutes to see what's possible.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#0d1f3c;padding:28px 48px;text-align:center;">
              <p style="margin:0 0 6px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#c9a84c;">Fernvay Consulting, LLC</p>
              <p style="margin:0;font-size:11px;color:rgba(176,200,224,.7);">
                AI Automation &amp; Business Systems &nbsp;&middot;&nbsp;
                <a href="https://fernvayconsulting.com" style="color:rgba(176,200,224,.7);text-decoration:none;">fernvayconsulting.com</a>
              </p>
              <p style="margin:14px 0 0;font-size:10px;color:rgba(176,200,224,.4);">
                You received this because you requested a free AI solution at fernvayconsulting.com.<br/>
                <a href="https://fernvayconsulting.com" style="color:rgba(176,200,224,.4);">Unsubscribe</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Spanish version (form opened with ?lang=es) ─────────────────
const SPANISH_INSTRUCTIONS = `

Language requirements (these override anything above):
- Write the entire email in neutral Latin American Spanish for Spanish speakers who run small businesses in the United States. No regional slang.
- Always address the reader formally with "usted", never "tú".
- Say "pequeños negocios" for small businesses.
- Never use the English words "build" or "audit". Say "implementación" instead of build.
- The free 30-minute call is called the "Revisión de Procesos Gratuita". Invite them to that by name; never call it a "discovery call" or "llamada de descubrimiento".`;

const ES_REVIEW_URL = 'https://fernvayconsulting.com/es/revision-de-procesos-gratuita/';

const SIGNATURE_TEXT_ES = `Saludos cordiales,
Roman Martinez
Fundador y Consultor Sénior en Automatización con IA
Fernvay Consulting
roman@fernvayconsulting.com`;

const SIGNATURE_HTML_ES = `<p style="margin:1.4em 0 0;line-height:1.6;">
  Saludos cordiales,<br/>
  <strong>Roman Martinez</strong><br/>
  Fundador y Consultor Sénior en Automatización con IA<br/>
  Fernvay Consulting<br/>
  <a href="mailto:roman@fernvayconsulting.com" style="color:#162d52;text-decoration:none;">roman@fernvayconsulting.com</a>
</p>`;

function buildEmailTextEs(name, aiBody, siteUrl) {
  return `${aiBody}

${SIGNATURE_TEXT_ES}

---
Reserve su Revisión de Procesos Gratuita de 30 minutos: ${ES_REVIEW_URL}

Fernvay Consulting, LLC | ${siteUrl}
Recibió este correo porque solicitó una solución de IA gratuita en ${siteUrl}.
Para darse de baja, responda con la palabra "baja" en el asunto.`;
}

function buildEmailHtmlEs(name, bottleneck, aiBody) {
  const bodyHtml = aiBody
    .split(/\n\n+/)
    .map(p => `<p style="margin:0 0 1.1em 0;line-height:1.75;">${p.trim().replace(/\n/g, '<br/>')}</p>`)
    .join('') + SIGNATURE_HTML_ES;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Su solución de IA — Fernvay Consulting</title>
</head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1ec;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
          <tr>
            <td style="background:#0d2448;background:linear-gradient(150deg,#0b1a30 0%,#0d2448 50%,#162d5e 100%);padding:40px 48px 36px;text-align:center;">
              <img src="${process.env.ASSETS_URL || 'https://fernvay-lead-form.vercel.app'}/assets/images/Fernvay_Logo_Darkback.svg"
                   alt="Fernvay Consulting" width="180" height="auto"
                   style="display:block;margin:0 auto 24px;width:180px;max-width:100%;" />
              <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:300;color:#f4f1ec;line-height:1.2;">
                Su solución de IA personalizada<br/>
                <em style="font-style:italic;color:#e8c87a;">está lista.</em>
              </h1>
              <p style="margin:14px 0 0;font-size:12px;font-weight:300;letter-spacing:1px;color:rgba(176,200,224,.8);">
                Basada en su cuello de botella: &ldquo;${escapeHtml(bottleneck.slice(0, 120))}${bottleneck.length > 120 ? '&hellip;' : ''}&rdquo;
              </p>
            </td>
          </tr>
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,#c9a84c,#e8c87a,#c9a84c);"></td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:44px 48px;color:#162d52;font-size:15px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:0 48px 44px;text-align:center;">
              <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                <tr>
                  <td style="background:#c9a84c;">
                    <a href="${ES_REVIEW_URL}"
                       style="display:inline-block;padding:14px 36px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;text-decoration:none;color:#0d1f3c;">
                      Reserve su Revisión de Procesos Gratuita
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:12px;color:#3a6199;line-height:1.6;">
                Sin compromiso. Sin presión de ventas. Solo 30 minutos para ver lo que es posible.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#0d1f3c;padding:28px 48px;text-align:center;">
              <p style="margin:0 0 6px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#c9a84c;">Fernvay Consulting, LLC</p>
              <p style="margin:0;font-size:11px;color:rgba(176,200,224,.7);">
                Automatización con IA y sistemas de negocio &nbsp;&middot;&nbsp;
                <a href="https://fernvayconsulting.com/es/" style="color:rgba(176,200,224,.7);text-decoration:none;">fernvayconsulting.com</a>
              </p>
              <p style="margin:14px 0 0;font-size:10px;color:rgba(176,200,224,.4);">
                Recibió este correo porque solicitó una solución de IA gratuita en fernvayconsulting.com.<br/>
                <a href="https://fernvayconsulting.com/es/" style="color:rgba(176,200,224,.4);">Darse de baja</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
