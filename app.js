// Egan Hoops 🏀 — Mobile-First Pickup Basketball Web App
// Author: Caleb Morris | Designed for Los Altos Pickup Hoops

const DEFAULT_CALENDAR_FEED = "https://p106-caldav.icloud.com/published/2/MTEzMzQzNDIwOTExMzM0MzDdaOwUKN-asCHRraXSKwGHwRpsKDE3B77yGoRMrYBEOUFvkxtZdkqkGvKNd_L2jFbU9ybD3S5MRqtadZoIuoY";
const DEFAULT_SUPABASE_URL = "https://pfxysdeeopdvunnaadyf.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_a40v6eT8bw6QWurjhg3DtQ_gHHgHRUW";
const DEFAULT_PASSCODE = "2026";
const TARGET_MIN_PLAYERS = 8;
const TARGET_IDEAL_MIN = 10;
const TARGET_IDEAL_MAX = 12;

// Known gym closure dates parsed from the iCloud feed
const KNOWN_CLOSURES = new Set([
  "2026-02-26", "2026-03-05", "2026-03-19",
  "2026-04-23", "2026-04-30", "2026-05-21", "2026-05-28",
  "2026-11-26", "2026-12-03", "2026-12-10"
]);

// App State
let state = {
  currentSession: null,
  upcomingSessions: [],
  rsvps: [],
  currentUser: localStorage.getItem('egan_hoops_user') || '',
  isAdmin: false,
  announcement: localStorage.getItem('egan_hoops_announcement') || '',
  supabase: null
};

// --- Calendar & Schedule Engine ---
function getLosAngelesNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10) - 1,
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10) % 24,
    minute: parseInt(map.minute, 10)
  };
}

function formatYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getUpcomingThursdays(count = 12) {
  const sessions = [];
  const la = getLosAngelesNow();

  // Start from current Los Angeles calendar date at 6:30 PM
  const current = new Date(la.year, la.month, la.day, 18, 30);
  const dayOfWeek = current.getDay(); // 0 is Sunday, 4 is Thursday

  let daysUntilThursday = (4 - dayOfWeek + 7) % 7;

  // If today in Los Angeles is Thursday, check if session already ended (after 20:15 / 8:15 PM)
  if (dayOfWeek === 4 && (la.hour > 20 || (la.hour === 20 && la.minute >= 15))) {
    daysUntilThursday = 7; // Advance to next Thursday
  }

  current.setDate(current.getDate() + daysUntilThursday);

  for (let i = 0; i < count; i++) {
    const sessionDate = new Date(current);
    const dateStr = formatYMD(sessionDate);
    const isClosed = KNOWN_CLOSURES.has(dateStr);

    sessions.push({
      id: dateStr,
      date: sessionDate,
      dateStr: dateStr,
      title: isClosed ? '🏀 (Gym Closed)' : '🏀 Egan Hoops',
      startTime: '6:30 PM',
      endTime: '8:15 PM',
      location: 'Egan Junior High School, 100 W Portola Ave, Los Altos, CA',
      isClosed: isClosed
    });

    current.setDate(current.getDate() + 7);
  }

  return sessions;
}

// Fetch live iCloud iCal feed if available via Cloudflare Pages Function
async function syncICloudCalendar() {
  try {
    const res = await fetch('/api/calendar');
    if (res.ok) {
      const text = await res.text();
      const prevCount = KNOWN_CLOSURES.size;
      parseIcsClosures(text);
      if (KNOWN_CLOSURES.size !== prevCount || !state.currentSession) {
        const prevId = state.currentSession ? state.currentSession.id : null;
        initSchedule();
        if (state.currentSession && state.currentSession.id !== prevId) {
          loadRSVPs();
        }
        renderAll();
      }
    }
  } catch (err) {
    console.log('Using pre-synced calendar rules:', err.message);
  }
}

function parseIcsClosures(icsText) {
  const events = icsText.split('BEGIN:VEVENT');
  for (let i = 1; i < events.length; i++) {
    const ev = events[i].split('END:VEVENT')[0];
    if (/Gym Closed|CLOSED|CANCELLED/i.test(ev)) {
      const match = ev.match(/DTSTART[^:]*:(\d{8})/);
      const recurrenceMatch = ev.match(/RECURRENCE-ID[^:]*:(\d{8})/);
      const raw = (match && match[1]) || (recurrenceMatch && recurrenceMatch[1]);
      if (raw) {
        const dateStr = `${raw.substring(0,4)}-${raw.substring(4,6)}-${raw.substring(6,8)}`;
        KNOWN_CLOSURES.add(dateStr);
      }
    }
  }
}

function initSchedule() {
  const allSessions = getUpcomingThursdays(12);
  // Find the first upcoming Thursday that is NOT closed
  const active = allSessions.find(s => !s.isClosed) || allSessions[0];
  state.currentSession = active;
  state.upcomingSessions = allSessions;
}

// --- Database & Storage (Supabase + Offline LocalStorage Fallback) ---
function initDatabase() {
  const url = localStorage.getItem('egan_hoops_sb_url') || DEFAULT_SUPABASE_URL;
  const key = localStorage.getItem('egan_hoops_sb_key') || DEFAULT_SUPABASE_KEY;

  if (url && key && window.supabase) {
    try {
      state.supabase = window.supabase.createClient(url, key);
      console.log('Connected to Supabase Realtime');
      subscribeToRealtime();
      loadAnnouncement();
    } catch (e) {
      console.warn('Supabase initialization failed, falling back to local mode:', e);
      state.supabase = null;
    }
  }

  loadRSVPs();
}

async function loadRSVPs() {
  if (!state.currentSession) return;
  const sessionId = state.currentSession.id;

  if (state.supabase) {
    const { data, error } = await state.supabase
      .from('rsvps')
      .select('*')
      .eq('session_id', sessionId);
    
    if (!error && data) {
      state.rsvps = data;
      renderAll();
      return;
    }
  }

  // LocalStorage Fallback
  const key = `egan_rsvps_${sessionId}`;
  const stored = localStorage.getItem(key);
  if (stored) {
    state.rsvps = JSON.parse(stored);
  } else {
    // Seed friendly default regulars for immediate testability
    state.rsvps = [
      { id: '1', player_name: 'Caleb Morris', status: 'in', guest_count: 1, guest_names: 'Alex', note: 'Bringing 2 basketballs' },
      { id: '2', player_name: 'Dave K.', status: 'in', guest_count: 0, guest_names: '', note: '' },
      { id: '3', player_name: 'Marcus Vance', status: 'in', guest_count: 0, guest_names: '', note: '' },
      { id: '4', player_name: 'Jordan Miller', status: 'in', guest_count: 1, guest_names: 'Chris', note: 'Running 5m late' },
      { id: '5', player_name: 'Sam T.', status: 'out', guest_count: 0, guest_names: '', note: 'Traveling for work' }
    ];
    saveLocalRSVPs();
  }
  renderAll();
}

function saveLocalRSVPs() {
  if (!state.currentSession) return;
  const key = `egan_rsvps_${state.currentSession.id}`;
  localStorage.setItem(key, JSON.stringify(state.rsvps));
}

function subscribeToRealtime() {
  if (!state.supabase) return;
  
  state.supabase
    .channel('public:rsvps')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rsvps' }, () => {
      loadRSVPs();
    })
    .subscribe();

  state.supabase
    .channel('public:site_settings')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, () => {
      loadAnnouncement();
    })
    .subscribe();
}

async function loadAnnouncement() {
  if (!state.supabase) return;
  try {
    const { data, error } = await state.supabase
      .from('site_settings')
      .select('value')
      .eq('key', 'announcement')
      .maybeSingle();

    if (!error && data && data.value) {
      state.announcement = data.value;
      renderAnnouncement();
    }
  } catch (err) {
    console.log('Error loading announcement:', err);
  }
}

async function saveRSVP(status) {
  const nameInput = document.getElementById('playerNameInput');
  const name = (state.currentUser || nameInput.value || '').trim();

  if (!name) {
    showToast('⚠️ Please enter your name to RSVP');
    nameInput.focus();
    return;
  }

  // Save current user to memory
  state.currentUser = name;
  localStorage.setItem('egan_hoops_user', name);
  recordPastPlayer(name);

  const guestCount = parseInt(document.getElementById('guestCountSelect').value, 10) || 0;
  const guestNames = (document.getElementById('guestNamesInput').value || '').trim();
  const note = (document.getElementById('playerNoteInput').value || '').trim();

  const rsvpPayload = {
    session_id: state.currentSession.id,
    player_name: name,
    status: status,
    guest_count: status === 'in' ? guestCount : 0,
    guest_names: status === 'in' ? guestNames : '',
    note: note,
    updated_at: new Date().toISOString()
  };

  if (state.supabase) {
    const { error } = await state.supabase
      .from('rsvps')
      .upsert(rsvpPayload, { onConflict: 'session_id,player_name' });
    
    if (error) {
      console.error('Supabase error, saving locally:', error);
      saveLocalRSVPEntry(rsvpPayload);
    }
  } else {
    saveLocalRSVPEntry(rsvpPayload);
  }

  showToast(status === 'in' ? `🏀 You're IN! Let's hoop.` : `Marked OUT. Catch you next week!`);
  renderAll();
}

function saveLocalRSVPEntry(entry) {
  const idx = state.rsvps.findIndex(r => r.player_name.toLowerCase() === entry.player_name.toLowerCase());
  if (idx >= 0) {
    state.rsvps[idx] = { ...state.rsvps[idx], ...entry };
  } else {
    state.rsvps.push({ id: Date.now().toString(), ...entry });
  }
  saveLocalRSVPs();
}

async function deleteRSVP(playerName) {
  if (!confirm(`Remove ${playerName} from the roster?`)) return;

  if (state.supabase && state.currentSession) {
    await state.supabase
      .from('rsvps')
      .delete()
      .eq('session_id', state.currentSession.id)
      .eq('player_name', playerName);
  }

  state.rsvps = state.rsvps.filter(r => r.player_name !== playerName);
  saveLocalRSVPs();
  showToast(`Removed ${playerName}`);
  renderAll();
}

function recordPastPlayer(name) {
  let past = [];
  try {
    past = JSON.parse(localStorage.getItem('egan_hoops_past_players') || '[]');
  } catch (e) {}
  if (!past.includes(name)) {
    past.push(name);
    localStorage.setItem('egan_hoops_past_players', JSON.stringify(past));
  }
  updateAutocomplete();
}

function updateAutocomplete() {
  const datalist = document.getElementById('pastPlayersList');
  if (!datalist) return;
  let past = [];
  try {
    past = JSON.parse(localStorage.getItem('egan_hoops_past_players') || '[]');
  } catch (e) {}
  datalist.innerHTML = past.map(p => `<option value="${escapeHtml(p)}"></option>`).join('');
}

// --- UI Rendering & Calculations ---
function renderAll() {
  renderSessionInfo();
  renderHeadcount();
  renderRoster();
  renderIdentity();
  renderAnnouncement();
  renderUpcomingSchedule();
}

function renderSessionInfo() {
  if (!state.currentSession) return;
  const s = state.currentSession;

  const dateOpts = { weekday: 'long', month: 'short', day: 'numeric' };
  const formattedDate = s.date.toLocaleDateString('en-US', dateOpts).toUpperCase();

  document.getElementById('gameDateDisplay').textContent = formattedDate;
  document.getElementById('gameTimeDisplay').textContent = `${s.startTime} – ${s.endTime}`;
  document.getElementById('gameLocationDisplay').textContent = s.location;
}

function renderHeadcount() {
  const inPlayers = state.rsvps.filter(r => r.status === 'in');
  const totalGuests = inPlayers.reduce((sum, r) => sum + (r.guest_count || 0), 0);
  const totalIn = inPlayers.length + totalGuests;

  document.getElementById('confirmedCount').textContent = totalIn;
  document.getElementById('rosterInCountPill').textContent = `${totalIn} IN`;
  document.getElementById('rosterOutCountPill').textContent = `${state.rsvps.filter(r => r.status === 'out').length} OUT`;

  // Progress Bar (scaled to 12 as 100%)
  const percentage = Math.min(100, Math.round((totalIn / TARGET_IDEAL_MAX) * 100));
  const fill = document.getElementById('progressFill');
  fill.style.width = `${percentage}%`;

  const statusBadge = document.getElementById('statusBadge');
  const statusBadgeText = document.getElementById('statusBadgeText');
  const targetStatusText = document.getElementById('targetStatusText');

  if (state.currentSession && state.currentSession.isClosed) {
    statusBadge.className = 'status-badge closed';
    statusBadgeText.textContent = 'GYM CLOSED';
    targetStatusText.textContent = 'No Hoops This Week';
    fill.style.background = '#DC2626';
    return;
  }

  if (totalIn >= TARGET_IDEAL_MIN) {
    statusBadge.className = 'status-badge game-on';
    statusBadgeText.textContent = '🔥 GAME ON (IDEAL SQUAD)';
    targetStatusText.textContent = `${totalIn} Players • Full Court 5v5 Ready`;
    fill.style.background = 'linear-gradient(90deg, #D96B27, #1E5139)';
  } else if (totalIn >= TARGET_MIN_PLAYERS) {
    statusBadge.className = 'status-badge game-on';
    statusBadgeText.textContent = '🔥 GAME ON (8+ PLAYERS)';
    targetStatusText.textContent = `Need ${TARGET_IDEAL_MIN - totalIn} more for ideal 5v5 rotation`;
    fill.style.background = '#1E5139';
  } else {
    const needed = TARGET_MIN_PLAYERS - totalIn;
    statusBadge.className = 'status-badge need-players';
    statusBadgeText.textContent = `🏀 NEED ${needed} MORE`;
    targetStatusText.textContent = `Need at least 8 to run games (${needed} more needed)`;
    fill.style.background = 'var(--leather-orange)';
  }
}

function renderRoster() {
  const inListEl = document.getElementById('inPlayerList');
  const outListEl = document.getElementById('outPlayerList');

  const inPlayers = state.rsvps.filter(r => r.status === 'in');
  const outPlayers = state.rsvps.filter(r => r.status === 'out');

  // Render IN list
  if (inPlayers.length === 0) {
    inListEl.innerHTML = '<li class="empty-state">No players confirmed yet. Be the first!</li>';
  } else {
    inListEl.innerHTML = inPlayers.map((p, idx) => {
      const isMe = state.currentUser && p.player_name.toLowerCase() === state.currentUser.toLowerCase();
      let guestTag = '';
      if (p.guest_count > 0) {
        const guestNames = p.guest_names ? `: ${p.guest_names}` : '';
        guestTag = `<span class="guest-badge">+${p.guest_count}${escapeHtml(guestNames)}</span>`;
      }
      const noteHtml = p.note ? `<div class="player-note">"${escapeHtml(p.note)}"</div>` : '';
      const deleteBtn = `<button class="admin-delete-btn" onclick="deleteRSVP('${escapeHtml(p.player_name)}')" title="Delete RSVP">🗑️</button>`;

      return `
        <li class="player-row ${isMe ? 'highlight-me' : ''}">
          <div class="player-info-left">
            <span class="player-number">#${idx + 1}</span>
            <div>
              <span class="player-name-text">${escapeHtml(p.player_name)}</span>
              ${guestTag}
              ${noteHtml}
            </div>
          </div>
          <div>${deleteBtn}</div>
        </li>
      `;
    }).join('');
  }

  // Render OUT list
  if (outPlayers.length === 0) {
    outListEl.innerHTML = '<li class="empty-state">No one has marked out.</li>';
  } else {
    outListEl.innerHTML = outPlayers.map(p => {
      const deleteBtn = `<button class="admin-delete-btn" onclick="deleteRSVP('${escapeHtml(p.player_name)}')" title="Delete RSVP">🗑️</button>`;
      const noteHtml = p.note ? `<span class="player-note">("${escapeHtml(p.note)}")</span>` : '';
      return `
        <li class="player-row" style="opacity: 0.85;">
          <div class="player-info-left">
            <span style="color: var(--varsity-red); font-size: 13px;">✕</span>
            <span class="player-name-text">${escapeHtml(p.player_name)}</span>
            ${noteHtml}
          </div>
          <div>${deleteBtn}</div>
        </li>
      `;
    }).join('');
  }
}

function renderIdentity() {
  const bar = document.getElementById('rememberedUserBar');
  const inputGroup = document.getElementById('nameInputGroup');
  const currentNameEl = document.getElementById('currentUserName');
  const btnIn = document.getElementById('btnImIn');
  const btnOut = document.getElementById('btnImOut');

  if (state.currentUser) {
    bar.style.display = 'flex';
    inputGroup.style.display = 'none';
    currentNameEl.textContent = state.currentUser;

    const myRSVP = state.rsvps.find(r => r.player_name.toLowerCase() === state.currentUser.toLowerCase());
    if (myRSVP) {
      if (myRSVP.status === 'in') {
        btnIn.classList.add('active');
        btnOut.classList.remove('active');
      } else {
        btnIn.classList.remove('active');
        btnOut.classList.add('active');
      }
    } else {
      btnIn.classList.remove('active');
      btnOut.classList.remove('active');
    }
  } else {
    bar.style.display = 'none';
    inputGroup.style.display = 'block';
    btnIn.classList.remove('active');
    btnOut.classList.remove('active');
  }
}

function renderAnnouncement() {
  const banner = document.getElementById('announcementBanner');
  const textEl = document.getElementById('announcementText');
  if (state.announcement && state.announcement.trim()) {
    banner.style.display = 'flex';
    textEl.textContent = state.announcement;
  } else {
    // Check if intermediate sessions are closed before the next active game
    const closedCount = (state.upcomingSessions || []).filter(s => s.isClosed && state.currentSession && s.date < state.currentSession.date).length;
    if (closedCount > 0 && state.currentSession) {
      const activeDateFormatted = state.currentSession.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      banner.style.display = 'flex';
      textEl.textContent = `Gym is closed for the next ${closedCount === 1 ? 'week' : closedCount + ' weeks'}. Next pickup session is ${activeDateFormatted}!`;
    } else {
      banner.style.display = 'none';
    }
  }
}

function renderUpcomingSchedule() {
  const container = document.getElementById('upcomingScheduleList');
  if (!container || !state.upcomingSessions) return;

  const items = state.upcomingSessions.slice(0, 7).map(s => {
    const isCurrentActive = state.currentSession && s.id === state.currentSession.id;
    const dateFormatted = s.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    let statusText = 'Open (6:30–8:15 PM)';
    if (s.isClosed) {
      statusText = '<span style="color: #DC2626; font-weight: 700;">Gym Closed</span>';
    } else if (isCurrentActive) {
      statusText = '<span style="color: var(--varsity-green); font-weight: 700;">Next Game 🏀</span>';
    }

    return `
      <div class="schedule-item ${s.isClosed ? 'closed' : ''}" style="${isCurrentActive ? 'background: #F0FDF4; border-left: 3px solid var(--varsity-green);' : ''}">
        <div>
          <strong style="color: var(--navy-primary); font-size: 13.5px;">${dateFormatted}</strong>
          <div style="font-size: 11px; color: var(--text-muted);">${s.location}</div>
        </div>
        <div style="font-size: 12px; font-weight: 600;">${statusText}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = items || '<div class="empty-state">No upcoming dates scheduled.</div>';
}

// --- Share to Group Chat ---
async function copyChatSummary() {
  if (!state.currentSession) return;
  const s = state.currentSession;
  const dateFormatted = s.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const inPlayers = state.rsvps.filter(r => r.status === 'in');
  const outPlayers = state.rsvps.filter(r => r.status === 'out');
  const totalGuests = inPlayers.reduce((sum, r) => sum + (r.guest_count || 0), 0);
  const totalIn = inPlayers.length + totalGuests;

  let statusEmoji = '🏀';
  let statusText = 'Need more players';
  if (totalIn >= TARGET_IDEAL_MIN) {
    statusEmoji = '🔥';
    statusText = 'Game On (Ideal Squad)';
  } else if (totalIn >= TARGET_MIN_PLAYERS) {
    statusEmoji = '🔥';
    statusText = 'Game On!';
  }

  let text = `${statusEmoji} EGAN HOOPS — ${dateFormatted.toUpperCase()}\n`;
  text += `⏰ ${s.startTime} – ${s.endTime} @ Egan Gym\n`;
  text += `📊 Status: ${statusText} (${totalIn} confirmed)\n\n`;

  text += `IN (${totalIn}):\n`;
  if (inPlayers.length === 0) {
    text += `(No players confirmed yet)\n`;
  } else {
    inPlayers.forEach((p, idx) => {
      let line = `${idx + 1}. ${p.player_name}`;
      if (p.guest_count > 0) {
        line += ` (+${p.guest_count}${p.guest_names ? ' ' + p.guest_names : ''})`;
      }
      if (p.note) {
        line += ` - "${p.note}"`;
      }
      text += `${line}\n`;
    });
  }

  if (outPlayers.length > 0) {
    text += `\nOUT:\n`;
    outPlayers.forEach(p => {
      text += `• ${p.player_name}${p.note ? ' (' + p.note + ')' : ''}\n`;
    });
  }

  const url = window.location.href;
  text += `\nRSVP / Details:\n${url}`;

  // Use Web Share API if supported on mobile device
  if (navigator.share) {
    try {
      await navigator.share({
        title: `Egan Hoops — ${dateFormatted}`,
        text: text
      });
      showToast('Shared successfully!');
      return;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.log('Share sheet canceled or failed, using clipboard');
      } else {
        return; // user dismissed share sheet
      }
    }
  }

  // Fallback to clipboard
  try {
    await navigator.clipboard.writeText(text);
    showToast('📋 Summary copied to clipboard!');
  } catch (err) {
    showToast('Failed to copy. Please copy manually.');
  }
}

// --- Admin Controls ---
function setupAdmin() {
  const adminBtn = document.getElementById('adminBtn');
  const modal = document.getElementById('adminModal');
  const closeBtn = document.getElementById('closeAdminModalBtn');
  const loginBtn = document.getElementById('adminLoginBtn');
  const passInput = document.getElementById('adminPasscodeInput');
  const authSec = document.getElementById('adminAuthSection');
  const toolsSec = document.getElementById('adminToolsSection');
  const announcementInput = document.getElementById('adminAnnouncementInput');
  const saveAnnouncementBtn = document.getElementById('saveAnnouncementBtn');
  const clearAnnouncementBtn = document.getElementById('clearAnnouncementBtn');
  const logoutBtn = document.getElementById('adminLogoutBtn');
  const saveSupabaseBtn = document.getElementById('saveSupabaseBtn');

  adminBtn.addEventListener('click', () => {
    modal.classList.add('open');
    if (state.isAdmin) {
      authSec.style.display = 'none';
      toolsSec.style.display = 'block';
      announcementInput.value = state.announcement || '';
    } else {
      authSec.style.display = 'block';
      toolsSec.style.display = 'none';
      passInput.value = '';
    }
  });

  closeBtn.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });

  loginBtn.addEventListener('click', () => {
    if (passInput.value.trim() === DEFAULT_PASSCODE) {
      state.isAdmin = true;
      document.body.classList.add('admin-mode-active');
      document.getElementById('adminLockIcon').textContent = '🔓';
      authSec.style.display = 'none';
      toolsSec.style.display = 'block';
      announcementInput.value = state.announcement || '';
      showToast('🔓 Organizer Mode Unlocked');
      renderAll();
    } else {
      showToast('❌ Incorrect Passcode');
    }
  });

  saveAnnouncementBtn.addEventListener('click', async () => {
    const val = announcementInput.value.trim();
    state.announcement = val;
    localStorage.setItem('egan_hoops_announcement', val);
    if (state.supabase) {
      await state.supabase.from('site_settings').upsert({ key: 'announcement', value: val, updated_at: new Date().toISOString() });
    }
    showToast('Banner saved!');
    renderAnnouncement();
  });

  clearAnnouncementBtn.addEventListener('click', async () => {
    state.announcement = '';
    localStorage.removeItem('egan_hoops_announcement');
    if (state.supabase) {
      await state.supabase.from('site_settings').delete().eq('key', 'announcement');
    }
    announcementInput.value = '';
    showToast('Banner cleared');
    renderAnnouncement();
  });

  logoutBtn.addEventListener('click', () => {
    state.isAdmin = false;
    document.body.classList.remove('admin-mode-active');
    document.getElementById('adminLockIcon').textContent = '🔒';
    modal.classList.remove('open');
    showToast('Admin Mode Locked');
    renderAll();
  });

  saveSupabaseBtn.addEventListener('click', () => {
    const url = document.getElementById('supabaseUrlInput').value.trim();
    const key = document.getElementById('supabaseKeyInput').value.trim();
    if (url && key) {
      localStorage.setItem('egan_hoops_sb_url', url);
      localStorage.setItem('egan_hoops_sb_key', key);
      showToast('Supabase settings saved. Reloading...');
      setTimeout(() => window.location.reload(), 800);
    }
  });
}

// --- Utilities ---
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  initSchedule();
  initDatabase();
  setupAdmin();
  updateAutocomplete();

  // Event Listeners
  document.getElementById('btnImIn').addEventListener('click', () => saveRSVP('in'));
  document.getElementById('btnImOut').addEventListener('click', () => saveRSVP('out'));
  document.getElementById('copySummaryBtn').addEventListener('click', copyChatSummary);

  document.getElementById('changeUserBtn').addEventListener('click', () => {
    state.currentUser = '';
    localStorage.removeItem('egan_hoops_user');
    renderIdentity();
    document.getElementById('playerNameInput').focus();
  });

  const guestToggle = document.getElementById('guestDrawerToggle');
  const guestDrawer = document.getElementById('guestDrawer');
  guestToggle.addEventListener('click', () => {
    const isHidden = guestDrawer.style.display === 'none';
    guestDrawer.style.display = isHidden ? 'flex' : 'none';
    guestToggle.innerHTML = isHidden ? '<span>➖</span> Hide guest / note options' : '<span>➕</span> Bringing someone or have a note? (Optional)';
  });

  // Sync background calendar feed if online
  syncICloudCalendar();
});
