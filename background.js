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

function collectInputFieldsInFrame() {
  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function getLabelText(element) {
    const labels = [];

    if (element.id) {
      const explicitLabel = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (explicitLabel?.innerText.trim()) {
        labels.push(explicitLabel.innerText.trim());
      }
    }

    const wrappingLabel = element.closest("label");
    if (wrappingLabel?.innerText.trim()) {
      labels.push(wrappingLabel.innerText.trim());
    }

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel?.trim()) {
      labels.push(ariaLabel.trim());
    }

    const ariaLabelledBy = element.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      const text = ariaLabelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText.trim())
        .filter(Boolean)
        .join(" ");

      if (text) {
        labels.push(text);
      }
    }

    return [...new Set(labels)].join(" | ");
  }

  function getOptions(element) {
    if (element.tagName === "SELECT") {
      return [...element.options].map((option) => ({
        text: option.text.trim(),
        value: option.value
      }));
    }

    return [];
  }

  function getCssPath(element) {
    if (element.id) {
      return `#${CSS.escape(element.id)}`;
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      const siblings = [...current.parentElement.children].filter((child) => child.tagName === current.tagName);
      const index = siblings.indexOf(current) + 1;
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      current = current.parentElement;
    }

    return parts.join(" > ");
  }

  function readField(element, index) {
    return {
      index,
      frameUrl: window.location.href,
      tagName: element.tagName.toLowerCase(),
      type: element.type || element.tagName.toLowerCase(),
      selector: getCssPath(element),
      id: element.id || "",
      name: element.name || "",
      label: getLabelText(element),
      placeholder: element.placeholder || "",
      value: element.type === "password" ? "" : element.value,
      checked: "checked" in element ? element.checked : null,
      required: element.required || false,
      disabled: element.disabled || false,
      readOnly: element.readOnly || false,
      visible: isVisible(element),
      autocomplete: element.autocomplete || "",
      maxLength: element.maxLength > -1 ? element.maxLength : null,
      options: getOptions(element)
    };
  }

  return {
    frameUrl: window.location.href,
    title: document.title,
    fields: [...document.querySelectorAll("input, textarea, select")].map(readField)
  };
}

async function getFieldsFromAllFrames(tabId) {
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: collectInputFieldsInFrame
  });

  const frames = injectionResults.map((item) => ({
    frameId: item.frameId,
    frameUrl: item.result?.frameUrl || "",
    title: item.result?.title || "",
    fieldCount: item.result?.fields?.length || 0
  }));

  const fields = injectionResults
    .flatMap((item) => (item.result?.fields || []).map((field) => ({
      ...field,
      frameId: item.frameId
    })))
    .map((field, index) => ({ ...field, index }));

  return {
    url: "",
    title: "",
    detectedAt: new Date().toISOString(),
    frameCount: frames.length,
    frames,
    fieldCount: fields.length,
    fields
  };
}

async function getApplicantInfo() {
  const response = await fetch(chrome.runtime.getURL("applicant.json"));

  if (!response.ok) {
    throw new Error(`Could not read applicant.json. HTTP ${response.status}.`);
  }

  return response.json();
}

function fillTextFieldInFrame(field, value) {
  const textInputTypes = new Set([
    "",
    "text",
    "email",
    "tel",
    "url",
    "search",
    "number"
  ]);
  const element = document.querySelector(field.selector);

  if (!element) {
    return { filled: false, reason: "field not found" };
  }

  const tagName = element.tagName.toLowerCase();
  const type = (element.getAttribute("type") || "text").toLowerCase();
  const isTextField = tagName === "textarea" || (tagName === "input" && textInputTypes.has(type));

  if (!isTextField) {
    return { filled: false, reason: "not a text field" };
  }

  if (element.disabled || element.readOnly) {
    return { filled: false, reason: "field is disabled or readonly" };
  }

  const prototype = tagName === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));

  return { filled: true };
}

async function fillTextField(tabId, field, value) {
  const injectionResults = await chrome.scripting.executeScript({
    target: {
      tabId,
      frameIds: [field.frameId || 0]
    },
    func: fillTextFieldInFrame,
    args: [field, value]
  });

  return injectionResults[0]?.result || { filled: false, reason: "no fill result" };
}

function buildFieldTypePrompt(field, applicantInfo) {
  return `You are matching one web form field to one applicant profile value.
This is NOT a programming task. Do NOT write code, pseudocode, Python, JavaScript, functions, regex, algorithms, or explanations.

Your job:
1. Read the FIELD JSON.
2. Decide what information the field asks for.
3. Look for that information in APPLICANT JSON.
4. Return exactly one line using exactly one of these formats:

If a matching applicant key exists:
key: value

If no matching applicant key exists or the value is empty:
NOT_AVAILABLE: reason

Rules:
- Use only keys and values that already exist in APPLICANT JSON.
- Do not invent or infer missing values.
- Do not output JSON.
- Do not output markdown.
- Do not output quotes.
- Do not output more than one line.
- Do not mention how to solve the task.
- The response must be under 80 characters.

Good examples:
email: mittalnitin.2022@gmail.com
phone: 9958850564
NOT_AVAILABLE: no work authorization

Bad examples:
def match_field(...)
Here is a Python script
{"email":"x"}
The field appears to ask for email

FIELD JSON:
${JSON.stringify(field, null, 2)}

APPLICANT JSON:
${JSON.stringify(applicantInfo, null, 2)}

Return one line only:`;
}

async function askOllamaForFieldType(field) {
  const applicantInfo = await getApplicantInfo();
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: buildFieldTypePrompt(field, applicantInfo),
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
  if (message.type === "GET_FIELDS_FROM_ALL_FRAMES") {
    getFieldsFromAllFrames(sender.tab.id)
      .then((response) => sendResponse({ response }))
      .catch((error) => sendResponse({ error: error.message }));

    return true;
  }

  if (message.type === "ASK_OLLAMA_FIELD_TYPE") {
    askOllamaForFieldType(message.field)
      .then((response) => sendResponse({ response }))
      .catch((error) => sendResponse({ error: error.message }));

    return true;
  }

  if (message.type === "FILL_TEXT_FIELD") {
    fillTextField(sender.tab.id, message.field, message.value)
      .then((response) => sendResponse({ response }))
      .catch((error) => sendResponse({ error: error.message }));

    return true;
  }

  return false;
});