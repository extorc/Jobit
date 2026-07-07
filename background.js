const CONTENT_FILES = ["detector-panel.js", "content.js"];
const OLLAMA_URL = "http://localhost:11434/api/generate";
const OLLAMA_MODEL = "llama3.1";

async function showDetectorPanel(tab) {
  if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_DETECTOR_PANEL" });
  } catch (error) {
    if (!error.message.includes("Receiving end does not exist")) {
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: CONTENT_FILES
    });

    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_DETECTOR_PANEL" });
  }
}

function buildFieldTypePrompt(field) {
  return `Read this one detected input field JSON and return only one plain string.

Output this field's type wrapped in angle brackets.
Use the exact type value from the field.
Do not include markdown, explanations, labels, JSON, or any extra text.

Example output:
<text>

Detected input field JSON:
${JSON.stringify(field, null, 2)}`;
}

async function askOllamaForFieldType(field) {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: buildFieldTypePrompt(field),
      stream: false,
      options: {
        temperature: 0
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed with HTTP ${response.status}.`);
  }

  const data = await response.json();
  return data.response || JSON.stringify(data, null, 2);
}

chrome.action.onClicked.addListener(showDetectorPanel);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "ASK_OLLAMA_FIELD_TYPE") {
    return false;
  }

  askOllamaForFieldType(message.field)
    .then((response) => sendResponse({ response }))
    .catch((error) => sendResponse({ error: error.message }));

  return true;
});