(function () {
  if (window.inputFieldDetectorPanelLoaded) {
    return;
  }

  window.inputFieldDetectorPanelLoaded = true;

  const PANEL_ID = "input-field-detector-panel";

  function createDetectorPanel(getInputFields) {
    const host = document.createElement("div");
    host.id = PANEL_ID;
    host.style.position = "fixed";
    host.style.top = "80px";
    host.style.right = "24px";
    host.style.zIndex = "2147483647";

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          color-scheme: light;
          font-family: Arial, sans-serif;
        }

        .panel {
          width: 380px;
          min-width: 280px;
          min-height: 220px;
          max-width: min(760px, calc(100vw - 24px));
          max-height: calc(100vh - 24px);
          display: grid;
          grid-template-rows: auto auto auto 1fr;
          gap: 12px;
          padding: 0 14px 14px;
          overflow: auto;
          resize: both;
          border: 1px solid #c8d2d6;
          border-radius: 8px;
          box-shadow: 0 18px 48px rgba(21, 32, 38, 0.22);
          color: #172026;
          background: #f7f7f5;
        }

        .header {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          min-height: 44px;
          margin: 0 -14px;
          padding: 0 8px 0 14px;
          cursor: move;
          user-select: none;
          border-bottom: 1px solid #d8dedf;
          background: #ffffff;
          border-radius: 8px 8px 0 0;
        }

        h1 {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0;
        }

        .close {
          width: 32px;
          height: 32px;
          border: 0;
          border-radius: 6px;
          color: #3a464c;
          background: transparent;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
        }

        .close:hover {
          background: #edf1f2;
        }

        .detect {
          width: 100%;
          min-height: 40px;
          border: 0;
          border-radius: 6px;
          color: #ffffff;
          background: #176b87;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
        }

        .detect:hover {
          background: #12546b;
        }

        button:focus-visible {
          outline: 3px solid #f2be22;
          outline-offset: 2px;
        }

        button:disabled {
          cursor: wait;
          opacity: 0.72;
        }

        .status {
          min-height: 18px;
          margin: 0;
          color: #4d5a61;
          font-size: 13px;
        }

        .output {
          min-height: 92px;
          margin: 0;
          padding: 10px;
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-word;
          border: 1px solid #d8dedf;
          border-radius: 6px;
          background: #ffffff;
          font-family: Consolas, "Courier New", monospace;
          font-size: 13px;
        }
      </style>
      <section class="panel" role="dialog" aria-label="Input Field Detector">
        <div class="header" data-drag-handle>
          <h1>Input Field Detector</h1>
          <button class="close" type="button" aria-label="Close">&times;</button>
        </div>
        <button class="detect" type="button">Fetch Input Fields JSON</button>
        <p class="status" aria-live="polite"></p>
        <pre class="output"></pre>
      </section>
    `;

    const header = shadow.querySelector("[data-drag-handle]");
    const closeButton = shadow.querySelector(".close");
    const detectButton = shadow.querySelector(".detect");
    const statusElement = shadow.querySelector(".status");
    const outputElement = shadow.querySelector(".output");

    let dragStart = null;

    function keepPanelInViewport(left, top) {
      const rect = host.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);

      host.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
      host.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
      host.style.right = "auto";
    }

    header.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) {
        return;
      }

      const rect = host.getBoundingClientRect();
      dragStart = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      header.setPointerCapture(event.pointerId);
    });

    header.addEventListener("pointermove", (event) => {
      if (!dragStart || event.pointerId !== dragStart.pointerId) {
        return;
      }

      keepPanelInViewport(event.clientX - dragStart.offsetX, event.clientY - dragStart.offsetY);
    });

    header.addEventListener("pointerup", () => {
      dragStart = null;
    });

    header.addEventListener("pointercancel", () => {
      dragStart = null;
    });

    closeButton.addEventListener("click", () => {
      host.remove();
    });

    function appendOllamaLine(fieldNumber, responseText, forceUnavailable = false, suffix = "") {
      const normalizedResponse = String(responseText || "").trim();
      const isUnavailable = forceUnavailable || normalizedResponse.toUpperCase().startsWith("NOT_AVAILABLE");
      const line = document.createElement("span");

      line.textContent = `\nField ${fieldNumber}: ${normalizedResponse}${suffix}`;

      if (isUnavailable) {
        line.style.color = "#c62828";
        line.style.fontWeight = "700";
      }

      outputElement.append(line);
    }

    function getApplicantValue(responseText) {
      const normalizedResponse = String(responseText || "").trim();

      if (!normalizedResponse || normalizedResponse.toUpperCase().startsWith("NOT_AVAILABLE")) {
        return "";
      }

      const separatorIndex = normalizedResponse.indexOf(":");

      if (separatorIndex === -1) {
        return "";
      }

      return normalizedResponse.slice(separatorIndex + 1).trim();
    }

    function isTextLikeField(field) {
      const textTypes = new Set(["", "text", "email", "tel", "url", "search", "number"]);
      const tagName = String(field.tagName || "").toLowerCase();
      const type = String(field.type || "").toLowerCase();

      return tagName === "textarea" || (tagName === "input" && textTypes.has(type));
    }

    detectButton.addEventListener("click", async () => {
      detectButton.disabled = true;
      statusElement.textContent = "Detecting fields...";
      outputElement.textContent = "";

      try {
        const frameResult = await chrome.runtime.sendMessage({ type: "GET_FIELDS_FROM_ALL_FRAMES" });

        if (frameResult?.error) {
          throw new Error(frameResult.error);
        }

        const result = frameResult?.response || getInputFields();
        const count = result.fields.length;
        statusElement.textContent = `Detected ${count} field${count === 1 ? "" : "s"}. Asking Ollama one by one...`;
        outputElement.textContent = `${JSON.stringify(result, null, 2)}\n\nOllama applicant values:`;

        for (const field of result.fields) {
          const fieldNumber = field.index + 1;
          statusElement.textContent = `Asking Ollama about field ${fieldNumber} of ${count}...`;

          try {
            const ollamaResult = await chrome.runtime.sendMessage({
              type: "ASK_OLLAMA_FIELD_TYPE",
              field
            });

            if (ollamaResult?.error) {
              throw new Error(ollamaResult.error);
            }

            const responseText = ollamaResult?.response || "";
            const applicantValue = getApplicantValue(responseText);
            let suffix = "";

            if (applicantValue && isTextLikeField(field)) {
              const fillResult = await chrome.runtime.sendMessage({
                type: "FILL_TEXT_FIELD",
                field,
                value: applicantValue
              });

              if (fillResult?.error) {
                suffix = ` (fill failed: ${fillResult.error})`;
              } else if (fillResult?.response?.filled) {
                suffix = " (filled)";
              } else if (fillResult?.response?.reason) {
                suffix = ` (not filled: ${fillResult.response.reason})`;
              }
            }

            appendOllamaLine(fieldNumber, responseText, false, suffix);
          } catch (error) {
            appendOllamaLine(fieldNumber, `NOT_AVAILABLE: ${error.message}`, true);
          }

          outputElement.scrollTop = outputElement.scrollHeight;
        }

        statusElement.textContent = `Detected ${count} field${count === 1 ? "" : "s"}. Ollama responses complete.`;
      } catch (error) {
        statusElement.textContent = "Could not complete request";
        outputElement.textContent = error.message;
      } finally {
        detectButton.disabled = false;
      }
    });

    return host;
  }

  function toggle(getInputFields) {
    const existingPanel = document.getElementById(PANEL_ID);

    if (existingPanel) {
      existingPanel.remove();
      return false;
    }

    document.documentElement.append(createDetectorPanel(getInputFields));
    return true;
  }

  window.InputFieldDetectorPanel = { toggle };
}());