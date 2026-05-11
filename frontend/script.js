const messagesContainer = document.getElementById('messagesContainer');
const messagesDiv = document.getElementById('messages');
const welcomeMessage = document.getElementById('welcomeMessage');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

const API_URL = 'http://localhost:5000/chat';

let isLoading = false;

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

    /* SHOW TYPING */
    const typingIndicator =
        createTypingIndicator();

    messagesDiv.appendChild(typingIndicator);

    scrollToBottom();

    try {

        const response = await fetch(API_URL, {

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

        scrollToBottom();

        messageInput.focus();
    }
}

/* CLEAR CHAT */
async function clearChat() {

    messagesDiv.innerHTML = '';

    welcomeMessage.classList.remove('hidden');

    messageInput.value = '';

    messageInput.style.height = 'auto';

    messageInput.focus();

    try {

        await fetch(
            'http://localhost:5000/clear',
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