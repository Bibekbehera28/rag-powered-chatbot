const messagesContainer = document.getElementById('messagesContainer');
const messagesDiv = document.getElementById('messages');
const welcomeMessage = document.getElementById('welcomeMessage');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const inputWrapper = document.getElementById('inputWrapper');
const voiceWaveOverlay = document.getElementById('voiceWaveOverlay');

/* Same host as chat + clear; voice sends multipart to /chat (see backend) */
const API_BASE = 'http://localhost:5000';
const CHAT_URL = `${API_BASE}/chat`;
/* Voice: multipart POST to /chat (same URL as text) so uploads work even if POST /voice is missing on the server */
const VOICE_URL = CHAT_URL;
const CLEAR_URL = `${API_BASE}/clear`;

let isLoading = false;

/* -------------------------------------------------------------------------- */
/* Voice: persistent mic (one permission prompt per visit) + composer waves */
/* -------------------------------------------------------------------------- */
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let preferredVoiceMime = '';
let isVoiceRecording = false;
let skipNextVoiceUpload = false;

/* Web Audio meter — reused across clips; full release on pagehide / track ended */
let voiceAudioContext = null;
let voiceSourceNode = null;
let voiceAnalyserNode = null;
let voiceAnalyserRaf = null;
let voiceWaveBars = [];

/**
 * Pick a MIME type supported by MediaRecorder (desktop + mobile vary).
 * Groq accepts webm; webm/opus is widely available in Chromium-based browsers.
 */
function pickVoiceMimeType() {

    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
    ];

    for (const type of candidates) {

        if (MediaRecorder.isTypeSupported(type)) {

            return type;
        }
    }

    return '';
}

function persistentMicStreamIsLive() {

    if (!mediaStream) return false;

    const tracks = mediaStream.getAudioTracks();

    return tracks.length > 0 && tracks.some((t) => t.readyState === 'live');
}

/**
 * Stop mic tracks and audio nodes — tab close, device revoked, or track ended.
 * Not called after each question (that would re-trigger the permission dialog).
 */
function releasePersistentMicrophone() {

    stopVoiceMeter();

    if (voiceAudioContext && voiceAudioContext.state !== 'closed') {

        voiceAudioContext.close().catch(() => {});

        voiceAudioContext = null;
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {

        /* Prevent onstop from starting an upload while the page is unloading */
        skipNextVoiceUpload = true;

        try {

            mediaRecorder.stop();

        } catch (_) {}
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

            setVoiceComposerRecording(false);
        };
    });
}

/** After MediaRecorder.stop(), drop only the recorder handle — keep the live stream. */
function clearMediaRecorderOnly() {

    mediaRecorder = null;
}

/** Remove recording / processing styles from the mic control. */
function resetMicButtonStyles() {

    micBtn.classList.remove('recording', 'processing');

    micBtn.setAttribute('aria-pressed', 'false');

    micBtn.removeAttribute('aria-busy');
}

/** Apply UI state while the microphone is open and capturing audio. */
function setVoiceRecordingUi(active) {

    isVoiceRecording = active;

    if (active) {

        micBtn.classList.add('recording');

        micBtn.setAttribute('aria-pressed', 'true');

        micBtn.setAttribute('aria-label', 'Stop recording and send');

    } else {

        micBtn.classList.remove('recording');

        micBtn.setAttribute('aria-pressed', 'false');

        micBtn.setAttribute('aria-label', 'Voice input');
    }
}

/** ChatGPT-style waveform layer over the textarea while recording. */
function setVoiceComposerRecording(active) {

    if (!voiceWaveOverlay || !inputWrapper) return;

    if (active) {

        voiceWaveOverlay.hidden = false;

        voiceWaveOverlay.setAttribute('aria-hidden', 'false');

        inputWrapper.classList.add('input-wrapper--voice-active');

    } else {

        voiceWaveOverlay.hidden = true;

        voiceWaveOverlay.setAttribute('aria-hidden', 'true');

        inputWrapper.classList.remove('input-wrapper--voice-active');
    }
}

function cacheVoiceWaveBars() {

    if (!voiceWaveOverlay) return;

    voiceWaveBars = [...voiceWaveOverlay.querySelectorAll('.voice-bar')];
}

function stopVoiceMeter() {

    cancelAnimationFrame(voiceAnalyserRaf);

    voiceAnalyserRaf = null;

    if (voiceSourceNode) {

        try {

            voiceSourceNode.disconnect();

        } catch (_) {}

        voiceSourceNode = null;
    }

    voiceAnalyserNode = null;

    voiceWaveBars.forEach((bar) => {

        bar.style.height = '';

    });

    voiceWaveBars = [];

    const barsWrap = voiceWaveOverlay?.querySelector('.voice-wave-bars');

    if (barsWrap) {

        barsWrap.classList.remove('voice-wave-bars--fallback');
    }
}

/** Drive bar heights from the mic signal; falls back to CSS animation if Web Audio fails. */
async function startVoiceMeter() {

    cacheVoiceWaveBars();

    const barsWrap = voiceWaveOverlay?.querySelector('.voice-wave-bars');

    if (!mediaStream || !voiceWaveBars.length) return;

    if (barsWrap) {

        barsWrap.classList.remove('voice-wave-bars--fallback');
    }

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

            } catch (_) {}

            voiceSourceNode = null;
        }

        voiceSourceNode = voiceAudioContext.createMediaStreamSource(mediaStream);

        voiceAnalyserNode = voiceAudioContext.createAnalyser();

        voiceAnalyserNode.fftSize = 256;

        voiceAnalyserNode.smoothingTimeConstant = 0.72;

        voiceSourceNode.connect(voiceAnalyserNode);

        const data = new Uint8Array(voiceAnalyserNode.frequencyBinCount);

        const nBars = voiceWaveBars.length;

        function tick() {

            if (!isVoiceRecording || !voiceAnalyserNode) return;

            voiceAnalyserNode.getByteFrequencyData(data);

            for (let i = 0; i < nBars; i++) {

                const bin = Math.min(
                    data.length - 1,
                    (((i + 0.5) / nBars) * data.length * 0.58) | 0
                );

                const v = data[bin] / 255;

                voiceWaveBars[i].style.height = `${5 + v * 30}px`;
            }

            voiceAnalyserRaf = requestAnimationFrame(tick);
        }

        voiceAnalyserRaf = requestAnimationFrame(tick);

    } catch (err) {

        console.warn('Voice meter fallback:', err);

        barsWrap?.classList.add('voice-wave-bars--fallback');
    }
}

/** First visit asks for mic; later clicks reuse the same stream (no repeat prompt). */
async function ensureMicrophoneStream() {

    if (persistentMicStreamIsLive()) {

        return mediaStream;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
        },
    });

    mediaStream = stream;

    attachMicStreamEndedHandlers(stream);

    return mediaStream;
}

/**
 * Discard an in-progress recording (e.g. New Chat) without uploading audio.
 * Does not release the persistent mic — permission stays granted for the next question.
 */
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

            setVoiceComposerRecording(false);

            resetMicButtonStyles();

            setVoiceRecordingUi(false);
        }

    } else {

        clearMediaRecorderOnly();

        stopVoiceMeter();

        setVoiceComposerRecording(false);

        resetMicButtonStyles();

        setVoiceRecordingUi(false);
    }
}

/**
 * First mic click: ensure mic stream, start MediaRecorder + in-box waves.
 * Second click: stop recorder; onstop uploads audio to the backend automatically.
 */
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

        const errMsg =
            createMessageElement('assistant', `⚠️ ${hint}`);

        welcomeMessage.classList.add('hidden');

        messagesDiv.appendChild(errMsg);

        scrollToBottom();

        return;
    }

    recordedChunks = [];

    const recorderOptions = preferredVoiceMime
        ? { mimeType: preferredVoiceMime }
        : undefined;

    try {

        mediaRecorder = new MediaRecorder(
            mediaStream,
            recorderOptions
        );

    } catch (err) {

        console.error('MediaRecorder init error:', err);

        const errMsg =
            createMessageElement(
                'assistant',
                '⚠️ Voice recording is not supported in this browser. Try Chrome or Edge, or type your message.'
            );

        welcomeMessage.classList.add('hidden');

        messagesDiv.appendChild(errMsg);

        scrollToBottom();

        return;
    }

    mediaRecorder.ondataavailable = (event) => {

        if (event.data && event.data.size > 0) {

            recordedChunks.push(event.data);
        }
    };

    /* When the user clicks the mic again, .stop() flushes buffers then runs this handler. */
    mediaRecorder.onstop = async () => {

        const mime = mediaRecorder
            ? (mediaRecorder.mimeType || preferredVoiceMime || 'audio/webm')
            : (preferredVoiceMime || 'audio/webm');

        clearMediaRecorderOnly();

        stopVoiceMeter();

        setVoiceComposerRecording(false);

        resetMicButtonStyles();

        setVoiceRecordingUi(false);

        sendBtn.disabled = false;

        messageInput.disabled = false;

        if (skipNextVoiceUpload) {

            skipNextVoiceUpload = false;

            return;
        }

        const blob = new Blob(recordedChunks, { type: mime });

        recordedChunks = [];

        if (!blob.size) {

            const emptyMsg =
                createMessageElement(
                    'assistant',
                    '⚠️ No audio was captured. Check your microphone and try again.'
                );

            messagesDiv.appendChild(emptyMsg);

            scrollToBottom();

            return;
        }

        await uploadVoiceBlob(blob, mime);
    };

    /* Periodic chunks improve reliability on some mobile browsers */
    mediaRecorder.start(1000);

    setVoiceRecordingUi(true);

    setVoiceComposerRecording(true);

    await startVoiceMeter();

    sendBtn.disabled = true;

    messageInput.disabled = true;
}

function stopVoiceRecording() {

    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    try {

        mediaRecorder.stop();

    } catch (e) {

        console.error('stopVoiceRecording:', e);

        clearMediaRecorderOnly();

        stopVoiceMeter();

        setVoiceComposerRecording(false);

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

/**
 * POST recorded audio to backend /chat (multipart); backend transcribes with Groq Whisper
 * then runs the same RAG path as JSON /chat. Renders user transcript + assistant reply.
 */
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

            const userMessage = createMessageElement('user', data.transcript);

            messagesDiv.appendChild(userMessage);

            attachCopyHandlers(userMessage);

            applySyntaxHighlighting(userMessage);

            const assistantMessage = createMessageElement(
                'assistant',
                data.reply
            );

            messagesDiv.appendChild(assistantMessage);

            attachCopyHandlers(assistantMessage);

            applySyntaxHighlighting(assistantMessage);

        } else {

            throw new Error(data.error || 'Invalid response from voice endpoint');
        }

    } catch (error) {

        console.error('Voice upload error:', error);

        removeTypingIndicator();

        const errorMessage = createMessageElement(
            'assistant',
            `⚠️ ${error.message || 'Voice request failed. Check the backend and API key.'}`
        );

        messagesDiv.appendChild(errorMessage);

    } finally {

        isLoading = false;

        micBtn.classList.remove('processing');

        micBtn.removeAttribute('aria-busy');

        micBtn.disabled = false;

        sendBtn.disabled = false;

        messageInput.disabled = false;

        scrollToBottom();

        messageInput.focus();

        setVoiceComposerRecording(false);
    }
}

/* AUTO RESIZE */
function autoResize(textarea) {

    textarea.style.height = 'auto';

    textarea.style.height =
        Math.min(textarea.scrollHeight, 200) + 'px';
}

/* ENTER TO SEND */
function handleKeyDown(event) {

    if (event.key === 'Enter' && !event.shiftKey) {

        event.preventDefault();

        sendMessage();
    }
}

/* AUTO SCROLL */
function scrollToBottom() {

    messagesContainer.scrollTop =
        messagesContainer.scrollHeight;
}

/* ESCAPE HTML */
function escapeHTML(text) {

    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function extractCodeBlocks(text) {
    const blocks = [];
    const replaced = text.replace(/```([^\n`]*)?\n?([\s\S]*?)```/g, (_, lang, code) => {
        const token = `%%CODE_BLOCK_${blocks.length}%%`;
        let cleanLanguage = (lang || "text")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9#+_-]/g, '');
        if (cleanLanguage === 'c++') cleanLanguage = 'cpp';
        if (cleanLanguage === 'c#') cleanLanguage = 'csharp';
        blocks.push({
            language: cleanLanguage || "text",
            code: code.trim()
        });
        return token;
    });
    return { replaced, blocks };
}

function renderCodeBlock(language, code, index) {
    const safeCode = escapeHTML(code);
    const safeLanguage = escapeHTML(language || "text");
    const classLanguage = (language || "text").replace(/[^a-z0-9_-]/g, "");
    return `
        <div class="code-block">
            <div class="code-header">
                <span class="code-language">${safeLanguage}</span>
                <button class="code-copy-btn" data-copy-id="code-${index}" type="button">Copy</button>
            </div>
            <pre><code id="code-${index}" class="language-${classLanguage}">${safeCode}</code></pre>
        </div>
    `;
}

/* FORMAT MESSAGES */
function formatMessage(text) {

    const { replaced, blocks } = extractCodeBlocks(text);
    text = escapeHTML(replaced);

    /* INLINE CODE */
    text = text.replace(
        /`([^`]+)`/g,
        '<code>$1</code>'
    );

    /* BOLD */
    text = text.replace(
        /\*\*(.*?)\*\*/g,
        '<strong>$1</strong>'
    );

    /* BULLET LISTS */
    text = text.replace(
        /(?:^- .+(?:\n|$))+/gm,
        (match) => {

            const items = match
                .trim()
                .split("\n")
                .map(item =>
                    `<li>${item.replace(/^- /, '')}</li>`
                )
                .join("");

            return `<ul>${items}</ul>`;
        }
    );

    /* NUMBERED LISTS */
    text = text.replace(
        /(?:^\d+\. .+(?:\n|$))+/gm,
        (match) => {

            const items = match
                .trim()
                .split("\n")
                .map(item =>
                    `<li>${item.replace(/^\d+\.\s/, '')}</li>`
                )
                .join("");

            return `<ol>${items}</ol>`;
        }
    );

    /* LINE BREAKS */
    text = text.replace(/\n/g, '<br>');
    text = text.replace(/(<br>\s*){3,}/g, '<br><br>');

    blocks.forEach((block, i) => {
        const blockHtml = renderCodeBlock(block.language, block.code, i);
        text = text.replace(`%%CODE_BLOCK_${i}%%`, blockHtml);
    });

    return text;
}

/* CREATE MESSAGE */
function createMessageElement(role, content) {

    const messageDiv = document.createElement('div');

    messageDiv.className = `message ${role}`;

    /* AVATAR */
    const avatar = document.createElement('div');

    avatar.className = 'message-avatar';

    avatar.textContent =
        role === 'user' ? 'U' : 'AI';

    /* CONTENT */
    const contentDiv = document.createElement('div');

    contentDiv.className = 'message-content';

    /* ROLE LABEL */
    const roleLabel = document.createElement('div');

    roleLabel.className = 'message-role';

    roleLabel.textContent =
        role === 'user' ? 'You' : 'Assistant';

    /* TEXT */
    const textDiv = document.createElement('div');

    textDiv.className = 'message-text';

    textDiv.innerHTML = formatMessage(content);

    /* APPEND */
    contentDiv.appendChild(roleLabel);

    contentDiv.appendChild(textDiv);

    messageDiv.appendChild(avatar);

    messageDiv.appendChild(contentDiv);

    return messageDiv;
}

/* TYPING INDICATOR */
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

    typingDiv.innerHTML =
        '<span></span><span></span><span></span>';

    contentDiv.appendChild(roleLabel);

    contentDiv.appendChild(typingDiv);

    messageDiv.appendChild(avatar);

    messageDiv.appendChild(contentDiv);

    return messageDiv;
}

/* REMOVE TYPING */
function removeTypingIndicator() {

    const indicator =
        document.getElementById('typingIndicator');

    if (indicator) indicator.remove();
}

function attachCopyHandlers(scopeElement) {
    const copyButtons = scopeElement.querySelectorAll('.code-copy-btn');
    copyButtons.forEach((btn) => {
        btn.addEventListener('click', async () => {
            const codeId = btn.getAttribute('data-copy-id');
            const codeElement = scopeElement.querySelector(`#${codeId}`);
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
    const codeBlocks = scopeElement.querySelectorAll('pre code');
    codeBlocks.forEach((block) => {
        window.hljs.highlightElement(block);
    });
}

/* SEND MESSAGE */
async function sendMessage() {

    const message = messageInput.value.trim();

    if (!message || isLoading) return;

    /* Do not send text while a voice clip is still being captured */
    if (isVoiceRecording) return;

    welcomeMessage.classList.add('hidden');

    /* USER MESSAGE */
    const userMessage =
        createMessageElement('user', message);

    messagesDiv.appendChild(userMessage);
    attachCopyHandlers(userMessage);
    applySyntaxHighlighting(userMessage);

    messageInput.value = '';

    messageInput.style.height = 'auto';

    isLoading = true;

    sendBtn.disabled = true;

    micBtn.disabled = true;

    /* SHOW TYPING */
    const typingIndicator =
        createTypingIndicator();

    messagesDiv.appendChild(typingIndicator);

    scrollToBottom();

    try {

        const response = await fetch(CHAT_URL, {

            method: 'POST',

            headers: {
                'Content-Type': 'application/json'
            },

            body: JSON.stringify({
                message: message
            })
        });

        if (!response.ok) {

            const errorText = await response.text();

            console.error("Backend error:", errorText);

            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        removeTypingIndicator();

        /* ASSISTANT MESSAGE */
        if (data.reply) {

            const assistantMessage =
                createMessageElement(
                    'assistant',
                    data.reply
                );

            messagesDiv.appendChild(assistantMessage);
            attachCopyHandlers(assistantMessage);
            applySyntaxHighlighting(assistantMessage);

        } else {

            throw new Error("Invalid response format");
        }

    } catch (error) {

        console.error('Fetch Error:', error);

        removeTypingIndicator();

        const errorMessage =
            createMessageElement(
                'assistant',
                '⚠️ Server error. Check backend or API key.'
            );

        messagesDiv.appendChild(errorMessage);

    } finally {

        isLoading = false;

        sendBtn.disabled = false;

        micBtn.disabled = false;

        scrollToBottom();

        messageInput.focus();
    }
}

/* CLEAR CHAT */
async function clearChat() {

    /* Voice: discard in-flight capture so New Chat does not upload audio */
    abortVoiceWithoutUpload();

    messagesDiv.innerHTML = '';

    welcomeMessage.classList.remove('hidden');

    messageInput.value = '';

    messageInput.style.height = 'auto';

    messageInput.focus();

    try {

        await fetch(
            CLEAR_URL,
            {
                method: 'POST'
            }
        );

    } catch (error) {

        console.error(
            "Clear chat error:",
            error
        );
    }
}

/* FOCUS ON LOAD */
messageInput.focus();