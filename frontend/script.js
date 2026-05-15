/* =============================================================================
   VSoft RAG Chat — frontend (vanilla)
   Sections: Config → DOM → Chat history → Formatting → Messaging → Voice → UI
   ============================================================================= */

'use strict';

/* ----------------------------------------------------------------------------- */
/* Config & API endpoints (unchanged integration) */
/* ----------------------------------------------------------------------------- */

const API_BASE = 'http://localhost:5000';
const CHAT_URL = `${API_BASE}/chat`;
const VOICE_URL = CHAT_URL;
const CLEAR_URL = `${API_BASE}/clear`;

const STORAGE_KEY = 'vsoft_rag_chats_v2';
const LEGACY_STORAGE_KEY = 'vsoft_rag_chats_v1';
const RECENTS_PANEL_OPEN_KEY = 'vsoft_recents_panel_open';

const VOICE_SILENCE_MS = 2600;
const VOICE_MIN_RECORD_MS = 520;
const VOICE_MAX_RECORD_MS = 120000;

/* ----------------------------------------------------------------------------- */
/* DOM references */
/* ----------------------------------------------------------------------------- */

const messagesContainer = document.getElementById('messagesContainer');
const messagesDiv = document.getElementById('messages');
const welcomeMessage = document.getElementById('welcomeMessage');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const inputWrapper = document.getElementById('inputWrapper');
const voiceWaveOverlay = document.getElementById('voiceWaveOverlay');
const voiceWaveLabel = document.getElementById('voiceWaveLabel');

const sidebarEl = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');
const sidebarNewChatBtn = document.getElementById('sidebarNewChatBtn');
const sidebarSearchBtn = document.getElementById('sidebarSearchBtn');
const sidebarRecentsToggleBtn = document.getElementById('sidebarRecentsToggleBtn');
const sidebarRecentsPanel = document.getElementById('sidebarRecentsPanel');
const chatSearchInput = document.getElementById('chatSearchInput');
const chatHistoryList = document.getElementById('chatHistoryList');

/* ----------------------------------------------------------------------------- */
/* Application state */
/* ----------------------------------------------------------------------------- */

let isLoading = false;

/** @type {{ id: string, title: string, updatedAt: number, messages: { role: string, content: string }[] }[]} */
let conversations = [];
let activeChatId = null;
/** Mirrors the active chat transcript for persistence */
let currentMessages = [];

/** Client-side filter for sidebar search */
let chatSearchQuery = '';

/* ----------------------------------------------------------------------------- */
/* Voice capture (persistent stream; silence ends clip) */
/* ----------------------------------------------------------------------------- */

let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let preferredVoiceMime = '';
let isVoiceRecording = false;
let skipNextVoiceUpload = false;

let voiceAudioContext = null;
let voiceSourceNode = null;
let voiceAnalyserNode = null;
let voiceAnalyserRaf = null;
let voiceWaveBars = [];
let voiceTimeDomainBuffer = null;

let voiceRecordingStartedAt = 0;
let voicePeakRms = 0.001;
let voiceLastSoundAt = 0;
let voiceMaxRecordTimeoutId = null;

const voiceBarHeightsSmooth = [];

/* ----------------------------------------------------------------------------- */
/* Chat history (localStorage) */
/* ----------------------------------------------------------------------------- */

function safeJsonParse(str, fallback) {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

function generateId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function titleFromFirstUserMessage(text) {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    return t || 'Chat';
}

function loadConversationsFromStorage() {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    }
    const parsed = safeJsonParse(raw, null);
    if (!parsed || !Array.isArray(parsed.chats)) {
        conversations = [];
        activeChatId = null;
        currentMessages = [];
        return;
    }

    conversations = parsed.chats
        .map((c) => ({
            id: String(c.id || generateId()),
            title: String(c.title || 'Chat'),
            updatedAt: Number(c.updatedAt) || Date.now(),
            messages: Array.isArray(c.messages) ? c.messages.map((m) => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: String(m.content || ''),
            })) : [],
        }))
        .filter((c) => c.messages.length > 0 && c.messages.some((m) => m.role === 'user'));

    let id = parsed.activeId ? String(parsed.activeId) : null;
    if (!id || !conversations.some((c) => c.id === id)) {
        id = conversations[0] ? conversations[0].id : null;
    }
    activeChatId = id;
    const active = conversations.find((c) => c.id === activeChatId);
    currentMessages = active ? active.messages.map((m) => ({ ...m })) : [];
}

function saveConversationsToStorage() {
    const payload = {
        version: 2,
        activeId: activeChatId,
        chats: conversations.map((c) => ({
            id: c.id,
            title: c.title,
            updatedAt: c.updatedAt,
            messages: c.messages.map((m) => ({ ...m })),
        })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    if (localStorage.getItem(LEGACY_STORAGE_KEY)) {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
}

function pruneEmptyChats() {
    conversations = conversations.filter(
        (c) => c.messages.length > 0 && c.messages.some((m) => m.role === 'user'),
    );
    if (activeChatId && !conversations.some((c) => c.id === activeChatId)) {
        activeChatId = null;
    }
}

function syncActiveChatFromCurrentMessages() {
    if (!activeChatId) return;
    const chat = conversations.find((c) => c.id === activeChatId);
    if (!chat) return;
    chat.messages = currentMessages.map((m) => ({ ...m }));
    chat.updatedAt = Date.now();
    const firstUser = currentMessages.find((m) => m.role === 'user');
    if (firstUser && firstUser.content.trim()) {
        chat.title = titleFromFirstUserMessage(firstUser.content);
    }
    conversations.sort((a, b) => b.updatedAt - a.updatedAt);
}

function saveSession() {
    pruneEmptyChats();
    saveConversationsToStorage();
    renderChatList();
}

function ensureChatRecordForFirstUserMessage(userText) {
    const hadUserBefore = currentMessages.some((m) => m.role === 'user');
    if (!activeChatId || !conversations.some((c) => c.id === activeChatId)) {
        const id = generateId();
        conversations.unshift({
            id,
            title: titleFromFirstUserMessage(userText),
            updatedAt: Date.now(),
            messages: [],
        });
        activeChatId = id;
        return;
    }
    const chat = conversations.find((c) => c.id === activeChatId);
    if (chat && !hadUserBefore) {
        chat.title = titleFromFirstUserMessage(userText);
    }
}

function appendToTranscript(role, content) {
    if (role === 'user') {
        ensureChatRecordForFirstUserMessage(content);
    }
    currentMessages.push({ role, content });
    syncActiveChatFromCurrentMessages();
    saveSession();
}

function persistActiveConversation() {
    syncActiveChatFromCurrentMessages();
    saveSession();
}

function getFilteredConversations() {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => (c.title || '').toLowerCase().includes(q));
}

function renderChatList() {
    if (!chatHistoryList) return;
    chatHistoryList.innerHTML = '';
    const frag = document.createDocumentFragment();
    const list = getFilteredConversations();

    if (!list.length && chatSearchQuery.trim()) {
        const empty = document.createElement('div');
        empty.className = 'sidebar-chat-empty';
        empty.textContent = 'No chats match your search.';
        frag.appendChild(empty);
        chatHistoryList.appendChild(frag);
        return;
    }

    list.forEach((chat) => {
        const row = document.createElement('div');
        row.className = 'sidebar-chat-item';
        if (chat.id === activeChatId) row.classList.add('is-active');
        row.dataset.chatId = chat.id;

        const body = document.createElement('button');
        body.type = 'button';
        body.className = 'sidebar-chat-item-body';
        body.setAttribute('aria-current', chat.id === activeChatId ? 'true' : 'false');

        const title = document.createElement('div');
        title.className = 'sidebar-chat-item-title';
        const firstUserMsg = chat.messages.find((m) => m.role === 'user');
        title.textContent = firstUserMsg
            ? titleFromFirstUserMessage(firstUserMsg.content)
            : (chat.title || 'Chat');

        body.appendChild(title);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'sidebar-chat-delete';
        del.setAttribute('aria-label', 'Delete chat');
        del.title = 'Delete';
        del.innerHTML =
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

        del.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteConversation(chat.id);
        });

        body.addEventListener('click', () => {
            switchConversation(chat.id);
        });

        row.appendChild(body);
        row.appendChild(del);
        frag.appendChild(row);
    });

    chatHistoryList.appendChild(frag);
}

function isMobileSidebarLayout() {
    return globalThis.matchMedia && globalThis.matchMedia('(max-width: 900px)').matches;
}

function openMobileSidebar() {
    if (!sidebarEl || !sidebarBackdrop) return;
    sidebarEl.classList.add('sidebar--open');
    sidebarBackdrop.hidden = false;
    sidebarBackdrop.classList.add('is-visible');
    sidebarOpenBtn?.setAttribute('aria-expanded', 'true');
    if (isMobileSidebarLayout()) {
        setRecentsPanelOpen(true);
    }
}

function closeMobileSidebar() {
    if (!sidebarEl || !sidebarBackdrop) return;
    sidebarEl.classList.remove('sidebar--open');
    sidebarBackdrop.classList.remove('is-visible');
    sidebarBackdrop.hidden = true;
    sidebarOpenBtn?.setAttribute('aria-expanded', 'false');
}

function setRecentsPanelOpen(open) {
    if (!sidebarEl) return;
    sidebarEl.classList.toggle('sidebar--recents-open', open);
    sidebarRecentsToggleBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    localStorage.setItem(RECENTS_PANEL_OPEN_KEY, open ? '1' : '0');
}

function toggleRecentsPanel() {
    const open = !sidebarEl?.classList.contains('sidebar--recents-open');
    setRecentsPanelOpen(open);
    if (!open) {
        chatSearchInput?.blur();
    }
}

function openRecentsPanelForSearch() {
    setRecentsPanelOpen(true);
    requestAnimationFrame(() => {
        chatSearchInput?.focus();
        chatSearchInput?.select();
    });
}

function applySavedRecentsPanelState() {
    if (!sidebarEl || isMobileSidebarLayout()) return;
    setRecentsPanelOpen(localStorage.getItem(RECENTS_PANEL_OPEN_KEY) === '1');
}

function switchConversation(chatId) {
    if (chatId === activeChatId) {
        closeMobileSidebar();
        return;
    }
    persistActiveConversation();
    abortVoiceWithoutUpload();

    const next = conversations.find((c) => c.id === chatId);
    if (!next) return;

    activeChatId = next.id;
    currentMessages = next.messages.map((m) => ({ ...m }));
    saveConversationsToStorage();

    rebuildMessagesDomFromState();
    closeMobileSidebar();
    renderChatList();
    messageInput.focus();
}

function deleteConversation(chatId) {
    const idx = conversations.findIndex((c) => c.id === chatId);
    if (idx === -1) return;

    const wasActive = conversations[idx].id === activeChatId;
    conversations.splice(idx, 1);
    pruneEmptyChats();

    if (wasActive) {
        const next = conversations[0];
        activeChatId = next ? next.id : null;
        currentMessages = next ? next.messages.map((m) => ({ ...m })) : [];
        rebuildMessagesDomFromState();
    }

    saveConversationsToStorage();
    renderChatList();
    closeMobileSidebar();
}

async function startNewChat() {
    persistActiveConversation();
    abortVoiceWithoutUpload();

    activeChatId = null;
    currentMessages = [];

    if (chatSearchInput) {
        chatSearchInput.value = '';
    }
    chatSearchQuery = '';

    messagesDiv.innerHTML = '';
    welcomeMessage.classList.remove('hidden');
    messageInput.value = '';
    messageInput.style.height = 'auto';

    saveSession();

    try {
        await fetch(CLEAR_URL, { method: 'POST' });
    } catch (error) {
        console.error('Clear chat error:', error);
    }

    closeMobileSidebar();
    messageInput.focus();
}

function rebuildMessagesDomFromState() {
    messagesDiv.innerHTML = '';
    if (!currentMessages.length) {
        welcomeMessage.classList.remove('hidden');
        return;
    }
    welcomeMessage.classList.add('hidden');
    currentMessages.forEach((m) => {
        const el = createMessageElement(m.role, m.content);
        messagesDiv.appendChild(el);
        attachCopyHandlers(el);
        applySyntaxHighlighting(el);
    });
    scrollToBottom();
}

/* ----------------------------------------------------------------------------- */
/* Message formatting & rendering */
/* ----------------------------------------------------------------------------- */

function escapeHTML(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function extractCodeBlocks(text) {
    const blocks = [];
    const replaced = text.replace(/```([^\n`]*)?\n?([\s\S]*?)```/g, (_, lang, code) => {
        const token = `%%CODE_BLOCK_${blocks.length}%%`;
        let cleanLanguage = (lang || 'text')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9#+_-]/g, '');
        if (cleanLanguage === 'c++') cleanLanguage = 'cpp';
        if (cleanLanguage === 'c#') cleanLanguage = 'csharp';
        blocks.push({
            language: cleanLanguage || 'text',
            code: code.trim(),
        });
        return token;
    });
    return { replaced, blocks };
}

function renderCodeBlock(language, code, index, idPrefix) {
    const safeId = `${idPrefix}_${index}`.replace(/[^a-zA-Z0-9_-]/g, '');
    const safeCode = escapeHTML(code);
    const safeLanguage = escapeHTML(language || 'text');
    const classLanguage = (language || 'text').replace(/[^a-z0-9_-]/g, '');
    return `
        <div class="code-block">
            <div class="code-header">
                <span class="code-language">${safeLanguage}</span>
                <button class="code-copy-btn" data-copy-id="${safeId}" type="button">Copy</button>
            </div>
            <pre><code id="${safeId}" class="language-${classLanguage}">${safeCode}</code></pre>
        </div>
    `;
}

function formatMessage(text) {
    const idPrefix = `cb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    const { replaced, blocks } = extractCodeBlocks(text);
    let html = escapeHTML(replaced);

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    html = html.replace(/(?:^- .+(?:\n|$))+/gm, (match) => {
        const items = match
            .trim()
            .split('\n')
            .map((item) => `<li>${item.replace(/^- /, '')}</li>`)
            .join('');
        return `<ul>${items}</ul>`;
    });

    html = html.replace(/(?:^\d+\. .+(?:\n|$))+/gm, (match) => {
        const items = match
            .trim()
            .split('\n')
            .map((item) => `<li>${item.replace(/^\d+\.\s/, '')}</li>`)
            .join('');
        return `<ol>${items}</ol>`;
    });

    html = html.replace(/\n/g, '<br>');
    html = html.replace(/(<br>\s*){3,}/g, '<br><br>');

    blocks.forEach((block, i) => {
        const blockHtml = renderCodeBlock(block.language, block.code, i, idPrefix);
        html = html.replace(`%%CODE_BLOCK_${i}%%`, blockHtml);
    });

    return html;
}

function createMessageElement(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? 'U' : 'AI';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const roleLabel = document.createElement('div');
    roleLabel.className = 'message-role';
    roleLabel.textContent = role === 'user' ? 'You' : 'Assistant';

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.innerHTML = formatMessage(content);

    contentDiv.appendChild(roleLabel);
    contentDiv.appendChild(textDiv);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);
    return messageDiv;
}

function createTypingIndicator() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.id = 'typingIndicator';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = 'AI';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const roleLabel = document.createElement('div');
    roleLabel.className = 'message-role';
    roleLabel.textContent = 'Assistant';

    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.innerHTML = '<span></span><span></span><span></span>';

    contentDiv.appendChild(roleLabel);
    contentDiv.appendChild(typingDiv);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);
    return messageDiv;
}

function removeTypingIndicator() {
    document.getElementById('typingIndicator')?.remove();
}

function attachCopyHandlers(scopeElement) {
    scopeElement.querySelectorAll('.code-copy-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const codeId = btn.getAttribute('data-copy-id');
            const codeElement = codeId ? document.getElementById(codeId) : null;
            if (!codeElement) return;
            try {
                await navigator.clipboard.writeText(codeElement.textContent);
                const original = btn.textContent;
                btn.textContent = 'Copied';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = original;
                    btn.classList.remove('copied');
                }, 1200);
            } catch (error) {
                console.error('Copy failed:', error);
            }
        });
    });
}

function applySyntaxHighlighting(scopeElement) {
    if (!window.hljs) return;
    scopeElement.querySelectorAll('pre code').forEach((block) => {
        window.hljs.highlightElement(block);
    });
}

function appendDomMessage(role, content, { persist = true } = {}) {
    welcomeMessage.classList.add('hidden');
    const el = createMessageElement(role, content);
    messagesDiv.appendChild(el);
    attachCopyHandlers(el);
    applySyntaxHighlighting(el);
    if (persist) {
        appendToTranscript(role, content);
    }
    return el;
}

function transcriptHasUserMessage() {
    return currentMessages.some((m) => m.role === 'user');
}

/* ----------------------------------------------------------------------------- */
/* Text chat */
/* ----------------------------------------------------------------------------- */

async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || isLoading || isVoiceRecording) return;

    appendDomMessage('user', message);
    messageInput.value = '';
    messageInput.style.height = 'auto';

    isLoading = true;
    sendBtn.disabled = true;
    micBtn.disabled = true;

    const typingIndicator = createTypingIndicator();
    messagesDiv.appendChild(typingIndicator);
    scrollToBottom();

    try {
        const response = await fetch(CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Backend error:', errorText);
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        removeTypingIndicator();

        if (data.reply) {
            appendDomMessage('assistant', data.reply);
        } else {
            throw new Error('Invalid response format');
        }
    } catch (error) {
        console.error('Fetch Error:', error);
        removeTypingIndicator();
        appendDomMessage('assistant', '⚠️ Server error. Check backend or API key.', {
            persist: transcriptHasUserMessage(),
        });
    } finally {
        isLoading = false;
        sendBtn.disabled = false;
        micBtn.disabled = false;
        scrollToBottom();
        messageInput.focus();
    }
}

/* ----------------------------------------------------------------------------- */
/* Voice: helpers */
/* ----------------------------------------------------------------------------- */

function pickVoiceMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (const type of candidates) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
}

function persistentMicStreamIsLive() {
    if (!mediaStream) return false;
    const tracks = mediaStream.getAudioTracks();
    return tracks.length > 0 && tracks.some((t) => t.readyState === 'live');
}

function resetVoiceSessionTimers() {
    if (voiceMaxRecordTimeoutId) {
        clearTimeout(voiceMaxRecordTimeoutId);
        voiceMaxRecordTimeoutId = null;
    }
    voiceRecordingStartedAt = 0;
    voicePeakRms = 0.001;
    voiceLastSoundAt = 0;
}

function setVoiceOverlayMode(mode) {
    if (!voiceWaveOverlay || !voiceWaveLabel) return;
    const barsWrap = voiceWaveOverlay.querySelector('.voice-wave-bars');

    voiceWaveOverlay.classList.remove('voice-wave-overlay--transcribing');
    barsWrap?.classList.remove('voice-wave-bars--processing');

    if (mode === 'hidden') {
        voiceWaveOverlay.hidden = true;
        voiceWaveOverlay.setAttribute('aria-hidden', 'true');
        inputWrapper?.classList.remove('input-wrapper--voice-active');
        return;
    }

    voiceWaveOverlay.hidden = false;
    voiceWaveOverlay.setAttribute('aria-hidden', 'false');
    inputWrapper?.classList.add('input-wrapper--voice-active');

    if (mode === 'listening') {
        voiceWaveLabel.textContent = 'Listening…';
    } else if (mode === 'transcribing') {
        voiceWaveLabel.textContent = 'Transcribing…';
        voiceWaveOverlay.classList.add('voice-wave-overlay--transcribing');
        barsWrap?.classList.add('voice-wave-bars--processing');
    }
}

function resetMicButtonStyles() {
    micBtn.classList.remove('recording', 'processing');
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.removeAttribute('aria-busy');
    micBtn.setAttribute('aria-label', 'Voice input');
    micBtn.title = 'Voice input';
}

function setVoiceRecordingUi(active) {
    isVoiceRecording = active;
    if (active) {
        micBtn.classList.add('recording');
        micBtn.setAttribute('aria-pressed', 'true');
        micBtn.setAttribute('aria-label', 'Stop and send now');
        micBtn.title = 'Stop and send now';
    } else {
        micBtn.classList.remove('recording');
        micBtn.setAttribute('aria-pressed', 'false');
        micBtn.setAttribute('aria-label', 'Voice input');
        micBtn.title = 'Voice input';
    }
}

function stopVoiceMeter() {
    cancelAnimationFrame(voiceAnalyserRaf);
    voiceAnalyserRaf = null;

    if (voiceSourceNode) {
        try {
            voiceSourceNode.disconnect();
        } catch (_) { /* noop */ }
        voiceSourceNode = null;
    }

    voiceAnalyserNode = null;
    voiceTimeDomainBuffer = null;

    voiceWaveBars.forEach((bar) => {
        bar.style.height = '';
    });
    voiceWaveBars = [];
    voiceBarHeightsSmooth.length = 0;

    const barsWrap = voiceWaveOverlay?.querySelector('.voice-wave-bars');
    barsWrap?.classList.remove('voice-wave-bars--fallback', 'voice-wave-bars--processing');

    resetVoiceSessionTimers();
}

function cacheVoiceWaveBars() {
    if (!voiceWaveOverlay) return;
    voiceWaveBars = [...voiceWaveOverlay.querySelectorAll('.voice-bar')];
    voiceBarHeightsSmooth.length = voiceWaveBars.length;
    voiceBarHeightsSmooth.fill(8);
}

function computeRmsTimeDomain(analyser, buffer) {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
        const x = (buffer[i] - 128) / 128;
        sum += x * x;
    }
    return Math.sqrt(sum / buffer.length);
}

function voiceMeterFrame() {
    if (!isVoiceRecording || !voiceAnalyserNode || !voiceWaveBars.length) return;

    const nBars = voiceWaveBars.length;
    const freqData = new Uint8Array(voiceAnalyserNode.frequencyBinCount);

    if (!voiceTimeDomainBuffer) {
        voiceTimeDomainBuffer = new Uint8Array(voiceAnalyserNode.fftSize);
    }

    function tick() {
        if (!isVoiceRecording || !voiceAnalyserNode) return;

        const t = performance.now();

        voiceAnalyserNode.getByteFrequencyData(freqData);

        for (let i = 0; i < nBars; i++) {
            const bin = Math.min(
                freqData.length - 1,
                (((i + 0.5) / nBars) * freqData.length * 0.58) | 0,
            );
            const v = freqData[bin] / 255;
            const target = 5 + v * 30;
            const prev = voiceBarHeightsSmooth[i] ?? 8;
            voiceBarHeightsSmooth[i] = prev * 0.62 + target * 0.38;
            voiceWaveBars[i].style.height = `${voiceBarHeightsSmooth[i]}px`;
        }

        const rms = computeRmsTimeDomain(voiceAnalyserNode, voiceTimeDomainBuffer);
        voicePeakRms = Math.max(voicePeakRms, rms);

        const quietThreshold = voicePeakRms > 0.04 ? voicePeakRms * 0.18 : 0.014;
        const isQuiet = rms < quietThreshold;

        if (!isQuiet) {
            voiceLastSoundAt = t;
        }

        const recordAge = t - voiceRecordingStartedAt;
        if (
            recordAge >= VOICE_MIN_RECORD_MS
            && t - voiceLastSoundAt >= VOICE_SILENCE_MS
        ) {
            stopVoiceRecording();
            return;
        }

        voiceAnalyserRaf = requestAnimationFrame(tick);
    }

    voiceAnalyserRaf = requestAnimationFrame(tick);
}

async function startVoiceMeter() {
    cacheVoiceWaveBars();
    const barsWrap = voiceWaveOverlay?.querySelector('.voice-wave-bars');
    if (!mediaStream || !voiceWaveBars.length) return;
    barsWrap?.classList.remove('voice-wave-bars--fallback');

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
        barsWrap?.classList.add('voice-wave-bars--fallback');
        return;
    }

    try {
        if (!voiceAudioContext || voiceAudioContext.state === 'closed') {
            voiceAudioContext = new AC();
        }
        await voiceAudioContext.resume();

        if (voiceSourceNode) {
            try {
                voiceSourceNode.disconnect();
            } catch (_) { /* noop */ }
            voiceSourceNode = null;
        }

        voiceSourceNode = voiceAudioContext.createMediaStreamSource(mediaStream);
        voiceAnalyserNode = voiceAudioContext.createAnalyser();
        voiceAnalyserNode.fftSize = 512;
        voiceAnalyserNode.smoothingTimeConstant = 0.86;
        voiceSourceNode.connect(voiceAnalyserNode);

        voiceMeterFrame();
    } catch (err) {
        console.warn('Voice meter fallback:', err);
        barsWrap?.classList.add('voice-wave-bars--fallback');
    }
}

function releasePersistentMicrophone() {
    stopVoiceMeter();
    if (voiceAudioContext && voiceAudioContext.state !== 'closed') {
        voiceAudioContext.close().catch(() => {});
        voiceAudioContext = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        skipNextVoiceUpload = true;
        try {
            mediaRecorder.stop();
        } catch (_) { /* noop */ }
    }
    mediaRecorder = null;
    if (mediaStream) {
        mediaStream.getAudioTracks().forEach((track) => {
            track.onended = null;
            track.stop();
        });
        mediaStream = null;
    }
}

window.addEventListener('pagehide', () => {
    releasePersistentMicrophone();
});

function attachMicStreamEndedHandlers(stream) {
    stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
            releasePersistentMicrophone();
            resetMicButtonStyles();
            setVoiceRecordingUi(false);
            setVoiceOverlayMode('hidden');
        };
    });
}

function clearMediaRecorderOnly() {
    mediaRecorder = null;
}

async function ensureMicrophoneStream() {
    if (persistentMicStreamIsLive()) return mediaStream;
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
    });
    mediaStream = stream;
    attachMicStreamEndedHandlers(stream);
    return mediaStream;
}

function abortVoiceWithoutUpload() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        skipNextVoiceUpload = true;
        try {
            mediaRecorder.stop();
        } catch (e) {
            console.error('Voice stop error:', e);
            skipNextVoiceUpload = false;
            clearMediaRecorderOnly();
            stopVoiceMeter();
            setVoiceOverlayMode('hidden');
            resetMicButtonStyles();
            setVoiceRecordingUi(false);
        }
    } else {
        clearMediaRecorderOnly();
        stopVoiceMeter();
        setVoiceOverlayMode('hidden');
        resetMicButtonStyles();
        setVoiceRecordingUi(false);
    }
}

async function startVoiceRecording() {
    if (isLoading || isVoiceRecording) return;

    preferredVoiceMime = pickVoiceMimeType();

    try {
        await ensureMicrophoneStream();
    } catch (err) {
        console.error('Microphone access error:', err);
        let hint = 'Could not access the microphone.';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            hint = 'Microphone permission was denied. Allow the mic for this site in your browser settings.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            hint = 'No microphone was found on this device.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            hint = 'The microphone is in use or could not be started.';
        }
        appendDomMessage('assistant', `⚠️ ${hint}`, { persist: transcriptHasUserMessage() });
        scrollToBottom();
        return;
    }

    recordedChunks = [];
    const recorderOptions = preferredVoiceMime ? { mimeType: preferredVoiceMime } : undefined;

    let recorder;
    try {
        recorder = new MediaRecorder(mediaStream, recorderOptions);
    } catch (err) {
        console.error('MediaRecorder init error:', err);
        appendDomMessage(
            'assistant',
            '⚠️ Voice recording is not supported in this browser. Try Chrome or Edge, or type your message.',
            { persist: transcriptHasUserMessage() },
        );
        scrollToBottom();
        return;
    }

    mediaRecorder = recorder;

    mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
        const mime = mediaRecorder
            ? (mediaRecorder.mimeType || preferredVoiceMime || 'audio/webm')
            : (preferredVoiceMime || 'audio/webm');

        clearMediaRecorderOnly();
        stopVoiceMeter();
        resetMicButtonStyles();
        setVoiceRecordingUi(false);

        sendBtn.disabled = false;
        messageInput.disabled = false;

        if (skipNextVoiceUpload) {
            skipNextVoiceUpload = false;
            setVoiceOverlayMode('hidden');
            return;
        }

        const blob = new Blob(recordedChunks, { type: mime });
        recordedChunks = [];

        if (!blob.size) {
            appendDomMessage('assistant', '⚠️ No audio was captured. Check your microphone and try again.', {
                persist: transcriptHasUserMessage(),
            });
            scrollToBottom();
            setVoiceOverlayMode('hidden');
            return;
        }

        setVoiceOverlayMode('transcribing');
        await uploadVoiceBlob(blob, mime);
    };

    mediaRecorder.start(1000);

    voiceRecordingStartedAt = performance.now();
    voiceLastSoundAt = voiceRecordingStartedAt;
    voicePeakRms = 0.001;

    voiceMaxRecordTimeoutId = setTimeout(() => {
        if (isVoiceRecording) stopVoiceRecording();
    }, VOICE_MAX_RECORD_MS);

    setVoiceRecordingUi(true);
    setVoiceOverlayMode('listening');
    await startVoiceMeter();

    sendBtn.disabled = true;
    messageInput.disabled = true;
}

function stopVoiceRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    cancelAnimationFrame(voiceAnalyserRaf);
    voiceAnalyserRaf = null;
    try {
        mediaRecorder.stop();
    } catch (e) {
        console.error('stopVoiceRecording:', e);
        clearMediaRecorderOnly();
        stopVoiceMeter();
        setVoiceOverlayMode('hidden');
        resetMicButtonStyles();
        setVoiceRecordingUi(false);
        sendBtn.disabled = isLoading;
        messageInput.disabled = isLoading;
    }
}

async function toggleVoiceInput() {
    if (isLoading) return;
    if (isVoiceRecording) {
        stopVoiceRecording();
        return;
    }
    await startVoiceRecording();
}

async function uploadVoiceBlob(blob, mime) {
    welcomeMessage.classList.add('hidden');

    micBtn.classList.add('processing');
    micBtn.setAttribute('aria-busy', 'true');
    micBtn.disabled = true;
    isLoading = true;
    sendBtn.disabled = true;
    messageInput.disabled = true;

    const typingIndicator = createTypingIndicator();
    messagesDiv.appendChild(typingIndicator);
    scrollToBottom();

    const ext = mime.includes('webm')
        ? 'webm'
        : mime.includes('mp4') || mime.includes('m4a')
            ? 'm4a'
            : 'webm';

    const file = new File([blob], `recording.${ext}`, { type: mime || blob.type });
    const formData = new FormData();
    formData.append('audio', file);

    try {
        const response = await fetch(VOICE_URL, {
            method: 'POST',
            body: formData,
        });

        let data = {};
        try {
            data = await response.json();
        } catch {
            data = {};
        }

        removeTypingIndicator();

        if (!response.ok) {
            const serverMsg = data.error || `HTTP ${response.status}`;
            throw new Error(serverMsg);
        }

        if (data.reply && data.transcript) {
            appendDomMessage('user', data.transcript);
            appendDomMessage('assistant', data.reply);
        } else {
            throw new Error(data.error || 'Invalid response from voice endpoint');
        }
    } catch (error) {
        console.error('Voice upload error:', error);
        removeTypingIndicator();
        appendDomMessage('assistant', `⚠️ ${error.message || 'Voice request failed. Check the backend and API key.'}`, {
            persist: transcriptHasUserMessage(),
        });
    } finally {
        isLoading = false;
        micBtn.classList.remove('processing');
        micBtn.removeAttribute('aria-busy');
        micBtn.disabled = false;
        sendBtn.disabled = false;
        messageInput.disabled = false;
        setVoiceOverlayMode('hidden');
        scrollToBottom();
        messageInput.focus();
    }
}

/* ----------------------------------------------------------------------------- */
/* UI utilities */
/* ----------------------------------------------------------------------------- */

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
}

function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/* ----------------------------------------------------------------------------- */
/* Init & event wiring */
/* ----------------------------------------------------------------------------- */

function wireEvents() {
    messageInput.addEventListener('input', () => autoResize(messageInput));
    messageInput.addEventListener('keydown', handleKeyDown);
    sendBtn.addEventListener('click', sendMessage);
    micBtn.addEventListener('click', () => {
        void toggleVoiceInput();
    });

    sidebarNewChatBtn?.addEventListener('click', () => {
        void startNewChat();
    });

    sidebarRecentsToggleBtn?.addEventListener('click', () => {
        toggleRecentsPanel();
    });

    sidebarSearchBtn?.addEventListener('click', () => {
        openRecentsPanelForSearch();
    });

    chatSearchInput?.addEventListener('input', () => {
        chatSearchQuery = chatSearchInput.value;
        renderChatList();
    });

    chatSearchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            chatSearchInput.value = '';
            chatSearchQuery = '';
            renderChatList();
            chatSearchInput.blur();
        }
    });

    sidebarOpenBtn?.addEventListener('click', () => {
        openMobileSidebar();
    });

    sidebarBackdrop?.addEventListener('click', () => {
        closeMobileSidebar();
    });

    globalThis.addEventListener('resize', () => {
        if (!isMobileSidebarLayout()) {
            closeMobileSidebar();
            applySavedRecentsPanelState();
        } else if (sidebarEl) {
            sidebarEl.classList.remove('sidebar--recents-open');
            sidebarRecentsToggleBtn?.setAttribute('aria-expanded', 'false');
        }
    });
}

function bootstrap() {
    loadConversationsFromStorage();
    rebuildMessagesDomFromState();
    renderChatList();
    saveSession();
    applySavedRecentsPanelState();
    wireEvents();
    messageInput.focus();
}

bootstrap();
