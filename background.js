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

async function askOllamaHello() {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: "Hello",
      stream: false
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
  if (message.type !== "ASK_OLLAMA_HELLO") {
    return false;
  }

  askOllamaHello()
    .then((response) => sendResponse({ response }))
    .catch((error) => sendResponse({ error: error.message }));

  return true;
});