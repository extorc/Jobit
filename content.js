if (window.inputFieldDetectorLoaded) {
  console.log("[Input Field Detector] Content script already loaded.");
} else {
window.inputFieldDetectorLoaded = true;

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

function readInputField(element, index) {
  return {
    index,
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

function getInputFields() {
  const fields = [...document.querySelectorAll("input, textarea, select")]
    .map(readInputField);

  return {
    url: window.location.href,
    title: document.title,
    detectedAt: new Date().toISOString(),
    fieldCount: fields.length,
    fields
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_INPUT_FIELDS") {
    sendResponse(getInputFields());
    return false;
  }

  if (message.type === "TOGGLE_DETECTOR_PANEL") {
    const opened = window.InputFieldDetectorPanel.toggle(getInputFields);
    sendResponse({ opened });
    return false;
  }

  return false;
});
}