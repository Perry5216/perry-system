/**
 * SecretsPanel — central UI for managing encrypted credentials.
 *
 * Backed by the SecretsService routes added in @perry/dashboard-api/routes/secrets.ts.
 * Lists all known secrets (metadata only — values never displayed in the list),
 * allows add/rotate/delete, and surfaces the audit log.
 *
 * Visual language matches FleetCanvas — dark navy, monospace, sci-fi accents.
 * Cost-coded: encrypted secrets have a green check, missing required secrets
 * get a red warning, missing optional get a muted icon.
 */

import React, { useEffect, useState } from 'react';
import { PanelHeader } from './PanelHeader';
import { HelpGuide } from './HelpGuide';

const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ? 'http://localhost:4000/api' : '/api';

interface SecretMetadata {
  name: string;
  hasValue: boolean;
  required?: boolean;
  purpose?: string;
  lastWriteAt?: string;
  lastReadAt?: string;
  rotationGraceExpiresAt?: string;
}

interface SecretAuditRow {
  id: string;
  secret_name: string;
  action: 'read' | 'write' | 'rotate' | 'delete' | 'reset' | 'import' | 'reveal';
  caller: string | null;
  created_at: string;
}

const ACTION_COLORS: Record<SecretAuditRow['action'], string> = {
  read:   '#9BA4B5',
  write:  '#7CFC00',
  rotate: '#FFD166',
  delete: '#FF6B6B',
  reset:  '#FF6B6B',
  import: '#4ECDC4',
  reveal: '#FB923C',
};

interface HelpGuideDetails {
  whatToEnter: string;
  howToGet: React.ReactNode;
  example: string;
}

const SECRET_HELP_GUIDES: Record<string, HelpGuideDetails> = {
  perry_api_key: {
    whatToEnter: "Any strong, secure password or token. This gates access to the P.E.R.R.Y. dashboard API.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Think of a long, strong passphrase or password.</li>
        <li>Alternatively, generate a random security token.</li>
        <li>Keep it safe, as you will need it to login to the dashboard.</li>
      </ol>
    ),
    example: "my_very_secure_dashboard_password_2026!"
  },
  perry_webhook_secret: {
    whatToEnter: "A custom secret string (like a password) used to verify that webhook calls sent to Perry are legitimate.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Create a random string of numbers and letters.</li>
        <li>Configure this same string in your webhook sender (e.g., n8n or GitHub Webhook settings).</li>
        <li>This ensures nobody else can trigger fake webhooks on your server.</li>
      </ol>
    ),
    example: "whsec_b2a7c8e9f0123456789abcdef"
  },
  reddit_client_id: {
    whatToEnter: "A 14-character app ID from the Reddit Developer Portal.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Go to <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener noreferrer" style={{ color: '#FB923C', textDecoration: 'underline' }}>reddit.com/prefs/apps</a> and log in.</li>
        <li>Scroll to the bottom and click <strong>"are you a developer? create an app..."</strong></li>
        <li>Enter a name (e.g., <code>perry-bookbot</code>), select the <strong>"script"</strong> radio button (critical!), and set redirect URI to <code>http://localhost</code>.</li>
        <li>Click <strong>"create app"</strong>.</li>
        <li>The Client ID is the 14-character string shown under <em>"personal use script"</em> (just under the bot name).</li>
      </ol>
    ),
    example: "aBcDeFgHiJkLmN"
  },
  reddit_client_secret: {
    whatToEnter: "The 27-character secret key corresponding to your Reddit Developer app.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Go to <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noopener noreferrer" style={{ color: '#FB923C', textDecoration: 'underline' }}>reddit.com/prefs/apps</a>.</li>
        <li>Find your script app.</li>
        <li>Copy the 27-character string labeled <strong>"secret"</strong>.</li>
      </ol>
    ),
    example: "xYz1234567890abcdefghijklmnopqr"
  },

  telegram_bot_token: {
    whatToEnter: "The access token for your Telegram Bot, allowing Perry to read and respond to Telegram chats.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Open Telegram and search for the official account <strong style={{ color: '#E2E8F0' }}>@BotFather</strong>.</li>
        <li>Send the message <code>/newbot</code>.</li>
        <li>Follow BotFather's instructions to choose a name and username (must end in "bot", e.g., <code>MyPerryBot</code>).</li>
        <li>BotFather will reply with a token. Copy it.</li>
      </ol>
    ),
    example: "123456789:AAGhK9J3m9nO-PqRsTuVwXyZ_abc123DEFg"
  },
  telegram_allowed_user_ids: {
    whatToEnter: "Your Telegram numeric account ID, or a list of IDs separated by commas. This blocks strangers from using your bot.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Open Telegram and search for the bot <strong style={{ color: '#E2E8F0' }}>@userinfobot</strong> or <strong style={{ color: '#E2E8F0' }}>@GetIDBot</strong>.</li>
        <li>Send any message (like <code>/start</code>) to the bot.</li>
        <li>It will reply with your numeric ID (e.g., <code>521612345</code>). Copy this number.</li>
        <li>If allowing multiple users, separate their numeric IDs with commas.</li>
      </ol>
    ),
    example: "521612345"
  },
  discord_bot_token: {
    whatToEnter: "The bot secret token from the Discord Developer Portal.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Go to the <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" style={{ color: '#FB923C', textDecoration: 'underline' }}>Discord Developer Portal</a>.</li>
        <li>Click <strong>New Application</strong>, name it, and go to the <strong>Bot</strong> tab.</li>
        <li>Click <strong>Add Bot</strong>, then click <strong>Reset Token</strong> and copy the token.</li>
        <li>Scroll down to <strong>Privileged Gateway Intents</strong> and enable <strong>Presence</strong>, <strong>Server Members</strong>, and <strong>Message Content</strong> (critical for reading chat messages).</li>
      </ol>
    ),
    example: "your_discord_bot_token_here"
  },
  discord_allowed_user_ids: {
    whatToEnter: "Your Discord user snowflake ID (or a list of IDs separated by commas) to authorize users.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>In Discord, go to <strong>User Settings &gt; Advanced</strong> and turn on <strong>Developer Mode</strong>.</li>
        <li>Right-click your profile picture in any channel or server list, and click <strong>Copy User ID</strong>.</li>
        <li>Paste the numeric ID here. Separate multiple IDs with commas.</li>
      </ol>
    ),
    example: "198345678901234567"
  },
  whatsapp_enabled: {
    whatToEnter: "Enable WhatsApp integration: enter either 'true' or 'false'.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Type <code>true</code> to enable WhatsApp.</li>
        <li>Type <code>false</code> (or leave empty) to disable it.</li>
      </ol>
    ),
    example: "true"
  },
  whatsapp_allowed_user_ids: {
    whatToEnter: "Your WhatsApp phone number(s) formatted as JIDs to authorize access.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Take your phone number, including country code (e.g., +44 for UK, +1 for US).</li>
        <li>Remove any <code>+</code>, <code>-</code>, spaces, or leading zeros (e.g., +44 7700 900000 becomes <code>447700900000</code>).</li>
        <li>Append <code>@s.whatsapp.net</code> to the end.</li>
        <li>If you receive an authorization error on WhatsApp with an ID ending in <code>@lid</code>, copy and paste that exact ID here (e.g. <code>11193305559284@lid</code>).</li>
        <li>Separate multiple WhatsApp JIDs with commas.</li>
      </ol>
    ),
    example: "447700900000@s.whatsapp.net,11193305559284@lid"
  },
  whatsapp_wife_user_ids: {
    whatToEnter: "The WhatsApp JID(s) of your partner/wife to trigger Wife Response Mode.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Have your partner message your paired WhatsApp number.</li>
        <li>Since they are not authorized, your WhatsApp account will receive an error message containing their ID.</li>
        <li>Copy that exact ID (e.g. <code>11193305559284@lid</code> or <code>447700900000@s.whatsapp.net</code>) and paste it here.</li>
        <li>Separate multiple JIDs with commas if you want to apply this mode to multiple numbers.</li>
      </ol>
    ),
    example: "11193305559284@lid"
  },
  whatsapp_wife_responder_prompt: {
    whatToEnter: "Custom system prompt override instructing the bot how to text back as you to your partner.",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Describe your relationship and typical casual texting style.</li>
        <li>Include details about how you normally respond, whether you use specific emojis, or what you are doing.</li>
        <li>If left blank, the bot will use a warm and friendly default spouse/partner texting persona.</li>
      </ol>
    ),
    example: "You are John, a loving husband. Act as him and reply to his wife warm and casually. Keep replies under 2 sentences, use a few emojis, and say you are working at your computer if asked."
  },
  whatsapp_wife_mode_enabled: {
    whatToEnter: "Whether Wife Response Mode is active ('true' or 'false').",
    howToGet: (
      <ol style={{ paddingLeft: 16, margin: '4px 0', lineHeight: '1.4' }}>
        <li>Set to <code>true</code> to enable Wife Response Mode.</li>
        <li>Set to <code>false</code> to temporarily disable it without deleting your wife JIDs.</li>
      </ol>
    ),
    example: "true"
  }
};

export function SecretsPanel() {
  const [secrets, setSecrets] = useState<SecretMetadata[]>([]);
  const [audit, setAudit] = useState<SecretAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const [revealedValue, setRevealedValue] = useState<{ name: string; value: string } | null>(null);
  const [expandedHelp, setExpandedHelp] = useState<string | null>(null);

  const refresh = () => {
    Promise.all([
      fetch(`${API_BASE}/secrets`).then(r => r.json()),
      fetch(`${API_BASE}/secrets-audit?limit=30`).then(r => r.json()),
    ]).then(([s, a]) => {
      setSecrets(s.secrets || []);
      setAudit(a.audit || []);
      setError(null);
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleAdd = async (name: string, value: string) => {
    const r = await fetch(`${API_BASE}/secrets/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!r.ok) throw new Error(await r.text());
    refresh();
  };

  const handleRotate = async (name: string, newValue: string, graceMs: number) => {
    const r = await fetch(`${API_BASE}/secrets/${encodeURIComponent(name)}/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: newValue, graceMs }),
    });
    if (!r.ok) throw new Error(await r.text());
    refresh();
  };

  const handleReset = async (name: string) => {
    if (!confirm(`Reset (erase) the secret value for "${name}"? This will clear the stored value from the secure database, making it blank again.`)) return;
    const r = await fetch(`${API_BASE}/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!r.ok) { alert(await r.text()); return; }
    refresh();
  };

  const handleReveal = async (name: string) => {
    if (!confirm(`Reveal and view "${name}" on screen? The action will be recorded in the security audit log for safety.`)) return;
    const r = await fetch(`${API_BASE}/secrets/${encodeURIComponent(name)}/reveal`);
    if (!r.ok) { alert(await r.text()); return; }
    const data = await r.json();
    setRevealedValue({ name, value: data.value });
    refresh(); // pulls the audit entry
  };

  if (loading) return <PanelShell><div style={{ padding: 24, color: '#9BA4B5' }}>Loading...</div></PanelShell>;
  if (error) return <PanelShell><div style={{ padding: 24, color: '#FF6B6B' }}>{error}</div></PanelShell>;

  return (
    <PanelShell>
      <Header onAdd={() => setAddOpen(true)} secretCount={secrets.length} />

      <div style={{ padding: '16px 24px' }}>
        <HelpGuide panelName="secrets" title="Secrets Vault Guide">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            <div>
              <h4 style={{ color: 'var(--secondary)', marginBottom: 6, fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>🛡️ AES-256-GCM Vault</h4>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                All credentials entered here are encrypted at rest using AES-256-GCM in the backend database. 
                They never leave this server and are accessed only by the specific backend services requiring them.
              </p>
            </div>
            <div>
              <h4 style={{ color: 'var(--secondary)', marginBottom: 6, fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>🤖 LLM Keys vs Subscription Workers</h4>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Perry operates in a subscription-only/daemon worker model. <strong>Do not</strong> save Anthropic or Gemini keys here.
                Instead, authenticate workers using the interactive CLI commands listed on the <strong>Assistants/Workers</strong> tab.
              </p>
            </div>
          </div>
        </HelpGuide>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: 24 }}>
          <div>
            <SectionTitle>Encrypted Vault</SectionTitle>
            <div style={{
              border: '1px solid rgba(155,164,181,0.15)',
              borderRadius: 6,
              background: 'rgba(10,14,31,0.5)',
              overflow: 'hidden',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                <thead>
                  <tr style={{ background: 'rgba(168,85,247,0.08)', color: '#9BA4B5', textAlign: 'left', fontSize: '0.65rem', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                    <th style={{ padding: '8px 12px' }}>Name</th>
                    <th style={{ padding: '8px 12px' }}>Status</th>
                    <th style={{ padding: '8px 12px' }}>Last write</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {secrets.map(s => {
                    const hasHelp = !!SECRET_HELP_GUIDES[s.name];
                    const isHelpOpen = expandedHelp === s.name;
                    return (
                      <React.Fragment key={s.name}>
                        <tr style={{ borderTop: '1px solid rgba(155,164,181,0.08)' }}>
                          <td style={{ padding: '10px 12px', color: '#E2E8F0' }}>
                            <div style={{ fontWeight: 600 }}>{s.name}</div>
                            {s.purpose && (
                              <div style={{ fontSize: '0.68rem', color: '#9BA4B5', marginTop: 2 }}>{s.purpose}</div>
                            )}
                            {hasHelp && (
                              <button
                                onClick={() => setExpandedHelp(isHelpOpen ? null : s.name)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: '#A855F7',
                                  fontSize: '0.68rem',
                                  padding: 0,
                                  marginTop: 4,
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                }}
                              >
                                <span>ℹ</span> {isHelpOpen ? 'Hide Help Guide' : 'How to get this key'}
                              </button>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            {s.hasValue ? (
                              <span style={{ color: '#7CFC00', fontSize: '0.7rem' }}>● ENCRYPTED</span>
                            ) : s.required ? (
                              <span style={{ color: '#FF6B6B', fontSize: '0.7rem' }}>● MISSING (required)</span>
                            ) : (
                              <span style={{ color: '#6B7280', fontSize: '0.7rem' }}>○ not set</span>
                            )}
                            {s.rotationGraceExpiresAt && (
                              <div style={{ fontSize: '0.65rem', color: '#FFD166', marginTop: 2 }}>
                                rotating · grace ends {new Date(s.rotationGraceExpiresAt).toLocaleTimeString()}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px', color: '#9BA4B5', fontSize: '0.7rem' }}>
                            {s.lastWriteAt ? new Date(s.lastWriteAt).toLocaleString() : '—'}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                            <ActionButtons
                              hasValue={s.hasValue}
                              onSet={() => setEditName(s.name)}
                              onReveal={() => handleReveal(s.name)}
                              onReset={() => handleReset(s.name)}
                            />
                          </td>
                        </tr>
                        {hasHelp && isHelpOpen && (
                          <tr style={{ background: 'rgba(168,85,247,0.03)' }}>
                            <td colSpan={4} style={{ padding: '14px 20px', borderTop: '1px dashed rgba(168,85,247,0.2)', borderBottom: '1px solid rgba(168,85,247,0.1)' }}>
                              <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: 20,
                                fontFamily: 'sans-serif',
                                fontSize: '0.75rem',
                                color: '#E2E8F0',
                              }}>
                                <div>
                                  <div style={{ fontWeight: 600, color: '#A855F7', marginBottom: 4, fontFamily: 'monospace', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                    What to enter
                                  </div>
                                  <div style={{ color: '#CBD5E1', marginBottom: 12, lineHeight: 1.4 }}>
                                    {SECRET_HELP_GUIDES[s.name].whatToEnter}
                                  </div>

                                  <div style={{ fontWeight: 600, color: '#A855F7', marginBottom: 4, fontFamily: 'monospace', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                    Example format
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <code style={{
                                      fontFamily: 'monospace',
                                      fontSize: '0.72rem',
                                      background: 'rgba(0,0,0,0.4)',
                                      padding: '4px 8px',
                                      borderRadius: 4,
                                      border: '1px solid rgba(155,164,181,0.15)',
                                      color: '#7CFC00',
                                      wordBreak: 'break-all',
                                    }}>
                                      {SECRET_HELP_GUIDES[s.name].example}
                                    </code>
                                    <button
                                      onClick={() => {
                                        navigator.clipboard.writeText(SECRET_HELP_GUIDES[s.name].example);
                                        alert('Example copied to clipboard!');
                                      }}
                                      style={{
                                        background: 'rgba(168,85,247,0.15)',
                                        color: '#A855F7',
                                        border: '1px solid rgba(168,85,247,0.3)',
                                        borderRadius: 4,
                                        padding: '3px 8px',
                                        fontSize: '0.62rem',
                                        cursor: 'pointer',
                                        fontFamily: 'monospace',
                                      }}
                                    >
                                      COPY
                                    </button>
                                  </div>
                                </div>

                                <div style={{ borderLeft: '1px solid rgba(155,164,181,0.15)', paddingLeft: 20 }}>
                                  <div style={{ fontWeight: 600, color: '#A855F7', marginBottom: 6, fontFamily: 'monospace', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                    How to get it
                                  </div>
                                  <div style={{ color: '#CBD5E1' }}>
                                    {SECRET_HELP_GUIDES[s.name].howToGet}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {secrets.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: 20, textAlign: 'center', color: '#6B7280', fontStyle: 'italic' }}>
                      no secrets yet. add one above.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <SectionTitle>Audit Log</SectionTitle>
            <div style={{
              border: '1px solid rgba(155,164,181,0.15)',
              borderRadius: 6,
              background: 'rgba(10,14,31,0.5)',
              maxHeight: 480,
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: '0.7rem',
            }}>
              {audit.length === 0 ? (
                <div style={{ padding: 16, color: '#6B7280', fontStyle: 'italic', textAlign: 'center' }}>no audit entries yet</div>
              ) : audit.map(a => (
                <div key={a.id} style={{
                  padding: '6px 12px',
                  display: 'grid',
                  gridTemplateColumns: '70px 60px 1fr',
                  gap: 8,
                  borderTop: '1px solid rgba(155,164,181,0.06)',
                  alignItems: 'baseline',
                }}>
                  <span style={{ color: '#6B7280' }}>{new Date(a.created_at).toLocaleTimeString()}</span>
                  <span style={{ color: ACTION_COLORS[a.action], textTransform: 'uppercase', fontWeight: 600 }}>{a.action}</span>
                  <span style={{ color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.secret_name}
                    {a.caller && <span style={{ color: '#6B7280' }}> · {a.caller}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {addOpen && <AddOrEditModal title="Add secret" allowName onSave={async (n, v) => { await handleAdd(n, v); setAddOpen(false); }} onClose={() => setAddOpen(false)} />}
      {editName && (
        <AddOrEditModal
          title={`Rotate "${editName}"`}
          initialName={editName}
          allowName={false}
          showGracePeriod
          onSave={async (_n, v, grace) => { await handleRotate(editName, v, grace || 0); setEditName(null); }}
          onClose={() => setEditName(null)}
        />
      )}
      {revealedValue && <RevealModal {...revealedValue} onClose={() => setRevealedValue(null)} />}
    </PanelShell>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100vh',
      background: 'radial-gradient(ellipse at center, #0a0e1f 0%, #050714 70%, #000000 100%)',
      borderRadius: 0,
      overflow: 'auto',
      color: '#E2E8F0',
    }}>
      {children}
    </div>
  );
}

function Header({ onAdd, secretCount }: { onAdd: () => void; secretCount: number }) {
  return (
    <PanelHeader
      eyebrow="P.E.R.R.Y. // Secrets Vault"
      title="Encrypted credential store"
      subtitle={<>AES-256-GCM at rest · <span className="mono">{secretCount}</span> entries</>}
      actions={
        <button
          onClick={onAdd}
          style={{
            padding: '7px 14px', borderRadius: 6,
            fontFamily: 'var(--font-sans)', fontSize: '0.78rem', fontWeight: 500,
            background: 'var(--accent-soft)', color: 'var(--accent)',
            border: '1px solid var(--accent-border)', cursor: 'pointer',
          }}
        >+ Add secret</button>
      }
    />
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.15em',
      textTransform: 'uppercase', color: '#9BA4B5', marginBottom: 8,
    }}>{children}</div>
  );
}

function ActionButtons({ hasValue, onSet, onReveal, onReset }: {
  hasValue: boolean; onSet: () => void; onReveal: () => void; onReset: () => void;
}) {
  const btn = (label: string, color: string, onClick: () => void) => (
    <button onClick={onClick} style={{
      background: 'transparent', color, border: `1px solid ${color}55`, borderRadius: 3,
      padding: '3px 8px', fontFamily: 'monospace', fontSize: '0.65rem', cursor: 'pointer',
      marginLeft: 4, letterSpacing: '0.08em',
    }}>{label}</button>
  );
  return (
    <>
      {hasValue && btn('REVEAL', '#FB923C', onReveal)}
      {btn(hasValue ? 'ROTATE' : 'SET', hasValue ? '#FFD166' : '#7CFC00', onSet)}
      {hasValue && btn('RESET', '#FF6B6B', onReset)}
    </>
  );
}

function AddOrEditModal({
  title, initialName, allowName, showGracePeriod, onSave, onClose,
}: {
  title: string; initialName?: string; allowName: boolean; showGracePeriod?: boolean;
  onSave: (name: string, value: string, graceMs?: number) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName || '');
  const [value, setValue] = useState('');
  const [grace, setGrace] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.match(/^[a-z_][a-z0-9_]*$/)) { setErr('name must match [a-z_][a-z0-9_]*'); return; }
    if (!value) { setErr('value required'); return; }
    setBusy(true); setErr(null);
    try { await onSave(name, value, grace * 60_000); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div style={{ fontFamily: 'monospace', color: '#E2E8F0', fontSize: '1rem', marginBottom: 16 }}>{title}</div>
      {allowName && (
        <>
          <Label>Name</Label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value.toLowerCase())}
            placeholder="lowercase_with_underscores"
            style={inputStyle}
          />
        </>
      )}
      <Label>Value</Label>
      <input
        type="password" value={value} onChange={e => setValue(e.target.value)}
        placeholder="(Enter password or API key here — it will be hidden and safely encrypted)"
        style={inputStyle}
        autoFocus={!allowName}
      />
      {showGracePeriod && (
        <>
          <Label>Grace period (minutes — how long the old password/key remains active while you switch to the new one)</Label>
          <input
            type="number" value={grace} onChange={e => setGrace(parseInt(e.target.value) || 0)}
            min={0} max={1440}
            style={inputStyle}
          />
        </>
      )}
      {err && <div style={{ color: '#FF6B6B', fontSize: '0.75rem', marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={cancelBtnStyle}>CANCEL</button>
        <button onClick={save} disabled={busy} style={saveBtnStyle}>{busy ? 'SAVING…' : 'SAVE'}</button>
      </div>
    </ModalShell>
  );
}

function RevealModal({ name, value, onClose }: { name: string; value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <ModalShell onClose={onClose}>
      <div style={{ fontFamily: 'monospace', color: '#FB923C', fontSize: '0.7rem', letterSpacing: '0.15em', marginBottom: 6 }}>
        ⚠️ REVEALED — AUDIT LOGGED
      </div>
      <div style={{ fontFamily: 'monospace', color: '#E2E8F0', fontSize: '0.9rem', marginBottom: 16 }}>{name}</div>
      <div style={{
        padding: 12, borderRadius: 4, background: 'rgba(0,0,0,0.5)',
        border: '1px solid rgba(251,146,60,0.3)', fontFamily: 'monospace',
        color: '#E2E8F0', wordBreak: 'break-all', fontSize: '0.85rem',
      }}>{value}</div>
      <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }} style={cancelBtnStyle}>{copied ? 'COPIED' : 'COPY'}</button>
        <button onClick={onClose} style={saveBtnStyle}>CLOSE</button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 480, padding: 24, borderRadius: 8,
        background: 'rgba(10,14,31,0.98)', border: '1px solid rgba(168,85,247,0.3)',
        boxShadow: '0 10px 40px rgba(168,85,247,0.15)',
      }}>
        {children}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.15em',
      textTransform: 'uppercase', color: '#9BA4B5', marginBottom: 4, marginTop: 12,
    }}>{children}</div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px',
  background: 'rgba(0,0,0,0.4)', color: '#E2E8F0',
  border: '1px solid rgba(155,164,181,0.25)', borderRadius: 4,
  fontFamily: 'monospace', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 14px', background: 'transparent', color: '#9BA4B5',
  border: '1px solid rgba(155,164,181,0.3)', borderRadius: 4,
  fontFamily: 'monospace', fontSize: '0.7rem', cursor: 'pointer', letterSpacing: '0.1em',
};
const saveBtnStyle: React.CSSProperties = {
  padding: '6px 14px', background: 'rgba(168,85,247,0.2)', color: '#A855F7',
  border: '1px solid rgba(168,85,247,0.5)', borderRadius: 4,
  fontFamily: 'monospace', fontSize: '0.7rem', cursor: 'pointer', letterSpacing: '0.1em',
};
