// life-os v2.0 統合ツール / Googleカレンダー同期（OAuth・API呼び出し・純粋関数）
// scheduler.js から import して使う専用モジュール。
// 参照: docs/superpowers/specs/2026-07-03-scheduler-gcal-sync-design.md
'use strict';

export const CLIENT_ID = '872120885665-tevu226h9f2481mfn5dnubttrgojk4kl.apps.googleusercontent.com';
export const SCHEDULER_CALENDAR_NAME = 'Scheduler';

const READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API_BASE = 'https://www.googleapis.com/calendar/v3';

let accessToken = null;
let tokenExpiresAt = 0;
let currentScope = null;

function loadGis() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('ブラウザ環境ではありません')); return; }
    if (window.google && window.google.accounts && window.google.accounts.oauth2) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('GISスクリプトの読み込みに失敗しました'));
    document.head.appendChild(s);
  });
}

// scope: 'readonly' | 'events'（'events'はreadonlyも含めて要求）
export async function ensureToken(scope) {
  await loadGis();
  const needed = scope === 'events' ? `${READONLY_SCOPE} ${EVENTS_SCOPE}` : READONLY_SCOPE;
  if (accessToken && currentScope === needed && Date.now() < tokenExpiresAt) {
    return accessToken;
  }
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: needed,
      callback: (resp) => {
        if (resp.error) { reject(new Error('Google認可に失敗しました: ' + resp.error)); return; }
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (resp.expires_in * 1000 - 60000);
        currentScope = needed;
        resolve(accessToken);
      }
    });
    client.requestAccessToken();
  });
}

async function apiFetch(token, path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Calendar API ${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

export function apiListCalendars(token) {
  return apiFetch(token, '/users/me/calendarList').then(r => (r && r.items) || []);
}
export function apiListEvents(token, calendarId, timeMinISO, timeMaxISO) {
  const q = new URLSearchParams({ timeMin: timeMinISO, timeMax: timeMaxISO, singleEvents: 'true', orderBy: 'startTime' });
  return apiFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events?${q}`).then(r => (r && r.items) || []);
}
export function apiInsertEvent(token, calendarId, body) {
  return apiFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) });
}
export function apiPatchEvent(token, calendarId, eventId, body) {
  return apiFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

function jstDateStr(d) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d);
}
function jstTimeStr(d) {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

// Google Event -> scheduler item（終日予定・複数日にまたがる予定はnullを返す＝呼び出し側でスキップ）
export function mapGCalEventToItem(event, calendarId) {
  if (!event.start || !event.start.dateTime || !event.end || !event.end.dateTime) return null;
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  const date = jstDateStr(start);
  if (date !== jstDateStr(end)) return null;
  return {
    id: 'gcal-' + event.id,
    kind: 'event',
    title: event.summary || '(無題の予定)',
    type: 'GCal',
    priority: 'mid',
    est_min: Math.round((end - start) / 60000),
    due_date: null,
    fixed_start: jstTimeStr(start),
    date,
    travel_min: 0,
    blocking: true,
    status: 'todo',
    gcal_source: true,
    gcal_calendar_id: calendarId
  };
}

// scheduler item -> Google Event本体（push用）
export function buildEventBody(item) {
  const startISO = `${item.date}T${item.fixed_start}:00+09:00`;
  const endDate = new Date(new Date(startISO).getTime() + item.est_min * 60000);
  const endISO = `${jstDateStr(endDate)}T${jstTimeStr(endDate)}:00+09:00`;
  return {
    summary: item.title,
    start: { dateTime: startISO, timeZone: 'Asia/Tokyo' },
    end: { dateTime: endISO, timeZone: 'Asia/Tokyo' }
  };
}

export function findCalendarByName(calendars, name) {
  return calendars.find(c => c.summary === name) || null;
}

// 今日〜+days日（既定8暦日=今日+7日）の取得範囲
export function syncWindow(todayDateStr, days = 8) {
  const startDate = new Date(`${todayDateStr}T00:00:00+09:00`);
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + days);
  return {
    timeMin: `${todayDateStr}T00:00:00+09:00`,
    timeMax: endDate.toISOString(),
    rangeStartDate: todayDateStr,
    rangeEndDateExclusive: jstDateStr(endDate)
  };
}

// 対象期間内のgcal_source予定だけ洗い替え。範囲外・手動予定・タスクはそのまま保持
export function mergeGCalImport(existingItems, importedItems, rangeStartDate, rangeEndDateExclusive) {
  const kept = existingItems.filter(i =>
    !(i.kind === 'event' && i.gcal_source && i.date >= rangeStartDate && i.date < rangeEndDateExclusive)
  );
  return kept.concat(importedItems);
}
