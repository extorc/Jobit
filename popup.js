const detectButton = document.getElementById("detectButton");
const statusElement = document.getElementById("status");
const outputElement = document.getElementById("output");

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function askCurrentTabForFields() {
  const tab = await getActiveTab();

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  if (!tab.url || !/^https?:\/\//.test(tab.url)) {
    throw new Error("This extension only runs on regular http or https pages.");
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "GET_INPUT_FIELDS" });
  } catch (error) {
    if (!error.message.includes("Receiving end does not exist")) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    return chrome.tabs.sendMessage(tab.id, { type: "GET_INPUT_FIELDS" });
  }
}

async function detectFields() {
  detectButton.disabled = true;
  statusElement.textContent = "Detecting fields...";
  outputElement.textContent = "";

  try {
    const result = await askCurrentTabForFields();
    const count = result.fields.length;
    statusElement.textContent = `Detected ${count} field${count === 1 ? "" : "s"}`;
    outputElement.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    statusElement.textContent = "Could not detect fields";
    outputElement.textContent = error.message;
  } finally {
    detectButton.disabled = false;
  }
}

detectButton.addEventListener("click", detectFields);
